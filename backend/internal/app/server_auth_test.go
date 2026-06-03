package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()
	return &Server{store: newTestStore(t)}
}

func createTestDatasource(t *testing.T, store *Store) Datasource {
	t.Helper()
	password, err := encryptText("test-password")
	if err != nil {
		t.Fatalf("encrypt test datasource password: %v", err)
	}
	datasource, err := store.CreateDatasource(Datasource{
		Name:           "测试数据源",
		Type:           DatasourceTypeMySQL,
		Purpose:        DatasourcePurposeSource,
		Host:           "127.0.0.1",
		Port:           3306,
		Username:       "tester",
		PasswordSecret: password,
		DefaultSchema:  "testdb",
		Remark:         "测试",
	}, DatasourceTestResult{
		Success:   true,
		Status:    DatasourceAvailable,
		Version:   "MySQL 8.0.44",
		LatencyMS: 1,
		TestedAt:  now(),
		Message:   "Connection available",
	})
	if err != nil {
		t.Fatalf("create test datasource: %v", err)
	}
	return datasource
}

func createNamedTestDatasource(t *testing.T, store *Store, name string, purpose DatasourcePurpose) Datasource {
	t.Helper()
	password, err := encryptText("test-password")
	if err != nil {
		t.Fatalf("encrypt test datasource password: %v", err)
	}
	datasource, err := store.CreateDatasource(Datasource{
		Name:           name,
		Type:           DatasourceTypeMySQL,
		Purpose:        purpose,
		Host:           "127.0.0.1",
		Port:           3306,
		Username:       "tester",
		PasswordSecret: password,
		DefaultSchema:  "testdb",
	}, DatasourceTestResult{
		Success:   true,
		Status:    DatasourceAvailable,
		Version:   "MySQL 8.0.44",
		LatencyMS: 1,
		TestedAt:  now(),
		Message:   "Connection available",
	})
	if err != nil {
		t.Fatalf("create test datasource %s: %v", name, err)
	}
	return datasource
}

func jsonBody(t *testing.T, value any) string {
	t.Helper()
	bytes, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json body: %v", err)
	}
	return string(bytes)
}

func authRequest(method string, path string, token string, body string) *http.Request {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+token)
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	return request
}

func serveTestRequest(server *Server, request *http.Request) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	server.ServeHTTP(response, request)
	return response
}

func tokenFor(userID string) string {
	return "dev-token:" + userID
}

