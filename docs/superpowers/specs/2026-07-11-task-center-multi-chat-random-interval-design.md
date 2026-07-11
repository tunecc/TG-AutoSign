# 任务中心：多目标聊天修复 + 配置弹窗放大 + 动作随机间隔

**日期：** 2026-07-11  
**状态：** 已批准  
**范围：** 签到任务中心创建/编辑/列表与执行层动作间隔

## 1. 背景与问题

用户在任务中心配置多个目标聊天时，保存后往往只剩一个；配置目标聊天的弹窗偏小；动作序列间隔只能填固定毫秒，无法按「上一个动作完成后，在随机时间内执行下一个」配置，且缺少时/分/秒输入。

### 1.1 根因

1. **多聊天丢失（真 bug）**  
   - 创建页 `frontend/app/dashboard/sign-tasks/create/page.tsx` 正确维护并提交完整 `chats[]`。  
   - 任务中心「编辑」入口跳到账号任务页；`AccountTasksContent.tsx` 中 `handleEditTask` 只读取 `task.chats[0]`，`handleSaveEdit` 写回 `chats: [{ ...单个 }]`。  
   - 结果：只要编辑并保存，多聊天配置被截断为 1 个。

2. **展示误导**  
   - `sign-tasks/page.tsx` 与账号任务列表只展示 `task.chats[0]?.chat_id`。  
   - 即使磁盘上仍有多个聊天，界面也像「只有 1 个」。

3. **动作间隔能力不足**  
   - 聊天级仅有固定 `action_interval`（毫秒）。  
   - 执行层 `tg_signer/core.py` 在每个动作后 `asyncio.sleep(chat.action_interval / 1000)`，无随机区间，无时/分/秒 UI。

4. **配置弹窗偏小**  
   - 弹窗约 `max-w-5xl`，动作序列区域 `max-h-[260px]`，多动作时难用。

### 1.2 目标

| 目标 | 成功标准 |
|------|----------|
| 多目标聊天完整保留 | 创建、编辑、保存后 `config.json` 与 UI 均展示完整 `chats[]` |
| 列表可读 | 任务列表显示目标聊天数量（及摘要），不再仅显示首个 ID |
| 弹窗可用 | 配置弹窗明显加大，动作列表可滚动更多行 |
| 随机/固定间隔 | 聊天级支持固定或随机区间；时分秒输入；执行层按模式 sleep |

### 1.3 范围

**In**

- 修复多聊天完整读写（编辑流 + 列表展示）。
- 放大「配置目标聊天」弹窗（创建页；编辑流对齐）。
- 聊天级动作间隔：固定 / 随机 + 时分秒输入。
- 后端归一化、校验与执行层随机 sleep；旧配置兼容。

**Out**

- 每个动作独立间隔。
- 任务调度时刻（fixed/range 签到时间）改造。
- 新建独立 edit 路由（方案 B，后续可选）。

## 2. 方案选择

| 方案 | 描述 | 结论 |
|------|------|------|
| **A（采用）** | 最小修复多聊天截断 + 弹窗放大 + 聊天级固定/随机间隔 | 推荐：改动可控，对齐现有语义 |
| B | 新建独立编辑页对齐创建页 | 长期更好，本次不必 |
| C | 每动作独立随机间隔 | 与用户选择的聊天级不符，过重 |

## 3. 数据模型与兼容

### 3.1 聊天对象字段

配置仍为 `_version: 4`（字段扩展，不升版本）。聊天对象目标形态：

```json
{
  "chat_id": 123,
  "name": "example",
  "actions": [],
  "delete_after": null,
  "action_interval_mode": "fixed",
  "action_interval_ms": 1000,
  "action_interval_min_ms": 1000,
  "action_interval_max_ms": 5000,
  "action_interval": 1000
}
```

| 字段 | 含义 |
|------|------|
| `action_interval_mode` | `fixed` \| `random` |
| `action_interval_ms` | 固定模式间隔（毫秒） |
| `action_interval_min_ms` / `action_interval_max_ms` | 随机模式上下界（毫秒），要求 `min ≤ max`，`min ≥ 0` |
| `action_interval` | 兼容字段：fixed 时等于 `action_interval_ms`；random 时等于 `min_ms` |

### 3.2 向后兼容

- **读旧配置**：仅有 `action_interval` 且无 `mode` → 视为 `fixed`，`action_interval_ms = action_interval`（并沿用现有 v3→v4 秒转毫秒逻辑）。
- **写新配置**：写全字段；同时写 `action_interval`，避免旧读取路径失败。
- **不升 `_version`**：可选字段 + 归一化层即可。

### 3.3 校验规则

- `min_ms ≤ max_ms`；非法请求 API 返回 400。
- 数值为非负整数毫秒。
- 固定模式：`action_interval_ms ≥ 0`（0 = 不 sleep，允许即时连发）。
- UI 时/分/秒 → 内部统一毫秒；展示时再拆回时/分/秒。

### 3.4 类型与 API

- `frontend/lib/api.ts` 的 `SignTaskChat` 增加新字段。
- `backend/api/routes/sign_tasks.py` 的 `ChatConfig` 增加可选字段；创建/更新透传。
- `tg_signer.config.SignChatV4` 增加可选字段，默认行为与现有 `action_interval=1000` 兼容。

## 4. 执行层

位置：`tg_signer/core.py` 中每个 action 完成后的 sleep。

