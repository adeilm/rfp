"""Independent evaluation: the matching system on the VERIFIED rows of independent_evaluation_dataset.xlsx.

Runs retrieve() (the function behind POST /retrieve/tender) on each tender of tenders.json, in company mode, with the
current rules and indexes, then compares its status and evidence with the person-verified labels. Nothing in the
matching is changed by this script. Outputs (next to this file):
- predictions.json: the system's status, documents and quote per requirement (saved even when metrics are refused)
- results.json / results.md: the metrics, the confusion matrix and every error
- independent_evaluation_results.xlsx: the Draft sheet with System Status / System Evidence / Correct / Error Type

Metrics are reported only when at least MIN_VERIFIED rows are VERIFIED: with fewer, the numbers mean nothing.

    cd services/rag && python -m benchmark.independent.evaluate               # needs verified labels
    cd services/rag && python -m benchmark.independent.evaluate --predict-only # only predictions.json (do not open it
                                                                              # before the labels are verified)
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook

import sys
HERE = Path(__file__).resolve().parent
if "--set" in sys.argv:          # another test set: a sub-folder (set2)
    HERE = HERE / sys.argv[sys.argv.index("--set") + 1]
SHEET = HERE / "independent_evaluation_dataset.xlsx"
CLASSES = ("covered", "partial", "missing")
MIN_VERIFIED = 15
K = 3


def load_tenders():
    return json.loads((HERE / "tenders.json").read_text(encoding="utf-8"))["tenders"]


def verified_labels():
    """{requirement id: row} for the Draft rows a person set to VERIFIED."""
    ws = load_workbook(SHEET)["Draft"]
    head = [c.value for c in ws[1]]
    out = {}
    for values in ws.iter_rows(min_row=2, values_only=True):
        row = dict(zip(head, values))
        if str(row.get("Label status") or "").strip().upper() == "VERIFIED":
            status = str(row.get("Expected Status") or "").strip().lower()
            if status not in CLASSES:
                raise SystemExit(f"{row['Requirement ID']}: VERIFIED but Expected Status is '{status}'")
            out[row["Requirement ID"]] = {**row, "Expected Status": status}
    return out


def predict(log=print):
    """The system's answer for every requirement line (company mode, current indexes)."""
    from rag import config
    from rag.context import for_mode, retrieval_scope
    from rag.index import build_index, index_up_to_date
    from rag.retriever import retrieve
    preds = {}
    with retrieval_scope(for_mode("company")):
        if not index_up_to_date(config.EMBEDDING_MODEL):
            log("building the company index")
            build_index(config.EMBEDDING_MODEL)
        for t in load_tenders():
            body = {c: [r["text"] for r in t["requirements"] if r["category"] == c] for c in ("technical", "team", "experience")}
            answer = retrieve(body)
            rows = {r["requirement"]: r for r in answer["requirements_matrix"]}
            ranked = {r["requirement"]: [m["doc_id"] for m in r.get("matches", [])] for r in answer["requirement_matches"]}
            for r in t["requirements"]:
                row = rows.get(r["text"], {})
                preds[r["id"]] = {"tender_id": t["tender_id"], "requirement": r["text"], "status": row.get("status", "missing"),
                                  "best_doc": row.get("best_doc"), "quote": row.get("evidence"), "docs": ranked.get(r["text"], [])}
            log(f"{t['tender_id']}: {len(t['requirements'])} lines")
    return preds


def same_doc(system_id, expected):
    """A system doc id ("CV_08_Lucas_Reed.pdf", "olivesoft_Project_X") matches an expected one ("CV_08..." or the id)."""
    s = str(system_id or "")
    for e in re.split(r"[;,]\s*", str(expected or "")):
        e = e.strip()
        if e and (s == e or s.split(".")[0] == e.split(".")[0] or (e[:5].upper() == s[:5].upper() and e[:5].upper().startswith("CV_"))):
            return True
    return False


def error_type(expected, system):
    if expected == system:
        return "None"
    if expected == "missing":
        return "False Positive"
    if system == "missing":
        return "False Negative"
    return "Incorrect Partial"


def metrics(labels, preds):
    pairs = [(lab["Expected Status"], preds[rid]["status"]) for rid, lab in labels.items()]
    n = len(pairs)
    confusion = {e: {s: sum(1 for a, b in pairs if a == e and b == s) for s in CLASSES} for e in CLASSES}
    per_class = {}
    for c in CLASSES:
        tp = confusion[c][c]
        fp = sum(confusion[e][c] for e in CLASSES if e != c)
        fn = sum(confusion[c][s] for s in CLASSES if s != c)
        p = tp / (tp + fp) if tp + fp else None
        r = tp / (tp + fn) if tp + fn else None
        per_class[c] = {"support": tp + fn, "precision": p, "recall": r,
                        "f1": (2 * p * r / (p + r)) if p and r else (0.0 if p is not None and r is not None else None)}
    # evidence: on rows both sides call covered / partial, is the system's lead document one the person named?
    ev_rows = [rid for rid, lab in labels.items() if lab["Expected Status"] != "missing" and preds[rid]["status"] != "missing"]
    ev_ok = [rid for rid in ev_rows if same_doc(preds[rid]["best_doc"], labels[rid]["Evidence Document"])]
    # retrieval: expected documents among the system's top K documents
    prec, rec = [], []
    for rid, lab in labels.items():
        expected = [e.strip() for e in re.split(r"[;,]\s*", str(lab["Evidence Document"] or "")) if e.strip()]
        top = preds[rid]["docs"][:K]
        if expected and top:
            hits = [d for d in top if same_doc(d, ";".join(expected))]
            prec.append(len(hits) / len(top))
            rec.append(len({e for e in expected if any(same_doc(d, e) for d in top)}) / len(expected))
    by_lang = {}
    for lang in sorted({str(lab.get("Language") or "?") for lab in labels.values()}):
        ids = [rid for rid, lab in labels.items() if str(lab.get("Language") or "?") == lang]
        by_lang[lang] = {"n": len(ids), "accuracy": sum(labels[i]["Expected Status"] == preds[i]["status"] for i in ids) / len(ids)}
    errors = Counter(error_type(a, b) for a, b in pairs)
    return {"n": n, "accuracy": sum(a == b for a, b in pairs) / n, "per_class": per_class, "confusion": confusion,
            "errors": dict(errors), "evidence_accuracy": {"rows": len(ev_rows), "correct": len(ev_ok)},
            f"precision@{K}": sum(prec) / len(prec) if prec else None, f"recall@{K}": sum(rec) / len(rec) if rec else None,
            "retrieval_rows": len(prec), "by_language": by_lang}


