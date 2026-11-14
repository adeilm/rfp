"""TendOlive's Teams bot: the HTTP service (aiohttp, port 3978).

  POST /api/messages   Teams activities from Azure Bot Service. The Microsoft 365 Agents SDK checks the Bot Framework JWT
                       (single-tenant: audience = BOT_APP_ID, tenant = BOT_TENANT_ID) and signs the replies. The bot shows
                       "typing", answers at once with 200, then posts n8n's answer as a proactive message (n8n can take a minute;
                       Teams expects the HTTP answer within seconds).
  POST /notify         n8n pushes a card (Main's alerts, a finished deck). Header X-Notify-Key = BOT_NOTIFY_KEY.
  GET  /health         always 200; says whether Teams is configured. Without BOT_APP_ID / BOT_APP_PASSWORD / BOT_TENANT_ID the
                       bot is idle: /api/messages answers 503 and the rest of the system is unaffected.
  BOT_TEST_MODE=1 only, with X-Notify-Key: POST /test/messages (a fake activity, no Teams token, replies in the HTTP answer) and
  GET/DELETE /test/outbox (what /notify would have posted). For scripts/simulate_teams.py and the tests.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Any

from aiohttp import web

from .activity import parse
from .brain import Brain
from .config import Settings
from .core import Core, outgoing
from .store import Store

log = logging.getLogger("teams-bot")


def _key_ok(request: web.Request, settings: Settings) -> bool:
    given = request.headers.get("X-Notify-Key", "")
    return bool(settings.notify_key) and hmac.compare_digest(given.encode(), settings.notify_key.encode())


class TeamsGlue:
    """The Microsoft 365 Agents SDK side: built only when the Azure Bot registration is configured."""

    def __init__(self, settings: Settings, core: Core):
        from microsoft_agents.activity import Activity, ConversationReference
        from microsoft_agents.authentication.msal import MsalConnectionManager
        from microsoft_agents.hosting.aiohttp import CloudAdapter
        from microsoft_agents.hosting.core import CardFactory, MessageFactory

        self.settings, self.core = settings, core
        self.Activity, self.ConversationReference, self.CardFactory, self.MessageFactory = Activity, ConversationReference, CardFactory, MessageFactory
        # single-tenant: MSAL authority login.microsoftonline.com/<tenant>; the inbound token must have aud = the app id
        config = {"CONNECTIONS": {"SERVICE_CONNECTION": {"SETTINGS": {
            "CLIENTID": settings.app_id, "CLIENTSECRET": settings.app_password, "TENANTID": settings.tenant_id}}}}
        self.connections = MsalConnectionManager(**config)
        self.adapter = CloudAdapter(connection_manager=self.connections)
        self._tasks: set[asyncio.Task] = set()

    @property
    def auth_configuration(self):
        return self.connections.get_default_connection_configuration()

    def _activity(self, msg: dict[str, Any]):
        attachments = [self.CardFactory.adaptive_card(a["content"]) for a in msg["attachments"]]
        if attachments:
            return self.MessageFactory.list(attachments, text=msg["text"] or None)
        return self.MessageFactory.text(msg["text"])

    async def on_turn(self, context) -> None:
        """The SDK's Agent protocol: one incoming activity."""
        a = context.activity
        raw = a.model_dump(mode="json", by_alias=True, exclude_none=True)
        inc = parse(raw)
        ref = a.get_conversation_reference().model_dump(mode="json", by_alias=True, exclude_none=True)
        self.core.store.remember(inc.conversation_id, ref, inc.conversation_type)
        if a.type == "conversationUpdate":
            bot_id = (a.recipient.id if a.recipient else "") or ""
            if any(m.id == bot_id for m in (a.members_added or [])):
                lang = "fr" if inc.locale.lower().startswith("fr") else "en"
                await context.send_activity("Bonjour, je suis TendOlive : posez-moi une question sur les appels d'offres, ou tapez « aide »." if lang == "fr"
                                            else "Hi, I am TendOlive: ask me about the tenders, or type \"help\".")
            return
        if a.type != "message":
            return
        await context.send_activity(self.Activity(type="typing"))
        task = asyncio.create_task(self._answer(inc, ref))       # answered after this turn: Teams gets its 200 now
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _answer(self, inc, ref: dict[str, Any]) -> None:
        try:
            replies = await self.core.handle(inc, progress=lambda msgs: self.post(ref, msgs))
        except Exception:                                        # never a raw error in Teams
            log.exception("turn failed")
            replies = [outgoing({"text": "Sorry, something went wrong. Try again." if not inc.locale.lower().startswith("fr")
                                 else "Désolé, un problème est survenu. Réessayez.", "cards": []})]
        await self.post(ref, replies)

    async def post(self, ref: dict[str, Any], messages: list[dict[str, Any]]) -> None:
        """A proactive message in the conversation of `ref` (a stored ConversationReference)."""
        reference = self.ConversationReference.model_validate(ref)

        async def send(ctx) -> None:
            for m in messages:
                await ctx.send_activity(self._activity(m))

        await self.adapter.continue_conversation(self.settings.app_id, reference.get_continuation_activity(), send)


