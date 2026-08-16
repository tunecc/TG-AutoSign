## Context

任务中心当前实现见 `frontend/app/dashboard/sign-tasks/page.tsx`（列表/筛选/排序/运行监控/历史）、`create/page.tsx` 与 `edit/page.tsx`（创建/批量计划/编辑），后端任务服务与路由见 `backend/services/sign_tasks.py`、`backend/api/routes/sign_tasks.py`。任务以文件系统存储：`<workdir>/signs/<account>/<task>/config.json`，运行历史存于 `<workdir>/history/<account>__<task>.json`（旧版为 `<task>.json`）。任务实例由 `(account_name, task_name)` 唯一标识。前端视图偏好（viewMode）已用 `localStorage` 持久化，键前缀 `tg-signpulse:`。本设计的约束：不引入数据库 schema 变更，保持现有文件存储模型；前端保持 Next.js + 现有 glass-panel 视觉语言。参见 proposal.md 的 Why 与 What Changes。

## Goals / Non-Goals

**Goals:**
- 让 `last_run` 只反映当前任务实例自身历史，删除任务时清理其历史文件
- 失败任务失败原因在列表内可观测（行内展开）
- 批量计划后编辑加载链路可靠（含时间重复同名任务）
- 排序/状态筛选持久化，搜索词不持久化
- 筛选栏单行紧凑美化
- 任务配置模板：保存/列表/删除/一键应用（应用后可继续编辑）

**Non-Goals:**
- 不重构任务存储为数据库
- 不改造调度器、运行监控、WebSocket 链路
- 不做账号排程规则的模板化（用户已确认仅任务配置模板）
- 不持久化搜索词、不持久化账号多选筛选（本次仅 sortKey/sortDir/statusFilter）
- 不引入新的 UI 组件库

## Decisions

### Decision 1: 删除任务时同步清理 history 文件

`SignTaskService.delete_task` 在 `shutil.rmtree(task_dir)` 后，删除对应 history 文件：优先 `_history_file_path(task_name, real_account_name)`，再尝试 legacy `run_history_dir / f"{_safe_history_key(task_name)}.json"`。失败不阻断删除成功（best-effort，记录日志）。

**理由**：根因是删除任务后 history 残留，新建同名任务时 `_get_last_run_info` 回退 legacy 读取到旧历史。从源头清理比在读取侧加复杂守卫更彻底。

**备选**：仅在读取侧用 `(account, task)` 严格匹配历史条目 `account_name` 字段——但 legacy 单文件历史无 account 字段时仍会串读，且残留文件持续累积。源头清理更干净。

### Decision 2: `_get_last_run_info` 收敛回退条件

即使 config 无 `last_run`，回退读取 history 时：若 history 文件中最近一条的 `account_name` 与当前任务的 `account_name` 不一致，则视为不属于本任务实例，返回 None。legacy 单文件历史（无 account 字段）仅在没有 account_name 时才作为回退（即真正旧版兼容场景）。

**理由**：双保险——清理后正常情况下新任务无 history；但若历史残留（如外部拷贝数据），读取侧仍不串读。

### Decision 3: 失败原因行内展开（前端）

在任务列表表格视图与卡片视图中，失败状态徽章/行可点击，展开一个内联区域显示 `last_run.message` 与失败时间，内含「查看历史日志」按钮（复用现有 `handleShowTaskHistory`）。用受控的展开 state（`Set<taskId>` 或单个 expanded taskId）。成功/未运行点击不展开。

**理由**：用户已选「行内可点击展开」。复用现有历史 Modal，无需新弹窗。

### Decision 4: 编辑加载链路修复

经审查，`getSignTask` → 后端 `get_task(task_name, account_name)` 路径解析正确（`signs/account/task`），`buildEditTaskPath` 已 `encodeURIComponent`。批量创建用相同 `taskName` 跨账号，每个 `(account,name)` 是独立目录，理论上不冲突。"加载任务失败"的实际触发链需在实现阶段通过日志/复现确认（疑似：批量创建部分失败导致列表存在指向不存在任务的条目，或 `loadedKeyRef` 与 StrictMode 双渲染时序问题）。修复策略：在 `loadTask` 失败时区分 404 与其他错误，404 给明确提示并返回；确认 `create/page.tsx` 批量提交后列表刷新一致。若复现发现是任务名特殊字符在路径参数中的边界问题，则补 URL 编码加固。

