# 更新日志 / Changelog

本文件记录当前维护分支的重要功能、修复、配置、部署与文档变更。
This file records important feature, fix, configuration, deployment, and documentation changes for the current maintained branch.

## 2026-10-02

- 修复 / Fixed: 任务运行历史清理从"按文件 mtime 删除 3 天前的整个历史文件"改为"按条目 time 裁剪"——此前任务只要超过 3 天没有执行（停用、离线或连续失败中断），其全部运行历史即被清空；现在仅剔除超过 3 天的条目并原子写回，全部过期才删除文件，条目时间缺失/无法解析时保守保留（由条数上限兜底），损坏文件仍按 mtime 删除 / Trim run-history cleanup per entry time instead of deleting whole files by mtime — previously a task that went unexecuted for 3 days (disabled, offline, or interrupted by consecutive failures) lost its entire history; now only entries older than 3 days are removed and the file is atomically rewritten, deleted only when nothing remains, entries with missing/unparsable times are conservatively kept (bounded by the max-entries cap), and corrupt files still fall back to mtime deletion.
- 修复 / Fixed: 任务历史面板中"失败但无 message"的记录此前显示信息性提示"该记录没有流程详情（旧版本可能仅保存结果）"，误导排障方向；现在失败记录显示"失败（无详细原因记录）"，成功记录保持原提示（中英双语新增 `task_history_failed_no_reason`）/ Failed history entries with an empty message previously showed the informational hint "No detailed flow for this record (older versions may only keep result)", misleading troubleshooting; failed entries now show "Failed (no failure detail recorded)" while successful entries keep the original hint (new bilingual key `task_history_failed_no_reason`).

- 修复 / Fixed: 修复签到任务在遇到 "Request timed out" 等网络异常后从此持续出错的问题。根因是 `normal_run` 执行循环对 `OSError`/`Unauthorized` 无限 30 秒重试：Python 3.11+ 起 `asyncio.TimeoutError` 是内建 `TimeoutError`（`OSError` 子类）的别名（Docker 镜像为 python:3.12），签到阶段超时被吞进无限循环，`run_once` 永不返回，账号锁被永久占用，同账号后续任务全部"等待账号空闲超时"失败、run-status 永远显示执行中。现在一次性执行（`run_once`）在连续 3 次失败后上抛异常并记录失败历史；CLI `run` 守护模式保持原有无限重试语义 / Fix sign tasks getting stuck failing after a "Request timed out" or other network error. `normal_run`'s execution loop retried `OSError`/`Unauthorized` forever: on Python 3.11+ (the Docker image is python:3.12) `asyncio.TimeoutError` aliases the built-in `TimeoutError` (an `OSError` subclass), so timeouts during the sign phase were swallowed into an infinite retry loop — `run_once` never returned, the account lock was held forever, all later tasks on the account failed with lock-wait timeouts, and run-status stayed "running". One-shot execution now re-raises after 3 consecutive failures and records the failure; the CLI `run` daemon keeps its original retry semantics.
- 修复 / Fixed: 修复任务中心点击"编辑"提示"任务不存在"的问题。根因一：前端 `api.ts` 把任务名未经 `encodeURIComponent` 直接拼进 REST 路径，名称含 `#`（被当作片段分隔符）或 `%`（非法转义）时请求路径被浏览器截断，后端 404（调度器不走 URL，任务仍每日执行，故表现为"任务在跑但编辑 404"）；根因二：create 与 update 的任务名校验集合不一致且都不拦 `#`、`%`、`..`。现在前端统一通过 `sign-task-urls.ts` 构造任务路径（含编辑/更新/删除/运行/状态/日志/历史/会话列表），后端 create 的 pydantic 校验与 update 路由统一使用同一规则，拒绝空名、`<>:"/\|?*#%`、`..` 与空字节；已存在的特殊字符任务名在前端编码修复后恢复可操作 / Fix the "task not found" toast when clicking Edit in the task center. Cause 1: the frontend interpolated task names into REST paths without `encodeURIComponent`, so names containing `#` (fragment separator) or `%` (invalid escape) got truncated by the browser and the backend returned 404 — the scheduler bypasses URLs, so the task kept running daily while edit/run/delete/history all failed. Cause 2: create and update validated task names with inconsistent rule sets that allowed `#`, `%`, and `..`. The frontend now builds all task URLs through `sign-task-urls.ts` (edit/update/delete/run/status/logs/history/chats), and create's pydantic validator plus the update route share one rule rejecting empty names, `<>:"/\|?*#%`, `..`, and NUL bytes; existing names with special characters become operable again via URL encoding.
- 修复 / Fixed: 任务配置与运行历史 JSON 改为原子写（临时文件 + `os.replace`），消除进程中途被杀（容器重启/OOM/超时强杀）时留下撕裂半截 JSON 导致任务从列表消失、编辑页 404 的风险；同时 `delete_task` 在删除中途失败时也会失效任务列表缓存，避免列表残留残缺任务 / Write task configs and run history atomically (temp file + `os.replace`), removing the risk that a mid-write process kill (container restart / OOM / forced timeout) leaves a torn JSON file that makes the task vanish from the list and 404 on edit; `delete_task` now also invalidates the list cache when deletion fails partway, so the list no longer keeps broken remnants.

