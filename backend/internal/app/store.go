package app

import (
	"errors"
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
		store.normalizeSupportedDataLocked()
		store.reconcileClusterLocked()
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
	store.normalizeSupportedDataLocked()
	store.reconcileClusterLocked()
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
	ensureUser(User{
		ID:           "user-readonly",
		Name:         "只读用户",
		Username:     "readonly",
		Role:         RoleReadonly,
		PasswordHash: hashPassword("readonly123"),
		CreatedAt:    createdAt,
	})
}

func (s *Store) normalizeSupportedDataLocked() {
	logs := make([]OperationLog, 0, len(s.data.OperationLogs))
	for _, entry := range s.data.OperationLogs {
		if entry.TargetType == "sync_task" || entry.TargetType == "error_event" || entry.TargetType == "capability_job" {
			continue
		}
		logs = append(logs, entry)
	}
	s.data.OperationLogs = logs
	s.data.AlertEvents = nil
	for index := range s.data.Datasources {
		if s.data.Datasources[index].Type == "" {
			s.data.Datasources[index].Type = DatasourceTypeMySQL
		}
		if s.data.Datasources[index].Purpose == "" {
			s.data.Datasources[index].Purpose = DatasourcePurposeGeneral
		}
		switch s.data.Datasources[index].ConnectionStatus {
		case DatasourceStatus("online"):
			s.data.Datasources[index].ConnectionStatus = DatasourceAvailable
		case DatasourceStatus("offline"):
			s.data.Datasources[index].ConnectionStatus = DatasourceFailed
		case "":
			s.data.Datasources[index].ConnectionStatus = DatasourceUntested
		}
		if !s.data.Datasources[index].IsDemo {
			continue
		}
		switch s.data.Datasources[index].Host {
		case "mysql-source.internal":
			s.data.Datasources[index].Host = "mysql-order.internal"
		case "mysql-target.internal":
			s.data.Datasources[index].Host = "mysql-reporting.internal"
		}
	}
	for index := range s.data.AlertRules {
		if strings.Contains(s.data.AlertRules[index].Name, "任务") || strings.TrimSpace(s.data.AlertRules[index].Name) == "" {
			s.data.AlertRules[index].Name = "默认告警"
		}
	}
	for index := range s.data.Nodes {
		if string(s.data.Nodes[index].Status) == "draining" {
			s.data.Nodes[index].Status = NodeOnline
		}
		if normalizeNodeRole(s.data.Nodes[index].Role) == "" {
			s.data.Nodes[index].Role = ""
		} else {
			s.data.Nodes[index].Role = normalizeNodeRole(s.data.Nodes[index].Role)
		}
	}
}

