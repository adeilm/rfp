"""POST /api/cvs: a PDF CV added from the web app's knowledge base, saved as the next NN_First_Last.pdf."""
import base64

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from rag import config, dashboard

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


@pytest.fixture
def client(tmp_path, monkeypatch):
    (tmp_path / "01_Ava_Thompson.pdf").write_bytes(PDF)
    (tmp_path / "19_Owen_Parker.pdf").write_bytes(PDF)
    monkeypatch.setattr(config, "CV_DIR", tmp_path)
    started = []
    monkeypatch.setattr(dashboard, "_reindex_after_cv", lambda f: started.append(f))
    monkeypatch.setitem(dashboard.CV_REINDEX, "status", "idle")
    app = FastAPI()
    app.include_router(dashboard.router)
    c = TestClient(app)
    c.started, c.dir = started, tmp_path
    return c


def test_pdf_saved_as_the_next_number_and_indexed(client):
    r = client.post("/api/cvs", json={"name": "Sara Ben Ali", "content_base64": base64.b64encode(PDF).decode()})
    assert r.status_code == 202 and r.json()["file"] == "20_Sara_Ben_Ali.pdf"
    assert (client.dir / "20_Sara_Ben_Ali.pdf").read_bytes() == PDF
    assert client.started == ["20_Sara_Ben_Ali.pdf"]


def test_accents_are_dropped_from_the_file_name():
    assert dashboard.cv_file_name("Élodie Gérard-Martin", ["03_X.pdf"]) == "04_Elodie_Gerard_Martin.pdf"


def test_not_a_pdf_or_while_indexing_is_refused(client):
    assert client.post("/api/cvs", json={"name": "Sara Ben Ali", "content_base64": base64.b64encode(b"hello world").decode()}).status_code == 422
    dashboard.CV_REINDEX["status"] = "indexing"
    assert client.post("/api/cvs", json={"name": "Sara Ben Ali", "content_base64": base64.b64encode(PDF).decode()}).status_code == 409
    assert not (client.dir / "20_Sara_Ben_Ali.pdf").exists()
