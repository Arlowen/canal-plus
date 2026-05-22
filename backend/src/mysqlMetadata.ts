import mysql from "mysql2/promise";
import type { Datasource, TableColumn, TableInfo } from "./types.js";
import { decryptText } from "./security.js";

const demoCatalog: Record<string, Record<string, TableInfo[]>> = {
  order_center: {
    tables: [
      {
        schema: "order_center",
        name: "orders",
        engine: "InnoDB",
        rows: 184260,
        columns: [
          { name: "id", type: "bigint", nullable: false, primaryKey: true },
          { name: "customer_id", type: "bigint", nullable: false, primaryKey: false },
          { name: "status", type: "varchar(32)", nullable: false, primaryKey: false },
          { name: "total_amount", type: "decimal(12,2)", nullable: false, primaryKey: false },
          { name: "updated_at", type: "datetime", nullable: false, primaryKey: false }
        ]
      },
      {
        schema: "order_center",
        name: "payments",
        engine: "InnoDB",
        rows: 42618,
        columns: [
          { name: "id", type: "varchar(32)", nullable: false, primaryKey: true },
          { name: "order_id", type: "bigint", nullable: false, primaryKey: false },
          { name: "amount", type: "decimal(12,2)", nullable: false, primaryKey: false },
          { name: "channel", type: "varchar(24)", nullable: false, primaryKey: false },
          { name: "updated_at", type: "datetime", nullable: false, primaryKey: false }
        ]
      }
    ]
  },
  reporting: {
    tables: [
      {
        schema: "reporting",
        name: "ods_orders",
        engine: "InnoDB",
        rows: 184260,
        columns: [
          { name: "id", type: "bigint", nullable: false, primaryKey: true },
          { name: "customer_id", type: "bigint", nullable: false, primaryKey: false },
          { name: "status", type: "varchar(32)", nullable: false, primaryKey: false },
          { name: "total_amount", type: "decimal(12,2)", nullable: false, primaryKey: false },
          { name: "updated_at", type: "datetime", nullable: false, primaryKey: false }
        ]
      },
      {
        schema: "reporting",
        name: "ods_payments",
        engine: "InnoDB",
        rows: 42618,
        columns: [
          { name: "id", type: "varchar(32)", nullable: false, primaryKey: true },
          { name: "order_id", type: "bigint", nullable: false, primaryKey: false },
          { name: "amount", type: "decimal(12,2)", nullable: false, primaryKey: false },
          { name: "channel", type: "varchar(24)", nullable: false, primaryKey: false },
          { name: "updated_at", type: "datetime", nullable: false, primaryKey: false }
        ]
      }
    ]
  }
};

function connectionConfig(datasource: Datasource, database?: string) {
  return {
    host: datasource.host,
    port: datasource.port,
    user: datasource.username,
    password: decryptText(datasource.passwordSecret),
    database,
    connectTimeout: 3000
  };
}

export async function testDatasource(datasource: Datasource) {
  if (datasource.isDemo) {
    return { ok: true, message: "演示数据源连接正常" };
  }

  const connection = await mysql.createConnection(connectionConfig(datasource, datasource.defaultSchema));
  try {
    await connection.query("SELECT 1");
    return { ok: true, message: "连接成功" };
  } finally {
    await connection.end();
  }
}

export async function listSchemas(datasource: Datasource) {
  if (datasource.isDemo) {
    return Object.keys(demoCatalog);
  }

  const connection = await mysql.createConnection(connectionConfig(datasource));
  try {
    const [rows] = await connection.query(
      "SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY SCHEMA_NAME"
    );
    return (rows as Array<{ name: string }>).map((row) => row.name);
  } finally {
    await connection.end();
  }
}

export async function listTables(datasource: Datasource, schema: string) {
  if (datasource.isDemo) {
    return demoCatalog[schema]?.tables.map(({ columns, ...table }) => table) ?? [];
  }

  const connection = await mysql.createConnection(connectionConfig(datasource, schema));
  try {
    const [rows] = await connection.query(
      `SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, ENGINE AS engine, TABLE_ROWS AS \`rows\`
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME`,
      [schema]
    );
    return rows as TableInfo[];
  } finally {
    await connection.end();
  }
}

export async function listColumns(datasource: Datasource, schema: string, table: string) {
  if (datasource.isDemo) {
    return demoCatalog[schema]?.tables.find((item) => item.name === table)?.columns ?? [];
  }

  const connection = await mysql.createConnection(connectionConfig(datasource, schema));
  try {
    const [rows] = await connection.query(
      `SELECT
         COLUMN_NAME AS name,
         COLUMN_TYPE AS type,
         CASE WHEN IS_NULLABLE = 'YES' THEN TRUE ELSE FALSE END AS nullable,
         CASE WHEN COLUMN_KEY = 'PRI' THEN TRUE ELSE FALSE END AS primaryKey,
         COLUMN_DEFAULT AS defaultValue
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [schema, table]
    );
    return rows as TableColumn[];
  } finally {
    await connection.end();
  }
}
