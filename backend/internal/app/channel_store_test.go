package app

import (
	"strings"
	"testing"
)

func TestCreateChannelStoresRuntimeAndChecksCapacity(t *testing.T) {
	store := newTestStore(t)
	source := createNamedTestDatasource(t, store, "source", DatasourcePurposeSource)
	target := createNamedTestDatasource(t, store, "target", DatasourcePurposeTarget)

	channel, err := store.CreateChannel(ChannelInput{
		Name:               "runtime-channel",
		SourceDatasourceID: source.ID,
		TargetDatasourceID: target.ID,
		RunNodeID:          "node-local",
		ResourceSpec:       "0.5G",
		Kind:               ChannelKindSync,
	}, "admin")
	if err != nil {
		t.Fatalf("create channel with enough capacity: %v", err)
	}
	if channel.RunNodeID != "node-local" || channel.ResourceSpec != "0.5G" || channel.Kind != ChannelKindSync {
		t.Fatalf("runtime fields not stored: %#v", channel)
	}
	if channel.SourceDatasourceType != DatasourceTypeMySQL || channel.TargetDatasourceType != DatasourceTypeMySQL {
		t.Fatalf("datasource types not stored: %#v", channel)
	}

	if _, err := store.CreateChannel(ChannelInput{
		Name:               "too-large-channel",
		SourceDatasourceID: source.ID,
		TargetDatasourceID: target.ID,
		RunNodeID:          "node-local",
		ResourceSpec:       "2G",
		Kind:               ChannelKindSync,
	}, "admin"); err == nil {
		t.Fatal("expected capacity error")
	}
}

func TestDataCorrectionRequiresSuccessfulValidationRun(t *testing.T) {
	store := newTestStore(t)
	source := createNamedTestDatasource(t, store, "source", DatasourcePurposeSource)
	target := createNamedTestDatasource(t, store, "target", DatasourcePurposeTarget)
	channel, err := store.CreateChannel(ChannelInput{
		Name:               "correction-channel",
		SourceDatasourceID: source.ID,
		TargetDatasourceID: target.ID,
		RunNodeID:          "node-local",
		ResourceSpec:       "0.5G",
		Kind:               ChannelKindCheck,
	}, "admin")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, ok, err := store.SaveChannelMappings(channel.ID, ChannelMappingsInput{
		Tables: []ChannelTableMappingInput{{
			SourceTable: "orders",
			TargetTable: "orders_shadow",
			PrimaryKeys: []string{"id"},
			Columns: []ChannelColumnMappingInput{
				{SourceColumn: "id", SourceType: "bigint", TargetColumn: "id", TargetType: "bigint", IsPrimaryKey: true},
				{SourceColumn: "amount", SourceType: "decimal(12,2)", TargetColumn: "amount", TargetType: "varchar(32)"},
			},
		}},
	}, "admin"); err != nil || !ok {
		t.Fatalf("save mappings ok=%v err=%v", ok, err)
	}
	correction, ok, err := store.CreateChannelTask(channel.ID, ChannelTaskInput{
		Name:    "数据订正",
		Type:    ChannelTaskDataCorrection,
		Enabled: boolPtr(true),
	}, "admin")
	if err != nil || !ok {
		t.Fatalf("create correction ok=%v err=%v", ok, err)
	}
	precheck, ok := store.PrecheckChannel(channel.ID)
	if !ok {
		t.Fatal("precheck channel missing")
	}
	if item := precheckItem(precheck, "columnTypes"); item == nil || item.Severity != ChannelPrecheckWarning || !item.Success {
		t.Fatalf("columnTypes warning missing: %#v", precheck.Items)
	}
	if item := precheckItem(precheck, "dataCorrectionValidation"); item == nil || item.Severity != ChannelPrecheckWarning || !item.Success {
		t.Fatalf("data correction warning missing: %#v", precheck.Items)
	}
	if _, ok, err := store.StartChannelTask(channel.ID, correction.ID, "admin"); err == nil || !ok || !strings.Contains(err.Error(), "请先完成数据校验") {
		t.Fatalf("start correction without validation ok=%v err=%v", ok, err)
	}

	validation, ok, err := store.CreateChannelTask(channel.ID, ChannelTaskInput{
		Name:    "数据校验",
		Type:    ChannelTaskDataValidation,
		Enabled: boolPtr(true),
	}, "admin")
	if err != nil || !ok {
		t.Fatalf("create validation ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.StartChannelTask(channel.ID, validation.ID, "admin"); err != nil || !ok {
		t.Fatalf("start validation ok=%v err=%v", ok, err)
	}
	if _, ok, err := store.StartChannelTask(channel.ID, correction.ID, "admin"); err != nil || !ok {
		t.Fatalf("start correction after validation ok=%v err=%v", ok, err)
	}
}

func precheckItem(result ChannelPrecheckResult, key string) *ChannelPrecheckItem {
	for index := range result.Items {
		if result.Items[index].Key == key {
			return &result.Items[index]
		}
	}
	return nil
}

func boolPtr(value bool) *bool {
	return &value
}
