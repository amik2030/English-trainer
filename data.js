/* ============ MOCK DATA — realistic, illustrative only ============ */

const SAMPLE_QUERIES = [
  {
    id: "aiact-triage",
    mode: "Scenario check · AI Act",
    chip: "Does the EU AI Act apply to our vendor's patient-triage chatbot?",
    type: "Scenario check", jur: "EU · AI Act",
    answer: `<p><strong>Short answer: Very likely yes — and probably as a high-risk system.</strong> <span class="badge b-med">Confidence: HIGH</span></p>
    <p style="margin-top:10px">A chatbot performing <em>triage</em> of patients influences access to healthcare services. Under <span class="cite" title="Regulation (EU) 2024/1689, Annex III, point 5(b) — AI systems intended to be used to evaluate and classify emergency calls or to dispatch emergency response units; and AI systems used in healthcare to influence access to treatment">AI Act Annex III, pt. 5(b)</span>, AI systems used to evaluate and classify patients in healthcare contexts are <strong>high-risk</strong>, triggering the full obligation set:</p>
    <ul style="margin:10px 0 10px 20px; line-height:1.8">
      <li><strong>Risk management system</strong> — <span class="cite" title="AI Act Article 9">Art. 9</span></li>
      <li><strong>Data governance</strong> (training/validation data quality) — <span class="cite" title="AI Act Article 10">Art. 10</span></li>
      <li><strong>Technical documentation + logging</strong> — <span class="cite" title="AI Act Articles 11–12">Arts. 11–12</span></li>
      <li><strong>Human oversight measures</strong> — <span class="cite" title="AI Act Article 14">Art. 14</span></li>
      <li><strong>Conformity assessment before deployment</strong> — <span class="cite" title="AI Act Article 43">Art. 43</span></li>
    </ul>
    <p>As deployer (not provider), our obligations are narrower but real: use in accordance with instructions, human oversight assignment, input data relevance, monitoring — <span class="cite" title="AI Act Article 26 — Obligations of deployers of high-risk AI systems">Art. 26</span>. GDPR duties run in parallel: triage of health data = <span class="cite" title="GDPR Article 9(1) — special category data">Art. 9(1)</span> special category, likely requiring a <span class="cite" title="GDPR Article 35(3)(b) — DPIA mandatory for large-scale special category processing">Art. 35(3)(b)</span> DPIA.</p>
    <p style="margin-top:10px"><strong>Internal position:</strong> our <span class="cite" title="Internal: AI Governance Directive v3.2, §4.2.1 — Vendor AI intake (Veeva Vault, effective 2026-03-01, owner: DDP AI Governance)">AI Governance Directive v3.2 §4.2.1</span> requires vendor AI intake review <em>before</em> pilot. This scenario fits intake category "high-risk candidate — health".</p>`,
    sources: [
      { ico: "⚖️", txt: "AI Act Annex III pt. 5(b) — high-risk classification", tag: "External · primary", conf: "Verified" },
      { ico: "⚖️", txt: "AI Act Art. 26 — deployer obligations", tag: "External · primary", conf: "Verified" },
      { ico: "⚖️", txt: "GDPR Art. 9(1), Art. 35(3)(b)", tag: "External · primary", conf: "Verified" },
      { ico: "📄", txt: "AI Governance Directive v3.2 §4.2.1 (Vault, effective)", tag: "Internal · authoritative", conf: "Verified" },
      { ico: "📝", txt: "EDPB Opinion 28/2024 on AI Act & data protection", tag: "External · guidance", conf: "Verified" }
    ],
    ver: [
      { label: "Claims extracted", val: "11", cls: "b-blue" },
      { label: "✅ Supported by sources", val: "11", cls: "b-high" },
      { label: "⚠️ Partially supported", val: "0", cls: "b-med" },
      { label: "❌ Unsupported (removed)", val: "0", cls: "b-low" },
      { label: "🚫 Fabricated (removed + logged)", val: "0", cls: "b-low" }
    ],
    gap: null
  },
  {
    id: "transfer-us",
    mode: "Transfer assessment · GDPR",
    chip: "Can we transfer HR analytics data to our US processor after the latest Omnibus developments?",
    type: "Transfer check", jur: "EU → US",
    answer: `<p><strong>Conditionally yes — DPF certification must be verified per sub-processor, and the Omnibus simplification does not remove the transfer tool requirement.</strong> <span class="badge b-med">Confidence: HIGH</span></p>
    <p style="margin-top:10px">Transfers to a US processor require a valid Chapter V tool: an adequacy decision (<span class="cite" title="GDPR Article 45 — Transfers on the basis of an adequacy decision">Art. 45</span>) via EU–US Data Privacy Framework certification, or appropriate safeguards (<span class="cite" title="GDPR Article 46 — SCCs, BCRs">Art. 46</span> — SCCs + transfer impact assessment).</p>
    <ul style="margin:10px 0 10px 20px; line-height:1.8">
      <li>Verify the processor's <strong>current DPF certification status</strong> in the official DPF list — certification lapses have occurred and invalidate the adequacy reliance.</li>
      <li>HR data includes payroll and performance data — check <span class="cite" title="GDPR Article 88 — Member State rules on employment context processing">Art. 88</span> national overlays (DE: §26 BDSG; CH: FADP Art. 6 for cross-border if Swiss entity involved).</li>
      <li>The <span class="cite" title="Digital Omnibus proposal (COM/2025) — targeted simplification of GDPR provisions">Digital Omnibus</span> proposals simplify some documentation duties but <strong>do not repeal Chapter V</strong>. Drafting-stage only — no reliance yet. <span class="badge b-low">Confidence: MEDIUM on final text</span></li>
    </ul>
    <p><strong>Internal position:</strong> <span class="cite" title="Internal: Global Transfer Directive v2.4, §3 — US transfers post-Schrems II (Veeva Vault, owner: DDP Cross-Border)">Global Transfer Directive v2.4 §3</span> requires a documented TIA even under DPF reliance, and Legal sign-off for HR-data flows.</p>`,
    sources: [
      { ico: "⚖️", txt: "GDPR Art. 45, 46, 88 — Chapter V tools", tag: "External · primary", conf: "Verified" },
      { ico: "🏛", txt: "EU–US DPF list status check (monitor feed, 2h ago)", tag: "External · live", conf: "Verified" },
      { ico: "📄", txt: "Global Transfer Directive v2.4 §3 (Vault, effective)", tag: "Internal · authoritative", conf: "Verified" },
      { ico: "📰", txt: "Digital Omnibus proposal — drafting stage tracker", tag: "External · signal", conf: "Monitored" }
    ],
    ver: [
      { label: "Claims extracted", val: "9", cls: "b-blue" },
      { label: "✅ Supported", val: "8", cls: "b-high" },
      { label: "⚠️ Partially supported", val: "1 (Omnibus scope — flagged MEDIUM)", cls: "b-med" },
      { label: "❌ Unsupported (removed)", val: "0", cls: "b-low" },
      { label: "🚫 Fabricated", val: "0", cls: "b-low" }
    ],
    gap: "🚩 <strong>Gap flagged:</strong> no DPF-certification lapse scenario is covered in Global Transfer Directive v2.4. Suggesting a project: directive amendment — routed to DDP Cross-Border owner."
  },
  {
    id: "breach-reportability",
    mode: "Breach analysis · FADP + GDPR",
    chip: "Is a misdirected email with 12 patients' appointment data reportable in Switzerland?",
    type: "Incident check", jur: "CH · FADP",
    answer: `<p><strong>Likely reportable to the FDPIC — assessment turns on "high risk", and the pattern base says DPA practice leans toward notification for identifiable health-adjacent data.</strong> <span class="badge b-med">Confidence: MEDIUM-HIGH</span></p>
    <p style="margin-top:10px">Under <span class="cite" title="FADP (revFADP) Article 24 — notification of data breaches to the FDPIC as soon as possible where high risk to personality/fundamental rights">FADP Art. 24</span>, breaches creating a <strong>high risk</strong> to personality or fundamental rights must be notified to the FDPIC <em>as soon as possible</em>. Appointment data of identifiable patients touches the health domain — even if not full medical records.</p>
    <ul style="margin:10px 0 10px 20px; line-height:1.8">
      <li><strong>Pattern base evidence:</strong> of 34 comparable Swiss incidents in our breach pattern base (misdirected correspondence, &lt;50 data subjects, health-adjacent), the FDPIC was notified in 22; no fines where notification was prompt and remediation documented.</li>
      <li>If the same facts involve EU residents → parallel <span class="cite" title="GDPR Article 33 — 72-hour notification to supervisory authority">Art. 33 GDPR</span> 72h clock to the relevant DPA.</li>
      <li>Controller must also inform data subjects where required for their protection (<span class="cite" title="FADP Article 24(4)">Art. 24(4)</span>).</li>
    </ul>
    <p><strong>Internal position:</strong> <span class="cite" title="Internal: Incident Response SOP v5.1 §7 — Notification decision tree (Veeva Vault, owner: DDP Incident Response)">Incident Response SOP v5.1 §7</span> decision tree step 3: "health-adjacent + identifiable = presume high risk unless DPO documents otherwise".</p>`,
    sources: [
      { ico: "⚖️", txt: "FADP Art. 24; GDPR Art. 33", tag: "External · primary", conf: "Verified" },
      { ico: "📊", txt: "Breach pattern base — 34 comparable CH incidents", tag: "Internal · analytics", conf: "Aggregated" },
      { ico: "📄", txt: "Incident Response SOP v5.1 §7 (Vault, effective)", tag: "Internal · authoritative", conf: "Verified" }
    ],
    ver: [
      { label: "Claims extracted", val: "8", cls: "b-blue" },
      { label: "✅ Supported", val: "7", cls: "b-high" },
      { label: "⚠️ Partially supported", val: "1 (pattern-base extrapolation)", cls: "b-med" },
      { label: "❌ Unsupported (removed)", val: "1", cls: "b-low" },
      { label: "🚫 Fabricated", val: "0", cls: "b-low" }
    ],
    gap: null
  }
];

