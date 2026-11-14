#!/usr/bin/env python3
"""Talk to the Teams bot without Teams: POSTs fake Teams activities to the bot's test route and prints its replies (text and
cards as plain lines). The bot must run with BOT_TEST_MODE=1; the route needs BOT_NOTIFY_KEY (X-Notify-Key). Everything after
the bot is real: n8n's RFP - Chat, the chat model, the RAG service and the studio.

  docker compose exec teams-bot python scripts/simulate_teams.py "top tenders"
  docker compose exec teams-bot python scripts/simulate_teams.py --button generate_deck T1w50xyr
  docker compose exec teams-bot python scripts/simulate_teams.py --fr "quelles sont les lacunes de T1w50xyr ?"
  docker compose exec teams-bot python scripts/simulate_teams.py --outbox      (what /notify posted: alerts, finished decks)
  (no message: an interactive prompt; options: --user <Entra object id>, --channel, --url http://127.0.0.1:3978)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

BOT_ID = "28:tendolive-simulator"


def call(url: str, method: str = "GET", body: dict | None = None, timeout: float = 180) -> dict:
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "X-Notify-Key": os.environ.get("BOT_NOTIFY_KEY", "")})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}  (is the bot in BOT_TEST_MODE=1, and BOT_NOTIFY_KEY the same?)")
    except urllib.error.URLError as e:
        sys.exit(f"the bot is not reachable: {e.reason}")


def activity(a: argparse.Namespace, text: str | None = None, value: dict | None = None) -> dict:
    conv = {"id": "19:simulated-channel@thread.tacv2", "conversationType": "channel", "isGroup": True} if a.channel \
        else {"id": f"a:simulated-chat-{a.user}", "conversationType": "personal"}
    act = {"type": "message", "channelId": "msteams", "serviceUrl": "https://smba.trafficmanager.net/simulated/",
           "from": {"id": "29:simulated", "name": "Simulated user", "aadObjectId": a.user}, "recipient": {"id": BOT_ID, "name": "TendOlive"},
           "conversation": conv, "locale": "fr-FR" if a.fr else "en-US", "text": text or "", "entities": []}
    if a.channel and text:
        act["text"] = f"<at>TendOlive</at> {text}"
        act["entities"] = [{"type": "mention", "text": "<at>TendOlive</at>", "mentioned": {"id": BOT_ID, "name": "TendOlive"}}]
    if value:
        act["value"] = value
    return act


def show_card(card: dict, indent: str = "  ") -> None:
    def walk(items: list, depth: int = 0) -> None:
        for el in items:
            t = el.get("type")
            if t == "TextBlock":
                print(f"{indent}{'  ' * depth}{el.get('text')}")
            elif t == "FactSet":
                for f in el.get("facts", []):
                    print(f"{indent}{'  ' * depth}{f['title']}: {f['value']}")
            elif t == "Container":
                walk(el.get("items", []), depth + 1)
            elif t == "ActionSet":
                print(f"{indent}{'  ' * depth}[{' | '.join(x.get('title', '') for x in el.get('actions', []))}]")
    walk(card.get("body", []))
    if card.get("actions"):
        labels = [x.get("title", "") + (f" {json.dumps(x['data'])}" if x.get("data") else "") for x in card["actions"]]
        print(f"{indent}buttons: {' | '.join(labels)}")


def show(replies: list) -> None:
    for m in replies:
        print(f"\nTendOlive: {m.get('text', '')}")
        for att in m.get("attachments", []):
            print("  ---- card ----")
            show_card(att.get("content", {}))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("message", nargs="*")
    p.add_argument("--button", nargs=2, metavar=("ACTION", "TENDER_ID"), help="press a card button: generate_deck | no_bid | tender | matrix | deck_status")
    p.add_argument("--reason", default="", help="the no-bid reason typed in the card")
    p.add_argument("--user", default="00000000-0000-0000-0000-00000000000a", help="the simulated user's Entra object id")
    p.add_argument("--channel", action="store_true", help="a channel @mention instead of a 1:1 chat")
    p.add_argument("--fr", action="store_true", help="a French Teams client (locale fr-FR)")
    p.add_argument("--outbox", action="store_true", help="print what /notify posted (alerts, finished decks)")
    p.add_argument("--url", default=os.environ.get("BOT_URL", "http://127.0.0.1:3978"))
    a = p.parse_args()
    if a.outbox:
        for m in call(f"{a.url}/test/outbox")["outbox"]:
            print(f"\n[{m.get('kind')}] -> {m.get('conversation_id')}")
            show([m])
        return
    if a.button:
        show(call(f"{a.url}/test/messages", "POST", activity(a, value={"action": a.button[0], "tender_id": a.button[1], "reason": a.reason}))["replies"])
        return
    if a.message:
        show(call(f"{a.url}/test/messages", "POST", activity(a, " ".join(a.message)))["replies"])
        return
    print("Type a message (empty line to quit).")
    while True:
        try:
            text = input("\nyou: ").strip()
        except EOFError:
            break
        if not text:
            break
        show(call(f"{a.url}/test/messages", "POST", activity(a, text))["replies"])


if __name__ == "__main__":
    main()
