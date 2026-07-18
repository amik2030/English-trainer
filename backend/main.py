"""
SpeakEasy AI - Enhanced Backend with Supabase
AI-powered conversation practice with progress tracking and authentication
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openai import OpenAI
from supabase import create_client, Client
import os
import tempfile
import shutil
import json
import jwt
from datetime import datetime
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# ============================================
# Configuration
# ============================================

# OpenAI
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY environment variable is required")
client = OpenAI(api_key=OPENAI_API_KEY)

# Supabase
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
if not all([SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_KEY]):
    raise ValueError("Supabase environment variables are required")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
supabase_admin: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ============================================
# FastAPI App
# ============================================

app = FastAPI(title="SpeakEasy AI - English Voice & Accent Trainer")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Conversation history per session (in-memory for MVP)
sessions = {}

# Mount static files for frontend
frontend_path = Path(__file__).parent.parent / "frontend"
if frontend_path.exists():
    app.mount("/static", StaticFiles(directory=frontend_path), name="static")


# ============================================
# Authentication
# ============================================

async def get_current_user(authorization: str = Header(None)) -> dict:
    """
    Extract and verify user from JWT token in Authorization header
    Returns user dict with id, email
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization header required")
    
    # Extract token from "Bearer <token>"
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    
    token = parts[1]
    
    try:
        # Verify JWT token with Supabase
        user = supabase_admin.auth.get_user(token)
        return {
            "id": user.user.id,
            "email": user.user.email
        }
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


# ============================================
# Request Models
# ============================================

class MessageRequest(BaseModel):
    session_id: str
    message: str


class ConversationStart(BaseModel):
    session_id: str
    topic: str = "general conversation"
    level: str = "intermediate"


# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    frontend_path = Path(__file__).parent.parent / "frontend" / "index.html"
    if frontend_path.exists():
        return FileResponse(frontend_path)
    return {"message": "SpeakEasy AI API", "status": "running"}


@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user)
):
    """
    Transcribe audio using OpenAI Whisper
    Returns transcription and basic pronunciation analysis
    """
    # Save uploaded file temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
        shutil.copyfileobj(file.file, temp_file)
        temp_path = temp_file.name
    
    try:
        # Transcribe with Whisper
        with open(temp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="verbose_json"
            )
        
        # Basic analysis
        text = transcription.text
        duration = getattr(transcription, 'duration', 0) or 0
        words = text.split()
        word_count = len(words)
        
        # Simple fluency metric (words per minute)
        if duration > 0:
            wpm = (word_count / duration) * 60
        else:
            wpm = 0
        
        confidence = getattr(transcription, 'confidence', 0) or 0
        
        return {
            "text": text,
            "duration": duration,
            "word_count": word_count,
            "words_per_minute": round(wpm, 1),
            "confidence": confidence
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@app.post("/api/conversation/start")
async def start_conversation(
    request: ConversationStart,
    user: dict = Depends(get_current_user)
):
    """
    Start a new conversation session with AI tutor
    """
    session_id = request.session_id
    user_id = user["id"]
    
    # Initialize session with system prompt
    system_prompt = f"""You are a friendly and patient English conversation tutor. 
    Your student is at {request.level} level and wants to practice {request.topic}.
    
    Your role:
    - Engage in natural conversation
    - Gently correct grammar and vocabulary mistakes
    - Suggest more natural or idiomatic expressions
    - Ask follow-up questions to keep conversation flowing
    - Be encouraging and supportive
    
    Keep responses concise (2-4 sentences) to maintain conversation flow.
    If the student makes a mistake, provide the correction in parentheses after your response.
    """
    
    sessions[session_id] = {
        "messages": [{"role": "system", "content": system_prompt}],
        "topic": request.topic,
        "level": request.level,
        "user_id": user_id,
        "start_time": datetime.now().isoformat()
    }
    
    # Generate opening message
    opening_messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Let's start practicing {request.topic}"}
    ]
    
    response = client.chat.completions.create(
        model="gpt-4",
        messages=opening_messages,
        max_tokens=150
    )
    
    tutor_message = response.choices[0].message.content
    sessions[session_id]["messages"].append({"role": "assistant", "content": tutor_message})
    
    # Create conversation record in Supabase
    try:
        supabase.table("conversations").insert({
            "user_id": user_id,
            "session_id": session_id,
            "topic": request.topic,
            "level": request.level,
            "start_time": datetime.now().isoformat()
        }).execute()
    except Exception as e:
        print(f"Failed to create conversation record: {e}")
    
    return {
        "session_id": session_id,
        "tutor_message": tutor_message
    }