## 2026-10-01

- 修复 / Fixed: 修复定时签到任务天天报 "database is locked" 失败的问题。根因是"普通任务"通过 CLI 子进程执行 `tg-signer run`——那是常驻 cron 守护循环，子进程永远不会退出，会在每日自身 cron 时刻重新连上并占用同账号的 `.session` SQLite 文件，与后端进程内的签到任务发生跨进程 SQLite 写锁冲突（进程内的账号锁与客户端共享池对子进程无效）。现将普通任务改为 `tg-signer run_once --no-force` 一次性执行：触发一次执行一次后立即退出，是否执行仍由任务配置的调度判断（今日已执行则跳过），与原守护进程行为一致 / Fix daily "database is locked" failures of scheduled sign tasks. The root cause: normal tasks ran `tg-signer run` in a CLI subprocess — a perpetual cron daemon that never exits, reconnects at its own cron time each day and holds the same account's `.session` SQLite file while the backend's in-process sign task opens it, causing cross-process SQLite write-lock contention (in-process account locks and the shared client pool cannot protect across processes). Normal tasks now run `tg-signer run_once --no-force`: one-shot execution that exits immediately, keeping the old daemon semantics of skipping runs already executed today per the task's own schedule.
- 新增 / Added: 跨进程会话文件锁 `tg_signer/session_lock.py`——文件会话在连接 Telegram 期间对 `<account>.session.lock` 加 `flock` 互斥（签到执行、登录探测、刷新会话列表路径均已接入），进程内复用既有账号锁不变；flock 随进程退出自动释放，无残留死锁风险。锁等待超时默认 120 秒，可通过 `TG_SESSION_FILE_LOCK_TIMEOUT` 调整（<=0 表示无限等待）；后端签到任务在等待文件锁超时后沿用既有的 3 次重试机制。in-memory / session_string 会话不受影响 / Add a cross-process session file lock (`tg_signer/session_lock.py`): file-mode sessions hold an exclusive `flock` on `<account>.session.lock` while connected, wired into sign-task execution, login probing, and chat-list refresh; in-process behavior is unchanged. The lock releases automatically on process exit. Wait timeout defaults to 120 seconds and is configurable via `TG_SESSION_FILE_LOCK_TIMEOUT` (<=0 means wait forever); sign tasks retry through the existing 3-attempt loop when the lock wait times out. In-memory / session_string sessions are unaffected.

## 2026-08-16

