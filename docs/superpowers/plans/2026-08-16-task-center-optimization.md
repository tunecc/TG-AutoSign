---
change: task-center-optimization
design-doc: docs/superpowers/specs/2026-08-16-task-center-optimization-design.md
base-ref: b9763346a97a4539888060b9ecd3ea1b0c9ec95d
---

# 任务中心综合优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一次性收敛任务中心 6 项缺陷——新任务显示旧 last_run、失败原因不可观测、批量计划后编辑加载失败、排序/筛选不持久、筛选栏杂乱、缺少任务配置模板。

**Architecture:** 后端在 `SignTaskService.delete_task` 增加 history 清理、收敛 `_get_last_run_info` 回退条件；新增独立 `SignTaskTemplateService` 与独立路由 `/sign-task-templates`。前端在 `sign-tasks/page.tsx` 增加失败原因行内展开、localStorage 持久化、筛选栏紧凑布局；在 `edit/page.tsx` 增加多重防御；在 `create/page.tsx` 增加模板保存/应用/删除 UI；`lib/api.ts` 增加模板客户端方法；`LanguageContext.tsx` 增加中英文案 key。

**Tech Stack:** FastAPI + Pydantic（后端）、Next.js 14 + React 18 + TypeScript（前端）、文件系统存储（无 DB schema 变更）、pytest + pytest-asyncio（后端测试）。

## Global Constraints

- 后端测试运行命令：`pytest backend/services/test_sign_tasks_history.py -v`（在仓库根目录执行）。
- 前端类型检查 / 构建命令：`cd frontend && npm run build`。
- localStorage 键前缀统一为 `tg-signpulse:`，与现有 `tg-signpulse:task-view-mode` 一致。
- 模板存储目录：`<workdir>/task_templates/<name>.json`，独立目录，不污染 signs/history。
- 模板名复用 `name_must_be_valid_filename` 校验规则（拒绝 `< > : " / \ | ? *`、空、`. ..`）。
- 任务实例由 `(account_name, task_name)` 唯一标识；history 文件名 `{account}__{task}.json`，旧版为 `{task}.json`。
- 前端保持现有 glass-panel 视觉语言，不引入新 UI 组件库。
- 文案 key 必须同时在 `translations.zh` 与 `translations.en` 中添加，否则 `t(key)` 回退返回 key 本身。
- 任务行内展开采用单展开模式（点击其他失败任务关闭前一个），符合 Design Decision 3 与 Open Question 倾向。

---

## File Structure

**后端：**

- `backend/services/sign_tasks.py`（修改）：`delete_task`（:1091）增加 history 清理；`_get_last_run_info`（:598）收敛回退条件。
- `backend/services/sign_task_templates.py`（新建）：`SignTaskTemplateService` 类，提供 `list_templates`/`save_template`/`delete_template`，存储于 `<workdir>/task_templates/`。
- `backend/api/routes/sign_task_templates.py`（新建）：独立 router，`GET/POST/DELETE /sign-task-templates`。
- `backend/api/routes/__init__.py`（修改）：注册新 router，`prefix="/sign-task-templates"`。
- `backend/services/test_sign_tasks_history.py`（新建）：`delete_task` 清理与 `_get_last_run_info` 回退收敛的单测。
- `backend/services/test_sign_task_templates.py`（新建）：模板服务 CRUD 单测。

**前端：**

- `frontend/lib/api.ts`（修改）：新增 `SignTaskTemplate` 类型与 `listSignTaskTemplates`/`saveSignTaskTemplate`/`deleteSignTaskTemplate` 客户端方法。
- `frontend/app/dashboard/sign-tasks/page.tsx`（修改）：失败原因行内展开、localStorage 持久化、筛选栏单行紧凑布局。
- `frontend/app/dashboard/sign-tasks/edit/page.tsx`（修改）：`loadTask` 失败区分 404 与其他错误。
- `frontend/app/dashboard/sign-tasks/create/page.tsx`（修改）：模板保存/应用/删除 UI。
- `frontend/context/LanguageContext.tsx`（修改）：新增失败原因、模板相关中英文案 key。

---

## Group A — 后端：删除任务清理 history 与 last_run 回退收敛

对应 Design Doc §1、tasks.md §1、spec Requirement「新任务不得显示历史运行记录」。

### Task 1: delete_task 清理 history 文件

**Files:**
- Modify: `backend/services/sign_tasks.py:1127-1144`（`delete_task` 的 `try` 块，`shutil.rmtree(task_dir)` 之后、`return True` 之前）
- Test: `backend/services/test_sign_tasks_history.py`

**Interfaces:**
- Consumes: `self._history_file_path(task_name, account_name)`（:245）、`self._safe_history_key(name)`（:242）、`self.run_history_dir`（:168）。
- Produces: `delete_task` 在删除任务目录后 best-effort 清理 history 文件，返回值不变（`bool`）。

- [x] **Step 1: 编写失败测试 — 删除任务后 history 文件被清理**

新建 `backend/services/test_sign_tasks_history.py`：

```python
import json
from pathlib import Path

import pytest

from backend.services.sign_tasks import SignTaskService


def _make_service(tmp_path: Path, monkeypatch) -> SignTaskService:
    monkeypatch.setattr("backend.services.sign_tasks.get_settings", lambda: _FakeSettings(tmp_path))
    monkeypatch.setattr(
        "backend.services.sign_tasks.get_sign_task_runtime_config",
        lambda: _FakeRuntimeConfig(),
    )
    # 避免触发真实调度器/Telegram 客户端
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", lambda self: None)
    return SignTaskService()


class _FakeSettings:
    def __init__(self, workdir: Path):
        self._workdir = workdir

    def resolve_workdir(self):
        return self._workdir


class _FakeRuntimeConfig:
    account_cooldown_seconds = 0
    history_max_entries = 50
    history_max_flow_lines = 500
    history_max_line_chars = 500
    history_max_message_events = 100


def _create_task(service: SignTaskService, account: str, task: str) -> Path:
    task_dir = service.signs_dir / account / task
    task_dir.mkdir(parents=True)
    (task_dir / "config.json").write_text(
        json.dumps({"name": task, "account_name": account, "sign_at": "0 0 * * *", "chats": []}),
        encoding="utf-8",
    )
    return task_dir


def _write_history(service: SignTaskService, account: str, task: str):
    history_file = service._history_file_path(task, account)
    history_file.write_text(
        json.dumps([{"time": "2026-08-16T00:00:00", "success": True, "message": "ok", "account_name": account}]),
        encoding="utf-8",
    )
    return history_file


def test_delete_task_removes_history_file(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")
    history_file = _write_history(service, "accA", "taskT")

    assert history_file.exists()
    assert service.delete_task("taskT", account_name="accA") is True
    assert not history_file.exists()


def test_delete_task_removes_legacy_history_file(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")
    legacy_file = service.run_history_dir / f"{service._safe_history_key('taskT')}.json"
    legacy_file.write_text(json.dumps([{"success": True}]), encoding="utf-8")

    assert service.delete_task("taskT", account_name="accA") is True
    assert not legacy_file.exists()


def test_delete_task_best_effort_when_history_missing(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")

    assert service.delete_task("taskT", account_name="accA") is True
    assert not (service.signs_dir / "accA" / "taskT").exists()
```

- [x] **Step 2: 运行测试验证失败**

Run: `pytest backend/services/test_sign_tasks_history.py::test_delete_task_removes_history_file -v`
Expected: FAIL（history 文件仍存在，`assert not history_file.exists()` 失败）。

- [x] **Step 3: 实现 delete_task 的 history 清理**

在 `backend/services/sign_tasks.py` 的 `delete_task` 中，将 `try` 块替换为：

