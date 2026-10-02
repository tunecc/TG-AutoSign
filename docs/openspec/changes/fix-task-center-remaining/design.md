# 修复方案

单方案修复（hotfix 预设）。

## 1. `backend/services/sign_tasks.py`

- `update_task` 重命名分支（`task_dir.rename(target_dir)` 成功后）追加历史迁移：
  - 账号作用域：`history/<safe(acc)>__<safe(旧名)>.json` → `<safe(acc)>__<safe(新名)>.json`
  - legacy：`history/<safe(旧名)>.json` → 账号非空时迁到账号作用域新名，账号为空时迁到
    legacy 新名
  - 目标文件已存在则跳过；`OSError` 仅 `logger.warning`，不阻断重命名（best-effort，
    与 delete_task 清理历史同级别）。
- `get_task` 与 `_load_task_config` 的 `except Exception` 分支补
  `logger.warning("任务配置解析失败: 路径=%s, 错误=%s", ...)`，返回值语义不变。

## 2. 手动运行 force（三个文件）

- `backend/cli/tasks.py`：`_build_run_task_args(account, task, dialogs, force_rerun=False)`
  —— `force_rerun=False` 时追加 `--no-force`（调度语义），`True` 时不追加
  （CLI `run_once` 默认 `--force`）。`async_run_task_cli` 增加 `force_rerun` 透传。
- `backend/services/tasks.py`：`run_task_once(db, task, force_rerun=False)` 透传。
- `backend/api/routes/tasks.py`：手动运行路由 `run_task` 调用
  `run_task_once(db, task, force_rerun=True)`；调度 `_job_run_task` 不变（默认 False）。

## 3. `tg_signer/core.py`：send 路径会话锁

`send_text` 与 `send_dice_cli` 改为：

```python
async with self._session_file_lock():
    if self.user is None:
        await self.login(print_chat=False)   # login 内部自行开合 app
    async with self.app:
        await self.send_message(...)          # / send_dice
```

单次持锁覆盖惰性 login 与发送动作，与 `normal_run` 的锁覆盖方式一致。

## 不做的事（明确排除）

- 不改 `update_task` 丢弃 config 中 `last_run` 的行为（迁移 history 后
  `_get_last_run_info` 回退可正确恢复显示）。
- 不为 update_task 与 `_save_run_info` 增加进程内写锁：单 uvicorn worker 下两者均在
  事件循环线程内同步执行，天然串行；线程池路由只读，`os.replace` 原子替换保证读到
  旧或新完整文件——当前拓扑不存在实际竞态（原子写已消除撕裂风险）。
- 不改调度 range 模式的 job 内随机 sleep（随机时间段执行是功能设计，
  coalesce + misfire_grace_time 已缓解叠加）。
- 不改 CLI `run` 守护模式对 Unauthorized 的无限重试（守护进程历史语义，超出缺陷范围）。

## 风险与回滚

- 手动 force 是行为增强（旧守护进程时代手动也跳过，用户无从区分"没跑"）；
  调度语义不变。
- send 加锁可能让并发发送排队最多 120 秒（锁等待超时），优于报 database is locked。
- 回滚：revert 本 change 提交。
