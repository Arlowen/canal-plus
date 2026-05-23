package app

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	taskProcessSpecEnv  = "CANAL_PLUS_TASK_PROCESS_SPEC"
	taskLogLimitPerTask = 300
)

type TaskLogService struct {
	store *Store
	mu    sync.RWMutex
	subs  map[string]map[chan TaskLogEntry]struct{}
}

func NewTaskLogService(store *Store) *TaskLogService {
	return &TaskLogService{
		store: store,
		subs:  map[string]map[chan TaskLogEntry]struct{}{},
	}
}

func (s *TaskLogService) List(taskID string, limit int) []TaskLogEntry {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	if limit <= 0 {
		limit = 120
	}
	filtered := make([]TaskLogEntry, 0, limit)
	for index := len(s.store.data.TaskLogs) - 1; index >= 0; index-- {
		entry := s.store.data.TaskLogs[index]
		if entry.TaskID != taskID {
			continue
		}
		filtered = append(filtered, cloneJSON(entry))
		if len(filtered) >= limit {
			break
		}
	}
	for left, right := 0, len(filtered)-1; left < right; left, right = left+1, right-1 {
		filtered[left], filtered[right] = filtered[right], filtered[left]
	}
	return filtered
}

func (s *TaskLogService) Subscribe(taskID string) (<-chan TaskLogEntry, func()) {
	channel := make(chan TaskLogEntry, 32)
	s.mu.Lock()
	if _, ok := s.subs[taskID]; !ok {
		s.subs[taskID] = map[chan TaskLogEntry]struct{}{}
	}
	s.subs[taskID][channel] = struct{}{}
	s.mu.Unlock()
	return channel, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if listeners, ok := s.subs[taskID]; ok {
			delete(listeners, channel)
			if len(listeners) == 0 {
				delete(s.subs, taskID)
			}
		}
		close(channel)
	}
}

func (s *TaskLogService) Broadcast(entry TaskLogEntry) {
	s.mu.RLock()
	listeners := s.subs[entry.TaskID]
	for channel := range listeners {
		select {
		case channel <- entry:
		default:
		}
	}
	s.mu.RUnlock()
}

type TaskStatusService struct {
	store *Store
}

func NewTaskStatusService(store *Store) *TaskStatusService {
	return &TaskStatusService{store: store}
}

func (s *TaskStatusService) MarkProcessLaunching(taskID string) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	runtime := s.store.ensureRuntimeLocked(taskID)
	runtime.ProcessStatus = "starting"
	runtime.ProcessID = 0
	runtime.ExitCode = nil
	runtime.UpdatedAt = now()
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, 0, "info", runtime.Phase, "任务进程启动中")
	return entry, s.store.saveLocked()
}

func (s *TaskStatusService) MarkProcessStarted(taskID string, pid int) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	runtime := s.store.ensureRuntimeLocked(taskID)
	timestamp := now()
	runtime.ProcessStatus = "running"
	runtime.ProcessID = pid
	runtime.ProcessStartedAt = timestamp
	runtime.ProcessStoppedAt = ""
	runtime.LastHeartbeatAt = timestamp
	runtime.LastLogAt = timestamp
	runtime.LastLogMessage = "任务进程已启动"
	runtime.ExitCode = nil
	if runtime.StartedAt == "" {
		runtime.StartedAt = timestamp
	}
	runtime.UpdatedAt = timestamp
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, pid, "info", runtime.Phase, fmt.Sprintf("任务进程已启动，PID %d", pid))
	return entry, s.store.saveLocked()
}

func (s *TaskStatusService) ApplyProcessEvent(taskID string, pid int, event taskProcessEvent) (TaskLogEntry, bool, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	runtime := s.store.ensureRuntimeLocked(taskID)
	timestamp := valueOr(event.Timestamp, now())
	runtime.ProcessStatus = "running"
	runtime.ProcessID = pid
	runtime.LastHeartbeatAt = timestamp
	runtime.UpdatedAt = timestamp
	if event.Phase != "" {
		runtime.Phase = event.Phase
	}
	if event.FullTotalRows > 0 {
		runtime.FullTotalRows = event.FullTotalRows
	}
	if event.FullSyncedRows >= 0 {
		runtime.FullSyncedRows = event.FullSyncedRows
	}
	if event.DelaySeconds >= 0 {
		runtime.DelaySeconds = event.DelaySeconds
	}
	if event.EventsPerSecond >= 0 {
		runtime.EventsPerSecond = event.EventsPerSecond
	}
	if event.BinlogFile != "" {
		runtime.BinlogFile = event.BinlogFile
	}
	if event.BinlogPosition > 0 {
		runtime.BinlogPosition = event.BinlogPosition
	}

	var entry TaskLogEntry
	created := false
	if strings.TrimSpace(event.Message) != "" {
		runtime.LastLogAt = timestamp
		runtime.LastLogMessage = event.Message
		entry = s.store.appendTaskLogLocked(taskID, runtime.NodeID, pid, valueOr(event.Level, "info"), runtime.Phase, event.Message)
		created = true
	}
	return entry, created, s.store.saveLocked()
}

