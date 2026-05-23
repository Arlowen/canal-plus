package app

import (
	"errors"
	"strings"
)

type preflightBuilder struct {
	report TaskPreflightReport
}

func (builder *preflightBuilder) add(id string, category string, title string, status PreflightStatus, message string, detail ...string) {
	builder.report.Checks = append(builder.report.Checks, TaskPreflightCheck{
		ID:       id,
		Category: category,
		Title:    title,
		Status:   status,
		Message:  message,
		Detail:   compactStrings(detail),
	})
	switch status {
	case PreflightFailed:
		builder.report.Summary.Failed++
	case PreflightWarning:
		builder.report.Summary.Warnings++
	default:
		builder.report.Summary.Passed++
	}
}

func (builder *preflightBuilder) finish() TaskPreflightReport {
	total := len(builder.report.Checks)
	penalty := builder.report.Summary.Failed*24 + builder.report.Summary.Warnings*8
	if total == 0 {
		builder.report.Score = 0
	} else {
		builder.report.Score = maxInt(0, 100-penalty)
	}
	builder.report.OK = builder.report.Summary.Failed == 0
	builder.report.GeneratedAt = now()
	return builder.report
}

func (s *Server) buildTaskPreflight(task SyncTask) TaskPreflightReport {
	snapshot := s.store.Snapshot()
	builder := preflightBuilder{}
	source, sourceExists := datasourceByID(snapshot.Datasources, task.SourceDatasourceID)
	target, targetExists := datasourceByID(snapshot.Datasources, task.TargetDatasourceID)

	if err := validateTask(task); err != nil {
		builder.add("task.required", "基础配置", "任务必填项", PreflightFailed, err.Error())
	} else {
		builder.add("task.required", "基础配置", "任务必填项", PreflightPassed, "任务名称、负责人、数据源和表映射已填写")
	}

	if task.SourceDatasourceID == task.TargetDatasourceID && task.SourceDatasourceID != "" {
		builder.add("task.datasource-split", "基础配置", "源端目标端隔离", PreflightWarning, "源端和目标端使用同一个数据源，请确认不是误选")
	} else {
		builder.add("task.datasource-split", "基础配置", "源端目标端隔离", PreflightPassed, "源端和目标端已分开配置")
	}

	checkDatasourceCompatibility(&builder, "source", source, sourceExists, []DatasourcePurpose{PurposeSource, PurposeBoth})
	checkDatasourceCompatibility(&builder, "target", target, targetExists, []DatasourcePurpose{PurposeTarget, PurposeBoth})

	if sourceExists {
		online, message := testDatasource(source)
		if online {
			builder.add("source.connectivity", "连接性", "源端连接", PreflightPassed, message)
		} else {
			builder.add("source.connectivity", "连接性", "源端连接", PreflightFailed, message)
		}
	}
	if targetExists {
		online, message := testDatasource(target)
		if online {
			builder.add("target.connectivity", "连接性", "目标端连接", PreflightPassed, message)
		} else {
			builder.add("target.connectivity", "连接性", "目标端连接", PreflightFailed, message)
		}
	}

	if sourceExists {
		checkSourceMappings(&builder, source, task.TableMappings)
	}
	if targetExists {
		checkTargetMappings(&builder, target, task.TableMappings)
	}

	checkStrategy(&builder, task.Strategy)
	checkDuplicateMapping(&builder, snapshot.SyncTasks, task)
	checkClusterCapacity(&builder, snapshot.Nodes, snapshot.TaskLeases)

	return builder.finish()
}

func checkDatasourceCompatibility(builder *preflightBuilder, side string, datasource Datasource, exists bool, allowed []DatasourcePurpose) {
	titlePrefix := "源端"
	if side == "target" {
		titlePrefix = "目标端"
	}
	if !exists {
		builder.add(side+".datasource", "数据源", titlePrefix+"数据源", PreflightFailed, titlePrefix+"数据源不存在")
		return
	}
	if !purposeAllowed(datasource.Purpose, allowed) {
		builder.add(side+".datasource", "数据源", titlePrefix+"用途", PreflightFailed, titlePrefix+"数据源用途不匹配："+string(datasource.Purpose))
		return
	}
	status := PreflightPassed
	message := titlePrefix + "数据源用途匹配"
	if datasource.ConnectionStatus == DatasourceOffline {
		status = PreflightFailed
		message = titlePrefix + "数据源最近连接测试失败"
	} else if datasource.ConnectionStatus == DatasourceUntested {
		status = PreflightWarning
		message = titlePrefix + "数据源还没有保存过连接测试结果"
	}
	builder.add(side+".datasource", "数据源", titlePrefix+"用途与状态", status, message, datasource.Name)
}

