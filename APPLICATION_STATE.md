# SpeakEasy AI - Application State & Troubleshooting Guide

**Last Updated:** 2026-07-20  
**Status:** ✅ Working MVP  
**Live URL:** https://english-trainer-go4p.onrender.com

---

## 🏗️ Architecture Overview

### Tech Stack
- **Frontend:** HTML/CSS/JavaScript (vanilla, no framework)
- **Backend:** FastAPI (Python 3.14)
- **Database:** Supabase (PostgreSQL)
- **Authentication:** Supabase Auth (email/password)
- **AI:** OpenAI API (GPT-4)
- **Hosting:** Render (backend + frontend)
- **Version Control:** GitHub

### Infrastructure
```
GitHub (amik2030/English-trainer)
    ↓ auto-deploy
Render (english-trainer service: srv-d9du4jernols73d73cv0)
    ↓ serves
Frontend (HTML/CSS/JS) + Backend (FastAPI)
    ↓ connects to
Supabase (Auth + Database)
```

### Key Files
- **Backend:** `backend/main.py` (FastAPI app)
- **Frontend:** `frontend/*.html` (index, signup, login, trainer, dashboard)
- **Database:** Supabase tables (users, conversations, progress)
- **Config:** `backend/.env` (environment variables)

---

## 🐛 Critical Bugs Fixed (2026-07-20)

### Bug #1: Corrupted Backend Syntax
**Problem:** `backend/main.py` had corrupted lines with `***` instead of `os.environ.get()`  
**Symptom:** `SyntaxError: unmatched ')'` on Render deploy  
**Root Cause:** File corruption during editing  
**Fix:** Replaced all `***"VAR_NAME")` with `os.environ.get("VAR_NAME")`  
**Commit:** `5822252`

**Lesson:** Always validate Python syntax locally before pushing:
```bash
python3 -m py_compile backend/main.py
```

---

### Bug #2: Fake Supabase Keys
**Problem:** Frontend had placeholder Supabase anon key (`sb_publishable_k514gfd5YtchDsftJjRqUw_w5uEBayH`)  
**Symptom:** Auth requests failed silently, no user creation  
**Root Cause:** Initial setup used fake keys  
**Fix:** Replaced with real keys from Supabase dashboard (Settings → API)  
**Commit:** `3a82594`

**Lesson:** Always verify keys are real JWTs (start with `eyJ...`), not placeholders.

---

### Bug #3: Supabase Variable Name Conflict
**Problem:** `const supabase = window.supabase.createClient(...)` conflicted with Supabase SDK's global `window.supabase`  
**Symptom:** `Uncaught SyntaxError: Identifier 'supabase' has already been declared`  
**Root Cause:** Variable naming collision with SDK  
**Fix:** Renamed to `const supabaseClient = window.supabase.createClient(...)`  
**Commit:** `422f680`

**Lesson:** Avoid naming variables the same as SDK globals. Use suffixes like `Client` or `Instance`.

---

### Bug #4: Form Submitting via GET Request
**Problem:** Form credentials appeared in URL (`?email=...&password=...`)  
**Symptom:** Supabase auth never called, credentials leaked in URL  
**Root Cause:** Form default behavior (GET) not prevented  
**Fix:** Changed button from `type="submit"` to `type="button"` with click handler  
**Commit:** `e96cb9a`

**Lesson:** For SPA-style auth, use button click handlers instead of form submit to prevent default behavior.

---

### Bug #5: Null Button Reference
**Problem:** `submitBtn` was null after changing from form submit to button click  
**Symptom:** `TypeError: Cannot set properties of null (setting 'textContent')`  
**Root Cause:** `this.querySelector('.signup-btn')` failed because `this` referred to button, not form  
**Fix:** Changed to `document.getElementById('signupBtn')`  
**Commit:** `07f1481`

**Lesson:** When changing event handlers, update all DOM references that depend on `this` context.

---

