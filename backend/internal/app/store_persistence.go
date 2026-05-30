package app

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	mysqlcfg "github.com/go-sql-driver/mysql"
	gormmysql "gorm.io/driver/mysql"
	"gorm.io/gorm"
)

const (
	metadataDSNEnv             = "CANAL_PLUS_METADATA_DSN"
	metadataTablePrefixEnv     = "CANAL_PLUS_METADATA_TABLE_PREFIX"
	legacyMetadataTableEnv     = "CANAL_PLUS_METADATA_TABLE"
	defaultMetadataTablePrefix = "canal_plus"
)

var metadataTablePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type storePersistence interface {
	Load() (DatabaseShape, bool, error)
	Save(DatabaseShape) error
	Backend() string
	Location() string
}

type mySQLStorePersistence struct {
	db          *gorm.DB
	tablePrefix string
	location    string
	ensureOnce  sync.Once
	ensureErr   error
}

func newMySQLStorePersistence(dsn string, tablePrefix string) (*mySQLStorePersistence, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("%s is empty", metadataDSNEnv)
	}
	tablePrefix = strings.TrimSpace(tablePrefix)
	if tablePrefix == "" {
		tablePrefix = defaultMetadataTablePrefix
	}
	if !metadataTablePattern.MatchString(tablePrefix) {
		return nil, fmt.Errorf("%s must match %s", metadataTablePrefixEnv, metadataTablePattern.String())
	}

	config, err := mysqlcfg.ParseDSN(dsn)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.DBName) == "" {
		return nil, fmt.Errorf("%s must include a database name", metadataDSNEnv)
	}

	db, err := gorm.Open(gormmysql.Open(dsn), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
	})
	if err != nil {
		return nil, err
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	sqlDB.SetConnMaxLifetime(5 * time.Minute)
	sqlDB.SetMaxIdleConns(5)
	sqlDB.SetMaxOpenConns(10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, err
	}

	return &mySQLStorePersistence{
		db:          db,
		tablePrefix: tablePrefix,
		location:    formatMetadataLocation(config, tablePrefix),
	}, nil
}

func (p *mySQLStorePersistence) Load() (DatabaseShape, bool, error) {
	if err := p.ensureSchema(); err != nil {
		return DatabaseShape{}, false, err
	}

	rows, err := p.loadSnapshotRows()
	if err != nil {
		return DatabaseShape{}, false, err
	}
	if rows.empty() {
		return DatabaseShape{}, false, nil
	}
	return rows.toDatabaseShape(), true, nil
}

func (p *mySQLStorePersistence) Save(data DatabaseShape) error {
	if err := p.ensureSchema(); err != nil {
		return err
	}
	rows := snapshotRowsFromDatabaseShape(data)
	return p.db.Transaction(func(tx *gorm.DB) error {
		return p.replaceSnapshotRows(tx, rows)
	})
}

func (p *mySQLStorePersistence) Backend() string {
	return "mysql"
}

func (p *mySQLStorePersistence) Location() string {
	return p.location
}

func (p *mySQLStorePersistence) ensureSchema() error {
	p.ensureOnce.Do(func() {
		p.ensureErr = p.autoMigrate()
	})
	return p.ensureErr
}

func (p *mySQLStorePersistence) autoMigrate() error {
	migrations := []struct {
		suffix string
		model  any
	}{
		{suffix: "users", model: &userRow{}},
		{suffix: "datasources", model: &datasourceRow{}},
		{suffix: "operation_logs", model: &operationLogRow{}},
		{suffix: "alert_rules", model: &alertRuleRow{}},
		{suffix: "alert_events", model: &alertEventRow{}},
		{suffix: "cluster_nodes", model: &clusterNodeRow{}},
		{suffix: "cluster_settings", model: &clusterSettingsRow{}},
	}
	for _, migration := range migrations {
		if err := p.db.Table(p.tableName(migration.suffix)).AutoMigrate(migration.model); err != nil {
			return err
		}
	}
	for _, column := range []struct {
		tableSuffix string
		name        string
	}{
		{tableSuffix: "alert_rules", name: "task_id"},
		{tableSuffix: "alert_rules", name: "delay_threshold_seconds"},
		{tableSuffix: "alert_rules", name: "error_threshold"},
		{tableSuffix: "alert_events", name: "matched_tasks"},
		{tableSuffix: "alert_events", name: "max_delay_seconds"},
		{tableSuffix: "alert_events", name: "pending_errors"},
		{tableSuffix: "cluster_nodes", name: "running_tasks"},
		{tableSuffix: "operation_logs", name: "type"},
	} {
		if err := p.dropColumnIfExists(p.tableName(column.tableSuffix), column.name); err != nil {
			return err
		}
	}
	for _, suffix := range []string{
		"sync_tasks",
		"runtime_states",
		"task_logs",
		"error_events",
		"capability_jobs",
		"task_leases",
		"task_revisions",
		"task_checkpoints",
		"quality_diffs",
		"structure_ddls",
		"subscription_changes",
	} {
		table := p.tableName(suffix)
		if p.db.Migrator().HasTable(table) {
			if err := p.db.Migrator().DropTable(table); err != nil {
				return err
			}
		}
	}
	return nil
}

