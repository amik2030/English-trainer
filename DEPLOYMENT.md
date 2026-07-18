# SpeakEasy AI - Deployment Guide

This guide will deploy your English trainer app using **Supabase** (database + auth) and **Render** (backend hosting).

---

## Overview

```
User Browser
    ↓
Render (FastAPI backend)
    ↓
Supabase (PostgreSQL + Auth)
    ↓
OpenAI API (Whisper, GPT-4, TTS)
```

---

## Step 1: Set Up Supabase (30 minutes)

### 1.1 Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click **"New Project"**
3. Fill in:
   - **Project name**: `speakeasy-ai`
   - **Database password**: (choose a strong password, save it somewhere safe)
   - **Region**: Choose closest to your users (e.g., `US East` for US users)
4. Click **"Create new project"**
5. Wait 2-3 minutes for the project to initialize

### 1.2 Run the Database Schema

1. In your Supabase dashboard, click **"SQL Editor"** in the left sidebar
2. Click **"New query"**
3. Open the file `supabase/schema.sql` from your project
4. Copy the entire contents and paste into the SQL Editor
5. Click **"Run"** (or press Ctrl+Enter)
6. You should see: `Success. No rows returned`

This creates:
- `profiles` table (user profiles)
- `conversations` table (conversation history)
- `messages` table (individual messages)
- Row Level Security (RLS) policies
- Auto-create profile trigger

### 1.3 Get Your Supabase Credentials

