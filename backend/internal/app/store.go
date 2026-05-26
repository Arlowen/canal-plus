package app

import (
	"errors"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Store struct {
	persistence storePersistence
	mu          sync.Mutex
	data        DatabaseShape
}

func NewStore() (*Store, error) {
	persistence, err := newStorePersistence()
	if err != nil {
		return nil, err
	}

	store := &Store{persistence: persistence}
	data, found, err := persistence.Load()
	if err != nil {
		return nil, err
	}
	if found {
		store.data = data
		store.ensureUsersLocked()
		store.ensureClusterLocked()
		store.ensureTaskRevisionsLocked()
		store.ensureTaskCheckpointsLocked()
		store.ensureStructureDDLsLocked()
		store.ensureQualityDiffsLocked()
		store.ensureSubscriptionChangesLocked()
		store.ensureTaskLogsLocked()
		if err := store.saveLocked(); err != nil {
			return nil, err
		}
		return store, nil
	}

	seed, err := createSeedData()
	if err != nil {
		return nil, err
	}
	store.data = seed
	store.ensureTaskRevisionsLocked()
	store.ensureTaskCheckpointsLocked()
	store.ensureStructureDDLsLocked()
	store.ensureQualityDiffsLocked()
	store.ensureSubscriptionChangesLocked()
	if err := store.saveLocked(); err != nil {
		return nil, err
	}
	return store, nil
}

func (s *Store) StorageBackend() string {
	return s.persistence.Backend()
}

func (s *Store) StorageLocation() string {
	return s.persistence.Location()
}

func (s *Store) ensureUsersLocked() {
	createdAt := now()
	ensureUser := func(user User) {
		for _, existing := range s.data.Users {
			if existing.Username == user.Username {
				return
			}
		}
		s.data.Users = append(s.data.Users, user)
	}
	ensureUser(User{
		ID:           "user-admin",
		Name:         "平台管理员",
		Username:     "admin",
		Role:         RoleAdmin,
		PasswordHash: hashPassword("admin123"),
		CreatedAt:    createdAt,
	})
	ensureUser(User{
		ID:           "user-operator",
		Name:         "运维操作员",
		Username:     "operator",
		Role:         RoleOperator,
		PasswordHash: hashPassword("operator123"),
		CreatedAt:    createdAt,
	})
}

func (s *Store) ensureTaskRevisionsLocked() {
	for _, task := range s.data.SyncTasks {
		if s.hasTaskRevisionLocked(task.ID, task.ConfigVersion) {
			continue
		}
		s.recordTaskRevisionLocked(task, "import", "导入当前任务配置", "system")
	}
}

func (s *Store) ensureTaskCheckpointsLocked() {
	for _, task := range s.data.SyncTasks {
		if s.hasTaskCheckpointLocked(task.ID) {
			continue
		}
		runtime := s.ensureRuntimeLocked(task.ID)
		s.recordTaskCheckpointLocked(*runtime, "import", "")
	}
}

func (s *Store) Snapshot() DatabaseShape {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
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
	s.reconcileClusterLocked()
	s.refreshRuntimeStatesLocked()
	return cloneJSON(s.data.SyncTasks)
}

func (s *Store) GetTask(id string) (SyncTask, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
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
	s.recordTaskRevisionLocked(input, "create", "创建同步任务", "admin")
	runtime := s.defaultRuntimeLocked(input.ID)
	if leaseRequired(input.Status) {
		if node := s.selectNodeLocked(""); node != nil {
			runtime.NodeID = node.ID
			runtime.LeaseExpiresAt = leaseExpiry()
			s.upsertLeaseLocked(input.ID, node.ID, false)
		}
	}
	s.data.RuntimeStates = append([]TaskRuntimeState{runtime}, s.data.RuntimeStates...)
	s.recordTaskCheckpointLocked(runtime, "create", "")
	if input.Status == TaskPending && runtime.NodeID == "" {
		loggedAt := now()
		runtime.ProcessStatus = "awaiting_takeover"
		runtime.LastLogAt = loggedAt
		runtime.LastLogMessage = formatRuntimeLogMessage(runtime, loggedAt, "info", "Task created; waiting for node takeover")
	}
	s.appendTaskLogLocked(input.ID, runtime.NodeID, 0, "info", runtime.Phase, "Task created; waiting to start")
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
			changedConfig = true
		}
		if patch.Description != "" {
			task.Description = patch.Description
			changedConfig = true
		}
		if patch.Owner != "" {
			task.Owner = patch.Owner
			changedConfig = true
		}
		if patch.SourceDatasourceID != "" {
			task.SourceDatasourceID = patch.SourceDatasourceID
			changedConfig = true
		}
		if patch.TargetDatasourceID != "" {
			task.TargetDatasourceID = patch.TargetDatasourceID
			changedConfig = true
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
		if changedConfig {
			s.recordTaskRevisionLocked(updated, "update", "更新同步任务配置", "admin")
			s.appendTaskLogLocked(id, s.ensureRuntimeLocked(id).NodeID, 0, "info", s.ensureRuntimeLocked(id).Phase, "Task configuration updated")
		}
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
		if task.Status != TaskStopped && task.Status != TaskDraft {
			return false, errors.New("只有草稿或已停止任务允许删除")
		}
		s.data.SyncTasks = append(s.data.SyncTasks[:index], s.data.SyncTasks[index+1:]...)
		for runtimeIndex := range s.data.RuntimeStates {
			if s.data.RuntimeStates[runtimeIndex].TaskID == id {
				s.data.RuntimeStates = append(s.data.RuntimeStates[:runtimeIndex], s.data.RuntimeStates[runtimeIndex+1:]...)
				break
			}
		}
		s.removeTaskRevisionsLocked(id)
		s.removeTaskCheckpointsLocked(id)
		s.removeTaskLogsLocked(id)
		s.logLocked("admin", "delete", "sync_task", id, "删除同步任务")
		return true, s.saveLocked()
	}
	return false, nil
}

func (s *Store) TaskRevisions(taskID string) []TaskRevision {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureTaskRevisionsLocked()
	revisions := []TaskRevision{}
	for _, revision := range s.data.TaskRevisions {
		if revision.TaskID == taskID {
			revisions = append(revisions, revision)
		}
	}
	sortTaskRevisionsDesc(revisions)
	return cloneJSON(revisions)
}

func (s *Store) TaskCheckpoints(taskID string) []TaskCheckpoint {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	s.refreshRuntimeStatesLocked()
	s.ensureTaskCheckpointsLocked()
	checkpoints := []TaskCheckpoint{}
	for _, checkpoint := range s.data.TaskCheckpoints {
		if checkpoint.TaskID == taskID {
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	sortTaskCheckpointsDesc(checkpoints)
	return cloneJSON(checkpoints)
}

func (s *Store) RollbackTaskRevision(taskID string, version int) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var revision TaskRevision
	for _, item := range s.data.TaskRevisions {
		if item.TaskID == taskID && item.Version == version {
			revision = item
			break
		}
	}
	if revision.ID == "" {
		return SyncTask{}, false, nil
	}
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != taskID {
			continue
		}
		current := &s.data.SyncTasks[index]
		next := revision.Snapshot
		next.ID = current.ID
		next.Status = current.Status
		next.ConfigVersion = current.ConfigVersion + 1
		next.CreatedAt = current.CreatedAt
		next.UpdatedAt = now()
		current.Name = next.Name
		current.Description = next.Description
		current.Owner = next.Owner
		current.SourceDatasourceID = next.SourceDatasourceID
		current.TargetDatasourceID = next.TargetDatasourceID
		current.TableMappings = next.TableMappings
		current.Strategy = next.Strategy
		current.ConfigVersion = next.ConfigVersion
		current.UpdatedAt = next.UpdatedAt
		s.recordTaskRevisionLocked(*current, "rollback", "回滚到 v"+intToString(version), "admin")
		s.logLocked("admin", "rollback", "sync_task", taskID, "回滚同步任务 "+current.Name+" 到 v"+intToString(version))
		return cloneJSON(*current), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
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

func (s *Store) RerunTask(id string) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != id {
			continue
		}
		task := &s.data.SyncTasks[index]
		if task.Status != TaskStopped && task.Status != TaskFailed {
			return SyncTask{}, false, errors.New("只有已停止或异常任务允许重跑")
		}
		timestamp := now()
		runtime := s.ensureRuntimeLocked(id)
		runtime.Phase = "idle"
		runtime.FullSyncedRows = 0
		if runtime.FullTotalRows <= 0 {
			runtime.FullTotalRows = int64(50000 + rand.Intn(90000))
		}
		runtime.DelaySeconds = 0
		runtime.EventsPerSecond = 0
		runtime.BinlogFile = "mysql-bin.000001"
		runtime.BinlogPosition = 4
		runtime.NodeID = ""
		runtime.LeaseExpiresAt = ""
		runtime.StartedAt = timestamp
		runtime.LastErrorID = ""
		runtime.ProcessStatus = "idle"
		runtime.ProcessID = 0
		runtime.ProcessStartedAt = ""
		runtime.ProcessStoppedAt = ""
		runtime.LastHeartbeatAt = ""
		runtime.LastLogAt = ""
		runtime.LastLogMessage = ""
		runtime.ExitCode = nil
		runtime.UpdatedAt = timestamp
		s.removeLeaseLocked(id)

		if task.Strategy.InitMode == "incremental_only" {
			task.Status = TaskIncrementalRunning
			runtime.Phase = "incremental"
			runtime.FullSyncedRows = runtime.FullTotalRows
		} else {
			task.Status = TaskFullSyncing
			runtime.Phase = "full"
		}
		if node := s.selectNodeLocked(""); node != nil {
			s.assignTaskToNodeLocked(runtime, node.ID, "rerun assignment", false)
		} else {
			task.Status = TaskPending
			runtime.Phase = "idle"
			runtime.ProcessStatus = "awaiting_takeover"
		}
		task.UpdatedAt = timestamp
		s.recordTaskCheckpointLocked(*runtime, "rerun", "")
		s.appendTaskLogLocked(id, runtime.NodeID, 0, "info", runtime.Phase, "Task rerun requested; runtime state reset")
		s.recountNodeTasksLocked()
		s.logLocked("admin", "rerun", "sync_task", id, "重跑同步任务 "+task.Name)
		return cloneJSON(*task), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
}

func (s *Store) TransitionTask(id string, action string) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
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
			if task.Strategy.InitMode != "incremental_only" && runtime.FullSyncedRows < runtime.FullTotalRows {
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
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			s.removeLeaseLocked(id)
		case "stop":
			task.Status = TaskStopped
			runtime.Phase = "stopped"
			runtime.EventsPerSecond = 0
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			s.removeLeaseLocked(id)
		default:
			return SyncTask{}, false, errors.New("unsupported task action")
		}
		if leaseRequired(task.Status) && runtime.NodeID == "" {
			if node := s.selectNodeLocked(""); node != nil {
				s.assignTaskToNodeLocked(runtime, node.ID, "lifecycle recovery assignment", false)
			}
		}
		if (action == "start" || action == "resume") && runtime.NodeID == "" {
			task.Status = TaskPending
			runtime.Phase = "idle"
			runtime.EventsPerSecond = 0
			runtime.ProcessStatus = "awaiting_takeover"
		}
		runtime.UpdatedAt = timestamp
		task.UpdatedAt = timestamp
		updated := *task
		s.recordTaskCheckpointLocked(*runtime, "lifecycle_"+action, "")
		s.appendTaskLogLocked(id, runtime.NodeID, 0, "info", runtime.Phase, lifecycleActionMessage(action, task.Status))
		s.recountNodeTasksLocked()
		s.logLocked("admin", action, "sync_task", id, action+" 同步任务 "+task.Name)
		return cloneJSON(updated), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
}

func (s *Store) UpdateTaskParameters(id string, patch TaskParameterPatch) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != id {
			continue
		}
		task := &s.data.SyncTasks[index]
		changed := false
		if patch.InitMode != "" {
			task.Strategy.InitMode = patch.InitMode
			changed = true
		}
		if patch.ConflictStrategy != "" {
			task.Strategy.ConflictStrategy = patch.ConflictStrategy
			changed = true
		}
		if patch.DeleteStrategy != "" {
			task.Strategy.DeleteStrategy = patch.DeleteStrategy
			changed = true
		}
		if patch.BatchSize != nil {
			if *patch.BatchSize <= 0 {
				return SyncTask{}, false, errors.New("批量写入大小必须大于 0")
			}
			task.Strategy.BatchSize = *patch.BatchSize
			changed = true
		}
		if patch.RetryTimes != nil {
			if *patch.RetryTimes < 0 {
				return SyncTask{}, false, errors.New("失败重试次数不能小于 0")
			}
			task.Strategy.RetryTimes = *patch.RetryTimes
			changed = true
		}
		if patch.RetryIntervalSeconds != nil {
			if *patch.RetryIntervalSeconds <= 0 {
				return SyncTask{}, false, errors.New("重试间隔必须大于 0")
			}
			task.Strategy.RetryIntervalSeconds = *patch.RetryIntervalSeconds
			changed = true
		}
		if patch.WriteMode != nil {
			if patch.WriteMode.Insert != nil {
				task.Strategy.WriteMode.Insert = *patch.WriteMode.Insert
				changed = true
			}
			if patch.WriteMode.Update != nil {
				task.Strategy.WriteMode.Update = *patch.WriteMode.Update
				changed = true
			}
			if patch.WriteMode.Delete != nil {
				task.Strategy.WriteMode.Delete = *patch.WriteMode.Delete
				changed = true
			}
		}
		if changed {
			task.ConfigVersion++
			task.UpdatedAt = now()
			s.recordTaskRevisionLocked(*task, "params", "修改任务运行参数", "admin")
			s.appendTaskLogLocked(id, s.ensureRuntimeLocked(id).NodeID, 0, "info", s.ensureRuntimeLocked(id).Phase, "Task runtime parameters updated")
			s.logLocked("admin", "params", "sync_task", id, "修改任务参数 "+task.Name)
			return cloneJSON(*task), true, s.saveLocked()
		}
		return cloneJSON(*task), true, nil
	}
	return SyncTask{}, false, nil
}

