"""OliveSoft pricing file (knowledge-base/pricing/pricing.json): read, validate, save, refresh the public prices.

The proposal studio's budget agent prices the deck from this file (day rates by role and seniority,
cloud and LLM list prices). The web app's Pricing page edits it through the routes below.

Refresh fetches public list prices, never a guess:
- Azure: the Retail Prices API (prices.azure.com, no key), France Central, pay-as-you-go, Linux.
- Google Cloud: the Cloud Billing Catalog API, Paris (europe-west9); needs GCP_BILLING_API_KEY
  (an API key with the Cloud Billing API enabled, free). Without it the GCP prices are left as they are.
- USD for 1 EUR: the European Central Bank's daily reference rate (no key), else Frankfurter (the same ECB rate).
- AI models: OpenRouter's public model list (no key), which lists each provider's own price per token.
Each source runs on its own: one that fails keeps its current values. A price that cannot be found keeps its current
value and is reported. An item marked "manual": true (a cloud item, an AI model, usd_per_eur) is never overwritten.
"""
import copy
import json
import math
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException

from . import config

PRICING_FILE = Path(os.getenv("RAG_PRICING_FILE", config.DATA_DIR / "pricing" / "pricing.json"))
ROLES = ["backend", "frontend", "devops", "pm", "designer", "qa"]
SENIORITIES = ["junior", "mid", "senior"]
CLOUD_ITEMS = ["vm_small", "vm_medium", "vm_large", "db_small", "db_medium", "storage_gb"]

router = APIRouter()


def load() -> dict:
    return json.loads(PRICING_FILE.read_text(encoding="utf-8"))


def _number(v, minimum=0.0):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v >= minimum


def validate(p: dict) -> list:
    """Every problem of the file, as readable lines (empty list: valid)."""
    errors = []
    if not isinstance(p, dict):
        return ["The pricing must be a JSON object"]
    rates = p.get("day_rates") or {}
    for role in ROLES:
        for s in SENIORITIES:
            if not _number((rates.get(role) or {}).get(s), 1):
                errors.append(f"day_rates.{role}.{s}: a day rate above 0 is required")
    for role, s in (p.get("staffing") or {}).items():
        if role not in ROLES or s not in SENIORITIES:
            errors.append(f"staffing.{role}: must be one of {', '.join(SENIORITIES)}")
    for k in ("support_percent_of_build", "contingency_percent", "margin_percent"):
        if not (_number(p.get(k)) and p[k] <= 1):
            errors.append(f"{k}: a fraction between 0 and 1 (0.15 = 15 %)")
    if not (isinstance(p.get("workdays_per_week"), int) and 1 <= p["workdays_per_week"] <= 7):
        errors.append("workdays_per_week: a whole number from 1 to 7")
    fx = p.get("usd_per_eur") or {}
    if not _number(fx.get("value"), 0.01):
        errors.append("usd_per_eur.value: the USD for 1 EUR rate is required")
    if "manual" in fx and not isinstance(fx["manual"], bool):
        errors.append("usd_per_eur.manual: true or false")
    cloud = p.get("cloud") or {}
    if p.get("default_cloud") not in cloud:
        errors.append(f"default_cloud: must be one of {', '.join(cloud) or 'the cloud providers'}")
    for name, c in cloud.items():
        if c.get("currency") not in ("EUR", "USD"):
            errors.append(f"cloud.{name}.currency: EUR or USD")
        for item, it in (c.get("items") or {}).items():
            if item not in CLOUD_ITEMS:
                errors.append(f"cloud.{name}.items.{item}: unknown item")
            elif not _number(it.get("price")):
                errors.append(f"cloud.{name}.items.{item}.price: a price >= 0 is required")
            if "manual" in it and not isinstance(it["manual"], bool):
                errors.append(f"cloud.{name}.items.{item}.manual: true or false")
    for m, it in ((p.get("llm") or {}).get("models") or {}).items():
        if not (_number(it.get("input_per_1m")) and _number(it.get("output_per_1m"))):
            errors.append(f"llm.models.{m}: input_per_1m and output_per_1m are required")
        if "manual" in it and not isinstance(it["manual"], bool):
            errors.append(f"llm.models.{m}.manual: true or false")
        if "openrouter_id" in it and not (isinstance(it["openrouter_id"], str) and it["openrouter_id"].strip()):
            errors.append(f"llm.models.{m}.openrouter_id: an OpenRouter model id (e.g. anthropic/claude-sonnet-5.5)")
    return errors