def create_app(settings: Settings | None = None, brain: Brain | None = None) -> web.Application:
    settings = settings or Settings()
    store = Store(settings.data_dir)
    core = Core(settings, store, brain or Brain(settings.chat_url, settings.chat_key, settings.chat_timeout_s))
    glue = TeamsGlue(settings, core) if settings.teams_configured else None
    app = web.Application(client_max_size=256 * 1024)
    app["settings"], app["core"], app["glue"], app["outbox"] = settings, core, glue, []
    if glue:
        app["agent_configuration"] = glue.auth_configuration      # read by the SDK's JWT check

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"status": "ok", "teams": bool(glue), "test_mode": settings.test_mode,
                                  "alert_conversation": bool(core.notify_target(None)), "notify": bool(settings.notify_key)})

    async def messages(request: web.Request) -> web.Response:
        return await glue.adapter.process(request, glue) or web.Response(status=202)

    async def not_configured(_: web.Request) -> web.Response:
        return web.json_response({"error": "Teams is not configured: set BOT_APP_ID, BOT_APP_PASSWORD and BOT_TENANT_ID in .env"}, status=503)

    async def notify(request: web.Request) -> web.Response:
        if not settings.notify_key:
            return web.json_response({"status": "error", "message": "BOT_NOTIFY_KEY is not set"}, status=503)
        if not _key_ok(request, settings):
            return web.json_response({"status": "error", "message": "invalid or missing X-Notify-Key"}, status=401)
        try:
            body = await request.json()
        except ValueError:
            return web.json_response({"status": "error", "message": "the body is not JSON"}, status=400)
        if not isinstance(body, dict) or not (body.get("text") or body.get("cards")):
            return web.json_response({"status": "error", "message": "send {text, cards, conversation_id?}"}, status=400)
        target = core.notify_target(str(body.get("conversation_id") or "") or None)
        if not target:
            return web.json_response({"status": "error", "message": "no alert conversation: say \"alerts here\" to the bot in a channel, "
                                      "or set BOT_NOTIFY_CHANNEL"}, status=409)
        msg = outgoing({"text": body.get("text"), "cards": body.get("cards"), "language": body.get("language")})
        if settings.test_mode:
            app["outbox"].append({"conversation_id": target, "kind": body.get("kind"), **msg})
            return web.json_response({"status": "ok", "conversation_id": target, "test_mode": True})
        if not glue:
            return web.json_response({"status": "error", "message": "Teams is not configured (BOT_APP_ID ...)"}, status=503)
        ref = store.reference(target)
        if not ref:
            return web.json_response({"status": "error", "message": "the bot has no reference for this conversation yet: "
                                      "@mention it there once"}, status=404)
        try:
            await glue.post(ref, [msg])
        except Exception as e:                                   # Teams refused (bot removed from the team, expired secret ...)
            log.error("proactive message failed: %s", type(e).__name__)
            return web.json_response({"status": "error", "message": f"Teams refused the message ({type(e).__name__})"}, status=502)
        return web.json_response({"status": "ok", "conversation_id": target})

    async def test_messages(request: web.Request) -> web.Response:
        if not _key_ok(request, settings):
            return web.json_response({"status": "error", "message": "invalid or missing X-Notify-Key"}, status=401)
        activity = await request.json()
        inc = parse(activity)
        store.remember(inc.conversation_id, {"conversation": {"id": inc.conversation_id}, "test": True}, inc.conversation_type)
        early: list[dict[str, Any]] = []

        async def progress(msgs: list[dict[str, Any]]) -> None:
            early.extend(msgs)
        return web.json_response({"replies": early + await core.handle(inc, progress=progress)})

    async def test_outbox(request: web.Request) -> web.Response:
        if not _key_ok(request, settings):
            return web.json_response({"status": "error", "message": "invalid or missing X-Notify-Key"}, status=401)
        if request.method == "DELETE":
            app["outbox"].clear()
        return web.json_response({"outbox": app["outbox"]})

    app.router.add_get("/health", health)
    if glue:
        from microsoft_agents.hosting.aiohttp import jwt_authorization_decorator
        app.router.add_post("/api/messages", jwt_authorization_decorator(messages))
    else:
        app.router.add_post("/api/messages", not_configured)
    app.router.add_post("/notify", notify)
    if settings.test_mode:
        app.router.add_post("/test/messages", test_messages)
        app.router.add_get("/test/outbox", test_outbox)
        app.router.add_delete("/test/outbox", test_outbox)
    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
    settings = Settings()
    log.info("Teams: %s | test mode: %s | /notify: %s | approvers: %s | n8n chat: %s",
             "configured" if settings.teams_configured else "NOT configured (BOT_APP_ID / BOT_APP_PASSWORD / BOT_TENANT_ID): idle",
             "ON" if settings.test_mode else "off", "on" if settings.notify_key else "off (BOT_NOTIFY_KEY empty)",
             len(settings.approver_users) or "everyone allowed", settings.chat_url)
    web.run_app(create_app(settings), host="0.0.0.0", port=settings.port, print=None)


if __name__ == "__main__":
    main()
