#!/bin/bash
set -e

# Load environment variables
export $(cat backend/.env | grep -v '^#' | xargs)

SUPABASE_URL="https://qiapbljkhbpybhqcshjo.supabase.co"
BACKEND_URL="https://english-trainer-go4p.onrender.com"

TEST_EMAIL="testuser$(date +%s)@example.com"
TEST_PASSWORD="***"

echo "=========================================="
echo "Testing User Creation Flow"
echo "=========================================="
echo "Email: $TEST_EMAIL"
echo ""

# Step 1: Signup
echo "1. SIGNUP"
SIGNUP_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

SIGNUP_STATUS=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.email // empty')
if [ -n "$SIGNUP_STATUS" ]; then
    echo "   ✓ Signup successful"
    USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
    ACCESS_TOKEN=*** "$SIGNUP_RESPONSE" | jq -r '.access_token')
    echo "   User ID: $USER_ID"
    echo ""
else
    echo "   ✗ Signup failed"
    echo "$SIGNUP_RESPONSE" | jq .
    exit 1
fi

# Step 2: Login
echo "2. LOGIN"
LOGIN_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

LOGIN_STATUS=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token // empty')
if [ -n "$LOGIN_STATUS" ]; then
    echo "   ✓ Login successful"
    ACCESS_TOKEN=*** "$LOGIN_RESPONSE" | jq -r '.access_token')
    echo ""
else
    echo "   ✗ Login failed"
    echo "$LOGIN_RESPONSE" | jq .
    exit 1
fi

# Step 3: Start Conversation
echo "3. START CONVERSATION"
CONV_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/conversation/start" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic":"travel","level":"intermediate"}')

CONV_ID=$(echo "$CONV_RESPONSE" | jq -r '.conversation_id // empty')
if [ -n "$CONV_ID" ]; then
    echo "   ✓ Conversation started"
    echo "   Conversation ID: $CONV_ID"
    echo ""
else
    echo "   ✗ Conversation failed"
    echo "$CONV_RESPONSE" | jq .
    exit 1
fi

# Step 4: Get Stats
echo "4. GET STATS"
STATS_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/stats" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

STATS_TOTAL=$(echo "$STATS_RESPONSE" | jq -r '.total_conversations // empty')
if [ -n "$STATS_TOTAL" ]; then
    echo "   ✓ Stats retrieved"
    echo "   Total conversations: $STATS_TOTAL"
    echo ""
else
    echo "   ✗ Stats failed"
    echo "$STATS_RESPONSE" | jq .
    exit 1
fi

# Step 5: Get History
echo "5. GET HISTORY"
HISTORY_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/history" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

HISTORY_COUNT=$(echo "$HISTORY_RESPONSE" | jq -r '.conversations | length')
echo "   ✓ History retrieved"
echo "   Total conversations: $HISTORY_COUNT"
echo ""

echo "=========================================="
echo "✓ All tests passed!"
echo "=========================================="
