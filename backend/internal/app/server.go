package app

import (
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	store           *Store
	localNodeID     string
	port            string
	frontendOrigins []string
	runtimeConfig   RuntimeConfig
	allowedOrigins  map[string]struct{}
}

func NewServer() (*Server, error) {
	loadDotEnv(".env")
	port := os.Getenv("PORT")
	if port == "" {
		port = "4100"
	}
	store, err := NewStore()
	if err != nil {
		return nil, err
	}
	localNodeID := resolveLocalNodeID(store, os.Getenv("CANAL_PLUS_NODE_ID"))
	clusterSupervisorEnabled := os.Getenv("CANAL_PLUS_CLUSTER_SUPERVISOR") != "false"
	clusterSupervisorInterval := envDurationSeconds("CANAL_PLUS_CLUSTER_SUPERVISOR_INTERVAL_SECONDS", 5*time.Second)
	if clusterSupervisorEnabled {
		store.StartClusterSupervisor(clusterSupervisorInterval)
	}
	embeddedHeartbeatEnabled := os.Getenv("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT") != "false"
	embeddedHeartbeatInterval := envDurationSeconds("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT_INTERVAL_SECONDS", 10*time.Second)
	if embeddedHeartbeatEnabled {
		store.StartEmbeddedNodeHeartbeat(localNodeID, embeddedHeartbeatInterval)
	}

	frontendOrigin := os.Getenv("FRONTEND_ORIGIN")
	if frontendOrigin == "" {
		frontendOrigin = "http://localhost:8999"
	}
	allowedOrigins := map[string]struct{}{}
	frontendOrigins := []string{}
	for _, origin := range strings.Split(frontendOrigin, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = struct{}{}
			frontendOrigins = append(frontendOrigins, origin)
		}
	}

	storageBackend := store.StorageBackend()
	storageLocation := store.StorageLocation()

	server := &Server{
		store:           store,
		localNodeID:     localNodeID,
		port:            port,
		frontendOrigins: frontendOrigins,
		allowedOrigins:  allowedOrigins,
		runtimeConfig: RuntimeConfig{
			BackendPort:                      port,
			FrontendOrigins:                  frontendOrigins,
			StorageBackend:                   storageBackend,
			StorageLocation:                  storageLocation,
			LocalNodeID:                      localNodeID,
			ClusterSupervisorEnabled:         clusterSupervisorEnabled,
			ClusterSupervisorIntervalSeconds: int(clusterSupervisorInterval.Seconds()),
			EmbeddedHeartbeatEnabled:         embeddedHeartbeatEnabled,
			EmbeddedHeartbeatIntervalSeconds: int(embeddedHeartbeatInterval.Seconds()),
		},
	}
	return server, nil
}

func envDurationSeconds(name string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func resolveLocalNodeID(store *Store, preferred string) string {
	preferred = strings.TrimSpace(preferred)
	if preferred != "" {
		return preferred
	}
	snapshot := store.ClusterSnapshot()
	for _, node := range snapshot.Nodes {
		if node.Status == NodeOnline {
			return node.ID
		}
	}
	if len(snapshot.Nodes) > 0 {
		return snapshot.Nodes[0].ID
	}
	return ""
}

func (s *Server) Port() string {
	return s.port
}

func (s *Server) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	s.applyCORS(response, request)
	if request.Method == http.MethodOptions {
		response.WriteHeader(http.StatusNoContent)
		return
	}

	if request.URL.Path == "/api/health" {
		writeJSON(response, http.StatusOK, map[string]string{
			"status":  "ok",
			"service": "canal-plus-backend",
			"time":    now(),
		})
		return
	}

	if request.URL.Path == "/api/auth/login" && request.Method == http.MethodPost {
		s.handleLogin(response, request)
		return
	}

	if !strings.HasPrefix(request.URL.Path, "/api/") {
		writeError(response, http.StatusNotFound, "not found")
		return
	}

	user, ok := s.currentUser(request)
	if !ok {
		writeError(response, http.StatusUnauthorized, "未登录或登录已失效")
		return
	}

	path := strings.Trim(strings.TrimPrefix(request.URL.Path, "/api"), "/")
	parts := []string{}
	if path != "" {
		parts = strings.Split(path, "/")
	}

	if !canAccess(user, request.Method, parts) {
		writeError(response, http.StatusForbidden, "权限不足：需要管理员权限")
		return
	}

	switch {
	case len(parts) == 1 && parts[0] == "me" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, toPublicUser(user))
	case len(parts) == 2 && parts[0] == "runtime" && parts[1] == "config" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.runtimeConfig)
	case len(parts) >= 1 && parts[0] == "datasources":
		s.handleDatasources(response, request, parts)
	case len(parts) >= 1 && parts[0] == "cluster":
		s.handleCluster(response, request, parts)
	case len(parts) == 1 && parts[0] == "operation-logs" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, firstN(s.store.Logs(), 200))
	case len(parts) >= 1 && parts[0] == "alert-rules":
		s.handleAlertRules(response, request, parts)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleLogin(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	user, ok := s.store.GetUserByUsername(input.Username)
	if !ok || !verifyPassword(input.Password, user.PasswordHash) {
		writeError(response, http.StatusUnauthorized, "账号或密码错误")
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{
		"token": "dev-token:" + user.ID,
		"user":  toPublicUser(user),
	})
}

