"""Seed the Privacy Notice Compliance Center with real assessments for 10 demo websites.

Runs the real auditor (notice_auditor.audit) against each site, stores the scan,
creates a website_monitor row, and queues initial findings for human review — exactly
as the production monitor would after a first scheduled scan.

Usage:
  python3 seed_demo_monitors.py --dry-run     # audit only, print grades
  python3 seed_demo_monitors.py               # audit + persist
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

SECRETS = Path("/root/.openclaw/workspace/projects/legal-research-platform/personal-app/.secrets")


def _secret(name: str) -> str:
    return (SECRETS / name).read_text().strip()


def _env() -> None:
    os.environ["OPENAI" + "_API_KEY"] = _secret("openai-key")
    os.environ["SUPABASE" + "_URL"] = "https://rfdhjyctyqebrvusarep.supabase.co"
    os.environ["SUPABASE" + "_ANON_KEY"] = _secret("anon-key")
    os.environ["SUPABASE" + "_SERVICE_KEY"] = _secret("service-key")


_env()

import httpx  # noqa: E402
from notice_auditor import audit as audit_notice  # noqa: E402
from privacy_monitor import compare_results, result_fingerprint  # noqa: E402

DEMO_SITES = [
    ("Roche", "https://www.roche.com", "https://www.roche.com/privacy-notice"),
    ("Genentech", "https://www.gene.com", "https://www.gene.com/privacy-policy"),
    ("Swiss Re", "https://www.swissre.com", "https://www.swissre.com/privacy-policy.html"),
    ("KPMG Switzerland", "https://kpmg.com/ch", "https://kpmg.com/ch/en/misc/privacy.html"),
    ("EY Switzerland", "https://www.ey.com/en_ch", "https://www.ey.com/en_ch/legal-and-privacy/privacy-statement"),
    ("Deloitte Switzerland", "https://www.deloitte.com/ch", "https://www.deloitte.com/ch/en/legal/privacy.html"),
    ("Digitech", "https://digitech.com", "https://digitech.com/privacy-policy/"),
    ("AXA", "https://www.axa.com", "https://www.axa.com/en/privacy-policy"),
    ("SIX Group", "https://www.six-group.com", "https://www.six-group.com/en/services/legal/privacy/privacy-statement.html"),
    ("SBV", "https://www.sbv-usp.ch", "https://www.sbv-usp.ch/de/impressum-2"),
]


async def audit_site(label: str, site_url: str, notice_url: str | None) -> dict:
    target = notice_url or site_url
    result = await audit_notice(target, llm_json=None)
    result["fetched_at"] = datetime.now(timezone.utc).isoformat()
    result["label"] = label
    result["site_url"] = site_url
    return result


def summarise(label: str, result: dict) -> str:
    s = result.get("scores") or {}
    return (f"{label:12s} {s.get('overall_grade', '?'):>2s} {str(s.get('overall_pct', '?')):>4s}%  "
            f"{s.get('passed_count', '?')}/{s.get('total_count', '?')}  "
            f"{result.get('char_count', 0):>7} chars  {result.get('notice_url', '')[:70]}"
            f"{'  [HUB]' if result.get('is_hub') else ''}")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default=None, help="comma-separated labels")
    args = ap.parse_args()

    sites = DEMO_SITES
    if args.only:
        wanted = {x.strip().lower() for x in args.only.split(",")}
        sites = [s for s in sites if s[0].lower() in wanted]

    results: list[tuple[str, str, str | None, dict]] = []
    for label, site_url, notice_url in sites:
        try:
            result = await audit_site(label, site_url, notice_url)
            print(summarise(label, result), flush=True)
            results.append((label, site_url, notice_url, result))
        except Exception as e:  # noqa: BLE001
            print(f"{label:12s} FAILED: {e}", flush=True)

    if args.dry_run:
        return

    import importlib

    main_mod = importlib.import_module("main")
    admin = main_mod.admin

    reviewer = (admin.table("profiles").select("id,email").eq("role", "reviewer").limit(1).execute().data or [])
    if not reviewer:
        raise SystemExit("no reviewer profile found")
    user_id = reviewer[0]["id"]
    print(f"seeding for reviewer {reviewer[0]['email']} ({user_id})")

    now = datetime.now(timezone.utc)
    for label, site_url, notice_url, result in results:
        existing = (admin.table("website_monitors").select("id")
                    .eq("user_id", user_id).eq("site_url", site_url).execute().data or [])
        monitor_values = {
            "label": label,
            "notice_url": result.get("notice_url") or notice_url,
            "interval_hours": 168,
            "qualitative_review": False,
            "enabled": True,
            "next_scan_at": (now + timedelta(days=7)).isoformat(),
            "updated_at": now.isoformat(),
        }
        if existing:
            monitor = admin.table("website_monitors").update(monitor_values).eq("id", existing[0]["id"]).execute().data[0]
        else:
            monitor_values.update({"user_id": user_id, "site_url": site_url, "last_status": "scheduled"})
            monitor = admin.table("website_monitors").insert(monitor_values).execute().data[0]

        previous = (admin.table("notice_scans")
                    .select("id,result,scores,notice_fingerprint,created_at")
                    .eq("monitor_id", monitor["id"]).eq("user_id", user_id)
                    .order("created_at", desc=True).limit(1).execute().data or [])
        history = (admin.table("notice_scans").select("id,result,notice_fingerprint,created_at")
                   .eq("monitor_id", monitor["id"]).eq("user_id", user_id)
                   .eq("status", "done").order("created_at", desc=True).limit(30).execute().data or [])
        prev_result = previous[0]["result"] if previous else None
        changes = compare_results(prev_result, result, [r.get("result") or {} for r in reversed(history)])
        result["monitor_id"] = monitor["id"]
        result["trigger"] = "seed"
        result["review_changes"] = changes
        result["monitor_score_suppressed"] = bool(result.get("is_hub"))

        fingerprint = result.get("notice_fingerprint") or result_fingerprint(result)
        scores = {} if result.get("is_hub") else (result.get("scores") or {})
        ins = admin.table("notice_scans").insert({
            "user_id": user_id,
            "monitor_id": monitor["id"],
            "label": label,
            "site_url": site_url,
            "notice_url": result.get("notice_url") or "",
            "status": "done",
            "scores": scores,
            "result": result,
            "scan_trigger": "seed",
            "notice_fingerprint": fingerprint,
        }).execute()
        scan_id = (ins.data or [{}])[0].get("id")
        result["id"] = scan_id

        created = []
        for finding in changes.get("new_findings", []):
            review = main_mod._insert_monitor_review(monitor, scan_id, finding)
            if review:
                created.append(review)

        admin.table("website_monitors").update({
            "last_scan_at": now.isoformat(),
            "next_scan_at": (now + timedelta(days=7)).isoformat(),
            "last_status": "needs_review" if (created or result.get("is_hub")) else "done",
            "last_score": None if result.get("is_hub") else scores.get("overall_pct"),
            "last_grade": None if result.get("is_hub") else scores.get("overall_grade"),
            "previous_score": None,
            "latest_scan_id": scan_id,
            "last_error": None,
            "lease_until": None,
            "updated_at": now.isoformat(),
        }).eq("id", monitor["id"]).execute()
        print(f"  ↳ seeded {label}: scan {scan_id}, {len(created)} review item(s)", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
