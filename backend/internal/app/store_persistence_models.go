package app

import "encoding/json"

type userRow struct {
	SortOrder    int    `json:"-" gorm:"not null;index"`
	ID           string `json:"id" gorm:"primaryKey;size:64"`
	Name         string `json:"name" gorm:"size:255;not null"`
	Username     string `json:"username" gorm:"size:255;not null;index"`
	Role         Role   `json:"role" gorm:"size:32;not null"`
	PasswordHash string `json:"passwordHash" gorm:"size:255;not null"`
	CreatedAt    string `json:"createdAt" gorm:"size:64;index"`
}

type datasourceRow struct {
	SortOrder        int               `json:"-" gorm:"not null;index"`
	ID               string            `json:"id" gorm:"primaryKey;size:64"`
	Name             string            `json:"name" gorm:"size:255;not null"`
	Purpose          DatasourcePurpose `json:"purpose" gorm:"size:32;not null;index"`
	Host             string            `json:"host" gorm:"size:255;not null"`
	Port             int               `json:"port" gorm:"not null"`
	Username         string            `json:"username" gorm:"size:255;not null"`
	PasswordSecret   string            `json:"passwordSecret" gorm:"type:text"`
	DefaultSchema    string            `json:"defaultSchema,omitempty" gorm:"size:255"`
	ConnectionStatus DatasourceStatus  `json:"connectionStatus" gorm:"size:32;not null;index"`
	LastTestedAt     string            `json:"lastTestedAt,omitempty" gorm:"size:64;index"`
	LastTestMessage  string            `json:"lastTestMessage,omitempty" gorm:"type:text"`
	IsDemo           bool              `json:"isDemo" gorm:"not null"`
	CreatedAt        string            `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt        string            `json:"updatedAt" gorm:"size:64;index"`
}

type syncTaskRow struct {
	SortOrder          int            `json:"-" gorm:"not null;index"`
	ID                 string         `json:"id" gorm:"primaryKey;size:64"`
	Name               string         `json:"name" gorm:"size:255;not null"`
	Description        string         `json:"description" gorm:"type:longtext"`
	Owner              string         `json:"owner" gorm:"size:255;not null"`
	SourceDatasourceID string         `json:"sourceDatasourceId" gorm:"size:64;index"`
	TargetDatasourceID string         `json:"targetDatasourceId" gorm:"size:64;index"`
	Status             TaskStatus     `json:"status" gorm:"size:32;not null;index"`
	TableMappings      []TableMapping `json:"tableMappings" gorm:"type:json;serializer:json"`
	Strategy           SyncStrategy   `json:"strategy" gorm:"type:json;serializer:json"`
	ConfigVersion      int            `json:"configVersion" gorm:"not null"`
	CreatedAt          string         `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt          string         `json:"updatedAt" gorm:"size:64;index"`
}

type taskRuntimeStateRow struct {
	SortOrder          int    `json:"-" gorm:"not null;index"`
	TaskID             string `json:"taskId" gorm:"primaryKey;size:64"`
	Phase              string `json:"phase" gorm:"size:64;not null"`
	FullTotalRows      int64  `json:"fullTotalRows" gorm:"not null"`
	FullSyncedRows     int64  `json:"fullSyncedRows" gorm:"not null"`
	DelaySeconds       int    `json:"delaySeconds" gorm:"not null"`
	EventsPerSecond    int    `json:"eventsPerSecond" gorm:"not null"`
	BinlogFile         string `json:"binlogFile" gorm:"size:128"`
	BinlogPosition     int64  `json:"binlogPosition" gorm:"not null"`
	NodeID             string `json:"nodeId,omitempty" gorm:"size:64;index"`
	LeaseExpiresAt     string `json:"leaseExpiresAt,omitempty" gorm:"size:64;index"`
	FailoverCount      int    `json:"failoverCount" gorm:"not null"`
	LastTakeoverAt     string `json:"lastTakeoverAt,omitempty" gorm:"size:64;index"`
	StartedAt          string `json:"startedAt,omitempty" gorm:"size:64;index"`
	UpdatedAt          string `json:"updatedAt" gorm:"size:64;index"`
	LastErrorID        string `json:"lastErrorId,omitempty" gorm:"size:64;index"`
	ProcessStatus      string `json:"processStatus,omitempty" gorm:"size:32;index"`
	ProcessID          int    `json:"processId,omitempty" gorm:"not null"`
	ProcessStartedAt   string `json:"processStartedAt,omitempty" gorm:"size:64;index"`
	ProcessStoppedAt   string `json:"processStoppedAt,omitempty" gorm:"size:64;index"`
	LastHeartbeatAt    string `json:"lastHeartbeatAt,omitempty" gorm:"size:64;index"`
	LastLogAt          string `json:"lastLogAt,omitempty" gorm:"size:64;index"`
	LastLogMessage     string `json:"lastLogMessage,omitempty" gorm:"type:longtext"`
	ExitCode           *int   `json:"exitCode,omitempty"`
	ManagedByLocalNode bool   `json:"managedByLocalNode,omitempty" gorm:"not null"`
	LocalLogAccessible bool   `json:"localLogAccessible,omitempty" gorm:"not null"`
	ExecutionNodeName  string `json:"executionNodeName,omitempty" gorm:"size:255"`
	LogAccessMessage   string `json:"logAccessMessage,omitempty" gorm:"type:text"`
}

