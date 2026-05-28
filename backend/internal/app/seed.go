package app

func createSeedData() (DatabaseShape, error) {
	createdAt := now()
	orderDatasourceID := newID()
	reportingDatasourceID := newID()
	orderPassword, err := encryptText("demo-password")
	if err != nil {
		return DatabaseShape{}, err
	}
	reportingPassword, err := encryptText("demo-password")
	if err != nil {
		return DatabaseShape{}, err
	}

	nodes := defaultClusterNodes(createdAt)

	return DatabaseShape{
		Users: []User{
			{
				ID:           "user-admin",
				Name:         "平台管理员",
				Username:     "admin",
				Role:         RoleAdmin,
				PasswordHash: hashPassword("admin123"),
				CreatedAt:    createdAt,
			},
			{
				ID:           "user-operator",
				Name:         "运维操作员",
				Username:     "operator",
				Role:         RoleOperator,
				PasswordHash: hashPassword("operator123"),
				CreatedAt:    createdAt,
			},
			{
				ID:           "user-readonly",
				Name:         "只读用户",
				Username:     "readonly",
				Role:         RoleReadonly,
				PasswordHash: hashPassword("readonly123"),
				CreatedAt:    createdAt,
			},
		},
		Datasources: []Datasource{
			{
				ID:                orderDatasourceID,
				Name:              "生产订单库",
				Type:              DatasourceTypeMySQL,
				Purpose:           DatasourcePurposeSource,
				Host:              "mysql-order.internal",
				Port:              3306,
				Version:           "MySQL 8.0.44",
				Username:          "reader",
				PasswordSecret:    orderPassword,
				DefaultSchema:     "order_center",
				Remark:            "订单同步源库",
				ConnectionStatus:  DatasourceAvailable,
				LastTestedAt:      createdAt,
				LastTestMessage:   "Connection available",
				LastTestLatencyMS: 8,
				IsDemo:            true,
				CreatedAt:         createdAt,
				UpdatedAt:         createdAt,
			},
			{
				ID:                reportingDatasourceID,
				Name:              "报表查询库",
				Type:              DatasourceTypeMySQL,
				Purpose:           DatasourcePurposeTarget,
				Host:              "mysql-reporting.internal",
				Port:              3306,
				Version:           "MySQL 8.0.44",
				Username:          "writer",
				PasswordSecret:    reportingPassword,
				DefaultSchema:     "reporting",
				Remark:            "报表目标库",
				ConnectionStatus:  DatasourceAvailable,
				LastTestedAt:      createdAt,
				LastTestMessage:   "Connection available",
				LastTestLatencyMS: 9,
				IsDemo:            true,
				CreatedAt:         createdAt,
				UpdatedAt:         createdAt,
			},
		},
		OperationLogs: []OperationLog{
			{
				ID:         newID(),
				Actor:      "system",
				Action:     "seed",
				TargetType: "datasource",
				Detail:     "Seeded demo datasources",
				CreatedAt:  createdAt,
			},
		},
		AlertRules: []AlertRule{
			{
				ID:        newID(),
				Name:      "默认告警",
				Enabled:   true,
				CreatedAt: createdAt,
				UpdatedAt: createdAt,
			},
		},
		Nodes: nodes,
	}, nil
}

func defaultClusterNodes(timestamp string) []ClusterNode {
	return []ClusterNode{
		{
			ID:              "node-shanghai-a",
			Name:            "shanghai-a",
			Endpoint:        "10.18.4.21:4100",
			SSHPort:         22,
			SSHUser:         "deploy",
			AuthMode:        NodeAuthPassword,
			InstallDir:      "/opt/canal-plus",
			Version:         "v1.0.0",
			Zone:            "cn-shanghai-a",
			Status:          NodeOnline,
			Role:            "scheduler+worker",
			CPUPercent:      42,
			MemoryPercent:   58,
			Capacity:        8,
			LastHeartbeatAt: timestamp,
			StartedAt:       timestamp,
			UpdatedAt:       timestamp,
		},
		{
			ID:              "node-shanghai-b",
			Name:            "shanghai-b",
			Endpoint:        "10.18.4.22:4100",
			SSHPort:         22,
			SSHUser:         "deploy",
			AuthMode:        NodeAuthPassword,
			InstallDir:      "/opt/canal-plus",
			Version:         "v1.0.0",
			Zone:            "cn-shanghai-b",
			Status:          NodeOnline,
			Role:            "worker",
			CPUPercent:      35,
			MemoryPercent:   46,
			Capacity:        8,
			LastHeartbeatAt: timestamp,
			StartedAt:       timestamp,
			UpdatedAt:       timestamp,
		},
		{
			ID:              "node-shanghai-c",
			Name:            "shanghai-c",
			Endpoint:        "10.18.4.23:4100",
			SSHPort:         22,
			SSHUser:         "deploy",
			AuthMode:        NodeAuthPassword,
			InstallDir:      "/opt/canal-plus",
			Version:         "v1.0.0",
			Zone:            "cn-shanghai-c",
			Status:          NodeOnline,
			Role:            "worker",
			CPUPercent:      27,
			MemoryPercent:   39,
			Capacity:        8,
			LastHeartbeatAt: timestamp,
			StartedAt:       timestamp,
			UpdatedAt:       timestamp,
		},
	}
}
