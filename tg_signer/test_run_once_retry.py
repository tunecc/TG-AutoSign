"""run_once 在 OSError（含 TimeoutError）下的重试上限回归测试。

背景：normal_run 的执行循环 except (OSError, errors.Unauthorized) 会无限 continue。
Python 3.11+ 起 asyncio.TimeoutError 是内建 TimeoutError 的别名，而内建 TimeoutError
是 OSError 的子类（Docker 镜像为 python:3.12-slim），签到阶段的 "Request timed out"
会被吞进无限 30 秒重试：run_once 永不返回，账号锁被永久占用，同账号后续任务全部
"等待账号空闲超时"失败，run-status 永远显示执行中。
"""

import asyncio

import pytest

from tg_signer.core import UserSigner


class _FakeAsyncCM:
    """极简 async 上下文：可选地在 __aenter__ 抛出指定异常并计数。"""

    in_memory = False
    session_string = None

    def __init__(self, exc=None):
        self.exc = exc
        self.enter_count = 0

    async def __aenter__(self):
        self.enter_count += 1
        if self.exc is not None:
            raise self.exc
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeConfig:
    requires_ai = False
    chats = []
    sign_at = "0 0 * * *"
    random_seconds = 0
    requires_updates = False


def _make_signer(monkeypatch, tmp_path, app):
    signer = object.__new__(UserSigner)
    signer.task_name = "t"
    signer._account = "acc"
    signer.user = object()  # 非None，跳过 login
    signer.app = app
    signer._session_dir = tmp_path
    monkeypatch.setattr(
        UserSigner, "load_config", lambda self, cfg_cls=None: _FakeConfig()
    )
    monkeypatch.setattr(UserSigner, "load_sign_record", lambda self: {})
    monkeypatch.setattr(UserSigner, "_session_file_lock", lambda self: _FakeAsyncCM())
    monkeypatch.setattr(
        UserSigner,
        "sign_record_file",
        property(lambda self: tmp_path / "sign_record.json"),
    )
    return signer


_REAL_SLEEP = asyncio.sleep


def test_run_once_raises_after_limited_retries(monkeypatch, tmp_path):
    """run_once 遇到持续 TimeoutError 应在有限次重试后上抛，而不是无限循环。"""
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > 10:
            # 防御：当前实现无限重试时快速失败，避免测试挂死
            raise RuntimeError("疑似无限重试：sleep 次数超出预期")

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    app = _FakeAsyncCM(exc=TimeoutError("Request timed out"))
    signer = _make_signer(monkeypatch, tmp_path, app)

    async def scenario():
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                signer.run_once(num_of_dialogs=5), timeout=5.0
            )

    asyncio.run(scenario())
    # 1 次原始尝试 + 2 次重试 = 3 次进入执行块，2 次退避
    assert app.enter_count == 3
    assert len(sleeps) == 2


def test_daemon_mode_keeps_retrying(monkeypatch, tmp_path):
    """only_once=False（CLI run 守护模式）保持原有无限重试语义。"""
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        # 必须真实让出控制权，否则无限重试循环会饿死事件循环，wait_for 无法触发超时
        await _REAL_SLEEP(0)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    app = _FakeAsyncCM(exc=TimeoutError("Request timed out"))
    signer = _make_signer(monkeypatch, tmp_path, app)

    async def scenario():
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(
                signer.run(num_of_dialogs=5, only_once=False, force_rerun=False),
                timeout=1.0,
            )

    asyncio.run(scenario())
    # 守护模式在窗口期内持续重试，从未上抛业务异常
    assert app.enter_count >= 5
