## 1. 后端：删除任务清理 history

- [x] 1.1 在 `SignTaskService.delete_task` 中，于 `shutil.rmtree(task_dir)` 后增加 history 清理：删除 `_history_file_path(task_name, real_account_name)` 与 legacy `run_history_dir / f"{_safe_history_key(task_name)}.json"`（best-effort，失败记日志不阻断）
- [x] 1.2 收敛 `_get_last_run_info`：读取 history 最近一条时校验其 `account_name` 与当前 `account_name` 一致；legacy 单文件历史仅在无 account_name 时回退
- [x] 1.3 为 delete_task 清理与 last_run 回退补单元测试（删除同名重建不显示旧 last_run、跨账号同名不串读）

## 2. 后端：任务配置模板 API

- [x] 2.1 新增模板服务方法：列表/保存/删除，存储于 `<workdir>/task_templates/<name>.json`，模板字段 = name + chats + execution_mode + sign_at/range_start/range_end + random_seconds + sign_interval
- [x] 2.2 模板名复用文件名安全校验（非法字符 `< > : " / \ | ? *`、空、`. ..` 拒绝）
- [x] 2.3 新增路由：`GET /sign-task-templates`、`POST /sign-task-templates`、`DELETE /sign-task-templates/{name}`，挂到 sign_tasks 路由或独立 router
- [x] 2.4 为模板服务补测试（保存/列表/删除、同名覆盖、非法名拒绝）

## 3. 前端：失败原因行内展开

- [x] 3.1 在 `sign-tasks/page.tsx` 任务列表表格视图与卡片视图中，使失败状态可点击，展开内联区域显示 `last_run.message` 与失败时间
- [x] 3.2 展开区域内提供「查看历史日志」入口，复用 `handleShowTaskHistory`
- [x] 3.3 成功/未运行状态点击不展开；交互为单展开（点击其他失败任务关闭前一个）
- [x] 3.4 新增/补充中英文案 key（失败原因、查看历史日志等）

## 4. 前端：批量计划后编辑加载修复

- [x] 4.1 复现并定位「批量添加计划后编辑时间重复任务加载失败」的真实触发点（检查 `loadedKeyRef`、StrictMode 双渲染、URL 参数解析、后端 404）
- [x] 4.2 修复根因（按复现结果：时序/编码/错误处理之一）
- [x] 4.3 在 `edit/page.tsx` `loadTask` 失败时区分 404 与其他错误，404 给明确提示并返回列表
- [x] 4.4 验证批量创建（相同任务名、相同时间、多账号）后每个任务均可正常打开编辑

## 5. 前端：排序与状态筛选持久化

- [x] 5.1 新增 `tg-signpulse:task-sort-key`、`tg-signpulse:task-sort-dir`、`tg-signpulse:task-status-filter` localStorage 读写
- [x] 5.2 组件初始化读取恢复 `sortKey/sortDir/statusFilter`；`searchQuery` 不持久化
- [x] 5.3 各 setter 变更时写入；`handleSortKeyChange`/`handleSortClick`/`handleSortDirToggle`/`setStatusFilter` 路径一致
- [x] 5.4 验证刷新后恢复、搜索词刷新后清空

## 6. 前端：筛选栏单行紧凑美化

- [x] 6.1 重构 `sign-tasks/page.tsx` 筛选栏为单行紧凑布局：搜索框 `flex-1` + 右侧状态/账号/排序字段/升降序切换分组
- [x] 6.2 统一控件高度、间距、`flex-wrap` 窄屏换行，保持 glass-panel 风格
- [x] 6.3 在表格视图与卡片视图下均表现正常，不破坏 selectionMode 批量操作栏

## 7. 前端：任务配置模板保存与一键应用

- [x] 7.1 在 `lib/api.ts` 新增模板 API 客户端方法与类型（list/save/delete）
- [x] 7.2 在 `create/page.tsx` 新增模板保存入口：将当前 chats/调度/延迟/间隔保存为命名模板
- [x] 7.3 在 `create/page.tsx` 新增模板选择与应用：一键填充表单，应用后保留手动编辑能力，不自动创建任务
- [x] 7.4 模板列表/删除入口；中英文案 key
- [x] 7.5 验证保存→应用→手动改→提交链路，删除模板不影响已建任务

## 8. 验收与收尾

- [x] 8.1 手动验收 6 项需求场景（删除重建、跨账号同名、失败展开、批量编辑、刷新记忆、模板应用）
- [x] 8.2 运行后端测试与前端构建/类型检查
- [x] 8.3 更新 CHANGELOG（如项目惯例要求）