```python
        try:
            import shutil

            shutil.rmtree(task_dir)
            # Invalidate cache
            self._tasks_cache = None

            # best-effort 清理 history 文件，失败不阻断删除
            for cleanup_path in (
                self._history_file_path(task_name, real_account_name or ""),
                self.run_history_dir / f"{self._safe_history_key(task_name)}.json",
            ):
                try:
                    if cleanup_path.exists():
                        cleanup_path.unlink()
                except Exception as e:
                    logger.warning("清理 history 文件失败: %s, 错误: %s", cleanup_path, e)

            if real_account_name:
                try:
                    from backend.scheduler import remove_sign_task_job

                    remove_sign_task_job(real_account_name, task_name)
                except Exception as e:
                    print(f"DEBUG: 移除调度任务失败: {e}")

            return True
        except Exception:
            return False
```

- [x] **Step 4: 运行测试验证通过**

Run: `pytest backend/services/test_sign_tasks_history.py -v`
Expected: PASS（3 个测试全部通过）。

- [x] **Step 5: 提交**

```bash
git add backend/services/sign_tasks.py backend/services/test_sign_tasks_history.py
git commit -m "fix(sign-tasks): clean history files on delete_task"
```

---

### Task 2: `_get_last_run_info` 收敛回退条件

**Files:**
- Modify: `backend/services/sign_tasks.py:598-622`（`_get_last_run_info` 方法体）
- Test: `backend/services/test_sign_tasks_history.py`

**Interfaces:**
- Consumes: `self._history_file_path`、`self.run_history_dir`、`self._safe_history_key`。
- Produces: `_get_last_run_info` 在 `account_name` 非空且 history 最近一条的 `account_name` 与之不一致时返回 None；legacy 单文件仅在没有 `account_name` 时回退。

- [x] **Step 1: 编写失败测试 — 跨账号同名不串读**

在 `backend/services/test_sign_tasks_history.py` 末尾追加：

```python
def _write_history_with_account(service, account, task, entry_account):
    history_file = service._history_file_path(task, account)
    history_file.write_text(
        json.dumps([{"success": False, "message": "boom", "account_name": entry_account}]),
        encoding="utf-8",
    )
    return history_file


def test_get_last_run_info_returns_none_when_account_mismatch(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accB", "taskT")
    # accA 的 history 串读到 accB 的查询路径（模拟残留）
    _write_history_with_account(service, "accA", "taskT", "accA")
    task_dir = service.signs_dir / "accB" / "taskT"

    # accB 不应读到 accA 的历史条目
    result = service._get_last_run_info(task_dir, account_name="accB")
    assert result is None


def test_get_last_run_info_returns_entry_when_account_matches(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")
    _write_history_with_account(service, "accA", "taskT", "accA")
    task_dir = service.signs_dir / "accA" / "taskT"

    result = service._get_last_run_info(task_dir, account_name="accA")
    assert result is not None
    assert result["message"] == "boom"


def test_get_last_run_info_legacy_only_when_no_account(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "", "taskT")  # 旧版无 account 路径
    legacy_file = service.run_history_dir / f"{service._safe_history_key('taskT')}.json"
    legacy_file.write_text(json.dumps([{"success": True, "message": "legacy"}]), encoding="utf-8")
    task_dir = service.signs_dir / "taskT"

    result = service._get_last_run_info(task_dir, account_name="")
    assert result is not None
    assert result["message"] == "legacy"


def test_get_last_run_info_legacy_not_used_when_account_present(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accB", "taskT")
    legacy_file = service.run_history_dir / f"{service._safe_history_key('taskT')}.json"
    legacy_file.write_text(json.dumps([{"success": True, "message": "legacy"}]), encoding="utf-8")
    task_dir = service.signs_dir / "accB" / "taskT"

    # 有 account_name 时不应回退到 legacy 单文件
    result = service._get_last_run_info(task_dir, account_name="accB")
    assert result is None
```

- [x] **Step 2: 运行测试验证失败**

Run: `pytest backend/services/test_sign_tasks_history.py::test_get_last_run_info_returns_none_when_account_mismatch -v`
Expected: FAIL（当前实现读取 legacy 单文件或返回 `accA` 的历史条目）。

- [x] **Step 3: 实现 `_get_last_run_info` 收敛**

将 `backend/services/sign_tasks.py:598-622` 的 `_get_last_run_info` 方法体替换为：

```python
    def _get_last_run_info(
        self, task_dir: Path, account_name: str = ""
    ) -> Optional[Dict[str, Any]]:
        """
        获取任务的最后执行信息
        - account_name 非空：仅读取 {account}__{task}.json，并校验最近一条的 account_name 一致
        - account_name 为空：回退 legacy 单文件 {task}.json（真正旧版兼容）
        """
        history_file = self._history_file_path(task_dir.name, account_name)
        legacy_file = self.run_history_dir / f"{self._safe_history_key(task_dir.name)}.json"

        if not history_file.exists():
            # 仅在无 account_name 时回退 legacy 单文件（真正旧版兼容场景）
            if not account_name and legacy_file.exists():
                history_file = legacy_file
            else:
                return None

        try:
            with open(history_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                entry = None
                if isinstance(data, list) and len(data) > 0:
                    entry = data[0]
                elif isinstance(data, dict):
                    entry = data
                if entry is None:
                    return None
                # account_name 非空时校验条目归属，避免跨账号串读
                if account_name and entry.get("account_name") and entry.get("account_name") != account_name:
                    return None
                return entry
        except Exception:
            return None
```

- [x] **Step 4: 运行全部后端测试验证通过**

Run: `pytest backend/services/test_sign_tasks_history.py -v`
Expected: PASS（7 个测试全部通过，包括 Task 1 的 3 个）。

- [x] **Step 5: 提交**

```bash
git add backend/services/sign_tasks.py backend/services/test_sign_tasks_history.py
git commit -m "fix(sign-tasks): converge _get_last_run_info fallback to prevent cross-account bleed"
```

---

## Group B — 后端：任务配置模板 API

对应 Design Doc §6、tasks.md §2、spec Requirement「任务配置模板可保存与一键应用」。

### Task 3: SignTaskTemplateService 服务层

**Files:**
- Create: `backend/services/sign_task_templates.py`
- Test: `backend/services/test_sign_task_templates.py`

**Interfaces:**
- Consumes: `backend.core.config.get_settings().resolve_workdir()`。
- Produces:
  - `SignTaskTemplateService(workdir: Optional[Path] = None)`
  - `list_templates() -> List[Dict[str, Any]]`
  - `save_template(name: str, config: Dict[str, Any]) -> Dict[str, Any]`
  - `delete_template(name: str) -> bool`
  - `get_template(name: str) -> Optional[Dict[str, Any]]`
- 模板字段：`{ name, chats, execution_mode, sign_at, range_start, range_end, random_seconds, sign_interval, updated_at }`

- [x] **Step 1: 编写失败测试 — 模板 CRUD**

新建 `backend/services/test_sign_task_templates.py`：