@app.post("/api/conversation/message")
async def send_message(
    request: MessageRequest,
    user: dict = Depends(get_current_user)
):
    """
    Send a message in the conversation and get tutor response
    """
    session_id = request.session_id
    user_id = user["id"]
    
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Add user message to history
    user_message = {
        "role": "user",
        "content": request.message,
        "timestamp": datetime.now().isoformat()
    }
    sessions[session_id]["messages"].append(user_message)
    
    # Save user message to Supabase
    try:
        # Get conversation_id
        conv_result = supabase.table("conversations").select("id").eq("session_id", session_id).execute()
        if conv_result.data:
            conversation_id = conv_result.data[0]["id"]
            
            supabase.table("messages").insert({
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "user",
                "content": request.message
            }).execute()
    except Exception as e:
        print(f"Failed to save user message: {e}")
    
    # Get tutor response
    response = client.chat.completions.create(
        model="gpt-4",
        messages=sessions[session_id]["messages"],
        max_tokens=200
    )
    
    tutor_message = response.choices[0].message.content
    sessions[session_id]["messages"].append({
        "role": "assistant",
        "content": tutor_message,
        "timestamp": datetime.now().isoformat()
    })
    
    # Save assistant message to Supabase
    try:
        if conv_result.data:
            supabase.table("messages").insert({
                "conversation_id": conversation_id,
                "user_id": user_id,
                "role": "assistant",
                "content": tutor_message
            }).execute()
    except Exception as e:
        print(f"Failed to save assistant message: {e}")
    
    return {
        "tutor_message": tutor_message
    }


@app.post("/api/speak")
async def text_to_speech(request: dict):
    """
    Convert text to speech using OpenAI TTS
    Returns audio file path
    """
    text = request.get("text", "")
    voice = request.get("voice", "alloy")
    
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    
    try:
        # Generate speech
        response = client.audio.speech.create(
            model="tts-1",
            voice=voice,
            input=text
        )
        
        # Save to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp3") as temp_file:
            response.stream_to_file(temp_file.name)
            temp_path = temp_file.name
        
        return {"audio_path": temp_path}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")


@app.api_route("/api/audio/{filename}", methods=["GET", "HEAD"])
async def get_audio(filename: str):
    """
    Serve audio files
    """
    temp_dir = tempfile.gettempdir()
    file_path = os.path.join(temp_dir, filename)
    
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")
    
    return FileResponse(
        file_path,
        media_type="audio/mpeg",
        filename=filename
    )


@app.post("/api/analyze-pronunciation")
async def analyze_pronunciation(
    request: dict,
    user: dict = Depends(get_current_user)
):
    """
    Analyze pronunciation and provide feedback
    """
    original_text = request.get("original_text", "")
    transcribed_text = request.get("transcribed_text", "")
    
    if not original_text or not transcribed_text:
        raise HTTPException(status_code=400, detail="Both texts are required")
    
    # Simple word-by-word comparison
    original_words = original_text.lower().split()
    transcribed_words = transcribed_text.lower().split()
    
    # Calculate accuracy
    correct_words = 0
    mismatches = []
    
    for i, (orig, trans) in enumerate(zip(original_words, transcribed_words)):
        if orig == trans:
            correct_words += 1
        else:
            mismatches.append({
                "word_number": i + 1,
                "expected": orig,
                "heard": trans
            })
    
    accuracy = (correct_words / len(original_words) * 100) if original_words else 0
    
    # Generate feedback
    feedback = []
    if accuracy >= 90:
        feedback.append("Excellent pronunciation! Very clear.")
    elif accuracy >= 70:
        feedback.append("Good job! A few words need practice.")
    else:
        feedback.append("Keep practicing! Focus on the words below.")
    
    if mismatches:
        feedback.append("Words to practice:")
        for m in mismatches[:5]:
            feedback.append(f"  - '{m['expected']}' (heard as '{m['heard']}')")
    
    return {
        "accuracy": round(accuracy, 1),
        "correct_words": correct_words,
        "total_words": len(original_words),
        "mismatches": mismatches,
        "feedback": feedback
    }


@app.post("/api/progress/save")
async def save_progress(
    request: dict,
    user: dict = Depends(get_current_user)
):
    """Save conversation progress to Supabase"""
    session_id = request.get("session_id")
    user_id = user["id"]
    topic = request.get("topic")
    level = request.get("level")
    total_words = request.get("total_words", 0)
    avg_accuracy = request.get("avg_accuracy", 0)
    messages = request.get("messages", [])
    
    try:
        # Update conversation record
        supabase.table("conversations").update({
            "end_time": datetime.now().isoformat(),
            "total_words": total_words,
            "avg_accuracy": avg_accuracy,
            "messages_count": len(messages)
        }).eq("session_id", session_id).eq("user_id", user_id).execute()
        
        # Update user profile stats
        supabase.table("profiles").update({
            "total_sessions": supabase.rpc("increment", {"row_id": user_id, "column": "total_sessions"}),
            "total_words": supabase.rpc("increment", {"row_id": user_id, "column": "total_words", "amount": total_words})
        }).eq("id", user_id).execute()
        
        return {"status": "saved", "session_id": session_id}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save progress: {str(e)}")


