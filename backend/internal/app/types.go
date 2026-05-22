package app

type Role string

const (
	RoleAdmin    Role = "admin"
	RoleOperator Role = "operator"
)

type DatasourcePurpose string

const (
	PurposeSource DatasourcePurpose = "source"
	PurposeTarget DatasourcePurpose = "target"
	PurposeBoth   DatasourcePurpose = "both"
)

type DatasourceStatus string

const (
	DatasourceUntested DatasourceStatus = "untested"
	DatasourceOnline   DatasourceStatus = "online"
	DatasourceOffline  DatasourceStatus = "offline"
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
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Purpose          DatasourcePurpose `json:"purpose"`
	Host             string            `json:"host"`
	Port             int               `json:"port"`
	Username         string            `json:"username"`
	PasswordSecret   string            `json:"passwordSecret"`
	DefaultSchema    string            `json:"defaultSchema,omitempty"`
	ConnectionStatus DatasourceStatus  `json:"connectionStatus"`
	LastTestedAt     string            `json:"lastTestedAt,omitempty"`
	LastTestMessage  string            `json:"lastTestMessage,omitempty"`
	IsDemo           bool              `json:"isDemo"`
	CreatedAt        string            `json:"createdAt"`
	UpdatedAt        string            `json:"updatedAt"`
}

type PublicDatasource struct {
	ID               string            `json:"id"`
	Name             string            `json:"name"`
	Purpose          DatasourcePurpose `json:"purpose"`
	Host             string            `json:"host"`
	Port             int               `json:"port"`
	Username         string            `json:"username"`
	DefaultSchema    string            `json:"defaultSchema,omitempty"`
	ConnectionStatus DatasourceStatus  `json:"connectionStatus"`
	LastTestedAt     string            `json:"lastTestedAt,omitempty"`
	LastTestMessage  string            `json:"lastTestMessage,omitempty"`
	HasPassword      bool              `json:"hasPassword"`
	IsDemo           bool              `json:"isDemo"`
	CreatedAt        string            `json:"createdAt"`
	UpdatedAt        string            `json:"updatedAt"`
}

type TableColumn struct {
	Name         string  `json:"name"`
	Type         string  `json:"type"`
	Nullable     bool    `json:"nullable"`
	PrimaryKey   bool    `json:"primaryKey"`
	DefaultValue *string `json:"defaultValue,omitempty"`
}

type TableInfo struct {
	Schema  string        `json:"schema"`
	Name    string        `json:"name"`
	Engine  string        `json:"engine,omitempty"`
	Rows    int64         `json:"rows,omitempty"`
	Columns []TableColumn `json:"columns,omitempty"`
}

type FieldMapping struct {
	SourceField   string `json:"sourceField"`
	TargetField   string `json:"targetField"`
	SourceType    string `json:"sourceType"`
	TargetType    string `json:"targetType"`
	PrimaryKey    bool   `json:"primaryKey"`
	Nullable      bool   `json:"nullable"`
	Ignored       bool   `json:"ignored"`
	ConstantValue string `json:"constantValue,omitempty"`
}

type TableMapping struct {
	ID           string         `json:"id,omitempty"`
	SourceSchema string         `json:"sourceSchema"`
	SourceTable  string         `json:"sourceTable"`
	TargetSchema string         `json:"targetSchema"`
	TargetTable  string         `json:"targetTable"`
	Fields       []FieldMapping `json:"fields"`
}

type TaskStatus string

const (
	TaskDraft              TaskStatus = "draft"
	TaskPending            TaskStatus = "pending"
	TaskFullSyncing        TaskStatus = "full_syncing"
	TaskIncrementalRunning TaskStatus = "incremental_running"
	TaskPaused             TaskStatus = "paused"
	TaskFailed             TaskStatus = "failed"
	TaskStopped            TaskStatus = "stopped"
)

type SyncStrategy struct {
	InitMode  string `json:"initMode"`
	WriteMode struct {
		Insert bool `json:"insert"`
		Update bool `json:"update"`
		Delete bool `json:"delete"`
	} `json:"writeMode"`
	ConflictStrategy     string `json:"conflictStrategy"`
	DeleteStrategy       string `json:"deleteStrategy"`
	BatchSize            int    `json:"batchSize"`
	RetryTimes           int    `json:"retryTimes"`
	RetryIntervalSeconds int    `json:"retryIntervalSeconds"`
}

