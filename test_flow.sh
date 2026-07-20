#!/bin/bash

# Test the complete user flow
SUPABASE_URL="https://qiapbljkhbpybhqcshjo.supabase.co"
SUPABASE_ANON_KEY="***"
BACKEND_URL="https://english-trainer-go4p.onrender.com"

# Generate unique test email
TEST_EMAIL="testuser$(date +%s)@example.com"
TEST_PASSWORD="***"

echo "Testing complete user flow..."
echo "Email: $TEST_EMAIL"
echo ""

# Step 1: Signup
echo "1. Signing up..."
SIGNUP_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
ACCESS_TOKEN=*** "$SIGNUP_RESPONSE" | jq -r '.access_token')

if [ "$USER_ID" != "null" ] && [ -n "$ACCESS_TOKEN" ]; then
    echo "✓ Signup successful"
    echo "User ID: $USER_ID"
else
    echo "✗ Signup failed"
    echo "$SIGNUP_RESPONSE" | jq .
    exit 1
fi
echo ""

# Step 2: Login
echo "2. Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

LOGIN_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.access_token')

if [ "$LOGIN_TOKEN" != "null" ] && [ -n "$LOGIN_TOKEN" ]; then
    echo "✓ Login successful"
else
    echo "✗ Login failed"
    echo "$LOGIN_RESPONSE" | jq .
    exit 1
fi
echo ""

# Step 3: Start conversation
echo "3. Starting conversation..."
CONV_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/conversation/start" \
  -H "Authorization: Bearer $LOGIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"topic":"travel","level":"intermediate"}')

CONV_ID=$(echo "$CONV_RESPONSE" | jq -r '.conversation_id')

if [ "$CONV_ID" != "null" ] && [ -n "$CONV_ID" ]; then
    echo "✓ Conversation started"
    echo "Conversation ID: $CONV_ID"
    echo "Greeting: $(echo "$CONV_RESPONSE" | jq -r '.greeting' | head -c 100)..."
else
    echo "✗ Conversation failed"
    echo "$CONV_RESPONSE" | jq .
    exit 1
fi
echo ""

# Step 4: Get stats
echo "4. Getting stats..."
STATS_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/stats" \
  -H "Authorization: Bearer $LOGIN_TOKEN")

TOTAL_CONVS=$(echo "$STATS_RESPONSE" | jq -r '.total_conversations')

if [ "$TOTAL_CONVS" != "null" ] && [ -n "$TOTAL_CONVS" ]; then
    echo "✓ Stats retrieved"
    echo "Total conversations: $TOTAL_CONVS"
else
    echo "✗ Stats failed"
    echo "$STATS_RESPONSE" | jq .
    exit 1
fi
echo ""

# Step 5: Get history
echo "5. Getting history..."
HISTORY_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/history" \
  -H "Authorization: Bearer $LOGIN_TOKEN")

HISTORY_COUNT=$(echo "$HISTORY_RESPONSE" | jq -r '.conversations | length')

if [ "$HISTORY_COUNT" != "null" ]; then
    echo "✓ History retrieved"
    echo "Total conversations in history: $HISTORY_COUNT"
else
    echo "✗ History failed"
    echo "$HISTORY_RESPONSE" | jq .
    exit 1
fi
echo ""

echo "=========================================="
echo "✓ All tests passed!"
echo "=========================================="
