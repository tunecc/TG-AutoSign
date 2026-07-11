import random

import pytest

from backend.services.action_interval import (
    IntervalValidationError,
    normalize_chat_interval,
    resolve_action_delay_ms,
)


def test_legacy_action_interval_becomes_fixed():
    out = normalize_chat_interval({"chat_id": 1, "action_interval": 1500}, config_version=4)
    assert out["action_interval_mode"] == "fixed"
    assert out["action_interval_ms"] == 1500
    assert out["action_interval"] == 1500


def test_pre_v4_seconds_to_ms():
    out = normalize_chat_interval({"chat_id": 1, "action_interval": 2}, config_version=3)
    assert out["action_interval_ms"] == 2000
    assert out["action_interval_mode"] == "fixed"


def test_random_mode_writes_compat_field():
    out = normalize_chat_interval(
        {
            "chat_id": 1,
            "action_interval_mode": "random",
            "action_interval_min_ms": 1000,
            "action_interval_max_ms": 3000,
        },
        config_version=4,
    )
    assert out["action_interval"] == 1000
    assert out["action_interval_min_ms"] == 1000
    assert out["action_interval_max_ms"] == 3000


def test_min_gt_max_raises():
    with pytest.raises(IntervalValidationError):
        normalize_chat_interval(
            {
                "chat_id": 1,
                "action_interval_mode": "random",
                "action_interval_min_ms": 5000,
                "action_interval_max_ms": 1000,
            },
            config_version=4,
        )


def test_resolve_fixed_delay():
    assert resolve_action_delay_ms({"action_interval_mode": "fixed", "action_interval_ms": 1200}) == 1200


def test_resolve_random_delay_in_range(monkeypatch):
    monkeypatch.setattr(random, "randint", lambda a, b: 2500)
    delay = resolve_action_delay_ms(
        {
            "action_interval_mode": "random",
            "action_interval_min_ms": 1000,
            "action_interval_max_ms": 3000,
        }
    )
    assert delay == 2500


def test_resolve_legacy_only_action_interval():
    assert resolve_action_delay_ms({"action_interval": 800}) == 800
