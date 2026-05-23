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
	ID               string         `json:"id,omitempty"`
	SourceSchema     string         `json:"sourceSchema"`
	SourceTable      string         `json:"sourceTable"`
	TargetSchema     string         `json:"targetSchema"`
	TargetTable      string         `json:"targetTable"`
	Fields           []FieldMapping `json:"fields"`
	EventActions     []string       `json:"eventActions,omitempty"`
	FilterExpression string         `json:"filterExpression,omitempty"`
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
	TaskID             string `json:"taskId"`
	Phase              string `json:"phase"`
	FullTotalRows      int64  `json:"fullTotalRows"`
	FullSyncedRows     int64  `json:"fullSyncedRows"`
	DelaySeconds       int    `json:"delaySeconds"`
	EventsPerSecond    int    `json:"eventsPerSecond"`
	BinlogFile         string `json:"binlogFile"`
	BinlogPosition     int64  `json:"binlogPosition"`
	NodeID             string `json:"nodeId,omitempty"`
	LeaseExpiresAt     string `json:"leaseExpiresAt,omitempty"`
	FailoverCount      int    `json:"failoverCount"`
	LastTakeoverAt     string `json:"lastTakeoverAt,omitempty"`
	StartedAt          string `json:"startedAt,omitempty"`
	UpdatedAt          string `json:"updatedAt"`
	LastErrorID        string `json:"lastErrorId,omitempty"`
	ProcessStatus      string `json:"processStatus,omitempty"`
	ProcessID          int    `json:"processId,omitempty"`
	ProcessStartedAt   string `json:"processStartedAt,omitempty"`
	ProcessStoppedAt   string `json:"processStoppedAt,omitempty"`
	LastHeartbeatAt    string `json:"lastHeartbeatAt,omitempty"`
	LastLogAt          string `json:"lastLogAt,omitempty"`
	LastLogMessage     string `json:"lastLogMessage,omitempty"`
	ExitCode           *int   `json:"exitCode,omitempty"`
	ManagedByLocalNode bool   `json:"managedByLocalNode,omitempty"`
	LocalLogAccessible bool   `json:"localLogAccessible,omitempty"`
	ExecutionNodeName  string `json:"executionNodeName,omitempty"`
	LogAccessMessage   string `json:"logAccessMessage,omitempty"`
}

type TaskLogEntry struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	NodeID    string `json:"nodeId,omitempty"`
	ProcessID int    `json:"processId,omitempty"`
	Level     string `json:"level"`
	Phase     string `json:"phase,omitempty"`
	Message   string `json:"message"`
	CreatedAt string `json:"createdAt"`
}

type TaskOperationResult struct {
	Task    TaskResponse      `json:"task"`
	Message string            `json:"message"`
	Meta    map[string]string `json:"meta,omitempty"`
}

type TaskExport struct {
	ExportedAt string           `json:"exportedAt"`
	Task       TaskResponse     `json:"task"`
	Runtime    TaskRuntimeState `json:"runtime"`
	Checksum   string           `json:"checksum"`
}

type TaskRevision struct {
	ID         string   `json:"id"`
	TaskID     string   `json:"taskId"`
	Version    int      `json:"version"`
	ChangeType string   `json:"changeType"`
	Summary    string   `json:"summary"`
	Actor      string   `json:"actor"`
	Snapshot   SyncTask `json:"snapshot"`
	CreatedAt  string   `json:"createdAt"`
}

type TaskCheckpoint struct {
	ID              string `json:"id"`
	TaskID          string `json:"taskId"`
	Phase           string `json:"phase"`
	BinlogFile      string `json:"binlogFile"`
	BinlogPosition  int64  `json:"binlogPosition"`
	NodeID          string `json:"nodeId,omitempty"`
	PreviousNodeID  string `json:"previousNodeId,omitempty"`
	LeaseEpoch      int    `json:"leaseEpoch"`
	TakeoverCount   int    `json:"takeoverCount"`
	EventsPerSecond int    `json:"eventsPerSecond"`
	DelaySeconds    int    `json:"delaySeconds"`
	Reason          string `json:"reason"`
	CreatedAt       string `json:"createdAt"`
}

