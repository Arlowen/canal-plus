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
	SortOrder         int               `json:"-" gorm:"not null;index"`
	ID                string            `json:"id" gorm:"primaryKey;size:64"`
	Name              string            `json:"name" gorm:"size:255;not null"`
	Type              DatasourceType    `json:"type" gorm:"size:32;not null;index"`
	Purpose           DatasourcePurpose `json:"purpose,omitempty" gorm:"size:32;index"`
	Host              string            `json:"host" gorm:"size:255;not null"`
	Port              int               `json:"port" gorm:"not null"`
	Version           string            `json:"version,omitempty" gorm:"size:64"`
	Username          string            `json:"username" gorm:"size:255;not null"`
	PasswordSecret    string            `json:"passwordSecret" gorm:"type:text"`
	DefaultSchema     string            `json:"defaultSchema,omitempty" gorm:"size:255"`
	Remark            string            `json:"remark,omitempty" gorm:"size:255"`
	ConnectionStatus  DatasourceStatus  `json:"connectionStatus" gorm:"size:32;not null;index"`
	LastTestedAt      string            `json:"lastTestedAt,omitempty" gorm:"size:64;index"`
	LastTestMessage   string            `json:"lastTestMessage,omitempty" gorm:"type:text"`
	LastTestLatencyMS int               `json:"lastTestLatencyMs,omitempty" gorm:"not null"`
	IsDemo            bool              `json:"isDemo" gorm:"not null"`
	CreatedAt         string            `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt         string            `json:"updatedAt" gorm:"size:64;index"`
}

type channelRow struct {
	SortOrder          int           `json:"-" gorm:"not null;index"`
	ID                 string        `json:"id" gorm:"primaryKey;size:64"`
	Name               string        `json:"name" gorm:"size:255;not null"`
	Description        string        `json:"description,omitempty" gorm:"type:text"`
	SourceDatasourceID string        `json:"sourceDatasourceId" gorm:"size:64;not null;index"`
	TargetDatasourceID string        `json:"targetDatasourceId" gorm:"size:64;not null;index"`
	Status             ChannelStatus `json:"status" gorm:"size:32;not null;index"`
	Owner              string        `json:"owner,omitempty" gorm:"size:255;index"`
	Tags               []string      `json:"tags" gorm:"type:json;serializer:json"`
	MappingVersion     int           `json:"mappingVersion" gorm:"not null"`
	TaskCount          int           `json:"taskCount" gorm:"not null"`
	RunningTaskCount   int           `json:"runningTaskCount" gorm:"not null"`
	LastRunID          string        `json:"lastRunId,omitempty" gorm:"size:64;index"`
	LastRunStatus      TaskRunStatus `json:"lastRunStatus,omitempty" gorm:"size:32;index"`
	CreatedAt          string        `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt          string        `json:"updatedAt" gorm:"size:64;index"`
	ArchivedAt         string        `json:"archivedAt,omitempty" gorm:"size:64;index"`
}

type channelTableMappingRow struct {
	SortOrder      int      `json:"-" gorm:"not null;index"`
	ID             string   `json:"id" gorm:"primaryKey;size:64"`
	ChannelID      string   `json:"channelId" gorm:"size:64;not null;index"`
	MappingVersion int      `json:"mappingVersion" gorm:"not null;index"`
	SourceSchema   string   `json:"sourceSchema,omitempty" gorm:"size:255"`
	SourceTable    string   `json:"sourceTable" gorm:"size:255;not null;index"`
	TargetSchema   string   `json:"targetSchema,omitempty" gorm:"size:255"`
	TargetTable    string   `json:"targetTable" gorm:"size:255;not null;index"`
	PrimaryKeys    []string `json:"primaryKeys" gorm:"type:json;serializer:json"`
	Enabled        bool     `json:"enabled" gorm:"not null;index"`
	CreatedAt      string   `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt      string   `json:"updatedAt" gorm:"size:64;index"`
}

type channelColumnMappingRow struct {
	SortOrder      int    `json:"-" gorm:"not null;index"`
	ID             string `json:"id" gorm:"primaryKey;size:64"`
	ChannelID      string `json:"channelId" gorm:"size:64;not null;index"`
	TableMappingID string `json:"tableMappingId" gorm:"size:64;not null;index"`
	MappingVersion int    `json:"mappingVersion" gorm:"not null;index"`
	SourceColumn   string `json:"sourceColumn" gorm:"size:255;not null"`
	SourceType     string `json:"sourceType,omitempty" gorm:"size:255"`
	TargetColumn   string `json:"targetColumn" gorm:"size:255;not null"`
	TargetType     string `json:"targetType,omitempty" gorm:"size:255"`
	IsPrimaryKey   bool   `json:"isPrimaryKey" gorm:"not null;index"`
	Nullable       bool   `json:"nullable" gorm:"not null"`
	DefaultValue   string `json:"defaultValue,omitempty" gorm:"type:text"`
	Enabled        bool   `json:"enabled" gorm:"not null;index"`
	CreatedAt      string `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt      string `json:"updatedAt" gorm:"size:64;index"`
}

