package app

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	mysqlcfg "github.com/go-sql-driver/mysql"
)

var datasourceDSNPattern = regexp.MustCompile(`[^\s]+:[^\s@]+@tcp\([^)]+\)/[^\s]*`)

var datasourceConnectionTester = runDatasourceConnectionTest
var datasourceDatabaseLister = listDatasourceDatabases
var datasourceTableLister = listDatasourceTables
var datasourceColumnLister = listDatasourceColumns

func runDatasourceConnectionTest(datasource Datasource) DatasourceTestResult {
	startedAt := time.Now()
	testedAt := now()
	if datasource.IsDemo {
		version := datasource.Version
		if strings.TrimSpace(version) == "" {
			version = "MySQL 8.0.44"
		}
		return DatasourceTestResult{
			Success:   true,
			Status:    DatasourceAvailable,
			Version:   version,
			LatencyMS: latencyMilliseconds(startedAt),
			TestedAt:  testedAt,
			Message:   "Connection available",
		}
	}

	db, err := openMySQL(datasource, datasource.DefaultSchema)
	if err != nil {
		return failedDatasourceTest(startedAt, testedAt, sanitizeDatasourceError(err.Error(), datasource))
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return failedDatasourceTest(startedAt, testedAt, sanitizeDatasourceError(err.Error(), datasource))
	}
	version := ""
	if datasource.Type == DatasourceTypeMySQL {
		var rawVersion string
		if err := db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&rawVersion); err != nil {
			return failedDatasourceTest(startedAt, testedAt, sanitizeDatasourceError(err.Error(), datasource))
		}
		version = formatDatasourceVersion(datasource.Type, rawVersion)
	}
	return DatasourceTestResult{
		Success:   true,
		Status:    DatasourceAvailable,
		Version:   version,
		LatencyMS: latencyMilliseconds(startedAt),
		TestedAt:  testedAt,
		Message:   "Connection available",
	}
}

func formatDatasourceVersion(datasourceType DatasourceType, rawVersion string) string {
	version := strings.TrimSpace(rawVersion)
	if version == "" {
		return ""
	}
	if datasourceType == DatasourceTypeMySQL && !strings.HasPrefix(strings.ToLower(version), "mysql ") {
		return "MySQL " + version
	}
	return version
}

func failedDatasourceTest(startedAt time.Time, testedAt string, message string) DatasourceTestResult {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "Connection failed"
	}
	return DatasourceTestResult{
		Success:   false,
		Status:    DatasourceFailed,
		LatencyMS: latencyMilliseconds(startedAt),
		TestedAt:  testedAt,
		Message:   message,
	}
}

func latencyMilliseconds(startedAt time.Time) int {
	latency := int(time.Since(startedAt).Milliseconds())
	if latency < 1 {
		return 1
	}
	return latency
}