func checkSourceMappings(builder *preflightBuilder, source Datasource, mappings []TableMapping) {
	if len(mappings) == 0 {
		return
	}
	validMappings := 0
	estimatedRows := int64(0)
	details := []string{}
	for _, mapping := range mappings {
		sourceTable, columns, err := sourceTableMetadata(source, mapping.SourceSchema, mapping.SourceTable)
		label := mapping.SourceSchema + "." + mapping.SourceTable
		if err != nil {
			details = append(details, label+": "+err.Error())
			continue
		}
		if sourceTable.Name == "" {
			details = append(details, label+": 源表不存在")
			continue
		}
		estimatedRows += sourceTable.Rows
		columnByName := tableColumnsByName(columns)
		missingFields := []string{}
		mappedFields := 0
		hasPrimaryKey := false
		for _, field := range mapping.Fields {
			if field.Ignored {
				continue
			}
			mappedFields++
			column, ok := columnByName[strings.ToLower(field.SourceField)]
			if !ok {
				missingFields = append(missingFields, field.SourceField)
				continue
			}
			if column.PrimaryKey || field.PrimaryKey {
				hasPrimaryKey = true
			}
		}
		if mappedFields == 0 {
			details = append(details, label+": 没有可同步字段")
			continue
		}
		if len(missingFields) > 0 {
			details = append(details, label+": 字段不存在 "+strings.Join(missingFields, ", "))
			continue
		}
		if !hasPrimaryKey {
			details = append(details, label+": 未检测到主键字段，增量更新和订正风险较高")
		}
		validMappings++
	}
	builder.report.EstimatedRows = estimatedRows
	if validMappings == len(mappings) && len(details) == 0 {
		builder.add("source.mapping", "表结构", "源端表与字段", PreflightPassed, "源端表和字段映射可访问", intToString(validMappings)+" 张表")
		return
	}
	if validMappings == len(mappings) {
		builder.add("source.mapping", "表结构", "源端表与字段", PreflightWarning, "源端表可访问，但存在需要确认的结构风险", details...)
		return
	}
	builder.add("source.mapping", "表结构", "源端表与字段", PreflightFailed, "源端表或字段映射不可用", details...)
}

func checkTargetMappings(builder *preflightBuilder, target Datasource, mappings []TableMapping) {
	if len(mappings) == 0 {
		return
	}
	missingTables := []string{}
	incompatibleFields := []string{}
	for _, mapping := range mappings {
		_, columns, err := sourceTableMetadata(target, mapping.TargetSchema, mapping.TargetTable)
		label := mapping.TargetSchema + "." + mapping.TargetTable
		if err != nil {
			missingTables = append(missingTables, label+": "+err.Error())
			continue
		}
		if len(columns) == 0 {
			missingTables = append(missingTables, label)
			continue
		}
		columnByName := tableColumnsByName(columns)
		for _, field := range mapping.Fields {
			if field.Ignored {
				continue
			}
			targetColumn, ok := columnByName[strings.ToLower(field.TargetField)]
			if !ok {
				incompatibleFields = append(incompatibleFields, label+"."+field.TargetField+": 目标字段不存在")
				continue
			}
			if !compatibleColumnType(field.SourceType, targetColumn.Type) {
				incompatibleFields = append(incompatibleFields, label+"."+field.TargetField+": "+field.SourceType+" -> "+targetColumn.Type)
			}
		}
	}
	if len(incompatibleFields) > 0 {
		builder.add("target.mapping", "表结构", "目标端字段兼容性", PreflightFailed, "目标表字段不兼容", incompatibleFields...)
		return
	}
	if len(missingTables) > 0 {
		builder.add("target.mapping", "表结构", "目标端表准备", PreflightWarning, "目标表不存在或无法读取，可先执行结构迁移计划", missingTables...)
		return
	}
	builder.add("target.mapping", "表结构", "目标端字段兼容性", PreflightPassed, "目标端表结构与字段映射兼容")
}

func checkStrategy(builder *preflightBuilder, strategy SyncStrategy) {
	details := []string{}
	if strategy.BatchSize <= 0 {
		details = append(details, "批量写入大小必须大于 0")
	}
	if strategy.RetryTimes < 0 {
		details = append(details, "失败重试次数不能小于 0")
	}
	if strategy.RetryIntervalSeconds <= 0 {
		details = append(details, "重试间隔必须大于 0")
	}
	if !strategy.WriteMode.Insert && !strategy.WriteMode.Update && !strategy.WriteMode.Delete {
		details = append(details, "至少需要订阅一种写入事件")
	}
	if strategy.InitMode != "full_then_incremental" && strategy.InitMode != "incremental_only" && strategy.InitMode != "full_only" {
		details = append(details, "初始化策略不支持："+strategy.InitMode)
	}
	if strategy.ConflictStrategy != "overwrite" && strategy.ConflictStrategy != "ignore" && strategy.ConflictStrategy != "fail" {
		details = append(details, "冲突策略不支持："+strategy.ConflictStrategy)
	}
	if strategy.DeleteStrategy != "physical" && strategy.DeleteStrategy != "soft_delete" && strategy.DeleteStrategy != "ignore" {
		details = append(details, "删除策略不支持："+strategy.DeleteStrategy)
	}
	if len(details) > 0 {
		builder.add("strategy.safety", "同步策略", "策略参数", PreflightFailed, "同步策略存在无效配置", details...)
		return
	}
	builder.add("strategy.safety", "同步策略", "策略参数", PreflightPassed, "同步策略参数有效")
}

