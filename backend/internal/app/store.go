package app

import (
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
)

type Store struct {
	path string
	mu   sync.Mutex
	data DatabaseShape
}

func NewStore(path string) (*Store, error) {
	if path == "" {
		path = "./data/store.json"
	}
	if err := ensureParentDir(path); err != nil {
		return nil, err
	}

	store := &Store{path: path}
	if _, err := os.Stat(path); err == nil {
		bytes, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(bytes, &store.data); err != nil {
			return nil, err
		}
		return store, nil
	}

	seed, err := createSeedData()
	if err != nil {
		return nil, err
	}
	store.data = seed
	if err := store.saveLocked(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) Snapshot() DatabaseShape {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRuntimeStatesLocked()
	return cloneJSON(s.data)
}

func (s *Store) Users() []User {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneJSON(s.data.Users)
}

func (s *Store) GetUserByUsername(username string) (User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.data.Users {
		if user.Username == username {
			return user, true
		}
	}
	return User{}, false
}

func (s *Store) GetUserByID(id string) (User, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, user := range s.data.Users {
		if user.ID == id {
			return user, true
		}
	}
	return User{}, false
}

func (s *Store) Datasources() []Datasource {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneJSON(s.data.Datasources)
}

func (s *Store) GetDatasource(id string) (Datasource, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getDatasourceLocked(id)
}

func (s *Store) CreateDatasource(input Datasource) (Datasource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	input.ID = newID()
	input.ConnectionStatus = DatasourceUntested
	input.IsDemo = false
	input.CreatedAt = timestamp
	input.UpdatedAt = timestamp
	s.data.Datasources = append([]Datasource{input}, s.data.Datasources...)
	s.logLocked("admin", "create", "datasource", input.ID, "创建数据源 "+input.Name)
	if err := s.saveLocked(); err != nil {
		return Datasource{}, err
	}
	return cloneJSON(input), nil
}

func (s *Store) UpdateDatasource(id string, patch Datasource) (Datasource, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.Datasources {
		if s.data.Datasources[index].ID != id {
			continue
		}
		if patch.Name != "" {
			s.data.Datasources[index].Name = patch.Name
		}
		if patch.Purpose != "" {
			s.data.Datasources[index].Purpose = patch.Purpose
		}
		if patch.Host != "" {
			s.data.Datasources[index].Host = patch.Host
		}
		if patch.Port != 0 {
			s.data.Datasources[index].Port = patch.Port
		}
		if patch.Username != "" {
			s.data.Datasources[index].Username = patch.Username
		}
		if patch.PasswordSecret != "" {
			s.data.Datasources[index].PasswordSecret = patch.PasswordSecret
		}
		if patch.DefaultSchema != "" {
			s.data.Datasources[index].DefaultSchema = patch.DefaultSchema
		}
		s.data.Datasources[index].UpdatedAt = now()
		updated := s.data.Datasources[index]
		s.logLocked("admin", "update", "datasource", id, "更新数据源 "+updated.Name)
		if err := s.saveLocked(); err != nil {
			return Datasource{}, false, err
		}
		return cloneJSON(updated), true, nil
	}
	return Datasource{}, false, nil
}

func (s *Store) DeleteDatasource(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, task := range s.data.SyncTasks {
		if task.SourceDatasourceID == id || task.TargetDatasourceID == id {
			return false, errors.New("数据源已被同步任务引用，不能删除")
		}
	}
	for index, datasource := range s.data.Datasources {
		if datasource.ID == id {
			s.data.Datasources = append(s.data.Datasources[:index], s.data.Datasources[index+1:]...)
			s.logLocked("admin", "delete", "datasource", id, "删除数据源")
			return true, s.saveLocked()
		}
	}
	return false, nil
}

func (s *Store) MarkDatasourceTest(id string, online bool, message string) (Datasource, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.Datasources {
		if s.data.Datasources[index].ID != id {
			continue
		}
		if online {
			s.data.Datasources[index].ConnectionStatus = DatasourceOnline
		} else {
			s.data.Datasources[index].ConnectionStatus = DatasourceOffline
		}
		s.data.Datasources[index].LastTestedAt = now()
		s.data.Datasources[index].LastTestMessage = message
		s.data.Datasources[index].UpdatedAt = now()
		updated := s.data.Datasources[index]
		s.logLocked("admin", "test", "datasource", id, "测试数据源："+message)
		return cloneJSON(updated), true, s.saveLocked()
	}
	return Datasource{}, false, nil
}

func (s *Store) Tasks() []SyncTask {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRuntimeStatesLocked()
	return cloneJSON(s.data.SyncTasks)
}

func (s *Store) GetTask(id string) (SyncTask, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRuntimeStatesLocked()
	for _, task := range s.data.SyncTasks {
		if task.ID == id {
			return cloneJSON(task), true
		}
	}
	return SyncTask{}, false
}

func (s *Store) CreateTask(input SyncTask) (SyncTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	input.ID = newID()
	if input.Status == "" {
		input.Status = TaskPending
	}
	input.ConfigVersion = 1
	input.CreatedAt = timestamp
	input.UpdatedAt = timestamp
	for mappingIndex := range input.TableMappings {
		if input.TableMappings[mappingIndex].ID == "" {
			input.TableMappings[mappingIndex].ID = newID()
		}
	}
	s.data.SyncTasks = append([]SyncTask{input}, s.data.SyncTasks...)
	s.data.RuntimeStates = append([]TaskRuntimeState{s.defaultRuntimeLocked(input.ID)}, s.data.RuntimeStates...)
	s.logLocked("admin", "create", "sync_task", input.ID, "创建同步任务 "+input.Name)
	if err := s.saveLocked(); err != nil {
		return SyncTask{}, err
	}
	return cloneJSON(input), nil
}

func (s *Store) UpdateTask(id string, patch SyncTask) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != id {
			continue
		}
		task := &s.data.SyncTasks[index]
		changedConfig := false
		if patch.Name != "" {
			task.Name = patch.Name
		}
		if patch.Description != "" {
			task.Description = patch.Description
		}
		if patch.Owner != "" {
			task.Owner = patch.Owner
		}
		if patch.SourceDatasourceID != "" {
			task.SourceDatasourceID = patch.SourceDatasourceID
		}
		if patch.TargetDatasourceID != "" {
			task.TargetDatasourceID = patch.TargetDatasourceID
		}
		if len(patch.TableMappings) > 0 {
			for mappingIndex := range patch.TableMappings {
				if patch.TableMappings[mappingIndex].ID == "" {
					patch.TableMappings[mappingIndex].ID = newID()
				}
			}
			task.TableMappings = patch.TableMappings
			changedConfig = true
		}
		if patch.Strategy.InitMode != "" {
			task.Strategy = patch.Strategy
			changedConfig = true
		}
		if changedConfig {
			task.ConfigVersion++
		}
		task.UpdatedAt = now()
		updated := *task
		s.logLocked("admin", "update", "sync_task", id, "更新同步任务 "+updated.Name)
		return cloneJSON(updated), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
}