func TestOperatorCanReadAndTestDatasources(t *testing.T) {
	server := newTestServer(t)
	operatorToken := tokenFor("user-operator")

	readResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources", operatorToken, ""))
	if readResponse.Code != http.StatusOK {
		t.Fatalf("operator read datasources status = %d body = %s", readResponse.Code, readResponse.Body.String())
	}

	runtimeConfigResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/runtime/config", operatorToken, ""))
	if runtimeConfigResponse.Code != http.StatusOK {
		t.Fatalf("operator read runtime config status = %d body = %s", runtimeConfigResponse.Code, runtimeConfigResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/missing/test", operatorToken, ""))
	if testResponse.Code != http.StatusNotFound {
		t.Fatalf("operator datasource test should reach handler, status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}
}

func TestOperatorCannotMutateConfigurationOrCluster(t *testing.T) {
	server := newTestServer(t)
	operatorToken := tokenFor("user-operator")

	createDatasourceResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources", operatorToken, `{"name":"blocked"}`))
	if createDatasourceResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create datasource status = %d body = %s", createDatasourceResponse.Code, createDatasourceResponse.Body.String())
	}

	clusterMutationResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/node-local/offline", operatorToken, ""))
	if clusterMutationResponse.Code != http.StatusForbidden {
		t.Fatalf("operator cluster mutation status = %d body = %s", clusterMutationResponse.Code, clusterMutationResponse.Body.String())
	}

	alertResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/alert-rules", operatorToken, `{}`))
	if alertResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create alert rule status = %d body = %s", alertResponse.Code, alertResponse.Body.String())
	}

	channelResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/channels", operatorToken, `{}`))
	if channelResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create channel status = %d body = %s", channelResponse.Code, channelResponse.Body.String())
	}
}

func TestReadonlyCanOnlyReadDatasources(t *testing.T) {
	server := newTestServer(t)
	readonlyToken := tokenFor("user-readonly")
	datasource := createTestDatasource(t, server.store)

	readResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources", readonlyToken, ""))
	if readResponse.Code != http.StatusOK {
		t.Fatalf("readonly read datasources status = %d body = %s", readResponse.Code, readResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/"+datasource.ID+"/test", readonlyToken, ""))
	if testResponse.Code != http.StatusForbidden {
		t.Fatalf("readonly test datasource status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	createResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources", readonlyToken, `{"name":"blocked"}`))
	if createResponse.Code != http.StatusForbidden {
		t.Fatalf("readonly create datasource status = %d body = %s", createResponse.Code, createResponse.Body.String())
	}
}

func TestRemovedLegacyRoutesAreNotFound(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")

	for _, path := range []string{
		"/api/datasources/source-id/schemas",
		"/api/datasources/source-id/schemas/order_center/tables",
		"/api/datasources/source-id/schemas/order_center/tables/orders/columns",
		"/api/sync-tasks",
		"/api/error-events",
		"/api/capability-jobs",
		"/api/sync-strategy/default",
		"/api/dashboard/summary",
	} {
		response := serveTestRequest(server, authRequest(http.MethodGet, path, adminToken, ""))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d body = %s", path, response.Code, response.Body.String())
		}
	}
}

func TestManualNodeCreationRoutesAreNotFound(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")

	for _, path := range []string{
		"/api/cluster/nodes",
		"/api/cluster/nodes/test-connection",
		"/api/cluster/nodes/deploy",
	} {
		response := serveTestRequest(server, authRequest(http.MethodPost, path, adminToken, `{}`))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s status = %d body = %s", path, response.Code, response.Body.String())
		}
	}
}

func TestAdminCannotOperateLocalControlNodeWithUnsafeActions(t *testing.T) {
	server := newTestServer(t)
	localNodeID := server.store.ClusterSnapshot().Nodes[0].ID
	server.localNodeID = localNodeID
	adminToken := tokenFor("user-admin")

	offlineResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/"+localNodeID+"/offline", adminToken, ""))
	if offlineResponse.Code != http.StatusBadRequest {
		t.Fatalf("admin offline local node status = %d body = %s", offlineResponse.Code, offlineResponse.Body.String())
	}

	uninstallResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/"+localNodeID+"/uninstall", adminToken, ""))
	if uninstallResponse.Code != http.StatusBadRequest {
		t.Fatalf("admin uninstall local node status = %d body = %s", uninstallResponse.Code, uninstallResponse.Body.String())
	}
}

func TestAdminCanDeleteClusterNode(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	nodeID := server.store.ClusterSnapshot().Nodes[0].ID
	if _, ok, err := server.store.MarkNodeStatus(nodeID, NodeOffline); err != nil || !ok {
		t.Fatalf("mark node offline ok=%v err=%v", ok, err)
	}

	deleteResponse := serveTestRequest(server, authRequest(http.MethodDelete, "/api/cluster/nodes/"+nodeID, adminToken, ""))
	if deleteResponse.Code != http.StatusNoContent {
		t.Fatalf("admin delete node status = %d body = %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	snapshot := server.store.ClusterSnapshot()
	if snapshot.TotalNodes != 0 {
		t.Fatalf("total nodes = %d, want 0", snapshot.TotalNodes)
	}
}

func TestAdminCannotDeleteOnlineClusterNode(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	nodeID := server.store.ClusterSnapshot().Nodes[0].ID

	deleteResponse := serveTestRequest(server, authRequest(http.MethodDelete, "/api/cluster/nodes/"+nodeID, adminToken, ""))
	if deleteResponse.Code != http.StatusConflict {
		t.Fatalf("admin delete online node status = %d body = %s", deleteResponse.Code, deleteResponse.Body.String())
	}

	snapshot := server.store.ClusterSnapshot()
	if snapshot.TotalNodes != 1 {
		t.Fatalf("total nodes = %d, want 1", snapshot.TotalNodes)
	}
}

func TestRegisterLocalControlNodeAddsConfiguredNode(t *testing.T) {
	store := newTestStore(t)
	t.Setenv("CANAL_PLUS_NODE_ID", "node-worker-a")
	t.Setenv("CANAL_PLUS_NODE_NAME", "worker-a")
	t.Setenv("CANAL_PLUS_NODE_ENDPOINT", "10.0.0.2:4101")
	t.Setenv("CANAL_PLUS_NODE_ROLE", "worker")
	t.Setenv("CANAL_PLUS_NODE_ZONE", "zone-a")
	t.Setenv("CANAL_PLUS_NODE_CAPACITY", "8")

	node, err := registerLocalControlNode(store, "4101")
	if err != nil {
		t.Fatalf("registerLocalControlNode() error = %v", err)
	}
	if node.ID != "node-worker-a" || node.Name != "worker-a" || node.Endpoint != "10.0.0.2:4101" {
		t.Fatalf("registered node mismatch: %#v", node)
	}

	snapshot := store.ClusterSnapshot()
	if snapshot.TotalNodes != 2 {
		t.Fatalf("expected configured local node to be added, got %d nodes", snapshot.TotalNodes)
	}
	if snapshot.LocalNodeID != "" {
		t.Fatalf("store snapshot should not set response-only local node id, got %q", snapshot.LocalNodeID)
	}
}

func TestRegisterLocalControlNodePreservesStoredNameWhenNameEnvMissing(t *testing.T) {
	store := newTestStore(t)
	snapshot := store.ClusterSnapshot()
	existingID := snapshot.Nodes[0].ID
	t.Setenv("CANAL_PLUS_NODE_ID", existingID)
	t.Setenv("CANAL_PLUS_NODE_NAME", "")

	if _, _, err := store.UpdateNodeName(existingID, ClusterNodeNameInput{Name: "custom-local"}); err != nil {
		t.Fatalf("update node name: %v", err)
	}
	node, err := registerLocalControlNode(store, "4100")
	if err != nil {
		t.Fatalf("registerLocalControlNode() error = %v", err)
	}
	if node.Name != "custom-local" {
		t.Fatalf("node name = %q, want custom-local", node.Name)
	}
}

func TestAdminCanMutateConfiguration(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	previousTester := datasourceConnectionTester
	datasourceConnectionTester = func(datasource Datasource) DatasourceTestResult {
		return DatasourceTestResult{
			Success:   true,
			Status:    DatasourceAvailable,
			LatencyMS: 12,
			TestedAt:  now(),
			Message:   "Connection available",
		}
	}
	defer func() {
		datasourceConnectionTester = previousTester
	}()

	payload := `{"name":"管理员创建","type":"mysql","purpose":"general","host":"127.0.0.1","port":3306,"username":"root","password":"secret"}`

	untestedResponse := serveTestRequest(server, authRequest(
		http.MethodPost,
		"/api/datasources",
		adminToken,
		payload,
	))
	if untestedResponse.Code != http.StatusBadRequest {
		t.Fatalf("admin create datasource without test status = %d body = %s", untestedResponse.Code, untestedResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(
		http.MethodPost,
		"/api/datasources/test",
		adminToken,
		payload,
	))
	if testResponse.Code != http.StatusOK {
		t.Fatalf("admin test datasource status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	response := serveTestRequest(server, authRequest(
		http.MethodPost,
		"/api/datasources",
		adminToken,
		payload,
	))
	if response.Code != http.StatusCreated {
		t.Fatalf("admin create datasource status = %d body = %s", response.Code, response.Body.String())
	}
}

func TestAdminCanManageChannelAndRunTask(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	source := createNamedTestDatasource(t, server.store, "source", DatasourcePurposeSource)
	target := createNamedTestDatasource(t, server.store, "target", DatasourcePurposeTarget)

	channelResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/channels", adminToken, jsonBody(t, map[string]any{
		"name":               "订单同步",
		"sourceDatasourceId": source.ID,
		"targetDatasourceId": target.ID,
	})))
	if channelResponse.Code != http.StatusCreated {
		t.Fatalf("admin create channel status = %d body = %s", channelResponse.Code, channelResponse.Body.String())
	}
	var channel Channel
	if err := json.NewDecoder(channelResponse.Body).Decode(&channel); err != nil {
		t.Fatalf("decode channel: %v", err)
	}

	mappingResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/channels/"+channel.ID+"/mappings", adminToken, jsonBody(t, map[string]any{
		"tables": []map[string]any{{
			"sourceTable": "A",
			"targetTable": "B",
			"primaryKeys": []string{"a"},
			"columns": []map[string]any{
				{"sourceColumn": "a", "targetColumn": "A", "isPrimaryKey": true},
				{"sourceColumn": "b", "targetColumn": "B"},
			},
		}},
	})))
	if mappingResponse.Code != http.StatusOK {
		t.Fatalf("admin save mappings status = %d body = %s", mappingResponse.Code, mappingResponse.Body.String())
	}

	taskResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/channels/"+channel.ID+"/tasks", adminToken, jsonBody(t, map[string]any{
		"name": "结构对比",
		"type": "schema_compare",
	})))
	if taskResponse.Code != http.StatusCreated {
		t.Fatalf("admin create task status = %d body = %s", taskResponse.Code, taskResponse.Body.String())
	}
	var task ChannelTask
	if err := json.NewDecoder(taskResponse.Body).Decode(&task); err != nil {
		t.Fatalf("decode task: %v", err)
	}

	startResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/channels/"+channel.ID+"/tasks/"+task.ID+"/start", adminToken, ""))
	if startResponse.Code != http.StatusOK {
		t.Fatalf("admin start task status = %d body = %s", startResponse.Code, startResponse.Body.String())
	}
}