type channelTaskRow struct {
	SortOrder      int               `json:"-" gorm:"not null;index"`
	ID             string            `json:"id" gorm:"primaryKey;size:64"`
	ChannelID      string            `json:"channelId" gorm:"size:64;not null;index"`
	Name           string            `json:"name" gorm:"size:255;not null"`
	Type           ChannelTaskType   `json:"type" gorm:"size:64;not null;index"`
	Status         ChannelTaskStatus `json:"status" gorm:"size:32;not null;index"`
	Enabled        bool              `json:"enabled" gorm:"not null;index"`
	DependsOn      []string          `json:"dependsOn" gorm:"type:json;serializer:json"`
	MappingVersion int               `json:"mappingVersion" gorm:"not null;index"`
	Config         map[string]string `json:"config" gorm:"type:json;serializer:json"`
	LastRunID      string            `json:"lastRunId,omitempty" gorm:"size:64;index"`
	LastRunStatus  TaskRunStatus     `json:"lastRunStatus,omitempty" gorm:"size:32;index"`
	CreatedAt      string            `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt      string            `json:"updatedAt" gorm:"size:64;index"`
}

type taskRunRow struct {
	SortOrder    int             `json:"-" gorm:"not null;index"`
	ID           string          `json:"id" gorm:"primaryKey;size:64"`
	ChannelID    string          `json:"channelId" gorm:"size:64;not null;index"`
	TaskID       string          `json:"taskId" gorm:"size:64;not null;index"`
	TaskType     ChannelTaskType `json:"taskType" gorm:"size:64;not null;index"`
	Status       TaskRunStatus   `json:"status" gorm:"size:32;not null;index"`
	StartedAt    string          `json:"startedAt" gorm:"size:64;index"`
	FinishedAt   string          `json:"finishedAt,omitempty" gorm:"size:64;index"`
	ReadRows     int             `json:"readRows" gorm:"not null"`
	WrittenRows  int             `json:"writtenRows" gorm:"not null"`
	FailedRows   int             `json:"failedRows" gorm:"not null"`
	DiffRows     int             `json:"diffRows" gorm:"not null"`
	ErrorMessage string          `json:"errorMessage,omitempty" gorm:"type:text"`
	CreatedBy    string          `json:"createdBy" gorm:"size:255;index"`
}

type taskLogRow struct {
	SortOrder int    `json:"-" gorm:"not null;index"`
	ID        string `json:"id" gorm:"primaryKey;size:64"`
	ChannelID string `json:"channelId" gorm:"size:64;not null;index"`
	TaskID    string `json:"taskId,omitempty" gorm:"size:64;index"`
	RunID     string `json:"runId,omitempty" gorm:"size:64;index"`
	Level     string `json:"level" gorm:"size:32;not null;index"`
	Thread    string `json:"thread" gorm:"size:128;not null;index"`
	Message   string `json:"message" gorm:"type:text"`
	CreatedAt string `json:"createdAt" gorm:"size:64;index"`
}

type dataValidationDiffRow struct {
	SortOrder        int    `json:"-" gorm:"not null;index"`
	ID               string `json:"id" gorm:"primaryKey;size:64"`
	ChannelID        string `json:"channelId" gorm:"size:64;not null;index"`
	ValidationTaskID string `json:"validationTaskId" gorm:"size:64;not null;index"`
	ValidationRunID  string `json:"validationRunId" gorm:"size:64;not null;index"`
	TableMappingID   string `json:"tableMappingId" gorm:"size:64;not null;index"`
	SourceTable      string `json:"sourceTable" gorm:"size:255;not null;index"`
	TargetTable      string `json:"targetTable" gorm:"size:255;not null;index"`
	PrimaryKeyJSON   string `json:"primaryKeyJson" gorm:"type:text"`
	DiffType         string `json:"diffType" gorm:"size:64;not null;index"`
	DiffColumnsJSON  string `json:"diffColumnsJson" gorm:"type:text"`
	SourceDigest     string `json:"sourceDigest,omitempty" gorm:"type:text"`
	TargetDigest     string `json:"targetDigest,omitempty" gorm:"type:text"`
	CorrectionStatus string `json:"correctionStatus" gorm:"size:64;not null;index"`
	CorrectionTaskID string `json:"correctionTaskId,omitempty" gorm:"size:64;index"`
	CorrectionRunID  string `json:"correctionRunId,omitempty" gorm:"size:64;index"`
	CreatedAt        string `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt        string `json:"updatedAt" gorm:"size:64;index"`
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
	SortOrder  int    `json:"-" gorm:"not null;index"`
	ID         string `json:"id" gorm:"primaryKey;size:64"`
	Name       string `json:"name" gorm:"size:255;not null"`
	Enabled    bool   `json:"enabled" gorm:"not null;index"`
	WebhookURL string `json:"webhookUrl,omitempty" gorm:"type:text"`
	CreatedAt  string `json:"createdAt" gorm:"size:64;index"`
	UpdatedAt  string `json:"updatedAt" gorm:"size:64;index"`
}

