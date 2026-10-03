/* ============ APP LOGIC ============ */

function go(screen) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("visible"));
  document.getElementById(screen).classList.add("visible");
  document.querySelectorAll(".nav-link").forEach(a => {
    a.classList.toggle("active", a.dataset.screen === screen);
  });
  window.scrollTo({ top: 0 });
  logEvent("screen_view", screen);
}
document.querySelectorAll(".nav-link").forEach(a => {
  a.addEventListener("click", e => { e.preventDefault(); go(a.dataset.screen); });
});

function toast(msg) {
  const t = document.getElementById("toast");
  t.innerHTML = msg;
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 4200);
}

/* ---------- Ask screen — one live bar, DB-backed knowledge base ---------- */
const ASK_API = LWB_API.replace("/question", "/ask");
let askBusy = false;
let KB = [];

function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

async function initAsk() {
  const inp = document.getElementById("askInput");
  if (!inp) return;
  inp.addEventListener("keydown", e => { if (e.key === "Enter") askBoard(); });
  loadKB();
  loadStream();
}

async function loadKB() {
  const qs = await fetchAnsweredQuestions();
  KB = qs;
  const box = document.getElementById("suggestBox");
  if (!box) return;
  if (!qs.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="suggest-lbl">Knowledge base — tap to recall:</span>` +
    qs.slice(0, 4).map(q => `<button class="suggest-pill" onclick="askPrefill(${q.id})">${escapeHtml(trunc(q.question, 70))}</button>`).join("");
}

function askPrefill(id) {
  const q = KB.find(x => x.id === id);
  if (!q) return;
  document.getElementById("askInput").value = q.question;
  askBoard();
}

async function askBoard() {
  const inp = document.getElementById("askInput");
  const q = inp.value.trim();
  if (!q || askBusy) return;
  askBusy = true;
  const btn = document.getElementById("askBtn");
  btn.disabled = true;
  document.getElementById("thinking").classList.add("on");
  document.getElementById("streamNew").innerHTML = "";
  logEvent("query_run", "ask", { question: q.slice(0, 200) });
  try {
    const r = await fetch(ASK_API, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, visitor_id: visitorId() })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    inp.value = "";
    renderNewAnswer(d);
    loadKB();
    loadStream();
  } catch (e) {
    document.getElementById("streamNew").innerHTML =
      `<div class="card" style="border-color:var(--amber)"><span class="small" style="color:var(--amber)">⚠️ The board is unreachable right now (${escapeHtml(String(e.message || e))}). Try again in a moment.</span></div>`;
  }
  document.getElementById("thinking").classList.remove("on");
  btn.disabled = false;
  askBusy = false;
}

function renderNewAnswer(d) {
  const conf = Math.round((d.confidence || 0) * 100);
  const confCls = conf >= 80 ? "b-high" : conf >= 60 ? "b-med" : "b-low";
  const srcs = (d.source_titles || []).map(t => `<span class="badge b-blue">📚 ${escapeHtml(trunc(t, 60))}</span>`).join(" ");
  const reuse = d.reused
    ? `<span class="badge b-purple">♻ Reused from knowledge base · entry #${d.matched_id}</span>`
    : `<span class="badge b-green">🆕 New answer · stored as KB entry #${d.id != null ? d.id : "—"}</span>`;
  document.getElementById("streamNew").innerHTML = `
    <div class="card ans-card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:10px">
        <div style="display:flex; gap:6px; flex-wrap:wrap">${reuse}<span class="badge b-purple">${escapeHtml(d.jurisdiction || "INTL")}</span><span class="badge ${confCls}">confidence ${conf}%</span></div>
        <span class="small muted">${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div class="small muted" style="margin-bottom:8px"><strong style="color:var(--text)">Q:</strong> ${escapeHtml(d.question)}</div>
      <div class="ans-body">${escapeHtml(d.answer).replace(/\n\n/g, "<br><br>").replace(/\n/g, "<br>")}</div>
      ${srcs ? `<div class="src-meta-row">${srcs}</div>` : ""}
    </div>`;
  document.getElementById("streamNew").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadStream() {
  const qs = await fetchAnsweredQuestions();
  const box = document.getElementById("streamHistory");
  if (!box) return;
  if (!qs.length) {
    box.innerHTML = `<div class="small muted" style="margin-top:14px">No exchanges yet — the first question above starts the knowledge base.</div>`;
    return;
  }
  box.innerHTML = `<h3 style="margin:18px 0 10px">🗄 Knowledge base — answered exchanges <span class="muted small">(${qs.length})</span></h3>` +
    qs.map(q => `
    <div class="card kb-card" onclick="askPrefill(${q.id})" title="Tap to re-ask">
      <div class="small"><strong>Q:</strong> ${escapeHtml(q.question)}</div>
      <div class="small kb-a" style="margin-top:6px"><span style="color:var(--green)">A:</span> ${escapeHtml(trunc(q.answer || "", 280))}</div>
      <div class="small muted" style="margin-top:6px">${q.answered_at ? new Date(q.answered_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}</div>
    </div>`).join("");
}

/* ---------- Projects ---------- */
const projList = document.getElementById("projList");
PROJECTS.forEach(p => {
  const c = document.createElement("div");
  c.className = "card proj-list-item";
  c.innerHTML = `<div style="font-size:24px; margin-bottom:8px">${p.emoji}</div>
    <span class="badge ${p.statusCls}">${p.status}</span>
    <h3 style="margin:10px 0 6px">${p.title}</h3>
    <p class="small muted">${p.desc}</p>
    <p class="small" style="margin-top:10px; color:var(--blue)">Open workspace →</p>`;
  c.onclick = () => openProject(p.id);
  projList.appendChild(c);
});

function openProject(id) {
  const p = PROJECTS.find(x => x.id === id);
  logEvent("project_opened", "projects", { project_id: id });
  const d = document.getElementById("projDetail");
  d.innerHTML = p.detail;
  d.style.display = "block";
  d.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- Monitoring ---------- */
document.getElementById("feedBox").innerHTML = FEED.map(f => `
  <div class="feed-item">
    <span class="feed-dot dot-${f.lvl}"></span>
    <span class="small"><span class="muted">${f.t}</span> — ${f.txt}</span>
  </div>`).join("");

document.getElementById("gapBars").innerHTML = GAP_BARS.map(g => `
  <div class="bar-row">
    <span>${g.name}<br><span class="muted" style="font-size:11px">${g.note}</span></span>
    <div class="bar-track"><div class="bar-fill ${g.cls}" style="width:${g.pct}%"></div></div>
    <span>${g.pct}%</span>
  </div>`).join("") +
  `<p class="small muted" style="margin-top:6px">Policy drift is a <strong style="color:var(--text)">monitored metric</strong>, not a silent decay. Each gap carries citations to both sides.</p>`;

document.getElementById("noticeTable").innerHTML = NOTICES.map(n => `
  <tr><td>${n.p}</td><td><span class="badge ${n.cls}">${n.s}</span></td><td>${n.d}</td><td class="muted">${n.age}</td></tr>`).join("");

document.getElementById("breachBox").innerHTML = BREACH.map(b => `
  <div style="padding:8px 0; border-bottom:1px solid var(--border)" class="small">• ${b.txt}</div>`).join("") +
  `<p class="small muted" style="margin-top:8px">When an incident hits, the pattern base turns per-incident guesswork into evidence-based judgment.</p>`;

document.getElementById("remBox").innerHTML = REMEDIATION.map(r => `
  <div style="padding:8px 0; border-bottom:1px solid var(--border)" class="small">${r.txt}</div>`).join("");

document.getElementById("horizonBox").innerHTML = HORIZON.map(h => `
  <div style="padding:8px 0; border-bottom:1px solid var(--border)" class="small">• ${h.txt}</div>`).join("");

/* deep-link support (#ask etc.) */
if (location.hash) {
  const s = location.hash.replace("#", "");
  if (document.getElementById(s)) go(s);
}
logEvent("session_start", location.hash ? location.hash.replace("#", "") : "home");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

initAsk();
setInterval(loadStream, 60000);

/* ---------- External regulatory sources (DDP taxonomy auto-tagging) ---------- */
let TAXONOMY = null;

async function initSourcePanel() {
  try {
    const r = await fetch(LWB_API.replace("/question", "/taxonomy"));
    if (r.ok) TAXONOMY = await r.json();
  } catch {}
  const jurSel = document.getElementById("srcJur");
  const instSel = document.getElementById("srcInst");
  if (TAXONOMY && jurSel) {
    TAXONOMY.jurisdictions.forEach(j => {
      const o = document.createElement("option"); o.value = j; o.textContent = j; jurSel.appendChild(o);
    });
    TAXONOMY.instrument_types.forEach(t => {
      const o = document.createElement("option"); o.value = t; o.textContent = t; instSel.appendChild(o);
    });
  }
  loadSources();
}

async function addSource() {
  const title = document.getElementById("srcTitle").value.trim();
  const st = document.getElementById("srcStatus");
  if (!title) { st.style.display = "block"; st.innerHTML = "⚠️ <span style='color:var(--amber)'>Title is required.</span>"; return; }
  const btn = document.getElementById("srcAdd");
  btn.disabled = true; btn.textContent = "⚙ Classifying against DDP taxonomy…";
  st.style.display = "block";
  st.innerHTML = "<span class='muted'>⚡ The classification engine is reading the source and mapping it to taxonomy nodes…</span>";
  logEvent("source_add_attempt", "kmbase", { title: title.slice(0, 200) });
  const payload = {
    title,
    publisher: document.getElementById("srcPublisher").value.trim() || null,
    url: document.getElementById("srcUrl").value.trim() || null,
    description: document.getElementById("srcDesc").value.trim() || null,
    jurisdiction: document.getElementById("srcJur").value || null,
    instrument_type: document.getElementById("srcInst").value || null,
  };
  try {
    const r = await fetch(LWB_API.replace("/question", "/source"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, added_by: visitorId() })
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    logEvent("source_added", "kmbase", { title: title.slice(0, 200), taxonomy_ids: d.source.taxonomy_ids, tags: d.source.tags });
    ["srcTitle", "srcPublisher", "srcUrl", "srcDesc"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("srcJur").value = ""; document.getElementById("srcInst").value = "";
    st.innerHTML = renderSourceCard(d.source, true);
    loadSources();
  } catch (e) {
    st.innerHTML = "⚠️ <span style='color:var(--amber)'>Classification failed</span> — " + escapeHtml(String(e.message || e)) + ". Try again in a moment.";
  }
  btn.disabled = false; btn.textContent = "⚡ Add & auto-tag";
}

function renderSourceCard(s, fresh) {
  const ids = (s.taxonomy_ids || []).map(id => {
    const lbl = (s.taxonomy_labels && s.taxonomy_labels[id]) || (TAXONOMY && TAXONOMY.nodes[id]) || id;
    return `<span class="badge b-purple" title="${escapeHtml(lbl)}">${escapeHtml(id)} · ${escapeHtml(lbl)}</span>`;
  }).join(" ");
  const tags = (s.tags || []).map(t => `<span class="badge b-blue">#${escapeHtml(t)}</span>`).join(" ");
  const conf = Math.round((s.confidence || 0) * 100);
  const confCls = conf >= 80 ? "b-green" : (conf >= 60 ? "b-med" : "b-red");
  const when = s.added_at ? new Date(s.added_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
  return `<div class="src-card"${fresh ? " style='border-left:3px solid var(--green)'" : ""}>
    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap">
      <strong class="small">${escapeHtml(s.title)}</strong>
      ${when ? `<span class="muted" style="font-size:11px">${escapeHtml(when)}</span>` : ""}
    </div>
    ${s.publisher ? `<div class="small muted" style="margin-top:2px">${escapeHtml(s.publisher)}${s.url ? ` · <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="color:var(--blue)">link ↗</a>` : ""}</div>` : (s.url ? `<div class="small muted"><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="color:var(--blue)">link ↗</a></div>` : "")}
    ${s.description ? `<div class="small" style="margin-top:4px">${escapeHtml(s.description)}</div>` : ""}
    <div class="src-meta-row">${ids}</div>
    ${tags ? `<div class="src-meta-row">${tags}</div>` : ""}
    <div class="src-meta-row">
      <span class="badge b-med">${escapeHtml(s.instrument_type || "?")}</span>
      <span class="badge b-med">${escapeHtml(s.jurisdiction || "?")}</span>
      <span class="badge b-med">${escapeHtml(s.temporal_status || "?")}</span>
      <span class="badge ${confCls}">confidence ${conf}%</span>
    </div>
    ${s.rationale ? `<div class="small muted" style="margin-top:8px">💡 ${escapeHtml(s.rationale)}</div>` : ""}
  </div>`;
}

async function loadSources() {
  const box = document.getElementById("srcRegistry");
  const cnt = document.getElementById("srcCount");
  try {
    const r = await fetch(LWB_API.replace("/question", "/sources"));
    if (!r.ok) throw new Error("HTTP " + r.status);
    const d = await r.json();
    if (cnt) cnt.textContent = d.count ? `(${d.count})` : "";
    if (!d.sources.length) {
      box.innerHTML = `<span class="small muted">No sources yet — add the first one above. Example: “EDPB Guidelines on Article 6(1)(f) legitimate interest”.</span>`;
      return;
    }
    box.innerHTML = d.sources.map(s => renderSourceCard(s, false)).join("");
  } catch (e) {
    box.innerHTML = `<span class="small muted">Registry temporarily unavailable (${escapeHtml(String(e.message || e))}).</span>`;
  }
}

initSourcePanel();
setInterval(loadSources, 60000);
