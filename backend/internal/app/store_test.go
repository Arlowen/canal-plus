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

func TestTaskCheckpointsCaptureRuntimeAndFailover(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()

	var activeLease TaskLease
	for _, lease := range before.Leases {
		if lease.NodeID != "" {
			activeLease = lease
			break
		}
	}
	if activeLease.TaskID == "" {
		t.Fatalf("expected active lease in snapshot: %#v", before.Leases)
	}

	initial := store.TaskCheckpoints(activeLease.TaskID)
	if len(initial) == 0 {
		t.Fatal("expected initial task checkpoint")
	}
	if initial[0].BinlogFile == "" || initial[0].BinlogPosition <= 0 {
		t.Fatalf("checkpoint missing binlog position: %#v", initial[0])
	}

	if _, ok, err := store.MarkNodeStatus(activeLease.NodeID, NodeOffline); err != nil || !ok {
		t.Fatalf("MarkNodeStatus(%q, offline) = ok %v, err %v", activeLease.NodeID, ok, err)
	}

	checkpoints := store.TaskCheckpoints(activeLease.TaskID)
	var takeover TaskCheckpoint
	for _, checkpoint := range checkpoints {
		if checkpoint.Reason == "failover_takeover" {
			takeover = checkpoint
			break
		}
	}
	if takeover.ID == "" {
		t.Fatalf("expected failover checkpoint, got %#v", checkpoints)
	}
	if takeover.PreviousNodeID != activeLease.NodeID {
		t.Fatalf("expected previous node %q, got %#v", activeLease.NodeID, takeover)
	}
	if takeover.NodeID == "" || takeover.NodeID == activeLease.NodeID {
		t.Fatalf("expected checkpoint to hand off to another node: %#v", takeover)
	}
	if takeover.LeaseEpoch <= activeLease.Epoch || takeover.TakeoverCount == 0 {
		t.Fatalf("expected checkpoint lease epoch and takeover count to advance: %#v", takeover)
	}
}

func TestFailoverDrillReturnsTakeoverReport(t *testing.T) {
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

	affectedBefore := map[string]TaskLease{}
	for _, lease := range before.Leases {
		if lease.NodeID == activeNode.ID {
			affectedBefore[lease.TaskID] = lease
		}
	}

	report, ok, err := store.FailoverDrill(activeNode.ID)
	if err != nil || !ok {
		t.Fatalf("FailoverDrill(%q) = ok %v, err %v", activeNode.ID, ok, err)
	}
	if !report.Success {
		t.Fatalf("expected drill to succeed: %#v", report)
	}
	if len(report.AffectedTasks) != len(affectedBefore) {
		t.Fatalf("affected task count mismatch, before %d report %d", len(affectedBefore), len(report.AffectedTasks))
	}
	if report.After.Failovers <= report.Before.Failovers {
		t.Fatalf("expected failover count to increase, before %d after %d", report.Before.Failovers, report.After.Failovers)
	}
	for _, transition := range report.AffectedTasks {
		if transition.PreviousNodeID != activeNode.ID {
			t.Fatalf("unexpected previous node in transition: %#v", transition)
		}
		if transition.NewNodeID == "" || transition.NewNodeID == activeNode.ID {
			t.Fatalf("task was not moved to another node: %#v", transition)
		}
		if transition.TakeoverCount == 0 {
			t.Fatalf("takeover count not incremented: %#v", transition)
		}
		if transition.PreviousLeaseEpoch != affectedBefore[transition.TaskID].Epoch || transition.LeaseEpoch <= transition.PreviousLeaseEpoch {
			t.Fatalf("lease epoch transition missing: %#v", transition)
		}
		if transition.RecoveryBinlogFile == "" || transition.RecoveryBinlogPosition <= 0 {
			t.Fatalf("recovery position missing: %#v", transition)
		}
	}
	for _, node := range report.After.Nodes {
		if node.ID == activeNode.ID && node.Status != NodeOffline {
			t.Fatalf("drilled node should be offline: %#v", node)
		}
	}
}

func TestTakeNodeOfflineReturnsHandoffReport(t *testing.T) {
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

	report, ok, err := store.TakeNodeOffline(activeNode.ID)
	if err != nil || !ok {
		t.Fatalf("TakeNodeOffline() ok %v err %v", ok, err)
	}
	if report.Action != "offline" || report.Node.ID != activeNode.ID {
		t.Fatalf("unexpected offline report: %#v", report)
	}
	if report.Before.TotalNodes == 0 || report.After.TotalNodes == 0 {
		t.Fatalf("expected before/after snapshots: %#v", report)
	}
}