const THINK_STEPS = [
  "Parsing query → {jurisdiction: EU/CH, topic, question_type, depth}…",
  "Pre-filtering by classification metadata (Vault lifecycle = effective only)…",
  "Hybrid retrieval: vector top-20 + BM25 top-20 → rank fusion…",
  "Resolving cross-references & citation chain…",
  "Synthesizing answer with per-claim confidence…",
  "Claim verification (NLI): checking every assertion against sources…"
];

const PROJECTS = [
  {
    id: "omnibus",
    emoji: "📜", status: "ACTIVE · week 3/8", statusCls: "b-high",
    title: "Digital Omnibus Impact Program",
    desc: "Reacting to the EU Digital Omnibus simplification package: map every affected policy, directive and control; draft amendments before deadlines.",
    detail: `
      <h2>📜 Digital Omnibus Impact Program</h2>
      <p class="muted small" style="margin-bottom:14px">Trigger: external legislative event · Owner: DDP Policy Team · Duration: 8 weeks · Status: week 3</p>
      <div class="grid grid-2" style="margin-bottom:16px">
        <div class="card">
          <h3>🎯 Regulatory Impact Radar — auto-mapped</h3>
          <div class="radar-item"><span class="badge b-low">HIGH impact</span> &nbsp;<strong>Global Transfer Directive v2.4</strong> — documentation duties for TIAs proposed to be scaled back for low-risk transfers. <span class="muted">Citation graph: implements GDPR Art. 46 → touched by Omnibus Art. 1(4).</span></div>
          <div class="radar-item"><span class="badge b-med">MEDIUM</span> &nbsp;<strong>DPIA SOP v3.0</strong> — proposed easing of some Art. 35 documentation for SMEs; our group-wide SOP exceeds the floor, decision needed on alignment.</div>
          <div class="radar-item"><span class="badge b-med">MEDIUM</span> &nbsp;<strong>Record of Processing template</strong> — Art. 30 threshold changes (750-employee rule) affect 2 of 9 affiliates.</div>
          <div class="radar-item"><span class="badge b-blue">WATCH</span> &nbsp;<strong>Cookie consent guidance</strong> — softening signals; monitor national DPA positions before changing notice UX.</div>
          <p class="small muted" style="margin-top:8px">Time-to-impact-map: <strong style="color:var(--green)">4 hours</strong> after proposal publication (manual baseline: 3–4 weeks).</p>
        </div>
        <div>
          <div class="card" style="margin-bottom:14px">
            <h3>📓 Research Notebook</h3>
            <div class="small" style="line-height:2">
              <div>🔖 14 sources bookmarked · 9 annotated</div>
              <div>🔍 23 saved queries · trending: "Art. 30 thresholds"</div>
              <div>📝 6 team annotations · 2 open questions to external counsel</div>
              <div>🧾 Audit trail: every query & draft versioned</div>
            </div>
          </div>
          <div class="card">
            <h3>📤 Deliverables pipeline</h3>
            <div class="small" style="line-height:2">
              <div><span class="badge b-high">APPROVED</span> Position paper — Omnibus overview (board)</div>
              <div><span class="badge b-med">IN REVIEW</span> Amendment draft — Transfer Directive §3</div>
              <div><span class="badge b-blue">DRAFTING</span> DPIA SOP decision memo</div>
              <div><span class="badge b-purple">QUEUED</span> Affiliate briefing deck (9 entities)</div>
            </div>
            <p class="small muted" style="margin-top:6px">All deliverables: citation-verified, draft→review with track changes, corrections flow back to the KB.</p>
          </div>
        </div>
      </div>`
  },
  {
    id: "aiact-policy",
    emoji: "🤖", status: "ACTIVE · week 6/10", statusCls: "b-high",
    title: "AI Governance Policy Refresh",
    desc: "Overhauling the global AI policy against applicable AI Act obligations (high-risk duties live since Aug 2026) + internal AI inventory gap analysis.",
    detail: `
      <h2>🤖 AI Governance Policy Refresh</h2>
      <p class="muted small" style="margin-bottom:14px">Driver: AI Act applicability · Owner: DDP AI Governance · Duration: 10 weeks · Status: week 6</p>
      <div class="grid grid-2">
        <div class="card">
          <h3>🕳 Gap Analysis Mode — continuous</h3>
          <div class="bar-row"><span>Art. 9 risk mgmt</span><div class="bar-track"><div class="bar-fill" style="width:85%"></div></div><span style="color:var(--green)">85%</span></div>
          <div class="bar-row"><span>Art. 10 data governance</span><div class="bar-track"><div class="bar-fill warn" style="width:60%"></div></div><span style="color:var(--amber)">60%</span></div>
          <div class="bar-row"><span>Art. 14 human oversight</span><div class="bar-track"><div class="bar-fill" style="width:78%"></div></div><span style="color:var(--green)">78%</span></div>
          <div class="bar-row"><span>Art. 26 deployer duties</span><div class="bar-track"><div class="bar-fill bad" style="width:40%"></div></div><span style="color:var(--red)">40%</span></div>
          <div class="bar-row"><span>FRIA (Art. 27)</span><div class="bar-track"><div class="bar-fill bad" style="width:25%"></div></div><span style="color:var(--red)">25%</span></div>
          <p class="small muted" style="margin-top:8px">Every gap carries citations to both the Act and our current policy text — reviewers see the evidence, not a score.</p>
        </div>
        <div class="card">
          <h3>🔗 Precedent chains in use</h3>
          <div class="small" style="line-height:2">
            <div>AI Act Art. 10 → EDPB Opinion 28/2024 → EDPS guidance on health data in AI → our AI Governance Directive §5</div>
            <div style="margin-top:8px" class="muted">Visual chain: Regulation → Opinion → Guidance → Internal policy. Click any node → the full authority trail.</div>
          </div>
          <h3 style="margin-top:14px">📤 This week</h3>
          <div class="small"><span class="badge b-med">IN REVIEW</span> FRIA template + deployer-duties SOP section (the two red gaps)</div>
        </div>
      </div>`
  },
  {
    id: "schrems",
    emoji: "⚡", status: "ARCHIVE · case study", statusCls: "b-purple",
    title: "Schrems II Response (retrospective)",
    desc: "What the 2020 ruling cost us manually — and what the same event costs with the Workbench. The clearest before/after in the business case.",
    detail: `
      <h2>⚡ Schrems II — Then vs. Now</h2>
      <p class="muted small" style="margin-bottom:14px">CJEU C-311/18 (16 July 2020) invalidated Privacy Shield · 4,800+ EU–US data flows in scope for a pharma group</p>
      <div class="card" style="padding:6px 20px; margin-bottom:14px">
        <table>
          <thead><tr><th>Step</th><th>2020 (manual)</th><th>With Workbench</th></tr></thead>
          <tbody>
            <tr><td>Detect & understand ruling</td><td>Days (news + counsel calls)</td><td><strong style="color:var(--green)">Hours</strong> — Monitor event + Summarizer brief</td></tr>
            <tr><td>Map affected flows/contracts</td><td>6–8 weeks of interviews + spreadsheets</td><td><strong style="color:var(--green)">Days</strong> — citation graph: policy → SCC clauses → vendor register</td></tr>
            <tr><td>Draft updated positions</td><td>Weeks, inconsistent across affiliates</td><td><strong style="color:var(--green)">Days</strong> — one verified position paper, 9 affiliate briefs generated</td></tr>
            <tr><td>Evidence for auditors/regulators</td><td>Reconstructed months later</td><td><strong style="color:var(--green)">Continuous</strong> — audit trail by construction</td></tr>
            <tr><td><strong>Total exposure window</strong></td><td><strong style="color:var(--red)">~4 months</strong></td><td><strong style="color:var(--green)">~2 weeks</strong></td></tr>
          </tbody>
        </table>
      </div>
      <p class="small muted">The exposure window is where enforcement and customer-churn risk live. This is the single most concrete "cost of doing nothing" the Workbench removes.</p>`
  }
];

