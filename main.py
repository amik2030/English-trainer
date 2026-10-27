"""
Pocket DDP Workbench — private legal research app backend.
FastAPI; serves the frontend static files + JSON API under /api.
Auth: Supabase magic-link. User access tokens verified via GoTrue /auth/v1/user.
Roles: reviewer (full HITL control) | user (ask + browse approved KB).
"""

from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from contextlib import asynccontextmanager
import asyncio
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlparse
import ipaddress
import socket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from supabase import create_client
import os
import json
import re
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

logger = logging.getLogger("ddp.notice_monitor")
monitor_stop = asyncio.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Lightweight in-process scheduler. DB leases prevent overlapping scans if
    # a web worker restarts while it is fetching a notice.
    task = asyncio.create_task(_monitor_scheduler())
    yield
    monitor_stop.set()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Pocket DDP Workbench", lifespan=lifespan)
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

ASK_SYSTEM = """You are the AI research assistant of a private Legal Research Workbench used by data-protection and employment lawyers.
You answer questions about data protection, privacy, AI governance, employment law and compliance (GDPR, AI Act, FADP, Digital Omnibus, ePrivacy, Schrems II, transfers, breaches, employment contracts, working time, dismissal, employee monitoring, collective bargaining, occupational health & safety, cross-border posting, etc.).

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
    taxonomy_area: Optional[str] = None       # top-level (A/B/C/D) or dotted prefix (A.1, D.4) matched against taxonomy_ids
    origin: Optional[str] = None              # external | internal (classification.origin; default external)
    temporal_status: Optional[str] = None     # IN_FORCE | DRAFT | PROPOSED | REPEALED | SUPERSEDED
    instrument: Optional[str] = None          # REGULATION | GUIDELINES | JUDGMENT | ...
    issuing_body: Optional[str] = None        # free text, substring-matched vs classification.issuing_body + title


class AskRequest(BaseModel):
    question: str
    scope: Optional[AskScope] = None


class ThreadCreate(BaseModel):
    title: Optional[str] = None
    scope: Optional[AskScope] = None


class ThreadChatRequest(BaseModel):
    message: str
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
            "answered_at": _now(), "source": "ask",
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
        .eq("status", "answered").eq("source", "ask") \
        .order("answered_at", desc=True).limit(min(limit, 50)).execute().data or []
    return {"count": len(rows), "entries": rows}


# ---------------- CONVERSATIONAL ASK ----------------

CHAT_SYSTEM = """You are the AI research assistant of a private Legal Research Workbench used by data-protection and employment lawyers, now in CONVERSATION mode.
You answer questions about data protection, privacy, AI governance, employment law and compliance (GDPR, AI Act, FADP, Digital Omnibus, ePrivacy, Schrems II, transfers, breaches, employment contracts, working time, dismissal, employee monitoring, collective bargaining, occupational health & safety, cross-border posting, etc.).

You receive: (1) the CONVERSATION SO FAR, (2) the user's NEW MESSAGE, (3) APPROVED KNOWLEDGE ITEMS (curated by the human reviewer), (4) APPROVED SOURCES register.

Procedure:
1. Treat the conversation as one continuous discussion. Resolve pronouns and follow-ups ("and for Switzerland?", "what about the retention side?") against the earlier turns. Never re-introduce yourself or repeat the prior answer.
2. Compose a direct answer GROUNDED IN the approved knowledge items and sources where they cover the topic; supplement with your own legal knowledge only where the KB is silent. Lead with the answer, then 2-4 supporting points. 100-250 words unless the user asks for depth.
3. Cite instruments/articles exactly (e.g. Art. 6(1)(f) GDPR) and approved source titles exactly.
4. If the user asks something genuinely unrelated to law/compliance, say so briefly and offer the nearest relevant angle.
5. Never fabricate case law or dates; flag uncertainty briefly.