func (s *Store) ResetTaskPosition(id string, input PositionResetInput) (SyncTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.BinlogFile == "" || input.BinlogPosition <= 0 {
		return SyncTask{}, false, errors.New("位点文件和位置必填")
	}
	for index := range s.data.SyncTasks {
		if s.data.SyncTasks[index].ID != id {
			continue
		}
		task := &s.data.SyncTasks[index]
		if task.Status != TaskStopped {
			return SyncTask{}, false, errors.New("只有已停止的增量任务允许重置位点")
		}
		runtime := s.ensureRuntimeLocked(id)
		runtime.BinlogFile = input.BinlogFile
		runtime.BinlogPosition = input.BinlogPosition
		runtime.DelaySeconds = 0
		runtime.EventsPerSecond = 0
		runtime.UpdatedAt = now()
		task.UpdatedAt = now()
		s.recordTaskCheckpointLocked(*runtime, "manual_reset", "")
		detail := "Task position reset to " + input.BinlogFile + ":" + intToString(int(input.BinlogPosition))
		if input.ServerID != "" {
			detail += " server_id=" + input.ServerID
		}
		s.appendTaskLogLocked(id, runtime.NodeID, 0, "info", runtime.Phase, detail)
		s.logLocked("admin", "reset_position", "sync_task", id, detail)
		return cloneJSON(*task), true, s.saveLocked()
	}
	return SyncTask{}, false, nil
}

func (s *Store) Runtime(taskID string) (TaskRuntimeState, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	s.refreshRuntimeStatesLocked()
	for _, task := range s.data.SyncTasks {
		if task.ID == taskID {
			return cloneJSON(*s.ensureRuntimeLocked(taskID)), true
		}
	}
	return TaskRuntimeState{}, false
}

func (s *Store) ClusterSnapshot() ClusterSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	return s.clusterSnapshotLocked()
}

func (s *Store) ReconcileCluster() (ClusterSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		return ClusterSnapshot{}, err
	}
	return s.clusterSnapshotLocked(), nil
}

func (s *Store) RegisterNode(input ClusterNodeInput) (ClusterNode, bool, error) {
	if err := validateClusterNodeInput(input); err != nil {
		return ClusterNode{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()

	nodeID := strings.TrimSpace(input.ID)
	if nodeID == "" {
		for _, node := range s.data.Nodes {
			if node.Endpoint == strings.TrimSpace(input.Endpoint) {
				nodeID = node.ID
				break
			}
		}
	}
	if nodeID == "" {
		nodeID = "node-" + newID()
	}

	timestamp := now()
	created := true
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID != nodeID {
			continue
		}
		node := &s.data.Nodes[index]
		node.Name = strings.TrimSpace(input.Name)
		node.Endpoint = strings.TrimSpace(input.Endpoint)
		node.SSHPort = normalizeNodeSSHPort(input.SSHPort)
		node.SSHUser = strings.TrimSpace(input.SSHUser)
		node.AuthMode = normalizeNodeAuthMode(input.AuthMode)
		node.InstallDir = valueOr(strings.TrimSpace(input.InstallDir), "/opt/canal-plus")
		node.Version = normalizeNodeVersion(input.Version)
		node.Zone = valueOr(strings.TrimSpace(input.Zone), "default")
		node.Role = valueOr(strings.TrimSpace(input.Role), "worker")
		node.Capacity = normalizeNodeCapacity(input.Capacity)
		node.CPUPercent = clampPercent(input.CPUPercent)
		node.MemoryPercent = clampPercent(input.MemoryPercent)
		node.Status = NodeOnline
		node.LastHeartbeatAt = timestamp
		node.UpdatedAt = timestamp
		created = false
		s.logLocked("admin", "node_register", "cluster_node", node.ID, "注册或更新 node："+node.Name)
		s.reconcileClusterLocked()
		if err := s.saveLocked(); err != nil {
			return ClusterNode{}, false, err
		}
		return cloneJSON(*node), created, nil
	}

	node := ClusterNode{
		ID:              nodeID,
		Name:            strings.TrimSpace(input.Name),
		Endpoint:        strings.TrimSpace(input.Endpoint),
		SSHPort:         normalizeNodeSSHPort(input.SSHPort),
		SSHUser:         strings.TrimSpace(input.SSHUser),
		AuthMode:        normalizeNodeAuthMode(input.AuthMode),
		InstallDir:      valueOr(strings.TrimSpace(input.InstallDir), "/opt/canal-plus"),
		Version:         normalizeNodeVersion(input.Version),
		Zone:            valueOr(strings.TrimSpace(input.Zone), "default"),
		Status:          NodeOnline,
		Role:            valueOr(strings.TrimSpace(input.Role), "worker"),
		CPUPercent:      clampPercent(input.CPUPercent),
		MemoryPercent:   clampPercent(input.MemoryPercent),
		Capacity:        normalizeNodeCapacity(input.Capacity),
		LastHeartbeatAt: timestamp,
		StartedAt:       timestamp,
		UpdatedAt:       timestamp,
	}
	s.data.Nodes = append(s.data.Nodes, node)
	s.logLocked("admin", "node_register", "cluster_node", node.ID, "注册新 node："+node.Name)
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		return ClusterNode{}, false, err
	}
	return cloneJSON(node), created, nil
}

func (s *Store) TestNodeConnection(input ClusterNodeInput) NodeConnectionTestResult {
	message, success := simulateNodeConnection(input)
	return NodeConnectionTestResult{
		Success:   success,
		Message:   message,
		CheckedAt: now(),
		LatencyMS: 18 + rand.Intn(42),
	}
}

func (s *Store) DeployNode(input ClusterNodeInput) (NodeOperationResult, error) {
	checked := s.TestNodeConnection(input)
	steps := []NodeOperationStep{
		{Key: "connect", Label: "连接机器", Status: "done", Detail: checked.Message},
		{Key: "upload", Label: "上传安装包", Status: "done", Detail: "安装包已上传到目标机器"},
		{Key: "install", Label: "安装依赖", Status: "done", Detail: "运行环境与依赖检查通过"},
		{Key: "start", Label: "启动节点", Status: "done", Detail: "节点进程已启动"},
		{Key: "register", Label: "注册节点", Status: "done", Detail: "节点已加入调度集群"},
	}
	if !checked.Success {
		steps[0].Status = "failed"
		return NodeOperationResult{
			Action:     "deploy",
			Success:    false,
			Message:    "SSH 连接失败，请检查地址、端口和凭据",
			FinishedAt: now(),
			Steps:      steps[:1],
		}, nil
	}
	node, _, err := s.RegisterNode(input)
	if err != nil {
		return NodeOperationResult{}, err
	}
	return NodeOperationResult{
		Action:     "deploy",
		Success:    true,
		Message:    node.Name + " 已部署完成",
		FinishedAt: now(),
		Node:       &node,
		Steps:      steps,
	}, nil
}

func (s *Store) UpgradeNode(id string) (NodeOperationResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	backup := cloneJSON(s.data)
	node := s.getNodeLocked(id)
	if node == nil {
		return NodeOperationResult{}, false, nil
	}
	steps := []NodeOperationStep{
		{Key: "connect", Label: "连接机器", Status: "done", Detail: "已连接到目标节点"},
		{Key: "drain", Label: "迁移任务", Status: "done", Detail: "节点当前没有承载运行中任务"},
		{Key: "backup", Label: "备份当前版本", Status: "done", Detail: "现有版本已完成备份"},
		{Key: "replace", Label: "替换程序包", Status: "done", Detail: "新版本程序包已覆盖"},
		{Key: "restart", Label: "重启节点", Status: "done", Detail: "节点已重启并恢复心跳"},
	}
	before := s.clusterSnapshotLocked()
	affectedBefore := leasesOnNode(before.Leases, id)
	handoffs := []FailoverDrillTask{}
	if len(affectedBefore) > 0 {
		tasksByID := s.tasksByIDLocked()
		node.Status = NodeDraining
		node.UpdatedAt = now()
		s.reconcileClusterLocked()
		afterDrain := s.clusterSnapshotLocked()
		var success bool
		handoffs, success = s.buildClusterHandoffsLocked(affectedBefore, afterDrain.Leases, tasksByID, id)
		if !success {
			steps[1].Status = "failed"
			steps[1].Detail = "仍有任务无法迁移，请先增加在线节点容量"
			s.data = backup
			failedNode := cloneNodePointer(s.getNodeLocked(id))
			return NodeOperationResult{
				Action:        "upgrade",
				Success:       false,
				Message:       "升级前仍有任务未迁移，请先扩容或停止相关任务",
				FinishedAt:    now(),
				Node:          failedNode,
				AffectedTasks: handoffs,
				Before:        &before,
				After:         &afterDrain,
				Steps:         steps[:2],
			}, true, nil
		}
		if len(handoffs) > 0 {
			steps[1].Detail = "已迁移 " + intToString(len(handoffs)) + " 个任务到其他在线节点"
		}
	}
	node.Version = nextNodeVersion(node.Version)
	node.Status = NodeOnline
	node.LastHeartbeatAt = now()
	node.UpdatedAt = now()
	s.logLocked("admin", "node_upgrade", "cluster_node", id, "升级节点："+node.Name+" 到 "+node.Version)
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		s.data = backup
		return NodeOperationResult{}, true, err
	}
	updated := cloneJSON(*node)
	after := s.clusterSnapshotLocked()
	return NodeOperationResult{
		Action:        "upgrade",
		Success:       true,
		Message:       updated.Name + " 已升级到 " + updated.Version,
		FinishedAt:    now(),
		Node:          &updated,
		AffectedTasks: handoffs,
		Before:        &before,
		After:         &after,
		Steps:         steps,
	}, true, nil
}

func (s *Store) UninstallNode(id string) (NodeOperationResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	backup := cloneJSON(s.data)
	node := s.getNodeLocked(id)
	if node == nil {
		return NodeOperationResult{}, false, nil
	}

	steps := []NodeOperationStep{
		{Key: "connect", Label: "连接机器", Status: "done", Detail: "已连接到目标节点"},
		{Key: "drain", Label: "迁移任务", Status: "done", Detail: "节点当前没有承载运行中任务"},
		{Key: "stop", Label: "停止节点", Status: "done", Detail: "节点进程已停止"},
		{Key: "cleanup", Label: "清理安装目录", Status: "done", Detail: "安装目录与服务文件已移除"},
		{Key: "remove", Label: "注销节点", Status: "done", Detail: "节点已从集群中移除"},
	}

	before := s.clusterSnapshotLocked()
	affectedBefore := leasesOnNode(before.Leases, id)
	handoffs := []FailoverDrillTask{}
	if len(affectedBefore) > 0 {
		tasksByID := s.tasksByIDLocked()
		node.Status = NodeDraining
		node.UpdatedAt = now()
		s.reconcileClusterLocked()
		afterDrain := s.clusterSnapshotLocked()
		var success bool
		handoffs, success = s.buildClusterHandoffsLocked(affectedBefore, afterDrain.Leases, tasksByID, id)
		if !success {
			steps[1].Status = "failed"
			steps[1].Detail = "仍有任务无法迁移，请先增加在线节点容量"
			s.data = backup
			failedNode := cloneNodePointer(s.getNodeLocked(id))
			return NodeOperationResult{
				Action:        "uninstall",
				Success:       false,
				Message:       "卸载前仍有任务未迁移，请先扩容或停止相关任务",
				FinishedAt:    now(),
				Node:          failedNode,
				AffectedTasks: handoffs,
				Before:        &before,
				After:         &afterDrain,
				Steps:         steps[:2],
			}, true, nil
		}
		if len(handoffs) > 0 {
			steps[1].Detail = "已迁移 " + intToString(len(handoffs)) + " 个任务到其他在线节点"
		}
	}

	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID != id {
			continue
		}
		s.data.Nodes = append(s.data.Nodes[:index], s.data.Nodes[index+1:]...)
		break
	}
	filteredLeases := make([]TaskLease, 0, len(s.data.TaskLeases))
	for _, lease := range s.data.TaskLeases {
		if lease.NodeID != id {
			filteredLeases = append(filteredLeases, lease)
		}
	}
	s.data.TaskLeases = filteredLeases
	s.reconcileClusterLocked()
	s.logLocked("admin", "node_uninstall", "cluster_node", id, "卸载节点："+node.Name)
	if err := s.saveLocked(); err != nil {
		s.data = backup
		return NodeOperationResult{}, true, err
	}
	after := s.clusterSnapshotLocked()
	return NodeOperationResult{
		Action:        "uninstall",
		Success:       true,
		Message:       node.Name + " 已卸载",
		FinishedAt:    now(),
		RemovedNodeID: id,
		AffectedTasks: handoffs,
		Before:        &before,
		After:         &after,
		Steps:         steps,
	}, true, nil
}