func (s *TaskStatusService) MarkProcessStopped(taskID string, message string) (TaskLogEntry, error) {
	return s.markProcessEnded(taskID, "stopped", nil, message, false)
}

func (s *TaskStatusService) MarkProcessCompleted(taskID string, message string) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	timestamp := now()
	for index := range s.store.data.SyncTasks {
		if s.store.data.SyncTasks[index].ID != taskID {
			continue
		}
		s.store.data.SyncTasks[index].Status = TaskStopped
		s.store.data.SyncTasks[index].UpdatedAt = timestamp
		runtime := s.store.ensureRuntimeLocked(taskID)
		runtime.Phase = "stopped"
		runtime.DelaySeconds = 0
		runtime.EventsPerSecond = 0
		runtime.ProcessStatus = "stopped"
		runtime.ProcessID = 0
		runtime.ProcessStoppedAt = timestamp
		runtime.LastHeartbeatAt = timestamp
		runtime.LastLogAt = timestamp
		runtime.LastLogMessage = message
		runtime.ExitCode = nil
		runtime.NodeID = ""
		runtime.LeaseExpiresAt = ""
		runtime.UpdatedAt = timestamp
		s.store.removeLeaseLocked(taskID)
		s.store.recountNodeTasksLocked()
		entry := s.store.appendTaskLogLocked(taskID, "", 0, "info", "stopped", message)
		return entry, s.store.saveLocked()
	}
	return TaskLogEntry{}, errors.New("同步任务不存在")
}

func (s *TaskStatusService) MarkProcessFailed(taskID string, exitCode int, message string) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	timestamp := now()
	for index := range s.store.data.SyncTasks {
		if s.store.data.SyncTasks[index].ID != taskID {
			continue
		}
		s.store.data.SyncTasks[index].Status = TaskFailed
		s.store.data.SyncTasks[index].UpdatedAt = timestamp
		runtime := s.store.ensureRuntimeLocked(taskID)
		runtime.Phase = "failed"
		runtime.EventsPerSecond = 0
		runtime.ProcessStatus = "failed"
		runtime.ProcessID = 0
		runtime.ProcessStoppedAt = timestamp
		runtime.LastHeartbeatAt = timestamp
		runtime.LastLogAt = timestamp
		runtime.LastLogMessage = message
		runtime.ExitCode = &exitCode
		runtime.UpdatedAt = timestamp
		entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, 0, "error", "failed", message)
		return entry, s.store.saveLocked()
	}
	return TaskLogEntry{}, errors.New("同步任务不存在")
}

func (s *TaskStatusService) markProcessEnded(taskID string, processStatus string, exitCode *int, message string, clearNode bool) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	runtime := s.store.ensureRuntimeLocked(taskID)
	timestamp := now()
	runtime.ProcessStatus = processStatus
	runtime.ProcessID = 0
	runtime.ProcessStoppedAt = timestamp
	runtime.LastHeartbeatAt = timestamp
	runtime.LastLogAt = timestamp
	runtime.LastLogMessage = message
	runtime.UpdatedAt = timestamp
	runtime.ExitCode = exitCode
	if clearNode {
		runtime.NodeID = ""
		runtime.LeaseExpiresAt = ""
		s.store.removeLeaseLocked(taskID)
		s.store.recountNodeTasksLocked()
	}
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, 0, "info", runtime.Phase, message)
	return entry, s.store.saveLocked()
}

type TaskProcessManager struct {
	store      *Store
	logs       *TaskLogService
	status     *TaskStatusService
	binaryPath string

	mu        sync.Mutex
	processes map[string]*managedTaskProcess
}

type managedTaskProcess struct {
	taskID        string
	nodeID        string
	initMode      string
	cmd           *exec.Cmd
	stopRequested bool
	stopMessage   string
}