func TestBringNodeOnlineReturnsRecoveryReport(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.ClusterSnapshot()

	var offlineNode ClusterNode
	for _, node := range snapshot.Nodes {
		if node.ID != "node-shanghai-a" {
			offlineNode = node
			break
		}
	}
	if offlineNode.ID == "" {
		t.Fatalf("expected secondary node in snapshot: %#v", snapshot.Nodes)
	}

	store.mu.Lock()
	for index := range store.data.Nodes {
		if store.data.Nodes[index].ID == offlineNode.ID {
			store.data.Nodes[index].Status = NodeOffline
		}
	}
	store.mu.Unlock()

	report, ok, err := store.BringNodeOnline(offlineNode.ID)
	if err != nil || !ok {
		t.Fatalf("BringNodeOnline() ok %v err %v", ok, err)
	}
	if report.Action != "online" || report.Node.ID != offlineNode.ID {
		t.Fatalf("unexpected online report: %#v", report)
	}
	if report.After.OnlineNodes < report.Before.OnlineNodes {
		t.Fatalf("expected online node count to recover: before=%#v after=%#v", report.Before, report.After)
	}
	recoveredRunningTasks := 0
	for _, node := range report.After.Nodes {
		if node.ID == offlineNode.ID {
			recoveredRunningTasks = node.RunningTasks
			break
		}
	}
	if recoveredRunningTasks == 0 && len(report.AffectedTasks) == 0 {
		t.Fatalf("expected recovered node to resume task capacity or trigger rebalance: %#v", report)
	}
}

func TestDrainNodeReturnsMaintenanceHandoffReport(t *testing.T) {
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

	affectedBefore := map[string]TaskLease{}
	for _, lease := range before.Leases {
		if lease.NodeID == activeNode.ID {
			affectedBefore[lease.TaskID] = lease
		}
	}

	report, ok, err := store.DrainNode(activeNode.ID)
	if err != nil || !ok {
		t.Fatalf("DrainNode(%q) = ok %v, err %v", activeNode.ID, ok, err)
	}
	if !report.Success {
		t.Fatalf("expected drain to succeed: %#v", report)
	}
	if report.Node.Status != NodeDraining {
		t.Fatalf("expected report node to be draining: %#v", report.Node)
	}
	if len(report.AffectedTasks) != len(affectedBefore) {
		t.Fatalf("affected task count mismatch, before %d report %d", len(affectedBefore), len(report.AffectedTasks))
	}
	for _, transition := range report.AffectedTasks {
		if transition.PreviousNodeID != activeNode.ID {
			t.Fatalf("unexpected previous node in transition: %#v", transition)
		}
		if transition.NewNodeID == "" || transition.NewNodeID == activeNode.ID {
			t.Fatalf("task was not moved to another node: %#v", transition)
		}
		if transition.LeaseEpoch <= transition.PreviousLeaseEpoch {
			t.Fatalf("expected lease epoch to advance: %#v", transition)
		}
		if transition.RecoveryBinlogFile == "" || transition.RecoveryBinlogPosition <= 0 {
			t.Fatalf("recovery position missing: %#v", transition)
		}
	}
	for _, node := range report.After.Nodes {
		if node.ID == activeNode.ID {
			if node.Status != NodeDraining {
				t.Fatalf("drained node should stay draining: %#v", node)
			}
			if node.RunningTasks != 0 {
				t.Fatalf("drained node should not own tasks: %#v", node)
			}
		}
	}
}

