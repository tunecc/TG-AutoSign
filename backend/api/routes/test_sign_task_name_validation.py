"""任务名称校验回归测试。

背景：SignTaskCreate 的 pydantic 校验只拦截 <>:"/\\|?* 与空名，不拦 #、%、..、\\x00；
update 路由的校验集合又与 create 不一致。含 # 的任务名会被未编码的前端路径拼接截断，
导致编辑页 404"任务不存在"。
"""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.routes.sign_tasks import SignTaskCreate, get_current_user, router


def _make_client() -> TestClient:
    app = FastAPI()
    # 真实应用以 /sign-tasks 前缀挂载；router 根路径为 ""，无前缀会触发 FastAPI 校验错误
    app.include_router(router, prefix="/sign-tasks")
    app.dependency_overrides[get_current_user] = lambda: object()
    return TestClient(app)


def _create_payload(name: str) -> dict:
    return {
        "name": name,
        "account_name": "acc",
        "sign_at": "0 0 6 * * *",
        "chats": [],
    }


BAD_NAMES = [
    "签到#1",  # 片段分隔符，破坏未编码 URL 路径
    "100%",  # 非法百分号转义
    "..",  # 路径逃逸
    "a/../b",  # 路径逃逸
    "a\x00b",  # NUL
]


@pytest.mark.parametrize("bad_name", BAD_NAMES)
def test_create_rejects_url_and_path_unsafe_names(bad_name):
    with pytest.raises(ValidationError):
        SignTaskCreate(**_create_payload(bad_name))


@pytest.mark.parametrize(
    "good_name", ["qd", "每日签到", "🤖 短信轰炸机", "task+1", "a.b"]
)
def test_create_accepts_normal_names(good_name):
    model = SignTaskCreate(**_create_payload(good_name))
    assert model.name == good_name


@pytest.mark.parametrize("bad_name", BAD_NAMES)
def test_update_route_rejects_url_and_path_unsafe_names(bad_name):
    client = _make_client()
    resp = client.put(
        "/sign-tasks/old-name",
        json={"name": bad_name},
    )
    assert resp.status_code == 400
    assert "任务名称无效" in resp.json()["detail"]