- 修复 / Fixed: 任务中心删除签到任务时同步清理其运行历史文件，并收敛 `_get_last_run_info` 回退逻辑——新建同名任务不再显示旧任务的最后运行时间，跨账号同名任务互不串读历史 / Clean up a sign task's run-history files on delete and converge `_get_last_run_info` fallback so newly created same-name tasks no longer show a stale last-run time and same-name tasks across accounts no longer bleed history.
- 新增 / Added: 任务列表失败任务支持点击行内展开，显示失败时间、失败原因（`last_run.message`）与查看历史日志入口；成功/未运行状态不触发展开，单展开模式 / Add an inline expand on failed tasks in the task list showing failure time, reason (`last_run.message`), and a history-log shortcut; success/not-run states do not expand, single-expand mode.
- 修复 / Fixed: 批量添加计划后编辑时间重复同名任务时不再出现加载任务失败；编辑页加载失败区分 404 与其他错误，任务不存在时给出明确提示并返回列表 / Editing time-duplicate same-name tasks created via batch scheduling no longer fails to load; the edit page distinguishes 404 from other load errors and returns to the list with a clear "task not found" message.
- 新增 / Added: 任务列表排序字段、升降序与状态筛选持久化到浏览器本地存储，刷新页面后恢复；搜索词不持久化 / Persist the task list sort key, sort direction, and status filter to browser local storage and restore them after refresh; the search query is not persisted.
- 变更 / Changed: 任务列表顶部搜索与筛选状态栏重构为单行紧凑布局，统一控件高度与间距，窄屏自适应换行，保持玻璃面板视觉风格 / Refactor the task list search and status filter bar into a single-row compact layout with unified control height and spacing, responsive wrapping on narrow screens, and the existing glass-panel visual style.
- 新增 / Added: 任务配置模板——可将任务配置（目标会话列表、调度模式与时间、随机延迟、动作间隔）保存为命名模板，在创建页一键应用，应用后任务仍可手动编辑再提交，不直接创建任务；支持模板列表与删除，删除模板不影响已建任务 / Add task configuration templates that save chats, schedule mode/times, random delay, and action interval as a named template, apply it with one click on the create page (the task remains editable before submitting and is not auto-created), and support listing and deleting templates without affecting existing tasks.

## 2026-06-12

- 修复 / Fixed: 登录页改为标准登录表单语义，用户名、密码与 TOTP 字段分别使用 `username`、`current-password`、`one-time-code` 自动填充标记，并在提交时直接读取表单 DOM 值，提升 Bitwarden 与浏览器密码管理器自动填充兼容性 / Use standard sign-in form semantics for the login page with `username`, `current-password`, and `one-time-code` autocomplete hints, and read submitted DOM form values directly to improve Bitwarden and browser password-manager autofill compatibility.
- 新增 / Added: 登录页新增默认开启的“保持登录 30 天”选项；登录接口增加 `remember_me` 参数，勾选时签发 30 天令牌，未勾选时继续使用 `APP_ACCESS_TOKEN_EXPIRE_HOURS` 短会话配置，并新增 `APP_REMEMBER_ME_EXPIRE_DAYS` 运行时配置与文档 / Add a default-enabled "keep me signed in for 30 days" option; extend login with `remember_me`, issue 30-day tokens when enabled, keep `APP_ACCESS_TOKEN_EXPIRE_HOURS` for short sessions when disabled, and document the new `APP_REMEMBER_ME_EXPIRE_DAYS` runtime config.

## 2026-06-01

