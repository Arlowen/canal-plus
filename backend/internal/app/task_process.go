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
	stopReasonMigrated  = "Task migrated away from this node"
	stopReasonStopped   = "Task stopped and process reclaimed"
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
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, 0, "info", runtime.Phase, "Task process is starting")
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
	runtime.LastLogMessage = "Task process started"
	runtime.ExitCode = nil
	if runtime.StartedAt == "" {
		runtime.StartedAt = timestamp
	}
	runtime.UpdatedAt = timestamp
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, pid, "info", runtime.Phase, fmt.Sprintf("Task process started with pid=%d", pid))
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

func (s *TaskStatusService) MarkProcessDetached(taskID string, message string) (TaskLogEntry, error) {
	s.store.mu.Lock()
	defer s.store.mu.Unlock()
	runtime := s.store.ensureRuntimeLocked(taskID)
	timestamp := now()
	runtime.ProcessID = 0
	runtime.ProcessStoppedAt = timestamp
	runtime.LastHeartbeatAt = timestamp
	runtime.LastLogAt = timestamp
	runtime.LastLogMessage = message
	runtime.UpdatedAt = timestamp
	entry := s.store.appendTaskLogLocked(taskID, runtime.NodeID, 0, "info", runtime.Phase, message)
	return entry, s.store.saveLocked()
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
	store       *Store
	logs        *TaskLogService
	status      *TaskStatusService
	binaryPath  string
	localNodeID string

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

func NewTaskProcessManager(store *Store, logs *TaskLogService, status *TaskStatusService, binaryPath string, localNodeID string) *TaskProcessManager {
	return &TaskProcessManager{
		store:       store,
		logs:        logs,
		status:      status,
		binaryPath:  binaryPath,
		localNodeID: localNodeID,
		processes:   map[string]*managedTaskProcess{},
	}
}

func (m *TaskProcessManager) RecoverActiveTasks() {
	m.Reconcile()
}

func (m *TaskProcessManager) StartSupervisor(interval time.Duration) func() {
	if interval <= 0 {
		return func() {}
	}
	ticker := time.NewTicker(interval)
	done := make(chan struct{})
	var once sync.Once
	var stopped sync.WaitGroup
	stopped.Add(1)
	go func() {
		defer stopped.Done()
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				m.Reconcile()
			case <-done:
				return
			}
		}
	}()
	return func() {
		once.Do(func() {
			close(done)
			stopped.Wait()
		})
	}
}

func (m *TaskProcessManager) Reconcile() {
	snapshot := m.store.Snapshot()
	desired := map[string]TaskRuntimeState{}
	taskByID := map[string]SyncTask{}
	for _, task := range snapshot.SyncTasks {
		taskByID[task.ID] = task
	}
	for _, runtime := range snapshot.RuntimeStates {
		task, ok := taskByID[runtime.TaskID]
		if !ok {
			continue
		}
		if m.shouldRunLocally(task, runtime) {
			desired[task.ID] = runtime
		}
	}

	m.mu.Lock()
	current := make(map[string]*managedTaskProcess, len(m.processes))
	for taskID, process := range m.processes {
		current[taskID] = process
	}
	m.mu.Unlock()

	for taskID, process := range current {
		if _, ok := desired[taskID]; ok {
			continue
		}
		reason := stopReasonMigrated
		if task, exists := taskByID[taskID]; exists && !leaseRequired(task.Status) {
			reason = stopReasonStopped
		}
		_ = m.StopTask(process.taskID, reason)
	}

	for taskID := range desired {
		_ = m.StartTask(taskID)
	}
}

func (m *TaskProcessManager) shouldRunLocally(task SyncTask, runtime TaskRuntimeState) bool {
	if !leaseRequired(task.Status) {
		return false
	}
	if runtime.NodeID == "" {
		return false
	}
	if m.localNodeID == "" {
		return true
	}
	return runtime.NodeID == m.localNodeID
}

func (m *TaskProcessManager) LocalNodeID() string {
	return m.localNodeID
}

