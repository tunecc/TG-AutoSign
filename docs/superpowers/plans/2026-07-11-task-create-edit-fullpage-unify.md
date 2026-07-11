# 任务新建/编辑全页统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将签到任务「新建 / 编辑」统一为任务中心级全页；删除账号任务页整任务 create/edit 弹窗；任务中心编辑直达编辑全页；保存/取消按 `from` 回跳。

**Architecture:** 抽出纯导航 helper + 共享「目标聊天列表 / 配置目标聊天弹窗」组件；保留 `create/page.tsx` 多账号错峰；新增 `edit/page.tsx` 单账号 load/update；账号任务与任务中心只改入口跳转并删除第二套整任务表单。

**Tech Stack:** Next.js 14 App Router、React 18、TypeScript、Phosphor icons、既有 `frontend/lib/api.ts` / `duration.ts`、无前端单测框架（纯函数用 Node assert；UI 用 `npm run build` + 手工验收）。

**Spec:** `docs/superpowers/specs/2026-07-11-task-create-edit-fullpage-unify-design.md`

## Global Constraints

- 不改后端数据模型 / 执行层；复用 `normalizeChatInterval`、`getSignTask`、`updateSignTask`、`createSignTask`。
- 编辑页**单账号**；不做多账号同名批改。
- 始终提交完整 `chats[]`，禁止 `chats[0]` 截断。
- 回跳**不用** `router.back()` 作主路径；用 `router.push(resolveTaskFormReturnPath(...))`。
- `from` 仅允许 `sign-tasks` | `account-tasks`；非法或缺失 → 回 `/dashboard/sign-tasks`。
- 验收结束前全仓任务表单路径只允许**一套**「配置目标聊天」大弹窗 UI。
- `docs/` 被 `.gitignore`：计划/设计文档提交用 `git add -f`。
- 决策优先级：可测试性 > 可读性 > 一致性 > 简洁性 > 可逆转性。

---

## File Map

| 路径 | 职责 |
|------|------|
| `frontend/lib/task-form-nav.ts` | **新建**：`from` 解析、回跳 path、create/edit URL 构造（纯函数） |
| `frontend/lib/task-form-nav.test.mjs` | **新建**：Node assert 覆盖 nav 纯函数 |
| `frontend/components/sign-task-form/types.ts` | **新建**：`EditingChatDraft`、`ActionTypeOption` |
| `frontend/components/sign-task-form/actionUtils.ts` | **新建**：`DICE_OPTIONS`、`toActionTypeOption`、`isActionValid` |
| `frontend/components/sign-task-form/TargetChatList.tsx` | **新建**：目标聊天列表 UI |
| `frontend/components/sign-task-form/ConfigureTargetChatModal.tsx` | **新建**：新版大弹窗（从 create 迁出） |
| `frontend/app/dashboard/sign-tasks/create/page.tsx` | 接入共享组件 + `account`/`from` query + 回跳 |
| `frontend/app/dashboard/sign-tasks/edit/page.tsx` | **新建**：编辑全页 |
| `frontend/app/dashboard/sign-tasks/page.tsx` | 编辑 Link 改直达 edit 全页 |
| `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx` | 删整任务弹窗；+ / 编辑改跳转 |
| `frontend/context/LanguageContext.tsx` | edit 页标题等文案 |
| `frontend/app/dashboard/sign-tasks/page.tsx.backup` | **删除**（无用备份） |

---

### Task 1: 导航纯函数 + Node 单测

**Files:**
- Create: `frontend/lib/task-form-nav.ts`
- Create: `frontend/lib/task-form-nav.test.mjs`

**Interfaces:**
- Produces:
  - `export type TaskFormFrom = "sign-tasks" | "account-tasks"`
  - `export function parseTaskFormFrom(raw: string | null | undefined): TaskFormFrom | null`
  - `export function resolveTaskFormReturnPath(from: TaskFormFrom | null | undefined, account?: string | null): string`
  - `export function buildCreateTaskPath(opts: { account?: string | null; from?: TaskFormFrom | null }): string`
  - `export function buildEditTaskPath(opts: { account: string; name: string; from?: TaskFormFrom | null }): string`

