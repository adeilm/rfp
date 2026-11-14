"""CV extractor: the facts of a PDF CV, section by section, for the web app's "Add CV" form.

Each fact comes from the section that states it, never from the whole text:
- name and headline: the top of the CV and its Profile section
- certifications: only the Certifications section (a CV can mention ISO 27001 projects without being certified)
- fields of work (web, devops, data...): the Profile, Experience and Projects sections
- skills: the Skills section first, then Experience and Projects
- years and seniority: a written "N years of experience", else the job dates of the Experience section
- languages and education: their own sections

The person checks the answer in the form before the CV is saved: what they confirm is stored next to the PDF
(`NN_First_Last.profile.json`) and wins over the rule parser at indexing time (profiles.build_profile). When the PDF
has no readable text, or nothing could be found, `ok` is false and the form is filled in by hand.
"""
import json
import re
import tempfile
from pathlib import Path

from . import cvparse
from . import taxonomy as tx

# Fields of work shown in the form, each found from the words that name it in the Profile / Experience / Projects text
FIELDS = {
    "web": ["web", "frontend", "front-end", "backend", "back-end", "full-stack", "fullstack", "react", "angular", "vue",
            "node.js", "django", "spring", "php", "laravel", "site", "website", "portail", "portal"],
    "mobile": ["mobile", "android", "ios", "flutter", "react native", "kotlin", "swift"],
    "devops": ["devops", "ci/cd", "kubernetes", "docker", "terraform", "ansible", "jenkins", "gitops", "sre"],
    "cloud": ["cloud", "azure", "aws", "gcp", "google cloud", "openshift"],
    "data": ["data engineer", "data pipeline", "etl", "elt", "data lake", "lakehouse", "data warehouse", "airflow",
             "talend", "databricks", "spark", "kafka", "dbt", "data platform"],
    "bi": ["power bi", "tableau", "qlik", "looker", "dashboard", "tableau de bord", "reporting", "business intelligence"],
    "ai": ["machine learning", "deep learning", "llm", "rag", "nlp", "computer vision", "data scientist", "mlops",
           "generative ai", "ia generative", "chatbot", "pytorch", "tensorflow"],
    "crm": ["salesforce", "crm", "dynamics 365", "hubspot", "sales cloud", "service cloud"],
    "erp": ["erp", "sap", "odoo", "oracle e-business"],
    "security": ["security", "securite", "cybersecurity", "iso 27001", "soc", "pentest", "siem"],
    "project management": ["project manager", "chef de projet", "scrum master", "product owner", "delivery manager",
                           "agile", "pmp", "prince2"],
}

MANUAL_FIELDS = ("name", "title", "seniority", "years", "fields", "roles", "skills", "certifications",
                 "sectors", "languages", "education")
SENIORITIES = ("junior", "mid", "senior")


def _text_of(lines):
    return "\n".join(lines)


def _has(text: str, word: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(word)}(?![a-z0-9])", text) is not None


def find_fields(text: str) -> list[str]:
    t = tx.normalize(text)
    return [f for f, words in FIELDS.items() if any(_has(t, tx.normalize(w)) for w in words)]


def read_pdf(pdf: bytes) -> str:
    """The text of a PDF, cleaned as the RAG loader reads CVs (one sentence per line)."""
    from .loader import _read
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "cv.pdf"
        path.write_bytes(pdf)
        return _read(path)


def extract_text(text: str) -> dict:
    """Every fact the CV states, by section (see the module docstring)."""
    from .profiles import _seniority, _years
    parts = {key: [] for key in cvparse.SECTION_NAMES}
    parts["top"] = []
    for key, lines in cvparse.sections(text):
        parts.setdefault(key, []).extend(lines)
    profile = _text_of(parts["profile"]) or cvparse.profile_paragraph(text)
    experience, projects = _text_of(parts["experience"]), _text_of(parts["projects"])
    skills_text = _text_of(parts["skills"])
    certs_text = _text_of(parts["certifications"])

    title = cvparse.current_job_title(text) or cvparse.headline(text) or ""
    years, source = _years(text)
    seniority = _seniority(" | ".join(x for x in (title, cvparse.headline(text)) if x), years, source)
    work = "\n".join(x for x in (profile, experience, projects) if x)
    out = {
        "name": cvparse.person_name(text) or "",
        "title": title,
        "seniority": seniority if seniority in SENIORITIES else "",
        "years": years,
        "years_source": source if years is not None else None,
        "fields": find_fields(work or text),
        "roles": tx.find_roles(" | ".join(x for x in (title, cvparse.headline(text), experience) if x)),
        "skills": sorted(set(tx.find_skills(skills_text)) | set(tx.find_skills(work))) if (skills_text or work)
        else sorted(tx.find_skills(text)),
        "certifications": sorted(set(tx.find_certs(certs_text))) if certs_text else [],
        "sectors": tx.find_sectors(work or text),
        "languages": [ln for ln in parts["languages"] if len(ln) <= 60][:6],
        "education": [ln for ln in parts["education"] if len(ln) <= 160][:4],
        "sections_found": [k for k in cvparse.SECTION_NAMES if parts.get(k)],
    }
    out["missing"] = [k for k in ("name", "title", "seniority", "fields", "skills") if not out[k]]
    # nothing useful: the form is filled in by hand
    out["ok"] = bool(text.strip()) and len(out["missing"]) < 4
    return out