- 修复 / Fixed: Dashboard 首页增加“任务中心”入口，任务中心返回按钮改为返回首页；目标聊天选择按聊天列表来源账号加载，支持刷新会话列表、搜索会话与手动输入 Chat ID / Add a Task Center entry on the dashboard, make the Task Center back button return home, and load target chats from the selected chat-list source account with refresh, search, and manual Chat ID fallback.
- 新增 / Added: 签到任务创建页支持以任务中心方式批量选择账号，并为每个账号设置固定时间或时间段；支持按账号顺序自动错开触发时间，便于同一任务模板分发到多个账号 / Add a task-center-style sign task creation flow that applies one task template to multiple selected accounts with per-account fixed-time or time-range schedules, including staggered scheduling.
- 新增 / Added: 任务中心目标聊天弹窗补齐旧版任务编辑的动作序列配置，支持发送文本、点击按钮、发送骰子、AI 图片识别与 AI 计算题，并支持动作间隔、删除延迟、保存前校验和动作数量回显 / Complete action-sequence configuration in the Task Center target-chat dialog with text send, button click, dice, AI vision, and AI logic actions, plus action interval, delete delay, pre-save validation, and action-count summaries.
- 变更 / Changed: 账号任务页移除独立批量导入入口，将多任务 JSON 识别合并到“粘贴导入任务”中，并为导入导出按钮增加文字标签，提升入口可识别性 / Merge batch JSON import into the paste-import flow on the account task page and add clearer text labels to import/export actions.
- 修复 / Fixed: 后端本地源码运行时支持通过 `WEB_DIR` 指定前端静态目录，并在 `/web` 不存在时回退到本地 `frontend/out`；同时固定 `bcrypt==4.0.1`，避免新版 bcrypt 与 passlib 的兼容问题影响启动 / Allow local backend source runs to use `WEB_DIR` or fall back from `/web` to local `frontend/out`, and pin `bcrypt==4.0.1` to avoid the passlib compatibility issue.
- 修复 / Fixed: 任务中心取消返回改为整页跳转 Dashboard，修复添加聊天弹窗 overlay 激活状态，并稳定 Toast 回调引用，避免弹窗样式和通知生命周期异常 / Make Task Center cancel navigation return to the dashboard via full-page navigation, fix the add-chat modal overlay active state, and stabilize toast callback references to avoid modal styling and toast lifecycle issues.

## 2026-05-29

- 新增 / Added: 账号管理支持 Telegram-Panel 账号包导入导出，后端可安全解压 Zip 并导入 Telethon 兼容包、session string、SQLite session、Telegram-Panel WTelegram 加密 session 与 Telegram Desktop TData，支持同名跳过或覆盖，并可导出 Telethon 或 TData 格式 / Add Telegram-Panel account-package import/export in account management, with safe Zip extraction and support for Telethon-compatible packages, session strings, SQLite sessions, Telegram-Panel encrypted WTelegram sessions, and Telegram Desktop TData, with duplicate skip/overwrite and Telethon or TData export formats.
- 新增 / Added: 代理配置支持 HTTP/HTTPS 等协议格式；前端代理输入增加实时格式校验，覆盖手机号登录、二维码登录与账号编辑三个入口，非法端口或格式会立即提示；同步更新 CLI help、环境变量注释与 UI 文案 / Add HTTP/HTTPS proxy format support; add client-side proxy format validation in phone login, QR login, and account-edit forms with immediate error feedback; update CLI help, env example comments, and UI labels.

## 2026-05-07

- 修复 / Fixed: 普通任务调度器在执行失败时不再只输出 `INFO` 级别的"执行结束"日志，而是正确输出 `ERROR` 并携带错误详情；同时增加异常边界捕获，防止逃逸异常丢失在 APScheduler 层 / Log regular task scheduling failures at `ERROR` level with error details instead of a generic `INFO` completion message, and add an outer exception boundary so escaped errors are also captured.
- 修复 / Fixed: 签到任务 `_save_run_info` 中的调试 `print` 替换为 `logger.error`，确保保存历史文件或更新 `config.json` 失败时错误信息能写入 `app.log` / `error.log` 而不是仅输出到 stdout / Replace debug `print` statements in `_save_run_info` with `logger.error` so file I/O failures are persisted to the application log files rather than lost to stdout.
- 修复 / Fixed: 签到任务 `run_task_with_logs` 收尾阶段将 `_save_run_info` 与 `dispatch_notification` 的异常处理分离，确保保存失败不影响通知发送，通知失败也不覆盖已保存的历史记录，原始错误信息始终保留并返回给调用者 / Separate exception handling in the sign task cleanup phase so history-save failures do not block notification delivery, notification failures do not overwrite persisted history, and the original error is always preserved.

## 2026-05-05

- 修复 / Fixed: Dashboard 运行日志移除机器人回复展示，仅保留任务完成状态；文案由"最近 N 条记录"改为"近 3 天记录"；统一 Dashboard、任务列表与账号任务三处历史弹窗的时间与任务名字号，并将时间颜色从 `ui-muted` 调深为 `text-main/70`，提升可读性 / Remove bot-reply display from dashboard run logs and keep only the completion status; change the log summary label from "last N entries" to "last 3 days"; unify timestamp and task-name font sizes across dashboard, sign-tasks, and account-tasks history modals, and deepen timestamp color from `ui-muted` to `text-main/70` for better readability.

