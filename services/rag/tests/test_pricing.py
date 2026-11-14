"""OliveSoft pricing file: validation, save, the web app's routes, and the public price fetchers.

The fetchers run on recorded answers of the Azure Retail Prices API, the Cloud Billing Catalog API, the ECB's daily
reference rates, Frankfurter and OpenRouter's model list (no network): they must pick the right rows and compute the
bundled sizes the same way as the file.
"""
import copy
import json
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag import pricing

# The knowledge base as shipped (conftest points RAG_DATA_DIR at a private copy without the pricing folder)
SHIPPED = Path(__file__).resolve().parents[1].parent / "data" / "pricing" / "pricing.json"


@pytest.fixture
def shipped():
    return json.loads(SHIPPED.read_text(encoding="utf-8"))


@pytest.fixture
def tmp_file(tmp_path, monkeypatch, shipped):
    f = tmp_path / "pricing.json"
    f.write_text(json.dumps(shipped), encoding="utf-8")
    monkeypatch.setattr(pricing, "PRICING_FILE", f)
    return f


def test_shipped_file_is_valid(shipped):
    assert pricing.validate(shipped) == []


def test_validation_names_every_problem(shipped):
    p = copy.deepcopy(shipped)
    p["day_rates"]["pm"]["senior"] = 0
    p["staffing"]["qa"] = "expert"
    p["margin_percent"] = 15
    p["default_cloud"] = "aws"
    p["cloud"]["gcp"]["items"]["vm_small"]["price"] = "cheap"
    errors = pricing.validate(p)
    for needle in ("day_rates.pm.senior", "staffing.qa", "margin_percent", "default_cloud", "cloud.gcp.items.vm_small.price"):
        assert any(needle in e for e in errors), needle


def test_routes_read_save_and_refuse_invalid(tmp_file, shipped):
    app = FastAPI()
    app.include_router(pricing.router)
    client = TestClient(app)
    assert client.get("/api/pricing").json()["day_rates"] == shipped["day_rates"]
    changed = copy.deepcopy(shipped)
    changed["day_rates"]["backend"]["senior"] = 400
    changed["default_cloud"] = "gcp"
    saved = client.put("/api/pricing", json=changed)
    assert saved.status_code == 200
    on_disk = json.loads(tmp_file.read_text(encoding="utf-8"))
    assert on_disk["day_rates"]["backend"]["senior"] == 400 and on_disk["default_cloud"] == "gcp"
    changed["workdays_per_week"] = 9
    refused = client.put("/api/pricing", json=changed)
    assert refused.status_code == 422 and "workdays_per_week" in refused.json()["detail"]
    assert json.loads(tmp_file.read_text(encoding="utf-8"))["workdays_per_week"] == 5, "an invalid save changes nothing"


def _azure_row(product, sku, price, meter="", arm_sku="", primary=True, tier=0):
    return {"productName": product, "skuName": sku, "retailPrice": price, "meterName": meter, "armSkuName": arm_sku,
            "isPrimaryMeterRegion": primary, "tierMinimumUnits": tier}


AZURE = {
    "Standard_B2s": [_azure_row("Virtual Machines BS Series Windows", "B2s", 0.0486),
                     _azure_row("Virtual Machines BS Series", "B2s", 0.0415)],
    "Standard_D4s_v5": [_azure_row("Virtual Machines Dsv5 Series", "Standard_D4s_v5 Spot", 0.0364),
                        _azure_row("Virtual Machines Dsv5 Series", "Standard_D4s_v5", 0.1971)],
    "Standard_D8s_v5": [_azure_row("Virtual Machines Dsv5 Series", "Standard_D8s_v5 Low Priority", 0.0788),
                        _azure_row("Virtual Machines Dsv5 Series", "Standard_D8s_v5", 0.3942)],
    "PostgreSQL": [_azure_row("Azure Database for PostgreSQL Flexible Server General Purpose Ddsv5 Series Compute", "4 vCore", 0.3625),
                   _azure_row("Azure Database for PostgreSQL Flexible Server General Purpose Ddsv5 Series Compute", "vCore", 0.0906, primary=False)],
    "Storage": [_azure_row("Blob Storage", "Hot LRS", 0.0162, tier=51200), _azure_row("Blob Storage", "Hot LRS", 0.0169)],
}


