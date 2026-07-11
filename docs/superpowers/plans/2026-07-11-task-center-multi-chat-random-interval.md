# 任务中心多聊天修复与随机动作间隔 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复编辑/列表导致多目标聊天被截断为 1 个的问题；放大配置弹窗；支持聊天级固定/随机动作间隔（时分秒输入），执行层按模式 sleep。

**Architecture:** 在不升配置版本（仍为 `_version: 4`）的前提下扩展聊天对象字段；后端 normalize 做旧字段兼容与校验；`tg_signer` 执行层按 `fixed|random` 计算 delay；前端抽出 duration 工具，创建页与账号任务编辑页共用完整 `chats[]` 与同一间隔 UI。

**Tech Stack:** Next.js (React) 前端、FastAPI + Pydantic v1 后端、`tg_signer` 执行核心、pytest（dev）、Playwright（已有，手工验收为主）。

**Spec:** `docs/superpowers/specs/2026-07-11-task-center-multi-chat-random-interval-design.md`

## Global Constraints

- 配置 `_version` 保持 **4**，不升版本；新字段可选 + 归一化。
- 聊天级间隔：`action_interval_mode` ∈ `fixed` | `random`；单位内部统一 **毫秒**。
- 兼容字段 `action_interval`：fixed 时 = `action_interval_ms`；random 时 = `action_interval_min_ms`。
- 旧配置仅有 `action_interval` → 视为 `fixed`。
- `min_ms ≤ max_ms`，`ms ≥ 0`；0 = 不 sleep。
- 不做每动作独立间隔；不新建独立 edit 路由。
- `docs/` 与 `tests/` 被 `.gitignore` 忽略：计划文档用 `git add -f`；Python 单测放在 **非** `tests/` 目录且文件名 **不要** 用 `_test*.py` 前缀（gitignore 会忽略），使用 `test_*.py` 放在 `backend/services/` 等包内。

---

## File Map

| 路径 | 职责 |
|------|------|
| `backend/services/action_interval.py` | **新建**：interval 归一化/校验/计算 delay 的纯函数（可单测） |
| `backend/services/sign_tasks.py` | 调用 normalize；create/update 落盘完整字段 |
| `backend/api/routes/sign_tasks.py` | `ChatConfig` 字段扩展；非法 interval → 400 |
| `backend/services/test_action_interval.py` | **新建**：normalize/resolve delay 单测 |
| `tg_signer/config.py` | `SignChatV4` 可选字段 |
| `tg_signer/core.py` | 动作间 sleep 使用 resolve delay |
| `frontend/lib/duration.ts` | **新建**：hms ↔ ms、format、normalizeChatInterval |
| `frontend/lib/api.ts` | `SignTaskChat` 类型扩展 |
| `frontend/context/LanguageContext.tsx` | 新文案 key |
| `frontend/app/dashboard/sign-tasks/create/page.tsx` | 弹窗加大、间隔 UI、函数式 setChats、编辑入口 |
| `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx` | 完整 `chats[]` 读写 + 对齐弹窗/间隔 UI |
| `frontend/app/dashboard/sign-tasks/page.tsx` | 列表展示 N 个目标 |

---

### Task 1: 后端 interval 纯函数 + 单测

**Files:**
- Create: `backend/services/action_interval.py`
- Create: `backend/services/test_action_interval.py`

**Interfaces:**
- Produces:
  - `normalize_chat_interval(chat: dict, config_version: Optional[int] = 4) -> dict`
  - `resolve_action_delay_ms(chat: Any) -> int`  # 支持 dict 或带属性对象
  - `IntervalValidationError(ValueError)` 当 min > max 或负值

- [ ] **Step 1: Write the failing tests**

创建 `backend/services/test_action_interval.py`：

