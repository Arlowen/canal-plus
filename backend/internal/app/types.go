package app

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
	RoleReadonly Role = "readonly"
)

type DatasourceStatus string

const (
	DatasourceUntested  DatasourceStatus = "untested"
	DatasourceAvailable DatasourceStatus = "available"
	DatasourceFailed    DatasourceStatus = "failed"
	DatasourceStale     DatasourceStatus = "stale"
)

type DatasourceType string

const (
	DatasourceTypeMySQL DatasourceType = "mysql"
)

type DatasourcePurpose string

const (
	DatasourcePurposeSource  DatasourcePurpose = "source"
	DatasourcePurposeTarget  DatasourcePurpose = "target"
	DatasourcePurposeGeneral DatasourcePurpose = "general"
)

type DatasourceAuthType string

const (
	DatasourceAuthPassword DatasourceAuthType = "password"
	DatasourceAuthNone     DatasourceAuthType = "none"
)

type User struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Username     string `json:"username"`
	Role         Role   `json:"role"`
	PasswordHash string `json:"passwordHash"`
	CreatedAt    string `json:"createdAt"`
}

type PublicUser struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Username string `json:"username"`
	Role     Role   `json:"role"`
}

type Datasource struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Type              DatasourceType    `json:"type"`
	Purpose           DatasourcePurpose `json:"purpose,omitempty"`
	Host              string            `json:"host"`
	Port              int               `json:"port"`
	Version           string            `json:"version,omitempty"`
	Username          string            `json:"username"`
	PasswordSecret    string            `json:"passwordSecret"`
	DefaultSchema     string            `json:"defaultSchema,omitempty"`
	Remark            string            `json:"remark,omitempty"`
	ConnectionStatus  DatasourceStatus  `json:"connectionStatus"`
	LastTestedAt      string            `json:"lastTestedAt,omitempty"`
	LastTestMessage   string            `json:"lastTestMessage,omitempty"`
	LastTestLatencyMS int               `json:"lastTestLatencyMs,omitempty"`
	IsDemo            bool              `json:"isDemo"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
}

type PublicDatasource struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Type              DatasourceType    `json:"type"`
	Purpose           DatasourcePurpose `json:"purpose,omitempty"`
	Host              string            `json:"host"`
	Port              int               `json:"port"`
	Version           string            `json:"version,omitempty"`
	Username          string            `json:"username"`
	DefaultSchema     string            `json:"defaultSchema,omitempty"`
	Remark            string            `json:"remark,omitempty"`
	ConnectionStatus  DatasourceStatus  `json:"connectionStatus"`
	LastTestedAt      string            `json:"lastTestedAt,omitempty"`
	LastTestMessage   string            `json:"lastTestMessage,omitempty"`
	LastTestLatencyMS int               `json:"lastTestLatencyMs,omitempty"`
	HasPassword       bool              `json:"hasPassword"`
	IsDemo            bool              `json:"isDemo"`
	CreatedAt         string            `json:"createdAt"`
	UpdatedAt         string            `json:"updatedAt"`
}

type DatasourceInput struct {
	ID            string             `json:"id,omitempty"`
	Name          string             `json:"name"`
	Type          DatasourceType     `json:"type"`
	Purpose       DatasourcePurpose  `json:"purpose,omitempty"`
	AuthType      DatasourceAuthType `json:"authType,omitempty"`
	Host          string             `json:"host"`
	Port          int                `json:"port"`
	Username      string             `json:"username"`
	Password      string             `json:"password,omitempty"`
	DefaultSchema string             `json:"defaultSchema,omitempty"`
	Remark        string             `json:"remark,omitempty"`
}

type DatasourceTestResult struct {
	Success   bool             `json:"success"`
	Status    DatasourceStatus `json:"status"`
	Version   string           `json:"version,omitempty"`
	LatencyMS int              `json:"latencyMs"`
	TestedAt  string           `json:"testedAt"`
	Message   string           `json:"message"`
}

type DatasourceTestRequest struct {
	NodeID string `json:"nodeId,omitempty"`
}

type OperationLog struct {
	ID         string `json:"id"`
	Actor      string `json:"actor"`
	Action     string `json:"action"`
	TargetType string `json:"targetType"`
	TargetID   string `json:"targetId,omitempty"`
	Detail     string `json:"detail"`
	CreatedAt  string `json:"createdAt"`
}

type AlertRule struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	WebhookURL string `json:"webhookUrl,omitempty"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type AlertRuleInput struct {
	Name       string `json:"name"`
	Enabled    *bool  `json:"enabled,omitempty"`
	WebhookURL string `json:"webhookUrl,omitempty"`
}

type AlertRuleEvaluation struct {
	RuleID    string   `json:"ruleId"`
	RuleName  string   `json:"ruleName"`
	Triggered bool     `json:"triggered"`
	Reasons   []string `json:"reasons"`
	UpdatedAt string   `json:"updatedAt"`
}

type AlertEventStatus string

const (
	AlertEventTriggered AlertEventStatus = "triggered"
	AlertEventRecovered AlertEventStatus = "recovered"
)

type AlertNotificationStatus string

const (
	AlertNotificationSkipped  AlertNotificationStatus = "skipped"
	AlertNotificationRecorded AlertNotificationStatus = "recorded"
)