- [ ] **Step 1: Write the failing test file**

创建 `frontend/lib/task-form-nav.test.mjs`：

```javascript
import assert from "node:assert/strict";
import {
  parseTaskFormFrom,
  resolveTaskFormReturnPath,
  buildCreateTaskPath,
  buildEditTaskPath,
} from "./task-form-nav.ts";

assert.equal(parseTaskFormFrom("sign-tasks"), "sign-tasks");
assert.equal(parseTaskFormFrom("account-tasks"), "account-tasks");
assert.equal(parseTaskFormFrom("nope"), null);
assert.equal(parseTaskFormFrom(null), null);

assert.equal(resolveTaskFormReturnPath("sign-tasks"), "/dashboard/sign-tasks");
assert.equal(resolveTaskFormReturnPath(null), "/dashboard/sign-tasks");
assert.equal(
  resolveTaskFormReturnPath("account-tasks", "alice"),
  "/dashboard/account-tasks?name=alice"
);
assert.equal(
  resolveTaskFormReturnPath("account-tasks", ""),
  "/dashboard/sign-tasks"
);

assert.equal(
  buildCreateTaskPath({ from: "sign-tasks" }),
  "/dashboard/sign-tasks/create?from=sign-tasks"
);
assert.equal(
  buildCreateTaskPath({ account: "alice", from: "account-tasks" }),
  "/dashboard/sign-tasks/create?account=alice&from=account-tasks"
);
assert.equal(
  buildEditTaskPath({ account: "alice", name: "每日签到", from: "sign-tasks" }),
  "/dashboard/sign-tasks/edit?account=alice&name=%E6%AF%8F%E6%97%A5%E7%AD%BE%E5%88%B0&from=sign-tasks"
);

console.log("task-form-nav tests passed");
```

> 若 Node 无法直接 import `.ts`，改为实现文件同时提供逻辑清晰的 `.ts`，测试改为复制断言到内联纯 JS 实现文件 `task-form-nav.mjs` 再 re-export，**或**用下面 Step 3 的纯 `.ts` + 将 test 改为动态 import 失败时改用 `npx --yes tsx frontend/lib/task-form-nav.test.mjs`。优先：实现为 `.ts`，测试用 `npx --yes tsx` 运行。

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd frontend && npx --yes tsx lib/task-form-nav.test.mjs
```

Expected: module not found / cannot find `./task-form-nav.ts`

- [ ] **Step 3: Implement `frontend/lib/task-form-nav.ts`**

```typescript
export type TaskFormFrom = "sign-tasks" | "account-tasks";

export function parseTaskFormFrom(
  raw: string | null | undefined
): TaskFormFrom | null {
  if (raw === "sign-tasks" || raw === "account-tasks") return raw;
  return null;
}

export function resolveTaskFormReturnPath(
  from: TaskFormFrom | null | undefined,
  account?: string | null
): string {
  if (from === "account-tasks") {
    const name = (account || "").trim();
    if (name) {
      return `/dashboard/account-tasks?name=${encodeURIComponent(name)}`;
    }
  }
  return "/dashboard/sign-tasks";
}

export function buildCreateTaskPath(opts: {
  account?: string | null;
  from?: TaskFormFrom | null;
}): string {
  const params = new URLSearchParams();
  const account = (opts.account || "").trim();
  if (account) params.set("account", account);
  if (opts.from === "sign-tasks" || opts.from === "account-tasks") {
    params.set("from", opts.from);
  }
  const q = params.toString();
  return q
    ? `/dashboard/sign-tasks/create?${q}`
    : "/dashboard/sign-tasks/create";
}

