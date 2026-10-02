# Legal Research Workbench — Interactive Demo

**Purpose:** Showcase artifact for leadership + development team. Sparks curiosity, explains the concept, invites questions.
**Status:** v1.0 (2026-10-02) — static demo with realistic mock data. Not connected to any real systems.

## Run it

Zero dependencies. Either:
1. **Double-click `index.html`** — opens in any browser, or
2. Serve it: `python3 -m http.server 8000` in this folder → http://localhost:8000

## What's inside (6 screens)

| Screen | Audience | Shows |
|---|---|---|
| **Overview** | Leadership | The pitch: stats, three work modes, why-now (do-nothing costs vs. upside) |
| **⚡ Consulting (Ask)** | Both | Interactive query demo: 3 sample questions → staged "thinking" pipeline → cited answer with confidence badges, source list, claim-verification panel, gap flags, and the **mandatory human review gate** (approve/revise/reject with audit-trail feedback) |
| **🏗 Projects (Build)** | Both | 3 project workspaces: Digital Omnibus Impact Program (Regulatory Impact Radar — 4h vs 3–4 weeks manual), AI Governance Policy Refresh (live gap-analysis bars vs AI Act articles), **Schrems II Then-vs-Now** (exposure window: ~4 months → ~2 weeks) |
| **📡 Monitoring (Operate)** | Both | Live regulatory feed, policy gap index, notice & cookie compliance table, breach pattern base, remediation tracker, horizon radar |
| **🧱 KM Base** | Leadership + KM team | "One Program, Not Two": 3-tier architecture (Vault → curated KB → AI), KM-practice→AI-capability table, reverse flow (Workbench as KM's ROI dashboard) |
| **🔬 Architecture** | Dev team | Three agents, retrieval pipeline (hybrid search → RRF → NLI claim verification), indicative stack, 10-week POC plan |

## Demo script (5-minute leadership walkthrough)

1. **Overview** — open with the quote: *"Document management organises files. KM organises meaning. AI requires meaning."* Point at the 60–70% stat.
2. **Ask** — click the AI Act triage sample. Let the pipeline steps play. Highlight: every claim cited, confidence badges, verification panel ("unsupported claims never reach you"). Then click **Approve** — the audit-trail story.
3. Ask the **transfer question** — show the 🚩 gap flag: the system noticed a directive deficiency *while answering a routine question*.
4. **Projects** — open Schrems II Then-vs-Now. This is the money slide: exposure window months → weeks.
5. **Monitoring** — the live feed: EDPB guideline detected 2h ago, auto-mapped to 3 internal policies.
6. **KM Base** — close with "One Program, Not Two": we're not buying a knowledge platform twice; the AI budget justifies the KM budget while KM de-risks the AI.

## Customizing

- **All content lives in `data.js`** — sample queries, projects, feeds, tables. Edit freely; no build step.
- Swap in real document names/policies from Vault to make it resonate internally.
- Styling: `styles.css` (CSS variables at top for theming).

## Guardrails for presenting

- The **DEMO — mock data** pill in the sidebar keeps expectations honest.
- Numbers are illustrative (Schrems II timeline, pattern-base stats) — label them as such if challenged.
- Legal content in mock answers is plausible but not legal advice; fine for a demo, don't circulate as guidance.

## Roadmap ideas (if the demo lands)

- v2: wire one real query path (Vault read-out + Qdrant + one LLM) for a "real data" wow moment
- v2: deploy to an internal URL (static hosting — trivial)
- v3: role-based views (what a steward sees vs. what a lawyer sees vs. what leadership sees)
