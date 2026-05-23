package app

import "testing"

func TestResolveLocalNodeIDPrefersConfiguredValue(t *testing.T) {
	store := newTestStore(t)
	resolved := resolveLocalNodeID(store, "node-custom")
	if resolved != "node-custom" {
		t.Fatalf("expected configured node id, got %q", resolved)
	}
}

func TestTaskProcessManagerShouldRunLocallyOnlyForAssignedActiveTasks(t *testing.T) {
	store := newTestStore(t)
	manager := NewTaskProcessManager(store, nil, nil, "", "node-shanghai-a")
	snapshot := store.Snapshot()

	var runningTask SyncTask
	var runtime TaskRuntimeState
	for _, task := range snapshot.SyncTasks {
		if task.Status == TaskIncrementalRunning || task.Status == TaskFullSyncing {
			runningTask = task
			break
		}
	}
	if runningTask.ID == "" {
		t.Fatal("expected running seed task")
	}
	for _, item := range snapshot.RuntimeStates {
		if item.TaskID == runningTask.ID {
			runtime = item
			break
		}
	}
	if runtime.TaskID == "" {
		t.Fatal("expected runtime state for running task")
	}
	if !manager.shouldRunLocally(runningTask, runtime) {
		t.Fatalf("expected task assigned to local node to run locally: %#v %#v", runningTask, runtime)
	}
	runtime.NodeID = "node-shanghai-b"
	if manager.shouldRunLocally(runningTask, runtime) {
		t.Fatalf("expected task assigned to other node to stay remote: %#v", runtime)
	}
	runtime.NodeID = ""
	if manager.shouldRunLocally(runningTask, runtime) {
		t.Fatalf("expected unassigned task to stay stopped: %#v", runtime)
	}
}

func TestMarkProcessDetachedDoesNotForceStoppedStatus(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.Snapshot()
	task := snapshot.SyncTasks[0]
	status := NewTaskStatusService(store)

	store.mu.Lock()
	runtime := store.ensureRuntimeLocked(task.ID)
	runtime.NodeID = "node-shanghai-b"
	runtime.ProcessStatus = "running"
	store.mu.Unlock()

	entry, err := status.MarkProcessDetached(task.ID, stopReasonMigrated)
	if err != nil {
		t.Fatalf("MarkProcessDetached() error = %v", err)
	}
	if entry.Message != stopReasonMigrated {
		t.Fatalf("unexpected detached log entry: %#v", entry)
	}
	runtimeAfter, ok := store.Runtime(task.ID)
	if !ok {
		t.Fatalf("expected runtime for task %s", task.ID)
	}
	if runtimeAfter.ProcessStatus != "running" {
		t.Fatalf("detached process should preserve running status for remote ownership: %#v", runtimeAfter)
	}
	if runtimeAfter.ProcessID != 0 {
		t.Fatalf("detached process should clear pid: %#v", runtimeAfter)
	}
}