def save(p: dict, touch: bool = True) -> dict:
    """Writes the file when it is valid. `touch`: last_updated becomes today (a save from the Pricing page); a refresh
    passes False, having set last_updated itself only when a price changed."""
    errors = validate(p)
    if errors:
        raise ValueError("; ".join(errors))
    if touch:
        p["last_updated"] = date.today().isoformat()
    tmp = PRICING_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(p, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(PRICING_FILE)
    return p


def _get_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode("utf-8")


def _get_json(url: str) -> dict:
    return json.loads(_get_text(url))


# ---- Azure Retail Prices API

AZURE_URL = "https://prices.azure.com/api/retail/prices"
AZURE_REGION = "francecentral"
AZURE_VMS = {"vm_small": "Standard_B2s", "vm_medium": "Standard_D4s_v5", "vm_large": "Standard_D8s_v5"}
AZURE_DB_VCORES = {"db_small": 2, "db_medium": 4}


def _azure(flt: str, fetch) -> list:
    rows, url = [], AZURE_URL + "?" + urllib.parse.urlencode({"currencyCode": "EUR", "$filter": flt})
    while url and len(rows) < 500:
        page = fetch(url)
        rows += page.get("Items", [])
        url = page.get("NextPageLink")
    return rows


def azure_prices(fetch=_get_json) -> dict:
    """{item: EUR price} for the Azure items; items not found are absent."""
    base = f"armRegionName eq '{AZURE_REGION}' and priceType eq 'Consumption'"
    out = {}
    for item, sku in AZURE_VMS.items():
        rows = [r for r in _azure(f"serviceName eq 'Virtual Machines' and {base} and armSkuName eq '{sku}'", fetch)
                if "Windows" not in r["productName"] and not re.search(r"Spot|Low Priority", r["skuName"])]
        if rows:
            out[item] = rows[0]["retailPrice"]
    # PostgreSQL Flexible Server, General Purpose Ddsv5: one row per size ("4 vCore"); the price per vCore is the same
    per_vcore = []
    for r in _azure(f"serviceName eq 'Azure Database for PostgreSQL' and {base} and "
                    "contains(productName,'Flexible Server General Purpose Ddsv5 Series Compute')", fetch):
        m = re.fullmatch(r"(\d+) vCore", r["skuName"])
        if m and r.get("isPrimaryMeterRegion", True):
            per_vcore.append(r["retailPrice"] / int(m.group(1)))
    if per_vcore:
        v = min(per_vcore)
        for item, n in AZURE_DB_VCORES.items():
            out[item] = round(v * n, 4)
    blob = [r for r in _azure(f"serviceName eq 'Storage' and {base} and skuName eq 'Hot LRS' "
                              "and meterName eq 'Hot LRS Data Stored'", fetch)
            if r.get("productName") == "Blob Storage" and r.get("tierMinimumUnits", 0) == 0]
    if blob:
        out["storage_gb"] = blob[0]["retailPrice"]
    return out


# ---- Google Cloud Billing Catalog API

GCP_URL = "https://cloudbilling.googleapis.com/v1/services/{service}/skus"
GCP_REGION = "europe-west9"
GCP_SERVICES = {"compute": "6F81-5844-456A", "sql": "9662-B51E-5089", "storage": "95FF-2EF5-5EA1"}
# item -> (vCPU, GiB RAM) and the SKU families that price them
GCP_VMS = {"vm_small": ("E2", 2, 8), "vm_medium": ("N2", 4, 16), "vm_large": ("N2", 8, 32)}
GCP_DBS = {"db_small": (2, 8), "db_medium": (4, 16)}


def _unit_price(sku: dict) -> float:
    rates = sku["pricingInfo"][0]["pricingExpression"]["tieredRates"]
    p = rates[-1]["unitPrice"]
    return int(p.get("units") or 0) + p.get("nanos", 0) / 1e9


def _gcp_skus(service: str, key: str, fetch) -> list:
    skus, token = [], ""
    while True:
        q = {"key": key, "currencyCode": "USD", "pageSize": 5000}
        if token:
            q["pageToken"] = token
        page = fetch(GCP_URL.format(service=service) + "?" + urllib.parse.urlencode(q))
        skus += [s for s in page.get("skus", []) if GCP_REGION in (s.get("serviceRegions") or [])
                 and (s.get("category") or {}).get("usageType") == "OnDemand"]
        token = page.get("nextPageToken")
        if not token:
            return skus


def _find(skus: list, pattern: str):
    for s in skus:
        if re.search(pattern, s.get("description", ""), re.I):
            return _unit_price(s)
    return None


def gcp_prices(key: str, fetch=_get_json) -> dict:
    """{item: USD price} for the Google Cloud items; items not found are absent."""
    out = {}
    compute = _gcp_skus(GCP_SERVICES["compute"], key, fetch)
    for item, (family, cpu, ram) in GCP_VMS.items():
        core = _find(compute, rf"^{family} Instance Core running in Paris")
        mem = _find(compute, rf"^{family} Instance Ram running in Paris")
        if core is not None and mem is not None:
            out[item] = round(cpu * core + ram * mem, 4)
    sql = _gcp_skus(GCP_SERVICES["sql"], key, fetch)
    core = _find(sql, r"Cloud SQL for PostgreSQL: Zonal - vCPU in Paris")
    mem = _find(sql, r"Cloud SQL for PostgreSQL: Zonal - RAM in Paris")
    if core is not None and mem is not None:
        for item, (cpu, ram) in GCP_DBS.items():
            out[item] = round(cpu * core + ram * mem, 4)
    storage = _find(_gcp_skus(GCP_SERVICES["storage"], key, fetch), r"^Standard Storage Paris")
    if storage is not None:
        out["storage_gb"] = storage
    return out


# ---- USD for 1 EUR: the ECB's daily reference rate, else Frankfurter (which republishes it)

ECB_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"
FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD"
ECB_SOURCE = "European Central Bank reference rate"
FRANKFURTER_SOURCE = "Frankfurter API (European Central Bank reference rate)"
# a USD for 1 EUR rate outside this range, or moving more than this from the stored one, is a parsing or API error
FX_RANGE = (0.8, 1.6)
FX_MAX_CHANGE = 0.10


def ecb_usd_per_eur(fetch_text=_get_text) -> dict:
    """{value, date, source} of the ECB's daily file: <Cube time='2026-10-30'><Cube currency='USD' rate='1.1172'/>,
    USD for 1 EUR (the file's own meaning, never inverted), dated by the ECB."""
    root = ET.fromstring(fetch_text(ECB_URL))
    for day in root.iter():
        if day.get("time"):
            for c in day:
                if c.get("currency") == "USD":
                    return {"value": float(c.get("rate")), "date": day.get("time"), "source": ECB_SOURCE}
    raise ValueError("no USD rate in the ECB reference rates")


def frankfurter_usd_per_eur(fetch=_get_json) -> dict:
    """{value, date, source} of Frankfurter: {"date": "2026-10-30", "rates": {"USD": 1.1172}} for 1 EUR."""
    d = fetch(FRANKFURTER_URL)
    return {"value": float(d["rates"]["USD"]), "date": d["date"], "source": FRANKFURTER_SOURCE}


def usd_per_eur_rate(fetch=_get_json, fetch_text=_get_text) -> dict:
    """The ECB rate, else Frankfurter's when the ECB file cannot be read."""
    try:
        return ecb_usd_per_eur(fetch_text)
    except Exception as ecb_error:
        try:
            return frankfurter_usd_per_eur(fetch)
        except Exception as e:
            raise RuntimeError(f"ECB: {str(ecb_error)[:90]}; Frankfurter: {str(e)[:90]}") from e


def _fx_problem(value: float, stored) -> str:
    """Why a fetched rate is not believable ('' when it is)."""
    low, high = FX_RANGE
    if not low <= value <= high:
        return f"{value} USD for 1 EUR is outside {low}-{high}"
    if _number(stored, 0.01) and abs(value - stored) / stored > FX_MAX_CHANGE:
        return f"{value} USD for 1 EUR is more than {FX_MAX_CHANGE:.0%} away from the stored {stored}"
    return ""


# ---- AI model prices: OpenRouter's public model list (no key)

OPENROUTER_URL = "https://openrouter.ai/api/v1/models"
OPENROUTER_SOURCE = "OpenRouter public model list (provider list prices)"
# model key of the file -> OpenRouter id; a model's own "openrouter_id" in the file wins
OPENROUTER_IDS = {
    "claude-sonnet-5-5": "anthropic/claude-sonnet-5.5",
    "claude-haiku-5-5": "anthropic/claude-haiku-5.5",
    "claude-opus-5-5": "anthropic/claude-opus-5.5",
    "gpt-6-1-sol": "openai/gpt-6.1-sol",
    "gpt-6-luna": "openai/gpt-6-luna",
    "gemini-3-1-pro": "google/gemini-3.1-pro-preview",  # Gemini 3.1 Pro is listed only as the preview
    "gemini-3-1-flash-lite": "google/gemini-3.1-flash-lite",
}


def _per_1m(per_token: float):
    v = round(per_token * 1e6, 4)
    return int(v) if v == int(v) else v


def openrouter_prices(fetch=_get_json) -> dict:
    """{OpenRouter id: (input, output) USD per 1M tokens}. The list gives USD per token as strings; the ":batch"
    variants (asynchronous, discounted), the routers (price -1) and a row that is not a finite price are left out
    (one odd row among the hundreds listed must not stop the others)."""
    out, url, pages = {}, OPENROUTER_URL, 0
    while url and pages < 10:
        page = fetch(url)
        for m in page.get("data", []):
            if not isinstance(m, dict):
                continue
            mid, price = str(m.get("id") or ""), m.get("pricing") or {}
            if mid.endswith(":batch"):
                continue
            try:
                inp, outp = float(price["prompt"]), float(price["completion"])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(inp) and math.isfinite(outp) and inp >= 0 and outp >= 0:
                out[mid] = (_per_1m(inp), _per_1m(outp))
        nxt = (page.get("links") or {}).get("next")
        url, pages = urllib.parse.urljoin(url, nxt) if nxt else None, pages + 1
    return out


# ---- refresh: every source on its own

CLOUD_SOURCES = {"azure": "Azure Retail Prices API (prices.azure.com), pay-as-you-go, Linux",
                 "gcp": "Cloud Billing Catalog API, on-demand, Linux"}


def _manual(it) -> bool:
    return isinstance(it, dict) and it.get("manual") is True


def _entry(updated=(), missing=(), skipped=(), error=None, **more) -> dict:
    """One source's line of the report: updated, not found (kept), skipped ("manual": true, kept), error."""
    return {"updated": list(updated), "missing": list(missing), "skipped": list(skipped), "error": error, **more}


def _update_cloud(c: dict, found: dict, name: str, today: str) -> dict:
    items = c.get("items", {})
    skipped = [k for k, it in items.items() if _manual(it)]
    updated = [k for k in items if k in found and k not in skipped]
    for k in updated:
        items[k]["price"] = found[k]
    if updated:
        c["date"] = today
        c["source"] = CLOUD_SOURCES[name]
    return _entry(updated, [k for k in items if k not in found and k not in skipped], skipped)


def _update_fx(p: dict, rate: dict) -> dict:
    stored = p.get("usd_per_eur") or {}
    problem = _fx_problem(rate["value"], stored.get("value"))
    if problem:
        raise ValueError(f"{rate['source']} rejected: {problem}; the stored rate is kept")
    p["usd_per_eur"] = {**stored, **rate}
    return _entry(["usd_per_eur"])


def _openrouter_id(key: str, m: dict):
    """The model's own "openrouter_id" (spaces around it ignored, as validate does), else the default mapping."""
    own = m.get("openrouter_id")
    return own.strip() if isinstance(own, str) and own.strip() else OPENROUTER_IDS.get(key)


def _update_llm(llm: dict, fetch, today: str) -> dict:
    models = llm["models"]
    skipped = [k for k, m in models.items() if _manual(m)]
    ids = {k: _openrouter_id(k, m) for k, m in models.items() if k not in skipped}
    listed = openrouter_prices(fetch)
    updated = [k for k, mid in ids.items() if mid in listed]
    for k in updated:
        models[k]["input_per_1m"], models[k]["output_per_1m"] = listed[ids[k]]
    if updated:
        llm["date"] = today
        llm["source"] = OPENROUTER_SOURCE
    return _entry(updated, [k for k in ids if k not in updated], skipped)


def _prices(p: dict) -> list:
    """Every price of the file, to tell whether a refresh changed one (a new date alone is not a change)."""
    cloud = [(n, k, it.get("price")) for n, c in (p.get("cloud") or {}).items() for k, it in (c.get("items") or {}).items()]
    llm = [(k, m.get("input_per_1m"), m.get("output_per_1m")) for k, m in ((p.get("llm") or {}).get("models") or {}).items()]
    return [(p.get("usd_per_eur") or {}).get("value"), cloud, llm]


def refresh(p: dict, gcp_key: str = "", fetch=_get_json, fetch_text=_get_text) -> dict:
    """Updates the prices of `p` in place from the public sources; returns {source: {updated, missing, skipped, error}}
    for azure, gcp, fx (usd_per_eur) and llm. `fetch` reads a JSON answer, `fetch_text` the ECB's XML.
    last_updated becomes today only when a price actually changed."""
    report, today = {}, date.today().isoformat()
    before = _prices(p)
    cloud, llm = p.get("cloud") or {}, p.get("llm") or {}
    # source -> (its items, the update that fetches then writes them); a source without items is left out
    sources = {
        "azure": ((cloud.get("azure") or {}).get("items"),
                  lambda: _update_cloud(cloud["azure"], azure_prices(fetch), "azure", today)),
        "gcp": ((cloud.get("gcp") or {}).get("items"),
                lambda: _update_cloud(cloud["gcp"], gcp_prices(gcp_key, fetch), "gcp", today)),
        "fx": ({"usd_per_eur": p.get("usd_per_eur") or {}}, lambda: _update_fx(p, usd_per_eur_rate(fetch, fetch_text))),
        "llm": (llm.get("models"), lambda: _update_llm(llm, fetch, today)),
    }
    for name, (items, update) in sources.items():
        if not items:
            continue
        skipped = [k for k, it in items.items() if _manual(it)]
        if name == "gcp" and not gcp_key:
            report[name] = _entry(note="GCP_BILLING_API_KEY is not set: the Google Cloud prices are left as they are")
        elif len(skipped) == len(items):  # all entered by hand: nothing to fetch
            report[name] = _entry(skipped=skipped)
        else:
            try:
                report[name] = update()
            except Exception as e:  # network or API error, or a rejected rate: this source's current values stay
                report[name] = _entry(missing=[k for k in items if k not in skipped], skipped=skipped, error=str(e)[:200])
    if _prices(p) != before:
        p["last_updated"] = today
    return report


# ---- routes (the web app's Pricing page)

@router.get("/api/pricing")
def get_pricing():
    try:
        return load()
    except FileNotFoundError:
        raise HTTPException(404, f"No pricing file at {PRICING_FILE}")


@router.put("/api/pricing")
def put_pricing(payload: dict):
    try:
        return save(payload)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/api/pricing/refresh")
def refresh_pricing():
    p = load()
    before = copy.deepcopy(p)
    report = refresh(p, os.getenv("GCP_BILLING_API_KEY", ""), _get_json, _get_text)
    if p != before:  # refresh set last_updated itself, only when a price changed
        save(p, touch=False)
    return {"pricing": p, "report": report}
