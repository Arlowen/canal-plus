package app

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestTaskPreflightPassesValidDemoTask(t *testing.T) {
	server := newTestServer(t)
	task := preflightDemoTask(t, server)
	body := mustJSON(t, task)

	response := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks/preflight", tokenFor("user-admin"), body))
	if response.Code != http.StatusOK {
		t.Fatalf("preflight status = %d body = %s", response.Code, response.Body.String())
	}

	var report TaskPreflightReport
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode preflight report: %v", err)
	}
	if !report.OK {
		t.Fatalf("expected preflight to pass, report = %#v", report)
	}
	if report.Summary.Failed != 0 {
		t.Fatalf("expected no failed checks, report = %#v", report)
	}
	if report.EstimatedRows == 0 {
		t.Fatalf("expected estimated rows from source metadata")
	}
	if !hasPreflightCheck(report, "cluster.capacity") {
		t.Fatalf("expected cluster capacity check in report: %#v", report.Checks)
	}
}

func TestTaskPreflightFindsMissingSourceField(t *testing.T) {
	server := newTestServer(t)
	task := preflightDemoTask(t, server)
	task.TableMappings[0].Fields[0].SourceField = "missing_column"
	body := mustJSON(t, task)

	response := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks/preflight", tokenFor("user-admin"), body))
	if response.Code != http.StatusOK {
		t.Fatalf("preflight status = %d body = %s", response.Code, response.Body.String())
	}

	var report TaskPreflightReport
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode preflight report: %v", err)
	}
	if report.OK {
		t.Fatalf("expected preflight to fail, report = %#v", report)
	}
	if report.Summary.Failed == 0 {
		t.Fatalf("expected failed checks, report = %#v", report)
	}

	createResponse := serveTestRequest(server, authRequest(http.MethodPost, "/api/sync-tasks", tokenFor("user-admin"), body))
	if createResponse.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create should be blocked by preflight, status = %d body = %s", createResponse.Code, createResponse.Body.String())
	}
}

func preflightDemoTask(t *testing.T, server *Server) SyncTask {
	t.Helper()
	snapshot := server.store.Snapshot()
	var source Datasource
	var target Datasource
	for _, datasource := range snapshot.Datasources {
		if (datasource.Purpose == PurposeSource || datasource.Purpose == PurposeBoth) && source.ID == "" {
			source = datasource
		}
		if (datasource.Purpose == PurposeTarget || datasource.Purpose == PurposeBoth) && target.ID == "" {
			target = datasource
		}
	}
	if source.ID == "" || target.ID == "" {
		t.Fatalf("seed data missing source or target datasource: %#v", snapshot.Datasources)
	}
	return SyncTask{
		Name:               "预检验证任务",
		Description:        "用于验证任务预检",
		Owner:              "数据平台",
		SourceDatasourceID: source.ID,
		TargetDatasourceID: target.ID,
		TableMappings: []TableMapping{
			{
				SourceSchema: "order_center",
				SourceTable:  "orders",
				TargetSchema: "reporting",
				TargetTable:  "ods_orders",
				Fields: []FieldMapping{
					{SourceField: "id", TargetField: "id", SourceType: "bigint", TargetType: "bigint", PrimaryKey: true},
					{SourceField: "customer_id", TargetField: "customer_id", SourceType: "bigint", TargetType: "bigint"},
					{SourceField: "status", TargetField: "status", SourceType: "varchar(32)", TargetType: "varchar(32)"},
					{SourceField: "total_amount", TargetField: "total_amount", SourceType: "decimal(12,2)", TargetType: "decimal(12,2)"},
					{SourceField: "updated_at", TargetField: "updated_at", SourceType: "datetime", TargetType: "datetime"},
				},
			},
		},
		Strategy: defaultStrategy(),
	}
}

func hasPreflightCheck(report TaskPreflightReport, id string) bool {
	for _, check := range report.Checks {
		if check.ID == id {
			return true
		}
	}
	return false
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json: %v", err)
	}
	return string(data)
}
