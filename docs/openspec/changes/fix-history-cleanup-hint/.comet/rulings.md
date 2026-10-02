# Preset rulings

### Preset file-count authorization
- status: active
- workflow: hotfix
- decision: continue-on-file-count-only
- scope: fix-history-cleanup-hint —— 历史清理按条目时间裁剪（_cleanup_old_logs 重写）+ 任务历史失败记录空 message 文案修正，及配套测试与 CHANGELOG
- allowed-file-categories: implementation, tests, user-docs, config, generated
- authorization-basis: user-explicit
- reason: 用户于 2026-10-02 通过结构化提问明确选择"继续 hotfix（推荐）"，确认范围与风险不变、仅文件数超限（预计 5 个：实现 3 + 测试 1 + CHANGELOG 1），无新增能力/公共 API/schema/跨模块/架构等实质升级信号
