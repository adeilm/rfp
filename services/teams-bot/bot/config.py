"""Settings, all from the environment (docker-compose.yml passes them from .env). No secret is ever logged."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).replace("﻿", "").strip()


def _list(name: str) -> frozenset[str]:
    """A comma or space separated list of Entra (AAD) object ids, lower-cased."""
    return frozenset(x.strip().lower() for x in _env(name).replace(",", " ").split() if x.strip())


def _on(name: str) -> bool:
    return _env(name).lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    app_id: str = field(default_factory=lambda: _env("BOT_APP_ID"))
    app_password: str = field(default_factory=lambda: _env("BOT_APP_PASSWORD"))
    tenant_id: str = field(default_factory=lambda: _env("BOT_TENANT_ID"))
    # the key n8n sends to POST /notify (header X-Notify-Key); the test routes need it too
    notify_key: str = field(default_factory=lambda: _env("BOT_NOTIFY_KEY"))
    # the conversation that gets Main's alerts; empty = the one set with "alerts here" (stored in the data folder)
    notify_channel: str = field(default_factory=lambda: _env("BOT_NOTIFY_CHANNEL"))
    allowed_users: frozenset[str] = field(default_factory=lambda: _list("TEAMS_ALLOWED_USERS"))
    approver_users: frozenset[str] = field(default_factory=lambda: _list("TEAMS_APPROVER_USERS"))
    # n8n's RFP - Chat webhook and its key (the same AGENTS_WEBHOOK_KEY as the deck agents' webhooks)
    chat_url: str = field(default_factory=lambda: _env("BOT_CHAT_URL", "http://n8n:5678/webhook/cstam/chat"))
    chat_key: str = field(default_factory=lambda: _env("AGENTS_WEBHOOK_KEY"))
    chat_timeout_s: float = field(default_factory=lambda: float(_env("BOT_CHAT_TIMEOUT_S", "120") or 120))
    data_dir: str = field(default_factory=lambda: _env("BOT_DATA_DIR", "/data"))
    port: int = field(default_factory=lambda: int(_env("BOT_PORT", "3978") or 3978))
    # BOT_TEST_MODE=1: POST /test/messages runs a fake Teams activity with no Teams token (header X-Notify-Key required) and
    # /notify keeps what it would send in GET /test/outbox. For the simulator and the tests only.
    test_mode: bool = field(default_factory=lambda: _on("BOT_TEST_MODE"))

    @property
    def teams_configured(self) -> bool:
        """The three values of the Azure Bot registration (single-tenant). Without them the bot stays idle."""
        return bool(self.app_id and self.app_password and self.tenant_id)

    def may_use(self, user_id: str) -> bool:
        return not self.allowed_users or user_id.lower() in self.allowed_users

    def may_act(self, user_id: str) -> bool:
        """State-changing actions (start a deck, refine a slide, record a no-bid): approvers only, when a list is set."""
        if not self.may_use(user_id):
            return False
        return not self.approver_users or user_id.lower() in self.approver_users