func (s *Store) MarkNodeStatus(id string, status NodeStatus) (ClusterNode, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID != id {
			continue
		}
		s.data.Nodes[index].Status = status
		if status == NodeOnline {
			s.data.Nodes[index].LastHeartbeatAt = now()
		}
		s.data.Nodes[index].UpdatedAt = now()
		updated := s.data.Nodes[index]
		s.logLocked("admin", "node_"+string(status), "cluster_node", id, "节点状态变更为 "+string(status)+"："+updated.Name)
		s.reconcileClusterLocked()
		if err := s.saveLocked(); err != nil {
			return ClusterNode{}, false, err
		}
		return cloneJSON(updated), true, nil
	}
	return ClusterNode{}, false, nil
}

func (s *Store) TakeNodeOffline(id string) (NodeStatusChangeResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	before := s.clusterSnapshotLocked()
	node := s.getNodeLocked(id)
	if node == nil {
		return NodeStatusChangeResult{}, false, nil
	}
	if node.Status == NodeOffline {
		return NodeStatusChangeResult{
			ID:            newID(),
			Action:        "offline",
			Node:          cloneJSON(*node),
			Success:       true,
			Message:       "节点已是离线状态",
			AffectedTasks: []FailoverDrillTask{},
			Before:        before,
			After:         before,
			ChangedAt:     now(),
		}, true, nil
	}

	tasksByID := s.tasksByIDLocked()
	affectedBefore := leasesOnNode(before.Leases, id)
	timestamp := now()
	node.Status = NodeOffline
	node.UpdatedAt = timestamp
	s.logLocked("admin", "node_offline", "cluster_node", id, "手动下线节点："+node.Name)
	s.reconcileClusterLocked()
	after := s.clusterSnapshotLocked()
	handoffs, success := s.buildClusterHandoffsLocked(affectedBefore, after.Leases, tasksByID, id)
	message := "节点已下线"
	if len(handoffs) == 0 {
		message = "节点已下线，该节点当前没有承载任务"
	} else if success {
		message = "节点已下线，承载任务已迁移到其他在线节点"
	} else {
		message = "节点已下线，但仍有任务待接管，请检查在线节点容量"
	}
	if err := s.saveLocked(); err != nil {
		return NodeStatusChangeResult{}, true, err
	}
	return NodeStatusChangeResult{
		ID:            newID(),
		Action:        "offline",
		Node:          cloneJSON(*node),
		Success:       success || len(handoffs) == 0,
		Message:       message,
		AffectedTasks: handoffs,
		Before:        before,
		After:         after,
		ChangedAt:     timestamp,
	}, true, nil
}

func (s *Store) BringNodeOnline(id string) (NodeStatusChangeResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	before := s.clusterSnapshotLocked()
	node := s.getNodeLocked(id)
	if node == nil {
		return NodeStatusChangeResult{}, false, nil
	}

	tasksByID := s.tasksByIDLocked()
	movedBefore := movedLeases(before.Leases, before.Leases)
	timestamp := now()
	node.Status = NodeOnline
	node.LastHeartbeatAt = timestamp
	node.UpdatedAt = timestamp
	s.logLocked("admin", "node_online", "cluster_node", id, "节点恢复上线："+node.Name)
	s.reconcileClusterLocked()
	s.rebalanceAssignmentsLocked("node recovery assignment", id)
	after := s.clusterSnapshotLocked()
	movedBefore = movedLeases(before.Leases, after.Leases)
	handoffs, success := s.buildClusterHandoffsLocked(movedBefore, after.Leases, tasksByID, "")
	message := "节点已上线"
	if len(handoffs) == 0 {
		message = "节点已上线，当前没有待分配任务"
	} else if success {
		message = "节点已上线，任务已按当前负载重新分配"
	} else {
		message = "节点已上线，但仍有任务待接管，请检查节点容量"
	}
	if err := s.saveLocked(); err != nil {
		return NodeStatusChangeResult{}, true, err
	}
	return NodeStatusChangeResult{
		ID:            newID(),
		Action:        "online",
		Node:          cloneJSON(*node),
		Success:       success || len(handoffs) == 0,
		Message:       message,
		AffectedTasks: handoffs,
		Before:        before,
		After:         after,
		ChangedAt:     timestamp,
	}, true, nil
}

func (s *Store) HeartbeatNode(id string) (ClusterNode, bool, error) {
	return s.MarkNodeStatus(id, NodeOnline)
}

func (s *Store) FailoverDrill(nodeID string) (FailoverDrillReport, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	before := s.clusterSnapshotLocked()
	node := s.getNodeLocked(nodeID)
	if node == nil {
		return FailoverDrillReport{}, false, nil
	}
	if node.Status != NodeOnline {
		return FailoverDrillReport{}, true, errors.New("只有在线节点可以发起故障演练")
	}

	tasksByID := s.tasksByIDLocked()
	affectedBefore := leasesOnNode(before.Leases, nodeID)

	timestamp := now()
	node.Status = NodeOffline
	node.UpdatedAt = timestamp
	s.logLocked("admin", "failover_drill", "cluster_node", nodeID, "故障演练触发节点离线："+node.Name)
	s.reconcileClusterLocked()
	after := s.clusterSnapshotLocked()
	handoffs, success := s.buildClusterHandoffsLocked(affectedBefore, after.Leases, tasksByID, nodeID)

	report := FailoverDrillReport{
		ID:            newID(),
		DrilledAt:     timestamp,
		Node:          cloneJSON(*node),
		Success:       success,
		AffectedTasks: handoffs,
		Before:        before,
		After:         after,
	}
	if len(report.AffectedTasks) == 0 {
		report.Message = "节点已离线，该节点当前没有承载同步任务"
	} else if report.Success {
		report.Message = "故障演练完成，受影响任务已自动接管"
	} else {
		report.Message = "故障演练完成，但存在未接管任务，请检查在线 node 容量"
	}
	if err := s.saveLocked(); err != nil {
		return FailoverDrillReport{}, true, err
	}
	return cloneJSON(report), true, nil
}

func (s *Store) DrainNode(nodeID string) (NodeDrainReport, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	before := s.clusterSnapshotLocked()
	node := s.getNodeLocked(nodeID)
	if node == nil {
		return NodeDrainReport{}, false, nil
	}
	if node.Status == NodeOffline {
		return NodeDrainReport{}, true, errors.New("离线节点不能执行维护排空")
	}

	tasksByID := s.tasksByIDLocked()
	affectedBefore := leasesOnNode(before.Leases, nodeID)

	timestamp := now()
	node.Status = NodeDraining
	node.UpdatedAt = timestamp
	s.logLocked("admin", "node_drain", "cluster_node", nodeID, "维护排空节点："+node.Name)
	s.reconcileClusterLocked()
	after := s.clusterSnapshotLocked()
	handoffs, success := s.buildClusterHandoffsLocked(affectedBefore, after.Leases, tasksByID, nodeID)

	report := NodeDrainReport{
		ID:            newID(),
		DrainedAt:     timestamp,
		Node:          cloneJSON(*node),
		Success:       success,
		AffectedTasks: handoffs,
		Before:        before,
		After:         after,
	}
	if len(report.AffectedTasks) == 0 {
		report.Message = "节点已进入排空状态，该节点当前没有承载同步任务"
	} else if report.Success {
		report.Message = "节点已进入排空状态，承载任务已迁移到其他在线 node"
	} else {
		report.Message = "节点已进入排空状态，但存在未迁移任务，请检查在线 node 容量"
	}
	if err := s.saveLocked(); err != nil {
		return NodeDrainReport{}, true, err
	}
	return cloneJSON(report), true, nil
}

func (s *Store) RefreshNodeHeartbeat(nodeID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	changed := false
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID != nodeID {
			continue
		}
		s.data.Nodes[index].LastHeartbeatAt = timestamp
		s.data.Nodes[index].UpdatedAt = timestamp
		changed = true
	}
	if !changed {
		return nil
	}
	s.reconcileClusterLocked()
	return s.saveLocked()
}

func (s *Store) StartEmbeddedNodeHeartbeat(nodeID string, interval time.Duration) func() {
	if interval <= 0 {
		return func() {}
	}
	ticker := time.NewTicker(interval)
	done := make(chan struct{})
	var stopOnce sync.Once
	var stopped sync.WaitGroup
	stopped.Add(1)
	go func() {
		defer stopped.Done()
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = s.RefreshNodeHeartbeat(nodeID)
			case <-done:
				return
			}
		}
	}()
	return func() {
		stopOnce.Do(func() {
			close(done)
			stopped.Wait()
		})
	}
}

func (s *Store) StartClusterSupervisor(interval time.Duration) func() {
	if interval <= 0 {
		return func() {}
	}
	ticker := time.NewTicker(interval)
	done := make(chan struct{})
	var stopOnce sync.Once
	var stopped sync.WaitGroup
	stopped.Add(1)
	go func() {
		defer stopped.Done()
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_, _ = s.ReconcileCluster()
			case <-done:
				return
			}
		}
	}()
	return func() {
		stopOnce.Do(func() {
			close(done)
			stopped.Wait()
		})
	}
}

func (s *Store) RebalanceCluster() (ClusterRebalanceReport, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	s.markStaleNodesLocked()
	before := s.clusterSnapshotLocked()
	tasksByID := s.tasksByIDLocked()
	s.rebalanceAssignmentsLocked("cluster rebalance", "")
	if err := s.saveLocked(); err != nil {
		return ClusterRebalanceReport{}, err
	}
	after := s.clusterSnapshotLocked()
	movedBefore := movedLeases(before.Leases, after.Leases)
	handoffs, success := s.buildClusterHandoffsLocked(movedBefore, after.Leases, tasksByID, "")
	report := ClusterRebalanceReport{
		ID:           newID(),
		RebalancedAt: now(),
		Success:      success,
		MovedTasks:   handoffs,
		Before:       before,
		After:        after,
	}
	if len(report.MovedTasks) == 0 {
		report.Message = "集群已经均衡，没有任务需要迁移"
	} else if report.Success {
		report.Message = "重新均衡完成，任务已按在线 node 负载重新分布"
	} else {
		report.Message = "重新均衡完成，但存在未分配任务，请检查在线 node 容量"
	}
	return cloneJSON(report), nil
}