type taskLogEntryRow struct {
	SortOrder int    `json:"-" gorm:"not null;index"`
	ID        string `json:"id" gorm:"primaryKey;size:64"`
	TaskID    string `json:"taskId" gorm:"size:64;not null;index"`
	NodeID    string `json:"nodeId,omitempty" gorm:"size:64;index"`
	ProcessID int    `json:"processId,omitempty" gorm:"not null"`
	Level     string `json:"level" gorm:"size:32;not null;index"`
	Phase     string `json:"phase,omitempty" gorm:"size:64;index"`
	Message   string `json:"message" gorm:"type:longtext"`
	CreatedAt string `json:"createdAt" gorm:"size:64;index"`
}

type errorEventRow struct {
	SortOrder       int         `json:"-" gorm:"not null;index"`
	ID              string      `json:"id" gorm:"primaryKey;size:64"`
	TaskID          string      `json:"taskId" gorm:"size:64;not null;index"`
	SourceTable     string      `json:"sourceTable" gorm:"size:255;not null"`
	TargetTable     string      `json:"targetTable" gorm:"size:255;not null"`
	EventType       string      `json:"eventType" gorm:"size:64;not null;index"`
	PrimaryKeyValue string      `json:"primaryKeyValue" gorm:"size:255;not null"`
	Reason          string      `json:"reason" gorm:"type:text"`
	RawEventSummary string      `json:"rawEventSummary" gorm:"type:longtext"`
	Status          ErrorStatus `json:"status" gorm:"size:32;not null;index"`
	BinlogFile      string      `json:"binlogFile" gorm:"size:128"`
	BinlogPosition  int64       `json:"binlogPosition" gorm:"not null"`
	CreatedAt       string      `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt       string      `json:"updatedAt" gorm:"size:64;index"`
	HandledBy       string      `json:"handledBy,omitempty" gorm:"size:255"`
	HandledReason   string      `json:"handledReason,omitempty" gorm:"type:text"`
}

type operationLogRow struct {
	SortOrder  int    `json:"-" gorm:"not null;index"`
	ID         string `json:"id" gorm:"primaryKey;size:64"`
	Actor      string `json:"actor" gorm:"size:255;not null;index"`
	Action     string `json:"action" gorm:"size:64;not null;index"`
	TargetType string `json:"targetType" gorm:"size:64;not null;index"`
	TargetID   string `json:"targetId,omitempty" gorm:"size:64;index"`
	Detail     string `json:"detail" gorm:"type:text"`
	CreatedAt  string `json:"createdAt" gorm:"size:64;index"`
}

type alertRuleRow struct {
	SortOrder             int    `json:"-" gorm:"not null;index"`
	ID                    string `json:"id" gorm:"primaryKey;size:64"`
	Name                  string `json:"name" gorm:"size:255;not null"`
	Enabled               bool   `json:"enabled" gorm:"not null;index"`
	TaskID                string `json:"taskId,omitempty" gorm:"size:64;index"`
	DelayThresholdSeconds int    `json:"delayThresholdSeconds" gorm:"not null"`
	ErrorThreshold        int    `json:"errorThreshold" gorm:"not null"`
	WebhookURL            string `json:"webhookUrl,omitempty" gorm:"type:text"`
	CreatedAt             string `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt             string `json:"updatedAt" gorm:"size:64;index"`
}

