import { randomUUID } from "node:crypto";
import type { DatabaseShape, SyncStrategy } from "./types.js";
import { encryptText, hashPassword } from "./security.js";

const now = () => new Date().toISOString();

export function defaultStrategy(): SyncStrategy {
  return {
    initMode: "full_then_incremental",
    writeMode: {
      insert: true,
      update: true,
      delete: true
    },
    conflictStrategy: "overwrite",
    deleteStrategy: "physical",
    batchSize: 1000,
    retryTimes: 3,
    retryIntervalSeconds: 10
  };
}

export function createSeedData(): DatabaseShape {
  const createdAt = now();
  const sourceId = randomUUID();
  const targetId = randomUUID();
  const runningTaskId = randomUUID();
  const failedTaskId = randomUUID();
  const errorId = randomUUID();

  return {
    users: [
      {
        id: "user-admin",
        name: "平台管理员",
        username: "admin",
        role: "admin",
        passwordHash: hashPassword("admin123"),
        createdAt
      }
    ],
    datasources: [
      {
        id: sourceId,
        name: "生产订单库",
        purpose: "source",
        host: "mysql-source.internal",
        port: 3306,
        username: "reader",
        passwordSecret: encryptText("demo-password"),
        defaultSchema: "order_center",
        connectionStatus: "online",
        lastTestedAt: createdAt,
        lastTestMessage: "演示数据源已就绪",
        isDemo: true,
        createdAt,
        updatedAt: createdAt
      },
      {
        id: targetId,
        name: "报表查询库",
        purpose: "target",
        host: "mysql-target.internal",
        port: 3306,
        username: "writer",
        passwordSecret: encryptText("demo-password"),
        defaultSchema: "reporting",
        connectionStatus: "online",
        lastTestedAt: createdAt,
        lastTestMessage: "演示数据源已就绪",
        isDemo: true,
        createdAt,
        updatedAt: createdAt
      }
    ],
    syncTasks: [
      {
        id: runningTaskId,
        name: "订单主表同步",
        description: "将订单中心核心订单表同步到报表查询库。",
        owner: "数据平台",
        sourceDatasourceId: sourceId,
        targetDatasourceId: targetId,
        status: "incremental_running",
        tableMappings: [
          {
            id: randomUUID(),
            sourceSchema: "order_center",
            sourceTable: "orders",
            targetSchema: "reporting",
            targetTable: "ods_orders",
            fields: [
              {
                sourceField: "id",
                targetField: "id",
                sourceType: "bigint",
                targetType: "bigint",
                primaryKey: true,
                nullable: false,
                ignored: false
              },
              {
                sourceField: "customer_id",
                targetField: "customer_id",
                sourceType: "bigint",
                targetType: "bigint",
                primaryKey: false,
                nullable: false,
                ignored: false
              },
              {
                sourceField: "status",
                targetField: "status",
                sourceType: "varchar(32)",
                targetType: "varchar(32)",
                primaryKey: false,
                nullable: false,
                ignored: false
              },
              {
                sourceField: "updated_at",
                targetField: "updated_at",
                sourceType: "datetime",
                targetType: "datetime",
                primaryKey: false,
                nullable: false,
                ignored: false
              }
            ]
          }
        ],
        strategy: defaultStrategy(),
        configVersion: 1,
        createdAt,
        updatedAt: createdAt
      },
      {
        id: failedTaskId,
        name: "支付流水同步",
        description: "同步支付流水到审计库，当前有一条目标写入错误待处理。",
        owner: "财务数据组",
        sourceDatasourceId: sourceId,
        targetDatasourceId: targetId,
        status: "failed",
        tableMappings: [
          {
            id: randomUUID(),
            sourceSchema: "order_center",
            sourceTable: "payments",
            targetSchema: "reporting",
            targetTable: "ods_payments",
            fields: [
              {
                sourceField: "id",
                targetField: "id",
                sourceType: "bigint",
                targetType: "bigint",
                primaryKey: true,
                nullable: false,
                ignored: false
              },
              {
                sourceField: "amount",
                targetField: "amount",
                sourceType: "decimal(12,2)",
                targetType: "decimal(12,2)",
                primaryKey: false,
                nullable: false,
                ignored: false
              }
            ]
          }
        ],
        strategy: defaultStrategy(),
        configVersion: 1,
        createdAt,
        updatedAt: createdAt
      }
    ],
    runtimeStates: [
      {
        taskId: runningTaskId,
        phase: "incremental",
        fullTotalRows: 184260,
        fullSyncedRows: 184260,
        delaySeconds: 4,
        eventsPerSecond: 128,
        binlogFile: "mysql-bin.000421",
        binlogPosition: 76819244,
        startedAt: createdAt,
        updatedAt: createdAt
      },
      {
        taskId: failedTaskId,
        phase: "failed",
        fullTotalRows: 42618,
        fullSyncedRows: 42618,
        delaySeconds: 312,
        eventsPerSecond: 0,
        binlogFile: "mysql-bin.000420",
        binlogPosition: 9912735,
        lastErrorId: errorId,
        startedAt: createdAt,
        updatedAt: createdAt
      }
    ],
    errorEvents: [
      {
        id: errorId,
        taskId: failedTaskId,
        sourceTable: "order_center.payments",
        targetTable: "reporting.ods_payments",
        eventType: "update",
        primaryKeyValue: "pay_982734",
        reason: "目标字段 amount 精度不足，写入被 MySQL 拒绝。",
        rawEventSummary: "UPDATE payments SET amount=128734.29 WHERE id='pay_982734'",
        status: "pending",
        binlogFile: "mysql-bin.000420",
        binlogPosition: 9912735,
        createdAt,
        updatedAt: createdAt
      }
    ],
    operationLogs: [
      {
        id: randomUUID(),
        actor: "system",
        action: "seed",
        targetType: "sync_task",
        detail: "初始化演示任务和数据源",
        createdAt
      }
    ],
    alertRules: [
      {
        id: randomUUID(),
        name: "默认任务异常告警",
        enabled: true,
        delayThresholdSeconds: 300,
        errorThreshold: 1,
        createdAt,
        updatedAt: createdAt
      }
    ]
  };
}
