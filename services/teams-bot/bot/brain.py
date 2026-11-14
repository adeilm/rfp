"""The bot's only call for answers: n8n's "RFP - Chat" webhook (POST /webhook/cstam/chat, header X-API-Key). Everything the
bot says about tenders comes back from there; this module only turns failures into plain sentences (the details go to the log)."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import aiohttp

log = logging.getLogger("teams-bot.brain")

_FAIL = {
    "en": "The assistant is not available right now ({why}). Try again in a few minutes.",
    "fr": "L'assistant n'est pas disponible pour le moment ({why}). Réessayez dans quelques minutes.",
}
_WHY = {
    "timeout": {"en": "it took too long to answer", "fr": "il a mis trop de temps à répondre"},
    "unreachable": {"en": "n8n cannot be reached", "fr": "n8n est injoignable"},
    "key": {"en": "n8n refused the bot's key", "fr": "n8n a refusé la clé du bot"},
    "missing": {"en": "the RFP - Chat workflow is not published in n8n", "fr": "le workflow RFP - Chat n'est pas publié dans n8n"},
    "error": {"en": "n8n answered with an error", "fr": "n8n a répondu par une erreur"},
}


def failure(why: str, lang: str) -> dict[str, Any]:
    lang = "fr" if lang == "fr" else "en"
    return {"text": _FAIL[lang].format(why=_WHY[why][lang]), "language": lang, "cards": [], "audit": [], "failed": why}


class Brain:
    def __init__(self, url: str, key: str, timeout_s: float = 120.0):
        self.url, self.key, self.timeout = url, key, aiohttp.ClientTimeout(total=timeout_s)

    async def ask(self, payload: dict[str, Any], lang: str = "en") -> dict[str, Any]:
        """POST one message or button to RFP - Chat -> its reply {text, language, cards, audit}."""
        try:
            async with aiohttp.ClientSession(timeout=self.timeout) as s:
                async with s.post(self.url, json=payload, headers={"X-API-Key": self.key}) as r:
                    if r.status in (401, 403):
                        log.error("RFP - Chat refused the key (HTTP %s): check AGENTS_WEBHOOK_KEY", r.status)
                        return failure("key", lang)
                    if r.status == 404:
                        log.error("RFP - Chat webhook not registered (HTTP 404): publish the workflow in n8n")
                        return failure("missing", lang)
                    if r.status != 200:
                        log.error("RFP - Chat answered HTTP %s: %s", r.status, (await r.text())[:300])
                        return failure("error", lang)
                    body = await r.json(content_type=None)
        except asyncio.TimeoutError:
            log.error("RFP - Chat did not answer within %ss", self.timeout.total)
            return failure("timeout", lang)
        except aiohttp.ClientError as e:
            log.error("RFP - Chat unreachable: %s", type(e).__name__)
            return failure("unreachable", lang)
        except ValueError:
            log.error("RFP - Chat answered something that is not JSON")
            return failure("error", lang)
        if not isinstance(body, dict) or not isinstance(body.get("text"), str):
            log.error("RFP - Chat answered without text: %.300s", body)
            return failure("error", lang)
        body.setdefault("cards", [])
        body.setdefault("audit", [])
        return body