const FEED = [
  { lvl: "high", t: "2h ago", txt: "<strong>EDPB adopts Guidelines 03/2026</strong> on AI Act Art. 10 data governance ↔ GDPR interplay. Summarizer: affects <strong>3 internal policies</strong>, risk HIGH. Alert sent to AI Governance owner." },
  { lvl: "med", t: "9h ago", txt: "<strong>EUR-Lex:</strong> Digital Omnibus — Committee amendments published (Art. 30 thresholds). Impact Radar re-run queued for Transfer Directive & RoPA templates." },
  { lvl: "med", t: "1d ago", txt: "<strong>DE BfDI enforcement notice:</strong> fine against health-app operator — consent UX deficiencies. Routed to Notice & Cookie monitoring baseline." },
  { lvl: "low", t: "1d ago", txt: "<strong>FDPIC update:</strong> revised breach notification form (CH). Auto-tagged to Incident Response SOP owner; summary in review queue." },
  { lvl: "low", t: "2d ago", txt: "<strong>Expert blog (flagged source):</strong> analysis of FRIA practice emerging in DE healthcare. Relevance: MEDIUM — horizon topic &ldquo;agentic AI in pharma&rdquo;." }
];

const GAP_BARS = [
  { name: "Global Transfer Directive v2.4", pct: 15, cls: "warn", note: "2 open gaps (Omnibus)" },
  { name: "AI Governance Directive v3.2", pct: 35, cls: "bad", note: "4 open gaps (Art. 26, FRIA)" },
  { name: "Incident Response SOP v5.1", pct: 5, cls: "", note: "1 minor (CH form update)" },
  { name: "DPIA SOP v3.0", pct: 8, cls: "", note: "watchlist only" }
];