type PreflightStatus string

const (
	PreflightPassed  PreflightStatus = "passed"
	PreflightWarning PreflightStatus = "warning"
	PreflightFailed  PreflightStatus = "failed"
)

type TaskPreflightCheck struct {
	ID       string          `json:"id"`
	Category string          `json:"category"`
	Title    string          `json:"title"`
	Status   PreflightStatus `json:"status"`
	Message  string          `json:"message"`
	Detail   []string        `json:"detail,omitempty"`
}

type TaskPreflightSummary struct {
	Passed   int `json:"passed"`
	Warnings int `json:"warnings"`
	Failed   int `json:"failed"`
}

type TaskPreflightReport struct {
	OK            bool                 `json:"ok"`
	Score         int                  `json:"score"`
	GeneratedAt   string               `json:"generatedAt"`
	EstimatedRows int64                `json:"estimatedRows"`
	Summary       TaskPreflightSummary `json:"summary"`
	Checks        []TaskPreflightCheck `json:"checks"`
}

type WriteModePatch struct {
	Insert *bool `json:"insert,omitempty"`
	Update *bool `json:"update,omitempty"`
	Delete *bool `json:"delete,omitempty"`
}

type TaskParameterPatch struct {
	InitMode             string          `json:"initMode,omitempty"`
	WriteMode            *WriteModePatch `json:"writeMode,omitempty"`
	ConflictStrategy     string          `json:"conflictStrategy,omitempty"`
	DeleteStrategy       string          `json:"deleteStrategy,omitempty"`
	BatchSize            *int            `json:"batchSize,omitempty"`
	RetryTimes           *int            `json:"retryTimes,omitempty"`
	RetryIntervalSeconds *int            `json:"retryIntervalSeconds,omitempty"`
}

