package app

import "testing"

func TestRefreshNodeHeartbeatWithMetricsUpdatesSnapshotAndHistory(t *testing.T) {
	store := newTestStore(t)
	nodeID := store.ClusterSnapshot().Nodes[0].ID

	err := store.RefreshNodeHeartbeatWithMetrics(nodeID, NodeMetricSample{
		CPUPercent:    18,
		MemoryPercent: 42,
		DiskPercent:   61,
		NetworkMBps:   12.6,
	})
	if err != nil {
		t.Fatalf("RefreshNodeHeartbeatWithMetrics() error = %v", err)
	}

	snapshot := store.ClusterSnapshot()
	node := snapshot.Nodes[0]
	if node.CPUPercent != 18 || node.MemoryPercent != 42 || node.DiskPercent != 61 || node.NetworkMBps != 12.6 {
		t.Fatalf("node metrics not updated: %#v", node)
	}

	store.metricHistory = nil
	history, ok := store.NodeMetricHistory(nodeID, "3h")
	if !ok {
		t.Fatal("NodeMetricHistory() returned not found")
	}
	if history.Range != "3h" {
		t.Fatalf("unexpected range: %s", history.Range)
	}
	if len(history.Samples) != 1 {
		t.Fatalf("expected one metric sample, got %d", len(history.Samples))
	}
	sample := history.Samples[0]
	if sample.NodeID != nodeID || sample.CPUPercent != 18 || sample.MemoryPercent != 42 || sample.DiskPercent != 61 || sample.NetworkMBps != 12.6 {
		t.Fatalf("unexpected history sample: %#v", sample)
	}
}

func TestNodeMetricHistoryDefaultsToCurrentNodeWhenNoSamples(t *testing.T) {
	store := newTestStore(t)
	node := store.ClusterSnapshot().Nodes[0]

	history, ok := store.NodeMetricHistory(node.ID, "1mo")
	if !ok {
		t.Fatal("NodeMetricHistory() returned not found")
	}
	if history.Range != "1mo" {
		t.Fatalf("unexpected range: %s", history.Range)
	}
	if len(history.Samples) != 1 {
		t.Fatalf("expected fallback sample, got %d", len(history.Samples))
	}
	if history.Samples[0].NodeID != node.ID {
		t.Fatalf("fallback sample should use node id, got %#v", history.Samples[0])
	}
}