const NOTICES = [
  { p: "corporate.com (global)", s: 96, cls: "b-high", d: "0", age: "—" },
  { p: "patient-portal.eu", s: 88, cls: "b-high", d: "1", age: "3d" },
  { p: "careers-group.com", s: 71, cls: "b-med", d: "3", age: "11d" },
  { p: "trial-recruit.de", s: 54, cls: "b-low", d: "5", age: "19d ⚠ escalated" }
];

const BREACH = [
  { txt: "CH · misdirected email, health-adjacent, <50 subjects → <strong>notified in 22/34 cases</strong>, 0 fines where prompt" },
  { txt: "DE · SaaS misconfiguration, no exfil evidence → notification in 61% of cases; median fine €12k where delayed" },
  { txt: "EU-wide · phishing/credential theft → Art. 33 clock starts at <em>awareness of confirmed compromise</em>, not suspicion" }
];

const REMEDIATION = [
  { txt: "<span class='badge b-low'>OVERDUE</span> trial-recruit.de — 5 cookie deviations, owner: Web Compliance, due 2026-09-25 → auto-escalated" },
  { txt: "<span class='badge b-med'>IN PROGRESS</span> Transfer Directive §3 amendment (Omnibus) — owner: Cross-Border, due 2026-10-31" },
  { txt: "<span class='badge b-high'>CLOSED</span> FRIA template gap v1 → resolved 2026-09-28, status report auto-drafted & approved" }
];

const HORIZON = [
  { txt: "<strong>Agentic AI in pharma</strong> — 47 signals/quarter across AI Act · GDPR · sectoral. Interconnection alert: EDPB 03/2026 touches Art. 10 → clinical-trial SOPs → vendor contracts." },
  { txt: "<strong>EU Data Act application</strong> — B2B data-sharing duties from Sep 2025; overlap map with trade-secret guidance refreshed." },
  { txt: "<strong>AI literacy (Art. 4)</strong> — enforcement signals emerging; linked to L&D policy tracker." }
];
