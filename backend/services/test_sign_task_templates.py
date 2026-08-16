import json
from pathlib import Path

import pytest

from backend.services.sign_task_templates import SignTaskTemplateService


def _make_service(tmp_path: Path, monkeypatch) -> SignTaskTemplateService:
    monkeypatch.setattr("backend.services.sign_task_templates.get_settings", lambda: _FakeSettings(tmp_path))
    return SignTaskTemplateService()


class _FakeSettings:
    def __init__(self, workdir: Path):
        self._workdir = workdir

    def resolve_workdir(self):
        return self._workdir


def _sample_config() -> dict:
    return {
        "chats": [{"chat_id": 123, "name": "chat_123", "actions": []}],
        "execution_mode": "fixed",
        "sign_at": "0 0 * * *",
        "range_start": "",
        "range_end": "",
        "random_seconds": 30,
        "sign_interval": 1,
    }


def test_save_and_list_template(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    saved = service.save_template("morning", _sample_config())
    assert saved["name"] == "morning"
    assert saved["chats"][0]["chat_id"] == 123

    items = service.list_templates()
    assert len(items) == 1
    assert items[0]["name"] == "morning"


def test_save_template_overwrites_same_name(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    service.save_template("morning", _sample_config())
    updated = {**_sample_config(), "random_seconds": 90}
    service.save_template("morning", updated)

    items = service.list_templates()
    assert len(items) == 1
    assert items[0]["random_seconds"] == 90


def test_delete_template(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    service.save_template("morning", _sample_config())
    assert service.delete_template("morning") is True
    assert service.list_templates() == []
    assert service.delete_template("morning") is False


def test_save_template_rejects_invalid_name(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    for bad in ["", "  ", "a/b", "a\\b", "a:b", "a<b", ".", ".."]:
        with pytest.raises(ValueError):
            service.save_template(bad, _sample_config())


def test_delete_template_rejects_path_traversal(tmp_path, monkeypatch):
    service = _make_service(tmp_path, monkeypatch)
    assert service.delete_template("../escape") is False
    assert service.delete_template(".") is False