@app.get("/api/progress/stats")
async def get_progress_stats(user: dict = Depends(get_current_user)):
    """Get overall progress statistics for current user"""
    user_id = user["id"]
    
    try:
        # Get user's conversation stats
        result = supabase.table("conversations").select(
            "total_words", "avg_accuracy", "messages_count"
        ).eq("user_id", user_id).execute()
        
        conversations = result.data or []
        
        total_conversations = len(conversations)
        total_words = sum(c.get("total_words", 0) for c in conversations)
        avg_accuracy = sum(c.get("avg_accuracy", 0) for c in conversations) / total_conversations if total_conversations > 0 else 0
        total_messages = sum(c.get("messages_count", 0) for c in conversations)
        
        # Get recent conversations
        recent_result = supabase.table("conversations").select(
            "session_id", "topic", "level", "start_time", "total_words", "avg_accuracy"
        ).eq("user_id", user_id).order("start_time", desc=True).limit(10).execute()
        
        return {
            "total_conversations": total_conversations,
            "total_words": total_words,
            "avg_accuracy": round(avg_accuracy, 1),
            "total_messages": total_messages,
            "recent_conversations": recent_result.data or []
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@app.get("/api/progress/history")
async def get_conversation_history(user: dict = Depends(get_current_user)):
    """Get all conversation history for current user"""
    user_id = user["id"]
    
    try:
        result = supabase.table("conversations").select(
            "session_id", "topic", "level", "start_time", "total_words", "avg_accuracy", "messages_count"
        ).eq("user_id", user_id).order("start_time", desc=True).execute()
        
        return {
            "conversations": result.data or []
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")


@app.get("/api/profile")
async def get_profile(user: dict = Depends(get_current_user)):
    """Get current user's profile"""
    user_id = user["id"]
    
    try:
        result = supabase.table("profiles").select("*").eq("id", user_id).execute()
        
        if result.data:
            return result.data[0]
        else:
            raise HTTPException(status_code=404, detail="Profile not found")
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get profile: {str(e)}")


# ============================================
# Static file routes
# ============================================

@app.get("/about.html")
async def serve_about():
    about_path = Path(__file__).parent.parent / "frontend" / "about.html"
    if about_path.exists():
        return FileResponse(about_path)
    raise HTTPException(status_code=404, detail="About page not found")


@app.get("/trainer.html")
async def serve_trainer():
    trainer_path = Path(__file__).parent.parent / "frontend" / "trainer.html"
    if trainer_path.exists():
        return FileResponse(trainer_path)
    raise HTTPException(status_code=404, detail="Trainer page not found")


@app.get("/practice.html")
async def serve_practice():
    practice_path = Path(__file__).parent.parent / "frontend" / "practice.html"
    if practice_path.exists():
        return FileResponse(practice_path)
    raise HTTPException(status_code=404, detail="Practice page not found")


@app.get("/login.html")
async def serve_login():
    login_path = Path(__file__).parent.parent / "frontend" / "login.html"
    if login_path.exists():
        return FileResponse(login_path)
    raise HTTPException(status_code=404, detail="Login page not found")


@app.get("/styles.css")
async def serve_styles():
    css_path = Path(__file__).parent.parent / "frontend" / "styles.css"
    if css_path.exists():
        return FileResponse(css_path)
    raise HTTPException(status_code=404, detail="CSS not found")


@app.get("/trainer.css")
async def serve_trainer_css():
    css_path = Path(__file__).parent.parent / "frontend" / "trainer.css"
    if css_path.exists():
        return FileResponse(css_path)
    raise HTTPException(status_code=404, detail="Trainer CSS not found")


@app.get("/main.js")
async def serve_main_js():
    js_path = Path(__file__).parent.parent / "frontend" / "main.js"
    if js_path.exists():
        return FileResponse(js_path)
    raise HTTPException(status_code=404, detail="JavaScript not found")


@app.get("/app")
async def serve_frontend():
    frontend_path = Path(__file__).parent.parent / "frontend" / "index.html"
    if frontend_path.exists():
        return FileResponse(frontend_path)
    return {"error": "Frontend not found"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
