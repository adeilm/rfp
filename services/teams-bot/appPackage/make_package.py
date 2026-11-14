#!/usr/bin/env python3
"""Builds the Teams app package (the zip you upload in Teams: Apps > Manage your apps > Upload a custom app):
manifest.json (from manifest.template.json, with the bot's app id) + color.png (192x192) + outline.png (32x32).

  python services/teams-bot/appPackage/make_package.py                 reads BOT_APP_ID from .env at the repository root
  python services/teams-bot/appPackage/make_package.py --app-id <id>   or give it
Writes services/teams-bot/appPackage/build/tendolive-teams.zip (git-ignored). No secret goes into the package: only the app id.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


def from_env_file(name: str) -> str:
    env = ROOT / ".env"
    if not env.exists():
        return ""
    for line in env.read_text(encoding="utf-8-sig").splitlines():
        if line.strip().startswith(f"{name}="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def main() -> None:
    p = argparse.ArgumentParser(description="Build the TendOlive Teams app package")
    p.add_argument("--app-id", default="", help="the Azure Bot's Microsoft App ID (default: BOT_APP_ID in .env)")
    p.add_argument("--website", default="https://www.olivesoft.fr", help="the developer website the manifest names")
    p.add_argument("--version", default="1.0.1", help="raise it for each new upload of the same app")
    a = p.parse_args()
    app_id = a.app_id or from_env_file("BOT_APP_ID")
    if not GUID.match(app_id):
        raise SystemExit("BOT_APP_ID is missing or not a GUID: set it in .env (the Azure Bot's Microsoft App ID) or pass --app-id")
    text = (HERE / "manifest.template.json").read_text(encoding="utf-8")
    text = text.replace("{{BOT_APP_ID}}", app_id).replace("{{WEBSITE_URL}}", a.website)
    manifest = json.loads(text)
    manifest["version"] = a.version
    out = HERE / "build"
    out.mkdir(exist_ok=True)
    target = out / "tendolive-teams.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        z.write(HERE / "color.png", "color.png")
        z.write(HERE / "outline.png", "outline.png")
    print(f"wrote {target} (app id {app_id[:8]}..., version {a.version}): upload it in Teams > Apps > Manage your apps > Upload a custom app")


if __name__ == "__main__":
    main()