def fmt(x):
    return "n/a" if x is None else f"{x:.2f}"


def write_report(m, labels, preds):
    lines = ["# Independent evaluation: results", "",
             f"{m['n']} verified requirement lines from {len({p['tender_id'] for p in preds.values()})} BOAMP tenders, company mode. "
             "Labels set before this run from the documents (an AI draft, checked by a second independent AI reviewer; rows where they disagree or the reviewer was unsure stay NEEDS_REVIEW and are not counted); the matching was not changed after it.", "",
             f"**Accuracy {fmt(m['accuracy'])}**", "", "| Class | Support | Precision | Recall | F1 |", "|---|---|---|---|---|"]
    lines += [f"| {c} | {v['support']} | {fmt(v['precision'])} | {fmt(v['recall'])} | {fmt(v['f1'])} |" for c, v in m["per_class"].items()]
    lines += ["", "Confusion matrix (rows: expected, columns: system)", "", "| | " + " | ".join(CLASSES) + " |", "|---|---|---|---|"]
    lines += [f"| {e} | " + " | ".join(str(m["confusion"][e][s]) for s in CLASSES) + " |" for e in CLASSES]
    ev = m["evidence_accuracy"]
    lines += ["", f"Errors: {m['errors']}", "",
              f"Evidence: the system's lead document is one the person named on {ev['correct']} of {ev['rows']} rows both call covered or partial.",
              f"Retrieval (rows with expected documents, n={m['retrieval_rows']}): P@{K} {fmt(m[f'precision@{K}'])}, R@{K} {fmt(m[f'recall@{K}'])}.", "",
              "By language: " + ", ".join(f"{k} {fmt(v['accuracy'])} (n={v['n']})" for k, v in m["by_language"].items()), "",
              "| Req | Requirement | Expected | System | System document | Error |", "|---|---|---|---|---|---|"]
    for rid, lab in labels.items():
        p = preds[rid]
        lines.append(f"| {rid} | {lab['Requirement']} | {lab['Expected Status']} | {p['status']} | {p['best_doc'] or ''} | "
                     f"{error_type(lab['Expected Status'], p['status'])} |")
    if m["n"] < 30:
        lines += ["", f"Small set ({m['n']} lines): a single line moves accuracy by {100 / m['n']:.0f} points. Read the errors, not only the rates."]
    (HERE / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_sheet(labels, preds):
    wb = load_workbook(SHEET)
    ws = wb["Draft"]
    head = [c.value for c in ws[1]]
    col = {h: i for i, h in enumerate(head)}
    for row in ws.iter_rows(min_row=2):
        rid = row[col["Requirement ID"]].value
        p = preds.get(rid)
        if not p:
            continue
        row[col["System Status"]].value = p["status"]
        row[col["System Evidence"]].value = " | ".join(x for x in (p["best_doc"], p["quote"]) if x)
        if rid in labels:
            e = error_type(labels[rid]["Expected Status"], p["status"])
            row[col["Correct"]].value = "yes" if e == "None" else "no"
            row[col["Error Type"]].value = e
    wb.save(HERE / "independent_evaluation_results.xlsx")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--predict-only", action="store_true", help="save predictions.json only")
    ap.add_argument("--set", default="", help="sub-folder of another test set (set2)")
    args = ap.parse_args()
    labels = {} if args.predict_only else verified_labels()
    if not args.predict_only and len(labels) < MIN_VERIFIED:
        raise SystemExit(f"Only {len(labels)} rows are VERIFIED in {SHEET.name} (Draft sheet); {MIN_VERIFIED} are needed "
                         "before metrics mean anything. Verify the labels first (see the Instructions sheet).")
    preds = predict()
    (HERE / "predictions.json").write_text(json.dumps(preds, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.predict_only:
        print("predictions.json written; do not open it before the labels are verified")
        return
    m = metrics(labels, preds)
    (HERE / "results.json").write_text(json.dumps(m, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(m, labels, preds)
    write_sheet(labels, preds)
    print(f"accuracy {fmt(m['accuracy'])} on {m['n']} verified lines; see results.md")


if __name__ == "__main__":
    main()