func (s *Server) handleDatasources(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		datasources := s.store.Datasources()
		publicDatasources := make([]PublicDatasource, 0, len(datasources))
		for _, datasource := range datasources {
			publicDatasources = append(publicDatasources, toPublicDatasource(datasource))
		}
		writeJSON(response, http.StatusOK, publicDatasources)
	case len(parts) == 1 && request.Method == http.MethodPost:
		s.createDatasource(response, request)
	case len(parts) == 2 && request.Method == http.MethodGet:
		datasource, ok := s.store.GetDatasource(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "数据源不存在")
			return
		}
		writeJSON(response, http.StatusOK, toPublicDatasource(datasource))
	case len(parts) == 2 && request.Method == http.MethodPut:
		s.updateDatasource(response, request, parts[1])
	case len(parts) == 2 && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteDatasource(parts[1])
		if err != nil {
			writeError(response, http.StatusConflict, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "数据源不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
	case len(parts) == 3 && parts[2] == "test" && request.Method == http.MethodPost:
		s.testDatasource(response, parts[1])
	case len(parts) == 3 && parts[2] == "schemas" && request.Method == http.MethodGet:
		s.listSchemas(response, parts[1])
	case len(parts) == 5 && parts[2] == "schemas" && parts[4] == "tables" && request.Method == http.MethodGet:
		s.listTables(response, parts[1], parts[3])
	case len(parts) == 7 && parts[2] == "schemas" && parts[4] == "tables" && parts[6] == "columns" && request.Method == http.MethodGet:
		s.listColumns(response, parts[1], parts[3], parts[5])
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) createDatasource(response http.ResponseWriter, request *http.Request) {
	var input struct {
		Name          string `json:"name"`
		Host          string `json:"host"`
		Port          int    `json:"port"`
		Username      string `json:"username"`
		Password      string `json:"password"`
		DefaultSchema string `json:"defaultSchema"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if input.Name == "" || input.Host == "" || input.Port == 0 || input.Username == "" || input.Password == "" {
		writeError(response, http.StatusBadRequest, "数据源必填项缺失")
		return
	}
	passwordSecret, err := encryptText(input.Password)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	datasource, err := s.store.CreateDatasource(Datasource{
		Name:           input.Name,
		Host:           input.Host,
		Port:           input.Port,
		Username:       input.Username,
		PasswordSecret: passwordSecret,
		DefaultSchema:  input.DefaultSchema,
	})
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, toPublicDatasource(datasource))
}

func (s *Server) updateDatasource(response http.ResponseWriter, request *http.Request, id string) {
	var input struct {
		Name          string `json:"name"`
		Host          string `json:"host"`
		Port          int    `json:"port"`
		Username      string `json:"username"`
		Password      string `json:"password"`
		DefaultSchema string `json:"defaultSchema"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	patch := Datasource{
		Name:          input.Name,
		Host:          input.Host,
		Port:          input.Port,
		Username:      input.Username,
		DefaultSchema: input.DefaultSchema,
	}
	if input.Password != "" {
		passwordSecret, err := encryptText(input.Password)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		patch.PasswordSecret = passwordSecret
	}
	datasource, ok, err := s.store.UpdateDatasource(id, patch)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	writeJSON(response, http.StatusOK, toPublicDatasource(datasource))
}

func (s *Server) testDatasource(response http.ResponseWriter, id string) {
	datasource, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	online, message := testDatasource(datasource)
	updated, ok, err := s.store.MarkDatasourceTest(id, online, message)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	status := http.StatusOK
	if !online {
		status = http.StatusUnprocessableEntity
	}
	writeJSON(response, status, toPublicDatasource(updated))
}

func (s *Server) listSchemas(response http.ResponseWriter, id string) {
	datasource, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	schemas, err := listSchemas(datasource)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, schemas)
}

func (s *Server) listTables(response http.ResponseWriter, id string, schema string) {
	datasource, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	tables, err := listTables(datasource, schema)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, tables)
}