type alertEventRow struct {
	SortOrder          int                     `json:"-" gorm:"not null;index"`
	ID                 string                  `json:"id" gorm:"primaryKey;size:64"`
	RuleID             string                  `json:"ruleId" gorm:"size:64;not null;index"`
	RuleName           string                  `json:"ruleName" gorm:"size:255;not null"`
	Status             AlertEventStatus        `json:"status" gorm:"size:32;not null;index"`
	Reasons            []string                `json:"reasons" gorm:"type:json;serializer:json"`
	NotificationStatus AlertNotificationStatus `json:"notificationStatus" gorm:"size:32;not null;index"`
	NotificationTarget string                  `json:"notificationTarget,omitempty" gorm:"type:text"`
	Message            string                  `json:"message" gorm:"type:longtext"`
	CreatedAt          string                  `json:"createdAt" gorm:"size:64;index"`
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
	DiskPercent     int          `json:"diskPercent" gorm:"not null"`
	NetworkMBps     float64      `json:"networkThroughputMBps" gorm:"not null"`
	Capacity        int          `json:"capacity" gorm:"not null"`
	LastHeartbeatAt string       `json:"lastHeartbeatAt" gorm:"size:64;index"`
	StartedAt       string       `json:"startedAt" gorm:"size:64;index"`
	UpdatedAt       string       `json:"updatedAt" gorm:"size:64;index"`
}

type nodeMetricSampleRow struct {
	ID                    string  `json:"id" gorm:"primaryKey;size:64"`
	NodeID                string  `json:"nodeId" gorm:"size:64;not null;index:idx_node_metric_samples_node_time"`
	CollectedAt           string  `json:"collectedAt" gorm:"size:64;not null;index:idx_node_metric_samples_node_time"`
	CPUPercent            int     `json:"cpuPercent" gorm:"not null"`
	MemoryPercent         int     `json:"memoryPercent" gorm:"not null"`
	DiskPercent           int     `json:"diskPercent" gorm:"not null"`
	NetworkThroughputMBps float64 `json:"networkThroughputMBps" gorm:"column:network_throughput_mbps;not null"`
}

type clusterSettingsRow struct {
	SortOrder       int    `json:"-" gorm:"not null;index"`
	ID              string `json:"id" gorm:"primaryKey;size:64"`
	MasterNodeCount int    `json:"masterNodeCount" gorm:"not null"`
	UpdatedAt       string `json:"updatedAt" gorm:"size:64;index"`
}

type snapshotRows struct {
	Users                 []userRow
	Datasources           []datasourceRow
	Channels              []channelRow
	ChannelTableMappings  []channelTableMappingRow
	ChannelColumnMappings []channelColumnMappingRow
	ChannelTasks          []channelTaskRow
	TaskRuns              []taskRunRow
	TaskLogs              []taskLogRow
	DataValidationDiffs   []dataValidationDiffRow
	OperationLogs         []operationLogRow
	AlertRules            []alertRuleRow
	AlertEvents           []alertEventRow
	Nodes                 []clusterNodeRow
	ClusterSettings       []clusterSettingsRow
}

