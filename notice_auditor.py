"""
Privacy Notice Auditor — rule-based GDPR / ePrivacy transparency scanner.

Fetches a privacy notice (auto-discovering it from a site homepage), extracts the
text, runs ~20 deterministic checks mapped to GDPR Art. 13/14 and ePrivacy Art. 5(3)
/ Art. 6, and scores them. Optional LLM review adds qualitative findings that
pattern matching cannot catch (vague wording, contradictory statements, missing
specifics). All findings are advisory — the reviewer decides what matters.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

UA = "Mozilla/5.0 (compatible; DDPPrivacyNoticeAuditor/1.0; +https://ddp-workbench.onrender.com)"
MAX_BYTES = 3_000_000
TIMEOUT = 25.0

PRIVACY_LINK_PATTERNS = [
    r'href=["\']([^"\']*(?:privacy[-_ ]?(?:statement|notice|policy)|data[-_ ]?protection|datenschutz|protection[-_ ]?des[-_ ]?donnees|informativa[-_ ]?privacy)[^"\']*)["\']',
    r'href=["\']([^"\']*(?:/privacy|/legal/privacy|/en/privacy|/privacy-policy|/datenschutz|/privacy-center)[^"\']*)["\']',
]

# ─────────────────────────── fetch + extract ───────────────────────────


def html_to_text(html: str) -> str:
    html = re.sub(r"(?is)<script.*?</script>", " ", html)
    html = re.sub(r"(?is)<style.*?</style>", " ", html)
    html = re.sub(r"(?is)<nav.*?</nav>", " ", html)
    html = re.sub(r"(?is)<header.*?</header>", " ", html)
    html = re.sub(r"(?is)<footer.*?</footer>", " ", html)
    html = re.sub(r"(?s)<!--.*?-->", " ", html)
    html = re.sub(r"(?s)<[^>]+>", " ", html)
    entities = {
        "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
        "&#39;": "'", "&apos;": "'", "&mdash;": "—", "&ndash;": "–", "&hellip;": "…",
        "&auml;": "ä", "&ouml;": "ö", "&uuml;": "ü", "&szlig;": "ß", "&eacute;": "é",
    }
    for k, v in entities.items():
        html = html.replace(k, v)
    html = re.sub(r"&#(\d+);", lambda m: chr(int(m.group(1))) if int(m.group(1)) < 0x10000 else " ", html)
    # Collapse ALL whitespace runs (including newlines) to a single space. Sites that wrap
    # every word in a <span> otherwise produce "data\nprotection\nofficer", which silently
    # breaks every multi-word compliance pattern.
    text = re.sub(r"[\s\u00a0]+", " ", html).strip()
    # Re-introduce paragraph breaks only where sentence punctuation ends, so evidence
    # snippets stay readable without the newline noise coming back.
    text = re.sub(r"(?<=[.!?])\s{2,}", "\n", text)
    return text


async def fetch(url: str, client: httpx.AsyncClient) -> tuple[str, str]:
    """Return (final_url, text). Follows redirects; rejects non-HTML."""
    r = await client.get(url, headers={"User-Agent": UA, "Accept-Language": "en,de;q=0.8,fr;q=0.6"})
    r.raise_for_status()
    ctype = r.headers.get("content-type", "")
    if "html" not in ctype and "text" not in ctype:
        raise ValueError(f"not an HTML page ({ctype or 'unknown type'})")
    body = r.text[:MAX_BYTES]
    return str(r.url), body


def common_paths(base_url: str) -> list[str]:
    p = urlparse(base_url)
    root = f"{p.scheme}://{p.netloc}"
    paths = [
        "/privacy", "/privacy-policy", "/privacy-notice", "/privacy-statement",
        "/en/privacy", "/en/privacy-policy", "/en/privacy-statement", "/legal/privacy",
        "/datenschutz", "/en/data-protection", "/data-protection", "/legal/privacy-policy",
    ]
    return [root + x for x in paths]


def discover_notice_url(home_html: str, base_url: str) -> Optional[str]:
    candidates: dict[str, int] = {}
    for pat in PRIVACY_LINK_PATTERNS:
        for m in re.finditer(pat, home_html, re.I):
            href = m.group(1).strip()
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            try:
                absu = urljoin(base_url, href)
            except Exception:
                continue
            if urlparse(absu).scheme not in ("http", "https"):
                continue
            low = absu.lower()
            score = 0
            if re.search(r"statement|notice|policy", low):
                score += 10
            if re.search(r"privacy[-_]?(statement|notice|policy)", low):
                score += 8
            if "/en/" in low or low.rstrip("/").endswith("privacy"):
                score += 2
            path_parts = [p for p in urlparse(low).path.split("/") if p]
            if len(path_parts) <= 1:
                score -= 3
            candidates[absu] = max(candidates.get(absu, -99), score)
    if not candidates:
        return None
    return max(candidates.items(), key=lambda kv: kv[1])[0]


# ─────────────────────────── checks ───────────────────────────

@dataclass
class Check:
    id: str
    domain: str          # GDPR | ePrivacy | Swiss FADP
    ref: str             # Art. 13(1)(a)
    title: str
    weight: int = 1
    passed: bool = False
    detail: str = ""
    evidence: str = ""
    patterns: list[str] = field(default_factory=list)
    min_hits: int = 1


def _hit(text: str, patterns: list[str]) -> tuple[bool, int, str]:
    """Return (any, count, first evidence snippet)."""
    hits = []
    for p in patterns:
        for m in re.finditer(p, text, re.I):
            s = max(0, m.start() - 90)
            hits.append(text[s:m.end() + 90].strip())
            break
    return (len(hits) > 0, len(hits), hits[0] if hits else "")


GDPR_CHECKS = [
    Check("controller", "GDPR", "Art. 13(1)(a)", "Identity of the controller disclosed",
          patterns=[r"\b(?:data\s+)?controller\b", r"\bwe\s+(?:are|act\s+as)\s+(?:the\s+)?(?:data\s+)?controller\b",
                    r"responsible\s+(?:party|body|entity)",
                    r"\bresponsible\s+for\s+(?:the\s+)?(?:process\w*|your\s+(?:personal\s+)?data|personal\s+data)",
                    r"\b(?:is|are)\s+responsible\s+for\s+process"]),
    Check("dpo", "GDPR", "Art. 13(1)(b)", "DPO / privacy contact provided",
          patterns=[r"data\s+protection\s+officer", r"\bDPO\b", r"privacy\s+(?:officer|team|office|contact|desk|mailbox)",
                    r"data\s+protection\s+(?:advisor|contact|representative|authority\s+contact)",
                    r"[\w.+-]*privacy[\w.+-]*@[\w.-]+\.[a-z]{2,}"]),
    Check("contact", "GDPR", "Art. 13(1)(a)", "Controller contact details provided",
          patterns=[r"(?:e-?mail|mail)\s*[:\-]?\s*[\w.+-]+@[\w.-]+\.[a-z]{2,}",
                    r"[\w.+-]+@[\w.-]+\.[a-z]{2,}",
                    r"(?:phone|tel|telephone)\s*[:\-]?\s*\+?[\d\s()\-]{7,}",
                    r"(?:registered\s+)?(?:address|seat|office)\s*[:\-]",
                    r"\bby\s+post\b", r"\bin\s+writing\s+to\b",
                    r"\b\d{4,5}\s+[A-ZÄÖÜ][\wäöüß.\-]+"]),
    Check("purposes", "GDPR", "Art. 13(1)(c)", "Purposes of processing stated",
          patterns=[r"purpose[s]?\s+(?:of|for)\s+(?:the\s+)?process", r"we\s+(?:collect|use|process|store)\s+.{0,60}(?:to|for|in\s+order)",
                    r"personal\s+data\s+(?:is|are|will\s+be|may\s+be)\s+(?:used|processed|collected)",
                    r"how\s+we\s+use\s+(?:your\s+)?(?:personal\s+)?data"]),
    Check("legal_basis", "GDPR", "Art. 13(1)(c)", "Legal basis for each purpose stated",
          patterns=[r"legal\s+basis", r"lawful\s+basis", r"lawful\s+ground", r"article\s+6", r"art\.?\s*6\s*\(?1\)?\s*\(?[a-f]",
                    r"legitimate\s+interest", r"contract(?:ual)?\s+(?:obligation|performance|necessity)",
                    r"legal\s+obligation", r"vital\s+interest", r"public\s+(?:interest|task)", r"consent"]),
    Check("recipients", "GDPR", "Art. 13(1)(e)", "Recipients or categories of recipients disclosed",
          patterns=[r"recipient", r"third\s+part(?:y|ies)", r"service\s+provider", r"processor",
                    r"share\s+.{0,40}\s+with", r"disclos", r"onward\s+transfer"]),
    Check("transfers", "GDPR", "Art. 13(1)(f)", "International transfers + safeguards addressed",
          patterns=[r"international\s+transfer", r"transfer\s+.{0,60}(?:outside|third\s+countr)",
                    r"outside\s+the\s+(?:EEA|EU|European\s+Economic\s+Area)",
                    r"standard\s+contractual\s+clauses?", r"\bSCCs?\b", r"adequacy\s+(?:decision|finding)",
                    r"binding\s+corporate\s+rules?", r"\bBCRs?\b", r"data\s+privacy\s+framework"]),
    Check("retention", "GDPR", "Art. 13(2)(a)", "Retention periods (or criteria) specified",
          patterns=[r"retention\s+(?:period|policy)", r"how\s+long\s+.{0,40}(?:store|keep|retain|process)",
                    r"(?:store|keep|retain|process).{0,60}for\s+(?:a\s+period|up\s+to|at\s+least|\d+\s+(?:year|month|day|week))",
                    r"storage\s+(?:period|duration|limit)", r"(?:deleted|erased|removed)\s+.{0,40}(?:after|when|once)"]),
    Check("rights", "GDPR", "Art. 13(2)(b)/15-22", "Data subject rights explained",
          weight=2, min_hits=3,
          patterns=[r"right\s+of\s+access", r"right\s+to\s+(?:rectification|correction|correct)",
                    r"right\s+to\s+access", r"\baccess\s+to\b.{0,40}\byour\s+(?:personal\s+)?(?:data|information)",
                    r"\bdeletion\s+of\b.{0,40}\byour\s+(?:personal\s+)?(?:data|information)",
                    r"\b(?:rectification|correction)\b.{0,40}\byour\s+(?:personal\s+)?(?:data|information)",
                    r"right\s+to\s+erasure", r"right\s+to\s+be\s+forgotten", r"right\s+(?:of|to)\s+(?:restriction|limitation)",
                    r"right\s+to\s+data\s+portability", r"right\s+to\s+object", r"right\s+to\s+(?:withdraw|revoke)\s+(?:your\s+)?consent",
                    r"right\s+not\s+to\s+be\s+subject\s+to\s+(?:a\s+)?(?:decision\s+based\s+solely\s+on\s+)?automated",
                    r"right\s+to\s+(?:lodge|file)\s+a\s+complaint", r"your\s+rights"]),
    Check("complain", "GDPR", "Art. 13(2)(d)", "Right to lodge a complaint with a supervisory authority",
          patterns=[r"supervisory\s+authorit", r"data\s+protection\s+authorit", r"competent\s+authorit",
                    r"(?:lodge|file)\s+a\s+complaint", r"right\s+to\s+complain", r"regulatory\s+authorit",
                    r"information\s+commissioner", r"\bcommissioner\b",
                    r"\bFDPIC\b", r"\bEDPB\b"]),
    Check("obligation", "GDPR", "Art. 13(2)(e)", "Whether provision of data is required + consequences",
          patterns=[r"(?:statutory|legal|regulatory)\s+(?:requirement|obligation|duty)",
                    r"(?:contractual|contract)\s+(?:requirement|obligation|necessar)",
                    r"(?:are|is)\s+(?:you\s+)?(?:obliged|required)\s+to\s+(?:provide|give|supply)",
                    r"consequences\s+of\s+(?:not\s+)?(?:providing|supplying|giving|failing)"]),
    Check("automated", "GDPR", "Art. 13(2)(f)/22", "Automated decision-making / profiling addressed",
          patterns=[r"automated\s+(?:decision|individual\s+decision)", r"profiling",
                    r"solely\s+(?:by\s+)?automated\s+means", r"article\s+22", r"art\.?\s*22\b",
                    r"(?:logic|significance|envisaged\s+consequences)\s+involved"]),
    Check("children", "GDPR", "Art. 8 / 13", "Children's data / age limits addressed",
          patterns=[r"child(?:ren)?(?:'s)?\s+(?:data|personal\s+data|privacy)", r"under\s+(?:the\s+age\s+of\s+)?(?:13|16|18)\s+years",
                    r"\bchild(?:ren)?\b",
                    r"\b(?:at\s+least|aged?|minimum\s+age\s+of)\s+(?:1[3-8])\b",
                    r"parental\s+(?:consent|responsibility)", r"age\s+(?:of\s+)?(?:consent|majority|limit)", r"\bminors?\b"]),
    Check("updates", "GDPR", "Art. 12(1)/13(3)", "Notice version / change-notification practice described",
          patterns=[r"(?:last|date\s+of)\s+(?:updated|modified|revised|reviewed)", r"we\s+(?:may|will)\s+(?:update|amend|change)\s+this\s+(?:privacy|notice|policy)",
                    r"version\s+(?:number|\d)", r"effective\s+(?:date|as\s+of)",
                    r"\bupdated\b.{0,60}\b(?:19|20)\d{2}\b", r"(?:19|20)\d{2}\b.{0,40}\bupdated\b",
                    r"updated\s+to\s+reflect"]),
]

EPRIVACY_CHECKS = [
    Check("cookies", "ePrivacy", "Art. 5(3)", "Cookies / tracking technologies disclosed",
          patterns=[r"cookie", r"tracking\s+(?:technolog|tool|pixel)", r"web\s+(?:beacon|bug|pixel)",
                    r"local\s+storage", r"pixel\s+tag", r"fingerprint"]),
    Check("cookie_cats", "ePrivacy", "Art. 5(3)", "Cookie categories / purposes explained",
          patterns=[r"(?:strictly\s+)?necessary\s+cookies?", r"(?:essential|functional)\s+cookies?",
                    r"(?:analytics?|performance|statistic\w*)\s+cookies?", r"(?:marketing|advertising|targeting)\s+cookies?",
                    r"(?:social\s+media|third[- ]party)\s+cookies?", r"cookie\s+(?:categor|type|purpose)"]),
    Check("cookie_consent", "ePrivacy", "Art. 5(3)", "Consent mechanism for non-essential cookies referenced",
          patterns=[r"cookie\s+consent", r"consent\s+.{0,40}cookies?", r"(?:accept|reject|manage|configure)\s+(?:all\s+)?cookies?",
                    r"cookie\s+(?:banner|notice|pop-?up|preferences|settings|manager)", r"opt[- ]?(?:in|out)"]),
    Check("withdraw", "ePrivacy", "Art. 7(3) GDPR / 5(3)", "Consent withdrawal / preference change described",
          patterns=[r"withdraw\s+.{0,20}consent", r"revoke\s+.{0,20}consent",
                    r"change\s+.{0,20}cookie\s+(?:preferences|settings)", r"manage\s+.{0,20}(?:cookie|tracking)\s+(?:preferences|settings)",
                    r"browser\s+settings", r"unsubscribe"]),
    Check("emarketing", "ePrivacy", "Art. 6 / 13", "Electronic marketing communications addressed",
          patterns=[r"electronic\s+(?:communication|marketing)", r"(?:e-?mail|newsletter)\s+(?:marketing|communication)",
                    r"direct\s+marketing", r"newsletter", r"push\s+notification", r"\bSMS\b", r"(?:soft|hard)\s+opt",
                    r"\bfor\s+marketing\b", r"marketing\s+(?:activities|purposes|communications|materials?|messages?)",
                    r"\bopt[- ]?out\b", r"\bunsubscrib"]),
]

SWISS_CHECKS = [
    Check("fadp_controller", "Swiss FADP", "Art. 19 FADP", "Swiss-law controller / representative identified",
          patterns=[r"\bFADP\b", r"Federal\s+Act\s+on\s+Data\s+Protection", r"\bDSG\b", r"\bLPD\b",
                    r"Swiss\s+(?:data\s+protection|representative)", r"FDPIC"]),
    Check("fadp_rights", "Swiss FADP", "Art. 25-28 FADP", "FADP rights (access, correction, deletion, objection)",
          patterns=[r"right\s+(?:to|of)\s+(?:information|access)", r"right\s+to\s+(?:correction|rectification|deletion|erasure)",
                    r"right\s+to\s+object", r"data\s+portability"]),
]

ALL_CHECKS = GDPR_CHECKS + EPRIVACY_CHECKS + SWISS_CHECKS


def run_checks(text: str) -> tuple[list[dict], dict]:
    results = []
    for c in ALL_CHECKS:
        ok, count, ev = _hit(text, c.patterns)
        passed = count >= c.min_hits if c.min_hits > 1 else ok
        results.append({
            "id": c.id, "domain": c.domain, "ref": c.ref, "title": c.title,
            "weight": c.weight, "passed": passed,
            "hits": count,
            "detail": (f"{count} matching signals" if passed else "no matching language found"),
            "evidence": re.sub(r"\s+", " ", ev)[:300],
        })
    return results, score(results)


def score(results: list[dict]) -> dict:
    """Score per domain. Swiss FADP is advisory only (excluded from the headline grade)
    because it applies only to notices that target Swiss data subjects."""
    by_domain: dict[str, dict] = {}
    for r in results:
        d = by_domain.setdefault(r["domain"], {"passed": 0, "total": 0, "weight_passed": 0, "weight_total": 0})
        d["total"] += 1
        d["weight_total"] += r["weight"]
        if r["passed"]:
            d["passed"] += 1
            d["weight_passed"] += r["weight"]

    def pct(p, t):
        return round(100 * p / t) if t else 0

    for name, d in by_domain.items():
        d["pct"] = pct(d["weight_passed"], d["weight_total"])
        d["grade"] = grade_for(d["pct"])
        d["advisory"] = name == "Swiss FADP"

    graded = [d for n, d in by_domain.items() if not d["advisory"]]
    overall = pct(sum(d["weight_passed"] for d in graded), sum(d["weight_total"] for d in graded))
    return {
        "overall_pct": overall,
        "overall_grade": grade_for(overall),
        "domains": by_domain,
        "failed": [{"id": r["id"], "domain": r["domain"], "ref": r["ref"], "title": r["title"]}
                   for r in results if not r["passed"]],
        "passed_count": sum(1 for r in results if r["passed"]),
        "total_count": len(results),
    }


def grade_for(p: int) -> str:
    return "A" if p >= 90 else "B" if p >= 75 else "C" if p >= 60 else "D" if p >= 40 else "F"


# ─────────────────────────── LLM review (optional) ───────────────────────────

QUAL_SYSTEM = """You are a senior data-protection reviewer auditing a privacy notice for a legal workbench.
You receive the notice text plus the results of a deterministic checklist that has ALREADY been scored.