func sanitizeDatasourceError(message string, datasource Datasource) string {
	sanitized := strings.TrimSpace(message)
	if datasource.PasswordSecret != "" {
		if password, err := decryptText(datasource.PasswordSecret); err == nil && password != "" {
			sanitized = strings.ReplaceAll(sanitized, password, "******")
		}
	}
	sanitized = datasourceDSNPattern.ReplaceAllString(sanitized, "[redacted-dsn]")
	if datasource.PasswordSecret != "" && strings.Contains(strings.ToLower(sanitized), "password") {
		sanitized = strings.ReplaceAll(sanitized, datasource.PasswordSecret, "******")
	}
	if sanitized == "" {
		return "Connection failed"
	}
	return sanitized
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

func listDatasourceDatabases(datasource Datasource) ([]string, error) {
	if datasource.IsDemo {
		return demoDatasourceDatabases(datasource), nil
	}
	db, err := openMySQL(datasource, "")
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, "SHOW DATABASES")
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer rows.Close()

	databases := []string{}
	for rows.Next() {
		database := ""
		if err := rows.Scan(&database); err != nil {
			return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
		}
		database = strings.TrimSpace(database)
		if database == "" || isMySQLSystemDatabase(database) {
			continue
		}
		databases = append(databases, database)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	return databases, nil
}

func listDatasourceTables(datasource Datasource, database string) ([]string, error) {
	database = strings.TrimSpace(database)
	if database == "" {
		return nil, errors.New("DB 必填")
	}
	if datasource.IsDemo {
		return demoDatasourceTables(database), nil
	}
	db, err := openMySQL(datasource, "")
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
SELECT table_name
FROM information_schema.tables
WHERE table_schema = ? AND table_type = 'BASE TABLE'
ORDER BY table_name
`, database)
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer rows.Close()

	tables := []string{}
	for rows.Next() {
		table := ""
		if err := rows.Scan(&table); err != nil {
			return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
		}
		table = strings.TrimSpace(table)
		if table != "" {
			tables = append(tables, table)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	return tables, nil
}

func listDatasourceColumns(datasource Datasource, database string, table string) ([]DatasourceColumn, error) {
	database = strings.TrimSpace(database)
	table = strings.TrimSpace(table)
	if database == "" {
		return nil, errors.New("DB 必填")
	}
	if table == "" {
		return nil, errors.New("表必填")
	}
	if datasource.IsDemo {
		return demoDatasourceColumns(database, table), nil
	}
	db, err := openMySQL(datasource, "")
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer db.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `
SELECT column_name, column_type, is_nullable, column_key, column_default
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position
`, database, table)
	if err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	defer rows.Close()

	columns := []DatasourceColumn{}
	for rows.Next() {
		column := DatasourceColumn{}
		nullable := ""
		columnKey := ""
		defaultValue := sql.NullString{}
		if err := rows.Scan(&column.Name, &column.Type, &nullable, &columnKey, &defaultValue); err != nil {
			return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
		}
		column.Name = strings.TrimSpace(column.Name)
		if column.Name == "" {
			continue
		}
		column.Nullable = strings.EqualFold(nullable, "YES")
		column.IsPrimaryKey = strings.EqualFold(columnKey, "PRI")
		if defaultValue.Valid {
			column.DefaultValue = defaultValue.String
		}
		columns = append(columns, column)
	}
	if err := rows.Err(); err != nil {
		return nil, errors.New(sanitizeDatasourceError(err.Error(), datasource))
	}
	return columns, nil
}

func isMySQLSystemDatabase(database string) bool {
	switch strings.ToLower(strings.TrimSpace(database)) {
	case "information_schema", "mysql", "performance_schema", "sys":
		return true
	default:
		return false
	}
}

func demoDatasourceDatabases(datasource Datasource) []string {
	if strings.TrimSpace(datasource.DefaultSchema) != "" {
		return []string{strings.TrimSpace(datasource.DefaultSchema)}
	}
	return []string{"canal_plus"}
}

func demoDatasourceTables(database string) []string {
	if strings.TrimSpace(database) == "" {
		return []string{}
	}
	return []string{"orders", "users"}
}

func demoDatasourceColumns(database string, table string) []DatasourceColumn {
	if strings.TrimSpace(database) == "" || strings.TrimSpace(table) == "" {
		return []DatasourceColumn{}
	}
	columnsByTable := map[string][]DatasourceColumn{
		"orders": {
			{Name: "id", Type: "bigint", Nullable: false, IsPrimaryKey: true},
			{Name: "user_id", Type: "bigint", Nullable: false},
			{Name: "amount", Type: "decimal(12,2)", Nullable: false, DefaultValue: "0.00"},
			{Name: "status", Type: "varchar(32)", Nullable: false, DefaultValue: "pending"},
			{Name: "created_at", Type: "datetime", Nullable: false},
		},
		"users": {
			{Name: "id", Type: "bigint", Nullable: false, IsPrimaryKey: true},
			{Name: "name", Type: "varchar(128)", Nullable: false},
			{Name: "email", Type: "varchar(255)", Nullable: true},
			{Name: "updated_at", Type: "datetime", Nullable: true},
		},
	}
	columns := columnsByTable[strings.ToLower(strings.TrimSpace(table))]
	if len(columns) == 0 {
		return []DatasourceColumn{
			{Name: "id", Type: "bigint", Nullable: false, IsPrimaryKey: true},
			{Name: "name", Type: "varchar(128)", Nullable: false},
			{Name: "updated_at", Type: "datetime", Nullable: true},
		}
	}
	copied := append([]DatasourceColumn(nil), columns...)
	sort.SliceStable(copied, func(left, right int) bool {
		if copied[left].IsPrimaryKey != copied[right].IsPrimaryKey {
			return copied[left].IsPrimaryKey
		}
		return false
	})
	return copied
}