func (s *Store) rebalanceAssignmentsLocked(reason string, preferredNodeID string) {
	plannedLoads := map[string]int{}
	for index := range s.data.Nodes {
		if s.data.Nodes[index].Status == NodeOnline {
			plannedLoads[s.data.Nodes[index].ID] = 0
		}
	}
	for taskIndex := range s.data.SyncTasks {
		if !leaseRequired(s.data.SyncTasks[taskIndex].Status) {
			continue
		}
		runtime := s.ensureRuntimeLocked(s.data.SyncTasks[taskIndex].ID)
		currentNode := s.getNodeLocked(runtime.NodeID)
		targetNode := s.selectNodeForLoadLocked(plannedLoads, preferredNodeID)
		if targetNode == nil {
			loggedAt := now()
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			runtime.ProcessStatus = "awaiting_takeover"
			runtime.LastLogAt = loggedAt
			runtime.LastLogMessage = formatRuntimeLogMessage(*runtime, loggedAt, "warn", "No online node is available; task is waiting for takeover")
			runtime.UpdatedAt = loggedAt
			s.removeLeaseLocked(runtime.TaskID)
			s.recordTaskCheckpointLocked(*runtime, "lease_unassigned", "")
			continue
		}
		if currentNode == nil || currentNode.Status != NodeOnline || targetNode.ID != runtime.NodeID {
			s.assignTaskToNodeLocked(runtime, targetNode.ID, reason, false)
		} else {
			runtime.LeaseExpiresAt = leaseExpiry()
			s.upsertLeaseLocked(runtime.TaskID, runtime.NodeID, false)
		}
		plannedLoads[targetNode.ID]++
	}
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

func (s *Store) CreateAlertRule(input AlertRuleInput) (AlertRule, error) {
	if err := validateAlertRuleInput(input); err != nil {
		return AlertRule{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	rule := AlertRule{
		ID:                    newID(),
		Name:                  input.Name,
		Enabled:               enabled,
		TaskID:                input.TaskID,
		DelayThresholdSeconds: input.DelayThresholdSeconds,
		ErrorThreshold:        input.ErrorThreshold,
		WebhookURL:            input.WebhookURL,
		CreatedAt:             timestamp,
		UpdatedAt:             timestamp,
	}
	s.data.AlertRules = append([]AlertRule{rule}, s.data.AlertRules...)
	s.logLocked("admin", "create", "alert_rule", rule.ID, "创建告警规则 "+rule.Name)
	return cloneJSON(rule), s.saveLocked()
}

func (s *Store) UpdateAlertRule(id string, input AlertRuleInput) (AlertRule, bool, error) {
	if err := validateAlertRuleInput(input); err != nil {
		return AlertRule{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.AlertRules {
		if s.data.AlertRules[index].ID != id {
			continue
		}
		rule := &s.data.AlertRules[index]
		rule.Name = input.Name
		if input.Enabled != nil {
			rule.Enabled = *input.Enabled
		}
		rule.TaskID = input.TaskID
		rule.DelayThresholdSeconds = input.DelayThresholdSeconds
		rule.ErrorThreshold = input.ErrorThreshold
		rule.WebhookURL = input.WebhookURL
		rule.UpdatedAt = now()
		s.logLocked("admin", "update", "alert_rule", id, "更新告警规则 "+rule.Name)
		return cloneJSON(*rule), true, s.saveLocked()
	}
	return AlertRule{}, false, nil
}

func (s *Store) DeleteAlertRule(id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index, rule := range s.data.AlertRules {
		if rule.ID != id {
			continue
		}
		s.data.AlertRules = append(s.data.AlertRules[:index], s.data.AlertRules[index+1:]...)
		s.logLocked("admin", "delete", "alert_rule", id, "删除告警规则 "+rule.Name)
		return true, s.saveLocked()
	}
	return false, nil
}

func (s *Store) AlertEvents(ruleID string) []AlertEvent {
	s.mu.Lock()
	defer s.mu.Unlock()
	events := make([]AlertEvent, 0, len(s.data.AlertEvents))
	for _, event := range s.data.AlertEvents {
		if ruleID == "" || event.RuleID == ruleID {
			events = append(events, event)
		}
	}
	sortAlertEvents(events)
	return cloneJSON(firstN(events, 100))
}

func (s *Store) AlertRuleEvaluations() []AlertRuleEvaluation {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	s.refreshRuntimeStatesLocked()
	timestamp := now()
	runtimeByTask := map[string]TaskRuntimeState{}
	for _, runtime := range s.data.RuntimeStates {
		runtimeByTask[runtime.TaskID] = runtime
	}
	pendingErrorsByTask := map[string]int{}
	for _, event := range s.data.ErrorEvents {
		if event.Status == ErrorPending {
			pendingErrorsByTask[event.TaskID]++
		}
	}
	evaluations := make([]AlertRuleEvaluation, 0, len(s.data.AlertRules))
	for _, rule := range s.data.AlertRules {
		evaluation := AlertRuleEvaluation{
			RuleID:    rule.ID,
			RuleName:  rule.Name,
			UpdatedAt: timestamp,
			Reasons:   []string{},
		}
		if !rule.Enabled {
			evaluations = append(evaluations, evaluation)
			continue
		}
		for _, task := range s.data.SyncTasks {
			if rule.TaskID != "" && rule.TaskID != task.ID {
				continue
			}
			evaluation.MatchedTasks++
			runtime := runtimeByTask[task.ID]
			if runtime.DelaySeconds > evaluation.MaxDelaySeconds {
				evaluation.MaxDelaySeconds = runtime.DelaySeconds
			}
			evaluation.PendingErrors += pendingErrorsByTask[task.ID]
		}
		if rule.DelayThresholdSeconds > 0 && evaluation.MaxDelaySeconds >= rule.DelayThresholdSeconds {
			evaluation.Triggered = true
			evaluation.Reasons = append(evaluation.Reasons, "延迟超过阈值 "+intToString(evaluation.MaxDelaySeconds)+"s")
		}
		if rule.ErrorThreshold > 0 && evaluation.PendingErrors >= rule.ErrorThreshold {
			evaluation.Triggered = true
			evaluation.Reasons = append(evaluation.Reasons, "待处理错误达到 "+intToString(evaluation.PendingErrors)+" 条")
		}
		evaluations = append(evaluations, evaluation)
	}
	if s.recordAlertEventsLocked(evaluations, timestamp) {
		_ = s.saveLocked()
	}
	return cloneJSON(evaluations)
}

func (s *Store) recordAlertEventsLocked(evaluations []AlertRuleEvaluation, timestamp string) bool {
	changed := false
	for _, evaluation := range evaluations {
		rule := s.alertRuleByIDLocked(evaluation.RuleID)
		if rule == nil {
			continue
		}
		lastEvent := s.lastAlertEventLocked(evaluation.RuleID)
		if evaluation.Triggered {
			if lastEvent != nil && lastEvent.Status == AlertEventTriggered {
				continue
			}
			event := buildAlertEvent(*rule, evaluation, AlertEventTriggered, timestamp)
			s.data.AlertEvents = append([]AlertEvent{event}, s.data.AlertEvents...)
			s.logLocked("system", "alert_triggered", "alert_rule", rule.ID, "告警触发："+rule.Name+"，"+strings.Join(evaluation.Reasons, "，"))
			changed = true
			continue
		}
		if lastEvent == nil || lastEvent.Status != AlertEventTriggered {
			continue
		}
		event := buildAlertEvent(*rule, evaluation, AlertEventRecovered, timestamp)
		s.data.AlertEvents = append([]AlertEvent{event}, s.data.AlertEvents...)
		s.logLocked("system", "alert_recovered", "alert_rule", rule.ID, "告警恢复："+rule.Name)
		changed = true
	}
	if len(s.data.AlertEvents) > 300 {
		s.data.AlertEvents = s.data.AlertEvents[:300]
	}
	return changed
}

func buildAlertEvent(rule AlertRule, evaluation AlertRuleEvaluation, status AlertEventStatus, timestamp string) AlertEvent {
	notificationStatus := AlertNotificationSkipped
	message := "告警已恢复"
	if status == AlertEventTriggered {
		message = strings.Join(evaluation.Reasons, "，")
		if strings.TrimSpace(rule.WebhookURL) != "" {
			notificationStatus = AlertNotificationRecorded
		}
	}
	if message == "" {
		message = "规则当前处于正常状态"
	}
	return AlertEvent{
		ID:                 newID(),
		RuleID:             rule.ID,
		RuleName:           rule.Name,
		Status:             status,
		MatchedTasks:       evaluation.MatchedTasks,
		MaxDelaySeconds:    evaluation.MaxDelaySeconds,
		PendingErrors:      evaluation.PendingErrors,
		Reasons:            append([]string{}, evaluation.Reasons...),
		NotificationStatus: notificationStatus,
		NotificationTarget: rule.WebhookURL,
		Message:            message,
		CreatedAt:          timestamp,
	}
}

func (s *Store) alertRuleByIDLocked(id string) *AlertRule {
	for index := range s.data.AlertRules {
		if s.data.AlertRules[index].ID == id {
			return &s.data.AlertRules[index]
		}
	}
	return nil
}

func (s *Store) lastAlertEventLocked(ruleID string) *AlertEvent {
	for index := range s.data.AlertEvents {
		if s.data.AlertEvents[index].RuleID == ruleID {
			return &s.data.AlertEvents[index]
		}
	}
	return nil
}

func sortAlertEvents(events []AlertEvent) {
	sort.SliceStable(events, func(left, right int) bool {
		return events[left].CreatedAt > events[right].CreatedAt
	})
}

func (s *Store) CapabilityJobs(jobType CapabilityJobType) []CapabilityJob {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.refreshCapabilityJobsLocked()
	jobs := make([]CapabilityJob, 0, len(s.data.CapabilityJobs))
	for _, job := range s.data.CapabilityJobs {
		if jobType == "" || job.Type == jobType {
			jobs = append(jobs, job)
		}
	}
	return cloneJSON(jobs)
}

func (s *Store) CreateCapabilityJob(input CapabilityJob) (CapabilityJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.Type == "" {
		return CapabilityJob{}, errors.New("能力任务类型不能为空")
	}
	task, ok := s.getTaskLocked(input.TaskID)
	if !ok {
		return CapabilityJob{}, errors.New("关联同步任务不存在")
	}
	timestamp := now()
	input.ID = newID()
	if input.Name == "" {
		input.Name = defaultCapabilityJobName(input.Type, task.Name)
	}
	if input.Mode == "" {
		input.Mode = defaultCapabilityMode(input.Type)
	}
	if input.Status == "" {
		if input.AutoStart {
			input.Status = CapabilityRunning
		} else {
			input.Status = CapabilityDraft
		}
	}
	if input.Status == CapabilityRunning {
		input.AutoStart = true
	}
	if input.Status == CapabilityCompleted {
		input.Steps = completedCapabilitySteps(input.Type)
		input.ProgressPercent = 100
		input.CurrentStep = maxInt(0, len(input.Steps)-1)
	} else {
		input.Steps = defaultCapabilitySteps(input.Type)
	}
	if input.Status == CapabilityRunning {
		input.ProgressPercent = 18
		input.CurrentStep = 0
	} else if input.Status != CapabilityCompleted {
		input.ProgressPercent = 0
		for stepIndex := range input.Steps {
			input.Steps[stepIndex].Status = "waiting"
		}
		input.CurrentStep = 0
	}
	input.Summary = buildCapabilitySummary(input.Type, task, input.Mode)
	input.CreatedAt = timestamp
	input.UpdatedAt = timestamp
	s.data.CapabilityJobs = append([]CapabilityJob{input}, s.data.CapabilityJobs...)
	switch input.Type {
	case CapabilityStructure:
		s.createStructureDDLsLocked(input, task)
	case CapabilityQuality:
		s.createQualityDiffsLocked(input, task)
	case CapabilitySubscription:
		s.createSubscriptionChangesLocked(input, task)
	}
	s.logLocked("admin", "create", "capability_job", input.ID, "创建能力任务 "+input.Name)
	if err := s.saveLocked(); err != nil {
		return CapabilityJob{}, err
	}
	return cloneJSON(input), nil
}

func (s *Store) RunCapabilityJob(id string) (CapabilityJob, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.CapabilityJobs {
		if s.data.CapabilityJobs[index].ID != id {
			continue
		}
		job := &s.data.CapabilityJobs[index]
		job.Status = CapabilityRunning
		job.AutoStart = true
		if job.ProgressPercent == 0 || job.ProgressPercent >= 100 {
			job.ProgressPercent = 18
			job.CurrentStep = 0
			job.Steps = defaultCapabilitySteps(job.Type)
			if job.Type == CapabilityStructure {
				if task, ok := s.getTaskLocked(job.TaskID); ok {
					job.Summary = buildCapabilitySummary(job.Type, task, job.Mode)
					s.removeStructureDDLsLocked(job.ID)
					s.createStructureDDLsLocked(*job, task)
				}
			}
			if job.Type == CapabilityQuality {
				if task, ok := s.getTaskLocked(job.TaskID); ok {
					job.Summary = buildCapabilitySummary(job.Type, task, job.Mode)
					s.removeQualityDiffsLocked(job.ID)
					s.createQualityDiffsLocked(*job, task)
				}
			}
			if job.Type == CapabilitySubscription {
				if task, ok := s.getTaskLocked(job.TaskID); ok {
					job.Summary = buildCapabilitySummary(job.Type, task, job.Mode)
					s.removeSubscriptionChangesLocked(job.ID)
					s.createSubscriptionChangesLocked(*job, task)
				}
			}
		}
		job.UpdatedAt = now()
		s.logLocked("admin", "run", "capability_job", id, "运行能力任务 "+job.Name)
		return cloneJSON(*job), true, s.saveLocked()
	}
	return CapabilityJob{}, false, nil
}

func (s *Store) StructureDDLs(jobID string) ([]StructureDDL, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureStructureDDLsLocked()
	job, ok := s.getCapabilityJobLocked(jobID)
	if !ok || job.Type != CapabilityStructure {
		return nil, false
	}
	statements := make([]StructureDDL, 0)
	for _, statement := range s.data.StructureDDLs {
		if statement.JobID == jobID {
			statements = append(statements, statement)
		}
	}
	sortStructureDDLs(statements)
	return cloneJSON(statements), true
}

func (s *Store) ApplyStructureDDLs(jobID string, input StructureDDLApplyInput) (CapabilityJob, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.getCapabilityJobPointerLocked(jobID)
	if job == nil {
		return CapabilityJob{}, false, nil
	}
	if job.Type != CapabilityStructure {
		return CapabilityJob{}, true, errors.New("只有结构迁移任务支持 DDL 执行")
	}
	if job.Status != CapabilityCompleted {
		return CapabilityJob{}, true, errors.New("结构迁移计划生成后才能执行 DDL")
	}
	selected := map[string]bool{}
	for _, id := range input.IDs {
		if strings.TrimSpace(id) != "" {
			selected[id] = true
		}
	}
	applyAll := len(selected) == 0
	timestamp := now()
	changed := 0
	for index := range s.data.StructureDDLs {
		statement := &s.data.StructureDDLs[index]
		if statement.JobID != jobID || statement.Status == StructureDDLApplied {
			continue
		}
		if !applyAll && !selected[statement.ID] {
			continue
		}
		statement.Status = StructureDDLApplied
		statement.AppliedAt = timestamp
		statement.AppliedBy = "admin"
		statement.HandledReason = strings.TrimSpace(input.Reason)
		statement.UpdatedAt = timestamp
		changed++
	}
	if changed == 0 {
		return cloneJSON(*job), true, nil
	}
	job.UpdatedAt = timestamp
	s.logLocked("admin", "structure_apply", "capability_job", jobID, "执行结构迁移 DDL "+intToString(changed)+" 条："+job.Name)
	return cloneJSON(*job), true, s.saveLocked()
}

func (s *Store) QualityDiffs(jobID string) ([]QualityDiff, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureQualityDiffsLocked()
	job, ok := s.getCapabilityJobLocked(jobID)
	if !ok || job.Type != CapabilityQuality {
		return nil, false
	}
	diffs := make([]QualityDiff, 0)
	for _, diff := range s.data.QualityDiffs {
		if diff.JobID == jobID {
			diffs = append(diffs, diff)
		}
	}
	sortQualityDiffs(diffs)
	return cloneJSON(diffs), true
}

func (s *Store) CorrectQualityDiffs(jobID string, input QualityDiffCorrectionInput) (CapabilityJob, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.getCapabilityJobPointerLocked(jobID)
	if job == nil {
		return CapabilityJob{}, false, nil
	}
	if job.Type != CapabilityQuality {
		return CapabilityJob{}, true, errors.New("只有数据校验任务支持差异订正")
	}
	if job.Status != CapabilityCompleted {
		return CapabilityJob{}, true, errors.New("校验任务完成后才能订正")
	}
	selected := map[string]bool{}
	for _, id := range input.IDs {
		if strings.TrimSpace(id) != "" {
			selected[id] = true
		}
	}
	correctAll := len(selected) == 0
	timestamp := now()
	changed := 0
	for index := range s.data.QualityDiffs {
		diff := &s.data.QualityDiffs[index]
		if diff.JobID != jobID || diff.Status == QualityDiffCorrected {
			continue
		}
		if !correctAll && !selected[diff.ID] {
			continue
		}
		diff.Status = QualityDiffCorrected
		diff.CorrectedAt = timestamp
		diff.CorrectedBy = "admin"
		diff.HandledReason = strings.TrimSpace(input.Reason)
		diff.UpdatedAt = timestamp
		changed++
	}
	if changed == 0 {
		return cloneJSON(*job), true, nil
	}
	job.Summary.CorrectedRows = s.countQualityDiffsLocked(jobID, QualityDiffCorrected)
	job.UpdatedAt = timestamp
	s.logLocked("admin", "quality_correct", "capability_job", jobID, "订正数据校验差异 "+intToString(changed)+" 条："+job.Name)
	return cloneJSON(*job), true, s.saveLocked()
}

func (s *Store) SubscriptionChanges(jobID string) ([]SubscriptionChange, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureSubscriptionChangesLocked()
	job, ok := s.getCapabilityJobLocked(jobID)
	if !ok || job.Type != CapabilitySubscription {
		return nil, false
	}
	changes := make([]SubscriptionChange, 0)
	for _, change := range s.data.SubscriptionChanges {
		if change.JobID == jobID {
			changes = append(changes, change)
		}
	}
	sortSubscriptionChanges(changes)
	return cloneJSON(changes), true
}

func (s *Store) getDatasourceLocked(id string) (Datasource, bool) {
	for _, datasource := range s.data.Datasources {
		if datasource.ID == id {
			return cloneJSON(datasource), true
		}
	}
	return Datasource{}, false
}

func (s *Store) getTaskLocked(id string) (SyncTask, bool) {
	for _, task := range s.data.SyncTasks {
		if task.ID == id {
			return cloneJSON(task), true
		}
	}
	return SyncTask{}, false
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
		ProcessStatus:   "idle",
		UpdatedAt:       now(),
	}
}

func (s *Store) tasksByIDLocked() map[string]SyncTask {
	tasksByID := map[string]SyncTask{}
	for _, task := range s.data.SyncTasks {
		tasksByID[task.ID] = task
	}
	return tasksByID
}

func (s *Store) ensureClusterLocked() {
	timestamp := now()
	if len(s.data.Nodes) == 0 {
		s.data.Nodes = defaultClusterNodes(timestamp)
	}
	for taskIndex := range s.data.SyncTasks {
		if !leaseRequired(s.data.SyncTasks[taskIndex].Status) {
			s.removeLeaseLocked(s.data.SyncTasks[taskIndex].ID)
			runtime := s.ensureRuntimeLocked(s.data.SyncTasks[taskIndex].ID)
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			continue
		}
		runtime := s.ensureRuntimeLocked(s.data.SyncTasks[taskIndex].ID)
		if runtime.NodeID == "" {
			if node := s.selectNodeLocked(""); node != nil {
				s.assignTaskToNodeLocked(runtime, node.ID, "lease assignment", false)
			}
		}
		if runtime.NodeID != "" {
			s.upsertLeaseLocked(s.data.SyncTasks[taskIndex].ID, runtime.NodeID, false)
			s.recountNodeTasksLocked()
		}
	}
	s.recountNodeTasksLocked()
}

func (s *Store) reconcileClusterLocked() {
	s.ensureClusterLocked()
	s.markStaleNodesLocked()
	for taskIndex := range s.data.SyncTasks {
		task := s.data.SyncTasks[taskIndex]
		if !leaseRequired(task.Status) {
			s.removeLeaseLocked(task.ID)
			continue
		}
		runtime := s.ensureRuntimeLocked(task.ID)
		node := s.getNodeLocked(runtime.NodeID)
		if node != nil && node.Status == NodeOnline && !expired(runtime.LeaseExpiresAt) {
			runtime.LeaseExpiresAt = leaseExpiry()
			runtime.UpdatedAt = now()
			s.upsertLeaseLocked(task.ID, node.ID, false)
			continue
		}
		target := s.selectNodeLocked(runtime.NodeID)
		if target == nil {
			if runtime.NodeID != "" {
				s.logLocked("system", "lease_unassigned", "sync_task", runtime.TaskID, "无可用在线节点，任务等待接管："+runtime.TaskID)
			}
			loggedAt := now()
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			runtime.ProcessStatus = "awaiting_takeover"
			runtime.LastLogAt = loggedAt
			runtime.LastLogMessage = formatRuntimeLogMessage(*runtime, loggedAt, "warn", "No online node is available; task is waiting for takeover")
			runtime.UpdatedAt = loggedAt
			s.removeLeaseLocked(task.ID)
			s.recordTaskCheckpointLocked(*runtime, "lease_unassigned", "")
			continue
		}
		s.assignTaskToNodeLocked(runtime, target.ID, "node failover takeover", true)
	}
	s.recountNodeTasksLocked()
}

func (s *Store) markStaleNodesLocked() {
	for index := range s.data.Nodes {
		node := &s.data.Nodes[index]
		if node.Status != NodeOnline || !heartbeatStale(node.LastHeartbeatAt) {
			continue
		}
		node.Status = NodeOffline
		node.UpdatedAt = now()
		s.logLocked("system", "node_heartbeat_timeout", "cluster_node", node.ID, "节点心跳超时自动下线："+node.Name)
	}
}

func (s *Store) assignTaskToNodeLocked(runtime *TaskRuntimeState, nodeID string, reason string, takeover bool) {
	if runtime.NodeID == nodeID && !expired(runtime.LeaseExpiresAt) {
		return
	}
	previousNodeID := runtime.NodeID
	runtime.NodeID = nodeID
	runtime.LeaseExpiresAt = leaseExpiry()
	if runtime.ProcessStatus == "awaiting_takeover" {
		runtime.ProcessStatus = "idle"
	}
	if takeover {
		runtime.FailoverCount++
		runtime.LastTakeoverAt = now()
	}
	runtime.UpdatedAt = now()
	lease := s.upsertLeaseLocked(runtime.TaskID, nodeID, takeover)
	if takeover {
		s.recordTaskCheckpointLocked(*runtime, "failover_takeover", previousNodeID)
	} else {
		s.recordTaskCheckpointLocked(*runtime, "lease_assign", previousNodeID)
	}
	detail := reason + ": task " + runtime.TaskID + " moved from " + valueOr(previousNodeID, "unassigned") + " to " + nodeID
	s.appendTaskLogLocked(runtime.TaskID, runtime.NodeID, 0, "info", runtime.Phase, detail)
	if takeover && lease.TakeoverCount > 0 {
		s.logLocked("system", "failover", "sync_task", runtime.TaskID, detail)
	}
	s.recountNodeTasksLocked()
}

func (s *Store) upsertLeaseLocked(taskID string, nodeID string, takeover bool) TaskLease {
	timestamp := now()
	for index := range s.data.TaskLeases {
		if s.data.TaskLeases[index].TaskID != taskID {
			continue
		}
		if s.data.TaskLeases[index].NodeID != nodeID {
			s.data.TaskLeases[index].Epoch++
		}
		s.data.TaskLeases[index].NodeID = nodeID
		s.data.TaskLeases[index].Status = "active"
		s.data.TaskLeases[index].ExpiresAt = leaseExpiry()
		s.data.TaskLeases[index].UpdatedAt = timestamp
		if takeover {
			s.data.TaskLeases[index].TakeoverCount++
			s.data.TaskLeases[index].AcquiredAt = timestamp
		}
		return s.data.TaskLeases[index]
	}
	lease := TaskLease{
		TaskID:        taskID,
		NodeID:        nodeID,
		Epoch:         1,
		Status:        "active",
		AcquiredAt:    timestamp,
		ExpiresAt:     leaseExpiry(),
		TakeoverCount: 0,
		UpdatedAt:     timestamp,
	}
	if takeover {
		lease.TakeoverCount = 1
	}
	s.data.TaskLeases = append([]TaskLease{lease}, s.data.TaskLeases...)
	return lease
}

func (s *Store) removeLeaseLocked(taskID string) {
	for index := range s.data.TaskLeases {
		if s.data.TaskLeases[index].TaskID == taskID {
			s.data.TaskLeases = append(s.data.TaskLeases[:index], s.data.TaskLeases[index+1:]...)
			return
		}
	}
}

func leasesOnNode(leases []TaskLease, nodeID string) map[string]TaskLease {
	affected := map[string]TaskLease{}
	for _, lease := range leases {
		if lease.NodeID == nodeID {
			affected[lease.TaskID] = lease
		}
	}
	return affected
}

func movedLeases(before []TaskLease, after []TaskLease) map[string]TaskLease {
	afterByTask := map[string]TaskLease{}
	for _, lease := range after {
		afterByTask[lease.TaskID] = lease
	}
	moved := map[string]TaskLease{}
	for _, previous := range before {
		next := afterByTask[previous.TaskID]
		if next.TaskID == "" || next.NodeID != previous.NodeID {
			moved[previous.TaskID] = previous
		}
	}
	return moved
}

func (s *Store) buildClusterHandoffsLocked(previousByTask map[string]TaskLease, afterLeases []TaskLease, tasksByID map[string]SyncTask, blockedNodeID string) ([]FailoverDrillTask, bool) {
	afterLeaseByTask := map[string]TaskLease{}
	for _, lease := range afterLeases {
		afterLeaseByTask[lease.TaskID] = lease
	}
	handoffs := []FailoverDrillTask{}
	success := true
	for taskID, previous := range previousByTask {
		next := afterLeaseByTask[taskID]
		runtime := s.ensureRuntimeLocked(taskID)
		taskName := taskID
		if task, ok := tasksByID[taskID]; ok {
			taskName = task.Name
		}
		if next.TaskID == "" || next.NodeID == "" || next.NodeID == blockedNodeID {
			success = false
		}
		handoffs = append(handoffs, FailoverDrillTask{
			TaskID:                  taskID,
			TaskName:                taskName,
			PreviousNodeID:          previous.NodeID,
			NewNodeID:               next.NodeID,
			PreviousLeaseEpoch:      previous.Epoch,
			LeaseEpoch:              next.Epoch,
			TakeoverCount:           next.TakeoverCount,
			RuntimePhase:            runtime.Phase,
			RecoveryBinlogFile:      runtime.BinlogFile,
			RecoveryBinlogPosition:  runtime.BinlogPosition,
			RecoveryDelaySeconds:    runtime.DelaySeconds,
			RecoveryEventsPerSecond: runtime.EventsPerSecond,
		})
	}
	sort.SliceStable(handoffs, func(left, right int) bool {
		if handoffs[left].TaskName == handoffs[right].TaskName {
			return handoffs[left].TaskID < handoffs[right].TaskID
		}
		return handoffs[left].TaskName < handoffs[right].TaskName
	})
	return handoffs, success
}

func (s *Store) selectNodeLocked(excludeID string) *ClusterNode {
	var selected *ClusterNode
	for index := range s.data.Nodes {
		node := &s.data.Nodes[index]
		if node.Status != NodeOnline || node.ID == excludeID || node.Capacity <= 0 {
			continue
		}
		if selected == nil ||
			node.RunningTasks < selected.RunningTasks ||
			(node.RunningTasks == selected.RunningTasks && node.CPUPercent < selected.CPUPercent) {
			selected = node
		}
	}
	if selected != nil {
		return selected
	}
	for index := range s.data.Nodes {
		node := &s.data.Nodes[index]
		if node.Status == NodeOnline && node.Capacity > 0 {
			return node
		}
	}
	return nil
}

func (s *Store) selectNodeForLoadLocked(loads map[string]int, preferredNodeID string) *ClusterNode {
	var selected *ClusterNode
	for index := range s.data.Nodes {
		node := &s.data.Nodes[index]
		if node.Status != NodeOnline || node.Capacity <= 0 {
			continue
		}
		if loads[node.ID] >= node.Capacity {
			continue
		}
		if selected == nil ||
			loads[node.ID] < loads[selected.ID] ||
			(loads[node.ID] == loads[selected.ID] && preferredNodeID != "" && node.ID == preferredNodeID && selected.ID != preferredNodeID) ||
			(loads[node.ID] == loads[selected.ID] && node.CPUPercent < selected.CPUPercent) {
			selected = node
		}
	}
	return selected
}

func (s *Store) getNodeLocked(id string) *ClusterNode {
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID == id {
			return &s.data.Nodes[index]
		}
	}
	return nil
}

func (s *Store) recountNodeTasksLocked() {
	leaseRequiredByTask := map[string]bool{}
	for _, task := range s.data.SyncTasks {
		leaseRequiredByTask[task.ID] = leaseRequired(task.Status)
	}
	counts := map[string]int{}
	for _, runtime := range s.data.RuntimeStates {
		if runtime.NodeID != "" && leaseRequiredByTask[runtime.TaskID] {
			counts[runtime.NodeID]++
		}
	}
	for index := range s.data.Nodes {
		s.data.Nodes[index].RunningTasks = counts[s.data.Nodes[index].ID]
	}
}

func (s *Store) clusterSnapshotLocked() ClusterSnapshot {
	s.recountNodeTasksLocked()
	nodes := cloneJSON(s.data.Nodes)
	leases := cloneJSON(s.data.TaskLeases)
	online := 0
	failovers := 0
	for _, node := range nodes {
		if node.Status == NodeOnline {
			online++
		}
	}
	for _, lease := range leases {
		failovers += lease.TakeoverCount
	}
	return ClusterSnapshot{
		Nodes:                   nodes,
		Leases:                  leases,
		OnlineNodes:             online,
		TotalNodes:              len(nodes),
		DegradedNodes:           len(nodes) - online,
		Failovers:               failovers,
		HeartbeatTimeoutSeconds: int(nodeHeartbeatTimeout.Seconds()),
	}
}

func leaseRequired(status TaskStatus) bool {
	return status == TaskPending || status == TaskFullSyncing || status == TaskIncrementalRunning || status == TaskFailed
}

func validateClusterNodeInput(input ClusterNodeInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("节点名称必填")
	}
	if strings.TrimSpace(input.Endpoint) == "" {
		return errors.New("节点 endpoint 必填")
	}
	if input.Capacity < 0 {
		return errors.New("节点容量不能为负数")
	}
	return nil
}

func simulateNodeConnection(input ClusterNodeInput) (string, bool) {
	endpoint := strings.TrimSpace(strings.ToLower(input.Endpoint))
	if endpoint == "" || strings.TrimSpace(input.SSHUser) == "" {
		return "请先填写主机地址和 SSH 用户", false
	}
	if strings.Contains(endpoint, "fail") || strings.Contains(endpoint, "offline") || strings.Contains(endpoint, "unreachable") {
		return "目标机器不可达，SSH 握手超时", false
	}
	if input.AuthMode == string(NodeAuthPrivateKey) && strings.TrimSpace(input.PrivateKey) == "" {
		return "私钥为空，无法建立 SSH 连接", false
	}
	if input.AuthMode != string(NodeAuthPrivateKey) && strings.TrimSpace(input.Password) == "" {
		return "密码为空，无法建立 SSH 连接", false
	}
	return "SSH 连接正常，可继续部署", true
}

func normalizeNodeCapacity(capacity int) int {
	if capacity <= 0 {
		return 4
	}
	return capacity
}

func normalizeNodeSSHPort(port int) int {
	if port <= 0 {
		return 22
	}
	return port
}

func normalizeNodeAuthMode(value string) NodeAuthMode {
	if value == string(NodeAuthPrivateKey) {
		return NodeAuthPrivateKey
	}
	return NodeAuthPassword
}

func normalizeNodeVersion(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "v1.0.0"
	}
	if strings.HasPrefix(value, "v") {
		return value
	}
	return "v" + value
}

func nextNodeVersion(current string) string {
	current = strings.TrimPrefix(strings.TrimSpace(current), "v")
	parts := strings.Split(current, ".")
	for len(parts) < 3 {
		parts = append(parts, "0")
	}
	patch, err := strconv.Atoi(parts[2])
	if err != nil {
		return "v1.0.0"
	}
	parts[2] = intToString(patch + 1)
	return "v" + strings.Join(parts[:3], ".")
}

func clampPercent(value int) int {
	if value < 0 {
		return 0
	}
	if value > 100 {
		return 100
	}
	return value
}

func cloneNodePointer(node *ClusterNode) *ClusterNode {
	if node == nil {
		return nil
	}
	cloned := cloneJSON(*node)
	return &cloned
}

func validateAlertRuleInput(input AlertRuleInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("告警规则名称必填")
	}
	if input.DelayThresholdSeconds <= 0 {
		return errors.New("延迟阈值必须大于 0")
	}
	if input.ErrorThreshold < 0 {
		return errors.New("错误阈值不能小于 0")
	}
	return nil
}

