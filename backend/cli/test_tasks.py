from backend.cli.tasks import _base_args, _build_run_task_args


def test_build_run_task_args_uses_one_shot_command():
    # 普通任务必须一次性执行并退出：run 是常驻 cron 守护循环，子进程永不退出
    args = _build_run_task_args("acc", "task-a", 50)
    prefix = _base_args("acc")
    assert args[: len(prefix)] == prefix
    assert args[len(prefix) :] == [
        "run_once",
        "task-a",
        "--num-of-dialogs",
        "50",
        "--no-force",
    ]
