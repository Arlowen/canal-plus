# Project Rules

## Completion Notification

- After completing and pushing any code, asset, UI, documentation, or project change, notify the user through the Feishu application bot configured by local environment variables `FEISHU_APP_ID`, `FEISHU_APP_SECRET`, `FEISHU_RECEIVE_ID_TYPE`, and `FEISHU_RECEIVE_ID`.
- Do not use Slack for completion notifications.
- Get `tenant_access_token` with `POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal`, using `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
- Send the notification with `POST https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${FEISHU_RECEIVE_ID_TYPE}`, using `Authorization: Bearer ${tenant_access_token}` and `FEISHU_RECEIVE_ID` as the message receiver.
- Send a text message where `content` is a JSON string, for example `{"text":"message"}`.
- Use this exact message format: `【项目名】【chat 名称】【会话名】变更已完成，【完成时间】`.
- Use the current repository or workspace name as `项目名`; if the name is `codex`, render it as `Codex`. Use the current chat/thread title as `chat 名称`, the current task/conversation name as `会话名`, and the local completion time as `完成时间`.

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

## Error Dialog Consistency

- 弹窗报错必须复用项目已有的统一错误弹窗、失败弹窗组件和样式。
- 禁止为单个场景新增临时、重复或风格不一致的报错弹窗。
- 普通校验、操作失败、系统错误这类轻量报错，必须使用 `NoticeToast` 渐入渐出的提示组件。
- 只有需要表单输入、二次确认或复杂详情内容时，才使用 `Modal`/`ConfirmDialog`。
- 如果新场景需要不同标题、对象或原因文案，优先扩展统一组件的参数。

## Icon Assets

- 涉及数据源、数据库、厂商或技术栈图标时，必须先查找并使用官方或标准图标资源，不能手绘、仿画或使用臆造图标替代。
- 图标资源需要本地化到项目中，避免运行时依赖外链。

## Log Format

- 所有应用日志信息必须使用英文。
- 每条日志必须使用 `[time][level][thread]message` 格式。
- `level` 只能是 `info`、`warn` 或 `error`。
- `thread` 使用线程名、任务名、进程名或稳定的执行上下文名称。