func (s *Store) DeleteTask(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index, task := range s.data.SyncTasks {
		if task.ID != id {
			continue
		}
		s.data.SyncTasks = append(s.data.SyncTasks[:index], s.data.SyncTasks[index+1:]...)
		for runtimeIndex := range s.data.RuntimeStates {
			if s.data.RuntimeStates[runtimeIndex].TaskID == id {
				s.data.RuntimeStates = append(s.data.RuntimeStates[:runtimeIndex], s.data.RuntimeStates[runtimeIndex+1:]...)
				break
			}
		}
		s.logLocked("admin", "delete", "sync_task", id, "删除同步任务")
		return true, s.saveLocked()
	}
	return false, nil
}

func (s *Store) CopyTask(id string) (SyncTask, bool, error) {
	source, ok := s.GetTask(id)
	if !ok {
		return SyncTask{}, false, nil
	}
	source.ID = ""
	source.Name += " 副本"
	source.Status = TaskDraft
	task, err := s.CreateTask(source)
	return task, err == nil, err
}

func (s *Store) TransitionTask(id string, action string) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRuntimeStatesLocked()
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != id {
			continue
		}
		task := &s.data.SyncTasks[index]
		runtime := s.ensureRuntimeLocked(id)
		timestamp := now()
		switch action {
		case "start", "resume":
			if task.Strategy.InitMode == "full_then_incremental" && runtime.FullSyncedRows < runtime.FullTotalRows {
				task.Status = TaskFullSyncing
				runtime.Phase = "full"
			} else {
				task.Status = TaskIncrementalRunning
				runtime.Phase = "incremental"
			}
			if runtime.StartedAt == "" {
				runtime.StartedAt = timestamp
			}
		case "pause":
			task.Status = TaskPaused
			runtime.Phase = "paused"
			runtime.EventsPerSecond = 0
		case "stop":
			task.Status = TaskStopped
			runtime.Phase = "stopped"
			runtime.EventsPerSecond = 0
		default:
			return SyncTask{}, false, errors.New("unsupported task action")
		}
		runtime.UpdatedAt = timestamp
		task.UpdatedAt = timestamp
		updated := *task
		s.logLocked("admin", action, "sync_task", id, action+" 同步任务 "+task.Name)
		return cloneJSON(updated), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
}

