"""Portfolio-monitor helpers for the Privacy Notice Compliance Center.

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

# Short reviewer-facing explanations for deterministic checklist misses. These
# deliberately say "not detected" rather than asserting non-compliance: a
# wording-based scanner can miss translations, linked notices, and equivalent
# language.
REVIEW_EXPLANATIONS = {
    "controller": (
        "The notice may not clearly identify the legal entity deciding why and how personal data is processed.",
        "People need to know which organisation is accountable for their data.",
        "Confirm the controller's full legal name and role are stated in the applicable notice.",
    ),
    "dpo": (
        "No data-protection officer or privacy contact was detected.",
        "Where a DPO is appointed or required, people need a usable contact route for privacy requests.",
        "Check for a named DPO/contact and an email, postal address, or equivalent contact method.",
    ),
    "contact": (
        "Direct contact details for the controller were not detected.",
        "A legal entity name alone may not give people a practical way to exercise their rights.",
        "Verify the notice provides valid contact details for the responsible entity.",
    ),
    "purposes": (
        "Specific purposes for collecting and using personal data were not detected.",
        "People should be able to understand what their data is used for before or when it is collected.",
        "Check that purposes are described concretely for the relevant processing activities.",
    ),
    "legal_basis": (
        "The notice did not clearly connect processing purposes to a lawful basis.",
        "For GDPR-covered processing, each purpose needs an applicable legal basis; a generic list may be insufficient.",
        "Verify the notice maps the relevant purposes to a basis such as contract, legal obligation, consent, or legitimate interests.",
    ),
    "recipients": (
        "Recipients or categories of organisations receiving personal data were not detected.",
        "People need to know whether data is shared with group companies, service providers, or other third parties.",
        "Check the notice identifies recipient categories and any relevant purpose of disclosure.",
    ),
    "transfers": (
        "Information about transfers outside the EEA/EU and applicable safeguards was not detected.",
        "This matters if the organisation transfers personal data internationally; the check does not establish that such transfers occur.",
        "Confirm whether transfers occur and, if so, whether destinations and safeguards are explained.",
    ),
    "retention": (
        "Retention periods or criteria for deciding how long data is kept were not detected.",
        "Without them, people cannot assess how long their information may remain identifiable.",
        "Look for a period or concrete criteria per relevant data type/purpose, including deletion or review points.",
    ),
    "rights": (
        "The scanner did not detect enough wording describing individual data-protection rights.",
        "A person may not be able to tell what they can request or how to do it.",
        "Check that applicable rights (for example access, correction, deletion, objection, and portability) are explained with a request route.",
    ),
    "complain": (
        "The right to complain to a supervisory authority was not detected.",
        "People should be told they can contact the competent data-protection authority, where this right applies.",
        "Verify the notice explains the complaint right and identifies or helps locate the competent authority.",
    ),
    "obligation": (
        "The notice did not explain whether providing data is required and what happens if it is not provided.",
        "This can leave people unclear about whether a field is optional or necessary for a contract/service.",
        "Check for required/optional status and consequences, where the data is collected directly and the rule applies.",
    ),
    "automated": (
        "Information about profiling or solely automated decisions was not detected.",
        "If such processing occurs, people may need information about its logic, significance, and consequences.",
        "Confirm whether relevant automated decisions/profiling occur and disclose them if applicable; absence alone is not a defect if none occur.",
    ),
    "children": (
        "Information about children's data or age limits was not detected.",
        "This is relevant if the service is directed to children or processes children's data; it may not apply to every organisation.",
        "Check the service's audience and whether age-related processing or safeguards need to be explained.",
    ),
    "updates": (
        "A notice version, effective date, or change-notification practice was not detected.",
        "Readers may have difficulty determining whether the notice is current or what changed.",
        "Look for a last-updated/effective date or a clear description of how material changes are communicated.",
    ),
    "cookies": (
        "Cookies or other tracking technologies were not detected in the notice text.",
        "If the site uses them, users need information about their use; a separate cookie notice may also be relevant.",
        "Check the live site and any linked cookie notice for cookies, pixels, local storage, or similar technologies.",
    ),
    "cookie_cats": (
        "Cookie categories or their purposes were not detected.",
        "Broad cookie disclosure may not tell users which technologies are essential, analytical, or promotional and why they are used.",
        "Review the cookie notice/consent interface for categories, purposes, and relevant providers.",
    ),
    "cookie_consent": (
        "A consent or preference mechanism for non-essential cookies was not detected.",
        "Where consent is required, users should be able to make a meaningful choice before non-essential technologies are used.",
        "Test the live banner/settings: look for accept and reject/manage options, and verify non-essential cookies do not fire before consent.",
    ),
    "withdraw": (
        "A way to withdraw consent or change cookie preferences was not detected.",
        "Where consent is used, users should be able to change their choice as easily as they made it.",
        "Check the notice and live interface for a persistent settings link or another clear withdrawal route.",
    ),
    "emarketing": (
        "The notice did not address email/newsletter or other electronic marketing communications.",
        "This is mainly relevant if the organisation sends direct marketing; it may be covered in a separate notice or sign-up flow.",
        "Check whether marketing occurs and, if so, how consent/opt-out and unsubscribe choices are explained.",
    ),
    "fadp_controller": (
        "Swiss FADP-specific controller or representative information was not detected.",
        "This is an advisory Swiss-law signal; applicability depends on the organisation and processing context.",
        "For Swiss-facing processing, verify the controller identity and any representative/contact information required in context.",
    ),
    "fadp_rights": (
        "Swiss FADP rights wording (such as access, correction, or deletion) was not detected.",
        "People may not see how to exercise rights available under Swiss law; the pattern check can miss equivalent German/French wording.",
        "Check the Swiss-facing notice in its relevant language for rights and a practical request channel.",
    ),
}


def review_detail(check: dict[str, Any] | None, kind: str = "initial_finding",
                  result: dict[str, Any] | None = None) -> str:
    """Build a concise, qualified summary for the human review queue."""
    check = check or {}
    if check.get("passed"):
        evidence = re.sub(r"\s+", " ", str(check.get("evidence") or "")).strip()
        lines = [
            "Update: the latest scan now detects wording for this checklist item; the earlier finding was not reproduced.",
            "Verify: confirm the wording is adequate and applies to the same processing. If so, resolve the older review item; if not, inspect the notice and scanner evidence.",
        ]
        if evidence:
            lines.append(f"Latest text signal: “{evidence[:240]}”")
        lines.append("The scan is a text-pattern signal, not a legal determination.")
        return "\n".join(lines)
    key = str(check.get("id") or "")
    summary, why, verify = REVIEW_EXPLANATIONS.get(key, (
        "The automated checklist did not detect expected wording for this item.",
        "This may indicate a missing disclosure, but wording-based matching can produce false positives.",
        "Open the linked notice and confirm the requirement applies and is not covered elsewhere or in equivalent wording.",
    ))
    lead = {
        "regression": "Possible regression",
        "reopened": "Possible recurring gap",
        "new_finding": "Possible new gap",
        "initial_finding": "Potential gap",
    }.get(kind, "Potential gap")
    lines = [f"{lead}: {summary}", f"Why it matters: {why}", f"Verify: {verify}"]
    evidence = re.sub(r"\s+", " ", str(check.get("evidence") or "")).strip()
    if evidence:
        lines.append(f"Text signal detected (not conclusive): “{evidence[:240]}”")
    else:
        lines.append("Text signal: no matching phrase was detected in the fetched text.")
    warnings = [str(w).lower() for w in (result or {}).get("warnings", [])]
    notice_url = str((result or {}).get("notice_url") or "").lower()
    if (result or {}).get("is_hub"):
        lines.append("Scope warning: this appears to be a privacy hub/index, not one complete notice. Pin the applicable notice before interpreting checklist findings.")
    elif any(x in notice_url for x in ("/impressum", "/disclaimer", "/legal-notice")):
        lines.append("Scope warning: the URL appears to be an imprint/disclaimer, not a dedicated privacy notice. These findings describe wording absent from this page; they are not evidence that the organisation's actual privacy notice is defective. Use the correct privacy notice URL and rescan.")
    elif any("no privacy notice could be located" in w or "renders its privacy notice with javascript" in w for w in warnings):
        lines.append("Scope warning: the scanner could not confirm this page is the privacy notice. Verify the correct, complete notice before treating this as a confirmed gap.")
    lines.append("Screening limitation: this is a text-pattern miss, not proof that the disclosure is absent or that the organisation is non-compliant. Equivalent wording, another language, or a linked notice can be missed.")
    return "\n".join(lines)


def event_review_detail(item: dict[str, Any]) -> str:
    """Human-readable context for non-checklist monitor events."""
    kind = str(item.get("kind") or "")
    detail = str(item.get("detail") or "").strip()
    if kind == "notice_changed":
        return ("Change detected: the fetched notice text differs from the previous scan. "
                "This can reflect a substantive change or harmless edits/layout. Compare the current and prior notice, "
                "then confirm whether purposes, data types, recipients, transfers, retention, rights, or cookie disclosures changed.")
    if kind == "score_drop":
        return (f"Screening score decreased. {detail} Review the checks that changed between scans; a score shift is a triage signal, "
                "not a legal finding by itself.").strip()
    if kind == "scan_failed":
        return (f"The scheduled fetch or analysis failed: {detail or 'no error details returned'}. "
                "Check whether the site is reachable, the notice URL still works, or access controls/site changes blocked the scanner.")
    if kind == "notice_hub":
        return (f"The URL appears to be a privacy hub/index rather than one applicable notice. {detail} "
                "Pin the audience- and jurisdiction-specific notice, then rescan.").strip()
    if kind in ("initial_finding", "new_finding", "regression", "reopened"):
        return review_detail(item.get("check") or item, kind, item.get("result"))
    return detail or "Review the linked scan and confirm what changed and whether the requirement applies."


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
            "detail": review_detail(check, check_kind, current),
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
