import asyncio

from tg_signer.core import UserSigner


def test_run_once_defaults_to_force_rerun(monkeypatch):
    recorded = {}

    async def fake_run(self, num_of_dialogs=20, only_once=False, force_rerun=False):
        recorded["call"] = (num_of_dialogs, only_once, force_rerun)

    monkeypatch.setattr(UserSigner, "run", fake_run)
    signer = object.__new__(UserSigner)

    asyncio.run(signer.run_once(7))
    assert recorded["call"] == (7, True, True)

    asyncio.run(signer.run_once(7, force_rerun=False))
    assert recorded["call"] == (7, True, False)
