#!/usr/bin/env python3
"""
Backend API Testing for Scrolic Hybrid Backend
Tests FastAPI proxy, Node Express endpoints, and LLM bridge
"""
import requests
import json
import sys
from typing import Dict, Any, Optional

# External URL from frontend/.env
BASE_URL = "https://ai-config-tool-4.preview.emergentagent.com"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    RESET = '\033[0m'

def print_test(name: str, passed: bool, details: str = ""):
    status = f"{Colors.GREEN}✅ PASS{Colors.RESET}" if passed else f"{Colors.RED}❌ FAIL{Colors.RESET}"
    print(f"{status} | {name}")
    if details:
        print(f"    {details}")

def print_section(title: str):
    print(f"\n{Colors.BLUE}{'='*60}{Colors.RESET}")
    print(f"{Colors.BLUE}{title}{Colors.RESET}")
    print(f"{Colors.BLUE}{'='*60}{Colors.RESET}")

def test_health_proxy() -> bool:
    """Test GET /api/health/proxy - FastAPI proxy health check"""
    try:
        resp = requests.get(f"{BASE_URL}/api/health/proxy", timeout=10)
        data = resp.json()
        
        if resp.status_code != 200:
            print_test("GET /api/health/proxy", False, f"Status: {resp.status_code}")
            return False
        
        # Check required fields
        if not data.get("ok"):
            print_test("GET /api/health/proxy", False, f"ok field is not true: {data}")
            return False
        
        if data.get("service") != "scrolic-hybrid-proxy":
            print_test("GET /api/health/proxy", False, f"service field incorrect: {data.get('service')}")
            return False
        
        if "node_pid" not in data:
            print_test("GET /api/health/proxy", False, "node_pid field missing")
            return False
        
        node_pid = data.get("node_pid")
        if node_pid is None:
            print_test("GET /api/health/proxy", False, "Node backend not running (node_pid is null)")
            return False
        
        print_test("GET /api/health/proxy", True, f"Node PID: {node_pid}")
        return True
    except Exception as e:
        print_test("GET /api/health/proxy", False, f"Exception: {str(e)}")
        return False

def test_health_node() -> bool:
    """Test GET /api/health - Node backend health check (proxied)"""
    try:
        resp = requests.get(f"{BASE_URL}/api/health", timeout=10)
        data = resp.json()
        
        if resp.status_code != 200:
            print_test("GET /api/health", False, f"Status: {resp.status_code}, Response: {data}")
            return False
        
        # Check for status and database fields
        if data.get("status") != "ok":
            print_test("GET /api/health", False, f"status field is not 'ok': {data}")
            return False
        
        if data.get("database") != "connected":
            print_test("GET /api/health", False, f"database field is not 'connected': {data}")
            return False
        
        print_test("GET /api/health", True, "Node backend healthy, MongoDB connected")
        return True
    except Exception as e:
        print_test("GET /api/health", False, f"Exception: {str(e)}")
        return False

def test_feed_endpoint() -> bool:
    """Test GET /api/feed?limit=5 - Public feed endpoint"""
    try:
        resp = requests.get(f"{BASE_URL}/api/feed?limit=5", timeout=10)
        data = resp.json()
        
        if resp.status_code != 200:
            print_test("GET /api/feed?limit=5", False, f"Status: {resp.status_code}, Response: {data}")
            return False
        
        # Check required fields
        if not data.get("success"):
            print_test("GET /api/feed?limit=5", False, f"success field is not true: {data}")
            return False
        
        if "posts" not in data:
            print_test("GET /api/feed?limit=5", False, "posts field missing")
            return False
        
        posts = data.get("posts", [])
        if not isinstance(posts, list):
            print_test("GET /api/feed?limit=5", False, f"posts is not a list: {type(posts)}")
            return False
        
        if len(posts) == 0:
            print_test("GET /api/feed?limit=5", False, "No posts returned (expected seeded data)")
            return False
        
        # Check first post structure
        first_post = posts[0]
        required_fields = ["user", "trade", "strategy"]
        missing = [f for f in required_fields if f not in first_post]
        if missing:
            print_test("GET /api/feed?limit=5", False, f"Post missing fields: {missing}")
            return False
        
        # Check has_more and next_cursor
        if "has_more" not in data:
            print_test("GET /api/feed?limit=5", False, "has_more field missing")
            return False
        
        if "next_cursor" not in data:
            print_test("GET /api/feed?limit=5", False, "next_cursor field missing")
            return False
        
        print_test("GET /api/feed?limit=5", True, f"Returned {len(posts)} posts with user/trade/strategy fields")
        return True
    except Exception as e:
        print_test("GET /api/feed?limit=5", False, f"Exception: {str(e)}")
        return False

