"""Chat action-interval normalize / resolve helpers."""

from __future__ import annotations

import random
from typing import Any, Dict, Optional


class IntervalValidationError(ValueError):
    """Raised when action interval fields are invalid."""


def _as_non_negative_int(value: Any, default: int = 0) -> int:
    try:
        n = int(float(value))
    except (TypeError, ValueError):
        n = default
    if n < 0:
        raise IntervalValidationError("action interval must be >= 0")
    return n


def normalize_chat_interval(
    chat: dict, config_version: Optional[int] = 4
) -> Dict[str, Any]:
    """Return a copy of chat with full interval fields for v4 storage."""
    normalized = dict(chat)

    # v3 and older stored seconds
    raw_interval = normalized.get("action_interval", 1000)
    if config_version is None or config_version < 4:
        try:
            raw_interval = int(float(raw_interval) * 1000)
        except (TypeError, ValueError):
            raw_interval = 1000

    mode = normalized.get("action_interval_mode") or "fixed"
    if mode not in ("fixed", "random"):
        mode = "fixed"

    if mode == "random":
        min_ms = normalized.get("action_interval_min_ms")
        max_ms = normalized.get("action_interval_max_ms")
        if min_ms is None:
            min_ms = normalized.get("action_interval_ms", raw_interval)
        if max_ms is None:
            max_ms = min_ms
        min_ms = _as_non_negative_int(min_ms, 0)
        max_ms = _as_non_negative_int(max_ms, 0)
        if min_ms > max_ms:
            raise IntervalValidationError(
                f"action_interval_min_ms ({min_ms}) > action_interval_max_ms ({max_ms})"
            )
        normalized["action_interval_mode"] = "random"
        normalized["action_interval_min_ms"] = min_ms
        normalized["action_interval_max_ms"] = max_ms
        normalized["action_interval_ms"] = min_ms
        normalized["action_interval"] = min_ms
        return normalized

    # fixed
    if config_version is None or config_version < 4:
        ms = raw_interval  # already converted to ms above
    else:
        ms = normalized.get("action_interval_ms", normalized.get("action_interval", 1000))
    ms = _as_non_negative_int(ms, 1000)
    normalized["action_interval_mode"] = "fixed"
    normalized["action_interval_ms"] = ms
    normalized["action_interval_min_ms"] = ms
    normalized["action_interval_max_ms"] = ms
    normalized["action_interval"] = ms
    return normalized


def resolve_action_delay_ms(chat: Any) -> int:
    """Compute sleep delay in ms for one inter-action wait."""

    def get(key: str, default: Any = None) -> Any:
        if isinstance(chat, dict):
            return chat.get(key, default)
        return getattr(chat, key, default)

    mode = get("action_interval_mode") or "fixed"
    if mode == "random":
        lo = get("action_interval_min_ms")
        hi = get("action_interval_max_ms")
        if lo is None:
            lo = get("action_interval_ms", get("action_interval", 0))
        if hi is None:
            hi = lo
        lo = _as_non_negative_int(lo, 0)
        hi = _as_non_negative_int(hi, 0)
        if hi < lo:
            lo, hi = hi, lo
        return random.randint(lo, hi)

    ms = get("action_interval_ms")
    if ms is None:
        ms = get("action_interval", 0)
    return _as_non_negative_int(ms, 0)
