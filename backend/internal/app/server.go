package app

import (
	"errors"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type Server struct {
	store          *Store
	port           string
	allowedOrigins map[string]struct{}
}

func NewServer() (*Server, error) {
	loadDotEnv(".env")
	port := os.Getenv("PORT")
	if port == "" {
		port = "4100"
	}
	dataFile := os.Getenv("CANAL_PLUS_DATA_FILE")
	if dataFile == "" {
		dataFile = "./data/store.json"
	}
	store, err := NewStore(dataFile)
	if err != nil {
		return nil, err
	}
	if os.Getenv("CANAL_PLUS_CLUSTER_SUPERVISOR") != "false" {
		store.StartClusterSupervisor(envDurationSeconds("CANAL_PLUS_CLUSTER_SUPERVISOR_INTERVAL_SECONDS", 5*time.Second))
	}
	if os.Getenv("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT") != "false" {
		store.StartEmbeddedNodeHeartbeat(envDurationSeconds("CANAL_PLUS_EMBEDDED_NODE_HEARTBEAT_INTERVAL_SECONDS", 10*time.Second))
	}

	frontendOrigin := os.Getenv("FRONTEND_ORIGIN")
	if frontendOrigin == "" {
		frontendOrigin = "http://localhost:5173"
	}
	allowedOrigins := map[string]struct{}{}
	for _, origin := range strings.Split(frontendOrigin, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			allowedOrigins[origin] = struct{}{}
		}
	}

	return &Server{
		store:          store,
		port:           port,
		allowedOrigins: allowedOrigins,
	}, nil
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
	case len(parts) == 2 && parts[0] == "dashboard" && parts[1] == "summary" && request.Method == http.MethodGet:
		s.handleDashboardSummary(response)
	case len(parts) >= 1 && parts[0] == "datasources":
		s.handleDatasources(response, request, parts)
	case len(parts) >= 1 && parts[0] == "sync-tasks":
		s.handleSyncTasks(response, request, parts)
	case len(parts) >= 1 && parts[0] == "error-events":
		s.handleErrorEvents(response, request, parts)
	case len(parts) >= 1 && parts[0] == "cluster":
		s.handleCluster(response, request, parts)
	case len(parts) >= 1 && parts[0] == "capability-jobs":
		s.handleCapabilityJobs(response, request, parts)
	case len(parts) == 1 && parts[0] == "operation-logs" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, firstN(s.store.Logs(), 200))
	case len(parts) >= 1 && parts[0] == "alert-rules":
		s.handleAlertRules(response, request, parts)
	case len(parts) == 2 && parts[0] == "sync-strategy" && parts[1] == "default" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, defaultStrategy())
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

