## Why

任务中心是用户管理签到任务的入口，当前存在多个影响信任与可用性的缺陷：新建任务从未运行却显示旧的「最后运行时间」（数据来源串号）；失败任务没有任何入口可查看失败原因；批量添加计划后编辑时间重复任务时加载失败；升降序与状态筛选刷新后不记忆；顶部搜索与筛选栏空间利用率低、视觉杂乱；缺少快捷保存/复用任务配置的能力，每次都要手动重建。这些问题叠加削弱了任务中心的可信度与效率，需要一次性收敛修复。

## What Changes

- 修复新任务显示旧「最后运行时间」：删除任务时同步清理其运行历史文件，并修正 `last_run` 回退逻辑——仅当 config 与 history 真实属于当前任务实例时才采用，杜绝同名/跨账号串读。
- 失败任务新增「行内可点击展开」的失败原因展示：在任务列表状态列/行上点击失败任务即展开 `last_run.message`、失败时间，并提供「查看历史日志」入口。
- 修复批量添加计划后编辑时间重复任务时加载失败：定位并修正编辑加载链路（URL 参数、`getSignTask` 解析、重复任务键），确保时间重复的同名任务可正常打开编辑。
- 排序与状态筛选持久化：`sortKey`、`sortDir`、`statusFilter` 写入 `localStorage`，刷新后恢复（搜索词不持久化）。
- 美化任务列表顶部搜索 + 筛选状态栏：改为单行紧凑布局，分组对齐、减少留白，与现有 glass-panel 视觉语言一致。
- 新增任务配置模板能力：可保存任务配置模板（chats、调度模式/时间、随机延迟、动作间隔），在创建页一键应用到所选账号；应用后任务仍可手动编辑再提交，不直接创建任务。

## Capabilities

### New Capabilities

- `task-center`: 任务中心的能力契约，覆盖任务列表展示（最后运行时间正确性、失败原因可查看）、任务编辑加载可靠性、列表排序与筛选的持久化记忆，以及任务配置模板的保存与一键应用。

### Modified Capabilities

（无——本仓库尚无现存 spec，`task-center` 作为新建 capability 首次建立其 requirements。）

## Impact

- 后端 `backend/services/sign_tasks.py`：`delete_task` 增加 history 清理；`_get_last_run_info` 收敛回退条件，避免同名/跨账号串读；`get_task` 返回值与编辑加载链路一致性修正。
- 后端 `backend/api/routes/sign_tasks.py`：任务配置模板的存取 API（列表/保存/删除/应用），以及必要时的编辑加载错误信息完善。
- 前端 `frontend/app/dashboard/sign-tasks/page.tsx`：失败原因行内展开、筛选栏单行紧凑美化、排序/筛选 localStorage 持久化、模板保存与应用入口。
- 前端 `frontend/app/dashboard/sign-tasks/create/page.tsx`：一键应用任务配置模板，应用后保留手动编辑能力。
- 前端 `frontend/lib/api.ts`：新增模板相关 API 客户端方法与类型。
- 前端 `frontend/context/LanguageContext.tsx`：新增模板、失败原因等中英文案 key。
- 数据/存储：任务配置模板的持久化位置（与 signs/history 同 workdir 下的独立目录），不涉及数据库 schema 变更。
