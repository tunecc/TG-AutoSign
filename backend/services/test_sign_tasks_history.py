import json
from pathlib import Path

import pytest

from backend.services.sign_tasks import SignTaskService


def _make_service(tmp_path: Path, monkeypatch) -> SignTaskService:
    # SignTaskService.__init__ 内部局部 import get_settings，必须 patch 真实源并清缓存
    # 才能让 resolve_workdir 指向 tmp_path，避免共享 .signer 导致跨测试目录冲突
    import backend.core.config as _cfg

    _cfg.get_settings.cache_clear()
    monkeypatch.setattr(_cfg, "get_settings", lambda: _FakeSettings(tmp_path))
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