func NewTaskProcessManager(store *Store, logs *TaskLogService, status *TaskStatusService, binaryPath string) *TaskProcessManager {
	return &TaskProcessManager{
		store:      store,
		logs:       logs,
		status:     status,
		binaryPath: binaryPath,
		processes:  map[string]*managedTaskProcess{},
	}
}

func (m *TaskProcessManager) RecoverActiveTasks() {
	tasks := m.store.Tasks()
	for _, task := range tasks {
		if task.Status == TaskFullSyncing || task.Status == TaskIncrementalRunning {
			_ = m.StartTask(task.ID)
		}
	}
}

func (m *TaskProcessManager) StartTask(taskID string) error {
	m.mu.Lock()
	if _, exists := m.processes[taskID]; exists {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	task, ok := m.store.GetTask(taskID)
	if !ok {
		return errors.New("同步任务不存在")
	}
	runtime, ok := m.store.Runtime(taskID)
	if !ok {
		return errors.New("任务运行态不存在")
	}
	if runtime.NodeID == "" {
		return nil
	}
	if task.Status != TaskFullSyncing && task.Status != TaskIncrementalRunning {
		return nil
	}

	entry, err := m.status.MarkProcessLaunching(taskID)
	if err == nil {
		m.logs.Broadcast(entry)
	}

	specBytes, err := json.Marshal(taskProcessSpec{
		TaskID:         task.ID,
		TaskName:       task.Name,
		InitMode:       task.Strategy.InitMode,
		Phase:          runtime.Phase,
		FullTotalRows:  runtime.FullTotalRows,
		FullSyncedRows: runtime.FullSyncedRows,
		BinlogFile:     runtime.BinlogFile,
		BinlogPosition: runtime.BinlogPosition,
		NodeID:         runtime.NodeID,
	})
	if err != nil {
		return err
	}

	command := exec.Command(m.binaryPath, "task-process")
	command.Env = append(os.Environ(), taskProcessSpecEnv+"="+base64.RawStdEncoding.EncodeToString(specBytes))
	stdout, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return err
	}
	if err := command.Start(); err != nil {
		exitCode := -1
		failedEntry, markErr := m.status.MarkProcessFailed(taskID, exitCode, "任务进程启动失败："+err.Error())
		if markErr == nil {
			m.logs.Broadcast(failedEntry)
		}
		return err
	}

	process := &managedTaskProcess{
		taskID:   taskID,
		nodeID:   runtime.NodeID,
		initMode: task.Strategy.InitMode,
		cmd:      command,
	}

	m.mu.Lock()
	m.processes[taskID] = process
	m.mu.Unlock()

	startedEntry, markErr := m.status.MarkProcessStarted(taskID, command.Process.Pid)
	if markErr == nil {
		m.logs.Broadcast(startedEntry)
	}

	go m.consumeStream(process, stdout, false)
	go m.consumeStream(process, stderr, true)
	go m.waitProcess(process)
	return nil
}

func (m *TaskProcessManager) StopTask(taskID string, message string) error {
	m.mu.Lock()
	process, ok := m.processes[taskID]
	if ok {
		process.stopRequested = true
		process.stopMessage = message
	}
	m.mu.Unlock()
	if !ok {
		entry, err := m.status.MarkProcessStopped(taskID, message)
		if err == nil {
			m.logs.Broadcast(entry)
		}
		return err
	}

	entry, err := m.status.markProcessEnded(taskID, "stopping", nil, valueOr(message, "任务进程停止中"), false)
	if err == nil {
		m.logs.Broadcast(entry)
	}

	if process.cmd.Process == nil {
		return nil
	}
	if signalErr := process.cmd.Process.Signal(os.Interrupt); signalErr != nil {
		_ = process.cmd.Process.Kill()
		return signalErr
	}
	go func(cmd *exec.Cmd) {
		time.Sleep(2 * time.Second)
		if cmd.ProcessState == nil || !cmd.ProcessState.Exited() {
			_ = cmd.Process.Kill()
		}
	}(process.cmd)
	return nil
}

func (m *TaskProcessManager) EnsureTaskStopped(taskID string, message string) {
	_ = m.StopTask(taskID, message)
}

