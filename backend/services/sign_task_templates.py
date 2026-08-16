"""
签到任务配置模板服务
提供任务配置模板的 CRUD（列表/保存/删除），存储于 <workdir>/task_templates/
模板与账号解耦：只保存 chats（含 chat_id + actions）与调度/延迟/间隔配置
"""

from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.core.config import get_settings

logger = __import__("logging").getLogger("backend.sign_task_templates")

_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*]')


def _validate_template_name(name: str) -> str:
    """校验模板名，复用 name_must_be_valid_filename 规则"""
    if not name or not name.strip():
        raise ValueError("模板名称不能为空")
    stripped = name.strip()
    if stripped in (".", ".."):
        raise ValueError("模板名称不能为 . 或 ..")
    if _INVALID_FILENAME_CHARS.search(stripped):
        raise ValueError('模板名称不能包含特殊字符: < > : " / \\ | ? *')
    return stripped


class SignTaskTemplateService:
    def __init__(self, workdir: Optional[Path] = None):
        if workdir is None:
            workdir = get_settings().resolve_workdir()
        self.workdir = workdir
        self.templates_dir = self.workdir / "task_templates"
        self.templates_dir.mkdir(parents=True, exist_ok=True)

    def _template_file(self, name: str) -> Path:
        safe_name = _validate_template_name(name)
        return self.templates_dir / f"{safe_name}.json"

    def list_templates(self) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for path in sorted(self.templates_dir.glob("*.json")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    items.append(data)
            except Exception as e:
                logger.warning("读取模板失败: %s, 错误: %s", path, e)
        return items

    def get_template(self, name: str) -> Optional[Dict[str, Any]]:
        path = self._template_file(name)
        if not path.exists():
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception:
            return None

    def save_template(self, name: str, config: Dict[str, Any]) -> Dict[str, Any]:
        safe_name = _validate_template_name(name)
        template = {
            "name": safe_name,
            "chats": config.get("chats", []),
            "execution_mode": config.get("execution_mode", "fixed"),
            "sign_at": config.get("sign_at", ""),
            "range_start": config.get("range_start", ""),
            "range_end": config.get("range_end", ""),
            "random_seconds": config.get("random_seconds", 0),
            "sign_interval": config.get("sign_interval", 1),
            "updated_at": datetime.now().isoformat(),
        }
        path = self.templates_dir / f"{safe_name}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(template, f, ensure_ascii=False, indent=2)
        return template

    def delete_template(self, name: str) -> bool:
        try:
            path = self._template_file(name)
        except ValueError:
            return False
        if not path.exists():
            return False
        try:
            path.unlink()
            return True
        except Exception as e:
            logger.warning("删除模板失败: %s, 错误: %s", path, e)
            return False


_service: Optional[SignTaskTemplateService] = None


def get_sign_task_template_service() -> SignTaskTemplateService:
    global _service
    if _service is None:
        _service = SignTaskTemplateService()
    return _service
