package app

import (
	"strings"
	"testing"
	"time"
)

type testStorePersistence struct {
	data          DatabaseShape
	found         bool
	metricSamples []NodeMetricSample
}

func (p *testStorePersistence) Load() (DatabaseShape, bool, error) {
	return cloneJSON(p.data), p.found, nil
}

func (p *testStorePersistence) Save(data DatabaseShape) error {
	p.data = cloneJSON(data)
	p.found = true
	return nil
}

func (p *testStorePersistence) Backend() string {
	return "test-rdb"
}

func (p *testStorePersistence) Location() string {
	return "memory://unit-test"
}

func (p *testStorePersistence) SaveNodeMetricSample(sample NodeMetricSample) error {
	p.metricSamples = append(p.metricSamples, cloneJSON(sample))
	return nil
}

func (p *testStorePersistence) LoadNodeMetricSamples(nodeID string, since time.Time) ([]NodeMetricSample, error) {
	samples := []NodeMetricSample{}
	for _, sample := range p.metricSamples {
		if sample.NodeID != nodeID {
			continue
		}
		collectedAt, err := time.Parse(time.RFC3339Nano, sample.CollectedAt)
		if err != nil || collectedAt.Before(since) {
			continue
		}
		samples = append(samples, cloneJSON(sample))
	}
	return samples, nil
}

func (p *testStorePersistence) PruneNodeMetricSamples(before time.Time) error {
	writeIndex := 0
	for _, sample := range p.metricSamples {
		collectedAt, err := time.Parse(time.RFC3339Nano, sample.CollectedAt)
		if err != nil || collectedAt.Before(before) {
			continue
		}
		p.metricSamples[writeIndex] = sample
		writeIndex++
	}
	p.metricSamples = p.metricSamples[:writeIndex]
	return nil
}

func newTestStore(t *testing.T) *Store {
	t.Helper()
	seed, err := createSeedData()
	if err != nil {
		t.Fatalf("createSeedData() error = %v", err)
	}
	store := &Store{
		persistence: &testStorePersistence{},
		data:        seed,
	}
	if err := store.saveLocked(); err != nil {
		t.Fatalf("save test store: %v", err)
	}
	return store
}

func TestSeedDataExcludesDemoData(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.Datasources) != 0 {
		t.Fatal("seed data should not include demo datasources")
	}
	if len(snapshot.Nodes) != 1 {
		t.Fatalf("seed data should include one local node, got %d", len(snapshot.Nodes))
	}
	node := snapshot.Nodes[0]
	if strings.HasPrefix(node.Name, "shanghai-") || strings.HasPrefix(node.Endpoint, "10.18.4.") {
		t.Fatalf("seed data should not include demo nodes, got %#v", node)
	}
}

func TestSanitizeDatasourceErrorHandlesEmptyPasswordSecret(t *testing.T) {
	message := sanitizeDatasourceError("Error 1045: Access denied for user '' (using password: NO)", Datasource{})
	if strings.Contains(message, "******E******") {
		t.Fatalf("empty password secret should not be replaced between characters: %s", message)
	}
}