## 2026-05-05

- 修复 / Fixed: 修复右下角 Toast 通知的 CSS 主题选择器错误（`data-theme` 实际设置在 `body` 而非 `:root` 上，导致浅色模式下深色样式错误生效），并移除消息文字上强制覆盖颜色的内联样式，恢复按通知类型区分的主题色文字，确保深浅色主题下文字与背景对比度始终正确 / Fix the toast CSS theme selector bug where the dark-mode style was incorrectly applied in the light theme because `data-theme` lives on `body`, not `:root`; remove the inline color override on toast text so type-specific theme colors are restored and contrast remains correct in both themes.
- 修复 / Fixed: 账号日志与任务历史中“最新消息”摘要改为取结构化消息事件列表的第一条，与事件入库顺序保持一致 / Use the first structured message event as the "latest message" summary in account logs and task history to match the event insertion order.

## 2026-05-02

- 修复 / Fixed: `ADMIN_USERNAME` 现在会在首次初始化管理员时覆盖默认用户名，并补充 Docker 与 README 说明，明确初始管理员环境变量只在用户表为空时生效 / Honor `ADMIN_USERNAME` when creating the initial administrator and document that initial admin environment variables apply only while the user table is empty.

## 2026-05-01

- 修复 / Fixed: 任务历史日志会将“开始执行”动作流程框解析为结构化卡片，避免中文、emoji 与框线字符混排导致表格错位 / Render sign-task action-flow banners as structured cards in history logs so Chinese text, emoji, and box-drawing characters no longer misalign.

## 2026-04-29

- 修复 / Fixed: 提高右下角 Toast 提示在浅色主题下的清晰度，移除模糊背景叠加并增强错误提示图标、正文和关闭按钮对比度 / Improve bottom-right toast readability in the light theme by removing the blurred translucent background layer and increasing contrast for error icons, text, and the close button.

## 2026-04-28

- 修复 / Fixed: 前端重复点击同一个签到任务时，后台返回“正在执行中 / 请勿重复触发”后改为信息提示，不再误显示为执行失败 / Treat duplicate sign-task submissions that report an already-running task as informational UI feedback instead of a failure toast.
- 修复 / Fixed: 签到任务运行监控状态面板不再把仍在运行的重复触发状态渲染为失败样式，并恢复结构化消息事件中“发送消息 / Message sent”的翻译键 / Avoid rendering duplicate-running sign-task monitor states as failures and restore the sent-message translation key for structured message event labels.

## 2026-04-26

- 新增 / Added: 手动执行签到任务改为后台提交，接口立即返回提交状态，前端通过实时进度和历史链式日志查看完整执行过程 / Submit manual sign tasks to an in-process background runner so the API returns immediately while the UI follows progress through live status and historical flow logs.
- 新增 / Added: 签到任务后台执行增加中文阶段状态、同账号同任务去重、同账号不同任务排队等待提示，并展示前序任务、前序阶段、最后进度和等待时长 / Add Chinese phase status, duplicate protection for the same account-task pair, queued same-account task hints, and blocking task details including phase, latest progress, and wait duration.
- 修复 / Fixed: 账号锁等待超时只取消当前等待任务并写入失败历史，不中断前序任务；历史默认保留条数继续使用 `SIGN_TASK_HISTORY_MAX_ENTRIES=100` / Cancel only the waiting job on account-lock timeout, persist failure history without interrupting the blocking job, and keep the default history retention at `SIGN_TASK_HISTORY_MAX_ENTRIES=100`.

