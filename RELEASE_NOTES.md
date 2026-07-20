# Voice Garden v1.0 - Release Notes

**Release Date:** July 20, 2026  
**Version:** v1.0-Voice-Garden  
**Codename:** Voice Garden

---

## 🌱 Overview

Voice Garden represents a major milestone in the SpeakEasy AI English Trainer app, focusing on user experience, visual design, and core functionality improvements. This release transforms the app into a polished, professional platform for English conversation practice.

---

## ✨ New Features

### 30-Day Challenge Program
- **Hero Section:** Prominent 30-day challenge banner on homepage with compelling statistics
  - 15 minutes per day
  - 30 days to transformation
  - 3x faster progress
  - 100+ conversation topics
- **Timeline Visualization:** Interactive 4-week journey showing progression from Foundation to Fluency
- **Call-to-Action:** Clear entry point for users to begin their 30-day journey

### Grammar-Based Scoring System
- **Real-time Grammar Checking:** AI analyzes each message for grammatical errors
- **Accuracy Score:** 100% starting score, minus 5 points per grammar error
- **Immediate Feedback:** Users see their accuracy percentage after each conversation
- **Progress Tracking:** Average accuracy displayed in dashboard

### Enhanced Conversation Management
- **Manual Start:** Users must click "Start Conversation" button to begin (no auto-start)
- **Conversation History:** View past conversations with detailed metrics
  - Duration (formatted as minutes/seconds)
  - Word count
  - Message count
  - Accuracy percentage
- **Progressive Disclosure:** Shows last 5 conversations with "Show more" button
- **Session Stats:** Real-time display of time, words, and turns during conversation

### Progress Dashboard
- **Total Sessions:** Count of completed conversations
- **Words Spoken:** Cumulative word count across all sessions
- **Average Accuracy:** Mean accuracy score across all conversations
- **Total Practice Time:** Cumulative time spent in conversations

---

## 🎨 UI/UX Improvements

### Homepage Redesign
- **Hero Section:** Eye-catching 30-day challenge with gradient background
- **Features Section:** Enhanced "Why SpeakEasy AI?" with:
  - Circular gradient icon backgrounds
  - Hover effects with elevation and rotation
  - Larger, more readable typography
  - Better visual hierarchy

### About Page Overhaul
- **Research-Backed Content:** Comprehensive methodology section
- **Study Cards:** Detailed research studies with key findings
- **Benefits Grid:** Six key benefits with icons and descriptions
- **References Section:** Full academic citations
- **Consistent Design:** Matches homepage visual language

### Practice Page Improvements
- **Session Stats Bar:** Moved into conversation area with gradient background
- **Better Layout:** Cleaner spacing and visual hierarchy
- **Conversation Controls:** Improved microphone and end conversation buttons
- **Responsive Design:** Better mobile experience

### Unified Footer
- **Consistent Across All Pages:** Same footer structure everywhere
- **Updated Messaging:** "AI-powered English conversation practice backed by science and driven by the passion of a group of teachers and technologists"
- **Quick Links:** Easy navigation to key pages
- **Research Links:** Direct access to methodology, studies, and references

### CSS Consolidation
- **Single Stylesheet:** All inline styles moved to `styles.css`
- **Maintainability:** Easier to update and maintain consistent styling
- **Performance:** Reduced HTML file sizes
- **Consistency:** Ensures uniform appearance across all pages

---

## 🔧 Technical Improvements

### Authentication & Security
- **JWT Token Management:** Fixed token expiration with Supabase client auto-refresh
- **Logout Handler:** Fixed syntax error (missing async keyword)
- **User ID Tracking:** Properly associates conversations and messages with users

### Backend Enhancements
- **New Endpoint:** `/api/conversation/end` to properly save conversation statistics
- **Grammar Checking:** Integrated GPT-3.5-turbo for real-time grammar analysis
- **Duration Calculation:** Computes conversation duration from start/end timestamps
- **Database Schema:** Gracefully handles missing columns

