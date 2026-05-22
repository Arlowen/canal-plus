package app

import (
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	store, err := NewStore(filepath.Join(t.TempDir(), "store.json"))
	if err != nil {
		t.Fatalf("NewStore() error = %v", err)
	}
	return store
}

func TestNodeOfflineTriggersLeaseTakeover(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()

	var activeNode ClusterNode
	found := false
	for _, node := range before.Nodes {
		if node.Status == NodeOnline && node.RunningTasks > 0 {
			activeNode = node
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected at least one online node with running tasks, got %#v", before.Nodes)
	}
	affectedTasks := map[string]bool{}
	for _, lease := range before.Leases {
		if lease.NodeID == activeNode.ID {
			affectedTasks[lease.TaskID] = true
		}
	}

	if _, ok, err := store.MarkNodeStatus(activeNode.ID, NodeOffline); err != nil || !ok {
		t.Fatalf("MarkNodeStatus(%q, offline) = ok %v, err %v", activeNode.ID, ok, err)
	}

	after := store.ClusterSnapshot()
	for _, node := range after.Nodes {
		if node.ID == activeNode.ID && node.RunningTasks != 0 {
			t.Fatalf("offline node still owns tasks: %#v", node)
		}
	}
	for _, lease := range after.Leases {
		if lease.NodeID == activeNode.ID {
			t.Fatalf("lease stayed on offline node: %#v", lease)
		}
		if affectedTasks[lease.TaskID] && lease.TakeoverCount == 0 {
			t.Fatalf("takeover count was not incremented: %#v", lease)
		}
	}
	if after.Failovers <= before.Failovers {
		t.Fatalf("expected failover count to increase, before %d after %d", before.Failovers, after.Failovers)
	}
}

func TestRebalanceKeepsLeasesOnOnlineNodes(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()
	offlineID := before.Nodes[0].ID
	if _, ok, err := store.MarkNodeStatus(offlineID, NodeOffline); err != nil || !ok {
		t.Fatalf("MarkNodeStatus(%q, offline) = ok %v, err %v", offlineID, ok, err)
	}

	after, err := store.RebalanceCluster()
	if err != nil {
		t.Fatalf("RebalanceCluster() error = %v", err)
	}

	onlineNodes := map[string]bool{}
	for _, node := range after.Nodes {
		if node.Status == NodeOnline {
			onlineNodes[node.ID] = true
		}
	}
	for _, lease := range after.Leases {
		if !onlineNodes[lease.NodeID] {
			t.Fatalf("lease assigned to non-online node: %#v", lease)
		}
	}

	leaseCounts := map[string]int{}
	for nodeID := range onlineNodes {
		leaseCounts[nodeID] = 0
	}
	for _, lease := range after.Leases {
		leaseCounts[lease.NodeID]++
	}
	minLeases := len(after.Leases)
	maxLeases := 0
	for _, count := range leaseCounts {
		if count < minLeases {
			minLeases = count
		}
		if count > maxLeases {
			maxLeases = count
		}
	}
	if maxLeases-minLeases > 1 {
		t.Fatalf("expected balanced leases across online nodes, got %#v", leaseCounts)
	}
}

func TestStaleHeartbeatTriggersAutomaticTakeover(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()

	var activeNode ClusterNode
	for _, node := range before.Nodes {
		if node.Status == NodeOnline && node.RunningTasks > 0 {
			activeNode = node
			break
		}
	}
	if activeNode.ID == "" {
		t.Fatalf("expected active node in snapshot: %#v", before.Nodes)
	}

	affectedTasks := map[string]bool{}
	for _, lease := range before.Leases {
		if lease.NodeID == activeNode.ID {
			affectedTasks[lease.TaskID] = true
		}
	}

	store.mu.Lock()
	for index := range store.data.Nodes {
		if store.data.Nodes[index].ID == activeNode.ID {
			store.data.Nodes[index].LastHeartbeatAt = time.Now().UTC().Add(-nodeHeartbeatTimeout - time.Second).Format(time.RFC3339Nano)
			break
		}
	}
	store.mu.Unlock()

	after := store.ClusterSnapshot()
	for _, node := range after.Nodes {
		if node.ID == activeNode.ID {
			if node.Status != NodeOffline {
				t.Fatalf("stale node was not marked offline: %#v", node)
			}
			if node.RunningTasks != 0 {
				t.Fatalf("stale node still has running tasks: %#v", node)
			}
		}
	}
	for _, lease := range after.Leases {
		if lease.NodeID == activeNode.ID {
			t.Fatalf("lease stayed on stale node: %#v", lease)
		}
		if affectedTasks[lease.TaskID] && lease.TakeoverCount == 0 {
			t.Fatalf("stale heartbeat takeover did not increment count: %#v", lease)
		}
	}
	if after.DegradedNodes == 0 {
		t.Fatalf("expected degraded node count to be reported")
	}
}

func TestNonRunningTasksDoNotHoldLeases(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}

	copyTask, ok, err := store.CopyTask(snapshot.SyncTasks[0].ID)
	if err != nil || !ok {
		t.Fatalf("CopyTask() ok %v err %v", ok, err)
	}
	if copyTask.Status != TaskDraft {
		t.Fatalf("expected draft copy, got %s", copyTask.Status)
	}

	paused, ok, err := store.TransitionTask(snapshot.SyncTasks[0].ID, "pause")
	if err != nil || !ok {
		t.Fatalf("TransitionTask(pause) ok %v err %v", ok, err)
	}
	if paused.Status != TaskPaused {
		t.Fatalf("expected paused status, got %s", paused.Status)
	}

	cluster := store.ClusterSnapshot()
	for _, lease := range cluster.Leases {
		if lease.TaskID == copyTask.ID || lease.TaskID == paused.ID {
			t.Fatalf("non-running task still holds lease: %#v", lease)
		}
	}
}