```python
import random

import pytest

from backend.services.action_interval import (
    IntervalValidationError,
    normalize_chat_interval,
    resolve_action_delay_ms,
)


def test_legacy_action_interval_becomes_fixed():
    out = normalize_chat_interval({"chat_id": 1, "action_interval": 1500}, config_version=4)
    assert out["action_interval_mode"] == "fixed"
    assert out["action_interval_ms"] == 1500
    assert out["action_interval"] == 1500


def test_pre_v4_seconds_to_ms():
    out = normalize_chat_interval({"chat_id": 1, "action_interval": 2}, config_version=3)
    assert out["action_interval_ms"] == 2000
    assert out["action_interval_mode"] == "fixed"


def test_random_mode_writes_compat_field():
    out = normalize_chat_interval(
        {
            "chat_id": 1,
            "action_interval_mode": "random",
            "action_interval_min_ms": 1000,
            "action_interval_max_ms": 3000,
        },
        config_version=4,
    )
    assert out["action_interval"] == 1000
    assert out["action_interval_min_ms"] == 1000
    assert out["action_interval_max_ms"] == 3000


def test_min_gt_max_raises():
    with pytest.raises(IntervalValidationError):
        normalize_chat_interval(
            {
                "chat_id": 1,
                "action_interval_mode": "random",
                "action_interval_min_ms": 5000,
                "action_interval_max_ms": 1000,
            },
            config_version=4,
        )


def test_resolve_fixed_delay():
    assert resolve_action_delay_ms({"action_interval_mode": "fixed", "action_interval_ms": 1200}) == 1200


def test_resolve_random_delay_in_range(monkeypatch):
    monkeypatch.setattr(random, "randint", lambda a, b: 2500)
    delay = resolve_action_delay_ms(
        {
            "action_interval_mode": "random",
            "action_interval_min_ms": 1000,
            "action_interval_max_ms": 3000,
        }
    )
    assert delay == 2500


def test_resolve_legacy_only_action_interval():
    assert resolve_action_delay_ms({"action_interval": 800}) == 800
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd /Users/tune/Develop/GitHub/TG-AutoSign
.venv/bin/pytest backend/services/test_action_interval.py -v
```

Expected: FAIL（模块不存在 / import error）

- [ ] **Step 3: Implement `backend/services/action_interval.py`**

```python
"""Chat action-interval normalize / resolve helpers."""

from __future__ import annotations

import random
from typing import Any, Dict, Optional


class IntervalValidationError(ValueError):
    """Raised when action interval fields are invalid."""


def _as_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        n = default
    if n < 0:
        raise IntervalValidationError("action interval must be >= 0")
    return n


def normalize_chat_interval(
    chat: dict, config_version: Optional[int] = 4
) -> Dict[str, Any]:
    """Return a copy of chat with full interval fields for v4 storage."""
    normalized = dict(chat)

    # v3 and older stored seconds
    raw_interval = normalized.get("action_interval", 1000)
    if config_version is None or config_version < 4:
        try:
            raw_interval = int(float(raw_interval) * 1000)
        except (TypeError, ValueError):
            raw_interval = 1000

    mode = normalized.get("action_interval_mode") or "fixed"
    if mode not in ("fixed", "random"):
        mode = "fixed"

    if mode == "random":
        min_ms = normalized.get("action_interval_min_ms")
        max_ms = normalized.get("action_interval_max_ms")
        if min_ms is None:
            min_ms = normalized.get("action_interval_ms", raw_interval)
        if max_ms is None:
            max_ms = min_ms
        min_ms = _as_non_negative_int(min_ms, 0)
        max_ms = _as_non_negative_int(max_ms, 0)
        if min_ms > max_ms:
            raise IntervalValidationError(
                f"action_interval_min_ms ({min_ms}) > action_interval_max_ms ({max_ms})"
            )
        normalized["action_interval_mode"] = "random"
        normalized["action_interval_min_ms"] = min_ms
        normalized["action_interval_max_ms"] = max_ms
        normalized["action_interval_ms"] = min_ms
        normalized["action_interval"] = min_ms
        return normalized

    # fixed
    ms = normalized.get("action_interval_ms")
    if ms is None:
        ms = raw_interval if config_version is not None and config_version >= 4 else raw_interval
        if config_version is not None and config_version >= 4:
            ms = normalized.get("action_interval", 1000)
    ms = _as_non_negative_int(ms, 1000)
    normalized["action_interval_mode"] = "fixed"
    normalized["action_interval_ms"] = ms
    normalized["action_interval_min_ms"] = ms
    normalized["action_interval_max_ms"] = ms
    normalized["action_interval"] = ms
    return normalized


def resolve_action_delay_ms(chat: Any) -> int:
    """Compute sleep delay in ms for one inter-action wait."""

    def get(key: str, default: Any = None) -> Any:
        if isinstance(chat, dict):
            return chat.get(key, default)
        return getattr(chat, key, default)

    mode = get("action_interval_mode") or "fixed"
    if mode == "random":
        lo = get("action_interval_min_ms")
        hi = get("action_interval_max_ms")
        if lo is None:
            lo = get("action_interval_ms", get("action_interval", 0))
        if hi is None:
            hi = lo
        lo = _as_non_negative_int(lo, 0)
        hi = _as_non_negative_int(hi, 0)
        if hi < lo:
            lo, hi = hi, lo
        return random.randint(lo, hi)

    ms = get("action_interval_ms")
    if ms is None:
        ms = get("action_interval", 0)
    return _as_non_negative_int(ms, 0)
```

