import asyncio
from contextlib import nullcontext

import pytest

from tg_signer.session_lock import (
    DEFAULT_SESSION_FILE_LOCK_TIMEOUT,
    SessionFileLockTimeout,
    _SessionFileLock,
    resolve_lock_timeout,
    session_file_lock,
    session_file_lock_for_client,
)

try:
    import fcntl  # noqa: F401

    FCNTL_AVAILABLE = True
except ImportError:  # pragma: no cover - Windows
    FCNTL_AVAILABLE = False


def test_lock_roundtrip(tmp_path):
    async def scenario():
        async with session_file_lock(tmp_path, "acc", timeout=5):
            assert (tmp_path / ".acc.session.lock").exists()

    asyncio.run(scenario())
    # 释放后应可再次获取
    asyncio.run(scenario())


@pytest.mark.skipif(not FCNTL_AVAILABLE, reason="需要 fcntl 支持")
def test_lock_rejects_second_holder(tmp_path):
    async def scenario():
        async with session_file_lock(tmp_path, "acc", timeout=5):
            with pytest.raises(SessionFileLockTimeout):
                async with session_file_lock(tmp_path, "acc", timeout=0.3):
                    pass  # pragma: no cover

    asyncio.run(scenario())


@pytest.mark.skipif(not FCNTL_AVAILABLE, reason="需要 fcntl 支持")
def test_lock_waits_indefinitely_when_timeout_non_positive(tmp_path):
    async def scenario():
        async def holder():
            async with session_file_lock(tmp_path, "acc", timeout=1):
                await asyncio.sleep(0.3)

        holder_task = asyncio.create_task(holder())
        await asyncio.sleep(0.05)
        # timeout <= 0 表示无限等待，持锁方释放后应成功获取
        async with session_file_lock(tmp_path, "acc", timeout=-1):
            pass
        await holder_task

    asyncio.run(scenario())


def test_resolve_lock_timeout_env(monkeypatch):
    monkeypatch.delenv("TG_SESSION_FILE_LOCK_TIMEOUT", raising=False)
    assert resolve_lock_timeout() == DEFAULT_SESSION_FILE_LOCK_TIMEOUT

    monkeypatch.setenv("TG_SESSION_FILE_LOCK_TIMEOUT", "30")
    assert resolve_lock_timeout() == 30.0

    monkeypatch.setenv("TG_SESSION_FILE_LOCK_TIMEOUT", "abc")
    assert resolve_lock_timeout() == DEFAULT_SESSION_FILE_LOCK_TIMEOUT


def test_lock_for_client_selection(tmp_path):
    class App:
        def __init__(self, in_memory=False, session_string=None):
            self.in_memory = in_memory
            self.session_string = session_string

    # in-memory / string 会话不落本地 SQLite 文件，不应加文件锁
    assert isinstance(
        session_file_lock_for_client(App(in_memory=True), tmp_path, "acc"),
        nullcontext,
    )
    assert isinstance(
        session_file_lock_for_client(App(session_string="xyz"), tmp_path, "acc"),
        nullcontext,
    )

    lock = session_file_lock_for_client(App(), tmp_path, "acc")
    assert isinstance(lock, _SessionFileLock)
    assert lock._lock_path == tmp_path / ".acc.session.lock"
