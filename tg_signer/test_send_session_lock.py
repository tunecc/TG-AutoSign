"""send_text / send_dice_cli 会话文件锁回归测试。

背景：web/CLI 发消息路径直接 `async with self.app` 打开 session，与正在执行的
签到任务并发时会触发 "database is locked"。e45902a 的会话锁只覆盖了签到执行、
登录探测与聊天刷新，send 路径遗漏。
"""

import asyncio

from tg_signer.core import UserSigner


class _CountingAsyncCM:
    in_memory = False
    session_string = None

    def __init__(self):
        self.enter_count = 0

    async def __aenter__(self):
        self.enter_count += 1
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _make_signer(monkeypatch, tmp_path, app, lock):
    signer = object.__new__(UserSigner)
    signer.task_name = "t"
    signer._account = "acc"
    signer.user = object()  # 默认跳过 login
    signer.app = app
    signer._session_dir = tmp_path
    monkeypatch.setattr(UserSigner, "_session_file_lock", lambda self: lock)
    return signer


def test_send_text_holds_session_lock(monkeypatch, tmp_path):
    lock = _CountingAsyncCM()
    app = _CountingAsyncCM()
    signer = _make_signer(monkeypatch, tmp_path, app, lock)
    sent = {}

    async def fake_send_message(self, chat_id, text, delete_after=None, **kwargs):
        sent["args"] = (chat_id, text, delete_after)
        # 发送动作执行期间会话锁必须已被持有
        assert lock.enter_count == 1

    monkeypatch.setattr(UserSigner, "send_message", fake_send_message)

    asyncio.run(signer.send_text(123, "hi", delete_after=7))

    assert sent["args"] == (123, "hi", 7)
    assert lock.enter_count == 1
    assert app.enter_count == 1


def test_send_text_locks_around_lazy_login(monkeypatch, tmp_path):
    lock = _CountingAsyncCM()
    app = _CountingAsyncCM()
    signer = _make_signer(monkeypatch, tmp_path, app, lock)
    signer.user = None  # 触发惰性 login

    async def fake_login(self, *args, **kwargs):
        assert lock.enter_count == 1, "login 必须在会话锁内执行"

    async def fake_send_message(self, chat_id, text, delete_after=None, **kwargs):
        assert lock.enter_count == 1

    monkeypatch.setattr(UserSigner, "login", fake_login)
    monkeypatch.setattr(UserSigner, "send_message", fake_send_message)

    asyncio.run(signer.send_text(123, "hi"))

    assert lock.enter_count == 1


def test_send_dice_cli_holds_session_lock(monkeypatch, tmp_path):
    lock = _CountingAsyncCM()
    app = _CountingAsyncCM()
    signer = _make_signer(monkeypatch, tmp_path, app, lock)
    sent = {}

    async def fake_send_dice(self, chat_id, emoji="🎲", delete_after=None, **kwargs):
        sent["args"] = (chat_id, emoji)
        assert lock.enter_count == 1

    monkeypatch.setattr(UserSigner, "send_dice", fake_send_dice)

    asyncio.run(signer.send_dice_cli(456, "🎯"))

    assert sent["args"] == (456, "🎯")
    assert lock.enter_count == 1
    assert app.enter_count == 1