func TestAllNodesUnavailableReleasesLeases(t *testing.T) {
	store := newTestStore(t)

	store.mu.Lock()
	staleHeartbeat := time.Now().UTC().Add(-nodeHeartbeatTimeout - time.Second).Format(time.RFC3339Nano)
	for index := range store.data.Nodes {
		store.data.Nodes[index].Status = NodeOnline
		store.data.Nodes[index].LastHeartbeatAt = staleHeartbeat
	}
	store.mu.Unlock()

	cluster := store.ClusterSnapshot()
	if len(cluster.Leases) != 0 {
		t.Fatalf("expected leases to be released when no node is available, got %#v", cluster.Leases)
	}
	for _, node := range cluster.Nodes {
		if node.Status != NodeOffline {
			t.Fatalf("expected stale node to be offline: %#v", node)
		}
		if node.RunningTasks != 0 {
			t.Fatalf("offline node should not report running tasks: %#v", node)
		}
	}
}

func TestRebalanceDistributesHotNode(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}
	base := snapshot.SyncTasks[0]
	for index := 0; index < 4; index++ {
		base.ID = ""
		base.Name = "rebalance-test"
		base.Status = TaskPending
		if _, err := store.CreateTask(base); err != nil {
			t.Fatalf("CreateTask() error = %v", err)
		}
	}

	store.mu.Lock()
	for runtimeIndex := range store.data.RuntimeStates {
		runtime := &store.data.RuntimeStates[runtimeIndex]
		runtime.NodeID = "node-shanghai-a"
		runtime.LeaseExpiresAt = leaseExpiry()
		store.upsertLeaseLocked(runtime.TaskID, runtime.NodeID, false)
	}
	store.recountNodeTasksLocked()
	store.mu.Unlock()

	cluster, err := store.RebalanceCluster()
	if err != nil {
		t.Fatalf("RebalanceCluster() error = %v", err)
	}

	counts := map[string]int{}
	for _, node := range cluster.Nodes {
		if node.Status == NodeOnline {
			counts[node.ID] = 0
		}
	}
	for _, lease := range cluster.Leases {
		counts[lease.NodeID]++
	}
	minLeases := len(cluster.Leases)
	maxLeases := 0
	for _, count := range counts {
		if count < minLeases {
			minLeases = count
		}
		if count > maxLeases {
			maxLeases = count
		}
	}
	if maxLeases-minLeases > 1 {
		t.Fatalf("expected rebalance to distribute hot node leases, got %#v", counts)
	}
}