func (s *Store) recordTaskRevisionLocked(task SyncTask, changeType string, summary string, actor string) {
	if task.ID == "" || task.ConfigVersion <= 0 {
		return
	}
	for index := range s.data.TaskRevisions {
		if s.data.TaskRevisions[index].TaskID == task.ID && s.data.TaskRevisions[index].Version == task.ConfigVersion {
			s.data.TaskRevisions[index].Snapshot = cloneJSON(task)
			s.data.TaskRevisions[index].ChangeType = changeType
			s.data.TaskRevisions[index].Summary = summary
			s.data.TaskRevisions[index].Actor = actor
			return
		}
	}
	s.data.TaskRevisions = append([]TaskRevision{
		{
			ID:         newID(),
			TaskID:     task.ID,
			Version:    task.ConfigVersion,
			ChangeType: changeType,
			Summary:    summary,
			Actor:      actor,
			Snapshot:   cloneJSON(task),
			CreatedAt:  now(),
		},
	}, s.data.TaskRevisions...)
}

func (s *Store) hasTaskRevisionLocked(taskID string, version int) bool {
	for _, revision := range s.data.TaskRevisions {
		if revision.TaskID == taskID && revision.Version == version {
			return true
		}
	}
	return false
}

func (s *Store) removeTaskRevisionsLocked(taskID string) {
	revisions := s.data.TaskRevisions[:0]
	for _, revision := range s.data.TaskRevisions {
		if revision.TaskID != taskID {
			revisions = append(revisions, revision)
		}
	}
	s.data.TaskRevisions = revisions
}

