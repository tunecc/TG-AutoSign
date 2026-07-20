# 任务中心列表排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在任务中心（`/dashboard/sign-tasks`）为账号 / 调度时间 / 最后运行增加客户端排序：表头可点 + 筛选栏选择器，表格与卡片共用结果；默认账号升序；范围调度用 `range_start`；无 `last_run` 恒沉底。

**Architecture:** 抽出纯排序函数到 `frontend/lib/task-list-sort.ts`，用 Node assert 单测锁规则；`sign-tasks/page.tsx` 增加会话内 `sortKey`/`sortDir`，在现有 `filteredTasks` 过滤后排序；筛选栏与表头共用 state，卡片视图只消费同一列表。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、Phosphor icons、无前端测试框架（纯函数用 `node --experimental-strip-types` + `node:assert/strict`；UI 用 `npm run build` + 手工验收）。

**Spec:** `docs/superpowers/specs/2026-07-20-task-center-list-sort-design.md`

## Global Constraints

- 仅改任务中心前端；**不改**后端 `list_tasks`、API、`account-tasks`。
- 不写 localStorage / URL 持久化排序。
- 空值（无 `last_run.time`、空调度、空账号）**无论 asc/desc 均沉底**。
- 范围模式排序键 = `range_start`；缺则回退 `sign_at`。
- 默认 `sortKey="account"` + `sortDir="asc"`（与后端 `(account_name, name)` 观感一致）。
- 点击**新列** → 切 key 且 dir 重置为 `asc`；再点**当前列** → 翻转 dir。
- `docs/` 被 `.gitignore`：计划文档提交用 `git add -f`。
- 决策优先级：可测试性 > 可读性 > 一致性 > 简洁性 > 可逆转性。
- 不引入新依赖。

---

## File Map

| 路径 | 职责 |
|------|------|
| `frontend/lib/task-list-sort.ts` | **新建**：`SortKey`/`SortDir`、`scheduleKey`、`nextSortState`、`sortSignTasks` |
| `frontend/lib/task-list-sort.test.mjs` | **新建**：Node assert 覆盖排序规则 |
| `frontend/app/dashboard/sign-tasks/page.tsx` | 接入 sort state、扩展 `filteredTasks`、筛选栏控件、可点表头 |
| `frontend/context/LanguageContext.tsx` | **不强制改**；本页筛选区既有文案多为 `language === "zh"` 内联，排序控件跟随同模式以保持一致 |

---

### Task 1: 排序纯函数 + Node 单测

**Files:**
- Create: `frontend/lib/task-list-sort.ts`
- Create: `frontend/lib/task-list-sort.test.mjs`

**Interfaces:**
- Produces:
  - `export type SortKey = "account" | "schedule" | "last_run"`
  - `export type SortDir = "asc" | "desc"`
  - `export type SortableSignTask = { name: string; account_name: string; sign_at: string; execution_mode?: "fixed" | "range"; range_start?: string; last_run?: { time: string } | null }`
  - `export function scheduleKey(task: SortableSignTask): string`
  - `export function nextSortState(currentKey: SortKey, currentDir: SortDir, clickedKey: SortKey): { sortKey: SortKey; sortDir: SortDir }`
  - `export function sortSignTasks<T extends SortableSignTask>(tasks: T[], key: SortKey, dir: SortDir): T[]`（返回**新数组**，不 mutate 入参）

- [ ] **Step 1: Write the failing test file**

创建 `frontend/lib/task-list-sort.test.mjs`：

