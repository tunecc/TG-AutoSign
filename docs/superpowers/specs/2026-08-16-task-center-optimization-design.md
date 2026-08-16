---
comet_change: task-center-optimization
role: technical-design
canonical_spec: openspec
archived-with: 2026-08-16-task-center-optimization
status: final
---

# 任务中心综合优化 — 技术设计

本设计细化 OpenSpec change `task-center-optimization` 的实现方案。需求与验收场景见 `docs/openspec/changes/task-center-optimization/specs/task-center/spec.md`，高层方案见 `docs/openspec/changes/task-center-optimization/design.md`。本文聚焦实现细节、技术风险、测试策略与边界条件。

## 1. 后端：新任务显示旧 last_run 修复

### 根因链
- `SignTaskService.delete_task`（`backend/services/sign_tasks.py:1091`）仅 `shutil.rmtree(task_dir)`，不清理 history 文件。
- `_load_task_config`（:790）中 `config.get("last_run")` 为空时回退调用 `_get_last_run_info`。
- `_get_last_run_info`（:598）读取 `_history_file_path(task_name, account_name)`，不存在时回退 legacy `run_history_dir / f"{task_dir.name}.json"`（未过 `_safe_history_key`，次要 bug）。
- 新建同名任务 → config.json 无 `last_run` → 回退读到旧任务残留 history → 显示旧运行时间。

### 实现
1. `delete_task`：`shutil.rmtree(task_dir)` 后增加 best-effort 清理块：
   - 删除 `_history_file_path(task_name, real_account_name)`；
   - 删除 legacy `self.run_history_dir / f"{self._safe_history_key(task_name)}.json"`；
   - 失败 `logger.warning`，不阻断，`delete_task` 仍返回 True。
2. `_get_last_run_info` 收敛回退：
   - 读取 history 最近一条后，若 `account_name` 非空且条目 `entry.get("account_name")` 与之不一致，返回 None；
   - legacy 单文件（`run_history_dir / f"{task}.json"`）仅在 `account_name` 为空时回退（真正旧版兼容）；
   - legacy 路径改用 `self._safe_history_key(task_dir.name)`。

### 边界
- 跨账号同名：history 文件名 `{A}__{T}.json`，B 账号查 `{B}__{T}.json` 不存在；legacy `{T}.json` 若存在被 account_name 校验挡住（条目 account=A≠B）。
- `real_account_name` 为空（旧版无 account 路径）：legacy 路径清理。

### 测试
- 创建+运行+删除+同名重建 → last_run 为 None。
- 跨账号同名互不串读。
- 删除后 history 文件确实被删。

## 2. 前端：失败原因行内展开

### 实现（`frontend/app/dashboard/sign-tasks/page.tsx`）
- 新增 state `failedDetailTaskId: string | null`（单展开）。
- 表格视图：失败状态单元格变为可点击 button，点击切换 `failedDetailTaskId`；展开时在当前行后插入全宽 `<tr><td colSpan={列数}>`，显示失败时间 + `last_run.message`（为空时占位「无失败详情」）+「查看历史日志」按钮（调 `handleShowTaskHistory(task)`）。
- 卡片视图：失败状态可点击，展开内联区块显示同样内容。
- 成功/未运行点击无反应。点击其他失败任务关闭当前。

### 边界
- `last_run.message` 为空时占位文案。
- 展开态随列表刷新重置（可接受）。

### 测试
- 失败任务点击展开 → 显示失败时间+消息+历史入口。
- 成功/未运行点击不展开。

## 3. 前端：批量计划后编辑加载失败（多重防御）

### 实现（`frontend/app/dashboard/sign-tasks/edit/page.tsx`、`create/page.tsx`）
1. `loadTask` catch 区分 404 与其他：`err.status === 404` → `task_not_found` toast；其他 → `task_load_failed`；均延迟 600ms 跳转返回。
2. URL 参数：`buildEditTaskPath` 已 `encodeURIComponent`，edit 页 `searchParams.get` 自动解码；`nameParam`/`accountParam` 为空已有 `invalid_edit_params` 守卫。
3. 批量创建：`create/page.tsx` `handleSubmit` partial 失败时不跳转（现状正确），成功才 `goBack`。
4. 实现阶段优先本地复现确认真实根因，多重防御为兜底。

