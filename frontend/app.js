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
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "***" + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401) { showLogin(); throw new Error("session expired"); }
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
    try { ME = await api("/api/me"); } catch (e) {
      console.error("enterApp failed:", e);
      alert("Login OK but profile load failed: " + e.message);
      showLogin(); return;
    }
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
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
      const out = await api("/api/ask", { method: "POST", body: { question: q } });
      $("#ask-result").innerHTML = qaCard({ ...out, answered_at: new Date().toISOString(), taxonomy_ids: [] });
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
  }

  function srcCard(s) {
    const st = { proposed: "amber", approved: "green", rejected: "red" }[s.status] || "";
    const tags = (s.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("");
    const ids = (s.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${s.taxonomy_labels?.[t] ? " · " + esc(s.taxonomy_labels[t]) : ""}</span>`).join("");
    const conf = s.classification?.confidence ? `<span class="badge">conf ${Math.round(s.classification.confidence * 100) / 100}</span>` : "";
    return `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <h3 style="margin:0">${s.url ? `<a href="${esc(s.url)}" target="_blank" style="color:var(--text)">${esc(s.title)}</a>` : esc(s.title)}</h3>
        <span class="badge ${st}">${esc(s.status)}</span>
      </div>
      <div style="margin-top:8px">${ids}${tags}${conf}<span class="badge">${esc(s.jurisdiction || "INTL")}</span><span class="badge purple">${esc(s.instrument || "")}</span></div>
      ${s.classification?.rationale ? `<p class="muted small" style="margin-top:8px">${esc(s.classification.rationale)}</p>` : ""}
    </div>`;
  }

  async function loadSources() {
    try {
      const r = await api("/api/sources");
      state.sources = r.sources;
      $("#sources-list").innerHTML = r.sources.length ? r.sources.map(srcCard).join("") : '<p class="muted small">No sources yet.</p>';
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