### Bug #6: Render Auto-Deploy Not Triggering
**Problem:** Render didn't auto-deploy after git push  
**Symptom:** Old commits still deployed  
**Root Cause:** Webhook not configured or failing  
**Fix:** Manual deploy via Render dashboard (Manual Deploy → Deploy latest commit)  
**Workaround:** Always use manual deploy if auto-deploy fails

**Lesson:** Render auto-deploy can be unreliable. Use manual deploy for critical fixes.

---

## ✅ Current Working State

### Authentication Flow
1. User visits `/signup.html`
2. Enters email + password
3. Clicks "Sign Up" button (type="button", not submit)
4. JavaScript calls `supabaseClient.auth.signUp()`
5. On success: redirects to `/dashboard.html` or `/login.html` (if email confirmation required)
6. User logs in via `/login.html`
7. After login: redirected to `/dashboard.html`

### Key Environment Variables (Render)
```
OPENAI_API_KEY=***
SUPABASE_URL=https://qiapbljkhbpybhqcshjo.supabase.co
SUPABASE_KEY=eyJhbG... (real anon key)
SUPABASE_SERVICE_KEY=eyJhbG... (real service role key)
```

### Supabase Configuration
- **Project URL:** https://qiapbljkhbpybhqcshjo.supabase.co
- **Auth:** Email/password enabled
- **Tables:** users, conversations, progress (schema in `supabase/` folder)
- **RLS:** Enabled (Row Level Security)

---

## 🔧 Troubleshooting Checklist

### If Signup/Login Doesn't Work

1. **Check Browser Console (F12 → Console)**
   - Look for red error messages
   - Common errors:
     - `SyntaxError` → Code syntax issue
     - `TypeError: Cannot read property of null` → DOM element not found
     - `Identifier already declared` → Variable naming conflict
     - `Invalid API key` → Supabase keys are wrong

2. **Check Network Tab (F12 → Network)**
   - Look for failed requests (red)
   - Check request/response payloads
   - Verify Supabase API calls are being made

3. **Verify Supabase Keys**
   - Go to Supabase dashboard → Settings → API
   - Copy anon key and service_role key
   - Check they start with `eyJ...` (real JWTs)
   - Update in:
     - `frontend/signup.html` (line ~177)
     - `frontend/login.html` (line ~177)
     - `frontend/trainer.html` (line ~177)
     - `backend/.env` (SUPABASE_KEY, SUPABASE_SERVICE_KEY)
     - Render environment variables

4. **Check Backend Logs (Render Dashboard)**
   - Look for Python errors on startup
   - Common issues:
     - `SyntaxError` → Fix Python code
     - `ModuleNotFoundError` → Add to `requirements.txt`
     - `ValueError: environment variables required` → Check Render env vars

5. **Force Browser Cache Refresh**
   - Hard refresh: `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or use Incognito/Private window
   - Or add cache-busting: `?v=2` to script URLs

6. **Manual Deploy on Render**
   - Go to Render dashboard → english-trainer service
   - Click "Manual Deploy" → "Deploy latest commit"
   - Wait for build to complete (2-3 min)

---

## 🚀 Deployment Process

### Standard Deploy
```bash
# 1. Make changes locally
# 2. Test locally (if possible)
# 3. Commit and push
git add .
git commit -m "Description of changes"
git push origin main

# 4. Trigger Render deploy (if auto-deploy fails)
# Go to Render dashboard → Manual Deploy → Deploy latest commit

