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
