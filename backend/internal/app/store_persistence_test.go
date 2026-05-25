package app

import (
	"path/filepath"
	"strings"
	"testing"

	mysqlcfg "github.com/go-sql-driver/mysql"
)

func TestNewStoreUsesFilePersistenceByDefault(t *testing.T) {
	t.Setenv(metadataDSNEnv, "")
	t.Setenv(metadataTablePrefixEnv, "")
	t.Setenv(legacyMetadataTableEnv, "")

	store, err := NewStore(filepath.Join(t.TempDir(), "store.json"))
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}

	if store.StorageBackend() != "file" {
		t.Fatalf("StorageBackend() = %q, want file", store.StorageBackend())
	}
	if !strings.HasSuffix(store.StorageLocation(), "store.json") {
		t.Fatalf("StorageLocation() = %q, want file path", store.StorageLocation())
	}
}

func TestNewStorePersistenceRejectsInvalidMySQLTablePrefix(t *testing.T) {
	t.Setenv(metadataDSNEnv, "root:secret@tcp(127.0.0.1:3306)/canal_plus?parseTime=true")
	t.Setenv(metadataTablePrefixEnv, "bad-table-name")

	_, err := newStorePersistence("")
	if err == nil {
		t.Fatal("expected invalid metadata table prefix error")
	}
	if !strings.Contains(err.Error(), metadataTablePrefixEnv) {
		t.Fatalf("expected error to mention %s, got %v", metadataTablePrefixEnv, err)
	}
}

func TestFormatMetadataLocationRedactsCredentials(t *testing.T) {
	config, err := mysqlcfg.ParseDSN("root:secret@tcp(mysql.internal:3307)/canal_plus?parseTime=true")
	if err != nil {
		t.Fatalf("ParseDSN() error = %v", err)
	}

	location := formatMetadataLocation(config, "canal_plus")
	if strings.Contains(location, "root") || strings.Contains(location, "secret") {
		t.Fatalf("formatMetadataLocation leaked credentials: %q", location)
	}
	if location != "mysql://mysql.internal:3307/canal_plus#canal_plus_*" {
		t.Fatalf("formatMetadataLocation() = %q", location)
	}
}
