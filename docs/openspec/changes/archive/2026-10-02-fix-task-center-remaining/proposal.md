# 修复：任务中心排查剩余项（重命名历史迁移 / 手动运行 force / send 会话锁 / 损坏配置日志）

## 问题背景（2026-10-02 全面排查的剩余遗留项，用户要求当日一并修复）

1. **任务重命名后历史不迁移**：`update_task` 重命名只移动任务目录
   （`signs/<账号>/<旧名>` → `<新名>`），`history/<账号>__<旧名>.json` 不跟随——
   重命名后任务历史清空、列表显示"未运行"，用户以为任务丢了执行记录。
2. **普通任务手动运行静默跳过**：e45902a 后普通任务统一走 `run_once --no-force`
   （调度语义正确），但 Web 手动"运行"按钮也走同一路径——当天已执行过的任务手动
   触发会静默跳过并报成功；签到任务手动运行则是强制重跑，两类任务语义不一致。
3. **`send_text`/`send_dice_cli` 未包会话文件锁**：web/CLI 发消息路径直接
   `async with self.app` 打开 session，与正在执行的签到任务并发时仍可能
   "database is locked"（会话锁此前只覆盖签到执行、登录探测、聊天刷新）。
4. **任务配置损坏无日志**：`get_task`/`_load_task_config` 在 `json.load` 失败时
   静默返回 None——表现为 404"任务不存在"，但日志里没有任何线索，排障困难。

## 根因分析

- R1：`update_task` 的重命名分支只处理了任务目录，遗漏了以任务名为键的
  history 文件（账号作用域 `<账号>__<任务>.json` 与 legacy `<任务>.json` 两种）。
- R2：`run_task_once` 无 force 参数，`_build_run_task_args` 硬编码 `--no-force`；
  手动触发与调度触发共用同一入口，无法区分语义。
- R3：`send_text`/`send_dice_cli`（含其内部 `login`）在 e45902a 接入会话锁时
  未纳入覆盖。
- R4：两个加载函数的 `except Exception: return None` 吞掉了损坏配置的具体错误。

## 修复目标

1. 重命名时同步迁移账号作用域与 legacy history 文件（目标已存在则跳过，不覆盖；
   迁移失败仅告警不阻断重命名）。
2. `run_task_once`/`async_run_task_cli`/`_build_run_task_args` 增加 `force_rerun`
   参数：手动运行路由传 `True`（CLI 不带 `--no-force`，即默认强制），调度保持
   `False`（`--no-force`）。
3. `send_text`/`send_dice_cli` 全程持有会话文件锁（含惰性 login）。
4. `get_task`/`_load_task_config` 解析失败时记录 warning 日志（含路径与异常摘要），
   行为仍返回 None（404 语义不变，但可排障）。

## 验收标准

- 回归测试：重命名后新名 history 文件存在、旧名消失、`list_tasks` 能取到 last_run；
  legacy 文件同样迁移。
- 回归测试：`_build_run_task_args` 默认含 `--no-force`，`force_rerun=True` 时不含。
- 回归测试：`send_text`/`send_dice_cli` 执行期间持有会话锁。
- 现有测试套件全部通过。
