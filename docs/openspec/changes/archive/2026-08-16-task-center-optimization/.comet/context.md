# Comet Design Handoff

- Change: task-center-optimization
- Phase: design
- Mode: compact
- Context hash: eb01f30527f83cdd79b6dd80606e4884cec3bff85ed85b2c546533311f8d1994

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/task-center-optimization/proposal.md

- Source: docs/openspec/changes/task-center-optimization/proposal.md
- Lines: 1-32
- SHA256: 79051dc39c74b3121d0dacb468fa647f09a3d5d83d2ba3c121f28b7fa41119f6

```md
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

```

## docs/openspec/changes/task-center-optimization/design.md

- Source: docs/openspec/changes/task-center-optimization/design.md
- Lines: 1-96
- SHA256: 10fed89bb18af9b23c93e9cc0980cd929c4761ff98a0ab0ab466d4c50aa537f4

[TRUNCATED]

```md
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

```

Full source: docs/openspec/changes/task-center-optimization/design.md

## docs/openspec/changes/task-center-optimization/tasks.md

- Source: docs/openspec/changes/task-center-optimization/tasks.md
- Lines: 1-53
- SHA256: 29700282cb3957c879bf144ade9043ff228c5ade31c3c5f70519f046d5e8746a

```md
## 1. 后端：删除任务清理 history

- [ ] 1.1 在 `SignTaskService.delete_task` 中，于 `shutil.rmtree(task_dir)` 后增加 history 清理：删除 `_history_file_path(task_name, real_account_name)` 与 legacy `run_history_dir / f"{_safe_history_key(task_name)}.json"`（best-effort，失败记日志不阻断）
- [ ] 1.2 收敛 `_get_last_run_info`：读取 history 最近一条时校验其 `account_name` 与当前 `account_name` 一致；legacy 单文件历史仅在无 account_name 时回退
- [ ] 1.3 为 delete_task 清理与 last_run 回退补单元测试（删除同名重建不显示旧 last_run、跨账号同名不串读）

## 2. 后端：任务配置模板 API

- [ ] 2.1 新增模板服务方法：列表/保存/删除，存储于 `<workdir>/task_templates/<name>.json`，模板字段 = name + chats + execution_mode + sign_at/range_start/range_end + random_seconds + sign_interval
- [ ] 2.2 模板名复用文件名安全校验（非法字符 `< > : " / \ | ? *`、空、`. ..` 拒绝）
- [ ] 2.3 新增路由：`GET /sign-task-templates`、`POST /sign-task-templates`、`DELETE /sign-task-templates/{name}`，挂到 sign_tasks 路由或独立 router
- [ ] 2.4 为模板服务补测试（保存/列表/删除、同名覆盖、非法名拒绝）

## 3. 前端：失败原因行内展开

- [ ] 3.1 在 `sign-tasks/page.tsx` 任务列表表格视图与卡片视图中，使失败状态可点击，展开内联区域显示 `last_run.message` 与失败时间
- [ ] 3.2 展开区域内提供「查看历史日志」入口，复用 `handleShowTaskHistory`
- [ ] 3.3 成功/未运行状态点击不展开；交互为单展开（点击其他失败任务关闭前一个）
- [ ] 3.4 新增/补充中英文案 key（失败原因、查看历史日志等）

## 4. 前端：批量计划后编辑加载修复

- [ ] 4.1 复现并定位「批量添加计划后编辑时间重复任务加载失败」的真实触发点（检查 `loadedKeyRef`、StrictMode 双渲染、URL 参数解析、后端 404）
- [ ] 4.2 修复根因（按复现结果：时序/编码/错误处理之一）
- [ ] 4.3 在 `edit/page.tsx` `loadTask` 失败时区分 404 与其他错误，404 给明确提示并返回列表
- [ ] 4.4 验证批量创建（相同任务名、相同时间、多账号）后每个任务均可正常打开编辑

## 5. 前端：排序与状态筛选持久化

- [ ] 5.1 新增 `tg-signpulse:task-sort-key`、`tg-signpulse:task-sort-dir`、`tg-signpulse:task-status-filter` localStorage 读写
- [ ] 5.2 组件初始化读取恢复 `sortKey/sortDir/statusFilter`；`searchQuery` 不持久化
- [ ] 5.3 各 setter 变更时写入；`handleSortKeyChange`/`handleSortClick`/`handleSortDirToggle`/`setStatusFilter` 路径一致
- [ ] 5.4 验证刷新后恢复、搜索词刷新后清空

## 6. 前端：筛选栏单行紧凑美化

- [ ] 6.1 重构 `sign-tasks/page.tsx` 筛选栏为单行紧凑布局：搜索框 `flex-1` + 右侧状态/账号/排序字段/升降序切换分组
- [ ] 6.2 统一控件高度、间距、`flex-wrap` 窄屏换行，保持 glass-panel 风格
- [ ] 6.3 在表格视图与卡片视图下均表现正常，不破坏 selectionMode 批量操作栏

## 7. 前端：任务配置模板保存与一键应用

- [ ] 7.1 在 `lib/api.ts` 新增模板 API 客户端方法与类型（list/save/delete）
- [ ] 7.2 在 `create/page.tsx` 新增模板保存入口：将当前 chats/调度/延迟/间隔保存为命名模板
- [ ] 7.3 在 `create/page.tsx` 新增模板选择与应用：一键填充表单，应用后保留手动编辑能力，不自动创建任务
- [ ] 7.4 模板列表/删除入口；中英文案 key
- [ ] 7.5 验证保存→应用→手动改→提交链路，删除模板不影响已建任务

## 8. 验收与收尾