func (s *Server) handleDashboardSummary(response http.ResponseWriter) {
	snapshot := s.store.Snapshot()
	runtimeByTask := map[string]TaskRuntimeState{}
	for _, runtime := range snapshot.RuntimeStates {
		runtimeByTask[runtime.TaskID] = runtime
	}

	var runningTasks []SyncTask
	failedTasks := 0
	for _, task := range snapshot.SyncTasks {
		if task.Status == TaskIncrementalRunning || task.Status == TaskFullSyncing {
			runningTasks = append(runningTasks, task)
		}
		if task.Status == TaskFailed {
			failedTasks++
		}
	}

	delaySum := 0
	for _, task := range runningTasks {
		delaySum += runtimeByTask[task.ID].DelaySeconds
	}
	averageDelay := 0
	if len(runningTasks) > 0 {
		averageDelay = delaySum / len(runningTasks)
	}

	eventsPerSecond := 0
	progressSum := 0
	progressCount := 0
	for _, runtime := range snapshot.RuntimeStates {
		eventsPerSecond += runtime.EventsPerSecond
		if runtime.FullTotalRows > 0 {
			progressSum += int((runtime.FullSyncedRows * 100) / runtime.FullTotalRows)
			progressCount++
		}
	}
	fullSyncProgress := 0
	if progressCount > 0 {
		fullSyncProgress = progressSum / progressCount
	}

	cutoff := time.Now().Add(-24 * time.Hour)
	failuresLast24Hours := 0
	for _, event := range snapshot.ErrorEvents {
		createdAt, err := time.Parse(time.RFC3339Nano, event.CreatedAt)
		if err == nil && createdAt.After(cutoff) {
			failuresLast24Hours++
		}
	}

	writeJSON(response, http.StatusOK, DashboardSummary{
		TaskTotal:           len(snapshot.SyncTasks),
		RunningTasks:        len(runningTasks),
		FailedTasks:         failedTasks,
		AverageDelaySeconds: averageDelay,
		EventsPerSecond:     eventsPerSecond,
		FailuresLast24Hours: failuresLast24Hours,
		FullSyncProgress:    fullSyncProgress,
		OnlineNodes:         clusterOnline(snapshot.Nodes),
		TotalNodes:          len(snapshot.Nodes),
		FailoverCount:       failoverCount(snapshot.TaskLeases),
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
		Name          string            `json:"name"`
		Purpose       DatasourcePurpose `json:"purpose"`
		Host          string            `json:"host"`
		Port          int               `json:"port"`
		Username      string            `json:"username"`
		Password      string            `json:"password"`
		DefaultSchema string            `json:"defaultSchema"`
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
		Purpose:        input.Purpose,
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
		Name          string            `json:"name"`
		Purpose       DatasourcePurpose `json:"purpose"`
		Host          string            `json:"host"`
		Port          int               `json:"port"`
		Username      string            `json:"username"`
		Password      string            `json:"password"`
		DefaultSchema string            `json:"defaultSchema"`
	}
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	patch := Datasource{
		Name:          input.Name,
		Purpose:       input.Purpose,
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

func (s *Server) handleSyncTasks(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		tasks := s.store.Tasks()
		filtered := make([]TaskResponse, 0, len(tasks))
		status := request.URL.Query().Get("status")
		owner := request.URL.Query().Get("owner")
		keyword := request.URL.Query().Get("keyword")
		for _, task := range tasks {
			if status != "" && string(task.Status) != status {
				continue
			}
			if owner != "" && !stringContainsFold(task.Owner, owner) {
				continue
			}
			if keyword != "" && !stringContainsFold(task.Name, keyword) && !stringContainsFold(task.Description, keyword) {
				continue
			}
			filtered = append(filtered, s.taskResponse(task))
		}
		writeJSON(response, http.StatusOK, filtered)
	case len(parts) == 1 && request.Method == http.MethodPost:
		s.createTask(response, request)
	case len(parts) == 2 && request.Method == http.MethodGet:
		task, ok := s.store.GetTask(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "同步任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, s.taskResponse(task))
	case len(parts) == 2 && request.Method == http.MethodPut:
		s.updateTask(response, request, parts[1])
	case len(parts) == 2 && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteTask(parts[1])
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "同步任务不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
	case len(parts) == 3 && isTaskAction(parts[2]) && request.Method == http.MethodPost:
		s.transitionTask(response, parts[1], parts[2])
	case len(parts) == 3 && parts[2] == "params" && request.Method == http.MethodPost:
		s.updateTaskParameters(response, request, parts[1])
	case len(parts) == 3 && parts[2] == "reset-position" && request.Method == http.MethodPost:
		s.resetTaskPosition(response, request, parts[1])
	case len(parts) == 3 && parts[2] == "rerun" && request.Method == http.MethodPost:
		s.rerunTask(response, parts[1])
	case len(parts) == 3 && parts[2] == "export" && request.Method == http.MethodGet:
		s.exportTask(response, parts[1])
	case len(parts) == 3 && parts[2] == "copy" && request.Method == http.MethodPost:
		task, ok, err := s.store.CopyTask(parts[1])
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "同步任务不存在")
			return
		}
		writeJSON(response, http.StatusCreated, s.taskResponse(task))
	case len(parts) == 3 && parts[2] == "runtime" && request.Method == http.MethodGet:
		runtime, ok := s.store.Runtime(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "同步任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, runtime)
	case len(parts) == 3 && parts[2] == "logs" && request.Method == http.MethodGet:
		logs := s.store.Logs()
		filtered := make([]OperationLog, 0)
		for _, log := range logs {
			if log.TargetID == parts[1] {
				filtered = append(filtered, log)
			}
		}
		writeJSON(response, http.StatusOK, filtered)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) createTask(response http.ResponseWriter, request *http.Request) {
	var input SyncTask
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	if err := validateTask(input); err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	task, err := s.store.CreateTask(input)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(response, http.StatusCreated, s.taskResponse(task))
}

func (s *Server) updateTask(response http.ResponseWriter, request *http.Request, id string) {
	var input SyncTask
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	task, ok, err := s.store.UpdateTask(id, input)
	if err != nil {
		writeError(response, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	writeJSON(response, http.StatusOK, s.taskResponse(task))
}

func (s *Server) transitionTask(response http.ResponseWriter, id string, action string) {
	task, ok, err := s.store.TransitionTask(id, action)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	writeJSON(response, http.StatusOK, s.taskResponse(task))
}

func (s *Server) updateTaskParameters(response http.ResponseWriter, request *http.Request, id string) {
	var input TaskParameterPatch
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	task, ok, err := s.store.UpdateTaskParameters(id, input)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	writeJSON(response, http.StatusOK, TaskOperationResult{
		Task:    s.taskResponse(task),
		Message: "任务参数已生效",
		Meta: map[string]string{
			"configVersion": intToString(task.ConfigVersion),
		},
	})
}

func (s *Server) resetTaskPosition(response http.ResponseWriter, request *http.Request, id string) {
	var input PositionResetInput
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, "请求体格式错误")
		return
	}
	task, ok, err := s.store.ResetTaskPosition(id, input)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	writeJSON(response, http.StatusOK, TaskOperationResult{
		Task:    s.taskResponse(task),
		Message: "任务位点已重置",
		Meta: map[string]string{
			"binlogFile":     input.BinlogFile,
			"binlogPosition": intToString(int(input.BinlogPosition)),
		},
	})
}

func (s *Server) rerunTask(response http.ResponseWriter, id string) {
	task, ok, err := s.store.RerunTask(id)
	if err != nil {
		writeError(response, http.StatusBadRequest, err.Error())
		return
	}
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	writeJSON(response, http.StatusOK, TaskOperationResult{
		Task:    s.taskResponse(task),
		Message: "任务已按原配置重跑",
		Meta: map[string]string{
			"status": string(task.Status),
		},
	})
}

func (s *Server) exportTask(response http.ResponseWriter, id string) {
	task, ok := s.store.GetTask(id)
	if !ok {
		writeError(response, http.StatusNotFound, "同步任务不存在")
		return
	}
	runtime, _ := s.store.Runtime(id)
	taskResponse := s.taskResponse(task)
	exported := TaskExport{
		ExportedAt: now(),
		Task:       taskResponse,
		Runtime:    runtime,
	}
	exported.Checksum = checksumJSON(struct {
		Task    TaskResponse     `json:"task"`
		Runtime TaskRuntimeState `json:"runtime"`
	}{
		Task:    exported.Task,
		Runtime: exported.Runtime,
	})
	writeJSON(response, http.StatusOK, exported)
}

func (s *Server) handleErrorEvents(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		status := request.URL.Query().Get("status")
		events := s.store.ErrorEvents()
		filtered := make([]ErrorEvent, 0, len(events))
		for _, event := range events {
			if status == "" || string(event.Status) == status {
				filtered = append(filtered, event)
			}
		}
		writeJSON(response, http.StatusOK, filtered)
	case len(parts) == 2 && parts[1] == "batch-retry" && request.Method == http.MethodPost:
		var input struct {
			IDs []string `json:"ids"`
		}
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		events := make([]ErrorEvent, 0, len(input.IDs))
		for _, id := range input.IDs {
			event, ok, _ := s.store.RetryError(id)
			if ok {
				events = append(events, event)
			}
		}
		writeJSON(response, http.StatusOK, events)
	case len(parts) == 2 && request.Method == http.MethodGet:
		event, ok := s.store.GetErrorEvent(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "错误事件不存在")
			return
		}
		writeJSON(response, http.StatusOK, event)
	case len(parts) == 3 && parts[2] == "retry" && request.Method == http.MethodPost:
		event, ok, err := s.store.RetryError(parts[1])
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "错误事件不存在")
			return
		}
		writeJSON(response, http.StatusOK, event)
	case len(parts) == 3 && parts[2] == "skip" && request.Method == http.MethodPost:
		var input struct {
			Reason string `json:"reason"`
		}
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		if strings.TrimSpace(input.Reason) == "" {
			writeError(response, http.StatusBadRequest, "跳过原因不能为空")
			return
		}
		event, ok, err := s.store.SkipError(parts[1], input.Reason)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "错误事件不存在")
			return
		}
		writeJSON(response, http.StatusOK, event)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
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
		writeJSON(response, http.StatusOK, s.store.ClusterSnapshot())
	case len(parts) == 2 && parts[1] == "nodes" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.ClusterSnapshot().Nodes)
	case len(parts) == 2 && parts[1] == "leases" && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.ClusterSnapshot().Leases)
	case len(parts) == 2 && parts[1] == "rebalance" && request.Method == http.MethodPost:
		snapshot, err := s.store.RebalanceCluster()
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(response, http.StatusOK, snapshot)
	case len(parts) == 4 && parts[1] == "nodes" && request.Method == http.MethodPost:
		var status NodeStatus
		switch parts[3] {
		case "online", "heartbeat":
			status = NodeOnline
		case "offline":
			status = NodeOffline
		case "drain":
			status = NodeDraining
		default:
			writeError(response, http.StatusNotFound, "not found")
			return
		}
		node, ok, err := s.store.MarkNodeStatus(parts[2], status)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "节点不存在")
			return
		}
		writeJSON(response, http.StatusOK, node)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleCapabilityJobs(response http.ResponseWriter, request *http.Request, parts []string) {
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		jobType := CapabilityJobType(request.URL.Query().Get("type"))
		if jobType != "" && !validCapabilityType(jobType) {
			writeError(response, http.StatusBadRequest, "能力任务类型不支持")
			return
		}
		writeJSON(response, http.StatusOK, s.store.CapabilityJobs(jobType))
	case len(parts) == 1 && request.Method == http.MethodPost:
		var input CapabilityJob
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		if !validCapabilityType(input.Type) {
			writeError(response, http.StatusBadRequest, "能力任务类型不支持")
			return
		}
		job, err := s.store.CreateCapabilityJob(input)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(response, http.StatusCreated, job)
	case len(parts) == 3 && parts[2] == "run" && request.Method == http.MethodPost:
		job, ok, err := s.store.RunCapabilityJob(parts[1])
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "能力任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, job)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) taskResponse(task SyncTask) TaskResponse {
	runtime, _ := s.store.Runtime(task.ID)
	response := TaskResponse{
		SyncTask: task,
		Runtime:  runtime,
	}
	if datasource, ok := s.store.GetDatasource(task.SourceDatasourceID); ok {
		public := toPublicDatasource(datasource)
		response.SourceDatasource = &public
	}
	if datasource, ok := s.store.GetDatasource(task.TargetDatasourceID); ok {
		public := toPublicDatasource(datasource)
		response.TargetDatasource = &public
	}
	return response
}

