# 任务新建/编辑：全页统一，删除老版整任务弹窗

**日期：** 2026-07-11  
**状态：** 已批准  
**范围：** 签到任务「新建 / 编辑」前端信息架构与入口统一

## 1. 背景与问题

### 1.1 现象

用户在账号任务页编辑任务时，仍可能看到（或期望消灭）老版整任务弹窗形态：窄弹窗（如 `!max-w-xl`）、任务级「动作间隔(毫秒)」、同窗内嵌搜会话与动作序列，与近期「新版」体验不一致。

### 1.2 现状（源码对照）

| 入口 | 现状 | 说明 |
|------|------|------|
| 任务中心「新建」→ `/dashboard/sign-tasks/create` | 独立全页 | 多账号 + 错峰；多聊天列表 + 新版「配置目标聊天」大弹窗（固定/随机时分秒） |
| 账号任务「+」/「编辑」 | `AccountTasksContent.tsx` 内整任务 modal（约 `!max-w-2xl`） | 已支持多聊天列表 + 嵌套新版聊天配置弹窗，但**外壳仍是弹窗**，与创建全页两套 UI |
| 任务中心「编辑」 | 仅跳转 `account-tasks?name=` | 需再点编辑，多一次跳转 |
| 数据层 | 多聊天 + `action_interval_*` 已落地 | 见 `2026-07-11-task-center-multi-chat-random-interval-design.md` |

近期提交（如 `7ce9def`、`6653144`、`dd996b2`）主要强化了**创建页**与**聊天配置弹窗**；账号任务的「整任务 create/edit 弹窗」未升级为同级全页。既有设计文档中方案 B（独立编辑页对齐创建页）曾标为后续可选，本次立项落地。

### 1.3 目标

| 目标 | 成功标准 |
|------|----------|
| 单一新建/编辑体验 | 新建与编辑均为任务中心级**全页**，交互与新版聊天配置一致 |
| 删除老路径 | 账号任务页不再出现整任务 create/edit 弹窗；无任务级裸毫秒间隔老布局 |
| 入口直达 | 任务中心「编辑」直达编辑全页；账号任务「+ / 编辑」跳全页 |
| 来源回跳 | 从哪进（任务中心 / 账号任务）取消或保存后回到哪 |
| 能力不回退 | 创建页多账号 + 错峰保留；多聊天与 interval 读写完整 |

### 1.4 范围

**In**

- 新建全页：`/dashboard/sign-tasks/create`（增强 query：`account`、`from`）
- 编辑全页：新建 `/dashboard/sign-tasks/edit?account=&name=`（可选 `from`）
- 任务中心列表「编辑」直达 edit 全页
- 账号任务「+ / 编辑」改为跳转全页；**删除**整任务 create/edit 弹窗及相关 state/handler
- 抽取并统一「目标聊天列表 + 配置目标聊天」新版 UI，避免 create/edit/账号页三处分叉
- 保存/取消按 `from` 回跳

**Out**

- 不改执行层 / 配置数据模型（多聊天、interval 已有）
- 不做「一次编辑同步多个账号上同名任务」
- 不重做导入/导出/历史日志弹窗
- 不顺手大改任务中心列表其它 UI
- 不新建每动作独立间隔等新能力

## 2. 方案选择

| 方案 | 描述 | 结论 |
|------|------|------|
| A. 账号任务弹窗对齐创建页能力，仍用 modal | 改动小，仍双 UI | 否：用户明确要求全页，且要删老版 |
| **B. 独立编辑路由 + 共享表单块（采用）** | create 保留；edit 新页；抽聊天配置；删账号任务整任务弹窗 | **推荐** |
| C. 仅 query 复用 create 页（`?edit=`） | 单文件更简单，URL 语义弱、create 分支膨胀 | 否：用户选择独立 edit 路由 |

**实现路径细化（B 内）：** 共享「目标聊天列表 + 配置目标聊天弹窗 + 调度字段」；create / edit 两个 page 编排；edit **单账号**；create 保留多账号 + 错峰。

## 3. 信息架构与路由

### 3.1 路由表

| 路径 | 模式 | 说明 |
|------|------|------|
| `/dashboard/sign-tasks/create` | 新建 | 现有全页；可 `?account=` 预选；可 `?from=` 记来源 |
| `/dashboard/sign-tasks/edit` | 编辑 | **新页**；必填 `account` + `name`；可选 `from` |
| `/dashboard/sign-tasks` | 任务中心 | 「编辑」→ edit 全页 |
| `/dashboard/account-tasks?name=` | 账号任务 | 列表 / 运行 / 导入导出 / 历史；**无**整任务 create/edit 弹窗 |

### 3.2 Query 约定

**create**

| 参数 | 必填 | 含义 |
|------|------|------|
| `account` | 否 | 预选并勾选该账号 |
| `from` | 否 | `sign-tasks` \| `account-tasks` |

**edit**

