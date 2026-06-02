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
	Users           []userRow
	Datasources     []datasourceRow
	OperationLogs   []operationLogRow
	AlertRules      []alertRuleRow
	AlertEvents     []alertEventRow
	Nodes           []clusterNodeRow
	ClusterSettings []clusterSettingsRow
}

func snapshotRowsFromDatabaseShape(data DatabaseShape) snapshotRows {
	settingsRows := []clusterSettingsRow{}
	if data.ClusterSettings.ID != "" {
		settingsRow := convertJSON[clusterSettingsRow](data.ClusterSettings)
		settingsRow.SortOrder = 0
		settingsRows = append(settingsRows, settingsRow)
	}
	return snapshotRows{
		Users:           toRows[User, userRow](data.Users, func(row *userRow, order int) { row.SortOrder = order }),
		Datasources:     toRows[Datasource, datasourceRow](data.Datasources, func(row *datasourceRow, order int) { row.SortOrder = order }),
		OperationLogs:   toRows[OperationLog, operationLogRow](data.OperationLogs, func(row *operationLogRow, order int) { row.SortOrder = order }),
		AlertRules:      toRows[AlertRule, alertRuleRow](data.AlertRules, func(row *alertRuleRow, order int) { row.SortOrder = order }),
		AlertEvents:     toRows[AlertEvent, alertEventRow](data.AlertEvents, func(row *alertEventRow, order int) { row.SortOrder = order }),
		Nodes:           toRows[ClusterNode, clusterNodeRow](data.Nodes, func(row *clusterNodeRow, order int) { row.SortOrder = order }),
		ClusterSettings: settingsRows,
	}
}

func (s snapshotRows) toDatabaseShape() DatabaseShape {
	settings := ClusterSettings{}
	if len(s.ClusterSettings) > 0 {
		settings = convertJSON[ClusterSettings](s.ClusterSettings[0])
	}
	return DatabaseShape{
		Users:           fromRows[User, userRow](s.Users),
		Datasources:     fromRows[Datasource, datasourceRow](s.Datasources),
		OperationLogs:   fromRows[OperationLog, operationLogRow](s.OperationLogs),
		AlertRules:      fromRows[AlertRule, alertRuleRow](s.AlertRules),
		AlertEvents:     fromRows[AlertEvent, alertEventRow](s.AlertEvents),
		Nodes:           fromRows[ClusterNode, clusterNodeRow](s.Nodes),
		ClusterSettings: settings,
	}
}

func (s snapshotRows) empty() bool {
	return len(s.Users) == 0 &&
		len(s.Datasources) == 0 &&
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
