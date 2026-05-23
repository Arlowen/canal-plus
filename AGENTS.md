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