func TestAdminCanReadDatasourceMetadata(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	datasource := createNamedTestDatasource(t, server.store, "metadata-source", DatasourcePurposeSource)
	originalDatabaseLister := datasourceDatabaseLister
	originalTableLister := datasourceTableLister
	originalColumnLister := datasourceColumnLister
	t.Cleanup(func() {
		datasourceDatabaseLister = originalDatabaseLister
		datasourceTableLister = originalTableLister
		datasourceColumnLister = originalColumnLister
	})
	datasourceDatabaseLister = func(input Datasource) ([]string, error) {
		if input.ID != datasource.ID {
			t.Fatalf("unexpected datasource id = %q", input.ID)
		}
		return []string{"sales"}, nil
	}
	datasourceTableLister = func(input Datasource, database string) ([]string, error) {
		if input.ID != datasource.ID {
			t.Fatalf("unexpected datasource id = %q", input.ID)
		}
		if database != "sales" {
			t.Fatalf("database = %q, want sales", database)
		}
		return []string{"orders"}, nil
	}
	datasourceColumnLister = func(input Datasource, database string, table string) ([]DatasourceColumn, error) {
		if input.ID != datasource.ID {
			t.Fatalf("unexpected datasource id = %q", input.ID)
		}
		if database != "sales" {
			t.Fatalf("database = %q, want sales", database)
		}
		if table != "orders" {
			t.Fatalf("table = %q, want orders", table)
		}
		return []DatasourceColumn{
			{Name: "id", Type: "bigint", Nullable: false, IsPrimaryKey: true},
			{Name: "amount", Type: "decimal(12,2)", Nullable: false},
		}, nil
	}

	databasesResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources/"+datasource.ID+"/databases", adminToken, ""))
	if databasesResponse.Code != http.StatusOK {
		t.Fatalf("read databases status = %d body = %s", databasesResponse.Code, databasesResponse.Body.String())
	}
	if !strings.Contains(databasesResponse.Body.String(), `"sales"`) {
		t.Fatalf("read databases body = %s", databasesResponse.Body.String())
	}

	tablesResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources/"+datasource.ID+"/tables?database=sales", adminToken, ""))
	if tablesResponse.Code != http.StatusOK {
		t.Fatalf("read tables status = %d body = %s", tablesResponse.Code, tablesResponse.Body.String())
	}
	if !strings.Contains(tablesResponse.Body.String(), `"orders"`) {
		t.Fatalf("read tables body = %s", tablesResponse.Body.String())
	}

	columnsResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources/"+datasource.ID+"/columns?database=sales&table=orders", adminToken, ""))
	if columnsResponse.Code != http.StatusOK {
		t.Fatalf("read columns status = %d body = %s", columnsResponse.Code, columnsResponse.Body.String())
	}
	if !strings.Contains(columnsResponse.Body.String(), `"id"`) || !strings.Contains(columnsResponse.Body.String(), `"isPrimaryKey":true`) {
		t.Fatalf("read columns body = %s", columnsResponse.Body.String())
	}
}

