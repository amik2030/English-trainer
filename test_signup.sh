#!/bin/bash
set -e

SUPABASE_URL="https://qiapbljkhbpybhqcshjo.supabase.co"
SUPABASE_KEY="sb_pub…BayH"
BACKEND_URL="https://english-trainer-go4p.onrender.com"

TIMESTAMP=$(date +%s)
TEST_EMAIL="testuser${TIMESTAMP}@example.com"
TEST_PASSWORD="***"

echo "=========================================="
echo "Testing User Creation Flow"
echo "=========================================="
echo "Email: $TEST_EMAIL"
echo ""

# Step 1: Signup
echo "Step 1: Signup via Supabase Auth"
SIGNUP_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")

USER_ID=$(echo "$SIGNUP_RESPONSE" | jq -r '.user.id')
ACCESS_TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.access_token')

if [ "$USER_ID" != "null" ] && [ -n "$ACCESS_TOKEN" ]; then
    echo "✓ Signup successful"
    echo "User ID: $USER_ID"
    echo ""
    
    # Step 2: Check if profile was auto-created
    echo "Step 2: Check Profile in Supabase"
    PROFILE_RESPONSE=$(curl -s "$SUPABASE_URL/rest/v1/profiles?id=eq.$USER_ID&select=*" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    
    PROFILE_COUNT=$(echo "$PROFILE_RESPONSE" | jq 'length')
    if [ "$PROFILE_COUNT" -gt 0 ]; then
        echo "✓ Profile auto-created"
        echo "$PROFILE_RESPONSE" | jq '.[0]'
    else
        echo "✗ Profile not found"
    fi
    echo ""
    
    # Step 3: Test backend APIs
    echo "Step 3: Test Backend API Endpoints"
    
    echo "3a. Testing /api/progress/stats"
    STATS_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/stats" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    echo "$STATS_RESPONSE" | jq .
    echo ""
    
    echo "3b. Testing /api/conversation/start"
    CONV_RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/conversation/start" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H "Content-Type: application/json" \
      -d '{"topic":"travel","level":"intermediate"}')
    echo "$CONV_RESPONSE" | jq .
    echo ""
    
    echo "3c. Testing /api/progress/history"
    HISTORY_RESPONSE=$(curl -s "$BACKEND_URL/api/progress/history" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    echo "$HISTORY_RESPONSE" | jq .
    echo ""
    
    echo "3d. Testing /api/profile"
    PROFILE_API_RESPONSE=$(curl -s "$BACKEND_URL/api/profile" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    echo "$PROFILE_API_RESPONSE" | jq .
    echo ""
    
    # Step 4: Test login
    echo "Step 4: Test Login"
    LOGIN_RESPONSE=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
      -H "apikey: $SUPABASE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}")
    
    LOGIN_USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id')
    if [ "$LOGIN_USER_ID" != "null" ]; then
        echo "✓ Login successful"
        echo "User ID: $LOGIN_USER_ID"
    else
        echo "✗ Login failed"
        echo "$LOGIN_RESPONSE" | jq .
    fi
    echo ""
else
    echo "✗ Signup failed"
    echo "$SIGNUP_RESPONSE" | jq .
fi

echo "=========================================="
echo "Test Complete"
echo "=========================================="