```javascript
import assert from "node:assert/strict";
import {
  scheduleKey,
  nextSortState,
  sortSignTasks,
} from "./task-list-sort.ts";

// --- scheduleKey ---
assert.equal(
  scheduleKey({ name: "a", account_name: "x", sign_at: "09:00" }),
  "09:00"
);
assert.equal(
  scheduleKey({
    name: "a",
    account_name: "x",
    sign_at: "09:00",
    execution_mode: "range",
    range_start: "08:30",
  }),
  "08:30"
);
assert.equal(
  scheduleKey({
    name: "a",
    account_name: "x",
    sign_at: "09:00",
    execution_mode: "range",
  }),
  "09:00"
);

// --- nextSortState ---
assert.deepEqual(nextSortState("account", "asc", "schedule"), {
  sortKey: "schedule",
  sortDir: "asc",
});
assert.deepEqual(nextSortState("schedule", "asc", "schedule"), {
  sortKey: "schedule",
  sortDir: "desc",
});
assert.deepEqual(nextSortState("schedule", "desc", "schedule"), {
  sortKey: "schedule",
  sortDir: "asc",
});
assert.deepEqual(nextSortState("last_run", "desc", "account"), {
  sortKey: "account",
  sortDir: "asc",
});

// --- fixtures ---
const tasks = [
  {
    name: "t2",
    account_name: "bob",
    sign_at: "10:00",
    last_run: { time: "2026-07-01T12:00:00Z" },
  },
  {
    name: "t1",
    account_name: "alice",
    sign_at: "08:00",
    last_run: { time: "2026-07-02T12:00:00Z" },
  },
  {
    name: "t3",
    account_name: "alice",
    sign_at: "09:00",
    execution_mode: "range",
    range_start: "07:00",
    last_run: null,
  },
  {
    name: "t0",
    account_name: "carol",
    sign_at: "11:00",
    // no last_run
  },
];

// default account asc: alice, alice, bob, carol; tie-break by name
{
  const sorted = sortSignTasks(tasks, "account", "asc").map(
    (t) => `${t.account_name}:${t.name}`
  );
  assert.deepEqual(sorted, ["alice:t1", "alice:t3", "bob:t2", "carol:t0"]);
}

// account desc — primary desc; tie-break name always asc (t1 before t3)
{
  const sorted = sortSignTasks(tasks, "account", "desc").map(
    (t) => `${t.account_name}:${t.name}`
  );
  assert.deepEqual(sorted, ["carol:t0", "bob:t2", "alice:t1", "alice:t3"]);
}

// schedule asc: range uses range_start 07:00, then 08:00, 10:00, 11:00
{
  const sorted = sortSignTasks(tasks, "schedule", "asc").map((t) => t.name);
  assert.deepEqual(sorted, ["t3", "t1", "t2", "t0"]);
}

// schedule desc
{
  const sorted = sortSignTasks(tasks, "schedule", "desc").map((t) => t.name);
  assert.deepEqual(sorted, ["t0", "t2", "t1", "t3"]);
}

// last_run asc: early first; missing last_run always at bottom (t3, t0)
{
  const sorted = sortSignTasks(tasks, "last_run", "asc").map((t) => t.name);
  assert.equal(sorted[0], "t2"); // 07-01
  assert.equal(sorted[1], "t1"); // 07-02
  // bottoms: t3 and t0, order by account then name
  assert.deepEqual(sorted.slice(2).sort(), ["t0", "t3"].sort());
  assert.ok(sorted.indexOf("t3") >= 2);
  assert.ok(sorted.indexOf("t0") >= 2);
}

// last_run desc: late first; missing still bottom
{
  const sorted = sortSignTasks(tasks, "last_run", "desc").map((t) => t.name);
  assert.equal(sorted[0], "t1");
  assert.equal(sorted[1], "t2");
  assert.ok(sorted.indexOf("t3") >= 2);
  assert.ok(sorted.indexOf("t0") >= 2);
}

// does not mutate input
{
  const copy = tasks.map((t) => ({ ...t }));
  sortSignTasks(tasks, "schedule", "desc");
  assert.deepEqual(
    tasks.map((t) => t.name),
    copy.map((t) => t.name)
  );
}

console.log("task-list-sort: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend && node --experimental-strip-types lib/task-list-sort.test.mjs
```

Expected: FAIL（模块不存在或导出缺失），例如 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: Write minimal implementation**

创建 `frontend/lib/task-list-sort.ts`：

