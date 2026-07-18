# English Voice & Accent Trainer

AI-powered conversation practice with pronunciation feedback.

## Features

- 🎤 **Voice Recording** - Record your speech directly in the browser
- 🤖 **AI Conversation Tutor** - Practice natural conversation with GPT-4
- 🔊 **Text-to-Speech** - Listen to model pronunciation
- 📊 **Basic Analytics** - Track words spoken, session time, and fluency
- 🎯 **Pronunciation Feedback** - Get feedback on word accuracy

## Tech Stack

- **Backend:** Python + FastAPI
- **AI:** OpenAI GPT-4 (conversation), Whisper (speech-to-text), TTS (text-to-speech)
- **Frontend:** Vanilla HTML/CSS/JavaScript
- **Speech:** Browser MediaRecorder API

## Setup

1. Install Python dependencies:
```bash
cd backend
pip install -r requirements.txt
```

2. Set your OpenAI API key:
```bash
# Edit backend/.env and add your OpenAI API key
OPENAI_API_KEY=sk-your-key-here
```

3. Start the backend:
```bash
cd backend
python main.py
```

4. Open `frontend/index.html` in your browser

## Usage

1. Choose a conversation topic and your English level
2. Click "Start Conversation"
3. Click the microphone button to record your speech
4. The AI tutor will respond with text and audio
5. Practice conversation naturally - the tutor will gently correct mistakes

## API Endpoints

- `POST /api/transcribe` - Transcribe audio to text
- `POST /api/conversation/start` - Start a new conversation session
- `POST /api/conversation/message` - Send a message in conversation
- `POST /api/speak` - Convert text to speech
- `GET /api/audio/{filename}` - Serve audio files
- `POST /api/analyze-pronunciation` - Analyze pronunciation accuracy

## Next Steps

- Add phoneme-level pronunciation analysis (Azure Pronunciation Assessment)
- Implement accent detection and specific sound coaching
- Add progress tracking and weak area identification
- Create personalized exercise generation
- Support multiple accent models (American, British, etc.)

## Cost Estimate

- Whisper: $0.006 per minute
- GPT-4: ~$0.03 per conversation turn
- TTS: $15 per 1M characters (~$0.01 per sentence)

Typical 30-minute session: ~$1-2 in API costs
