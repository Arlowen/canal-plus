package app

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Server struct {
	store                             *Store
	localNodeID                       string
	port                              string
	frontendOrigins                   []string
	runtimeConfig                     RuntimeConfig
	allowedOrigins                    map[string]struct{}
	datasourceVerificationMu          sync.Mutex
	datasourceSuccessfulVerifications map[string]DatasourceTestResult
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
	localNode, err := registerLocalControlNode(store, port)
	if err != nil {
		return nil, err
	}
	localNodeID := localNode.ID
	metricCollector := NewNodeMetricCollector()
	if sample, err := metricCollector.Collect(localNodeID); err == nil {
		_ = store.RefreshNodeHeartbeatWithMetrics(localNodeID, sample)
	}
	clusterSupervisorEnabled := os.Getenv("CANAL_PLUS_CLUSTER_SUPERVISOR") != "false"
	clusterSupervisorInterval := envDurationSeconds("CANAL_PLUS_CLUSTER_SUPERVISOR_INTERVAL_SECONDS", 5*time.Second)
	if clusterSupervisorEnabled {
		store.StartClusterSupervisor(clusterSupervisorInterval)
	}
	embeddedHeartbeatEnabled := os.Getenv("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT") != "false"
	embeddedHeartbeatInterval := envDurationSeconds("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT_INTERVAL_SECONDS", 10*time.Second)
	if embeddedHeartbeatEnabled {
		store.StartEmbeddedNodeMetrics(localNodeID, embeddedHeartbeatInterval, metricCollector.Collect)
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
		store:                             store,
		localNodeID:                       localNodeID,
		port:                              port,
		frontendOrigins:                   frontendOrigins,
		allowedOrigins:                    allowedOrigins,
		datasourceSuccessfulVerifications: map[string]DatasourceTestResult{},
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

func registerLocalControlNode(store *Store, port string) (ClusterNode, error) {
	input := localClusterNodeInput(port)
	if strings.TrimSpace(os.Getenv("CANAL_PLUS_NODE_NAME")) == "" {
		snapshot := store.ClusterSnapshot()
		for _, node := range snapshot.Nodes {
			if node.ID == input.ID && strings.TrimSpace(node.Name) != "" {
				input.Name = node.Name
				break
			}
		}
	}
	return store.RegisterLocalNode(input)
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
	case len(parts) == 2 && parts[1] == "test" && request.Method == http.MethodPost:
		s.testDatasourceInput(response, request)
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
		s.testSavedDatasource(response, request, parts[1])
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) createDatasource(response http.ResponseWriter, request *http.Request) {
	var input DatasourceInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	normalized, err := normalizeDatasourceInput(input, true)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	fingerprint := datasourceInputFingerprint(normalized, "")
	testResult, ok := s.datasourceVerification(fingerprint)
	if !ok {
		writeError(response, http.StatusBadRequest, "请先测试")
		return
	}
	passwordSecret := ""
	if normalized.AuthType == DatasourceAuthPassword && normalized.Password != "" {
		encrypted, err := encryptText(normalized.Password)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		passwordSecret = encrypted
	}
	datasource, err := s.store.CreateDatasource(Datasource{
		Name:           normalized.Name,
		Type:           normalized.Type,
		Purpose:        normalized.Purpose,
		Host:           normalized.Host,
		Port:           normalized.Port,
		Username:       normalized.Username,
		PasswordSecret: passwordSecret,
		DefaultSchema:  normalized.DefaultSchema,
		Remark:         normalized.Remark,
	}, testResult)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, toPublicDatasource(datasource))
}

func (s *Server) updateDatasource(response http.ResponseWriter, request *http.Request, id string) {
	existing, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	var input DatasourceInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	normalized, err := normalizeDatasourceInput(input, existing.PasswordSecret == "")
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	connectionChanged := datasourceConnectionChanged(existing, normalized)
	var testResult *DatasourceTestResult
	if connectionChanged {
		fingerprint := datasourceInputFingerprint(normalized, existing.PasswordSecret)
		verified, ok := s.datasourceVerification(fingerprint)
		if !ok {
			writeError(response, http.StatusBadRequest, "请先测试")
			return
		}
		testResult = &verified
	}
	passwordSecret := ""
	passwordChanged := normalized.Password != "" || (normalized.AuthType == DatasourceAuthNone && existing.PasswordSecret != "")
	if normalized.Password != "" {
		encrypted, err := encryptText(normalized.Password)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		passwordSecret = encrypted
	}
	datasource, ok, err := s.store.UpdateDatasource(id, DatasourcePatch{
		Name:              normalized.Name,
		Type:              normalized.Type,
		Purpose:           normalized.Purpose,
		Host:              normalized.Host,
		Port:              normalized.Port,
		Username:          normalized.Username,
		PasswordSecret:    passwordSecret,
		PasswordChanged:   passwordChanged,
		DefaultSchema:     normalized.DefaultSchema,
		Remark:            normalized.Remark,
		ConnectionChanged: connectionChanged,
		TestResult:        testResult,
	})
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

func (s *Server) testDatasourceInput(response http.ResponseWriter, request *http.Request) {
	var input DatasourceInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	var existing *Datasource
	if strings.TrimSpace(input.ID) != "" {
		datasource, ok := s.store.GetDatasource(strings.TrimSpace(input.ID))
		if !ok {
			writeError(response, http.StatusNotFound, "数据源不存在")
			return
		}
		existing = &datasource
	}
	requirePassword := existing == nil || existing.PasswordSecret == ""
	normalized, err := normalizeDatasourceInput(input, requirePassword)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	datasource, err := datasourceFromTestInput(normalized, existing)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	result := datasourceConnectionTester(datasource)
	if result.Success {
		s.rememberDatasourceVerification(datasourceInputFingerprint(normalized, datasource.PasswordSecret), result)
	}
	if err := s.store.RecordDatasourceTestLog(valueOr(normalized.ID, ""), normalized.Name); err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (s *Server) testSavedDatasource(response http.ResponseWriter, request *http.Request, id string) {
	var input DatasourceTestRequest
	if request.Body != nil && request.ContentLength != 0 {
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
	}
	if err := s.ensureDatasourceTestNode(input.NodeID); err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	datasource, ok := s.store.GetDatasource(id)
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	result := datasourceConnectionTester(datasource)
	_, ok, err := s.store.MarkDatasourceTest(id, result)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "数据源不存在")
		return
	}
	writeJSON(response, http.StatusOK, result)
}

func (s *Server) ensureDatasourceTestNode(nodeID string) error {
	nodeID = strings.TrimSpace(nodeID)
	if nodeID == "" {
		return nil
	}
	snapshot := s.store.ClusterSnapshot()
	for _, node := range snapshot.Nodes {
		if node.ID != nodeID {
			continue
		}
		if node.Status != NodeOnline {
			return errors.New("节点不可用")
		}
		return nil
	}
	return errors.New("节点不存在")
}

func normalizeDatasourceInput(input DatasourceInput, requirePassword bool) (DatasourceInput, error) {
	input.ID = strings.TrimSpace(input.ID)
	input.Name = strings.TrimSpace(input.Name)
	input.Type = DatasourceType(strings.TrimSpace(string(input.Type)))
	input.Purpose = DatasourcePurpose(strings.TrimSpace(string(input.Purpose)))
	input.AuthType = DatasourceAuthType(strings.TrimSpace(string(input.AuthType)))
	input.Host = strings.TrimSpace(input.Host)
	input.Username = strings.TrimSpace(input.Username)
	input.DefaultSchema = strings.TrimSpace(input.DefaultSchema)
	input.Remark = strings.TrimSpace(input.Remark)

	if input.Name == "" {
		return DatasourceInput{}, errors.New("名称必填")
	}
	if len([]rune(input.Name)) > 50 {
		return DatasourceInput{}, errors.New("名称最多 50 字符")
	}
	if input.Type == "" {
		return DatasourceInput{}, errors.New("类型必填")
	}
	if input.Type != DatasourceTypeMySQL {
		return DatasourceInput{}, errors.New("类型无效")
	}
	if input.Purpose == "" {
		input.Purpose = DatasourcePurposeGeneral
	}
	if input.AuthType == "" {
		if input.Username == "" && input.Password == "" {
			input.AuthType = DatasourceAuthNone
		} else {
			input.AuthType = DatasourceAuthPassword
		}
	}
	switch input.Purpose {
	case DatasourcePurposeSource, DatasourcePurposeTarget, DatasourcePurposeGeneral:
	default:
		return DatasourceInput{}, errors.New("用途无效")
	}
	switch input.AuthType {
	case DatasourceAuthPassword, DatasourceAuthNone:
	default:
		return DatasourceInput{}, errors.New("认证类型无效")
	}
	if input.Host == "" {
		return DatasourceInput{}, errors.New("主机必填")
	}
	if input.Port < 1 || input.Port > 65535 {
		return DatasourceInput{}, errors.New("端口无效")
	}
	if input.AuthType == DatasourceAuthNone {
		input.Username = ""
		input.Password = ""
	} else if input.Username == "" {
		return DatasourceInput{}, errors.New("用户名必填")
	}
	if input.AuthType == DatasourceAuthPassword && requirePassword && input.Password == "" {
		return DatasourceInput{}, errors.New("密码必填")
	}
	if len([]rune(input.Remark)) > 200 {
		return DatasourceInput{}, errors.New("备注最多 200 字符")
	}
	return input, nil
}

func datasourceFromTestInput(input DatasourceInput, existing *Datasource) (Datasource, error) {
	passwordSecret := ""
	isDemo := false
	if existing != nil {
		passwordSecret = existing.PasswordSecret
		isDemo = existing.IsDemo
	}
	if input.AuthType == DatasourceAuthNone {
		passwordSecret = ""
	} else if input.Password != "" {
		encrypted, err := encryptText(input.Password)
		if err != nil {
			return Datasource{}, err
		}
		passwordSecret = encrypted
	}
	return Datasource{
		ID:             input.ID,
		Name:           input.Name,
		Type:           input.Type,
		Purpose:        input.Purpose,
		Host:           input.Host,
		Port:           input.Port,
		Username:       input.Username,
		PasswordSecret: passwordSecret,
		DefaultSchema:  input.DefaultSchema,
		Remark:         input.Remark,
		IsDemo:         isDemo,
	}, nil
}

func datasourceConnectionChanged(existing Datasource, input DatasourceInput) bool {
	return existing.Type != input.Type ||
		datasourceAuthType(existing) != input.AuthType ||
		existing.Host != input.Host ||
		existing.Port != input.Port ||
		existing.Username != input.Username ||
		existing.DefaultSchema != input.DefaultSchema ||
		input.Password != ""
}

func datasourceInputFingerprint(input DatasourceInput, existingPasswordSecret string) string {
	passwordKey := "secret:" + existingPasswordSecret
	if input.AuthType == DatasourceAuthNone {
		passwordKey = "none"
	}
	if input.Password != "" {
		passwordKey = "plain:" + input.Password
	}
	return checksumJSON(map[string]any{
		"authType":      input.AuthType,
		"type":          input.Type,
		"host":          input.Host,
		"port":          input.Port,
		"username":      input.Username,
		"password":      passwordKey,
		"defaultSchema": input.DefaultSchema,
	})
}

func datasourceAuthType(datasource Datasource) DatasourceAuthType {
	if datasource.Username == "" && datasource.PasswordSecret == "" {
		return DatasourceAuthNone
	}
	return DatasourceAuthPassword
}

func (s *Server) rememberDatasourceVerification(fingerprint string, result DatasourceTestResult) {
	if fingerprint == "" || !result.Success {
		return
	}
	s.datasourceVerificationMu.Lock()
	defer s.datasourceVerificationMu.Unlock()
	if s.datasourceSuccessfulVerifications == nil {
		s.datasourceSuccessfulVerifications = map[string]DatasourceTestResult{}
	}
	s.datasourceSuccessfulVerifications[fingerprint] = result
}

func (s *Server) datasourceVerification(fingerprint string) (DatasourceTestResult, bool) {
	s.datasourceVerificationMu.Lock()
	defer s.datasourceVerificationMu.Unlock()
	if s.datasourceSuccessfulVerifications == nil {
		return DatasourceTestResult{}, false
	}
	result, ok := s.datasourceSuccessfulVerifications[fingerprint]
	return result, ok && result.Success
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
	case len(parts) == 2 && parts[1] == "master-node-count" && request.Method == http.MethodPost:
		var input ClusterMasterNodeCountInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		if _, err := s.store.SetClusterMasterNodeCount(input.MasterNodeCount); err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(response, http.StatusOK, s.clusterResponse())
	case len(parts) == 2 && parts[1] == "nodes" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.clusterResponse().Nodes)
	case len(parts) == 4 && parts[1] == "nodes" && parts[3] == "metrics" && request.Method == http.MethodGet:
		history, ok := s.store.NodeMetricHistory(parts[2], request.URL.Query().Get("range"))
		if !ok {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		writeJSON(response, http.StatusOK, history)
	case len(parts) == 3 && parts[1] == "nodes" && request.Method == http.MethodPut:
		var input ClusterNodeNameInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		node, ok, err := s.store.UpdateNodeName(parts[2], input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		writeJSON(response, http.StatusOK, node)
	case len(parts) == 3 && parts[1] == "nodes" && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteNode(parts[2])
		if err != nil {
			writeError(response, http.StatusConflict, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
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
	case len(parts) == 2 && parts[0] == "datasources" && parts[1] == "test":
		return true
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