```typescript
export type SortKey = "account" | "schedule" | "last_run";
export type SortDir = "asc" | "desc";

export type SortableSignTask = {
  name: string;
  account_name: string;
  sign_at: string;
  execution_mode?: "fixed" | "range";
  range_start?: string;
  last_run?: { time: string } | null;
};

export function scheduleKey(task: SortableSignTask): string {
  if (task.execution_mode === "range" && task.range_start) {
    return task.range_start;
  }
  return task.sign_at || "";
}

export function nextSortState(
  currentKey: SortKey,
  currentDir: SortDir,
  clickedKey: SortKey
): { sortKey: SortKey; sortDir: SortDir } {
  if (clickedKey !== currentKey) {
    return { sortKey: clickedKey, sortDir: "asc" };
  }
  return {
    sortKey: currentKey,
    sortDir: currentDir === "asc" ? "desc" : "asc",
  };
}

function primaryValue(task: SortableSignTask, key: SortKey): string {
  if (key === "account") return task.account_name || "";
  if (key === "schedule") return scheduleKey(task);
  return task.last_run?.time || "";
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function tieBreak(a: SortableSignTask, b: SortableSignTask, key: SortKey): number {
  if (key !== "account") {
    const byAccount = compareStrings(a.account_name || "", b.account_name || "");
    if (byAccount !== 0) return byAccount;
  }
  return compareStrings(a.name || "", b.name || "");
}

function compareTasks(
  a: SortableSignTask,
  b: SortableSignTask,
  key: SortKey,
  dir: SortDir
): number {
  const av = primaryValue(a, key);
  const bv = primaryValue(b, key);
  const aEmpty = !av;
  const bEmpty = !bv;
  if (aEmpty && bEmpty) return tieBreak(a, b, key);
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  const cmp = compareStrings(av, bv);
  const ordered = dir === "asc" ? cmp : -cmp;
  return ordered !== 0 ? ordered : tieBreak(a, b, key);
}

export function sortSignTasks<T extends SortableSignTask>(
  tasks: T[],
  key: SortKey,
  dir: SortDir
): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, key, dir));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd frontend && node --experimental-strip-types lib/task-list-sort.test.mjs
```

Expected: stdout 含 `task-list-sort: all assertions passed`，exit code 0。

若 `account desc` 在 alice 两条上的 name 序与断言不一致（`t3`/`t1`），以 **tie-break 始终按 name 升序** 为准，修正测试期望为实现行为，**不要**再引入 dir 影响次级键。

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/task-list-sort.ts frontend/lib/task-list-sort.test.mjs
git commit -m "$(cat <<'EOF'
feat(frontend): pure helpers for task center list sort

Add scheduleKey, nextSortState, and sortSignTasks with node assert coverage
for account/schedule/last_run rules (range uses range_start; empty last_run sinks).
EOF
)"
```

---

### Task 2: 接入页面 state + filteredTasks 排序

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx`

**Interfaces:**
- Consumes: `SortKey`, `SortDir`, `nextSortState`, `sortSignTasks` from `../../../lib/task-list-sort`
- Produces: page state `sortKey` / `sortDir`；`filteredTasks` 为过滤后再排序的结果

- [ ] **Step 1: Add imports and state**

在 `page.tsx` 顶部 import 区增加：

```typescript
import {
    SortKey,
    SortDir,
    nextSortState,
    sortSignTasks,
} from "../../../lib/task-list-sort";
```

在现有 state 声明附近（约 `statusFilter` 后）增加：

```typescript
const [sortKey, setSortKey] = useState<SortKey>("account");
const [sortDir, setSortDir] = useState<SortDir>("asc");
```

增加点击处理（可放在 `filteredTasks` 之前）：

```typescript
const handleSortClick = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
        const next = nextSortState(prevKey, sortDir, key);
        setSortDir(next.sortDir);
        return next.sortKey;
    });
}, [sortDir]);
```

注意：`nextSortState` 依赖**点击瞬间**的 `sortKey`+`sortDir`。上面写法用 functional `setSortKey` 时 `sortDir` 可能闭包陈旧。更稳妥的实现：

```typescript
const handleSortClick = useCallback((key: SortKey) => {
    setSortKey((prevKey) => {
        // 用 ref 或合并为一次 set：见下方推荐
        return prevKey;
    });
}, []);
```

**推荐实现（避免双 setState 竞态）：**

```typescript
const handleSortClick = useCallback((clickedKey: SortKey) => {
    setSortKey((prevKey) => {
        setSortDir((prevDir) => nextSortState(prevKey, prevDir, clickedKey).sortDir);
        return nextSortState(prevKey, /* need prevDir */ "asc", clickedKey).sortKey;
    });
}, []);
```

这仍有问题。用单一 handler + 当前 state 依赖即可（React 18 同事件批处理足够）：

```typescript
const handleSortClick = useCallback((clickedKey: SortKey) => {
    const next = nextSortState(sortKey, sortDir, clickedKey);
    setSortKey(next.sortKey);
    setSortDir(next.sortDir);
}, [sortKey, sortDir]);
```

筛选栏字段切换也走同一函数；方向 toggle 单独：