func (m *TaskProcessManager) consumeStream(process *managedTaskProcess, stream io.Reader, stderr bool) {
	scanner := bufio.NewScanner(stream)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if stderr {
			entry, created, err := m.status.ApplyProcessEvent(process.taskID, process.cmd.Process.Pid, taskProcessEvent{
				Timestamp: now(),
				Level:     "error",
				Message:   line,
			})
			if err == nil && created {
				m.logs.Broadcast(entry)
			}
			continue
		}
		var event taskProcessEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			entry, created, applyErr := m.status.ApplyProcessEvent(process.taskID, process.cmd.Process.Pid, taskProcessEvent{
				Timestamp: now(),
				Level:     "info",
				Message:   line,
			})
			if applyErr == nil && created {
				m.logs.Broadcast(entry)
			}
			continue
		}
		entry, created, err := m.status.ApplyProcessEvent(process.taskID, process.cmd.Process.Pid, event)
		if err == nil && created {
			m.logs.Broadcast(entry)
		}
	}
}

func (m *TaskProcessManager) waitProcess(process *managedTaskProcess) {
	err := process.cmd.Wait()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ProcessState != nil {
			exitCode = exitErr.ProcessState.ExitCode()
		} else {
			exitCode = 1
		}
	}

	m.mu.Lock()
	delete(m.processes, process.taskID)
	stopRequested := process.stopRequested
	stopMessage := process.stopMessage
	initMode := process.initMode
	m.mu.Unlock()

	if stopRequested {
		entry, statusErr := m.status.MarkProcessStopped(process.taskID, valueOr(stopMessage, "任务进程已停止"))
		if statusErr == nil {
			m.logs.Broadcast(entry)
		}
		return
	}

	if exitCode == 0 && initMode == "full_only" {
		entry, statusErr := m.status.MarkProcessCompleted(process.taskID, "全量迁移完成")
		if statusErr == nil {
			m.logs.Broadcast(entry)
		}
		return
	}

	entry, statusErr := m.status.MarkProcessFailed(process.taskID, exitCode, fmt.Sprintf("任务进程意外退出，exit code %d", exitCode))
	if statusErr == nil {
		m.logs.Broadcast(entry)
	}
}

type taskProcessSpec struct {
	TaskID         string `json:"taskId"`
	TaskName       string `json:"taskName"`
	InitMode       string `json:"initMode"`
	Phase          string `json:"phase"`
	FullTotalRows  int64  `json:"fullTotalRows"`
	FullSyncedRows int64  `json:"fullSyncedRows"`
	BinlogFile     string `json:"binlogFile"`
	BinlogPosition int64  `json:"binlogPosition"`
	NodeID         string `json:"nodeId"`
}

type taskProcessEvent struct {
	Timestamp       string `json:"timestamp"`
	Level           string `json:"level,omitempty"`
	Phase           string `json:"phase,omitempty"`
	Message         string `json:"message,omitempty"`
	FullTotalRows   int64  `json:"fullTotalRows,omitempty"`
	FullSyncedRows  int64  `json:"fullSyncedRows,omitempty"`
	DelaySeconds    int    `json:"delaySeconds,omitempty"`
	EventsPerSecond int    `json:"eventsPerSecond,omitempty"`
	BinlogFile      string `json:"binlogFile,omitempty"`
	BinlogPosition  int64  `json:"binlogPosition,omitempty"`
}

func RunTaskProcessCLI() error {
	payload := strings.TrimSpace(os.Getenv(taskProcessSpecEnv))
	if payload == "" {
		return errors.New("missing task process spec")
	}
	bytes, err := base64.RawStdEncoding.DecodeString(payload)
	if err != nil {
		return err
	}
	var spec taskProcessSpec
	if err := json.Unmarshal(bytes, &spec); err != nil {
		return err
	}
	return runTaskProcess(spec)
}