注意：Step 3 里 fixed 分支对 `config_version >= 4` 的 `ms` 取值写得啰嗦，实现时收敛为：

```python
# fixed
if config_version is None or config_version < 4:
    ms = raw_interval  # already converted to ms above
else:
    ms = normalized.get("action_interval_ms", normalized.get("action_interval", 1000))
ms = _as_non_negative_int(ms, 1000)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
.venv/bin/pytest backend/services/test_action_interval.py -v
```

Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/services/action_interval.py backend/services/test_action_interval.py
git commit -m "feat(sign-tasks): add action interval normalize helpers"
```

---

### Task 2: 接入服务层 normalize + API ChatConfig

**Files:**
- Modify: `backend/services/sign_tasks.py`（`_normalize_chat_action_interval` 与 create/update 路径）
- Modify: `backend/api/routes/sign_tasks.py`（`ChatConfig` + create/update 捕获校验错误）

**Interfaces:**
- Consumes: `normalize_chat_interval`, `IntervalValidationError`
- Produces: 落盘 chats 含完整 interval 字段；API 400 on invalid

- [ ] **Step 1: 扩展 `ChatConfig`（Pydantic v1）**

在 `backend/api/routes/sign_tasks.py` 的 `ChatConfig`：

```python
from typing import Any, Dict, List, Literal, Optional

class ChatConfig(BaseModel):
    chat_id: int = Field(..., description="Chat ID")
    name: str = Field("", description="Chat 名称")
    actions: List[Dict[str, Any]] = Field(..., description="动作列表")
    delete_after: Optional[int] = Field(None, description="删除延迟（秒）")
    action_interval: int = Field(1000, description="兼容：动作间隔（毫秒）")
    action_interval_mode: Optional[Literal["fixed", "random"]] = Field(
        None, description="fixed | random"
    )
    action_interval_ms: Optional[int] = Field(None, description="固定间隔毫秒")
    action_interval_min_ms: Optional[int] = Field(None, description="随机下限毫秒")
    action_interval_max_ms: Optional[int] = Field(None, description="随机上限毫秒")
```

- [ ] **Step 2: 替换服务层 normalize**

在 `backend/services/sign_tasks.py`：

```python
from backend.services.action_interval import (
    IntervalValidationError,
    normalize_chat_interval,
)

def _normalize_chat_action_interval(chat: dict, config_version) -> dict:
    return normalize_chat_interval(chat, config_version)
```

确保 `_normalize_task_chats` 仍调用它。`create_task` / `update_task` 写入前对每个 chat 调用 normalize（若当前只在 load 时 normalize，**创建/更新也要 normalize 一次**再 `json.dump`）：

在 `create_task` 中 `config = {...}` 之前：

```python
chats = [
    normalize_chat_interval(c if isinstance(c, dict) else dict(c), config_version=4)
    for c in chats
]
```

`update_task` 在组装 `config["chats"]` 时同样处理。

- [ ] **Step 3: API 捕获 IntervalValidationError → 400**

在 `create_sign_task` / `update_sign_task` 的 `try` 中：

```python
except IntervalValidationError as e:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
```

（从 `backend.services.action_interval` 导入）

- [ ] **Step 4: 跑单测 + 快速 import 检查**

```bash
.venv/bin/pytest backend/services/test_action_interval.py -v
.venv/bin/python -c "from backend.api.routes.sign_tasks import ChatConfig; print(ChatConfig(chat_id=1, actions=[]).dict())"
```

Expected: tests PASS；ChatConfig 可构造

- [ ] **Step 5: Commit**

```bash
git add backend/services/sign_tasks.py backend/api/routes/sign_tasks.py
git commit -m "feat(sign-tasks): wire interval normalize into API and storage"
```

---

### Task 3: tg_signer 配置模型 + 执行层 sleep

**Files:**
- Modify: `tg_signer/config.py`（`SignChatV4`）
- Modify: `tg_signer/core.py`（`sign_a_chat` 中 sleep）

**Interfaces:**
- Consumes: chat 上 `action_interval_mode` / `*_ms` / `action_interval`
- Produces: 日志 `动作间隔等待: {delay_ms}ms (...)`；`delay_ms==0` 不 sleep

- [ ] **Step 1: 扩展 `SignChatV4`**

```python
class SignChatV4(BaseJSONConfig):
    version: ClassVar = 4
    chat_id: int
    name: Optional[str] = None
    delete_after: Optional[int] = None
    actions: List[ActionT]
    action_interval: int = 1000  # 兼容字段，毫秒
    action_interval_mode: str = "fixed"  # fixed | random
    action_interval_ms: Optional[int] = None
    action_interval_min_ms: Optional[int] = None
    action_interval_max_ms: Optional[int] = None

    @classmethod
    def from_v3(cls, obj: "SignChatV3") -> "SignChatV4":
        ms = int(float(obj.action_interval) * 1000)
        return cls(
            chat_id=obj.chat_id,
            name=obj.name,
            delete_after=obj.delete_after,
            actions=obj.actions,
            action_interval=ms,
            action_interval_mode="fixed",
            action_interval_ms=ms,
            action_interval_min_ms=ms,
            action_interval_max_ms=ms,
        )
