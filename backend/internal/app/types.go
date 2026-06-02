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
	NodeID        string             `json:"nodeId,omitempty"`
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

type ChannelStatus string

const (
	ChannelStatusDraft    ChannelStatus = "draft"
	ChannelStatusReady    ChannelStatus = "ready"
	ChannelStatusRunning  ChannelStatus = "running"
	ChannelStatusWarning  ChannelStatus = "warning"
	ChannelStatusFailed   ChannelStatus = "failed"
	ChannelStatusStopped  ChannelStatus = "stopped"
	ChannelStatusArchived ChannelStatus = "archived"
)

type ChannelKind string

const (
	ChannelKindSync  ChannelKind = "sync"
	ChannelKindCheck ChannelKind = "check"
)

type ChannelTaskType string

const (
	ChannelTaskSchemaMigration ChannelTaskType = "schema_migration"
	ChannelTaskFullMigration   ChannelTaskType = "full_migration"
	ChannelTaskIncrementalSync ChannelTaskType = "incremental_sync"
	ChannelTaskSchemaCompare   ChannelTaskType = "schema_compare"
	ChannelTaskDataValidation  ChannelTaskType = "data_validation"
	ChannelTaskDataCorrection  ChannelTaskType = "data_correction"
)

type ChannelTaskStatus string

const (
	ChannelTaskDraft    ChannelTaskStatus = "draft"
	ChannelTaskReady    ChannelTaskStatus = "ready"
	ChannelTaskDisabled ChannelTaskStatus = "disabled"
	ChannelTaskQueued   ChannelTaskStatus = "queued"
	ChannelTaskRunning  ChannelTaskStatus = "running"
	ChannelTaskStopping ChannelTaskStatus = "stopping"
	ChannelTaskStopped  ChannelTaskStatus = "stopped"
	ChannelTaskSuccess  ChannelTaskStatus = "success"
	ChannelTaskFailed   ChannelTaskStatus = "failed"
	ChannelTaskCanceled ChannelTaskStatus = "canceled"
)

type TaskRunStatus string

const (
	TaskRunRunning  TaskRunStatus = "running"
	TaskRunStopped  TaskRunStatus = "stopped"
	TaskRunSuccess  TaskRunStatus = "success"
	TaskRunFailed   TaskRunStatus = "failed"
	TaskRunCanceled TaskRunStatus = "canceled"
)

type Channel struct {
	ID                   string         `json:"id"`
	Name                 string         `json:"name"`
	Description          string         `json:"description,omitempty"`
	SourceDatasourceID   string         `json:"sourceDatasourceId"`
	TargetDatasourceID   string         `json:"targetDatasourceId"`
	SourceDatasourceType DatasourceType `json:"sourceDatasourceType,omitempty"`
	TargetDatasourceType DatasourceType `json:"targetDatasourceType,omitempty"`
	RunNodeID            string         `json:"runNodeId,omitempty"`
	ResourceSpec         string         `json:"resourceSpec,omitempty"`
	Kind                 ChannelKind    `json:"kind,omitempty"`
	Status               ChannelStatus  `json:"status"`
	Owner                string         `json:"owner,omitempty"`
	Tags                 []string       `json:"tags"`
	MappingVersion       int            `json:"mappingVersion"`
	TaskCount            int            `json:"taskCount"`
	RunningTaskCount     int            `json:"runningTaskCount"`
	LastRunID            string         `json:"lastRunId,omitempty"`
	LastRunStatus        TaskRunStatus  `json:"lastRunStatus,omitempty"`
	CreatedAt            string         `json:"createdAt"`
	UpdatedAt            string         `json:"updatedAt"`
	ArchivedAt           string         `json:"archivedAt,omitempty"`
}

type ChannelInput struct {
	Name                 string         `json:"name"`
	Description          string         `json:"description,omitempty"`
	SourceDatasourceID   string         `json:"sourceDatasourceId"`
	TargetDatasourceID   string         `json:"targetDatasourceId"`
	SourceDatasourceType DatasourceType `json:"sourceDatasourceType,omitempty"`
	TargetDatasourceType DatasourceType `json:"targetDatasourceType,omitempty"`
	RunNodeID            string         `json:"runNodeId,omitempty"`
	ResourceSpec         string         `json:"resourceSpec,omitempty"`
	Kind                 ChannelKind    `json:"kind,omitempty"`
	Tags                 []string       `json:"tags,omitempty"`
}

