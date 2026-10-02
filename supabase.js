/* ============ SUPABASE LAYER — demo analytics + question wall ============ */
const SUPA_URL = "https://qiapbljkhbpybhqcshjo.supabase.co";
const SUPA_ANON = "eyJhbG…NKCc";

// visitor id in localStorage
function visitorId() {
  let v = localStorage.getItem("lwb_visitor");
  if (!v) { v = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); localStorage.setItem("lwb_visitor", v); }
  return v;
}

const headers = { "apikey": SUPA_ANON, "Authorization": "Bearer " + SUPA_ANON, "Content-Type": "application/json" };

// fire-and-forget event logging (demo degrades gracefully if tables absent)
function logEvent(event_type, screen, detail = {}) {
  fetch(SUPA_URL + "/rest/v1/demo_events", {
    method: "POST", headers,
    body: JSON.stringify({ visitor_id: visitorId(), event_type, screen, detail })
  }).catch(() => {});
}

// question wall
async function submitQuestion(q) {
  const r = await fetch(SUPA_URL + "/rest/v1/demo_questions", {
    method: "POST", headers,
    body: JSON.stringify({ visitor_id: visitorId(), question: q })
  });
  return r.ok || r.status === 201;
}

async function fetchAnsweredQuestions() {
  try {
    const r = await fetch(SUPA_URL + "/rest/v1/demo_questions?status=eq.answered&order=answered_at.desc&limit=20", { headers });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}
