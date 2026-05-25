package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	mysqlcfg "github.com/go-sql-driver/mysql"
)

const (
	defaultDataFilePath     = "./data/store.json"
	metadataDSNEnv          = "CANAL_PLUS_METADATA_DSN"
	metadataTableEnv        = "CANAL_PLUS_METADATA_TABLE"
	defaultMetadataTable    = "canal_plus_metadata"
	defaultMetadataStoreKey = "default"
)

var metadataTablePattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

type storePersistence interface {
	Load() (DatabaseShape, bool, error)
	Save(DatabaseShape) error
	Backend() string
	Location() string
}

type fileStorePersistence struct {
	path string
}

func newFileStorePersistence(path string) *fileStorePersistence {
	if strings.TrimSpace(path) == "" {
		path = defaultDataFilePath
	}
	return &fileStorePersistence{path: path}
}

func (p *fileStorePersistence) Load() (DatabaseShape, bool, error) {
	if _, err := os.Stat(p.path); err != nil {
		if os.IsNotExist(err) {
			return DatabaseShape{}, false, nil
		}
		return DatabaseShape{}, false, err
	}
	bytes, err := os.ReadFile(p.path)
	if err != nil {
		return DatabaseShape{}, false, err
	}
	var data DatabaseShape
	if err := json.Unmarshal(bytes, &data); err != nil {
		return DatabaseShape{}, false, err
	}
	return data, true, nil
}

func (p *fileStorePersistence) Save(data DatabaseShape) error {
	if err := ensureParentDir(p.path); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tempPath := filepath.Join(filepath.Dir(p.path), "."+filepath.Base(p.path)+".tmp")
	if err := os.WriteFile(tempPath, append(bytes, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tempPath, p.path)
}

func (p *fileStorePersistence) Backend() string {
	return "file"
}

func (p *fileStorePersistence) Location() string {
	return p.path
}

type mySQLStorePersistence struct {
	db         *sql.DB
	table      string
	location   string
	ensureOnce sync.Once
	ensureErr  error
}

func newMySQLStorePersistence(dsn string, table string) (*mySQLStorePersistence, error) {
	dsn = strings.TrimSpace(dsn)
	if dsn == "" {
		return nil, fmt.Errorf("%s is empty", metadataDSNEnv)
	}
	table = strings.TrimSpace(table)
	if table == "" {
		table = defaultMetadataTable
	}
	if !metadataTablePattern.MatchString(table) {
		return nil, fmt.Errorf("%s must match %s", metadataTableEnv, metadataTablePattern.String())
	}
	config, err := mysqlcfg.ParseDSN(dsn)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.DBName) == "" {
		return nil, fmt.Errorf("%s must include a database name", metadataDSNEnv)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, err
	}
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetMaxIdleConns(5)
	db.SetMaxOpenConns(10)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &mySQLStorePersistence{
		db:       db,
		table:    table,
		location: formatMetadataLocation(config, table),
	}, nil
}

func (p *mySQLStorePersistence) Load() (DatabaseShape, bool, error) {
	if err := p.ensureSchema(); err != nil {
		return DatabaseShape{}, false, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	query := fmt.Sprintf("SELECT payload FROM `%s` WHERE store_key = ?", p.table)
	var payload []byte
	if err := p.db.QueryRowContext(ctx, query, defaultMetadataStoreKey).Scan(&payload); err != nil {
		if err == sql.ErrNoRows {
			return DatabaseShape{}, false, nil
		}
		return DatabaseShape{}, false, err
	}
	var data DatabaseShape
	if err := json.Unmarshal(payload, &data); err != nil {
		return DatabaseShape{}, false, err
	}
	return data, true, nil
}

func (p *mySQLStorePersistence) Save(data DatabaseShape) error {
	if err := p.ensureSchema(); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	query := fmt.Sprintf(`
		INSERT INTO %s (store_key, payload)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP
	`, p.tableName())
	_, err = p.db.ExecContext(ctx, query, defaultMetadataStoreKey, payload)
	return err
}

func (p *mySQLStorePersistence) Backend() string {
	return "mysql"
}

func (p *mySQLStorePersistence) Location() string {
	return p.location
}

func (p *mySQLStorePersistence) ensureSchema() error {
	p.ensureOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		query := fmt.Sprintf(`
			CREATE TABLE IF NOT EXISTS %s (
				store_key VARCHAR(64) NOT NULL PRIMARY KEY,
				payload JSON NOT NULL,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`, p.tableName())
		_, p.ensureErr = p.db.ExecContext(ctx, query)
	})
	return p.ensureErr
}

func (p *mySQLStorePersistence) tableName() string {
	return "`" + p.table + "`"
}

func formatMetadataLocation(config *mysqlcfg.Config, table string) string {
	addr := strings.TrimSpace(config.Addr)
	if addr == "" {
		addr = "127.0.0.1:3306"
	}
	return fmt.Sprintf("mysql://%s/%s#%s", addr, config.DBName, table)
}

func newStorePersistence(path string) (storePersistence, error) {
	if dsn := strings.TrimSpace(os.Getenv(metadataDSNEnv)); dsn != "" {
		return newMySQLStorePersistence(dsn, os.Getenv(metadataTableEnv))
	}
	return newFileStorePersistence(path), nil
}