func TestCreateCapabilityJobBuildsSummaryAndSteps(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}

	job, err := store.CreateCapabilityJob(CapabilityJob{
		Type:      CapabilityQuality,
		TaskID:    snapshot.SyncTasks[0].ID,
		Mode:      "verify_then_correct",
		AutoStart: true,
	})
	if err != nil {
		t.Fatalf("CreateCapabilityJob() error = %v", err)
	}
	if job.ID == "" || job.Name == "" {
		t.Fatalf("expected persisted job identity: %#v", job)
	}
	if job.Status != CapabilityRunning {
		t.Fatalf("expected running job, got %s", job.Status)
	}
	if len(job.Steps) < 4 {
		t.Fatalf("expected CloudCanal-like multi-step job: %#v", job.Steps)
	}
	if job.Summary.Tables == 0 || job.Summary.Columns == 0 || job.Summary.DiffRows == 0 {
		t.Fatalf("expected populated quality summary: %#v", job.Summary)
	}
}

func TestCompletedSubscriptionJobAppliesTaskMapping(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}
	taskID := snapshot.SyncTasks[0].ID
	initialMappings := len(snapshot.SyncTasks[0].TableMappings)

	job, err := store.CreateCapabilityJob(CapabilityJob{
		Type:      CapabilitySubscription,
		TaskID:    taskID,
		Mode:      "add_tables",
		AutoStart: true,
	})
	if err != nil {
		t.Fatalf("CreateCapabilityJob() error = %v", err)
	}

	store.mu.Lock()
	for index := range store.data.CapabilityJobs {
		if store.data.CapabilityJobs[index].ID == job.ID {
			store.data.CapabilityJobs[index].Status = CapabilityCompleted
			store.applySubscriptionJobLocked(&store.data.CapabilityJobs[index])
			break
		}
	}
	store.mu.Unlock()

	updated, ok := store.GetTask(taskID)
	if !ok {
		t.Fatalf("task %s not found", taskID)
	}
	if len(updated.TableMappings) <= initialMappings {
		t.Fatalf("expected subscription mapping to be added, before %d after %d", initialMappings, len(updated.TableMappings))
	}
}

func TestUpdateTaskParametersIncrementsConfigVersion(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]
	nextBatchSize := task.Strategy.BatchSize + 512
	nextRetries := task.Strategy.RetryTimes + 1

	updated, ok, err := store.UpdateTaskParameters(task.ID, TaskParameterPatch{
		BatchSize:  &nextBatchSize,
		RetryTimes: &nextRetries,
	})
	if err != nil || !ok {
		t.Fatalf("UpdateTaskParameters() ok %v err %v", ok, err)
	}
	if updated.ConfigVersion != task.ConfigVersion+1 {
		t.Fatalf("expected config version increment, before %d after %d", task.ConfigVersion, updated.ConfigVersion)
	}
	if updated.Strategy.BatchSize != nextBatchSize || updated.Strategy.RetryTimes != nextRetries {
		t.Fatalf("parameter patch not applied: %#v", updated.Strategy)
	}
}

func TestResetTaskPositionRequiresStoppedTask(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]

	if _, _, err := store.ResetTaskPosition(task.ID, PositionResetInput{
		BinlogFile:     "mysql-bin.000777",
		BinlogPosition: 8821,
	}); err == nil {
		t.Fatal("expected reset position to require stopped task")
	}

	if _, ok, err := store.TransitionTask(task.ID, "stop"); err != nil || !ok {
		t.Fatalf("TransitionTask(stop) ok %v err %v", ok, err)
	}
	updated, ok, err := store.ResetTaskPosition(task.ID, PositionResetInput{
		BinlogFile:     "mysql-bin.000777",
		BinlogPosition: 8821,
		ServerID:       "18721",
	})
	if err != nil || !ok {
		t.Fatalf("ResetTaskPosition() ok %v err %v", ok, err)
	}
	runtime, ok := store.Runtime(updated.ID)
	if !ok {
		t.Fatalf("runtime missing for task %s", updated.ID)
	}
	if runtime.BinlogFile != "mysql-bin.000777" || runtime.BinlogPosition != 8821 {
		t.Fatalf("position not reset: %#v", runtime)
	}
}
