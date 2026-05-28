package app

import (
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

	registerNodeResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes", operatorToken, `{"name":"blocked","endpoint":"10.0.0.1:4101"}`))
	if registerNodeResponse.Code != http.StatusForbidden {
		t.Fatalf("operator register node status = %d body = %s", registerNodeResponse.Code, registerNodeResponse.Body.String())
	}

	alertResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/alert-rules", operatorToken, `{}`))
	if alertResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create alert rule status = %d body = %s", alertResponse.Code, alertResponse.Body.String())
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

func TestAdminCannotOperateLocalControlNodeWithUnsafeActions(t *testing.T) {
	server := newTestServer(t)
	server.localNodeID = "node-shanghai-a"
	adminToken := tokenFor("user-admin")

	offlineResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/node-shanghai-a/offline", adminToken, ""))
	if offlineResponse.Code != http.StatusBadRequest {
		t.Fatalf("admin offline local node status = %d body = %s", offlineResponse.Code, offlineResponse.Body.String())
	}

	uninstallResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/node-shanghai-a/uninstall", adminToken, ""))
	if uninstallResponse.Code != http.StatusBadRequest {
		t.Fatalf("admin uninstall local node status = %d body = %s", uninstallResponse.Code, uninstallResponse.Body.String())
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