type PositionResetInput struct {
	BinlogFile     string `json:"binlogFile"`
	BinlogPosition int64  `json:"binlogPosition"`
	ServerID       string `json:"serverId,omitempty"`
	Reason         string `json:"reason,omitempty"`
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

type AlertRuleInput struct {
	Name                  string `json:"name"`
	Enabled               *bool  `json:"enabled,omitempty"`
	TaskID                string `json:"taskId,omitempty"`
	DelayThresholdSeconds int    `json:"delayThresholdSeconds"`
	ErrorThreshold        int    `json:"errorThreshold"`
	WebhookURL            string `json:"webhookUrl,omitempty"`
}

type AlertRuleEvaluation struct {
	RuleID          string   `json:"ruleId"`
	RuleName        string   `json:"ruleName"`
	Triggered       bool     `json:"triggered"`
	MatchedTasks    int      `json:"matchedTasks"`
	MaxDelaySeconds int      `json:"maxDelaySeconds"`
	PendingErrors   int      `json:"pendingErrors"`
	Reasons         []string `json:"reasons"`
	UpdatedAt       string   `json:"updatedAt"`
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
	MatchedTasks       int                     `json:"matchedTasks"`
	MaxDelaySeconds    int                     `json:"maxDelaySeconds"`
	PendingErrors      int                     `json:"pendingErrors"`
	Reasons            []string                `json:"reasons"`
	NotificationStatus AlertNotificationStatus `json:"notificationStatus"`
	NotificationTarget string                  `json:"notificationTarget,omitempty"`
	Message            string                  `json:"message"`
	CreatedAt          string                  `json:"createdAt"`
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

type StructureDDLStatus string

const (
	StructureDDLPending StructureDDLStatus = "pending"
	StructureDDLApplied StructureDDLStatus = "applied"
)

type StructureDDL struct {
	ID            string             `json:"id"`
	JobID         string             `json:"jobId"`
	TaskID        string             `json:"taskId"`
	SourceObject  string             `json:"sourceObject"`
	TargetObject  string             `json:"targetObject"`
	ObjectType    string             `json:"objectType"`
	ChangeType    string             `json:"changeType"`
	Statement     string             `json:"statement"`
	RiskLevel     string             `json:"riskLevel"`
	Status        StructureDDLStatus `json:"status"`
	CreatedAt     string             `json:"createdAt"`
	UpdatedAt     string             `json:"updatedAt"`
	AppliedAt     string             `json:"appliedAt,omitempty"`
	AppliedBy     string             `json:"appliedBy,omitempty"`
	HandledReason string             `json:"handledReason,omitempty"`
}

type StructureDDLApplyInput struct {
	IDs    []string `json:"ids,omitempty"`
	Reason string   `json:"reason,omitempty"`
}

type QualityDiffStatus string

const (
	QualityDiffPending   QualityDiffStatus = "pending"
	QualityDiffCorrected QualityDiffStatus = "corrected"
)

type QualityDiff struct {
	ID            string            `json:"id"`
	JobID         string            `json:"jobId"`
	TaskID        string            `json:"taskId"`
	SourceTable   string            `json:"sourceTable"`
	TargetTable   string            `json:"targetTable"`
	PrimaryKey    string            `json:"primaryKey"`
	DiffType      string            `json:"diffType"`
	FieldName     string            `json:"fieldName"`
	SourceValue   string            `json:"sourceValue"`
	TargetValue   string            `json:"targetValue"`
	Severity      string            `json:"severity"`
	Status        QualityDiffStatus `json:"status"`
	CorrectionSQL string            `json:"correctionSql"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
	CorrectedAt   string            `json:"correctedAt,omitempty"`
	CorrectedBy   string            `json:"correctedBy,omitempty"`
	HandledReason string            `json:"handledReason,omitempty"`
}

type QualityDiffCorrectionInput struct {
	IDs    []string `json:"ids,omitempty"`
	Reason string   `json:"reason,omitempty"`
}

type SubscriptionChangeStatus string

const (
	SubscriptionChangePending SubscriptionChangeStatus = "pending"
	SubscriptionChangeApplied SubscriptionChangeStatus = "applied"
)

type SubscriptionChange struct {
	ID            string                   `json:"id"`
	JobID         string                   `json:"jobId"`
	TaskID        string                   `json:"taskId"`
	ChangeType    string                   `json:"changeType"`
	SourceObject  string                   `json:"sourceObject"`
	TargetObject  string                   `json:"targetObject"`
	BeforeActions []string                 `json:"beforeActions,omitempty"`
	AfterActions  []string                 `json:"afterActions,omitempty"`
	BeforeFilter  string                   `json:"beforeFilter,omitempty"`
	AfterFilter   string                   `json:"afterFilter,omitempty"`
	FieldCount    int                      `json:"fieldCount"`
	RiskLevel     string                   `json:"riskLevel"`
	Status        SubscriptionChangeStatus `json:"status"`
	ResultMessage string                   `json:"resultMessage,omitempty"`
	CreatedAt     string                   `json:"createdAt"`
	UpdatedAt     string                   `json:"updatedAt"`
	AppliedAt     string                   `json:"appliedAt,omitempty"`
	AppliedBy     string                   `json:"appliedBy,omitempty"`
	HandledReason string                   `json:"handledReason,omitempty"`
}

type NodeStatus string

const (
	NodeOnline   NodeStatus = "online"
	NodeOffline  NodeStatus = "offline"
	NodeDraining NodeStatus = "draining"
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
	RunningTasks    int          `json:"runningTasks"`
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

type NodeConnectionTestResult struct {
	Success   bool   `json:"success"`
	Message   string `json:"message"`
	CheckedAt string `json:"checkedAt"`
	LatencyMS int    `json:"latencyMs"`
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
	AffectedTasks []FailoverDrillTask `json:"affectedTasks,omitempty"`
	Before        *ClusterSnapshot    `json:"before,omitempty"`
	After         *ClusterSnapshot    `json:"after,omitempty"`
	Steps         []NodeOperationStep `json:"steps"`
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

type FailoverDrillTask struct {
	TaskID                  string `json:"taskId"`
	TaskName                string `json:"taskName"`
	PreviousNodeID          string `json:"previousNodeId"`
	NewNodeID               string `json:"newNodeId"`
	PreviousLeaseEpoch      int    `json:"previousLeaseEpoch"`
	LeaseEpoch              int    `json:"leaseEpoch"`
	TakeoverCount           int    `json:"takeoverCount"`
	RuntimePhase            string `json:"runtimePhase"`
	RecoveryBinlogFile      string `json:"recoveryBinlogFile"`
	RecoveryBinlogPosition  int64  `json:"recoveryBinlogPosition"`
	RecoveryDelaySeconds    int    `json:"recoveryDelaySeconds"`
	RecoveryEventsPerSecond int    `json:"recoveryEventsPerSecond"`
}

type FailoverDrillReport struct {
	ID            string              `json:"id"`
	DrilledAt     string              `json:"drilledAt"`
	Node          ClusterNode         `json:"node"`
	Success       bool                `json:"success"`
	Message       string              `json:"message"`
	AffectedTasks []FailoverDrillTask `json:"affectedTasks"`
	Before        ClusterSnapshot     `json:"before"`
	After         ClusterSnapshot     `json:"after"`
}

type NodeDrainReport struct {
	ID            string              `json:"id"`
	DrainedAt     string              `json:"drainedAt"`
	Node          ClusterNode         `json:"node"`
	Success       bool                `json:"success"`
	Message       string              `json:"message"`
	AffectedTasks []FailoverDrillTask `json:"affectedTasks"`
	Before        ClusterSnapshot     `json:"before"`
	After         ClusterSnapshot     `json:"after"`
}

type ClusterRebalanceReport struct {
	ID           string              `json:"id"`
	RebalancedAt string              `json:"rebalancedAt"`
	Success      bool                `json:"success"`
	Message      string              `json:"message"`
	MovedTasks   []FailoverDrillTask `json:"movedTasks"`
	Before       ClusterSnapshot     `json:"before"`
	After        ClusterSnapshot     `json:"after"`
}

type ClusterSnapshot struct {
	Nodes                   []ClusterNode `json:"nodes"`
	Leases                  []TaskLease   `json:"leases"`
	LocalNodeID             string        `json:"localNodeId,omitempty"`
	LocalNodeName           string        `json:"localNodeName,omitempty"`
	OnlineNodes             int           `json:"onlineNodes"`
	TotalNodes              int           `json:"totalNodes"`
	DegradedNodes           int           `json:"degradedNodes"`
	Failovers               int           `json:"failovers"`
	HeartbeatTimeoutSeconds int           `json:"heartbeatTimeoutSeconds"`
}

type DatabaseShape struct {
	Users               []User               `json:"users"`
	Datasources         []Datasource         `json:"datasources"`
	SyncTasks           []SyncTask           `json:"syncTasks"`
	RuntimeStates       []TaskRuntimeState   `json:"runtimeStates"`
	TaskLogs            []TaskLogEntry       `json:"taskLogs"`
	ErrorEvents         []ErrorEvent         `json:"errorEvents"`
	OperationLogs       []OperationLog       `json:"operationLogs"`
	AlertRules          []AlertRule          `json:"alertRules"`
	AlertEvents         []AlertEvent         `json:"alertEvents"`
	CapabilityJobs      []CapabilityJob      `json:"capabilityJobs"`
	Nodes               []ClusterNode        `json:"nodes"`
	TaskLeases          []TaskLease          `json:"taskLeases"`
	TaskRevisions       []TaskRevision       `json:"taskRevisions"`
	TaskCheckpoints     []TaskCheckpoint     `json:"taskCheckpoints"`
	QualityDiffs        []QualityDiff        `json:"qualityDiffs"`
	StructureDDLs       []StructureDDL       `json:"structureDdls"`
	SubscriptionChanges []SubscriptionChange `json:"subscriptionChanges"`
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