type AlertEvent struct {
	ID                 string                  `json:"id"`
	RuleID             string                  `json:"ruleId"`
	RuleName           string                  `json:"ruleName"`
	Status             AlertEventStatus        `json:"status"`
	Reasons            []string                `json:"reasons"`
	NotificationStatus AlertNotificationStatus `json:"notificationStatus"`
	NotificationTarget string                  `json:"notificationTarget,omitempty"`
	Message            string                  `json:"message"`
	CreatedAt          string                  `json:"createdAt"`
}

type NodeStatus string

const (
	NodeOnline  NodeStatus = "online"
	NodeOffline NodeStatus = "offline"
)

type NodeAuthMode string

const (
	NodeAuthPassword   NodeAuthMode = "password"
	NodeAuthPrivateKey NodeAuthMode = "private_key"
)

type ClusterNode struct {
	ID              string       `json:"id"`
	Name            string       `json:"name"`
	Endpoint        string       `json:"endpoint"`
	SSHPort         int          `json:"sshPort"`
	SSHUser         string       `json:"sshUser"`
	AuthMode        NodeAuthMode `json:"authMode"`
	InstallDir      string       `json:"installDir"`
	Version         string       `json:"version"`
	Zone            string       `json:"zone"`
	Status          NodeStatus   `json:"status"`
	Role            string       `json:"role"`
	CPUPercent      int          `json:"cpuPercent"`
	MemoryPercent   int          `json:"memoryPercent"`
	Capacity        int          `json:"capacity"`
	LastHeartbeatAt string       `json:"lastHeartbeatAt"`
	StartedAt       string       `json:"startedAt"`
	UpdatedAt       string       `json:"updatedAt"`
}

type ClusterNodeInput struct {
	ID            string `json:"id,omitempty"`
	Name          string `json:"name"`
	Endpoint      string `json:"endpoint"`
	SSHPort       int    `json:"sshPort,omitempty"`
	SSHUser       string `json:"sshUser,omitempty"`
	AuthMode      string `json:"authMode,omitempty"`
	Password      string `json:"password,omitempty"`
	PrivateKey    string `json:"privateKey,omitempty"`
	InstallDir    string `json:"installDir,omitempty"`
	Version       string `json:"version,omitempty"`
	Zone          string `json:"zone,omitempty"`
	Role          string `json:"role,omitempty"`
	Capacity      int    `json:"capacity,omitempty"`
	CPUPercent    int    `json:"cpuPercent,omitempty"`
	MemoryPercent int    `json:"memoryPercent,omitempty"`
}

type NodeOperationStep struct {
	Key    string `json:"key"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type NodeOperationResult struct {
	Action        string              `json:"action"`
	Success       bool                `json:"success"`
	Message       string              `json:"message"`
	FinishedAt    string              `json:"finishedAt"`
	Node          *ClusterNode        `json:"node,omitempty"`
	RemovedNodeID string              `json:"removedNodeId,omitempty"`
	Before        *ClusterSnapshot    `json:"before,omitempty"`
	After         *ClusterSnapshot    `json:"after,omitempty"`
	Steps         []NodeOperationStep `json:"steps"`
}

type NodeStatusChangeResult struct {
	ID        string          `json:"id"`
	Action    string          `json:"action"`
	Node      ClusterNode     `json:"node"`
	Success   bool            `json:"success"`
	Message   string          `json:"message"`
	Before    ClusterSnapshot `json:"before"`
	After     ClusterSnapshot `json:"after"`
	ChangedAt string          `json:"changedAt"`
}

type ClusterSnapshot struct {
	Nodes                   []ClusterNode `json:"nodes"`
	LocalNodeID             string        `json:"localNodeId,omitempty"`
	LocalNodeName           string        `json:"localNodeName,omitempty"`
	OnlineNodes             int           `json:"onlineNodes"`
	TotalNodes              int           `json:"totalNodes"`
	DegradedNodes           int           `json:"degradedNodes"`
	HeartbeatTimeoutSeconds int           `json:"heartbeatTimeoutSeconds"`
}

type DatabaseShape struct {
	Users         []User         `json:"users"`
	Datasources   []Datasource   `json:"datasources"`
	OperationLogs []OperationLog `json:"operationLogs"`
	AlertRules    []AlertRule    `json:"alertRules"`
	AlertEvents   []AlertEvent   `json:"alertEvents"`
	Nodes         []ClusterNode  `json:"nodes"`
}

type RuntimeConfig struct {
	BackendPort                      string   `json:"backendPort"`
	FrontendOrigins                  []string `json:"frontendOrigins"`
	StorageBackend                   string   `json:"storageBackend"`
	StorageLocation                  string   `json:"storageLocation"`
	LocalNodeID                      string   `json:"localNodeId"`
	ClusterSupervisorEnabled         bool     `json:"clusterSupervisorEnabled"`
	ClusterSupervisorIntervalSeconds int      `json:"clusterSupervisorIntervalSeconds"`
	EmbeddedHeartbeatEnabled         bool     `json:"embeddedHeartbeatEnabled"`
	EmbeddedHeartbeatIntervalSeconds int      `json:"embeddedHeartbeatIntervalSeconds"`
}
