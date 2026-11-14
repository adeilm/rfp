"""What the bot reads from an incoming Teams activity (a plain dict, the Bot Framework JSON schema)."""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from typing import Any

_TAG = re.compile(r"<[^>]+>")


@dataclass
class Incoming:
    text: str
    action: dict[str, Any] | None
    user_id: str
    user_name: str
    locale: str
    conversation_id: str
    conversation_type: str          # personal | channel | groupChat
    service_url: str
    raw: dict[str, Any] = field(repr=False, default_factory=dict)


def strip_mentions(text: str, activity: dict[str, Any]) -> str:
    """The message without the bot's @mention. Teams writes "<at>TendOlive</at> top tenders" in channels; the mention entities
    name the exact text. Other people's mentions stay (they can be part of the question)."""
    bot_id = ((activity.get("recipient") or {}).get("id") or "").lower()
    for ent in activity.get("entities") or []:
        if not isinstance(ent, dict) or ent.get("type") != "mention":
            continue
        who = ((ent.get("mentioned") or {}).get("id") or "").lower()
        said = ent.get("text") or ""
        if said and (not bot_id or who == bot_id):
            text = text.replace(said, " ")
    # a mention Teams sent without its entity: only when it is the first thing in the message (how a channel @mention looks)
    text = re.sub(r"^\s*<at\b[^>]*>.*?</at>", " ", text, flags=re.IGNORECASE | re.DOTALL)
    text = html.unescape(_TAG.sub(" ", text))
    return re.sub(r"\s+", " ", text).strip()


def parse(activity: dict[str, Any]) -> Incoming:
    frm = activity.get("from") or {}
    conv = activity.get("conversation") or {}
    value = activity.get("value")
    action = None
    # an Adaptive Card button (Action.Submit): Teams posts a message whose value is the button's data plus the card's inputs
    if isinstance(value, dict) and isinstance(value.get("action"), str):
        action = {"name": value["action"][:40], "tender_id": str(value.get("tender_id") or "")[:80], "reason": str(value.get("reason") or "")[:300]}
    conv_type = conv.get("conversationType") or ("channel" if conv.get("isGroup") else "personal")
    return Incoming(
        text=strip_mentions(str(activity.get("text") or ""), activity) if action is None else "",
        action=action,
        # the Entra (AAD) object id identifies the person across chats; frm["id"] is the Teams-specific id
        user_id=str(frm.get("aadObjectId") or frm.get("id") or ""),
        user_name=str(frm.get("name") or ""),
        locale=str(activity.get("locale") or ""),
        conversation_id=str(conv.get("id") or ""),
        conversation_type=str(conv_type),
        service_url=str(activity.get("serviceUrl") or ""),
        raw=activity,
    )
