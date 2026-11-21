import json
from pathlib import Path

import pytest

from backend.services.sign_tasks import SignTaskService


def _make_service(tmp_path: Path, monkeypatch) -> SignTaskService:
    # 与 test_sign_tasks_history 相同的隔离方式：SignTaskService.__init__ 内部
    # 局部 import get_settings，必须 patch 真实源并清缓存才能指向 tmp_path
    import backend.core.config as _cfg

    _cfg.get_settings.cache_clear()
    monkeypatch.setattr(_cfg, "get_settings", lambda: _FakeSettings(tmp_path))
    monkeypatch.setattr(
        "backend.services.sign_tasks.get_sign_task_runtime_config",
        lambda: _FakeRuntimeConfig(),
    )
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


def _default_bots():
    return [
        {
            "name": "蓝色",
            "chat_id": 7460869927,
            "commands": ["/qd", "/hz 15070527892 5"],
        },
        {"name": "金鼎", "chat_id": 5969411283, "commands": ["/qd", "/hz 15070527892 5"]},
        {"name": "绿色", "chat_id": 6379863842, "commands": ["/qd", "/hz 15070527892 5"]},
    ]


def test_quick_create_creates_task_per_account_with_bot_chats(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)

    result = service.quick_create_tasks(
        accounts=["accA", "accB"],
        bots=_default_bots(),
    )

    assert result["failed"] == []
    assert len(result["created"]) == 2

    for task in result["created"]:
        # 每小时触发（6 段 cron：秒 分 时），随机延迟钳制到 3600 -> 3000 秒
        assert task["sign_at"] == "0 0 * * * *"
        assert task["random_seconds"] == 3000
        assert task["sign_interval"] == 60
        assert task["execution_mode"] == "fixed"
        assert len(task["chats"]) == 3

        first_chat = task["chats"][0]
        assert first_chat["chat_id"] == 7460869927
        assert first_chat["name"] == "蓝色"
        assert first_chat["actions"] == [
            {"action": 1, "text": "/qd"},
            {"action": 1, "text": "/hz 15070527892 5"},
        ]
        # 动作间隔为 random 模式，默认 60~600 秒（毫秒存储）
        assert first_chat["action_interval_mode"] == "random"
        assert first_chat["action_interval_min_ms"] == 60000
        assert first_chat["action_interval_max_ms"] == 600000

        config_file = (
            service.signs_dir / task["account_name"] / task["name"] / "config.json"
        )
        assert config_file.exists()
        stored = json.loads(config_file.read_text(encoding="utf-8"))
        assert stored["sign_at"] == "0 0 * * * *"
        assert stored["random_seconds"] == 3000
        assert stored["chats"][0]["action_interval_mode"] == "random"

    names = {task["name"] for task in result["created"]}
    assert names == {"快速签到-accA", "快速签到-accB"}


def test_quick_create_frequency_two_hours_clamps_random_delay(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)

    result = service.quick_create_tasks(
        accounts=["accA"],
        bots=_default_bots(),
        frequency_hours=2,
    )

    assert result["failed"] == []
    task = result["created"][0]
    # 每 2 小时触发一次，随机延迟上限取 min(3600, 2*3600-600)=3600，不超过触发间隔
    assert task["sign_at"] == "0 0 */2 * * *"
    assert task["random_seconds"] == 3600


def test_quick_create_custom_interval_range_applied(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)

    result = service.quick_create_tasks(
        accounts=["accA"],
        bots=_default_bots(),
        interval_min_seconds=30,
        interval_max_seconds=120,
    )

    assert result["failed"] == []
    for chat in result["created"][0]["chats"]:
        assert chat["action_interval_mode"] == "random"
        assert chat["action_interval_min_ms"] == 30000
        assert chat["action_interval_max_ms"] == 120000


def test_quick_create_reports_existing_task_as_failed(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    service.create_task(
        task_name="快速签到-accA",
        account_name="accA",
        sign_at="0 0 * * * *",
        chats=[{"chat_id": 1, "actions": [{"action": 1, "text": "/qd"}]}],
        random_seconds=0,
        sign_interval=60,
    )

    result = service.quick_create_tasks(
        accounts=["accA", "accB"],
        bots=_default_bots(),
    )

    # 已存在的任务按账号报告失败，其余账号仍创建成功
    assert len(result["created"]) == 1
    assert result["created"][0]["account_name"] == "accB"
    assert len(result["failed"]) == 1
    assert result["failed"][0]["account_name"] == "accA"
    assert "已存在" in result["failed"][0]["error"]


def test_quick_create_invalid_interval_rejected_before_creating(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)

    with pytest.raises(ValueError):
        service.quick_create_tasks(
            accounts=["accA"],
            bots=_default_bots(),
            interval_min_seconds=700,
            interval_max_seconds=600,
        )

    assert list((service.signs_dir / "accA").glob("*")) == []


def test_quick_create_rejects_empty_inputs(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)

    with pytest.raises(ValueError):
        service.quick_create_tasks(accounts=[], bots=_default_bots())
    with pytest.raises(ValueError):
        service.quick_create_tasks(accounts=["accA"], bots=[])
    with pytest.raises(ValueError):
        service.quick_create_tasks(
            accounts=["accA"],
            bots=[{"name": "蓝色", "chat_id": 1, "commands": ["  "]}],
        )
    with pytest.raises(ValueError):
        service.quick_create_tasks(accounts=["accA"], bots=_default_bots(), frequency_hours=0)
