from __future__ import annotations

import asyncio
from typing import Callable, Optional

from backend.core.config import get_settings

settings = get_settings()


def _base_args(account_name: str) -> list[str]:
    return [
        "tg-signer",
        "--workdir",
        str(settings.resolve_workdir()),
        "--session_dir",
        str(settings.resolve_session_dir()),
        "--account",
        account_name,
    ]


def _build_run_task_args(
    account_name: str, task_name: str, num_of_dialogs: int, force_rerun: bool = False
) -> list[str]:
    # 必须用 run_once 而不是 run：run 是常驻 cron 守护循环，子进程永远不会退出，
    # 会长期占用账号 session 文件，导致签到任务报 "database is locked"。
    # 调度触发（force_rerun=False）带 --no-force，与旧守护进程行为一致：是否执行
    # 由任务配置自身的调度判断；手动触发（force_rerun=True）省略该参数强制执行，
    # 与签到任务手动运行的强制语义对齐。
    args = _base_args(account_name) + [
        "run_once",
        task_name,
        "--num-of-dialogs",
        str(num_of_dialogs),
    ]
    if not force_rerun:
        args.append("--no-force")
    return args


async def async_run_task_cli(
    account_name: str,
    task_name: str,
    num_of_dialogs: int = 50,
    callback: Optional[Callable[[str], None]] = None,
    force_rerun: bool = False,
) -> tuple[int, str, str]:
    """
    Asynchronously run a tg-signer sign task using CLI.
    Returns (returncode, stdout, stderr)
    """
    args = _build_run_task_args(account_name, task_name, num_of_dialogs, force_rerun)

    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,  # 合并 stdout 和 stderr 以便于即时按顺序捕获日志
    )

    full_output = []
    while True:
        line = await process.stdout.readline()
        if not line:
            break
        decoded_line = line.decode("utf-8", errors="replace").rstrip()
        if decoded_line:
            full_output.append(decoded_line)
            if callback:
                callback(decoded_line)

    await process.wait()

    return (
        process.returncode or 0,
        "\n".join(full_output),
        "",  # stderr 已经由于合并捕获到了 stdout 中
    )
