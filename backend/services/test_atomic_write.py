"""_atomic_write_json 原子写回归测试。

背景：_save_run_info/create_task/update_task 直接 open(path, "w") 截断后 json.dump，
进程在写入中途被杀（容器重启/OOM/超时强杀）会留下撕裂的半截 JSON，
get_task/_load_task_config 解析失败后任务从列表消失、编辑页 404。
"""

import json

import pytest

from backend.services.sign_tasks import _atomic_write_json


def test_atomic_write_json_roundtrip(tmp_path):
    target = tmp_path / "config.json"
    _atomic_write_json(target, {"a": 1})
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1}
    assert not list(tmp_path.glob("*.tmp"))


def test_atomic_write_json_overwrites_existing(tmp_path):
    target = tmp_path / "config.json"
    _atomic_write_json(target, {"a": 1})
    _atomic_write_json(target, {"b": 2})
    assert json.loads(target.read_text(encoding="utf-8")) == {"b": 2}
    assert not list(tmp_path.glob("*.tmp"))


def test_atomic_write_json_keeps_original_on_failure(tmp_path, monkeypatch):
    target = tmp_path / "config.json"
    _atomic_write_json(target, {"a": 1})

    def boom(fp, obj, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(json, "dump", boom)
    with pytest.raises(OSError):
        _atomic_write_json(target, {"a": 2})
    # 原文件内容未被破坏
    assert json.loads(target.read_text(encoding="utf-8")) == {"a": 1}
    # 临时文件已清理
    assert not list(tmp_path.glob("*.tmp"))