**理由**：此问题的根因需要实现阶段复现确认，不在设计阶段臆断单一根因。

### Decision 5: 排序/筛选持久化用 localStorage

沿用现有 `tg-signpulse:` 前缀。新增键：`tg-signpulse:task-sort-key`、`tg-signpulse:task-sort-dir`、`tg-signpulse:task-status-filter`。在组件初始化时读取恢复，在 `setSortKey/setSortDir/setStatusFilter` 变更时写入。`searchQuery` 不持久化。

**理由**：与 viewMode 持久化方式一致，零后端改动。

### Decision 6: 筛选栏单行紧凑布局

重构 `sign-tasks/page.tsx` 的筛选栏：搜索框 `flex-1 min-w`，右侧筛选控件分组（状态/账号/排序字段/升降序切换）单行排列，统一控件高度与间距，`flex-wrap` 窄屏换行。保留现有 glass-panel 容器与图标。

**理由**：用户已选「单行紧凑布局」。

### Decision 7: 任务配置模板存储与 API

模板存于 `<workdir>/task_templates/<template_name>.json`（独立目录，不污染 signs/history）。模板内容：`{ name, chats, execution_mode, sign_at/range_start/range_end, random_seconds, sign_interval }`。

后端新增 API（挂到 sign_tasks 路由或独立路由）：
- `GET /sign-task-templates` → 列表
- `POST /sign-task-templates` → 保存（body 含 name + 配置）
- `DELETE /sign-task-templates/{name}` → 删除
- 不需要「应用」接口——应用是前端行为：拉取模板内容填入 create 页表单

模板名做文件名安全校验（复用 `name_must_be_valid_filename` 规则）。模板不绑定账号（chats 中的 chat_id 跨账号通用，但 chat 名称可能不同；应用时只填 chat_id + actions，名称由账号侧补全或留 `chat_<id>`）。

**理由**：应用是纯前端表单填充，无需后端参与；后端只负责模板 CRUD。模板与账号解耦，更通用。

**备选**：模板也存 localStorage——但跨设备不同步且易丢失，后端文件存储与任务一致更可靠。

## Risks / Trade-offs

- **[删除任务时清理 history 的误删风险]** → 仅删除 `_history_file_path` 计算出的明确路径与 legacy 路径，不使用通配删除；best-effort 不阻断删除主流程。
- **[模板 chat_id 跨账号不匹配]** → 应用模板时只填 chat_id 与 actions，chat 显示名称在保存 chat 时由 `chat_<id>` 兜底；用户可在应用后手动调整。文档/Toast 提示。
- **[编辑加载失败根因未最终确认]** → 实现阶段优先复现，避免过早固化错误修复；若确为 StrictMode 时序问题则用 `loadedKeyRef` 已有逻辑加固。
- **[localStorage 持久化与多标签页不一致]** → 本次不做跨标签同步，可接受；用户在另一标签改动不影响当前标签直到刷新。
- **[排序持久化后用户困惑「列表变了」]** → 属预期行为，符合用户「记住」诉求。

## Migration Plan

- 后端：`delete_task` 增加 history 清理（向后兼容，老任务删除同样生效）；新增模板 API 与目录（首次访问自动创建）。
- 前端：筛选栏重构、失败展开、持久化、模板 UI 均为增量，不影响既有任务数据。
- 无数据迁移；已残留的孤立 history 文件在下次删除对应任务时被清理，或可后续提供一次性清理脚本（本变更不含）。
- 回滚：前端改动可单独回滚；后端模板 API 与清理逻辑可单独回滚，不影响任务运行。

## Open Questions

- 模板是否需要「导出/导入」？本次不做，仅保存/列表/删除/应用。
- 失败原因展开是单任务单展开还是多任务同时展开？实现阶段取交互更自然者（倾向单展开，点击其他关闭）。
