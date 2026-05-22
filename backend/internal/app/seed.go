package app

func defaultStrategy() SyncStrategy {
	strategy := SyncStrategy{
		InitMode:             "full_then_incremental",
		ConflictStrategy:     "overwrite",
		DeleteStrategy:       "physical",
		BatchSize:            1000,
		RetryTimes:           3,
		RetryIntervalSeconds: 10,
	}
	strategy.WriteMode.Insert = true
	strategy.WriteMode.Update = true
	strategy.WriteMode.Delete = true
	return strategy
}

func createSeedData() (DatabaseShape, error) {
	createdAt := now()
	sourceID := newID()
	targetID := newID()
	runningTaskID := newID()
	failedTaskID := newID()
	errorID := newID()
	sourcePassword, err := encryptText("demo-password")
	if err != nil {
		return DatabaseShape{}, err
	}
	targetPassword, err := encryptText("demo-password")
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
		},
		Datasources: []Datasource{
			{
				ID:               sourceID,
				Name:             "生产订单库",
				Purpose:          PurposeSource,
				Host:             "mysql-source.internal",
				Port:             3306,
				Username:         "reader",
				PasswordSecret:   sourcePassword,
				DefaultSchema:    "order_center",
				ConnectionStatus: DatasourceOnline,
				LastTestedAt:     createdAt,
				LastTestMessage:  "演示数据源已就绪",
				IsDemo:           true,
				CreatedAt:        createdAt,
				UpdatedAt:        createdAt,
			},
			{
				ID:               targetID,
				Name:             "报表查询库",
				Purpose:          PurposeTarget,
				Host:             "mysql-target.internal",
				Port:             3306,
				Username:         "writer",
				PasswordSecret:   targetPassword,
				DefaultSchema:    "reporting",
				ConnectionStatus: DatasourceOnline,
				LastTestedAt:     createdAt,
				LastTestMessage:  "演示数据源已就绪",
				IsDemo:           true,
				CreatedAt:        createdAt,
				UpdatedAt:        createdAt,
			},
		},
		SyncTasks: []SyncTask{
			{
				ID:                 runningTaskID,
				Name:               "订单主表同步",
				Description:        "将订单中心核心订单表同步到报表查询库。",
				Owner:              "数据平台",
				SourceDatasourceID: sourceID,
				TargetDatasourceID: targetID,
				Status:             TaskIncrementalRunning,
				TableMappings: []TableMapping{
					{
						ID:           newID(),
						SourceSchema: "order_center",
						SourceTable:  "orders",
						TargetSchema: "reporting",
						TargetTable:  "ods_orders",
						Fields: []FieldMapping{
							{SourceField: "id", TargetField: "id", SourceType: "bigint", TargetType: "bigint", PrimaryKey: true},
							{SourceField: "customer_id", TargetField: "customer_id", SourceType: "bigint", TargetType: "bigint"},
							{SourceField: "status", TargetField: "status", SourceType: "varchar(32)", TargetType: "varchar(32)"},
							{SourceField: "updated_at", TargetField: "updated_at", SourceType: "datetime", TargetType: "datetime"},
						},
					},
				},
				Strategy:      defaultStrategy(),
				ConfigVersion: 1,
				CreatedAt:     createdAt,
				UpdatedAt:     createdAt,
			},
			{
				ID:                 failedTaskID,
				Name:               "支付流水同步",
				Description:        "同步支付流水到审计库，当前有一条目标写入错误待处理。",
				Owner:              "财务数据组",
				SourceDatasourceID: sourceID,
				TargetDatasourceID: targetID,
				Status:             TaskFailed,
				TableMappings: []TableMapping{
					{
						ID:           newID(),
						SourceSchema: "order_center",
						SourceTable:  "payments",
						TargetSchema: "reporting",
						TargetTable:  "ods_payments",
						Fields: []FieldMapping{
							{SourceField: "id", TargetField: "id", SourceType: "bigint", TargetType: "bigint", PrimaryKey: true},
							{SourceField: "amount", TargetField: "amount", SourceType: "decimal(12,2)", TargetType: "decimal(12,2)"},
						},
					},
				},
				Strategy:      defaultStrategy(),
				ConfigVersion: 1,
				CreatedAt:     createdAt,
				UpdatedAt:     createdAt,
			},
		},
		RuntimeStates: []TaskRuntimeState{
			{
				TaskID:          runningTaskID,
				Phase:           "incremental",
				FullTotalRows:   184260,
				FullSyncedRows:  184260,
				DelaySeconds:    4,
				EventsPerSecond: 128,
				BinlogFile:      "mysql-bin.000421",
				BinlogPosition:  76819244,
				NodeID:          nodes[0].ID,
				LeaseExpiresAt:  leaseExpiry(),
				StartedAt:       createdAt,
				UpdatedAt:       createdAt,
			},
			{
				TaskID:          failedTaskID,
				Phase:           "failed",
				FullTotalRows:   42618,
				FullSyncedRows:  42618,
				DelaySeconds:    312,
				EventsPerSecond: 0,
				BinlogFile:      "mysql-bin.000420",
				BinlogPosition:  9912735,
				NodeID:          nodes[1].ID,
				LeaseExpiresAt:  leaseExpiry(),
				LastErrorID:     errorID,
				StartedAt:       createdAt,
				UpdatedAt:       createdAt,
			},
		},
		ErrorEvents: []ErrorEvent{
			{
				ID:              errorID,
				TaskID:          failedTaskID,
				SourceTable:     "order_center.payments",
				TargetTable:     "reporting.ods_payments",
				EventType:       "update",
				PrimaryKeyValue: "pay_982734",
				Reason:          "目标字段 amount 精度不足，写入被 MySQL 拒绝。",
				RawEventSummary: "UPDATE payments SET amount=128734.29 WHERE id='pay_982734'",
				Status:          ErrorPending,
				BinlogFile:      "mysql-bin.000420",
				BinlogPosition:  9912735,
				CreatedAt:       createdAt,
				UpdatedAt:       createdAt,
			},
		},
		OperationLogs: []OperationLog{
			{
				ID:         newID(),
				Actor:      "system",
				Action:     "seed",
				TargetType: "sync_task",
				Detail:     "初始化演示任务和数据源",
				CreatedAt:  createdAt,
			},
		},
		AlertRules: []AlertRule{
			{
				ID:                    newID(),
				Name:                  "默认任务异常告警",
				Enabled:               true,
				DelayThresholdSeconds: 300,
				ErrorThreshold:        1,
				CreatedAt:             createdAt,
				UpdatedAt:             createdAt,
			},
		},
		CapabilityJobs: []CapabilityJob{
			{
				ID:              newID(),
				Type:            CapabilityStructure,
				Name:            "订单主表结构计划",
				TaskID:          runningTaskID,
				Mode:            "schema_prepare",
				Status:          CapabilityCompleted,
				ProgressPercent: 100,
				CurrentStep:     4,
				Steps:           completedCapabilitySteps(CapabilityStructure),
				Summary: CapabilityJobSummary{
					Tables:    1,
					Columns:   4,
					DDLCount:  2,
					RiskLevel: "low",
				},
				AutoStart: true,
				CreatedAt: createdAt,
				UpdatedAt: createdAt,
			},
			{
				ID:              newID(),
				Type:            CapabilityQuality,
				Name:            "支付流水二次校验",
				TaskID:          failedTaskID,
				Mode:            "verify_then_correct",
				Status:          CapabilityRunning,
				ProgressPercent: 64,
				CurrentStep:     2,
				Steps:           defaultCapabilitySteps(CapabilityQuality),
				Summary: CapabilityJobSummary{
					Tables:    1,
					Columns:   2,
					DiffRows:  18,
					RiskLevel: "medium",
				},
				AutoStart: true,
				CreatedAt: createdAt,
				UpdatedAt: createdAt,
			},
		},
		Nodes: nodes,
		TaskLeases: []TaskLease{
			{
				TaskID:        runningTaskID,
				NodeID:        nodes[0].ID,
				Epoch:         1,
				Status:        "active",
				AcquiredAt:    createdAt,
				ExpiresAt:     leaseExpiry(),
				TakeoverCount: 0,
				UpdatedAt:     createdAt,
			},
			{
				TaskID:        failedTaskID,
				NodeID:        nodes[1].ID,
				Epoch:         1,
				Status:        "active",
				AcquiredAt:    createdAt,
				ExpiresAt:     leaseExpiry(),
				TakeoverCount: 0,
				UpdatedAt:     createdAt,
			},
		},
	}, nil
}

func defaultClusterNodes(timestamp string) []ClusterNode {
	return []ClusterNode{
		{
			ID:              "node-shanghai-a",
			Name:            "shanghai-a",
			Endpoint:        "10.18.4.21:4100",
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