```python
import json
from pathlib import Path

import pytest

from backend.services.sign_task_templates import SignTaskTemplateService


def _make_service(tmp_path: Path, monkeypatch) -> SignTaskTemplateService:
    monkeypatch.setattr("backend.services.sign_task_templates.get_settings", lambda: _FakeSettings(tmp_path))
    return SignTaskTemplateService()


class _FakeSettings:
    def __init__(self, workdir: Path):
        self._workdir = workdir

    def resolve_workdir(self):
        return self._workdir


def _sample_config() -> dict:
    return {
        "chats": [{"chat_id": 123, "name": "chat_123", "actions": []}],
        "execution_mode": "fixed",
        "sign_at": "0 0 * * *",
        "range_start": "",
        "range_end": "",
        "random_seconds": 30,
        "sign_interval": 1,
    }


def test_save_and_list_template(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    saved = service.save_template("morning", _sample_config())
    assert saved["name"] == "morning"
    assert saved["chats"][0]["chat_id"] == 123

    items = service.list_templates()
    assert len(items) == 1
    assert items[0]["name"] == "morning"


def test_save_template_overwrites_same_name(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    service.save_template("morning", _sample_config())
    updated = {**_sample_config(), "random_seconds": 90}
    service.save_template("morning", updated)

    items = service.list_templates()
    assert len(items) == 1
    assert items[0]["random_seconds"] == 90


def test_delete_template(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    service.save_template("morning", _sample_config())
    assert service.delete_template("morning") is True
    assert service.list_templates() == []
    assert service.delete_template("morning") is False


def test_save_template_rejects_invalid_name(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    for bad in ["", "  ", "a/b", "a\\b", "a:b", "a<b", ".", ".."]:
        with pytest.raises(ValueError):
            service.save_template(bad, _sample_config())


def test_delete_template_rejects_path_traversal(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    assert service.delete_template("../escape") is False
    assert service.delete_template(".") is False
```

- [x] **Step 2: 运行测试验证失败**

Run: `pytest backend/services/test_sign_task_templates.py -v`
Expected: FAIL（`ModuleNotFoundError: No module named 'backend.services.sign_task_templates'`）。

- [x] **Step 3: 实现 SignTaskTemplateService**

新建 `backend/services/sign_task_templates.py`：

```python
"""
签到任务配置模板服务
提供任务配置模板的 CRUD（列表/保存/删除），存储于 <workdir>/task_templates/
模板与账号解耦：只保存 chats（含 chat_id + actions）与调度/延迟/间隔配置
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.config import get_settings

logger = __import__("logging").getLogger("backend.sign_task_templates")

_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*]')


def _validate_template_name(name: str) -> str:
    """校验模板名，复用 name_must_be_valid_filename 规则"""
    if not name or not name.strip():
        raise ValueError("模板名称不能为空")
    stripped = name.strip()
    if stripped in (".", ".."):
        raise ValueError("模板名称不能为 . 或 ..")
    if _INVALID_FILENAME_CHARS.search(stripped):
        raise ValueError('模板名称不能包含特殊字符: < > : " / \\ | ? *')
    return stripped


class SignTaskTemplateService:
    def __init__(self, workdir: Optional[Path] = None):
        if workdir is None:
            workdir = get_settings().resolve_workdir()
        self.workdir = workdir
        self.templates_dir = self.workdir / "task_templates"
        self.templates_dir.mkdir(parents=True, exist_ok=True)

    def _template_file(self, name: str) -> Path:
        safe_name = _validate_template_name(name)
        return self.templates_dir / f"{safe_name}.json"

    def list_templates(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for path in sorted(self.templates_dir.glob("*.json")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    items.append(data)
            except Exception as e:
                logger.warning("读取模板失败: %s, 错误: %s", path, e)
        return items

    def get_template(self, name: str) -> Optional[Dict[str, Any]]:
        path = self._template_file(name)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def save_template(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        safe_name = _validate_template_name(name)
        template = {
            "name": safe_name,
            "chats": config.get("chats", []),
            "execution_mode": config.get("execution_mode", "fixed"),
            "sign_at": config.get("sign_at", ""),
            "range_start": config.get("range_start", ""),
            "range_end": config.get("range_end", ""),
            "random_seconds": config.get("random_seconds", 0),
            "sign_interval": config.get("sign_interval", 1),
            "updated_at": datetime.now().isoformat(),
        }
        path = self.templates_dir / f"{safe_name}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(template, f, ensure_ascii=False, indent=2)
        return template

    def delete_template(self, name: str) -> bool:
        try:
            path = self._template_file(name)
        except ValueError:
            return False
        if not path.exists():
            return False
        try:
            path.unlink()
            return True
        except Exception as e:
            logger.warning("删除模板失败: %s, 错误: %s", path, e)
            return False


_service: Optional[SignTaskTemplateService] = None


def get_sign_task_template_service() -> SignTaskTemplateService:
    global _service
    if _service is None:
        _service = SignTaskTemplateService()
    return _service
```

- [x] **Step 4: 运行测试验证通过**

Run: `pytest backend/services/test_sign_task_templates.py -v`
Expected: PASS（5 个测试全部通过）。

- [x] **Step 5: 提交**

```bash
git add backend/services/sign_task_templates.py backend/services/test_sign_task_templates.py
git commit -m "feat(sign-task-templates): add SignTaskTemplateService with file CRUD"
```

---

### Task 4: 模板 API 路由

**Files:**
- Create: `backend/api/routes/sign_task_templates.py`
- Modify: `backend/api/routes/__init__.py:3,10`

**Interfaces:**
- Consumes: `get_sign_task_template_service()`、`get_current_user`。
- Produces（HTTP）：
  - `GET /api/sign-task-templates` → `List[SignTaskTemplateOut]`
  - `POST /api/sign-task-templates` → `SignTaskTemplateOut`（201）
  - `DELETE /api/sign-task-templates/{name}` → `{"ok": true}`

- [x] **Step 1: 实现路由文件**

新建 `backend/api/routes/sign_task_templates.py`：

```python
"""
签到任务配置模板 API 路由
独立 router，前缀 /sign-task-templates
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, validator

from backend.core.auth import get_current_user
from backend.services.sign_task_templates import get_sign_task_template_service

router = APIRouter()


class SignTaskTemplateIn(BaseModel):
    """保存模板请求"""

    name: str = Field(..., description="模板名称")
    chats: List[Dict[str, Any]] = Field(default_factory=list, description="Chat 配置列表")
    execution_mode: Optional[str] = Field("fixed", description="执行模式 fixed/range")
    sign_at: Optional[str] = Field("", description="CRON 表达式（fixed 模式）")
    range_start: Optional[str] = Field("", description="随机范围开始时间")
    range_end: Optional[str] = Field("", description="随机范围结束时间")
    random_seconds: Optional[int] = Field(0, description="随机延迟秒数")
    sign_interval: Optional[int] = Field(1, description="签到间隔秒数")

    @validator("name")
    def name_must_be_valid(cls, v):
        import re

        if not v or not v.strip():
            raise ValueError("模板名称不能为空")
        if re.search(r'[<>:"/\\|?*]', v):
            raise ValueError('模板名称不能包含特殊字符: < > : " / \\ | ? *')
        if v.strip() in (".", ".."):
            raise ValueError("模板名称不能为 . 或 ..")
        return v


class SignTaskTemplateOut(BaseModel):
    """模板输出"""

    name: str
    chats: List[Dict[str, Any]]
    execution_mode: str = "fixed"
    sign_at: str = ""
    range_start: str = ""
    range_end: str = ""
    random_seconds: int = 0
    sign_interval: int = 1
    updated_at: Optional[str] = None


@router.get("", response_model=List[SignTaskTemplateOut])
async def list_sign_task_templates(current_user=Depends(get_current_user)):
    """列出全部任务配置模板"""
    return get_sign_task_template_service().list_templates()


@router.post("", response_model=SignTaskTemplateOut, status_code=status.HTTP_201_CREATED)
async def save_sign_task_template(
    payload: SignTaskTemplateIn,
    current_user=Depends(get_current_user),
):
    """保存（覆盖）任务配置模板"""
    try:
        return get_sign_task_template_service().save_template(
            payload.name,
            {
                "chats": payload.chats,
                "execution_mode": payload.execution_mode,
                "sign_at": payload.sign_at,
                "range_start": payload.range_start,
                "range_end": payload.range_end,
                "random_seconds": payload.random_seconds,
                "sign_interval": payload.sign_interval,
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{name}", status_code=status.HTTP_200_OK)
async def delete_sign_task_template(
    name: str,
    current_user=Depends(get_current_user),
):
    """删除任务配置模板"""
    deleted = get_sign_task_template_service().delete_template(name)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"模板 {name} 不存在")
    return {"ok": True}
```

