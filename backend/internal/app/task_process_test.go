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