func resolveLocalNodeID(store *Store, preferred string) string {
	preferred = strings.TrimSpace(preferred)
	if preferred != "" {
		return preferred
	}
	snapshot := store.ClusterSnapshot()
	for _, node := range snapshot.Nodes {
		if node.Status == NodeOnline {
			return node.ID
		}
	}
	if len(snapshot.Nodes) > 0 {
		return snapshot.Nodes[0].ID
	}
	return ""
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
	if m.localNodeID != "" && runtime.NodeID != m.localNodeID {
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
		failedEntry, markErr := m.status.MarkProcessFailed(taskID, exitCode, "Task process failed to start: "+err.Error())
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

	entry, err := m.status.markProcessEnded(taskID, "stopping", nil, valueOr(message, "Task process is stopping"), false)
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
		var (
			entry     TaskLogEntry
			statusErr error
		)
		if stopMessage == stopReasonMigrated {
			entry, statusErr = m.status.MarkProcessDetached(process.taskID, stopMessage)
		} else {
			entry, statusErr = m.status.MarkProcessStopped(process.taskID, valueOr(stopMessage, "Task process stopped"))
		}
		if statusErr == nil {
			m.logs.Broadcast(entry)
		}
		return
	}

	if exitCode == 0 && initMode == "full_only" {
		entry, statusErr := m.status.MarkProcessCompleted(process.taskID, "Full migration completed")
		if statusErr == nil {
			m.logs.Broadcast(entry)
		}
		return
	}

	entry, statusErr := m.status.MarkProcessFailed(process.taskID, exitCode, fmt.Sprintf("Task process exited unexpectedly with exit_code=%d", exitCode))
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
		Message:         "Task process accepted execution",
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
				Message:   "Stop signal received; task process exiting",
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
					Message:         fmt.Sprintf("Full migration progressed to %d/%d", fullSyncedRows, fullTotalRows),
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
							Message:         "Full migration completed",
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
						Message:   "Full phase completed; switching to incremental sync",
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
				Message:         fmt.Sprintf("Incremental sync healthy; position advanced to %s:%d", binlogFile, binlogPosition),
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
	timestamp := now()
	normalizedLevel := normalizeTaskLogLevel(level)
	formattedMessage := formatTaskLogMessage(timestamp, normalizedLevel, taskLogThreadName(taskID, nodeID, processID), message)
	entry := TaskLogEntry{
		ID:        newID(),
		TaskID:    taskID,
		NodeID:    nodeID,
		ProcessID: processID,
		Level:     normalizedLevel,
		Phase:     phase,
		Message:   formattedMessage,
		CreatedAt: timestamp,
	}
	s.data.TaskLogs = append(s.data.TaskLogs, entry)
	s.updateRuntimeLastLogLocked(taskID, timestamp, formattedMessage)
	s.pruneTaskLogsLocked(taskID)
	return cloneJSON(entry)
}

func normalizeTaskLogLevel(level string) string {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "warn", "warning":
		return "warn"
	case "error":
		return "error"
	default:
		return "info"
	}
}

func (s *Store) ensureTaskLogsLocked() {
	for index := range s.data.TaskLogs {
		entry := &s.data.TaskLogs[index]
		timestamp := valueOr(entry.CreatedAt, now())
		entry.Level = normalizeTaskLogLevel(entry.Level)
		if entry.CreatedAt == "" {
			entry.CreatedAt = timestamp
		}
		if !isFormattedTaskLogMessage(entry.Message) {
			entry.Message = formatTaskLogMessage(timestamp, entry.Level, taskLogThreadName(entry.TaskID, entry.NodeID, entry.ProcessID), normalizeLegacyTaskLogMessage(entry.Message))
		}
	}
	for index := range s.data.RuntimeStates {
		runtime := &s.data.RuntimeStates[index]
		if strings.TrimSpace(runtime.LastLogMessage) == "" || isFormattedTaskLogMessage(runtime.LastLogMessage) {
			continue
		}
		timestamp := valueOr(runtime.LastLogAt, valueOr(runtime.UpdatedAt, now()))
		runtime.LastLogAt = timestamp
		runtime.LastLogMessage = formatRuntimeLogMessage(*runtime, timestamp, "info", normalizeLegacyTaskLogMessage(runtime.LastLogMessage))
	}
}

func isFormattedTaskLogMessage(message string) bool {
	trimmed := strings.TrimSpace(message)
	return strings.HasPrefix(trimmed, "[") &&
		(strings.Contains(trimmed, "][info][") ||
			strings.Contains(trimmed, "][warn][") ||
			strings.Contains(trimmed, "][error]["))
}