```

- [ ] **Step 2: 在 core 中 resolve delay**

在 `tg_signer/core.py` 文件顶部确认已有 `import random`（文件内已使用 random）。将：

```python
await asyncio.sleep(chat.action_interval / 1000)
```

替换为（约 1479 行附近）：

```python
from backend.services.action_interval import resolve_action_delay_ms

delay_ms = resolve_action_delay_ms(chat)
if delay_ms > 0:
    mode = getattr(chat, "action_interval_mode", None) or "fixed"
    if mode == "random":
        lo = getattr(chat, "action_interval_min_ms", None)
        hi = getattr(chat, "action_interval_max_ms", None)
        self.log(f"动作间隔等待: {delay_ms}ms (random {lo}-{hi})")
    else:
        self.log(f"动作间隔等待: {delay_ms}ms (fixed)")
    await asyncio.sleep(delay_ms / 1000)
```

**耦合注意：** `tg_signer` 核心目前可被 CLI 单独使用。若导入 `backend.*` 会增加对 backend 的依赖。**更稳妥写法：把 resolve 逻辑复制成 core 内小函数，或把 `action_interval.py` 放到 `tg_signer/`。**

**本计划采用：在 `tg_signer/action_interval.py` 放同一实现，backend 再 re-export，避免 core 依赖 backend。**

调整：

1. 将 Task 1 文件改为创建 `tg_signer/action_interval.py`（逻辑同上）
2. `backend/services/action_interval.py` 仅：

```python
from tg_signer.action_interval import (  # noqa: F401
    IntervalValidationError,
    normalize_chat_interval,
    resolve_action_delay_ms,
)
```

3. 单测改为：

```python
from tg_signer.action_interval import ...
```

或继续测 backend re-export。

4. core：

```python
from tg_signer.action_interval import resolve_action_delay_ms
```

（若 Task 1 已按 backend 路径提交，本 Task 开头先移动/抽公共模块再改 core。）

- [ ] **Step 3: 最小执行路径单测（可选但推荐）**

在 `tg_signer/test_action_interval_resolve.py`：

```python
from tg_signer.action_interval import resolve_action_delay_ms

def test_object_style_chat():
    class C:
        action_interval_mode = "fixed"
        action_interval_ms = 400
        action_interval = 400
    assert resolve_action_delay_ms(C()) == 400
```

```bash
.venv/bin/pytest tg_signer/test_action_interval_resolve.py backend/services/test_action_interval.py -v
```

- [ ] **Step 4: Commit**

```bash
git add tg_signer/action_interval.py tg_signer/config.py tg_signer/core.py \
  backend/services/action_interval.py backend/services/test_action_interval.py \
  tg_signer/test_action_interval_resolve.py
git commit -m "feat(signer): random/fixed action interval at runtime"
```

---

### Task 4: 前端 duration 工具 + API 类型 + i18n

**Files:**
- Create: `frontend/lib/duration.ts`
- Modify: `frontend/lib/api.ts`（`SignTaskChat`）
- Modify: `frontend/context/LanguageContext.tsx`

**Interfaces:**
- Produces:
  - `hmsToMs(h: number, m: number, s: number): number`
  - `msToHms(ms: number): { h: number; m: number; s: number }`
  - `formatDuration(ms: number): string`  // e.g. "1s", "1m30s", "1h2m3s"
  - `formatChatIntervalSummary(chat: IntervalFields): string`
  - `normalizeChatInterval(chat: Partial<SignTaskChat>): SignTaskChat interval fields`
  - `SignTaskChat` 含 mode / ms / min / max

- [ ] **Step 1: 实现 `frontend/lib/duration.ts`**

```typescript
export type IntervalMode = "fixed" | "random";

