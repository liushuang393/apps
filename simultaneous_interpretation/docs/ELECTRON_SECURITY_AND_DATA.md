# Electron 凭据、端点与历史数据

## API Key

Electron 版的 Key 优先级为：进程环境变量、操作系统安全存储中的用户 Key、未配置。兼容环境变量按以下顺序读取：

1. `OPENAI_API_KEY`
2. `OPENAI_REALTIME_API_KEY`
3. `VOICETRANSLATE_API_KEY`

UI 保存的 Key 使用 Electron `safeStorage` 加密后写入 `userData/credentials.json`。renderer 不能读取 Key；清除操作只删除安全存储中的 fallback，不影响环境变量。若 `safeStorage` 暂时不可用，Key 仅在当前进程内使用，不会明文写盘。

首次升级会尝试迁移旧的 `localStorage.openai_api_key`。只有 main 确认密文持久化成功后，旧明文和迁移标记才会更新。

## 自定义 OpenAI 端点

端点只可由 main 进程环境变量配置：

- `OPENAI_REALTIME_URL`：必须为 `wss://`
- `OPENAI_CHAT_URL`：必须为 `https://`

URL 不得包含用户名、密码或 fragment。自定义端点会接收 OpenAI Authorization header 和翻译内容，使用前必须确认服务方可信。生产包不会加载工作目录中的 `.env`；项目 `.env` 仅用于未打包开发模式。

## 历史数据

数据库位于 Electron `userData/conversations.db`，不会写入安装目录或 `app.asar`。历史默认永久保留；每个 segment 以 `(session_id, segment_id, role)` UPSERT 最终原文和最终译文。正文使用 `safeStorage` 按字段加密，密文损坏时该行显示“内容无法解密”，不会阻断其他历史。

“清空全部历史”只允许在 idle 状态执行，并要求二次确认。活动 session 在异常退出后会于下次启动标记为 `interrupted`。

## 发布检查

`npm run dist:win` 会先清理 `dist/electron` 和 `release`，然后生成 installer、portable 和 unpacked 包。`npm run smoke:packaged` 检查关键资源、安全存储和 `userData` 数据库。发布前还应确认 `app.asar` 不含 `.env`、数据库、日志或旧 `dist`，并确认 `better-sqlite3.node` 位于 `app.asar.unpacked`。
