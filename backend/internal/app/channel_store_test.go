package app

import "testing"

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