type alertEventRow struct {
	SortOrder          int                     `json:"-" gorm:"not null;index"`
	ID                 string                  `json:"id" gorm:"primaryKey;size:64"`
	RuleID             string                  `json:"ruleId" gorm:"size:64;not null;index"`
	RuleName           string                  `json:"ruleName" gorm:"size:255;not null"`
	Status             AlertEventStatus        `json:"status" gorm:"size:32;not null;index"`
	MatchedTasks       int                     `json:"matchedTasks" gorm:"not null"`
	MaxDelaySeconds    int                     `json:"maxDelaySeconds" gorm:"not null"`
	PendingErrors      int                     `json:"pendingErrors" gorm:"not null"`
	Reasons            []string                `json:"reasons" gorm:"type:json;serializer:json"`
	NotificationStatus AlertNotificationStatus `json:"notificationStatus" gorm:"size:32;not null;index"`
	NotificationTarget string                  `json:"notificationTarget,omitempty" gorm:"type:text"`
	Message            string                  `json:"message" gorm:"type:longtext"`
	CreatedAt          string                  `json:"createdAt" gorm:"size:64;index"`
}

type capabilityJobRow struct {
	SortOrder       int                  `json:"-" gorm:"not null;index"`
	ID              string               `json:"id" gorm:"primaryKey;size:64"`
	Type            CapabilityJobType    `json:"type" gorm:"size:32;not null;index"`
	Name            string               `json:"name" gorm:"size:255;not null"`
	TaskID          string               `json:"taskId" gorm:"size:64;not null;index"`
	Mode            string               `json:"mode" gorm:"size:64;not null"`
	Status          CapabilityJobStatus  `json:"status" gorm:"size:32;not null;index"`
	ProgressPercent int                  `json:"progressPercent" gorm:"not null"`
	CurrentStep     int                  `json:"currentStep" gorm:"not null"`
	Steps           []CapabilityStep     `json:"steps" gorm:"type:json;serializer:json"`
	Summary         CapabilityJobSummary `json:"summary" gorm:"type:json;serializer:json"`
	Schedule        string               `json:"schedule,omitempty" gorm:"size:255"`
	AutoStart       bool                 `json:"autoStart" gorm:"not null"`
	CreatedAt       string               `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt       string               `json:"updatedAt" gorm:"size:64;index"`
}

type clusterNodeRow struct {
	SortOrder       int          `json:"-" gorm:"not null;index"`
	ID              string       `json:"id" gorm:"primaryKey;size:64"`
	Name            string       `json:"name" gorm:"size:255;not null"`
	Endpoint        string       `json:"endpoint" gorm:"size:255;not null;index"`
	SSHPort         int          `json:"sshPort" gorm:"not null"`
	SSHUser         string       `json:"sshUser" gorm:"size:255;not null"`
	AuthMode        NodeAuthMode `json:"authMode" gorm:"size:32;not null"`
	InstallDir      string       `json:"installDir" gorm:"size:255;not null"`
	Version         string       `json:"version" gorm:"size:64;not null"`
	Zone            string       `json:"zone" gorm:"size:128;not null"`
	Status          NodeStatus   `json:"status" gorm:"size:32;not null;index"`
	Role            string       `json:"role" gorm:"size:64;not null"`
	CPUPercent      int          `json:"cpuPercent" gorm:"not null"`
	MemoryPercent   int          `json:"memoryPercent" gorm:"not null"`
	RunningTasks    int          `json:"runningTasks" gorm:"not null"`
	Capacity        int          `json:"capacity" gorm:"not null"`
	LastHeartbeatAt string       `json:"lastHeartbeatAt" gorm:"size:64;index"`
	StartedAt       string       `json:"startedAt" gorm:"size:64;index"`
	UpdatedAt       string       `json:"updatedAt" gorm:"size:64;index"`
}

type taskLeaseRow struct {
	SortOrder     int    `json:"-" gorm:"not null;index"`
	TaskID        string `json:"taskId" gorm:"primaryKey;size:64"`
	NodeID        string `json:"nodeId" gorm:"size:64;not null;index"`
	Epoch         int    `json:"epoch" gorm:"not null"`
	Status        string `json:"status" gorm:"size:32;not null;index"`
	AcquiredAt    string `json:"acquiredAt" gorm:"size:64;index"`
	ExpiresAt     string `json:"expiresAt" gorm:"size:64;index"`
	TakeoverCount int    `json:"takeoverCount" gorm:"not null"`
	UpdatedAt     string `json:"updatedAt" gorm:"size:64;index"`
}

type taskRevisionRow struct {
	SortOrder  int      `json:"-" gorm:"not null;index"`
	ID         string   `json:"id" gorm:"primaryKey;size:64"`
	TaskID     string   `json:"taskId" gorm:"size:64;not null;index"`
	Version    int      `json:"version" gorm:"not null;index"`
	ChangeType string   `json:"changeType" gorm:"size:64;not null;index"`
	Summary    string   `json:"summary" gorm:"type:text"`
	Actor      string   `json:"actor" gorm:"size:255;not null"`
	Snapshot   SyncTask `json:"snapshot" gorm:"type:json;serializer:json"`
	CreatedAt  string   `json:"createdAt" gorm:"size:64;index"`
}

type taskCheckpointRow struct {
	SortOrder       int    `json:"-" gorm:"not null;index"`
	ID              string `json:"id" gorm:"primaryKey;size:64"`
	TaskID          string `json:"taskId" gorm:"size:64;not null;index"`
	Phase           string `json:"phase" gorm:"size:64;not null;index"`
	BinlogFile      string `json:"binlogFile" gorm:"size:128"`
	BinlogPosition  int64  `json:"binlogPosition" gorm:"not null"`
	NodeID          string `json:"nodeId,omitempty" gorm:"size:64;index"`
	PreviousNodeID  string `json:"previousNodeId,omitempty" gorm:"size:64;index"`
	LeaseEpoch      int    `json:"leaseEpoch" gorm:"not null"`
	TakeoverCount   int    `json:"takeoverCount" gorm:"not null"`
	EventsPerSecond int    `json:"eventsPerSecond" gorm:"not null"`
	DelaySeconds    int    `json:"delaySeconds" gorm:"not null"`
	Reason          string `json:"reason" gorm:"size:64;not null;index"`
	CreatedAt       string `json:"createdAt" gorm:"size:64;index"`
}

type qualityDiffRow struct {
	SortOrder     int               `json:"-" gorm:"not null;index"`
	ID            string            `json:"id" gorm:"primaryKey;size:64"`
	JobID         string            `json:"jobId" gorm:"size:64;not null;index"`
	TaskID        string            `json:"taskId" gorm:"size:64;not null;index"`
	SourceTable   string            `json:"sourceTable" gorm:"size:255;not null"`
	TargetTable   string            `json:"targetTable" gorm:"size:255;not null"`
	PrimaryKey    string            `json:"primaryKey" gorm:"size:255;not null"`
	DiffType      string            `json:"diffType" gorm:"size:64;not null;index"`
	FieldName     string            `json:"fieldName" gorm:"size:255;not null"`
	SourceValue   string            `json:"sourceValue" gorm:"type:longtext"`
	TargetValue   string            `json:"targetValue" gorm:"type:longtext"`
	Severity      string            `json:"severity" gorm:"size:32;not null;index"`
	Status        QualityDiffStatus `json:"status" gorm:"size:32;not null;index"`
	CorrectionSQL string            `json:"correctionSql" gorm:"type:longtext"`
	CreatedAt     string            `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt     string            `json:"updatedAt" gorm:"size:64;index"`
	CorrectedAt   string            `json:"correctedAt,omitempty" gorm:"size:64;index"`
	CorrectedBy   string            `json:"correctedBy,omitempty" gorm:"size:255"`
	HandledReason string            `json:"handledReason,omitempty" gorm:"type:text"`
}