func (s *Store) Runtime(taskID string) (TaskRuntimeState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshRuntimeStatesLocked()
	for _, task := range s.data.SyncTasks {
		if task.ID == taskID {
			return cloneJSON(*s.ensureRuntimeLocked(taskID)), true
		}
	}
	return TaskRuntimeState{}, false
}

func (s *Store) ErrorEvents() []ErrorEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneJSON(s.data.ErrorEvents)
}

func (s *Store) GetErrorEvent(id string) (ErrorEvent, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, event := range s.data.ErrorEvents {
		if event.ID == id {
			return cloneJSON(event), true
		}
	}
	return ErrorEvent{}, false
}

func (s *Store) RetryError(id string) (ErrorEvent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.ErrorEvents {
		if s.data.ErrorEvents[index].ID != id {
			continue
		}
		s.data.ErrorEvents[index].Status = ErrorResolved
		s.data.ErrorEvents[index].UpdatedAt = now()
		event := s.data.ErrorEvents[index]
		s.recoverTaskAfterErrorLocked(event.TaskID, 84)
		s.logLocked("admin", "retry", "error_event", id, "重试错误事件 "+id)
		return cloneJSON(event), true, s.saveLocked()
	}
	return ErrorEvent{}, false, nil
}

func (s *Store) SkipError(id string, reason string) (ErrorEvent, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.ErrorEvents {
		if s.data.ErrorEvents[index].ID != id {
			continue
		}
		s.data.ErrorEvents[index].Status = ErrorSkipped
		s.data.ErrorEvents[index].HandledBy = "admin"
		s.data.ErrorEvents[index].HandledReason = reason
		s.data.ErrorEvents[index].UpdatedAt = now()
		event := s.data.ErrorEvents[index]
		s.recoverTaskAfterErrorLocked(event.TaskID, 64)
		s.logLocked("admin", "skip", "error_event", id, "跳过错误事件："+reason)
		return cloneJSON(event), true, s.saveLocked()
	}
	return ErrorEvent{}, false, nil
}

func (s *Store) Logs() []OperationLog {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneJSON(s.data.OperationLogs)
}

func (s *Store) AlertRules() []AlertRule {
	s.mu.Lock()
	defer s.mu.Unlock()
	return cloneJSON(s.data.AlertRules)
}

