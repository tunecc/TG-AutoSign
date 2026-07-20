# 任务中心列表：调度时间 / 最后运行 / 账号可排序

**日期：** 2026-07-20  
**状态：** 已批准  
**范围：** 任务中心（`/dashboard/sign-tasks`）任务列表前端排序

## 1. 背景与问题

### 1.1 现象

任务中心任务较多时，用户需要按「调度时间」或「最后运行时间」查看顺序（从早到晚 / 从晚到早），目前列表无表头排序交互，只能依赖后端固定的账号序。

### 1.2 现状（源码对照）

| 位置 | 现状 |
|------|------|
| `frontend/app/dashboard/sign-tasks/page.tsx` | 全量拉取任务；支持搜索、账号筛选、状态筛选；表格 / 卡片视图；**无排序 state / UI** |
| `filteredTasks` `useMemo` | 仅过滤，不过排序 |
| 后端 `SignTaskService.list_tasks` | 缓存列表固定 `sorted(..., key=(account_name, name))` |
| 调度展示 | 固定：`sign_at`；范围：`range_start - range_end` |
| 最后运行展示 | `last_run.time`（可为空） |
| `account-tasks` | 单账号卡片列表；本次**不改** |

### 1.3 目标

| 目标 | 成功标准 |
|------|----------|
| 可按调度时间排序 | 点击表头或筛选栏选择「调度时间」，升序从早到晚、降序从晚到早 |
| 可按最后运行排序 | 同上；无运行记录的任务始终沉底 |
| 范围调度用开始时间 | `execution_mode === "range"` 时排序键为 `range_start` |
| 默认保持账号序 | 初始 / 刷新后为账号升序，与现后端一致 |
| 双视图一致 | 表格与卡片共用同一排序结果 |
| 范围可控 | 仅任务中心；不改 API / 后端 / 账号任务页 |

### 1.4 范围

**In**

- 任务中心前端排序 state（会话内）
- 过滤后客户端稳定排序
- 表格三列表头可点：账号、调度时间、最后运行
- 筛选栏排序字段选择器 + 方向切换（表格 / 卡片共用）
- 必要 i18n 文案

**Out**

- 账号任务页（`account-tasks`）
- 后端 `list_tasks` 排序参数 / API query
- localStorage / URL 持久化排序
- 按任务名、Chat、状态等其它列排序
- 分页（当前仍为全量列表）

## 2. 方案选择

| 方案 | 描述 | 结论 |
|------|------|------|
| **A. 纯前端排序（采用）** | 在 `filteredTasks` 过滤后再 `sort`；筛选栏 + 表头双入口 | **推荐**：改动面最小，与现全量列表匹配 |
| B. 后端排序 API | `GET /sign-tasks?sort_by=&order=` | 否：当前无分页，YAGNI |
| C. URL query 持久排序 | 前端排序 + `?sort=&dir=` | 否：用户选择会话内即可，且筛选未上 URL |

## 3. 状态模型

仅改 `frontend/app/dashboard/sign-tasks/page.tsx`（+ i18n 键）。

```ts
type SortKey = "account" | "schedule" | "last_run";
type SortDir = "asc" | "desc";

// 默认与后端 list_tasks 一致
const [sortKey, setSortKey] = useState<SortKey>("account");
const [sortDir, setSortDir] = useState<SortDir>("asc");
```

**数据流：**

```
tasks (API 全量)
  → 账号筛选 / 状态筛选 / 搜索   // 现有
  → 按 sortKey + sortDir 排序      // 新增
  → filteredTasks → 表格 & 卡片共用
```

**交互约定：**

| 操作 | 结果 |
|------|------|
| 点击 / 选择**新列** | `sortKey` 切换，`sortDir` 重置为 `asc` |
| 再点 / 切换**当前列**方向 | `asc` ↔ `desc` |
| 表头与筛选栏 | 共用同一 state，双向同步 |
| 刷新页面 | 回到默认 `account` + `asc` |
| 持久化 | 不写 localStorage，不进 URL |

## 4. 排序规则

### 4.1 主排序键

| sortKey | 取值 | 比较 |
|---------|------|------|
| `account` | `task.account_name` | 字符串 `localeCompare`（建议 `sensitivity: "base"`） |
| `schedule` | 见 4.2 | 字符串字典序（时间串可比较） |
| `last_run` | `task.last_run?.time` | ISO / 可解析时间字符串比较 |

### 4.2 调度时间键

```ts
function scheduleKey(task: SignTask): string {
  if (task.execution_mode === "range" && task.range_start) {
    return task.range_start;
  }
  return task.sign_at || "";
}
```

- 固定模式：用 `sign_at`
- 范围模式：用 **开始时间** `range_start`（不用 `range_end`）
- 若 `range` 但缺 `range_start`：回退 `sign_at`，再空则按空值规则

### 4.3 方向

- `asc`：从早到晚 / A→Z
- `desc`：从晚到早 / Z→A

### 4.4 空值