func TestOperatorCanRunChannelTaskButCannotEdit(t *testing.T) {
	server := newTestServer(t)
	operatorToken := tokenFor("user-operator")
	source := createNamedTestDatasource(t, server.store, "source", DatasourcePurposeSource)
	target := createNamedTestDatasource(t, server.store, "target", DatasourcePurposeTarget)
	channel, err := server.store.CreateChannel(ChannelInput{
		Name:               "订单同步",
		SourceDatasourceID: source.ID,
		TargetDatasourceID: target.ID,
	}, "admin")
	if err != nil {
		t.Fatalf("create channel: %v", err)
	}
	if _, ok, err := server.store.SaveChannelMappings(channel.ID, ChannelMappingsInput{
		Tables: []ChannelTableMappingInput{{
			SourceTable: "A",
			TargetTable: "B",
			PrimaryKeys: []string{"a"},
			Columns: []ChannelColumnMappingInput{
				{SourceColumn: "a", TargetColumn: "A", IsPrimaryKey: true},
				{SourceColumn: "b", TargetColumn: "B"},
			},
		}},
	}, "admin"); err != nil || !ok {
		t.Fatalf("save mappings ok=%v err=%v", ok, err)
	}
	task, ok, err := server.store.CreateChannelTask(channel.ID, ChannelTaskInput{Name: "结构对比", Type: ChannelTaskSchemaCompare}, "admin")
	if err != nil || !ok {
		t.Fatalf("create task ok=%v err=%v", ok, err)
	}

	editResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/channels/"+channel.ID+"/tasks/"+task.ID, operatorToken, jsonBody(t, map[string]any{
		"name": "blocked",
		"type": "schema_compare",
	})))
	if editResponse.Code != http.StatusForbidden {
		t.Fatalf("operator edit task status = %d body = %s", editResponse.Code, editResponse.Body.String())
	}

	startResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/channels/"+channel.ID+"/tasks/"+task.ID+"/start", operatorToken, ""))
	if startResponse.Code != http.StatusOK {
		t.Fatalf("operator start task status = %d body = %s", startResponse.Code, startResponse.Body.String())
	}
}

