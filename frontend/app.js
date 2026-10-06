/* Pocket DDP Workbench — frontend app logic */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let SB = null;        // supabase client
  let ME = null;        // {id,email,role}
  let TAX = null;       // taxonomy meta
  const state = { sources: [], queue: null };

  function toast(msg, ms) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  async function api(path, opts) {
    opts = opts || {};
    const { data } = await SB.auth.getSession();
    const token = data?.session?.access_token;
    const res = await fetch(path, {
      method: opts.method || "GET",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: ("Bear" + "er ") + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) {
      try { await SB.auth.signOut(); } catch (e) {}
      location.replace("/login.html?expired=1");
      throw new Error("session expired");
    }
    if (!res.ok) {
      let d = "request failed";
      try { d = (await res.json()).detail || d; } catch (e) {}
      throw new Error(typeof d === "string" ? d : JSON.stringify(d));
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------- boot ----------
  async function boot() {
    let cfg;
    try {
      const r = await fetch("/api/config?v=" + Date.now(), { cache: "no-store" });
      cfg = await r.json();
    } catch (e) {
      alert("Backend unreachable (" + e.message + "). Refresh in a minute.");
      return;
    }
    SB = supabase.createClient(cfg.supabase_url, cfg.anon_key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data } = await SB.auth.getSession();
    if (data?.session) { await enterApp(); } else { showLogin(); }
    SB.auth.onAuthStateChange((event, session) => {
      if (session && !ME) enterApp();
      if (!session && event === "SIGNED_OUT") { ME = null; showLogin(); }
    });
  }

  function showLogin() { location.replace("/login.html"); }

  async function enterApp() {
    try {
      try { ME = await api("/api/me"); }
      catch (e1) {
        if (String(e1.message).indexOf("session expired") !== -1) throw e1;
        await new Promise((r) => setTimeout(r, 1500));
        ME = await api("/api/me"); // one retry (cold start)
      }
    } catch (e) {
      console.error("enterApp failed:", e);
      if (String(e.message).indexOf("session expired") === -1) {
        alert("Login OK but profile load failed: " + e.message);
      }
      showLogin(); return;
    }
    const appEl = $("#app"); if (appEl) appEl.classList.remove("hidden");
    $("#me-email").textContent = ME.email;
    $("#me-role").textContent = ME.role === "reviewer" ? "🛡 reviewer" : "👤 user";
    $("#me-role").className = "badge " + (ME.role === "reviewer" ? "purple" : "blue");
    const lb = $("#lb-corner");
    if (lb) { lb.innerHTML = "signed in as <b style='color:var(--text)'>" + ME.email.replace(/</g, "&lt;") + "</b> · " + (ME.role === "reviewer" ? "🛡 reviewer" : "👤 user"); }
    if (ME.role === "reviewer") $("#nav-review").classList.remove("hidden");
    TAX = await api("/api/taxonomy").catch(() => null);
    fillSourceFormSelects();
    wireNav();
    await Promise.all([loadHistory(), loadSources(), ME.role === "reviewer" ? loadQueue() : Promise.resolve()]);
  }

  // login moved to /login.html
  // ---------- nav ----------
  function wireNav() {
    const lo = $("#logout-btn");
    if (lo) lo.onclick = async () => {
      lo.disabled = true; lo.textContent = "Signing out…";
      try { await SB.auth.signOut(); } catch (e) {}
      location.replace("/login.html");
    };
    $$(".nav-link").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault();
      const id = a.dataset.screen;
      $$(".nav-link").forEach((x) => x.classList.remove("active"));
      a.classList.add("active");
      $$(".screen").forEach((s) => s.classList.toggle("visible", s.id === id));
      if (id === "kb") loadKB();
      if (id === "review") loadQueue();
    }));
    $$(".tab").forEach((t) => t.addEventListener("click", () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      ["items", "sources", "gaps", "users", "manual"].forEach((k) =>
        $("#rv-" + k).classList.toggle("hidden", k !== t.dataset.rtab));
    }));
  }

  // ---------- ASK ----------
  function qaCard(q) {
    const cits = (q.citations || []).map((c) =>
      `<span class="cit">↳ <b>${esc(c.kind === "source" ? "source" : c.kind === "qa" ? "prior Q&A" : "knowledge")}</b>: ${esc(c.title)}</span>`).join("<br>");
    const tags = (q.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${TAX?.nodes?.[t] ? " · " + esc(TAX.nodes[t]) : ""}</span>`).join("");
    return `<div class="card qa-card">
      <div class="qa-q">Q: ${esc(q.question)}</div>
      <div class="qa-a">${esc(q.answer)}</div>
      <div class="qa-meta">
        ${q.kb_reused ? '<span class="badge green">KB reuse</span>' : ""}
        <span class="badge">confidence ${Math.round((q.confidence ?? 0) * 100) / 100}</span>
        <span class="badge">${esc(q.jurisdiction || "INTL")}</span>
        ${q.scope ? Object.entries(q.scope).map(([k, v]) => `<span class="badge purple">🎯 ${esc(k.replace("_", " "))}: ${esc(v)}</span>`).join("") : ""}
        ${q.kb_counts ? `<span class="badge">KB in scope: ${q.kb_counts.items_in_scope} items / ${q.kb_counts.sources_in_scope} sources</span>` : ""}
        ${tags}
      </div>
      ${cits ? `<div style="margin-top:8px">${cits}</div>` : '<div style="margin-top:8px" class="cit">↳ general legal knowledge (KB did not cover this — flagged for curation)</div>'}
      <div class="muted small" style="margin-top:6px">${new Date(q.answered_at || q.created_at).toLocaleString()}</div>
    </div>`;
  }

  $("#ask-btn")?.addEventListener("click", doAsk);
  $("#ask-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doAsk(); });

  async function doAsk() {
    const q = $("#ask-input").value.trim();
    if (!q) return;
    $("#ask-input").value = "";
    $("#ask-btn").disabled = true; $("#ask-btn").textContent = "Researching…";
    $("#ask-loading").classList.remove("hidden");
    $("#ask-result").innerHTML = "";
    try {
      const sc = currentScope();
      const out = await api("/api/ask", { method: "POST", body: { question: q, scope: sc } });
      $("#ask-result").innerHTML = qaCard({ ...out, answered_at: new Date().toISOString(), taxonomy_ids: [], scope: sc });
      loadHistory();
      if (ME.role === "reviewer") loadQueue();
    } catch (e) {
      $("#ask-result").innerHTML = `<div class="card" style="color:var(--red)">❌ ${esc(e.message)}</div>`;
    }
    $("#ask-loading").classList.add("hidden");
    $("#ask-btn").disabled = false; $("#ask-btn").textContent = "Ask";
  }

  async function loadHistory() {
    try {
      const h = await api("/api/history?limit=10");
      $("#history").innerHTML = h.entries.length
        ? h.entries.map(qaCard).join("")
        : '<p class="muted small">No questions yet.</p>';
    } catch (e) { $("#history").innerHTML = ""; }
  }

  // ---------- SOURCES ----------
  function fillSourceFormSelects() {
    if (!TAX) return;
    $("#src-jur").innerHTML = '<option value="">Jurisdiction (auto)</option>' + TAX.jurisdictions.map((j) => `<option>${j}</option>`).join("");
    $("#src-inst").innerHTML = '<option value="">Instrument type (auto)</option>' + TAX.instruments.map((j) => `<option>${j}</option>`).join("");
    fillScopeSelects();
  }

  // ---------- ASK SCOPE ----------
  const SCOPE_AREAS = [
    ["A", "A · Data Protection & Privacy"],
    ["A.1", "A.1 · GDPR (EU)"],
    ["A.3", "A.3 · FADP (Switzerland)"],
    ["A.4", "A.4 · ePrivacy"],
    ["A.5", "A.5 · International transfers"],
    ["A.7", "A.7 · Sectoral privacy"],
    ["A.8", "A.8 · Intl frameworks (108+)"],
    ["B", "B · AI & Digital Regulation"],
    ["B.1", "B.1 · EU AI Act"],
    ["B.2", "B.2 · DSA"],
    ["B.5", "B.5 · NIS2 & Cyber"],
    ["C", "C · Information Governance"],
  ];

  function fillScopeSelects() {
    if (!TAX) return;
    $("#scope-jur").innerHTML = '<option value="">Any jurisdiction</option>' + TAX.jurisdictions.map((j) => `<option>${j}</option>`).join("");
    $("#scope-inst").innerHTML = '<option value="">Any instrument</option>' + TAX.instruments.map((j) => `<option>${j}</option>`).join("");
    $("#scope-area").innerHTML = '<option value="">Any legal area</option>' + SCOPE_AREAS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    ["#scope-jur", "#scope-area", "#scope-origin", "#scope-status", "#scope-inst", "#scope-body"].forEach((sel) =>
      $(sel)?.addEventListener("input", updateScopeHint));
    $("#scope-clear")?.addEventListener("click", () => {
      ["#scope-jur", "#scope-area", "#scope-origin", "#scope-status", "#scope-inst", "#scope-body"].forEach((sel) => { $(sel).value = ""; });
      updateScopeHint();
    });
  }

  function currentScope() {
    const sc = {};
    const j = $("#scope-jur")?.value; if (j) sc.jurisdiction = j;
    const a = $("#scope-area")?.value; if (a) sc.taxonomy_area = a;
    const o = $("#scope-origin")?.value; if (o) sc.origin = o;
    const t = $("#scope-status")?.value; if (t) sc.temporal_status = t;
    const i = $("#scope-inst")?.value; if (i) sc.instrument = i;
    const b = $("#scope-body")?.value.trim(); if (b) sc.issuing_body = b;
    return Object.keys(sc).length ? sc : null;
  }

  function updateScopeHint() {
    const sc = currentScope();
    const hint = $("#scope-hint");
    if (!hint) return;
    if (!sc) { hint.classList.add("hidden"); hint.textContent = ""; return; }
    const labels = { jurisdiction: "jurisdiction", taxonomy_area: "legal area", origin: "origin", temporal_status: "status", instrument: "instrument", issuing_body: "issuing body" };
    hint.textContent = "🎯 Scoping active — answers limited to: " + Object.entries(sc).map(([k, v]) => `${labels[k]}=${v}`).join(", ");
    hint.classList.remove("hidden");
  }

  const JUR_FLAGS = { EU: "🇪🇺", UK: "🇬🇧", CH: "🇨🇭", INTL: "🌐", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", AT: "🇦🇹", ES: "🇪🇸", NL: "🇳🇱", BE: "🇧🇪", US: "🇺🇸" };
  const AREA_LABELS = { A: "Data Protection", B: "AI & Digital", C: "Info Governance", Z: "Unclassified" };

  function srcCard(s) {
    const st = { proposed: "amber", approved: "green", rejected: "red" }[s.status] || "";
    const cls = s.classification || {};
    const tags = (s.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("");
    const ids = (s.taxonomy_ids || []).map((t) => `<span class="badge blue" title="${esc(TAX?.nodes?.[t] || t)}">${esc(t)}${TAX?.nodes?.[t] ? " · " + esc(TAX.nodes[t]) : ""}</span>`).join("");
    const conf = cls.confidence ? `<span class="badge" title="Classification confidence">conf ${Math.round(cls.confidence * 100) / 100}</span>` : "";
    const jur = s.jurisdiction || "INTL";
    const temporal = cls.temporal_status && cls.temporal_status !== "IN_FORCE" ? `<span class="badge amber">${esc(cls.temporal_status.replace("_", " ").toLowerCase())}</span>` : "";
    const origin = cls.origin === "internal" ? '<span class="badge purple">internal</span>' : "";
    const body = cls.issuing_body ? `<span class="badge">🏛 ${esc(cls.issuing_body)}</span>` : "";
    const reviewed = s.reviewed_at ? `<span class="muted small">reviewed ${new Date(s.reviewed_at).toLocaleDateString()}</span>` : "";
    return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start">
        <div style="display:flex;gap:10px;align-items:flex-start;min-width:0">
          <span style="font-size:22px;line-height:1.2">${JUR_FLAGS[jur] || "🌐"}</span>
          <div style="min-width:0">
            <h3 style="margin:0">${s.url ? `<a href="${esc(s.url)}" target="_blank" style="color:var(--text)">${esc(s.title)}</a>` : esc(s.title)}</h3>
            ${cls.description ? `<p class="muted small" style="margin:4px 0 0">${esc(cls.description.slice(0, 220))}${cls.description.length > 220 ? "…" : ""}</p>` : ""}
          </div>
        </div>
        <span class="badge ${st}">${esc(s.status)}</span>
      </div>
      <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        ${ids}${tags}${conf}<span class="badge">${JUR_FLAGS[jur] || ""} ${esc(jur)}</span><span class="badge purple">${esc((s.instrument || "").replace("_", " ").toLowerCase())}</span>${temporal}${origin}${body}
        ${reviewed ? `<span style="margin-left:auto">${reviewed}</span>` : ""}
      </div>
      ${cls.rationale ? `<p class="muted small" style="margin-top:8px">💡 ${esc(cls.rationale)}</p>` : ""}
    </div>`;
  }

  function srcFilterState() {
    return {
      search: ($("#srcf-search")?.value || "").trim().toLowerCase(),
      jur: $("#srcf-jur")?.value || "",
      area: $("#srcf-area")?.value || "",
      inst: $("#srcf-inst")?.value || "",
      status: $("#srcf-status")?.value || "",
      origin: $("#srcf-origin")?.value || "",
      tstatus: $("#srcf-tstatus")?.value || "",
    };
  }

  function srcInFilter(s, f) {
    if (f.search) {
      const hay = ((s.title || "") + " " + ((s.classification || {}).issuing_body || "") + " " + ((s.classification || {}).description || "") + " " + ((s.classification || {}).rationale || "")).toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    if (f.jur && (s.jurisdiction || "INTL") !== f.jur) return false;
    if (f.area && !(s.taxonomy_ids || []).some((i) => String(i).toUpperCase() === f.area || String(i).toUpperCase().startsWith(f.area + "."))) return false;
    if (f.inst && (s.instrument || "") !== f.inst) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.origin && String(((s.classification || {}).origin) || "external") !== f.origin) return false;
    if (f.tstatus && String(((s.classification || {}).temporal_status) || "IN_FORCE") !== f.tstatus) return false;
    return true;
  }

  function renderSourceStats(rows) {
    const approved = rows.filter((s) => s.status === "approved").length;
    const proposed = rows.filter((s) => s.status === "proposed").length;
    const rejected = rows.filter((s) => s.status === "rejected").length;
    const byJur = {};
    rows.forEach((s) => { const j = s.jurisdiction || "INTL"; byJur[j] = (byJur[j] || 0) + 1; });
    const byArea = {};
    rows.forEach((s) => { const a = ((s.taxonomy_ids || [])[0] || "Z").split(".")[0]; byArea[a] = (byArea[a] || 0) + 1; });
    const avgConf = rows.length
      ? rows.reduce((a, s) => a + (s.classification?.confidence || 0), 0) / rows.length : 0;
    const jurEntries = Object.entries(byJur).sort((a, b) => b[1] - a[1]);
    const maxJur = Math.max(1, ...jurEntries.map(([, n]) => n));
    $("#src-stats").innerHTML = `
      <div class="src-stat"><div class="num">${rows.length}</div><div class="lbl">Total sources</div><div class="sub">${jurEntries.length} jurisdictions</div></div>
      <div class="src-stat green"><div class="num">${approved}</div><div class="lbl">Approved</div><div class="sub">grounding answers</div></div>
      <div class="src-stat amber"><div class="num">${proposed}</div><div class="lbl">Awaiting review</div><div class="sub">${rejected ? rejected + " rejected" : "none rejected"}</div></div>
      <div class="src-stat purple"><div class="num">${rows.length ? Math.round(avgConf * 100) : 0}%</div><div class="lbl">Avg classification</div><div class="sub">confidence</div></div>`;
    const barRow = (label, n) => `<div class="src-bar-row"><span class="bl">${label}</span><div class="src-bar-track"><div class="src-bar-fill" style="width:${Math.round((n / maxJur) * 100)}%"></div></div><span class="bn">${n}</span></div>`;
    let bars = `<div class="src-bars" id="src-bars"><h4>By jurisdiction</h4>${jurEntries.map(([j, n]) => barRow((JUR_FLAGS[j] || "") + " " + j, n)).join("")}</div>`;
    const areaEntries = Object.entries(byArea).sort((a, b) => b[1] - a[1]);
    const maxArea = Math.max(1, ...areaEntries.map(([, n]) => n));
    bars += `<div class="src-bars" style="margin-top:-8px"><h4>By legal area</h4>${areaEntries.map(([a, n]) =>
      `<div class="src-bar-row"><span class="bl">${a} · ${AREA_LABELS[a] || a}</span><div class="src-bar-track"><div class="src-bar-fill" style="width:${Math.round((n / maxArea) * 100)}%"></div></div><span class="bn">${n}</span></div>`).join("")}</div>`;
    document.querySelectorAll("#sources .src-bars").forEach((el) => el.remove());
    $("#src-stats").insertAdjacentHTML("afterend", bars);
  }

  function renderSourceList() {
    const rows = state.sources || [];
    renderSourceStats(rows);
    const f = srcFilterState();
    const filtered = rows.filter((s) => srcInFilter(s, f));
    const active = Object.values(f).some(Boolean);
    const hint = $("#srcf-hint");
    if (hint) {
      if (active) {
        hint.textContent = `🔍 Showing ${filtered.length} of ${rows.length} sources`;
        hint.classList.remove("hidden");
      } else { hint.classList.add("hidden"); }
    }
    $("#sources-list").innerHTML = filtered.length
      ? filtered.map(srcCard).join("")
      : (rows.length
        ? '<p class="muted small">No sources match the current filters.</p>'
        : '<p class="muted small">No sources yet.</p>');
  }

  function wireSourceFilters() {
    ["#srcf-search", "#srcf-jur", "#srcf-area", "#srcf-inst", "#srcf-status", "#srcf-origin", "#srcf-tstatus"].forEach((sel) =>
      $(sel)?.addEventListener("input", renderSourceList));
    $("#srcf-clear")?.addEventListener("click", () => {
      ["#srcf-search", "#srcf-jur", "#srcf-area", "#srcf-inst", "#srcf-status", "#srcf-origin", "#srcf-tstatus"].forEach((sel) => { $(sel).value = ""; });
      renderSourceList();
    });
  }

  function fillSourceFilterSelects() {
    if (!TAX) return;
    $("#srcf-jur").innerHTML = '<option value="">All jurisdictions</option>' + TAX.jurisdictions.map((j) => `<option>${j}</option>`).join("");
    $("#srcf-inst").innerHTML = '<option value="">All instruments</option>' + TAX.instruments.map((j) => `<option>${j}</option>`).join("");
    $("#srcf-area").innerHTML = '<option value="">All legal areas</option>' + SCOPE_AREAS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    wireSourceFilters();
  }

  async function loadSources() {
    try {
      const r = await api("/api/sources");
      state.sources = r.sources;
      fillSourceFilterSelects();
      renderSourceList();
    } catch (e) { $("#sources-list").innerHTML = ""; }
  }

  $("#src-btn")?.addEventListener("click", async () => {
    const title = $("#src-title").value.trim();
    if (!title) return toast("Title required");
    $("#src-btn").disabled = true;
    try {
      await api("/api/sources", { method: "POST", body: {
        title, url: $("#src-url").value.trim() || null, description: $("#src-desc").value.trim() || null,
        jurisdiction: $("#src-jur").value || null, instrument_type: $("#src-inst").value || null,
      } });
      toast("✅ Proposed — awaiting reviewer approval");
      $("#src-title").value = $("#src-url").value = $("#src-desc").value = "";
      await loadSources();
      if (ME.role === "reviewer") loadQueue();
    } catch (e) { toast("❌ " + e.message); }
    $("#src-btn").disabled = false;
  });

  // ---------- KB ----------
  async function loadKB() {
    try {
      const r = await api("/api/kb");
      const groups = {};
      for (const it of r.knowledge_items) {
        const dom = (it.taxonomy_ids?.[0] || "Z").split(".")[0];
        (groups[dom] = groups[dom] || []).push(it);
      }
      const domNames = { A: "A · Data Protection & Privacy", B: "B · AI & Digital Regulation", C: "C · Information Governance", Z: "Z · Unclassified" };
      let html = `<p class="muted small" style="margin-bottom:18px">${r.knowledge_items.length} approved knowledge items · ${r.sources.length} approved sources</p>`;
      for (const dom of ["A", "B", "C", "Z"]) {
        if (!groups[dom]) continue;
        html += `<div class="kb-group"><h2>${domNames[dom] || dom}</h2>` + groups[dom].map((it) => `
          <div class="card" style="margin-bottom:10px">
            <div class="qa-a">${esc(it.content)}</div>
            <div class="qa-meta">
              ${(it.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}</span>`).join("")}
              ${(it.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("")}
              ${it.sources?.title ? `<span class="cit">from: <b>${esc(it.sources.title)}</b></span>` : ""}
            </div>
          </div>`).join("") + `</div>`;
      }
      if (!r.knowledge_items.length) html += '<p class="muted">Knowledge base is empty — propose sources and let the reviewer extract knowledge.</p>';
      $("#kb-content").innerHTML = html;
    } catch (e) { $("#kb-content").innerHTML = `<p style="color:var(--red)">${esc(e.message)}</p>`; }
  }

  // ---------- REVIEW (reviewer only) ----------
  function reviewActions(entity, row, extra) {
    return `<div class="row-actions">
      <button class="btn small green" data-act="approve" data-entity="${entity}" data-id="${row.id}">✓ Approve</button>
      <button class="btn small amber" data-act="revise" data-entity="${entity}" data-id="${row.id}">✎ Revise & approve</button>
      <button class="btn small red" data-act="reject" data-entity="${entity}" data-id="${row.id}">✕ Reject</button>
      ${extra || ""}
    </div>`;
  }

  async function loadQueue() {
    try {
      const q = await api("/api/review/queue");
      state.queue = q;
      const n = q.pending_items.length + q.pending_sources.length + q.gap_flags.length;
      $("#review-count").textContent = n ? String(n) : "";
      $("#rv-items").innerHTML = q.pending_items.length ? q.pending_items.map((it) => `
        <div class="card review-item" style="margin-bottom:12px" id="ki-${it.id}">
          <div class="qa-a">${esc(it.content)}</div>
          <div class="qa-meta">
            ${(it.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${it.taxonomy_labels?.[t] ? " · " + esc(it.taxonomy_labels[t]) : ""}</span>`).join("")}
            ${(it.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("")}
            ${it.sources?.title ? `<span class="cit">from: <b>${esc(it.sources.title)}</b></span>` : ""}
          </div>
          ${it.ai_rationale ? `<p class="muted small" style="margin-top:6px">AI rationale: ${esc(it.ai_rationale)}</p>` : ""}
          <textarea class="rv hidden" id="rv-note-ki-${it.id}" placeholder="Reviewer notes / revised content"></textarea>
          ${reviewActions("knowledge_item", it)}
        </div>`).join("") : '<p class="muted small">No pending knowledge items. Approve a source and run "Extract knowledge".</p>';
      $("#rv-sources").innerHTML = q.sources.length ? q.sources.map((s) => `
        <div class="card review-item ${s.status}" style="margin-bottom:12px" id="src-${s.id}">
          <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <h3 style="margin:0">${s.url ? `<a href="${esc(s.url)}" target="_blank" style="color:var(--text)">${esc(s.title)}</a>` : esc(s.title)}</h3>
            <span class="badge ${{ proposed: "amber", approved: "green", rejected: "red" }[s.status] || ""}">${esc(s.status)}</span>
          </div>
          <div style="margin-top:8px">${(s.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${s.taxonomy_labels?.[t] ? " · " + esc(s.taxonomy_labels[t]) : ""}</span>`).join("")}${(s.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("")}<span class="badge">${esc(s.jurisdiction || "INTL")}</span><span class="badge purple">${esc(s.instrument || "")}</span></div>
          ${s.classification?.rationale ? `<p class="muted small" style="margin-top:8px">${esc(s.classification.rationale)}</p>` : ""}
          <textarea class="rv hidden" id="rv-note-source-${s.id}" placeholder="Reviewer notes / revised title"></textarea>
          ${reviewActions("source", s, `<button class="btn small" data-act="extract" data-id="${s.id}">🧠 Extract knowledge</button>`)}
        </div>`).join("") : '<p class="muted small">No sources yet.</p>';
      $("#rv-gaps").innerHTML = q.gap_flags.length ? q.gap_flags.map((g) => `
        <div class="card review-item" style="margin-bottom:12px">
          <div class="qa-q">🕳 ${esc(g.question)}</div>
          <p class="muted small">${esc(g.reason || "")} · ${new Date(g.created_at).toLocaleDateString()}</p>
          <div class="row-actions">
            <button class="btn small green" data-act="approve" data-entity="gap_flag" data-id="${g.id}">✓ Curated (close)</button>
            <button class="btn small red" data-act="reject" data-entity="gap_flag" data-id="${g.id}">✕ Dismiss</button>
          </div>
        </div>`).join("") : '<p class="muted small">No open gaps — KB covered everything so far. 🎉</p>';
      $("#rv-users").innerHTML = (await api("/api/review/users")).users.map((u) => `
        <div class="card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div><b>${esc(u.email)}</b> <span class="badge ${u.role === "reviewer" ? "purple" : "blue"}">${esc(u.role)}</span>
          <div class="muted small">joined ${new Date(u.created_at).toLocaleDateString()}</div></div>
          <div>${u.role === "reviewer"
            ? `<button class="btn small" data-act="demote" data-email="${esc(u.email)}">Make user</button>`
            : `<button class="btn small green" data-act="promote" data-email="${esc(u.email)}">Make reviewer</button>`}</div>
        </div>`).join("");
      wireReviewButtons();
    } catch (e) { console.error(e); }
  }

  function wireReviewButtons() {
    $$("#review button[data-act]").forEach((b) => b.addEventListener("click", async () => {
      const act = b.dataset.act;
      b.disabled = true;
      try {
        if (act === "extract") {
          toast("🧠 Extracting knowledge from source… this can take a moment");
          const r = await api("/api/review/extract", { method: "POST", body: { source_id: Number(b.dataset.id) } });
          toast(`✅ Extracted ${r.extracted} items into your review queue`);
        } else if (act === "promote" || act === "demote") {
          await api("/api/review/users/role", { method: "POST", body: { email: b.dataset.email, role: act === "promote" ? "reviewer" : "user" } });
          toast("✅ Role updated");
        } else {
          const entity = b.dataset.entity, id = Number(b.dataset.id);
          const noteEl = document.getElementById(`rv-note-${entity}-${id}`);
          let notes = noteEl ? noteEl.value.trim() : "";
          let body = { id, action: act, entity, notes: notes || null };
          if (act === "revise" && noteEl) {
            if (entity === "knowledge_item") body.updated_content = notes;
            if (entity === "source") body.updated_title = notes;
          }
          await api("/api/review/action", { method: "POST", body });
          toast(`✅ ${act === "approve" ? "Approved" : act === "reject" ? "Rejected" : "Revised & approved"}`);
        }
        await loadQueue();
        loadKB(); loadSources();
      } catch (e) { toast("❌ " + e.message); b.disabled = false; }
    }));
    // toggle note boxes on "revise"
    $$('#review button[data-act="revise"]').forEach((b) => b.addEventListener("click", (e) => {
      const el = document.getElementById(`rv-note-${b.dataset.entity}-${b.dataset.id}`);
      if (el && el.classList.contains("hidden")) { el.classList.remove("hidden"); el.focus(); e.stopImmediatePropagation(); }
    }, true));
  }

  $("#manual-btn")?.addEventListener("click", async () => {
    const content = $("#manual-content").value.trim();
    if (content.length < 10) return toast("Content too short");
    try {
      await api("/api/review/items/create", { method: "POST", body: { content } });
      toast("✅ Added to knowledge base (auto-tagged)");
      $("#manual-content").value = "";
      loadKB();
    } catch (e) { toast("❌ " + e.message); }
  });

  boot().catch((e) => { console.error(e); showLogin(); });
})();
