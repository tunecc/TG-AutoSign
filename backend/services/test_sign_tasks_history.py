import json
import os
import time
from datetime import datetime, timedelta
from pathlib import Path

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


# ---------- _cleanup_old_logs 按条目时间裁剪 ----------


def _iso_days_ago(days: int) -> str:
    return (datetime.now() - timedelta(days=days)).isoformat()


def test_cleanup_trims_old_entries_keeps_recent(tmp_path, monkeypatch):
    """混合新旧条目：清理后只保留 3 天内条目，文件不删除。"""
    _real_cleanup = SignTaskService._cleanup_old_logs
    service = _make_service(tmp_path, monkeypatch)
    # _make_service 将 _cleanup_old_logs 置为 no-op 以跳过 __init__ 清理；
    # 本组测试需要调用真实实现，先保存再恢复
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", _real_cleanup)
    history_file = service._history_file_path("taskT", "accA")
    history_file.write_text(
        json.dumps(
            [
                {"time": _iso_days_ago(1), "success": True, "message": "recent"},
                {"time": _iso_days_ago(5), "success": False, "message": "old"},
            ]
        ),
        encoding="utf-8",
    )

    service._cleanup_old_logs()

    assert history_file.exists()
    data = json.loads(history_file.read_text(encoding="utf-8"))
    assert [e["message"] for e in data] == ["recent"]


def test_cleanup_removes_file_when_all_entries_old(tmp_path, monkeypatch):
    """全部条目超过 3 天：文件删除。"""
    _real_cleanup = SignTaskService._cleanup_old_logs
    service = _make_service(tmp_path, monkeypatch)
    # _make_service 将 _cleanup_old_logs 置为 no-op 以跳过 __init__ 清理；
    # 本组测试需要调用真实实现，先保存再恢复
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", _real_cleanup)
    history_file = service._history_file_path("taskT", "accA")
    history_file.write_text(
        json.dumps([{"time": _iso_days_ago(5), "success": False, "message": "old"}]),
        encoding="utf-8",
    )

    service._cleanup_old_logs()

    assert not history_file.exists()


def test_cleanup_keeps_entries_with_missing_or_invalid_time(tmp_path, monkeypatch):
    """条目时间缺失/无法解析：保守保留，由条数上限兜底。"""
    _real_cleanup = SignTaskService._cleanup_old_logs
    service = _make_service(tmp_path, monkeypatch)
    # _make_service 将 _cleanup_old_logs 置为 no-op 以跳过 __init__ 清理；
    # 本组测试需要调用真实实现，先保存再恢复
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", _real_cleanup)
    history_file = service._history_file_path("taskT", "accA")
    history_file.write_text(
        json.dumps(
            [
                {"success": True, "message": "no-time"},
                {"time": "not-a-date", "success": True, "message": "bad-time"},
                {"time": _iso_days_ago(1), "success": True, "message": "recent"},
                {"time": _iso_days_ago(5), "success": True, "message": "old"},
            ]
        ),
        encoding="utf-8",
    )

    service._cleanup_old_logs()

    data = json.loads(history_file.read_text(encoding="utf-8"))
    assert [e["message"] for e in data] == ["no-time", "bad-time", "recent"]


def test_cleanup_falls_back_to_mtime_for_corrupt_file(tmp_path, monkeypatch):
    """损坏 JSON 文件：退回按 mtime 删除（旧 mtime 删、新 mtime 留）。"""
    _real_cleanup = SignTaskService._cleanup_old_logs
    service = _make_service(tmp_path, monkeypatch)
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", _real_cleanup)
    old_file = service._history_file_path("taskOld", "accA")
    old_file.write_text("{not-json", encoding="utf-8")
    fresh_file = service._history_file_path("taskFresh", "accA")
    fresh_file.write_text("{not-json", encoding="utf-8")

    four_days_ago = time.time() - 4 * 24 * 3600
    os.utime(old_file, (four_days_ago, four_days_ago))

    service._cleanup_old_logs()

    assert not old_file.exists()
    assert fresh_file.exists()


# ---------- update_task 重命名迁移历史 ----------


def test_update_task_migrates_history_on_rename(tmp_path, monkeypatch):
    """重命名任务时账号作用域 history 文件跟随迁移，last_run 可恢复。"""
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")
    history_file = _write_history(service, "accA", "taskT")

    updated = service.update_task("taskT", account_name="accA", new_task_name="taskNew")

    assert updated["name"] == "taskNew"
    new_history = service._history_file_path("taskNew", "accA")
    assert new_history.exists()
    assert not history_file.exists()
    data = json.loads(new_history.read_text(encoding="utf-8"))
    assert data[0]["message"] == "ok"

    tasks = service.list_tasks(force_refresh=True)
    task = next(t for t in tasks if t["name"] == "taskNew")
    assert task["last_run"] is not None


def test_update_task_migrates_legacy_history_on_rename(tmp_path, monkeypatch):
    """重命名任务时 legacy history 文件迁移到账号作用域新名。"""
    service = _make_service(tmp_path, monkeypatch)
    _create_task(service, "accA", "taskT")
    legacy_file = service.run_history_dir / f"{service._safe_history_key('taskT')}.json"
    legacy_file.write_text(
        json.dumps([{"time": "2026-10-01T00:00:00", "success": True, "message": "legacy-ok"}]),
        encoding="utf-8",
    )

    service.update_task("taskT", account_name="accA", new_task_name="taskNew")

    assert not legacy_file.exists()
    migrated = service._history_file_path("taskNew", "accA")
    assert migrated.exists()
    data = json.loads(migrated.read_text(encoding="utf-8"))
    assert data[0]["message"] == "legacy-ok"


def test_get_task_returns_none_for_malformed_interval(tmp_path, monkeypatch):
    """畸形动作间隔配置：get_task 返回 None（404 语义），不得上抛变成 500。"""
    service = _make_service(tmp_path, monkeypatch)
    task_dir = service.signs_dir / "accA" / "taskT"
    task_dir.mkdir(parents=True)
    (task_dir / "config.json").write_text(
        json.dumps(
            {
                "name": "taskT",
                "account_name": "accA",
                "sign_at": "0 0 * * *",
                "chats": [
                    {
                        "chat_id": 1,
                        "actions": [],
                        "action_interval_mode": "random",
                        "action_interval_min_ms": 500,
                        "action_interval_max_ms": 100,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    assert service.get_task("taskT", account_name="accA") is None
