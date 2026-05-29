package app

import (
	"os"
	"strconv"
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
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "4100"
	}
	input := localClusterNodeInput(port)
	return ClusterNode{
		ID:              input.ID,
		Name:            input.Name,
		Endpoint:        input.Endpoint,
		SSHPort:         input.SSHPort,
		SSHUser:         input.SSHUser,
		AuthMode:        normalizeNodeAuthMode(input.AuthMode),
		InstallDir:      input.InstallDir,
		Version:         input.Version,
		Zone:            input.Zone,
		Status:          NodeOnline,
		Role:            input.Role,
		CPUPercent:      0,
		MemoryPercent:   0,
		Capacity:        input.Capacity,
		LastHeartbeatAt: timestamp,
		StartedAt:       timestamp,
		UpdatedAt:       timestamp,
	}
}

func localClusterNodeInput(port string) ClusterNodeInput {
	port = strings.TrimSpace(port)
	if port == "" {
		port = "4100"
	}
	nodeID := strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_ID"))
	if nodeID == "" {
		nodeID = "node-local"
	}
	name := strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_NAME"))
	if name == "" {
		if nodeID == "node-local" {
			name = "local"
		} else {
			name = nodeID
		}
	}
	endpoint := strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_ENDPOINT"))
	if endpoint == "" {
		endpoint = "127.0.0.1:" + port
	}
	return ClusterNodeInput{
		ID:         nodeID,
		Name:       name,
		Endpoint:   endpoint,
		SSHPort:    envPositiveInt("CANAL_PLUS_NODE_SSH_PORT", 22),
		SSHUser:    strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_SSH_USER")),
		AuthMode:   string(NodeAuthPassword),
		InstallDir: envString("CANAL_PLUS_NODE_INSTALL_DIR", "/opt/canal-plus"),
		Version:    envString("CANAL_PLUS_NODE_VERSION", "v1.0.0"),
		Zone:       envString("CANAL_PLUS_NODE_ZONE", "local"),
		Role:       envString("CANAL_PLUS_NODE_ROLE", "scheduler+worker"),
		Capacity:   envPositiveInt("CANAL_PLUS_NODE_CAPACITY", 1),
	}
}

func envString(name string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	return value
}

func envPositiveInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
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