func TestRebalanceKeepsLeasesOnOnlineNodes(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()
	offlineID := before.Nodes[0].ID
	if _, ok, err := store.MarkNodeStatus(offlineID, NodeOffline); err != nil || !ok {
		t.Fatalf("MarkNodeStatus(%q, offline) = ok %v, err %v", offlineID, ok, err)
	}

	report, err := store.RebalanceCluster()
	if err != nil {
		t.Fatalf("RebalanceCluster() error = %v", err)
	}
	after := report.After

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

func TestTaskRevisionRollbackRestoresConfiguration(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatalf("expected seed task")
	}
	task := snapshot.SyncTasks[0]
	originalBatchSize := task.Strategy.BatchSize
	nextBatchSize := originalBatchSize + 257

	updated, ok, err := store.UpdateTaskParameters(task.ID, TaskParameterPatch{BatchSize: &nextBatchSize})
	if err != nil || !ok {
		t.Fatalf("UpdateTaskParameters() = ok %v err %v", ok, err)
	}
	if updated.ConfigVersion <= task.ConfigVersion {
		t.Fatalf("expected config version to increase, before %d after %d", task.ConfigVersion, updated.ConfigVersion)
	}

	revisions := store.TaskRevisions(task.ID)
	if len(revisions) < 2 {
		t.Fatalf("expected at least two revisions, got %#v", revisions)
	}
	if revisions[0].Version != updated.ConfigVersion {
		t.Fatalf("expected latest revision to match updated version, got %#v", revisions[0])
	}

	rolledBack, ok, err := store.RollbackTaskRevision(task.ID, task.ConfigVersion)
	if err != nil || !ok {
		t.Fatalf("RollbackTaskRevision() = ok %v err %v", ok, err)
	}
	if rolledBack.Strategy.BatchSize != originalBatchSize {
		t.Fatalf("expected batch size %d after rollback, got %d", originalBatchSize, rolledBack.Strategy.BatchSize)
	}
	if rolledBack.ConfigVersion <= updated.ConfigVersion {
		t.Fatalf("rollback should create a new version, before %d after %d", updated.ConfigVersion, rolledBack.ConfigVersion)
	}
	revisions = store.TaskRevisions(task.ID)
	if revisions[0].ChangeType != "rollback" {
		t.Fatalf("expected latest revision to be rollback, got %#v", revisions[0])
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

func TestReconcileClusterRenewsHealthyNodeLease(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()
	if len(before.Leases) == 0 {
		t.Fatalf("expected active leases in snapshot")
	}
	lease := before.Leases[0]
	shortExpiry := time.Now().UTC().Add(time.Second).Format(time.RFC3339Nano)

	store.mu.Lock()
	for index := range store.data.RuntimeStates {
		if store.data.RuntimeStates[index].TaskID == lease.TaskID {
			store.data.RuntimeStates[index].LeaseExpiresAt = shortExpiry
			store.data.RuntimeStates[index].NodeID = lease.NodeID
			break
		}
	}
	for index := range store.data.TaskLeases {
		if store.data.TaskLeases[index].TaskID == lease.TaskID {
			store.data.TaskLeases[index].ExpiresAt = shortExpiry
			break
		}
	}
	store.mu.Unlock()

	after, err := store.ReconcileCluster()
	if err != nil {
		t.Fatalf("ReconcileCluster() error = %v", err)
	}
	var renewed TaskLease
	for _, item := range after.Leases {
		if item.TaskID == lease.TaskID {
			renewed = item
			break
		}
	}
	if renewed.TaskID == "" {
		t.Fatalf("expected renewed lease for task %s", lease.TaskID)
	}
	if renewed.NodeID != lease.NodeID {
		t.Fatalf("healthy node lease moved unexpectedly: before %s after %s", lease.NodeID, renewed.NodeID)
	}
	renewedExpiry, err := time.Parse(time.RFC3339Nano, renewed.ExpiresAt)
	if err != nil {
		t.Fatalf("renewed lease expiry parse error: %v", err)
	}
	oldExpiry, err := time.Parse(time.RFC3339Nano, shortExpiry)
	if err != nil {
		t.Fatalf("old lease expiry parse error: %v", err)
	}
	if !renewedExpiry.After(oldExpiry) {
		t.Fatalf("expected lease expiry to be renewed, old %s new %s", shortExpiry, renewed.ExpiresAt)
	}
}

func TestClusterSupervisorRunsTakeoverWithoutSnapshotRequest(t *testing.T) {
	store := newTestStore(t)
	before := store.ClusterSnapshot()

	var activeNode ClusterNode
	affectedTasks := map[string]bool{}
	for _, node := range before.Nodes {
		if node.Status == NodeOnline && node.RunningTasks > 0 {
			activeNode = node
			break
		}
	}
	if activeNode.ID == "" {
		t.Fatalf("expected active node in snapshot: %#v", before.Nodes)
	}
	for _, lease := range before.Leases {
		if lease.NodeID == activeNode.ID {
			affectedTasks[lease.TaskID] = true
		}
	}
	if len(affectedTasks) == 0 {
		t.Fatalf("expected affected leases for active node %s", activeNode.ID)
	}

	store.mu.Lock()
	for index := range store.data.Nodes {
		if store.data.Nodes[index].ID == activeNode.ID {
			store.data.Nodes[index].LastHeartbeatAt = time.Now().UTC().Add(-nodeHeartbeatTimeout - time.Second).Format(time.RFC3339Nano)
			break
		}
	}
	store.mu.Unlock()

	stop := store.StartClusterSupervisor(10 * time.Millisecond)
	defer stop()

	deadline := time.After(600 * time.Millisecond)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-deadline:
			t.Fatalf("supervisor did not take over leases from stale node %s", activeNode.ID)
		case <-ticker.C:
			store.mu.Lock()
			nodeOffline := false
			leaseStayed := false
			takeoverMissing := false
			for _, node := range store.data.Nodes {
				if node.ID == activeNode.ID {
					nodeOffline = node.Status == NodeOffline && node.RunningTasks == 0
					break
				}
			}
			for _, lease := range store.data.TaskLeases {
				if lease.NodeID == activeNode.ID {
					leaseStayed = true
				}
				if affectedTasks[lease.TaskID] && lease.TakeoverCount == 0 {
					takeoverMissing = true
				}
			}
			store.mu.Unlock()
			if nodeOffline && !leaseStayed && !takeoverMissing {
				return
			}
		}
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

func TestRegisterNodeUpsertsAndTakesOverWaitingTasks(t *testing.T) {
	store := newTestStore(t)

	store.mu.Lock()
	for index := range store.data.Nodes {
		store.data.Nodes[index].Status = NodeOffline
	}
	for runtimeIndex := range store.data.RuntimeStates {
		store.data.RuntimeStates[runtimeIndex].NodeID = ""
		store.data.RuntimeStates[runtimeIndex].LeaseExpiresAt = ""
	}
	store.data.TaskLeases = nil
	store.mu.Unlock()

	node, created, err := store.RegisterNode(ClusterNodeInput{
		ID:            "node-hangzhou-d",
		Name:          "hangzhou-d",
		Endpoint:      "10.8.0.14:4101",
		Zone:          "hangzhou",
		Role:          "worker",
		Capacity:      3,
		CPUPercent:    27,
		MemoryPercent: 44,
	})
	if err != nil {
		t.Fatalf("RegisterNode() error = %v", err)
	}
	if !created || node.ID != "node-hangzhou-d" || node.Status != NodeOnline {
		t.Fatalf("unexpected registered node: created=%v node=%#v", created, node)
	}

	cluster := store.ClusterSnapshot()
	if cluster.OnlineNodes != 1 {
		t.Fatalf("expected exactly one online node, got %#v", cluster.Nodes)
	}
	if len(cluster.Leases) == 0 {
		t.Fatalf("expected waiting tasks to be assigned to registered node")
	}
	for _, lease := range cluster.Leases {
		if lease.NodeID != node.ID {
			t.Fatalf("expected lease on registered node, got %#v", lease)
		}
	}

	updated, created, err := store.RegisterNode(ClusterNodeInput{
		ID:       node.ID,
		Name:     "hangzhou-d-resized",
		Endpoint: node.Endpoint,
		Capacity: 5,
	})
	if err != nil {
		t.Fatalf("RegisterNode(upsert) error = %v", err)
	}
	if created || updated.Name != "hangzhou-d-resized" || updated.Capacity != 5 {
		t.Fatalf("expected existing node to be updated, created=%v node=%#v", created, updated)
	}
	nodes := store.ClusterSnapshot().Nodes
	seen := 0
	for _, item := range nodes {
		if item.ID == node.ID {
			seen++
		}
	}
	if seen != 1 {
		t.Fatalf("expected upsert to keep one node, seen %d in %#v", seen, nodes)
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

	report, err := store.RebalanceCluster()
	if err != nil {
		t.Fatalf("RebalanceCluster() error = %v", err)
	}
	cluster := report.After
	if len(report.MovedTasks) == 0 {
		t.Fatalf("expected rebalance report to include moved tasks: %#v", report)
	}
	for _, moved := range report.MovedTasks {
		if moved.PreviousNodeID == moved.NewNodeID || moved.NewNodeID == "" {
			t.Fatalf("expected moved task to include node handoff: %#v", moved)
		}
		if moved.RecoveryBinlogFile == "" || moved.RecoveryBinlogPosition <= 0 {
			t.Fatalf("expected moved task to include recovery position: %#v", moved)
		}
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

func TestStructureDDLApplyUpdatesPlan(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}

	job, err := store.CreateCapabilityJob(CapabilityJob{
		Type:      CapabilityStructure,
		TaskID:    snapshot.SyncTasks[0].ID,
		Mode:      "schema_prepare",
		Status:    CapabilityCompleted,
		AutoStart: true,
	})
	if err != nil {
		t.Fatalf("CreateCapabilityJob(structure) error = %v", err)
	}
	if job.ProgressPercent != 100 {
		t.Fatalf("completed structure job should start at 100%%, got %#v", job)
	}
	statements, ok := store.StructureDDLs(job.ID)
	if !ok || len(statements) == 0 {
		t.Fatalf("expected structure DDL statements, ok=%v statements=%#v", ok, statements)
	}
	if statements[0].Statement == "" || statements[0].TargetObject == "" {
		t.Fatalf("expected populated DDL statement: %#v", statements[0])
	}

	updated, ok, err := store.ApplyStructureDDLs(job.ID, StructureDDLApplyInput{
		IDs:    []string{statements[0].ID},
		Reason: "结构计划审核通过",
	})
	if err != nil || !ok {
		t.Fatalf("ApplyStructureDDLs() ok %v err %v", ok, err)
	}
	if updated.ID != job.ID {
		t.Fatalf("unexpected updated job: %#v", updated)
	}

	updatedStatements, ok := store.StructureDDLs(job.ID)
	if !ok {
		t.Fatalf("structure job missing after apply")
	}
	applied := 0
	for _, statement := range updatedStatements {
		if statement.Status == StructureDDLApplied {
			applied++
		}
	}
	if applied != 1 {
		t.Fatalf("expected one DDL statement applied, got %d in %#v", applied, updatedStatements)
	}

	if _, ok, err := store.ApplyStructureDDLs(job.ID, StructureDDLApplyInput{}); err != nil || !ok {
		t.Fatalf("ApplyStructureDDLs(all) ok %v err %v", ok, err)
	}
	updatedStatements, _ = store.StructureDDLs(job.ID)
	for _, statement := range updatedStatements {
		if statement.Status != StructureDDLApplied {
			t.Fatalf("expected all DDL statements applied: %#v", updatedStatements)
		}
	}
}

func TestQualityDiffCorrectionUpdatesSummary(t *testing.T) {
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
	diffs, ok := store.QualityDiffs(job.ID)
	if !ok || len(diffs) == 0 {
		t.Fatalf("expected quality diffs, ok=%v diffs=%#v", ok, diffs)
	}

	store.mu.Lock()
	for index := range store.data.CapabilityJobs {
		if store.data.CapabilityJobs[index].ID == job.ID {
			store.data.CapabilityJobs[index].Status = CapabilityCompleted
			store.data.CapabilityJobs[index].ProgressPercent = 100
			break
		}
	}
	store.mu.Unlock()

	updated, ok, err := store.CorrectQualityDiffs(job.ID, QualityDiffCorrectionInput{
		IDs:    []string{diffs[0].ID},
		Reason: "确认源端为准",
	})
	if err != nil || !ok {
		t.Fatalf("CorrectQualityDiffs() ok %v err %v", ok, err)
	}
	if updated.Summary.CorrectedRows != 1 {
		t.Fatalf("expected one corrected row, got %#v", updated.Summary)
	}

	updatedDiffs, ok := store.QualityDiffs(job.ID)
	if !ok {
		t.Fatalf("quality job missing after correction")
	}
	foundCorrected := false
	for _, diff := range updatedDiffs {
		if diff.ID == diffs[0].ID {
			foundCorrected = diff.Status == QualityDiffCorrected && diff.CorrectedBy == "admin"
			break
		}
	}
	if !foundCorrected {
		t.Fatalf("selected diff was not corrected: %#v", updatedDiffs)
	}

	updated, ok, err = store.CorrectQualityDiffs(job.ID, QualityDiffCorrectionInput{})
	if err != nil || !ok {
		t.Fatalf("CorrectQualityDiffs(all) ok %v err %v", ok, err)
	}
	if updated.Summary.CorrectedRows != len(diffs) {
		t.Fatalf("expected all diffs corrected, got summary %#v diff count %d", updated.Summary, len(diffs))
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
	changes, ok := store.SubscriptionChanges(job.ID)
	if !ok {
		t.Fatalf("SubscriptionChanges(%q) not found", job.ID)
	}
	if len(changes) == 0 || changes[0].ChangeType != "add_table" || changes[0].Status != SubscriptionChangePending {
		t.Fatalf("expected pending add table change, got %#v", changes)
	}

	store.mu.Lock()
	for index := range store.data.CapabilityJobs {
		if store.data.CapabilityJobs[index].ID == job.ID {
			store.data.CapabilityJobs[index].Status = CapabilityCompleted
			store.applySubscriptionJobLocked(&store.data.CapabilityJobs[index])
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
	if len(updated.TableMappings) != initialMappings+len(changes) {
		t.Fatalf("expected subscription apply to be idempotent, before %d after %d changes %d", initialMappings, len(updated.TableMappings), len(changes))
	}
	updatedChanges, ok := store.SubscriptionChanges(job.ID)
	if !ok {
		t.Fatalf("SubscriptionChanges(%q) not found after apply", job.ID)
	}
	for _, change := range updatedChanges {
		if change.Status != SubscriptionChangeApplied || change.AppliedAt == "" || change.ResultMessage == "" {
			t.Fatalf("expected applied change with result: %#v", change)
		}
	}
}

func TestSubscriptionActionFilterUpdatesTaskActions(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}
	taskID := snapshot.SyncTasks[0].ID
	originalVersion := snapshot.SyncTasks[0].ConfigVersion

	job, err := store.CreateCapabilityJob(CapabilityJob{
		Type:      CapabilitySubscription,
		TaskID:    taskID,
		Mode:      "filter_actions",
		AutoStart: true,
	})
	if err != nil {
		t.Fatalf("CreateCapabilityJob() error = %v", err)
	}
	changes, ok := store.SubscriptionChanges(job.ID)
	if !ok || len(changes) != 1 {
		t.Fatalf("expected one subscription action change, ok %v changes %#v", ok, changes)
	}
	if !containsString(changes[0].BeforeActions, "delete") || containsString(changes[0].AfterActions, "delete") {
		t.Fatalf("expected delete action to be filtered out: %#v", changes[0])
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
	if updated.ConfigVersion != originalVersion+1 {
		t.Fatalf("expected config version increment, before %d after %d", originalVersion, updated.ConfigVersion)
	}
	if updated.Strategy.WriteMode.Delete {
		t.Fatalf("expected delete action disabled: %#v", updated.Strategy.WriteMode)
	}
	for _, mapping := range updated.TableMappings {
		if containsString(mapping.EventActions, "delete") || !containsString(mapping.EventActions, "insert") || !containsString(mapping.EventActions, "update") {
			t.Fatalf("unexpected mapping event actions: %#v", mapping.EventActions)
		}
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
	checkpoints := store.TaskCheckpoints(updated.ID)
	if len(checkpoints) == 0 {
		t.Fatal("expected manual reset checkpoint")
	}
	if checkpoints[0].Reason != "manual_reset" {
		t.Fatalf("expected latest checkpoint to be manual_reset, got %#v", checkpoints[0])
	}
	if checkpoints[0].BinlogFile != "mysql-bin.000777" || checkpoints[0].BinlogPosition != 8821 {
		t.Fatalf("checkpoint position not reset: %#v", checkpoints[0])
	}
}

func TestRerunTaskRequiresStoppedOrFailedTask(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]

	if _, _, err := store.RerunTask(task.ID); err == nil {
		t.Fatal("expected rerun to require stopped or failed task")
	}
	if _, ok, err := store.TransitionTask(task.ID, "stop"); err != nil || !ok {
		t.Fatalf("TransitionTask(stop) ok %v err %v", ok, err)
	}
	rerun, ok, err := store.RerunTask(task.ID)
	if err != nil || !ok {
		t.Fatalf("RerunTask() ok %v err %v", ok, err)
	}
	if rerun.Status != TaskFullSyncing && rerun.Status != TaskIncrementalRunning && rerun.Status != TaskPending {
		t.Fatalf("unexpected rerun status: %s", rerun.Status)
	}
	runtime, ok := store.Runtime(task.ID)
	if !ok {
		t.Fatalf("runtime missing for task %s", task.ID)
	}
	if runtime.BinlogFile != "mysql-bin.000001" || runtime.BinlogPosition != 4 {
		t.Fatalf("rerun did not reset binlog position: %#v", runtime)
	}
	if rerun.Status != TaskPending && runtime.NodeID == "" {
		t.Fatalf("rerun task should be assigned when online nodes exist: %#v", runtime)
	}
	cluster := store.ClusterSnapshot()
	for _, lease := range cluster.Leases {
		if lease.TaskID == task.ID && lease.TakeoverCount != 0 {
			t.Fatalf("rerun assignment should not count as failover: %#v", lease)
		}
	}
}

func TestDeleteTaskRequiresDraftOrStoppedTask(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]

	if _, ok, err := store.TransitionTask(task.ID, "start"); err != nil || !ok {
		t.Fatalf("TransitionTask(start) ok %v err %v", ok, err)
	}
	if deleted, err := store.DeleteTask(task.ID); err == nil || deleted {
		t.Fatalf("expected running task delete to be rejected, deleted %v err %v", deleted, err)
	}
	if _, ok, err := store.TransitionTask(task.ID, "stop"); err != nil || !ok {
		t.Fatalf("TransitionTask(stop) ok %v err %v", ok, err)
	}
	if deleted, err := store.DeleteTask(task.ID); err != nil || !deleted {
		t.Fatalf("DeleteTask(stopped) deleted %v err %v", deleted, err)
	}
	if _, ok := store.GetTask(task.ID); ok {
		t.Fatalf("deleted task %s still exists", task.ID)
	}
	cluster := store.ClusterSnapshot()
	for _, lease := range cluster.Leases {
		if lease.TaskID == task.ID {
			t.Fatalf("deleted task still holds lease: %#v", lease)
		}
	}
}

func TestTransitionTaskWritesTaskLog(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]

	if _, ok, err := store.TransitionTask(task.ID, "pause"); err != nil || !ok {
		t.Fatalf("TransitionTask(pause) ok %v err %v", ok, err)
	}

	logs := store.Snapshot().TaskLogs
	found := false
	for _, entry := range logs {
		if entry.TaskID == task.ID && entry.Message == "任务已暂停" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected task pause log entry, got %#v", logs)
	}
}

func TestDeleteTaskRemovesTaskLogs(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]

	if _, ok, err := store.TransitionTask(task.ID, "stop"); err != nil || !ok {
		t.Fatalf("TransitionTask(stop) ok %v err %v", ok, err)
	}
	if deleted, err := store.DeleteTask(task.ID); err != nil || !deleted {
		t.Fatalf("DeleteTask() deleted %v err %v", deleted, err)
	}

	for _, entry := range store.Snapshot().TaskLogs {
		if entry.TaskID == task.ID {
			t.Fatalf("expected task logs removed after delete, got %#v", entry)
		}
	}
}

func TestUpgradeNodeReturnsTaskHandoffs(t *testing.T) {
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

	result, ok, err := store.UpgradeNode(activeNode.ID)
	if err != nil || !ok {
		t.Fatalf("UpgradeNode() ok %v err %v", ok, err)
	}
	if !result.Success {
		t.Fatalf("expected upgrade success: %#v", result)
	}
	if result.Node == nil || result.Node.Version == activeNode.Version {
		t.Fatalf("expected version update: before=%#v result=%#v", activeNode, result)
	}
	if result.Before == nil || result.After == nil {
		t.Fatalf("expected before/after snapshots in result: %#v", result)
	}
	if len(result.AffectedTasks) == 0 {
		t.Fatalf("expected upgrade to report migrated tasks: %#v", result)
	}
}

func TestUninstallNodeRollbackOnMigrationFailure(t *testing.T) {
	store := newTestStore(t)
	initial := store.ClusterSnapshot()

	var activeNode ClusterNode
	for _, node := range initial.Nodes {
		if node.Status == NodeOnline && node.RunningTasks > 0 {
			activeNode = node
			break
		}
	}
	if activeNode.ID == "" {
		t.Fatalf("expected active node in snapshot: %#v", initial.Nodes)
	}

	store.mu.Lock()
	for index := range store.data.Nodes {
		if store.data.Nodes[index].ID != activeNode.ID {
			store.data.Nodes[index].Status = NodeOffline
		}
	}
	store.mu.Unlock()

	result, ok, err := store.UninstallNode(activeNode.ID)
	if err != nil || !ok {
		t.Fatalf("UninstallNode() ok %v err %v", ok, err)
	}
	if result.Success {
		t.Fatalf("expected uninstall to fail without available target nodes: %#v", result)
	}

	after := store.ClusterSnapshot()
	var restored ClusterNode
	for _, node := range after.Nodes {
		if node.ID == activeNode.ID {
			restored = node
			break
		}
	}
	if restored.ID == "" || restored.Status != NodeOnline {
		t.Fatalf("expected node state rollback after uninstall failure: %#v", after.Nodes)
	}
}

func TestAlertRuleCrudAndEvaluation(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	if len(snapshot.SyncTasks) == 0 {
		t.Fatal("expected seed task")
	}
	task := snapshot.SyncTasks[0]
	enabled := true

	rule, err := store.CreateAlertRule(AlertRuleInput{
		Name:                  "高延迟验证",
		Enabled:               &enabled,
		TaskID:                task.ID,
		DelayThresholdSeconds: 5,
		ErrorThreshold:        1,
		WebhookURL:            "https://example.com/webhook",
	})
	if err != nil {
		t.Fatalf("CreateAlertRule() error = %v", err)
	}
	if rule.ID == "" || !rule.Enabled || rule.TaskID != task.ID {
		t.Fatalf("unexpected created rule: %#v", rule)
	}

	updatedEnabled := false
	updated, ok, err := store.UpdateAlertRule(rule.ID, AlertRuleInput{
		Name:                  "高延迟验证已关闭",
		Enabled:               &updatedEnabled,
		TaskID:                task.ID,
		DelayThresholdSeconds: 10,
		ErrorThreshold:        0,
	})
	if err != nil || !ok {
		t.Fatalf("UpdateAlertRule() ok %v err %v", ok, err)
	}
	if updated.Enabled || updated.Name != "高延迟验证已关闭" {
		t.Fatalf("unexpected updated rule: %#v", updated)
	}

	if deleted, err := store.DeleteAlertRule(rule.ID); err != nil || !deleted {
		t.Fatalf("DeleteAlertRule() deleted %v err %v", deleted, err)
	}

	triggeredRule, err := store.CreateAlertRule(AlertRuleInput{
		Name:                  "全局错误验证",
		Enabled:               &enabled,
		DelayThresholdSeconds: 9999,
		ErrorThreshold:        1,
		WebhookURL:            "https://example.com/hook",
	})
	if err != nil {
		t.Fatalf("CreateAlertRule(triggered) error = %v", err)
	}
	evaluations := store.AlertRuleEvaluations()
	var found AlertRuleEvaluation
	for _, evaluation := range evaluations {
		if evaluation.RuleID == triggeredRule.ID {
			found = evaluation
			break
		}
	}
	if found.RuleID == "" {
		t.Fatalf("expected evaluation for rule %s", triggeredRule.ID)
	}
	if !found.Triggered || found.PendingErrors == 0 || len(found.Reasons) == 0 {
		t.Fatalf("expected global error rule to trigger, got %#v", found)
	}
	events := store.AlertEvents(triggeredRule.ID)
	if len(events) != 1 || events[0].Status != AlertEventTriggered {
		t.Fatalf("expected one triggered alert event, got %#v", events)
	}
	if events[0].NotificationStatus != AlertNotificationRecorded || events[0].NotificationTarget == "" {
		t.Fatalf("expected webhook notification to be marked recorded: %#v", events[0])
	}
	store.AlertRuleEvaluations()
	events = store.AlertEvents(triggeredRule.ID)
	if len(events) != 1 {
		t.Fatalf("expected repeated evaluation to avoid duplicate events, got %#v", events)
	}

	_, ok, err = store.UpdateAlertRule(triggeredRule.ID, AlertRuleInput{
		Name:                  "全局错误验证",
		Enabled:               &enabled,
		DelayThresholdSeconds: 9999,
		ErrorThreshold:        999,
		WebhookURL:            "https://example.com/hook",
	})
	if err != nil || !ok {
		t.Fatalf("UpdateAlertRule(recover) ok %v err %v", ok, err)
	}
	store.AlertRuleEvaluations()
	events = store.AlertEvents(triggeredRule.ID)
	if len(events) != 2 || events[0].Status != AlertEventRecovered {
		t.Fatalf("expected recovered alert event after thresholds clear, got %#v", events)
	}
}

func TestCreateAlertRuleValidatesThresholds(t *testing.T) {
	store := newTestStore(t)
	enabled := true
	if _, err := store.CreateAlertRule(AlertRuleInput{
		Name:                  "",
		Enabled:               &enabled,
		DelayThresholdSeconds: 30,
		ErrorThreshold:        0,
	}); err == nil {
		t.Fatal("expected missing rule name to be rejected")
	}
	if _, err := store.CreateAlertRule(AlertRuleInput{
		Name:                  "bad delay",
		Enabled:               &enabled,
		DelayThresholdSeconds: 0,
		ErrorThreshold:        0,
	}); err == nil {
		t.Fatal("expected non-positive delay threshold to be rejected")
	}
}