type structureDDLRow struct {
	SortOrder     int                `json:"-" gorm:"not null;index"`
	ID            string             `json:"id" gorm:"primaryKey;size:64"`
	JobID         string             `json:"jobId" gorm:"size:64;not null;index"`
	TaskID        string             `json:"taskId" gorm:"size:64;not null;index"`
	SourceObject  string             `json:"sourceObject" gorm:"size:255;not null"`
	TargetObject  string             `json:"targetObject" gorm:"size:255;not null"`
	ObjectType    string             `json:"objectType" gorm:"size:64;not null;index"`
	ChangeType    string             `json:"changeType" gorm:"size:64;not null;index"`
	Statement     string             `json:"statement" gorm:"type:longtext"`
	RiskLevel     string             `json:"riskLevel" gorm:"size:32;not null;index"`
	Status        StructureDDLStatus `json:"status" gorm:"size:32;not null;index"`
	CreatedAt     string             `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt     string             `json:"updatedAt" gorm:"size:64;index"`
	AppliedAt     string             `json:"appliedAt,omitempty" gorm:"size:64;index"`
	AppliedBy     string             `json:"appliedBy,omitempty" gorm:"size:255"`
	HandledReason string             `json:"handledReason,omitempty" gorm:"type:text"`
}

type subscriptionChangeRow struct {
	SortOrder     int                      `json:"-" gorm:"not null;index"`
	ID            string                   `json:"id" gorm:"primaryKey;size:64"`
	JobID         string                   `json:"jobId" gorm:"size:64;not null;index"`
	TaskID        string                   `json:"taskId" gorm:"size:64;not null;index"`
	ChangeType    string                   `json:"changeType" gorm:"size:64;not null;index"`
	SourceObject  string                   `json:"sourceObject" gorm:"size:255;not null"`
	TargetObject  string                   `json:"targetObject" gorm:"size:255;not null"`
	BeforeActions []string                 `json:"beforeActions,omitempty" gorm:"type:json;serializer:json"`
	AfterActions  []string                 `json:"afterActions,omitempty" gorm:"type:json;serializer:json"`
	BeforeFilter  string                   `json:"beforeFilter,omitempty" gorm:"type:text"`
	AfterFilter   string                   `json:"afterFilter,omitempty" gorm:"type:text"`
	FieldCount    int                      `json:"fieldCount" gorm:"not null"`
	RiskLevel     string                   `json:"riskLevel" gorm:"size:32;not null;index"`
	Status        SubscriptionChangeStatus `json:"status" gorm:"size:32;not null;index"`
	ResultMessage string                   `json:"resultMessage,omitempty" gorm:"type:text"`
	CreatedAt     string                   `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt     string                   `json:"updatedAt" gorm:"size:64;index"`
	AppliedAt     string                   `json:"appliedAt,omitempty" gorm:"size:64;index"`
	AppliedBy     string                   `json:"appliedBy,omitempty" gorm:"size:255"`
	HandledReason string                   `json:"handledReason,omitempty" gorm:"type:text"`
}