const maxTaskCheckpointsPerTask = 50

func (s *Store) hasTaskCheckpointLocked(taskID string) bool {
	for _, checkpoint := range s.data.TaskCheckpoints {
		if checkpoint.TaskID == taskID {
			return true
		}
	}
	return false
}

func (s *Store) recordTaskCheckpointLocked(runtime TaskRuntimeState, reason string, previousNodeID string) {
	if runtime.TaskID == "" {
		return
	}
	if reason == "" {
		reason = "runtime_tick"
	}
	lease := TaskLease{}
	for _, item := range s.data.TaskLeases {
		if item.TaskID == runtime.TaskID {
			lease = item
			break
		}
	}
	checkpoint := TaskCheckpoint{
		ID:              newID(),
		TaskID:          runtime.TaskID,
		Phase:           runtime.Phase,
		BinlogFile:      runtime.BinlogFile,
		BinlogPosition:  runtime.BinlogPosition,
		NodeID:          runtime.NodeID,
		PreviousNodeID:  previousNodeID,
		LeaseEpoch:      lease.Epoch,
		TakeoverCount:   lease.TakeoverCount,
		EventsPerSecond: runtime.EventsPerSecond,
		DelaySeconds:    runtime.DelaySeconds,
		Reason:          reason,
		CreatedAt:       now(),
	}
	for _, existing := range s.data.TaskCheckpoints {
		if existing.TaskID != runtime.TaskID {
			continue
		}
		if existing.Phase == checkpoint.Phase &&
			existing.BinlogFile == checkpoint.BinlogFile &&
			existing.BinlogPosition == checkpoint.BinlogPosition &&
			existing.NodeID == checkpoint.NodeID &&
			existing.PreviousNodeID == checkpoint.PreviousNodeID &&
			existing.LeaseEpoch == checkpoint.LeaseEpoch &&
			existing.Reason == checkpoint.Reason {
			return
		}
		break
	}
	s.data.TaskCheckpoints = append([]TaskCheckpoint{checkpoint}, s.data.TaskCheckpoints...)
	s.pruneTaskCheckpointsLocked(runtime.TaskID)
}

func (s *Store) pruneTaskCheckpointsLocked(taskID string) {
	keptForTask := 0
	checkpoints := s.data.TaskCheckpoints[:0]
	for _, checkpoint := range s.data.TaskCheckpoints {
		if checkpoint.TaskID != taskID {
			checkpoints = append(checkpoints, checkpoint)
			continue
		}
		if keptForTask >= maxTaskCheckpointsPerTask {
			continue
		}
		checkpoints = append(checkpoints, checkpoint)
		keptForTask++
	}
	s.data.TaskCheckpoints = checkpoints
}

func (s *Store) removeTaskCheckpointsLocked(taskID string) {
	checkpoints := s.data.TaskCheckpoints[:0]
	for _, checkpoint := range s.data.TaskCheckpoints {
		if checkpoint.TaskID != taskID {
			checkpoints = append(checkpoints, checkpoint)
		}
	}
	s.data.TaskCheckpoints = checkpoints
}

func (s *Store) removeTaskLogsLocked(taskID string) {
	logs := s.data.TaskLogs[:0]
	for _, entry := range s.data.TaskLogs {
		if entry.TaskID != taskID {
			logs = append(logs, entry)
		}
	}
	s.data.TaskLogs = logs
}

func lifecycleActionMessage(action string, status TaskStatus) string {
	switch action {
	case "start":
		return "Task started"
	case "resume":
		return "Task resumed"
	case "pause":
		return "Task paused"
	case "stop":
		return "Task stopped"
	default:
		return "Task status changed to " + string(status)
	}
}

func sortTaskRevisionsDesc(revisions []TaskRevision) {
	sort.SliceStable(revisions, func(left, right int) bool {
		if revisions[left].Version == revisions[right].Version {
			return revisions[left].CreatedAt > revisions[right].CreatedAt
		}
		return revisions[left].Version > revisions[right].Version
	})
}

func sortTaskCheckpointsDesc(checkpoints []TaskCheckpoint) {
	sort.SliceStable(checkpoints, func(left, right int) bool {
		return checkpoints[left].CreatedAt > checkpoints[right].CreatedAt
	})
}

func (s *Store) refreshRuntimeStatesLocked() {
	s.recountNodeTasksLocked()
}

func (s *Store) refreshCapabilityJobsLocked() {
	timestamp := now()
	changed := false
	for index := range s.data.CapabilityJobs {
		job := &s.data.CapabilityJobs[index]
		if len(job.Steps) == 0 {
			job.Steps = defaultCapabilitySteps(job.Type)
			changed = true
		}
		if job.Status != CapabilityRunning {
			continue
		}
		job.ProgressPercent += 17 + rand.Intn(14)
		if job.ProgressPercent >= 100 {
			job.ProgressPercent = 100
			job.Status = CapabilityCompleted
			job.CurrentStep = len(job.Steps) - 1
		} else {
			job.CurrentStep = minInt(len(job.Steps)-1, job.ProgressPercent/(100/maxInt(1, len(job.Steps))))
		}
		for stepIndex := range job.Steps {
			switch {
			case stepIndex < job.CurrentStep:
				job.Steps[stepIndex].Status = "done"
			case stepIndex == job.CurrentStep && job.Status == CapabilityRunning:
				job.Steps[stepIndex].Status = "running"
			case stepIndex <= job.CurrentStep && job.Status == CapabilityCompleted:
				job.Steps[stepIndex].Status = "done"
			default:
				job.Steps[stepIndex].Status = "waiting"
			}
		}
		if job.Status == CapabilityCompleted {
			switch job.Type {
			case CapabilityStructure:
				s.ensureStructureDDLsForJobLocked(*job)
			case CapabilityQuality:
				s.ensureQualityDiffsForJobLocked(*job)
				job.Summary.CorrectedRows = s.countQualityDiffsLocked(job.ID, QualityDiffCorrected)
			case CapabilitySubscription:
				s.ensureSubscriptionChangesForJobLocked(*job)
				s.applySubscriptionJobLocked(job)
			}
		}
		job.UpdatedAt = timestamp
		changed = true
	}
	if changed {
		_ = s.saveLocked()
	}
}

