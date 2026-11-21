"""快速创建签到任务的请求校验与路由行为回归测试。

覆盖 QuickCreateSignTaskRequest 的 pydantic 校验与 quick-create 路由的
批量创建/部分失败响应结构（不触发真实调度器与 Telegram 客户端）。
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.routes.sign_tasks import (
    QuickCreateSignTaskRequest,
    get_current_user,
    router,
)
from backend.services.sign_tasks import get_sign_task_service


def _make_client() -> TestClient:
    app = FastAPI()
    # 真实应用以 /sign-tasks 前缀挂载；router 根路径为 ""，无前缀会触发 FastAPI 校验错误
    app.include_router(router, prefix="/sign-tasks")
    app.dependency_overrides[get_current_user] = lambda: object()
    return TestClient(app)


def _payload(**overrides) -> dict:
    base = {
        "accounts": ["accA", "accB"],
        "bots": [
            {
                "name": "蓝色",
                "chat_id": 7460869927,
                "commands": ["/qd", "/hz 15070527892 5"],
            }
        ],
    }
    base.update(overrides)
    return base


def test_quick_create_request_defaults():
    req = QuickCreateSignTaskRequest(**_payload())
    assert req.frequency_hours == 1
    assert req.random_delay_seconds == 3600
    assert req.interval_min_seconds == 60
    assert req.interval_max_seconds == 600
    assert req.task_name_prefix == "快速签到"


def test_quick_create_request_rejects_bad_inputs():
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(**_payload(bots=[]))
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(**_payload(frequency_hours=0))
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(**_payload(interval_min_seconds=700, interval_max_seconds=600))
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(**_payload(random_delay_seconds=0))
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(
            **_payload(bots=[{"name": "蓝色", "chat_id": 1, "commands": []}])
        )
    with pytest.raises(ValidationError):
        QuickCreateSignTaskRequest(**_payload(task_name_prefix="a/../b"))


def test_quick_create_route_creates_and_reports_partial_failures(tmp_path, monkeypatch):
    # 隔离服务目录
    import backend.core.config as _cfg
    from backend.services.sign_tasks import SignTaskService

    class _FakeSettings:
        def __init__(self, workdir):
            self._workdir = workdir

        def resolve_workdir(self):
            return self._workdir

    class _FakeRuntimeConfig:
        account_cooldown_seconds = 0
        history_max_entries = 50
        history_max_flow_lines = 500
        history_max_line_chars = 500
        history_max_message_events = 100

    _cfg.get_settings.cache_clear()
    monkeypatch.setattr(_cfg, "get_settings", lambda: _FakeSettings(tmp_path))
    monkeypatch.setattr(
        "backend.services.sign_tasks.get_sign_task_runtime_config",
        lambda: _FakeRuntimeConfig(),
    )
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", lambda self: None)

    # 预置一个同名任务，制造 accA 的部分失败场景；并阻断批量后的调度器同步
    service = get_sign_task_service()
    service.create_task(
        task_name="快速签到-accA",
        account_name="accA",
        sign_at="0 0 * * * *",
        chats=[{"chat_id": 1, "actions": [{"action": 1, "text": "/qd"}]}],
        random_seconds=0,
        sign_interval=60,
    )

    import backend.api.routes.sign_tasks  # noqa: F401  确保路由模块已加载

    async def _no_sync():
        return None

    # 路由内在调用时执行 `from backend.scheduler import sync_jobs`，
    # patch 源模块属性即可拦截批量创建后的调度同步
    monkeypatch.setattr("backend.scheduler.sync_jobs", _no_sync)

    client = _make_client()
    resp = client.post("/sign-tasks/quick-create", json=_payload())
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data["created"]) == 1
    assert data["created"][0]["account_name"] == "accB"
    assert data["created"][0]["sign_at"] == "0 0 * * * *"
    assert data["created"][0]["chats"][0]["chat_id"] == 7460869927
    assert len(data["failed"]) == 1
    assert data["failed"][0]["account_name"] == "accA"
    assert "已存在" in data["failed"][0]["error"]


def test_quick_create_route_rejects_invalid_interval(tmp_path, monkeypatch):
    import backend.core.config as _cfg
    from backend.services.sign_tasks import SignTaskService

    class _FakeSettings:
        def __init__(self, workdir):
            self._workdir = workdir

        def resolve_workdir(self):
            return self._workdir

    class _FakeRuntimeConfig:
        account_cooldown_seconds = 0
        history_max_entries = 50
        history_max_flow_lines = 500
        history_max_line_chars = 500
        history_max_message_events = 100

    _cfg.get_settings.cache_clear()
    monkeypatch.setattr(_cfg, "get_settings", lambda: _FakeSettings(tmp_path))
    monkeypatch.setattr(
        "backend.services.sign_tasks.get_sign_task_runtime_config",
        lambda: _FakeRuntimeConfig(),
    )
    monkeypatch.setattr(SignTaskService, "_cleanup_old_logs", lambda self: None)

    client = _make_client()
    resp = client.post(
        "/sign-tasks/quick-create",
        json=_payload(interval_min_seconds=700, interval_max_seconds=600),
    )
    # pydantic 校验先拦截，返回 422
    assert resp.status_code == 422