Respond with ONLY a JSON object:
{"answer": str, "followups": [str], "citations": [{"kind": "knowledge_item"|"source", "id": int, "title": str}], "kb_grounded": bool, "confidence": float, "jurisdiction": str, "title": str}
- followups: 2-3 short suggested next questions, or [].
- title: a 2-5 word title for this conversation, derived from the discussion as a whole (used for labelling only)."""


def _kb_context(sc: Optional[AskScope], qa_limit: int = 40):
    """Approved KB + sources (+ prior Q&A) filtered by the active scope."""
    ki_all = admin.table("knowledge_items").select("id, content, source_id, taxonomy_ids, tags") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(60).execute().data or []
    src_all = admin.table("sources").select("id, title, taxonomy_ids, tags, instrument, jurisdiction, classification") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(40).execute().data or []
    src = [x for x in src_all if _source_in_scope(x, sc)]
    if sc is not None:
        in_src_ids = {x["id"] for x in src}
        pref = (sc.taxonomy_area or "").strip().upper()
        ki = [k for k in ki_all
              if k.get("source_id") in in_src_ids
              or (pref and any(str(i).upper() == pref or str(i).upper().startswith(pref + ".")
                               for i in (k.get("taxonomy_ids") or [])))]
    else:
        ki = ki_all
    qa = admin.table("qa_history").select("id, question, answer").eq("status", "answered") \
        .order("answered_at", desc=True).limit(qa_limit).execute().data or []
    return ki, src, qa


def _thread_owned(thread_id: int, prof: dict) -> dict:
    rows = admin.table("chat_threads").select("*").eq("id", thread_id).execute().data or []
    if not rows:
        raise HTTPException(404, "conversation not found")
    if rows[0]["user_id"] != prof["id"] and prof.get("role") != "reviewer":
        raise HTTPException(403, "not your conversation")
    return rows[0]


def _thread_messages(thread_id: int, limit: int = 40) -> list[dict]:
    rows = admin.table("chat_messages").select("*").eq("thread_id", thread_id) \
        .order("created_at", desc=True).limit(min(limit, 60)).execute().data or []
    return list(reversed(rows))


@app.get("/api/threads")
async def list_threads(request: Request, limit: int = 30):
    prof = await current_user(request)
    rows = admin.table("chat_threads").select("id, title, message_count, last_message_at, created_at, scope") \
        .eq("user_id", prof["id"]).order("last_message_at", desc=True).limit(min(limit, 100)).execute().data or []
    return {"count": len(rows), "threads": rows}


@app.post("/api/threads")
async def create_thread(req: ThreadCreate, request: Request):
    prof = await current_user(request)
    row = admin.table("chat_threads").insert({
        "user_id": prof["id"],
        "title": (req.title or "").strip()[:80] or "New conversation",
        "scope": (req.scope.model_dump(exclude_none=True) if req.scope else {}),
        "message_count": 0,
        "last_message_at": _now(),
        "updated_at": _now(),
    }).execute().data[0]
    return {"thread": row}


@app.get("/api/threads/{thread_id}")
async def get_thread(thread_id: int, request: Request):
    prof = await current_user(request)
    thread = _thread_owned(thread_id, prof)
    return {"thread": thread, "messages": _thread_messages(thread_id)}


@app.patch("/api/threads/{thread_id}")
async def rename_thread(thread_id: int, request: Request):
    prof = await current_user(request)
    _thread_owned(thread_id, prof)
    body = await request.json()
    title = str(body.get("title") or "").strip()[:80]
    if not title:
        raise HTTPException(400, "title required")
    out = admin.table("chat_threads").update({"title": title, "updated_at": _now()}) \
        .eq("id", thread_id).execute().data
    return {"thread": (out or [])[0]}


@app.delete("/api/threads/{thread_id}")
async def delete_thread(thread_id: int, request: Request):
    prof = await current_user(request)
    _thread_owned(thread_id, prof)
    admin.table("chat_threads").delete().eq("id", thread_id).execute()
    return {"ok": True}


@app.post("/api/threads/{thread_id}/message")
async def thread_message(thread_id: int, req: ThreadChatRequest, request: Request, background_tasks: BackgroundTasks):
    prof = await current_user(request)
    thread = _thread_owned(thread_id, prof)
    if thread["user_id"] != prof["id"]:
        raise HTTPException(403, "only the owner can post in this conversation")
    msg = (req.message or "").strip()[:1500]
    if not msg:
        raise HTTPException(400, "message required")

    if req.scope is not None:
        sc = req.scope
    elif thread.get("scope"):
        sc = AskScope(**{k: v for k, v in (thread["scope"] or {}).items() if v})
    else:
        sc = None
    history_rows = _thread_messages(thread_id, limit=24)
    ki, src, _qa = _kb_context(sc)

    convo = [{"role": r["role"], "content": r["content"][:1500]} for r in history_rows][-16:]
    prompt = (
        (("\n" + _scope_summary(sc) + "\n\n") if _scope_summary(sc) else "")
        + "CONVERSATION SO FAR:\n" + (json.dumps(convo, ensure_ascii=False) if convo else "[] (this is the first turn)")
        + "\n\nNEW MESSAGE:\n" + msg
        + "\n\nAPPROVED KNOWLEDGE ITEMS:\n" + json.dumps(
            [{"id": k["id"], "content": k["content"][:800], "taxonomy_ids": k.get("taxonomy_ids") or [],
              "source_id": k.get("source_id")} for k in ki], ensure_ascii=False)
        + "\n\nAPPROVED SOURCES:\n" + json.dumps([{"id": x["id"], "title": x["title"]} for x in src], ensure_ascii=False)
    )
    try:
        out = _llm_json(CHAT_SYSTEM, prompt, max_tokens=900)
    except Exception as e:
        raise HTTPException(502, f"answer generation failed: {e}")
    answer = str(out.get("answer", "")).strip()
    if not answer:
        raise HTTPException(502, "empty answer")

    ki_ids = {k["id"] for k in ki}
    src_ids = {x["id"] for x in src}
    cits = []
    for c in (out.get("citations") or [])[:8]:
        kind, cid = c.get("kind"), c.get("id")
        if kind == "knowledge_item" and cid in ki_ids:
            cits.append({"kind": "knowledge_item", "id": cid,
                         "title": ([k for k in ki if k["id"] == cid][0].get("content") or "")[:80]})
        elif kind == "source" and cid in src_ids:
            cits.append({"kind": "source", "id": cid, "title": [x for x in src if x["id"] == cid][0]["title"]})

    try:
        conf = max(0.0, min(1.0, float(out.get("confidence", 0.8))))
    except (TypeError, ValueError):
        conf = 0.8
    jur = str(out.get("jurisdiction", "INTL"))[:10] or "INTL"
    followups = [str(x)[:160] for x in (out.get("followups") or [])[:3]]

    admin.table("chat_messages").insert({
        "thread_id": thread_id, "user_id": prof["id"], "role": "user", "content": msg,
    }).execute()

    # Mirror each turn into qa_history so KB coverage analysis and gap flags keep working.
    qa_ins = admin.table("qa_history").insert({
        "user_id": prof["id"], "question": msg, "answer": answer,
        "citations": cits, "kb_reused": False, "status": "answered",
        "answered_at": _now(), "source": "chat",
    }).execute()
    qa_id = (qa_ins.data or [{}])[0].get("id")

    asst = admin.table("chat_messages").insert({
        "thread_id": thread_id, "user_id": prof["id"], "role": "assistant", "content": answer,
        "citations": cits, "kb_grounded": bool(out.get("kb_grounded")),
        "confidence": conf, "jurisdiction": jur, "qa_id": qa_id,
    }).execute().data[0]

    if (not out.get("kb_grounded")) or conf < 0.55:
        try:
            admin.table("gap_flags").insert({
                "qa_id": qa_id, "question": msg,
                "reason": "low confidence" if conf < 0.55 else "not covered by approved KB",
            }).execute()
        except Exception:
            pass
    if qa_id is not None:
        background_tasks.add_task(tag_qa, qa_id, msg, answer)

    # Title the conversation from its content once, and only while it is still generic.
    new_title = None
    generic = (thread.get("title") or "").strip().lower() in ("", "new conversation", "untitled")
    suggested = str(out.get("title") or "").strip()[:80]
    if generic and suggested:
        candidates = [suggested, msg[:60].strip()]
        for cand in candidates:
            cand = re.sub(r"\s+", " ", cand).strip(" .?!,;:-")
            if 3 <= len(cand) <= 60:
                new_title = cand[0].upper() + cand[1:]
                break

    update = {"last_message_at": _now(), "updated_at": _now(),
              "message_count": int(thread.get("message_count") or 0) + 2}
    if new_title:
        update["title"] = new_title
    if req.scope is not None:
        update["scope"] = req.scope.model_dump(exclude_none=True)
    admin.table("chat_threads").update(update).eq("id", thread_id).execute()

    return {"message": asst, "thread_id": thread_id, "title": new_title or thread["title"],
            "followups": followups, "answer": answer, "citations": cits,
            "confidence": conf, "jurisdiction": jur,
            "kb_counts": {"sources_in_scope": len(src), "items_in_scope": len(ki)}}


# ---------------- Knowledge Base (approved items, taxonomy-grouped) ----------------

@app.get("/api/kb")
async def kb(request: Request):
    prof = await current_user(request)
    items = admin.table("knowledge_items").select("*, sources(title, url, jurisdiction, instrument)") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(400).execute().data or []
    srcs = admin.table("sources").select("id, title, url, instrument, jurisdiction, taxonomy_ids, tags, reviewed_at") \
        .eq("status", "approved").order("reviewed_at", desc=True).limit(100).execute().data or []
    for it in items:
        it["taxonomy_labels"] = taxonomy_labels(it.get("taxonomy_ids") or [])
    return {"knowledge_items": items, "sources": srcs,
            "taxonomy_tree": TAXONOMY_NODES}


# ---------------- Sources: propose + list ----------------

SOURCE_CLASSIFY_SYSTEM = """You are the classification engine of a Legal Research Workbench covering data protection, privacy, AI & digital regulation, information governance and employment law.
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