func (s *Store) ensureStructureDDLsLocked() {
	for _, job := range s.data.CapabilityJobs {
		if job.Type != CapabilityStructure {
			continue
		}
		s.ensureStructureDDLsForJobLocked(job)
	}
}

func (s *Store) ensureStructureDDLsForJobLocked(job CapabilityJob) {
	if job.Type != CapabilityStructure || s.hasStructureDDLsLocked(job.ID) {
		return
	}
	task, ok := s.getTaskLocked(job.TaskID)
	if !ok {
		return
	}
	s.createStructureDDLsLocked(job, task)
}

func (s *Store) createStructureDDLsLocked(job CapabilityJob, task SyncTask) int {
	if job.Type != CapabilityStructure || s.hasStructureDDLsLocked(job.ID) {
		return 0
	}
	limit := minInt(maxInt(2, job.Summary.DDLCount), 12)
	if limit <= 0 {
		limit = 2
	}
	timestamp := now()
	statements := []StructureDDL{}
	for mappingIndex, mapping := range task.TableMappings {
		statements = append(statements, StructureDDL{
			ID:           newID(),
			JobID:        job.ID,
			TaskID:       task.ID,
			SourceObject: mapping.SourceSchema + "." + mapping.SourceTable,
			TargetObject: mapping.TargetSchema + "." + mapping.TargetTable,
			ObjectType:   "table",
			ChangeType:   "create_table",
			Statement:    buildCreateTableDDL(mapping),
			RiskLevel:    structureDDLRisk(mapping, "create_table"),
			Status:       StructureDDLPending,
			CreatedAt:    timestamp,
			UpdatedAt:    timestamp,
		})
		for fieldIndex, field := range mapping.Fields {
			if field.Ignored || field.PrimaryKey {
				continue
			}
			if len(statements) >= limit {
				break
			}
			statements = append(statements, StructureDDL{
				ID:           newID(),
				JobID:        job.ID,
				TaskID:       task.ID,
				SourceObject: mapping.SourceSchema + "." + mapping.SourceTable + "." + field.SourceField,
				TargetObject: mapping.TargetSchema + "." + mapping.TargetTable + "." + field.TargetField,
				ObjectType:   "column",
				ChangeType:   "add_column",
				Statement:    buildAddColumnDDL(mapping, field),
				RiskLevel:    structureDDLRisk(mapping, "add_column_"+intToString(mappingIndex+fieldIndex)),
				Status:       StructureDDLPending,
				CreatedAt:    timestamp,
				UpdatedAt:    timestamp,
			})
		}
		if len(statements) >= limit {
			break
		}
	}
	if len(statements) == 0 {
		return 0
	}
	if len(statements) > limit {
		statements = statements[:limit]
	}
	s.data.StructureDDLs = append(s.data.StructureDDLs, statements...)
	return len(statements)
}

func buildCreateTableDDL(mapping TableMapping) string {
	lines := []string{}
	for _, field := range mapping.Fields {
		if field.Ignored {
			continue
		}
		column := "  `" + field.TargetField + "` " + mysqlColumnType(field.TargetType)
		if !field.Nullable || field.PrimaryKey {
			column += " NOT NULL"
		}
		lines = append(lines, column)
	}
	primaryKey := primaryKeyField(mapping.Fields)
	if primaryKey != "" {
		lines = append(lines, "  PRIMARY KEY (`"+primaryKey+"`)")
	}
	return "CREATE TABLE IF NOT EXISTS `" + mapping.TargetSchema + "`.`" + mapping.TargetTable + "` (\n" + strings.Join(lines, ",\n") + "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;"
}

func buildAddColumnDDL(mapping TableMapping, field FieldMapping) string {
	column := "`" + field.TargetField + "` " + mysqlColumnType(field.TargetType)
	if !field.Nullable {
		column += " NOT NULL"
	}
	return "ALTER TABLE `" + mapping.TargetSchema + "`.`" + mapping.TargetTable + "` ADD COLUMN " + column + ";"
}

func mysqlColumnType(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" {
		return "varchar(255)"
	}
	if strings.Contains(normalized, "bigint") {
		return "bigint"
	}
	if strings.Contains(normalized, "int") {
		return "int"
	}
	if strings.Contains(normalized, "decimal") {
		return "decimal(18,4)"
	}
	if strings.Contains(normalized, "datetime") || strings.Contains(normalized, "timestamp") {
		return "datetime"
	}
	if strings.Contains(normalized, "json") {
		return "json"
	}
	return "varchar(255)"
}

func structureDDLRisk(mapping TableMapping, changeType string) string {
	if strings.Contains(changeType, "create_table") {
		return "low"
	}
	if len(mapping.Fields) > 8 {
		return "medium"
	}
	return "low"
}

func (s *Store) hasStructureDDLsLocked(jobID string) bool {
	for _, statement := range s.data.StructureDDLs {
		if statement.JobID == jobID {
			return true
		}
	}
	return false
}

func (s *Store) removeStructureDDLsLocked(jobID string) {
	statements := s.data.StructureDDLs[:0]
	for _, statement := range s.data.StructureDDLs {
		if statement.JobID != jobID {
			statements = append(statements, statement)
		}
	}
	s.data.StructureDDLs = statements
}

func sortStructureDDLs(statements []StructureDDL) {
	sort.SliceStable(statements, func(left, right int) bool {
		if statements[left].Status == statements[right].Status {
			return statements[left].CreatedAt > statements[right].CreatedAt
		}
		return statements[left].Status == StructureDDLPending
	})
}

func (s *Store) ensureQualityDiffsLocked() {
	for _, job := range s.data.CapabilityJobs {
		if job.Type != CapabilityQuality {
			continue
		}
		s.ensureQualityDiffsForJobLocked(job)
	}
}

func (s *Store) ensureQualityDiffsForJobLocked(job CapabilityJob) {
	if job.Type != CapabilityQuality || s.hasQualityDiffsLocked(job.ID) {
		return
	}
	task, ok := s.getTaskLocked(job.TaskID)
	if !ok {
		return
	}
	s.createQualityDiffsLocked(job, task)
}

func (s *Store) createQualityDiffsLocked(job CapabilityJob, task SyncTask) int {
	if job.Type != CapabilityQuality || s.hasQualityDiffsLocked(job.ID) {
		return 0
	}
	limit := minInt(maxInt(3, job.Summary.DiffRows), 12)
	if limit <= 0 {
		limit = 3
	}
	timestamp := now()
	type diffCandidate struct {
		mapping      TableMapping
		mappingIndex int
		field        FieldMapping
		fieldIndex   int
		primaryKey   string
	}
	candidates := []diffCandidate{}
	for mappingIndex, mapping := range task.TableMappings {
		fields := activeDiffFields(mapping.Fields)
		if len(fields) == 0 {
			continue
		}
		primaryKey := primaryKeyField(mapping.Fields)
		for fieldIndex, field := range fields {
			candidates = append(candidates, diffCandidate{mapping: mapping, mappingIndex: mappingIndex, field: field, fieldIndex: fieldIndex, primaryKey: primaryKey})
		}
	}
	if len(candidates) == 0 {
		return 0
	}
	created := 0
	for created < limit {
		candidate := candidates[created%len(candidates)]
		diffType := []string{"value_mismatch", "target_missing", "source_missing"}[(created+candidate.mappingIndex+candidate.fieldIndex)%3]
		sourceValue, targetValue := sampleDiffValues(candidate.field.SourceField, created)
		diff := QualityDiff{
			ID:            newID(),
			JobID:         job.ID,
			TaskID:        task.ID,
			SourceTable:   candidate.mapping.SourceSchema + "." + candidate.mapping.SourceTable,
			TargetTable:   candidate.mapping.TargetSchema + "." + candidate.mapping.TargetTable,
			PrimaryKey:    candidate.primaryKey + "=" + intToString(90000+created*37+candidate.mappingIndex),
			DiffType:      diffType,
			FieldName:     candidate.field.SourceField,
			SourceValue:   sourceValue,
			TargetValue:   targetValue,
			Severity:      qualityDiffSeverity(candidate.field, diffType),
			Status:        QualityDiffPending,
			CorrectionSQL: buildCorrectionSQL(candidate.mapping, candidate.primaryKey, candidate.field.TargetField, sourceValue, created),
			CreatedAt:     timestamp,
			UpdatedAt:     timestamp,
		}
		s.data.QualityDiffs = append(s.data.QualityDiffs, diff)
		created++
	}
	return created
}

func activeDiffFields(fields []FieldMapping) []FieldMapping {
	active := make([]FieldMapping, 0, len(fields))
	for _, field := range fields {
		if !field.Ignored && !field.PrimaryKey {
			active = append(active, field)
		}
	}
	if len(active) > 0 {
		return active
	}
	for _, field := range fields {
		if !field.Ignored {
			active = append(active, field)
		}
	}
	return active
}

func primaryKeyField(fields []FieldMapping) string {
	for _, field := range fields {
		if field.PrimaryKey {
			return valueOr(field.TargetField, field.SourceField)
		}
	}
	return "id"
}

func sampleDiffValues(field string, index int) (string, string) {
	field = strings.ToLower(field)
	switch {
	case strings.Contains(field, "amount") || strings.Contains(field, "price"):
		return intToString(839+index*17) + ".42", intToString(839+index*17) + ".40"
	case strings.Contains(field, "status"):
		return "PAID", "PAYING"
	case strings.Contains(field, "time") || strings.Contains(field, "date"):
		return "2026-05-22 18:" + twoDigit(index+7) + ":31", "2026-05-22 18:" + twoDigit(index+5) + ":18"
	default:
		return "source_" + intToString(471+index*13), "target_" + intToString(469+index*11)
	}
}

func qualityDiffSeverity(field FieldMapping, diffType string) string {
	name := strings.ToLower(field.SourceField + field.TargetField)
	if field.PrimaryKey || strings.Contains(name, "amount") || diffType == "target_missing" {
		return "high"
	}
	if strings.Contains(name, "status") || strings.Contains(name, "time") {
		return "medium"
	}
	return "low"
}

func buildCorrectionSQL(mapping TableMapping, primaryKey string, targetField string, sourceValue string, index int) string {
	return "UPDATE " + mapping.TargetSchema + "." + mapping.TargetTable +
		" SET " + targetField + " = '" + sourceValue + "'" +
		" WHERE " + primaryKey + " = " + intToString(90000+index*37)
}

func (s *Store) hasQualityDiffsLocked(jobID string) bool {
	for _, diff := range s.data.QualityDiffs {
		if diff.JobID == jobID {
			return true
		}
	}
	return false
}

func (s *Store) removeQualityDiffsLocked(jobID string) {
	diffs := s.data.QualityDiffs[:0]
	for _, diff := range s.data.QualityDiffs {
		if diff.JobID != jobID {
			diffs = append(diffs, diff)
		}
	}
	s.data.QualityDiffs = diffs
}

func (s *Store) countQualityDiffsLocked(jobID string, status QualityDiffStatus) int {
	count := 0
	for _, diff := range s.data.QualityDiffs {
		if diff.JobID == jobID && diff.Status == status {
			count++
		}
	}
	return count
}

func sortQualityDiffs(diffs []QualityDiff) {
	sort.SliceStable(diffs, func(left, right int) bool {
		if diffs[left].Status == diffs[right].Status {
			return diffs[left].CreatedAt > diffs[right].CreatedAt
		}
		return diffs[left].Status == QualityDiffPending
	})
}

func (s *Store) ensureSubscriptionChangesLocked() {
	for _, job := range s.data.CapabilityJobs {
		if job.Type != CapabilitySubscription {
			continue
		}
		s.ensureSubscriptionChangesForJobLocked(job)
	}
}

func (s *Store) ensureSubscriptionChangesForJobLocked(job CapabilityJob) {
	if job.Type != CapabilitySubscription || s.hasSubscriptionChangesLocked(job.ID) {
		return
	}
	task, ok := s.getTaskLocked(job.TaskID)
	if !ok {
		return
	}
	created := s.createSubscriptionChangesLocked(job, task)
	if created > 0 && job.Status == CapabilityCompleted {
		s.markSubscriptionChangesAppliedLocked(job.ID, valueOr(job.UpdatedAt, now()), "历史订阅任务已完成，补齐发布记录")
	}
}