type snapshotRows struct {
	Users               []userRow
	Datasources         []datasourceRow
	SyncTasks           []syncTaskRow
	RuntimeStates       []taskRuntimeStateRow
	TaskLogs            []taskLogEntryRow
	ErrorEvents         []errorEventRow
	OperationLogs       []operationLogRow
	AlertRules          []alertRuleRow
	AlertEvents         []alertEventRow
	CapabilityJobs      []capabilityJobRow
	Nodes               []clusterNodeRow
	TaskLeases          []taskLeaseRow
	TaskRevisions       []taskRevisionRow
	TaskCheckpoints     []taskCheckpointRow
	QualityDiffs        []qualityDiffRow
	StructureDDLs       []structureDDLRow
	SubscriptionChanges []subscriptionChangeRow
}

func snapshotRowsFromDatabaseShape(data DatabaseShape) snapshotRows {
	return snapshotRows{
		Users:               toRows[User, userRow](data.Users, func(row *userRow, order int) { row.SortOrder = order }),
		Datasources:         toRows[Datasource, datasourceRow](data.Datasources, func(row *datasourceRow, order int) { row.SortOrder = order }),
		SyncTasks:           toRows[SyncTask, syncTaskRow](data.SyncTasks, func(row *syncTaskRow, order int) { row.SortOrder = order }),
		RuntimeStates:       toRows[TaskRuntimeState, taskRuntimeStateRow](data.RuntimeStates, func(row *taskRuntimeStateRow, order int) { row.SortOrder = order }),
		TaskLogs:            toRows[TaskLogEntry, taskLogEntryRow](data.TaskLogs, func(row *taskLogEntryRow, order int) { row.SortOrder = order }),
		ErrorEvents:         toRows[ErrorEvent, errorEventRow](data.ErrorEvents, func(row *errorEventRow, order int) { row.SortOrder = order }),
		OperationLogs:       toRows[OperationLog, operationLogRow](data.OperationLogs, func(row *operationLogRow, order int) { row.SortOrder = order }),
		AlertRules:          toRows[AlertRule, alertRuleRow](data.AlertRules, func(row *alertRuleRow, order int) { row.SortOrder = order }),
		AlertEvents:         toRows[AlertEvent, alertEventRow](data.AlertEvents, func(row *alertEventRow, order int) { row.SortOrder = order }),
		CapabilityJobs:      toRows[CapabilityJob, capabilityJobRow](data.CapabilityJobs, func(row *capabilityJobRow, order int) { row.SortOrder = order }),
		Nodes:               toRows[ClusterNode, clusterNodeRow](data.Nodes, func(row *clusterNodeRow, order int) { row.SortOrder = order }),
		TaskLeases:          toRows[TaskLease, taskLeaseRow](data.TaskLeases, func(row *taskLeaseRow, order int) { row.SortOrder = order }),
		TaskRevisions:       toRows[TaskRevision, taskRevisionRow](data.TaskRevisions, func(row *taskRevisionRow, order int) { row.SortOrder = order }),
		TaskCheckpoints:     toRows[TaskCheckpoint, taskCheckpointRow](data.TaskCheckpoints, func(row *taskCheckpointRow, order int) { row.SortOrder = order }),
		QualityDiffs:        toRows[QualityDiff, qualityDiffRow](data.QualityDiffs, func(row *qualityDiffRow, order int) { row.SortOrder = order }),
		StructureDDLs:       toRows[StructureDDL, structureDDLRow](data.StructureDDLs, func(row *structureDDLRow, order int) { row.SortOrder = order }),
		SubscriptionChanges: toRows[SubscriptionChange, subscriptionChangeRow](data.SubscriptionChanges, func(row *subscriptionChangeRow, order int) { row.SortOrder = order }),
	}
}