### 测试
- 批量创建（相同任务名、相同时间、多账号）后每个任务均可正常打开编辑。
- 任务不存在时 404 明确提示并返回。

## 4. 前端：排序与状态筛选持久化

### 实现（`sign-tasks/page.tsx`）
- 新增 helper 读写 localStorage（键 `tg-signpulse:task-sort-key`、`tg-signpulse:task-sort-dir`、`tg-signpulse:task-status-filter`），SSR 安全（`typeof window !== 'undefined'`），非法值回退默认。
- `useState` 惰性初始化 `sortKey`/`sortDir`/`statusFilter` 从 localStorage 读取。
- `useEffect` 监听三值变化写入存储。
- `searchQuery` 保持 `useState("")` 不持久化。

### 边界
- localStorage 残留非法值 → 校验后回退默认。

### 测试
- 刷新页面后排序与状态筛选恢复。
- 搜索词刷新后清空。

## 5. 前端：筛选栏单行紧凑美化

### 实现（`sign-tasks/page.tsx` 筛选栏区块）
- 重构为：左侧搜索框 `flex-1 min-w-[200px]`，右侧筛选组 `flex items-center gap-2 flex-wrap`（状态/账号/排序字段 select + 升降序 button）。
- 统一控件 `h-9`、`text-xs`、`rounded-lg`、`gap-2`，移除多余 `py-1.5`。
- `flex-wrap` 窄屏换行，保持 glass-panel 视觉。

### 边界
- selectionMode 下筛选栏隐藏（现状 `!selectionMode`），不破坏批量操作栏。

## 6. 任务配置模板

### 后端
- 新建 `SignTaskTemplateService`（`backend/services/sign_task_templates.py`），`templates_dir = workdir / "task_templates"`，`__init__` 中 `mkdir`。
- 方法：`list_templates()`、`save_template(name, config)`、`delete_template(name)`。
- 模板文件结构：`{name, chats, execution_mode, sign_at, range_start, range_end, random_seconds, sign_interval, updated_at}`。
- name 校验：复用 `name_must_be_valid_filename` 规则 + 拒绝 `.`/`..`/含路径分隔。
- 路由：独立 router `GET/POST /sign-task-templates`、`DELETE /sign-task-templates/{name}`。

### 前端（`lib/api.ts`、`create/page.tsx`）
- `lib/api.ts`：新增 `SignTaskTemplate` 类型、`listSignTaskTemplates`/`saveSignTaskTemplate`/`deleteSignTaskTemplate`。
- `create/page.tsx`：基本配置区新增「模板」区——「保存为模板」按钮（inline 输入 name）将当前 chats+调度+延迟+间隔提交保存；「应用模板」下拉加载列表，选择后填充表单；删除按钮。
- 应用模板时覆盖 chats，保留 selectedAccount，不自动提交，用户可继续编辑。

### 边界
- 模板名含 `/`：POST 用 body 传 name，DELETE 校验拒绝含分隔的 name。
- chat_id 跨账号：模板存 chat_id+actions，name 用 `chat_<id>` 兜底，应用后可手动改。

### 测试
- 保存→应用→手动改→提交链路。
- 删除模板不影响已建任务。
- 非法名拒绝、同名覆盖。

## 风险与取舍

- **删除时清理 history 误删** → 仅删明确路径 + legacy 路径，best-effort 不阻断主流程。
- **模板 chat_id 跨账号不匹配** → 只存 chat_id+actions，name 兜底，应用后可改；Toast 提示。
- **#3 根因未最终确认** → 多重防御兜底，实现优先复现。
- **localStorage 多标签不一致** → 不做跨标签同步。
- **排序持久化后列表"变了"** → 属预期行为。

## 测试策略汇总

- 后端单测：last_run 修复三场景、模板 CRUD 四场景。
- 前端：手动验收 6 项需求场景；`npm run build` / 类型检查通过。
- 验收场景对照 delta spec `task-center/spec.md`。