| 参数 | 必填 | 含义 |
|------|------|------|
| `account` | 是 | 所属账号 |
| `name` | 是 | 任务名（原始名，用于 load / update） |
| `from` | 否 | `sign-tasks` \| `account-tasks` |

- edit 非法/缺失必填参数：toast + 回合理默认页（有 `from` 用 from，否则任务中心）。
- `from` 非法值：视为缺省，回任务中心。

### 3.3 入口 → 目标

| 入口 | 跳转 |
|------|------|
| 任务中心「新建」 | `/dashboard/sign-tasks/create?from=sign-tasks` |
| 任务中心列表「编辑」 | `/dashboard/sign-tasks/edit?account=…&name=…&from=sign-tasks` |
| 账号任务「+」 | `/dashboard/sign-tasks/create?account={当前账号}&from=account-tasks` |
| 账号任务卡片「编辑」 | `/dashboard/sign-tasks/edit?account=…&name=…&from=account-tasks` |

任务中心列表「编辑」**不再**仅跳转账号任务页；若仍保留「进入该账号任务列表」的其它入口可不动。

### 3.4 返回策略

- 取消 / 保存成功：
  - `from=account-tasks` → `/dashboard/account-tasks?name={account}`
  - `from=sign-tasks` 或缺省 → `/dashboard/sign-tasks`
- **不以** `router.back()` 作为主路径（避免历史栈乱）；明确 `router.push` 目标页。
- 编辑改名成功后：返回链接仍用账号维度；列表以服务端最新名为准。

### 3.5 页面关系

```text
共享块
  ├─ TargetChatList          目标聊天列表：展示 / 添加 / 删除 / 打开配置
  ├─ ConfigureTargetChatModal  新版大弹窗：会话选择、delete_after、固定/随机时分秒、动作序列
  └─ TaskScheduleFields（可选抽）  调度模式 + 时间控件

页面
  ├─ CreateSignTaskPage  多账号 + 错峰 + createSignTask API + 上述共享块
  └─ EditSignTaskPage    单账号只读展示 + load/update + 上述共享块
```

## 4. 编辑页行为

1. **载入**  
   使用 `account` + `name` 拉取任务（`getSignTask` 优先；若接口语义不足可用 `listSignTasks(account)` 再按 name 匹配）。失败：toast + 按 `from` 回退。

2. **可编辑字段**（与创建页任务本体对齐）  
   - 任务名（允许改名，走现有 `updateSignTask` 的 `name`）  
   - 调度：`execution_mode` fixed / range、对应时间、`random_seconds` / `sign_interval` 等与创建页一致的字段  
   - 目标聊天完整 `chats[]`：增删改；点进新版「配置目标聊天」大弹窗  

3. **账号**  
   编辑页**只读展示**所属账号；不可切换账号；无多账号勾选 / 错峰（create 专用）。

4. **提交**  
   ```text
   updateSignTask(token, originalName, {
     name, sign_at, chats: chats.map(normalizeChatInterval),
     execution_mode, range_start, range_end, random_seconds, …
   }, account)
   ```  
   - 始终提交**完整** `chats[]`，禁止 `chats[0]` 截断。  
   - 成功 toast + 按 `from` 回跳。

5. **校验**  
   与创建一致：至少一个聊天、动作合法、interval `min ≤ max` 等；失败 toast，不跳转。

## 5. 创建页调整

- 保留：多账号勾选、错峰 `stagger`、批量 `createSignTask`。
- 新增：读取 `account` 预选；读取 `from` 控制取消/成功回跳。
- 聊天相关 UI 改为共享组件；行为与字段不变。
- 任务中心进入时默认 `from=sign-tasks`。

## 6. 账号任务页删除范围

### 6.1 删除

- `showCreateDialog` / `showEditDialog` 及仅服务整任务弹窗的 state（如任务级 `newTask` / `editTask` 表单等）
- 整任务 modal JSX（当前 create/edit 共用外壳）
- `handleCreateTask` / `handleSaveEdit` / `openCreateDialog` / `handleEditTask` 中仅服务弹窗的逻辑

### 6.2 改入口

- 「+」→ `router.push(/dashboard/sign-tasks/create?account=…&from=account-tasks)`
- 卡片「编辑」→ `router.push(/dashboard/sign-tasks/edit?account=…&name=…&from=account-tasks)`

### 6.3 保留

- 任务列表、运行、复制/粘贴导入、批量删除、历史日志等非「整任务表单」能力
- 若 `editingChat` 及聊天配置 modal **仅**被整任务弹窗使用：随弹窗删除，聊天编辑只存在于 create/edit 全页共享 modal
- 抽共享后删除本地重复实现，**不留**第二套聊天配置 UI

### 6.4 其它清理

- `frontend/app/dashboard/sign-tasks/page.tsx.backup` 等无用备份：实现阶段可删（计划中单列，避免误删）
- i18n：补 edit 页标题等；仅老弹窗使用的无引用 key 可顺手清理（非阻塞）

