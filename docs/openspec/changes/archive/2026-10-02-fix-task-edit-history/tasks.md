# Tasks

## 后端

- [x] 1. 回归测试先行：`run_once` 持续抛 `TimeoutError`（OSError 子类）时最多重试 3 次
      后上抛，不无限循环（`tg_signer/test_run_once_retry.py`）
- [x] 2. `tg_signer/core.py` `normal_run`：only_once 模式下 `OSError`/`Unauthorized`
      有限重试后 raise；daemon 模式保持原语义；现有测试通过
- [x] 3. 回归测试先行：create/update 对 `#`、`%`、`..`、`\x00` 等任务名统一拒绝
      （`backend/api/routes/test_sign_task_name_validation.py`）
- [x] 4. 统一任务名校验：扩展 `SignTaskCreate` 校验并让 update 路由复用同一规则
- [x] 5. 单元测试先行：`_atomic_write_json` 落盘为完整 JSON 且通过 os.replace 替换
      （`backend/services/test_atomic_write.py`）
- [x] 6. `backend/services/sign_tasks.py`：新增 `_atomic_write_json` 并替换
      `_save_run_info`/`create_task`/`update_task` 的 JSON 写入；`delete_task` 失败路径
      也失效 `_tasks_cache`

## 前端

- [x] 7. `frontend/lib/api.ts`：任务名路径段统一 `encodeURIComponent`，手工拼的
      `account_name` 查询串改 `URLSearchParams`；`node --test` 相关测试通过

## 验证

- [x] 8. 运行后端测试套件（`pytest`）与前端 `node --test`，全部通过；输出排查报告
      （遗留 bug 清单 + 部署版本确认提醒）
