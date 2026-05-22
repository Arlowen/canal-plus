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

func TestOperatorCanReadAndRunOperationalActions(t *testing.T) {
	server := newTestServer(t)
	operatorToken := tokenFor("user-operator")

	readResponse := serveTestRequest(server, authRequest(http.MethodGet, "/api/datasources", operatorToken, ""))
	if readResponse.Code != http.StatusOK {
		t.Fatalf("operator read datasources status = %d body = %s", readResponse.Code, readResponse.Body.String())
	}

	testResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources/missing/test", operatorToken, ""))
	if testResponse.Code != http.StatusNotFound {
		t.Fatalf("operator datasource test should reach handler, status = %d body = %s", testResponse.Code, testResponse.Body.String())
	}

	batchRetryResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/error-events/batch-retry", operatorToken, `{"ids":[]}`))
	if batchRetryResponse.Code != http.StatusOK {
		t.Fatalf("operator batch retry status = %d body = %s", batchRetryResponse.Code, batchRetryResponse.Body.String())
	}

	var runningTask SyncTask
	for _, task := range server.store.Tasks() {
		if task.Status == TaskIncrementalRunning || task.Status == TaskFullSyncing {
			runningTask = task
			break
		}
	}
	if runningTask.ID == "" {
		t.Fatal("expected a running task in seed data")
	}
	pauseResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks/"+runningTask.ID+"/pause", operatorToken, ""))
	if pauseResponse.Code != http.StatusOK {
		t.Fatalf("operator pause task status = %d body = %s", pauseResponse.Code, pauseResponse.Body.String())
	}
}

func TestOperatorCannotMutateConfigurationOrCluster(t *testing.T) {
	server := newTestServer(t)
	operatorToken := tokenFor("user-operator")

	createDatasourceResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/datasources", operatorToken, `{"name":"blocked"}`))
	if createDatasourceResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create datasource status = %d body = %s", createDatasourceResponse.Code, createDatasourceResponse.Body.String())
	}

	createTaskResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks", operatorToken, `{}`))
	if createTaskResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create task status = %d body = %s", createTaskResponse.Code, createTaskResponse.Body.String())
	}

	rollbackResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks/task-missing/revisions/1/rollback", operatorToken, `{}`))
	if rollbackResponse.Code != http.StatusForbidden {
		t.Fatalf("operator rollback task revision status = %d body = %s", rollbackResponse.Code, rollbackResponse.Body.String())
	}

	preflightResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks/preflight", operatorToken, `{}`))
	if preflightResponse.Code != http.StatusForbidden {
		t.Fatalf("operator preflight task status = %d body = %s", preflightResponse.Code, preflightResponse.Body.String())
	}

	rebalanceResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/rebalance", operatorToken, ""))
	if rebalanceResponse.Code != http.StatusForbidden {
		t.Fatalf("operator rebalance cluster status = %d body = %s", rebalanceResponse.Code, rebalanceResponse.Body.String())
	}

	registerNodeResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes", operatorToken, `{"name":"blocked","endpoint":"10.0.0.1:4101"}`))
	if registerNodeResponse.Code != http.StatusForbidden {
		t.Fatalf("operator register node status = %d body = %s", registerNodeResponse.Code, registerNodeResponse.Body.String())
	}

	drillResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/cluster/nodes/node-a/failover-drill", operatorToken, ""))
	if drillResponse.Code != http.StatusForbidden {
		t.Fatalf("operator failover drill status = %d body = %s", drillResponse.Code, drillResponse.Body.String())
	}

	alertResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/alert-rules", operatorToken, `{}`))
	if alertResponse.Code != http.StatusForbidden {
		t.Fatalf("operator create alert rule status = %d body = %s", alertResponse.Code, alertResponse.Body.String())
	}

	correctQualityResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/capability-jobs/job-missing/quality-diffs/correct", operatorToken, `{}`))
	if correctQualityResponse.Code != http.StatusForbidden {
		t.Fatalf("operator correct quality diff status = %d body = %s", correctQualityResponse.Code, correctQualityResponse.Body.String())
	}

	applyStructureResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/capability-jobs/job-missing/structure-ddl/apply", operatorToken, `{}`))
	if applyStructureResponse.Code != http.StatusForbidden {
		t.Fatalf("operator apply structure ddl status = %d body = %s", applyStructureResponse.Code, applyStructureResponse.Body.String())
	}
}

func TestAdminCanMutateConfiguration(t *testing.T) {
	server := newTestServer(t)
	adminToken := tokenFor("user-admin")

	response := serveTestRequest(server, authRequest(
		http.MethodPost,
		"/api/datasources",
		adminToken,
		`{"name":"管理员创建","purpose":"source","host":"127.0.0.1","port":3306,"username":"root","password":"secret"}`,
	))
	if response.Code != http.StatusCreated {
		t.Fatalf("admin create datasource status = %d body = %s", response.Code, response.Body.String())
	}
}