```typescript
const handleSortDirToggle = useCallback(() => {
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
}, []);

const handleSortKeyChange = useCallback((key: SortKey) => {
    // 字段下拉：新列重置 asc；同列保持（下拉选当前项无操作）
    setSortKey((prev) => {
        if (prev === key) return prev;
        setSortDir("asc");
        return key;
    });
}, []);
```

更干净：字段下拉始终 `setSortKey(key); if (key !== sortKey) setSortDir("asc")`：

```typescript
const handleSortKeyChange = useCallback((key: SortKey) => {
    if (key === sortKey) return;
    setSortKey(key);
    setSortDir("asc");
}, [sortKey]);
```

- [ ] **Step 2: Extend filteredTasks to sort after filter**

将现有 `filteredTasks` `useMemo` 改为：

```typescript
const filteredTasks = useMemo(() => {
    const filtered = tasks.filter(task => {
        // 账号筛选
        if (selectedAccounts.length > 0 && !selectedAccounts.includes(task.account_name)) {
            return false;
        }
        // 状态筛选
        if (statusFilter !== "all") {
            if (statusFilter === "not_run" && task.last_run) return false;
            if (statusFilter === "success" && (!task.last_run || !task.last_run.success)) return false;
            if (statusFilter === "failed" && (!task.last_run || task.last_run.success)) return false;
        }
        // 搜索筛选
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            const matchName = task.name.toLowerCase().includes(query);
            const matchChatId = task.chats.some(chat => String(chat.chat_id).includes(query));
            const matchAccount = task.account_name.toLowerCase().includes(query);
            return matchName || matchChatId || matchAccount;
        }
        return true;
    });
    return sortSignTasks(filtered, sortKey, sortDir);
}, [tasks, selectedAccounts, statusFilter, searchQuery, sortKey, sortDir]);
```

- [ ] **Step 3: Smoke-check types**

Run:

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -40
```

Expected: 无与 `task-list-sort` / `page.tsx` 相关的新增类型错误（既有错误可忽略但需记录）。若 `SignTask` 不满足 `SortableSignTask`，检查 `last_run` 形状是否兼容（只需有可选 `time`）。

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat(sign-tasks): wire client sort into filtered task list

Session-only sortKey/sortDir default to account asc; filter then sortSignTasks
so table and card views share one ordered list.
EOF
)"
```

---

### Task 3: 筛选栏排序控件 + 可点表头

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx`（筛选栏 + `<thead>`）

**Interfaces:**
- Consumes: `sortKey`, `sortDir`, `handleSortClick`, `handleSortKeyChange`, `handleSortDirToggle`
- Produces: 用户可见的排序 UI（筛选栏 + 三列表头指示）

- [ ] **Step 1: Import sort direction icons**

在 `@phosphor-icons/react` import 中增加 `CaretUp`, `CaretDown`（若已有 `CaretLeft` 可同包导入）。

- [ ] **Step 2: Add filter-bar sort controls**

在筛选栏 `select` 账号筛选之后、关闭 `flex` 容器前（约 `accounts.length > 1` 的 `select` 之后），插入：

```tsx
<select
    value={sortKey}
    onChange={(e) => handleSortKeyChange(e.target.value as SortKey)}
    className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/10 transition-all"
    title={language === "zh" ? "排序字段" : "Sort by"}
>
    <option value="account">{language === "zh" ? "账号" : "Account"}</option>
    <option value="schedule">{language === "zh" ? "调度时间" : "Schedule"}</option>
    <option value="last_run">{language === "zh" ? "最后运行" : "Last Run"}</option>
</select>
<button
    type="button"
    onClick={handleSortDirToggle}
    className="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-bold hover:bg-white/10 transition-all inline-flex items-center gap-1"
    title={sortDir === "asc"
        ? (language === "zh" ? "升序（点击切换为降序）" : "Ascending (click for descending)")
        : (language === "zh" ? "降序（点击切换为升序）" : "Descending (click for ascending)")}
>
    {sortDir === "asc" ? <CaretUp weight="bold" size={12} /> : <CaretDown weight="bold" size={12} />}
    <span>{sortDir === "asc"
        ? (language === "zh" ? "升序" : "Asc")
        : (language === "zh" ? "降序" : "Desc")}</span>
