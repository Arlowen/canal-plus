package app

import (
	"testing"
	"time"
)

func TestSingleNodeIsMaster(t *testing.T) {
	store := newTestStore(t)

	snapshot := store.ClusterSnapshot()
	if snapshot.TotalNodes != 1 {
		t.Fatalf("expected one node, got %d", snapshot.TotalNodes)
	}
	if snapshot.Nodes[0].Role != NodeRoleMaster {
		t.Fatalf("single node role = %q, want %q", snapshot.Nodes[0].Role, NodeRoleMaster)
	}
	if snapshot.MasterNodeID != snapshot.Nodes[0].ID {
		t.Fatalf("master node id = %q, want %q", snapshot.MasterNodeID, snapshot.Nodes[0].ID)
	}
}

func TestMultipleNodesDefaultToSingleMasterAndStandby(t *testing.T) {
	store := newTestStore(t)

	_, _, err := store.registerNode(ClusterNodeInput{
		ID:       "node-standby-a",
		Name:     "standby-a",
		Endpoint: "10.0.0.2:4100",
	}, "system", "node_register")
	if err != nil {
		t.Fatalf("register standby node: %v", err)
	}

	snapshot := store.ClusterSnapshot()
	masters := countNodesWithRole(snapshot.Nodes, NodeRoleMaster)
	standbys := countNodesWithRole(snapshot.Nodes, NodeRoleStandby)
	if masters != 1 {
		t.Fatalf("master count = %d, want 1: %#v", masters, snapshot.Nodes)
	}
	if standbys != 1 {
		t.Fatalf("standby count = %d, want 1: %#v", standbys, snapshot.Nodes)
	}
}

func TestStandbyTakesOverWhenMasterHeartbeatTimesOut(t *testing.T) {
	store := newTestStore(t)

	_, _, err := store.registerNode(ClusterNodeInput{
		ID:       "node-standby-a",
		Name:     "standby-a",
		Endpoint: "10.0.0.2:4100",
	}, "system", "node_register")
	if err != nil {
		t.Fatalf("register standby node: %v", err)
	}
	before := store.ClusterSnapshot()
	oldMasterID := before.MasterNodeID
	if oldMasterID == "" {
		t.Fatal("expected master before failover")
	}

	store.mu.Lock()
	for index := range store.data.Nodes {
		if store.data.Nodes[index].ID == oldMasterID {
			store.data.Nodes[index].LastHeartbeatAt = time.Now().UTC().Add(-2 * nodeHeartbeatTimeout).Format(time.RFC3339Nano)
			break
		}
	}
	store.mu.Unlock()

	after, err := store.ReconcileCluster()
	if err != nil {
		t.Fatalf("reconcile cluster: %v", err)
	}
	if after.MasterNodeID == "" || after.MasterNodeID == oldMasterID {
		t.Fatalf("master did not fail over: before=%q after=%q", oldMasterID, after.MasterNodeID)
	}
	if after.MasterNodeName != "standby-a" {
		t.Fatalf("master name = %q, want standby-a", after.MasterNodeName)
	}
	oldMaster := findNode(after.Nodes, oldMasterID)
	if oldMaster == nil || oldMaster.Status != NodeOffline || oldMaster.Role != NodeRoleStandby {
		t.Fatalf("old master after failover = %#v", oldMaster)
	}
}

func TestManualPromoteKeepsSingleMaster(t *testing.T) {
	store := newTestStore(t)

	_, _, err := store.registerNode(ClusterNodeInput{
		ID:       "node-standby-a",
		Name:     "standby-a",
		Endpoint: "10.0.0.2:4100",
	}, "system", "node_register")
	if err != nil {
		t.Fatalf("register standby node: %v", err)
	}

	result, ok, err := store.SetNodeRole("node-standby-a", NodeRoleMaster)
	if err != nil {
		t.Fatalf("promote standby: %v", err)
	}
	if !ok {
		t.Fatal("promote standby returned not found")
	}
	if result.After.MasterNodeID != "node-standby-a" {
		t.Fatalf("master node id = %q, want node-standby-a", result.After.MasterNodeID)
	}
	if countNodesWithRole(result.After.Nodes, NodeRoleMaster) != 1 {
		t.Fatalf("expected one master after promotion: %#v", result.After.Nodes)
	}
}

func countNodesWithRole(nodes []ClusterNode, role string) int {
	count := 0
	for _, node := range nodes {
		if node.Role == role {
			count++
		}
	}
	return count
}

func findNode(nodes []ClusterNode, id string) *ClusterNode {
	for index := range nodes {
		if nodes[index].ID == id {
			return &nodes[index]
		}
	}
	return nil
}
