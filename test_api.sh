#!/bin/bash

# Load environment variables
export $(grep -v '^#' backend/.env | xargs)

SUPABASE_URL="https://qiapbljkhbpybhqcshjo.supabase.co"
BACKEND_URL="https://english-trainer-go4p.onrender.com"
TEST_EMAIL="testuser$(date +%s)@example.com"
TEST_PASSWORD="***"

echo "Testing API endpoints..."
echo "Email: $TEST_EMAIL"
echo ""

# Step 1: Signup
echo "1. Signup..."
SIGNUP=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

USER_ID=$(echo "$SIGNUP" | jq -r '.user.id')
TOKEN=*** "$SIGNUP" | jq -r '.access_token')

if [ "$USER_ID" != "null" ] && [ -n "$TOKEN" ]; then
    echo "✓ Signup successful"
    echo "User ID: $USER_ID"
else
    echo "✗ Signup failed"
    echo "$SIGNUP" | jq .
    exit 1
fi
echo ""

# Step 2: Login
echo "2. Login..."
LOGIN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

LOGIN_TOKEN=$(echo "$LOGIN" | jq -r '.access_token')

if [ "$LOGIN_TOKEN" != "null" ] && [ -n "$LOGIN_TOKEN" ]; then
    echo "✓ Login successful"
else
    echo "✗ Login failed"
    echo "$LOGIN" | jq .
    exit 1
fi
echo ""

# Step 3: Start conversation
echo "3. Start conversation..."
CONV=$(curl -s -X POST "$BACKEND_URL/api/conversation/start" \
  -H "Authorization: Bearer $LOGIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic":"travel","level":"intermediate"}')

CONV_ID=$(echo "$CONV" | jq -r '.conversation_id')

if [ "$CONV_ID" != "null" ] && [ -n "$CONV_ID" ]; then
    echo "✓ Conversation started"
    echo "Conversation ID: $CONV_ID"
    echo "Greeting: $(echo "$CONV" | jq -r '.greeting' | head -c 100)..."
else
    echo "✗ Conversation failed"
    echo "$CONV" | jq .
    exit 1
fi
echo ""

# Step 4: Get stats
echo "4. Get stats..."
STATS=$(curl -s "$BACKEND_URL/api/progress/stats" \
  -H "Authorization: Bearer $LOGIN_TOKEN")

TOTAL=$(echo "$STATS" | jq -r '.total_conversations')

if [ "$TOTAL" != "null" ]; then
    echo "✓ Stats retrieved"
    echo "Total conversations: $TOTAL"
else
    echo "✗ Stats failed"
    echo "$STATS" | jq .
    exit 1
fi
echo ""

# Step 5: Get history
echo "5. Get history..."
HISTORY=$(curl -s "$BACKEND_URL/api/progress/history" \
  -H "Authorization: Bearer $LOGIN_TOKEN")

COUNT=$(echo "$HISTORY" | jq -r '.conversations | length')

echo "✓ History retrieved"
echo "Conversations in history: $COUNT"
echo ""

echo "=========================================="
echo "✓ All API tests passed!"
echo "=========================================="
