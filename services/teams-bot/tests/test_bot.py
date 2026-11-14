"""Teams bot tests: python -m pytest -q (inside the image: docker compose run --rm --no-deps teams-bot python -m pytest -q).
No Teams, no n8n, no network: n8n is a fake aiohttp server or a fake Brain; Teams activities are recorded JSON shapes."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from aiohttp import web

from bot import cards
from bot.activity import parse, strip_mentions
from bot.app import create_app
from bot.brain import Brain
from bot.config import Settings
from bot.core import Core
from bot.store import Store

SNAP = Path(__file__).parent / "snapshots"
KEY = "test-notify-key-0123456789"
BOT_ID = "28:bot-app-id"
USER = "00000000-0000-0000-0000-0000000000aa"
APPROVER = "00000000-0000-0000-0000-0000000000bb"

CHANNEL_MSG = {
    "type": "message", "id": "1730300000000", "channelId": "msteams", "serviceUrl": "https://smba.trafficmanager.net/emea/",
    "from": {"id": "29:user-teams-id", "name": "Sam Doe", "aadObjectId": USER},
    "recipient": {"id": BOT_ID, "name": "TendOlive"},
    "conversation": {"id": "19:abc@thread.tacv2;messageid=1730300000000", "conversationType": "channel", "isGroup": True, "tenantId": "tid"},
    "text": "<at>TendOlive</at> top tenders for <at>Alex</at>", "locale": "en-US", "textFormat": "plain",
    "entities": [{"type": "mention", "text": "<at>TendOlive</at>", "mentioned": {"id": BOT_ID, "name": "TendOlive"}},
                 {"type": "mention", "text": "<at>Alex</at>", "mentioned": {"id": "29:alex", "name": "Alex"}}],
    "channelData": {"tenant": {"id": "tid"}},
}
BUTTON = {**CHANNEL_MSG, "text": None, "entities": [], "conversation": {"id": "a:personal-chat", "conversationType": "personal"},
          "value": {"action": "no_bid", "tender_id": "T1w50xyr", "reason": "  too far from our offer  "}}
TENDER = {"tender_id": "T1w50xyr", "title": "Prestations de développement d'agents LLM", "buyer": "CITY'UP", "demo": False, "source": "boamp",
          "deadline": "2026-11-26", "days_left": 26, "budget": "250000", "fit": 72, "covered": 5, "partial": 2, "missing": 1,
          "mandatory_missing": 1, "decision": None, "url": "http://localhost:5173/tenders/T1w50xyr", "notice_url": "https://www.boamp.fr/x"}


def settings(tmp_path, **kw) -> Settings:
    base = dict(app_id="", app_password="", tenant_id="", notify_key=KEY, notify_channel="", allowed_users=frozenset(),
                approver_users=frozenset(), chat_url="http://n8n.invalid/webhook/cstam/chat", chat_key="k", chat_timeout_s=5,
                data_dir=str(tmp_path), port=3978, test_mode=True)
    base.update(kw)
    return Settings(**base)


class FakeBrain:
    def __init__(self, reply=None):
        self.calls, self.reply = [], reply or {"text": "Line one\nLine two", "language": "en", "cards": [{"type": "tender", "data": TENDER}], "audit": []}

    async def ask(self, payload, lang="en"):
        self.calls.append(payload)
        return self.reply


# ---------------------------------------------------------------- activities
def test_channel_mention_is_stripped_other_mentions_kept():
    inc = parse(CHANNEL_MSG)
    assert inc.text == "top tenders for Alex"
    assert inc.user_id == USER and inc.conversation_type == "channel" and inc.action is None


def test_mention_without_entity_at_start_is_stripped():
    assert strip_mentions("<at>TendOlive</at>  status", {"recipient": {"id": BOT_ID}}) == "status"


def test_button_value_becomes_action():
    inc = parse(BUTTON)
    assert inc.action == {"name": "no_bid", "tender_id": "T1w50xyr", "reason": "  too far from our offer  "}
    assert inc.text == "" and inc.conversation_type == "personal"


def test_sdk_activity_roundtrip_keeps_what_the_bot_reads():
    """The glue dumps the SDK's Activity with aliases: parse must read the same fields as from Teams' JSON."""
    from microsoft_agents.activity import Activity, ConversationReference
    a = Activity.model_validate(CHANNEL_MSG)
    dumped = a.model_dump(mode="json", by_alias=True, exclude_none=True)
    inc = parse(dumped)
    assert (inc.text, inc.user_id, inc.conversation_id, inc.conversation_type) == ("top tenders for Alex", USER, CHANNEL_MSG["conversation"]["id"], "channel")
    ref = a.get_conversation_reference().model_dump(mode="json", by_alias=True, exclude_none=True)
    back = ConversationReference.model_validate(json.loads(json.dumps(ref)))
    cont = back.get_continuation_activity()
    assert cont.conversation.id == CHANNEL_MSG["conversation"]["id"] and cont.service_url == CHANNEL_MSG["serviceUrl"]


# ---------------------------------------------------------------- cards
def _snapshot(name: str, card: dict) -> None:
    SNAP.mkdir(exist_ok=True)
    path = SNAP / f"{name}.json"
    text = json.dumps(card, ensure_ascii=False, indent=1, sort_keys=True)
    if not path.exists():                       # first run writes the snapshot; later runs compare
        path.write_text(text, encoding="utf-8")
    assert json.loads(path.read_text(encoding="utf-8")) == json.loads(text), f"{name} changed: delete tests/snapshots/{name}.json if intended"


def test_tender_card_snapshot_and_buttons():
    card = cards.tender_card(TENDER, "en")
    _snapshot("tender_card_en", card)
    acts = card["actions"]
    assert acts[0] == {"type": "Action.OpenUrl", "title": "Open tender", "url": TENDER["url"]}
    assert acts[1]["data"] == {"action": "generate_deck", "tender_id": "T1w50xyr"}
    show = acts[2]["card"]
    assert show["body"][0]["id"] == "reason" and show["actions"][0]["data"] == {"action": "no_bid", "tender_id": "T1w50xyr"}
    facts = {f["title"]: f["value"] for f in card["body"][2]["facts"]}
    assert facts["RAG fit"] == "72 / 100" and facts["Requirements"] == "5 covered · 2 partial · 1 missing (1 mandatory)"


def test_tender_card_french_demo_and_decided():
    card = cards.tender_card({**TENDER, "demo": True, "decision": {"decision": "no_bid", "reason": "hors périmètre"}}, "fr")
    _snapshot("tender_card_fr_demo_nobid", card)
    assert card["body"][0]["text"].endswith("(démo)")
    assert not any(a.get("data", {}).get("action") in ("generate_deck", "no_bid") for a in card["actions"])


def test_alert_card_has_header():
    card = cards.tender_card({**TENDER, "alert": True, "fit_level": "high", "market": {"low": 150000, "mid": 200000, "high": 260000, "currency": "EUR"}}, "en")
    _snapshot("alert_card_en", card)
    assert card["body"][0]["text"] == "New high-fit tender"


def test_matrix_list_coverage_deck_snapshots():
    rows = [{"n": i, "requirement": f"Requirement {i}", "status": ["covered", "partial", "missing"][i % 3], "mandatory": i == 2, "basis": "CV_13_Isabella_Ross.pdf"} for i in range(12)]
    m = cards.matrix_card({"tender": TENDER, "rows": rows, "total": 12}, "en")
    _snapshot("matrix_card_en", m)
    assert sum(1 for b in m["body"] if b["type"] == "Container") == 8 and "Showing 8 of 12" in m["body"][-1]["text"]
    _snapshot("tender_list_card_en", cards.tender_list_card({"tenders": [TENDER] * 7, "total": 9, "filters": ["open (deadline not passed)"]}, "en"))
    _snapshot("coverage_card_en", cards.coverage_card({"rows": rows[:3], "team": [{"name": "Julian Hayes", "title": "Project Manager", "certifications": ["PMP"]}]}, "en"))
    d = cards.deck_card({"status": "done", "deck_id": "91002df3", "deck_url": "http://localhost:5173/decks/91002df3", "placeholders": 3, "title": "X", "tender_id": "T1"}, "en")
    _snapshot("deck_card_en", d)
    assert d["actions"][0]["url"].endswith("/decks/91002df3")


def test_render_skips_unknown_and_bad_urls_and_stays_small():
    out = cards.render([{"type": "nope", "data": {}}, {"type": "tender", "data": {**TENDER, "url": "javascript:alert(1)"}}], "en")
    assert len(out) == 1 and out[0]["contentType"] == cards.CONTENT_TYPE
    assert all(a["type"] != "Action.OpenUrl" or a["url"].startswith("http") for a in out[0]["content"]["actions"])
    big = {"tenders": [{**TENDER, "title": "x" * 5000}] * 5, "total": 5}
    out = cards.render([{"type": "tender_list", "data": big}] * 3, "en")
    assert sum(len(json.dumps(o["content"]).encode()) for o in out) <= cards.MAX_CARD_BYTES


# ---------------------------------------------------------------- store
def test_conversation_references_and_alerts_persist(tmp_path):
    s = Store(str(tmp_path))
    s.remember("19:abc", {"conversation": {"id": "19:abc"}, "serviceUrl": "https://x"}, "channel")
    s.set_alert_conversation("19:abc")
    s.audit(user_id=USER, action="no_bid", tender_id="T1", outcome="done")
    again = Store(str(tmp_path))
    assert again.reference("19:abc")["serviceUrl"] == "https://x" and again.alert_conversation == "19:abc"
    line = json.loads((tmp_path / "audit.log").read_text(encoding="utf-8").splitlines()[0])
    assert line["user_id"] == USER and line["action"] == "no_bid"


def test_store_survives_a_corrupt_file(tmp_path):
    (tmp_path / "conversations.json").write_text("{not json", encoding="utf-8")
    assert Store(str(tmp_path)).reference("x") is None


# ---------------------------------------------------------------- core
async def test_core_access_control_and_payload(tmp_path):
    brain = FakeBrain()
    core = Core(settings(tmp_path, allowed_users=frozenset({USER, APPROVER}), approver_users=frozenset({APPROVER})), Store(str(tmp_path)), brain)
    out = await core.handle(parse({**CHANNEL_MSG, "from": {"id": "29:x", "aadObjectId": "someone-else"}}))
    assert "not allowed" in out[0]["text"] and not brain.calls
    out = await core.handle(parse(CHANNEL_MSG))
    assert brain.calls[-1]["can_act"] is False and brain.calls[-1]["text"] == "top tenders for Alex"
    assert out[0]["text"] == "Line one\n\nLine two" and out[0]["attachments"][0]["content"]["type"] == "AdaptiveCard"
    await core.handle(parse({**BUTTON, "from": {"id": "29:b", "aadObjectId": APPROVER}}))
    assert brain.calls[-1]["can_act"] is True and brain.calls[-1]["action"]["name"] == "no_bid"
    log = [json.loads(x) for x in (tmp_path / "audit.log").read_text(encoding="utf-8").splitlines()]
    assert log[-1]["action"] == "no_bid" and log[-1]["outcome"] == "requested" and log[-1]["user_id"] == APPROVER


async def test_core_own_commands(tmp_path):
    store = Store(str(tmp_path))
    core = Core(settings(tmp_path, approver_users=frozenset({APPROVER})), store, FakeBrain())
    who = await core.handle(parse({**CHANNEL_MSG, "text": "<at>TendOlive</at> whoami"}))
    assert USER in who[0]["text"] and "reader" in who[0]["text"]
    refused = await core.handle(parse({**CHANNEL_MSG, "text": "alerts here", "entities": []}))
    assert "Only an approver" in refused[0]["text"] and store.alert_conversation is None
    ok = await core.handle(parse({**CHANNEL_MSG, "text": "alertes ici", "entities": [], "from": {"id": "29:b", "aadObjectId": APPROVER}, "locale": "fr-FR"}))
    assert "publiés ici" in ok[0]["text"] and store.alert_conversation == CHANNEL_MSG["conversation"]["id"]


async def test_busy_model_is_retried_once(tmp_path):
    """n8n says busy (the chat model's 429): the bot posts a note at once, waits, asks again once; a button is never retried."""
    class Busy(FakeBrain):
        async def ask(self, payload, lang="en"):
            self.calls.append(payload)
            return {"text": "busy", "language": "en", "cards": [], "busy": True} if len(self.calls) == 1 else {"text": "answer", "language": "en", "cards": []}
    brain, notes = Busy(), []

    async def progress(msgs):
        notes.extend(msgs)
    core = Core(settings(tmp_path), Store(str(tmp_path)), brain, retry_after_s=0.01)
    out = await core.handle(parse(CHANNEL_MSG), progress=progress)
    assert len(brain.calls) == 2 and "retrying" in notes[0]["text"] and out[0]["text"] == "answer"
    button_brain = Busy()
    out = await Core(settings(tmp_path), Store(str(tmp_path)), button_brain, retry_after_s=0.01).handle(parse(BUTTON))
    assert len(button_brain.calls) == 1 and out[0]["text"] == "busy"


# ---------------------------------------------------------------- brain (fake n8n)
async def _fake_n8n(aiohttp_server, status=200, body=None, delay=0.0):
    seen = {}

    async def chat(request):
        seen["key"] = request.headers.get("X-API-Key")
        seen["json"] = await request.json()
        await asyncio.sleep(delay)
        return web.json_response(body if body is not None else {"text": "ok", "language": "en", "cards": []}, status=status)
    app = web.Application()
    app.router.add_post("/webhook/cstam/chat", chat)
    server = await aiohttp_server(app)
    return f"http://{server.host}:{server.port}/webhook/cstam/chat", seen


async def test_brain_sends_key_and_reads_reply(aiohttp_server):
    url, seen = await _fake_n8n(aiohttp_server)
    reply = await Brain(url, "secret-key", 5).ask({"text": "hi"})
    assert reply["text"] == "ok" and seen["key"] == "secret-key" and seen["json"] == {"text": "hi"}


@pytest.mark.parametrize("status,why", [(401, "key"), (404, "missing"), (500, "error")])
async def test_brain_failures_are_plain_sentences(aiohttp_server, status, why):
    url, _ = await _fake_n8n(aiohttp_server, status=status, body={"message": "internal stack trace"})
    reply = await Brain(url, "k", 5).ask({"text": "hi"}, "fr")
    assert reply["failed"] == why and "stack" not in reply["text"] and reply["text"].startswith("L'assistant")


async def test_brain_timeout_and_unreachable(aiohttp_server):
    url, _ = await _fake_n8n(aiohttp_server, delay=2)
    assert (await Brain(url, "k", 0.5).ask({"text": "hi"}))["failed"] == "timeout"
    assert (await Brain("http://127.0.0.1:1/webhook/cstam/chat", "k", 2).ask({"text": "hi"}))["failed"] == "unreachable"


# ---------------------------------------------------------------- HTTP: /health, /notify, /test, JWT
async def test_idle_without_credentials(aiohttp_client, tmp_path):
    client = await aiohttp_client(create_app(settings(tmp_path, test_mode=False), FakeBrain()))
    health = await (await client.get("/health")).json()
    assert health["teams"] is False and health["status"] == "ok"
    assert (await client.post("/api/messages", json=CHANNEL_MSG)).status == 503
    assert (await client.post("/test/messages", json=CHANNEL_MSG)).status in (404, 405)   # no test route outside test mode


async def test_notify_auth_and_targets(aiohttp_client, tmp_path):
    client = await aiohttp_client(create_app(settings(tmp_path), FakeBrain()))
    card = {"text": "New fit tender", "cards": [{"type": "tender", "data": TENDER}]}
    assert (await client.post("/notify", json=card)).status == 401
    assert (await client.post("/notify", json=card, headers={"X-Notify-Key": "wrong"})).status == 401
    assert (await client.post("/notify", json=card, headers={"X-Notify-Key": KEY})).status == 409          # no alert conversation yet
    r = await client.post("/notify", json={**card, "conversation_id": "a:personal-chat"}, headers={"X-Notify-Key": KEY})
    assert r.status == 200
    outbox = (await (await client.get("/test/outbox", headers={"X-Notify-Key": KEY})).json())["outbox"]
    assert outbox[0]["conversation_id"] == "a:personal-chat" and outbox[0]["attachments"][0]["content"]["body"]


async def test_notify_without_key_configured(aiohttp_client, tmp_path):
    client = await aiohttp_client(create_app(settings(tmp_path, notify_key=""), FakeBrain()))
    assert (await client.post("/notify", json={"text": "x"}, headers={"X-Notify-Key": ""})).status == 503


async def test_simulated_turn(aiohttp_client, tmp_path):
    brain = FakeBrain()
    client = await aiohttp_client(create_app(settings(tmp_path), brain))
    assert (await client.post("/test/messages", json=CHANNEL_MSG)).status == 401
    r = await client.post("/test/messages", json=CHANNEL_MSG, headers={"X-Notify-Key": KEY})
    replies = (await r.json())["replies"]
    assert replies[0]["attachments"][0]["content"]["body"][0]["text"].startswith("Prestations")


async def test_jwt_is_required_when_teams_is_configured(aiohttp_client, tmp_path):
    """With the Azure Bot registration set, /api/messages goes through the SDK's JWT check: no token or a bad one is a 401."""
    s = settings(tmp_path, app_id="11111111-1111-1111-1111-111111111111", app_password="x", tenant_id="22222222-2222-2222-2222-222222222222", test_mode=False)
    client = await aiohttp_client(create_app(s, FakeBrain()))
    assert (await (await client.get("/health")).json())["teams"] is True
    assert (await client.post("/api/messages", json=CHANNEL_MSG)).status == 401
    assert (await client.post("/api/messages", json=CHANNEL_MSG, headers={"Authorization": "Bearer not.a.jwt"})).status == 401
    assert (await client.post("/api/messages", json=CHANNEL_MSG, headers={"Authorization": "Basic abc"})).status == 401