func checkDuplicateMapping(builder *preflightBuilder, tasks []SyncTask, candidate SyncTask) {
	duplicates := []string{}
	candidateKeys := mappingKeys(candidate)
	for _, task := range tasks {
		if task.ID != "" && candidate.ID != "" && task.ID == candidate.ID {
			continue
		}
		if task.SourceDatasourceID != candidate.SourceDatasourceID || task.TargetDatasourceID != candidate.TargetDatasourceID {
			continue
		}
		for key := range candidateKeys {
			if mappingKeys(task)[key] {
				duplicates = append(duplicates, task.Name+" / "+key)
				break
			}
		}
	}
	if len(duplicates) > 0 {
		builder.add("task.duplicate", "任务冲突", "重复订阅", PreflightWarning, "已有任务订阅相同源表和目标表，请确认不会重复写入", duplicates...)
		return
	}
	builder.add("task.duplicate", "任务冲突", "重复订阅", PreflightPassed, "未发现相同源端、目标端和表映射的任务")
}

func checkClusterCapacity(builder *preflightBuilder, nodes []ClusterNode, leases []TaskLease) {
	onlineCapacity := 0
	onlineRunning := 0
	for _, node := range nodes {
		if node.Status != NodeOnline {
			continue
		}
		onlineCapacity += node.Capacity
		onlineRunning += node.RunningTasks
	}
	if onlineCapacity == 0 {
		builder.add("cluster.capacity", "分布式运行", "Node 承载能力", PreflightFailed, "当前没有在线 node 承载同步任务")
		return
	}
	if onlineCapacity <= onlineRunning || len(leases) >= onlineCapacity {
		builder.add("cluster.capacity", "分布式运行", "Node 承载能力", PreflightWarning, "在线 node 容量接近上限，发布后可能触发排队或需要扩容", "online="+intToString(onlineRunning), "capacity="+intToString(onlineCapacity))
		return
	}
	builder.add("cluster.capacity", "分布式运行", "Node 承载能力", PreflightPassed, "在线 node 有剩余容量，任务发布后可被 lease 调度")
}

func sourceTableMetadata(datasource Datasource, schema string, table string) (TableInfo, []TableColumn, error) {
	if schema == "" || table == "" {
		return TableInfo{}, nil, errors.New("库表为空")
	}
	tables, err := listTables(datasource, schema)
	if err != nil {
		return TableInfo{}, nil, err
	}
	for _, tableInfo := range tables {
		if tableInfo.Name != table {
			continue
		}
		columns, err := listColumns(datasource, schema, table)
		if err != nil {
			return TableInfo{}, nil, err
		}
		return tableInfo, columns, nil
	}
	return TableInfo{}, nil, nil
}

func datasourceByID(datasources []Datasource, id string) (Datasource, bool) {
	for _, datasource := range datasources {
		if datasource.ID == id {
			return datasource, true
		}
	}
	return Datasource{}, false
}

func purposeAllowed(purpose DatasourcePurpose, allowed []DatasourcePurpose) bool {
	for _, value := range allowed {
		if purpose == value {
			return true
		}
	}
	return false
}

func tableColumnsByName(columns []TableColumn) map[string]TableColumn {
	result := map[string]TableColumn{}
	for _, column := range columns {
		result[strings.ToLower(column.Name)] = column
	}
	return result
}

func compatibleColumnType(sourceType string, targetType string) bool {
	source := normalizeColumnType(sourceType)
	target := normalizeColumnType(targetType)
	if source == "" || target == "" {
		return true
	}
	if source == target {
		return true
	}
	if strings.HasPrefix(source, "varchar") && strings.HasPrefix(target, "varchar") {
		return true
	}
	if strings.HasPrefix(source, "decimal") && strings.HasPrefix(target, "decimal") {
		return true
	}
	if strings.Contains(source, "int") && strings.Contains(target, "int") {
		return true
	}
	return false
}

func normalizeColumnType(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func mappingKeys(task SyncTask) map[string]bool {
	keys := map[string]bool{}
	for _, mapping := range task.TableMappings {
		key := mapping.SourceSchema + "." + mapping.SourceTable + "->" + mapping.TargetSchema + "." + mapping.TargetTable
		keys[key] = true
	}
	return keys
}

func compactStrings(items []string) []string {
	result := []string{}
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}
