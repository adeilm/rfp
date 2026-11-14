"""Staffing lines nobody meets exactly, and tender wording the glossary now understands.

A team line is partial (never covered) when people come close: the role one level below the seniority
asked, or the role's core skill without the title. Built on synthetic profiles, not on the benchmark.
"""
from rag import taxonomy as tx
from rag.reqparse import parse
from rag.retriever import _near_team


def cv(roles, seniority, skills=()):
    return {"type": "cv", "profile": {"roles": list(roles), "seniority": seniority, "skills": list(skills)}}


STORE = {
    "dev_mid": cv(["developer"], "mid"),
    "dev_junior": cv(["developer"], "junior"),
    "analyst_ux": cv(["business analyst"], "mid", ["ux/ui design", "power bi"]),
    "pm_senior": cv(["project manager"], "senior"),
}


def test_role_one_level_below_the_seniority_asked_is_near():
    near = _near_team(parse("Minimum 3 senior developers", "team"), STORE, {"cv"})
    assert near == {"dev_mid": "developer at mid level, not senior"}, "junior is two levels below: not counted"


def test_role_skill_without_the_title_is_near():
    near = _near_team(parse("1 UX/UI designer", "team"), STORE, {"cv"})
    assert list(near) == ["analyst_ux"]
    assert "ux/ui design skill without the designer role" in near["analyst_ux"]


def test_nothing_near_for_certificates_other_skills_or_non_team_lines():
    assert _near_team(parse("1 PMP certified project manager", "team"), STORE, {"cv"}) == {}
    assert _near_team(parse("2 senior developers with Kubernetes", "team"), STORE, {"cv"}) == {}
    assert _near_team(parse("React frontend", "technical"), STORE, {"cv"}) == {}
    assert _near_team(parse("1 data engineer", "team"), STORE, {"cv"}) == {}, "nobody close: stays missing"


def test_french_tender_wording_is_understood():
    assert "dashboard" in tx.find_skills("restitution des données aux directions")
    assert "dashboard" in tx.find_skills("data restitutions")
    assert "etl" in tx.find_skills("traitement des données")
    assert "computer vision" in tx.find_skills("Le système doit permettre l'analyse d'images")
    assert "chatbot" in tx.find_skills("un assistant conversationnel pour les usagers")


def test_tender_boilerplate_does_not_block_an_experience_match():
    # DEMO-003 (2026-10-30): "contractor" and "justify" were left over, so the health dashboard project never matched
    r = parse("The contractor must justify at least 1 health sector dashboard project", "experience")
    assert r.leftover == [] and r.sectors == ["health"] and "dashboard" in r.skills
    assert parse("Le titulaire doit justifier d'au moins 1 projet de tableau de bord", "experience").leftover == []
