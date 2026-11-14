"""What the bot keeps in its data folder (a Docker volume): the conversation references it needs to post proactively, the
alert conversation, and the audit log of state-changing commands. Plain JSON, written atomically; nothing secret."""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

MAX_CONVERSATIONS = 500


class Store:
    def __init__(self, data_dir: str):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "conversations.json"
        self.audit_path = self.dir / "audit.log"
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("conversations"), dict):
                return data
        except (OSError, ValueError):
            pass
        return {"conversations": {}, "alert_conversation": None}

    def _save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def remember(self, conversation_id: str, reference: dict[str, Any], conversation_type: str) -> None:
        """Keeps the latest reference of a conversation (the bot needs it to post there later). The oldest are dropped."""
        if not conversation_id:
            return
        with self._lock:
            convs = self._data["conversations"]
            convs[conversation_id] = {"reference": reference, "type": conversation_type, "updated": int(time.time())}
            if len(convs) > MAX_CONVERSATIONS:
                for old in sorted(convs, key=lambda k: convs[k].get("updated", 0))[: len(convs) - MAX_CONVERSATIONS]:
                    if old != self._data.get("alert_conversation"):
                        del convs[old]
            self._save()

    def reference(self, conversation_id: str) -> dict[str, Any] | None:
        entry = self._data["conversations"].get(conversation_id)
        return entry["reference"] if entry else None

    @property
    def alert_conversation(self) -> str | None:
        return self._data.get("alert_conversation")

    def set_alert_conversation(self, conversation_id: str | None) -> None:
        with self._lock:
            self._data["alert_conversation"] = conversation_id
            self._save()

    def audit(self, **entry: Any) -> None:
        """One JSON line per state-changing command: who (Entra object id), where, what, and how it ended."""
        line = json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"), **entry}, ensure_ascii=False)
        with self._lock, self.audit_path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")
