package app

import (
	"bufio"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

type NodeMetricCollector struct {
	mu                   sync.Mutex
	previousNetworkBytes uint64
	previousNetworkAt    time.Time
}

func NewNodeMetricCollector() *NodeMetricCollector {
	return &NodeMetricCollector{}
}

func (collector *NodeMetricCollector) Collect(nodeID string) (NodeMetricSample, error) {
	return NodeMetricSample{
		NodeID:        nodeID,
		CollectedAt:   now(),
		CPUPercent:    collectCPUPercent(),
		MemoryPercent: collectMemoryPercent(),
		DiskPercent:   collectDiskPercent(),
		NetworkMBps:   collector.collectNetworkMBps(),
	}, nil
}

func collectCPUPercent() int {
	output, err := exec.Command("ps", "-A", "-o", "%cpu=").Output()
	if err != nil {
		return 0
	}
	total := 0.0
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		value, err := strconv.ParseFloat(strings.TrimSpace(scanner.Text()), 64)
		if err == nil {
			total += value
		}
	}
	cpus := runtime.NumCPU()
	if cpus <= 0 {
		cpus = 1
	}
	return clampPercent(int(total/float64(cpus) + 0.5))
}

func collectMemoryPercent() int {
	switch runtime.GOOS {
	case "linux":
		return collectLinuxMemoryPercent()
	case "darwin":
		return collectDarwinMemoryPercent()
	default:
		return 0
	}
}

func collectLinuxMemoryPercent() int {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0
	}
	totalKB := uint64(0)
	availableKB := uint64(0)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSuffix(fields[0], ":") {
		case "MemTotal":
			totalKB = value
		case "MemAvailable":
			availableKB = value
		}
	}
	if totalKB == 0 || availableKB > totalKB {
		return 0
	}
	return percentUsed(totalKB-availableKB, totalKB)
}

func collectDarwinMemoryPercent() int {
	totalOutput, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return 0
	}
	totalBytes, err := strconv.ParseUint(strings.TrimSpace(string(totalOutput)), 10, 64)
	if err != nil || totalBytes == 0 {
		return 0
	}
	vmOutput, err := exec.Command("vm_stat").Output()
	if err != nil {
		return 0
	}
	pageSize := uint64(4096)
	freePages := uint64(0)
	inactivePages := uint64(0)
	purgeablePages := uint64(0)
	speculativePages := uint64(0)
	scanner := bufio.NewScanner(strings.NewReader(string(vmOutput)))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.Contains(line, "page size of") {
			if size := parseDarwinPageSize(line); size > 0 {
				pageSize = size
			}
			continue
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		pages, err := strconv.ParseUint(strings.Trim(strings.TrimSpace(value), "."), 10, 64)
		if err != nil {
			continue
		}
		switch strings.TrimSpace(key) {
		case "Pages free":
			freePages = pages
		case "Pages inactive":
			inactivePages = pages
		case "Pages purgeable":
			purgeablePages = pages
		case "Pages speculative":
			speculativePages = pages
		}
	}
	freeBytes := (freePages + inactivePages + purgeablePages + speculativePages) * pageSize
	if freeBytes > totalBytes {
		return 0
	}
	return percentUsed(totalBytes-freeBytes, totalBytes)
}

func parseDarwinPageSize(line string) uint64 {
	_, suffix, ok := strings.Cut(line, "page size of")
	if !ok {
		return 0
	}
	fields := strings.Fields(suffix)
	if len(fields) == 0 {
		return 0
	}
	value, err := strconv.ParseUint(fields[0], 10, 64)
	if err != nil {
		return 0
	}
	return value
}

func collectDiskPercent() int {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return 0
	}
	total := uint64(stat.Blocks) * uint64(stat.Bsize)
	available := uint64(stat.Bavail) * uint64(stat.Bsize)
	if total == 0 || available > total {
		return 0
	}
	return percentUsed(total-available, total)
}

func (collector *NodeMetricCollector) collectNetworkMBps() float64 {
	totalBytes := collectNetworkBytes()
	nowTime := time.Now().UTC()
	collector.mu.Lock()
	defer collector.mu.Unlock()
	if collector.previousNetworkBytes == 0 || collector.previousNetworkAt.IsZero() {
		collector.previousNetworkBytes = totalBytes
		collector.previousNetworkAt = nowTime
		return 0
	}
	elapsed := nowTime.Sub(collector.previousNetworkAt).Seconds()
	previousBytes := collector.previousNetworkBytes
	collector.previousNetworkBytes = totalBytes
	collector.previousNetworkAt = nowTime
	if elapsed <= 0 || totalBytes < previousBytes {
		return 0
	}
	return normalizeNodeNetworkMBps(float64(totalBytes-previousBytes) / elapsed / 1024 / 1024)
}

func collectNetworkBytes() uint64 {
	switch runtime.GOOS {
	case "linux":
		return collectLinuxNetworkBytes()
	case "darwin":
		return collectDarwinNetworkBytes()
	default:
		return 0
	}
}

func collectLinuxNetworkBytes() uint64 {
	data, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return 0
	}
	total := uint64(0)
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		line := scanner.Text()
		name, values, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		if strings.TrimSpace(name) == "lo" {
			continue
		}
		fields := strings.Fields(values)
		if len(fields) < 16 {
			continue
		}
		received, receiveErr := strconv.ParseUint(fields[0], 10, 64)
		sent, sendErr := strconv.ParseUint(fields[8], 10, 64)
		if receiveErr == nil {
			total += received
		}
		if sendErr == nil {
			total += sent
		}
	}
	return total
}

func collectDarwinNetworkBytes() uint64 {
	output, err := exec.Command("netstat", "-ibn").Output()
	if err != nil {
		return 0
	}
	total := uint64(0)
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 10 || fields[0] == "Name" {
			continue
		}
		name := fields[0]
		if strings.HasPrefix(name, "lo") || strings.HasSuffix(name, "*") || !strings.HasPrefix(fields[2], "<Link#") {
			continue
		}
		received, receiveErr := strconv.ParseUint(fields[6], 10, 64)
		sent, sendErr := strconv.ParseUint(fields[9], 10, 64)
		if receiveErr == nil {
			total += received
		}
		if sendErr == nil {
			total += sent
		}
	}
	return total
}

func percentUsed(used uint64, total uint64) int {
	if total == 0 {
		return 0
	}
	return clampPercent(int(float64(used)/float64(total)*100 + 0.5))
}
