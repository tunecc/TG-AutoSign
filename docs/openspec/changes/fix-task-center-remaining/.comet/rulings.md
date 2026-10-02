# Preset rulings

### Preset file-count authorization
- status: active
- workflow: hotfix
- decision: continue-on-file-count-only
- scope: fix-task-center-remaining —— 重命名历史迁移、手动运行 force 透传、send_text/send_dice_cli 会话锁、损坏配置告警日志，及配套测试与 CHANGELOG
- allowed-file-categories: implementation, tests, user-docs, config, generated
- authorization-basis: user-explicit
- reason: 用户于 2026-10-02 通过结构化提问明确选择"继续 hotfix（推荐）"，确认范围与风险不变、仅文件数超限（预计 8 个：实现 5 + 测试 2 + CHANGELOG 1），无新增能力/公共 API/schema/跨模块/架构等实质升级信号
