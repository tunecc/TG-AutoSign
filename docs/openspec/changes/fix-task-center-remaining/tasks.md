# Tasks

## 后端

- [x] 1. 回归测试先行：重命名后账号作用域与 legacy history 文件迁移、last_run 恢复
      （扩展 `backend/services/test_sign_tasks_history.py`）
- [x] 2. `update_task` 重命名时迁移 history 文件（best-effort）；
      `get_task`/`_load_task_config` 解析失败补 warning 日志
- [x] 3. 回归测试先行：`_build_run_task_args` 默认 `--no-force`、`force_rerun=True`
      时省略（扩展 `backend/cli/test_tasks.py`）
- [x] 4. `run_task_once`/`async_run_task_cli`/`_build_run_task_args` 增加 force 透传；
      手动运行路由传 `True`，调度不变

## tg_signer

- [x] 5. 回归测试先行：`send_text`/`send_dice_cli` 执行期间持有会话文件锁
      （新增 `tg_signer/test_send_session_lock.py`）
- [x] 6. `send_text`/`send_dice_cli` 包裹 `_session_file_lock()`（含惰性 login）

## 验证

- [x] 7. 全量 pytest + 前端 node --test 通过；更新 CHANGELOG；人工走查最终 diff
