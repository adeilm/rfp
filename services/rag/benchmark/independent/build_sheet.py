"""Builds independent_evaluation_dataset.xlsx from tenders.json and draft_labels.json.

Sheets:
- Instructions: how to verify a row.
- Blank: every requirement, the label columns empty (to label from scratch, without the draft).
- Draft: the AI assistant's proposed labels, all NEEDS_REVIEW. A person sets "Label status" to VERIFIED (after
  correcting the row if needed) or EXCLUDED; only VERIFIED rows count in the evaluation.
The "System ..." and "Correct" / "Error Type" columns stay empty here: evaluate.py fills them in its own output file,
after the labels are verified, so the system's answers are never seen while labelling.

    python -m benchmark.independent.build_sheet            # from services/rag (writes next to this file)
"""
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

import sys
HERE = Path(__file__).resolve().parent
if "--set" in sys.argv:          # another test set: a sub-folder with its own tenders.json and labels (set2)
    HERE = HERE / sys.argv[sys.argv.index("--set") + 1]
OUT = HERE / "independent_evaluation_dataset.xlsx"
COLUMNS = ["Tender ID", "Tender Name", "Requirement ID", "Requirement", "Requirement Category", "Language",
           "Taken from", "Expected Status", "Evidence Document", "Evidence Location", "Evidence Explanation",
           "Label status", "Reviewer note", "System Status", "System Evidence", "Correct", "Error Type"]
WIDTHS = [12, 40, 9, 50, 12, 9, 14, 12, 34, 30, 60, 13, 30, 12, 30, 9, 18]
FR = set("le la les des du de et pour avec un une sur au aux en d l".split())


def language(text):
    words = [w.strip("'(),.").lower() for w in text.replace("'", " ").split()]
    fr = sum(w in FR for w in words) + sum(any(c in w for c in "éèàêç") for w in words)
    return "fr" if fr else "en"


def reviewer_row(rev, draft):
    """A second reviewer's label (reviewer_labels.json): VERIFIED when its confidence is high or medium and it agrees
    with the draft on the status; otherwise NEEDS_REVIEW, for a person to decide."""
    agrees = str(rev.get("agrees_with_draft", "")).lower().startswith("yes") and rev["expected_status"] == draft.get("expected")
    status = "VERIFIED" if rev.get("confidence") in ("high", "medium") and agrees else "NEEDS_REVIEW"
    explanation = f"{rev.get('explanation', '')} | quote: \"{rev.get('evidence_quote', '')}\"" if rev.get("evidence_quote") else rev.get("explanation", "")
    note = (f"Second reviewer (Claude, separate session), confidence {rev.get('confidence')}; AI draft said "
            f"{draft.get('expected', '?')}; agrees: {rev.get('agrees_with_draft', '')}")
    return rev["expected_status"], rev.get("evidence_document", ""), rev.get("evidence_location", ""), explanation, status, note


def rows(with_draft):
    tenders = json.loads((HERE / "tenders.json").read_text(encoding="utf-8"))["tenders"]
    labels = json.loads((HERE / "draft_labels.json").read_text(encoding="utf-8"))["labels"] if with_draft else {}
    reviewed = HERE / "reviewer_labels.json"
    reviewer = json.loads(reviewed.read_text(encoding="utf-8"))["labels"] if with_draft and reviewed.exists() else {}
    for t in tenders:
        for r in t["requirements"]:
            lab = labels.get(r["id"], {})
            if r["id"] in reviewer:
                expected, doc, loc, why, status, note = reviewer_row(reviewer[r["id"]], lab)
            else:
                expected, doc, loc = lab.get("expected", ""), lab.get("evidence", ""), lab.get("location", "")
                why = lab.get("why", "") + (f" | DOUBT: {lab['doubt']}" if lab.get("doubt") else "")
                status, note = ("NEEDS_REVIEW" if with_draft else ""), ""
            yield [t["tender_id"], t["title"], r["id"], r["text"], r["category"], language(r["text"]), r["from"],
                   expected, doc, loc, why, status, note, "", "", "", ""]


def sheet(wb, title, with_draft):
    ws = wb.create_sheet(title)
    ws.append(COLUMNS)
    for c, w in zip(ws[1], WIDTHS):
        c.font, c.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="1F4E79")
        ws.column_dimensions[c.column_letter].width = w
    for row in rows(with_draft):
        ws.append(row)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
    n = ws.max_row
    for col, values in (("H", "covered,partial,missing,NEEDS_REVIEW"), ("L", "NEEDS_REVIEW,VERIFIED,EXCLUDED")):
        dv = DataValidation(type="list", formula1=f'"{values}"', allow_blank=True)
        ws.add_data_validation(dv)
        dv.add(f"{col}2:{col}{n}")
    ws.freeze_panes = "E2"


def main():
    wb = Workbook()
    info = wb.active
    info.title = "Instructions"
    for line in [
        "Independent evaluation of the tender matching (RAG) - manual ground truth",
        "",
        "6 real BOAMP tenders never used to develop or tune the matching. Requirement lines are the notice's own words.",
        "Label each line from the knowledge base documents (knowledge-base/cvs, projects, tech_stacks), NEVER from the system's answers.",
        "covered = a document clearly proves the line as written (with the count asked); partial = related evidence or an equivalent technology;",
        "missing = no document proves it (it says nothing about what people can do outside the documents). Administrative lines are missing.",
        "Every covered or partial row needs its evidence document and location.",
        "",
        "Sheet 'Blank': label from scratch. Sheet 'Draft': the AI assistant's proposals, all NEEDS_REVIEW.",
        "For each Draft row: correct Expected Status / Evidence if needed, then set Label status to VERIFIED, or EXCLUDED if the line cannot be judged.",
        "Only VERIFIED rows are evaluated. Then run: python -m benchmark.independent.evaluate (see docs/rag-benchmark.md, section 8).",
        "Do not change the matching rules after looking at the evaluation: this set would become development data.",
    ]:
        info.append([line])
    info.column_dimensions["A"].width = 140
    info["A1"].font = Font(bold=True, size=13)
    sheet(wb, "Blank", with_draft=False)
    sheet(wb, "Draft", with_draft=True)
    wb.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
