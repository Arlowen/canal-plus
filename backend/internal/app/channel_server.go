package app

import (
	"net/http"
)

func (s *Server) handleChannels(response http.ResponseWriter, request *http.Request, parts []string, user User) {
	actor := requestActor(user)
	switch {
	case len(parts) == 1 && request.Method == http.MethodGet:
		writeJSON(response, http.StatusOK, s.store.Channels())
	case len(parts) == 1 && request.Method == http.MethodPost:
		var input ChannelInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		channel, err := s.store.CreateChannel(input, actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(response, http.StatusCreated, channel)
	case len(parts) == 2 && request.Method == http.MethodGet:
		channel, ok := s.store.GetChannel(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, channel)
	case len(parts) == 2 && request.Method == http.MethodPut:
		var input ChannelInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		channel, ok, err := s.store.UpdateChannel(parts[1], input, actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, channel)
	case len(parts) == 2 && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteChannel(parts[1], actor)
		if err != nil {
			writeError(response, http.StatusInternalServerError, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
	case len(parts) == 3 && parts[2] == "archive" && request.Method == http.MethodPost:
		channel, ok, err := s.store.ArchiveChannel(parts[1], actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, channel)
	case len(parts) == 3 && parts[2] == "precheck" && request.Method == http.MethodPost:
		result, ok := s.store.PrecheckChannel(parts[1])
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, result)
	case len(parts) >= 3 && parts[2] == "mappings":
		s.handleChannelMappings(response, request, parts, actor)
	case len(parts) >= 3 && parts[2] == "tasks":
		s.handleChannelTasks(response, request, parts, actor)
	case len(parts) >= 3 && parts[2] == "runs":
		s.handleChannelRuns(response, request, parts)
	case len(parts) >= 3 && parts[2] == "logs":
		s.handleChannelLogs(response, request, parts)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleChannelMappings(response http.ResponseWriter, request *http.Request, parts []string, actor string) {
	channelID := parts[1]
	switch {
	case len(parts) == 3 && request.Method == http.MethodGet:
		mappings, ok := s.store.ChannelMappings(channelID)
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, mappings)
	case len(parts) == 3 && request.Method == http.MethodPut:
		var input ChannelMappingsInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		mappings, ok, err := s.store.SaveChannelMappings(channelID, input, actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, mappings)
	case len(parts) == 4 && parts[3] == "precheck" && request.Method == http.MethodPost:
		result, ok := s.store.PrecheckChannel(channelID)
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, result)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleChannelTasks(response http.ResponseWriter, request *http.Request, parts []string, actor string) {
	channelID := parts[1]
	switch {
	case len(parts) == 3 && request.Method == http.MethodGet:
		tasks, ok := s.store.ChannelTasks(channelID)
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, tasks)
	case len(parts) == 3 && request.Method == http.MethodPost:
		var input ChannelTaskInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		task, ok, err := s.store.CreateChannelTask(channelID, input, actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusCreated, task)
	case len(parts) == 4 && request.Method == http.MethodGet:
		task, ok := s.store.GetChannelTask(channelID, parts[3])
		if !ok {
			writeError(response, http.StatusNotFound, "任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, task)
	case len(parts) == 4 && request.Method == http.MethodPut:
		var input ChannelTaskInput
		if err := decodeJSON(request, &input); err != nil {
			writeError(response, http.StatusBadRequest, "请求体格式错误")
			return
		}
		task, ok, err := s.store.UpdateChannelTask(channelID, parts[3], input, actor)
		if err != nil {
			writeError(response, http.StatusBadRequest, err.Error())
			return
		}
		if !ok {
			writeError(response, http.StatusNotFound, "任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, task)
	case len(parts) == 4 && request.Method == http.MethodDelete:
		deleted, err := s.store.DeleteChannelTask(channelID, parts[3], actor)
		if err != nil {
			writeError(response, http.StatusConflict, err.Error())
			return
		}
		if !deleted {
			writeError(response, http.StatusNotFound, "任务不存在")
			return
		}
		response.WriteHeader(http.StatusNoContent)
	case len(parts) == 5 && request.Method == http.MethodPost:
		switch parts[4] {
		case "start":
			task, ok, err := s.store.StartChannelTask(channelID, parts[3], actor)
			if err != nil {
				writeError(response, http.StatusBadRequest, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "任务不存在")
				return
			}
			writeJSON(response, http.StatusOK, task)
		case "stop":
			task, ok, err := s.store.StopChannelTask(channelID, parts[3], actor)
			if err != nil {
				writeError(response, http.StatusBadRequest, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "任务不存在")
				return
			}
			writeJSON(response, http.StatusOK, task)
		case "rerun":
			task, ok, err := s.store.RerunChannelTask(channelID, parts[3], actor)
			if err != nil {
				writeError(response, http.StatusBadRequest, err.Error())
				return
			}
			if !ok {
				writeError(response, http.StatusNotFound, "任务不存在")
				return
			}
			writeJSON(response, http.StatusOK, task)
		default:
			writeError(response, http.StatusNotFound, "not found")
		}
	case len(parts) == 5 && parts[4] == "runs" && request.Method == http.MethodGet:
		runs, ok := s.store.ChannelTaskRuns(channelID, parts[3])
		if !ok {
			writeError(response, http.StatusNotFound, "任务不存在")
			return
		}
		writeJSON(response, http.StatusOK, firstN(runs, 100))
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleChannelRuns(response http.ResponseWriter, request *http.Request, parts []string) {
	channelID := parts[1]
	switch {
	case len(parts) == 3 && request.Method == http.MethodGet:
		runs, ok := s.store.ChannelRuns(channelID)
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, firstN(runs, 100))
	case len(parts) == 5 && parts[4] == "logs" && request.Method == http.MethodGet:
		logs, ok := s.store.ChannelTaskLogs(channelID, parts[3])
		if !ok {
			writeError(response, http.StatusNotFound, "Channel 不存在")
			return
		}
		writeJSON(response, http.StatusOK, logs)
	default:
		writeError(response, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleChannelLogs(response http.ResponseWriter, request *http.Request, parts []string) {
	channelID := parts[1]
	if len(parts) != 3 || request.Method != http.MethodGet {
		writeError(response, http.StatusNotFound, "not found")
		return
	}
	logs, ok := s.store.ChannelTaskLogs(channelID, "")
	if !ok {
		writeError(response, http.StatusNotFound, "Channel 不存在")
		return
	}
	writeJSON(response, http.StatusOK, logs)
}

func requestActor(user User) string {
	if user.Username != "" {
		return user.Username
	}
	if user.Name != "" {
		return user.Name
	}
	return "system"
}