- [x] **Step 2: 注册路由**

修改 `backend/api/routes/__init__.py`：

- 第 3 行 import 改为：
```python
from backend.api.routes import accounts, auth, config, events, sign_task_templates, sign_tasks, tasks, user
```
- 在第 10 行 `router.include_router(sign_tasks.router, ...)` 之后新增一行：
```python
router.include_router(sign_task_templates.router, prefix="/sign-task-templates", tags=["sign-task-templates"])
```

- [x] **Step 3: 验证路由注册（导入不报错）**

Run: `python -c "from backend.api.routes import router; print([r.path for r in router.routes if 'template' in r.path])"`
Expected: 输出包含 `/api/sign-task-templates`、`/api/sign-task-templates/{name}`（前缀 `/api` 在 app 层挂载）。

- [x] **Step 4: 提交**

```bash
git add backend/api/routes/sign_task_templates.py backend/api/routes/__init__.py
git commit -m "feat(sign-task-templates): add template API routes"
```

---

## Group C — 前端：失败原因行内展开

对应 Design Doc §2、tasks.md §3、spec Requirement「失败任务可查看失败原因」。

### Task 5: 失败任务行内展开失败原因

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx`（state 区 :146-171、表格视图 :851-934、卡片视图 :980-1016）
- Modify: `frontend/context/LanguageContext.tsx`（zh 末尾、en 末尾）

**Interfaces:**
- Consumes: `task.last_run.message`、`task.last_run.time`、`handleShowTaskHistory`（:543）、`getTaskId`（:317）。
- Produces: 单展开 state `failedDetailTaskId`；表格视图失败行后插入 `<tr><td colSpan>` 展开区；卡片视图失败状态可点击展开。

- [x] **Step 1: 添加文案 key**

在 `frontend/context/LanguageContext.tsx` 的 `zh` 块末尾（`"switch_to_dark": "切换至夜间模式"` 之后）添加：

```json
        "failed_reason": "失败原因",
        "view_history_logs": "查看历史日志",
        "no_failed_detail": "无失败详情",
        "failed_at": "失败时间"
```

在 `en` 块末尾（`"switch_to_dark": "Switch to Dark Mode"` 之后）添加：

```json
        "failed_reason": "Failure Reason",
        "view_history_logs": "View History Logs",
        "no_failed_detail": "No failure detail",
        "failed_at": "Failed At"
```

注意：原末行去掉逗号后，新 key 之间用逗号分隔，最后一个 key 不带逗号。

- [x] **Step 2: 添加展开 state**

在 `frontend/app/dashboard/sign-tasks/page.tsx` 的 `const [selectionMode, setSelectionMode] = useState(false);`（:154）之后添加：

```tsx
    const [failedDetailTaskId, setFailedDetailTaskId] = useState<string | null>(null);
