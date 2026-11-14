"""Adaptive Cards (schema 1.5) for the facts n8n returns. n8n's code builds the card DATA from tool results (n8n/src/lib.js,
chatCards; Main's Teams Alerts); this module only lays it out, so a card never shows a fact a tool did not return.

Card types: tender, tender_list, matrix, coverage, deck, error. Buttons send Action.Submit data {action, tender_id} that the bot
forwards to n8n (generate_deck, no_bid with the card's reason input, tender, matrix, deck_status)."""
from __future__ import annotations

import json
from typing import Any

SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json"
MAX_CARD_BYTES = 24_000          # Teams refuses a message over about 28 KB (text and cards together)
CONTENT_TYPE = "application/vnd.microsoft.card.adaptive"

_T = {
    "en": {
        "deadline": "Deadline", "days": "{n} days left", "today": "today", "passed": "passed", "budget": "Declared budget", "fit": "RAG fit",
        "reqs": "Requirements", "req_counts": "{c} covered · {p} partial · {m} missing", "mandatory_missing": " ({n} mandatory)",
        "decision": "Decision", "no_bid": "No-bid", "bid": "Bid", "open": "Open tender", "notice": "Notice", "generate": "Generate deck",
        "no_bid_btn": "No-bid", "reason_ph": "Why not bid? (3 to 300 characters)", "record": "Record no-bid", "details": "Details",
        "matrix": "Matrix", "demo": " (demo)", "new_fit": "New {lvl}-fit tender", "market": "Market range",
        "tenders": "Tenders", "n_of": "{shown} of {total}", "filters": "Filter: {f}", "none": "No tender matches.",
        "matrix_title": "Requirements matrix", "covered": "Covered", "partial": "Partial", "missing": "Missing", "mand": "mandatory",
        "more_rows": "Showing {shown} of {total}: open the tender for the rest.", "coverage": "Knowledge base check", "team": "Proposed team",
        "deck_ready": "Deck ready", "deck_running": "Generating the deck…", "deck_failed": "Deck failed", "deck_queued": "Deck queued",
        "open_deck": "Open deck", "placeholders": "[TO FILL] placeholders", "warnings": "Warnings", "run": "Run", "status": "Status",
        "before_export": "Approve the prices and fill the placeholders in the editor, then export PPTX or PDF.", "error": "Something went wrong",
    },
    "fr": {
        "deadline": "Date limite", "days": "{n} jours restants", "today": "aujourd'hui", "passed": "dépassée", "budget": "Budget déclaré",
        "fit": "Adéquation RAG", "reqs": "Exigences", "req_counts": "{c} couvertes · {p} partielles · {m} manquantes", "mandatory_missing": " ({n} obligatoires)",
        "decision": "Décision", "no_bid": "No-bid", "bid": "Bid", "open": "Ouvrir", "notice": "Avis", "generate": "Générer la présentation",
        "no_bid_btn": "No-bid", "reason_ph": "Pourquoi ne pas répondre ? (3 à 300 caractères)", "record": "Enregistrer le no-bid", "details": "Détails",
        "matrix": "Matrice", "demo": " (démo)", "new_fit": "Nouvel appel d'offres ({lvl})", "market": "Fourchette du marché",
        "tenders": "Appels d'offres", "n_of": "{shown} sur {total}", "filters": "Filtre : {f}", "none": "Aucun appel d'offres ne correspond.",
        "matrix_title": "Matrice des exigences", "covered": "Couverte", "partial": "Partielle", "missing": "Manquante", "mand": "obligatoire",
        "more_rows": "{shown} sur {total} affichées : ouvrez l'appel d'offres pour la suite.", "coverage": "Vérification de la base de connaissances",
        "team": "Équipe proposée", "deck_ready": "Présentation prête", "deck_running": "Génération de la présentation…", "deck_failed": "Échec de la génération",
        "deck_queued": "Présentation en attente", "open_deck": "Ouvrir la présentation", "placeholders": "Éléments [TO FILL]", "warnings": "Avertissements",
        "run": "Run", "status": "Statut", "before_export": "Approuvez les prix et complétez les éléments dans l'éditeur, puis exportez en PPTX ou PDF.",
        "error": "Un problème est survenu",
    },
}
_STATUS_ICON = {"covered": "✅", "partial": "🟡", "missing": "❌"}


