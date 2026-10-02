# 修复：任务失败后任务中心编辑"任务不存在"与超时后任务持续出错

## 问题背景（用户报告）

1. 某签到任务自 9/24 起"任务执行出错: Request timed out"失败一次后，9/25–9/30 连续 6 天报
   "任务执行出错: database is locked"。
2. 昨天上午已修复一部分（e45902a：普通任务改 `run_once --no-force` + flock 会话文件锁），
   但用户报告修复后在任务中心点击"编辑"仍会提示"任务不存在"并被弹回列表。
3. 任务历史面板存在"该记录没有流程详情（旧版本可能仅保存结果）"的失败记录，提示文案误导。
4. 生产部署在服务器（ghcr.io/tunecc/tg-autosign:latest），本地无生产日志，本次分析全部基于代码。

## 根因分析

### R1（超时后任务持续出错的剩余根因，未被 e45902a 覆盖）

`tg_signer/core.py` `normal_run()` 的执行循环：

```python
while True:
    try:
        async with self._session_file_lock():
            async with self.app:
                ...
                await sign_once()
    except (OSError, errors.Unauthorized) as e:
        await asyncio.sleep(30)
        continue          # ← 无限重试，无退出条件
    if only_once:
        break
```

Docker 镜像为 `python:3.12-slim`。Python 3.11+ 中 `asyncio.TimeoutError` 是内建
`TimeoutError` 的别名，而内建 `TimeoutError` 是 `OSError` 的子类。因此签到阶段的
"Request timed out"（以及 `ConnectionError`、`FileNotFoundError` 等）会被
`except OSError` 捕获进入**无限 30 秒重试循环**，`only_once=True`（`run_once`）永不返回：

- `run_task_with_logs` 一直持有账号锁 → 同账号后续调度任务（scheduler 调用不带
  `lock_wait_timeout_seconds`）无限等待挂起，APScheduler `max_instances=10` 耗尽后
  该任务不再被调度；
- 手动运行经 Runner 120 秒等待后报"等待账号空闲超时"失败；
- run-status 永远显示执行中；Runner 2 个 worker 全部卡死后所有手动任务排队。

登录阶段（`while` 之前的 `await self.login()`）不在 try 内，超时直接上抛并被记录为失败
——与用户 9/24 看到的"任务执行出错: Request timed out"记录吻合；签到阶段的同类超时则
落入无限循环，表现为"超时一次之后任务就出错"。

### R2（编辑页 404"任务不存在"的根因面）

`get_task()` 在 `config.json` 缺失**或 JSON 解析失败**时一律返回 None → 路由 404 →
前端提示"任务不存在"。存在多个可导致该状态的缺陷：

- **R2a 任务名校验缺口 + 前端路径未编码**：`SignTaskCreate` 的 pydantic 校验只拦截
  `<>:"/\|?*` 与空名，**不拦 `#`、`%`、`..`、`\x00`**；`PUT /sign-tasks`（update）路由
  的校验集合（`/ \ .. \x00`）与 create 又不一致。名称含 `#` 时，前端 `api.ts` 把原始
  名称直接拼进 URL 路径（`/sign-tasks/${name}`），`#` 被浏览器当作片段分隔符、`%` 形成非法
  转义序列，后端收到截断/变形的名称 → 404"任务不存在"；含 `..` 时存在目录逃逸风险。
  调度器与列表扫描不经过 URL，因此任务仍能每天执行并显示——与"任务在跑但编辑 404"的
  现象一致。WS 监控 URL 已正确 `encodeURIComponent`，说明问题只出在 REST 路径拼接。
- **R2b JSON 非原子写**：`_save_run_info`（history 文件 + config.json 的 last_run 回写）、
  `create_task`、`update_task` 均直接 `open(path, "w")` 截断后 `json.dump`，无 tmp+rename、
  无并发互斥。进程在写入中途被杀（容器重启/OOM/超时强杀）会留下撕裂的半截 JSON →
  `get_task`/`_load_task_config` 解析失败 → 编辑 404、列表丢失任务。
- **R2c 删除残留缓存**：`delete_task` 的 `shutil.rmtree` 中途抛异常时 `return False`，
  `_tasks_cache` 不失效（失效语句在 rmtree 之后），列表继续显示残缺任务 → 编辑 404。

### R3（"该记录没有流程详情"误导，仅记录不修）

空 message 且空 flow_logs 的历史记录（旧版本或异常路径写入）渲染为
"该记录没有流程详情（旧版本可能仅保存结果）"，未提示这是失败且无详细原因。

## 修复目标

1. `normal_run` 在 `only_once` 模式下对 `OSError`/`Unauthorized` 有限重试后上抛，
   杜绝账号锁被永久占用（R1）。
2. 统一任务名校验：`SignTaskCreate` 校验扩展 `#`、`%`、`..`、`\x00`，update 路由复用
   同一规则（R2a 后端侧）。
3. 前端 `api.ts` 所有把任务名拼进路径的请求统一 `encodeURIComponent`（R2a 前端侧，
   同时修复已存在的特殊字符任务名的编辑/运行/删除/历史）。
4. 任务配置与历史文件统一改原子写（tmp + `os.replace`）；`delete_task` 失败时同样失效
   缓存（R2b/R2c）。

## 验收标准

- 回归测试：`run_once` 在持续抛 `TimeoutError`（OSError 子类）时有限次重试后上抛，
  不会无限循环。
- 回归测试：create 任务名含非法字符返回 400；合法名称不受影响。
- 回归测试：任务 JSON 写入为原子替换（中断不产生撕裂文件，行为由 helper 单测覆盖）。
- 现有测试套件全部通过。