type SyncTask struct {
	ID                 string         `json:"id"`
	Name               string         `json:"name"`
	Description        string         `json:"description"`
	Owner              string         `json:"owner"`
	SourceDatasourceID string         `json:"sourceDatasourceId"`
	TargetDatasourceID string         `json:"targetDatasourceId"`
	Status             TaskStatus     `json:"status"`
	TableMappings      []TableMapping `json:"tableMappings"`
	Strategy           SyncStrategy   `json:"strategy"`
	ConfigVersion      int            `json:"configVersion"`
	CreatedAt          string         `json:"createdAt"`
	UpdatedAt          string         `json:"updatedAt"`
}

type TaskResponse struct {
	SyncTask
	Runtime          TaskRuntimeState  `json:"runtime"`
	SourceDatasource *PublicDatasource `json:"sourceDatasource,omitempty"`
	TargetDatasource *PublicDatasource `json:"targetDatasource,omitempty"`
}

type TaskRuntimeState struct {
	TaskID          string `json:"taskId"`
	Phase           string `json:"phase"`
	FullTotalRows   int64  `json:"fullTotalRows"`
	FullSyncedRows  int64  `json:"fullSyncedRows"`
	DelaySeconds    int    `json:"delaySeconds"`
	EventsPerSecond int    `json:"eventsPerSecond"`
	BinlogFile      string `json:"binlogFile"`
	BinlogPosition  int64  `json:"binlogPosition"`
	NodeID          string `json:"nodeId,omitempty"`
	LeaseExpiresAt  string `json:"leaseExpiresAt,omitempty"`
	FailoverCount   int    `json:"failoverCount"`
	LastTakeoverAt  string `json:"lastTakeoverAt,omitempty"`
	StartedAt       string `json:"startedAt,omitempty"`
	UpdatedAt       string `json:"updatedAt"`
	LastErrorID     string `json:"lastErrorId,omitempty"`
}

type ErrorStatus string

const (
	ErrorPending  ErrorStatus = "pending"
	ErrorRetried  ErrorStatus = "retried"
	ErrorSkipped  ErrorStatus = "skipped"
	ErrorResolved ErrorStatus = "resolved"
)

type ErrorEvent struct {
	ID              string      `json:"id"`
	TaskID          string      `json:"taskId"`
	SourceTable     string      `json:"sourceTable"`
	TargetTable     string      `json:"targetTable"`
	EventType       string      `json:"eventType"`
	PrimaryKeyValue string      `json:"primaryKeyValue"`
	Reason          string      `json:"reason"`
	RawEventSummary string      `json:"rawEventSummary"`
	Status          ErrorStatus `json:"status"`
	BinlogFile      string      `json:"binlogFile"`
	BinlogPosition  int64       `json:"binlogPosition"`
	CreatedAt       string      `json:"createdAt"`
	UpdatedAt       string      `json:"updatedAt"`
	HandledBy       string      `json:"handledBy,omitempty"`
	HandledReason   string      `json:"handledReason,omitempty"`
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
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	Enabled               bool   `json:"enabled"`
	TaskID                string `json:"taskId,omitempty"`
	DelayThresholdSeconds int    `json:"delayThresholdSeconds"`
	ErrorThreshold        int    `json:"errorThreshold"`
	WebhookURL            string `json:"webhookUrl,omitempty"`
	CreatedAt             string `json:"createdAt"`
	UpdatedAt             string `json:"updatedAt"`
}

type CapabilityJobType string

const (
	CapabilityStructure    CapabilityJobType = "structure"
	CapabilityQuality      CapabilityJobType = "quality"
	CapabilitySubscription CapabilityJobType = "subscription"
)

type CapabilityJobStatus string

const (
	CapabilityDraft     CapabilityJobStatus = "draft"
	CapabilityRunning   CapabilityJobStatus = "running"
	CapabilityCompleted CapabilityJobStatus = "completed"
	CapabilityFailed    CapabilityJobStatus = "failed"
)

type CapabilityStep struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail string `json:"detail"`
}