def _t(lang: str, key: str, **kw: Any) -> str:
    return _T.get(lang, _T["en"]).get(key, _T["en"][key]).format(**kw)


def _s(v: Any, n: int = 200) -> str:
    text = "" if v is None else " ".join(str(v).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def _card(body: list, actions: list | None = None) -> dict:
    card = {"type": "AdaptiveCard", "$schema": SCHEMA, "version": "1.5", "msteams": {"width": "Full"}, "body": body}
    if actions:
        card["actions"] = actions
    return card


def _text(text: str, **kw: Any) -> dict:
    return {"type": "TextBlock", "text": text, "wrap": True, **kw}


def _url(v: Any) -> str | None:
    """Only http(s) links become buttons (a card with another scheme is refused by Teams)."""
    u = str(v or "")
    return u if u.startswith(("http://", "https://")) else None


def _deadline(d: dict, lang: str) -> str | None:
    if not d.get("deadline"):
        return None
    n = d.get("days_left")
    if isinstance(n, int):
        extra = _t(lang, "passed") if n < 0 else _t(lang, "today") if n == 0 else _t(lang, "days", n=n)
        return f"{d['deadline']} ({extra})"
    return str(d["deadline"])


def _title(d: dict, lang: str) -> str:
    return _s(d.get("title"), 140) + (_t(lang, "demo") if d.get("demo") else "")


def _counts(d: dict, lang: str) -> str | None:
    if not any(isinstance(d.get(k), int) for k in ("covered", "partial", "missing")):
        return None
    text = _t(lang, "req_counts", c=d.get("covered") or 0, p=d.get("partial") or 0, m=d.get("missing") or 0)
    if d.get("mandatory_missing"):
        text += _t(lang, "mandatory_missing", n=d["mandatory_missing"])
    return text


def _money(v: Any) -> str:
    try:
        return f"{float(v):,.0f}".replace(",", " ")
    except (TypeError, ValueError):
        return _s(v, 40)


def tender_card(d: dict, lang: str = "en") -> dict:
    tid = str(d.get("tender_id") or "")
    body: list = []
    if d.get("alert"):
        body.append(_text(_t(lang, "new_fit", lvl=_s(d.get("fit_level"), 10) or "fit"), size="Small", weight="Bolder", color="Accent", spacing="None"))
    body.append(_text(_title(d, lang), weight="Bolder", size="Medium"))
    sub = " · ".join(x for x in (tid, _s(d.get("buyer"), 80), _s(d.get("source"), 30)) if x)
    if sub:
        body.append(_text(sub, isSubtle=True, spacing="None", size="Small"))
    facts = []
    for title, value in (
        (_t(lang, "deadline"), _deadline(d, lang)),
        (_t(lang, "budget"), _money(d["budget"]) if d.get("budget") else None),
        (_t(lang, "fit"), f"{d['fit']} / 100" if isinstance(d.get("fit"), (int, float)) else None),
        (_t(lang, "reqs"), _counts(d, lang)),
        (_t(lang, "market"), f"{_money(d['market'].get('low'))} – {_money(d['market'].get('high'))} {_s(d['market'].get('currency'), 5)}"
         if isinstance(d.get("market"), dict) and d["market"].get("low") is not None else None),
        (_t(lang, "decision"), (_t(lang, "no_bid") if (d.get("decision") or {}).get("decision") == "no_bid" else _t(lang, "bid"))
         + (f": {_s(d['decision'].get('reason'), 120)}" if (d.get("decision") or {}).get("reason") else "") if d.get("decision") else None),
    ):
        if value:
            facts.append({"title": title, "value": value})
    if facts:
        body.append({"type": "FactSet", "facts": facts})
    if d.get("reason"):
        body.append(_text(_s(d["reason"], 240), size="Small", isSubtle=True))
    actions: list = []
    if _url(d.get("url")):
        actions.append({"type": "Action.OpenUrl", "title": _t(lang, "open"), "url": d["url"]})
    decided = (d.get("decision") or {}).get("decision") == "no_bid"
    if tid and not decided:
        actions.append({"type": "Action.Submit", "title": _t(lang, "generate"), "data": {"action": "generate_deck", "tender_id": tid}})
        actions.append({"type": "Action.ShowCard", "title": _t(lang, "no_bid_btn"), "card": {
            "type": "AdaptiveCard", "version": "1.5",
            "body": [{"type": "Input.Text", "id": "reason", "placeholder": _t(lang, "reason_ph"), "maxLength": 300, "isMultiline": True}],
            "actions": [{"type": "Action.Submit", "title": _t(lang, "record"), "data": {"action": "no_bid", "tender_id": tid}}]}})
    elif _url(d.get("notice_url")):
        actions.append({"type": "Action.OpenUrl", "title": _t(lang, "notice"), "url": d["notice_url"]})
    return _card(body, actions)


def tender_list_card(d: dict, lang: str = "en") -> dict:
    items = (d.get("tenders") or [])[:5]
    total = d.get("total") or len(items)
    body: list = [_text(f"{_t(lang, 'tenders')} — {_t(lang, 'n_of', shown=len(items), total=total)}", weight="Bolder", size="Medium")]
    if d.get("filters"):
        body.append(_text(_t(lang, "filters", f=", ".join(_s(f, 60) for f in d["filters"][:4])), isSubtle=True, size="Small", spacing="None"))
    if not items:
        body.append(_text(_t(lang, "none")))
    for t in items:
        line = " · ".join(x for x in (
            str(t.get("tender_id") or ""), _s(t.get("buyer"), 50), _deadline(t, lang),
            f"{_t(lang, 'fit')} {t['fit']}" if isinstance(t.get("fit"), (int, float)) else "") if x)
        actions = [{"type": "Action.Submit", "title": _t(lang, "details"), "data": {"action": "tender", "tender_id": t.get("tender_id")}},
                   {"type": "Action.Submit", "title": _t(lang, "matrix"), "data": {"action": "matrix", "tender_id": t.get("tender_id")}}]
        if _url(t.get("url")):
            actions.append({"type": "Action.OpenUrl", "title": _t(lang, "open"), "url": t["url"]})
        body.append({"type": "Container", "separator": True, "spacing": "Medium", "items": [
            _text(_title(t, lang), weight="Bolder"), _text(line, isSubtle=True, size="Small", spacing="None"),
            {"type": "ActionSet", "actions": actions}]})
    return _card(body)


def _row(r: dict, lang: str) -> dict:
    status = str(r.get("status") or "")
    head = f"{_STATUS_ICON.get(status, '•')} **{_t(lang, status) if status in _STATUS_ICON else _s(status, 20)}**"
    if r.get("mandatory"):
        head += f" ({_t(lang, 'mand')})"
    items = [_text(f"{head} — {_s(r.get('requirement'), 140)}", size="Small")]
    basis = _s(r.get("basis"), 90)
    if basis:
        items.append(_text(basis, isSubtle=True, size="Small", spacing="None"))
    return {"type": "Container", "spacing": "Small", "items": items}


def matrix_card(d: dict, lang: str = "en") -> dict:
    t = d.get("tender") or {}
    rows = (d.get("rows") or [])[:8]
    total = d.get("total") or len(rows)
    body: list = [_text(_t(lang, "matrix_title"), weight="Bolder", size="Medium"),
                  _text(f"{_title(t, lang)} · {t.get('tender_id', '')}", isSubtle=True, size="Small", spacing="None")]
    body += [_row(r, lang) for r in rows]
    if total > len(rows):
        body.append(_text(_t(lang, "more_rows", shown=len(rows), total=total), isSubtle=True, size="Small"))
    actions = [{"type": "Action.OpenUrl", "title": _t(lang, "open"), "url": t["url"]}] if _url(t.get("url")) else []
    return _card(body, actions)


def coverage_card(d: dict, lang: str = "en") -> dict:
    body: list = [_text(_t(lang, "coverage"), weight="Bolder", size="Medium")]
    body += [_row(r, lang) for r in (d.get("rows") or [])[:8]]
    team = (d.get("team") or [])[:6]
    if team:
        body.append(_text(_t(lang, "team"), weight="Bolder", spacing="Medium"))
        body.append({"type": "FactSet", "facts": [{"title": _s(p.get("name"), 40) or "?", "value": _s(" · ".join(x for x in (
            _s(p.get("title"), 60), ", ".join(_s(c, 40) for c in (p.get("certifications") or [])[:3])) if x), 160) or "—"} for p in team]})
    return _card(body)


def deck_card(d: dict, lang: str = "en") -> dict:
    status = str(d.get("status") or "")
    head = {"done": "deck_ready", "failed": "deck_failed", "queued": "deck_queued"}.get(status, "deck_running")
    body: list = [_text(_t(lang, head), weight="Bolder", size="Medium", color="Good" if status == "done" else "Attention" if status == "failed" else "Default")]
    if d.get("title"):
        body.append(_text(f"{_s(d['title'], 140)} · {d.get('tender_id') or ''}", isSubtle=True, size="Small", spacing="None"))
    facts = []
    if isinstance(d.get("placeholders"), int):
        facts.append({"title": _t(lang, "placeholders"), "value": str(d["placeholders"])})
    if isinstance(d.get("warnings"), int) and d["warnings"]:
        facts.append({"title": _t(lang, "warnings"), "value": str(d["warnings"])})
    if d.get("run_id"):
        facts.append({"title": _t(lang, "run"), "value": _s(d["run_id"], 20) + (f" · {_s(d.get('step'), 20)}" if d.get("step") and status != "done" else "")})
    if facts:
        body.append({"type": "FactSet", "facts": facts})
    if status == "done":
        body.append(_text(_t(lang, "before_export"), size="Small", isSubtle=True))
    if status == "failed" and d.get("error"):
        body.append(_text(_s(d["error"], 200), size="Small", color="Attention"))
    actions = [{"type": "Action.OpenUrl", "title": _t(lang, "open_deck"), "url": d["deck_url"]}] if _url(d.get("deck_url")) else []
    return _card(body, actions)


def error_card(d: dict, lang: str = "en") -> dict:
    return _card([_text(_t(lang, "error"), weight="Bolder", color="Attention"), _text(_s(d.get("message"), 300))])


BUILDERS = {"tender": tender_card, "tender_list": tender_list_card, "matrix": matrix_card, "coverage": coverage_card, "deck": deck_card, "error": error_card}


def render(cards: list[dict] | None, lang: str = "en") -> list[dict]:
    """n8n's [{type, data}] -> Teams attachments. Unknown types are skipped; the whole stays under Teams' size limit."""
    out, size = [], 0
    for c in (cards or [])[:3]:
        build = BUILDERS.get(str((c or {}).get("type")))
        if not build or not isinstance(c.get("data"), dict):
            continue
        card = build(c["data"], "fr" if lang == "fr" else "en")
        n = len(json.dumps(card, ensure_ascii=False).encode("utf-8"))
        if size + n > MAX_CARD_BYTES:
            break
        size += n
        out.append({"contentType": CONTENT_TYPE, "content": card})
    return out