def extract(pdf: bytes) -> dict:
    """extract_text on a PDF; a PDF without readable text (a scan) gives ok false and an error to show."""
    try:
        text = read_pdf(pdf)
    except Exception as e:
        return {"ok": False, "error": f"The PDF could not be read ({type(e).__name__}).", **_empty()}
    if len(text.strip()) < 80:
        return {"ok": False, "error": "No text found in the PDF (a scanned CV?). Fill in the fields by hand.", **_empty()}
    out = extract_text(text)
    if not out["ok"]:
        out["error"] = "Too little was found in this CV. Check and complete the fields by hand."
    return out


def _empty() -> dict:
    return {"name": "", "title": "", "seniority": "", "years": None, "years_source": None, "fields": [], "roles": [],
            "skills": [], "certifications": [], "sectors": [], "languages": [], "education": [], "sections_found": [],
            "missing": ["name", "title", "seniority", "fields", "skills"]}


# ---------------------------------------------------------------- what the person confirmed, next to the PDF
def manual_path(pdf_path) -> Path:
    p = Path(pdf_path)
    return p.with_name(p.stem + ".profile.json")


def clean_manual(data: dict) -> dict:
    """The confirmed fields only, typed: text, a known seniority, whole years, lists of short strings."""
    out = {}
    for k in MANUAL_FIELDS:
        v = (data or {}).get(k)
        if k in ("name", "title") and isinstance(v, str) and v.strip():
            out[k] = v.strip()[:120]
        elif k == "seniority" and v in SENIORITIES:
            out[k] = v
        elif k == "years" and isinstance(v, (int, float)) and 0 <= v <= 60:
            out[k] = int(v)
        elif isinstance(v, list):
            items = [str(x).strip()[:120] for x in v if str(x).strip()]
            if items:
                out[k] = items[:30]
    return out


def save_manual(pdf_path, data: dict) -> dict:
    confirmed = clean_manual(data)
    if confirmed:
        manual_path(pdf_path).write_text(json.dumps({"source": "confirmed in the Add CV form", **confirmed},
                                                    ensure_ascii=False, indent=2), encoding="utf-8")
    return confirmed


def load_manual(pdf_path) -> dict:
    try:
        return clean_manual(json.loads(manual_path(pdf_path).read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return {}


def apply_manual(profile: dict, manual: dict) -> dict:
    """The rule parser's profile with what the person confirmed: their values win, skills and certifications are
    normalised to the taxonomy so matching still finds them."""
    if not manual:
        return profile
    p = dict(profile)
    if manual.get("name"):
        p["name"] = manual["name"]
    if manual.get("title"):
        p["role"] = manual["title"]
    if manual.get("seniority"):
        p["seniority"] = manual["seniority"]
    if "years" in manual:
        p["years"], p["years_source"] = manual["years"], "confirmed"
    if manual.get("skills"):
        p["skills"] = sorted(set(p.get("skills") or []) | set(tx.expand_skills(tx.find_skills(" , ".join(manual["skills"])))))
    if manual.get("certifications"):
        p["certifications"] = sorted(set(tx.find_certs(" , ".join(manual["certifications"]))) or set(manual["certifications"]))
    if manual.get("roles"):
        p["roles"] = sorted(set(p.get("roles") or []) | set(tx.find_roles(" | ".join(manual["roles"]))))
    for k in ("fields", "languages", "education"):
        if manual.get(k):
            p[k] = manual[k]
    if manual.get("sectors"):
        p["sectors"] = sorted(set(manual["sectors"]) & set(tx.SECTORS)) or p.get("sectors", [])
    p["extractor"] = (p.get("extractor") or "rules") + "+confirmed"
    return p
