# 验证报告：fix-task-center-remaining

- 日期：2026-10-02
- 工作流：hotfix（Classic）
- 验证模式：light（hotfix 预设；规模评估建议 full——任务数 7>3、变更文件 21>8，其中含 OpenSpec 产物与 .comet 元数据；实质实现 5 文件 + 测试 3 文件，无 delta spec、无公共 API/schema 变更，并发与边界风险场景由回归测试覆盖，维持 light）
- 审查模式：off（hotfix 预设）；以人工集成审查替代，见第 6 项
- 验证轮次：2（第一轮集成审查发现本 change 引入的边界回归，verify-fail 回 build 修复后复验）

## 轻量验证 7 项检查

| # | 检查项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | tasks.md 全部任务 `[x]` | PASS | `docs/openspec/changes/fix-task-center-remaining/tasks.md` 7/7 勾选 |
| 2 | 改动文件与 tasks 描述一致 | PASS | `git diff --stat 584ad6d...HEAD`：实现 5（sign_tasks.py、services/tasks.py、routes/tasks.py、cli/tasks.py、core.py）+ 测试 3（扩展 2 + 新增 test_send_session_lock.py）+ CHANGELOG + change 产物；与任务 1-7 对应 |
| 3 | 编译/导入通过 | PASS | pytest 全量收集执行；ruff check 全部通过 |
| 4 | 相关测试通过 | PASS | Runtime 记录：`.venv/bin/python -m pytest -q` → 59 passed（exit 0，复用修复后 build 证据 ebdf7381）；`node --test`（cwd frontend）→ pass 4 / fail 0 |
| 5 | 无明显安全问题 | PASS | 无硬编码密钥；无新增 unsafe 操作；历史迁移仅在 workdir/history 内 rename |
| 6 | 集成审查 | PASS（第 2 轮） | review_mode=off；人工审查发现第 1 轮问题：get_task 重构把 chats 归一化移出 try，`IntervalValidationError`（畸形 interval 配置，tg_signer/action_interval.py:51）会从 404 变 500——已回 build 修复（2f03433：归一化放回 try 内 + 回归测试），复验通过。其余审查点：历史迁移 scoped/legacy 双源与目标冲突跳过正确；force 透传调度默认不变；send 锁覆盖惰性 login；`_load_task_config`/`get_task` 告警不改变返回语义 |
| 7 | 核心成功/失败/边界场景 | PASS | ① 迁移：`test_update_task_migrates_history_on_rename`（scoped 文件迁移 + last_run 恢复）、`test_update_task_migrates_legacy_history_on_rename`；② force：`test_build_run_task_args_force_omits_no_force` / `..._default_keeps_no_force`；③ 锁：`test_send_text_holds_session_lock`、`test_send_text_locks_around_lazy_login`、`test_send_dice_cli_holds_session_lock`；④ 边界：`test_get_task_returns_none_for_malformed_interval`（畸形配置 404 不 500）；RED→GREEN：修复前 6 个目标测试失败（迁移缺失、force TypeError、send 未持锁） |

## 验证失败与修复记录

- 第 1 轮 verify 集成审查发现：get_task 结构调整使畸形 interval 配置由 404 变 500（IMPORTANT，本 change 引入）。verify_failures=1，回 build 修复（`2f03433`：归一化移回 try + 回归测试 `test_get_task_returns_none_for_malformed_interval`），重跑全量 59 passed 后重新进入 verify，本轮全部通过。

## 明确不做的事项（design.md 记录）

- update_task 与 _save_run_info 不加进程内写锁：单 worker 下两者在事件循环线程同步执行天然串行，线程池路由只读且 `os.replace` 原子替换保证读到完整文件——当前拓扑无实际竞态。
- 调度 range 模式 job 内随机 sleep（功能设计）、CLI 守护模式 Unauthorized 重试（历史语义）均不改。

## 结论

7/7 通过（第 2 轮），无未解决的 CRITICAL/IMPORTANT 问题。验证通过。
