"""Mermaid text -> SVG, drawn by mermaid.js (static/vendor, pinned 10.9.1) in the studio's Playwright Chromium.

The deck agents generate the architecture diagram as Mermaid; POST /api/render/mermaid turns it into the SVG the slide
shows. Runs in a child process, as the PDF export does. Offline: no CDN.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MERMAID_JS = ROOT / "static" / "vendor" / "mermaid.min.js"
MAX_CHARS = 20000

# Readable on a slide: dark text on the light boxes, edge labels without the default coloured background
_CONFIG = {"startOnLoad": False, "securityLevel": "strict", "theme": "base",
           "flowchart": {"htmlLabels": False, "curve": "basis", "nodeSpacing": 40, "rankSpacing": 60},
           "themeVariables": {"fontFamily": "Arial, Helvetica, sans-serif", "fontSize": "16px",
                              "edgeLabelBackground": "#ffffff", "lineColor": "#64748b"}}

_SCRIPT = r'''
import json, sys
from playwright.sync_api import sync_playwright
job = json.loads(sys.stdin.read())
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page()
    page.set_content("<!doctype html><html><body></body></html>")
    page.add_script_tag(path=job["js"])
    svg = page.evaluate("""async ([text, config]) => {
        mermaid.initialize(config);
        const { svg } = await mermaid.render('arch', text);
        return svg;
    }""", [job["text"], job["config"]])
    browser.close()
sys.stdout.write(svg)
'''


def render(text: str, python: str = sys.executable, timeout: int = 60) -> str:
    """The SVG of `text`. Raises ValueError for empty / too long input, RuntimeError when mermaid.js fails."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("mermaid text is required")
    if len(text) > MAX_CHARS:
        raise ValueError(f"mermaid text exceeds {MAX_CHARS} characters")
    if not MERMAID_JS.exists():
        raise RuntimeError("static/vendor/mermaid.min.js is missing")
    job = json.dumps({"text": text, "js": str(MERMAID_JS), "config": _CONFIG})
    res = subprocess.run([python, "-c", _SCRIPT], input=job, capture_output=True, text=True, timeout=timeout)
    if res.returncode != 0 or "<svg" not in res.stdout:
        raise RuntimeError((res.stderr or "mermaid render failed").strip().splitlines()[-1][:300])
    return res.stdout
