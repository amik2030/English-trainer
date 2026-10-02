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

/* ---------- Ask screen ---------- */
const chipBox = document.getElementById("chipBox");
SAMPLE_QUERIES.forEach(q => {
  const b = document.createElement("button");
  b.className = "chip";
  b.innerHTML = `<span class="chip-mode">${q.mode}</span>${q.chip}`;
  b.onclick = () => { document.getElementById("askInput").value = q.chip; runQuery(q.id); };
  chipBox.appendChild(b);
});

document.getElementById("askInput").addEventListener("keydown", e => {
  if (e.key === "Enter") runQuery();
});

let currentQuery = null;

function runQuery(forcedId) {
  const input = document.getElementById("askInput").value.trim();
  if (!input && !forcedId) return;
  const q = forcedId
    ? SAMPLE_QUERIES.find(x => x.id === forcedId)
    : (SAMPLE_QUERIES.find(x => x.chip === input) || SAMPLE_QUERIES[0]);
  currentQuery = q;
  logEvent("query_run", "ask", { query_id: q.id, question: q.chip });

  const box = document.getElementById("answerBox");
  box.classList.remove("on");
  document.getElementById("reviewResult").style.display = "none";

  // staged "thinking" for realism
  const thinking = document.getElementById("thinking");
  const thinkText = document.getElementById("thinkText");
  thinking.classList.add("on");
  let step = 0;
  const iv = setInterval(() => {
    thinkText.textContent = THINK_STEPS[step % THINK_STEPS.length];
    step++;
  }, 380);

  setTimeout(() => {
    clearInterval(iv);
    thinking.classList.remove("on");
    renderAnswer(q);
  }, 2400);
}

function renderAnswer(q) {
  document.getElementById("ansType").textContent = q.type;
  document.getElementById("ansJur").textContent = q.jur;
  document.getElementById("ansTime").textContent =
    "Answer generated in 6.4s · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  document.getElementById("ansBody").innerHTML = q.answer;

  document.getElementById("srcCount").textContent = "(" + q.sources.length + ")";
  document.getElementById("srcList").innerHTML = q.sources.map(s => `
    <div class="src-item">
      <span class="src-ico">${s.ico}</span>
      <span>${s.txt}<br><span class="muted" style="font-size:11.5px">${s.tag} · <span style="color:var(--green)">${s.conf}</span></span></span>
    </div>`).join("");

  document.getElementById("verBox").innerHTML = q.ver.map(v => `
    <div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border)" class="small">
      <span class="muted">${v.label}</span><span class="badge ${v.cls}">${v.val}</span>
    </div>`).join("") +
    `<p class="small muted" style="margin-top:10px">Every claim is checked against retrieved sources by an NLI verifier before you see it. Unsupported claims never reach the answer.</p>`;

  const gap = document.getElementById("gapFlag");
  if (q.gap) { gap.style.display = "block"; gap.innerHTML = q.gap; }
  else gap.style.display = "none";

  const box = document.getElementById("answerBox");
  box.classList.add("on");
  // staggered reveal
  const blocks = box.querySelectorAll(":scope > *");
  blocks.forEach((b, i) => {
    b.classList.remove("show");
    b.style.opacity = "0";
    b.style.transform = "translateY(8px)";
    b.style.transition = "all .45s ease";
    setTimeout(() => { b.style.opacity = "1"; b.style.transform = "none"; }, 120 * i);
  });
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function review(action) {
  logEvent("review_decision", "ask", { query_id: currentQuery ? currentQuery.id : null, decision: action });
  const rr = document.getElementById("reviewResult");
  rr.style.display = "block";
  const ts = new Date().toLocaleString();
  if (action === "approved") {
    rr.innerHTML = `✅ <span style="color:var(--green)">Approved</span> — logged to audit trail (query → chunks → output → your decision). Answer stored in the answer log; future similar queries will surface it first. <span class="muted">(${ts} · reviewer: you)</span>`;
    toast("✅ Approved &amp; shared. The answer is now a documented position — the 2nd identical question answers itself.");
  } else if (action === "revise") {
    rr.innerHTML = `✎ <span style="color:var(--amber)">Revision requested</span> — your corrections are captured and feed back: future summaries and synthesis improve from this review. <span class="muted">(${ts})</span>`;
    toast("✎ Revision routed back with your comments. Corrections improve the knowledge base — feedback loop in action.");
  } else {
    rr.innerHTML = `✗ <span style="color:var(--red)">Rejected</span> — output quarantined, never shared. Rejection reason requested for the audit trail and gap analysis. <span class="muted">(${ts})</span>`;
    toast("✗ Rejected &amp; quarantined. Nothing leaves the Workbench without human approval.");
  }
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

/* ---------- Question wall (Supabase) ---------- */
async function askQuestion() {
  const inp = document.getElementById("qInput");
  const st = document.getElementById("qStatus");
  const q = inp.value.trim();
  if (!q) return;
  const btn = document.getElementById("qSubmit");
  btn.disabled = true; btn.textContent = "…";
  const ok = await submitQuestion(q);
  btn.disabled = false; btn.textContent = "Submit";
  st.style.display = "block";
  if (ok) {
    inp.value = "";
    st.innerHTML = "✅ <span style='color:var(--green)'>Submitted!</span> Your question is now in the DDP team's review queue — answered questions appear below. <span class='muted'>(logged to the live audit trail — the same pattern the real platform uses.)</span>";
    logEvent("question_submit", "ask", { question: q.slice(0, 200) });
  } else {
    st.innerHTML = "⚠️ <span style='color:var(--amber)'>Submission temporarily unavailable</span> — the demo works fully offline; try again later.";
  }
}

async function loadAnswered() {
  const qs = await fetchAnsweredQuestions();
  const box = document.getElementById("qAnswered");
  if (!qs.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<h3 style="margin-top:6px">✅ Answered by the team</h3>` + qs.map(q => `
    <div style="border-left:3px solid var(--green); padding:8px 14px; margin-bottom:10px; background:var(--panel2); border-radius:0 10px 10px 0">
      <div class="small"><strong>Q:</strong> ${escapeHtml(q.question)}</div>
      <div class="small" style="margin-top:6px"><span style="color:var(--green)">A:</span> ${escapeHtml(q.answer || "")}</div>
    </div>`).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadAnswered();
setInterval(loadAnswered, 60000);