func (s snapshotRows) toDatabaseShape() DatabaseShape {
	return DatabaseShape{
		Users:               fromRows[User, userRow](s.Users),
		Datasources:         fromRows[Datasource, datasourceRow](s.Datasources),
		SyncTasks:           fromRows[SyncTask, syncTaskRow](s.SyncTasks),
		RuntimeStates:       fromRows[TaskRuntimeState, taskRuntimeStateRow](s.RuntimeStates),
		TaskLogs:            fromRows[TaskLogEntry, taskLogEntryRow](s.TaskLogs),
		ErrorEvents:         fromRows[ErrorEvent, errorEventRow](s.ErrorEvents),
		OperationLogs:       fromRows[OperationLog, operationLogRow](s.OperationLogs),
		AlertRules:          fromRows[AlertRule, alertRuleRow](s.AlertRules),
		AlertEvents:         fromRows[AlertEvent, alertEventRow](s.AlertEvents),
		CapabilityJobs:      fromRows[CapabilityJob, capabilityJobRow](s.CapabilityJobs),
		Nodes:               fromRows[ClusterNode, clusterNodeRow](s.Nodes),
		TaskLeases:          fromRows[TaskLease, taskLeaseRow](s.TaskLeases),
		TaskRevisions:       fromRows[TaskRevision, taskRevisionRow](s.TaskRevisions),
		TaskCheckpoints:     fromRows[TaskCheckpoint, taskCheckpointRow](s.TaskCheckpoints),
		QualityDiffs:        fromRows[QualityDiff, qualityDiffRow](s.QualityDiffs),
		StructureDDLs:       fromRows[StructureDDL, structureDDLRow](s.StructureDDLs),
		SubscriptionChanges: fromRows[SubscriptionChange, subscriptionChangeRow](s.SubscriptionChanges),
	}
}

func (s snapshotRows) empty() bool {
	return len(s.Users) == 0 &&
		len(s.Datasources) == 0 &&
		len(s.SyncTasks) == 0 &&
		len(s.RuntimeStates) == 0 &&
		len(s.TaskLogs) == 0 &&
		len(s.ErrorEvents) == 0 &&
		len(s.OperationLogs) == 0 &&
		len(s.AlertRules) == 0 &&
		len(s.AlertEvents) == 0 &&
		len(s.CapabilityJobs) == 0 &&
		len(s.Nodes) == 0 &&
		len(s.TaskLeases) == 0 &&
		len(s.TaskRevisions) == 0 &&
		len(s.TaskCheckpoints) == 0 &&
		len(s.QualityDiffs) == 0 &&
		len(s.StructureDDLs) == 0 &&
		len(s.SubscriptionChanges) == 0
}

func convertJSON[To any](value any) To {
	bytes, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	var target To
	if err := json.Unmarshal(bytes, &target); err != nil {
		panic(err)
	}
	return target
}

func toRows[T any, R any](items []T, setSortOrder func(*R, int)) []R {
	rows := make([]R, len(items))
	for index, item := range items {
		row := convertJSON[R](item)
		setSortOrder(&row, index)
		rows[index] = row
	}
	return rows
}

func fromRows[T any, R any](rows []R) []T {
	items := make([]T, len(rows))
	for index, row := range rows {
		items[index] = convertJSON[T](row)
	}
	return items
}