### Database Improvements
- **Clean Slate:** Reset all conversation history for fresh start
- **Proper Indexing:** Better query performance for conversation history
- **Data Integrity:** Fixed user_id associations in messages table

### Progress Tracking
- **Stats Calculation:** Fixed progress stats endpoint to calculate duration correctly
- **History Display:** Compact format showing duration (e.g., "3m" or "45s")
- **Accuracy Display:** Shows percentage with proper formatting

---

## 📱 Platform Support

### Web Browsers
- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)

### Mobile
- ✅ iOS Safari (with known limitations - see below)
- ✅ Android Chrome
- ✅ Responsive design for all screen sizes

---

## ⚠️ Known Issues

### iOS Audio Playback
**Issue:** Tutor voice only plays for the first greeting, not for subsequent AI responses.

**Root Cause:** iOS Safari has strict autoplay policies that block audio playback after async operations complete. Multiple attempts to fix this (using AudioContext, single Audio element with unlock) broke the app's core functionality.

**Current Workaround:** Audio plays on first greeting only. Users can still see the AI's text responses.

**Future Fix:** Requires deeper investigation into iOS Safari audio policies, possibly involving:
- Pre-loading audio files
- Using Web Audio API with proper context management
- Implementing user gesture requirements more carefully

---

## 🚀 Deployment

### Live Application
**URL:** https://english-trainer-go4p.onrender.com

### Technology Stack
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla)
- **Backend:** FastAPI (Python)
- **Database:** Supabase (PostgreSQL)
- **AI:** OpenAI GPT-3.5-turbo
- **TTS:** Backend audio generation
- **Hosting:** Render.com

### Deployment Process
1. Code pushed to GitHub main branch
2. Render automatically deploys from main
3. Database migrations handled via Supabase dashboard
4. Environment variables managed in Render dashboard

---

## 📊 Metrics & Analytics

### Conversation Tracking
- Total conversations started
- Average conversation duration
- Words spoken per conversation
- Grammar accuracy trends

### User Engagement
- Daily active users
- 30-day challenge completion rate
- Topic preferences
- Session frequency

---

## 🎯 Future Roadmap

### Voice Garden v1.1 (Planned)
- [ ] Fix iOS audio playback issue
- [ ] Implement pronunciation feedback feature
- [ ] Add conversation topic recommendations
- [ ] Improve mobile navigation

### Voice Garden v1.2 (Planned)
- [ ] User profiles and avatars
- [ ] Conversation bookmarks
- [ ] Export conversation history
- [ ] Dark mode support

### Future Considerations
- [ ] Multi-language support (beyond English)
- [ ] Speech-to-text accuracy improvements
- [ ] AI personality customization
- [ ] Social features (leaderboards, challenges)

---

## 🙏 Acknowledgments

This release represents the collaborative effort of:
- **Development Team:** Passionate teachers and technologists
- **Research Foundation:** Built on peer-reviewed language learning research
- **User Feedback:** Insights from early testers and users
- **Open Source Community:** Various libraries and tools that made this possible

---

## 📝 Git History Summary

**Total Commits in this Release:** 15+ major commits

**Key Commits:**
- `dceabbc` - Update footer text to mention teachers and technologists
- `64f4a87` - Move CTA button inside hero section
- `bccec86` - Move note below CTA button
- `1f64647` - Move CTA button below hero section
- `e6eabe8` - Remove white pill background from hero CTA
- `dbefdf7` - Fix practice page top padding
- `1713554` - Move session stats into conversation area
- `f2a8b56` - Fix user_id in message inserts
- `87ad73e` - Fix conversation history display
- `2466ed1` - Simplify scoring to grammar-only
- `267efbc` - Add accuracy scoring

---

## 📞 Support

For issues, questions, or feedback:
- **GitHub Issues:** https://github.com/amik2030/English-trainer/issues
- **Email:** contact@speekasy.ai

---

## 📄 License

© 2026 SpeakEasy AI. All rights reserved.

---

**Voice Garden v1.0** - Growing confident English speakers, one conversation at a time. 🌱🗣️