1. Go to **Settings** → **API** in the left sidebar
2. Copy these values (you'll need them later):
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...` (starts with eyJ)
   - **service_role key**: `eyJhbGc...` (different from anon key, starts with eyJ)

⚠️ **Important**: The `service_role` key has full database access. Keep it secret!

### 1.4 Enable Google OAuth (Optional)

If you want users to login with Google:

1. Go to **Authentication** → **Providers** in the left sidebar
2. Click **"Google"**
3. Follow the setup instructions to create a Google OAuth app
4. Copy the **Client ID** and **Client Secret** into Supabase
5. Toggle **"Enable"** for Google provider
6. Click **"Save"**

---

## Step 2: Update Frontend with Supabase Credentials (5 minutes)

### 2.1 Update login.html

Open `frontend/login.html` and find these lines (around line 200):

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace with your actual values from Step 1.3:

```javascript
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGc...';  // Use the anon PUBLIC key
```

### 2.2 Update trainer.html

Open `frontend/trainer.html` and find these lines (around line 280):

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Replace with the same values you used in login.html.

---

## Step 3: Deploy Backend to Render (30 minutes)

### 3.1 Push Code to GitHub

If you haven't already:

```bash
cd /path/to/english-trainer
git init
git add .
git commit -m "Supabase integration"
git remote add origin https://github.com/YOUR_USERNAME/speakeasy-ai.git
git push -u origin main
```

### 3.2 Create Render Account

1. Go to [render.com](https://render.com) and sign up/login
2. You can sign up with GitHub for easier setup

### 3.3 Deploy the Backend

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub account if prompted
3. Select your `speakeasy-ai` repository
4. Configure the service:
   - **Name**: `speakeasy-ai-backend`
   - **Region**: Same as your Supabase region
   - **Branch**: `main`
   - **Root Directory**: Leave blank (or `backend` if you restructured)
   - **Build Command**: `pip install -r backend/requirements.txt`
   - **Start Command**: `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: Choose **"Free"** (or **"Starter"** for $7/month, no sleep)

5. Click **"Advanced"** → **"Add Environment Variable"**
6. Add these environment variables:

| Key | Value |
|-----|-------|
| `OPENAI_API_KEY` | `sk-proj-...` (your OpenAI key) |
| `SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `SUPABASE_KEY` | `eyJhbGc...` (the **anon public** key) |
| `SUPABASE_SERVICE_KEY` | `eyJhbGc...` (the **service_role** key) |

7. Click **"Create Web Service"**
8. Wait 3-5 minutes for deployment

### 3.4 Verify Deployment

1. Once deployed, Render gives you a URL like: `https://speakeasy-ai-backend.onrender.com`
2. Visit `https://speakeasy-ai-backend.onrender.com/` in your browser
3. You should see the homepage or `{"message": "SpeakEasy AI API", "status": "running"}`

---

## Step 4: Test the App (15 minutes)

### 4.1 Test Authentication

1. Visit `https://speakeasy-ai-backend.onrender.com/login.html`
2. Click **"Sign up free"**
3. Enter an email and password
4. You should be redirected to the trainer page

### 4.2 Test a Conversation

1. On the trainer page, select a topic and level
2. Click **"Start Conversation"**
3. Click the microphone button and speak
4. You should see the transcription and get a response from the AI tutor

### 4.3 Test Progress Tracking

1. Complete a short conversation
2. Visit `https://speakeasy-ai-backend.onrender.com/api/progress/stats`
3. You should see your conversation stats (if you're logged in)

---

## Step 5: Custom Domain (Optional, 10 minutes)

### 5.1 Add Custom Domain to Render

1. In Render dashboard, go to your service
2. Click **"Settings"** → **"Custom Domains"**
3. Click **"Add Custom Domain"**
4. Enter your domain (e.g., `speakeasy.yourdomain.com`)
5. Follow the DNS instructions to point your domain to Render

### 5.2 Enable HTTPS

Render automatically provides free SSL certificates via Let's Encrypt. Once your DNS propagates (5-30 minutes), HTTPS will be enabled automatically.

---

## Troubleshooting

### Backend won't start

**Check logs in Render dashboard:**
- Go to your service → **"Logs"**
- Look for error messages

**Common issues:**
- Missing environment variables → Double-check all 4 env vars are set
- Wrong build command → Should be `pip install -r backend/requirements.txt`
- Wrong start command → Should be `cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT`

### Authentication fails

**Check browser console (F12):**
- Look for CORS errors → Make sure Render backend allows CORS from your domain
- Look for 401 errors → Check that SUPABASE_SERVICE_KEY is correct

**Check Supabase dashboard:**
- Go to **Authentication** → **Users** to see if users are being created

### Database errors

**Check Supabase logs:**
- Go to **Database** → **Logs** in Supabase dashboard

**Common issues:**
- Tables not created → Re-run `supabase/schema.sql`
- RLS blocking access → Check that RLS policies were created correctly

### Free tier sleep issue

Render's free tier sleeps after 15 minutes of inactivity. First request after sleep takes 30-60 seconds to wake up.

**Solutions:**
- Upgrade to Starter plan ($7/month) for always-on
- Use a cron job to ping your endpoint every 10 minutes (e.g., [cron-job.org](https://cron-job.org))

---

## Cost Breakdown

| Service | Free Tier | Paid |
|---------|-----------|------|
| **Supabase** | 500MB DB, 50K auth users | $25/month (8GB DB) |
| **Render** | Sleeps after 15 min | $7/month (always on) |
| **OpenAI** | Pay per use (~$1-2 per 30-min session) | Same |
| **Total** | **$0 + OpenAI usage** | **$32/month + OpenAI usage** |

---

## Next Steps

After deployment, you might want to:

1. **Add a progress dashboard** - Create a page to show conversation history and stats
2. **Improve pronunciation analysis** - Integrate Azure Pronunciation Assessment
3. **Add more topics** - Expand the conversation scenarios
4. **Mobile app** - Wrap the web app in React Native or Flutter
5. **Analytics** - Track user engagement and improvement over time

---

## Support

- **Supabase docs**: https://supabase.com/docs
- **Render docs**: https://render.com/docs
- **FastAPI docs**: https://fastapi.tiangolo.com

---

**Deployment complete!** 🎉

Your SpeakEasy AI app is now live with:
- ✅ Real user authentication (email/password + Google OAuth)
- ✅ PostgreSQL database for progress tracking
- ✅ Row Level Security (users can only see their own data)
- ✅ Auto-deploy from GitHub
- ✅ HTTPS with custom domain support