def fake_azure(url):
    for key, rows in AZURE.items():
        if key.replace("_", "") in url.replace("_", "") or (key == "Storage" and "Storage'" in url):
            return {"Items": rows}
    return {"Items": []}


def test_azure_prices_pick_linux_pay_as_you_go_rows():
    found = pricing.azure_prices(fake_azure)
    assert found == {"vm_small": 0.0415, "vm_medium": 0.1971, "vm_large": 0.3942,
                     "db_small": 0.1812, "db_medium": 0.3625, "storage_gb": 0.0169}


def _gcp_sku(description, price, unit="h", region="europe-west9", usage="OnDemand"):
    units, nanos = int(price), round((price - int(price)) * 1e9)
    return {"description": description, "serviceRegions": [region], "category": {"usageType": usage},
            "pricingInfo": [{"pricingExpression": {"usageUnit": unit, "tieredRates": [{"unitPrice": {"units": str(units), "nanos": nanos}}]}}]}


GCP = {
    "6F81-5844-456A": [
        _gcp_sku("E2 Instance Core running in Paris", 0.025), _gcp_sku("E2 Instance Ram running in Paris", 0.0035),
        _gcp_sku("N2 Instance Core running in Paris", 0.0378), _gcp_sku("N2 Instance Ram running in Paris", 0.0051),
        _gcp_sku("N2 Instance Core running in Paris", 0.01, usage="Preemptible"),
        _gcp_sku("N2 Instance Core running in Americas", 0.03, region="us-central1"),
    ],
    "9662-B51E-5089": [_gcp_sku("Cloud SQL for PostgreSQL: Zonal - vCPU in Paris", 0.048),
                       _gcp_sku("Cloud SQL for PostgreSQL: Zonal - RAM in Paris", 0.008)],
    "95FF-2EF5-5EA1": [_gcp_sku("Standard Storage Paris", 0.02, unit="GiBy.mo")],
}


def fake_gcp(url):
    assert "key=test-key" in url and "currencyCode=USD" in url
    return {"skus": next(rows for service, rows in GCP.items() if f"/services/{service}/" in url)}


def test_gcp_prices_bundle_cores_and_ram_of_paris_on_demand_skus():
    found = pricing.gcp_prices("test-key", fake_gcp)
    assert found["vm_small"] == round(2 * 0.025 + 8 * 0.0035, 4)
    assert found["vm_medium"] == round(4 * 0.0378 + 16 * 0.0051, 4)
    assert found["vm_large"] == round(8 * 0.0378 + 32 * 0.0051, 4)
    assert found["db_small"] == round(2 * 0.048 + 8 * 0.008, 4) == 0.16
    assert found["db_medium"] == 0.32
    assert found["storage_gb"] == 0.02


ECB_XML = """<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender><gesmes:name>European Central Bank</gesmes:name></gesmes:Sender>
  <Cube>
    <Cube time='2026-10-30'>
      <Cube currency='JPY' rate='175.68'/>
      <Cube currency='USD' rate='{usd}'/>
      <Cube currency='GBP' rate='0.83380'/>
    </Cube>
  </Cube>
</gesmes:Envelope>"""


def fake_ecb(url, usd="1.1172"):
    assert url == pricing.ECB_URL
    return ECB_XML.replace("{usd}", usd)


def ecb_at(usd):
    return lambda url: fake_ecb(url, usd)


def fake_frankfurter(url):
    assert "base=EUR" in url and "symbols=USD" in url
    return {"amount": 1.0, "base": "EUR", "date": "2026-10-29", "rates": {"USD": 1.1165}}


def _or_model(model_id, prompt, completion):
    return {"id": model_id, "name": model_id, "pricing": {"prompt": prompt, "completion": completion}}


OPENROUTER = {"data": [
    _or_model("anthropic/claude-sonnet-5.5:batch", "0.0000015", "0.0000075"),  # half price, asynchronous: never picked
    _or_model("anthropic/claude-sonnet-5.5", "0.000003", "0.000015"),
    _or_model("anthropic/claude-haiku-5.5", "0.0000001", "0.0000005"),
    _or_model("anthropic/claude-opus-5.5", "0.000004", "0.00002"),
    _or_model("openai/gpt-6.1-sol", "0.000002", "0.00001"),
    _or_model("openai/gpt-6-luna", "0.0000001", "0.0000005"),
    _or_model("google/gemini-3.1-pro-preview", "0.000002", "0.000012"),
    _or_model("google/gemini-3.1-flash-lite:batch", "0.000000125", "0.00000075"),  # flash-lite: only its batch variant
    _or_model("google/gemini-3.1-flash-lite-preview", "0.0000003", "0.0000018"),
    _or_model("openrouter/auto", "-1", "-1"),
], "total_count": 10, "links": {"next": None}}