EXTRACT_SYSTEM = """You are the knowledge-extraction engine of a Legal Research Workbench for data-protection and employment lawyers.
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


# ---------------- PRIVACY NOTICE AUDITOR ----------------
from notice_auditor import audit as audit_notice, ALL_CHECKS
from privacy_monitor import compare_results, result_fingerprint


class AuditRequest(BaseModel):
    url: str
    label: Optional[str] = None
    deep: bool = True  # qualitative LLM pass on top of the deterministic checklist


class MonitorRequest(BaseModel):
    url: str
    label: Optional[str] = None
    notice_url: Optional[str] = None
    interval_hours: int = 168
    qualitative_review: bool = False


class MonitorUpdate(BaseModel):
    label: Optional[str] = None
    notice_url: Optional[str] = None
    interval_hours: Optional[int] = None
    qualitative_review: Optional[bool] = None
    enabled: Optional[bool] = None


class MonitorReviewUpdate(BaseModel):
    status: str  # in_review | resolved | accepted | false_positive
    resolution_note: Optional[str] = None


def _public_http_url(raw: str) -> str:
    """Normalize a public website URL; reject local/private targets for scans."""
    raw = str(raw or "").strip()
    if not raw:
        raise HTTPException(400, "website URL required")
    if not raw.lower().startswith(("http://", "https://")):
        raw = "https://" + raw.lstrip("/")
    try:
        p = urlparse(raw)
        if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
            raise ValueError("invalid URL")
        host = p.hostname.rstrip(".").lower()
        if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError("private/local hostnames are not allowed")
        try:
            addresses = [ipaddress.ip_address(host)]
        except ValueError:
            addresses = [ipaddress.ip_address(x[4][0]) for x in socket.getaddrinfo(host, p.port or (443 if p.scheme == "https" else 80), type=socket.SOCK_STREAM)]
        if not addresses or any(not (ip.is_global) for ip in addresses):
            raise ValueError("website must resolve to a public IP address")
        return p.geturl()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"invalid or non-public website URL: {e}")


def _monitor_owned(monitor_id: int, prof: dict) -> dict:
    rows = admin.table("website_monitors").select("*").eq("id", monitor_id).execute().data or []
    if not rows:
        raise HTTPException(404, "website monitor not found")
    if rows[0]["user_id"] != prof["id"] and prof.get("role") != "reviewer":
        raise HTTPException(403, "not your website monitor")
    return rows[0]


def _safe_latest_scan(monitor_id: int, user_id: str) -> Optional[dict]:
    rows = (admin.table("notice_scans").select("id, monitor_id, status, scores, result, created_at, notice_url, error, scan_trigger")
            .eq("monitor_id", monitor_id).eq("user_id", user_id)
            .order("created_at", desc=True).limit(1).execute().data or [])
    return rows[0] if rows else None


def _monitor_scan_history(monitor_id: int, user_id: str, limit: int = 30) -> list[dict]:
    rows = (admin.table("notice_scans").select("id, result, scores, notice_fingerprint, created_at, status")
            .eq("monitor_id", monitor_id).eq("user_id", user_id)
            .eq("status", "done").order("created_at", desc=True)
            .limit(limit).execute().data or [])
    return [r.get("result") or {} for r in reversed(rows)]


def _review_is_muted(monitor_id: int, user_id: str, key: str) -> bool:
    rows = (admin.table("monitor_reviews").select("id")
            .eq("monitor_id", monitor_id).eq("user_id", user_id)
            .eq("finding_key", key).in_("status", ["accepted", "false_positive"])
            .limit(1).execute().data or [])
    return bool(rows)


def _active_review(monitor_id: int, user_id: str, key: str) -> Optional[dict]:
    rows = (admin.table("monitor_reviews").select("id, status")
            .eq("monitor_id", monitor_id).eq("user_id", user_id)
            .eq("finding_key", key).in_("status", ["pending", "in_review"])
            .limit(1).execute().data or [])
    return rows[0] if rows else None


def _insert_monitor_review(monitor: dict, scan_id: Optional[int], item: dict) -> Optional[dict]:
    key = str(item.get("finding_key") or item.get("kind") or "notice_changed")
    if item.get("kind") in ("notice_changed", "score_drop", "scan_failed", "notice_hub"):
        active = (admin.table("monitor_reviews").select("id")
                  .eq("monitor_id", monitor["id"]).eq("user_id", monitor["user_id"])
                  .eq("finding_key", key).in_("status", ["pending", "in_review"])
                  .limit(1).execute().data or [])
        if active:
            return None
    # Accepted/false-positive findings remain muted; every event class dedupes
    # against an already-open identical item (including scan failures/hub alerts).
    if item.get("kind") not in ("notice_changed", "score_drop", "scan_failed", "notice_hub"):
        if _review_is_muted(monitor["id"], monitor["user_id"], key):
            return None
    if _active_review(monitor["id"], monitor["user_id"], key):
        return None
    row = {
        "user_id": monitor["user_id"],
        "monitor_id": monitor["id"],
        "scan_id": scan_id,
        "finding_key": key,
        "kind": item.get("kind", "new_finding"),
        "severity": item.get("severity", "medium"),
        "title": item.get("title", "Privacy notice needs human review"),
        "detail": item.get("detail", ""),
        "status": item.get("status", "pending"),
    }
    try:
        ins = admin.table("monitor_reviews").insert(row).execute()
        return (ins.data or [None])[0]
    except Exception as e:
        # Concurrent scheduler/manual click can race the partial unique index.
        logger.warning("review insert skipped (likely dedupe race): %s", e)
        return None


async def _perform_monitor_scan(monitor: dict, trigger: str = "scheduled") -> dict:
    """Run one scan, persist its snapshot, diff against the prior snapshot, queue deltas."""
    monitor_id, user_id = monitor["id"], monitor["user_id"]
    previous = _safe_latest_scan(monitor_id, user_id)
    history = _monitor_scan_history(monitor_id, user_id)
    url = monitor.get("notice_url") or monitor["site_url"]
    scan_id = None
    status = "failed"
    try:
        result = await audit_notice(url, llm_json=_llm_json if monitor.get("qualitative_review") else None)
        result["fetched_at"] = _now()
        result["label"] = monitor["label"]
        result["monitor_id"] = monitor_id
        result["trigger"] = trigger
        result["site_url"] = monitor["site_url"]
        is_hub = bool(result.get("is_hub"))
        result["monitor_score_suppressed"] = is_hub
        result["review_changes"] = (
            {"new_findings": [], "recovered": [], "still_failing": [], "ongoing": []}
            if is_hub else compare_results(previous.get("result") if previous else None, result, history[:-1] if history else [])
        )
        result["review_changes"]["new_findings"] = [
            x for x in result["review_changes"]["new_findings"]
            if not _review_is_muted(monitor_id, user_id, x["finding_key"])
            and not _active_review(monitor_id, user_id, x["finding_key"])
        ]
        if is_hub:
            result.setdefault("warnings", []).append("This is a privacy hub/index. Human review is needed to pin the relevant notice before treating the score as meaningful.")
        fingerprint = result.get("notice_fingerprint") or result_fingerprint(result)

        status = "done"
        ins = admin.table("notice_scans").insert({
            "user_id": user_id,
            "monitor_id": monitor_id,
            "label": monitor["label"],
            "site_url": monitor["site_url"],
            "notice_url": result.get("notice_url") or "",
            "status": status,
            "scores": {} if is_hub else (result.get("scores") or {}),
            "result": result,
            "scan_trigger": trigger,
            "notice_fingerprint": fingerprint,
        }).execute()
        scan_id = (ins.data or [{}])[0].get("id")
        created_reviews = []
        ongoing_keys = {x["finding_key"] for x in result["review_changes"].get("ongoing", [])}

        if is_hub:
            review = _insert_monitor_review(monitor, scan_id, {
                "finding_key": "notice_hub", "kind": "notice_hub", "severity": "medium",
                "title": f"{monitor['label']}: discovered a privacy hub, not a single notice",
                "detail": "The fetched page looks like an index to multiple notices. Its checklist score is suppressed to avoid a misleading compliance impression. Pin the applicable notice URL in monitor settings, then scan again.",
            })
            if review:
                created_reviews.append(review)
        else:
            for finding in result["review_changes"]["new_findings"]:
                review = _insert_monitor_review(monitor, scan_id, finding)
                if review:
                    created_reviews.append(review)

        # Once a previously flagged gap is no longer failing, close every open
        # review row for that key, regardless of its original event kind.
        recovered_keys = {x["finding_key"] for x in result["review_changes"]["recovered"]}
        for key in recovered_keys:
            rows = (admin.table("monitor_reviews").select("id")
                    .eq("monitor_id", monitor_id).eq("user_id", user_id)
                    .eq("finding_key", key).in_("status", ["pending", "in_review"])
                    .execute().data or [])
            for row in rows:
                admin.table("monitor_reviews").update({
                    "status": "auto_resolved", "resolved_at": _now(),
                    "resolution_note": "The corresponding check passed on a later scan.",
                    "updated_at": _now(),
                }).eq("id", row["id"]).execute()

        # Automatically close pending items whose checks recovered.
        for item in result["review_changes"]["recovered"]:
            try:
                admin.table("monitor_reviews").insert({
                    "user_id": user_id, "monitor_id": monitor_id, "scan_id": scan_id,
                    "finding_key": "recovered:" + item["finding_key"],
                    "kind": "recovered", "severity": "low",
                    "title": "Recovered: " + item.get("title", item["finding_key"]),
                    "detail": "The check now passes. This recovery is recorded for history only.",
                    "status": "auto_resolved", "resolved_at": _now(),
                }).execute()
            except Exception as e:
                logger.warning("recovery event insert skipped: %s", e)

        # A changed notice warrants review even when the deterministic check
        # vector remains identical. Store the hash, not copied notice text.
        prev_fp = (previous or {}).get("notice_fingerprint")
        if not is_hub and prev_fp and fingerprint and prev_fp != fingerprint:
            review = _insert_monitor_review(monitor, scan_id, {
                "finding_key": "notice_changed",
                "kind": "notice_changed", "severity": "low",
                "title": f"{monitor['label']}: privacy notice text changed",
                "detail": "The fetched notice text changed since the previous scan. Review for substantive changes; boilerplate or page layout changes can also alter this fingerprint.",
            })
            if review:
                created_reviews.append(review)

        old_score = ((previous or {}).get("scores") or {}).get("overall_pct")
        new_score = None if is_hub else (result.get("scores") or {}).get("overall_pct")
        if old_score is not None and new_score is not None and old_score - new_score >= 5:
            review = _insert_monitor_review(monitor, scan_id, {
                "finding_key": f"score_drop:{old_score}:{new_score}",
                "kind": "score_drop", "severity": "medium",
                "title": f"{monitor['label']}: screening score fell {old_score - new_score} points",
                "detail": f"Previous screening score: {old_score}%. Current: {new_score}%. Pattern-based screening only; compare the underlying notice.",
            })
            if review:
                created_reviews.append(review)

        # Persist current monitoring summary and release the scheduler lease.
        update = {
            "last_scan_at": _now(),
            "next_scan_at": (datetime.now(timezone.utc) + timedelta(hours=monitor["interval_hours"])).isoformat(),
            "last_status": "needs_review" if (created_reviews or is_hub) else "done",
            "last_score": new_score,
            "last_grade": None if is_hub else (result.get("scores") or {}).get("overall_grade"),
            "previous_score": old_score,
            "latest_scan_id": scan_id,
            "last_error": None,
            "lease_until": None,
            "updated_at": _now(),
        }
        admin.table("website_monitors").update(update).eq("id", monitor_id).execute()
        result["id"] = scan_id
        result["created_reviews"] = created_reviews
        return result
    except Exception as e:
        logger.exception("monitor scan failed for %s", monitor_id)
        if scan_id is None:
            failed = admin.table("notice_scans").insert({
                "user_id": user_id, "monitor_id": monitor_id, "label": monitor["label"],
                "site_url": monitor["site_url"], "notice_url": monitor.get("notice_url") or "",
                "status": "failed", "error": str(e)[:1000],
                "scores": {}, "result": {"error": str(e), "trigger": trigger},
                "scan_trigger": trigger,
            }).execute()
            scan_id = (failed.data or [{}])[0].get("id")
        _insert_monitor_review(monitor, scan_id, {
            "finding_key": "scan_failed", "kind": "scan_failed", "severity": "high",
            "title": f"{monitor['label']}: scheduled scan failed",
            "detail": str(e)[:1000],
        })
        admin.table("website_monitors").update({
            "last_scan_at": _now(),
            "next_scan_at": (datetime.now(timezone.utc) + timedelta(hours=min(monitor["interval_hours"], 24))).isoformat(),
            "last_status": "failed", "last_error": str(e)[:1000],
            "lease_until": None, "updated_at": _now(),
        }).eq("id", monitor_id).execute()
        raise


async def _monitor_scheduler():
    """Claim and scan a small due batch periodically while the web process is up."""
    while not monitor_stop.is_set():
        try:
            claimed = admin.rpc("claim_due_website_monitors", {"p_limit": 3}).execute().data or []
            for monitor in claimed:
                try:
                    await _perform_monitor_scan(monitor, "scheduled")
                except Exception:
                    # Scan failure is persisted; continue servicing other monitors.
                    pass
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("website monitor scheduler pass failed")
        try:
            await asyncio.wait_for(monitor_stop.wait(), timeout=60)
        except asyncio.TimeoutError:
            pass


@app.get("/api/auditor/checks")
async def auditor_checks(request: Request):
    await current_user(request)
    return {"checks": [{"id": c.id, "domain": c.domain, "ref": c.ref, "title": c.title}
                       for c in ALL_CHECKS]}


@app.post("/api/auditor/scan")
async def auditor_scan(req: AuditRequest, request: Request):
    prof = await current_user(request)
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(400, "url required")
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url.lstrip("/")
    try:
        result = await audit_notice(url, llm_json=_llm_json if req.deep else None)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(502, f"audit failed: {e}")

    result["fetched_at"] = _now()
    result["label"] = (req.label or "").strip()[:200] or None
    result["trigger"] = "manual"
    result["monitor_id"] = None
    result["review_changes"] = {"new_findings": [], "recovered": [], "still_failing": [], "ongoing": []}
    ins = admin.table("notice_scans").insert({
        "user_id": prof["id"],
        "label": result["label"],
        "site_url": url,
        "notice_url": result.get("notice_url"),
        "status": "done",
        "scores": result.get("scores") or {},
        "result": result,
        "scan_trigger": "manual",
        "notice_fingerprint": result.get("notice_fingerprint"),
    }).execute()
    return {"id": (ins.data or [{}])[0].get("id"), **result}


@app.get("/api/auditor/scans")
async def auditor_scans(request: Request, limit: int = 30):
    prof = await current_user(request)
    q = admin.table("notice_scans").select("id, label, site_url, notice_url, status, scores, created_at")
    if prof.get("role") != "reviewer":
        q = q.eq("user_id", prof["id"])
    rows = q.order("created_at", desc=True).limit(min(limit, 100)).execute().data or []
    return {"count": len(rows), "scans": rows}


@app.get("/api/auditor/scans/{scan_id}")
async def auditor_scan_get(scan_id: int, request: Request):
    prof = await current_user(request)
    rows = admin.table("notice_scans").select("*").eq("id", scan_id).execute().data or []
    if not rows:
        raise HTTPException(404, "scan not found")
    if rows[0]["user_id"] != prof["id"] and prof.get("role") != "reviewer":
        raise HTTPException(403, "not your scan")
    return rows[0]


@app.delete("/api/auditor/scans/{scan_id}")
async def auditor_scan_delete(scan_id: int, request: Request):
    prof = await current_user(request)
    rows = admin.table("notice_scans").select("id, user_id").eq("id", scan_id).execute().data or []
    if not rows:
        raise HTTPException(404, "scan not found")
    if rows[0]["user_id"] != prof["id"] and prof.get("role") != "reviewer":
        raise HTTPException(403, "not your scan")
    admin.table("notice_scans").delete().eq("id", scan_id).execute()
    return {"ok": True}


@app.get("/api/auditor/monitors")
async def auditor_monitors(request: Request):
    prof = await current_user(request)
    q = admin.table("website_monitors").select("*")
    q = q.eq("user_id", prof["id"])
    monitors = q.order("created_at", desc=True).limit(200).execute().data or []
    if not monitors:
        return {"monitors": [], "reviews": [], "totals": {"sites": 0, "pending": 0, "avg_score": None}}
    ids = [m["id"] for m in monitors]
    scans = (admin.table("notice_scans").select("id, monitor_id, status, scores, created_at, notice_url, scan_trigger")
             .in_("monitor_id", ids).order("created_at", desc=True).limit(min(1000, len(ids) * 30)).execute().data or [])
    by_monitor = {}
    for scan in scans:
        by_monitor.setdefault(scan["monitor_id"], []).append(scan)
    reviews = (admin.table("monitor_reviews").select("*").eq("user_id", prof["id"]).in_("monitor_id", ids)
               .eq("status", "pending").order("created_at", desc=True).limit(500).execute().data or [])
    pending_by_monitor = {}
    for review in reviews:
        pending_by_monitor[review["monitor_id"]] = pending_by_monitor.get(review["monitor_id"], 0) + 1
    for m in monitors:
        history = by_monitor.get(m["id"], [])
        m["history"] = list(reversed(history[:30]))
        m["pending_reviews"] = pending_by_monitor.get(m["id"], 0)
        m["latest_scan"] = history[0] if history else None
    scores = [m["last_score"] for m in monitors if m.get("last_score") is not None]
    return {
        "monitors": monitors,
        "reviews": reviews,
        "totals": {
            "sites": len(monitors), "pending": len(reviews),
            "high_pending": sum(1 for r in reviews if r.get("severity") == "high"),
            "avg_score": round(sum(scores) / len(scores)) if scores else None,
        },
    }


@app.post("/api/auditor/monitors")
async def auditor_monitor_create(req: MonitorRequest, request: Request):
    prof = await current_user(request)
    site_url = _public_http_url(req.url)
    if req.notice_url:
        notice_url = _public_http_url(req.notice_url)
    else:
        notice_url = None
    interval = int(req.interval_hours)
    if interval < 6 or interval > 8760:
        raise HTTPException(400, "interval_hours must be from 6 (minimum) to 8760 (yearly)")
    label = (req.label or "").strip()[:200] or (urlparse(site_url).hostname or site_url)
    existing = (admin.table("website_monitors").select("id")
                .eq("user_id", prof["id"]).eq("site_url", site_url).execute().data or [])
    values = {
        "label": label, "notice_url": notice_url, "interval_hours": interval,
        "qualitative_review": bool(req.qualitative_review),
            "enabled": True, "next_scan_at": _now(), "updated_at": _now(),
            "last_status": "scheduled", "last_error": None,
    }
    if existing:
        row = admin.table("website_monitors").update(values).eq("id", existing[0]["id"]).execute().data[0]
        return {"monitor": row, "existing": True}
    values.update({"user_id": prof["id"], "site_url": site_url, "last_status": "scheduled"})
    row = admin.table("website_monitors").insert(values).execute().data[0]
    return {"monitor": row, "existing": False}


@app.post("/api/auditor/monitors/{monitor_id}/notice-url")
async def auditor_monitor_set_notice_url(monitor_id: int, request: Request):
    """Pin the canonical notice URL discovered from an existing audit result."""
    prof = await current_user(request)
    monitor = _monitor_owned(monitor_id, prof)
    body = await request.json()
    raw = str(body.get("notice_url") or "").strip()
    if not raw:
        raise HTTPException(400, "notice_url required")
    notice_url = _public_http_url(raw)
    out = admin.table("website_monitors").update({
        "notice_url": notice_url, "next_scan_at": _now(), "updated_at": _now(),
    }).eq("id", monitor_id).execute().data
    return {"monitor": (out or [monitor])[0]}


@app.post("/api/auditor/monitors/{monitor_id}/scan-lock")
async def auditor_monitor_scan_lock(monitor_id: int, request: Request):
    """Acquire a short DB-backed lock for a user-triggered scan."""
    prof = await current_user(request)
    monitor = _monitor_owned(monitor_id, prof)
    now = _now()
    lease = (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    out = (admin.table("website_monitors").update({"lease_until": lease, "updated_at": now})
           .eq("id", monitor_id).eq("enabled", True)
           .or_(f"lease_until.is.null,lease_until.lt.{now}")
           .execute().data or [])
    if not out:
        raise HTTPException(409, "a scan is already running or this monitor is paused")
    return {"monitor": out[0]}


@app.patch("/api/auditor/monitors/{monitor_id}")
async def auditor_monitor_update(monitor_id: int, req: MonitorUpdate, request: Request):
    prof = await current_user(request)
    monitor = _monitor_owned(monitor_id, prof)
    updates = {"updated_at": _now()}
    if req.label is not None:
        label = req.label.strip()[:200]
        if not label:
            raise HTTPException(400, "label cannot be empty")
        updates["label"] = label
    if req.notice_url is not None:
        updates["notice_url"] = _public_http_url(req.notice_url) if req.notice_url.strip() else None
        updates["next_scan_at"] = _now()
    if req.interval_hours is not None:
        if req.interval_hours < 6 or req.interval_hours > 8760:
            raise HTTPException(400, "interval_hours must be from 6 to 8760")
        updates["interval_hours"] = req.interval_hours
        updates["next_scan_at"] = _now()
    if req.qualitative_review is not None:
        updates["qualitative_review"] = req.qualitative_review
    if req.enabled is not None:
        updates["enabled"] = req.enabled
        if req.enabled:
            updates["next_scan_at"] = _now()
    row = admin.table("website_monitors").update(updates).eq("id", monitor_id).execute().data
    return {"monitor": (row or [monitor])[0]}


@app.delete("/api/auditor/monitors/{monitor_id}")
async def auditor_monitor_delete(monitor_id: int, request: Request):
    prof = await current_user(request)
    _monitor_owned(monitor_id, prof)
    admin.table("website_monitors").delete().eq("id", monitor_id).execute()
    return {"ok": True}


@app.post("/api/auditor/monitors/{monitor_id}/scan")
async def auditor_monitor_scan(monitor_id: int, request: Request):
    prof = await current_user(request)
    monitor = _monitor_owned(monitor_id, prof)
    if not monitor.get("lease_until") or monitor["lease_until"] <= _now():
        raise HTTPException(409, "acquire a scan lock before running the scan")
    try:
        result = await _perform_monitor_scan(monitor, "manual_monitor")
        return result
    except Exception as e:
        raise HTTPException(502, f"monitor scan failed: {e}")


@app.get("/api/auditor/monitor-reviews")
async def auditor_monitor_reviews(request: Request, status: str = "pending", limit: int = 200):
    prof = await current_user(request)
    allowed = {"pending", "in_review", "resolved", "accepted", "false_positive", "auto_resolved"}
    if status not in allowed:
        raise HTTPException(400, "invalid review status")
    q = admin.table("monitor_reviews").select("*").eq("status", status)
    if prof.get("role") != "reviewer":
        q = q.eq("user_id", prof["id"])
    rows = q.order("created_at", desc=True).limit(min(max(limit, 1), 500)).execute().data or []
    return {"reviews": rows}


@app.patch("/api/auditor/monitor-reviews/{review_id}")
async def auditor_monitor_review_update(review_id: int, req: MonitorReviewUpdate, request: Request):
    prof = await current_user(request)
    if req.status not in ("in_review", "resolved", "accepted", "false_positive"):
        raise HTTPException(400, "status must be in_review|resolved|accepted|false_positive")
    rows = admin.table("monitor_reviews").select("*").eq("id", review_id).execute().data or []
    if not rows:
        raise HTTPException(404, "monitor review not found")
    review = rows[0]
    if review["user_id"] != prof["id"] and prof.get("role") != "reviewer":
        raise HTTPException(403, "not your review item")
    update = {
        "status": req.status,
        "resolution_note": (req.resolution_note or "").strip()[:1000] or None,
        "updated_at": _now(),
        "resolved_at": None if req.status == "in_review" else _now(),
    }
    out = admin.table("monitor_reviews").update(update).eq("id", review_id).execute().data
    return {"review": (out or [review])[0]}


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
