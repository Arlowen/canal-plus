import type { TaskStatus } from "../types/api";

export const taskStatusText: Record<TaskStatus, string> = {
  draft: "草稿",
  pending: "待启动",
  full_syncing: "全量同步中",
  incremental_running: "增量同步中",
  paused: "已暂停",
  failed: "异常",
  stopped: "已停止"
};