export type IntervalFields = {
  action_interval?: number;
  action_interval_mode?: IntervalMode;
  action_interval_ms?: number;
  action_interval_min_ms?: number;
  action_interval_max_ms?: number;
};

export function hmsToMs(h: number, m: number, s: number): number {
  const hh = Math.max(0, Math.floor(Number(h) || 0));
  const mm = Math.max(0, Math.floor(Number(m) || 0));
  const ss = Math.max(0, Math.floor(Number(s) || 0));
  return ((hh * 60 + mm) * 60 + ss) * 1000;
}

export function msToHms(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  return { h, m, s };
}

export function formatDuration(ms: number): string {
  const { h, m, s } = msToHms(ms);
  if (h === 0 && m === 0 && s === 0) return "0s";
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join("");
}

export function normalizeChatInterval<T extends IntervalFields>(chat: T): T & {
  action_interval_mode: IntervalMode;
  action_interval_ms: number;
  action_interval_min_ms: number;
  action_interval_max_ms: number;
  action_interval: number;
} {
  const mode: IntervalMode = chat.action_interval_mode === "random" ? "random" : "fixed";
  const legacy = Number(chat.action_interval);
  const legacyMs = Number.isFinite(legacy) && legacy >= 0 ? legacy : 1000;

  if (mode === "random") {
    let min = Number(chat.action_interval_min_ms);
    let max = Number(chat.action_interval_max_ms);
    if (!Number.isFinite(min) || min < 0) min = Number(chat.action_interval_ms);
    if (!Number.isFinite(min) || min < 0) min = legacyMs;
    if (!Number.isFinite(max) || max < 0) max = min;
    if (min > max) {
      const t = min;
      min = max;
      max = t;
    }
    return {
      ...chat,
      action_interval_mode: "random",
      action_interval_ms: min,
      action_interval_min_ms: min,
      action_interval_max_ms: max,
      action_interval: min,
    };
  }

  let ms = Number(chat.action_interval_ms);
  if (!Number.isFinite(ms) || ms < 0) ms = legacyMs;
  return {
    ...chat,
    action_interval_mode: "fixed",
    action_interval_ms: ms,
    action_interval_min_ms: ms,
    action_interval_max_ms: ms,
    action_interval: ms,
  };
}

export function formatChatIntervalSummary(chat: IntervalFields): string {
  const n = normalizeChatInterval(chat);
  if (n.action_interval_mode === "random") {
    return `${formatDuration(n.action_interval_min_ms)} ~ ${formatDuration(n.action_interval_max_ms)}`;
  }
  return formatDuration(n.action_interval_ms);
}

export function validateIntervalFields(chat: IntervalFields): string | null {
  const n = normalizeChatInterval(chat);
  if (n.action_interval_mode === "random" && n.action_interval_min_ms > n.action_interval_max_ms) {
    return "interval_min_gt_max";
  }
  return null;
}
```

- [ ] **Step 2: 扩展 `SignTaskChat`**

```typescript
export interface SignTaskChat {
  chat_id: number;
  name: string;
  actions: any[];
  delete_after?: number;
  action_interval: number;
  action_interval_mode?: "fixed" | "random";
  action_interval_ms?: number;
  action_interval_min_ms?: number;
  action_interval_max_ms?: number;
}
```

- [ ] **Step 3: i18n keys（zh + en）**

在 `LanguageContext.tsx` 两处字典中增加（键名一致）：

| key | zh | en |
|-----|----|----|
| `action_interval` | 动作间隔 | Action Interval |
| `action_interval_fixed` | 固定 | Fixed |
| `action_interval_random` | 随机区间 | Random range |
| `action_interval_min` | 最短 | Minimum |
| `action_interval_max` | 最长 | Maximum |
| `action_interval_hint` | 上一个动作结束后，在此区间内随机等待再执行下一个 | After an action finishes, wait a random time in this range before the next |
| `interval_hour` | 时 | h |
| `interval_minute` | 分 | m |
| `interval_second` | 秒 | s |
| `interval_min_gt_max` | 最短间隔不能大于最长间隔 | Minimum interval cannot exceed maximum |
| `target_chats_count` | {count} 个目标 | {count} targets |
| `edit_chat` | 编辑 | Edit |

可保留旧文案 `动作间隔 (毫秒)` 改为不含毫秒的「动作间隔」，因 UI 已是时分秒。

- [ ] **Step 4: 手工/Node 快速校验 duration**

```bash
cd frontend && node -e "
const { hmsToMs, msToHms, formatDuration, normalizeChatInterval } = require('./lib/duration.ts');
" 2>/dev/null || npx --yes tsx -e "
import { hmsToMs, msToHms, formatDuration, normalizeChatInterval } from './lib/duration.ts';
console.assert(hmsToMs(0,0,1)===1000);
console.assert(formatDuration(90000)==='1m30s');
console.assert(normalizeChatInterval({action_interval:1000}).action_interval_mode==='fixed');
console.log('duration ok');
"
```

若无 `tsx`，在浏览器/后续页面集成时验证；至少保证 TypeScript 无编译错误：

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/duration.ts frontend/lib/api.ts frontend/context/LanguageContext.tsx
git commit -m "feat(frontend): duration helpers and chat interval types"
```