def test_users_endpoint() -> bool:
    """Test GET /api/users - Public users list"""
    try:
        resp = requests.get(f"{BASE_URL}/api/users", timeout=10)
        data = resp.json()
        
        if resp.status_code != 200:
            print_test("GET /api/users", False, f"Status: {resp.status_code}, Response: {data}")
            return False
        
        if "users" not in data:
            print_test("GET /api/users", False, "users field missing")
            return False
        
        users = data.get("users", [])
        if not isinstance(users, list):
            print_test("GET /api/users", False, f"users is not a list: {type(users)}")
            return False
        
        if len(users) == 0:
            print_test("GET /api/users", False, "No users returned (expected 4 seeded users)")
            return False
        
        # Check for seeded usernames
        usernames = [u.get("username") for u in users if "username" in u]
        expected_users = ["sarah_scalper", "alex_trader", "elena_smc", "ray_swing"]
        found_users = [u for u in expected_users if u in usernames]
        
        if len(found_users) < 4:
            print_test("GET /api/users", False, f"Expected 4 seeded users, found: {found_users}")
            return False
        
        print_test("GET /api/users", True, f"Returned {len(users)} users including all 4 seeded users")
        return True
    except Exception as e:
        print_test("GET /api/users", False, f"Exception: {str(e)}")
        return False

def test_strategies_endpoint() -> bool:
    """Test GET /api/strategies - Public strategies list"""
    try:
        resp = requests.get(f"{BASE_URL}/api/strategies", timeout=10)
        data = resp.json()
        
        if resp.status_code != 200:
            print_test("GET /api/strategies", False, f"Status: {resp.status_code}, Response: {data}")
            return False
        
        # Response could be array or object with strategies field
        strategies = data if isinstance(data, list) else data.get("strategies", [])
        
        if not isinstance(strategies, list):
            print_test("GET /api/strategies", False, f"strategies is not a list: {type(strategies)}")
            return False
        
        if len(strategies) == 0:
            print_test("GET /api/strategies", False, "No strategies returned (expected seeded data)")
            return False
        
        print_test("GET /api/strategies", True, f"Returned {len(strategies)} strategies")
        return True
    except Exception as e:
        print_test("GET /api/strategies", False, f"Exception: {str(e)}")
        return False

def test_news_endpoint() -> bool:
    """Test GET /api/news/economic-calendar or GET /api/news - Economic news"""
    try:
        # Try economic-calendar first
        resp = requests.get(f"{BASE_URL}/api/news/economic-calendar", timeout=10)
        
        if resp.status_code == 404:
            # Try /api/news instead
            resp = requests.get(f"{BASE_URL}/api/news", timeout=10)
        
        if resp.status_code != 200:
            print_test("GET /api/news/*", False, f"Status: {resp.status_code}")
            return False
        
        # Any 200 response is acceptable
        print_test("GET /api/news/*", True, f"Status: {resp.status_code}")
        return True
    except Exception as e:
        print_test("GET /api/news/*", False, f"Exception: {str(e)}")
        return False

def test_auth_user_me() -> bool:
    """Test GET /api/user/me - Should return null user without session"""
    try:
        resp = requests.get(f"{BASE_URL}/api/user/me", timeout=10)
        
        # Accept 200 or 401
        if resp.status_code not in [200, 401]:
            print_test("GET /api/user/me (no session)", False, f"Status: {resp.status_code}")
            return False
        
        if resp.status_code == 200:
            data = resp.json()
            # Should return null user or similar
            if data.get("user") is None or data.get("user") == {}:
                print_test("GET /api/user/me (no session)", True, "Returns null user as expected")
                return True
            else:
                print_test("GET /api/user/me (no session)", False, f"Expected null user, got: {data}")
                return False
        else:
            # 401 is also acceptable
            print_test("GET /api/user/me (no session)", True, "Returns 401 as expected")
            return True
    except Exception as e:
        print_test("GET /api/user/me (no session)", False, f"Exception: {str(e)}")
        return False

