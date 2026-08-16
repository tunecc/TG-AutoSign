# Brainstorm Summary

- Change: task-center-optimization
- Date: 2026-08-16

## 确认的技术方案

### 后端
- **#1 last_run 修复**：`delete_task` 在 `shutil.rmtree(task_dir)` 后 best-effort 清理 history 文件（`_history_file_path(task_name, real_account_name)` + legacy `run_history_dir/_safe_history_key(task_name).json`）；`_get_last_run_info` 回退读取时校验 history 最近一条的 `account_name` 与当前一致，不一致返回 None，legacy 单文件仅 account_name 为空时回退，并改用 `_safe_history_key`。
- **#6 模板 API**：新建独立 `SignTaskTemplateService`（存储 `<workdir>/task_templates/<safe_name>.json`），独立路由 `GET/POST /sign-task-templates`、`DELETE /sign-task-templates/{name}`；模板含 name + chats + execution_mode + sign_at/range_start/range_end + random_seconds + sign_interval + updated_at；name 复用文件名安全校验。

### 前端
- **#2 失败原因行内展开**：`sign-tasks/page.tsx` 新增 `failedDetailTaskId` state（单展开）；表格视图失败状态可点击，展开全宽行显示失败时间+message+「查看历史日志」按钮（复用 `handleShowTaskHistory`）；卡片视图同理。
- **#3 编辑加载多重防御**：`edit/page.tsx` `loadTask` catch 区分 404 与其他错误，404 给 `task_not_found` toast；URL 参数已 `encodeURIComponent` 无需额外；批量创建 partial 失败不跳转（现状正确）。实现时优先本地复现确认根因。
- **#4 排序/筛选持久化**：`sortKey`/`sortDir`/`statusFilter` 惰性初始化从 localStorage 读取，`useEffect` 监听写入；键前缀 `tg-signpulse:task-`；`searchQuery` 不持久化；SSR 安全 + 非法值回退默认。
- **#5 筛选栏单行紧凑**：重构筛选栏为单行，搜索框 `flex-1` + 右侧状态/账号/排序/升降序分组，统一 `h-9 text-xs rounded-lg gap-2`，`flex-wrap` 窄屏换行，保持 glass-panel 风格。
- **#6 模板 UI**：`lib/api.ts` 新增模板类型与 list/save/delete 方法；`create/page.tsx` 新增「保存为模板」「应用模板」下拉与删除；应用模板填充表单后保留手动编辑，不自动提交。

## 关键取舍与风险

- **[删除时清理 history 误删]** → 仅删明确计算路径 + legacy 路径，best-effort 不阻断删除主流程。
- **[模板 chat_id 跨账号不匹配]** → 模板只存 chat_id+actions，name 用 `chat_<id>` 兜底，应用后可手动改；Toast 提示。
- **[#3 根因未最终确认]** → 多重防御兜底，实现时优先复现。
- **[localStorage 多标签不一致]** → 本次不做跨标签同步，可接受。
- **[排序持久化后列表"变了"] → 属预期，符合用户"记住"诉求。

## 测试策略

- 后端单测：删除同名重建不显示旧 last_run、跨账号同名不串读、history 文件确实被删；模板 save/list/delete/同名覆盖/非法名拒绝。
- 前端：手动验收 6 项需求场景；前端构建+类型检查通过。

## Spec Patch

无。delta spec 验收场景已覆盖关键行为（删除重建、跨账号同名、失败展开、批量编辑、刷新记忆、搜索词清空、模板保存/应用/删除）。Open Questions 中的「失败展开单/多展开」已定为单展开、「模板导出」明确不做，均不改变 spec。
