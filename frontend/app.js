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

  function wireThemeToggle() {
    const toggle = $("#theme-toggle");
    if (!toggle) return;
    const applyTheme = (theme, persist) => {
      const selected = theme === "light" ? "light" : "dark";
      const target = selected === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = selected;
      toggle.setAttribute("aria-pressed", String(selected === "light"));
      toggle.setAttribute("aria-label", `Switch to ${target} mode`);
      toggle.title = `Switch to ${target} mode`;
      $("#theme-toggle-label").textContent = `${target[0].toUpperCase()}${target.slice(1)} mode`;
      $("#theme-toggle-icon").textContent = target === "light" ? "☀️" : "🌙";
      if (persist) {
        try { localStorage.setItem("ddp-workbench-theme", selected); } catch (e) {}
      }
    };
    let saved = "dark";
    try { saved = localStorage.getItem("ddp-workbench-theme") === "light" ? "light" : "dark"; } catch (e) {}
    applyTheme(saved, false);
    toggle.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light", true);
    });
  }

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
    wireAff();
    await Promise.all([loadHistory(), loadSources(), ME.role === "reviewer" ? loadQueue() : Promise.resolve()]);
    // Honour a deep link (#compliance/cookies) on load, else show the default screen.
    const initial = routeFromHash();
    if (location.hash) showScreen(initial);
  }

  // login moved to /login.html
  // ---------- nav ----------
  function routeFromHash() {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    // #compliance/notices and #compliance/cookies are the shareable module links.
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "compliance" && parts[1] === "notices") return "auditor";
    if (parts[0] === "compliance" && parts[1] === "cookies") return "cookies";
    // #compliance/affiliates is the unified annual affiliate workspace.
    // #compliance/icta is kept as a backwards-compatible alias (old links/emails).
    if (parts[0] === "compliance" && parts[1] === "affiliates") return "affiliates";
    if (parts[0] === "compliance" && parts[1] === "icta") return "affiliates";
    const id = parts[0] || "ask";
    if (id === "compliance") return "compliance";
    if (id === "auditor") return "auditor";
    if (id === "cookies") return "cookies";
    // #icta is the retired screen id; send legacy bookmarks to the new workspace.
    if (id === "icta") return "affiliates";
    if (id === "affiliates") return "affiliates";
    if (["ask", "kb", "sources", "review"].includes(id)) return id;
    return "ask";
  }

  function showScreen(id) {
    if (id === "review" && ME && ME.role !== "reviewer") return;
    $$(".nav-link").forEach((x) => x.classList.toggle("active", x.dataset.screen === id));
    $$(".screen").forEach((s) => s.classList.toggle("visible", s.id === id));
    if (id === "kb") loadKB();
    if (id === "review") loadQueue();
    if (id === "compliance") loadHub();
    if (id === "auditor") { loadAudits(); loadMonitors(); }
    if (id === "cookies") { loadCookieScans(); loadCookieMonitors(); }
    if (id === "affiliates") { normalizeAffiliateHash(); renderAff(); }
    if (id === "ask") { if (ASK_MODE === "chat") loadThreads(); else loadHistory(); }
  }

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
      const target = id === "compliance" ? "#compliance" : "#" + id;
      if (location.hash !== target) location.hash = target;
      else showScreen(id);   // same hash → no hashchange event, render explicitly
    }));
    // In-screen links (hub cards, breadcrumbs) are plain anchors — intercept them too.
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || a.classList.contains("nav-link")) return;
      e.preventDefault();
      const h = a.getAttribute("href");
      if (location.hash === h) showScreen(routeFromHash()); else location.hash = h;
    });
    window.addEventListener("hashchange", () => showScreen(routeFromHash()));
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

  // Collapsed row for the Single-mode history: question on one line, two-line
  // answer preview, full answer + citations only after expanding.
  function qaHistoryRow(q, i) {
    const cits = (q.citations || []).map((c) =>
      `<span class="cit">↳ <b>${esc(c.kind === "source" ? "source" : c.kind === "qa" ? "prior Q&A" : "knowledge")}</b>: ${esc(c.title)}</span>`).join("<br>");
    const tags = (q.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${TAX?.nodes?.[t] ? " · " + esc(TAX.nodes[t]) : ""}</span>`).join("");
    const key = "qa" + (q.id ?? i);
    const meta = `<div class="chat-meta">
        ${q.kb_reused ? '<span class="badge green">KB reuse</span>' : ""}
        <span class="badge">confidence ${Math.round((q.confidence ?? 0) * 100) / 100}</span>
        <span class="badge">${esc(q.jurisdiction || "INTL")}</span>
        ${q.scope ? Object.entries(q.scope).map(([k, v]) => `<span class="badge purple">🎯 ${esc(k.replace("_", " "))}: ${esc(v)}</span>`).join("") : ""}
        ${q.kb_counts ? `<span class="badge">KB in scope: ${q.kb_counts.items_in_scope} items / ${q.kb_counts.sources_in_scope} sources</span>` : ""}
        ${tags}
      </div>`;
    return `<div class="thread-item" data-qa="${key}">
      <div class="thread-row">
        <span class="thread-caret" data-qa-toggle="${key}">▸</span>
        <div class="thread-main">
          <div class="thread-name">${esc(q.question)}</div>
          <div class="thread-sub">${esc(relTime(q.answered_at || q.created_at))}${q.kb_grounded === false ? " · KB silent" : ""}</div>
        </div>
      </div>
      <div class="thread-summary qa-preview">${esc(q.answer)}</div>
      <div class="thread-more hidden" data-qa-more="${key}">
        <div class="qa-full">${esc(q.answer)}</div>
        ${meta}
        ${cits ? `<div style="margin-top:8px">${cits}</div>` : '<div style="margin-top:8px" class="cit">↳ general legal knowledge (KB did not cover this — flagged for curation)</div>'}
        <div class="muted small" style="margin-top:6px">${new Date(q.answered_at || q.created_at).toLocaleString()}</div>
      </div>
    </div>`;
  }

  $("#ask-btn")?.addEventListener("click", doAsk);
  $("#ask-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doAsk(); });

  async function doAsk() {
    if (ASK_MODE === "chat") return sendChat();
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

  // ---------- ASK MODES ----------
  const ASKMODE_HINTS = {
    single: "One question, one cited answer.",
    chat: "Multi-turn thread — follow-ups keep the context. Each conversation is titled and saved.",
  };
  let ASK_MODE = "single";
  let CHAT_THREAD_ID = null;

  function setAskMode(mode) {
    ASK_MODE = mode === "chat" ? "chat" : "single";
    $$(".seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.askmode === ASK_MODE));
    const hint = $("#ask-mode-hint");
    if (hint) hint.textContent = ASKMODE_HINTS[ASK_MODE];
    $("#ask-form-wrap")?.classList.remove("hidden");
    $("#chat-pane")?.classList.toggle("hidden", ASK_MODE !== "chat");
    $("#history-heading").textContent = ASK_MODE === "chat" ? "🗂 Your conversations" : "💬 Your recent questions";
    $("#ask-input").placeholder = ASK_MODE === "chat"
      ? "Ask anything — then follow up in the same thread…"
      : "e.g. Do the EDPB legitimate-interest guidelines change our cookie analytics position?";
    $("#ask-btn").textContent = ASK_MODE === "chat" ? "Send" : "Ask";
    if (ASK_MODE === "chat") {
      // Never show an empty pane: either resume the open thread or start fresh.
      const box = $("#chat-thread");
      if (!box.innerHTML.trim() || !box.querySelector(".chat-msg, .card")) newConversation();
      else loadThreads();
    } else { loadHistory(); }
  }

  $$(".seg-btn").forEach((b) => b.addEventListener("click", () => setAskMode(b.dataset.askmode)));

  // ---------- CONVERSATIONS ----------
  function chatMsgHtml(m) {
    const isUser = m.role === "user";
    const cits = (m.citations || []).map((c) =>
      `<span class="cit">↳ <b>${esc(c.kind === "source" ? "source" : "knowledge")}</b>: ${esc(c.title)}</span>`).join("<br>");
    const meta = isUser ? "" : `<div class="chat-meta">
        <span class="badge">confidence ${Math.round((m.confidence ?? 0) * 100) / 100}</span>
        <span class="badge">${esc(m.jurisdiction || "INTL")}</span>
        ${m.kb_grounded ? '<span class="badge green">KB-grounded</span>' : '<span class="badge amber">KB silent</span>'}
      </div>${cits ? `<div style="margin-top:8px">${cits}</div>` : ""}`;
    return `<div class="chat-msg ${isUser ? "user" : "assistant"}">
      <div class="av">${isUser ? "🙋" : "§"}</div>
      <div class="chat-bub">${esc(m.content)}${meta}</div>
    </div>`;
  }

  function renderThread(thread, messages) {
    const box = $("#chat-thread");
    $("#chat-title").textContent = (thread && thread.title) || "New conversation";
    $("#chat-sub").textContent = messages?.length
      ? `${messages.length} message${messages.length === 1 ? "" : "s"}`
      : "";
    box.innerHTML = messages?.length
      ? messages.map(chatMsgHtml).join("")
      : '<div class="chat-empty muted small">Nothing here yet — ask your first question above and the thread starts.</div>';
    box.scrollTop = box.scrollHeight;
  }

  async function openThread(id) {
    CHAT_THREAD_ID = id;
    try {
      const r = await api("/api/threads/" + id);
      renderThread(r.thread, r.messages);
      $("#chat-followups").innerHTML = "";
      loadThreads();
    } catch (e) { toast("❌ " + e.message); }
  }

  function newConversation() {
    CHAT_THREAD_ID = null;
    $("#chat-title").textContent = "New conversation";
    renderThread(null, []);
    $("#chat-followups").innerHTML = "";
    $("#ask-input")?.focus();
    loadThreads();
  }

  function relTime(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d === 1) return "yesterday";
    if (d < 7) return `${d}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  function threadItem(t) {
    const active = String(t.id) === String(CHAT_THREAD_ID);
    const msgs = Number(t.message_count || 0);
    const summary = (t.summary || "").trim();
    const more = t.has_more && (t.last_excerpt || "");
    return `<div class="thread-item ${active ? "active" : ""}" data-thread="${t.id}">
      <div class="thread-row">
        <span class="thread-caret" data-thread-toggle="${t.id}" title="${more ? "Show last activity" : "No extra turns"}"${more ? "" : ' aria-disabled="true"'}>${more ? "▸" : "·"}</span>
        <div class="thread-main">
          <div class="thread-name">${esc(t.title || "Untitled")}</div>
          <div class="thread-sub">${msgs} message${msgs === 1 ? "" : "s"} · ${esc(relTime(t.last_message_at))}</div>
        </div>
        <button class="thread-del" data-thread-del="${t.id}" title="Delete conversation">🗑</button>
      </div>
      ${summary ? `<div class="thread-summary">${esc(summary)}</div>` : ""}
      ${more ? `<div class="thread-more hidden" data-thread-more="${t.id}">
        <span class="thread-more-role">${t.last_role === "assistant" ? "Last answer" : "Last question"}</span>
        <span>${esc(t.last_excerpt)}</span>
      </div>` : ""}
    </div>`;
  }

  async function loadThreads() {
    const el = $("#history");
    if (!el) return;
    try {
      const r = await api("/api/threads?limit=30");
      if (!r.threads.length) {
        el.innerHTML = '<p class="muted small">No conversations yet. Ask something to start the first one.</p>';
        return;
      }
      el.innerHTML = r.threads.map(threadItem).join("");

      // Caret expands the last turn in place, without opening the thread.
      $$('#history [data-thread-toggle]').forEach((c) => c.addEventListener("click", (e) => {
        e.stopPropagation();
        if (c.getAttribute("aria-disabled") === "true") return;
        const more = el.querySelector(`[data-thread-more="${c.dataset.threadToggle}"]`);
        if (!more) return;
        const open = !more.classList.toggle("hidden");
        c.textContent = open ? "▾" : "▸";
      }));

      $$('#history [data-thread]').forEach((d) => d.addEventListener("click", (e) => {
        if (e.target.closest("[data-thread-del], [data-thread-toggle]")) return;
        openThread(d.dataset.thread);
      }));
      $$('#history [data-thread-del]').forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this conversation and its messages?")) return;
        b.disabled = true;
        try {
          await api("/api/threads/" + b.dataset.threadDel, { method: "DELETE" });
          if (String(CHAT_THREAD_ID) === String(b.dataset.threadDel)) newConversation();
          else loadThreads();
          toast("🗑 Conversation deleted");
        } catch (err) { toast("❌ " + err.message); b.disabled = false; }
      }));
    } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  async function sendChat() {
    const input = $("#ask-input");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    $("#ask-btn").disabled = true; $("#ask-btn").textContent = "Thinking…";
    $("#chat-loading").classList.remove("hidden");
    const box = $("#chat-thread");
    if (!box.querySelector(".chat-msg")) box.innerHTML = "";
    box.insertAdjacentHTML("beforeend", chatMsgHtml({ role: "user", content: msg }));
    box.scrollTop = box.scrollHeight;
    try {
      const sc = currentScope();
      if (!CHAT_THREAD_ID) {
        const created = await api("/api/threads", { method: "POST", body: { scope: sc } });
        CHAT_THREAD_ID = created.thread.id;
      }
      const out = await api("/api/threads/" + CHAT_THREAD_ID + "/message", {
        method: "POST", body: { message: msg, scope: sc },
      });
      box.insertAdjacentHTML("beforeend", chatMsgHtml(out.message));
      box.scrollTop = box.scrollHeight;
      $("#chat-title").textContent = out.title || "Conversation";
      $("#chat-followups").innerHTML = (out.followups || []).length
        ? out.followups.map((f) => `<button data-followup="${esc(f)}">💡 ${esc(f)}</button>`).join("")
        : "";
      $$("#chat-followups [data-followup]").forEach((b) => b.addEventListener("click", () => {
        input.value = b.dataset.followup;
        sendChat();
      }));
      loadThreads();
      if (ME.role === "reviewer") loadQueue();
    } catch (e) {
      box.insertAdjacentHTML("beforeend",
        `<div class="card" style="color:var(--red)">❌ ${esc(e.message)}</div>`);
    }
    $("#chat-loading").classList.add("hidden");
    $("#ask-btn").disabled = false; $("#ask-btn").textContent = "Send";
  }

  $("#chat-new-btn")?.addEventListener("click", newConversation);

  async function loadHistory() {
    const el = $("#history");
    if (!el) return;
    try {
      const h = await api("/api/history?limit=10");
      if (!h.entries.length) {
        el.innerHTML = '<p class="muted small">No questions yet.</p>';
        return;
      }
      el.innerHTML = h.entries.map((q, i) => qaHistoryRow(q, i)).join("");
      $$('#history [data-qa-toggle]').forEach((c) => c.addEventListener("click", (e) => {
        e.stopPropagation();
        const more = el.querySelector(`[data-qa-more="${c.dataset.qaToggle}"]`);
        const preview = c.closest(".thread-item")?.querySelector(".qa-preview");
        if (!more) return;
        const open = !more.classList.toggle("hidden");
        c.textContent = open ? "▾" : "▸";
        if (preview) preview.classList.toggle("hidden", open);
      }));
      $$('#history [data-qa]').forEach((d) => d.addEventListener("click", (e) => {
        if (e.target.closest("[data-qa-toggle]")) return;
        e.currentTarget.querySelector("[data-qa-toggle]")?.click();
      }));
    } catch (e) { el.innerHTML = ""; }
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
    ["C.3", "C.3 · eDiscovery & legal hold"],
    ["C.3.1", "C.3.1 · Cross-border discovery"],
    ["C.3.2", "C.3.2 · Legal hold & preservation"],
    ["C.3.3", "C.3.3 · Collection, processing & review"],
    ["C.3.4", "C.3.4 · Privilege & production"],
    ["C.3.5", "C.3.5 · Spoliation & defensibility"],
    ["C.3.6", "C.3.6 · Disposition & closure"],
    ["D", "D · Employment Law"],
    ["D.4", "D.4 · Employment data & monitoring"],
  ];

  function fillScopeSelects() {
    if (!TAX) return;
    $("#scope-jur").innerHTML = '<option value="">Jurisdiction</option>' + TAX.jurisdictions.map((j) => `<option>${j}</option>`).join("");
    $("#scope-inst").innerHTML = '<option value="">Instrument</option>' + TAX.instruments.map((j) => `<option>${j}</option>`).join("");
    $("#scope-area").innerHTML = '<option value="">Legal area</option>' + SCOPE_AREAS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    ["#scope-jur", "#scope-area", "#scope-origin", "#scope-status", "#scope-inst", "#scope-body"].forEach((sel) =>
      $(sel)?.addEventListener("input", updateScopeHint));
    ["#scope-jur", "#scope-area", "#scope-origin", "#scope-status", "#scope-inst"].forEach((sel) =>
      $(sel)?.addEventListener("change", updateScopeHint));
    $("#scope-clear")?.addEventListener("click", () => {
      ["#scope-jur", "#scope-area", "#scope-origin", "#scope-status", "#scope-inst", "#scope-body"].forEach((sel) => { $(sel).value = ""; });
      updateScopeHint();
    });
    updateScopeHint();
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
    const clearBtn = $("#scope-clear");
    if (clearBtn) clearBtn.classList.toggle("hidden", !sc);
    if (!hint) return;
    if (!sc) { hint.classList.add("hidden"); hint.innerHTML = ""; return; }
    const labels = { jurisdiction: "Jurisdiction", taxonomy_area: "Area", origin: "Origin", temporal_status: "Status", instrument: "Instrument", issuing_body: "Body" };
    hint.innerHTML = Object.entries(sc)
      .map(([k, v]) => `<span class="scope-chip">${esc(labels[k] || k)}: <b>${esc(v)}</b></span>`)
      .join("");
    hint.classList.remove("hidden");
  }

  const JUR_FLAGS = { EU: "🇪🇺", UK: "🇬🇧", CH: "🇨🇭", INTL: "🌐", DE: "🇩🇪", FR: "🇫🇷", IT: "🇮🇹", AT: "🇦🇹", ES: "🇪🇸", NL: "🇳🇱", BE: "🇧🇪", US: "🇺🇸" };
  const AREA_LABELS = { A: "Data Protection", B: "AI & Digital", C: "Info Governance", D: "Employment", Z: "Unclassified" };

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
      caselaw: $("#srcf-caselaw")?.classList.contains("primary") || false,
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
    if (f.caselaw && !["JUDGMENT", "DPA_DECISION"].includes((s.instrument || "").toUpperCase())) return false;
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
    $("#srcf-caselaw")?.addEventListener("click", () => {
      const btn = $("#srcf-caselaw");
      btn.classList.toggle("primary");
      renderSourceList();
    });
    $("#srcf-clear")?.addEventListener("click", () => {
      ["#srcf-search", "#srcf-jur", "#srcf-area", "#srcf-inst", "#srcf-status", "#srcf-origin", "#srcf-tstatus"].forEach((sel) => { $(sel).value = ""; });
      $("#srcf-caselaw")?.classList.remove("primary");
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

  // ---------- KB — KNOWLEDGE NAVIGATOR ----------
  const KB = { items: [], sources: [], node: null, search: "", jur: "", caselaw: false };

  function countUnder(prefix) {
    // direct = tagged with exactly this node; total = tagged with this node or any descendant
    let direct = 0, total = 0, srcTot = 0;
    const pfx = prefix + ".";
    const pool = KB.caselaw ? KB.items.filter(isCaseLaw) : KB.items;
    for (const it of pool) {
      const ids = it.taxonomy_ids || [];
      if (ids.some((i) => i === prefix)) direct++;
      if (ids.some((i) => i === prefix || String(i).startsWith(pfx))) total++;
    }
    for (const s of KB.sources) {
      const ids = s.taxonomy_ids || [];
      if (ids.some((i) => i === prefix || String(i).startsWith(pfx))) srcTot++;
    }
    return { direct, total, srcTot };
  }

  function nodeChildren(prefix) {
    const kids = [];
    const pfx = prefix + ".";
    const seen = {};
    for (const id of Object.keys(TAX?.nodes || {})) {
      if (!id.startsWith(pfx)) continue;
      const rest = id.slice(pfx.length);
      if (rest.includes(".")) continue;           // grandchild
      const selfId = TAX.nodes[prefix];
      // only show children that exist in taxonomy (id already does)
      kids.push(id);
      seen[id] = true;
    }
    return kids.sort();
  }

  function kbCntClass(total, direct) {
    if (direct >= 5) return "g"; if (direct >= 1) return "a"; return "";
  }

  function kbNodeRow(id, activeId) {
    const label = TAX?.nodes?.[id] || id;
    const c = countUnder(id);
    const cls = c.total >= 5 ? "g" : c.total >= 1 ? "a" : "";
    const active = id === activeId ? " active" : "";
    const empty = c.total === 0 ? ' style="opacity:.55"' : "";
    return `<div class="kb-node"${empty}><div class="kb-node-link${active}" data-node="${esc(id)}" title="${esc(label)}">
      <span>${esc(label.length > 34 ? label.slice(0, 32) + "…" : label)}</span>
      <span class="cnt ${cls}">${c.total ? c.total : "–"}</span>
    </div><div class="kb-node-children" data-parent="${esc(id)}"></div></div>`;
  }

  function kbRenderTree(activeId) {
    const tree = $("#kb-tree");
    if (!TAX) { tree.innerHTML = ""; return; }
    const tops = ["A", "B", "C", "D", "Z"].filter((t) => TAX.nodes[t]);
    // Helper: node path parts for a dotted id (A.3.4 → [A, A.3, A.3.4])
    const anc = (id) => {
      const parts = id.split("."), out = [];
      for (let i = 0; i < parts.length; i++) out.push(parts.slice(0, i + 1).join("."));
      return out;
    };
    const openSet = new Set();
    if (activeId) for (const a of anc(activeId)) openSet.add(a);
    const renderLevel = (prefix, depth) => {
      const kids = nodeChildren(prefix);
      if (!kids.length) return "";
      return kids.map((k) => {
        const row = kbNodeRow(k, activeId);
        const open = openSet.has(k) || (activeId && activeId.startsWith(k + "."));
        const childHtml = open ? renderLevel(k, depth + 1) : "";
        return row.replace('<div class="kb-node-children" data-parent="' + esc(k) + '"></div>',
                           '<div class="kb-node-children" data-parent="' + esc(k) + '">' + childHtml + "</div>");
      }).join("");
    };
    let html = tops.map((t) => {
      const row = kbNodeRow(t, activeId);
      const open = openSet.has(t) || (activeId && activeId.startsWith(t + ".")) || !activeId;
      const childHtml = open ? renderLevel(t, 1) : "";
      return row.replace('<div class="kb-node-children" data-parent="' + esc(t) + '"></div>',
                         '<div class="kb-node-children" data-parent="' + esc(t) + '">' + childHtml + "</div>");
    }).join("");
    if (KB.search) {
      const matches = kbSearchItems();
      const byNode = {};
      matches.forEach((it) => { (it.taxonomy_ids || ["Z"]).forEach((t) => { (byNode[t] = byNode[t] || []).push(it); }); });
      const mnodes = Object.keys(byNode).sort();
      if (mnodes.length) {
        html += `<div class="kb-node"><div class="kb-node-link" style="font-weight:700;color:var(--muted);cursor:default">search matches</div>` +
          mnodes.map((t) => `<div class="kb-node-link${t === (KB.node || "") ? " active" : ""}" data-node="${esc(t)}"><span>${esc(TAX?.nodes?.[t] || t)}</span><span class="cnt ${kbCntClass(0, byNode[t].length)}">${byNode[t].length}</span></div>`).join("") + "</div>";
      }
    }
    tree.innerHTML = html;
    tree.querySelectorAll(".kb-node-link[data-node]").forEach((el) =>
      el.addEventListener("click", () => kbSelect(el.dataset.node)));
  }

  function kbSearchItems() {
    const q = KB.search.toLowerCase();
    return KB.items.filter((it) =>
      (it.content || "").toLowerCase().includes(q)
      || (it.tags || []).some((t) => t.toLowerCase().includes(q))
      || (it.sources?.title || "").toLowerCase().includes(q)
      || ((it.taxonomy_ids || []).some((t) => (TAX?.nodes?.[t] || t).toLowerCase().includes(q))));
  }

  const CASE_LAW_INSTR = ["JUDGMENT", "DPA_DECISION"];
  function isCaseLaw(it) {
    if ((it.tags || []).some((t) => String(t).toLowerCase() === "case-law")) return true;
    const inst = (it.sources?.instrument || "").toUpperCase();
    return CASE_LAW_INSTR.includes(inst);
  }

  function kbItemsFor(nodeId) {
    const pfx = nodeId + ".";
    let items = KB.items.filter((it) => (it.taxonomy_ids || []).some((i) => i === nodeId || String(i).startsWith(pfx)));
    if (KB.jur) {
      items = items.filter((it) => {
        const srcJur = it.sources?.jurisdiction || (it.source_jur || "");
        return srcJur === KB.jur;
      });
    }
    if (KB.search) items = kbSearchItems().filter((it) => items.includes(it));
    return items;
  }

  function kbNoteCard(it) {
    const ids = (it.taxonomy_ids || []).map((t) => `<span class="badge blue">${esc(t)}${TAX?.nodes?.[t] ? " · " + esc(TAX.nodes[t]) : ""}</span>`).join("");
    const tags = (it.tags || []).map((t) => `<span class="badge">#${esc(t)}</span>`).join("");
    const src = it.sources?.title ? `<span class="from">💡 from: <b>${esc(it.sources.title)}</b>${it.sources?.url ? ` · <a href="${esc(it.sources.url)}" target="_blank">open source ↗</a>` : ""}</span>` : (it.origin_note ? `<span class="from">💡 ${esc(it.origin_note)}</span>` : "");
    return `<div class="kb-note-card">
      <div class="qa-a">${esc(it.content)}</div>
      <div class="qa-meta" style="margin-top:8px">${ids}${tags}</div>
      ${src ? `<div style="margin-top:8px">${src}</div>` : ""}
      ${it.reviewed_at ? `<div class="from" style="margin-top:4px">✅ reviewer-approved ${new Date(it.reviewed_at).toLocaleDateString()}${it.reviewed_by ? " · " + esc(it.reviewed_by) : ""}</div>` : ""}
    </div>`;
  }

  function kbRenderContent() {
    const el = $("#kb-content");
    const gov = KB.jur;   // governance lens = jurisdiction
    let items, context = "";
    if (KB.search) {
      items = kbSearchItems();
      if (KB.jur) items = items.filter((it) => (it.sources?.jurisdiction || it.source_jur || "") === KB.jur);
    } else if (KB.node) {
      items = kbItemsFor(KB.node);
    } else {
      items = KB.items.slice();
      if (KB.jur) items = items.filter((it) => (it.sources?.jurisdiction || it.source_jur || "") === KB.jur);
    }
    if (KB.caselaw) items = items.filter(isCaseLaw);
    if (KB.node && !KB.search && !items.length) {
      if (KB.caselaw) {
        el.innerHTML = `<div class="card" style="border-left:4px solid var(--amber,#d29922)">
          <h3 style="margin:0 0 6px">${esc(TAX?.nodes?.[KB.node] || KB.node)}</h3>
          <p class="muted">No case law in this area yet.</p>
          <p class="muted small">Turn off ⚖️ Case law only to see the other notes, or add a judgment source and extract it.</p>
        </div>`;
        return;
      }
      el.innerHTML = `<div class="card" style="border-left:4px solid var(--amber,#d29922)">
        <h3 style="margin:0 0 6px">${esc(TAX?.nodes?.[KB.node] || KB.node)}</h3>
        <p class="muted">No knowledge notes in this area yet.</p>
        <p class="muted small">${ME?.role === "reviewer"
          ? 'Use 🛡 Review → “Add knowledge”, tag it ' + esc(KB.node) + ', or extract knowledge from an approved source covering this area.'
          : 'Ask a question in ⚡ Ask — if the KB can\'t answer, it lands in the curation backlog.'}</p>
      </div>`;
      return;
    }
    let label = KB.node ? (TAX?.nodes?.[KB.node] || KB.node) : (KB.search ? `search: “${esc(KB.search)}”` : "All knowledge");
    if (KB.caselaw) label = "⚖️ Case law · " + label;
    const srcs = new Set(items.map((it) => it.sources?.title).filter(Boolean));
    const head = `<div class="kb-ann-head">
      <h2 style="margin:0">${label}</h2>
      <span class="badge">${items.length} notes</span>
      <span class="badge blue">${srcs.size} sources</span>
    </div>`;
    el.innerHTML = head + (items.length ? items.map(kbNoteCard).join("") : '<p class="muted">No matches. Try clearing the search or jurisdiction lens.</p>');
  }

  function kbRenderCrumb() {
    const cr = $("#kb-crumb");
    if (!KB.node || KB.search) { cr.classList.add("hidden"); cr.innerHTML = ""; return; }
    const parts = KB.node.split(".");
    let chain = [], acc = [];
    for (const p of parts) { acc.push(p); chain.push(acc.join(".")); }
    cr.innerHTML = '<a data-node="">🧭 Home</a>' + chain.map((c, i) =>
      ` <span class="sep">›</span> ${i === chain.length - 1 ? `<b>${esc(TAX?.nodes?.[c] || c)}</b>` : `<a data-node="${esc(c)}">${esc(TAX?.nodes?.[c] || c)}</a>`}`).join("")
      + (KB.jur ? ` <span class="sep">·</span> 🌐 <b>${esc(KB.jur)}</b>` : "");
    cr.classList.remove("hidden");
    cr.querySelectorAll("a[data-node]").forEach((a) => a.addEventListener("click", () => kbSelect(a.dataset.node || "")));
  }

  function kbSelect(nodeId) {
    KB.node = nodeId || null;
    if (nodeId) KB.search = "", $("#kb-search").value = "";
    kbRenderTree(KB.node);
    kbRenderCrumb();
    kbRenderContent();
  }

  async function loadKB() {
    try {
      const r = await api("/api/kb");
      KB.items = r.knowledge_items || [];
      KB.sources = r.sources || [];
      // jurisdiction lens options from approved sources
      const jurs = [...new Set(KB.sources.map((s) => s.jurisdiction).filter(Boolean))].sort();
      const cur = KB.jur;
      $("#kb-jur").innerHTML = '<option value="">🌐 All jurisdictions</option>' + jurs.map((j) => `<option${j === cur ? " selected" : ""}>${j}</option>`).join("");
      if (!KB._wiredSearch) {
        KB._wiredSearch = true;
        $("#kb-search").addEventListener("input", () => { KB.search = $("#kb-search").value.trim(); kbRenderTree(KB.node); kbRenderCrumb(); kbRenderContent(); });
        $("#kb-jur").addEventListener("change", () => { KB.jur = $("#kb-jur").value; kbRenderTree(KB.node); kbRenderCrumb(); kbRenderContent(); });
        $("#kb-caselaw")?.addEventListener("click", () => {
          KB.caselaw = !KB.caselaw;
          $("#kb-caselaw").classList.toggle("primary", KB.caselaw);
          kbRenderTree(KB.node); kbRenderCrumb(); kbRenderContent();
        });
      }
      if (!KB.node && !KB.search) { kbRenderTree(""); kbRenderContent(); }
      else { kbRenderTree(KB.node); kbRenderCrumb(); kbRenderContent(); }
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
      if (b.dataset.busy === "true") return; // hard guard against double-click
      const act = b.dataset.act;
      // freeze the whole action row: no second action while one is in flight
      const row = b.closest(".row-actions") || b.parentElement;
      const siblings = $$("button[data-act]", row);
      const prevLabel = b.textContent;
      siblings.forEach((s) => { s.disabled = true; s.dataset.prevLabel = s.textContent; });
      b.dataset.busy = "true";
      if (act === "extract") b.textContent = "Extracting…";
      else b.textContent = "Working…";
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
      } catch (e) {
        toast("❌ " + e.message);
        // restore buttons only on failure
        siblings.forEach((s) => { s.disabled = false; if (s.dataset.prevLabel) s.textContent = s.dataset.prevLabel; });
        delete b.dataset.busy;
        b.textContent = prevLabel;
      }
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

  // ---------- PRIVACY NOTICE AUDITOR ----------
  const gradeClass = (g) => "g-" + (["A", "B", "C", "D", "F"].includes(g) ? g : "F");
  const pctColor = (p) => (p >= 90 ? "#3fb950" : p >= 75 ? "var(--blue)" : p >= 60 ? "#d29922" : "#f85149");

  function domainBar(name, d) {
    const color = pctColor(d.pct);
    return `<div style="flex:1;min-width:160px">
      <div style="display:flex;justify-content:space-between;font-size:12.5px">
        <span>${esc(name)}${d.advisory ? ' <span class="badge" style="font-size:9.5px">advisory</span>' : ""}</span>
        <span class="muted">${d.passed}/${d.total} · ${d.pct}% <b style="color:${color}">${esc(d.grade)}</b></span>
      </div>
      <div class="scorebar"><i style="width:${d.pct}%;background:${color}"></i></div>
    </div>`;
  }

  function checkRow(c) {
    const failed = !c.passed;
    return `<div class="chk">
      <div class="mk">${failed ? "❌" : "✅"}</div>
      <div style="flex:1">
        <div style="${failed ? "" : "color:var(--muted)"}">${esc(c.title)}</div>
        <span class="ref">${esc(c.ref)}${failed ? "" : " · " + esc(c.detail || "")}</span>
        ${failed && c.evidence ? `<div class="ev">…${esc(c.evidence)}…</div>` : ""}
      </div>
    </div>`;
  }

  function auditCard(r, id) {
    const s = r.scores || {};
    const dom = s.domains || {};
    const llm = r.llm;
    const checks = r.checks || [];
    const fails = checks.filter((c) => !c.passed);
    const passes = checks.filter((c) => c.passed);
    const order = ["GDPR", "ePrivacy", "Swiss FADP"];

    const warnHtml = (r.warnings || []).map((w) => `<div class="aud-warn">⚠︎ ${esc(w)}</div>`).join("");

    const llmHtml = llm
      ? `<div class="card" style="margin-top:14px;background:var(--bg2)">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
            <h3 style="margin:0">🧠 Qualitative review</h3>
            <div>
              <span class="badge blue">${esc(llm.jurisdiction_guess || "?")}</span>
              <span class="badge">plain language ${esc(llm.plain_language_score ?? "?")}/10</span>
            </div>
          </div>
          ${llm.summary ? `<p class="small" style="margin-bottom:12px">${esc(llm.summary)}</p>` : ""}
          ${(llm.findings || []).map((f) => `<div class="aud-finding">
              <div><span class="pill ${esc(f.severity || "low")}">${esc(f.severity || "low")}</span>
              <b style="margin-left:6px">${esc(f.issue || "")}</b></div>
              ${f.ref ? `<div class="ref" style="font-size:11.5px;color:var(--muted)">${esc(f.ref)}</div>` : ""}
              ${f.quote ? `<div class="q">“${esc(f.quote)}”</div>` : ""}
              ${f.fix ? `<div class="small"><b style="color:#3fb950">Fix:</b> ${esc(f.fix)}</div>` : ""}
            </div>`).join("")}
          ${(llm.positive || []).length ? `<div class="small" style="margin-top:6px"><b class="muted">Done well:</b> ${llm.positive.map((p) => esc(p)).join(" · ")}</div>` : ""}
        </div>`
      : "";

    return `<div class="card" style="margin-top:16px"${id ? ` id="audit-${id}"` : ""}>
      <div class="grade-card">
        ${r.monitor_score_suppressed ? '<div class="aud-disclaimer" style="width:100%">Screening score withheld: this appears to be a privacy hub/index. Pin the applicable notice URL before relying on a score.</div>' : ""}
        <div class="grade-badge ${r.monitor_score_suppressed ? "" : gradeClass(s.overall_grade)}">
          <span class="g">${r.monitor_score_suppressed ? "—" : esc(s.overall_grade || "?")}</span>
          <span class="p">${r.monitor_score_suppressed ? "review" : esc(s.overall_pct ?? 0) + "%"}</span>
        </div>
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700;font-size:15px">${esc(r.label || r.notice_url || r.requested_url || "Audit")}</div>
          <div class="muted small" style="word-break:break-all">${esc(r.notice_url || "")}</div>
          <div class="muted small" style="margin-top:4px">${r.monitor_score_suppressed ? "Screening score withheld — this appears to be a notice hub" : `${esc(s.passed_count ?? 0)}/${esc(s.total_count ?? 0)} checks passed · ${esc((r.char_count || 0).toLocaleString())} chars analysed in full`}${r.llm_input_truncated ? ' · <b style="color:#d29922">AI review saw head+tail only</b>' : ""}${r.is_hub ? ' · <b style="color:#d29922">index page, not full notice</b>' : ""}</div>
        </div>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin:16px 0 4px">
        ${order.filter((k) => dom[k]).map((k) => domainBar(k, dom[k])).join("")}
      </div>
      ${r.monitor_id ? `<div class="aud-disclaimer" style="margin-top:12px">Automated text-pattern screening only — not a legal opinion or determination of compliance.</div>` : ""}
      ${r.review_changes ? `<div class="aud-change-box"><b>Scan comparison</b><div class="muted small">${(r.review_changes.new_findings || []).length} new finding(s) · ${(r.review_changes.recovered || []).length} recovered · ${(r.review_changes.ongoing || r.review_changes.still_failing || []).length} ongoing</div>${(r.created_reviews || []).length ? `<ul>${r.created_reviews.map(x => `<li><span class="pill ${esc(x.severity || "low")}">${esc(x.severity || "low")}</span> ${esc(x.title)}</li>`).join("")}</ul>` : ""}</div>` : ""}
      ${warnHtml}
      <h3 style="margin:18px 0 6px;font-size:14px">❌ Gaps (${fails.length})</h3>
      ${fails.length ? fails.map(checkRow).join("") : '<p class="muted small">No checklist failures. 🎉</p>'}
      ${llmHtml}
      ${passes.length ? `<details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Show ${passes.length} passed checks</summary><div style="margin-top:8px">${passes.map(checkRow).join("")}</div></details>` : ""}
      <div class="row-actions" style="margin-top:14px">
        ${r.notice_url ? `<a class="btn small" href="${esc(r.notice_url)}" target="_blank" rel="noopener">Open notice ↗</a>` : ""}
        ${r.monitor_id && r.notice_url ? `<button class="btn small" data-mon-pin="${esc(r.monitor_id)}" data-notice-url="${esc(r.notice_url)}">${r.is_hub ? "Use this notice for monitor" : "Pin discovered notice URL"}</button>` : ""}
        ${id ? `<button class="btn small red" data-aud-del="${id}">Delete</button>` : ""}
      </div>
    </div>`;
  }

  async function runAudit() {
    const url = $("#aud-url").value.trim();
    if (!url) return toast("Enter a URL");
    const btn = $("#aud-btn");
    btn.disabled = true; btn.textContent = "Auditing…";
    $("#aud-result").innerHTML = "";
    $("#aud-loading").classList.remove("hidden");
    try {
      const r = await api("/api/auditor/scan", { method: "POST", body: {
        url, label: $("#aud-label").value.trim() || null, deep: $("#aud-deep").checked,
      } });
      $("#aud-result").innerHTML = auditCard(r, r.id);
      wireAuditDelete();
      loadAudits();
    } catch (e) {
      $("#aud-result").innerHTML = `<div class="card" style="color:#f85149;margin-top:14px">❌ ${esc(e.message)}</div>`;
    }
    $("#aud-loading").classList.add("hidden");
    btn.disabled = false; btn.textContent = "Run one-off scan";
  }

  function wireAuditDelete() {
    $$("button[data-aud-del]").forEach((b) => {
      if (b.dataset.bound) return;
      b.dataset.bound = "1";
      b.addEventListener("click", async () => {
        if (!confirm("Delete this audit?")) return;
        b.disabled = true;
        try {
          await api("/api/auditor/scans/" + b.dataset.audDel, { method: "DELETE" });
          toast("🗑 Deleted");
          const card = document.getElementById("audit-" + b.dataset.audDel);
          if (card) card.remove();
          loadAudits();
        } catch (e) { toast("❌ " + e.message); b.disabled = false; }
      });
    });
  }

  async function loadAudits() {
    const el = $("#aud-history");
    if (!el) return;
    try {
      const r = await api("/api/auditor/scans?limit=25");
      if (!r.scans.length) { el.innerHTML = '<p class="muted small">No audits yet.</p>'; return; }
      el.innerHTML = r.scans.map((s) => {
        const g = s.scores?.overall_grade || "?";
        return `<div class="card" style="margin-bottom:9px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div class="grade-badge ${gradeClass(g)}" style="width:46px;height:46px;border-radius:12px">
            <span class="g" style="font-size:19px">${esc(g)}</span>
          </div>
          <div style="flex:1;min-width:180px">
            <div style="font-weight:600;font-size:13.5px">${esc(s.label || s.site_url)}</div>
            <div class="muted" style="font-size:11.5px;word-break:break-all">${esc(s.notice_url || s.site_url)}</div>
            <div class="muted" style="font-size:11px">${new Date(s.created_at).toLocaleString()} · ${esc(s.scores?.overall_pct ?? 0)}%</div>
          </div>
          <div class="row-actions" style="margin:0">
            <button class="btn small" data-aud-open="${s.id}">View</button>
            <button class="btn small red" data-aud-del="${s.id}">🗑</button>
          </div>
        </div>`;
      }).join("");
      $$('#aud-history button[data-aud-open]').forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const row = await api("/api/auditor/scans/" + b.dataset.audOpen);
          $("#aud-result").innerHTML = auditCard({ ...(row.result || {}), label: row.label }, row.id);
          wireAuditDelete();
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) { toast("❌ " + e.message); }
        b.disabled = false;
      }));
      wireAuditDelete();
    } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  function monitorGradeClass(grade) { return grade ? `g-${String(grade).toUpperCase()}` : ""; }

  function monitorSpark(history) {
    const points = (history || []).filter(x => x.status === "done" && Number.isFinite(Number(x.scores?.overall_pct)));
    if (points.length < 2) return '<div class="mon-spark-empty">Trend will appear after another scan.</div>';
    const vals = points.map(x => Number(x.scores.overall_pct));
    const min = Math.min(...vals, 0), max = Math.max(...vals, 100), span = Math.max(max - min, 10), w=240, h=34;
    const xy = vals.map((v,i) => `${(i/(vals.length-1))*w},${h-((v-min)/span)*h}`).join(" ");
    // Colour by the latest grade, not by direction: an F trending up is still an F.
    const last = points.at(-1);
    const grade = String((last.scores || {}).overall_grade || "").toUpperCase();
    const color = { A: "#3fb950", B: "#4f8cff", C: "#d29922", D: "#fb923c", F: "#f85149" }[grade] || "#8b96b8";
    const pct = vals.at(-1);
    return `<svg viewBox="0 0 ${w} ${h}" class="mon-spark" preserveAspectRatio="none" role="img" aria-label="Score trend, latest ${pct}% (grade ${grade || 'n/a'})"><polyline points="${xy}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function renderMonitors(data) {
    const t=data.totals||{}; const sites=data.monitors||[];
    $("#mon-kpis").innerHTML=`<div class="mon-kpi"><b>${esc(t.sites||0)}</b><span>websites</span></div><div class="mon-kpi"><b>${t.avg_score==null?"—":esc(t.avg_score)+"%"}</b><span>avg screening score</span></div><div class="mon-kpi ${t.high_pending?"alert":""}"><b>${esc(t.pending||0)}</b><span>pending review</span></div><div class="mon-kpi"><b>${esc(t.high_pending||0)}</b><span>high priority</span></div>`;
    $("#mon-sites").innerHTML=sites.length?sites.map(m=>{
      const status=m.last_status||"scheduled",grade=m.last_grade||"—";
      return `<article class="card mon-site"><div class="mon-site-top"><div class="mon-site-id"><b>${esc(m.label)}</b><a href="${esc(m.site_url)}" target="_blank" rel="noopener">${esc(m.site_url)}</a>${m.notice_url?`<a class="mon-notice-url" href="${esc(m.notice_url)}" target="_blank" rel="noopener">Notice: ${esc(m.notice_url)}</a>`:""}</div><div class="grade-badge ${monitorGradeClass(grade)}" title="Screening only"><span class="g">${esc(grade)}</span><span class="p">${m.last_score==null?"—":esc(m.last_score)+"%"}</span></div></div>
      ${monitorSpark(m.history)}<div class="mon-meta"><span class="mon-status ${status}">${esc(status)}</span><span>Last: ${m.last_scan_at?esc(new Date(m.last_scan_at).toLocaleString()):"Not scanned"}</span><span>Next: ${esc(new Date(m.next_scan_at).toLocaleString())}</span><span>Every ${esc(m.interval_hours)}h</span><span>${m.pending_reviews?`🧑‍⚖️ ${esc(m.pending_reviews)} to review`:"✓ No pending reviews"}</span></div>${m.last_error?`<div class="aud-warn">${esc(m.last_error)}</div>`:""}
      <div class="mon-actions"><button class="btn small primary" data-mon-scan="${esc(m.id)}">Scan now</button><button class="btn small" data-mon-toggle="${esc(m.id)}" data-enabled="${m.enabled?"1":"0"}">${m.enabled?"Pause":"Resume"}</button><button class="btn small red" data-mon-delete="${esc(m.id)}">Remove</button></div></article>`;
    }).join(""):'<div class="card muted small">No websites tracked yet. Add one above to start monitoring.</div>';
    const reviews=data.reviews||[];
    const reviewDetailHtml = (detail) => {
      const lines = String(detail || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      if (!lines.length) return "";
      const lead = lines.find(x => /^(Potential gap|Possible regression|Possible recurring gap|Possible new gap):/i.test(x));
      if (!lead) return `<p class="small mon-review-detail">${esc(lines.join(" "))}</p>`;
      const scope = lines.find(x => /^Scope warning:/i.test(x));
      const extra = lines.filter(x => x !== lead && x !== scope);
      return `<div class="mon-review-detail"><p class="mon-review-summary">${esc(lead)}</p>
        ${scope ? `<p class="mon-review-scope">⚠ ${esc(scope.replace(/^Scope warning:\s*/i, ""))}</p>` : ""}
        ${extra.length ? `<details class="mon-review-more"><summary>Why it matters · what to verify</summary><div>${extra.map(x => `<p>${esc(x)}</p>`).join("")}</div></details>` : ""}</div>`;
    };
    $("#mon-reviews").innerHTML=reviews.length?`<div class="mon-review-list">${reviews.map(r=>{const m=sites.find(x=>String(x.id)===String(r.monitor_id));return `<article class="mon-review"><div class="mon-review-head"><span class="pill ${esc(r.severity)}">${esc(r.severity)}</span><b>${esc(r.title)}</b></div><div class="muted small">${esc(m?.label||"Website")} · ${esc(String(r.kind).replace(/_/g," "))} · ${esc(new Date(r.created_at).toLocaleString())}</div>${reviewDetailHtml(r.detail)}<div class="mon-actions"><button class="btn small" data-mon-review="${esc(r.id)}" data-status="in_review">Reviewing</button><button class="btn small" data-mon-review="${esc(r.id)}" data-status="resolved">Resolve</button><button class="btn small" data-mon-review="${esc(r.id)}" data-status="accepted">Accept risk</button><button class="btn small" data-mon-review="${esc(r.id)}" data-status="false_positive">False positive</button></div></article>`}).join("")}</div>`:'<div class="card muted small">✨ Review queue clear — no pending findings.</div>';
    wireMonitorActions();
  }

  async function loadMonitors() {
    if(!$("#mon-sites"))return;
    try{renderMonitors(await api("/api/auditor/monitors"));}
    catch(e){$("#mon-sites").innerHTML=`<div class="card" style="color:var(--red)">Monitor unavailable: ${esc(e.message)}. The database migration may need to be applied.</div>`;}
  }

  function wireMonitorActions() {
    $$('[data-mon-pin]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{b.disabled=true;try{await api(`/api/auditor/monitors/${b.dataset.monPin}/notice-url`,{method:"POST",body:{notice_url:b.dataset.noticeUrl}});toast("Notice URL pinned — rescan is due");await loadMonitors();}catch(e){toast("❌ "+e.message);}finally{b.disabled=false;}};});
    $$('[data-mon-scan]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{b.disabled=true;b.textContent="Scanning…";try{await api(`/api/auditor/monitors/${b.dataset.monScan}/scan-lock`,{method:"POST"});const r=await api(`/api/auditor/monitors/${b.dataset.monScan}/scan`,{method:"POST"});$("#aud-result").innerHTML=auditCard(r,r.id);wireAuditDelete();toast(`${(r.created_reviews||[]).length} new review item(s)`);await loadMonitors();window.scrollTo({top:0,behavior:"smooth"});}catch(e){toast("❌ "+e.message);}finally{b.disabled=false;b.textContent="Scan now";}};});
    $$('[data-mon-toggle]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{b.disabled=true;try{await api(`/api/auditor/monitors/${b.dataset.monToggle}`,{method:"PATCH",body:{enabled:b.dataset.enabled!=="1"}});await loadMonitors();}catch(e){toast("❌ "+e.message);b.disabled=false;}};});
    $$('[data-mon-delete]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{if(!confirm("Stop monitoring this site and delete its scan/review history?"))return;b.disabled=true;try{await api(`/api/auditor/monitors/${b.dataset.monDelete}`,{method:"DELETE"});toast("Website monitor removed");await loadMonitors();}catch(e){toast("❌ "+e.message);b.disabled=false;}};});
    $$('[data-mon-review]').forEach(b=>{if(b.dataset.bound)return;b.dataset.bound="1";b.onclick=async()=>{b.disabled=true;try{await api(`/api/auditor/monitor-reviews/${b.dataset.monReview}`,{method:"PATCH",body:{status:b.dataset.status}});toast("Review updated");await loadMonitors();}catch(e){toast("❌ "+e.message);b.disabled=false;}};});
  }

  $("#mon-add-btn")?.addEventListener("click",async()=>{
    const url=$("#mon-url").value.trim();if(!url)return toast("Enter a website URL");const b=$("#mon-add-btn");b.disabled=true;b.textContent="Adding…";
    try{const out=await api("/api/auditor/monitors",{method:"POST",body:{url,label:$("#mon-label").value.trim()||null,notice_url:$("#mon-notice-url").value.trim()||null,interval_hours:Number($("#mon-interval").value),qualitative_review:$("#mon-qualitative").checked}});$("#mon-url").value="";$("#mon-notice-url").value="";$("#mon-label").value="";$("#mon-qualitative").checked=false;toast(out.existing?"Monitor updated":"Website added — first scan is due");await loadMonitors();}
    catch(e){toast("❌ "+e.message);}finally{b.disabled=false;b.textContent="＋ Track website";}
  });
  $("#mon-refresh")?.addEventListener("click",loadMonitors);

  $("#aud-btn")?.addEventListener("click", runAudit);
  $("#aud-url")?.addEventListener("keydown", (e) => { if (e.key === "Enter") runAudit(); });


  // ═══════════════════ Compliance Center hub ═══════════════════

  function hubKpis(s) {
    if (!s) return '<span class="muted small">No data</span>';
    const avg = s.avg_score == null ? "—" : s.avg_score + "%";
    const last = s.last_scan_at ? new Date(s.last_scan_at).toLocaleDateString() : "never";
    return `<span><b>${esc(s.sites ?? 0)}</b> tracked</span>
      <span><b>${esc(avg)}</b> avg score</span>
      <span class="${s.pending ? "warn" : ""}"><b>${esc(s.pending ?? 0)}</b> to review</span>
      <span class="muted">last scan ${esc(last)}</span>`;
  }

  function hubGrades(s) {
    const g = (s && s.grades) || {};
    const total = Object.values(g).reduce((a, b) => a + b, 0);
    if (!total) return "";
    return `<div class="hub-grades">${["A", "B", "C", "D", "F"].filter((k) => g[k])
      .map((k) => `<span class="grade-badge tiny ${gradeClass(k)}"><span class="g">${k}</span><span class="p">${g[k]}</span></span>`).join("")}</div>`;
  }

  async function loadHub() {
    const nEl = $("#hub-notices-kpis"), cEl = $("#hub-cookies-kpis");
    // Demo card KPIs are static — no backend involved.
    const aEl = $("#hub-affiliates-kpis");
    if (aEl) {
      const k = affKpis(AFF.defaultCycle);
      aEl.innerHTML = `<span><b>${k.entities}</b> affiliates</span>
        <span><b>${k.agreementsCurrent}</b> agreements current</span>
        <span><b>${k.assessmentsSubmitted}</b> assessments submitted</span>
        <span><b>${k.declarationsSubmitted}</b> declarations submitted</span>
        <span class="warn"><b>${k.attention}</b> need attention</span>
        <span class="muted">sample data</span>`;
    }
    if (!nEl && !cEl) return;
    try {
      const s = await api("/api/compliance/summary");
      if (nEl) { nEl.innerHTML = hubKpis(s.notices); }
      if (cEl) { cEl.innerHTML = hubKpis(s.cookies); }
      const nCard = nEl && nEl.closest(".hub-card");
      const cCard = cEl && cEl.closest(".hub-card");
      if (nCard) nCard.querySelector(".hub-go").insertAdjacentHTML("beforebegin", hubGrades(s.notices));
      if (cCard) cCard.querySelector(".hub-go").insertAdjacentHTML("beforebegin", hubGrades(s.cookies));
      const badge = $("#compliance-count");
      if (badge) {
        const total = (s.notices?.pending || 0) + (s.cookies?.pending || 0);
        badge.textContent = total ? String(total) : "";
        badge.classList.toggle("hidden", !total);
      }
    } catch (e) {
      if (nEl) nEl.innerHTML = `<span class="muted small">Unavailable: ${esc(e.message)}</span>`;
      if (cEl) cEl.innerHTML = `<span class="muted small">Unavailable: ${esc(e.message)}</span>`;
    }
  }

  // ═══════════════════ Cookie & Tracker Compliance ═══════════════════

  const COOKIE_JURIS_LABEL = {
    "EU": "EU / EEA", "CH": "Switzerland", "UK": "United Kingdom", "US-CA": "California",
  };

  function jurisChips(list) {
    return (list || []).map((j) => `<span class="badge blue">${esc(COOKIE_JURIS_LABEL[j] || j)}</span>`).join(" ");
  }

  function cookieSpark(history) {
    const pts = (history || []).filter((x) => x.status === "done" && Number.isFinite(Number(x.scores?.overall_pct)));
    if (pts.length < 2) return '<div class="mon-spark-empty">Trend will appear after another scan.</div>';
    const vals = pts.map((x) => Number(x.scores.overall_pct));
    const min = Math.min(...vals, 0), max = Math.max(...vals, 100), span = Math.max(max - min, 10), w = 240, h = 34;
    const xy = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / span) * h}`).join(" ");
    const grade = String((pts.at(-1).scores || {}).overall_grade || "").toUpperCase();
    const color = { A: "#3fb950", B: "#4f8cff", C: "#d29922", D: "#fb923c", F: "#f85149" }[grade] || "#8b96b8";
    return `<svg viewBox="0 0 ${w} ${h}" class="mon-spark" preserveAspectRatio="none" role="img" aria-label="Cookie score trend, latest ${vals.at(-1)}% (grade ${grade || "n/a"})"><polyline points="${xy}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  }

  function cookieSignalsBlock(sig) {
    if (!sig) return "";
    const bit = (ok, yes, no) => `<span class="sig ${ok ? "ok" : "no"}">${ok ? "✓" : "✕"} ${esc(ok ? yes : no)}</span>`;
    const cookies = sig.preconsent_nonessential || [];
    return `<div class="ck-signals">
      ${bit(sig.has_banner, "Banner in HTML", "No banner in HTML")}
      ${bit(sig.has_reject, "Reject option", "No reject option")}
      ${bit(sig.cmp, `CMP: ${sig.cmp || ""}`, "No known CMP")}
      ${bit(sig.tcf || sig.google_consent_mode, "Consent signals", "No TCF/Consent Mode")}
      ${bit(sig.total_cookies === 0, `${sig.total_cookies} cookie(s) set`, `${sig.total_cookies} cookie(s) set`)}
    </div>
    ${cookies.length ? `<div class="aud-warn" style="margin-top:8px"><b>${cookies.length} non-essential cookie(s) observed before consent:</b> ${cookies.slice(0, 10).map((c) => esc(c.name) + (c.vendor ? ` <span class="muted">(${esc(c.vendor)})</span>` : "")).join(", ")}</div>` : ""}
    ${(sig.trackers || []).length ? `<div class="muted small" style="margin-top:6px"><b>Trackers in page source:</b> ${sig.trackers.map((t) => esc(t)).join(" · ")}</div>` : ""}`;
  }

  function cookieResultCard(r, id) {
    const s = r.scores || {};
    const dom = s.domains || {};
    const order = ["Transparency", "Technical", "ePrivacy", "FADP/TCA", "CCPA/CPRA"];
    const checks = r.checks || [];
    const fails = checks.filter((c) => !c.passed);
    const passes = checks.filter((c) => c.passed);
    const warnHtml = (r.warnings || []).length
      ? `<div class="aud-warn" style="margin-top:10px">${r.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")}</div>` : "";
    const limHtml = (r.limitations || []).length
      ? `<details class="mon-review-more" style="margin-top:10px"><summary>What this scan cannot verify</summary><div>${r.limitations.map((l) => `<p>${esc(l)}</p>`).join("")}</div></details>` : "";

    return `<div class="card" style="margin-top:16px"${id ? ` id="ckscan-${id}"` : ""}>
      <div class="grade-card">
        <div class="grade-badge ${gradeClass(s.overall_grade)}">
          <span class="g">${esc(s.overall_grade || "?")}</span>
          <span class="p">${esc(s.overall_pct ?? 0)}%</span>
        </div>
        <div style="flex:1;min-width:220px">
          <div style="font-weight:700;font-size:15px">${esc(r.label || r.final_url || r.requested_url || "Cookie scan")}</div>
          <div class="muted small" style="word-break:break-all">${esc(r.final_url || r.requested_url || "")}</div>
          <div class="muted small" style="margin-top:4px">${esc(s.passed_count ?? 0)}/${esc(s.total_count ?? 0)} checks passed · <span class="badge">static analysis</span></div>
          <div style="margin-top:6px">${jurisChips(r.jurisdiction)}${(r.consent_model || []).map((m) => `<span class="badge">${esc(m)} model</span>`).join(" ")}</div>
        </div>
      </div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin:16px 0 4px">
        ${order.filter((k) => dom[k]).map((k) => domainBar(k, dom[k])).join("")}
      </div>
      ${cookieSignalsBlock(r.signals)}
      ${r.review_changes && (r.review_changes.new_findings || []).length ? `<div class="aud-change-box"><b>Scan comparison</b><div class="muted small">${r.review_changes.new_findings.length} new finding(s) · ${(r.review_changes.recovered || []).length} recovered · ${(r.review_changes.still_failing || []).length} ongoing</div></div>` : ""}
      ${warnHtml}
      <h3 style="margin:18px 0 6px;font-size:14px">❌ Gaps (${fails.length})</h3>
      ${fails.length ? fails.map(checkRow).join("") : '<p class="muted small">No checklist failures. 🎉</p>'}
      ${passes.length ? `<details style="margin-top:12px"><summary class="muted small" style="cursor:pointer">Show ${passes.length} passed checks</summary><div style="margin-top:8px">${passes.map(checkRow).join("")}</div></details>` : ""}
      ${limHtml}
      <div class="row-actions" style="margin-top:14px">
        ${r.signals?.cookie_policy_url ? `<a class="btn small" href="${esc(r.signals.cookie_policy_url)}" target="_blank" rel="noopener">Open cookie policy ↗</a>` : ""}
        ${id ? `<button class="btn small red" data-ck-del="${id}">Delete</button>` : ""}
      </div>
    </div>`;
  }

  async function runCookieScan() {
    const url = $("#ck-url").value.trim();
    if (!url) return toast("Enter a URL");
    const btn = $("#ck-btn");
    btn.disabled = true; btn.textContent = "Scanning…";
    $("#ck-result").innerHTML = "";
    $("#ck-loading").classList.remove("hidden");
    try {
      const r = await api("/api/cookies/scan", { method: "POST", body: {
        url, label: $("#ck-label").value.trim() || null, jurisdiction: $("#ck-juris").value,
      } });
      $("#ck-result").innerHTML = cookieResultCard(r, r.id);
      wireCookieDelete();
      loadCookieScans(); loadHub();
    } catch (e) {
      $("#ck-result").innerHTML = `<div class="card" style="color:var(--red);margin-top:14px">❌ ${esc(e.message)}</div>`;
    }
    $("#ck-loading").classList.add("hidden");
    btn.disabled = false; btn.textContent = "Run one-off scan";
  }

  function wireCookieDelete() {
    $$("button[data-ck-del]").forEach((b) => {
      if (b.dataset.bound) return;
      b.dataset.bound = "1";
      b.onclick = async () => {
        if (!confirm("Delete this cookie scan?")) return;
        b.disabled = true;
        try {
          await api("/api/cookies/scans/" + b.dataset.ckDel, { method: "DELETE" });
          toast("🗑 Deleted");
          document.getElementById("ckscan-" + b.dataset.ckDel)?.remove();
          loadCookieScans();
        } catch (e) { toast("❌ " + e.message); b.disabled = false; }
      };
    });
  }

  async function loadCookieScans() {
    const el = $("#ck-history");
    if (!el) return;
    try {
      const r = await api("/api/cookies/scans?limit=25");
      if (!r.scans.length) { el.innerHTML = '<p class="muted small">No cookie scans yet.</p>'; return; }
      el.innerHTML = r.scans.map((s) => {
        const g = s.scores?.overall_grade || "?";
        return `<div class="card" style="margin-bottom:9px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <div class="grade-badge ${gradeClass(g)}" style="width:46px;height:46px;border-radius:12px">
            <span class="g" style="font-size:19px">${esc(g)}</span>
          </div>
          <div style="flex:1;min-width:180px">
            <div style="font-weight:600;font-size:13.5px">${esc(s.label || s.site_url)}</div>
            <div class="muted" style="font-size:11.5px;word-break:break-all">${esc(s.site_url)}</div>
            <div class="muted" style="font-size:11px">${new Date(s.created_at).toLocaleString()} · ${esc(s.scores?.overall_pct ?? 0)}% · ${esc(s.jurisdiction || "")}</div>
          </div>
          <div class="row-actions" style="margin:0">
            <button class="btn small" data-ck-open="${s.id}">View</button>
            <button class="btn small red" data-ck-del="${s.id}">🗑</button>
          </div>
        </div>`;
      }).join("");
      $$('#ck-history button[data-ck-open]').forEach((b) => b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          const row = await api("/api/cookies/scans/" + b.dataset.ckOpen);
          $("#ck-result").innerHTML = cookieResultCard({ ...(row.result || {}), label: row.label }, row.id);
          wireCookieDelete();
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) { toast("❌ " + e.message); }
        b.disabled = false;
      }));
      wireCookieDelete();
    } catch (e) { el.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  function renderCookieMonitors(data) {
    const t = data.totals || {}, sites = data.monitors || [];
    $("#ck-kpis").innerHTML = `<div class="mon-kpi"><b>${esc(t.sites || 0)}</b><span>websites</span></div>
      <div class="mon-kpi"><b>${t.avg_score == null ? "—" : esc(t.avg_score) + "%"}</b><span>avg cookie score</span></div>
      <div class="mon-kpi ${t.pending ? "alert" : ""}"><b>${esc(t.pending || 0)}</b><span>pending review</span></div>
      <div class="mon-kpi"><b>${esc(t.high_pending || 0)}</b><span>high priority</span></div>`;

    $("#ck-sites").innerHTML = sites.length ? sites.map((m) => {
      const status = m.last_status || "scheduled", grade = m.last_grade || "—";
      return `<article class="card mon-site">
        <div class="mon-site-top">
          <div class="mon-site-id"><b>${esc(m.label)}</b>
            <a href="${esc(m.site_url)}" target="_blank" rel="noopener">${esc(m.site_url)}</a>
            <div style="margin-top:4px">${jurisChips(String(m.jurisdiction || "").split("+"))}</div>
          </div>
          <div class="grade-badge ${monitorGradeClass(grade)}" title="Screening only">
            <span class="g">${esc(grade)}</span><span class="p">${m.last_score == null ? "—" : esc(m.last_score) + "%"}</span>
          </div>
        </div>
        ${cookieSpark(m.history)}
        <div class="mon-meta"><span class="mon-status ${status}">${esc(status)}</span>
          <span>Last: ${m.last_scan_at ? esc(new Date(m.last_scan_at).toLocaleString()) : "Not scanned"}</span>
          <span>Next: ${esc(new Date(m.next_scan_at).toLocaleString())}</span>
          <span>Every ${esc(m.interval_hours)}h</span>
          <span>${m.pending_reviews ? `🧑‍⚖️ ${esc(m.pending_reviews)} to review` : "✓ No pending reviews"}</span></div>
        ${m.last_error ? `<div class="aud-warn">${esc(m.last_error)}</div>` : ""}
        <div class="mon-actions">
          <button class="btn small primary" data-ck-scan="${esc(m.id)}">Scan now</button>
          <button class="btn small" data-ck-toggle="${esc(m.id)}" data-enabled="${m.enabled ? "1" : "0"}">${m.enabled ? "Pause" : "Resume"}</button>
          <button class="btn small red" data-ck-remove="${esc(m.id)}">Remove</button>
        </div></article>`;
    }).join("") : '<div class="card muted small">No websites tracked yet. Add one above to start monitoring cookies.</div>';

    const reviews = data.reviews || [];
    $("#ck-reviews").innerHTML = reviews.length ? `<div class="mon-review-list">${reviews.map((r) => {
      const m = sites.find((x) => String(x.id) === String(r.monitor_id));
      return `<article class="mon-review">
        <div class="mon-review-head"><span class="pill ${esc(r.severity)}">${esc(r.severity)}</span><b>${esc(r.title)}</b></div>
        <div class="muted small">${esc(m?.label || "Website")} · ${esc(String(r.kind).replace(/_/g, " "))} · ${esc(new Date(r.created_at).toLocaleString())}</div>
        ${r.detail ? `<div class="mon-review-detail"><p class="mon-review-summary">${esc(r.detail.split("\n")[0])}</p>
          ${r.detail.split("\n").slice(1).filter(Boolean).length ? `<details class="mon-review-more"><summary>Why it matters · what to verify</summary><div>${r.detail.split("\n").slice(1).filter(Boolean).map((x) => `<p>${esc(x)}</p>`).join("")}</div></details>` : ""}</div>` : ""}
        <div class="mon-actions">
          <button class="btn small" data-ck-review="${esc(r.id)}" data-status="in_review">Reviewing</button>
          <button class="btn small" data-ck-review="${esc(r.id)}" data-status="resolved">Resolve</button>
          <button class="btn small" data-ck-review="${esc(r.id)}" data-status="accepted">Accept risk</button>
          <button class="btn small" data-ck-review="${esc(r.id)}" data-status="false_positive">False positive</button>
        </div></article>`;
    }).join("")}</div>` : '<div class="card muted small">✨ Cookie review queue clear — no pending findings.</div>';

    wireCookieMonitorActions();
  }

  async function loadCookieMonitors() {
    if (!$("#ck-sites")) return;
    try { renderCookieMonitors(await api("/api/cookies/monitors")); }
    catch (e) { $("#ck-sites").innerHTML = `<div class="card" style="color:var(--red)">Cookie monitor unavailable: ${esc(e.message)}</div>`; }
  }

  function wireCookieMonitorActions() {
    $$("[data-ck-scan]").forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = "1";
      b.onclick = async () => {
        b.disabled = true; b.textContent = "Scanning…";
        try {
          await api(`/api/cookies/monitors/${b.dataset.ckScan}/scan-lock`, { method: "POST" });
          const r = await api(`/api/cookies/monitors/${b.dataset.ckScan}/scan`, { method: "POST" });
          $("#ck-result").innerHTML = cookieResultCard(r, r.id);
          wireCookieDelete();
          toast(`${(r.created_reviews || []).length} new review item(s)`);
          await loadCookieMonitors(); loadCookieScans(); loadHub();
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e) { toast("❌ " + e.message); }
        finally { b.disabled = false; b.textContent = "Scan now"; }
      };
    });
    $$("[data-ck-toggle]").forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = "1";
      b.onclick = async () => {
        b.disabled = true;
        try {
          await api(`/api/cookies/monitors/${b.dataset.ckToggle}`, { method: "PATCH", body: { enabled: b.dataset.enabled !== "1" } });
          await loadCookieMonitors();
        } catch (e) { toast("❌ " + e.message); b.disabled = false; }
      };
    });
    $$("[data-ck-remove]").forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = "1";
      b.onclick = async () => {
        if (!confirm("Stop monitoring this site and delete its cookie scan history?")) return;
        b.disabled = true;
        try { await api(`/api/cookies/monitors/${b.dataset.ckRemove}`, { method: "DELETE" }); toast("Cookie monitor removed"); await loadCookieMonitors(); loadHub(); }
        catch (e) { toast("❌ " + e.message); b.disabled = false; }
      };
    });
    $$("[data-ck-review]").forEach((b) => {
      if (b.dataset.bound) return; b.dataset.bound = "1";
      b.onclick = async () => {
        b.disabled = true;
        try { await api(`/api/cookies/reviews/${b.dataset.ckReview}`, { method: "PATCH", body: { status: b.dataset.status } }); toast("Review updated"); await loadCookieMonitors(); loadHub(); }
        catch (e) { toast("❌ " + e.message); b.disabled = false; }
      };
    });
    const addBtn = $("#ck-mon-add");
    if (addBtn && !addBtn.dataset.bound) {
      addBtn.dataset.bound = "1";
      addBtn.onclick = async () => {
        const url = $("#ck-mon-url").value.trim();
        if (!url) return toast("Enter a website URL");
        addBtn.disabled = true;
        try {
          const out = await api("/api/cookies/monitors", { method: "POST", body: {
            url, label: $("#ck-mon-label").value.trim() || null,
            jurisdiction: $("#ck-mon-juris").value,
            interval_hours: Number($("#ck-mon-interval").value),
          } });
          $("#ck-mon-url").value = ""; $("#ck-mon-label").value = "";
          toast(out.existing ? "Monitor updated" : "Website added — first scan is due");
          await loadCookieMonitors(); loadHub();
        } catch (e) { toast("❌ " + e.message); }
        addBtn.disabled = false;
      };
    }
    const rf = $("#ck-refresh");
    if (rf && !rf.dataset.bound) { rf.dataset.bound = "1"; rf.onclick = () => loadCookieMonitors(); }
  }

  // ═══════════════ Affiliate Privacy Assurance (DEMO) ═══════════════
  //
  // One annual workspace per affiliate LEGAL ENTITY, with country as an
  // attribute. Three workstreams are tracked separately and never collapsed:
  //   1. Intracompany Data Transfer Agreement (ICTA)
  //   2. Privacy Maturity Self-Assessment
  //   3. Privacy Compliance Declaration
  // A derived "overall" status is shown *with its reason*.
  //
  // Everything below is fabricated demo data. No API calls, no database access,
  // no backend or schema involvement. The screen and hub card carry DEMO labels.
  //
  // "Complete" means the cycle's steps are recorded — NOT legal compliance.
  // The maturity score is a self-assessment, not a certification.

  // ── Workstream vocabularies (kept distinct on purpose) ─────────────
  const AFF_AGREEMENT = {
    current:      { label: "Current",        tone: "green"  },
    review_due:   { label: "Review due",     tone: "amber"  },
    pending:      { label: "Pending",        tone: "amber"  },
    not_applicable:{ label: "Not applicable", tone: "grey"  },
  };
  const AFF_ASSESSMENT = {
    not_started: { label: "Not started", tone: "grey"  },
    in_progress: { label: "In progress", tone: "blue"  },
    submitted:   { label: "Submitted",   tone: "green" },
    actions_open:{ label: "Actions open", tone: "amber" },
  };
  const AFF_DECLARATION = {
    not_started:     { label: "Not started",     tone: "grey"   },
    submitted:       { label: "Submitted",       tone: "green"  },
    exceptions_noted:{ label: "Exceptions noted", tone: "purple" },
  };

  const AFF_CYCLES = [2025, 2026];
  const AFF_DEFAULT_CYCLE = 2026;

  // ── Sample entities ───────────────────────────────────────────────
  // country: display name, region: reporting region, flag: emoji,
  // cc: ISO-ish key used for grouping. Deliberately includes countries with
  // more than one affiliate so the country roll-up has something to show.
  const AFF_ENTITIES = [
    // — multiple affiliates in one country —
    { id: "DE-01", name: "Nordwind Analytics GmbH", short: "Nordwind Analytics", country: "Germany", cc: "DE", flag: "🇩🇪", region: "Western Europe", hq: "Berlin" },
    { id: "DE-02", name: "Nordwind Labs GmbH", short: "Nordwind Labs", country: "Germany", cc: "DE", flag: "🇩🇪", region: "Western Europe", hq: "Munich" },
    { id: "NL-01", name: "Delta Shelf B.V.", short: "Delta Shelf", country: "Netherlands", cc: "NL", flag: "🇳🇱", region: "Western Europe", hq: "Amsterdam" },
    { id: "NL-02", name: "Delta Shelf Logistics B.V.", short: "Delta Shelf Logistics", country: "Netherlands", cc: "NL", flag: "🇳🇱", region: "Western Europe", hq: "Rotterdam" },

    { id: "FR-01", name: "Atelier Rivage SAS", short: "Atelier Rivage", country: "France", cc: "FR", flag: "🇫🇷", region: "Western Europe", hq: "Lyon" },
    { id: "ES-01", name: "Costa Verde Digital S.L.", short: "Costa Verde Digital", country: "Spain", cc: "ES", flag: "🇪🇸", region: "Southern Europe", hq: "Barcelona" },
    { id: "IT-01", name: "Fiume Rete S.r.l.", short: "Fiume Rete", country: "Italy", cc: "IT", flag: "🇮🇹", region: "Southern Europe", hq: "Milan" },
    { id: "PT-01", name: "Onda Clara Unipessoal Lda", short: "Onda Clara", country: "Portugal", cc: "PT", flag: "🇵🇹", region: "Southern Europe", hq: "Lisbon" },
    { id: "IE-01", name: "Harbour Bridge Ltd", short: "Harbour Bridge", country: "Ireland", cc: "IE", flag: "🇮🇪", region: "Northern Europe", hq: "Dublin" },
    { id: "SE-01", name: "Nordljus AB", short: "Nordljus", country: "Sweden", cc: "SE", flag: "🇸🇪", region: "Northern Europe", hq: "Stockholm" },
    { id: "DK-01", name: "Klitrose ApS", short: "Klitrose", country: "Denmark", cc: "DK", flag: "🇩🇰", region: "Northern Europe", hq: "Copenhagen" },
    { id: "FI-01", name: "Jääkaari Oy", short: "Jääkaari", country: "Finland", cc: "FI", flag: "🇫🇮", region: "Northern Europe", hq: "Helsinki" },
    { id: "NO-01", name: "Fjellvid AS", short: "Fjellvid", country: "Norway", cc: "NO", flag: "🇳🇴", region: "Northern Europe", hq: "Oslo" },
    { id: "PL-01", name: "Wisła Data Sp. z o.o.", short: "Wisła Data", country: "Poland", cc: "PL", flag: "🇵🇱", region: "Eastern Europe", hq: "Warsaw" },
    { id: "CZ-01", name: "Vltava Systems s.r.o.", short: "Vltava Systems", country: "Czechia", cc: "CZ", flag: "🇨🇿", region: "Eastern Europe", hq: "Prague" },
    { id: "AT-01", name: "Alpenrand GmbH", short: "Alpenrand", country: "Austria", cc: "AT", flag: "🇦🇹", region: "Western Europe", hq: "Vienna" },
    { id: "CH-01", name: "Helvetia Klar AG", short: "Helvetia Klar", country: "Switzerland", cc: "CH", flag: "🇨🇭", region: "Western Europe", hq: "Zurich" },
    { id: "BE-01", name: "Kanaal Tij BVBA", short: "Kanaal Tij", country: "Belgium", cc: "BE", flag: "🇧🇪", region: "Western Europe", hq: "Ghent" },
    { id: "GR-01", name: "Aigaio Soft AE", short: "Aigaio Soft", country: "Greece", cc: "GR", flag: "🇬🇷", region: "Southern Europe", hq: "Athens" },
    { id: "RO-01", name: "Carpat Cloud SRL", short: "Carpat Cloud", country: "Romania", cc: "RO", flag: "🇷🇴", region: "Eastern Europe", hq: "Cluj-Napoca" },
    { id: "HU-01", name: "Duna Pixel Kft.", short: "Duna Pixel", country: "Hungary", cc: "HU", flag: "🇭🇺", region: "Eastern Europe", hq: "Budapest" },
    { id: "GB-01", name: "Thames Ledger Ltd", short: "Thames Ledger", country: "United Kingdom", cc: "GB", flag: "🇬🇧", region: "Northern Europe", hq: "London" },
    { id: "EE-01", name: "Balti Laine OÜ", short: "Balti Laine", country: "Estonia", cc: "EE", flag: "🇪🇪", region: "Northern Europe", hq: "Tallinn" },
    { id: "SI-01", name: "Jadran Sistemi d.o.o.", short: "Jadran Sistemi", country: "Slovenia", cc: "SI", flag: "🇸🇮", region: "Southern Europe", hq: "Ljubljana" },
  ];

  // Per-cycle workstream state. Every row is invented. `agreement`/`assessment`/
  // `declaration` hold the status key; the extra fields are the evidence, dates
  // and action items surfaced in the detail panel. `history` holds prior years.
  const AFF_CYCLES_DATA = {
    2026: {
      "DE-01": {
        agreement: { status: "current", ref: "ICTA-DE-2026-014", signed: "2026-01-19", expires: "2027-01-18" },
        assessment: { status: "actions_open", score: 74, submitted: "2026-02-06", band: "Managed", actions: [
          { text: "Document retention schedule for marketing leads", tag: "open" },
          { text: "Refresh DPIA for the analytics pipeline", tag: "open" },
          { text: "Complete processor register for two new vendors", tag: "done" },
        ] },
        declaration: { status: "submitted", submitted: "2026-02-11", by: "A. Brandt (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "71 / Managed", declaration: "Submitted (v1.4)" }],
      },
      "DE-02": {
        agreement: { status: "current", ref: "ICTA-DE-2026-014", signed: "2026-01-19", expires: "2027-01-18" },
        assessment: { status: "submitted", score: 88, submitted: "2026-02-03", band: "Optimised", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-09", by: "A. Brandt (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "85 / Optimised", declaration: "Submitted (v1.4)" }],
      },
      "NL-01": {
        agreement: { status: "review_due", ref: "ICTA-NL-2025-003", signed: "2025-02-28", expires: "2026-02-27" },
        assessment: { status: "in_progress", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "68 / Managed", declaration: "Submitted (v1.3)" }],
      },
      "NL-02": {
        agreement: { status: "not_applicable", ref: null, signed: null, expires: null, why: "No intracompany transfer — local processing only (sample rationale)" },
        assessment: { status: "submitted", score: 63, submitted: "2026-02-14", band: "Defined", actions: [] },
        declaration: { status: "exceptions_noted", submitted: "2026-02-17", by: "M. de Vries (Counsel)", version: "v2.1", exceptions: 2, note: "Two sub-processor entries awaiting updated DPAs (sample)" },
        history: [{ year: 2025, agreement: "Not applicable", assessment: "59 / Defined", declaration: "Exceptions noted (v1.3)" }],
      },
      "FR-01": {
        agreement: { status: "current", ref: "ICTA-FR-2026-007", signed: "2026-01-08", expires: "2027-01-07" },
        assessment: { status: "submitted", score: 81, submitted: "2026-02-05", band: "Managed", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-12", by: "C. Moreau (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "77 / Managed", declaration: "Submitted (v1.4)" }],
      },
      "ES-01": {
        agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Awaiting countersignature on the 2026 schedule (sample)" },
        assessment: { status: "in_progress", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Pending", assessment: "—", declaration: "Not started" }],
      },
      "IT-01": {
        agreement: { status: "current", ref: "ICTA-IT-2026-005", signed: "2026-01-22", expires: "2027-01-21" },
        assessment: { status: "actions_open", score: 57, submitted: "2026-02-10", band: "Defined", actions: [
          { text: "Assign a named privacy owner for the entity", tag: "open" },
          { text: "Run the annual awareness briefing", tag: "open" },
        ] },
        declaration: { status: "submitted", submitted: "2026-02-15", by: "G. Rinaldi (Legal)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Review due", assessment: "52 / Defined", declaration: "Submitted (v1.4)" }],
      },
      "PT-01": {
        agreement: { status: "current", ref: "ICTA-PT-2026-002", signed: "2026-01-11", expires: "2027-01-10" },
        assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "61 / Defined", declaration: "Submitted (v1.3)" }],
      },
      "IE-01": {
        agreement: { status: "current", ref: "ICTA-IE-2026-009", signed: "2026-01-05", expires: "2027-01-04" },
        assessment: { status: "submitted", score: 91, submitted: "2026-02-02", band: "Optimised", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-07", by: "S. O’Neill (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "89 / Optimised", declaration: "Submitted (v1.4)" }],
      },
      "SE-01": {
        agreement: { status: "current", ref: "ICTA-SE-2026-006", signed: "2026-01-16", expires: "2027-01-15" },
        assessment: { status: "submitted", score: 79, submitted: "2026-02-08", band: "Managed", actions: [] },
        declaration: { status: "exceptions_noted", submitted: "2026-02-13", by: "E. Lind (Counsel)", version: "v2.1", exceptions: 1, note: "One transferred dataset missing a retention note (sample)" },
        history: [{ year: 2025, agreement: "Current", assessment: "74 / Managed", declaration: "Submitted (v1.4)" }],
      },
      "DK-01": {
        agreement: { status: "review_due", ref: "ICTA-DK-2025-011", signed: "2025-03-01", expires: "2026-02-28" },
        assessment: { status: "submitted", score: 72, submitted: "2026-02-04", band: "Managed", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "70 / Managed", declaration: "Submitted (v1.3)" }],
      },
      "FI-01": {
        agreement: { status: "current", ref: "ICTA-FI-2026-004", signed: "2026-01-27", expires: "2027-01-26" },
        assessment: { status: "submitted", score: 84, submitted: "2026-02-09", band: "Optimised", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-16", by: "L. Korhonen (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "80 / Managed", declaration: "Submitted (v1.4)" }],
      },
      "NO-01": {
        agreement: { status: "not_applicable", ref: null, signed: null, expires: null, why: "Outside the intracompany transfer scope for this demo (sample)" },
        assessment: { status: "actions_open", score: 66, submitted: "2026-02-12", band: "Defined", actions: [
          { text: "Close the two open vendor assessments", tag: "open" },
        ] },
        declaration: { status: "submitted", submitted: "2026-02-18", by: "H. Dahl (Legal)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Not applicable", assessment: "63 / Defined", declaration: "Submitted (v1.3)" }],
      },
      "PL-01": {
        agreement: { status: "pending", ref: null, signed: null, expires: null, why: "New entity — agreement in drafting (sample)" },
        assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [],
      },
      "CZ-01": {
        agreement: { status: "current", ref: "ICTA-CZ-2026-008", signed: "2026-01-14", expires: "2027-01-13" },
        assessment: { status: "submitted", score: 69, submitted: "2026-02-06", band: "Managed", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-10", by: "P. Novák (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "64 / Defined", declaration: "Submitted (v1.3)" }],
      },
      "AT-01": {
        agreement: { status: "current", ref: "ICTA-AT-2026-010", signed: "2026-01-20", expires: "2027-01-19" },
        assessment: { status: "in_progress", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "76 / Managed", declaration: "Submitted (v1.4)" }],
      },
      "CH-01": {
        agreement: { status: "current", ref: "ICTA-CH-2026-012", signed: "2026-01-23", expires: "2027-01-22" },
        assessment: { status: "submitted", score: 86, submitted: "2026-02-07", band: "Optimised", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-14", by: "R. Meier (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "83 / Optimised", declaration: "Submitted (v1.4)" }],
      },
      "BE-01": {
        agreement: { status: "review_due", ref: "ICTA-BE-2025-002", signed: "2025-02-15", expires: "2026-02-14" },
        assessment: { status: "actions_open", score: 54, submitted: "2026-02-11", band: "Initial", actions: [
          { text: "Adopt a written retention policy", tag: "open" },
          { text: "Record the processor onboarding checklist", tag: "open" },
          { text: "Appoint an entity-level privacy contact", tag: "open" },
        ] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "49 / Initial", declaration: "Submitted (v1.3)" }],
      },
      "GR-01": {
        agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Local counsel review outstanding (sample)" },
        assessment: { status: "in_progress", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Pending", assessment: "—", declaration: "Not started" }],
      },
      "RO-01": {
        agreement: { status: "current", ref: "ICTA-RO-2026-013", signed: "2026-01-29", expires: "2027-01-28" },
        assessment: { status: "submitted", score: 61, submitted: "2026-02-13", band: "Defined", actions: [] },
        declaration: { status: "exceptions_noted", submitted: "2026-02-19", by: "I. Popescu (Legal)", version: "v2.1", exceptions: 1, note: "One cross-border transfer awaiting an updated annex (sample)" },
        history: [{ year: 2025, agreement: "Current", assessment: "58 / Defined", declaration: "Submitted (v1.3)" }],
      },
      "HU-01": {
        agreement: { status: "current", ref: "ICTA-HU-2026-015", signed: "2026-01-31", expires: "2027-01-30" },
        assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "55 / Defined", declaration: "Submitted (v1.3)" }],
      },
      "GB-01": {
        agreement: { status: "current", ref: "ICTA-GB-2026-001", signed: "2026-01-06", expires: "2027-01-05" },
        assessment: { status: "submitted", score: 93, submitted: "2026-02-01", band: "Optimised", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-06", by: "J. Whitfield (DPO)", version: "v2.1", exceptions: 0 },
        history: [{ year: 2025, agreement: "Current", assessment: "90 / Optimised", declaration: "Submitted (v1.4)" }],
      },
      "EE-01": {
        agreement: { status: "current", ref: "ICTA-EE-2026-016", signed: "2026-02-02", expires: "2027-02-01" },
        assessment: { status: "in_progress", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [],
      },
      "SI-01": {
        agreement: { status: "current", ref: "ICTA-SI-2026-017", signed: "2026-02-04", expires: "2027-02-03" },
        assessment: { status: "submitted", score: 76, submitted: "2026-02-15", band: "Managed", actions: [] },
        declaration: { status: "submitted", submitted: "2026-02-20", by: "N. Zupan (DPO)", version: "v2.1", exceptions: 0 },
        history: [],
      },
    },
    // Prior cycle — kept partial on purpose so the year selector has a visibly
    // different (mostly older) picture, and the detail history has something to show.
    2025: {
      "DE-01": { agreement: { status: "current", ref: "ICTA-DE-2025-014", signed: "2025-01-20", expires: "2026-01-19" }, assessment: { status: "submitted", score: 71, submitted: "2025-02-07", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-12", by: "A. Brandt (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "DE-02": { agreement: { status: "current", ref: "ICTA-DE-2025-014", signed: "2025-01-20", expires: "2026-01-19" }, assessment: { status: "submitted", score: 85, submitted: "2025-02-04", band: "Optimised", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-10", by: "A. Brandt (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "NL-01": { agreement: { status: "current", ref: "ICTA-NL-2025-003", signed: "2025-02-28", expires: "2026-02-27" }, assessment: { status: "submitted", score: 68, submitted: "2025-03-05", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-03-11", by: "M. de Vries (Counsel)", version: "v1.3", exceptions: 0 }, history: [] },
      "NL-02": { agreement: { status: "not_applicable", ref: null, signed: null, expires: null, why: "No intracompany transfer — local processing only (sample rationale)" }, assessment: { status: "submitted", score: 59, submitted: "2025-03-06", band: "Defined", actions: [] }, declaration: { status: "exceptions_noted", submitted: "2025-03-12", by: "M. de Vries (Counsel)", version: "v1.3", exceptions: 1, note: "One sub-processor DPA was pending (sample)" }, history: [] },
      "FR-01": { agreement: { status: "current", ref: "ICTA-FR-2025-007", signed: "2025-01-09", expires: "2026-01-08" }, assessment: { status: "submitted", score: 77, submitted: "2025-02-06", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-13", by: "C. Moreau (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "ES-01": { agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Countersignature outstanding (sample)" }, assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] }, declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 }, history: [] },
      "IT-01": { agreement: { status: "review_due", ref: "ICTA-IT-2024-005", signed: "2024-01-25", expires: "2025-01-24" }, assessment: { status: "submitted", score: 52, submitted: "2025-02-11", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-16", by: "G. Rinaldi (Legal)", version: "v1.4", exceptions: 0 }, history: [] },
      "PT-01": { agreement: { status: "current", ref: "ICTA-PT-2025-002", signed: "2025-01-12", expires: "2026-01-11" }, assessment: { status: "submitted", score: 61, submitted: "2025-02-08", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-14", by: "R. Alves (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "IE-01": { agreement: { status: "current", ref: "ICTA-IE-2025-009", signed: "2025-01-06", expires: "2026-01-05" }, assessment: { status: "submitted", score: 89, submitted: "2025-02-03", band: "Optimised", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-08", by: "S. O’Neill (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "SE-01": { agreement: { status: "current", ref: "ICTA-SE-2025-006", signed: "2025-01-17", expires: "2026-01-16" }, assessment: { status: "submitted", score: 74, submitted: "2025-02-09", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-14", by: "E. Lind (Counsel)", version: "v1.4", exceptions: 0 }, history: [] },
      "DK-01": { agreement: { status: "current", ref: "ICTA-DK-2025-011", signed: "2025-03-01", expires: "2026-02-28" }, assessment: { status: "submitted", score: 70, submitted: "2025-03-04", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-03-10", by: "F. Sørensen (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "FI-01": { agreement: { status: "current", ref: "ICTA-FI-2025-004", signed: "2025-01-28", expires: "2026-01-27" }, assessment: { status: "submitted", score: 80, submitted: "2025-02-10", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-17", by: "L. Korhonen (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "NO-01": { agreement: { status: "not_applicable", ref: null, signed: null, expires: null, why: "Outside the intracompany transfer scope for this demo (sample)" }, assessment: { status: "submitted", score: 63, submitted: "2025-02-13", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-19", by: "H. Dahl (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "PL-01": { agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Entity onboarding in progress (sample)" }, assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] }, declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 }, history: [] },
      "CZ-01": { agreement: { status: "current", ref: "ICTA-CZ-2025-008", signed: "2025-01-15", expires: "2026-01-14" }, assessment: { status: "submitted", score: 64, submitted: "2025-02-07", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-11", by: "P. Novák (DPO)", version: "v1.3", exceptions: 0 }, history: [] },
      "AT-01": { agreement: { status: "current", ref: "ICTA-AT-2025-010", signed: "2025-01-21", expires: "2026-01-20" }, assessment: { status: "submitted", score: 76, submitted: "2025-02-08", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-15", by: "K. Huber (Legal)", version: "v1.4", exceptions: 0 }, history: [] },
      "CH-01": { agreement: { status: "current", ref: "ICTA-CH-2025-012", signed: "2025-01-24", expires: "2026-01-23" }, assessment: { status: "submitted", score: 83, submitted: "2025-02-08", band: "Optimised", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-15", by: "R. Meier (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "BE-01": { agreement: { status: "current", ref: "ICTA-BE-2025-002", signed: "2025-02-15", expires: "2026-02-14" }, assessment: { status: "submitted", score: 49, submitted: "2025-02-20", band: "Initial", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-26", by: "T. Claes (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "GR-01": { agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Local counsel review outstanding (sample)" }, assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] }, declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 }, history: [] },
      "RO-01": { agreement: { status: "current", ref: "ICTA-RO-2025-013", signed: "2025-01-30", expires: "2026-01-29" }, assessment: { status: "submitted", score: 58, submitted: "2025-02-14", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-20", by: "I. Popescu (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "HU-01": { agreement: { status: "current", ref: "ICTA-HU-2025-015", signed: "2025-02-01", expires: "2026-01-31" }, assessment: { status: "submitted", score: 55, submitted: "2025-02-12", band: "Defined", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-18", by: "B. Nagy (Legal)", version: "v1.3", exceptions: 0 }, history: [] },
      "GB-01": { agreement: { status: "current", ref: "ICTA-GB-2025-001", signed: "2025-01-07", expires: "2026-01-06" }, assessment: { status: "submitted", score: 90, submitted: "2025-02-02", band: "Optimised", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-07", by: "J. Whitfield (DPO)", version: "v1.4", exceptions: 0 }, history: [] },
      "EE-01": { agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Entity formed late in the cycle (sample)" }, assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] }, declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 }, history: [] },
      "SI-01": { agreement: { status: "current", ref: "ICTA-SI-2025-017", signed: "2025-02-05", expires: "2026-02-04" }, assessment: { status: "submitted", score: 72, submitted: "2025-02-16", band: "Managed", actions: [] }, declaration: { status: "submitted", submitted: "2025-02-21", by: "N. Zupan (DPO)", version: "v1.3", exceptions: 0 }, history: [] },
    },
  };
  AFF_ENTITIES.forEach((e) => {
    if (!AFF_CYCLES_DATA[2025][e.id]) {
      AFF_CYCLES_DATA[2025][e.id] = {
        agreement: { status: "pending", ref: null, signed: null, expires: null, why: "Sample placeholder for a prior cycle" },
        assessment: { status: "not_started", score: null, submitted: null, band: "—", actions: [] },
        declaration: { status: "not_started", submitted: null, by: null, version: null, exceptions: 0 },
        history: [],
      };
    }
  });

  const AFF = {
    cycles: AFF_CYCLES,
    defaultCycle: AFF_DEFAULT_CYCLE,
    entities: AFF_ENTITIES,
    byId: Object.fromEntries(AFF_ENTITIES.map((e) => [e.id, e])),
    data: AFF_CYCLES_DATA,
    state: { cycle: AFF_DEFAULT_CYCLE, q: "", region: "", country: "", overall: "", attention: false, open: "" },
  };

  // ── Derived helpers ───────────────────────────────────────────────
  function affRow(entity, cycle) {
    const d = (AFF.data[cycle] || AFF.data[AFF.defaultCycle])[entity.id];
    return { ...entity, ...d };
  }

  function affRows(cycle) {
    return AFF.entities.map((e) => affRow(e, cycle));
  }

  // Attention reasons — explicit, in priority order. An entity "needs attention"
  // when any workstream is unfinished or carries open actions/exceptions.
  function affAttention(row) {
    const r = [];
    if (row.agreement.status === "pending") r.push("agreement pending");
    if (row.agreement.status === "review_due") r.push("agreement review due");
    if (row.assessment.status === "actions_open") r.push("assessment actions open");
    if (row.assessment.status === "not_started") r.push("assessment not started");
    if (row.assessment.status === "in_progress") r.push("assessment in progress");
    if (row.declaration.status === "not_started") r.push("declaration not started");
    if (row.declaration.status === "exceptions_noted") r.push("declaration exceptions");
    return r;
  }

  // Overall is DERIVED, never stored. The reason string is always shown so the
  // roll-up can't be mistaken for one of the three real statuses.
  function affOverall(row) {
    const a = row.agreement.status, s = row.assessment.status, d = row.declaration.status;
    const complete = (a === "current" || a === "not_applicable") && s === "submitted" && d === "submitted";
    if (complete) return { key: "complete", label: "Complete", tone: "green", why: "all three steps recorded" };
    // "Pending" and "Review due" are recorded agreement states — the cycle has
    // begun for the entity even when the other two steps are untouched.
    const started = s !== "not_started" || d !== "not_started" || a !== "not_applicable";
    if (!started) return { key: "not_started", label: "Not started", tone: "grey", why: "no steps recorded yet" };
    const why = affAttention(row).slice(0, 2).join("; ");
    return { key: "in_progress", label: "In progress", tone: "amber", why: why || "steps outstanding" };
  }

  function affKpis(cycle) {
    const rows = affRows(cycle);
    return {
      entities: rows.length,
      agreementsCurrent: rows.filter((r) => r.agreement.status === "current").length,
      assessmentsSubmitted: rows.filter((r) => r.assessment.status === "submitted" || r.assessment.status === "actions_open").length,
      declarationsSubmitted: rows.filter((r) => r.declaration.status === "submitted" || r.declaration.status === "exceptions_noted").length,
      attention: rows.filter((r) => affAttention(r).length > 0).length,
      complete: rows.filter((r) => affOverall(r).key === "complete").length,
    };
  }

  function affFiltered() {
    const S = AFF.state;
    const q = S.q.trim().toLowerCase();
    return affRows(S.cycle).filter((r) => {
      if (q) {
        const hay = `${r.name} ${r.short} ${r.id} ${r.country} ${r.hq} ${r.region}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (S.region && r.region !== S.region) return false;
      if (S.country && r.cc !== S.country) return false;
      if (S.overall) {
        const o = affOverall(r);
        const hit = S.overall === "attention" ? affAttention(r).length > 0 : o.key === S.overall;
        if (!hit) return false;
      }
      if (S.attention && !affAttention(r).length) return false;
      return true;
    });
  }

  function affCountryName(cc) {
    const e = AFF.entities.find((x) => x.cc === cc);
    return e ? e.country : cc;
  }

  function affPill(vocab, key) {
    const v = vocab[key] || { label: key, tone: "grey" };
    return `<span class="aff-pill ${v.tone}">${esc(v.label)}</span>`;
  }

  function affOverallPill(o) {
    return `<span class="aff-pill ${o.tone}" title="${esc(o.why)}"><span class="dot"></span>${esc(o.label)}` +
      `<span class="why">· ${esc(o.why)}</span></span>`;
  }

  // ── Render: KPIs + progress bars ──────────────────────────────────
  function affStatsHtml() {
    const k = affKpis(AFF.state.cycle);
    const pct = (n) => (k.entities ? Math.round((n / k.entities) * 100) : 0);
    return `
      <div class="icta-stat"><div class="num">${k.entities}</div><div class="lbl">Affiliates</div><div class="sub">legal entities (demo)</div></div>
      <div class="icta-stat green"><div class="num">${k.agreementsCurrent}</div><div class="lbl">Agreements current</div><div class="sub">${pct(k.agreementsCurrent)}% of entities</div></div>
      <div class="icta-stat green"><div class="num">${k.assessmentsSubmitted}</div><div class="lbl">Assessments submitted</div><div class="sub">${pct(k.assessmentsSubmitted)}% of entities</div></div>
      <div class="icta-stat purple"><div class="num">${k.declarationsSubmitted}</div><div class="lbl">Declarations submitted</div><div class="sub">${pct(k.declarationsSubmitted)}% of entities</div></div>
      <div class="icta-stat amber"><div class="num">${k.attention}</div><div class="lbl">Needs attention</div><div class="sub">any workstream outstanding</div></div>`;
  }

  function affProgressHtml() {
    const rows = affRows(AFF.state.cycle);
    const n = rows.length || 1;
    const cur = rows.filter((r) => r.agreement.status === "current").length;
    const sub = rows.filter((r) => r.assessment.status === "submitted" || r.assessment.status === "actions_open").length;
    const dec = rows.filter((r) => r.declaration.status === "submitted" || r.declaration.status === "exceptions_noted").length;
    const bar = (cls, label, val, sub2) => {
      const p = Math.round((val / n) * 100);
      return `<div class="aff-progress ${cls}">
        <div class="aph"><b>${label}</b><span>${val}/${rows.length} · ${p}%</span></div>
        <div class="bar" role="img" aria-label="${label}: ${val} of ${rows.length} (${p}%)"><i style="width:${p}%"></i></div>
        <div class="aps">${sub2}</div>
      </div>`;
    };
    return bar("", "Agreements current", cur, "Signed and in date for the cycle") +
      bar("assess", "Assessments submitted", sub, "Submitted, with or without open actions") +
      bar("decl", "Declarations submitted", dec, "Submitted, with or without exceptions");
  }

  // ── Render: filters ───────────────────────────────────────────────
  function affFillFilters() {
    const regionSel = $("#aff-region"), countrySel = $("#aff-country"), overallSel = $("#aff-overall");
    if (regionSel && !regionSel.dataset.filled) {
      const regions = [...new Set(AFF.entities.map((e) => e.region))].sort();
      regionSel.innerHTML = '<option value="">All regions</option>' +
        regions.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
      regionSel.dataset.filled = "1";
    }
    if (countrySel && !countrySel.dataset.filled) {
      const seen = new Map();
      AFF.entities.forEach((e) => { if (!seen.has(e.cc)) seen.set(e.cc, e); });
      const opts = [...seen.values()].sort((a, b) => a.country.localeCompare(b.country));
      countrySel.innerHTML = '<option value="">All countries</option>' +
        opts.map((e) => `<option value="${esc(e.cc)}">${esc(e.flag)} ${esc(e.country)}</option>`).join("");
      countrySel.dataset.filled = "1";
    }
    if (overallSel && !overallSel.dataset.filled) {
      overallSel.innerHTML = '<option value="">All overall statuses</option>' +
        '<option value="complete">Complete</option>' +
        '<option value="in_progress">In progress</option>' +
        '<option value="not_started">Not started</option>' +
        '<option value="attention">Needs attention</option>';
      overallSel.dataset.filled = "1";
    }
  }

  // ── Render: cycle selector ────────────────────────────────────────
  function affCycleHtml() {
    return AFF.cycles.map((y) =>
      `<button type="button" data-cycle="${y}" aria-pressed="${y === AFF.state.cycle}">${y}</button>`).join("");
  }

  // ── Render: table ─────────────────────────────────────────────────
  function affRowsHtml(rows) {
    if (!rows.length) return "";
    return rows.map((r) => {
      const o = affOverall(r);
      const open = AFF.state.open === r.id;
      const detail = open ? affDetailHtml(r) : "";
      return `<div class="aff-row${open ? " open" : ""}" data-id="${esc(r.id)}">
        <div class="aff-row-main" role="row" tabindex="0" aria-expanded="${open}" data-toggle="${esc(r.id)}">
          <span class="aff-ent" role="cell">
            <span class="aff-chev" aria-hidden="true">▶</span>
            <span class="nm"><b>${esc(r.short)}</b><span>${esc(r.id)} · ${esc(r.hq)}</span></span>
          </span>
          <span class="aff-ctry" role="cell">
            <span class="flag" aria-hidden="true">${r.flag}</span>
            <span class="cn"><b>${esc(r.country)}</b><span>${esc(r.region)}</span></span>
          </span>
          <span class="aff-col-ws" role="cell">${affPill(AFF_AGREEMENT, r.agreement.status)}</span>
          <span class="aff-col-ws" role="cell">${affPill(AFF_ASSESSMENT, r.assessment.status)}</span>
          <span class="aff-col-ws" role="cell">${affPill(AFF_DECLARATION, r.declaration.status)}</span>
          <span class="aff-col-overall" role="cell">${affOverallPill(o)}</span>
        </div>
        ${detail}
      </div>`;
    }).join("");
  }

  function affWsAgreement(r) {
    const a = r.agreement;
    if (a.status === "not_applicable") {
      return `<div class="aff-ws"><h4>1 · Transfer agreement</h4>
        <div class="kv"><span>Status</span><b>${affPill(AFF_AGREEMENT, a.status)}</b></div>
        <div class="ev"><b>Why recorded as N/A:</b> ${esc(a.why || "Sample rationale")}</div></div>`;
    }
    return `<div class="aff-ws"><h4>1 · Transfer agreement</h4>
      <div class="kv"><span>Status</span><b>${affPill(AFF_AGREEMENT, a.status)}</b></div>
      <div class="kv"><span>Reference</span><b>${esc(a.ref || "—")}</b></div>
      <div class="kv"><span>Signed</span><b>${esc(a.signed || "—")}</b></div>
      <div class="kv"><span>Expires</span><b>${esc(a.expires || "—")}</b></div>
      ${a.why ? `<div class="ev"><b>Note:</b> ${esc(a.why)}</div>` : ""}</div>`;
  }

  function affWsAssessment(r) {
    const s = r.assessment;
    const score = s.score == null ? "—" : `${s.score}<span class="muted small"> / 100 self-assessed</span>`;
    const acts = (s.actions || []).map((a) =>
      `<li><span class="tag ${a.tag === "done" ? "done" : ""}">${a.tag === "done" ? "done" : "open"}</span><span>${esc(a.text)}</span></li>`).join("");
    return `<div class="aff-ws"><h4>2 · Maturity self-assessment</h4>
      <div class="kv"><span>Status</span><b>${affPill(AFF_ASSESSMENT, s.status)}</b></div>
      <div class="kv"><span>Score</span><b>${score}</b></div>
      <div class="kv"><span>Band</span><b>${esc(s.band || "—")}</b></div>
      <div class="kv"><span>Submitted</span><b>${esc(s.submitted || "—")}</b></div>
      ${acts ? `<div class="ev"><b>Action items</b></div><ul class="aff-actions">${acts}</ul>` : `<div class="ev">No open action items recorded.</div>`}
      <div class="aff-note">Self-reported questionnaire result — not a certification or audit opinion.</div></div>`;
  }

  function affWsDeclaration(r) {
    const d = r.declaration;
    return `<div class="aff-ws"><h4>3 · Compliance declaration</h4>
      <div class="kv"><span>Status</span><b>${affPill(AFF_DECLARATION, d.status)}</b></div>
      <div class="kv"><span>Version</span><b>${esc(d.version || "—")}</b></div>
      <div class="kv"><span>Submitted</span><b>${esc(d.submitted || "—")}</b></div>
      <div class="kv"><span>Submitted by</span><b>${esc(d.by || "—")}</b></div>
      <div class="kv"><span>Exceptions</span><b>${d.exceptions || 0}</b></div>
      ${d.note ? `<div class="ev"><b>Exception note:</b> ${esc(d.note)}</div>` : ""}</div>`;
  }

  function affHistoryHtml(r) {
    const hist = r.history || [];
    if (!hist.length) return `<div class="aff-hist"><div class="muted small">No prior-year history recorded for this entity (demo).</div></div>`;
    return `<div class="aff-hist"><table>
      <thead><tr><th>Cycle</th><th>Agreement</th><th>Assessment</th><th>Declaration</th></tr></thead>
      <tbody>${hist.map((h) => `<tr><td>${h.year}</td><td>${esc(h.agreement)}</td><td>${esc(h.assessment)}</td><td>${esc(h.declaration)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  }

  function affDetailHtml(r) {
    const o = affOverall(r);
    const att = affAttention(r);
    return `<div class="aff-detail-wrap">
      <div class="aff-ws-grid">
        ${affWsAgreement(r)}
        ${affWsAssessment(r)}
        ${affWsDeclaration(r)}
      </div>
      <div class="aff-ws" style="margin-top:12px">
        <h4>Derived overall — ${esc(o.label)}</h4>
        <div class="kv"><span>Reason</span><b>${esc(o.why)}</b></div>
        <div class="kv"><span>Open points</span><b>${att.length ? esc(att.join("; ")) : "none"}</b></div>
        <div class="aff-note">Derived from the three workstream statuses above — not a stored field and not a compliance determination.</div>
      </div>
      ${affHistoryHtml(r)}
      <div class="aff-note">All values on this panel are fabricated demo data for ${esc(r.short)} (${esc(r.id)}).</div>
    </div>`;
  }

  // ── Render: country roll-up ───────────────────────────────────────
  function affRollupHtml() {
    const rows = affRows(AFF.state.cycle);
    const groups = new Map();
    rows.forEach((r) => {
      if (!groups.has(r.cc)) groups.set(r.cc, []);
      groups.get(r.cc).push(r);
    });
    const multi = [...groups.values()].filter((g) => g.length > 1);
    if (!multi.length) return `<div class="icta-empty">No country has more than one affiliate in this cycle.</div>`;
    return multi.map((g) => {
      const e = g[0];
      const cur = g.filter((r) => r.agreement.status === "current").length;
      const sub = g.filter((r) => r.assessment.status === "submitted" || r.assessment.status === "actions_open").length;
      const dec = g.filter((r) => r.declaration.status === "submitted" || r.declaration.status === "exceptions_noted").length;
      const att = g.filter((r) => affAttention(r).length).length;
      return `<div class="aff-roll">
        <div class="rh"><span class="flag" aria-hidden="true">${e.flag}</span><b>${esc(e.country)}</b><span>${g.length} entities</span></div>
        <div class="rline"><span>Agreements current</span><b>${cur}/${g.length}</b></div>
        <div class="rline"><span>Assessments submitted</span><b>${sub}/${g.length}</b></div>
        <div class="rline"><span>Declarations submitted</span><b>${dec}/${g.length}</b></div>
        <div class="rline"><span>Needs attention</span><b>${att}</b></div>
      </div>`;
    }).join("");
  }

  // ── Render: master ────────────────────────────────────────────────
  function renderAff() {
    const rowsEl = $("#aff-rows");
    if (!rowsEl) return;
    // If the open entity was filtered out, close the detail.
    const visible = affFiltered();
    if (AFF.state.open && !visible.some((r) => r.id === AFF.state.open)) AFF.state.open = "";

    const stats = $("#aff-stats"); if (stats) stats.innerHTML = affStatsHtml();
    const prog = $("#aff-progress"); if (prog) prog.innerHTML = affProgressHtml();
    const tabs = $("#aff-cycle-tabs"); if (tabs) tabs.innerHTML = affCycleHtml();
    const note = $("#aff-cycle-note");
    if (note) note.innerHTML = `Showing the <b>${AFF.state.cycle}</b> cycle · demo data`;

    affFillFilters();
    // Keep the selects in sync when the state was reset programmatically.
    const map = { "#aff-search": "q", "#aff-region": "region", "#aff-country": "country", "#aff-overall": "overall" };
    Object.entries(map).forEach(([sel, k]) => { const el = $(sel); if (el && el.value !== AFF.state[k]) el.value = AFF.state[k]; });
    const at = $("#aff-attention"); if (at) at.checked = !!AFF.state.attention;

    rowsEl.innerHTML = affRowsHtml(visible);
    const empty = $("#aff-empty"); if (empty) empty.classList.toggle("hidden", visible.length > 0);

    const cl = $("#aff-count-line");
    if (cl) {
      const chips = [];
      if (AFF.state.q) chips.push(`“${AFF.state.q}”`);
      if (AFF.state.region) chips.push(AFF.state.region);
      if (AFF.state.country) chips.push(affCountryName(AFF.state.country));
      if (AFF.state.overall) chips.push(AFF.state.overall === "attention" ? "needs attention" : AFF.state.overall.replace("_", " "));
      if (AFF.state.attention) chips.push("needs attention only");
      cl.innerHTML = `Showing <b>${visible.length}</b> of ${AFF.entities.length} affiliates` +
        (chips.length ? ` · filtered by ${esc(chips.join(" · "))}` : "") +
        ` · <span class="muted">derived overall shown with reason</span>`;
    }

    const roll = $("#aff-rollup"); if (roll) roll.innerHTML = affRollupHtml();
  }

  // Legacy #icta / #compliance/icta → rewrite to the new screen path so the
  // address bar matches what's on screen (history.replaceState, no extra entry).
  function normalizeAffiliateHash() {
    const raw = (location.hash || "").replace(/^#/, "").trim();
    if (raw === "icta" || raw === "compliance/icta") {
      try { history.replaceState(null, "", "#compliance/affiliates"); } catch (e) { /* ignore */ }
    }
  }

  function wireAff() {
    const tabs = $("#aff-cycle-tabs");
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = "1";
      tabs.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-cycle]");
        if (!b) return;
        const y = Number(b.dataset.cycle);
        if (!AFF.cycles.includes(y)) return;
        AFF.state.cycle = y;
        AFF.state.open = "";
        renderAff();
      });
    }

    const s = $("#aff-search");
    if (s && !s.dataset.bound) {
      s.dataset.bound = "1";
      let t = null;
      s.oninput = () => {
        clearTimeout(t);
        t = setTimeout(() => { AFF.state.q = s.value; renderAff(); }, 120);
      };
    }
    [["#aff-region", "region"], ["#aff-country", "country"], ["#aff-overall", "overall"]].forEach(([sel, k]) => {
      const el = $(sel);
      if (el && !el.dataset.bound) {
        el.dataset.bound = "1";
        el.onchange = () => { AFF.state[k] = el.value; renderAff(); };
      }
    });
    const at = $("#aff-attention");
    if (at && !at.dataset.bound) {
      at.dataset.bound = "1";
      at.onchange = () => { AFF.state.attention = at.checked; renderAff(); };
    }

    const rows = $("#aff-rows");
    if (rows && !rows.dataset.bound) {
      rows.dataset.bound = "1";
      const toggle = (id) => {
        AFF.state.open = AFF.state.open === id ? "" : id;
        renderAff();
      };
      rows.addEventListener("click", (e) => {
        const m = e.target.closest("[data-toggle]");
        if (!m) return;
        toggle(m.dataset.toggle);
      });
      rows.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const m = e.target.closest("[data-toggle]");
        if (!m) return;
        e.preventDefault();
        toggle(m.dataset.toggle);
      });
    }

    const rs = $("#aff-reset");
    if (rs && !rs.dataset.bound) {
      rs.dataset.bound = "1";
      rs.onclick = () => {
        AFF.state.q = ""; AFF.state.region = ""; AFF.state.country = ""; AFF.state.overall = "";
        AFF.state.attention = false; AFF.state.open = "";
        renderAff();
      };
    }
  }

  $("#ck-btn")?.addEventListener("click", runCookieScan);
  $("#ck-url")?.addEventListener("keydown", (e) => { if (e.key === "Enter") runCookieScan(); });

  wireThemeToggle();
  boot().catch((e) => { console.error(e); showLogin(); });
})();