- [ ] 8.1 手动验收 6 项需求场景（删除重建、跨账号同名、失败展开、批量编辑、刷新记忆、模板应用）
- [ ] 8.2 运行后端测试与前端构建/类型检查
- [ ] 8.3 更新 CHANGELOG（如项目惯例要求）

```

## docs/openspec/changes/task-center-optimization/specs/task-center/spec.md

- Source: docs/openspec/changes/task-center-optimization/specs/task-center/spec.md
- Lines: 1-77
- SHA256: 026641df43093a620a4467d4e5fe1356beeb43e7342b02143a380e26ac728779

```md
## Purpose

任务中心是用户管理签到任务（创建、批量计划、编辑、查看运行结果）的统一入口。本能力定义任务列表数据正确性、失败原因可观测性、编辑加载可靠性、列表排序与筛选记忆，以及任务配置模板复用等行为契约。

## ADDED Requirements

### Requirement: 新任务不得显示历史运行记录

任务列表中任务的「最后运行时间 / 最后运行状态」必须反映该任务实例自身的真实运行历史。删除任务时，其运行历史文件必须同步清理；当任务的配置文件中未记录 `last_run` 时，回退读取历史文件不得跨任务实例或跨账号串读同名旧任务的历史。

#### Scenario: 删除任务后重建同名任务不显示旧运行记录
- **WHEN** 用户删除账号 A 下的任务 T（曾运行过），随后在账号 A 下重新创建同名任务 T 且尚未运行
- **THEN** 任务列表中任务 T 的最后运行时间显示为「未运行」，最后运行状态显示为「未运行」，不显示旧任务的运行时间或成功/失败状态

#### Scenario: 跨账号同名任务互不串读历史
- **WHEN** 账号 A 与账号 B 各自存在同名任务 T，仅账号 A 的任务 T 运行过
- **THEN** 账号 B 的任务 T 显示「未运行」，不显示账号 A 的任务 T 的运行时间或状态

### Requirement: 失败任务可查看失败原因

任务列表中处于失败状态的任务 SHALL 提供可点击的失败原因入口，展示该任务最后一次失败的消息（`last_run.message`）与失败时间，并提供跳转到该任务历史日志的入口。成功与未运行状态不受此影响。

#### Scenario: 点击失败任务展开失败原因
- **WHEN** 任务列表中某任务状态为失败，用户点击该任务行的失败状态
- **THEN** 展开显示最后一次失败的时间与失败消息文本，并提供「查看历史日志」入口

#### Scenario: 成功或未运行任务不触发失败展开
- **WHEN** 用户点击状态为成功或未运行的任务行
- **THEN** 不展开失败原因区域

### Requirement: 批量计划后任务可正常编辑加载

通过任务中心批量添加计划创建的任务（含多个账号使用相同任务名、相同触发时间的情况），在任务列表中点击编辑 SHALL 能正常加载该任务配置，不出现「加载任务失败」。编辑加载链路 SHALL 能正确解析账号与任务名参数并定位到对应任务实例。

#### Scenario: 批量创建时间重复的同名任务后可编辑
- **WHEN** 用户批量添加计划，多个账号使用相同任务名与相同触发时间，随后在任务列表点击其中任一任务的编辑
- **THEN** 该任务的编辑页正常加载其配置（任务名、调度、chats 等），不报加载失败

#### Scenario: 任务不存在时给出明确错误
- **WHEN** 用户打开编辑页但对应账号下不存在该任务
- **THEN** 提示加载任务失败并返回任务列表，不卡在加载态

### Requirement: 列表排序与状态筛选在刷新后保持

任务列表的排序字段、排序方向与状态筛选 SHALL 持久化到浏览器本地存储，刷新页面或重新进入任务中心时恢复用户上次的选择。搜索词不持久化。

#### Scenario: 刷新页面后恢复排序与筛选
- **WHEN** 用户将排序设为「调度时间 / 降序」、状态筛选设为「失败」，然后刷新页面
- **THEN** 刷新后排序仍为「调度时间 / 降序」、状态筛选仍为「失败」

#### Scenario: 搜索词刷新后清空
- **WHEN** 用户在搜索框输入关键词筛选任务，然后刷新页面
- **THEN** 刷新后搜索框为空，列表不按旧搜索词过滤

### Requirement: 任务列表筛选栏布局紧凑

任务列表顶部的搜索框与筛选状态栏 SHALL 以单行紧凑布局呈现，控件分组对齐、减少多余留白，并与应用现有玻璃面板视觉风格一致，在窄屏下可自适应换行。

#### Scenario: 筛选栏单行紧凑呈现
- **WHEN** 任务列表至少有一个任务且未进入批量选择模式
- **THEN** 搜索框与状态/账号/排序控件在同一行内分组排列，整体高度紧凑、视觉风格与 glass-panel 一致

### Requirement: 任务配置模板可保存与一键应用

用户 SHALL 能将任务配置保存为模板，模板至少包含目标会话列表（chats，含动作）、调度模式与时间、随机延迟、动作间隔。在创建任务页 SHALL 能选择已保存模板一键应用其配置，应用后任务仍可手动编辑再提交，不直接创建任务。

#### Scenario: 保存任务配置模板
- **WHEN** 用户在创建任务页填写了 chats、调度模式与时间、随机延迟、动作间隔后，选择保存为模板并命名
- **THEN** 该模板被持久化保存，可在模板列表中看到并再次选用

#### Scenario: 一键应用模板后仍可编辑
- **WHEN** 用户在创建任务页选择一个已保存模板并应用
- **THEN** 表单被填充为模板内容，用户可继续修改任意字段后再提交创建，不自动创建任务

#### Scenario: 删除模板不影响已创建任务
- **WHEN** 用户删除一个任务配置模板
- **THEN** 模板从列表移除；已通过该模板创建的任务不受影响

```