```

- [x] **Step 3: 表格视图失败状态可点击**

在表格视图（:851-934 区域），将失败状态 `<td>` 替换为可点击展开。定位到 :865-886 的状态单元格，替换为：

```tsx
                                                <td className="px-4 py-3">
                                                    <div className="flex items-center gap-2">
                                                        {task.last_run ? (
                                                            task.last_run.success ? (
                                                                <>
                                                                    <div className="w-2 h-2 rounded-full bg-green-500 shrink-0"></div>
                                                                    <span className="text-xs font-bold text-green-400">{t("success")}</span>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() =>
                                                                        setFailedDetailTaskId(
                                                                            failedDetailTaskId === taskId ? null : taskId
                                                                        )
                                                                    }
                                                                    className="flex items-center gap-2 hover:bg-white/5 rounded px-1 -mx-1 transition-colors"
                                                                    title={t("failed_reason")}
                                                                >
                                                                    <div className="w-2 h-2 rounded-full bg-red-500 shrink-0"></div>
                                                                    <span className="text-xs font-bold text-red-400">{t("failure")}</span>
                                                                </button>
                                                            )
                                                        ) : (
                                                            <>
                                                                <div className="w-2 h-2 rounded-full bg-gray-500 shrink-0"></div>
                                                                <span className="text-xs font-bold text-gray-400">{language === "zh" ? "未运行" : "Not run"}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </td>
```

- [x] **Step 4: 表格视图插入展开行**

在表格视图的 `</tr>`（:928）之前、`<td>操作</td>` 之后，插入展开行。将 `filteredTasks.map` 的 `return (` 块改为返回 Fragment，在 `</tr>` 前条件渲染展开行。将 :816-928 的 `<tr>...</tr>` 替换为：

```tsx
                                        return (
                                            <Fragment key={taskId}>
                                            <tr className={`hover:bg-white/5 transition-colors ${isSelected ? 'bg-[#8a3ffc]/10' : ''}`}>
                                                {/* ...原有 td 内容保持不变，仅状态单元格按 Step 3 替换... */}
                                            </tr>
                                            {failedDetailTaskId === taskId && task.last_run && !task.last_run.success && (
                                                <tr className="bg-red-500/5">
                                                    <td colSpan={selectionMode ? 8 : 7} className="px-4 py-3">
                                                        <div className="flex items-start gap-3">
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-[10px] uppercase tracking-wider text-main/40 mb-1">{t("failed_at")}</div>
                                                                <div className="text-xs font-mono text-main/70 mb-2">
                                                                    {new Date(task.last_run.time).toLocaleString(language === "zh" ? 'zh-CN' : 'en-US')}
                                                                </div>
                                                                <div className="text-xs text-red-300 break-all">
                                                                    {task.last_run.message || t("no_failed_detail")}
                                                                </div>
                                                            </div>
                                                            <button
                                                                onClick={() => handleShowTaskHistory(task)}
                                                                disabled={loading}
                                                                className="action-btn !h-7 !px-3 !text-[#8a3ffc] hover:bg-[#8a3ffc]/10 shrink-0"
                                                                title={t("view_history_logs")}
                                                            >
                                                                <ListDashes weight="bold" size={12} />
                                                                <span className="text-xs ml-1">{t("view_history_logs")}</span>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                            </Fragment>
                                        );
```

注意：原 `<tr key={taskId}>` 的 key 移到 `<Fragment key={taskId}>`，移除 `<tr>` 上的 `key`。需在文件顶部 import 中添加 `Fragment`：

```tsx
import { Fragment, useEffect, useState, useCallback, useRef, Suspense } from "react";
```

（若 `Fragment` 未在现有 import 中，加入即可。）

- [x] **Step 5: 卡片视图失败状态可点击展开**

在卡片视图（:980-1016 区域）的状态行（:982-1001），将失败状态 `<div>` 改为可点击 button，并在卡片内 `task.last_run` 区块（:1003-1015）之后插入展开内容。定位到 :982-1001，替换失败分支为：

```tsx
                                            <div className="flex items-center gap-1.5">
                                                {task.last_run ? (
                                                    task.last_run.success ? (
                                                        <>
                                                            <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                                                            <span className="font-bold text-green-400">{t("success")}</span>
                                                        </>
                                                    ) : (
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                setFailedDetailTaskId(
                                                                    failedDetailTaskId === taskId ? null : taskId
                                                                )
                                                            }
                                                            className="flex items-center gap-1.5 hover:bg-white/5 rounded px-1 -mx-1 transition-colors"
                                                            title={t("failed_reason")}
                                                        >
                                                            <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                                                            <span className="font-bold text-red-400">{t("failure")}</span>
                                                        </button>
                                                    )
                                                ) : (
                                                    <>
                                                        <div className="w-1.5 h-1.5 rounded-full bg-gray-500"></div>
                                                        <span className="font-bold text-gray-400">{language === "zh" ? "未运行" : "Not run"}</span>
                                                    </>
                                                )}
                                            </div>
```

在卡片视图 `<div className="space-y-2 mb-3 text-xs">` 区块结束（:1016）之前、`task.last_run` 区块（:1003-1015）之后，插入：

```tsx
                                        {failedDetailTaskId === taskId && task.last_run && !task.last_run.success && (
                                            <div className="bg-red-500/5 rounded-lg p-2 space-y-1">
                                                <div className="text-[10px] uppercase tracking-wider text-main/40">{t("failed_at")}</div>
                                                <div className="text-main/60 text-[10px] font-mono">
                                                    {new Date(task.last_run.time).toLocaleString(language === "zh" ? 'zh-CN' : 'en-US')}
                                                </div>
                                                <div className="text-red-300 break-all text-[11px]">
                                                    {task.last_run.message || t("no_failed_detail")}
                                                </div>
                                                <button
                                                    onClick={() => handleShowTaskHistory(task)}
                                                    disabled={loading}
                                                    className="action-btn !h-6 !px-2 !text-[#8a3ffc] hover:bg-[#8a3ffc]/10"
                                                    title={t("view_history_logs")}
                                                >
                                                    <ListDashes weight="bold" size={11} />
                                                    <span className="text-[10px] ml-1">{t("view_history_logs")}</span>
                                                </button>
                                            </div>
                                        )}
```

- [x] **Step 6: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [x] **Step 7: 手动验收 — 失败任务点击展开**

启动前后端，在任务列表点击一个失败任务的状态：
Expected: 展开显示失败时间 + `last_run.message` + 「查看历史日志」按钮；点击成功/未运行状态不展开；点击其他失败任务关闭前一个展开。

- [x] **Step 8: 提交**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx frontend/context/LanguageContext.tsx
git commit -m "feat(sign-tasks): inline expand failed reason on task list"
```

---

## Group D — 前端：批量计划后编辑加载修复（多重防御）

对应 Design Doc §3、tasks.md §4、spec Requirement「批量计划后任务可正常编辑加载」。

### Task 6: edit 页 loadTask 区分 404 与其他错误

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/edit/page.tsx:135-159`（`loadTask` 函数）
- Modify: `frontend/context/LanguageContext.tsx`（添加 `task_not_found` key）

**Interfaces:**
- Consumes: `getSignTask`（`lib/api.ts:877`，错误对象带 `err.status`）、`handleAccountSessionInvalid`。
- Produces: `loadTask` 在 `err.status === 404` 时用 `task_not_found` 文案，其他用 `task_load_failed`，均延迟 600ms 跳转返回。

- [x] **Step 1: 添加文案 key**

在 `frontend/context/LanguageContext.tsx` 的 `zh` 块中 `"task_load_failed": "加载任务失败"`（:101）之后添加：

```json
        "task_not_found": "任务不存在",
```

在 `en` 块中 `"task_load_failed": "Failed to load task"`（:496）之后添加：

```json
        "task_not_found": "Task not found",
```

- [x] **Step 2: 实现 loadTask 错误区分**

在 `frontend/app/dashboard/sign-tasks/edit/page.tsx:135-159` 的 `loadTask` 中，将 catch 块替换为：

```tsx
        } catch (err: any) {
            if (handleAccountSessionInvalid(err)) return;
            const key = err?.status === 404 ? "task_not_found" : "task_load_failed";
            addToast(formatErrorMessage(key, err), "error");
            setTimeout(() => {
                router.replace(resolveTaskFormReturnPath(fromParam, accountName));
            }, 600);
        } finally {
```

- [x] **Step 3: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [x] **Step 4: 手动验收 — 任务不存在时明确提示**

在任务列表中删除某任务后，用旧 URL 打开其编辑页：
Expected: 提示「任务不存在」并延迟返回列表，不卡在加载态。

- [x] **Step 5: 手动验收 — 批量创建时间重复同名任务可编辑**

在创建页用相同任务名、相同时间、勾选多个账号批量创建，随后在任务列表点击每个任务的编辑：
Expected: 每个任务编辑页正常加载配置，不报加载失败。

- [x] **Step 6: 提交**

```bash
git add frontend/app/dashboard/sign-tasks/edit/page.tsx frontend/context/LanguageContext.tsx
git commit -m "fix(sign-tasks): distinguish 404 from other load errors in edit page"
```

---

## Group E — 前端：排序与状态筛选持久化

对应 Design Doc §4、tasks.md §5、spec Requirement「列表排序与状态筛选在刷新后保持」。

### Task 7: sortKey/sortDir/statusFilter localStorage 持久化

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx:146-151`（state 初始化）、:182-194（视图偏好 effect 之后）

**Interfaces:**
- Consumes: 现有 `useState` 的 `sortKey`/`sortDir`/`statusFilter`/`searchQuery`。
- Produces: localStorage 键 `tg-signpulse:task-sort-key`、`tg-signpulse:task-sort-dir`、`tg-signpulse:task-status-filter`；SSR 安全；非法值回退默认。

- [x] **Step 1: 添加持久化 helper**

在 `frontend/app/dashboard/sign-tasks/page.tsx` 顶部（`type ViewMode = "card" | "table";` :132 之前）添加 helper：

```tsx
const SORT_KEY_STORAGE = "tg-signpulse:task-sort-key";
const SORT_DIR_STORAGE = "tg-signpulse:task-sort-dir";
const STATUS_FILTER_STORAGE = "tg-signpulse:task-status-filter";

const VALID_SORT_KEYS: SortKey[] = ["account", "schedule", "last_run"];
const VALID_SORT_DIRS: SortDir[] = ["asc", "desc"];
const VALID_STATUS_FILTERS: StatusFilter[] = ["all", "success", "failed", "not_run"];

function readPersisted<T extends string>(key: string, valid: T[], fallback: T): T {
    if (typeof window === "undefined") return fallback;
    try {
        const v = window.localStorage.getItem(key);
        if (v && valid.includes(v as T)) return v as T;
    } catch {
        // localStorage 不可用或被禁用
    }
    return fallback;
}

function writePersisted(key: string, value: string): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // 忽略写入失败
    }
}
```

注意：`SortKey`/`SortDir` 类型在文件 :130 附近已定义（来自 sort helpers）。如 `SortKey`/`SortDir` 在该文件之外定义，则将 helper 放在使用处之后，或调整 import 顺序。

- [x] **Step 2: 惰性初始化 state**

将 `frontend/app/dashboard/sign-tasks/page.tsx:149-151` 的三行 state 初始化：

```tsx
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [sortKey, setSortKey] = useState<SortKey>("account");
    const [sortDir, setSortDir] = useState<SortDir>("asc");
```

替换为惰性初始化：

```tsx
    const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
        readPersisted(STATUS_FILTER_STORAGE, VALID_STATUS_FILTERS, "all")
    );
    const [sortKey, setSortKey] = useState<SortKey>(() =>
        readPersisted(SORT_KEY_STORAGE, VALID_SORT_KEYS, "account")
    );
    const [sortDir, setSortDir] = useState<SortDir>(() =>
        readPersisted(SORT_DIR_STORAGE, VALID_SORT_DIRS, "asc")
    );
```

- [x] **Step 3: 添加写入 effect**

在视图偏好保存 effect（:191-194 `handleViewModeChange` 定义之后）添加：

```tsx
    useEffect(() => {
        writePersisted(SORT_KEY_STORAGE, sortKey);
    }, [sortKey]);

    useEffect(() => {
        writePersisted(SORT_DIR_STORAGE, sortDir);
    }, [sortDir]);

    useEffect(() => {
        writePersisted(STATUS_FILTER_STORAGE, statusFilter);
    }, [statusFilter]);
```

- [x] **Step 4: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [x] **Step 5: 手动验收 — 刷新后恢复排序与筛选**

在任务列表设置排序为「调度时间 / 降序」、状态筛选为「失败」，刷新页面：
Expected: 刷新后排序仍为「调度时间 / 降序」、状态筛选仍为「失败」。

- [x] **Step 6: 手动验收 — 搜索词刷新后清空**

在搜索框输入关键词筛选任务，刷新页面：
Expected: 刷新后搜索框为空，列表不按旧搜索词过滤（`searchQuery` 仍为 `useState("")`，未持久化）。

- [x] **Step 7: 提交**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "feat(sign-tasks): persist sortKey/sortDir/statusFilter to localStorage"
```

---

## Group F — 前端：筛选栏单行紧凑美化

对应 Design Doc §5、tasks.md §6、spec Requirement「任务列表筛选栏布局紧凑」。

### Task 8: 筛选栏单行紧凑布局

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/page.tsx:709-770`（筛选栏 JSX 区块）

**Interfaces:**
- Consumes: 现有 `searchQuery`/`statusFilter`/`selectedAccounts`/`sortKey`/`sortDir` 与对应 setter。
- Produces: 单行紧凑布局，搜索框 `flex-1 min-w-[200px]` + 右侧筛选组 `flex items-center gap-2 flex-wrap`；统一控件 `h-9 text-xs rounded-lg`。

- [x] **Step 1: 重构筛选栏 JSX**

将 `frontend/app/dashboard/sign-tasks/page.tsx:710-769` 的筛选栏 `<div className="glass-panel p-3 mb-6 flex flex-wrap items-center gap-3">...</div>` 替换为：

```tsx
                    <div className="glass-panel p-3 mb-6 flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                            <MagnifyingGlass weight="bold" size={16} className="text-main/40 shrink-0" />
                            <input
                                type="text"
                                placeholder={language === "zh" ? "搜索任务、账号、Chat ID..." : "Search tasks, accounts, chat ID..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-main/30 min-w-0"
                            />
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <Funnel weight="bold" size={14} className="text-main/40 shrink-0" />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                                className="bg-white/5 border border-white/10 rounded-lg h-9 px-3 text-xs font-bold hover:bg-white/10 transition-all"
                            >
                                <option value="all">{language === "zh" ? "全部状态" : "All Status"}</option>
                                <option value="success">{language === "zh" ? "成功" : "Success"}</option>
                                <option value="failed">{language === "zh" ? "失败" : "Failed"}</option>
                                <option value="not_run">{language === "zh" ? "未运行" : "Not Run"}</option>
                            </select>
                            {accounts.length > 1 && (
                                <select
                                    value={selectedAccounts.length === 1 ? selectedAccounts[0] : ""}
                                    onChange={(e) => setSelectedAccounts(e.target.value ? [e.target.value] : [])}
                                    className="bg-white/5 border border-white/10 rounded-lg h-9 px-3 text-xs font-bold hover:bg-white/10 transition-all"
                                >
                                    <option value="">{language === "zh" ? "全部账号" : "All Accounts"}</option>
                                    {accounts.map(acc => (
                                        <option key={acc.name} value={acc.name}>{acc.name}</option>
                                    ))}
                                </select>
                            )}
                            <select
                                value={sortKey}
                                onChange={(e) => handleSortKeyChange(e.target.value as SortKey)}
                                className="bg-white/5 border border-white/10 rounded-lg h-9 px-3 text-xs font-bold hover:bg-white/10 transition-all"
                                title={language === "zh" ? "排序字段" : "Sort by"}
                            >
                                <option value="account">{language === "zh" ? "账号" : "Account"}</option>
                                <option value="schedule">{language === "zh" ? "调度时间" : "Schedule"}</option>
                                <option value="last_run">{language === "zh" ? "最后运行" : "Last Run"}</option>
                            </select>
                            <button
                                type="button"
                                onClick={handleSortDirToggle}
                                className="bg-white/5 border border-white/10 rounded-lg h-9 px-2.5 text-xs font-bold hover:bg-white/10 transition-all inline-flex items-center gap-1"
                                title={sortDir === "asc"
                                    ? (language === "zh" ? "升序（点击切换为降序）" : "Ascending (click for descending)")
                                    : (language === "zh" ? "降序（点击切换为升序）" : "Descending (click for ascending)")}
                            >
                                {sortDir === "asc" ? <CaretUp weight="bold" size={12} /> : <CaretDown weight="bold" size={12} />}
                                <span>{sortDir === "asc"
                                    ? (language === "zh" ? "升序" : "Asc")
                                    : (language === "zh" ? "降序" : "Desc")}</span>
                            </button>
                        </div>
                    </div>
```

关键变更：移除所有 `py-1.5`，统一 `h-9`；搜索框 input 加 `min-w-0`；图标加 `shrink-0`。

- [x] **Step 2: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [x] **Step 3: 手动验收 — 筛选栏单行紧凑**

在任务列表查看筛选栏：
Expected: 搜索框与状态/账号/排序控件在同一行内分组排列，整体高度紧凑、视觉风格与 glass-panel 一致；窄屏下 `flex-wrap` 自适应换行。

- [x] **Step 4: 手动验收 — selectionMode 下筛选栏隐藏**

进入批量选择模式：
Expected: 筛选栏隐藏（`!selectionMode` 条件不变），批量操作栏显示，不破坏布局。

- [x] **Step 5: 提交**

```bash
git add frontend/app/dashboard/sign-tasks/page.tsx
git commit -m "style(sign-tasks): compact single-row filter bar"
```

---

## Group G — 前端：任务配置模板保存/应用/删除 UI

对应 Design Doc §6 前端部分、tasks.md §7、spec Requirement「任务配置模板可保存与一键应用」。

### Task 9: api.ts 模板客户端方法

**Files:**
- Modify: `frontend/lib/api.ts`（在 :1009 `getSignTaskHistory` 之后，文件末尾之前）

**Interfaces:**
- Consumes: `request`（:23）、`SignTaskChat`（:718）。
- Produces:
  - `interface SignTaskTemplate { name: string; chats: SignTaskChat[]; execution_mode: "fixed" | "range"; sign_at: string; range_start: string; range_end: string; random_seconds: number; sign_interval: number; updated_at?: string; }`
  - `interface SaveSignTaskTemplateRequest { name: string; chats: SignTaskChat[]; execution_mode?: "fixed" | "range"; sign_at?: string; range_start?: string; range_end?: string; random_seconds?: number; sign_interval?: number; }`
  - `listSignTaskTemplates(token: string): Promise<SignTaskTemplate[]>`
  - `saveSignTaskTemplate(token: string, data: SaveSignTaskTemplateRequest): Promise<SignTaskTemplate>`
  - `deleteSignTaskTemplate(token: string, name: string): Promise<{ ok: boolean }>`

- [x] **Step 1: 添加类型与方法**

在 `frontend/lib/api.ts` 末尾（`getSignTaskHistory` 函数之后）添加：

```tsx
// ============ 任务配置模板 ============

export interface SignTaskTemplate {
  name: string;
  chats: SignTaskChat[];
  execution_mode: "fixed" | "range";
  sign_at: string;
  range_start: string;
  range_end: string;
  random_seconds: number;
  sign_interval: number;
  updated_at?: string;
}

export interface SaveSignTaskTemplateRequest {
  name: string;
  chats: SignTaskChat[];
  execution_mode?: "fixed" | "range";
  sign_at?: string;
  range_start?: string;
  range_end?: string;
  random_seconds?: number;
  sign_interval?: number;
}

export const listSignTaskTemplates = (token: string): Promise<SignTaskTemplate[]> =>
  request<SignTaskTemplate[]>("/sign-task-templates", {}, token);

export const saveSignTaskTemplate = (
  token: string,
  data: SaveSignTaskTemplateRequest
): Promise<SignTaskTemplate> =>
  request<SignTaskTemplate>("/sign-task-templates", {
    method: "POST",
    body: JSON.stringify(data),
  }, token);

export const deleteSignTaskTemplate = (token: string, name: string): Promise<{ ok: boolean }> =>
  request<{ ok: boolean }>(`/sign-task-templates/${encodeURIComponent(name)}`, {
    method: "DELETE",
  }, token);
```

- [x] **Step 2: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功。

- [x] **Step 3: 提交**

```bash
git add frontend/lib/api.ts
git commit -m "feat(api): add sign task template client methods"
```

---

### Task 10: create 页模板保存/应用/删除 UI

**Files:**
- Modify: `frontend/app/dashboard/sign-tasks/create/page.tsx`（import 区 :6-14、state 区 :83-109、新 handler、JSX 基本配置区 :469-670 之后）
- Modify: `frontend/context/LanguageContext.tsx`（模板相关 key）

**Interfaces:**
- Consumes: `listSignTaskTemplates`/`saveSignTaskTemplate`/`deleteSignTaskTemplate`（Task 9）、`SignTaskTemplate`、`normalizeChatInterval`（:15）、`fixedTimeToCron`（:65）。
- Produces: create 页基本配置区新增「模板」区块——保存当前 chats+调度+延迟+间隔为命名模板；选择已保存模板一键填充表单；删除模板。

- [x] **Step 1: 添加文案 key**

在 `frontend/context/LanguageContext.tsx` 的 `zh` 块中 `"template_account_hint"`（:121）之后添加：

```json
        "task_template_section": "任务模板",
        "task_template_save": "保存为模板",
        "task_template_name": "模板名称",
        "task_template_name_placeholder": "输入模板名称",
        "task_template_apply": "应用模板",
        "task_template_delete": "删除模板",
        "task_template_empty": "暂无模板",
        "task_template_saved": "模板已保存",
        "task_template_applied": "模板已应用",
        "task_template_deleted": "模板已删除",
        "task_template_apply_hint": "应用模板会覆盖当前配置，可在应用后继续修改",
        "task_template_name_required": "请输入模板名称",
```

在 `en` 块中 `"template_account_hint"`（:516）之后添加：

```json
        "task_template_section": "Task Template",
        "task_template_save": "Save as Template",
        "task_template_name": "Template Name",
        "task_template_name_placeholder": "Enter template name",
        "task_template_apply": "Apply Template",
        "task_template_delete": "Delete Template",
        "task_template_empty": "No templates",
        "task_template_saved": "Template saved",
        "task_template_applied": "Template applied",
        "task_template_deleted": "Template deleted",
        "task_template_apply_hint": "Applying a template overwrites current config; you can edit further after applying",
        "task_template_name_required": "Please enter a template name",
```

- [x] **Step 2: 添加 import**

在 `frontend/app/dashboard/sign-tasks/create/page.tsx:6-14` 的 import 块中，向 `lib/api` 的导入添加模板方法：

```tsx
import {
    createSignTask,
    listAccounts,
    getAccountChats,
    searchAccountChats,
    listSignTaskTemplates,
    saveSignTaskTemplate,
    deleteSignTaskTemplate,
    AccountInfo,
    ChatInfo,
    SignTaskChat,
    SignTaskTemplate,
} from "../../../../lib/api";
```

- [x] **Step 3: 添加模板 state**

在 `frontend/app/dashboard/sign-tasks/create/page.tsx` 的 `const [editingChat, setEditingChat] = useState<EditingChatDraft | null>(null);`（:109）之后添加：

```tsx
    // 任务模板
    const [templates, setTemplates] = useState<SignTaskTemplate[]>([]);
    const [templateName, setTemplateName] = useState("");
    const [applyTemplateName, setApplyTemplateName] = useState("");
    const [templateSaving, setTemplateSaving] = useState(false);
```

- [x] **Step 4: 添加模板 handlers**

在 `frontend/app/dashboard/sign-tasks/create/page.tsx` 的 `handleRefreshChats`（:265-274）之前添加：

```tsx
    const loadTemplates = useCallback(async () => {
        if (!token) return;
        try {
            const data = await listSignTaskTemplates(token);
            setTemplates(data);
        } catch (err: any) {
            // 模板加载失败不阻塞主流程
        }
    }, [token]);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    const handleSaveTemplate = async () => {
        if (!token) return;
        const name = templateName.trim();
        if (!name) {
            addToast(t("task_template_name_required"), "error");
            return;
        }
        try {
            setTemplateSaving(true);
            const normalizedChats = chats.map((c) => normalizeChatInterval(c));
            await saveSignTaskTemplate(token, {
                name,
                chats: normalizedChats,
                execution_mode: executionMode,
                sign_at: fixedTimeToCron(signAt),
                range_start: rangeStart,
                range_end: rangeEnd,
                random_seconds: randomSeconds,
                sign_interval: signInterval,
            });
            addToast(t("task_template_saved"), "success");
            setTemplateName("");
            await loadTemplates();
        } catch (err: any) {
            addToast(formatErrorMessage("create_failed", err), "error");
        } finally {
            setTemplateSaving(false);
        }
    };

    const handleApplyTemplate = async (name: string) => {
        const template = templates.find((t) => t.name === name);
        if (!template) return;
        setApplyTemplateName(name);
        // 应用模板覆盖 chats + 调度 + 延迟 + 间隔；保留 selectedAccount
        setExecutionMode(template.execution_mode === "range" ? "range" : "fixed");
        if (template.execution_mode === "range") {
            setRangeStart(template.range_start || "09:00");
            setRangeEnd(template.range_end || "18:00");
        }
        setSignAt(cronToFixedTime(template.sign_at || ""));
        setRandomSeconds(template.random_seconds ?? 0);
        setSignInterval(template.sign_interval ?? 1);
        setChats((template.chats || []).map((c) => normalizeChatInterval(c)));
        addToast(t("task_template_applied"), "success");
    };

    const handleDeleteTemplate = async (name: string) => {
        if (!token) return;
        try {
            await deleteSignTaskTemplate(token, name);
            addToast(t("task_template_deleted"), "success");
            if (applyTemplateName === name) setApplyTemplateName("");
            await loadTemplates();
        } catch (err: any) {
            addToast(formatErrorMessage("create_failed", err), "error");
        }
    };
```

注意：`cronToFixedTime` 已在 edit 页定义，create 页需在文件顶部添加同名 helper（与 :65 的 `fixedTimeToCron` 同级）：

```tsx
function cronToFixedTime(cron: string): string {
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

- [x] **Step 5: 添加模板 UI 区块**

在 `frontend/app/dashboard/sign-tasks/create/page.tsx` 基本配置 `</section>`（:670）之后、`<TargetChatList .../>`（:672）之前，插入模板区块：

```tsx
                    {/* 任务模板 */}
                    <section className="glass-panel p-6 space-y-4">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-[#8a3ffc]/10 rounded-lg text-[#b57dff]">
                                <Lightning weight="fill" size={18} />
                            </div>
                            <h2 className="text-lg font-bold">{t("task_template_section")}</h2>
                        </div>

                        {/* 保存为模板 */}
                        <div className="flex items-center gap-2 flex-wrap">
                            <input
                                className="!mb-0 flex-1 min-w-[160px]"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                placeholder={t("task_template_name_placeholder")}
                            />
                            <button
                                onClick={handleSaveTemplate}
                                disabled={templateSaving || chats.length === 0}
                                className="btn-secondary"
                                title={t("task_template_save")}
                            >
                                {templateSaving ? <Spinner className="animate-spin" weight="bold" /> : t("task_template_save")}
                            </button>
                        </div>

                        {/* 应用 / 删除模板 */}
                        {templates.length > 0 ? (
                            <div className="space-y-2">
                                <p className="text-xs text-main/40">{t("task_template_apply_hint")}</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                    <select
                                        className="!mb-0 flex-1 min-w-[160px]"
                                        value={applyTemplateName}
                                        onChange={(e) => handleApplyTemplate(e.target.value)}
                                    >
                                        <option value="">{t("task_template_empty")}</option>
                                        {templates.map((tpl) => (
                                            <option key={tpl.name} value={tpl.name}>{tpl.name}</option>
                                        ))}
                                    </select>
                                    {applyTemplateName && (
                                        <button
                                            onClick={() => handleDeleteTemplate(applyTemplateName)}
                                            className="action-btn !h-9 status-action-danger"
                                            title={t("task_template_delete")}
                                        >
                                            <Trash weight="bold" size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <p className="text-xs text-main/40">{t("task_template_empty")}</p>
                        )}
                    </section>
```

确保 `Trash` 图标已在 import 中（page.tsx 顶部 `@phosphor-icons/react` import 应已含 `Trash`，若无需补加）。

- [x] **Step 6: 验证构建通过**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [x] **Step 7: 手动验收 — 保存→应用→手动改→提交链路**

在创建页填写 chats + 调度 + 延迟 + 间隔，保存为模板，刷新页面后选择该模板应用：
Expected: 表单被填充为模板内容，可继续修改任意字段后再提交创建，不自动创建任务。

- [x] **Step 8: 手动验收 — 删除模板不影响已建任务**

创建一个基于模板的任务，然后删除该模板：
Expected: 模板从列表移除；已创建任务不受影响。

- [x] **Step 9: 提交**

```bash
git add frontend/app/dashboard/sign-tasks/create/page.tsx frontend/context/LanguageContext.tsx
git commit -m "feat(sign-tasks): template save/apply/delete UI on create page"
```

---

## Group H — 验收与收尾

对应 tasks.md §8。

### Task 11: 全量验收与构建检查

**Files:** 无（仅验收与运行检查）。

- [x] **Step 1: 运行全部后端测试**

Run: `pytest backend/services/test_sign_tasks_history.py backend/services/test_sign_task_templates.py -v`
Expected: 全部通过（12 个测试）。

- [x] **Step 2: 运行前端构建/类型检查**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TypeScript 错误。

- [x] **Step 3: 手动验收 6 项需求场景**

对照 spec `docs/openspec/changes/task-center-optimization/specs/task-center/spec.md` 逐项验收：

1. 删除任务后重建同名任务不显示旧运行记录（Spec: 「删除任务后重建同名任务不显示旧运行记录」）。
2. 跨账号同名任务互不串读历史（Spec: 「跨账号同名任务互不串读历史」）。
3. 失败任务点击展开显示失败原因 + 历史入口（Spec: 「点击失败任务展开失败原因」）。
4. 批量创建时间重复同名任务后可编辑（Spec: 「批量创建时间重复的同名任务后可编辑」）。
5. 刷新后恢复排序与状态筛选，搜索词清空（Spec: 「刷新页面后恢复排序与筛选」+「搜索词刷新后清空」）。
6. 筛选栏单行紧凑呈现（Spec: 「筛选栏单行紧凑呈现」）。
7. 模板保存→应用→手动改→提交链路，删除模板不影响已建任务（Spec: 三个模板场景）。

Expected: 全部通过。

- [x] **Step 4: 检查 git 状态**

Run: `git status`
Expected: 工作区干净，所有改动已提交。

- [x] **Step 5: 更新 CHANGELOG（如项目惯例要求）**

检查项目根目录是否存在 `CHANGELOG.md`：
- 若存在且项目惯例要求记录，追加本次变更条目。
- 若不存在或不要求，跳过此步。

---

## Self-Review 记录

**1. Spec 覆盖核对：**
- 「新任务不得显示历史运行记录」→ Task 1（清理 history）+ Task 2（回退收敛），覆盖删除重建与跨账号两个 Scenario。
- 「失败任务可查看失败原因」→ Task 5，覆盖展开失败原因与历史入口、成功/未运行不展开。
- 「批量计划后任务可正常编辑加载」→ Task 6，覆盖批量编辑加载与 404 明确提示。
- 「列表排序与状态筛选在刷新后保持」→ Task 7，覆盖刷新恢复与搜索词不持久化。
- 「任务列表筛选栏布局紧凑」→ Task 8，覆盖单行紧凑与 glass-panel 一致。
- 「任务配置模板可保存与一键应用」→ Task 3（后端服务）+ Task 4（路由）+ Task 9（前端 API）+ Task 10（前端 UI），覆盖保存、应用后可编辑、删除不影响任务。
- 无遗漏 spec 需求。

**2. 占位符扫描：** 无 TBD/TODO/"add appropriate error handling" 等占位符；所有代码步骤含完整代码。

**3. 类型一致性核对：**
- `SignTaskTemplate` 在 Task 9（api.ts）定义，Task 10（create/page.tsx）import 使用，字段 `name/chats/execution_mode/sign_at/range_start/range_end/random_seconds/sign_interval/updated_at` 一致。
- `SignTaskTemplateService.save_template(name, config)` 在 Task 3 定义，Task 4 路由调用，参数一致。
- `get_sign_task_template_service()` 在 Task 3 末尾定义，Task 4 路由使用。
- `_history_file_path`/`_safe_history_key` 在 Task 1/2 使用，与现有 :245/:242 签名一致。
- `failedDetailTaskId` 在 Task 5 定义并在表格/卡片视图一致使用。
- `cronToFixedTime` 在 Task 10 Step 4 为 create 页添加（edit 页已有），与 edit 页 :52 签名一致。

**4. 任务边界合理性：**
- Task 1 与 Task 2 共享测试文件但任务边界清晰（删除清理 vs 回退收敛），各自有独立测试与提交。
- Task 3 与 Task 4 是后端模板的服务层与路由层，独立可测。
- Task 5/6/7/8 是前端 page.tsx/edit.tsx 的独立改动，各自有独立构建验证与提交。
- Task 9/10 是前端模板的 API 层与 UI 层，Task 9 先于 Task 10（Task 10 依赖 Task 9 的方法）。

**5. 依赖顺序：**
- Group A（Task 1-2）独立，无前端依赖。
- Group B（Task 3-4）独立，Task 4 依赖 Task 3。
- Group C-F（Task 5-8）均修改 page.tsx，建议按顺序执行以减少冲突；Task 5 与 Task 7/8 均改 page.tsx 但改动区域不同（state/表格/卡片 vs 筛选栏）。
- Group G（Task 9-10）依赖 Group B 的后端 API（Task 4）运行；Task 10 依赖 Task 9。
- Group H（Task 11）依赖全部前置任务完成。
