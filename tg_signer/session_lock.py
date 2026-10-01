"""跨进程的会话文件互斥锁。

Pyrogram 的 `<account>.session` 文件本质是一个 SQLite 数据库。后端进程与 CLI
子进程（或多个 CLI 进程）同时打开同一个账号的 session 文件时，SQLite 写锁冲突
会以 "database is locked" 的形式暴露。这里通过 `flock` 对
`<account>.session.lock` 文件加跨进程互斥锁来避免并发写冲突；flock 随进程
退出（包括被 kill）自动释放，不会留下死锁残留。
"""

from __future__ import annotations

import asyncio
import os
from contextlib import nullcontext
from pathlib import Path
from typing import Optional, Union

try:
    import fcntl
except ImportError:  # pragma: no cover - Windows 无 fcntl，退化为不加锁
    fcntl = None  # type: ignore[assignment]

DEFAULT_SESSION_FILE_LOCK_TIMEOUT = 120.0
_LOCK_POLL_INTERVAL = 0.2
_TIMEOUT_ENV = "TG_SESSION_FILE_LOCK_TIMEOUT"


class SessionFileLockTimeout(RuntimeError):
    """等待会话文件锁超时。"""


def resolve_lock_timeout() -> float:
    raw = os.getenv(_TIMEOUT_ENV)
    if not raw:
        return DEFAULT_SESSION_FILE_LOCK_TIMEOUT
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_SESSION_FILE_LOCK_TIMEOUT
    return value


def _lock_path(session_dir: Union[str, Path], account_name: str) -> Path:
    return Path(session_dir) / f".{account_name}.session.lock"


class _SessionFileLock:
    """基于 flock 的异步上下文管理器。

    timeout <= 0 表示无限等待；fcntl 不可用的平台上退化为空操作。
    """

    def __init__(self, lock_path: Path, timeout: float):
        self._lock_path = lock_path
        self._timeout = timeout
        self._fd: Optional[int] = None

    async def __aenter__(self) -> "_SessionFileLock":
        if fcntl is None:
            return self
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(str(self._lock_path), os.O_CREAT | os.O_RDWR, 0o644)
        loop = asyncio.get_running_loop()
        deadline = None if self._timeout <= 0 else loop.time() + self._timeout
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except OSError as exc:
                if deadline is not None and loop.time() >= deadline:
                    os.close(fd)
                    raise SessionFileLockTimeout(
                        f"等待会话文件锁超时（已等 {self._timeout:g} 秒）: "
                        f"{self._lock_path.name} 正被其他进程占用。"
                        "请避免同账号任务执行时间重叠，或调大 "
                        f"{_TIMEOUT_ENV} 后重试"
                    ) from exc
                await asyncio.sleep(_LOCK_POLL_INTERVAL)
        self._fd = fd
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            finally:
                os.close(self._fd)
                self._fd = None
        return False


def session_file_lock(
    session_dir: Union[str, Path],
    account_name: str,
    timeout: Optional[float] = None,
):
    """对指定账号的 session 文件加跨进程互斥锁。

    timeout 为 None 时读取环境变量 `TG_SESSION_FILE_LOCK_TIMEOUT`，
    未设置时使用默认值；显式传入的值优先生效。
    """
    if timeout is None:
        timeout = resolve_lock_timeout()
    return _SessionFileLock(_lock_path(session_dir, account_name), timeout)


def session_file_lock_for_client(
    client,
    session_dir: Union[str, Path],
    account_name: str,
    timeout: Optional[float] = None,
):
    """按客户端的会话类型选择加锁方式。

    in-memory / session_string 会话不落本地 SQLite 文件，无需跨进程锁。
    """
    if getattr(client, "in_memory", False) or getattr(client, "session_string", None):
        return nullcontext()
    return session_file_lock(session_dir, account_name, timeout=timeout)
