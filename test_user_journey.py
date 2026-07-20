#!/usr/bin/env python3
"""
Test the complete user creation and authentication flow
Simulates what happens when a user signs up via the UI
"""

import requests
import json
import time
from datetime import datetime

# Configuration
SUPABASE_URL = "https://qiapbljkhbpybhqcshjo.supabase.co"
SUPABASE_ANON_KEY = "***"
BACKEND_URL = "https://english-trainer-go4p.onrender.com"

# Test credentials
TEST_EMAIL = f"testuser{int(time.time())}@example.com"
TEST_PASSWORD = "***"

print("=" * 70)
print("TESTING USER CREATION FLOW")
print("=" * 70)
print(f"\nTest Email: {TEST_EMAIL}")
print(f"Test Password: {TEST_PASSWORD}")

# Step 1: Sign up (what signup.html does)
print("\n" + "=" * 70)
print("STEP 1: User Signup")
print("=" * 70)

signup_response = requests.post(
    f"{SUPABASE_URL}/auth/v1/signup",
    headers={
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    },
    json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    }
)

print(f"\nSignup Response Status: {signup_response.status_code}")
signup_data = signup_response.json()

if signup_response.status_code == 200:
    print("✓ Signup successful!")
    print(f"User ID: {signup_data.get('user', {}).get('id')}")
    print(f"Email: {signup_data.get('user', {}).get('email')}")
    
    # Extract the access token
    access_token = signup_data.get('access_token')
    
    if access_token:
        print(f"Access Token: {access_token[:50]}...")
        
        # Step 2: Check if profile was created
        print("\n" + "=" * 70)
        print("STEP 2: Verify Profile Creation")
        print("=" * 70)
        
        profile_response = requests.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {access_token}"
            },
            params={
                "id": f"eq.{signup_data['user']['id']}",
                "select": "*"
            }
        )
        
        print(f"\nProfile Query Status: {profile_response.status_code}")
        if profile_response.status_code == 200:
            profiles = profile_response.json()
            if profiles:
                print("✓ Profile exists!")
                print(f"Profile: {json.dumps(profiles[0], indent=2)}")
            else:
                print("✗ Profile not found (should be auto-created)")
        else:
            print(f"✗ Profile query failed: {profile_response.text}")
        
        # Step 3: Test backend API endpoints
        print("\n" + "=" * 70)
        print("STEP 3: Test Backend API Endpoints")
        print("=" * 70)
        
        # Test 3a: Get stats
        print("\n3a. Testing /api/progress/stats")
        stats_response = requests.get(
            f"{BACKEND_URL}/api/progress/stats",
            headers={
                "Authorization": f"Bearer {access_token}"
            }
        )
        print(f"Status: {stats_response.status_code}")
        if stats_response.status_code == 200:
            print("✓ Stats endpoint works!")
            print(f"Stats: {json.dumps(stats_response.json(), indent=2)}")
        else:
            print(f"✗ Stats failed: {stats_response.text}")
        
        # Test 3b: Start conversation
        print("\n3b. Testing /api/conversation/start")
        conv_response = requests.post(
            f"{BACKEND_URL}/api/conversation/start",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json"
            },
            json={
                "topic": "travel",
                "level": "intermediate"
            }
        )
        print(f"Status: {conv_response.status_code}")
        if conv_response.status_code == 200:
            print("✓ Conversation start works!")
            conv_data = conv_response.json()
            print(f"Conversation ID: {conv_data.get('conversation_id')}")
            print(f"AI Greeting: {conv_data.get('greeting', '')[:100]}...")
        else:
            print(f"✗ Conversation start failed: {conv_response.text}")
        
        # Test 3c: Get conversation history
        print("\n3c. Testing /api/progress/history")
        history_response = requests.get(
            f"{BACKEND_URL}/api/progress/history",
            headers={
                "Authorization": f"Bearer {access_token}"
            }
        )
        print(f"Status: {history_response.status_code}")
        if history_response.status_code == 200:
            print("✓ History endpoint works!")
            history_data = history_response.json()
            print(f"Conversations: {len(history_data.get('conversations', []))}")
        else:
            print(f"✗ History failed: {history_response.text}")
        
        # Test 3d: Get profile
        print("\n3d. Testing /api/profile")
        profile_api_response = requests.get(
            f"{BACKEND_URL}/api/profile",
            headers={
                "Authorization": f"Bearer {access_token}"
            }
        )
        print(f"Status: {profile_api_response.status_code}")
        if profile_api_response.status_code == 200:
            print("✓ Profile endpoint works!")
            print(f"Profile: {json.dumps(profile_api_response.json(), indent=2)}")
        else:
            print(f"✗ Profile failed: {profile_api_response.text}")
        
        # Step 4: Test login flow
        print("\n" + "=" * 70)
        print("STEP 4: Test Login Flow")
        print("=" * 70)
        
        login_response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers={
                "apikey": SUPABASE_ANON_KEY,
                "Content-Type": "application/json"
            },
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD
            }
        )
        
        print(f"\nLogin Response Status: {login_response.status_code}")
        if login_response.status_code == 200:
            print("✓ Login successful!")
            login_data = login_response.json()
            print(f"User ID: {login_data.get('user', {}).get('id')}")
            print(f"New Access Token: {login_data.get('access_token', '')[:50]}...")
        else:
            print(f"✗ Login failed: {login_response.text}")
        
    else:
        print("✗ No access token in response")
        print(f"Full response: {json.dumps(signup_data, indent=2)}")
else:
    print("✗ Signup failed!")
    print(f"Error: {signup_response.text}")

print("\n" + "=" * 70)
print("TEST COMPLETE")
print("=" * 70)
