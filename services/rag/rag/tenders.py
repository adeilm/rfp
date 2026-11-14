"""Atomic persistence for tender metadata and its latest RAG analysis."""
import json
from datetime import date, timedelta
from pathlib import Path
from threading import Lock

from . import config

_lock = Lock()


def _path() -> Path:
    return Path(config.TENDERS_FILE)


def _read() -> dict[str, dict]:
    path = _path()
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("Tender store must contain an object")
    return data


def _write(items: dict[str, dict]) -> None:
    """Replace the whole store at once: write a temporary file, then rename it over the store.
    A reader never sees a half-written file. Call it while holding _lock."""
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def save(tender: dict) -> dict:
    """Store a tender and its latest analysis. A bid decision recorded earlier is kept: n8n sends a tender again on
    every run, and that must not undo the person's call."""
    tender_id = tender.get("tender_id")
    if not tender_id:
        return tender
    with _lock:
        items = _read()
        decision = (items.get(tender_id) or {}).get("decision")
        if decision and "decision" not in tender:
            tender = {**tender, "decision": decision}
        items[tender_id] = tender
        _write(items)
    return tender


def set_decision(tender_id: str, decision: dict) -> dict | None:
    """Record the bid decision of a tender, replacing any earlier one. Returns the tender, or None when no tender
    has this ID."""
    with _lock:
        items = _read()
        if tender_id not in items:
            return None
        items[tender_id] = {**items[tender_id], "decision": decision}
        _write(items)
        return items[tender_id]


def clear_decision(tender_id: str) -> dict | None:
    """Reopen a tender: remove its bid decision. Returns the tender, or None when no tender has this ID."""
    with _lock:
        items = _read()
        if tender_id not in items:
            return None
        items[tender_id].pop("decision", None)
        _write(items)
        return items[tender_id]


def list_all() -> list[dict]:
    with _lock:
        return list(_read().values())


def get(tender_id: str) -> dict | None:
    with _lock:
        return _read().get(tender_id)


def delete(tender_id: str) -> bool:
    """Remove one tender and its analysis. Returns False when no tender has this ID."""
    with _lock:
        items = _read()
        if tender_id not in items:
            return False
        del items[tender_id]
        _write(items)
    return True


def clear() -> int:
    """Remove every stored tender and return how many were removed.

    A store that cannot be read (damaged JSON) is replaced by an empty one too: clearing the inbox
    is the way out of that state, and its tenders could not be listed anyway (they count as 0).
    """
    with _lock:
        if not _path().exists():
            return 0
        try:
            removed = len(_read())
        except ValueError:  # json.JSONDecodeError is a ValueError
            removed = 0
        _write({})
    return removed


# ---------------------------------------------------------------- retention (docs/retention-policy.md)
ARCHIVE_AFTER_DAYS = 0        # a tender is archived once its deadline has passed
DELETE_AFTER_DAYS = 365       # an archived tender is deleted 12 months after it was archived


def _deadline(tender: dict) -> date | None:
    """The tender's deadline as a date, or None when it is missing or unreadable (never archived then)."""
    try:
        return date.fromisoformat(str(tender.get("deadline") or "")[:10])
    except ValueError:
        return None


def _protected(tender: dict) -> bool:
    """A tender OliveSoft decided to bid on is never archived nor deleted."""
    return (tender.get("decision") or {}).get("decision") == "bid"


def apply_retention(today: date | None = None, delete_after_days: int = DELETE_AFTER_DAYS, dry_run: bool = False) -> dict:
    """Archive expired tenders without a bid decision; delete those archived for more than delete_after_days.

    Archiving only sets `archived_at`: the tender stays in the store (hidden from the default list, kept for the
    history of buyers and no-bid reasons). Deleting removes it. A tender with a "bid" decision, or without a readable
    deadline, is never touched. dry_run = count only. Returns the counts and the ids concerned.
    """
    today = today or date.today()
    limit = today - timedelta(days=delete_after_days)
    archived, deleted = [], []
    with _lock:
        items = _read()
        for tender_id, tender in list(items.items()):
            if _protected(tender):
                continue
            since = tender.get("archived_at")
            if since:
                try:
                    old = date.fromisoformat(str(since)[:10]) < limit
                except ValueError:
                    old = False
                if old:
                    deleted.append(tender_id)
                    if not dry_run:
                        del items[tender_id]
                continue
            deadline = _deadline(tender)
            if deadline and deadline + timedelta(days=ARCHIVE_AFTER_DAYS) < today:
                archived.append(tender_id)
                if not dry_run:
                    items[tender_id] = {**tender, "archived_at": today.isoformat()}
        if not dry_run and (archived or deleted):
            _write(items)
    return {"date": today.isoformat(), "dry_run": dry_run, "archived": len(archived), "deleted": len(deleted),
            "archived_ids": archived, "deleted_ids": deleted}


def unarchive(tender_id: str) -> dict | None:
    """Bring an archived tender back to the active list. Returns the tender, or None when no tender has this ID."""
    with _lock:
        items = _read()
        if tender_id not in items:
            return None
        items[tender_id].pop("archived_at", None)
        _write(items)
        return items[tender_id]
