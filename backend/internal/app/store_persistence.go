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
		{suffix: "sync_tasks", model: &syncTaskRow{}},
		{suffix: "runtime_states", model: &taskRuntimeStateRow{}},
		{suffix: "task_logs", model: &taskLogEntryRow{}},
		{suffix: "error_events", model: &errorEventRow{}},
		{suffix: "operation_logs", model: &operationLogRow{}},
		{suffix: "alert_rules", model: &alertRuleRow{}},
		{suffix: "alert_events", model: &alertEventRow{}},
		{suffix: "capability_jobs", model: &capabilityJobRow{}},
		{suffix: "cluster_nodes", model: &clusterNodeRow{}},
		{suffix: "task_leases", model: &taskLeaseRow{}},
		{suffix: "task_revisions", model: &taskRevisionRow{}},
		{suffix: "task_checkpoints", model: &taskCheckpointRow{}},
		{suffix: "quality_diffs", model: &qualityDiffRow{}},
		{suffix: "structure_ddls", model: &structureDDLRow{}},
		{suffix: "subscription_changes", model: &subscriptionChangeRow{}},
	}
	for _, migration := range migrations {
		if err := p.db.Table(p.tableName(migration.suffix)).AutoMigrate(migration.model); err != nil {
			return err
		}
	}
	return nil
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
	if rows.SyncTasks, err = loadTableRows[syncTaskRow](p.db, p.tableName("sync_tasks")); err != nil {
		return snapshotRows{}, err
	}
	if rows.RuntimeStates, err = loadTableRows[taskRuntimeStateRow](p.db, p.tableName("runtime_states")); err != nil {
		return snapshotRows{}, err
	}
	if rows.TaskLogs, err = loadTableRows[taskLogEntryRow](p.db, p.tableName("task_logs")); err != nil {
		return snapshotRows{}, err
	}
	if rows.ErrorEvents, err = loadTableRows[errorEventRow](p.db, p.tableName("error_events")); err != nil {
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
	if rows.CapabilityJobs, err = loadTableRows[capabilityJobRow](p.db, p.tableName("capability_jobs")); err != nil {
		return snapshotRows{}, err
	}
	if rows.Nodes, err = loadTableRows[clusterNodeRow](p.db, p.tableName("cluster_nodes")); err != nil {
		return snapshotRows{}, err
	}
	if rows.TaskLeases, err = loadTableRows[taskLeaseRow](p.db, p.tableName("task_leases")); err != nil {
		return snapshotRows{}, err
	}
	if rows.TaskRevisions, err = loadTableRows[taskRevisionRow](p.db, p.tableName("task_revisions")); err != nil {
		return snapshotRows{}, err
	}
	if rows.TaskCheckpoints, err = loadTableRows[taskCheckpointRow](p.db, p.tableName("task_checkpoints")); err != nil {
		return snapshotRows{}, err
	}
	if rows.QualityDiffs, err = loadTableRows[qualityDiffRow](p.db, p.tableName("quality_diffs")); err != nil {
		return snapshotRows{}, err
	}
	if rows.StructureDDLs, err = loadTableRows[structureDDLRow](p.db, p.tableName("structure_ddls")); err != nil {
		return snapshotRows{}, err
	}
	if rows.SubscriptionChanges, err = loadTableRows[subscriptionChangeRow](p.db, p.tableName("subscription_changes")); err != nil {
		return snapshotRows{}, err
	}

	return rows, nil
}

func (p *mySQLStorePersistence) replaceSnapshotRows(tx *gorm.DB, rows snapshotRows) error {
	replacements := []func(*gorm.DB) error{
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("users"), rows.Users) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("datasources"), rows.Datasources) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("sync_tasks"), rows.SyncTasks) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("runtime_states"), rows.RuntimeStates)
		},
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("task_logs"), rows.TaskLogs) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("error_events"), rows.ErrorEvents) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("operation_logs"), rows.OperationLogs)
		},
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("alert_rules"), rows.AlertRules) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("alert_events"), rows.AlertEvents) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("capability_jobs"), rows.CapabilityJobs)
		},
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("cluster_nodes"), rows.Nodes) },
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("task_leases"), rows.TaskLeases) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("task_revisions"), rows.TaskRevisions)
		},
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("task_checkpoints"), rows.TaskCheckpoints)
		},
		func(db *gorm.DB) error { return replaceTableRows(db, p.tableName("quality_diffs"), rows.QualityDiffs) },
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("structure_ddls"), rows.StructureDDLs)
		},
		func(db *gorm.DB) error {
			return replaceTableRows(db, p.tableName("subscription_changes"), rows.SubscriptionChanges)
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
