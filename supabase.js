/* ============ SUPABASE LAYER — demo analytics + question wall ============ */
const SUPA_URL = "https://qiapbljkhbpybhqcshjo.supabase.co";
const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFpYXBibGpraGJweWJocWNzaGpvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyOTE4MDIsImV4cCI6MjA5OTg2NzgwMn0.zba_NfWkl8SpZXXzWeiEcqIH6FSZ2KUnaw94y9CNKkc";

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

// question wall — instant answer via Workbench answering board
const LWB_API = "https://english-trainer-go4p.onrender.com/api/demo/question";

async function submitQuestion(q) {
  // Ask the answering board — it logs the question AND returns an immediate answer
  try {
    const r = await fetch(LWB_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, visitor_id: visitorId() })
    });
    if (r.ok) return await r.json();
  } catch {}
  // fallback: queue-only submit (demo degrades gracefully if API is down)
  try {
    const r2 = await fetch(SUPA_URL + "/rest/v1/demo_questions", {
      method: "POST", headers,
      body: JSON.stringify({ visitor_id: visitorId(), question: q })
    });
    if (r2.ok || r2.status === 201) return { queued: true };
  } catch {}
  return null;
}

async function fetchAnsweredQuestions() {
  try {
    const r = await fetch(SUPA_URL + "/rest/v1/demo_questions?status=eq.answered&order=answered_at.desc&limit=20", { headers });
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}
