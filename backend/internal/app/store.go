package app

import (
	"encoding/json"
	"errors"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
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
		store.ensureClusterLocked()
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
	if err := store.saveLocked(); err != nil {
		return nil, err
	}
	return store, nil
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
	runtime := s.defaultRuntimeLocked(input.ID)
	if leaseRequired(input.Status) {
		if node := s.selectNodeLocked(""); node != nil {
			runtime.NodeID = node.ID
			runtime.LeaseExpiresAt = leaseExpiry()
			s.upsertLeaseLocked(input.ID, node.ID, false)
		}
	}
	s.data.RuntimeStates = append([]TaskRuntimeState{runtime}, s.data.RuntimeStates...)
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
			s.assignTaskToNodeLocked(runtime, node.ID, "任务重跑分配", false)
		} else {
			task.Status = TaskPending
			runtime.Phase = "idle"
		}
		task.UpdatedAt = timestamp
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
				s.assignTaskToNodeLocked(runtime, node.ID, "任务状态恢复分配", false)
			}
		}
		runtime.UpdatedAt = timestamp
		task.UpdatedAt = timestamp
		updated := *task
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
		detail := "重置任务位点 " + task.Name + " 到 " + input.BinlogFile + ":" + intToString(int(input.BinlogPosition))
		if input.ServerID != "" {
			detail += " serverId=" + input.ServerID
		}
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

func (s *Store) HeartbeatNode(id string) (ClusterNode, bool, error) {
	return s.MarkNodeStatus(id, NodeOnline)
}

func (s *Store) RefreshOnlineNodeHeartbeats() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	changed := false
	for index := range s.data.Nodes {
		if s.data.Nodes[index].Status != NodeOnline {
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

func (s *Store) StartEmbeddedNodeHeartbeat(interval time.Duration) func() {
	if interval <= 0 {
		return func() {}
	}
	ticker := time.NewTicker(interval)
	done := make(chan struct{})
	var stopOnce sync.Once
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				_ = s.RefreshOnlineNodeHeartbeats()
			case <-done:
				return
			}
		}
	}()
	return func() {
		stopOnce.Do(func() {
			close(done)
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
	go func() {
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
		})
	}
}

func (s *Store) RebalanceCluster() (ClusterSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	s.markStaleNodesLocked()
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
		targetNode := s.selectNodeForLoadLocked(plannedLoads)
		if targetNode == nil {
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			runtime.UpdatedAt = now()
			s.removeLeaseLocked(runtime.TaskID)
			continue
		}
		if currentNode == nil || currentNode.Status != NodeOnline || targetNode.ID != runtime.NodeID {
			s.assignTaskToNodeLocked(runtime, targetNode.ID, "任务重新均衡", false)
		} else {
			runtime.LeaseExpiresAt = leaseExpiry()
			s.upsertLeaseLocked(runtime.TaskID, runtime.NodeID, false)
		}
		plannedLoads[targetNode.ID]++
	}
	if err := s.saveLocked(); err != nil {
		return ClusterSnapshot{}, err
	}
	return s.clusterSnapshotLocked(), nil
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

func (s *Store) AlertRuleEvaluations() []AlertRuleEvaluation {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
	s.refreshRuntimeStatesLocked()
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
			UpdatedAt: now(),
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
	return cloneJSON(evaluations)
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
	input.Steps = defaultCapabilitySteps(input.Type)
	if input.Status == CapabilityRunning {
		input.ProgressPercent = 18
	} else {
		input.ProgressPercent = 0
		for stepIndex := range input.Steps {
			input.Steps[stepIndex].Status = "waiting"
		}
	}
	input.CurrentStep = 0
	input.Summary = buildCapabilitySummary(input.Type, task)
	input.CreatedAt = timestamp
	input.UpdatedAt = timestamp
	s.data.CapabilityJobs = append([]CapabilityJob{input}, s.data.CapabilityJobs...)
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
		}
		job.UpdatedAt = now()
		s.logLocked("admin", "run", "capability_job", id, "运行能力任务 "+job.Name)
		return cloneJSON(*job), true, s.saveLocked()
	}
	return CapabilityJob{}, false, nil
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
		UpdatedAt:       now(),
	}
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
				runtime.NodeID = node.ID
				runtime.LeaseExpiresAt = leaseExpiry()
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
			runtime.NodeID = ""
			runtime.LeaseExpiresAt = ""
			runtime.UpdatedAt = now()
			s.removeLeaseLocked(task.ID)
			continue
		}
		s.assignTaskToNodeLocked(runtime, target.ID, "节点故障自动接管", true)
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
	if takeover {
		runtime.FailoverCount++
		runtime.LastTakeoverAt = now()
	}
	runtime.UpdatedAt = now()
	lease := s.upsertLeaseLocked(runtime.TaskID, nodeID, takeover)
	detail := reason + "：" + runtime.TaskID + " 从 " + valueOr(previousNodeID, "unassigned") + " 切换到 " + nodeID
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

func (s *Store) selectNodeForLoadLocked(loads map[string]int) *ClusterNode {
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

func (s *Store) refreshRuntimeStatesLocked() {
	timestamp := now()
	changed := false
	for index := range s.data.SyncTasks {
		task := &s.data.SyncTasks[index]
		runtime := s.ensureRuntimeLocked(task.ID)
		if runtime.NodeID != "" && leaseRequired(task.Status) {
			runtime.LeaseExpiresAt = leaseExpiry()
			s.upsertLeaseLocked(task.ID, runtime.NodeID, false)
		}
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
		s.recountNodeTasksLocked()
		_ = s.saveLocked()
	}
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
			case CapabilityQuality:
				job.Summary.CorrectedRows = job.Summary.DiffRows
			case CapabilitySubscription:
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

func (s *Store) applySubscriptionJobLocked(job *CapabilityJob) {
	for taskIndex := range s.data.SyncTasks {
		if s.data.SyncTasks[taskIndex].ID != job.TaskID {
			continue
		}
		task := &s.data.SyncTasks[taskIndex]
		if job.Summary.AddedTables > 0 {
			for added := 0; added < job.Summary.AddedTables; added++ {
				task.TableMappings = append(task.TableMappings, TableMapping{
					ID:           newID(),
					SourceSchema: "order_center",
					SourceTable:  "auto_added_" + intToString(added+1),
					TargetSchema: "reporting",
					TargetTable:  "ods_auto_added_" + intToString(added+1),
					Fields: []FieldMapping{
						{SourceField: "id", TargetField: "id", SourceType: "bigint", TargetType: "bigint", PrimaryKey: true},
						{SourceField: "updated_at", TargetField: "updated_at", SourceType: "datetime", TargetType: "datetime"},
					},
				})
			}
			task.ConfigVersion++
			task.UpdatedAt = now()
			s.logLocked("system", "subscription_apply", "sync_task", task.ID, "订阅变更已生效："+job.Name)
		}
		return
	}
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

func buildCapabilitySummary(jobType CapabilityJobType, task SyncTask) CapabilityJobSummary {
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
		summary.AddedTables = 1
		summary.RiskLevel = "medium"
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