Rules:
1. Do NOT restate checklist findings. The user already sees them. Only add value the checklist cannot.
2. Exception: if a checklist check is marked FAILED but the notice actually satisfies it in wording the
   patterns missed, report it with issue starting exactly "FALSE POSITIVE" and name the check.
3. Only assess the jurisdictions actually relevant to this notice. If the notice does not target
   Swiss data subjects, do not raise Swiss FADP findings.
4. Quote VERBATIM from the notice, max 25 words, and only text that actually appears in the excerpt.
   If you cannot quote it, do not claim it.
5. Focus on: vagueness that fails Art. 12(1) clarity, internal contradictions, outdated framework
   references (Safe Harbor, Privacy Shield, pre-GDPR wording, wrong supervisory authority),
   missing specifics a DPA would challenge (retention criteria, transfer mechanism, named DPO),
   and jurisdiction mismatches (EU-facing site with US-only disclosures).

Respond with ONLY JSON:
{"jurisdiction_guess":"EU|CH|UK|US|INTL","plain_language_score":0-10,"summary":"2-3 sentences",
 "findings":[{"severity":"high|medium|low","ref":"Art. 13(1)(f)","issue":"what is wrong","quote":"short verbatim quote","fix":"how to fix it"}],
 "positive":["up to 3 things done well"]}
