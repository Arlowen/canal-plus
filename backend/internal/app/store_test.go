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
	}
	for _, node := range report.After.Nodes {
		if node.ID == activeNode.ID && node.Status != NodeOffline {
			t.Fatalf("drilled node should be offline: %#v", node)
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