func normalizeLegacyTaskLogMessage(message string) string {
	trimmed := strings.TrimSpace(message)
	switch trimmed {
	case "":
		return "No log message"
	case "任务已从当前节点迁移":
		return stopReasonMigrated
	case "任务已停止，进程已回收":
		return stopReasonStopped
	case "任务进程启动中":
		return "Task process is starting"
	case "任务进程已启动":
		return "Task process started"
	case "任务进程停止中":
		return "Task process is stopping"
	case "任务进程已停止":
		return "Task process stopped"
	case "全量迁移完成", "全量迁移已完成":
		return "Full migration completed"
	case "任务进程已接管执行":
		return "Task process accepted execution"
	case "收到停止信号，任务进程退出":
		return "Stop signal received; task process exiting"
	case "全量阶段完成，切换到增量同步":
		return "Full phase completed; switching to incremental sync"
	case "任务已创建，等待节点接管":
		return "Task created; waiting for node takeover"
	case "任务已创建，等待启动":
		return "Task created; waiting to start"
	case "任务配置已更新":
		return "Task configuration updated"
	case "任务已重跑，运行态已重置":
		return "Task rerun requested; runtime state reset"
	case "任务已启动":
		return "Task started"
	case "任务已恢复":
		return "Task resumed"
	case "任务已暂停":
		return "Task paused"
	case "任务已停止":
		return "Task stopped"
	case "任务运行参数已更新":
		return "Task runtime parameters updated"
	case "当前没有可用在线节点，任务等待接管":
		return "No online node is available; task is waiting for takeover"
	}
	if strings.HasPrefix(trimmed, "任务进程已启动，PID ") {
		return "Task process started with pid=" + strings.TrimPrefix(trimmed, "任务进程已启动，PID ")
	}
	if strings.HasPrefix(trimmed, "任务进程启动失败：") {
		return "Task process failed to start: " + strings.TrimPrefix(trimmed, "任务进程启动失败：")
	}
	if strings.HasPrefix(trimmed, "任务进程意外退出，exit code ") {
		return "Task process exited unexpectedly with exit_code=" + strings.TrimPrefix(trimmed, "任务进程意外退出，exit code ")
	}
	if strings.HasPrefix(trimmed, "全量迁移推进到 ") {
		return "Full migration progressed to " + strings.TrimPrefix(trimmed, "全量迁移推进到 ")
	}
	if strings.HasPrefix(trimmed, "增量同步正常，位点推进到 ") {
		return "Incremental sync healthy; position advanced to " + strings.TrimPrefix(trimmed, "增量同步正常，位点推进到 ")
	}
	if strings.HasPrefix(trimmed, "重置任务位点 ") {
		if _, after, found := strings.Cut(trimmed, " 到 "); found {
			return "Task position reset to " + after
		}
		return "Task position reset"
	}
	if translated, ok := normalizeLegacyAssignmentLogMessage(trimmed); ok {
		return translated
	}
	return trimmed
}

func normalizeLegacyAssignmentLogMessage(message string) (string, bool) {
	reasons := map[string]string{
		"任务重跑分配":       "rerun assignment",
		"任务状态恢复分配":     "lifecycle recovery assignment",
		"节点恢复上线重新分配":   "node recovery assignment",
		"任务重新均衡":       "cluster rebalance",
		"节点故障自动接管":     "node failover takeover",
		"lease_assign": "lease assignment",
	}
	for legacyReason, reason := range reasons {
		prefix := legacyReason + "："
		if !strings.HasPrefix(message, prefix) {
			continue
		}
		body := strings.TrimPrefix(message, prefix)
		taskID, movement, found := strings.Cut(body, " 从 ")
		if !found {
			return reason + ": " + body, true
		}
		previousNodeID, nodeID, found := strings.Cut(movement, " 切换到 ")
		if !found {
			return reason + ": task " + taskID + " " + movement, true
		}
		return reason + ": task " + taskID + " moved from " + previousNodeID + " to " + nodeID, true
	}
	return "", false
}

func taskLogThreadName(taskID string, nodeID string, processID int) string {
	if taskID != "" {
		return "sync-task:" + taskID
	}
	if processID > 0 {
		return fmt.Sprintf("process:%d", processID)
	}
	if nodeID != "" {
		return "node:" + nodeID
	}
	return "app"
}

func formatTaskLogMessage(timestamp string, level string, thread string, message string) string {
	normalizedMessage := strings.TrimSpace(message)
	if normalizedMessage == "" {
		normalizedMessage = "No log message"
	}
	return "[" + timestamp + "][" + level + "][" + thread + "]" + normalizedMessage
}

func (s *Store) updateRuntimeLastLogLocked(taskID string, timestamp string, message string) {
	if taskID == "" {
		return
	}
	for index := range s.data.RuntimeStates {
		if s.data.RuntimeStates[index].TaskID != taskID {
			continue
		}
		s.data.RuntimeStates[index].LastLogAt = timestamp
		s.data.RuntimeStates[index].LastLogMessage = message
		return
	}
}

func formatRuntimeLogMessage(runtime TaskRuntimeState, timestamp string, level string, message string) string {
	normalizedLevel := normalizeTaskLogLevel(level)
	return formatTaskLogMessage(timestamp, normalizedLevel, taskLogThreadName(runtime.TaskID, runtime.NodeID, runtime.ProcessID), message)
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