Max 8 findings, ordered by severity.
The prompt tells you SEGMENT INFO: how much of the notice you are seeing. Only mention truncation in the
summary if SEGMENT INFO explicitly says the text was truncated. If it says you are seeing the complete
notice, do NOT describe the notice as truncated, partial, or cut off."""


LLM_TEXT_LIMIT = 60000  # ~15k tokens; comfortable within gpt-4o-mini's 128k context


def build_llm_prompt(notice_text: str, checklist: list[dict], site: str) -> str:
    compact = [{"ref": c["ref"], "check": c["title"], "passed": c["passed"]} for c in checklist]
    total = len(notice_text)
    if total <= LLM_TEXT_LIMIT:
        segment = (f"SEGMENT INFO: the COMPLETE notice is included below ({total} characters). "
                   f"Nothing was truncated.")
        excerpt = notice_text
    else:
        head = int(LLM_TEXT_LIMIT * 0.6)
        tail = LLM_TEXT_LIMIT - head
        segment = (f"SEGMENT INFO: the notice is {total} characters. You are seeing the first {head} "
                   f"characters and the final {tail} characters, with a gap in the middle. "
                   f"This IS truncated — say so in the summary.")
        excerpt = (notice_text[:head]
                   + f"\n\n[... {total - LLM_TEXT_LIMIT} characters omitted from the middle ...]\n\n"
                   + notice_text[-tail:])
    return (
        f"SITE: {site}\n\n{segment}\n\nCHECKLIST RESULTS:\n{compact}\n\nNOTICE TEXT:\n{excerpt}"
    )


# ─────────────────────────── orchestration ───────────────────────────

async def audit(url: str, llm_json=None) -> dict:
    """Full audit. `llm_json(system, user, max_tokens)` optional callable."""
    warnings: list[str] = []
    started = url
    last_html = ""
    body_len_hint = 0
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True, max_redirects=6) as client:
        try:
            final, body = await fetch(url, client)
        except Exception as e:
            raise ValueError(f"could not fetch {url}: {e}") from e

        notice_url, notice_text = final, html_to_text(body)
        last_html, body_len_hint = body, len(body)

        if not _looks_like_notice(notice_url, notice_text):
            candidate = discover_notice_url(body, final)
            if candidate and candidate.rstrip("/") != final.rstrip("/"):
                got = await _try_notice(client, candidate, len(notice_text))
                if got:
                    notice_url, notice_text, last_html = got
                    warnings.append("notice auto-discovered from the page you gave")
                else:
                    warnings.append("discovered notice link did not open — using the page you gave")
            if not _looks_like_notice(notice_url, notice_text):
                for path in common_paths(final)[:6]:
                    got = await _try_notice(client, path, len(notice_text))
                    if got:
                        notice_url, notice_text, last_html = got
                        warnings.append(f"notice found at a conventional path ({path})")
                        break
            if not _looks_like_notice(notice_url, notice_text):
                warnings.append("no privacy notice could be located — this may not be a compliant/auditable site, or the notice is JS-rendered")

    notice_text = re.sub(r"[ \t]+", " ", notice_text)
    if len(notice_text) < 400:
        if body_len_hint < 60000 and re.search(r"(?i)<script|__NEXT_DATA__|ng-app|data-reactroot|id=\"root\"", last_html or ""):
            raise ValueError(
                "This site renders its privacy notice with JavaScript, so the auditor received only the "
                "page shell. Paste the direct notice URL (e.g. https://site.com/privacy) or use the "
                "site's 'Download as PDF' version."
            )
        raise ValueError("page text too short to audit (blocked, JS-rendered, or PDF)")

    # The deterministic checklist runs on the FULL notice: regex scanning is cheap, and
    # capping it here silently dropped real findings in long notices.
    text = notice_text

    is_hub = bool(len(notice_text) < 6000 and len(re.findall(r'href="[^"]*privacy[^"]*"', last_html, re.I)) >= 3)
    if is_hub:
        warnings.append(
            "This looks like a privacy hub / index page rather than a full notice. "
            "The low score below reflects the index, not the actual notice — paste the "
            "jurisdiction- or audience-specific notice URL for a meaningful audit."
        )

    checks, scores = run_checks(text)
    result = {
        "requested_url": started,
        "notice_url": notice_url,
        "fetched_at": None,
        "char_count": len(notice_text),
        "truncated": len(notice_text) > LLM_TEXT_LIMIT,
        "llm_input_truncated": len(notice_text) > LLM_TEXT_LIMIT,
        "is_hub": is_hub,
        "checks": checks,
        "scores": scores,
        "warnings": warnings,
        "llm": None,
    }

    if llm_json is not None:
        try:
            out = llm_json(QUAL_SYSTEM, build_llm_prompt(text, checks, notice_url), 1400)
            if isinstance(out, dict):
                result["llm"] = out
        except Exception as e:
            result["warnings"].append(f"qualitative review unavailable: {e}")

    return result


NOTICE_HINTS = re.compile(
    r"(privacy\s+(notice|policy|statement)|data\s+protection|datenschutz|personal\s+data|personenbezogene\s+daten)", re.I)


def _looks_like_notice(url: str, text: str) -> bool:
    """Heuristic: is this page actually a privacy notice?"""
    if re.search(r"privacy|datenschutz|data[-_]?protection", url, re.I):
        return True
    if len(text) < 2500:
        return False
    hints = len(NOTICE_HINTS.findall(text[:20000]))
    legal = len(re.findall(r"(GDPR|DSGVO|personal data|data subject|controller|consent)", text[:20000], re.I))
    return hints >= 6 and legal >= 10


async def _try_notice(client: httpx.AsyncClient, candidate: str, baseline_len: int):
    """Fetch a candidate notice URL; accept if it looks like a notice or is substantially richer."""
    try:
        cfinal, cbody = await fetch(candidate, client)
    except Exception:
        return None
    ctext = html_to_text(cbody)
    if _looks_like_notice(cfinal, ctext) or len(ctext) > max(baseline_len, 3000) * 1.5:
        return cfinal, ctext, cbody
    return None
