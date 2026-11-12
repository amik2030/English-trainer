"""
Cookie & Tracker Compliance — static (Tier A) ePrivacy / TCA / FADP cookie scanner.

Fetches a page, inspects the *served* HTML, response headers (Set-Cookie) and the
visible text, then runs a jurisdiction-aware checklist covering:

  · ePrivacy Art. 5(3) + GDPR Art. 4(11) / 7       (EU)
  · PECR reg. 6                                    (UK)
  · Art. 45c TCA (SR 780.10) + FADP Art. 19/21     (Switzerland) — opt-OUT, not opt-in
  · CCPA/CPRA opt-out of sale/share                (US-CA)

Scope discipline: this is a STATIC analysis. It inspects the HTML the server sends
before any consent interaction. It cannot prove what happens after a user clicks,
cannot render JavaScript banners, and cannot judge colour/contrast dark patterns.
Those are Tier B (headless) and Tier C (human review) concerns. Every result carries
an explicit `limitations` list so the UI can never overstate what was verified.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx

from notice_auditor import (
    MAX_BYTES,
    TIMEOUT,
    UA,
    _require_public_target,
    html_to_text,
)

# ─────────────────────────── jurisdiction profiles ───────────────────────────

JURISDICTIONS = {
    "EU": {"label": "EU / EEA — ePrivacy + GDPR", "model": "opt-in",
           "refs": "ePrivacy Directive Art. 5(3); GDPR Art. 4(11), 7"},
    "CH": {"label": "Switzerland — Art. 45c TCA + FADP", "model": "opt-out",
           "refs": "Art. 45c TCA (SR 780.10); FADP Art. 6, 19, 21, 30"},
    "UK": {"label": "United Kingdom — PECR + UK GDPR", "model": "opt-in",
           "refs": "PECR reg. 6; UK GDPR Art. 4(11), 7"},
    "US-CA": {"label": "California — CCPA/CPRA", "model": "opt-out",
              "refs": "CCPA §1798.100, §1798.120, §1798.135"},
}


def resolve_jurisdictions(value: Optional[str]) -> list[str]:
    """Accept 'EU', 'CH', 'EU+CH', 'EU,CH', 'ALL' … and return a clean list."""
    raw = str(value or "").strip().upper()
    if not raw or raw in {"ALL", "ANY"}:
        return ["EU", "CH"]
    parts = [p.strip() for p in re.split(r"[+,/|;]| and ", raw) if p.strip()]
    out: list[str] = []
    for p in parts:
        if p in JURISDICTIONS:
            out.append(p)
        elif p in {"EU/EEA", "EEA", "GDPR"}:
            out.append("EU")
        elif p in {"SWISS", "SWITZERLAND", "FADP", "TCA"}:
            out.append("CH")
        elif p in {"UK", "GB", "PECR"}:
            out.append("UK")
        elif p in {"US", "CA", "CCPA", "CPRA", "US-CA"}:
            out.append("US-CA")
    return out or ["EU", "CH"]


# ─────────────────────────── detection vocabularies ───────────────────────────

CMP_VENDORS = [
    ("OneTrust", r"onetrust|optanon|ot-sdk"),
    ("Cookiebot", r"cookiebot|cybotcookiebot"),
    ("Usercentrics", r"usercentrics|uc\.js"),
    ("Didomi", r"didomi"),
    ("Osano", r"osano"),
    ("Sourcepoint", r"sourcepoint|sp-prod|_sp_"),
    ("TrustArc", r"trustarc|truste\.com"),
    ("Quantcast", r"quantcast|qc-cmp"),
    ("CookieYes", r"cookieyes"),
    ("Termly", r"termly"),
    ("Iubenda", r"iubenda"),
    ("Klaro", r"klaro"),
    ("Borlabs", r"borlabs"),
    ("Complianz", r"complianz"),
    ("CookieInformation", r"cookieinformation"),
    ("Axeptio", r"axeptio"),
    ("Pandectes", r"pandectes"),
    ("CookieScript", r"cookiescript"),
]

TRACKER_SIGNATURES = [
    ("Google Analytics", r"google-analytics\.com|googletagmanager\.com|gtag\("),
    ("Google Ads / DoubleClick", r"doubleclick\.net|googleadservices\.com|googlesyndication\.com"),
    ("Meta Pixel", r"connect\.facebook\.net|fbq\("),
    ("LinkedIn Insight", r"snap\.licdn\.com|linkedin\.com/li\.tracking"),
    ("TikTok Pixel", r"analytics\.tiktok\.com"),
    ("Hotjar", r"static\.hotjar\.com|hj\("),
    ("Microsoft Clarity", r"clarity\.ms"),
    ("Bing/Microsoft Ads", r"bat\.bing\.com|clarity\.ms"),
    ("Segment", r"cdn\.segment\.com|analytics\.js"),
    ("Mixpanel", r"cdn\.mxpnl\.com"),
    ("Amplitude", r"amplitude\.com"),
    ("Matomo", r"matomo\.js|piwik"),
    ("HubSpot", r"js\.hs-scripts\.com|hs-analytics"),
    ("Salesforce/Pardot", r"pi\.pardot\.com"),
    ("Criteo", r"static\.criteo\.net"),
    ("Taboola", r"cdn\.taboola\.com"),
    ("Outbrain", r"outbrain\.com"),
    ("Adobe Analytics", r"omtrdc\.net|2o7\.net|adobedc"),
    ("New Relic", r"js-agent\.newrelic\.com"),
    ("Sentry", r"browser\.sentry-cdn\.com"),
    ("Cloudflare Insights", r"static\.cloudflareinsights\.com"),
    ("YouTube embed", r"youtube\.com/embed|youtube-nocookie"),
    ("Vimeo embed", r"player\.vimeo\.com"),
]

# Cookie names strongly associated with non-essential purposes.
NONESSENTIAL_COOKIE_HINTS = [
    (r"^_ga$|^_gid$|^_gat|^_gcl_", "Google Analytics"),
    (r"^_fbp$|^_fbc$|^fr$", "Meta Pixel"),
    (r"^_hjid$|^_hjSession", "Hotjar"),
    (r"^_uetsid$|^_uetvid$|^_uetmsclkid$", "Microsoft Ads"),
    (r"^IDE$|^NID$|^test_cookie$|^_gads$", "DoubleClick/Google Ads"),
    (r"^li_sugr$|^bcookie$|^lidc$|^UserMatchHistory$", "LinkedIn"),
    (r"^_ttp$|^ttclid$", "TikTok"),
    (r"^_scid$|^_pin_unauth$", "Pinterest"),
    (r"^__hstc$|^hubspotutk$|^__hssc$", "HubSpot"),
    (r"^mp_|^mixpanel", "Mixpanel"),
    (r"^ajs_", "Segment"),
    (r"^_clck$|^_clsk$|^CLID$|^MUID$", "Microsoft Clarity/Bing"),
    (r"^AMP_TOKEN$|^_dc_gtm_", "Google Tag Manager"),
]

ACCEPT_PATTERNS = [
    r"accept\s+all", r"allow\s+all", r"i\s+agree", r"i\s+accept", r"got\s+it", r"^accept$",
    r"alle\s+akzeptieren", r"alle\s+zulassen", r"zustimmen", r"einverstanden",
    r"tout\s+accepter", r"j'accepte", r"accetta\s+tutti", r"aceptar\s+todo",
]

REJECT_PATTERNS = [
    r"reject\s+all", r"refuse\s+all", r"decline\s+all", r"deny\s+all", r"^reject$", r"^refuse$",
    r"only\s+(?:necessary|essential)", r"essential\s+only", r"necessary\s+only",
    r"continue\s+without\s+accepting", r"do\s+not\s+(?:accept|consent)", r"no\s+thanks",
    r"alle\s+ablehnen", r"nur\s+(?:notwendige|essenzielle)", r"nur\s+erforderliche",
    r"tout\s+refuser", r"refuser", r"rifiuta\s+tutto", r"rifiuta", r"rechazar\s+todo", r"rechazar",
]

CATEGORY_PATTERNS = {
    "necessary": r"(?:strictly\s+)?necessary|essential|required|technisch\s+notwendig|obligatoire|necessari|necesarias",
    "preferences": r"preference|functional|functionality|comfort",
    "analytics": r"analytic|performance|statistic|statistik|measurement|mesure|statistiche|estadístic",
    "marketing": r"marketing|advertising|targeting|advert|remarketing|social\s+media",
}

COOKIE_POLICY_PATTERNS = [
    r'href=["\']([^"\']*cookie[-_ ]?(?:policy|notice|statement|declaration)[^"\']*)["\']',
    r'href=["\']([^"\']*(?:/cookies|/cookie-policy|/cookie-notice|/legal/cookies|/cookierichtlinie|/politique-cookies)[^"\']*)["\']',
]

RETENTION_PATTERNS = [
    r"(?:retention|storage)\s+period", r"(?:stored|kept|retained)\s+for\s+(?:up\s+to\s+)?\d+",
    r"\d+\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\s*(?:of\s+)?(?:storage|retention)?",
    r"expire[sd]?\s+(?:after|in)\s+\d+", r"session\s+cookies?.*persistent",
    r"speicherdauer", r"durée\s+de\s+conservation", r"durata",
]

THIRD_PARTY_PATTERNS = [
    r"third[- ]part(?:y|ies)", r"our\s+partners", r"service\s+providers?",
    r"vendors?", r"drittanbieter", r"tiers",
]

DARK_LINK_PATTERNS = [
    r"continue\s+without\s+accepting",
    r"by\s+(?:continuing|using|clicking).{0,60}(?:you\s+)?(?:consent|agree|accept)",
    r"by\s+(?:continuing|using).{0,60}cookies",
    r"if\s+you\s+continue.{0,40}(?:accept|consent)",
]


# ─────────────────────────── fetch ───────────────────────────

async def fetch_with_headers(url: str) -> dict:
    """Fetch collecting final URL, HTML, text, and every Set-Cookie header per hop."""
    current = url
    set_cookies: list[dict] = []
    hops: list[str] = []
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False) as client:
        for _ in range(7):
            _require_public_target(current)
            r = await client.get(
                current,
                headers={"User-Agent": UA, "Accept-Language": "en,de;q=0.8,fr;q=0.6"},
            )
            hops.append(str(r.url))
            for raw in r.headers.get_list("set-cookie"):
                parsed = _parse_set_cookie(raw)
                if parsed:
                    parsed["hop"] = len(hops)
                    set_cookies.append(parsed)
            if r.status_code in (301, 302, 303, 307, 308):
                location = r.headers.get("location")
                if not location:
                    raise ValueError("website returned redirect without a target")
                current = urljoin(str(r.url), location)
                continue
            r.raise_for_status()
            ctype = r.headers.get("content-type", "")
            if "html" not in ctype and "text" not in ctype:
                raise ValueError(f"not an HTML page ({ctype or 'unknown type'})")
            body = r.content[:MAX_BYTES].decode(r.encoding or "utf-8", errors="replace")
            return {
                "final_url": str(r.url),
                "html": body,
                "text": html_to_text(body),
                "set_cookies": set_cookies,
                "hops": hops,
            }
    raise ValueError("too many redirects")


def _parse_set_cookie(raw: str) -> Optional[dict]:
    """Minimal Set-Cookie parser: we only need name/domain/path/flags, not values."""
    try:
        first, *attrs = [x.strip() for x in raw.split(";")]
        if "=" not in first:
            return None
        name, _, value = first.partition("=")
        name = name.strip()
        if not name:
            return None
        out = {"name": name[:120], "domain": "", "path": "", "secure": False,
               "httponly": False, "samesite": "", "session": True, "max_age": None}
        for a in attrs:
            low = a.lower()
            if low.startswith("domain="):
                out["domain"] = a.split("=", 1)[1].strip()
            elif low.startswith("path="):
                out["path"] = a.split("=", 1)[1].strip()
            elif low.startswith("max-age="):
                try:
                    out["max_age"] = int(a.split("=", 1)[1].strip())
                    out["session"] = False
                except ValueError:
                    pass
            elif low.startswith("expires="):
                out["session"] = False
            elif low == "secure":
                out["secure"] = True
            elif low == "httponly":
                out["httponly"] = True
            elif low.startswith("samesite="):
                out["samesite"] = low.split("=", 1)[1].strip()
        # The value is never persisted: we record shape only.
        del value
        return out
    except Exception:
        return None


# ─────────────────────────── analysis ───────────────────────────

def _find_any(text: str, patterns: list[str]) -> tuple[bool, str]:
    for p in patterns:
        m = re.search(p, text, re.I | re.M)
        if m:
            s = max(0, m.start() - 100)
            return True, re.sub(r"\s+", " ", text[s:m.end() + 120]).strip()[:320]
    return False, ""


def analyze(page: dict, jurisdiction: list[str], policy_text: str = "") -> dict:
    html = page["html"]
    text = page["text"]
    # Disclosure checks (categories, retention, third parties) are legally satisfied by the
    # cookie policy as much as by the banner. Scanning only the homepage produced false
    # failures on sites that keep all of that on a linked policy page.
    disclosure_text = f"{text}\n{policy_text}" if policy_text else text
    final_url = page["final_url"]
    site_host = (urlparse(final_url).hostname or "").lower()

    # --- banner / CMP -------------------------------------------------------
    cmp_name = None
    for vendor, pat in CMP_VENDORS:
        if re.search(pat, html, re.I):
            cmp_name = vendor
            break

    banner_re, banner_ev = _find_any(html, [
        r'(?:id|class)=["\'][^"\']*(?:cookie[-_]?(?:banner|consent|notice|bar|modal|popup|wall|dialog))[^"\']*["\']',
        r'(?:id|class)=["\'][^"\']*(?:consent[-_]?(?:banner|modal|dialog|manager|popup))[^"\']*["\']',
        r'(?:id|class)=["\'][^"\']*(?:gdpr|cc[-_]window|CybotCookiebot|onetrust|usercentrics|didomi)[^"\']*["\']',
        r'aria-label=["\'][^"\']*cookie[^"\']*["\']',
        r'role=["\']dialog["\'][^>]*>[^<]{0,400}cookie',
    ])
    banner_text, banner_text_ev = _find_any(text, [
        r"we\s+use\s+cookies", r"this\s+(?:site|website)\s+uses\s+cookies",
        r"wir\s+verwenden\s+cookies", r"nous\s+utilisons\s+des\s+cookies",
        r"utilizziamo\s+cookie", r"utilizamos\s+cookies",
        r"cookie\s+(?:settings|preferences|consent)",
    ])
    has_banner = banner_re or banner_text
    banner_evidence = banner_ev or banner_text_ev

    has_accept, accept_ev = _find_any(html + "\n" + text, ACCEPT_PATTERNS)
    has_reject, reject_ev = _find_any(html + "\n" + text, REJECT_PATTERNS)
    # Only trust accept/reject when a banner is actually evidenced. Otherwise these words are
    # matched in policy prose ("you may reject cookies by ..."), which is not a banner control
    # and inflated the ePrivacy score on sites with no visible banner in the served HTML.
    if not has_banner:
        has_accept = has_reject = False
        accept_ev = reject_ev = ""

    # Pre-ticked consent checkboxes (EDPB taskforce Type B).
    preticked, preticked_ev = _find_any(html, [
        r'<input[^>]+type=["\']checkbox["\'][^>]*\bchecked\b[^>]*',
        r'<input[^>]+\bchecked\b[^>]*type=["\']checkbox["\'][^>]*',
    ])
    # Tighten: only count if a consent-ish word appears nearby.
    if preticked and not re.search(r"cookie|consent|tracking|market|analytic", preticked_ev, re.I):
        preticked, preticked_ev = False, ""

    tcf = bool(re.search(r"__tcfapi|tcfapi|tcData|euconsent-v2", html, re.I))
    gcm = bool(re.search(r"gtag\(\s*['\"]consent['\"]|default_consent|consent_mode", html, re.I))

    # --- cookie policy link -------------------------------------------------
    cookie_policy_url = None
    for pat in COOKIE_POLICY_PATTERNS:
        m = re.search(pat, html, re.I)
        if m:
            href = m.group(1).strip()
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            try:
                cookie_policy_url = urljoin(final_url, href)
            except Exception:
                cookie_policy_url = None
            if cookie_policy_url:
                break

    # --- disclosed categories / retention / third parties -------------------
    categories = [k for k, pat in CATEGORY_PATTERNS.items() if re.search(pat, disclosure_text, re.I)]
    retention, retention_ev = _find_any(disclosure_text, RETENTION_PATTERNS)
    third_parties, third_party_ev = _find_any(disclosure_text, THIRD_PARTY_PATTERNS)
    dark_link, dark_link_ev = _find_any(text + "\n" + html, DARK_LINK_PATTERNS)

    # --- trackers in served HTML -------------------------------------------
    trackers = sorted({name for name, pat in TRACKER_SIGNATURES if re.search(pat, html, re.I)})

    # --- cookies actually set on first response ----------------------------
    cookies = page["set_cookies"]
    nonessential: list[dict] = []
    for c in cookies:
        for pat, vendor in NONESSENTIAL_COOKIE_HINTS:
            if re.search(pat, c["name"], re.I):
                nonessential.append({"name": c["name"], "vendor": vendor,
                                     "third_party": bool(c["domain"]) and not _same_site(c["domain"], site_host),
                                     "session": c["session"]})
                break
    third_party_cookies = [
        {"name": c["name"], "domain": c["domain"]}
        for c in cookies
        if c["domain"] and not _same_site(c["domain"], site_host)
    ]

    return {
        "cmp": cmp_name,
        "has_banner": bool(has_banner),
        "banner_evidence": banner_evidence,
        "has_accept": has_accept,
        "accept_evidence": accept_ev,
        "has_reject": has_reject,
        "reject_evidence": reject_ev,
        "preticked": bool(preticked),
        "preticked_evidence": preticked_ev,
        "tcf": tcf,
        "google_consent_mode": gcm,
        "cookie_policy_url": cookie_policy_url,
        "policy_fetched": bool(policy_text),
        "categories": categories,
        "retention": retention,
        "retention_evidence": retention_ev,
        "third_parties_disclosed": third_parties,
        "third_party_evidence": third_party_ev,
        "dark_link": bool(dark_link),
        "dark_link_evidence": dark_link_ev,
        "trackers": trackers,
        "preconsent_nonessential": nonessential,
        "third_party_cookies": third_party_cookies,
        "total_cookies": len(cookies),
        "jurisdictions": jurisdiction,
    }


def _same_site(cookie_domain: str, host: str) -> bool:
    d = cookie_domain.lstrip(".").lower()
    h = host.lower()
    return bool(d) and (h == d or h.endswith("." + d) or d.endswith("." + h))


def _discover_cookie_policy(html: str, base_url: str) -> Optional[str]:
    for pat in COOKIE_POLICY_PATTERNS:
        for m in re.finditer(pat, html, re.I):
            href = m.group(1).strip()
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            try:
                absu = urljoin(base_url, href)
            except Exception:
                continue
            if urlparse(absu).scheme in ("http", "https"):
                return absu
    return None


# ─────────────────────────── checks ───────────────────────────

@dataclass
class CookieCheck:
    id: str
    domain: str
    ref: str
    title: str
    weight: int = 1
    jurisdictions: tuple = ("EU", "CH", "UK", "US-CA")
    # "present" → passes when the signal is true
    # "absent"  → passes when the signal is FALSE (a bad practice must not be found)
    polarity: str = "present"
    key: str = ""          # key into the signals dict
    detail_pass: str = ""
    detail_fail: str = ""
    extra: tuple = field(default_factory=tuple)   # additional jurisdictions that also grade this


CHECKS: list[CookieCheck] = [
    # ---- universal / technical -------------------------------------------
    CookieCheck(
        "banner_present", "Transparency", "Art. 45c TCA / Art. 5(3) ePrivacy",
        "Cookie banner or consent notice present in served markup", weight=2,
        key="has_banner",
        detail_pass="A cookie/consent notice was found in the HTML the server returns.",
        detail_fail="No cookie banner or consent notice was found in the served HTML. Either there is none, or it is injected by JavaScript later (static scan cannot see that).",
    ),
    CookieCheck(
        "cmp_detected", "Transparency", "good practice",
        "Recognised consent management platform detected", weight=1,
        key="cmp",
        detail_pass="A known CMP was identified in the page source.",
        detail_fail="No known CMP signature found. A custom in-house banner may still be compliant — this is an informational signal only.",
    ),
    CookieCheck(
        "cookie_policy", "Transparency", "Art. 5(3) ePrivacy / Art. 19 FADP",
        "Cookie policy or cookie declaration reachable", weight=1,
        key="cookie_policy_url",
        detail_pass="A link to a cookie policy / declaration was found.",
        detail_fail="No cookie policy link was found in the served HTML.",
    ),
    CookieCheck(
        "categories", "Transparency", "Art. 5(3) ePrivacy / Art. 19 FADP",
        "Cookie categories and purposes disclosed", weight=2,
        key="categories",
        detail_pass="Distinct cookie categories and purposes were described.",
        detail_fail="Cookie categories/purposes were not clearly disclosed in the page text.",
    ),
    CookieCheck(
        "third_parties", "Transparency", "Art. 19 FADP / Art. 13 GDPR",
        "Third parties / recipients addressed", weight=1,
        key="third_parties_disclosed",
        detail_pass="Third-party recipients or processors are referenced.",
        detail_fail="No reference to third parties receiving cookie data was found.",
    ),
    CookieCheck(
        "retention", "Transparency", "Art. 5(3) ePrivacy / Art. 19 FADP",
        "Cookie retention or expiry disclosed", weight=1,
        key="retention",
        detail_pass="A storage/retention period or criterion was found.",
        detail_fail="No retention period or expiry information was found.",
    ),
    CookieCheck(
        "preconsent_cookies", "Technical", "Art. 5(3) ePrivacy / Art. 45c TCA",
        "No non-essential cookies set before any consent", weight=3,
        polarity="absent", key="preconsent_nonessential",
        detail_pass="No known non-essential tracking cookies were set in the initial server response.",
        detail_fail="Non-essential tracking cookies (analytics/advertising) were set by the server before any consent interaction.",
    ),
    CookieCheck(
        "tracker_scripts", "Technical", "Art. 5(3) ePrivacy",
        "No tracking scripts loaded unconditionally in the page source", weight=2,
        polarity="absent", key="trackers",
        detail_pass="No known third-party tracking script was found loading directly in the HTML.",
        detail_fail="Third-party tracking scripts appear to load directly in the page source rather than behind consent.",
    ),
    # ---- EU / UK (opt-in model) ------------------------------------------
    CookieCheck(
        "prior_consent", "ePrivacy", "Art. 5(3) ePrivacy; GDPR Art. 4(11)",
        "Prior consent required for non-essential cookies (opt-in model)", weight=3,
        jurisdictions=("EU", "UK"), key="has_banner",
        detail_pass="A consent mechanism is present, consistent with an opt-in model.",
        detail_fail="No consent mechanism was detected for non-essential cookies, which EU/UK law requires before they are set.",
    ),
    CookieCheck(
        "reject_control", "ePrivacy", "Art. 5(3); EDPB Cookie Banner Taskforce (Type A)",
        "Refuse/reject option available at the same layer as accept", weight=3,
        jurisdictions=("EU", "UK"), key="has_reject",
        detail_pass="A refuse/reject/only-necessary control was found.",
        detail_fail="No refuse/reject control was found at the banner's first layer. EDPB considers the absence of a reject option an infringement.",
    ),
    CookieCheck(
        "granular_choice", "ePrivacy", "Art. 5(3); GDPR Art. 7(2)",
        "Granular per-category choice offered", weight=2,
        jurisdictions=("EU", "UK"), key="categories_count",
        detail_pass="Multiple cookie categories are exposed, enabling granular choice.",
        detail_fail="No granular per-category choice was found — consent appears bundled.",
    ),
    CookieCheck(
        "consent_withdrawal", "ePrivacy", "GDPR Art. 7(3)",
        "Consent withdrawal / preference change described", weight=2,
        jurisdictions=("EU", "UK"),
        key="withdrawal",
        detail_pass="A way to withdraw consent or change preferences was described.",
        detail_fail="No consent-withdrawal or preference-change route was found.",
    ),
    CookieCheck(
        "no_preticked", "ePrivacy", "GDPR recital 32; EDPB Taskforce (Type B)",
        "No pre-ticked consent options", weight=2,
        jurisdictions=("EU", "UK"), polarity="absent", key="preticked",
        detail_pass="No pre-ticked consent checkboxes were found in the markup.",
        detail_fail="Pre-ticked consent checkboxes were found. Silence or pre-ticked boxes are not valid consent.",
    ),
    CookieCheck(
        "no_deceptive_design", "ePrivacy", "EDPB Guidelines 03/2022; Taskforce Types C-E",
        "No deceptive banner wording detected (static heuristics)", weight=2,
        jurisdictions=("EU", "UK"), polarity="absent", key="dark_link",
        detail_pass="No deceptive 'by continuing you consent' wording was detected.",
        detail_fail="Wording implying consent by continued browsing was found. Consent must be a positive action; this needs human review (colour/contrast is out of scope for a static scan).",
    ),
    CookieCheck(
        "tcf_signals", "ePrivacy", "TCF v2 / Google Consent Mode",
        "Consent signals (TCF / Google Consent Mode) implemented", weight=1,
        jurisdictions=("EU", "UK"), key="consent_signals",
        detail_pass="TCF or Google Consent Mode signals were detected.",
        detail_fail="No TCF or Google Consent Mode signals found. Optional, but expected for ad-supported sites.",
    ),
    # ---- Switzerland (opt-out model) -------------------------------------
    CookieCheck(
        "ch_information", "FADP/TCA", "Art. 45c lit. b TCA",
        "Users informed about processing on their device and its purpose", weight=3,
        jurisdictions=("CH",), key="has_banner",
        detail_pass="Information about cookie processing and its purpose is provided.",
        detail_fail="No information about processing on the user's device and its purpose was found, as Art. 45c TCA requires.",
    ),
    CookieCheck(
        "ch_refusal_right", "FADP/TCA", "Art. 45c lit. b TCA",
        "Right to refuse the processing is communicated", weight=3,
        jurisdictions=("CH",), key="has_reject",
        detail_pass="A refusal right / opt-out control was found.",
        detail_fail="No communicated right to refuse cookie processing was found. Swiss law requires that users be told they may refuse, and how.",
    ),
    CookieCheck(
        "ch_optout_mechanism", "FADP/TCA", "Art. 30(2)(b) FADP; Art. 45c TCA",
        "Practical opt-out mechanism available before cookies are set", weight=2,
        jurisdictions=("CH",), key="ch_optout",
        detail_pass="A practical opt-out mechanism appears available.",
        detail_fail="No practical opt-out mechanism was found prior to cookie activation.",
    ),
    CookieCheck(
        "ch_no_mandatory_consent", "FADP/TCA", "Art. 45c TCA; FDPIC cookie guidelines",
        "Banner does not wrongly imply consent is legally mandatory", weight=1,
        jurisdictions=("CH",), polarity="absent", key="forced_consent",
        detail_pass="No wording implying mandatory consent was detected.",
        detail_fail="Wording implies consent is mandatory to use the site. Under Swiss law a refusal right must exist; consent is not the only basis.",
    ),
    # ---- US-CA ------------------------------------------------------------
    CookieCheck(
        "ca_optout_link", "CCPA/CPRA", "CCPA §1798.135",
        "'Do Not Sell or Share My Personal Information' link present", weight=3,
        jurisdictions=("US-CA",), key="ca_optout",
        detail_pass="A Do Not Sell/Share opt-out link was found.",
        detail_fail="No 'Do Not Sell or Share My Personal Information' link was found.",
    ),
    CookieCheck(
        "ca_notice_at_collection", "CCPA/CPRA", "CCPA §1798.100",
        "Notice at collection present", weight=2,
        jurisdictions=("US-CA",), key="has_banner",
        detail_pass="A notice at collection / cookie notice is present.",
        detail_fail="No notice at collection was detected.",
    ),
]


def _signal(signals: dict, key: str) -> bool:
    if key == "categories_count":
        return len(signals.get("categories") or []) >= 2
    if key == "withdrawal":
        return bool(signals.get("has_reject") or signals.get("cookie_policy_url"))
    if key == "consent_signals":
        return bool(signals.get("tcf") or signals.get("google_consent_mode"))
    if key == "ch_optout":
        return bool(signals.get("has_reject") or signals.get("cookie_policy_url"))
    if key == "ca_optout":
        return bool(signals.get("ca_optout_link"))
    if key == "forced_consent":
        return bool(signals.get("forced_consent"))
    val = signals.get(key)
    if isinstance(val, (list, tuple, set, dict)):
        return len(val) > 0
    return bool(val)


def run_checks(signals: dict, jurisdiction: list[str]) -> tuple[list[dict], dict]:
    applicable = [c for c in CHECKS if set(c.jurisdictions) & set(jurisdiction)]
    results: list[dict] = []
    for c in applicable:
        found = _signal(signals, c.key)
        passed = (not found) if c.polarity == "absent" else found
        evidence = ""
        if c.key == "has_banner":
            evidence = signals.get("banner_evidence") or ""
        elif c.key == "has_reject":
            evidence = signals.get("reject_evidence") or ""
        elif c.key == "preticked":
            evidence = signals.get("preticked_evidence") or ""
        elif c.key == "dark_link":
            evidence = signals.get("dark_link_evidence") or ""
        elif c.key == "retention":
            evidence = signals.get("retention_evidence") or ""
        elif c.key == "third_parties_disclosed":
            evidence = signals.get("third_party_evidence") or ""
        elif c.key == "preconsent_nonessential":
            items = signals.get("preconsent_nonessential") or []
            evidence = ", ".join(f"{i['name']} ({i['vendor']})" for i in items[:8])
        elif c.key == "trackers":
            evidence = ", ".join((signals.get("trackers") or [])[:10])
        elif c.key == "cmp":
            evidence = signals.get("cmp") or ""
        results.append({
            "id": c.id,
            "domain": c.domain,
            "ref": c.ref,
            "title": c.title,
            "weight": c.weight,
            "polarity": c.polarity,
            "passed": passed,
            "detail": c.detail_pass if passed else c.detail_fail,
            "evidence": re.sub(r"\s+", " ", evidence)[:320],
        })
    return results, score(results)


def score(results: list[dict]) -> dict:
    by_domain: dict[str, dict] = {}
    for r in results:
        d = by_domain.setdefault(r["domain"], {"passed": 0, "total": 0,
                                               "weight_passed": 0, "weight_total": 0})
        d["total"] += 1
        d["weight_total"] += r["weight"]
        if r["passed"]:
            d["passed"] += 1
            d["weight_passed"] += r["weight"]

    def pct(p: int, t: int) -> int:
        return round(100 * p / t) if t else 0

    for _name, d in by_domain.items():
        d["pct"] = pct(d["weight_passed"], d["weight_total"])
        d["grade"] = grade_for(d["pct"])

    overall = pct(sum(d["weight_passed"] for d in by_domain.values()),
                  sum(d["weight_total"] for d in by_domain.values()))
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


# ─────────────────────────── extras on the signal pass ───────────────────────────

def _augment_signals(signals: dict, text: str, html: str) -> None:
    """Signals that need the combined text/HTML rather than a single key lookup."""
    signals["ca_optout_link"] = bool(re.search(
        r"do\s+not\s+(?:sell|share)\s+my\s+(?:personal\s+)?information", text + html, re.I))
    signals["forced_consent"] = bool(re.search(
        r"(?:you\s+)?(?:must|need\s+to)\s+(?:accept|consent)\s+.{0,40}(?:to\s+)?(?:continue|access|use\s+(?:the|this)\s+(?:site|website))"
        r"|by\s+clicking\s+.{0,30}you\s+(?:agree|consent)",
        text, re.I))


LIMITATIONS = [
    "Static analysis only: the page HTML and initial response headers are inspected. JavaScript-rendered banners may be invisible to this scan.",
    "Cannot verify what cookies or requests fire after a user accepts or rejects — that requires a headless browser (planned Tier B).",
    "Cannot judge visual dark patterns such as colour, contrast, button size or placement — that needs human review (Tier C).",
    "A passing score is not a compliance determination: it means the expected text and markup signals were found.",
]


async def audit_cookies(url: str, jurisdiction: Optional[str] = None) -> dict:
    """Run one static cookie-compliance scan."""
    juris = resolve_jurisdictions(jurisdiction)
    warnings: list[str] = []

    page = await fetch_with_headers(url)
    text, html = page["text"], page["html"]

    if len(html) < 500:
        raise ValueError("page too short to analyse (blocked, empty, or not HTML)")

    # Pre-pass to find the cookie policy link, then fetch it so disclosure checks
    # (categories, retention, third parties) are judged against the policy text too.
    policy_text = ""
    policy_url = _discover_cookie_policy(page["html"], page["final_url"])
    if policy_url and policy_url.rstrip("/") != page["final_url"].rstrip("/"):
        try:
            pp = await fetch_with_headers(policy_url)
            policy_text = pp["text"]
        except Exception:
            warnings.append(f"cookie policy link found ({policy_url}) but could not be fetched")

    signals = analyze(page, juris, policy_text=policy_text)
    _augment_signals(signals, text, html)

    checks, scores = run_checks(signals, juris)
    if not signals["has_banner"]:
        warnings.append(
            "No cookie banner was found in the served HTML. If a banner appears in a real "
            "browser, it is injected by JavaScript and this static scan cannot see it — "
            "not a confirmed absence."
        )
    if signals["preconsent_nonessential"]:
        warnings.append(
            f"{len(signals['preconsent_nonessential'])} non-essential tracking cookie(s) were set "
            "by the server before any consent interaction."
        )
    if not signals["cmp"]:
        warnings.append("No recognised CMP detected — a custom banner is not necessarily non-compliant.")

    result = {
        "requested_url": url,
        "final_url": page["final_url"],
        "jurisdiction": juris,
        "jurisdiction_labels": [JURISDICTIONS[j]["label"] for j in juris],
        "consent_model": sorted({JURISDICTIONS[j]["model"] for j in juris}),
        "fetched_at": None,
        "method": "static",
        "char_count": len(text),
        "html_fingerprint": hashlib.sha256(
            re.sub(r"\s+", " ", html).strip().lower().encode("utf-8")
        ).hexdigest(),
        "signals": {
            "cmp": signals["cmp"],
            "has_banner": signals["has_banner"],
            "has_accept": signals["has_accept"],
            "has_reject": signals["has_reject"],
            "preticked": signals["preticked"],
            "tcf": signals["tcf"],
            "google_consent_mode": signals["google_consent_mode"],
            "categories": signals["categories"],
            "trackers": signals["trackers"],
            "cookie_policy_url": signals["cookie_policy_url"],
            "total_cookies": signals["total_cookies"],
            "preconsent_nonessential": signals["preconsent_nonessential"],
            "third_party_cookies": signals["third_party_cookies"][:25],
            "retention_found": signals["retention"],
            "third_parties_disclosed": signals["third_parties_disclosed"],
        },
        "checks": checks,
        "scores": scores,
        "warnings": warnings,
        "limitations": LIMITATIONS,
    }
    return result