func clusterOnline(nodes []ClusterNode) int {
	count := 0
	for _, node := range nodes {
		if node.Status == NodeOnline {
			count++
		}
	}
	return count
}

func failoverCount(leases []TaskLease) int {
	count := 0
	for _, lease := range leases {
		count += lease.TakeoverCount
	}
	return count
}

func (s *Server) currentUser(request *http.Request) (User, bool) {
	header := request.Header.Get("Authorization")
	token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
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
	case len(parts) == 3 && parts[0] == "sync-tasks" && isTaskAction(parts[2]):
		return true
	case len(parts) == 2 && parts[0] == "error-events" && parts[1] == "batch-retry":
		return true
	case len(parts) == 3 && parts[0] == "error-events" && (parts[2] == "retry" || parts[2] == "skip"):
		return true
	case len(parts) == 3 && parts[0] == "capability-jobs" && parts[2] == "run":
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

func validateTask(task SyncTask) error {
	if task.Name == "" || task.Owner == "" || task.SourceDatasourceID == "" || task.TargetDatasourceID == "" {
		return errors.New("同步任务必填项缺失")
	}
	if len(task.TableMappings) == 0 {
		return errors.New("至少需要一个表映射")
	}
	for _, mapping := range task.TableMappings {
		if mapping.SourceSchema == "" || mapping.SourceTable == "" || mapping.TargetSchema == "" || mapping.TargetTable == "" {
			return errors.New("表映射必填项缺失")
		}
		if len(mapping.Fields) == 0 {
			return errors.New("至少需要一个字段映射")
		}
	}
	return nil
}

func isTaskAction(action string) bool {
	return action == "start" || action == "pause" || action == "resume" || action == "stop"
}

func validCapabilityType(jobType CapabilityJobType) bool {
	return jobType == CapabilityStructure || jobType == CapabilityQuality || jobType == CapabilitySubscription
}

func firstN[T any](items []T, count int) []T {
	if len(items) <= count {
		return items
	}
	return items[:count]
}

var localOriginRE = regexp.MustCompile(`^http://(localhost|127\.0\.0\.1):\d+$`)
