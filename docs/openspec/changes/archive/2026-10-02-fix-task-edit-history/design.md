# 修复方案

单方案修复，不做多方案对比（hotfix 预设）。

## 1. `tg_signer/core.py`：`normal_run` 有限重试

在执行循环的 `except (OSError, errors.Unauthorized)` 分支引入重试计数：

- `only_once=True`（`run_once` 路径，签到任务与普通任务一次性执行都走这里）：同一异常
  最多重试 2 次（共 3 次尝试，与后端 `run_task_with_logs` 的锁重试上限一致），仍失败则
  `raise`，让调用方记录失败历史并释放账号锁。保留 30 秒退避间隔。
- `only_once=False`（CLI `run` 常驻守护模式）：维持原有无限重试语义，不影响现有用户。

计数器在进入循环前初始化，`continue` 前自增，成功迭代后重置为 0（网络抖动恢复后
重新给满重试额度）。

## 2. 任务名校验统一（create 与 update 同一规则）

`SignTaskCreate.name_must_be_valid_filename` 在现有 `<>:"/\|?*` 与空名之外，增加拒绝
`#`、`%`、`..`、`\x00`（`#`/`%` 会破坏未编码的 REST 路径，`..`/`\x00` 涉及路径安全）；
`update_sign_task` 路由改用同一规则函数。emoji/CJK/空格/`+` 等仍允许（前端编码修复后
可正常使用）。历史遗留的 `#`/`%` 名称任务由前端编码修复保住操作能力。

## 3. `frontend/lib/api.ts`：路径参数编码

新增内部 helper `encodePathSegment = (s: string) => encodeURIComponent(String(s))`，
将 `getSignTask`、`updateSignTask`、`deleteSignTask`、`runSignTask`、`getSignTaskStatus`、
`getSignTaskLogs`、`getSignTaskHistory` 中拼进路径的 `name` 统一编码；这些函数中手工拼接
的 `account_name` 查询串改用 `URLSearchParams`（空格/`+`/`&`/`#` 语义与后端
`parse_qsl` 一致）。WS URL 构造已正确编码，不动。

## 4. `backend/services/sign_tasks.py`：原子写 + 缓存失效

- 新增模块级/类内 helper `_atomic_write_json(path, data)`：写 `path.with_suffix(
  path.suffix + ".tmp")` 后 `os.replace` 到目标路径，`ensure_ascii=False, indent=2` 与
  现有格式保持一致。
- 替换写入点：`_save_run_info` 的 history 文件与 config.json last_run 回写、
  `create_task` 的 config 写入、`update_task` 的 config 写入。
- `delete_task`：`shutil.rmtree` 抛异常时也执行 `self._tasks_cache = None` 再返回 False，
  避免列表残留残缺任务。

## 不做的事（明确排除）

- 不改 `_cleanup_old_logs` 的 3 天 mtime 清理策略、不改历史记录结构（无 schema 变更）。
- 不为 `send_text`/`send_dice_cli` 补会话锁（并发面已由 flock 大幅收敛，列为观察项）。
- 不改"该记录没有流程详情"文案（列入排查报告，另行决定）。
- 不做任务名 `/` 等历史脏数据的迁移清理（创建侧已堵住新增）。

## 风险与回滚

- 全部为行为收窄或等价替换：有限重试只在原先会无限挂死的场景改变行为；原子写对调用方
  透明；前端编码对合法名称产物相同。
- 回滚方式：revert 本 change 的提交即可，无数据迁移。