func (p *mySQLStorePersistence) dropColumnIfExists(table string, column string) error {
	var count int64
	if err := p.db.Raw(
		"SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
		table,
		column,
	).Scan(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return nil
	}
	return p.db.Exec("ALTER TABLE `" + table + "` DROP COLUMN `" + column + "`").Error
}

func (p *mySQLStorePersistence) loadSnapshotRows() (snapshotRows, error) {
	var rows snapshotRows
	var err error

	if rows.Users, err = loadTableRows[userRow](p.db, p.tableName("users")); err != nil {
		return snapshotRows{}, err
	}
	if rows.Datasources, err = loadTableRows[datasourceRow](p.db, p.tableName("datasources")); err != nil {
		return snapshotRows{}, err
	}
	if rows.OperationLogs, err = loadTableRows[operationLogRow](p.db, p.tableName("operation_logs")); err != nil {
		return snapshotRows{}, err
	}
	if rows.AlertRules, err = loadTableRows[alertRuleRow](p.db, p.tableName("alert_rules")); err != nil {
		return snapshotRows{}, err
	}
	if rows.AlertEvents, err = loadTableRows[alertEventRow](p.db, p.tableName("alert_events")); err != nil {
		return snapshotRows{}, err
	}
	if rows.Nodes, err = loadTableRows[clusterNodeRow](p.db, p.tableName("cluster_nodes")); err != nil {
		return snapshotRows{}, err
	}
	if rows.ClusterSettings, err = loadTableRows[clusterSettingsRow](p.db, p.tableName("cluster_settings")); err != nil {
		return snapshotRows{}, err
	}

	return rows, nil
}

func (p *mySQLStorePersistence) replaceSnapshotRows(tx *gorm.DB, rows snapshotRows) error {
	replacements := []func(*gorm.DB) error{
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("users"), rows.Users) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("datasources"), rows.Datasources) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("operation_logs"), rows.OperationLogs)
		},
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("alert_rules"), rows.AlertRules) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("alert_events"), rows.AlertEvents) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("cluster_nodes"), rows.Nodes) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("cluster_settings"), rows.ClusterSettings)
		},
	}
	for _, replacement := range replacements {
		if err := replacement(tx); err != nil {
			return err
		}
	}
	return nil
}

func (p *mySQLStorePersistence) tableName(suffix string) string {
	return p.tablePrefix + "_" + suffix
}

func loadTableRows[T any](db *gorm.DB, table string) ([]T, error) {
	var rows []T
	err := db.Table(table).Order("sort_order ASC").Find(&rows).Error
	return rows, err
}

func replaceTableRows[T any](tx *gorm.DB, table string, rows []T) error {
	var model T
	if err := tx.Table(table).Session(&gorm.Session{AllowGlobalUpdate: true}).Delete(&model).Error; err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	return tx.Table(table).CreateInBatches(rows, 200).Error
}

func formatMetadataLocation(config *mysqlcfg.Config, tablePrefix string) string {
	addr := strings.TrimSpace(config.Addr)
	if addr == "" {
		addr = "127.0.0.1:3306"
	}
	return fmt.Sprintf("mysql://%s/%s#%s_*", addr, config.DBName, tablePrefix)
}

func metadataTablePrefix() string {
	if value := strings.TrimSpace(os.Getenv(metadataTablePrefixEnv)); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv(legacyMetadataTableEnv)); value != "" {
		return value
	}
	return defaultMetadataTablePrefix
}

func newStorePersistence() (storePersistence, error) {
	if dsn := strings.TrimSpace(os.Getenv(metadataDSNEnv)); dsn != "" {
		return newMySQLStorePersistence(dsn, metadataTablePrefix())
	}
	return nil, fmt.Errorf("%s is required", metadataDSNEnv)
}