func (s *Store) getDatasourceLocked(id string) (Datasource, bool) {
	for _, datasource := range s.data.Datasources {
		if datasource.ID == id {
			return cloneJSON(datasource), true
		}
	}
	return Datasource{}, false
}

func (s *Store) ensureRuntimeLocked(taskID string) *TaskRuntimeState {
	for index := range s.data.RuntimeStates {
		if s.data.RuntimeStates[index].TaskID == taskID {
			return &s.data.RuntimeStates[index]
		}
	}
	runtime := s.defaultRuntimeLocked(taskID)
	s.data.RuntimeStates = append([]TaskRuntimeState{runtime}, s.data.RuntimeStates...)
	return &s.data.RuntimeStates[0]
}

func (s *Store) defaultRuntimeLocked(taskID string) TaskRuntimeState {
	return TaskRuntimeState{
		TaskID:          taskID,
		Phase:           "idle",
		FullTotalRows:   int64(50000 + rand.Intn(90000)),
		FullSyncedRows:  0,
		DelaySeconds:    0,
		EventsPerSecond: 0,
		BinlogFile:      "mysql-bin.000001",
		BinlogPosition:  4,
		UpdatedAt:       now(),
	}
}

func (s *Store) refreshRuntimeStatesLocked() {
	timestamp := now()
	changed := false
	for index := range s.data.SyncTasks {
		task := &s.data.SyncTasks[index]
		runtime := s.ensureRuntimeLocked(task.ID)
		switch task.Status {
		case TaskFullSyncing:
			next := runtime.FullSyncedRows + int64(2500+rand.Intn(2500))
			if next > runtime.FullTotalRows {
				next = runtime.FullTotalRows
			}
			runtime.FullSyncedRows = next
			runtime.EventsPerSecond = 220 + rand.Intn(90)
			runtime.DelaySeconds = 0
			runtime.Phase = "full"
			runtime.UpdatedAt = timestamp
			changed = true
			if runtime.FullSyncedRows >= runtime.FullTotalRows {
				task.Status = TaskIncrementalRunning
				task.UpdatedAt = timestamp
				runtime.Phase = "incremental"
				runtime.EventsPerSecond = 90 + rand.Intn(80)
			}
		case TaskIncrementalRunning:
			runtime.Phase = "incremental"
			runtime.FullSyncedRows = runtime.FullTotalRows
			runtime.DelaySeconds = 2 + rand.Intn(12)
			runtime.EventsPerSecond = 60 + rand.Intn(120)
			runtime.BinlogPosition += int64(1200 + rand.Intn(4200))
			runtime.UpdatedAt = timestamp
			changed = true
		}
	}
	if changed {
		_ = s.saveLocked()
	}
}

func (s *Store) recoverTaskAfterErrorLocked(taskID string, eventsPerSecond int) {
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != taskID || s.data.SyncTasks[index].Status != TaskFailed {
			continue
		}
		s.data.SyncTasks[index].Status = TaskIncrementalRunning
		s.data.SyncTasks[index].UpdatedAt = now()
		runtime := s.ensureRuntimeLocked(taskID)
		runtime.Phase = "incremental"
		runtime.LastErrorID = ""
		runtime.EventsPerSecond = eventsPerSecond
		runtime.UpdatedAt = now()
	}
}

func (s *Store) logLocked(actor string, action string, targetType string, targetID string, detail string) {
	s.data.OperationLogs = append([]OperationLog{
		{
			ID:         newID(),
			Actor:      actor,
			Action:     action,
			TargetType: targetType,
			TargetID:   targetID,
			Detail:     detail,
			CreatedAt:  now(),
		},
	}, s.data.OperationLogs...)
}

func (s *Store) saveLocked() error {
	if err := ensureParentDir(s.path); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tempPath := filepath.Join(filepath.Dir(s.path), "."+filepath.Base(s.path)+".tmp")
	if err := os.WriteFile(tempPath, append(bytes, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tempPath, s.path)
}