func (s *Server) listColumns(response http.ResponseWriter, id string, schema string, table string) {
	datasource, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	columns, err := listColumns(datasource, schema, table)
	if err != nil {
		writeError(response, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, columns)
}

func (s *Server) handleAlertRules(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.AlertRules())
	case len(parts) == 1 && request.Method == http.MethodPost:
		var input AlertRuleInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		rule, err := s.store.CreateAlertRule(input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(response, http.StatusCreated, rule)
	case len(parts) == 2 && parts[1] == "evaluations" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.AlertRuleEvaluations())
	case len(parts) == 2 && parts[1] == "events" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.AlertEvents(request.URL.Query().Get("ruleId")))
	case len(parts) == 2 && request.Method == http.MethodPut:
		var input AlertRuleInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		rule, ok, err := s.store.UpdateAlertRule(parts[1], input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "告警规则不存在")
			return
		}
		writeJSON(response, http.StatusOK, rule)
	case len(parts) == 2 && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteAlertRule(parts[1])
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "告警规则不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleCluster(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.clusterResponse())
	case len(parts) == 2 && parts[1] == "nodes" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.clusterResponse().Nodes)
	case len(parts) == 3 && parts[1] == "nodes" && parts[2] == "test-connection" && request.Method == http.MethodPost:
		var input ClusterNodeInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		writeJSON(response, http.StatusOK, s.store.TestNodeConnection(input))
	case len(parts) == 3 && parts[1] == "nodes" && parts[2] == "deploy" && request.Method == http.MethodPost:
		var input ClusterNodeInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		result, err := s.store.DeployNode(input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(response, http.StatusOK, result)
	case len(parts) == 2 && parts[1] == "nodes" && request.Method == http.MethodPost:
		var input ClusterNodeInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		node, created, err := s.store.RegisterNode(input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if created {
			writeJSON(response, http.StatusCreated, node)
			return
		}
		writeJSON(response, http.StatusOK, node)
	case len(parts) == 4 && parts[1] == "nodes" && parts[3] == "upgrade" && request.Method == http.MethodPost:
		result, ok, err := s.store.UpgradeNode(parts[2])
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		writeJSON(response, http.StatusOK, result)
	case len(parts) == 4 && parts[1] == "nodes" && parts[3] == "uninstall" && request.Method == http.MethodPost:
		if s.isLocalControlNode(parts[2]) {
			writeError(response, http.StatusBadRequest, "当前控制节点不能从自身控制台卸载，请切换到其他节点执行")
			return
		}
		result, ok, err := s.store.UninstallNode(parts[2])
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		writeJSON(response, http.StatusOK, result)
	case len(parts) == 4 && parts[1] == "nodes" && request.Method == http.MethodPost:
		switch parts[3] {
		case "online":
			result, ok, err := s.store.BringNodeOnline(parts[2])
			if err != nil {
				writeError(response, http.StatusInternalServerError, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "节点不存在")
				return
			}
			writeJSON(response, http.StatusOK, result)
			return
		case "heartbeat":
			node, ok, err := s.store.MarkNodeStatus(parts[2], NodeOnline)
			if err != nil {
				writeError(response, http.StatusInternalServerError, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "节点不存在")
				return
			}
			writeJSON(response, http.StatusOK, node)
			return
		case "offline":
			if s.isLocalControlNode(parts[2]) {
				writeError(response, http.StatusBadRequest, "当前控制节点不能从自身控制台下线")
				return
			}
			result, ok, err := s.store.TakeNodeOffline(parts[2])
			if err != nil {
				writeError(response, http.StatusInternalServerError, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "节点不存在")
				return
			}
			writeJSON(response, http.StatusOK, result)
			return
		default:
			writeError(response, http.StatusNotFound, "not found")
			return
		}
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) clusterResponse() ClusterSnapshot {
	snapshot := s.store.ClusterSnapshot()
	snapshot.LocalNodeID = s.localNodeID
	for _, node := range snapshot.Nodes {
		if node.ID == snapshot.LocalNodeID {
			snapshot.LocalNodeName = node.Name
			break
		}
	}
	return snapshot
}

func (s *Server) isLocalControlNode(nodeID string) bool {
	return nodeID != "" && nodeID == s.localNodeID
}

func (s *Server) currentUser(request *http.Request) (User, bool) {
	header := request.Header.Get("Authorization")
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
	if token == "" {
		token = strings.TrimSpace(request.URL.Query().Get("access_token"))
	}
	if !strings.HasPrefix(token, "dev-token:") {
		return User{}, false
	}
	userID := strings.TrimPrefix(token, "dev-token:")
	return s.store.GetUserByID(userID)
}

func canAccess(user User, method string, parts []string) bool {
	if user.Role == RoleAdmin {
		return true
	}
	if method == http.MethodGet {
		return true
	}
	if user.Role != RoleOperator {
		return false
	}
	return operatorCanMutate(method, parts)
}

func operatorCanMutate(method string, parts []string) bool {
	if method != http.MethodPost {
		return false
	}
	switch {
	case len(parts) == 3 && parts[0] == "datasources" && parts[2] == "test":
		return true
	default:
		return false
	}
}

func (s *Server) applyCORS(response http.ResponseWriter, request *http.Request) {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return
	}
	if _, ok := s.allowedOrigins[origin]; ok || localOriginRE.MatchString(origin) {
		response.Header().Set("Access-Control-Allow-Origin", origin)
		response.Header().Set("Access-Control-Allow-Credentials", "true")
		response.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		response.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		response.Header().Set("Vary", "Origin")
	}
}

func firstN[T any](items []T, count int) []T {
	if len(items) <= count {
		return items
	}
	return items[:count]
}

var localOriginRE = regexp.MustCompile(`^http://(localhost|127\.0\.0\.1):\d+$`)
