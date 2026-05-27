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

func TestRemovedLegacyRoutesAreNotFound(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")

	for _, path := range []string{
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

	response := serveTestRequest(server, authRequest(
		http.MethodPost,
		"/api/datasources",
		adminToken,
		`{"name":"管理员创建","host":"127.0.0.1","port":3306,"username":"root","password":"secret"}`,
	))
	if response.Code != http.StatusCreated {
		t.Fatalf("admin create datasource status = %d body = %s", response.Code, response.Body.String())
	}
}
