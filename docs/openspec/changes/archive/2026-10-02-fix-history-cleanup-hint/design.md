# 修复方案

单方案修复，不做多方案对比（hotfix 预设）。

## 1. `backend/services/sign_tasks.py`：`_cleanup_old_logs` 按条目裁剪

- 遍历 `history/*.json`，读取 JSON 列表后按条目 `time`（ISO，naive 本地时间）与
  3 天阈值比较：过期的条目剔除，保留条目经 `_history_max_entries` 上限裁剪后
  用既有 `_atomic_write_json` 写回；仅当保留列表为空时才删除文件。
- 条目时间缺失或 `datetime.fromisoformat` 解析失败/时区不可比时**保守保留**该条目，
  由条数上限兜底，避免因数据瑕疵丢历史。
- 文件读取失败（损坏）或数据不是列表（旧版单条 dict 格式）时，退回原有
  mtime 删除行为，行为不劣于现状。
- 调用点（服务初始化、每日维护任务）不变，保留天数仍为 3 天，不新增配置面。

## 2. 前端失败记录文案

- `LanguageContext.tsx` 新增 `task_history_failed_no_reason`：
  zh "失败（无详细原因记录）" / en "Failed (no failure detail recorded)"。
- `page.tsx` 两处 `{log.message || t("task_history_no_flow")}` 改为按 `log.success`
  区分：失败且无 message → `task_history_failed_no_reason`；成功且无 message →
  维持 `task_history_no_flow`。
- 不改组件结构与样式，仅替换回退文案来源。

## 不做的事

- 不引入保留天数配置项（维持 3 天常量）。
- 不做条目级 TTL 与条数上限的配置重构。
- 不为组件渲染搭建测试基础设施（超出本缺陷范围）。

## 风险与回滚

- 清理语义从"整文件 mtime"变为"条目时间"：用户可见差异是长任务的历史不再被整文件清空，
  属预期改善；损坏文件路径行为不变。
- 回滚：revert 本 change 提交即可，无数据迁移（写回仍复用原子写）。