---

### Task 5: 创建页 — 弹窗放大 + 间隔 UI + 稳健 setChats

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/create/page.tsx`

**Interfaces:**
- Consumes: `duration.ts` helpers, i18n keys
- Produces: 保存的 chat 含完整 interval 字段；弹窗更大

- [ ] **Step 1: 扩展 `editingChat` 状态类型**

```typescript
const [editingChat, setEditingChat] = useState<{
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
  editIndex?: number; // undefined = add, number = replace chats[editIndex]
} | null>(null);
```

- [ ] **Step 2: `handleAddChat` 默认间隔**

```typescript
const handleAddChat = () => {
  setEditingChat({
    chat_id: 0,
    name: "",
    manual_chat_id: "",
    actions: [{ action: 1, text: "" }],
    action_interval: 1000,
    action_interval_mode: "fixed",
    action_interval_ms: 1000,
    action_interval_min_ms: 1000,
    action_interval_max_ms: 1000,
  });
};
```

- [ ] **Step 3: `handleSaveChat` 使用 normalize + 函数式更新**

```typescript
import {
  formatChatIntervalSummary,
  hmsToMs,
  msToHms,
  normalizeChatInterval,
  validateIntervalFields,
} from "../../../../lib/duration";

// inside handleSaveChat, after action validation:
const intervalErr = validateIntervalFields(editingChat);
if (intervalErr) {
  addToast(t(intervalErr), "error");
  return;
}
const interval = normalizeChatInterval(editingChat);
const { manual_chat_id: _m, editIndex, ...rest } = editingChat;
const chatPayload = {
  ...rest,
  ...interval,
  chat_id: resolvedChatId,
  name: rest.name || `chat_${resolvedChatId}`,
  delete_after: rest.delete_after === undefined ? undefined : Number(rest.delete_after),
};

setChats((prev) => {
  if (typeof editIndex === "number" && editIndex >= 0 && editIndex < prev.length) {
    const next = [...prev];
    next[editIndex] = chatPayload;
    return next;
  }
  return [...prev, chatPayload];
});
setEditingChat(null);
```

- [ ] **Step 4: 弹窗尺寸**

外层 modal content class 改为：

```
w-full max-w-6xl w-[min(96vw,72rem)] max-h-[calc(100vh-2rem)]
```

动作列表容器：

```
max-h-[min(50vh,420px)] overflow-y-auto ...
```

- [ ] **Step 5: 间隔 UI 替换原毫秒 input**

用 mode 切换 + 时分秒三框。示例（固定模式）：

```tsx
const fixedHms = msToHms(editingChat.action_interval_ms);
// ...
<label>{t("action_interval")}</label>
<div className="flex gap-3">
  <button type="button" onClick={() => setEditingChat({...editingChat, action_interval_mode: "fixed"})}>
    {t("action_interval_fixed")}
  </button>
  <button type="button" onClick={() => setEditingChat({...editingChat, action_interval_mode: "random"})}>
    {t("action_interval_random")}
  </button>
