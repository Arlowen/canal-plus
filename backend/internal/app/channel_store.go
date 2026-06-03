package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
)

func (s *Store) Channels() []Channel {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.data.Channels == nil {
		return []Channel{}
	}
	for index := range s.data.Channels {
		s.refreshChannelDerivedLocked(index)
	}
	return cloneJSON(s.data.Channels)
}

func (s *Store) GetChannel(id string) (Channel, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(id)
	if index < 0 {
		return Channel{}, false
	}
	s.refreshChannelDerivedLocked(index)
	return cloneJSON(s.data.Channels[index]), true
}

func (s *Store) CreateChannel(input ChannelInput, actor string) (Channel, error) {
	normalized, err := s.normalizeChannelInput(input)
	if err != nil {
		return Channel{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.getDatasourceLocked(normalized.SourceDatasourceID); !ok {
		return Channel{}, errors.New("源端数据源不存在")
	}
	source, _ := s.getDatasourceLocked(normalized.SourceDatasourceID)
	if _, ok := s.getDatasourceLocked(normalized.TargetDatasourceID); !ok {
		return Channel{}, errors.New("目标端数据源不存在")
	}
	target, _ := s.getDatasourceLocked(normalized.TargetDatasourceID)
	normalized, err = s.enrichChannelRuntimeLocked(normalized, source, target, true)
	if err != nil {
		return Channel{}, err
	}
	timestamp := now()
	channel := Channel{
		ID:                   newID(),
		Name:                 normalized.Name,
		Description:          normalized.Description,
		SourceDatasourceID:   normalized.SourceDatasourceID,
		TargetDatasourceID:   normalized.TargetDatasourceID,
		SourceDatasourceType: normalized.SourceDatasourceType,
		TargetDatasourceType: normalized.TargetDatasourceType,
		RunNodeID:            normalized.RunNodeID,
		ResourceSpec:         normalized.ResourceSpec,
		Kind:                 normalized.Kind,
		Status:               ChannelStatusDraft,
		Owner:                strings.TrimSpace(actor),
		Tags:                 normalized.Tags,
		MappingVersion:       0,
		TaskCount:            0,
		RunningTaskCount:     0,
		CreatedAt:            timestamp,
		UpdatedAt:            timestamp,
	}
	s.data.Channels = append([]Channel{channel}, s.data.Channels...)
	s.logLocked(actor, "create", "channel", channel.ID, "Channel created: "+channel.Name)
	if err := s.saveLocked(); err != nil {
		return Channel{}, err
	}
	return cloneJSON(channel), nil
}

func (s *Store) UpdateChannel(id string, input ChannelInput, actor string) (Channel, bool, error) {
	normalized, err := s.normalizeChannelInput(input)
	if err != nil {
		return Channel{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(id)
	if index < 0 {
		return Channel{}, false, nil
	}
	if _, ok := s.getDatasourceLocked(normalized.SourceDatasourceID); !ok {
		return Channel{}, true, errors.New("源端数据源不存在")
	}
	source, _ := s.getDatasourceLocked(normalized.SourceDatasourceID)
	if _, ok := s.getDatasourceLocked(normalized.TargetDatasourceID); !ok {
		return Channel{}, true, errors.New("目标端数据源不存在")
	}
	target, _ := s.getDatasourceLocked(normalized.TargetDatasourceID)
	channel := &s.data.Channels[index]
	if channel.Status == ChannelStatusArchived {
		return Channel{}, true, errors.New("Channel 已归档")
	}
	validateRuntime := normalized.RunNodeID != "" && normalized.RunNodeID != channel.RunNodeID ||
		normalized.ResourceSpec != "" && normalized.ResourceSpec != channel.ResourceSpec
	if normalized.RunNodeID == "" {
		normalized.RunNodeID = channel.RunNodeID
	}
	if normalized.ResourceSpec == "" {
		normalized.ResourceSpec = channel.ResourceSpec
	}
	if normalized.Kind == "" {
		normalized.Kind = channel.Kind
	}
	normalized, err = s.enrichChannelRuntimeLocked(normalized, source, target, validateRuntime)
	if err != nil {
		return Channel{}, true, err
	}
	channel.Name = normalized.Name
	channel.Description = normalized.Description
	channel.SourceDatasourceID = normalized.SourceDatasourceID
	channel.TargetDatasourceID = normalized.TargetDatasourceID
	channel.SourceDatasourceType = normalized.SourceDatasourceType
	channel.TargetDatasourceType = normalized.TargetDatasourceType
	channel.RunNodeID = normalized.RunNodeID
	channel.ResourceSpec = normalized.ResourceSpec
	channel.Kind = normalized.Kind
	channel.Tags = normalized.Tags
	channel.UpdatedAt = now()
	s.refreshChannelDerivedLocked(index)
	s.logLocked(actor, "update", "channel", id, "Channel updated: "+channel.Name)
	if err := s.saveLocked(); err != nil {
		return Channel{}, true, err
	}
	return cloneJSON(*channel), true, nil
}

func (s *Store) DeleteChannel(id string, actor string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(id)
	if index < 0 {
		return false, nil
	}
	name := s.data.Channels[index].Name
	s.data.Channels = append(s.data.Channels[:index], s.data.Channels[index+1:]...)
	s.removeChannelChildrenLocked(id)
	s.logLocked(actor, "delete", "channel", id, "Channel deleted: "+name)
	return true, s.saveLocked()
}

func (s *Store) ArchiveChannel(id string, actor string) (Channel, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(id)
	if index < 0 {
		return Channel{}, false, nil
	}
	timestamp := now()
	channel := &s.data.Channels[index]
	channel.Status = ChannelStatusArchived
	channel.ArchivedAt = timestamp
	channel.UpdatedAt = timestamp
	s.logLocked(actor, "archive", "channel", id, "Channel archived: "+channel.Name)
	if err := s.saveLocked(); err != nil {
		return Channel{}, true, err
	}
	return cloneJSON(*channel), true, nil
}

func (s *Store) ChannelMappings(channelID string) (ChannelMappingsResponse, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(channelID)
	if index < 0 {
		return ChannelMappingsResponse{}, false
	}
	channel := s.data.Channels[index]
	tables := make([]ChannelTableMapping, 0)
	for _, table := range s.data.ChannelTableMappings {
		if table.ChannelID == channelID && table.MappingVersion == channel.MappingVersion {
			tables = append(tables, table)
		}
	}
	columns := make([]ChannelColumnMapping, 0)
	for _, column := range s.data.ChannelColumnMappings {
		if column.ChannelID == channelID && column.MappingVersion == channel.MappingVersion {
			columns = append(columns, column)
		}
	}
	sort.SliceStable(tables, func(left, right int) bool {
		return tables[left].CreatedAt < tables[right].CreatedAt
	})
	sort.SliceStable(columns, func(left, right int) bool {
		return columns[left].CreatedAt < columns[right].CreatedAt
	})
	return ChannelMappingsResponse{
		ChannelID:      channelID,
		MappingVersion: channel.MappingVersion,
		Tables:         cloneJSON(tables),
		Columns:        cloneJSON(columns),
	}, true
}

func (s *Store) SaveChannelMappings(channelID string, input ChannelMappingsInput, actor string) (ChannelMappingsResponse, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	index := s.channelIndexLocked(channelID)
	if index < 0 {
		return ChannelMappingsResponse{}, false, nil
	}
	channel := &s.data.Channels[index]
	if channel.Status == ChannelStatusArchived {
		return ChannelMappingsResponse{}, true, errors.New("Channel 已归档")
	}
	nextVersion := channel.MappingVersion + 1
	timestamp := now()
	oldTableCreatedAt := map[string]string{}
	for _, table := range s.data.ChannelTableMappings {
		if table.ChannelID == channelID {
			oldTableCreatedAt[table.ID] = table.CreatedAt
		}
	}
	oldColumnCreatedAt := map[string]string{}
	for _, column := range s.data.ChannelColumnMappings {
		if column.ChannelID == channelID {
			oldColumnCreatedAt[column.ID] = column.CreatedAt
		}
	}
	tables, columns, err := normalizeChannelMappingsInput(channelID, nextVersion, timestamp, oldTableCreatedAt, oldColumnCreatedAt, input)
	if err != nil {
		return ChannelMappingsResponse{}, true, err
	}
	s.data.ChannelTableMappings = filterTableMappingsNotChannel(s.data.ChannelTableMappings, channelID)
	s.data.ChannelColumnMappings = filterColumnMappingsNotChannel(s.data.ChannelColumnMappings, channelID)
	s.data.ChannelTableMappings = append(s.data.ChannelTableMappings, tables...)
	s.data.ChannelColumnMappings = append(s.data.ChannelColumnMappings, columns...)
	channel.MappingVersion = nextVersion
	channel.UpdatedAt = timestamp
	for taskIndex := range s.data.ChannelTasks {
		task := &s.data.ChannelTasks[taskIndex]
		if task.ChannelID != channelID || task.Status == ChannelTaskRunning {
			continue
		}
		task.MappingVersion = nextVersion
		if task.Enabled && len(tables) > 0 {
			task.Status = ChannelTaskReady
		} else if task.Enabled {
			task.Status = ChannelTaskDraft
		}
		task.UpdatedAt = timestamp
	}
	s.refreshChannelDerivedLocked(index)
	s.logLocked(actor, "save_mappings", "channel", channelID, "Channel mappings saved: "+channel.Name)
	if err := s.saveLocked(); err != nil {
		return ChannelMappingsResponse{}, true, err
	}
	return ChannelMappingsResponse{
		ChannelID:      channelID,
		MappingVersion: nextVersion,
		Tables:         cloneJSON(tables),
		Columns:        cloneJSON(columns),
	}, true, nil
}

func (s *Store) PrecheckChannel(channelID string) (ChannelPrecheckResult, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelIndexLocked(channelID) < 0 {
		return ChannelPrecheckResult{}, false
	}
	result := s.precheckChannelLocked(channelID)
	return cloneJSON(result), true
}

func (s *Store) ChannelDiffs(channelID string) ([]DataValidationDiff, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelIndexLocked(channelID) < 0 {
		return nil, false
	}
	diffs := make([]DataValidationDiff, 0)
	for _, diff := range s.data.DataValidationDiffs {
		if diff.ChannelID == channelID {
			diffs = append(diffs, diff)
		}
	}
	sort.SliceStable(diffs, func(left, right int) bool {
		return diffs[left].CreatedAt > diffs[right].CreatedAt
	})
	return cloneJSON(diffs), true
}

func (s *Store) ChannelTasks(channelID string) ([]ChannelTask, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelIndexLocked(channelID) < 0 {
		return nil, false
	}
	tasks := make([]ChannelTask, 0)
	for _, task := range s.data.ChannelTasks {
		if task.ChannelID == channelID {
			tasks = append(tasks, task)
		}
	}
	sort.SliceStable(tasks, func(left, right int) bool {
		return tasks[left].CreatedAt < tasks[right].CreatedAt
	})
	return cloneJSON(tasks), true
}

func (s *Store) GetChannelTask(channelID string, taskID string) (ChannelTask, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	taskIndex := s.channelTaskIndexLocked(channelID, taskID)
	if taskIndex < 0 {
		return ChannelTask{}, false
	}
	return cloneJSON(s.data.ChannelTasks[taskIndex]), true
}

func (s *Store) CreateChannelTask(channelID string, input ChannelTaskInput, actor string) (ChannelTask, bool, error) {
	normalized, err := normalizeChannelTaskInput(input)
	if err != nil {
		return ChannelTask{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		return ChannelTask{}, false, nil
	}
	channel := &s.data.Channels[channelIndex]
	if channel.Status == ChannelStatusArchived {
		return ChannelTask{}, true, errors.New("Channel 已归档")
	}
	if err := s.validateTaskDependenciesLocked(channelID, "", normalized.DependsOn); err != nil {
		return ChannelTask{}, true, err
	}
	timestamp := now()
	status := ChannelTaskDraft
	if !normalizedEnabled(normalized.Enabled) {
		status = ChannelTaskDisabled
	} else if enabledTableCount(s.data.ChannelTableMappings, channelID, channel.MappingVersion) > 0 {
		status = ChannelTaskReady
	}
	task := ChannelTask{
		ID:             newID(),
		ChannelID:      channelID,
		Name:           normalized.Name,
		Type:           normalized.Type,
		Status:         status,
		Enabled:        normalizedEnabled(normalized.Enabled),
		DependsOn:      normalized.DependsOn,
		MappingVersion: channel.MappingVersion,
		Config:         normalized.Config,
		CreatedAt:      timestamp,
		UpdatedAt:      timestamp,
	}
	s.data.ChannelTasks = append(s.data.ChannelTasks, task)
	s.refreshChannelDerivedLocked(channelIndex)
	s.logLocked(actor, "create", "channel_task", task.ID, "Channel task created: "+task.Name)
	if err := s.saveLocked(); err != nil {
		return ChannelTask{}, true, err
	}
	return cloneJSON(task), true, nil
}

func (s *Store) UpdateChannelTask(channelID string, taskID string, input ChannelTaskInput, actor string) (ChannelTask, bool, error) {
	normalized, err := normalizeChannelTaskInput(input)
	if err != nil {
		return ChannelTask{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		return ChannelTask{}, false, nil
	}
	channel := &s.data.Channels[channelIndex]
	if channel.Status == ChannelStatusArchived {
		return ChannelTask{}, true, errors.New("Channel 已归档")
	}
	taskIndex := s.channelTaskIndexLocked(channelID, taskID)
	if taskIndex < 0 {
		return ChannelTask{}, false, nil
	}
	if err := s.validateTaskDependenciesLocked(channelID, taskID, normalized.DependsOn); err != nil {
		return ChannelTask{}, true, err
	}
	task := &s.data.ChannelTasks[taskIndex]
	if task.Status == ChannelTaskRunning {
		return ChannelTask{}, true, errors.New("运行中的任务不能编辑")
	}
	task.Name = normalized.Name
	task.Type = normalized.Type
	task.Enabled = normalizedEnabled(normalized.Enabled)
	task.DependsOn = normalized.DependsOn
	task.Config = normalized.Config
	task.MappingVersion = channel.MappingVersion
	if !task.Enabled {
		task.Status = ChannelTaskDisabled
	} else if enabledTableCount(s.data.ChannelTableMappings, channelID, channel.MappingVersion) > 0 {
		task.Status = ChannelTaskReady
	} else {
		task.Status = ChannelTaskDraft
	}
	task.UpdatedAt = now()
	s.refreshChannelDerivedLocked(channelIndex)
	s.logLocked(actor, "update", "channel_task", task.ID, "Channel task updated: "+task.Name)
	if err := s.saveLocked(); err != nil {
		return ChannelTask{}, true, err
	}
	return cloneJSON(*task), true, nil
}

func (s *Store) DeleteChannelTask(channelID string, taskID string, actor string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		return false, nil
	}
	taskIndex := s.channelTaskIndexLocked(channelID, taskID)
	if taskIndex < 0 {
		return false, nil
	}
	task := s.data.ChannelTasks[taskIndex]
	if task.Status == ChannelTaskRunning {
		return true, errors.New("运行中的任务不能删除")
	}
	s.data.ChannelTasks = append(s.data.ChannelTasks[:taskIndex], s.data.ChannelTasks[taskIndex+1:]...)
	s.data.TaskRuns = filterTaskRunsNotTask(s.data.TaskRuns, taskID)
	s.data.TaskLogs = filterTaskLogsNotTask(s.data.TaskLogs, taskID)
	s.data.DataValidationDiffs = updateDiffsForDeletedTask(s.data.DataValidationDiffs, task, now())
	for index := range s.data.ChannelTasks {
		if s.data.ChannelTasks[index].ChannelID != channelID {
			continue
		}
		s.data.ChannelTasks[index].DependsOn = removeString(s.data.ChannelTasks[index].DependsOn, taskID)
	}
	s.refreshChannelDerivedLocked(channelIndex)
	s.logLocked(actor, "delete", "channel_task", taskID, "Channel task deleted: "+task.Name)
	return true, s.saveLocked()
}

func (s *Store) StartChannelTask(channelID string, taskID string, actor string) (ChannelTask, bool, error) {
	return s.runChannelTask(channelID, taskID, actor, false)
}

func (s *Store) RerunChannelTask(channelID string, taskID string, actor string) (ChannelTask, bool, error) {
	return s.runChannelTask(channelID, taskID, actor, true)
}

func (s *Store) StopChannelTask(channelID string, taskID string, actor string) (ChannelTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		return ChannelTask{}, false, nil
	}
	taskIndex := s.channelTaskIndexLocked(channelID, taskID)
	if taskIndex < 0 {
		return ChannelTask{}, false, nil
	}
	timestamp := now()
	task := &s.data.ChannelTasks[taskIndex]
	if task.Status == ChannelTaskRunning {
		task.Status = ChannelTaskStopped
		task.LastRunStatus = TaskRunStopped
		for index := range s.data.TaskRuns {
			if s.data.TaskRuns[index].ID == task.LastRunID && s.data.TaskRuns[index].FinishedAt == "" {
				s.data.TaskRuns[index].Status = TaskRunStopped
				s.data.TaskRuns[index].FinishedAt = timestamp
				break
			}
		}
		s.appendTaskLogLocked(channelID, taskID, task.LastRunID, "info", "channel-task", "Task stopped: "+task.Name)
	} else {
		task.Status = ChannelTaskStopped
	}
	task.UpdatedAt = timestamp
	s.refreshChannelDerivedLocked(channelIndex)
	s.logLocked(actor, "stop", "channel_task", taskID, "Channel task stopped: "+task.Name)
	if err := s.saveLocked(); err != nil {
		return ChannelTask{}, true, err
	}
	return cloneJSON(*task), true, nil
}

func (s *Store) ChannelRuns(channelID string) ([]TaskRun, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelIndexLocked(channelID) < 0 {
		return nil, false
	}
	runs := make([]TaskRun, 0)
	for _, run := range s.data.TaskRuns {
		if run.ChannelID == channelID {
			runs = append(runs, run)
		}
	}
	sortTaskRuns(runs)
	return cloneJSON(runs), true
}

func (s *Store) ChannelTaskRuns(channelID string, taskID string) ([]TaskRun, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelTaskIndexLocked(channelID, taskID) < 0 {
		return nil, false
	}
	runs := make([]TaskRun, 0)
	for _, run := range s.data.TaskRuns {
		if run.ChannelID == channelID && run.TaskID == taskID {
			runs = append(runs, run)
		}
	}
	sortTaskRuns(runs)
	return cloneJSON(runs), true
}

func (s *Store) ChannelTaskLogs(channelID string, filter ChannelTaskLogFilter) ([]TaskLog, bool, error) {
	filter.TaskID = strings.TrimSpace(filter.TaskID)
	filter.RunID = strings.TrimSpace(filter.RunID)
	filter.Level = strings.TrimSpace(strings.ToLower(filter.Level))
	switch filter.Level {
	case "", "info", "warn", "error":
	default:
		return nil, true, errors.New("日志级别无效")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.channelIndexLocked(channelID) < 0 {
		return nil, false, nil
	}
	logs := make([]TaskLog, 0)
	for _, log := range s.data.TaskLogs {
		if log.ChannelID != channelID {
			continue
		}
		if filter.TaskID != "" && log.TaskID != filter.TaskID {
			continue
		}
		if filter.RunID != "" && log.RunID != filter.RunID {
			continue
		}
		if filter.Level != "" && log.Level != filter.Level {
			continue
		}
		logs = append(logs, log)
	}
	sort.SliceStable(logs, func(left, right int) bool {
		return logs[left].CreatedAt > logs[right].CreatedAt
	})
	return cloneJSON(firstN(logs, 200)), true, nil
}

func (s *Store) runChannelTask(channelID string, taskID string, actor string, rerun bool) (ChannelTask, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		return ChannelTask{}, false, nil
	}
	channel := &s.data.Channels[channelIndex]
	if channel.Status == ChannelStatusArchived {
		return ChannelTask{}, true, errors.New("Channel 已归档")
	}
	taskIndex := s.channelTaskIndexLocked(channelID, taskID)
	if taskIndex < 0 {
		return ChannelTask{}, false, nil
	}
	task := &s.data.ChannelTasks[taskIndex]
	if !task.Enabled || task.Status == ChannelTaskDisabled {
		return ChannelTask{}, true, errors.New("任务未启用")
	}
	if task.Status == ChannelTaskRunning {
		return ChannelTask{}, true, errors.New("任务正在运行")
	}
	if task.MappingVersion <= 0 {
		return ChannelTask{}, true, errors.New("请先配置映射")
	}
	if err := s.ensureTaskDependenciesCompleteLocked(task); err != nil {
		return ChannelTask{}, true, err
	}
	if task.Type == ChannelTaskDataCorrection && !s.hasSuccessfulDataValidationRunLocked(channelID) {
		return ChannelTask{}, true, errors.New("请先完成数据校验")
	}
	precheck := s.precheckChannelLocked(channelID)
	if !precheck.Success {
		return ChannelTask{}, true, errors.New("预检未通过")
	}
	timestamp := now()
	runStatus := TaskRunSuccess
	taskStatus := ChannelTaskSuccess
	finishedAt := timestamp
	if task.Type == ChannelTaskIncrementalSync {
		runStatus = TaskRunRunning
		taskStatus = ChannelTaskRunning
		finishedAt = ""
	}
	run := TaskRun{
		ID:          newID(),
		ChannelID:   channelID,
		TaskID:      task.ID,
		TaskType:    task.Type,
		Status:      runStatus,
		StartedAt:   timestamp,
		FinishedAt:  finishedAt,
		ReadRows:    simulatedReadRowsLocked(s.data.ChannelTableMappings, channelID, task.Type, task.MappingVersion),
		WrittenRows: simulatedWrittenRowsLocked(s.data.ChannelTableMappings, channelID, task.Type, task.MappingVersion),
		FailedRows:  0,
		DiffRows:    0,
		CreatedBy:   actor,
	}
	if task.Type == ChannelTaskDataValidation && runStatus == TaskRunSuccess {
		diffs := s.createDataValidationDiffsLocked(channelID, task.ID, run.ID, task.MappingVersion, timestamp)
		run.DiffRows = len(diffs)
		if len(diffs) > 0 {
			s.data.DataValidationDiffs = append(diffs, s.data.DataValidationDiffs...)
			s.appendTaskLogLocked(channelID, task.ID, run.ID, "warn", "data-validation", fmt.Sprintf("Data validation produced %d diffs", len(diffs)))
		}
	}
	if task.Type == ChannelTaskDataCorrection && runStatus == TaskRunSuccess {
		corrected := s.markValidationDiffsCorrectedLocked(channelID, task.ID, run.ID, timestamp)
		run.WrittenRows = corrected
		if corrected > 0 {
			s.appendTaskLogLocked(channelID, task.ID, run.ID, "info", "data-correction", fmt.Sprintf("Data correction marked %d diffs", corrected))
		}
	}
	s.data.TaskRuns = append([]TaskRun{run}, s.data.TaskRuns...)
	task.Status = taskStatus
	task.LastRunID = run.ID
	task.LastRunStatus = run.Status
	task.UpdatedAt = timestamp
	s.appendTaskLogLocked(channelID, task.ID, run.ID, "info", "channel-task", "Task started: "+task.Name)
	if runStatus == TaskRunSuccess {
		s.appendTaskLogLocked(channelID, task.ID, run.ID, "info", "channel-task", "Task completed: "+task.Name)
	}
	action := "start"
	if rerun {
		action = "rerun"
	}
	s.logLocked(actor, action, "channel_task", task.ID, "Channel task "+action+": "+task.Name)
	s.refreshChannelDerivedLocked(channelIndex)
	if err := s.saveLocked(); err != nil {
		return ChannelTask{}, true, err
	}
	return cloneJSON(*task), true, nil
}

func (s *Store) normalizeChannelInput(input ChannelInput) (ChannelInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	input.SourceDatasourceID = strings.TrimSpace(input.SourceDatasourceID)
	input.TargetDatasourceID = strings.TrimSpace(input.TargetDatasourceID)
	input.SourceDatasourceType = DatasourceType(strings.TrimSpace(strings.ToLower(string(input.SourceDatasourceType))))
	input.TargetDatasourceType = DatasourceType(strings.TrimSpace(strings.ToLower(string(input.TargetDatasourceType))))
	input.RunNodeID = strings.TrimSpace(input.RunNodeID)
	input.ResourceSpec = normalizeChannelResourceSpec(input.ResourceSpec)
	input.Kind = ChannelKind(strings.TrimSpace(strings.ToLower(string(input.Kind))))
	input.Tags = normalizeTags(input.Tags)
	if input.Name == "" {
		return ChannelInput{}, errors.New("Channel 名称必填")
	}
	if len([]rune(input.Name)) > 80 {
		return ChannelInput{}, errors.New("Channel 名称最多 80 字符")
	}
	if len([]rune(input.Description)) > 300 {
		return ChannelInput{}, errors.New("描述最多 300 字符")
	}
	if input.SourceDatasourceID == "" {
		return ChannelInput{}, errors.New("源端必填")
	}
	if input.TargetDatasourceID == "" {
		return ChannelInput{}, errors.New("目标端必填")
	}
	if input.SourceDatasourceType != "" && input.SourceDatasourceType != DatasourceTypeMySQL {
		return ChannelInput{}, errors.New("源端类型不支持")
	}
	if input.TargetDatasourceType != "" && input.TargetDatasourceType != DatasourceTypeMySQL {
		return ChannelInput{}, errors.New("目标端类型不支持")
	}
	if input.Kind != "" && input.Kind != ChannelKindSync && input.Kind != ChannelKindCheck {
		return ChannelInput{}, errors.New("Channel 类型不支持")
	}
	if input.ResourceSpec != "" {
		if _, err := channelResourceSpecGB(input.ResourceSpec); err != nil {
			return ChannelInput{}, err
		}
	}
	return input, nil
}

func (s *Store) enrichChannelRuntimeLocked(input ChannelInput, source Datasource, target Datasource, validateRuntime bool) (ChannelInput, error) {
	if input.Kind == "" {
		input.Kind = ChannelKindSync
	}
	if input.SourceDatasourceType == "" {
		input.SourceDatasourceType = source.Type
	} else if input.SourceDatasourceType != source.Type {
		return ChannelInput{}, errors.New("源端类型与数据源不匹配")
	}
	if input.TargetDatasourceType == "" {
		input.TargetDatasourceType = target.Type
	} else if input.TargetDatasourceType != target.Type {
		return ChannelInput{}, errors.New("目标端类型与数据源不匹配")
	}
	if validateRuntime && input.ResourceSpec != "" && input.RunNodeID == "" {
		return ChannelInput{}, errors.New("运行节点必填")
	}
	if validateRuntime && input.RunNodeID != "" {
		node := s.getNodeLocked(input.RunNodeID)
		if node == nil {
			return ChannelInput{}, errors.New("运行节点不存在")
		}
		if node.Status != NodeOnline {
			return ChannelInput{}, errors.New("运行节点不可用")
		}
		if input.ResourceSpec != "" {
			required, err := channelResourceSpecGB(input.ResourceSpec)
			if err != nil {
				return ChannelInput{}, err
			}
			if float64(node.Capacity) < required {
				return ChannelInput{}, fmt.Errorf("节点资源不足，当前 %dG，需要 %s", node.Capacity, input.ResourceSpec)
			}
		}
	}
	return input, nil
}

func normalizeChannelResourceSpec(spec string) string {
	spec = strings.TrimSpace(strings.ToUpper(spec))
	if spec == ".5G" {
		return "0.5G"
	}
	return spec
}

func channelResourceSpecGB(spec string) (float64, error) {
	switch normalizeChannelResourceSpec(spec) {
	case "0.5G":
		return 0.5, nil
	case "1G":
		return 1, nil
	case "2G":
		return 2, nil
	case "3G":
		return 3, nil
	case "4G":
		return 4, nil
	default:
		return 0, errors.New("任务规格不支持")
	}
}

func normalizeChannelMappingsInput(channelID string, version int, timestamp string, oldTableCreatedAt map[string]string, oldColumnCreatedAt map[string]string, input ChannelMappingsInput) ([]ChannelTableMapping, []ChannelColumnMapping, error) {
	tables := make([]ChannelTableMapping, 0, len(input.Tables))
	columns := make([]ChannelColumnMapping, 0)
	seenTables := map[string]bool{}
	for _, tableInput := range input.Tables {
		tableInput.ID = strings.TrimSpace(tableInput.ID)
		tableInput.SourceSchema = strings.TrimSpace(tableInput.SourceSchema)
		tableInput.SourceTable = strings.TrimSpace(tableInput.SourceTable)
		tableInput.TargetSchema = strings.TrimSpace(tableInput.TargetSchema)
		tableInput.TargetTable = strings.TrimSpace(tableInput.TargetTable)
		if tableInput.SourceTable == "" || tableInput.TargetTable == "" {
			return nil, nil, errors.New("表映射不完整")
		}
		tableKey := tableInput.SourceSchema + "." + tableInput.SourceTable + "->" + tableInput.TargetSchema + "." + tableInput.TargetTable
		if seenTables[tableKey] {
			return nil, nil, errors.New("表映射重复")
		}
		seenTables[tableKey] = true
		tableID := tableInput.ID
		if tableID == "" {
			tableID = newID()
		}
		enabled := true
		if tableInput.Enabled != nil {
			enabled = *tableInput.Enabled
		}
		createdAt := oldTableCreatedAt[tableID]
		if createdAt == "" {
			createdAt = timestamp
		}
		primaryKeys := normalizeTags(tableInput.PrimaryKeys)
		table := ChannelTableMapping{
			ID:             tableID,
			ChannelID:      channelID,
			MappingVersion: version,
			SourceSchema:   tableInput.SourceSchema,
			SourceTable:    tableInput.SourceTable,
			TargetSchema:   tableInput.TargetSchema,
			TargetTable:    tableInput.TargetTable,
			PrimaryKeys:    primaryKeys,
			Enabled:        enabled,
			CreatedAt:      createdAt,
			UpdatedAt:      timestamp,
		}
		tables = append(tables, table)
		seenColumns := map[string]bool{}
		for _, columnInput := range tableInput.Columns {
			columnInput.ID = strings.TrimSpace(columnInput.ID)
			columnInput.SourceColumn = strings.TrimSpace(columnInput.SourceColumn)
			columnInput.SourceType = strings.TrimSpace(columnInput.SourceType)
			columnInput.TargetColumn = strings.TrimSpace(columnInput.TargetColumn)
			columnInput.TargetType = strings.TrimSpace(columnInput.TargetType)
			columnInput.DefaultValue = strings.TrimSpace(columnInput.DefaultValue)
			if columnInput.SourceColumn == "" || columnInput.TargetColumn == "" {
				return nil, nil, errors.New("列映射不完整")
			}
			columnKey := strings.ToLower(columnInput.SourceColumn) + "->" + strings.ToLower(columnInput.TargetColumn)
			if seenColumns[columnKey] {
				return nil, nil, errors.New("列映射重复")
			}
			seenColumns[columnKey] = true
			columnID := columnInput.ID
			if columnID == "" {
				columnID = newID()
			}
			columnEnabled := true
			if columnInput.Enabled != nil {
				columnEnabled = *columnInput.Enabled
			}
			columnCreatedAt := oldColumnCreatedAt[columnID]
			if columnCreatedAt == "" {
				columnCreatedAt = timestamp
			}
			isPrimaryKey := columnInput.IsPrimaryKey || containsString(primaryKeys, columnInput.SourceColumn) || containsString(primaryKeys, columnInput.TargetColumn)
			columns = append(columns, ChannelColumnMapping{
				ID:             columnID,
				ChannelID:      channelID,
				TableMappingID: tableID,
				MappingVersion: version,
				SourceColumn:   columnInput.SourceColumn,
				SourceType:     columnInput.SourceType,
				TargetColumn:   columnInput.TargetColumn,
				TargetType:     columnInput.TargetType,
				IsPrimaryKey:   isPrimaryKey,
				Nullable:       columnInput.Nullable,
				DefaultValue:   columnInput.DefaultValue,
				Enabled:        columnEnabled,
				CreatedAt:      columnCreatedAt,
				UpdatedAt:      timestamp,
			})
		}
	}
	return tables, columns, nil
}

func normalizeChannelTaskInput(input ChannelTaskInput) (ChannelTaskInput, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Type = ChannelTaskType(strings.TrimSpace(string(input.Type)))
	input.DependsOn = normalizeTags(input.DependsOn)
	if input.Config == nil {
		input.Config = map[string]string{}
	}
	normalizedConfig := map[string]string{}
	for key, value := range input.Config {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		normalizedConfig[key] = strings.TrimSpace(value)
	}
	input.Config = normalizedConfig
	if input.Name == "" {
		return ChannelTaskInput{}, errors.New("任务名称必填")
	}
	if len([]rune(input.Name)) > 80 {
		return ChannelTaskInput{}, errors.New("任务名称最多 80 字符")
	}
	if !validChannelTaskType(input.Type) {
		return ChannelTaskInput{}, errors.New("任务类型无效")
	}
	return input, nil
}

func (s *Store) validateTaskDependenciesLocked(channelID string, currentTaskID string, dependsOn []string) error {
	for _, dependencyID := range dependsOn {
		if dependencyID == currentTaskID {
			return errors.New("任务不能依赖自身")
		}
		if s.channelTaskIndexLocked(channelID, dependencyID) < 0 {
			return errors.New("依赖任务不存在")
		}
	}
	return nil
}

func (s *Store) ensureTaskDependenciesCompleteLocked(task *ChannelTask) error {
	for _, dependencyID := range task.DependsOn {
		index := s.channelTaskIndexLocked(task.ChannelID, dependencyID)
		if index < 0 {
			return errors.New("依赖任务不存在")
		}
		dependency := s.data.ChannelTasks[index]
		if dependency.Status != ChannelTaskSuccess && dependency.Status != ChannelTaskRunning {
			return errors.New("依赖任务未完成")
		}
	}
	return nil
}

func (s *Store) precheckChannelLocked(channelID string) ChannelPrecheckResult {
	result := ChannelPrecheckResult{
		Success:   true,
		CheckedAt: now(),
		Items:     []ChannelPrecheckItem{},
	}
	add := func(key string, label string, success bool, severity ChannelPrecheckSeverity, message string) {
		if !success {
			result.Success = false
		}
		result.Items = append(result.Items, ChannelPrecheckItem{
			Key:      key,
			Label:    label,
			Success:  success,
			Severity: severity,
			Message:  message,
		})
	}
	addCheck := func(key string, label string, success bool, message string) {
		severity := ChannelPrecheckPass
		if !success {
			severity = ChannelPrecheckBlocker
		}
		add(key, label, success, severity, message)
	}
	channelIndex := s.channelIndexLocked(channelID)
	if channelIndex < 0 {
		addCheck("channel", "Channel", false, "Channel 不存在")
		return result
	}
	channel := s.data.Channels[channelIndex]
	_, sourceOK := s.getDatasourceLocked(channel.SourceDatasourceID)
	_, targetOK := s.getDatasourceLocked(channel.TargetDatasourceID)
	addCheck("source", "源端", sourceOK, valueByBool(sourceOK, "源端可用", "源端数据源不存在"))
	addCheck("target", "目标端", targetOK, valueByBool(targetOK, "目标端可用", "目标端数据源不存在"))

	tables := make([]ChannelTableMapping, 0)
	columnsByTable := map[string][]ChannelColumnMapping{}
	for _, table := range s.data.ChannelTableMappings {
		if table.ChannelID == channelID && table.MappingVersion == channel.MappingVersion && table.Enabled {
			tables = append(tables, table)
		}
	}
	for _, column := range s.data.ChannelColumnMappings {
		if column.ChannelID == channelID && column.MappingVersion == channel.MappingVersion && column.Enabled {
			columnsByTable[column.TableMappingID] = append(columnsByTable[column.TableMappingID], column)
		}
	}
	addCheck("tables", "表映射", len(tables) > 0, valueByBool(len(tables) > 0, "表映射可用", "至少需要一条表映射"))
	columnOK := true
	primaryKeyOK := true
	typeMismatchCount := 0
	for _, table := range tables {
		columns := columnsByTable[table.ID]
		if len(columns) == 0 {
			columnOK = false
		}
		for _, column := range columns {
			if column.SourceType != "" && column.TargetType != "" && !strings.EqualFold(column.SourceType, column.TargetType) {
				typeMismatchCount++
			}
		}
		if len(table.PrimaryKeys) == 0 {
			primaryKeyOK = false
			continue
		}
		for _, primaryKey := range table.PrimaryKeys {
			found := false
			for _, column := range columns {
				if column.IsPrimaryKey || strings.EqualFold(column.SourceColumn, primaryKey) || strings.EqualFold(column.TargetColumn, primaryKey) {
					found = true
					break
				}
			}
			if !found {
				primaryKeyOK = false
			}
		}
	}
	addCheck("columns", "列映射", columnOK, valueByBool(columnOK, "列映射可用", "每个表至少需要一条列映射"))
	addCheck("primaryKey", "主键", primaryKeyOK, valueByBool(primaryKeyOK, "主键可用", "数据校验和订正需要主键列映射"))
	if typeMismatchCount > 0 {
		add("columnTypes", "类型", true, ChannelPrecheckWarning, fmt.Sprintf("存在 %d 个类型不一致列", typeMismatchCount))
	}
	if s.hasEnabledTaskTypeLocked(channelID, ChannelTaskDataCorrection) && !s.hasSuccessfulDataValidationRunLocked(channelID) {
		add("dataCorrectionValidation", "数据订正", true, ChannelPrecheckWarning, "启动前需要先完成数据校验")
	}
	return result
}

func (s *Store) hasEnabledTaskTypeLocked(channelID string, taskType ChannelTaskType) bool {
	for _, task := range s.data.ChannelTasks {
		if task.ChannelID == channelID && task.Type == taskType && task.Enabled {
			return true
		}
	}
	return false
}

func (s *Store) hasSuccessfulDataValidationRunLocked(channelID string) bool {
	for _, run := range s.data.TaskRuns {
		if run.ChannelID == channelID && run.TaskType == ChannelTaskDataValidation && run.Status == TaskRunSuccess {
			return true
		}
	}
	return false
}

func (s *Store) createDataValidationDiffsLocked(channelID string, taskID string, runID string, mappingVersion int, timestamp string) []DataValidationDiff {
	diffs := []DataValidationDiff{}
	for _, table := range s.data.ChannelTableMappings {
		if table.ChannelID != channelID || table.MappingVersion != mappingVersion || !table.Enabled || len(table.PrimaryKeys) == 0 {
			continue
		}
		diffColumn := firstComparableColumnLocked(s.data.ChannelColumnMappings, table.ID, table.PrimaryKeys)
		if diffColumn == "" {
			continue
		}
		sourceTable := table.SourceTable
		targetTable := table.TargetTable
		primaryKey := table.PrimaryKeys[0]
		primaryKeyJSON := jsonString(map[string]string{primaryKey: fmt.Sprintf("%s-%s", table.SourceTable, primaryKey)})
		diffColumnsJSON := jsonString([]map[string]string{{
			"column": diffColumn,
			"source": "source-sample",
			"target": "target-sample",
		}})
		diffs = append(diffs, DataValidationDiff{
			ID:               newID(),
			ChannelID:        channelID,
			ValidationTaskID: taskID,
			ValidationRunID:  runID,
			TableMappingID:   table.ID,
			SourceTable:      sourceTable,
			TargetTable:      targetTable,
			PrimaryKeyJSON:   primaryKeyJSON,
			DiffType:         "value_mismatch",
			DiffColumnsJSON:  diffColumnsJSON,
			SourceDigest:     "source-sample",
			TargetDigest:     "target-sample",
			CorrectionStatus: "pending",
			CreatedAt:        timestamp,
			UpdatedAt:        timestamp,
		})
	}
	return diffs
}

func (s *Store) markValidationDiffsCorrectedLocked(channelID string, taskID string, runID string, timestamp string) int {
	corrected := 0
	for index := range s.data.DataValidationDiffs {
		diff := &s.data.DataValidationDiffs[index]
		if diff.ChannelID != channelID || diff.CorrectionStatus == "corrected" {
			continue
		}
		diff.CorrectionStatus = "corrected"
		diff.CorrectionTaskID = taskID
		diff.CorrectionRunID = runID
		diff.UpdatedAt = timestamp
		corrected++
	}
	return corrected
}

func firstComparableColumnLocked(columns []ChannelColumnMapping, tableID string, primaryKeys []string) string {
	for _, column := range columns {
		if column.TableMappingID != tableID || !column.Enabled {
			continue
		}
		if column.IsPrimaryKey || containsString(primaryKeys, column.SourceColumn) || containsString(primaryKeys, column.TargetColumn) {
			continue
		}
		return column.SourceColumn
	}
	return ""
}

func jsonString(value any) string {
	data, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func (s *Store) refreshChannelDerivedLocked(index int) {
	if index < 0 || index >= len(s.data.Channels) {
		return
	}
	channel := &s.data.Channels[index]
	taskCount := 0
	runningCount := 0
	hasFailed := false
	hasStopped := false
	for _, task := range s.data.ChannelTasks {
		if task.ChannelID != channel.ID {
			continue
		}
		taskCount++
		switch task.Status {
		case ChannelTaskRunning, ChannelTaskQueued, ChannelTaskStopping:
			runningCount++
		case ChannelTaskFailed:
			hasFailed = true
		case ChannelTaskStopped:
			hasStopped = true
		}
	}
	channel.TaskCount = taskCount
	channel.RunningTaskCount = runningCount
	for _, run := range s.data.TaskRuns {
		if run.ChannelID != channel.ID {
			continue
		}
		if channel.LastRunID == "" || run.StartedAt > channelLastRunStartedAtLocked(s.data.TaskRuns, channel.LastRunID) {
			channel.LastRunID = run.ID
			channel.LastRunStatus = run.Status
		}
	}
	if channel.Status == ChannelStatusArchived {
		return
	}
	switch {
	case runningCount > 0:
		channel.Status = ChannelStatusRunning
	case hasFailed:
		channel.Status = ChannelStatusFailed
	case hasStopped:
		channel.Status = ChannelStatusStopped
	case enabledTableCount(s.data.ChannelTableMappings, channel.ID, channel.MappingVersion) > 0:
		channel.Status = ChannelStatusReady
	default:
		channel.Status = ChannelStatusDraft
	}
}

func (s *Store) removeChannelChildrenLocked(channelID string) {
	s.data.ChannelTableMappings = filterTableMappingsNotChannel(s.data.ChannelTableMappings, channelID)
	s.data.ChannelColumnMappings = filterColumnMappingsNotChannel(s.data.ChannelColumnMappings, channelID)
	s.data.ChannelTasks = filterChannelTasksNotChannel(s.data.ChannelTasks, channelID)
	s.data.TaskRuns = filterTaskRunsNotChannel(s.data.TaskRuns, channelID)
	s.data.TaskLogs = filterTaskLogsNotChannel(s.data.TaskLogs, channelID)
	s.data.DataValidationDiffs = filterDiffsNotChannel(s.data.DataValidationDiffs, channelID)
}

func (s *Store) appendTaskLogLocked(channelID string, taskID string, runID string, level string, thread string, message string) {
	if level != "warn" && level != "error" {
		level = "info"
	}
	s.data.TaskLogs = append([]TaskLog{{
		ID:        newID(),
		ChannelID: channelID,
		TaskID:    taskID,
		RunID:     runID,
		Level:     level,
		Thread:    thread,
		Message:   message,
		CreatedAt: now(),
	}}, s.data.TaskLogs...)
}

func (s *Store) channelIndexLocked(id string) int {
	for index, channel := range s.data.Channels {
		if channel.ID == id {
			return index
		}
	}
	return -1
}

func (s *Store) channelTaskIndexLocked(channelID string, taskID string) int {
	for index, task := range s.data.ChannelTasks {
		if task.ChannelID == channelID && task.ID == taskID {
			return index
		}
	}
	return -1
}

func validChannelTaskType(taskType ChannelTaskType) bool {
	switch taskType {
	case ChannelTaskSchemaMigration,
		ChannelTaskFullMigration,
		ChannelTaskIncrementalSync,
		ChannelTaskSchemaCompare,
		ChannelTaskDataValidation,
		ChannelTaskDataCorrection:
		return true
	default:
		return false
	}
}

func normalizedEnabled(enabled *bool) bool {
	return enabled == nil || *enabled
}

func normalizeTags(values []string) []string {
	normalized := []string{}
	seen := map[string]bool{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		normalized = append(normalized, value)
	}
	return normalized
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func removeString(values []string, target string) []string {
	filtered := values[:0]
	for _, value := range values {
		if value == target {
			continue
		}
		filtered = append(filtered, value)
	}
	return filtered
}

func valueByBool(success bool, successMessage string, failureMessage string) string {
	if success {
		return successMessage
	}
	return failureMessage
}

func filterTableMappingsNotChannel(items []ChannelTableMapping, channelID string) []ChannelTableMapping {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterColumnMappingsNotChannel(items []ChannelColumnMapping, channelID string) []ChannelColumnMapping {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterChannelTasksNotChannel(items []ChannelTask, channelID string) []ChannelTask {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterTaskRunsNotChannel(items []TaskRun, channelID string) []TaskRun {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterTaskRunsNotTask(items []TaskRun, taskID string) []TaskRun {
	filtered := items[:0]
	for _, item := range items {
		if item.TaskID == taskID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterTaskLogsNotChannel(items []TaskLog, channelID string) []TaskLog {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterTaskLogsNotTask(items []TaskLog, taskID string) []TaskLog {
	filtered := items[:0]
	for _, item := range items {
		if item.TaskID == taskID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func filterDiffsNotChannel(items []DataValidationDiff, channelID string) []DataValidationDiff {
	filtered := items[:0]
	for _, item := range items {
		if item.ChannelID == channelID {
			continue
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func updateDiffsForDeletedTask(items []DataValidationDiff, task ChannelTask, timestamp string) []DataValidationDiff {
	filtered := items[:0]
	for _, item := range items {
		if task.Type == ChannelTaskDataValidation && item.ValidationTaskID == task.ID {
			continue
		}
		if task.Type == ChannelTaskDataCorrection && item.CorrectionTaskID == task.ID {
			item.CorrectionStatus = "pending"
			item.CorrectionTaskID = ""
			item.CorrectionRunID = ""
			item.UpdatedAt = timestamp
		}
		filtered = append(filtered, item)
	}
	return filtered
}

func sortTaskRuns(runs []TaskRun) {
	sort.SliceStable(runs, func(left, right int) bool {
		return runs[left].StartedAt > runs[right].StartedAt
	})
}

func channelLastRunStartedAtLocked(runs []TaskRun, runID string) string {
	for _, run := range runs {
		if run.ID == runID {
			return run.StartedAt
		}
	}
	return ""
}

func simulatedReadRowsLocked(tables []ChannelTableMapping, channelID string, taskType ChannelTaskType, mappingVersion int) int {
	count := enabledTableCount(tables, channelID, mappingVersion)
	switch taskType {
	case ChannelTaskFullMigration:
		return count * 1000
	case ChannelTaskDataValidation:
		return count * 1000
	case ChannelTaskIncrementalSync:
		return 0
	default:
		return count
	}
}

func simulatedWrittenRowsLocked(tables []ChannelTableMapping, channelID string, taskType ChannelTaskType, mappingVersion int) int {
	count := enabledTableCount(tables, channelID, mappingVersion)
	switch taskType {
	case ChannelTaskFullMigration:
		return count * 1000
	case ChannelTaskDataCorrection:
		return 0
	case ChannelTaskIncrementalSync:
		return 0
	case ChannelTaskSchemaMigration:
		return count
	default:
		return 0
	}
}

func enabledTableCount(tables []ChannelTableMapping, channelID string, mappingVersion int) int {
	count := 0
	for _, table := range tables {
		if table.ChannelID == channelID && table.MappingVersion == mappingVersion && table.Enabled {
			count++
		}
	}
	return count
}
