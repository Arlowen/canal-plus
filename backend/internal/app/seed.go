package app

import (
	"os"
	"strings"
)

func createSeedData() (DatabaseShape, error) {
	createdAt := now()
	nodes := defaultClusterNodes(createdAt)

	return DatabaseShape{
		Users: []User{
			{
				ID:           "user-admin",
				Name:         "平台管理员",
				Username:     "admin",
				Role:         RoleAdmin,
				PasswordHash: hashPassword("admin123"),
				CreatedAt:    createdAt,
			},
			{
				ID:           "user-operator",
				Name:         "运维操作员",
				Username:     "operator",
				Role:         RoleOperator,
				PasswordHash: hashPassword("operator123"),
				CreatedAt:    createdAt,
			},
			{
				ID:           "user-readonly",
				Name:         "只读用户",
				Username:     "readonly",
				Role:         RoleReadonly,
				PasswordHash: hashPassword("readonly123"),
				CreatedAt:    createdAt,
			},
		},
		AlertRules: []AlertRule{
			{
				ID:        newID(),
				Name:      "默认告警",
				Enabled:   true,
				CreatedAt: createdAt,
				UpdatedAt: createdAt,
			},
		},
		Nodes: nodes,
	}, nil
}

func defaultClusterNodes(timestamp string) []ClusterNode {
	return []ClusterNode{defaultLocalClusterNode(timestamp)}
}

func defaultLocalClusterNode(timestamp string) ClusterNode {
	nodeID := strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_ID"))
	if nodeID == "" {
		nodeID = "node-local"
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "4100"
	}
	return ClusterNode{
		ID:              nodeID,
		Name:            "local",
		Endpoint:        "127.0.0.1:" + port,
		SSHPort:         22,
		SSHUser:         "",
		AuthMode:        NodeAuthPassword,
		InstallDir:      "/opt/canal-plus",
		Version:         "v1.0.0",
		Zone:            "local",
		Status:          NodeOnline,
		Role:            "scheduler+worker",
		CPUPercent:      0,
		MemoryPercent:   0,
		Capacity:        1,
		LastHeartbeatAt: timestamp,
		StartedAt:       timestamp,
		UpdatedAt:       timestamp,
	}
}

func normalizeLegacyDemoClusterNodes(nodes []ClusterNode, timestamp string) []ClusterNode {
	normalized := make([]ClusterNode, 0, len(nodes))
	localInserted := false
	for _, node := range nodes {
		if isLegacyDemoClusterNode(node, "node-shanghai-a", "shanghai-a", "10.18.4.21:4100") {
			if !localInserted {
				normalized = append(normalized, defaultLocalClusterNode(timestamp))
				localInserted = true
			}
			continue
		}
		if isLegacyDemoClusterNode(node, "node-shanghai-b", "shanghai-b", "10.18.4.22:4100") ||
			isLegacyDemoClusterNode(node, "node-shanghai-c", "shanghai-c", "10.18.4.23:4100") {
			continue
		}
		normalized = append(normalized, node)
	}
	return normalized
}

func isLegacyDemoClusterNode(node ClusterNode, id string, name string, endpoint string) bool {
	return node.ID == id && node.Name == name && node.Endpoint == endpoint
}
