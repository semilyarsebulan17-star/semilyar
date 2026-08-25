"""
Comprehensive Verification Script for Scrolic Python Single-Runtime Backend
"""
import sys, os
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure backend package can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.server import app

client = TestClient(app)

def test_root():
    res = client.get("/")
    assert res.status_code == 200
    assert res.json().get("ok") == True
    print("✅ Root / endpoint working")

def test_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json().get("ok") == True
    print("✅ Health /api/health working")

def test_health_proxy():
    res = client.get("/api/health/proxy")
    assert res.status_code == 200
    data = res.json()
    assert data.get("node_alive") == True
    assert "single-runtime" in data.get("service")
    print("✅ Health Proxy /api/health/proxy working (node_alive: True)")

def test_google_auth():
    # Test Google GSI credential login
    payload = {
        "email": "test.google.trader@scrolic.com",
        "name": "Google Test Trader",
        "username": "google_test_trader",
        "avatar": "https://api.dicebear.com/7.x/bottts/svg?seed=google_test",
        "referralCode": "SCROLIC50"
    }
    res = client.post("/api/auth/google", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data.get("success") == True
    user = data.get("user")
    assert user.get("username") == "google_test_trader"
    assert user.get("email") == "test.google.trader@scrolic.com"
    print("✅ Google Auth /api/auth/google working (User registered & referral processed)")

def test_login_and_me():
    res = client.post("/api/auth/login", json={"username": "alex_trader"})
    assert res.status_code == 200
    user = res.json().get("user")
    assert user.get("username") == "alex_trader"

    res_me = client.get("/api/user/me", headers={"x-session-user-id": "user-alex"})
    assert res_me.status_code == 200
    user_me = res_me.json().get("user")
    assert user_me.get("username") == "alex_trader"
    print("✅ Login /api/auth/login & /api/user/me working")

def test_feed_and_interactions():
    res = client.get("/api/feed")
    assert res.status_code == 200
    posts = res.json().get("posts")
    assert len(posts) > 0
    post_id = posts[0].get("id")

    res_like = client.post(f"/api/posts/{post_id}/like", headers={"x-session-user-id": "user-sarah"})
    assert res_like.status_code == 200
    assert res_like.json().get("success") == True

    res_unlock = client.post(f"/api/posts/{post_id}/unlock", headers={"x-session-user-id": "user-sarah"})
    assert res_unlock.status_code == 200
    assert res_unlock.json().get("success") == True
    print("✅ Feed /api/feed, Likes, and Unlock working")

def test_strategies_and_news():
    res_strat = client.get("/api/strategies")
    assert res_strat.status_code == 200
    assert len(res_strat.json().get("strategies")) >= 4

    res_news = client.get("/api/news/economic-calendar")
    assert res_news.status_code == 200
    assert len(res_news.json().get("events")) > 0
    print("✅ Strategies & Economic Calendar endpoints working")

if __name__ == "__main__":
    test_root()
    test_health()
    test_health_proxy()
    test_google_auth()
    test_login_and_me()
    test_feed_and_interactions()
    test_strategies_and_news()
    print("\n🎉 ALL 7 TEST SUITES PASSED SUCCESSFULLY!")