export function buildEditTaskPath(opts: {
  account: string;
  name: string;
  from?: TaskFormFrom | null;
}): string {
  const params = new URLSearchParams();
  params.set("account", opts.account);
  params.set("name", opts.name);
  if (opts.from === "sign-tasks" || opts.from === "account-tasks") {
    params.set("from", opts.from);
  }
  return `/dashboard/sign-tasks/edit?${params.toString()}`;
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd frontend && npx --yes tsx lib/task-form-nav.test.mjs
```

Expected: `task-form-nav tests passed`

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/task-form-nav.ts frontend/lib/task-form-nav.test.mjs
git commit -m "feat(frontend): task form navigation helpers"
```

---

### Task 2: 共享类型与动作工具

**Files:**
- Create: `frontend/components/sign-task-form/types.ts`
- Create: `frontend/components/sign-task-form/actionUtils.ts`

**Interfaces:**
- Produces:
  - `export type ActionTypeOption = "1" | "2" | "3" | "ai_vision" | "ai_logic"`
  - `export type EditingChatDraft = { chat_id: number; name: string; manual_chat_id: string; actions: any[]; delete_after?: number; action_interval: number; action_interval_mode: "fixed" | "random"; action_interval_ms: number; action_interval_min_ms: number; action_interval_max_ms: number; editIndex?: number }`
  - `export const DICE_OPTIONS: readonly string[]`
  - `export function toActionTypeOption(action: any): ActionTypeOption`
  - `export function isActionValid(action: any): boolean`
  - `export function createEmptyEditingChat(): EditingChatDraft`  // 默认 1 条发文本动作、fixed 1000ms

- [ ] **Step 1: Create types**

`frontend/components/sign-task-form/types.ts`：

```typescript
export type ActionTypeOption = "1" | "2" | "3" | "ai_vision" | "ai_logic";

export type EditingChatDraft = {
  chat_id: number;
  name: string;
  manual_chat_id: string;
  actions: any[];
  delete_after?: number;
  action_interval: number;
  action_interval_mode: "fixed" | "random";
  action_interval_ms: number;
  action_interval_min_ms: number;
  action_interval_max_ms: number;
  editIndex?: number;
};
```

- [ ] **Step 2: Create actionUtils（逻辑与 create/page 现有一致）**

`frontend/components/sign-task-form/actionUtils.ts`：

```typescript
import type { ActionTypeOption, EditingChatDraft } from "./types";

export const DICE_OPTIONS = [
  "🎲",
  "🎯",
  "🏀",
  "⚽",
  "🎳",
  "🎰",
] as const;

export function toActionTypeOption(action: any): ActionTypeOption {
  const actionId = Number(action?.action);
  if (actionId === 1) return "1";
  if (actionId === 3) return "3";
  if (actionId === 2) return "2";
  if (actionId === 4 || actionId === 6) return "ai_vision";
  if (actionId === 5 || actionId === 7) return "ai_logic";
  return "1";
}

export function isActionValid(action: any): boolean {
  const actionId = Number(action?.action);
  if (actionId === 1 || actionId === 3) {
    return Boolean((action?.text || "").trim());
  }
  if (actionId === 2) {
    return Boolean((action?.dice || "").trim());
  }
  return [4, 5, 6, 7].includes(actionId);
}

export function createEmptyEditingChat(): EditingChatDraft {
  return {
    chat_id: 0,
    name: "",
    manual_chat_id: "",
    actions: [{ action: 1, text: "" }],
    action_interval: 1000,
    action_interval_mode: "fixed",
    action_interval_ms: 1000,
    action_interval_min_ms: 1000,
    action_interval_max_ms: 1000,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/sign-task-form/types.ts frontend/components/sign-task-form/actionUtils.ts
git commit -m "feat(frontend): shared sign-task form types and action utils"
```

---

### Task 3: TargetChatList 共享组件

**Files:**
- Create: `frontend/components/sign-task-form/TargetChatList.tsx`

**Interfaces:**
- Consumes: `SignTaskChat` from `frontend/lib/api`；`formatChatIntervalSummary`、`normalizeChatInterval` from `duration`；`useLanguage`
- Produces:
  - `export function TargetChatList(props: { chats: SignTaskChat[]; onAdd: () => void; onEdit: (chat: SignTaskChat, index: number) => void; onRemove: (index: number) => void }): JSX.Element`

- [ ] **Step 1: Implement TargetChatList**

从 `create/page.tsx` 约 753–823 行「Chat 配置」section 抽出列表本体（含空态、序号、interval 摘要、编辑/删除按钮）。保持相同 className 与 `t(...)` keys：

- 标题：`t("target_chat_config")` + `({chats.length})`
- 添加：`+ {t("add_chat")}`
- 空态：`t("no_target_chat")`
- 行：`chat.name`、`t("id_label")`、`t("actions_count")`、`t("action_interval")` + `formatChatIntervalSummary(chat)`、可选 `t("task_flow_delete_after")`
- 编辑按钮 `title={t("edit_chat")}` → `onEdit(chat, idx)`
- 删除 → `onRemove(idx)`

组件签名示例：

```tsx
"use client";

import { ChatCircleText, PencilSimple, Trash } from "@phosphor-icons/react";
import { SignTaskChat } from "../../lib/api";
import { formatChatIntervalSummary } from "../../lib/duration";
import { useLanguage } from "../../context/LanguageContext";

type Props = {
  chats: SignTaskChat[];
  onAdd: () => void;
  onEdit: (chat: SignTaskChat, index: number) => void;
  onRemove: (index: number) => void;
};

export function TargetChatList({ chats, onAdd, onEdit, onRemove }: Props) {
  const { t } = useLanguage();
  // ... 从 create/page 迁入 JSX，onClick 接 props
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/sign-task-form/TargetChatList.tsx
git commit -m "feat(frontend): shared TargetChatList for sign tasks"
```

---

### Task 4: ConfigureTargetChatModal 共享组件

**Files:**
- Create: `frontend/components/sign-task-form/ConfigureTargetChatModal.tsx`

**Interfaces:**
- Consumes: `EditingChatDraft`、`actionUtils`、`ChatInfo`、`duration` helpers、`useLanguage`
- Produces:
  - `export function ConfigureTargetChatModal(props: { draft: EditingChatDraft; availableChats: ChatInfo[]; chatSearch: string; chatSearchResults: ChatInfo[]; chatSearchLoading: boolean; loadingChats?: boolean; refreshingChats?: boolean; onChatSearchChange: (v: string) => void; onClearSearch: () => void; onRefreshChats: () => void; onChange: (next: EditingChatDraft) => void; onSave: () => void; onCancel: () => void }): JSX.Element | null`

行为要求（与现 create 弹窗一致）：

- 尺寸：`!w-[min(98vw,90rem)] !max-w-[min(98vw,90rem)] max-h-[calc(100vh-1rem)]`
- 搜索结果点击 → 更新 draft 的 `chat_id`/`name`/`manual_chat_id`，并 `onClearSearch`
- 列表 select / 手动 ID / delete_after / 固定·随机时分秒 / 动作序列增删改
- 确认按钮调用 `onSave`（校验留在父组件 `handleSaveChat`，与现逻辑一致）
- 取消 `onCancel`

- [ ] **Step 1: 从 create/page.tsx 834–1245 迁出弹窗 JSX 到 ConfigureTargetChatModal**

父组件保留的职责：

- `token`、账号会话失效、`loadChats` / `searchAccountChats` debounce
- `handleSaveChat`（校验 + `normalizeChatInterval` + 写回 `chats`）
- `editingChat` state

Modal 内用 `onChange` 更新 draft（不要自己 setState 父外字段）。

动作行更新示例：

```tsx
onChange({
  ...draft,
  actions: draft.actions.map((a, i) => (i === index ? updater(a) : a)),
});
```

或在 modal 内本地封装 `updateAction` 再 `onChange`。

- [ ] **Step 2: 视觉/交互对照**

对照 create 页现有弹窗：搜索、刷新列表、时分秒、AI 动作子模式、`max-h-[min(50vh,420px)]` 动作列表 — 全部保留。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/sign-task-form/ConfigureTargetChatModal.tsx
git commit -m "feat(frontend): shared ConfigureTargetChatModal"
```

---

### Task 5: create 页接入共享组件 + from/account 回跳

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/create/page.tsx`

**Interfaces:**
- Consumes: Task 1–4 exports；`useSearchParams` from `next/navigation`

- [ ] **Step 1: 读取 query**

```tsx
import { useRouter, useSearchParams } from "next/navigation";
import {
  parseTaskFormFrom,
  resolveTaskFormReturnPath,
} from "../../../../lib/task-form-nav";
import { TargetChatList } from "../../../../components/sign-task-form/TargetChatList";
import { ConfigureTargetChatModal } from "../../../../components/sign-task-form/ConfigureTargetChatModal";
import {
  createEmptyEditingChat,
  isActionValid,
  // 若仍本地用到 toActionTypeOption 则删，改由 modal 内部使用
} from "../../../../components/sign-task-form/actionUtils";
import type { EditingChatDraft } from "../../../../components/sign-task-form/types";
```

```tsx
const searchParams = useSearchParams();
const fromParam = parseTaskFormFrom(searchParams.get("from"));
const accountParam = (searchParams.get("account") || "").trim();
```

- [ ] **Step 2: 预选账号**

在 `loadAccounts` 成功后：

- 若 `accountParam` 匹配某账号名：
  - `setSelectedAccount(accountParam)`
  - `setAccountSchedules` 时：该账号 `selected: true`，其它默认 `false`（或仅保证该账号 selected，按产品：从账号页进入应至少勾选该账号）
  - `loadChats(token, accountParam)`
- 否则保持现有「默认第一项」行为

- [ ] **Step 3: 回跳**

替换 `handleCancel` 与创建成功跳转：

```tsx
const goBack = useCallback(() => {
  router.push(resolveTaskFormReturnPath(fromParam, accountParam || selectedAccount));
}, [router, fromParam, accountParam, selectedAccount]);

// handleCancel
const handleCancel = useCallback(() => {
  resetForm();
  goBack();
}, [resetForm, goBack]);

// handleSubmit 全成功分支（替换 window/router 写死 sign-tasks）
addToast(...);
setTimeout(() => goBack(), 1000);
```

删除 `window.location.href = "/dashboard/sign-tasks"`。

- [ ] **Step 4: 用 TargetChatList + ConfigureTargetChatModal 替换内联 JSX**

- `editingChat` 类型改为 `EditingChatDraft | null`
- `handleAddChat` → `setEditingChat(createEmptyEditingChat())`
- 列表：

```tsx
<TargetChatList
  chats={chats}
  onAdd={handleAddChat}
  onEdit={(chat, idx) => {
    const n = normalizeChatInterval(chat);
    setEditingChat({
      chat_id: chat.chat_id,
      name: chat.name,
      manual_chat_id: String(chat.chat_id),
      actions: chat.actions || [],
      delete_after: chat.delete_after,
      ...n,
      editIndex: idx,
    });
  }}
  onRemove={(idx) => setChats((prev) => prev.filter((_, i) => i !== idx))}
/>
```

- 弹窗：传入 draft、availableChats、搜索 state、handlers；`onSave={handleSaveChat}`；`onCancel={() => setEditingChat(null)}`

删除 create 页内重复的 `toActionTypeOption` / `DICE_OPTIONS` / 大段 modal JSX（若仅被 modal 使用）。

- [ ] **Step 5: 创建提交仍 normalize chats**

```tsx
chats: chats.map((c) => normalizeChatInterval(c)),
```

（若当前直接传 `chats`，改为 map normalize，与 edit 一致。）

- [ ] **Step 6: Build 检查**

```bash
cd frontend && npm run build
```

Expected: 编译成功（若 `useSearchParams` 需 Suspense，按 Next 14 要求包一层 `Suspense` 或在 page 导出时处理，与项目其它页一致）。

- [ ] **Step 7: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/create/page.tsx
git commit -m "refactor(create-task): shared chat UI and from/account return nav"
```

---

### Task 6: 新建 edit 全页

**Files:**
- Create: `frontend/app/dashboard/sign-tasks/edit/page.tsx`
- Modify: `frontend/context/LanguageContext.tsx`（若缺 key）

**Interfaces:**
- Consumes: `getSignTask`、`updateSignTask`、`getAccountChats`、`searchAccountChats`、shared components、nav helpers、duration
- Produces: 路由 `/dashboard/sign-tasks/edit`

- [ ] **Step 1: i18n keys**

在 `LanguageContext.tsx` 中英各加（若已有则复用）：

```text
"edit_task_page_title": "编辑任务" / "Edit Task"
"edit_task_page_desc": "修改调度与目标聊天配置" / "Update schedule and target chat config"
"account_readonly": "所属账号" / "Account"
"task_load_failed": "加载任务失败" / "Failed to load task"
"invalid_edit_params": "编辑参数无效" / "Invalid edit parameters"
```

复用已有：`edit_task`、`save_changes`、`task_name`、`scheduling_mode`、`update_success`、`update_failed`、`chat_required` 等。

- [ ] **Step 2: 实现 edit/page.tsx 骨架**

结构对齐 create（navbar + max-w-[900px] main + glass sections），但：

1. `useSearchParams`：`account`、`name`、`from`
2. 缺 `account` 或 `name` → toast `invalid_edit_params` → `router.replace(resolveTaskFormReturnPath(from, account))`
3. `getToken`；无 token → `/`
4. `getSignTask(token, name, account)` 载入：
   - `originalName = task.name`（update 定位用，state 固定到加载成功时的 name）
   - `taskName`、`executionMode`、`signAt`（若 fixed：尽量从 cron 解析为 `HH:mm`，解析失败则放 `"06:00"` 并保留原始 `sign_at` 在 ref 以便用户改回 fixed 时用 time 输入重写）
   - `rangeStart`/`rangeEnd`、`randomSeconds`、`signInterval`
   - `chats = (task.chats||[]).map(normalizeChatInterval)`
5. 账号只读展示 `account`（input disabled 或纯文本）
6. **单账号调度区**（无多账号表、无错峰）：
   - `execution_mode` select
   - fixed → `<input type="time">`（与 create 模板时间一致）
   - range → start/end time
   - 可选：`random_seconds` / `sign_interval` 若 create 有暴露且任务对象有字段则对齐；create 目前在提交里带 `random_seconds`/`sign_interval` 但 UI 主路径以账号表为准 — edit 页至少保证 `execution_mode` + 时间 + 完整 chats
7. `TargetChatList` + `ConfigureTargetChatModal` + 与 create 相同的 search/loadChats/`handleSaveChat` 模式（`selectedAccount` 固定为 query account）
8. 保存：

```tsx
const fixedCron =
  executionMode === "fixed" ? fixedTimeToCron(signAt) : "0 0 * * *";
if (executionMode === "fixed" && !fixedCron) {
  addToast(t("fixed_time_required"), "error");
  return;
}
if (chats.length === 0) {
  addToast(t("chat_required"), "error");
  return;
}
await updateSignTask(
  token,
  originalName,
  {
    name: taskName.trim() || originalName,
    sign_at: fixedCron,
    chats: chats.map((c) => normalizeChatInterval(c)),
    random_seconds: randomSeconds,
    sign_interval: signInterval,
    execution_mode: executionMode,
    range_start: rangeStart,
    range_end: rangeEnd,
  },
  account
);
addToast(t("update_success"), "success");
router.push(resolveTaskFormReturnPath(fromParam, account));
```

9. 取消：`router.push(resolveTaskFormReturnPath(fromParam, account))`
10. 顶栏面包屑：`t("sidebar_tasks") / t("edit_task")`；主按钮文案 `t("save_changes")`

**cron → time 解析**（edit 页内小函数，与 create 的 `fixedTimeToCron` 对称）：

```typescript
function cronToFixedTime(cron: string): string {
  // expect "0 M H * * *"
  const parts = (cron || "").trim().split(/\s+/);
  if (parts.length >= 3) {
    const minute = Number(parts[1]);
    const hour = Number(parts[2]);
    if (Number.isFinite(minute) && Number.isFinite(hour)) {
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }
  return "06:00";
}
```

- [ ] **Step 3: Build**

```bash
cd frontend && npm run build
```

Expected: 成功；`/dashboard/sign-tasks/edit` 在路由表中。

- [ ] **Step 4: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/edit/page.tsx frontend/context/LanguageContext.tsx
git commit -m "feat(sign-tasks): full-page edit route for tasks"
```

---

### Task 7: 任务中心编辑入口直达 edit 全页

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx`

- [ ] **Step 1: 改两处编辑 Link**（表格视图约 829 行、卡片视图约 955 行）

从：

```tsx
href={`/dashboard/account-tasks?name=${task.account_name}`}
```

改为（推荐用 helper，注意 encode）：

```tsx
import { buildEditTaskPath } from "../../../lib/task-form-nav";

// ...
href={buildEditTaskPath({
  account: task.account_name,
  name: task.name,
  from: "sign-tasks",
})}
```

`title` 仍可用 `t("edit")`。

- [ ] **Step 2: 新建按钮补 from**

将「新建」Link / `router.push("/dashboard/sign-tasks/create")` 改为：

```tsx
import { buildCreateTaskPath } from "../../../lib/task-form-nav";
// href={buildCreateTaskPath({ from: "sign-tasks" })}
// 或 router.push(buildCreateTaskPath({ from: "sign-tasks" }))
```

（约 637、709 行附近。）

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "fix(task-center): edit opens full-page editor; create passes from"
```

---

### Task 8: 账号任务页 — 改入口并删除整任务弹窗

**Files:**
- Modify: `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx`

**删除目标（硬要求）：**

- state：`showCreateDialog`、`showEditDialog`、`newTask`、`editTask`、`editingTaskName`、`originalTaskName`、以及**仅**服务于整任务弹窗的 `taskChats` / `editingChat` / chatSearch 若不再被其它 UI 使用
- handlers：`handleCreateTask`、`handleSaveEdit`、`openCreateDialog`、`handleEditTask`、`handleAddChat`/`handleSaveChat`/… 若只服务弹窗
- JSX：约 1285–1487 整任务 modal；约 1489–1897 嵌套聊天配置 modal（随共享组件迁移后不再本地保留）

**保留：** 列表 TaskItem、运行、复制/粘贴、批量删除、历史日志、导出。

- [ ] **Step 1: 改「+」与编辑入口**

```tsx
import { useRouter } from "next/navigation";
import {
  buildCreateTaskPath,
  buildEditTaskPath,
} from "../../../lib/task-form-nav";

// openCreate / Plus button:
router.push(
  buildCreateTaskPath({ account: accountName, from: "account-tasks" })
);

// TaskItem onEdit:
onEdit={(task) => {
  router.push(
    buildEditTaskPath({
      account: accountName,
      name: task.name,
      from: "account-tasks",
    })
  );
}}
```

空态点击新建同样 `router.push(buildCreateTaskPath(...))`。

- [ ] **Step 2: 删除整任务 modal 及相关 state/effects**

逐项删除后确保：

- 无 `showCreateDialog` / `showEditDialog` 字符串残留（`rg` 自检）
- 无任务级「动作间隔(毫秒)」老布局
- 文件仍能通过 TypeScript（去掉未用 import：`createSignTask`/`updateSignTask` 若不再本地调用可删；history/export 等保留）

- [ ] **Step 3: rg 自检**

```bash
rg -n "showCreateDialog|showEditDialog|handleCreateTask|handleSaveEdit|openCreateDialog" frontend/app/dashboard/account-tasks/AccountTasksContent.tsx
```

Expected: 无匹配

```bash
rg -n "ConfigureTargetChatModal|editingChat" frontend/app/dashboard/account-tasks/AccountTasksContent.tsx
```

Expected: 无匹配（聊天配置只在 create/edit 全页）

- [ ] **Step 4: Build**

```bash
cd frontend && npm run build
```

Expected: 成功

- [ ] **Step 5: Commit**

```bash
git add frontend/app/dashboard/account-tasks/AccountTasksContent.tsx
git commit -m "refactor(account-tasks): remove task modals; navigate to full-page forms"
```

---

### Task 9: 清理备份 + 全仓一致性检查

**Files:**
- Delete: `frontend/app/dashboard/sign-tasks/page.tsx.backup`（若仍存在）
- 可选：确认 create/edit 外无第二套配置聊天大弹窗

- [ ] **Step 1: 删除备份**

```bash
git rm -f frontend/app/dashboard/sign-tasks/page.tsx.backup 2>/dev/null || rm -f frontend/app/dashboard/sign-tasks/page.tsx.backup
```

- [ ] **Step 2: 全仓扫描**

```bash
rg -n "showCreateDialog|showEditDialog" frontend/app --glob '!**/.next/**'
rg -n "configure_target_chat|ConfigureTargetChatModal" frontend --glob '!**/{.next,node_modules}/**'
rg -n "max-w-xl" frontend/app/dashboard --glob '!**/.next/**'
```

Expected:

- 无账号任务整任务 dialog state
- `ConfigureTargetChatModal` 定义 1 处、使用于 create + edit
- 任务表单路径无 `max-w-xl` 老整任务壳

- [ ] **Step 3: 最终 build + nav 单测**

```bash
cd frontend && npx --yes tsx lib/task-form-nav.test.mjs && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A frontend/app/dashboard/sign-tasks/page.tsx.backup frontend/components/sign-task-form frontend/lib frontend/app/dashboard frontend/context/LanguageContext.tsx
git status
git commit -m "chore(frontend): drop sign-tasks page backup; verify unified task forms"
```

（若无变更则跳过空 commit。）

---

### Task 10: 手工验收清单（对照 spec §10）

在本地 `npm run dev`（或既有前后端启动方式）登录后执行：

- [ ] **A. 账号任务「+」**  
  进入 create 全页；账号预选当前账号；**无**整任务 modal。取消 → 回账号任务页。

- [ ] **B. 账号任务「编辑」**  
  进入 edit 全页；完整 `chats[]` 与调度；保存后配置不丢多聊天；取消/保存 → 回账号任务页。

- [ ] **C. 任务中心「编辑」**  
  直达 edit；**不**先落账号任务页；取消/保存 → 回任务中心。

- [ ] **D. 任务中心「新建」**  
  create 带 `from=sign-tasks`；多账号 + 错峰仍可用；成功回任务中心。

- [ ] **E. 聊天配置**  
  固定/随机时分秒、动作序列在 create 与 edit 同一套大弹窗。

- [ ] **F. 回归**  
  账号任务导入/导出/运行/历史仍可用。

- [ ] **G. 边界**  
  打开 `/dashboard/sign-tasks/edit` 无 query → toast 并回任务中心。

全部通过后无需额外 commit；若修 bug 则按问题小步 commit。

---

## Spec coverage（自检）

| Spec 要求 | Task |
|-----------|------|
| 独立 `/sign-tasks/edit` | 6 |
| create 支持 `account`/`from` | 5 |
| 任务中心编辑直达 | 7 |
| 账号任务入口跳转 | 8 |
| 删整任务弹窗 | 8 |
| 按 from 回跳 | 1, 5, 6 |
| 共享聊天配置一套 UI | 3, 4, 5, 6, 9 |
| 完整 chats[] + normalize | 5, 6 |
| 多账号错峰不回退 | 5（保留 create 逻辑） |
| 验收清单 | 10 |
| 备份清理 | 9 |

## Placeholder scan

无 TBD/TODO；路径与函数名与 Task 1–4 Interfaces 一致。

## 执行说明

实现时按 Task 1 → 10 顺序；每 Task 结束 commit。推荐 subagent-driven：每 Task 新代理 + 任务间 review。