# 5. Wait for build (2-3 min)
# 6. Test in incognito mode
```

### Emergency Fix
If the app is broken:
1. Check Render logs for the error
2. Fix locally
3. Validate syntax: `python3 -m py_compile backend/main.py`
4. Commit and push
5. Manual deploy on Render
6. Test in incognito mode

---

## 📊 Performance & Cost

### Render (Free Tier)
- **Service:** Web service (Python)
- **Instance:** 512MB RAM, 0.1 CPU
- **Cost:** Free (spins down after 15 min inactivity)
- **Cold start:** ~30 seconds when waking up
- **Limitation:** Not suitable for production (slow, unreliable)

### Supabase (Free Tier)
- **Database:** 500MB PostgreSQL
- **Auth:** 50,000 MAU (Monthly Active Users)
- **Storage:** 1GB
- **Cost:** Free
- **Limitation:** Pauses after 1 week of inactivity

### OpenAI API
- **Model:** GPT-4 (via API)
- **Cost:** ~$0.03 per 1K tokens (input), ~$0.06 per 1K tokens (output)
- **Usage:** Conversation practice (voice + text)
- **Limitation:** Pay-as-you-go, can get expensive with heavy usage

**Total Monthly Cost (MVP):** $0 (all free tiers)  
**Estimated Cost (100 users):** ~$50-100/month (mostly OpenAI API)

---

## 🎯 Next Steps for Production

### Before Launching
1. **Upgrade Render to paid tier** ($7/month) for reliability
2. **Add email confirmation** in Supabase (currently disabled)
3. **Implement rate limiting** to prevent API abuse
4. **Add error logging** (Sentry or similar)
5. **Set up monitoring** (Render alerts, Supabase monitoring)
6. **Test with real users** (10 beta testers)
7. **Collect feedback** on UX and features

### Scaling Considerations
1. **Database:** Supabase scales well, but monitor query performance
2. **Backend:** Consider serverless (AWS Lambda, Vercel) for cost efficiency
3. **Frontend:** Move to a framework (React, Vue) for better UX
4. **AI:** Implement caching to reduce OpenAI API costs
5. **Auth:** Consider adding OAuth (Google, GitHub) for easier signup

---

## 📝 Development Notes

### Code Conventions
- Use `supabaseClient` (not `supabase`) to avoid SDK conflicts
- Use button click handlers (not form submit) for SPA-style auth
- Always validate Python syntax before pushing
- Test in incognito mode to avoid cache issues

### Common Pitfalls
- **Cache issues:** Always test in incognito or hard refresh
- **Variable naming:** Avoid conflicts with SDK globals
- **Form submission:** Use button click, not form submit
- **Environment variables:** Verify keys are real JWTs, not placeholders
- **Render auto-deploy:** Use manual deploy if it fails

### Testing Checklist
- [ ] Signup flow works
- [ ] Login flow works
- [ ] Dashboard loads after login
- [ ] Conversation practice works
- [ ] Voice recording works
- [ ] Progress tracking works
- [ ] Logout works
- [ ] Error messages display correctly

---

## 🔐 Security Notes

### Current State
- ✅ Supabase RLS enabled (Row Level Security)
- ✅ Environment variables not in git (`.env` in `.gitignore`)
- ✅ API keys stored in Render environment variables
- ⚠️ Email confirmation disabled (users can login without verifying email)
- ⚠️ No rate limiting on API endpoints
- ⚠️ No input sanitization (potential XSS risk)

### Before Production
- Enable email confirmation in Supabase
- Add rate limiting (e.g., 10 requests/minute per user)
- Sanitize all user inputs
- Add CORS restrictions (limit to your domain)
- Implement proper error handling (don't expose stack traces)
- Add HTTPS enforcement (Render does this automatically)

---

## 📚 Resources

### Documentation
- [Supabase Docs](https://supabase.com/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [Render Docs](https://render.com/docs)
- [OpenAI API Docs](https://platform.openai.com/docs)

### Support
- Render Dashboard: https://dashboard.render.com
- Supabase Dashboard: https://supabase.com/dashboard
- GitHub Repo: https://github.com/amik2030/English-trainer

---

## 🎓 Lessons Learned

1. **Always test locally before deploying** — catches syntax errors early
2. **Use incognito mode for testing** — avoids cache confusion
3. **Check browser console first** — 90% of frontend issues show up there
4. **Validate environment variables** — fake keys cause silent failures
5. **Avoid SDK naming conflicts** — use suffixes like `Client` or `Instance`
6. **Manual deploy is your friend** — auto-deploy can be unreliable
7. **Document everything** — future you will thank present you
8. **Start simple** — vanilla JS works fine for MVP, no need for frameworks
9. **Free tiers have limits** — plan for paid tiers before production
10. **Debugging takes time** — don't rush, be methodical

---

**This document is the source of truth for the application state. Update it after every major change or fix.**