func runTaskProcess(spec taskProcessSpec) error {
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	phase := spec.Phase
	if phase == "" || phase == "idle" {
		if spec.InitMode == "incremental_only" {
			phase = "incremental"
		} else {
			phase = "full"
		}
	}
	fullTotalRows := spec.FullTotalRows
	if fullTotalRows <= 0 {
		fullTotalRows = int64(50000 + rand.Intn(90000))
	}
	fullSyncedRows := spec.FullSyncedRows
	if fullSyncedRows < 0 {
		fullSyncedRows = 0
	}
	binlogFile := valueOr(spec.BinlogFile, "mysql-bin.000001")
	binlogPosition := maxInt64(spec.BinlogPosition, 4)

	writeTaskProcessEvent(taskProcessEvent{
		Timestamp:       now(),
		Level:           "info",
		Phase:           phase,
		Message:         "任务进程已接管执行",
		FullTotalRows:   fullTotalRows,
		FullSyncedRows:  fullSyncedRows,
		DelaySeconds:    0,
		EventsPerSecond: 0,
		BinlogFile:      binlogFile,
		BinlogPosition:  binlogPosition,
	})

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-signals:
			writeTaskProcessEvent(taskProcessEvent{
				Timestamp: now(),
				Level:     "info",
				Phase:     phase,
				Message:   "收到停止信号，任务进程退出",
			})
			return nil
		case <-ticker.C:
			if phase == "full" {
				next := fullSyncedRows + int64(2400+rand.Intn(2600))
				if next > fullTotalRows {
					next = fullTotalRows
				}
				fullSyncedRows = next
				writeTaskProcessEvent(taskProcessEvent{
					Timestamp:       now(),
					Level:           "info",
					Phase:           "full",
					Message:         fmt.Sprintf("全量迁移推进到 %d/%d", fullSyncedRows, fullTotalRows),
					FullTotalRows:   fullTotalRows,
					FullSyncedRows:  fullSyncedRows,
					DelaySeconds:    0,
					EventsPerSecond: 220 + rand.Intn(80),
					BinlogFile:      binlogFile,
					BinlogPosition:  binlogPosition,
				})
				if fullSyncedRows >= fullTotalRows {
					if spec.InitMode == "full_only" {
						writeTaskProcessEvent(taskProcessEvent{
							Timestamp:       now(),
							Level:           "info",
							Phase:           "stopped",
							Message:         "全量迁移已完成",
							FullTotalRows:   fullTotalRows,
							FullSyncedRows:  fullSyncedRows,
							DelaySeconds:    0,
							EventsPerSecond: 0,
							BinlogFile:      binlogFile,
							BinlogPosition:  binlogPosition,
						})
						return nil
					}
					phase = "incremental"
					writeTaskProcessEvent(taskProcessEvent{
						Timestamp: now(),
						Level:     "info",
						Phase:     phase,
						Message:   "全量阶段完成，切换到增量同步",
					})
				}
				continue
			}

			phase = "incremental"
			binlogPosition += int64(1200 + rand.Intn(3800))
			delaySeconds := 1 + rand.Intn(10)
			eventsPerSecond := 60 + rand.Intn(140)
			writeTaskProcessEvent(taskProcessEvent{
				Timestamp:       now(),
				Level:           "info",
				Phase:           phase,
				Message:         fmt.Sprintf("增量同步正常，位点推进到 %s:%d", binlogFile, binlogPosition),
				FullTotalRows:   fullTotalRows,
				FullSyncedRows:  fullTotalRows,
				DelaySeconds:    delaySeconds,
				EventsPerSecond: eventsPerSecond,
				BinlogFile:      binlogFile,
				BinlogPosition:  binlogPosition,
			})
		}
	}
}

func writeTaskProcessEvent(event taskProcessEvent) {
	bytes, _ := json.Marshal(event)
	fmt.Fprintln(os.Stdout, string(bytes))
}

func (s *Store) appendTaskLogLocked(taskID string, nodeID string, processID int, level string, phase string, message string) TaskLogEntry {
	entry := TaskLogEntry{
		ID:        newID(),
		TaskID:    taskID,
		NodeID:    nodeID,
		ProcessID: processID,
		Level:     valueOr(level, "info"),
		Phase:     phase,
		Message:   message,
		CreatedAt: now(),
	}
	s.data.TaskLogs = append(s.data.TaskLogs, entry)
	s.pruneTaskLogsLocked(taskID)
	return cloneJSON(entry)
}

func (s *Store) pruneTaskLogsLocked(taskID string) {
	count := 0
	filtered := make([]TaskLogEntry, 0, len(s.data.TaskLogs))
	for index := len(s.data.TaskLogs) - 1; index >= 0; index-- {
		entry := s.data.TaskLogs[index]
		if entry.TaskID == taskID {
			if count >= taskLogLimitPerTask {
				continue
			}
			count++
		}
		filtered = append(filtered, entry)
	}
	for left, right := 0, len(filtered)-1; left < right; left, right = left+1, right-1 {
		filtered[left], filtered[right] = filtered[right], filtered[left]
	}
	s.data.TaskLogs = filtered
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}