func snapshotRowsFromDatabaseShape(data DatabaseShape) snapshotRows {
	settingsRows := []clusterSettingsRow{}
	if data.ClusterSettings.ID != "" {
		settingsRow := convertJSON[clusterSettingsRow](data.ClusterSettings)
		settingsRow.SortOrder = 0
		settingsRows = append(settingsRows, settingsRow)
	}
	return snapshotRows{
		Users:                 toRows[User, userRow](data.Users, func(row *userRow, order int) { row.SortOrder = order }),
		Datasources:           toRows[Datasource, datasourceRow](data.Datasources, func(row *datasourceRow, order int) { row.SortOrder = order }),
		Channels:              toRows[Channel, channelRow](data.Channels, func(row *channelRow, order int) { row.SortOrder = order }),
		ChannelTableMappings:  toRows[ChannelTableMapping, channelTableMappingRow](data.ChannelTableMappings, func(row *channelTableMappingRow, order int) { row.SortOrder = order }),
		ChannelColumnMappings: toRows[ChannelColumnMapping, channelColumnMappingRow](data.ChannelColumnMappings, func(row *channelColumnMappingRow, order int) { row.SortOrder = order }),
		ChannelTasks:          toRows[ChannelTask, channelTaskRow](data.ChannelTasks, func(row *channelTaskRow, order int) { row.SortOrder = order }),
		TaskRuns:              toRows[TaskRun, taskRunRow](data.TaskRuns, func(row *taskRunRow, order int) { row.SortOrder = order }),
		TaskLogs:              toRows[TaskLog, taskLogRow](data.TaskLogs, func(row *taskLogRow, order int) { row.SortOrder = order }),
		DataValidationDiffs:   toRows[DataValidationDiff, dataValidationDiffRow](data.DataValidationDiffs, func(row *dataValidationDiffRow, order int) { row.SortOrder = order }),
		OperationLogs:         toRows[OperationLog, operationLogRow](data.OperationLogs, func(row *operationLogRow, order int) { row.SortOrder = order }),
		AlertRules:            toRows[AlertRule, alertRuleRow](data.AlertRules, func(row *alertRuleRow, order int) { row.SortOrder = order }),
		AlertEvents:           toRows[AlertEvent, alertEventRow](data.AlertEvents, func(row *alertEventRow, order int) { row.SortOrder = order }),
		Nodes:                 toRows[ClusterNode, clusterNodeRow](data.Nodes, func(row *clusterNodeRow, order int) { row.SortOrder = order }),
		ClusterSettings:       settingsRows,
	}
}

func (s snapshotRows) toDatabaseShape() DatabaseShape {
	settings := ClusterSettings{}
	if len(s.ClusterSettings) > 0 {
		settings = convertJSON[ClusterSettings](s.ClusterSettings[0])
	}
	return DatabaseShape{
		Users:                 fromRows[User, userRow](s.Users),
		Datasources:           fromRows[Datasource, datasourceRow](s.Datasources),
		Channels:              fromRows[Channel, channelRow](s.Channels),
		ChannelTableMappings:  fromRows[ChannelTableMapping, channelTableMappingRow](s.ChannelTableMappings),
		ChannelColumnMappings: fromRows[ChannelColumnMapping, channelColumnMappingRow](s.ChannelColumnMappings),
		ChannelTasks:          fromRows[ChannelTask, channelTaskRow](s.ChannelTasks),
		TaskRuns:              fromRows[TaskRun, taskRunRow](s.TaskRuns),
		TaskLogs:              fromRows[TaskLog, taskLogRow](s.TaskLogs),
		DataValidationDiffs:   fromRows[DataValidationDiff, dataValidationDiffRow](s.DataValidationDiffs),
		OperationLogs:         fromRows[OperationLog, operationLogRow](s.OperationLogs),
		AlertRules:            fromRows[AlertRule, alertRuleRow](s.AlertRules),
		AlertEvents:           fromRows[AlertEvent, alertEventRow](s.AlertEvents),
		Nodes:                 fromRows[ClusterNode, clusterNodeRow](s.Nodes),
		ClusterSettings:       settings,
	}
}

func (s snapshotRows) empty() bool {
	return len(s.Users) == 0 &&
		len(s.Datasources) == 0 &&
		len(s.Channels) == 0 &&
		len(s.ChannelTableMappings) == 0 &&
		len(s.ChannelColumnMappings) == 0 &&
		len(s.ChannelTasks) == 0 &&
		len(s.TaskRuns) == 0 &&
		len(s.TaskLogs) == 0 &&
		len(s.DataValidationDiffs) == 0 &&
		len(s.OperationLogs) == 0 &&
		len(s.AlertRules) == 0 &&
		len(s.AlertEvents) == 0 &&
		len(s.Nodes) == 0 &&
		len(s.ClusterSettings) == 0
}

func convertJSON[To any](value any) To {
	bytes, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	var converted To
	if err := json.Unmarshal(bytes, &converted); err != nil {
		panic(err)
	}
	return converted
}

func toRows[From any, To any](items []From, setSortOrder func(*To, int)) []To {
	rows := make([]To, 0, len(items))
	for index, item := range items {
		row := convertJSON[To](item)
		setSortOrder(&row, index)
		rows = append(rows, row)
	}
	return rows
}

func fromRows[To any, From any](rows []From) []To {
	items := make([]To, 0, len(rows))
	for _, row := range rows {
		items = append(items, convertJSON[To](row))
	}
	return items
}