func (s *Store) createSubscriptionChangesLocked(job CapabilityJob, task SyncTask) int {
	if job.Type != CapabilitySubscription || s.hasSubscriptionChangesLocked(job.ID) {
		return 0
	}
	timestamp := now()
	changes := []SubscriptionChange{}
	switch job.Mode {
	case "filter_actions":
		changes = append(changes, SubscriptionChange{
			ID:            newID(),
			JobID:         job.ID,
			TaskID:        task.ID,
			ChangeType:    "action_filter",
			SourceObject:  task.Name,
			TargetObject:  task.Name,
			BeforeActions: writeActionsFromStrategy(task.Strategy),
			AfterActions:  []string{"insert", "update"},
			FieldCount:    mappedFieldCount(task.TableMappings),
			RiskLevel:     "medium",
			Status:        SubscriptionChangePending,
			ResultMessage: "等待发布 action 过滤",
			CreatedAt:     timestamp,
			UpdatedAt:     timestamp,
		})
	case "condition_filter":
		mapping := firstTableMapping(task)
		changes = append(changes, SubscriptionChange{
			ID:            newID(),
			JobID:         job.ID,
			TaskID:        task.ID,
			ChangeType:    "condition_filter",
			SourceObject:  objectName(mapping.SourceSchema, mapping.SourceTable),
			TargetObject:  objectName(mapping.TargetSchema, mapping.TargetTable),
			BeforeActions: tableActions(mapping, task.Strategy),
			AfterActions:  tableActions(mapping, task.Strategy),
			BeforeFilter:  mapping.FilterExpression,
			AfterFilter:   "updated_at >= DATE_SUB(CURRENT_DATE, INTERVAL 90 DAY)",
			FieldCount:    len(mapping.Fields),
			RiskLevel:     "high",
			Status:        SubscriptionChangePending,
			ResultMessage: "等待发布条件过滤",
			CreatedAt:     timestamp,
			UpdatedAt:     timestamp,
		})
	default:
		count := maxInt(1, job.Summary.AddedTables)
		for index := 0; index < count; index++ {
			tableIndex := len(task.TableMappings) + index + 1
			sourceTable := "auto_added_" + intToString(tableIndex)
			targetTable := "ods_auto_added_" + intToString(tableIndex)
			changes = append(changes, SubscriptionChange{
				ID:            newID(),
				JobID:         job.ID,
				TaskID:        task.ID,
				ChangeType:    "add_table",
				SourceObject:  objectName("order_center", sourceTable),
				TargetObject:  objectName("reporting", targetTable),
				AfterActions:  writeActionsFromStrategy(task.Strategy),
				FieldCount:    2,
				RiskLevel:     "medium",
				Status:        SubscriptionChangePending,
				ResultMessage: "等待发布新增订阅表",
				CreatedAt:     timestamp,
				UpdatedAt:     timestamp,
			})
		}
	}
	s.data.SubscriptionChanges = append(s.data.SubscriptionChanges, changes...)
	return len(changes)
}

func (s *Store) hasSubscriptionChangesLocked(jobID string) bool {
	for _, change := range s.data.SubscriptionChanges {
		if change.JobID == jobID {
			return true
		}
	}
	return false
}

func (s *Store) removeSubscriptionChangesLocked(jobID string) {
	changes := s.data.SubscriptionChanges[:0]
	for _, change := range s.data.SubscriptionChanges {
		if change.JobID != jobID {
			changes = append(changes, change)
		}
	}
	s.data.SubscriptionChanges = changes
}

func (s *Store) markSubscriptionChangesAppliedLocked(jobID string, timestamp string, message string) {
	for index := range s.data.SubscriptionChanges {
		change := &s.data.SubscriptionChanges[index]
		if change.JobID != jobID || change.Status == SubscriptionChangeApplied {
			continue
		}
		change.Status = SubscriptionChangeApplied
		change.AppliedAt = timestamp
		change.AppliedBy = "system"
		change.HandledReason = message
		change.ResultMessage = message
		change.UpdatedAt = timestamp
	}
}

func sortSubscriptionChanges(changes []SubscriptionChange) {
	sort.SliceStable(changes, func(left, right int) bool {
		if changes[left].Status == changes[right].Status {
			return changes[left].CreatedAt > changes[right].CreatedAt
		}
		return changes[left].Status == SubscriptionChangePending
	})
}

func (s *Store) getCapabilityJobLocked(id string) (CapabilityJob, bool) {
	for _, job := range s.data.CapabilityJobs {
		if job.ID == id {
			return job, true
		}
	}
	return CapabilityJob{}, false
}

func (s *Store) getCapabilityJobPointerLocked(id string) *CapabilityJob {
	for index := range s.data.CapabilityJobs {
		if s.data.CapabilityJobs[index].ID == id {
			return &s.data.CapabilityJobs[index]
		}
	}
	return nil
}

func (s *Store) applySubscriptionJobLocked(job *CapabilityJob) {
	for taskIndex := range s.data.SyncTasks {
		if s.data.SyncTasks[taskIndex].ID != job.TaskID {
			continue
		}
		task := &s.data.SyncTasks[taskIndex]
		timestamp := now()
		applied := 0
		for changeIndex := range s.data.SubscriptionChanges {
			change := &s.data.SubscriptionChanges[changeIndex]
			if change.JobID != job.ID || change.Status == SubscriptionChangeApplied {
				continue
			}
			switch change.ChangeType {
			case "add_table":
				if !taskHasMapping(*task, change.SourceObject, change.TargetObject) {
					sourceSchema, sourceTable := splitObjectName(change.SourceObject)
					targetSchema, targetTable := splitObjectName(change.TargetObject)
					task.TableMappings = append(task.TableMappings, TableMapping{
						ID:           newID(),
						SourceSchema: sourceSchema,
						SourceTable:  sourceTable,
						TargetSchema: targetSchema,
						TargetTable:  targetTable,
						EventActions: change.AfterActions,
						Fields: []FieldMapping{
							{SourceField: "id", TargetField: "id", SourceType: "bigint", TargetType: "bigint", PrimaryKey: true},
							{SourceField: "updated_at", TargetField: "updated_at", SourceType: "datetime", TargetType: "datetime"},
						},
					})
				}
			case "action_filter":
				for mappingIndex := range task.TableMappings {
					task.TableMappings[mappingIndex].EventActions = append([]string{}, change.AfterActions...)
				}
				task.Strategy.WriteMode.Insert = containsString(change.AfterActions, "insert")
				task.Strategy.WriteMode.Update = containsString(change.AfterActions, "update")
				task.Strategy.WriteMode.Delete = containsString(change.AfterActions, "delete")
			case "condition_filter":
				for mappingIndex := range task.TableMappings {
					if objectName(task.TableMappings[mappingIndex].SourceSchema, task.TableMappings[mappingIndex].SourceTable) == change.SourceObject {
						task.TableMappings[mappingIndex].FilterExpression = change.AfterFilter
						break
					}
				}
			}
			change.Status = SubscriptionChangeApplied
			change.AppliedAt = timestamp
			change.AppliedBy = "system"
			change.HandledReason = "能力任务完成后自动发布"
			change.ResultMessage = "已发布到任务配置 v" + intToString(task.ConfigVersion+1)
			change.UpdatedAt = timestamp
			applied++
		}
		if applied > 0 {
			task.ConfigVersion++
			task.UpdatedAt = timestamp
			job.Summary.AddedTables = s.countSubscriptionChangesLocked(job.ID, "add_table")
			job.UpdatedAt = timestamp
			s.recordTaskRevisionLocked(*task, "subscription", "订阅变更已生效", "system")
			s.logLocked("system", "subscription_apply", "sync_task", task.ID, "订阅变更已生效："+job.Name+"，发布 "+intToString(applied)+" 项变更")
		}
		return
	}
}

func (s *Store) countSubscriptionChangesLocked(jobID string, changeType string) int {
	count := 0
	for _, change := range s.data.SubscriptionChanges {
		if change.JobID != jobID {
			continue
		}
		if changeType == "" || change.ChangeType == changeType {
			count++
		}
	}
	return count
}

func mappedFieldCount(mappings []TableMapping) int {
	count := 0
	for _, mapping := range mappings {
		count += len(mapping.Fields)
	}
	return count
}

func firstTableMapping(task SyncTask) TableMapping {
	if len(task.TableMappings) == 0 {
		return TableMapping{
			SourceSchema: "source",
			SourceTable:  "unknown",
			TargetSchema: "target",
			TargetTable:  "unknown",
		}
	}
	return task.TableMappings[0]
}

func tableActions(mapping TableMapping, strategy SyncStrategy) []string {
	if len(mapping.EventActions) > 0 {
		return append([]string{}, mapping.EventActions...)
	}
	return writeActionsFromStrategy(strategy)
}

func writeActionsFromStrategy(strategy SyncStrategy) []string {
	actions := []string{}
	if strategy.WriteMode.Insert {
		actions = append(actions, "insert")
	}
	if strategy.WriteMode.Update {
		actions = append(actions, "update")
	}
	if strategy.WriteMode.Delete {
		actions = append(actions, "delete")
	}
	return actions
}

func objectName(schema string, table string) string {
	if strings.TrimSpace(schema) == "" {
		return strings.TrimSpace(table)
	}
	return strings.TrimSpace(schema) + "." + strings.TrimSpace(table)
}

func splitObjectName(value string) (string, string) {
	parts := strings.SplitN(strings.TrimSpace(value), ".", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", strings.TrimSpace(value)
}

func taskHasMapping(task SyncTask, sourceObject string, targetObject string) bool {
	for _, mapping := range task.TableMappings {
		if objectName(mapping.SourceSchema, mapping.SourceTable) == sourceObject && objectName(mapping.TargetSchema, mapping.TargetTable) == targetObject {
			return true
		}
	}
	return false
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func defaultCapabilityJobName(jobType CapabilityJobType, taskName string) string {
	switch jobType {
	case CapabilityStructure:
		return taskName + " 结构迁移计划"
	case CapabilityQuality:
		return taskName + " 校验订正"
	case CapabilitySubscription:
		return taskName + " 订阅变更"
	default:
		return taskName + " 能力任务"
	}
}

func defaultCapabilityMode(jobType CapabilityJobType) string {
	switch jobType {
	case CapabilityStructure:
		return "schema_prepare"
	case CapabilityQuality:
		return "verify_then_correct"
	case CapabilitySubscription:
		return "add_tables"
	default:
		return "standard"
	}
}

func defaultCapabilitySteps(jobType CapabilityJobType) []CapabilityStep {
	var names []string
	switch jobType {
	case CapabilityStructure:
		names = []string{"结构扫描", "差异分析", "DDL 生成", "目标执行", "持续同步"}
	case CapabilityQuality:
		names = []string{"抽样计划", "一次校验", "二次差异校验", "订正预览", "执行回写"}
	case CapabilitySubscription:
		names = []string{"读取订阅", "对象变更", "过滤预检", "发布版本", "增量生效"}
	default:
		names = []string{"创建", "执行", "完成"}
	}
	steps := make([]CapabilityStep, 0, len(names))
	for index, name := range names {
		status := "waiting"
		if index == 0 {
			status = "running"
		}
		steps = append(steps, CapabilityStep{
			Name:   name,
			Status: status,
			Detail: capabilityStepDetail(jobType, name),
		})
	}
	return steps
}

func completedCapabilitySteps(jobType CapabilityJobType) []CapabilityStep {
	steps := defaultCapabilitySteps(jobType)
	for index := range steps {
		steps[index].Status = "done"
	}
	return steps
}

func capabilityStepDetail(jobType CapabilityJobType, name string) string {
	switch jobType {
	case CapabilityStructure:
		return "检查源端结构、目标端缺失对象和类型转换风险"
	case CapabilityQuality:
		return "使用两轮差异校验降低同步延迟造成的误判"
	case CapabilitySubscription:
		return "在运行中链路上预检加表、删表、过滤和版本发布"
	default:
		return name
	}
}

func buildCapabilitySummary(jobType CapabilityJobType, task SyncTask, mode string) CapabilityJobSummary {
	tables := len(task.TableMappings)
	columns := 0
	for _, mapping := range task.TableMappings {
		columns += len(mapping.Fields)
	}
	summary := CapabilityJobSummary{
		Tables:    maxInt(1, tables),
		Columns:   maxInt(1, columns),
		RiskLevel: "low",
	}
	switch jobType {
	case CapabilityStructure:
		summary.DDLCount = maxInt(1, tables+columns/3)
	case CapabilityQuality:
		summary.DiffRows = maxInt(3, columns*2+tables)
		if summary.DiffRows > 12 {
			summary.RiskLevel = "medium"
		}
	case CapabilitySubscription:
		switch mode {
		case "filter_actions":
			summary.RiskLevel = "medium"
		case "condition_filter":
			summary.RiskLevel = "high"
		default:
			summary.AddedTables = 1
			summary.RiskLevel = "medium"
		}
	}
	return summary
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
	return s.persistence.Save(s.data)
}