func (s *Store) Snapshot() DatabaseShape {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reconcileClusterLocked()
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

func (s *Store) CreateDatasource(input Datasource, testResult DatasourceTestResult) (Datasource, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	timestamp := now()
	input.ID = newID()
	input.ConnectionStatus = DatasourceAvailable
	input.Version = testResult.Version
	input.LastTestedAt = testResult.TestedAt
	input.LastTestMessage = testResult.Message
	input.LastTestLatencyMS = testResult.LatencyMS
	input.IsDemo = false
	input.CreatedAt = timestamp
	input.UpdatedAt = timestamp
	s.data.Datasources = append([]Datasource{input}, s.data.Datasources...)
	s.logLocked("admin", "create", "datasource", input.ID, "Datasource created: "+input.Name)
	if err := s.saveLocked(); err != nil {
		return Datasource{}, err
	}
	return cloneJSON(input), nil
}

type DatasourcePatch struct {
	Name              string
	Type              DatasourceType
	Purpose           DatasourcePurpose
	Host              string
	Port              int
	Username          string
	PasswordSecret    string
	PasswordChanged   bool
	DefaultSchema     string
	Remark            string
	ConnectionChanged bool
	TestResult        *DatasourceTestResult
}

func (s *Store) UpdateDatasource(id string, patch DatasourcePatch) (Datasource, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.Datasources {
		if s.data.Datasources[index].ID != id {
			continue
		}
		s.data.Datasources[index].Name = patch.Name
		s.data.Datasources[index].Type = patch.Type
		s.data.Datasources[index].Purpose = patch.Purpose
		s.data.Datasources[index].Host = patch.Host
		s.data.Datasources[index].Port = patch.Port
		s.data.Datasources[index].Username = patch.Username
		if patch.PasswordChanged {
			s.data.Datasources[index].PasswordSecret = patch.PasswordSecret
		}
		s.data.Datasources[index].DefaultSchema = patch.DefaultSchema
		s.data.Datasources[index].Remark = patch.Remark
		if patch.ConnectionChanged {
			if patch.TestResult != nil && patch.TestResult.Success {
				s.data.Datasources[index].ConnectionStatus = DatasourceAvailable
				s.data.Datasources[index].Version = patch.TestResult.Version
				s.data.Datasources[index].LastTestedAt = patch.TestResult.TestedAt
				s.data.Datasources[index].LastTestMessage = patch.TestResult.Message
				s.data.Datasources[index].LastTestLatencyMS = patch.TestResult.LatencyMS
			} else {
				s.data.Datasources[index].ConnectionStatus = DatasourceStale
			}
		}
		s.data.Datasources[index].UpdatedAt = now()
		updated := s.data.Datasources[index]
		s.logLocked("admin", "update", "datasource", id, "Datasource updated: "+updated.Name)
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
	for index, datasource := range s.data.Datasources {
		if datasource.ID == id {
			s.data.Datasources = append(s.data.Datasources[:index], s.data.Datasources[index+1:]...)
			s.logLocked("admin", "delete", "datasource", id, "Datasource deleted: "+datasource.Name)
			return true, s.saveLocked()
		}
	}
	return false, nil
}

func (s *Store) MarkDatasourceTest(id string, result DatasourceTestResult) (Datasource, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for index := range s.data.Datasources {
		if s.data.Datasources[index].ID != id {
			continue
		}
		if result.Success {
			s.data.Datasources[index].ConnectionStatus = DatasourceAvailable
			s.data.Datasources[index].Version = result.Version
		} else {
			s.data.Datasources[index].ConnectionStatus = DatasourceFailed
			s.data.Datasources[index].Version = ""
		}
		s.data.Datasources[index].LastTestedAt = result.TestedAt
		s.data.Datasources[index].LastTestMessage = result.Message
		s.data.Datasources[index].LastTestLatencyMS = result.LatencyMS
		s.data.Datasources[index].UpdatedAt = now()
		updated := s.data.Datasources[index]
		s.logLocked("admin", "test", "datasource", id, "Datasource connection tested: "+updated.Name)
		return cloneJSON(updated), true, s.saveLocked()
	}
	return Datasource{}, false, nil
}

func (s *Store) RecordDatasourceTestLog(targetID string, name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.logLocked("admin", "test", "datasource", targetID, "Datasource connection tested: "+name)
	return s.saveLocked()
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

func (s *Store) RegisterLocalNode(input ClusterNodeInput) (ClusterNode, error) {
	node, _, err := s.registerNode(input, "system", "node_self_register")
	return node, err
}

func (s *Store) registerNode(input ClusterNodeInput, actor string, action string) (ClusterNode, bool, error) {
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
		if role := normalizeNodeRole(input.Role); role != "" {
			node.Role = role
		} else if normalizeNodeRole(node.Role) == "" {
			node.Role = NodeRoleStandby
		}
		node.Capacity = normalizeNodeCapacity(input.Capacity)
		node.CPUPercent = clampPercent(input.CPUPercent)
		node.MemoryPercent = clampPercent(input.MemoryPercent)
		node.Status = NodeOnline
		node.LastHeartbeatAt = timestamp
		node.UpdatedAt = timestamp
		created = false
		s.logLocked(actor, action, "cluster_node", node.ID, "Node registered or updated: "+node.Name)
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
		Role:            valueOr(normalizeNodeRole(input.Role), NodeRoleStandby),
		CPUPercent:      clampPercent(input.CPUPercent),
		MemoryPercent:   clampPercent(input.MemoryPercent),
		Capacity:        normalizeNodeCapacity(input.Capacity),
		LastHeartbeatAt: timestamp,
		StartedAt:       timestamp,
		UpdatedAt:       timestamp,
	}
	s.data.Nodes = append(s.data.Nodes, node)
	s.logLocked(actor, action, "cluster_node", node.ID, "Node registered: "+node.Name)
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		return ClusterNode{}, false, err
	}
	return cloneJSON(node), created, nil
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
	before := s.clusterSnapshotLocked()
	steps := []NodeOperationStep{
		{Key: "connect", Label: "连接机器", Status: "done", Detail: "已连接到目标节点"},
		{Key: "backup", Label: "备份版本", Status: "done", Detail: "现有版本已完成备份"},
		{Key: "replace", Label: "替换程序包", Status: "done", Detail: "新版本程序包已覆盖"},
		{Key: "restart", Label: "重启节点", Status: "done", Detail: "节点已重启并恢复心跳"},
	}
	node.Version = nextNodeVersion(node.Version)
	node.Status = NodeOnline
	node.LastHeartbeatAt = now()
	node.UpdatedAt = now()
	s.logLocked("admin", "node_upgrade", "cluster_node", id, "Node upgraded: "+node.Name+" to "+node.Version)
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		s.data = backup
		return NodeOperationResult{}, true, err
	}
	updated := cloneJSON(*node)
	after := s.clusterSnapshotLocked()
	return NodeOperationResult{
		Action:     "upgrade",
		Success:    true,
		Message:    updated.Name + " 已升级到 " + updated.Version,
		FinishedAt: now(),
		Node:       &updated,
		Before:     &before,
		After:      &after,
		Steps:      steps,
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
	before := s.clusterSnapshotLocked()
	steps := []NodeOperationStep{
		{Key: "connect", Label: "连接机器", Status: "done", Detail: "已连接到目标节点"},
		{Key: "stop", Label: "停止节点", Status: "done", Detail: "节点进程已停止"},
		{Key: "cleanup", Label: "清理安装目录", Status: "done", Detail: "安装目录与服务文件已移除"},
		{Key: "remove", Label: "注销节点", Status: "done", Detail: "节点已从集群中移除"},
	}
	nodeName := node.Name
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID != id {
			continue
		}
		s.data.Nodes = append(s.data.Nodes[:index], s.data.Nodes[index+1:]...)
		break
	}
	s.reconcileClusterLocked()
	s.logLocked("admin", "node_uninstall", "cluster_node", id, "Node uninstalled: "+nodeName)
	if err := s.saveLocked(); err != nil {
		s.data = backup
		return NodeOperationResult{}, true, err
	}
	after := s.clusterSnapshotLocked()
	return NodeOperationResult{
		Action:        "uninstall",
		Success:       true,
		Message:       nodeName + " 已卸载",
		FinishedAt:    now(),
		RemovedNodeID: id,
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
		s.data.Nodes[index].Status = normalizeNodeStatus(status)
		if s.data.Nodes[index].Status == NodeOnline {
			s.data.Nodes[index].LastHeartbeatAt = now()
		}
		s.data.Nodes[index].UpdatedAt = now()
		s.logLocked("admin", "node_"+string(s.data.Nodes[index].Status), "cluster_node", id, "Node status changed: "+s.data.Nodes[index].Name+" -> "+string(s.data.Nodes[index].Status))
		s.reconcileClusterLocked()
		updated := s.data.Nodes[index]
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
	timestamp := now()
	if node.Status != NodeOffline {
		node.Status = NodeOffline
		node.UpdatedAt = timestamp
		s.logLocked("admin", "node_offline", "cluster_node", id, "Node taken offline: "+node.Name)
	}
	s.reconcileClusterLocked()
	after := s.clusterSnapshotLocked()
	if err := s.saveLocked(); err != nil {
		return NodeStatusChangeResult{}, true, err
	}
	return NodeStatusChangeResult{
		ID:        newID(),
		Action:    "offline",
		Node:      cloneJSON(*node),
		Success:   true,
		Message:   "节点已下线",
		Before:    before,
		After:     after,
		ChangedAt: timestamp,
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
	timestamp := now()
	node.Status = NodeOnline
	node.LastHeartbeatAt = timestamp
	node.UpdatedAt = timestamp
	s.logLocked("admin", "node_online", "cluster_node", id, "Node brought online: "+node.Name)
	s.reconcileClusterLocked()
	after := s.clusterSnapshotLocked()
	if err := s.saveLocked(); err != nil {
		return NodeStatusChangeResult{}, true, err
	}
	return NodeStatusChangeResult{
		ID:        newID(),
		Action:    "online",
		Node:      cloneJSON(*node),
		Success:   true,
		Message:   "节点已上线",
		Before:    before,
		After:     after,
		ChangedAt: timestamp,
	}, true, nil
}

func (s *Store) SetClusterMasterNodeCount(count int) (ClusterSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ensureClusterLocked()
	if count <= 0 {
		return ClusterSnapshot{}, errors.New("主节点个数至少为 1")
	}
	if count > len(s.data.Nodes) {
		return ClusterSnapshot{}, errors.New("主节点个数不能超过节点数量")
	}
	timestamp := now()
	if s.data.ClusterSettings.ID == "" {
		s.data.ClusterSettings = defaultClusterSettings(timestamp)
	}
	s.data.ClusterSettings.MasterNodeCount = count
	s.data.ClusterSettings.UpdatedAt = timestamp
	s.logLocked("admin", "update_master_node_count", "cluster", s.data.ClusterSettings.ID, "Master node count updated: "+intToString(count))
	s.reconcileClusterLocked()
	if err := s.saveLocked(); err != nil {
		return ClusterSnapshot{}, err
	}
	return s.clusterSnapshotLocked(), nil
}

func (s *Store) HeartbeatNode(id string) (ClusterNode, bool, error) {
	return s.MarkNodeStatus(id, NodeOnline)
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
		s.data.Nodes[index].Status = NodeOnline
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
		ID:         newID(),
		Name:       strings.TrimSpace(input.Name),
		Enabled:    enabled,
		WebhookURL: strings.TrimSpace(input.WebhookURL),
		CreatedAt:  timestamp,
		UpdatedAt:  timestamp,
	}
	s.data.AlertRules = append([]AlertRule{rule}, s.data.AlertRules...)
	s.logLocked("admin", "create", "alert_rule", rule.ID, "Alert rule created: "+rule.Name)
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
		rule.Name = strings.TrimSpace(input.Name)
		if input.Enabled != nil {
			rule.Enabled = *input.Enabled
		}
		rule.WebhookURL = strings.TrimSpace(input.WebhookURL)
		rule.UpdatedAt = now()
		s.logLocked("admin", "update", "alert_rule", id, "Alert rule updated: "+rule.Name)
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
		s.logLocked("admin", "delete", "alert_rule", id, "Alert rule deleted: "+rule.Name)
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
	timestamp := now()
	evaluations := make([]AlertRuleEvaluation, 0, len(s.data.AlertRules))
	for _, rule := range s.data.AlertRules {
		evaluations = append(evaluations, AlertRuleEvaluation{
			RuleID:    rule.ID,
			RuleName:  rule.Name,
			Triggered: false,
			Reasons:   []string{},
			UpdatedAt: timestamp,
		})
	}
	return cloneJSON(evaluations)
}

func (s *Store) getDatasourceLocked(id string) (Datasource, bool) {
	for _, datasource := range s.data.Datasources {
		if datasource.ID == id {
			return cloneJSON(datasource), true
		}
	}
	return Datasource{}, false
}

func (s *Store) ensureClusterLocked() {
	timestamp := now()
	s.data.Nodes = normalizeLegacyDemoClusterNodes(s.data.Nodes, timestamp)
	if len(s.data.Nodes) == 0 {
		s.data.Nodes = defaultClusterNodes(timestamp)
	}
	if s.data.ClusterSettings.ID == "" {
		s.data.ClusterSettings = defaultClusterSettings(timestamp)
	}
	s.data.ClusterSettings.MasterNodeCount = normalizeMasterNodeCount(s.data.ClusterSettings.MasterNodeCount, len(s.data.Nodes))
	for index := range s.data.Nodes {
		if string(s.data.Nodes[index].Status) == "draining" {
			s.data.Nodes[index].Status = NodeOnline
		}
		role := normalizeNodeRole(s.data.Nodes[index].Role)
		if role == "" {
			s.data.Nodes[index].Role = ""
		} else {
			s.data.Nodes[index].Role = role
		}
	}
}

func (s *Store) reconcileClusterLocked() {
	s.ensureClusterLocked()
	s.markStaleNodesLocked()
	s.reconcileNodeRolesLocked()
}

func (s *Store) markStaleNodesLocked() {
	for index := range s.data.Nodes {
		node := &s.data.Nodes[index]
		if node.Status != NodeOnline || !heartbeatStale(node.LastHeartbeatAt) {
			continue
		}
		node.Status = NodeOffline
		node.UpdatedAt = now()
		s.logLocked("system", "node_heartbeat_timeout", "cluster_node", node.ID, "Node heartbeat timed out: "+node.Name)
	}
}

func (s *Store) reconcileNodeRolesLocked() {
	if len(s.data.Nodes) == 0 {
		return
	}
	timestamp := now()
	desiredMasters := normalizeMasterNodeCount(s.data.ClusterSettings.MasterNodeCount, len(s.data.Nodes))
	masterIndexes := map[int]bool{}
	for index, node := range s.data.Nodes {
		if len(masterIndexes) >= desiredMasters {
			break
		}
		if node.Status == NodeOnline && node.Role == NodeRoleMaster {
			masterIndexes[index] = true
		}
	}
	for index, node := range s.data.Nodes {
		if len(masterIndexes) >= desiredMasters {
			break
		}
		if node.Status == NodeOnline {
			masterIndexes[index] = true
		}
	}
	if len(masterIndexes) == 0 {
		for index, node := range s.data.Nodes {
			if node.Role == NodeRoleMaster {
				masterIndexes[index] = true
				break
			}
		}
	}
	if len(masterIndexes) == 0 {
		masterIndexes[0] = true
	}

	for index := range s.data.Nodes {
		role := NodeRoleStandby
		if masterIndexes[index] {
			role = NodeRoleMaster
		}
		if s.data.Nodes[index].Role == role {
			continue
		}
		s.data.Nodes[index].Role = role
		s.data.Nodes[index].UpdatedAt = timestamp
		if role == NodeRoleMaster {
			s.logLocked("system", "node_promote", "cluster_node", s.data.Nodes[index].ID, "Node promoted to master: "+s.data.Nodes[index].Name)
		} else {
			s.logLocked("system", "node_standby", "cluster_node", s.data.Nodes[index].ID, "Node changed to standby: "+s.data.Nodes[index].Name)
		}
	}
}

func (s *Store) getNodeLocked(id string) *ClusterNode {
	for index := range s.data.Nodes {
		if s.data.Nodes[index].ID == id {
			return &s.data.Nodes[index]
		}
	}
	return nil
}

func (s *Store) clusterSnapshotLocked() ClusterSnapshot {
	nodes := cloneJSON(s.data.Nodes)
	online := 0
	masterNodeID := ""
	masterNodeName := ""
	for _, node := range nodes {
		if node.Status == NodeOnline {
			online++
		}
		if node.Role == NodeRoleMaster && masterNodeID == "" {
			masterNodeID = node.ID
			masterNodeName = node.Name
		}
	}
	return ClusterSnapshot{
		Nodes:                   nodes,
		MasterNodeID:            masterNodeID,
		MasterNodeName:          masterNodeName,
		MasterNodeCount:         normalizeMasterNodeCount(s.data.ClusterSettings.MasterNodeCount, len(nodes)),
		OnlineNodes:             online,
		TotalNodes:              len(nodes),
		DegradedNodes:           len(nodes) - online,
		HeartbeatTimeoutSeconds: int(nodeHeartbeatTimeout.Seconds()),
	}
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

func normalizeNodeCapacity(capacity int) int {
	if capacity <= 0 {
		return 4
	}
	return capacity
}

func normalizeMasterNodeCount(count int, totalNodes int) int {
	if totalNodes <= 0 {
		return 1
	}
	if count <= 0 {
		return 1
	}
	if count > totalNodes {
		return totalNodes
	}
	return count
}

func normalizeNodeRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case NodeRoleMaster, "primary", "leader", "main":
		return NodeRoleMaster
	case NodeRoleStandby, "slave", "backup", "replica", "worker":
		return NodeRoleStandby
	default:
		return ""
	}
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

func normalizeNodeStatus(status NodeStatus) NodeStatus {
	if status == NodeOffline {
		return NodeOffline
	}
	return NodeOnline
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

func validateAlertRuleInput(input AlertRuleInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return errors.New("告警规则名称必填")
	}
	return nil
}

func sortAlertEvents(events []AlertEvent) {
	sort.SliceStable(events, func(left, right int) bool {
		return events[left].CreatedAt > events[right].CreatedAt
	})
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