type CapabilityJobSummary struct {
	Tables        int    `json:"tables"`
	Columns       int    `json:"columns"`
	DDLCount      int    `json:"ddlCount"`
	DiffRows      int    `json:"diffRows"`
	CorrectedRows int    `json:"correctedRows"`
	AddedTables   int    `json:"addedTables"`
	RemovedTables int    `json:"removedTables"`
	RiskLevel     string `json:"riskLevel"`
}

type CapabilityJob struct {
	ID              string               `json:"id"`
	Type            CapabilityJobType    `json:"type"`
	Name            string               `json:"name"`
	TaskID          string               `json:"taskId"`
	Mode            string               `json:"mode"`
	Status          CapabilityJobStatus  `json:"status"`
	ProgressPercent int                  `json:"progressPercent"`
	CurrentStep     int                  `json:"currentStep"`
	Steps           []CapabilityStep     `json:"steps"`
	Summary         CapabilityJobSummary `json:"summary"`
	Schedule        string               `json:"schedule,omitempty"`
	AutoStart       bool                 `json:"autoStart"`
	CreatedAt       string               `json:"createdAt"`
	UpdatedAt       string               `json:"updatedAt"`
}

type NodeStatus string

const (
	NodeOnline   NodeStatus = "online"
	NodeOffline  NodeStatus = "offline"
	NodeDraining NodeStatus = "draining"
)

type ClusterNode struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Endpoint        string     `json:"endpoint"`
	Zone            string     `json:"zone"`
	Status          NodeStatus `json:"status"`
	Role            string     `json:"role"`
	CPUPercent      int        `json:"cpuPercent"`
	MemoryPercent   int        `json:"memoryPercent"`
	RunningTasks    int        `json:"runningTasks"`
	Capacity        int        `json:"capacity"`
	LastHeartbeatAt string     `json:"lastHeartbeatAt"`
	StartedAt       string     `json:"startedAt"`
	UpdatedAt       string     `json:"updatedAt"`
}

type TaskLease struct {
	TaskID        string `json:"taskId"`
	NodeID        string `json:"nodeId"`
	Epoch         int    `json:"epoch"`
	Status        string `json:"status"`
	AcquiredAt    string `json:"acquiredAt"`
	ExpiresAt     string `json:"expiresAt"`
	TakeoverCount int    `json:"takeoverCount"`
	UpdatedAt     string `json:"updatedAt"`
}

type ClusterSnapshot struct {
	Nodes                   []ClusterNode `json:"nodes"`
	Leases                  []TaskLease   `json:"leases"`
	OnlineNodes             int           `json:"onlineNodes"`
	TotalNodes              int           `json:"totalNodes"`
	DegradedNodes           int           `json:"degradedNodes"`
	Failovers               int           `json:"failovers"`
	HeartbeatTimeoutSeconds int           `json:"heartbeatTimeoutSeconds"`
}

type DatabaseShape struct {
	Users          []User             `json:"users"`
	Datasources    []Datasource       `json:"datasources"`
	SyncTasks      []SyncTask         `json:"syncTasks"`
	RuntimeStates  []TaskRuntimeState `json:"runtimeStates"`
	ErrorEvents    []ErrorEvent       `json:"errorEvents"`
	OperationLogs  []OperationLog     `json:"operationLogs"`
	AlertRules     []AlertRule        `json:"alertRules"`
	CapabilityJobs []CapabilityJob    `json:"capabilityJobs"`
	Nodes          []ClusterNode      `json:"nodes"`
	TaskLeases     []TaskLease        `json:"taskLeases"`
}

type DashboardSummary struct {
	TaskTotal           int `json:"taskTotal"`
	RunningTasks        int `json:"runningTasks"`
	FailedTasks         int `json:"failedTasks"`
	AverageDelaySeconds int `json:"averageDelaySeconds"`
	EventsPerSecond     int `json:"eventsPerSecond"`
	FailuresLast24Hours int `json:"failuresLast24Hours"`
	FullSyncProgress    int `json:"fullSyncProgress"`
	OnlineNodes         int `json:"onlineNodes"`
	TotalNodes          int `json:"totalNodes"`
	FailoverCount       int `json:"failoverCount"`
}