func TestAdminDatasourceInputTestRejectsMissingNode(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	payload := `{"nodeId":"missing-node","name":"节点校验数据源","type":"mysql","purpose":"general","authType":"none","host":"127.0.0.1","port":3306}`

	response := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/test", adminToken, payload))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("test datasource input with missing node status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "节点不存在") {
		t.Fatalf("missing node response should explain failure: %s", response.Body.String())
	}
}

func TestAdminCanCreateDatasourceWithoutAccountPassword(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	previousTester := datasourceConnectionTester
	datasourceConnectionTester = func(datasource Datasource) DatasourceTestResult {
		if datasource.Username != "" || datasource.PasswordSecret != "" {
			t.Fatalf("expected empty datasource credentials, got username=%q passwordSecret=%q", datasource.Username, datasource.PasswordSecret)
		}
		return DatasourceTestResult{
			Success:   true,
			Status:    DatasourceAvailable,
			LatencyMS: 12,
			TestedAt:  now(),
			Message:   "Connection available",
		}
	}
	defer func() {
		datasourceConnectionTester = previousTester
	}()

	payload := `{"name":"免密数据源","type":"mysql","purpose":"general","authType":"none","host":"127.0.0.1","port":3306}`

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/test", adminToken, payload))
	if testResponse.Code != http.StatusOK {
		t.Fatalf("test no-auth datasource status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	response := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources", adminToken, payload))
	if response.Code != http.StatusCreated {
		t.Fatalf("create no-auth datasource status = %d body = %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"hasPassword":false`) {
		t.Fatalf("create no-auth response should expose hasPassword false: %s", response.Body.String())
	}
}

func TestDatasourceCanSwitchToNoAccountPassword(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	datasource := createTestDatasource(t, server.store)
	previousTester := datasourceConnectionTester
	datasourceConnectionTester = func(datasource Datasource) DatasourceTestResult {
		return DatasourceTestResult{
			Success:   true,
			Status:    DatasourceAvailable,
			LatencyMS: 12,
			TestedAt:  now(),
			Message:   "Connection available",
		}
	}
	defer func() {
		datasourceConnectionTester = previousTester
	}()

	payload := `{"id":"` + datasource.ID + `","name":"` + datasource.Name + `","type":"mysql","purpose":"general","authType":"none","host":"` + datasource.Host + `","port":` + intToString(datasource.Port) + `}`

	untestedResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/datasources/"+datasource.ID, adminToken, payload))
	if untestedResponse.Code != http.StatusBadRequest {
		t.Fatalf("switch to no-auth without test status = %d body = %s", untestedResponse.Code, untestedResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/test", adminToken, payload))
	if testResponse.Code != http.StatusOK {
		t.Fatalf("test no-auth update status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	updateResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/datasources/"+datasource.ID, adminToken, payload))
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("switch to no-auth status = %d body = %s", updateResponse.Code, updateResponse.Body.String())
	}
	updated, ok := server.store.GetDatasource(datasource.ID)
	if !ok {
		t.Fatal("updated datasource missing")
	}
	if updated.Username != "" || updated.PasswordSecret != "" {
		t.Fatalf("expected credentials to be cleared, got username=%q passwordSecret=%q", updated.Username, updated.PasswordSecret)
	}
}

func TestDatasourceUpdateRequiresRetestWhenConnectionChanges(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	datasource := createTestDatasource(t, server.store)
	previousTester := datasourceConnectionTester
	datasourceConnectionTester = func(datasource Datasource) DatasourceTestResult {
		return DatasourceTestResult{
			Success:   true,
			Status:    DatasourceAvailable,
			LatencyMS: 12,
			TestedAt:  now(),
			Message:   "Connection available",
		}
	}
	defer func() {
		datasourceConnectionTester = previousTester
	}()

	metadataOnlyPayload := `{"name":"仅改名称","type":"mysql","purpose":"source","host":"` + datasource.Host + `","port":3306,"username":"` + datasource.Username + `","defaultSchema":"` + datasource.DefaultSchema + `","remark":"` + datasource.Remark + `"}`
	metadataOnlyResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/datasources/"+datasource.ID, adminToken, metadataOnlyPayload))
	if metadataOnlyResponse.Code != http.StatusOK {
		t.Fatalf("metadata-only update status = %d body = %s", metadataOnlyResponse.Code, metadataOnlyResponse.Body.String())
	}

	connectionPayload := `{"id":"` + datasource.ID + `","name":"仅改名称","type":"mysql","purpose":"source","host":"mysql-new.internal","port":3306,"username":"` + datasource.Username + `","defaultSchema":"` + datasource.DefaultSchema + `","remark":"` + datasource.Remark + `"}`
	untestedResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/datasources/"+datasource.ID, adminToken, connectionPayload))
	if untestedResponse.Code != http.StatusBadRequest {
		t.Fatalf("connection update without test status = %d body = %s", untestedResponse.Code, untestedResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/test", adminToken, connectionPayload))
	if testResponse.Code != http.StatusOK {
		t.Fatalf("test changed connection status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	updateResponse := serveTestRequest(server, authRequest(http.MethodPut, "/api/datasources/"+datasource.ID, adminToken, connectionPayload))
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("connection update after test status = %d body = %s", updateResponse.Code, updateResponse.Body.String())
	}
}

func TestDatasourceAPIHidesPasswordSecret(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")
	createTestDatasource(t, server.store)

	response := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources", adminToken, ""))
	if response.Code != http.StatusOK {
		t.Fatalf("list datasources status = %d body = %s", response.Code, response.Body.String())
	}
	body := response.Body.String()
	if strings.Contains(body, "passwordSecret") || strings.Contains(body, "demo-password") {
		t.Fatalf("datasource response leaked password material: %s", body)
	}
}