</button>
```

文案与邻接筛选控件一致，使用 `language === "zh"` 内联（本页既有模式），**不强制**改 `LanguageContext`。

- [ ] **Step 3: Make table headers sortable**

将账号 / 调度时间 / 最后运行三列 `<th>` 改为可点按钮，仅当前列显示箭头。抽出小 helper（可放组件内）：

```tsx
const renderSortableHeader = (key: SortKey, labelZh: string, labelEn: string) => {
    const active = sortKey === key;
    return (
        <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-main/60">
            <button
                type="button"
                onClick={() => handleSortClick(key)}
                className={`inline-flex items-center gap-1 hover:text-main transition-colors ${active ? "text-[#b57dff]" : ""}`}
            >
                <span>{language === "zh" ? labelZh : labelEn}</span>
                {active && (sortDir === "asc"
                    ? <CaretUp weight="bold" size={12} />
                    : <CaretDown weight="bold" size={12} />)}
            </button>
        </th>
    );
};
```

替换：

```tsx
{/* was: <th>...账号...</th> */}
{renderSortableHeader("account", "账号", "Account")}
<th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-main/60">{language === "zh" ? "任务名" : "Task"}</th>
<th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-main/60">Chat ID</th>
{renderSortableHeader("schedule", "调度时间", "Schedule")}
{renderSortableHeader("last_run", "最后运行", "Last Run")}
<th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-main/60">{language === "zh" ? "状态" : "Status"}</th>
<th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-main/60">{language === "zh" ? "操作" : "Actions"}</th>
```

- [ ] **Step 4: Build verify**

Run:

```bash
cd frontend && npm run build
```

Expected: build 成功（exit 0）。若仅有与本改动无关的既有 warning，可继续。

- [ ] **Step 5: Manual checklist（开发者本地）**

在 `npm run dev` 下打开 `/dashboard/sign-tasks`，逐项勾选：

| # | 操作 | 期望 |
|---|------|------|
| 1 | 默认进入 | 账号升序；账号列表头有 ↑ |
| 2 | 点「调度时间」表头 | 按调度升序；范围任务按 `range_start`；表头与筛选栏同步 |
| 3 | 再点「调度时间」 | 降序 |
| 4 | 点「最后运行」 | 有记录按时间；无记录沉底 |
| 5 | 最后运行降序 | 有记录从晚到早；无记录仍沉底 |
| 6 | 筛选栏改字段 | 列表与表头同步，新字段为升序 |
| 7 | 筛选栏点升/降序 | 仅翻转方向 |
| 8 | 切卡片视图 | 顺序与表格一致 |
| 9 | 刷新页面 | 回到账号升序 |
| 10 | 搜索 + 排序 | 先过滤再排序 |

- [ ] **Step 6: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat(sign-tasks): sortable headers and filter-bar sort controls

Account / schedule / last run columns and a shared filter-bar control drive
the same session sort state for table and card views.
EOF
)"
```

---

### Task 4: 回归纯测 + 最终确认

**Files:**
- 无新文件（验证既有）

- [ ] **Step 1: Re-run pure tests**

```bash
cd frontend && node --experimental-strip-types lib/task-list-sort.test.mjs
```

Expected: `task-list-sort: all assertions passed`

- [ ] **Step 2: Confirm git status**

```bash
git status --short
git log --oneline -5
```

Expected: 工作区干净（或仅有无关本地文件）；最近提交含 Task 1–3 的 sort 相关 commit。

- [ ] **Step 3: Done**

无需再 commit。若手工清单有失败项，回到对应 Task 修，不要在本 Task 扩 scope。

---

## Spec Coverage Self-Review

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 可按调度时间 / 最后运行 / 账号排序 | Task 1 + 2 + 3 |
| 范围用 `range_start` | Task 1 `scheduleKey` |
| 无 last_run 恒沉底 | Task 1 比较器 + 测试 |
| 默认账号升序 | Task 2 初始 state |
| 表头点击 + 筛选栏双入口 | Task 3 |
| 表格 / 卡片共用 | Task 2 `filteredTasks` |
| 会话内、刷新回默认 | Task 2 无持久化 |
| 不改后端 / account-tasks | Global Constraints + 无对应文件 |
| 次级键稳定 | Task 1 `tieBreak` |
| 测试要点 1–10 | Task 1 单测 + Task 3 手工清单 |

## Placeholder / Consistency Scan

- 无 TBD / TODO
- 类型名全程 `SortKey` / `SortDir` / `sortSignTasks` / `nextSortState` / `scheduleKey`
- 空值规则与 spec 4.4 一致（恒沉底）
- 新列 → `asc` 在 `nextSortState` 与 `handleSortKeyChange` 两处一致
