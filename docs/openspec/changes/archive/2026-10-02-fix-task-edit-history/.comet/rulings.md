# Preset rulings

### Preset file-count authorization
- status: active
- workflow: hotfix
- decision: continue-on-file-count-only
- scope: fix-task-edit-history —— 任务失败后编辑"任务不存在"与超时后任务持续出错的问题链修复：normal_run 有限重试、create 任务名校验、JSON 原子写、前端路径编码，及配套回归/单元测试
- allowed-file-categories: implementation, tests, user-docs, config, generated
- authorization-basis: user-explicit
- reason: 用户于 2026-10-02 通过结构化提问明确选择"继续 hotfix（推荐）"，确认范围与风险不变、仅文件数超限（预计 7 个：实现 4 + 测试 3），无新增能力/公共 API/schema/跨模块/架构等实质升级信号
