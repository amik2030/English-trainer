"""
Pocket DDP Workbench — private legal research app backend.
FastAPI; serves the frontend static files + JSON API under /api.
Auth: Supabase magic-link. User access tokens verified via GoTrue /auth/v1/user.
Roles: reviewer (full HITL control) | user (ask + browse approved KB).
"""

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from supabase import create_client
import os
import json
import httpx
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from ddp_taxonomy import (
    TAXONOMY_NODES, TAXONOMY_TAGS, INSTRUMENT_TYPES, JURISDICTIONS,
    TEMPORAL_STATUSES, taxonomy_labels,
)

OPENAI_API_KEY = os.environ["OPENAI" + "_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE" + "_URL"]
SUPABASE_ANON_KEY = os.environ["SUPABASE" + "_ANON_KEY"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE" + "_SERVICE_KEY"]
REVIEWER_EMAILS = {e.strip().lower() for e in os.environ.get("REVIEWER_EMAILS", "").split(",") if e.strip()}
PUBLIC_SITE_URL = os.environ.get("PUBLIC_SITE_URL", "")  # for magic-link redirect allowlist

client = OpenAI(api_key=OPENAI_API_KEY)
admin = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

app = FastAPI(title="Pocket DDP Workbench")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# ---------------- auth helpers ----------------

async def current_user(request: Request) -> dict:
    """Verify the Bearer access token against GoTrue and return the profile."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    async with httpx.AsyncClient(timeout=15) as hc:
        r = await hc.get(f"{SUPABASE_URL}/auth/v1/user",
                         headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(401, "invalid token")
    u = r.json()
    uid, email = u.get("id"), (u.get("email") or "").lower()
    # fetch/create profile
    res = admin.table("profiles").select("*").eq("id", uid).execute()
    if res.data:
        prof = res.data[0]
        # auto-promote allowlisted reviewer emails
        if email in REVIEWER_EMAILS and prof.get("role") != "reviewer":
            admin.table("profiles").update({"role": "reviewer"}).eq("id", uid).execute()
            prof["role"] = "reviewer"
    else:
        role = "reviewer" if email in REVIEWER_EMAILS else "user"
        prof = {"id": uid, "email": email, "role": role}
        admin.table("profiles").insert(prof).execute()
    return prof


def require_reviewer(prof: dict):
    if prof.get("role") != "reviewer":
        raise HTTPException(403, "reviewer role required")
    return prof


def _now():
    return datetime.now(timezone.utc).isoformat()


def _llm_json(system: str, user: str, max_tokens=800, temperature=0.3):
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_tokens=max_tokens, temperature=temperature,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


def _taxonomy_block():
    return (
        "TAXONOMY TREE (dotted ID -> label):\n"
        + "\n".join(f"{k}  {v}" for k, v in TAXONOMY_NODES.items())
        + "\n\nCONTROLLED TAGS: " + ", ".join(TAXONOMY_TAGS)
        + "\nINSTRUMENT TYPES: " + ", ".join(INSTRUMENT_TYPES)
        + "\nJURISDICTIONS: " + ", ".join(JURISDICTIONS)
        + "\nTEMPORAL STATUSES: " + ", ".join(TEMPORAL_STATUSES)
    )


def _clean_ids_tags_jur(cls: dict):
    ids = [str(i).strip() for i in cls.get("taxonomy_ids", []) if str(i).strip() in TAXONOMY_NODES][:3] or ["Z"]
    tags = [str(t).strip().lstrip("#") for t in cls.get("tags", []) if str(t).strip().lstrip("#") in TAXONOMY_TAGS][:5]
    jur = str(cls.get("jurisdiction", "INTL"))[:10]
    if jur not in JURISDICTIONS:
        jur = "INTL"
    try:
        conf = max(0.0, min(1.0, float(cls.get("confidence", 0.8))))
    except (TypeError, ValueError):
        conf = 0.8
    return ids, tags, jur, conf, str(cls.get("rationale", ""))[:300]


# ---------------- public config + me ----------------

@app.get("/api/config")
async def get_config():
    return {
        "supabase_url": SUPABASE_URL,
        "anon_key": SUPABASE_ANON_KEY,
        "site_url": PUBLIC_SITE_URL,
    }


@app.get("/api/me")
async def me(request: Request):
    prof = await current_user(request)
    return {"id": prof["id"], "email": prof.get("email"), "role": prof.get("role"),
            "display_name": prof.get("display_name")}


# ---------------- ASK (RAG over approved knowledge) ----------------

ASK_SYSTEM = """You are the AI research assistant of a private Legal Research Workbench used by data-protection lawyers.
You answer questions about data protection, privacy, AI governance and compliance (GDPR, AI Act, FADP, Digital Omnibus, ePrivacy, Schrems II, transfers, breaches, etc.).

You receive: (1) the QUESTION, (2) APPROVED KNOWLEDGE ITEMS (curated by the human reviewer), (3) APPROVED SOURCES register, (4) PREVIOUS ANSWERED Q&A.

Procedure:
1. KB REUSE FIRST: if a previous answered question has the same intent (paraphrases count), return that answer VERBATIM, set reused=true and matched_qa_id to its id.
2. Otherwise compose an answer GROUNDED IN the approved knowledge items and sources where they cover the topic; supplement with your own legal knowledge only where the KB is silent. Direct answer first, then 2-4 key points, 120-250 words. Cite instruments/articles (e.g. Art. 6(1)(f) GDPR) and approved source titles exactly.
3. citations: list of {"kind": "knowledge_item"|"source"|"qa", "id": int, "title": str} for items you actually relied on (empty if none).
4. kb_grounded: true if the approved KB materially contributed to the answer.
5. confidence: 0.0-1.0. jurisdiction: from EU, CH, DE, FR, IT, AT, ES, NL, BE, UK, US, INTL.
6. Never fabricate case law or dates; if uncertain, say so briefly.
7. If outside data-protection/compliance scope, say so briefly, confidence low.

Respond with ONLY a JSON object:
{"answer": str, "reused": bool, "matched_qa_id": int|null, "citations": [...], "kb_grounded": bool, "confidence": float, "jurisdiction": str}"""


class AskScope(BaseModel):
    """Optional narrowing filters for an Ask query."""
    jurisdiction: Optional[str] = None        # EU | UK | CH | ... (exact match on source.jurisdiction)
    taxonomy_area: Optional[str] = None       # top-level (A/B/C) or dotted prefix (A.1) matched against taxonomy_ids
    origin: Optional[str] = None              # external | internal (classification.origin; default external)
    temporal_status: Optional[str] = None     # IN_FORCE | DRAFT | PROPOSED | REPEALED | SUPERSEDED
    instrument: Optional[str] = None          # REGULATION | GUIDELINES | JUDGMENT | ...
    issuing_body: Optional[str] = None        # free text, substring-matched vs classification.issuing_body + title


class AskRequest(BaseModel):
    question: str
    scope: Optional[AskScope] = None


def _source_in_scope(s: dict, sc: Optional[AskScope]) -> bool:
    if sc is None:
        return True
    if sc.jurisdiction and (s.get("jurisdiction") or "INTL").upper() != sc.jurisdiction.strip().upper():
        return False
    if sc.taxonomy_area:
        pref = sc.taxonomy_area.strip().upper()
        ids = [str(i).upper() for i in (s.get("taxonomy_ids") or [])]
        if not any(i == pref or i.startswith(pref + ".") for i in ids):
            return False
    cls = s.get("classification") or {}
    if sc.origin:
        origin = str(cls.get("origin") or "external").lower()
        if origin != sc.origin.strip().lower():
            return False
    if sc.temporal_status:
        ts = str(cls.get("temporal_status") or "IN_FORCE").upper()
        if ts != sc.temporal_status.strip().upper():
            return False
    if sc.instrument and (s.get("instrument") or "").upper() != sc.instrument.strip().upper():
        return False
    if sc.issuing_body:
        hay = (str(cls.get("issuing_body") or "") + " " + str(s.get("title") or "")).lower()
        if sc.issuing_body.strip().lower() not in hay:
            return False
    return True


def _scope_summary(sc: Optional[AskScope]) -> str:
    """Human-readable scope line for the LLM prompt; empty when unscoped."""
    if sc is None:
        return ""
    parts = []
    if sc.jurisdiction: parts.append(f"jurisdiction={sc.jurisdiction}")
    if sc.taxonomy_area: parts.append(f"legal area={sc.taxonomy_area}")
    if sc.origin: parts.append(f"source origin={sc.origin}")
    if sc.temporal_status: parts.append(f"status={sc.temporal_status}")
    if sc.instrument: parts.append(f"instrument type={sc.instrument}")
    if sc.issuing_body: parts.append(f"issuing body contains '{sc.issuing_body}'")
    return "SCOPE CONSTRAINTS (narrow your answer to these; say so if the KB lacks in-scope material): " + "; ".join(parts) if parts else ""


@app.post("/api/ask")
async def ask(req: AskRequest, request: Request, background_tasks: BackgroundTasks):
    prof = await current_user(request)
    q = (req.question or "").strip()[:800]
    if not q:
        raise HTTPException(400, "question required")

    ki_all = admin.table("knowledge_items").select("id, content, source_id, taxonomy_ids, tags") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(60).execute().data or []
    src_all = admin.table("sources").select("id, title, taxonomy_ids, tags, instrument, jurisdiction, classification") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(40).execute().data or []
    qa = admin.table("qa_history").select("id, question, answer") \
        .eq("status", "answered").order("answered_at", desc=True).limit(40).execute().data or []

    # apply scope filters
    src = [s for s in src_all if _source_in_scope(s, req.scope)]
    if req.scope is not None:
        in_src_ids = {s["id"] for s in src}
        pref = (req.scope.taxonomy_area or "").strip().upper()
        ki = [k for k in ki_all
              if k.get("source_id") in in_src_ids
              or (pref and any(str(i).upper() == pref or str(i).upper().startswith(pref + ".")
                               for i in (k.get("taxonomy_ids") or [])))]
    else:
        ki = ki_all

    scope_line = _scope_summary(req.scope)
    prompt = (
        (("\n" + scope_line + "\n\n") if scope_line else "")
        + "QUESTION:\n" + q
        + "\n\nAPPROVED KNOWLEDGE ITEMS:\n" + json.dumps([{"id": k["id"], "content": k["content"][:800],
             "taxonomy_ids": k.get("taxonomy_ids") or [], "source_id": k.get("source_id")} for k in ki], ensure_ascii=False)
        + "\n\nAPPROVED SOURCES:\n" + json.dumps([{"id": s["id"], "title": s["title"]} for s in src], ensure_ascii=False)
        + "\n\nPREVIOUS ANSWERED Q&A:\n" + json.dumps([{"id": r["id"], "question": r["question"],
             "answer": (r.get("answer") or "")[:1000]} for r in qa], ensure_ascii=False)
    )
    try:
        out = _llm_json(ASK_SYSTEM, prompt, max_tokens=900)
    except Exception as e:
        raise HTTPException(502, f"answer generation failed: {e}")

    answer = str(out.get("answer", "")).strip()
    if not answer:
        raise HTTPException(502, "empty answer")
    reused = bool(out.get("reused"))
    qa_ids = {r["id"] for r in qa}
    matched = out.get("matched_qa_id")
    if not reused or matched not in qa_ids:
        reused, matched = False, None
    ki_ids = {k["id"] for k in ki}
    src_ids = {s["id"] for s in src}
    cits = []
    for c in (out.get("citations") or [])[:8]:
        kind, cid = c.get("kind"), c.get("id")
        if kind == "knowledge_item" and cid in ki_ids:
            cits.append({"kind": "knowledge_item", "id": cid, "title": (ki[[k["id"] for k in ki].index(cid)].get("content") or "")[:80]})
        elif kind == "source" and cid in src_ids:
            cits.append({"kind": "source", "id": cid, "title": src[[s["id"] for s in src].index(cid)]["title"]})
        elif kind == "qa" and cid in qa_ids:
            cits.append({"kind": "qa", "id": cid, "title": qa[[r["id"] for r in qa].index(cid)]["question"][:80]})
    try:
        conf = max(0.0, min(1.0, float(out.get("confidence", 0.8))))
    except (TypeError, ValueError):
        conf = 0.8
    jur = str(out.get("jurisdiction", "INTL"))[:10] or "INTL"

    row_id = matched
    if not reused:
        ins = admin.table("qa_history").insert({
            "user_id": prof["id"], "question": q, "answer": answer,
            "citations": cits, "kb_reused": False, "status": "answered",
            "answered_at": _now(),
        }).execute()
        row_id = ins.data[0]["id"] if ins.data else None
        # gap flag: KB didn't cover it or low confidence
        if (not out.get("kb_grounded")) or conf < 0.55:
            try:
                admin.table("gap_flags").insert({
                    "qa_id": row_id, "question": q,
                    "reason": "low confidence" if conf < 0.55 else "not covered by approved KB",
                }).execute()
            except Exception:
                pass
        if row_id is not None:
            background_tasks.add_task(tag_qa, row_id, q, answer)
    return {"id": row_id, "question": q, "answer": answer, "reused": reused,
            "matched_qa_id": matched, "citations": cits, "confidence": conf,
            "jurisdiction": jur, "status": "answered",
            "scope": (req.scope.dict(exclude_none=True) if req.scope else None),
            "kb_counts": {"sources_in_scope": len(src), "items_in_scope": len(ki)}}


QA_TAG_SYSTEM = """You are the classification engine of a Legal Research Workbench (DDP Taxonomy v0.2).
Classify the given Q&A exchange. Respond with ONLY JSON:
{"taxonomy_ids": ["A.1.4"], "tags": ["data-transfer"], "jurisdiction": "EU", "confidence": 0.9, "rationale": "one sentence"}
Rules: 1-3 dotted IDs (deepest stable nodes), 0-5 tags from the controlled vocabulary only, ["Z"] if nothing fits."""


def tag_qa(qa_id: int, question: str, answer: str):
    try:
        cls = _llm_json(QA_TAG_SYSTEM, _taxonomy_block()
                        + "\n\nQ: " + question + "\nA: " + (answer or "")[:1500], max_tokens=300, temperature=0.0)
        ids, tags, jur, conf, _ = _clean_ids_tags_jur(cls)
        admin.table("qa_history").update({"taxonomy_ids": ids}).eq("id", qa_id).execute()
    except Exception:
        pass


@app.get("/api/history")
async def history(request: Request, limit: int = 20):
    prof = await current_user(request)
    rows = admin.table("qa_history").select("*").eq("user_id", prof["id"]) \
        .eq("status", "answered").order("answered_at", desc=True).limit(min(limit, 50)).execute().data or []
    return {"count": len(rows), "entries": rows}


# ---------------- Knowledge Base (approved items, taxonomy-grouped) ----------------

@app.get("/api/kb")
async def kb(request: Request):
    prof = await current_user(request)
    items = admin.table("knowledge_items").select("*, sources(title, url, jurisdiction)") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(200).execute().data or []
    srcs = admin.table("sources").select("id, title, url, instrument, jurisdiction, taxonomy_ids, tags, reviewed_at") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(100).execute().data or []
    for it in items:
        it["taxonomy_labels"] = taxonomy_labels(it.get("taxonomy_ids") or [])
    return {"knowledge_items": items, "sources": srcs,
            "taxonomy_tree": TAXONOMY_NODES}


# ---------------- Sources: propose + list ----------------

SOURCE_CLASSIFY_SYSTEM = """You are the classification engine of a Legal Research Workbench for a data-protection practice.
Classify the external regulatory source per DDP Taxonomy v0.2. Respond with ONLY JSON:
{
  "taxonomy_ids": ["A.1.1"], "tags": ["data-transfer"],
  "instrument_type": "REGULATION", "jurisdiction": "EU", "temporal_status": "IN_FORCE",
  "confidence": 0.9, "rationale": "one or two sentences"
}
Rules: 1-3 dotted IDs deepest stable nodes; tags from controlled vocabulary only; validate/keep user-provided hints; ["Z"] if nothing fits."""


class SourceRequest(BaseModel):
    title: str
    url: Optional[str] = None
    description: Optional[str] = None
    jurisdiction: Optional[str] = None
    instrument_type: Optional[str] = None
    temporal_status: Optional[str] = None


@app.post("/api/sources")
async def propose_source(req: SourceRequest, request: Request):
    prof = await current_user(request)
    title = (req.title or "").strip()[:300]
    if not title:
        raise HTTPException(400, "title required")
    meta = {
        "title": title,
        "url": (req.url or "").strip()[:500] or None,
        "description": (req.description or "").strip()[:2000] or None,
        "jurisdiction_hint": (req.jurisdiction or "").strip().upper()[:10] or None,
        "instrument_hint": (req.instrument_type or "").strip().upper()[:30] or None,
        "temporal_hint": (req.temporal_status or "").strip().upper()[:20] or None,
    }
    try:
        cls = _llm_json(SOURCE_CLASSIFY_SYSTEM, _taxonomy_block()
                        + "\n\nSOURCE (JSON):\n" + json.dumps(meta, ensure_ascii=False), max_tokens=400, temperature=0.0)
    except Exception as e:
        raise HTTPException(502, f"classification failed: {e}")
    ids, tags, jur, conf, rationale = _clean_ids_tags_jur(cls)
    instrument = str(cls.get("instrument_type", meta["instrument_hint"] or "COMMENTARY")).upper()[:30]
    if instrument not in INSTRUMENT_TYPES:
        instrument = "COMMENTARY"
    ins = admin.table("sources").insert({
        "title": title, "url": meta["url"], "source_type": instrument.lower().replace("_", "-"),
        "jurisdiction": jur, "instrument": instrument, "taxonomy_ids": ids, "tags": tags,
        "classification": {"confidence": conf, "rationale": rationale,
                            "temporal_status": str(cls.get("temporal_status", "IN_FORCE")).upper()[:20],
                            "description": meta["description"]},
        "status": "proposed", "proposed_by": prof["id"],
    }).execute()
    row = ins.data[0] if ins.data else None
    return {"source": row, "taxonomy_labels": taxonomy_labels(ids)}


@app.get("/api/sources")
async def list_sources(request: Request):
    prof = await current_user(request)
    if prof.get("role") == "reviewer":
        rows = admin.table("sources").select("*").order("created_at", desc=True).limit(200).execute().data or []
    else:
        a = admin.table("sources").select("*").eq("status", "approved").order("created_at", desc=True).limit(200).execute().data or []
        b = admin.table("sources").select("*").eq("proposed_by", prof["id"]).order("created_at", desc=True).limit(50).execute().data or []
        seen, rows = set(), []
        for r in a + b:
            if r["id"] not in seen:
                seen.add(r["id"])
                rows.append(r)
    for r in rows:
        r["taxonomy_labels"] = taxonomy_labels(r.get("taxonomy_ids") or [])
    return {"count": len(rows), "sources": rows}


@app.get("/api/taxonomy")
async def taxonomy(request: Request):
    await current_user(request)
    return {"nodes": TAXONOMY_NODES, "tags": TAXONOMY_TAGS,
            "instruments": INSTRUMENT_TYPES, "jurisdictions": JURISDICTIONS,
            "temporal": TEMPORAL_STATUSES}


# ---------------- REVIEWER: private review area ----------------

EXTRACT_SYSTEM = """You are the knowledge-extraction engine of a Legal Research Workbench for data-protection lawyers.
From the given source content, extract the most legally significant, durable knowledge items (rules, obligations, deadlines, thresholds, holdings).
Respond with ONLY JSON: {"items": [{"content": "self-contained statement, 1-4 sentences, cites articles where possible", "taxonomy_ids": ["A.1.4"], "tags": ["data-transfer"], "rationale": "why this matters"}]}
Rules: 3-8 items; each self-contained (understandable without the source); dotted IDs from the provided taxonomy; tags from the controlled vocabulary only; skip boilerplate."""


@app.get("/api/review/queue")
async def review_queue(request: Request):
    prof = require_reviewer(await current_user(request))
    sources = admin.table("sources").select("*").in_("status", ["proposed", "approved", "rejected"]) \
        .order("created_at", desc=True).limit(200).execute().data or []
    items = admin.table("knowledge_items").select("*, sources(title)") \
        .eq("status", "pending_review").order("created_at", desc=True).limit(200).execute().data or []
    gaps = admin.table("gap_flags").select("*, qa_history(question)").eq("status", "open") \
        .order("created_at", desc=True).limit(100).execute().data or []
    for r in sources + items:
        r["taxonomy_labels"] = taxonomy_labels(r.get("taxonomy_ids") or [])
    return {"pending_sources": [s for s in sources if s["status"] == "proposed"],
            "sources": sources, "pending_items": items, "gap_flags": gaps}


@app.post("/api/review/extract")
async def review_extract(request: Request):
    """Reviewer action: AI-extract knowledge items from an approved/proposed source into pending_review."""
    prof = require_reviewer(await current_user(request))
    body = await request.json()
    sid = body.get("source_id")
    src = admin.table("sources").select("*").eq("id", sid).execute().data
    if not src:
        raise HTTPException(404, "source not found")
    src = src[0]
    content = (src.get("classification") or {}).get("description") or ""
    url = src.get("url")
    if url and len(content) < 500:
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=True) as hc:
                r = await hc.get(url, headers={"User-Agent": "Mozilla/5.0 (DDP Workbench research)"})
                if r.status_code == 200:
                    import re
                    text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", r.text)
                    text = re.sub(r"<[^>]+>", " ", text)
                    text = re.sub(r"\s+", " ", text)
                    content = (content + " " + text).strip()
        except Exception:
            pass
    if len(content.strip()) < 100:
        raise HTTPException(422, "not enough content to extract from (no usable description or fetchable URL)")
    try:
        out = _llm_json(EXTRACT_SYSTEM, _taxonomy_block()
                        + f"\n\nSOURCE: {src['title']}\n\nCONTENT:\n" + content[:14000],
                        max_tokens=2500, temperature=0.2)
    except Exception as e:
        raise HTTPException(502, f"extraction failed: {e}")
    created = []
    # Idempotency: skip items whose normalized content already exists for this source (double-click/retry protection)
    existing = admin.table("knowledge_items").select("content").eq("source_id", sid).execute().data or []
    norm = lambda s: " ".join(str(s).lower().split())[:2000]
    seen = {norm(e["content"]) for e in existing}
    for it in (out.get("items") or [])[:10]:
        c = str(it.get("content", "")).strip()
        if len(c) < 30 or norm(c) in seen:
            continue
        seen.add(norm(c))
        ids = [str(i).strip() for i in it.get("taxonomy_ids", []) if str(i).strip() in TAXONOMY_NODES][:3] or ["Z"]
        tags = [str(t).strip().lstrip("#") for t in it.get("tags", []) if str(t).strip().lstrip("#") in TAXONOMY_TAGS][:5]
        ins = admin.table("knowledge_items").insert({
            "source_id": sid, "content": c[:2000], "taxonomy_ids": ids, "tags": tags,
            "status": "pending_review", "ai_rationale": str(it.get("rationale", ""))[:300],
        }).execute()
        if ins.data:
            created.append(ins.data[0])
    return {"extracted": len(created), "items": created}


class ReviewAction(BaseModel):
    id: int
    action: str  # approve | revise | reject
    entity: str  # source | knowledge_item | gap_flag
    notes: Optional[str] = None
    updated_content: Optional[str] = None
    updated_title: Optional[str] = None


@app.post("/api/review/action")
async def review_action(req: ReviewAction, request: Request):
    prof = require_reviewer(await current_user(request))
    if req.action not in ("approve", "revise", "reject"):
        raise HTTPException(400, "invalid action")
    table = {"source": "sources", "knowledge_item": "knowledge_items", "gap_flag": "gap_flags"}.get(req.entity)
    if not table:
        raise HTTPException(400, "invalid entity")
    row = admin.table(table).select("*").eq("id", req.id).execute().data
    if not row:
        raise HTTPException(404, "not found")
    before = row[0]
    target_status = {"approve": "approved", "reject": "rejected", "revise": "approved"}[req.action] \
        if table in ("sources", "knowledge_items") else \
        {"approve": "curated", "reject": "dismissed", "revise": "curated"}[req.action]
    # Idempotency: already in target state and no content changes -> no-op, no duplicate review_log
    if before.get("status") == target_status and not (req.notes or req.updated_content or req.updated_title):
        return {"ok": True, "entity": before, "noop": True}
    updates = {"reviewer_notes": (req.notes or "")[:1000] or None}
    if table in ("sources", "knowledge_items"):
        updates["reviewed_at"] = _now()
        updates["status"] = {"approve": "approved", "reject": "rejected",
                             "revise": "approved"}[req.action]
        if req.action == "revise":
            if req.updated_content and table == "knowledge_items":
                updates["content"] = req.updated_content[:3000]
            if req.updated_title and table == "sources":
                updates["title"] = req.updated_title[:300]
    else:  # gap_flag
        updates.pop("reviewer_notes", None)
        updates["status"] = {"approve": "curated", "reject": "dismissed", "revise": "curated"}[req.action]
    admin.table(table).update(updates).eq("id", req.id).execute()
    after = admin.table(table).select("*").eq("id", req.id).execute().data
    admin.table("review_log").insert({
        "reviewer_id": prof["id"], "action": req.action, "entity_type": req.entity,
        "entity_id": req.id, "before_state": before, "after_state": (after or [{}])[0],
        "notes": req.notes,
    }).execute()
    return {"ok": True, "entity": (after or [None])[0]}


@app.post("/api/review/items/create")
async def create_item(request: Request):
    """Reviewer manually adds a knowledge item (goes straight to approved)."""
    prof = require_reviewer(await current_user(request))
    body = await request.json()
    content = str(body.get("content", "")).strip()
    if len(content) < 10:
        raise HTTPException(400, "content too short")
    try:
        cls = _llm_json(QA_TAG_SYSTEM, _taxonomy_block() + "\n\nKNOWLEDGE ITEM:\n" + content[:2000],
                        max_tokens=300, temperature=0.0)
        ids, tags, jur, conf, rationale = _clean_ids_tags_jur(cls)
    except Exception:
        ids, tags, rationale = ["Z"], [], ""
    ins = admin.table("knowledge_items").insert({
        "source_id": body.get("source_id") or None, "content": content[:3000],
        "taxonomy_ids": ids, "tags": tags, "status": "approved",
        "ai_rationale": rationale, "reviewer_notes": "manually curated", "reviewed_at": _now(),
    }).execute()
    return {"item": ins.data[0] if ins.data else None}


@app.get("/api/review/users")
async def list_users(request: Request):
    require_reviewer(await current_user(request))
    rows = admin.table("profiles").select("*").order("created_at", desc=True).limit(200).execute().data or []
    return {"users": rows}


@app.post("/api/review/users/role")
async def set_role(request: Request):
    require_reviewer(await current_user(request))
    body = await request.json()
    email = str(body.get("email", "")).strip().lower()
    role = body.get("role")
    if role not in ("user", "reviewer") or not email:
        raise HTTPException(400, "need email + role(user|reviewer)")
    prof = admin.table("profiles").select("*").ilike("email", email).execute().data
    if not prof:
        raise HTTPException(404, "user has not logged in yet")
    admin.table("profiles").update({"role": role}).eq("id", prof[0]["id"]).execute()
    return {"ok": True, "profile": admin.table("profiles").select("*").eq("id", prof[0]["id"]).execute().data[0]}


# ---------------- static frontend (mount last) ----------------

FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"
if not FRONTEND_DIR.exists():
    FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

class NoCacheStatic(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        ct = resp.headers.get("content-type", "")
        path = request.url.path
        if ("html" in ct or "javascript" in ct or "css" in ct or path in ("/", "/login.html", "/app.html")):
            resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            if "etag" in resp.headers:
                del resp.headers["etag"]
        return resp

app.add_middleware(NoCacheStatic)

if FRONTEND_DIR.exists():
    @app.get("/")
    async def root():
        return RedirectResponse("/login.html", status_code=302)
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
