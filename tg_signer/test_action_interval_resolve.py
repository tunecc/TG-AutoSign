from tg_signer.action_interval import resolve_action_delay_ms


def test_object_style_chat():
    class C:
        action_interval_mode = "fixed"
        action_interval_ms = 400
        action_interval = 400

    assert resolve_action_delay_ms(C()) == 400