```text
if mode == random:
  delay_ms = random.randint(min_ms, max_ms)  # 保证 min≤max
else:
  delay_ms = action_interval_ms
if delay_ms > 0:
  log("动作间隔等待: {delay_ms}ms ({mode} ...)")
  await asyncio.sleep(delay_ms / 1000)
```

- 最后一个 action 后仍 sleep 一次（与现行为一致）。
- 日志需能区分 fixed / random，并在 random 时打印区间信息。

服务层扩展 `_normalize_chat_action_interval`：

1. 旧字段无 mode → fixed + ms。
2. random 校验 min/max。
3. 落盘写全字段 + 兼容 `action_interval`。

## 5. 前端交互

### 5.1 多聊天修复

**`AccountTasksContent.tsx`**

- 编辑/创建态改为与创建页一致的目标聊天列表（展示全部 `chats`、添加弹窗、删除；建议支持点进再编辑）。
- `handleEditTask` 载入完整 `chats[]`，禁止 `chats[0]`。
- `handleSaveEdit` / 创建提交完整 `chats[]`。
- 创建弹窗同步为多聊天，避免再写入单聊天数据。

**`sign-tasks/page.tsx`**

- 列表展示「N 个目标」或首个名称 + `+N`，不再仅 `chats[0].chat_id`。

**`create/page.tsx`**

- 追加聊天改用函数式更新：`setChats(prev => [...prev, chat])`。
- 列表项建议补「编辑」入口（当前偏「只能删」）。
- 弹窗尺寸与间隔 UI 按 5.2 / 5.3 升级。

### 5.2 配置弹窗尺寸

- 宽度：`max-w-5xl` → `max-w-6xl` 或 `w-[min(96vw,72rem)]`。
- 动作序列高度：`max-h-[260px]` → `max-h-[min(50vh,420px)]`。
- 小屏接近全屏（减小外层 padding）。
- 创建页与账号任务编辑弹窗尺寸一致。

### 5.3 动作间隔 UI（聊天级）

替换原单一毫秒输入：

```text
动作间隔
○ 固定    ○ 随机区间

[固定]  [时] [分] [秒]

[随机]
  最短  [时] [分] [秒]
  最长  [时] [分] [秒]
  说明：上一个动作结束后，在此区间内随机等待再执行下一个
```

- 默认：固定，`0时 0分 1秒`（1000ms）。
- 切换模式保留已填数值。
- 校验失败时 toast，不关闭弹窗。
- 聊天列表摘要：固定 `间隔: 1s` / 随机 `间隔: 1s ~ 5s`（人话，非裸毫秒）。

### 5.4 共享工具

建议 `frontend/lib/duration.ts`：

- `hmsToMs` / `msToHms` / `formatDuration`
- `normalizeChatInterval(chat)` 做旧字段兼容

创建页与账号任务编辑共用，避免两套规则。

## 6. 错误处理

| 场景 | 行为 |
|------|------|
| 前端 min > max / 非法时分秒 | toast，不提交 |
| API 非法 interval | 400 + 明确 detail |
| 旧配置无新字段 | 归一化为 fixed，默认 1000ms（或沿用旧值） |
| 编辑未改聊天直接保存 | 完整 `chats[]` 回写，不截断 |
| delay_ms = 0 | 不 sleep |

## 7. 主要改动文件

| 层 | 文件 |
|----|------|
| FE | `frontend/app/dashboard/sign-tasks/create/page.tsx` |
| FE | `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx` |
| FE | `frontend/app/dashboard/sign-tasks/page.tsx` |
| FE | `frontend/lib/api.ts`，可选 `frontend/lib/duration.ts` |
| FE | `frontend/context/LanguageContext.tsx`（i18n 文案） |
| BE | `backend/api/routes/sign_tasks.py` |
| BE | `backend/services/sign_tasks.py`（normalize） |
| Core | `tg_signer/config.py`、`tg_signer/core.py` |

## 8. 验收标准

1. **多聊天创建**：创建页添加 2+ 聊天 → 部署 → `config.json` 含完整 `chats` 数组。  
2. **多聊天编辑不丢**：账号任务编辑可见全部聊天；改调度/名称后保存，`chats` 数量与内容不丢。  
3. **列表展示**：任务中心显示「N 个目标」类摘要，而非仅首个 Chat ID。  
4. **固定间隔**：UI 设 0 分 5 秒 → 落盘约 5000ms → 日志出现 `动作间隔等待: 5000ms (fixed)`。  
5. **随机间隔**：min 1s、max 3s → 多次执行 delay 落在 [1000, 3000]。  
6. **旧任务兼容**：仅有 `action_interval: 1000` 的任务仍可运行与编辑。  
7. **弹窗**：配置弹窗明显更大，动作列表可展示/滚动更多行。

## 9. 测试建议

- 前端：多聊天 add/save/edit 状态与提交 payload 单元或集成断言。  
- 后端：normalize 旧/新字段用例；非法 min/max → 400。  
- 执行层：对 random 路径 mock `random.randint` 或断言 sleep 调用参数在区间内。  
- 手工：按第 8 节验收清单走通创建 → 列表 → 编辑 → 运行日志。

## 10. 实现备注

- 决策优先级：可测试性 > 可读性 > 一致性 > 简洁性 > 可逆转性。  
- 不扩大到每动作间隔、不新建 edit 路由，除非后续单独立项。  
- 下一步：`writing-plans` 产出可执行实现计划后再改代码。
