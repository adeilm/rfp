"""The bot's turn logic, independent of the Teams SDK (so the simulator and the tests run it as it is): who may use the bot, the
few commands the bot answers itself (its own settings), the call to n8n, the cards and the audit log."""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Awaitable, Callable

from . import cards
from .activity import Incoming
from .brain import Brain
from .config import Settings
from .store import Store

log = logging.getLogger("teams-bot.core")

# commands about the bot itself, answered here (n8n knows nothing about Teams conversations)
_ALERTS_HERE = re.compile(r"^(alerts? here|alertes? ici)[.!]?$", re.IGNORECASE)
_ALERTS_OFF = re.compile(r"^(alerts? off|alertes? off|stop alerts?|arr[eê]te les alertes)[.!]?$", re.IGNORECASE)
_WHOAMI = re.compile(r"^(who ?am ?i|my id|mon id|qui suis[- ]je)\??$", re.IGNORECASE)
_STATE_CHANGING = {"generate_deck", "no_bid"}


def _lang(inc: Incoming) -> str:
    return "fr" if inc.locale.lower().startswith("fr") else "en"


def outgoing(reply: dict[str, Any]) -> dict[str, Any]:
    """n8n's reply -> what the adapter sends: Teams markdown text (one line per paragraph) and the card attachments."""
    text = str(reply.get("text") or "").strip().replace("\r", "")
    text = re.sub(r"\n+", "\n\n", text)
    return {"text": text, "attachments": cards.render(reply.get("cards"), str(reply.get("language") or "en"))}


class Core:
    def __init__(self, settings: Settings, store: Store, brain: Brain, retry_after_s: int = 30):
        self.settings, self.store, self.brain, self.retry_after_s = settings, store, brain, retry_after_s

    def _say(self, en: str, fr: str, inc: Incoming) -> list[dict[str, Any]]:
        return [{"text": fr if _lang(inc) == "fr" else en, "attachments": []}]

    async def handle(self, inc: Incoming, progress: Callable[[list[dict[str, Any]]], Awaitable[None]] | None = None) -> list[dict[str, Any]]:
        """One message or card button -> the messages to send back (usually one). `progress` posts a message at once (the
        "busy, retrying" note while the model's rate limit passes)."""
        s = self.settings
        if not s.may_use(inc.user_id):
            log.warning("refused a user not in TEAMS_ALLOWED_USERS (%s)", inc.user_id)
            return self._say("You are not allowed to use this assistant. Ask your administrator to add you.",
                             "Vous n'êtes pas autorisé à utiliser cet assistant. Demandez à votre administrateur de vous ajouter.", inc)
        text = inc.text.strip()
        if inc.action is None and _WHOAMI.match(text):
            role = "approver" if s.may_act(inc.user_id) else "reader"
            return self._say(f"Your Entra object id is {inc.user_id or 'unknown'} ({role}). Admins list it in TEAMS_APPROVER_USERS.",
                             f"Votre identifiant Entra est {inc.user_id or 'inconnu'} ({'approbateur' if role == 'approver' else 'lecteur'}). "
                             "Les administrateurs le mettent dans TEAMS_APPROVER_USERS.", inc)
        if inc.action is None and (_ALERTS_HERE.match(text) or _ALERTS_OFF.match(text)):
            if not s.may_act(inc.user_id):
                return self._say("Only an approver can choose where the alerts go.", "Seul un approbateur peut choisir où vont les alertes.", inc)
            here = bool(_ALERTS_HERE.match(text))
            self.store.set_alert_conversation(inc.conversation_id if here else None)
            self.store.audit(user_id=inc.user_id, user_name=inc.user_name, conversation_id=inc.conversation_id,
                             action="alerts_here" if here else "alerts_off", outcome="ok")
            if s.notify_channel:
                note_en, note_fr = " (BOT_NOTIFY_CHANNEL in .env still takes precedence.)", " (BOT_NOTIFY_CHANNEL dans .env reste prioritaire.)"
            else:
                note_en = note_fr = ""
            return self._say(("New fit tenders will be posted here." if here else "Alerts are off.") + note_en,
                             ("Les nouveaux appels d'offres pertinents seront publiés ici." if here else "Les alertes sont désactivées.") + note_fr, inc)

        can_act = s.may_act(inc.user_id)
        payload = {"text": text, "action": inc.action, "user": {"id": inc.user_id, "name": inc.user_name}, "locale": inc.locale,
                   "conversation": {"id": inc.conversation_id, "type": inc.conversation_type}, "can_act": can_act}
        if inc.action and inc.action.get("name") in _STATE_CHANGING:
            self.store.audit(user_id=inc.user_id, user_name=inc.user_name, conversation_id=inc.conversation_id,
                             action=inc.action["name"], tender_id=inc.action.get("tender_id"), outcome="requested" if can_act else "refused (not an approver)")
        reply = await self.brain.ask(payload, _lang(inc))
        if reply.get("busy") and inc.action is None:
            # the chat model's rate limit (Groq's free tier: tokens per minute): say so, wait, ask once more. A button is not
            # retried by itself: it may have started something before the model was called
            fr = reply.get("language") == "fr"
            note = (f"L'assistant est occupé (limite de débit du modèle) : nouvel essai dans {self.retry_after_s} secondes…" if fr
                    else f"The assistant is busy (the model's rate limit): retrying in {self.retry_after_s} seconds…")
            if progress:
                await progress([{"text": note, "attachments": []}])
            await asyncio.sleep(self.retry_after_s)
            reply = await self.brain.ask(payload, _lang(inc))
        for a in reply.get("audit") or []:
            if isinstance(a, dict):
                self.store.audit(user_id=inc.user_id, user_name=inc.user_name, conversation_id=inc.conversation_id, outcome="done",
                                 **{k: v for k, v in a.items() if k in ("action", "tender_id", "run_id", "deck_id", "slide")})
        return [outgoing(reply)]

    def notify_target(self, conversation_id: str | None) -> str | None:
        """Where a /notify goes: the conversation n8n names (a deck asked from chat), else BOT_NOTIFY_CHANNEL, else "alerts here"."""
        return conversation_id or self.settings.notify_channel or self.store.alert_conversation
