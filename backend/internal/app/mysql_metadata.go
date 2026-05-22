package app

import (
	"context"
	"database/sql"
	"time"

	_ "github.com/go-sql-driver/mysql"
	mysqlcfg "github.com/go-sql-driver/mysql"
)

var demoCatalog = map[string][]TableInfo{
	"order_center": {
		{
			Schema: "order_center",
			Name:   "orders",
			Engine: "InnoDB",
			Rows:   184260,
			Columns: []TableColumn{
				{Name: "id", Type: "bigint", Nullable: false, PrimaryKey: true},
				{Name: "customer_id", Type: "bigint", Nullable: false},
				{Name: "status", Type: "varchar(32)", Nullable: false},
				{Name: "total_amount", Type: "decimal(12,2)", Nullable: false},
				{Name: "updated_at", Type: "datetime", Nullable: false},
			},
		},
		{
			Schema: "order_center",
			Name:   "payments",
			Engine: "InnoDB",
			Rows:   42618,
			Columns: []TableColumn{
				{Name: "id", Type: "varchar(32)", Nullable: false, PrimaryKey: true},
				{Name: "order_id", Type: "bigint", Nullable: false},
				{Name: "amount", Type: "decimal(12,2)", Nullable: false},
				{Name: "channel", Type: "varchar(24)", Nullable: false},
				{Name: "updated_at", Type: "datetime", Nullable: false},
			},
		},
	},
	"reporting": {
		{
			Schema: "reporting",
			Name:   "ods_orders",
			Engine: "InnoDB",
			Rows:   184260,
			Columns: []TableColumn{
				{Name: "id", Type: "bigint", Nullable: false, PrimaryKey: true},
				{Name: "customer_id", Type: "bigint", Nullable: false},
				{Name: "status", Type: "varchar(32)", Nullable: false},
				{Name: "total_amount", Type: "decimal(12,2)", Nullable: false},
				{Name: "updated_at", Type: "datetime", Nullable: false},
			},
		},
		{
			Schema: "reporting",
			Name:   "ods_payments",
			Engine: "InnoDB",
			Rows:   42618,
			Columns: []TableColumn{
				{Name: "id", Type: "varchar(32)", Nullable: false, PrimaryKey: true},
				{Name: "order_id", Type: "bigint", Nullable: false},
				{Name: "amount", Type: "decimal(12,2)", Nullable: false},
				{Name: "channel", Type: "varchar(24)", Nullable: false},
				{Name: "updated_at", Type: "datetime", Nullable: false},
			},
		},
	},
}

func testDatasource(datasource Datasource) (bool, string) {
	if datasource.IsDemo {
		return true, "演示数据源连接正常"
	}
	db, err := openMySQL(datasource, datasource.DefaultSchema)
	if err != nil {
		return false, err.Error()
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return false, err.Error()
	}
	return true, "连接成功"
}

func listSchemas(datasource Datasource) ([]string, error) {
	if datasource.IsDemo {
		schemas := []string{"order_center", "reporting"}
		if datasource.DefaultSchema == "" || datasource.DefaultSchema == schemas[0] {
			return schemas, nil
		}
		ordered := []string{datasource.DefaultSchema}
		for _, schema := range schemas {
			if schema != datasource.DefaultSchema {
				ordered = append(ordered, schema)
			}
		}
		return ordered, nil
	}
	db, err := openMySQL(datasource, "")
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		SELECT SCHEMA_NAME
		FROM INFORMATION_SCHEMA.SCHEMATA
		WHERE SCHEMA_NAME NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
		ORDER BY SCHEMA_NAME`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var schemas []string
	for rows.Next() {
		var schema string
		if err := rows.Scan(&schema); err != nil {
			return nil, err
		}
		schemas = append(schemas, schema)
	}
	return schemas, rows.Err()
}

func listTables(datasource Datasource, schema string) ([]TableInfo, error) {
	if datasource.IsDemo {
		tables := cloneJSON(demoCatalog[schema])
		for index := range tables {
			tables[index].Columns = nil
		}
		return tables, nil
	}
	db, err := openMySQL(datasource, schema)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		SELECT TABLE_SCHEMA, TABLE_NAME, COALESCE(ENGINE, ''), COALESCE(TABLE_ROWS, 0)
		FROM INFORMATION_SCHEMA.TABLES
		WHERE TABLE_SCHEMA = ?
		ORDER BY TABLE_NAME`, schema)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tables []TableInfo
	for rows.Next() {
		var table TableInfo
		if err := rows.Scan(&table.Schema, &table.Name, &table.Engine, &table.Rows); err != nil {
			return nil, err
		}
		tables = append(tables, table)
	}
	return tables, rows.Err()
}

func listColumns(datasource Datasource, schema string, tableName string) ([]TableColumn, error) {
	if datasource.IsDemo {
		for _, table := range demoCatalog[schema] {
			if table.Name == tableName {
				return cloneJSON(table.Columns), nil
			}
		}
		return []TableColumn{}, nil
	}
	db, err := openMySQL(datasource, schema)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.Query(`
		SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT
		FROM INFORMATION_SCHEMA.COLUMNS
		WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
		ORDER BY ORDINAL_POSITION`, schema, tableName)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var columns []TableColumn
	for rows.Next() {
		var column TableColumn
		var nullable string
		var key string
		var defaultValue sql.NullString
		if err := rows.Scan(&column.Name, &column.Type, &nullable, &key, &defaultValue); err != nil {
			return nil, err
		}
		column.Nullable = nullable == "YES"
		column.PrimaryKey = key == "PRI"
		if defaultValue.Valid {
			value := defaultValue.String
			column.DefaultValue = &value
		}
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

func openMySQL(datasource Datasource, database string) (*sql.DB, error) {
	password, err := decryptText(datasource.PasswordSecret)
	if err != nil {
		return nil, err
	}
	config := mysqlcfg.NewConfig()
	config.User = datasource.Username
	config.Passwd = password
	config.Net = "tcp"
	config.Addr = datasource.Host + ":" + intToString(datasource.Port)
	config.DBName = database
	config.Timeout = 3 * time.Second
	config.ParseTime = true
	return sql.Open("mysql", config.FormatDSN())
}