def fake_openrouter(url):
    assert url == pricing.OPENROUTER_URL
    return OPENROUTER


def fake_sources(url):
    """The JSON sources of a refresh without a GCP key: Azure, Frankfurter (the ECB fallback), OpenRouter."""
    for host, fake in (("prices.azure.com", fake_azure), ("frankfurter", fake_frankfurter), ("openrouter.ai", fake_openrouter)):
        if host in url:
            return fake(url)
    raise AssertionError(f"unexpected call: {url}")


def down(url):
    raise OSError("network unreachable")


def test_refresh_updates_found_prices_and_keeps_the_others(shipped):
    p = copy.deepcopy(shipped)
    gcp_before = copy.deepcopy(p["cloud"]["gcp"])

    def no_gcp(url):
        assert "cloudbilling" not in url, "GCP must not be called without a key"
        return fake_sources(url)

    report = pricing.refresh(p, "", no_gcp, fake_ecb)
    assert sorted(report["azure"]["updated"]) == sorted(pricing.CLOUD_ITEMS) and report["azure"]["error"] is None
    assert report["gcp"]["error"] is None and "GCP_BILLING_API_KEY" in report["gcp"]["note"]
    assert p["cloud"]["gcp"] == gcp_before, "no key: GCP prices unchanged"
    assert set(report) == {"azure", "gcp", "fx", "llm"}
    assert all(set(r) >= {"updated", "missing", "skipped", "error"} for r in report.values())

    p2 = copy.deepcopy(shipped)
    report = pricing.refresh(p2, "test-key", down, down)
    for source in ("azure", "gcp", "fx", "llm"):
        assert report[source]["error"] and report[source]["updated"] == [], source
    assert "network unreachable" in report["azure"]["error"] and "Frankfurter" in report["fx"]["error"]
    assert report["fx"]["missing"] == ["usd_per_eur"] and sorted(report["llm"]["missing"]) == sorted(shipped["llm"]["models"])
    assert p2 == shipped, "every source down: nothing changes, last_updated included"


def test_usd_per_eur_is_the_ecb_rate_with_its_own_date():
    def no_json(url):
        raise AssertionError("Frankfurter is only the fallback")

    assert pricing.usd_per_eur_rate(no_json, fake_ecb) == {"value": 1.1172, "date": "2026-10-30", "source": pricing.ECB_SOURCE}


def test_usd_per_eur_falls_back_to_frankfurter():
    for ecb in (down, lambda url: "<html>Service unavailable</html>", lambda url: ECB_XML.replace("USD", "XXX")):
        rate = pricing.usd_per_eur_rate(fake_frankfurter, ecb)
        assert rate == {"value": 1.1165, "date": "2026-10-29", "source": pricing.FRANKFURTER_SOURCE}
    with pytest.raises(RuntimeError, match="ECB: .*Frankfurter: "):
        pricing.usd_per_eur_rate(down, down)


def test_refresh_sets_the_rate_and_keeps_the_other_fields(shipped):
    p = copy.deepcopy(shipped)
    p["usd_per_eur"]["note"] = "kept"
    report = pricing.refresh(p, "", fake_sources, fake_ecb)
    assert report["fx"] == {"updated": ["usd_per_eur"], "missing": [], "skipped": [], "error": None}
    assert p["usd_per_eur"] == {"value": 1.1172, "date": "2026-10-30", "source": pricing.ECB_SOURCE, "note": "kept"}

    p = copy.deepcopy(shipped)
    report = pricing.refresh(p, "", fake_sources, down)
    assert report["fx"]["error"] is None and p["usd_per_eur"]["source"] == pricing.FRANKFURTER_SOURCE
    assert p["usd_per_eur"]["value"] == 1.1165 and p["usd_per_eur"]["date"] == "2026-10-29"


