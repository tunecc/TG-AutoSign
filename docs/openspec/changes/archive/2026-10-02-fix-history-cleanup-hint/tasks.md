# Tasks

## 后端

- [x] 1. 回归测试先行：`_cleanup_old_logs` 按条目时间裁剪——混合新旧条目仅留新条目、
      全旧条目删除文件、缺失/非法时间条目保留、损坏文件按 mtime 删除
      （扩展 `backend/services/test_sign_tasks_history.py`）
- [x] 2. 重写 `_cleanup_old_logs` 为按条目 `time` 裁剪 + `_atomic_write_json` 写回 +
      mtime 回退；现有测试通过

## 前端

- [x] 3. `LanguageContext.tsx` 新增 `task_history_failed_no_reason` 中英文案；
      `page.tsx` 两处空 message 回退按 `log.success` 区分；代码走查 + 双语 key 核对
      （组件测试基础设施缺失，按 proposal 记录手工验证）

## 验证

- [x] 4. 运行后端 pytest 与前端 node --test，全部通过；更新 CHANGELOG
