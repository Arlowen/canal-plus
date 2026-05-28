# Project Rules

## Completion Notification

- After completing and pushing any code, asset, UI, documentation, or project change, notify the user through the Slack bot configured by local environment variables `SLACK_BOT_TOKEN` and `SLACK_NOTIFY_CHANNEL`.
- Send the notification with Slack `chat.postMessage` so it appears from the bot app instead of the user's profile.
- If the bot-token notification fails for any reason, fall back to `[@slack](plugin://slack@openai-curated)` and send the same notification message.
- Mention the user with `<@U0ALQ0WRQHE>` at the start of the notification.
- Use this exact message format: `<@U0ALQ0WRQHE> 【项目名】【chat 名称】【会话名】变更已完成，【完成时间】`.
- Use the current repository or workspace name as `项目名`, the current chat/thread title as `chat 名称`, the current task/conversation name as `会话名`, and the local completion time as `完成时间`.

## Small Change Auto Publish

- For each small, self-contained change, once the relevant verification passes and the change is confirmed to have no obvious issues, automatically stage only the related files, commit them, and push them to the current remote branch without waiting for an extra confirmation.
- Never include unrelated local changes in that automatic commit.
- If verification fails, the change scope is mixed or unclear, or pushing would be risky, stop and report the blocker instead of pushing blindly.

## Post-change Startup

- 每次完成代码、资源、UI、文档或项目规则变更后，都需要启动或确认项目已经启动。
- 如果项目已经在运行，确认前后端端口和健康状态即可，不要重复启动冲突进程。
- 最终回复必须提供可访问的项目链接，优先提供前端地址；必要时同时提供后端健康检查地址。

## Copy Minimalism

- UI 文案默认极简，能用一个词就不要写一句话。
- 按钮、标签、卡片标题、辅助说明优先用短词或短语，避免解释型长句和营销文案。
- 只有报错、危险操作确认、权限限制这类高风险场景，才允许使用完整句子说明。

## Icon Assets

- 涉及数据源、数据库、厂商或技术栈图标时，必须先查找并使用官方或标准图标资源，不能手绘、仿画或使用臆造图标替代。
- 图标资源需要本地化到项目中，避免运行时依赖外链。

## Log Format

- 所有应用日志信息必须使用英文。
- 每条日志必须使用 `[time][level][thread]message` 格式。
- `level` 只能是 `info`、`warn` 或 `error`。
- `thread` 使用线程名、任务名、进程名或稳定的执行上下文名称。