## 7. 组件与文件

| 层 | 文件 | 动作 |
|----|------|------|
| FE 新 | `frontend/app/dashboard/sign-tasks/edit/page.tsx` | 编辑全页 |
| FE 新 | `frontend/components/sign-task-form/*`（路径可微调） | TargetChatList、ConfigureTargetChatModal 等共享 |
| FE 改 | `frontend/app/dashboard/sign-tasks/create/page.tsx` | 接入共享块 + `from`/`account` |
| FE 改 | `frontend/app/dashboard/sign-tasks/page.tsx` | 编辑入口直达 edit |
| FE 改 | `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx` | 删整任务弹窗；入口改跳转 |
| FE 改 | `frontend/context/LanguageContext.tsx` | edit 相关文案 |
| FE 既有 | `frontend/lib/duration.ts`、`frontend/lib/api.ts` | 复用 normalize 与 get/update API；无模型变更则可不改后端 |

**第一期实现弹性：** 若 create 与 modal 耦合过紧，允许 edit 先复制聊天块再抽公共；但**验收结束前**全仓任务表单路径只允许一套「配置目标聊天」UI。

## 8. 错误处理

| 场景 | 行为 |
|------|------|
| edit 缺 `account` / `name` | toast → 按 `from` 回退（无则任务中心） |
| 任务不存在 / 拉取失败 | toast → 同上 |
| `ACCOUNT_SESSION_INVALID` | 沿用现有：提示并 `replace` 仪表盘 |
| 校验失败（无聊天、动作非法、min>max） | toast，留在当前页 |
| 保存 API 失败 | toast 带错误信息，不跳转 |
| 创建多账号部分失败 | 保持 create 现有「部分成功 + 错误列表」语义 |
| 配置聊天弹窗未点确认 | 不写入列表；关弹窗丢弃草稿 |

## 9. 风险与兼容

- **深链：** 书签到账号任务页仍可用；编辑改为跳全页，无后端兼容问题。
- **改名：** update 使用 `originalName` 定位；成功后列表以新名为准。
- **多聊天 / interval：** 只复用已有 `normalizeChatInterval` 与后端字段，不改 schema。
- **双 UI 回潮：** 删除账号任务整任务弹窗是硬要求；PR 验收检查无 `showCreateDialog`/`showEditDialog` 任务表单残留。

## 10. 验收标准

1. 账号任务「+」→ 创建全页且预选该账号；页面上**无**整任务 create modal。  
2. 账号任务「编辑」→ 编辑全页，载入完整 `chats[]` 与调度；**无**窄弹窗老布局（无任务级裸毫秒「动作间隔」同窗塞满）。  
3. 任务中心「编辑」→ 直接 edit 全页，不先强制进入账号任务页。  
4. 编辑保存后配置中多聊天与 interval 字段完整；再次编辑仍完整。  
5. `from=account-tasks` 取消/保存 → 回账号任务页；`from=sign-tasks` → 回任务中心。  
6. 创建页多账号 + 错峰能力不回退。  
7. 全仓任务表单路径只剩一套「配置目标聊天」大弹窗 UI。  
8. 账号任务页导入/导出/运行/历史仍可用。

## 11. 测试建议

- **手工主路径：** 任务中心新建 → 编辑；账号页新建 → 编辑；分别验证 `from` 回跳。  
- **回归：** 2+ 聊天任务编辑改名/改调度后 `chats` 不丢；固定/随机间隔展示与提交。  
- **边界：** 错误 query、不存在任务名、保存 400、会话失效。  
- **可选自动化：** duration/normalize 与提交 payload 断言沿用现有工具。

## 12. 实现顺序（供 writing-plans）

1. 抽取/对齐「配置目标聊天」+ 目标聊天列表共享块（或 edit 复制后立即收敛为单一实现）。  
2. 新增 `edit/page.tsx`：load / 表单 / save / return。  
3. create 接入 `from`、`account` 预选与回跳；改用共享块。  
4. 任务中心、账号任务入口改跳转。  
5. 删除账号任务整任务弹窗与死代码。  
6. i18n 与备份清理；按第 10 节验收清单走通。

## 13. 决策记录

| 决策点 | 选择 |
|--------|------|
| 目标形态 | 全页统一，删除老版整任务弹窗 |
| 编辑路由 | 独立 `/dashboard/sign-tasks/edit` |
| 回跳 | 按 `from` 来源（任务中心 / 账号任务） |
| 任务中心编辑 | 直达 edit 全页 |
| 编辑账号范围 | 单账号；不改多账号同名批改 |
| 数据/执行层 | 不改；复用既有 multi-chat + interval |

## 14. 相关文档

- `docs/superpowers/specs/2026-07-11-task-center-multi-chat-random-interval-design.md`（多聊天修复、弹窗放大、动作间隔）
