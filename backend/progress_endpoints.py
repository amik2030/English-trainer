
@app.post("/api/progress/save")
async def save_progress(request: dict):
    """Save conversation progress to database"""
    session_id = request.get("session_id")
    topic = request.get("topic")
    level = request.get("level")
    total_words = request.get("total_words", 0)
    avg_accuracy = request.get("avg_accuracy", 0)
    messages = request.get("messages", [])
    
    try:
        # Insert or update conversation
        cursor.execute("""
            INSERT OR REPLACE INTO conversations 
            (session_id, topic, level, start_time, end_time, total_words, avg_accuracy, messages_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (session_id, topic, level, datetime.now().isoformat(), datetime.now().isoformat(), 
              total_words, avg_accuracy, len(messages)))
        
        # Save messages
        for msg in messages:
            cursor.execute("""
                INSERT INTO messages (session_id, role, content, timestamp, accuracy)
                VALUES (?, ?, ?, ?, ?)
            """, (session_id, msg.get("role"), msg.get("content"), 
                  msg.get("timestamp", datetime.now().isoformat()), msg.get("accuracy", 0)))
        
        conn.commit()
        return {"status": "saved", "session_id": session_id}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save progress: {str(e)}")


@app.get("/api/progress/stats")
async def get_progress_stats():
    """Get overall progress statistics"""
    try:
        cursor.execute("""
            SELECT 
                COUNT(*) as total_conversations,
                SUM(total_words) as total_words,
                AVG(avg_accuracy) as avg_accuracy,
                SUM(messages_count) as total_messages
            FROM conversations
        """)
        
        stats = cursor.fetchone()
        
        # Get recent conversations
        cursor.execute("""
            SELECT session_id, topic, level, start_time, total_words, avg_accuracy
            FROM conversations
            ORDER BY start_time DESC
            LIMIT 10
        """)
        
        recent = cursor.fetchall()
        
        return {
            "total_conversations": stats[0] or 0,
            "total_words": stats[1] or 0,
            "avg_accuracy": round(stats[2] or 0, 1),
            "total_messages": stats[3] or 0,
            "recent_conversations": [
                {
                    "session_id": r[0],
                    "topic": r[1],
                    "level": r[2],
                    "start_time": r[3],
                    "total_words": r[4],
                    "avg_accuracy": r[5]
                }
                for r in recent
            ]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@app.get("/api/progress/history")
async def get_conversation_history():
    """Get all conversation history"""
    try:
        cursor.execute("""
            SELECT session_id, topic, level, start_time, total_words, avg_accuracy, messages_count
            FROM conversations
            ORDER BY start_time DESC
        """)
        
        history = cursor.fetchall()
        
        return {
            "conversations": [
                {
                    "session_id": h[0],
                    "topic": h[1],
                    "level": h[2],
                    "start_time": h[3],
                    "total_words": h[4],
                    "avg_accuracy": h[5],
                    "messages_count": h[6]
                }
                for h in history
            ]
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get history: {str(e)}")