type ChannelTableMapping struct {
	ID             string   `json:"id"`
	ChannelID      string   `json:"channelId"`
	MappingVersion int      `json:"mappingVersion"`
	SourceSchema   string   `json:"sourceSchema,omitempty"`
	SourceTable    string   `json:"sourceTable"`
	TargetSchema   string   `json:"targetSchema,omitempty"`
	TargetTable    string   `json:"targetTable"`
	PrimaryKeys    []string `json:"primaryKeys"`
	Enabled        bool     `json:"enabled"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
}

type ChannelColumnMapping struct {
	ID             string `json:"id"`
	ChannelID      string `json:"channelId"`
	TableMappingID string `json:"tableMappingId"`
	MappingVersion int    `json:"mappingVersion"`
	SourceColumn   string `json:"sourceColumn"`
	SourceType     string `json:"sourceType,omitempty"`
	TargetColumn   string `json:"targetColumn"`
	TargetType     string `json:"targetType,omitempty"`
	IsPrimaryKey   bool   `json:"isPrimaryKey"`
	Nullable       bool   `json:"nullable"`
	DefaultValue   string `json:"defaultValue,omitempty"`
	Enabled        bool   `json:"enabled"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
}

type ChannelColumnMappingInput struct {
	ID           string `json:"id,omitempty"`
	SourceColumn string `json:"sourceColumn"`
	SourceType   string `json:"sourceType,omitempty"`
	TargetColumn string `json:"targetColumn"`
	TargetType   string `json:"targetType,omitempty"`
	IsPrimaryKey bool   `json:"isPrimaryKey,omitempty"`
	Nullable     bool   `json:"nullable,omitempty"`
	DefaultValue string `json:"defaultValue,omitempty"`
	Enabled      *bool  `json:"enabled,omitempty"`
}

type ChannelTableMappingInput struct {
	ID           string                      `json:"id,omitempty"`
	SourceSchema string                      `json:"sourceSchema,omitempty"`
	SourceTable  string                      `json:"sourceTable"`
	TargetSchema string                      `json:"targetSchema,omitempty"`
	TargetTable  string                      `json:"targetTable"`
	PrimaryKeys  []string                    `json:"primaryKeys,omitempty"`
	Enabled      *bool                       `json:"enabled,omitempty"`
	Columns      []ChannelColumnMappingInput `json:"columns,omitempty"`
}

type ChannelMappingsInput struct {
	Tables []ChannelTableMappingInput `json:"tables"`
}

type ChannelMappingsResponse struct {
	ChannelID      string                 `json:"channelId"`
	MappingVersion int                    `json:"mappingVersion"`
	Tables         []ChannelTableMapping  `json:"tables"`
	Columns        []ChannelColumnMapping `json:"columns"`
}

type ChannelTask struct {
	ID             string            `json:"id"`
	ChannelID      string            `json:"channelId"`
	Name           string            `json:"name"`
	Type           ChannelTaskType   `json:"type"`
	Status         ChannelTaskStatus `json:"status"`
	Enabled        bool              `json:"enabled"`
	DependsOn      []string          `json:"dependsOn"`
	MappingVersion int               `json:"mappingVersion"`
	Config         map[string]string `json:"config"`
	LastRunID      string            `json:"lastRunId,omitempty"`
	LastRunStatus  TaskRunStatus     `json:"lastRunStatus,omitempty"`
	CreatedAt      string            `json:"createdAt"`
	UpdatedAt      string            `json:"updatedAt"`
}

type ChannelTaskInput struct {
	Name      string            `json:"name"`
	Type      ChannelTaskType   `json:"type"`
	Enabled   *bool             `json:"enabled,omitempty"`
	DependsOn []string          `json:"dependsOn,omitempty"`
	Config    map[string]string `json:"config,omitempty"`
}