| 字段 | 规则 |
|------|------|
| `last_run` 缺失或无 `time` | **无论 asc/desc 均沉底** |
| `schedule` 主值为空串 | 无论 asc/desc 均沉底 |
| `account_name` 为空 | 无论 asc/desc 均沉底（兜底） |

空值比较优先于方向：先分「有值 / 无值」，有值之间再按 `sortDir` 比较。

### 4.5 次级键（稳定排序 / 防跳动）

主值相等时依次：

1. `account_name`（若当前主键不是 `account`）
2. `name`

保证同键多任务顺序可预期，表格 / 卡片切换不乱跳。

### 4.6 比较器伪代码

```ts
function compareTasks(a: SignTask, b: SignTask, key: SortKey, dir: SortDir): number {
  const av = primaryValue(a, key);
  const bv = primaryValue(b, key);
  const aEmpty = !av;
  const bEmpty = !bv;
  if (aEmpty && bEmpty) return tieBreak(a, b, key);
  if (aEmpty) return 1;   // 空值沉底
  if (bEmpty) return -1;
  const cmp = compareNonEmpty(av, bv, key); // 字符串或时间
  const ordered = dir === "asc" ? cmp : -cmp;
  return ordered !== 0 ? ordered : tieBreak(a, b, key);
}
```

## 5. UI

### 5.1 筛选栏排序控件

位置：现有筛选区（搜索 / 账号 / 状态旁），表格与卡片均可见。

推荐形态（与现有 `select` 风格一致）：

- **字段**下拉：`账号` / `调度时间` / `最后运行`
- **方向** toggle 按钮（或小下拉）：升序 / 降序
- 切换字段时方向重置为 `asc`（与表头「点新列」一致）

文案走 `LanguageContext` 中英键（示例键名，实现时可微调）：

- `sort_by` / `sort_account` / `sort_schedule` / `sort_last_run`
- `sort_asc` / `sort_desc`（或图标 `CaretUp` / `CaretDown` + title）

### 5.2 表格表头

| 列 | 可排序 | 指示 |
|----|--------|------|
| 账号 | 是 | 当前列显示 ↑/↓ |
| 任务名 | 否 | — |
| Chat ID | 否 | — |
| 调度时间 | 是 | 当前列显示 ↑/↓ |
| 最后运行 | 是 | 当前列显示 ↑/↓ |
| 状态 | 否 | — |
| 操作 | 否 | — |

视觉：

- 可排序表头为可点击控件（`button` 或等价），`cursor-pointer`，hover 略亮
- **仅当前排序列**显示方向箭头（`CaretUp` / `CaretDown` 等）
- 非当前可排序列不显示箭头（保持干净）

点击逻辑同第 3 节：新列 → key + `asc`；同列 → 翻转 dir。

### 5.3 卡片视图

- 无表头；顺序 = 同一 `filteredTasks`
- 改排序仅通过筛选栏控件（与表头 state 同步）

## 6. 错误处理与边界

| 场景 | 行为 |
|------|------|
| 任务列表为空 / 筛选无匹配 | 无额外 UI；现有空态不变 |
| 全员无 `last_run` 且按最后运行排 | 全员「空」→ 仅次级键（账号、任务名）定序 |
| 范围任务缺 `range_start` | 回退 `sign_at`，再空则沉底 |
| 筛选条件变化 | 保留当前 `sortKey` / `sortDir`，对新过滤结果重排 |
| 切换表格 / 卡片 | 排序 state 不变，结果一致 |
| 刷新 / 重进页面 | 默认账号升序 |

## 7. 测试要点

| # | 场景 | 期望 |
|---|------|------|
| 1 | 默认进入 | 按账号升序（与改前观感一致） |
| 2 | 点「调度时间」 | 按调度键升序；范围任务用 `range_start` |
| 3 | 再点「调度时间」 | 变为降序 |
| 4 | 点「最后运行」升序 | 有记录从早到晚；无记录全部在底 |
| 5 | 「最后运行」降序 | 有记录从晚到早；无记录仍在底 |
| 6 | 筛选栏改字段 / 方向 | 列表与表头指示同步 |
| 7 | 表头改排序 | 筛选栏显示同步 |
| 8 | 切卡片视图 | 顺序与表格一致 |
| 9 | 刷新 | 回到账号升序 |
| 10 | 搜索 / 账号 / 状态筛选 + 排序 | 先过滤再排序，结果正确 |

## 8. 实现落点（指导实现计划，非本阶段编码）

| 文件 | 变更 |
|------|------|
| `frontend/app/dashboard/sign-tasks/page.tsx` | 增加 sort state；扩展 `filteredTasks`；表头可点；筛选栏控件 |
| `frontend/context/LanguageContext.tsx` | 排序相关中英文案 |

可选：将 `scheduleKey` / `compareTasks` 抽到同文件顶部纯函数或 `frontend/lib/` 小工具，便于单测；**不强制**，保持与页面现有风格一致即可。

## 9. 非目标重申

- 不改后端缓存排序语义（API 仍可返回账号序；前端展示序独立）
- 不做分页服务端排序
- 不改 `account-tasks`
- 不引入新依赖