@pytest.mark.parametrize("usd, reason", [("1.9", "outside 0.8-1.6"), ("0.5", "outside 0.8-1.6"), ("1.2500", "10%")])
def test_refresh_rejects_an_unbelievable_rate(shipped, usd, reason):
    p = copy.deepcopy(shipped)
    p["usd_per_eur"]["value"] = 1.113
    report = pricing.refresh(p, "", fake_sources, ecb_at(usd))
    assert reason in report["fx"]["error"] and "kept" in report["fx"]["error"]
    assert report["fx"]["updated"] == [] and report["fx"]["missing"] == ["usd_per_eur"]
    assert p["usd_per_eur"] == {**shipped["usd_per_eur"], "value": 1.113}, "the stored rate stays"
    assert report["azure"]["error"] is None and report["llm"]["error"] is None, "the other sources still run"


def test_a_move_within_ten_percent_is_accepted(shipped):
    p = copy.deepcopy(shipped)
    p["usd_per_eur"]["value"] = 1.113
    assert pricing.refresh(p, "", fake_sources, ecb_at("1.2200"))["fx"]["error"] is None  # +9.6 %
    assert p["usd_per_eur"]["value"] == 1.22


def test_openrouter_prices_are_per_1m_tokens_without_batch_or_routers():
    found = pricing.openrouter_prices(fake_openrouter)
    assert found["anthropic/claude-sonnet-5.5"] == (3, 15), "the batch row listed first is not picked"
    assert found["anthropic/claude-haiku-5.5"] == (0.1, 0.5) and found["google/gemini-3.1-pro-preview"] == (2, 12)
    assert not any(k.endswith(":batch") for k in found)
    assert "openrouter/auto" not in found and "google/gemini-3.1-flash-lite" not in found


def test_an_odd_openrouter_row_does_not_stop_the_others(shipped):
    odd = {"data": [_or_model("x/infinite", "1e400", "0.00001"), "not a model", {"id": None},
                    *OPENROUTER["data"]]}
    found = pricing.openrouter_prices(lambda url: odd)
    assert "x/infinite" not in found and found["anthropic/claude-sonnet-5.5"] == (3, 15)

    p = copy.deepcopy(shipped)
    p["llm"]["models"]["gemini-3-1-flash-lite"]["openrouter_id"] = " google/gemini-3.1-flash-lite-preview "
    assert pricing.validate(p) == []
    report = pricing.refresh(p, "", lambda url: odd if "openrouter.ai" in url else fake_sources(url), fake_ecb)
    assert report["llm"]["error"] is None and report["llm"]["missing"] == []
    assert p["llm"]["models"]["gemini-3-1-flash-lite"]["output_per_1m"] == 1.8, "the id's spaces are ignored"
    json.dumps(p, allow_nan=False)  # nothing infinite reaches the file


def test_refresh_updates_ai_prices_and_reports_the_models_not_found(shipped):
    p = copy.deepcopy(shipped)
    report = pricing.refresh(p, "", fake_sources, fake_ecb)
    llm = p["llm"]
    assert report["llm"]["missing"] == ["gemini-3-1-flash-lite"], "listed only as :batch: not found"
    assert sorted(report["llm"]["updated"]) == sorted(set(shipped["llm"]["models"]) - {"gemini-3-1-flash-lite"})
    assert llm["models"]["claude-sonnet-5-5"]["input_per_1m"] == 3 and llm["models"]["claude-sonnet-5-5"]["output_per_1m"] == 15
    assert llm["models"]["gemini-3-1-pro"]["output_per_1m"] == 12, "Gemini 3.1 Pro: the preview id"
    assert llm["models"]["gemini-3-1-flash-lite"] == shipped["llm"]["models"]["gemini-3-1-flash-lite"], "not found: kept"
    assert llm["date"] == date.today().isoformat() and llm["source"] == pricing.OPENROUTER_SOURCE
    assert llm["models"]["claude-sonnet-5-5"]["source"] == shipped["llm"]["models"]["claude-sonnet-5-5"]["source"]


def test_a_models_openrouter_id_wins_over_the_default(shipped):
    p = copy.deepcopy(shipped)
    p["llm"]["models"]["gemini-3-1-flash-lite"]["openrouter_id"] = "google/gemini-3.1-flash-lite-preview"
    p["llm"]["models"]["gpt-6-luna"]["openrouter_id"] = "openai/gpt-6-luna:batch"
    assert pricing.validate(p) == []
    report = pricing.refresh(p, "", fake_sources, fake_ecb)
    assert "gemini-3-1-flash-lite" in report["llm"]["updated"]
    assert p["llm"]["models"]["gemini-3-1-flash-lite"]["input_per_1m"] == 0.3
    assert report["llm"]["missing"] == ["gpt-6-luna"], "a :batch id is never used"


