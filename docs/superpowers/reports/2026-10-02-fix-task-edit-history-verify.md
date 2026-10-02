# 验证报告：fix-task-edit-history

- 日期：2026-10-02
- 工作流：hotfix（Classic）
- 验证模式：light（hotfix 预设；规模评估建议 full——任务数 8>3、变更文件 22>8，但其中包含 OpenSpec 产物与 .comet 元数据；实质实现仅 4 文件 + 4 测试文件，无 delta spec、无公共 API/schema 变更，并发风险场景由回归测试覆盖，故维持 light）
- 审查模式：off（hotfix 预设）；以人工集成审查替代自动审查，见第 6 项

## 轻量验证 7 项检查

| # | 检查项 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | tasks.md 全部任务 `[x]` | PASS | `docs/openspec/changes/fix-task-edit-history/tasks.md` 8/8 勾选 |
| 2 | 改动文件与 tasks 描述一致 | PASS | `git diff --stat d115f76...HEAD`：实现 4 文件（core.py、routes/sign_tasks.py、services/sign_tasks.py、frontend/lib/api.ts）+ 新增 sign-task-urls.ts + 4 个测试文件 + CHANGELOG + change 产物；与任务 1-8 一一对应；中性文档（CHANGELOG/产物）不计实现不一致 |
| 3 | 编译/导入通过 | PASS | pytest 全量收集并执行（隐式编译导入）；前端 `tsc --noEmit` 无输出（通过） |
| 4 | 相关测试通过 | PASS | Runtime 记录：`.venv/bin/python -m pytest -q` → 47 passed（exit 0）；`node --test`（cwd frontend，4 个测试文件）→ pass 4 / fail 0（exit 0） |
| 5 | 无明显安全问题 | PASS | 无硬编码密钥；任务名校验新增拒绝 `..` 与 `\x00`，关闭创建侧路径逃逸缺口；无新增 unsafe 操作 |
| 6 | 集成审查 | PASS | review_mode=off（hotfix 预设，跳过自动审查）；已对最终 diff 做人工集成审查：重试上限仅作用于 only_once（守护模式语义保留、成功迭代重置计数）、create/update 校验共用同一规则、前端 URL 构造与旧实现对合法名称产物逐函数比对一致（空 account 省略、run/status 恒带 account_name、%2F 因 `/` 已禁用无影响）、原子写覆盖全部任务关键 JSON（chats_cache 读取端容错故保留直接写） |
| 7 | 核心成功/失败/边界场景 | PASS | ① 超时链：`test_run_once_raises_after_limited_retries`——持续 TimeoutError 下 3 次尝试后上抛（修复前无限循环，RED 已记录）；② 守护语义：`test_daemon_mode_keeps_retrying`——only_once=False 仍无限重试；③ 404 链：`test_create_rejects_url_and_path_unsafe_names` / `test_update_route_rejects_url_and_path_unsafe_names`——`#` `%` `..` `\x00` 统一拒绝、正常名称（含 emoji/空格/`+`）不受影响；④ 原子写：`test_atomic_write_json_keeps_original_on_failure`——写入失败保留原文件且清理临时文件；⑤ 前端编码：`sign-task-urls.test.mjs`——`#`/`%`/空格编码正确、普通名称不变 |

## RED→GREEN 证据

修复前（RED）：`test_run_once_raises_after_limited_retries` 失败（无限重试被守卫异常截获）、名称校验 10 例失败（`#`/`%`/`..`/`\x00` 被放行）、`_atomic_write_json` ImportError、前端模块缺失。修复后（GREEN）：全部通过，全量套件 47 passed + 4 test files passed。

## 遗留观察项（不在本 change 范围，已列入排查报告）

- "该记录没有流程详情（旧版本可能仅保存结果）" 对空 message 失败记录的文案误导。
- `send_text`/`send_dice_cli` 未包会话文件锁（并发面已大幅收敛，观察即可）。
- 部署提醒：服务器运行 `ghcr.io/tunecc/tg-autosign:latest`，需确认镜像已包含 e45902a 与本次修复后重新部署。

## 结论

7/7 通过，无 CRITICAL/IMPORTANT 问题。验证通过。