- 修复 / Fixed: 统一首页运行日志中“收到 N 条消息”和“最近消息”的字号字重，并移除账号任务历史展开后的重复“最新摘要”行 / Align the dashboard run-log count and latest-message typography, and remove the duplicate latest-summary line from expanded account task history entries.
- 修复 / Fixed: 优化浅色主题下任务卡片、任务历史、运行监控、首页日志与设置页的成功/失败状态样式，改用主题感知的高对比度状态色和历史面板背景，并为 9-11px 小字号文案增加 12px 可读下限，避免成功徽章、日志文字和说明文字发虚或看不清 / Improve light-theme readability for success/failure states across task cards, task history, run monitoring, dashboard logs, and settings by using theme-aware high-contrast status colors and history panel surfaces, and add a 12px readability floor for 9-11px text.

## 2026-04-25

- 变更 / Changed: 重构后端与 `tg_signer` 日志系统，统一时间戳与格式化输出，补充中文诊断日志、调度日志和关键边缘场景判断，并清理遗留 `print` 与 `utcnow()` 用法，便于直接通过日志定位失败阶段与原因 / Refine backend and `tg_signer` logging with unified timestamps and formatting, richer Chinese diagnostics, scheduler logs, defensive edge-case checks, and cleanup of legacy `print` and `utcnow()` usage so failures can be located directly from logs.
- 修复 / Fixed: 修复签到任务通知摘要误回退为启动日志的问题，补齐发送型及旧版配置签到任务的消息上下文采集，并避免复用旧的 no_updates client 或将自己发送的消息误记为执行摘要 / Fix sign task notifications falling back to startup logs, restore message context capture for send-type and legacy-config sign tasks, and avoid stale no_updates client reuse or self-authored messages being picked as summaries.
- 修复 / Fixed: 修正签到任务消息历史中的发送方/接收方建模与展示，私聊场景不再把 chat 误显示为接收者，并补充名称、用户名与 ID 的可读格式 / Correct sender and recipient modeling for sign task message history so private chats no longer display the chat object as the recipient, and show readable name, username, and ID formatting.

## 2026-04-24

- 新增 / Added: 普通任务与签到任务支持通过 Telegram 官方 Bot 发送完成通知，支持全局默认配置与账号级覆盖 / Add Telegram Bot completion notifications for regular and sign tasks with global defaults and per-account overrides.
- 变更 / Changed: Telegram 完成通知配置完全通过 UI 管理，不依赖新增 Docker 环境变量 / Manage Telegram completion notification settings entirely from the UI without new Docker environment variables.
- 新增 / Added: 签到任务运行监控支持结构化 Telegram 消息事件实时推送与历史回看 / Add structured Telegram message event streaming and history review for sign task monitoring.
- 变更 / Changed: 签到任务历史 JSON 新增 `message_events` 字段，并保持旧历史记录兼容读取 / Extend sign task history JSON with `message_events` while remaining compatible with legacy records.
- 新增 / Added: 增加 `SIGN_TASK_HISTORY_MAX_MESSAGE_EVENTS` 运行时配置，用于限制单次执行保留的结构化消息事件数量，并支持设为 `0` 禁用历史保留 / Add `SIGN_TASK_HISTORY_MAX_MESSAGE_EVENTS` runtime config to cap structured message events kept per run and allow `0` to disable history retention.

## 2026-04-23

- 修复 / Fixed: 避免已编辑回复消息场景下的按钮点击出现延迟 / Avoid delayed button clicks on edited reply messages.
- 修复 / Fixed: 修复任务图标、进度指示和主题相关的界面问题 / Fix UI task icons, progress indicators, and theme-related issues.
- 变更 / Changed: 将动作间隔配置统一迁移为毫秒单位 / Migrate action interval configuration to milliseconds.
- 新增 / Added: 增加任务重命名，以及取消或重置表单能力 / Add task rename support and cancel or reset form behavior.
- 新增 / Added: 增加签到任务批量导入与导出能力 / Add batch sign task import and export.
- 修复 / Fixed: 修复 Telegram API 首次启动时的环境变量引导优先级 / Fix Telegram API environment bootstrap precedence on first run.

## 2026-04-22

- 变更 / Changed: 刷新部署文档，并补充 Telegram client 设备参数统一配置 / Refresh deployment docs and unify Telegram client device configuration.