def test_manual_items_are_never_overwritten(shipped):
    p = copy.deepcopy(shipped)
    p["cloud"]["azure"]["items"]["vm_small"].update(price=0.05, manual=True)
    p["llm"]["models"]["claude-sonnet-5-5"].update(input_per_1m=2.5, manual=True)
    p["usd_per_eur"].update(value=1.2, manual=True)
    assert pricing.validate(p) == []
    before = copy.deepcopy(p)

    def no_fx(url):
        assert "frankfurter" not in url, "a manual rate is not fetched"
        return fake_sources(url)

    report = pricing.refresh(p, "", no_fx, down)
    assert report["fx"] == {"updated": [], "missing": [], "skipped": ["usd_per_eur"], "error": None}
    assert report["azure"]["skipped"] == ["vm_small"] and "vm_small" not in report["azure"]["updated"] + report["azure"]["missing"]
    assert report["llm"]["skipped"] == ["claude-sonnet-5-5"] and "claude-sonnet-5-5" not in report["llm"]["updated"]
    assert p["cloud"]["azure"]["items"]["vm_small"] == before["cloud"]["azure"]["items"]["vm_small"]
    assert p["llm"]["models"]["claude-sonnet-5-5"] == before["llm"]["models"]["claude-sonnet-5-5"]
    assert p["usd_per_eur"] == before["usd_per_eur"]
    assert p["cloud"]["azure"]["items"]["vm_medium"]["price"] == 0.1971, "the items without the flag still update"

    p["cloud"]["azure"]["items"]["vm_small"]["manual"] = "yes"
    assert any("vm_small.manual" in e for e in pricing.validate(p))


def test_last_updated_changes_only_when_a_price_changes(shipped):
    p = copy.deepcopy(shipped)
    pricing.refresh(p, "", fake_sources, fake_ecb)  # the file now holds the sources' prices
    p["last_updated"] = "2026-01-01"
    report = pricing.refresh(p, "", fake_sources, fake_ecb)
    assert report["azure"]["updated"] and report["llm"]["updated"], "the prices were checked again"
    assert p["last_updated"] == "2026-01-01", "same prices: last_updated unchanged"

    p["llm"]["models"]["claude-opus-5-5"]["input_per_1m"] = 5
    pricing.refresh(p, "", fake_sources, fake_ecb)
    assert p["last_updated"] == date.today().isoformat()


def test_refresh_route_saves_without_touching_last_updated_when_nothing_changed(tmp_file, shipped, monkeypatch):
    app = FastAPI()
    app.include_router(pricing.router)
    client = TestClient(app)
    monkeypatch.delenv("GCP_BILLING_API_KEY", raising=False)
    monkeypatch.setattr(pricing, "_get_json", fake_sources)
    monkeypatch.setattr(pricing, "_get_text", fake_ecb)
    p = copy.deepcopy(shipped)
    pricing.refresh(p, "", fake_sources, fake_ecb)
    p["last_updated"] = "2026-01-01"
    tmp_file.write_text(json.dumps(p), encoding="utf-8")

    answer = client.post("/api/pricing/refresh").json()
    assert answer["report"]["fx"]["error"] is None and answer["pricing"]["last_updated"] == "2026-01-01"
    assert json.loads(tmp_file.read_text(encoding="utf-8"))["last_updated"] == "2026-01-01"

    p["cloud"]["azure"]["items"]["vm_large"]["price"] = 0.5
    tmp_file.write_text(json.dumps(p), encoding="utf-8")
    client.post("/api/pricing/refresh")
    on_disk = json.loads(tmp_file.read_text(encoding="utf-8"))
    assert on_disk["cloud"]["azure"]["items"]["vm_large"]["price"] == 0.3942 and on_disk["last_updated"] == date.today().isoformat()

    p["last_updated"] = "2026-01-01"
    assert client.put("/api/pricing", json=p).json()["last_updated"] == date.today().isoformat(), "a save always dates the file"
