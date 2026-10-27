"""Portfolio-monitor helpers for the Privacy Notice Auditor.

Scores are screening signals only. This module decides which changed checks should
be offered to a human reviewer; it does not determine legal compliance.
"""
from __future__ import annotations

import hashlib
import re
from typing import Any

SEVERITY_BY_REF = {
    "Art. 13(1)(a)": "high",  # controller identity/contact
    "Art. 13(1)(b)": "high",  # DPO/contact
    "Art. 13(1)(c)": "high",  # purposes/legal basis
    "Art. 13(1)(e)": "medium",
    "Art. 13(1)(f)": "medium",
    "Art. 13(2)(a)": "high",  # retention
    "Art. 13(2)(b)/15-22": "high",
    "Art. 13(2)(d)": "high",
    "Art. 13(2)(e)": "medium",
    "Art. 13(2)(f)/22": "low",
    "Art. 8 / 13": "medium",
    "Art. 5(3)": "medium",
    "Art. 7(3) GDPR / 5(3)": "medium",
    "Art. 6 / 13": "low",
    "Art. 12(1)/13(3)": "low",
}


def severity(check: dict[str, Any]) -> str:
    ref = str(check.get("ref", ""))
    title = str(check.get("title", "")).lower()
    if "cookie_consent" in str(check.get("id", "")) or "consent mechanism" in title:
        return "high"
    for key, value in SEVERITY_BY_REF.items():
        if key in ref:
            return value
    return "medium"


def result_fingerprint(result: dict[str, Any]) -> str:
    """Hash normalized fetched notice text; falls back to stable checklist JSON."""
    if result.get("notice_fingerprint"):
        return str(result["notice_fingerprint"])
    text = str(result.get("notice_text") or result.get("normalized_text") or "")
    if text:
        normalized = re.sub(r"\s+", " ", text).strip().lower()
        return hashlib.sha256(normalized.encode()).hexdigest()
    # The auditor intentionally does not return/store the full text. Use the
    # stable check evidence/score payload as a fallback fingerprint.
    import json
    checks = result.get("checks") or []
    material = [{k: c.get(k) for k in ("id", "passed", "evidence", "detail")} for c in checks]
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def failed_checks(result: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not result:
        return {}
    return {str(c.get("id") or c.get("ref") or c.get("title")): c
            for c in result.get("checks", []) if not c.get("passed", False)}


def compare_results(previous: dict[str, Any] | None,
                    current: dict[str, Any],
                    history: list[dict[str, Any]] | None = None) -> dict[str, list[dict[str, Any]]]:
    """Diff checks, distinguishing initial gaps, regressions, and recoveries."""
    old_failed = failed_checks(previous)
    new_failed = failed_checks(current)
    current_all = {str(c.get("id") or c.get("ref") or c.get("title")): c
                   for c in current.get("checks", [])}
    old_all = {str(c.get("id") or c.get("ref") or c.get("title")): c
               for c in (previous or {}).get("checks", [])}
    added = []
    for key, check in new_failed.items():
        if key in old_failed:
            continue
        prior = old_all.get(key)
        check_kind = "initial_finding" if previous is None else (
            "regression" if prior and prior.get("passed") else "new_finding"
        )
        added.append({
            "finding_key": key,
            "kind": check_kind,
            "severity": severity(check),
            "title": check.get("title") or check.get("ref") or key,
            "ref": check.get("ref"),
            "detail": check.get("detail") or "The check did not detect expected wording in the fetched notice.",
            "evidence": check.get("evidence") or "",
        })
    recovered = [
        {"finding_key": key, "title": old_failed[key].get("title") or key,
         "ref": old_failed[key].get("ref"),
         "check": {k: old_failed[key].get(k) for k in ("id", "title", "ref", "domain", "weight")}}
        for key in old_failed.keys() - new_failed.keys()
    ]
    # If a key failed earlier, then passed, and now failed again, mark reopened.
    history = history or []
    was_ever_failed = set().union(*(failed_checks(x).keys() for x in history)) if history else set()
    for item in added:
        key = item["finding_key"]
        prior_pass_after_fail = False
        if was_ever_failed:
            seen_failure = False
            for snapshot in history:
                if key in failed_checks(snapshot):
                    seen_failure = True
                elif seen_failure:
                    snap_all = {str(c.get("id") or c.get("ref") or c.get("title")): c
                                for c in snapshot.get("checks", [])}
                    if snap_all.get(key, {}).get("passed"):
                        prior_pass_after_fail = True
            if key in old_failed:
                seen_failure = True
            elif key in old_all and old_all[key].get("passed") and seen_failure:
                prior_pass_after_fail = True
        if prior_pass_after_fail:
            item["kind"] = "reopened"
        elif key in old_all and old_all[key].get("passed"):
            item["kind"] = "regression"
    # Attach the exact checklist object used by the frontend for incident history.
    for item in added:
        item["check"] = current_all.get(item["finding_key"], {})

    return {"new_findings": added, "recovered": recovered,
            "still_failing": [
                {"finding_key": key, "title": check.get("title") or key,
                 "ref": check.get("ref"), "severity": severity(check)}
                for key, check in new_failed.items() if key in old_failed
            ],
            "ongoing": [
                {"finding_key": key, "title": check.get("title") or key,
                 "ref": check.get("ref"), "severity": severity(check)}
                for key, check in new_failed.items() if key in old_failed
            ]}