</div>
{editingChat.action_interval_mode === "fixed" ? (
  <div className="flex gap-2 items-end">
    {(["h","m","s"] as const).map((part) => (
      <div key={part} className="space-y-1">
        <label className="text-[10px]">{t(part === "h" ? "interval_hour" : part === "m" ? "interval_minute" : "interval_second")}</label>
        <input
          inputMode="numeric"
          className="!mb-0 w-16"
          value={fixedHms[part === "h" ? "h" : part === "m" ? "m" : "s"]}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9]/g, "");
            const n = raw === "" ? 0 : Number(raw);
            const next = { ...fixedHms, [part === "h" ? "h" : part === "m" ? "m" : "s"]: n };
            const ms = hmsToMs(next.h, next.m, next.s);
            setEditingChat({
              ...editingChat,
              action_interval_ms: ms,
              action_interval: ms,
              action_interval_min_ms: ms,
              action_interval_max_ms: ms,
            });
          }}
        />
      </div>
    ))}
  </div>
) : (
  // 同样两套 min/max 时分秒，写入 action_interval_min_ms / max_ms
  // 并显示 t("action_interval_hint")
  null
)}
```

随机模式实现完整 min/max 两行，不要留 `null`。

- [ ] **Step 6: 列表摘要 + 编辑入口**

聊天卡片展示 `formatChatIntervalSummary(chat)`；增加编辑按钮：

```tsx
<button
  type="button"
  className="action-btn"
  title={t("edit_chat")}
  onClick={() => {
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
>
  <PencilSimple weight="bold" />
</button>
```

（从 `@phosphor-icons/react` 增加 `PencilSimple` import。）

- [ ] **Step 7: 本地手测创建页**

1. 打开 `/dashboard/sign-tasks/create`
2. 添加 2 个聊天，确认列表 count=2
3. 编辑第二个，改间隔为随机 1s~3s，摘要显示正确
4. 弹窗明显更宽、动作区更高

- [ ] **Step 8: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/create/page.tsx
git commit -m "feat(create-task): multi-chat edit, larger modal, interval UI"
```

---

### Task 6: 账号任务页 — 完整 chats[] 读写（修截断根因）

**Files:**
- Modify: `frontend/app/dashboard/account-tasks/AccountTasksContent.tsx`

**Interfaces:**
- Consumes: duration helpers、与创建页相同的 chat 配置弹窗交互
- Produces: `updateSignTask` / create 提交完整 `chats[]`

- [ ] **Step 1: 状态改造**

增加：

```typescript
const [taskChats, setTaskChats] = useState<SignTaskChat[]>([]);
const [editingChat, setEditingChat] = useState<...同创建页...>(null);
```

创建与编辑对话框顶层保留任务名/调度字段；**聊天部分**改为列表 +「添加聊天」，不要再用单一 `chat_id` 字段作为唯一真相。

- [ ] **Step 2: `handleEditTask` 载入全部 chats**

```typescript
const handleEditTask = useCallback((task: SignTask) => {
  setEditingTaskName(task.name);
  setOriginalTaskName(task.name);
  setTaskChats((task.chats || []).map((c) => normalizeChatInterval(c)));
  setEditTask({
    // 仅调度相关字段，去掉单一 chat_* 
    sign_at: task.sign_at,
    random_minutes: Math.round(task.random_seconds / 60),
    execution_mode: task.execution_mode || "fixed",
    range_start: task.range_start || "09:00",
    range_end: task.range_end || "18:00",
  });
  setShowEditDialog(true);
}, []);
```

同步精简 `editTask` / `newTask` 类型，删除单 chat 字段，避免误用。

- [ ] **Step 3: `handleSaveEdit` 提交完整列表**

```typescript
if (taskChats.length === 0) {
  addToast(t("chat_required"), "error");
  return;
}
await updateSignTask(token, originalTaskName, {
  name: editingTaskName,
  sign_at: editTask.sign_at,
  random_seconds: editTask.random_minutes * 60,
  chats: taskChats.map((c) => normalizeChatInterval(c)),
  execution_mode: editTask.execution_mode,
  range_start: editTask.range_start,
  range_end: editTask.range_end,
}, accountName);
```

- [ ] **Step 4: 创建路径同样提交 `taskChats` / 多聊天**

定位 `handleCreateTask`（或等价），把 `chats: [{ single }]` 改为 `chats: taskChats.map(normalizeChatInterval)`；打开创建对话框时 `setTaskChats([])`。

- [ ] **Step 5: 嵌入与创建页同结构的配置弹窗**

复用 Task 5 的 modal markup（可暂时复制，后续再抽组件；YAGNI 允许复制一次）。保存到 `taskChats`：

```typescript
setTaskChats((prev) => {
  if (typeof editIndex === "number" && editIndex >= 0) {
    const next = [...prev];
    next[editIndex] = chatPayload;
    return next;
  }
  return [...prev, chatPayload];
});
```

- [ ] **Step 6: 列表项 TaskItem 展示 N 个目标**

文件内 `TaskItem` 中 `task.chats[0]?.chat_id` 改为：

```tsx
{t("target_chats_count").replace("{count}", String(task.chats?.length || 0))}
{task.chats?.[0]?.name || task.chats?.[0]?.chat_id || ""}
```

- [ ] **Step 7: 回归手测（关键验收）**

1. 用创建页建任务含 2 个 chat → 磁盘 `config.json` 有 2 项  
2. 打开账号任务编辑 → **必须看到 2 个**  
3. 只改任务名/时间后保存 → 仍为 2 个  
4. 再添加第 3 个 chat 保存 → 3 个  

- [ ] **Step 8: Commit**

```bash
git add frontend/app/dashboard/account-tasks/AccountTasksContent.tsx
git commit -m "fix(account-tasks): preserve full chats array on edit/save"
```

---

### Task 7: 任务中心列表展示 N 个目标

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx`

- [ ] **Step 1: 替换表格与卡片中的 `chats[0]` 展示**

表格列与卡片中：

```tsx
// before
task.chats[0]?.chat_id || "-"

// after
<span title={(task.chats || []).map(c => c.name || c.chat_id).join(", ")}>
  {t("target_chats_count").replace("{count}", String(task.chats?.length || 0))}
  {task.chats?.length ? ` · ${task.chats[0]?.name || task.chats[0]?.chat_id}` : ""}
</span>
```

两处（约 770 行表格、891 行卡片）都改。

- [ ] **Step 2: 手测列表**

打开 `/dashboard/sign-tasks`，多聊天任务显示「2 个目标」类文案。

- [ ] **Step 3: Commit**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "fix(task-center): show target chat count in list"
```

---

### Task 8: 端到端验收与收尾

**Files:** 无新文件；必要时小修

- [ ] **Step 1: 跑后端单测**

```bash
.venv/bin/pytest backend/services/test_action_interval.py tg_signer/test_action_interval_resolve.py -v
```

Expected: PASS

- [ ] **Step 2: 前端类型检查**

```bash
cd frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -50
```

Expected: 无新增错误（或仅有与本改动无关的既有问题，需记录）

- [ ] **Step 3: 手工验收清单（对照 spec §8）**

| # | 检查项 | 通过? |
|---|--------|-------|
| 1 | 创建 2+ 聊天 → config.json 完整 | |
| 2 | 编辑保存不丢 chats | |
| 3 | 列表显示 N 个目标 | |
| 4 | 固定 5s → 日志 fixed 5000ms | |
| 5 | 随机 1s~3s → delay 在区间内 | |
| 6 | 旧任务仅 `action_interval` 可运行 | |
| 7 | 弹窗更大、动作区更高 | |

运行一次真实任务（或 mock sleep 日志）确认 core 日志。

- [ ] **Step 4: 最终 commit（若有修修补补）**

```bash
git status
# 如有修复：
git add -A
git commit -m "fix: polish multi-chat interval edge cases"
```

- [ ] **Step 5: 汇总**

向用户报告：改动文件列表、如何手测、已知限制（如未抽共享 ChatConfigModal 组件）。

---

## Self-Review (plan vs spec)

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 多聊天截断修复（AccountTasks 读写） | Task 6 |
| 列表展示 N 个目标 | Task 6 内 TaskItem + Task 7 |
| 弹窗放大 | Task 5（创建）、Task 6（编辑对齐） |
| 固定/随机 + 时分秒 | Task 4–6 |
| 数据模型字段与兼容 | Task 1–3 |
| 执行层 random sleep + 日志 | Task 3 |
| API 校验 400 | Task 2 |
| 旧配置兼容 | Task 1 normalize + Task 3 resolve |
| 验收标准 | Task 8 |

**Placeholder scan:** 无 TBD；Task 5 随机 UI 要求实现完整 min/max，不留 `null` stub。  
**类型一致性:** `action_interval_mode/ms/min_ms/max_ms` + 兼容 `action_interval` 全链路同名。  
**依赖方向:** `tg_signer/action_interval.py` 为真源；backend re-export，core 不依赖 backend。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-11-task-center-multi-chat-random-interval.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派一个新 subagent，Task 间 review，迭代快  
2. **Inline Execution** — 本会话用 executing-plans 按批执行并设检查点  

**Which approach?**
