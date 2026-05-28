package app

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"time"

	_ "github.com/go-sql-driver/mysql"
	mysqlcfg "github.com/go-sql-driver/mysql"
)

var datasourceDSNPattern = regexp.MustCompile(`[^\s]+:[^\s@]+@tcp\([^)]+\)/[^\s]*`)

var datasourceConnectionTester = runDatasourceConnectionTest

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
	if strings.Contains(strings.ToLower(sanitized), "password") {
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