type TaskRun struct {
	ID           string          `json:"id"`
	ChannelID    string          `json:"channelId"`
	TaskID       string          `json:"taskId"`
	TaskType     ChannelTaskType `json:"taskType"`
	Status       TaskRunStatus   `json:"status"`
	StartedAt    string          `json:"startedAt"`
	FinishedAt   string          `json:"finishedAt,omitempty"`
	ReadRows     int             `json:"readRows"`
	WrittenRows  int             `json:"writtenRows"`
	FailedRows   int             `json:"failedRows"`
	DiffRows     int             `json:"diffRows"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	CreatedBy    string          `json:"createdBy"`
}

type TaskLog struct {
	ID        string `json:"id"`
	ChannelID string `json:"channelId"`
	TaskID    string `json:"taskId,omitempty"`
	RunID     string `json:"runId,omitempty"`
	Level     string `json:"level"`
	Thread    string `json:"thread"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type ChannelPrecheckItem struct {
	Key     string `json:"key"`
	Label   string `json:"label"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

type ChannelPrecheckResult struct {
	Success   bool                  `json:"success"`
	CheckedAt string                `json:"checkedAt"`
	Items     []ChannelPrecheckItem `json:"items"`
}

type DataValidationDiff struct {
	ID               string `json:"id"`
	ChannelID        string `json:"channelId"`
	ValidationTaskID string `json:"validationTaskId"`
	ValidationRunID  string `json:"validationRunId"`
	TableMappingID   string `json:"tableMappingId"`
	SourceTable      string `json:"sourceTable"`
	TargetTable      string `json:"targetTable"`
	PrimaryKeyJSON   string `json:"primaryKeyJson"`
	DiffType         string `json:"diffType"`
	DiffColumnsJSON  string `json:"diffColumnsJson"`
	SourceDigest     string `json:"sourceDigest,omitempty"`
	TargetDigest     string `json:"targetDigest,omitempty"`
	CorrectionStatus string `json:"correctionStatus"`
	CorrectionTaskID string `json:"correctionTaskId,omitempty"`
	CorrectionRunID  string `json:"correctionRunId,omitempty"`
	CreatedAt        string `json:"createdAt"`
	UpdatedAt        string `json:"updatedAt"`
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

const (
	NodeRoleMaster  = "master"
	NodeRoleStandby = "standby"
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
	DiskPercent     int          `json:"diskPercent"`
	NetworkMBps     float64      `json:"networkThroughputMBps"`
	Capacity        int          `json:"capacity"`
	LastHeartbeatAt string       `json:"lastHeartbeatAt"`
	StartedAt       string       `json:"startedAt"`
	UpdatedAt       string       `json:"updatedAt"`
}

type ClusterNodeInput struct {
	ID            string  `json:"id,omitempty"`
	Name          string  `json:"name"`
	Endpoint      string  `json:"endpoint"`
	SSHPort       int     `json:"sshPort,omitempty"`
	SSHUser       string  `json:"sshUser,omitempty"`
	AuthMode      string  `json:"authMode,omitempty"`
	Password      string  `json:"password,omitempty"`
	PrivateKey    string  `json:"privateKey,omitempty"`
	InstallDir    string  `json:"installDir,omitempty"`
	Version       string  `json:"version,omitempty"`
	Zone          string  `json:"zone,omitempty"`
	Role          string  `json:"role,omitempty"`
	Capacity      int     `json:"capacity,omitempty"`
	CPUPercent    int     `json:"cpuPercent,omitempty"`
	MemoryPercent int     `json:"memoryPercent,omitempty"`
	DiskPercent   int     `json:"diskPercent,omitempty"`
	NetworkMBps   float64 `json:"networkThroughputMBps,omitempty"`
}

type NodeMetricSample struct {
	NodeID        string  `json:"nodeId"`
	CollectedAt   string  `json:"collectedAt"`
	CPUPercent    int     `json:"cpuPercent"`
	MemoryPercent int     `json:"memoryPercent"`
	DiskPercent   int     `json:"diskPercent"`
	NetworkMBps   float64 `json:"networkThroughputMBps"`
}

type NodeMetricHistoryResponse struct {
	NodeID      string             `json:"nodeId"`
	Range       string             `json:"range"`
	GeneratedAt string             `json:"generatedAt"`
	Samples     []NodeMetricSample `json:"samples"`
}

type ClusterNodeNameInput struct {
	Name string `json:"name"`
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
	MasterNodeID            string        `json:"masterNodeId,omitempty"`
	MasterNodeName          string        `json:"masterNodeName,omitempty"`
	MasterNodeCount         int           `json:"masterNodeCount"`
	OnlineNodes             int           `json:"onlineNodes"`
	TotalNodes              int           `json:"totalNodes"`
	DegradedNodes           int           `json:"degradedNodes"`
	HeartbeatTimeoutSeconds int           `json:"heartbeatTimeoutSeconds"`
}

type ClusterSettings struct {
	ID              string `json:"id"`
	MasterNodeCount int    `json:"masterNodeCount"`
	UpdatedAt       string `json:"updatedAt"`
}

type ClusterMasterNodeCountInput struct {
	MasterNodeCount int `json:"masterNodeCount"`
}

type DatabaseShape struct {
	Users                 []User                 `json:"users"`
	Datasources           []Datasource           `json:"datasources"`
	Channels              []Channel              `json:"channels"`
	ChannelTableMappings  []ChannelTableMapping  `json:"channelTableMappings"`
	ChannelColumnMappings []ChannelColumnMapping `json:"channelColumnMappings"`
	ChannelTasks          []ChannelTask          `json:"channelTasks"`
	TaskRuns              []TaskRun              `json:"taskRuns"`
	TaskLogs              []TaskLog              `json:"taskLogs"`
	DataValidationDiffs   []DataValidationDiff   `json:"dataValidationDiffs"`
	OperationLogs         []OperationLog         `json:"operationLogs"`
	AlertRules            []AlertRule            `json:"alertRules"`
	AlertEvents           []AlertEvent           `json:"alertEvents"`
	Nodes                 []ClusterNode          `json:"nodes"`
	ClusterSettings       ClusterSettings        `json:"clusterSettings"`
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