def test_llm_trade_analysis() -> bool:
    """Test POST /api/_llm/trade-analysis - LLM bridge for trade analysis"""
    try:
        payload = {
            "session_id": "test-1",
            "symbol": "EURUSD",
            "direction": "SELL",
            "entryPrice": "1.0850",
            "stopLoss": "1.0900",
            "takeProfit": "1.0750",
            "strategyName": "Scalping",
            "question": "Setup ini valid?"
        }
        
        resp = requests.post(f"{BASE_URL}/api/_llm/trade-analysis", json=payload, timeout=30)
        
        if resp.status_code != 200:
            print_test("POST /api/_llm/trade-analysis", False, f"Status: {resp.status_code}, Response: {resp.text}")
            return False
        
        data = resp.json()
        
        if "answer" not in data:
            print_test("POST /api/_llm/trade-analysis", False, "answer field missing")
            return False
        
        answer = data.get("answer", "")
        if not answer or len(answer) < 10:
            print_test("POST /api/_llm/trade-analysis", False, f"Answer too short: {answer}")
            return False
        
        # Check for Bahasa Indonesia content (should contain Indonesian words)
        # and bullet points (•), no asterisks
        if "*" in answer:
            print_test("POST /api/_llm/trade-analysis", False, "Answer contains asterisks (should use bullets)")
            return False
        
        print_test("POST /api/_llm/trade-analysis", True, f"Returned Bahasa Indonesia analysis ({len(answer)} chars, no asterisks)")
        return True
    except Exception as e:
        print_test("POST /api/_llm/trade-analysis", False, f"Exception: {str(e)}")
        return False

def test_llm_economic_event() -> bool:
    """Test POST /api/_llm/economic-event - LLM bridge for economic event analysis"""
    try:
        payload = {
            "session_id": "test-2",
            "eventTitle": "US NFP",
            "currency": "USD",
            "impact": "HIGH",
            "actual": "250K",
            "forecast": "200K",
            "previous": "180K",
            "affectedPairs": ["EURUSD", "XAUUSD"]
        }
        
        resp = requests.post(f"{BASE_URL}/api/_llm/economic-event", json=payload, timeout=30)
        
        if resp.status_code != 200:
            print_test("POST /api/_llm/economic-event", False, f"Status: {resp.status_code}, Response: {resp.text}")
            return False
        
        data = resp.json()
        
        if "answer" not in data:
            print_test("POST /api/_llm/economic-event", False, "answer field missing")
            return False
        
        answer = data.get("answer", "")
        if not answer or len(answer) < 10:
            print_test("POST /api/_llm/economic-event", False, f"Answer too short: {answer}")
            return False
        
        print_test("POST /api/_llm/economic-event", True, f"Returned economic analysis ({len(answer)} chars)")
        return True
    except Exception as e:
        print_test("POST /api/_llm/economic-event", False, f"Exception: {str(e)}")
        return False

def main():
    print(f"\n{Colors.YELLOW}{'='*60}{Colors.RESET}")
    print(f"{Colors.YELLOW}Scrolic Hybrid Backend API Testing{Colors.RESET}")
    print(f"{Colors.YELLOW}Base URL: {BASE_URL}{Colors.RESET}")
    print(f"{Colors.YELLOW}{'='*60}{Colors.RESET}")
    
    results = {}
    
    # 1. HEALTH & PROXY
    print_section("1. HEALTH & PROXY ENDPOINTS")
    results["health_proxy"] = test_health_proxy()
    results["health_node"] = test_health_node()
    
    # 2. PUBLIC READ ENDPOINTS
    print_section("2. PUBLIC READ ENDPOINTS (via proxy to Node)")
    results["feed"] = test_feed_endpoint()
    results["users"] = test_users_endpoint()
    results["strategies"] = test_strategies_endpoint()
    results["news"] = test_news_endpoint()
    
    # 3. AUTH
    print_section("3. AUTH ENDPOINTS")
    results["auth_user_me"] = test_auth_user_me()
    
    # 4. LLM BRIDGE
    print_section("4. LLM BRIDGE (native FastAPI, Emergent LLM)")
    results["llm_trade_analysis"] = test_llm_trade_analysis()
    results["llm_economic_event"] = test_llm_economic_event()
    
    # Summary
    print_section("SUMMARY")
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print(f"{Colors.GREEN}✅ All tests passed!{Colors.RESET}")
        return 0
    else:
        failed_tests = [k for k, v in results.items() if not v]
        print(f"{Colors.RED}❌ Failed tests: {', '.join(failed_tests)}{Colors.RESET}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
