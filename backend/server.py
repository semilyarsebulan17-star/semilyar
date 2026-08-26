"""
Scrolic Single-Runtime FastAPI Backend
======================================
1. Native LLM Bridge (/api/_llm/*) using emergentintegrations (Gemini)
2. Native Auth (/api/auth/*) including Google OAuth JWT decoding & referral rewards (+20 Energy)
3. Native Feed (/api/feed, /api/posts/*), User Profiles (/api/user/*), & Strategies (/api/strategies/*)
4. Real-time Notifications SSE & Snapshots (/api/notifications/*)
5. Official cTrader Open API Integration (/api/ctrader/*)
6. Official Mayar.id In-App Payment Gateway (/api/payments/mayar/*) & Webhook Handler
7. Socket.IO ASGI Server (/socket.io/*) with safe import fallback guard
8. Real-time Market Fluctuation Ticker Engine (2.5s interval)
"""
import os, asyncio, json, logging, sys, urllib.request, urllib.parse
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Request, Response, HTTPException, Query, Header, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse, HTMLResponse, RedirectResponse
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT_DIR / ".env")
    load_dotenv(ROOT_DIR.parent / ".env")
    load_dotenv(Path("/app/.env"))
    load_dotenv(Path("/app/backend/.env"))
except ImportError:
    pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("scrolic.backend")

def get_mayar_api_key() -> str:
    return (os.environ.get("MAYAR_API_KEY") or "").strip()

def get_mayar_webhook_secret() -> str:
    return (os.environ.get("MAYAR_WEBHOOK_SECRET") or "").strip()

def get_mayar_base_url() -> str:
    raw = (os.environ.get("MAYAR_BASE_URL") or "https://api.mayar.id").strip().rstrip("/")
    if raw.endswith("/hl/v1"):
        raw = raw[:-6]
    return raw

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")

try:
    from backend.ctrader_config import (
        get_ctrader_client_id,
        get_ctrader_client_secret,
        get_ctrader_env,
        mask_credential,
        get_active_endpoint,
        AUTH_BASE_URL,
        TOKEN_ENDPOINT_URL
    )
except ImportError:
    from ctrader_config import (
        get_ctrader_client_id,
        get_ctrader_client_secret,
        get_ctrader_env,
        mask_credential,
        get_active_endpoint,
        AUTH_BASE_URL,
        TOKEN_ENDPOINT_URL
    )

def get_ctrader_proxy_url() -> str:
    return (os.environ.get("CTRADER_PROXY_URL") or "").strip()

CTRADER_CLIENT_ID = get_ctrader_client_id()
CTRADER_CLIENT_SECRET = get_ctrader_client_secret()
CTRADER_ENV = get_ctrader_env()
CTRADER_PROXY_URL = get_ctrader_proxy_url()


# ---------------- Safe Socket.IO Import Fallback Guard ----------------
try:
    import socketio
    sio = socketio.AsyncServer(
        async_mode="asgi",
        cors_allowed_origins="*",
        cors_credentials=False,
        always_connect=True,
        allow_upgrades=True
    )

    @sio.event
    async def connect(sid, environ, auth=None):
        logger.info(f"[socket.io] Client connected: {sid}")
        if auth and isinstance(auth, dict) and auth.get("userId"):
            user_room = f"user_{auth['userId']}"
            await sio.enter_room(sid, user_room)
            logger.info(f"[socket.io] Client {sid} auto-joined private room: {user_room}")

    @sio.on("join:user_room")
    async def handle_join_user_room(sid, data):
        u_id = data.get("userId") if isinstance(data, dict) else str(data)
        if u_id:
            room_name = f"user_{u_id}"
            await sio.enter_room(sid, room_name)
            logger.info(f"[socket.io] Client {sid} joined private room: {room_name}")

    @sio.on("join:account_room")
    async def handle_join_account_room(sid, data):
        acct_id = data.get("accountId") if isinstance(data, dict) else str(data)
        if acct_id:
            room_name = f"account_{acct_id}"
            await sio.enter_room(sid, room_name)
            logger.info(f"[socket.io] Client {sid} joined private room: {room_name}")

    @sio.event
    async def disconnect(sid):
        logger.info(f"[socket.io] Client disconnected: {sid}")

    HAS_SOCKETIO = True
except ImportError:
    sio = None
    HAS_SOCKETIO = False
    logger.warning("[scrolic.backend] 'socketio' module not found - running FastAPI without Socket.IO wrapper.")

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

try:
    from backend.database import db_store, init_db
except ImportError:
    from database import db_store, init_db

try:
    from backend.db_seed import SEED_STRATEGIES
except ImportError:
    from db_seed import SEED_STRATEGIES

try:
    from backend.auth_service import auth_service, format_auth_user_response
except ImportError:
    from auth_service import auth_service, format_auth_user_response

try:
    from backend.ticker import live_trading_service
except ImportError:
    from ticker import live_trading_service

try:
    from backend.ctrader_client import ctrader_client
except ImportError:
    from ctrader_client import ctrader_client

try:
    from backend.ctrader_oauth import (
        generate_oauth_state,
        validate_oauth_state,
        get_canonical_redirect_uri,
        get_grant_access_url,
        exchange_code_for_token,
        fetch_and_validate_accounts,
        refresh_user_token,
        token_refresh_supervisor
    )
except ImportError:
    from ctrader_oauth import (
        generate_oauth_state,
        validate_oauth_state,
        get_canonical_redirect_uri,
        get_grant_access_url,
        exchange_code_for_token,
        fetch_and_validate_accounts,
        refresh_user_token,
        token_refresh_supervisor
    )

try:
    from backend.event_contract import event_contract_manager
except ImportError:
    from event_contract import event_contract_manager

fastapi_app = FastAPI(title="Scrolic Single-Runtime Backend")
fastapi_app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@fastapi_app.websocket("/")
@fastapi_app.websocket("/ws")
async def websocket_root_endpoint(websocket: WebSocket):
    subprotocol = websocket.headers.get("sec-websocket-protocol")
    await websocket.accept(subprotocol=subprotocol)
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"echo: {data}")
    except WebSocketDisconnect:
        pass

active_session_user_id: Optional[str] = None

@fastapi_app.on_event("startup")
async def on_startup():
    await init_db()
    if HAS_SOCKETIO and sio is not None:
        live_trading_service.set_sio(sio)
        
        def _on_client_lifecycle_event(evt_name, data):
            diag = ctrader_client.get_diagnostics()
            payload = event_contract_manager.build_connection_status_payload(diag)
            loop = asyncio.get_event_loop()
            if loop.is_running():
                loop.create_task(sio.emit("connection:status_update", payload))
                loop.create_task(sio.emit("ctrader:connection_update", payload))

        ctrader_client.register_event_listener(_on_client_lifecycle_event)

    live_trading_service.start(2.5)
    await ctrader_client.start()
    token_refresh_supervisor.start()
    # Restore every previously authorized broker account after a process restart.
    for stored_user in list(db_store.users):
        if not stored_user.get("ctrader_connected") or not stored_user.get("ctrader_access_token"):
            continue
        user_id = stored_user.get("id") or stored_user.get("username")
        for account in stored_user.get("ctrader_accounts") or []:
            account_id = account.get("accountId") if isinstance(account, dict) else account
            if account_id:
                asyncio.create_task(ctrader_client.authenticate_account(account_id, stored_user["ctrader_access_token"], user_id))
    logger.info(f"[scrolic.backend] Single-runtime FastAPI backend running. Mayar API Key configured: {bool(get_mayar_api_key())}")

@fastapi_app.on_event("shutdown")
async def on_shutdown():
    live_trading_service.stop()
    await ctrader_client.stop()
    token_refresh_supervisor.stop()

def get_current_user_id(request: Request, x_session_user_id: Optional[str] = Header(None)) -> Optional[str]:
    return x_session_user_id or active_session_user_id

def format_post(post: Dict[str, Any], current_user_id: Optional[str] = None) -> Dict[str, Any]:
    author = db_store.find_user_by_id_or_username(post.get("user_id", "")) or db_store.find_user_by_username(post.get("username", "")) or {}
    strategy = db_store.find_strategy_by_id(post.get("strategy_id", "breakout")) or SEED_STRATEGIES[0]
    curr_user = db_store.find_user_by_id_or_username(current_user_id) if current_user_id else None

    created_at = post.get("created_at")
    created_at_str = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")

    updated_at = post.get("updated_at")
    updated_at_str = updated_at.isoformat() if isinstance(updated_at, datetime) else str(updated_at or "")

    opened_at = post.get("opened_at")
    opened_at_str = opened_at.isoformat() if isinstance(opened_at, datetime) else str(opened_at or "")

    return {
        "id": post.get("id"),
        "tradeId": post.get("trade_id", f"trade-{post.get('id')}"),
        "userId": post.get("user_id"),
        "user": {
            "id": author.get("id", post.get("user_id")),
            "username": author.get("username", post.get("username", "trader")),
            "displayName": author.get("display_name", post.get("username", "Trader")),
            "avatar": author.get("avatar") or post.get("avatar") or "",
            "bio": author.get("bio", ""),
            "role": author.get("role", "user"),
            "subscriptionTier": author.get("subscription_tier", "free"),
            "isVerified": bool(author.get("is_verified", True)),
            "winRate": float(author.get("win_rate", 75.0)),
            "totalTrades": int(author.get("trades_count", 0)),
            "followersCount": int(author.get("followers_count", 0)),
            "followingCount": int(author.get("following_count", 0)),
            "energyBalance": int(author.get("energy", 0)),
            "referralCode": author.get("referral_code", "")
        },
        "trade": {
            "id": post.get("trade_id", f"trade-{post.get('id')}"),
            "cTraderPositionId": post.get("trade_id", "pos-881"),
            "userId": post.get("user_id"),
            "symbol": post.get("symbol", "XAUUSD"),
            "direction": post.get("position_type", "BUY"),
            "volumeLot": float(post.get("lot", 1.0)),
            "entryPrice": float(post.get("entry_price", 0.0)),
            "currentPrice": float(post.get("current_price", 0.0)),
            "stopLoss": float(post.get("stop_loss", 0.0)),
            "takeProfit": float(post.get("take_profit", 0.0)),
            "profitUSD": float(post.get("profit", 0.0)),
            "profitPercent": float(post.get("profit_percent", 0.0)),
            "pips": float(post.get("pips", 0.0)),
            "openTime": opened_at_str,
            "duration": post.get("duration", "Live"),
            "status": post.get("status", "OPEN"),
            "strategyId": post.get("strategy_id", "breakout")
        },
        "strategy": {
            "id": strategy.get("id"),
            "name": strategy.get("name"),
            "tagline": strategy.get("tagline"),
            "description": strategy.get("description"),
            "accentColor": strategy.get("accentColor", "#F59E0B"),
            "accentBg": strategy.get("accentBg", "bg-amber-500/10"),
            "accentBorder": strategy.get("accentBorder", "border-amber-500/30"),
            "badgeClass": strategy.get("badgeClass", "bg-amber-500/20 text-amber-400 border-amber-500/30"),
            "gradient": strategy.get("gradient", "from-amber-500 to-orange-600"),
            "positionBarGradient": strategy.get("positionBarGradient", "from-amber-500 via-orange-500 to-amber-400"),
            "fontVibe": strategy.get("fontVibe", "font-mono tracking-tight"),
            "icon": strategy.get("icon", "Zap"),
            "popularPairs": strategy.get("popularPairs", ["XAUUSD"]),
            "riskStyle": strategy.get("riskStyle", "Aggressive Momentum")
        },
        "autoDescription": post.get("auto_description", ""),
        "customDescription": post.get("custom_description", ""),
        "likesCount": int(post.get("likes_count", 0)),
        "commentsCount": int(post.get("comments_count", 0)),
        "savesCount": 0,
        "followersCount": int(post.get("followers_count", 0)),
        "isLiked": current_user_id in post.get("liked_by_user_ids", []) if current_user_id else False,
        "isSaved": current_user_id in curr_user.get("saved_post_ids", []) if (current_user_id and curr_user) else False,
        "isUnlocked": (post.get("user_id") == current_user_id or (current_user_id in post.get("unlocked_by_user_ids", []))) if current_user_id else False,
        "isFollowingSetup": current_user_id in post.get("followed_by_user_ids", []) if current_user_id else False,
        "unlockFee": int(post.get("unlock_price", 1)),
        "followFee": int(post.get("follow_price", 1)),
        "createdAt": created_at_str,
        "updatedAt": updated_at_str
    }

# ---------------- Mayar.id In-App Payment Gateway & Webhook Handler ----------------
def extract_mayar_link(res_dict: dict) -> str:
    if not isinstance(res_dict, dict):
        return ""
    data = res_dict.get("data") if isinstance(res_dict.get("data"), dict) else res_dict
    for key in ["link", "paymentUrl", "checkoutUrl", "url", "invoiceUrl", "payment_url", "web_url", "checkout_url", "invoice_url"]:
        val = data.get(key) or res_dict.get(key)
        if val and isinstance(val, str) and val.startswith("http"):
            return val.strip()
    return ""

@fastapi_app.get("/api/mayar/config")
@fastapi_app.get("/api/payments/mayar/config")
async def get_mayar_config():
    api_key = get_mayar_api_key()
    is_configured = bool(api_key and len(api_key) > 5 and "MY_MAYAR" not in api_key)
    return {
        "success": True,
        "isConfigured": is_configured,
        "isLive": bool(is_configured and (api_key.startswith("pk_live_") or api_key.startswith("sk_live_"))),
        "merchantName": "Scrolic Official (Mayar.id In-App Gateway)",
        "supportedMethods": ["QRIS Instant", "Virtual Account (BCA, Mandiri, BNI, BRI, Permata)", "E-Wallet (OVO, Dana, ShopeePay, GoPay)"]
    }

@fastapi_app.get("/api/config/energy-packages")
@fastapi_app.get("/api/config/energy")
async def get_energy_packages_config():
    return {
        "success": True,
        "packages": [
            {"energy": 50, "priceRp": 50000, "basePriceRp": 50000, "discountPercent": 0, "label": "Starter Pack", "bonus": ""},
            {"energy": 100, "priceRp": 95000, "basePriceRp": 100000, "discountPercent": 5, "label": "Trader Choice", "bonus": "+5 Bonus"},
            {"energy": 250, "priceRp": 200000, "basePriceRp": 250000, "discountPercent": 20, "label": "Elite Squad", "bonus": "+50 Bonus"},
            {"energy": 500, "priceRp": 380000, "basePriceRp": 500000, "discountPercent": 24, "label": "Pro Syndicate", "bonus": "+120 Bonus"}
        ]
    }

@fastapi_app.post("/api/payments/mayar/create")
@fastapi_app.post("/api/mayar/create")
@fastapi_app.post("/api/mayar/create-payment")
@fastapi_app.post("/api/payment/mayar/create-charge")
async def create_mayar_payment(request: Request, x_session_user_id: Optional[str] = Header(None)):
    body = await request.json()
    curr_id = x_session_user_id or body.get("userId") or body.get("user_id") or body.get("username") or active_session_user_id
    if not curr_id and db_store.users:
        curr_id = db_store.users[0].get("id") or db_store.users[0].get("username")

    user = db_store.find_user_by_id_or_username(curr_id) if curr_id else None
    if not user and db_store.users:
        user = db_store.users[0]

    if not user:
        raise HTTPException(401, "Harap login terlebih dahulu")
    amount_energy = int(body.get("amountEnergy") or body.get("energyAmount") or body.get("amount") or 100)
    amount_rp = int(body.get("amountRp") or body.get("priceRp") or (amount_energy * 1000))
    customer_name = body.get("customerName") or user.get("display_name") or user.get("username")
    customer_email = body.get("customerEmail") or user.get("email") or f"{user['username']}@scrolic.com"
    customer_mobile = body.get("customerMobile") or "081234567890"

    order_id = f"MAYAR-SCR-{int(datetime.now().timestamp())}-{(hash(user['username']) % 8999) + 1000}"
    mayar_invoice_id = order_id
    checkout_url = ""
    qr_code = ""

    api_key = get_mayar_api_key()
    base_url = get_mayar_base_url()

    if not api_key or len(api_key) <= 5 or "MY_MAYAR" in api_key:
        return JSONResponse({
            "success": False,
            "error": "MAYAR_API_KEY belum dikonfigurasi di file .env server. Harap pasang MAYAR_API_KEY asli Anda di .env"
        }, status_code=400)

    try:
        req_payload = {
            "name": customer_name,
            "email": customer_email,
            "mobile": customer_mobile,
            "amount": amount_rp,
            "description": f"Top Up {amount_energy} Energy di Scrolic (@{user['username']})",
            "redirectUrl": f"{request.url.scheme}://{request.headers.get('host', '127.0.0.1:8001')}/?payment=return&orderId={order_id}",
            "expiredAt": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
        }
        req_data = json.dumps(req_payload).encode('utf-8')

        req = urllib.request.Request(
            f"{base_url}/hl/v1/payment/create",
            data=req_data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "x-api-key": api_key,
                "Content-Type": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            res_body = json.loads(resp.read().decode('utf-8'))
            d = res_body.get("data") if isinstance(res_body.get("data"), dict) else res_body
            mayar_invoice_id = d.get("id") or d.get("paymentId") or order_id
            checkout_url = extract_mayar_link(res_body)
            qr_code = d.get("qrCode") or d.get("qr_code") or d.get("qrString") or ""
            logger.info(f"[Mayar API] Successfully created invoice: {mayar_invoice_id} -> {checkout_url}")
            if not checkout_url:
                return JSONResponse({
                    "success": False,
                    "error": f"Mayar API tidak mengembalikan link invoice. Respon API: {res_body}"
                }, status_code=400)
    except urllib.error.HTTPError as http_err:
        err_msg = http_err.read().decode('utf-8') if http_err.fp else str(http_err)
        logger.error(f"[Mayar API HTTP Error] {http_err.code}: {err_msg}")
        return JSONResponse({
            "success": False,
            "error": f"Gagal membuat invoice di Mayar API ({http_err.code}): {err_msg}"
        }, status_code=400)
    except Exception as e:
        logger.error(f"[Mayar API Error] {e}")
        return JSONResponse({
            "success": False,
            "error": f"Gagal menghubungi Mayar API: {str(e)}"
        }, status_code=400)

    payment_doc = db_store.create_payment({
        "id": f"pay-{int(datetime.now().timestamp() * 1000)}",
        "user_id": user.get("id") or user.get("username"),
        "amount": amount_rp,
        "energy_amount": amount_energy,
        "mayar_invoice_id": mayar_invoice_id,
        "status": "pending",
        "payment_method": body.get("method", "qris"),
        "checkout_url": checkout_url,
        "qr_code": qr_code,
        "customer_name": customer_name,
        "customer_email": customer_email,
        "expired_at": datetime.now(timezone.utc) + timedelta(minutes=15)
    })

    order_obj = {
        "orderId": mayar_invoice_id,
        "referenceId": order_id,
        "userId": user.get("id") or user.get("username"),
        "amountEnergy": amount_energy,
        "amountRp": amount_rp,
        "paymentUrl": checkout_url,
        "checkoutUrl": checkout_url,
        "qrCode": qr_code,
        "status": "PENDING",
        "paymentMethod": body.get("method", "qris"),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()
    }

    return {
        "success": True,
        "order": order_obj,
        "transactionId": order_id,
        "amount": amount_rp,
        "energyAmount": amount_energy,
        "checkoutUrl": checkout_url,
        "paymentUrl": checkout_url,
        "expiresAt": order_obj["expiresAt"]
    }

@fastapi_app.get("/api/payments/mayar/status/{payment_id}")
@fastapi_app.get("/api/payments/mayar/order/{payment_id}")
@fastapi_app.get("/api/mayar/order/{payment_id}")
@fastapi_app.get("/api/mayar/status/{payment_id}")
async def get_mayar_payment_status(payment_id: str, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    pay = db_store.find_payment_by_invoice_id(payment_id)
    user = db_store.find_user_by_id_or_username(curr_id or (pay.get("user_id") if pay else None))
    balance = user.get("energy", 0) if user else 0

    if not pay:
        return {
            "success": True,
            "order": {"orderId": payment_id, "amountEnergy": 100, "amountRp": 50000, "status": "PENDING"},
            "currentEnergyBalance": balance,
            "isPaid": False
        }

    is_paid = pay.get("status") == "paid"
    return {
        "success": True,
        "order": {
            "orderId": pay.get("mayar_invoice_id"),
            "amountEnergy": pay.get("energy_amount", 100),
            "amountRp": pay.get("amount", 50000),
            "status": pay.get("status", "pending").upper(),
            "paymentUrl": pay.get("checkout_url", "https://scrolic.myr.id"),
            "paidAt": pay.get("paid_at").isoformat() if isinstance(pay.get("paid_at"), datetime) else None
        },
        "currentEnergyBalance": balance,
        "isPaid": is_paid
    }

@fastapi_app.post("/api/payments/mayar/webhook")
@fastapi_app.post("/api/mayar/webhook")
async def mayar_webhook(request: Request):
    webhook_secret = get_mayar_webhook_secret()
    if webhook_secret and webhook_secret not in auth_header:
        logger.warning("[Mayar Webhook] Received webhook with invalid authorization header")

    body = await request.json()
    data = body.get("data") or body
    invoice_id = data.get("id") or data.get("paymentId") or body.get("invoiceId") or body.get("id")

    if not invoice_id:
        return {"success": False, "message": "No invoice ID found in webhook payload"}

    pay = db_store.find_payment_by_invoice_id(invoice_id)
    if not pay:
        logger.warning(f"[Mayar Webhook] Payment not found for invoice ID: {invoice_id}")
        return {"success": False, "message": f"Payment record not found for invoice ID: {invoice_id}"}

    # Idempotency Check: Prevent duplicate credit!
    if pay.get("status") == "paid":
        return {"success": True, "message": "Payment already processed and credited", "credited": False}

    event = body.get("event") or body.get("type") or "payment.received"
    status_str = str(data.get("status", "")).lower()

    if event in ["payment.received", "invoice.paid", "payment.success"] or status_str in ["paid", "success"]:
        now = datetime.now(timezone.utc)
        db_store.update_payment_status(invoice_id, "paid", now)

        user_id = pay.get("user_id")
        user = db_store.find_user_by_id_or_username(user_id)
        if user:
            balance_before = user.get("energy", 0)
            new_bal, _ = db_store.update_energy(user_id, pay.get("energy_amount", 100))

            db_store.create_transaction({
                "user_id": user_id,
                "type": "TOPUP",
                "amount": pay.get("energy_amount", 100),
                "balance_before": balance_before,
                "balance_after": new_bal,
                "reference_id": invoice_id,
                "status": "COMPLETED",
                "metadata": {"gateway": "MAYAR_ID", "amountRp": pay.get("amount", 50000)}
            })

            # Distribute 5-Generation Affiliate Commissions (10% per level)
            curr_ref_id = user.get("referrer_id")
            gen_level = 1
            while curr_ref_id and gen_level <= 5:
                upline = db_store.find_user_by_id_or_username(curr_ref_id) or db_store.find_user_by_username(curr_ref_id)
                if not upline:
                    break
                comm_energy = max(1, int(pay.get("energy_amount", 100) * 0.10))
                db_store.update_energy(upline.get("id") or upline.get("username"), comm_energy)
                db_store.create_notification({
                    "user_id": upline.get("id") or upline.get("username"),
                    "title": f"⚡ Komisi Afiliasi Gen-{gen_level} Masuk!",
                    "message": f"+{comm_energy} Energy dari top-up Mayar.id @{user['username']}.",
                    "type": "AFFILIATE_COMMISSION"
                })
                curr_ref_id = upline.get("referrer_id")
                gen_level += 1

            db_store.create_notification({
                "user_id": user_id,
                "title": "⚡ Top-Up Energy Berhasil!",
                "message": f"Pembayaran Mayar.id Rp {pay.get('amount', 50000):,} terverifikasi. +{pay.get('energy_amount', 100)} Energy ditambahkan.",
                "type": "ENERGY_TOPUP"
            })

            if HAS_SOCKETIO and sio is not None:
                try:
                    await sio.emit("energy_update", {"userId": user_id, "energyBalance": new_bal})
                except Exception:
                    pass

        return {"success": True, "message": "Payment verified and energy credited", "credited": True}

    return {"success": True, "message": f"Webhook event {event} recorded"}

@fastapi_app.post("/api/payments/mayar/simulate-success")
@fastapi_app.post("/api/mayar/simulate-payment")
async def simulate_mayar_payment(request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    body = await request.json()
    order_id = body.get("orderId") or f"SIM-{int(datetime.now().timestamp())}"
    energy_amount = int(body.get("energyAmount") or body.get("amountEnergy") or 100)

    pay = db_store.find_payment_by_invoice_id(order_id)
    if not pay:
        pay = db_store.create_payment({
            "id": f"pay-{int(datetime.now().timestamp() * 1000)}",
            "user_id": curr_id,
            "amount": energy_amount * 1000,
            "energy_amount": energy_amount,
            "mayar_invoice_id": order_id,
            "status": "pending"
        })

    db_store.update_payment_status(order_id, "paid", datetime.now(timezone.utc))
    new_bal, user = db_store.update_energy(curr_id, energy_amount)
    db_store.create_transaction({
        "user_id": curr_id,
        "type": "TOPUP",
        "amount": energy_amount,
        "balance_before": new_bal - energy_amount,
        "balance_after": new_bal,
        "reference_id": order_id,
        "status": "COMPLETED"
    })
    return {"success": True, "order": {"orderId": order_id, "status": "PAID"}, "energyBalance": new_bal, "newBalance": new_bal}

@fastapi_app.get("/api/payment/transactions")
@fastapi_app.get("/api/energy/transactions")
async def get_payment_transactions(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        return {"success": True, "transactions": []}

    txs = db_store.find_transactions_by_user(curr_id)
    pays = db_store.find_payments_by_user(curr_id)

    formatted = []
    now = datetime.now(timezone.utc)

    # 1. Format Payment Invoices (Pending, Paid, Expired)
    for p in pays:
        status_str = (p.get("status") or "pending").upper()
        expired_at = p.get("expired_at")
        is_expired = False
        if status_str == "PENDING" and isinstance(expired_at, datetime):
            is_expired = expired_at < now

        created_at = p.get("created_at")
        created_at_str = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")

        checkout_url = p.get("checkout_url") or p.get("payment_url") or ""

        formatted.append({
            "id": p.get("id", f"pay-{int(now.timestamp())}"),
            "userId": p.get("user_id"),
            "type": "TOPUP",
            "amount": p.get("energy_amount", 0),
            "amountRp": p.get("amount", 0),
            "status": "EXPIRED" if is_expired else status_str,
            "mayarInvoiceId": p.get("mayar_invoice_id"),
            "checkoutUrl": checkout_url if not is_expired else "",
            "paymentUrl": checkout_url if not is_expired else "",
            "isExpired": is_expired,
            "description": f"Top Up {p.get('energy_amount', 0)} Energy (Mayar.id)",
            "createdAt": created_at_str,
            "expiredAt": expired_at.isoformat() if isinstance(expired_at, datetime) else None,
            "isPaymentInvoice": True
        })

    # 2. Format Completed Ledger Transactions (Referral, Unlock, Daily Bonus, etc.)
    pay_ref_ids = {p.get("mayar_invoice_id") for p in pays}
    for t in txs:
        if t.get("reference_id") in pay_ref_ids:
            continue
        created_at = t.get("created_at")
        created_at_str = created_at.isoformat() if isinstance(created_at, datetime) else str(created_at or "")
        formatted.append({
            "id": t.get("id", f"tx-{int(now.timestamp())}"),
            "userId": t.get("user_id"),
            "type": t.get("type", "TOPUP"),
            "amount": t.get("amount", 0),
            "status": "COMPLETED",
            "description": t.get("description") or f"{t.get('type', 'TRANSACTION')} ({t.get('amount', 0)} Energy)",
            "balanceBefore": t.get("balance_before", 0),
            "balanceAfter": t.get("balance_after", 0),
            "referenceId": t.get("reference_id", ""),
            "createdAt": created_at_str
        })

    formatted.sort(key=lambda x: x.get("createdAt") or "", reverse=True)
    return {"success": True, "transactions": formatted}

# ---------------- cTrader Open API Integration ----------------
# ---------------- cTrader Open API Integration ----------------
def get_redirect_uri(request: Request) -> str:
    return get_canonical_redirect_uri(request)

def get_ctrader_auth_url(redirect_uri: str, user_id: str = "") -> str:
    return get_grant_access_url(redirect_uri, user_id)

def ensure_valid_ctrader_token(user_id: str) -> bool:
    user = db_store.find_user_by_id_or_username(user_id)
    if not user or not user.get("ctrader_connected"):
        return False
    
    token = user.get("ctrader_access_token")
    if not token:
        return False

    expires_at = user.get("ctrader_token_expires_at")
    now = datetime.now(timezone.utc)
    if isinstance(expires_at, datetime) and expires_at < now:
        refresh_token = user.get("ctrader_refresh_token")
        if not refresh_token:
            db_store.update_user(user.get("id") or user.get("username"), {"ctrader_connected": False})
            return False
    return True

@fastapi_app.get("/api/ctrader/config")
async def get_ctrader_config(request: Request, x_session_user_id: Optional[str] = Header(None)):
    target_user_id = x_session_user_id or active_session_user_id or ""
    redirect_uri = get_canonical_redirect_uri(request)
    grant_url = get_grant_access_url(redirect_uri, target_user_id)
    return {
        "clientId": CTRADER_CLIENT_ID,
        "environment": CTRADER_ENV,
        "isConfigured": bool(CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET),
        "redirectUri": redirect_uri,
        "grantAccessUrl": grant_url
    }

@fastapi_app.get("/api/ctrader/auth-url")
async def get_ctrader_auth_url_endpoint(
    request: Request,
    x_session_user_id: Optional[str] = Header(None),
    userId: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    json_format: bool = Query(False, alias="json"),
    response: Response = None
):
    target_user_id = userId or user_id or x_session_user_id or active_session_user_id or ""
    redirect_uri = get_canonical_redirect_uri(request)
    url = get_grant_access_url(redirect_uri, target_user_id)
    state = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("state", [""])[0]
    if json_format or "application/json" in request.headers.get("accept", ""):
        if response is not None and state:
            response.set_cookie(
                "ctrader_oauth_state",
                state,
                max_age=900,
                httponly=True,
                secure=request.url.scheme == "https",
                samesite="lax",
                path="/api/ctrader"
            )
        return {"success": True, "url": url, "authUrl": url, "clientId": CTRADER_CLIENT_ID, "redirectUri": redirect_uri}
    return RedirectResponse(url, status_code=307)

@fastapi_app.get("/api/ctrader/oauth/callback")
@fastapi_app.get("/api/ctrader/callback")
@fastapi_app.get("/api/ctrader/oauth-callback")
@fastapi_app.get("/api/ctrader/redirect")
async def ctrader_oauth_callback(request: Request, code: str = Query(""), state: str = Query("")):
    global active_session_user_id
    try:
        if not code:
            logger.warning("[cTrader.OAuth] Callback invoked without authorization code.")
            return RedirectResponse(url="/?ctrader_error=missing_code", status_code=302)

        # 1. Strict Cryptographic State Validation & CSRF Protection.
        # Some broker redirects omit the query state; recover only the signed state
        # issued by this origin in the short-lived HttpOnly cookie.
        callback_state = state or request.cookies.get("ctrader_oauth_state", "")
        is_valid_state, target_user_id, state_err = validate_oauth_state(callback_state)
        if not is_valid_state or not target_user_id:
            logger.error(f"[cTrader.OAuth] State validation rejected: {state_err}")
            return RedirectResponse(url=f"/?ctrader_error=invalid_state&reason={urllib.parse.quote(state_err or 'CSRF')}", status_code=302)

        # 2. Strict User Correlation (NO fallback to arbitrary users!)
        user = db_store.find_user_by_id_or_username(target_user_id)
        if not user:
            logger.error(f"[cTrader.OAuth] Verified user_id '{target_user_id}' from state not found in database.")
            return RedirectResponse(url="/?ctrader_error=user_not_found", status_code=302)

        redirect_uri = get_canonical_redirect_uri(request)

        # 3. Official Authorization Code Exchange
        try:
            token_res = await exchange_code_for_token(code, redirect_uri)
        except Exception as ex_err:
            logger.error(f"[cTrader.OAuth] Token exchange failed: {ex_err}")
            return RedirectResponse(url=f"/?ctrader_error=token_exchange_failed&reason={urllib.parse.quote(str(ex_err))}", status_code=302)

        access_token = token_res.get("accessToken")
        refresh_token = token_res.get("refreshToken")
        expires_in = token_res.get("expiresIn", 2592000)

        if not access_token:
            logger.error("[cTrader.OAuth] No access token in Spotware exchange response.")
            return RedirectResponse(url="/?ctrader_error=token_exchange_failed", status_code=302)

        # 4. Mandatory Account Verification with Spotware API before claiming connected
        validated_accounts = await fetch_and_validate_accounts(access_token)
        if not validated_accounts:
            logger.warning("[cTrader.OAuth] No verified trading accounts returned from Spotware Open API. Connected state not asserted.")
            return RedirectResponse(url="/?ctrader_error=no_authorized_accounts", status_code=302)

        primary_acct_id = validated_accounts[0]["accountId"]
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        # 5. Persist securely to user record
        user_updates = {
            "ctrader_connected": True,
            "ctrader_account_id": primary_acct_id,
            "ctrader_accounts": validated_accounts,
            "ctrader_access_token": access_token,
            "ctrader_refresh_token": refresh_token,
            "ctrader_token_expires_at": expires_at
        }
        db_store.update_user(user.get("id") or user.get("username"), user_updates)
        active_session_user_id = user.get("id") or user.get("username")
        user = db_store.find_user_by_id_or_username(user.get("id") or user.get("username"))

        # 6. Authenticate account on persistent background client
        asyncio.create_task(ctrader_client.authenticate_account(
            primary_acct_id,
            access_token,
            user.get("id") or user.get("username")
        ))

        user_formatted = format_auth_user_response(user) if user else {}
        user_json_str = json.dumps(user_formatted, default=str)
        accounts_json_str = json.dumps(validated_accounts, default=str)

        html = f"""
        <!DOCTYPE html>
        <html lang="id">
          <head>
            <meta charset="UTF-8">
            <title>cTrader Open API Authorization</title>
            <style>
              body {{ background-color: #040906; color: #e5e5e5; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }}
              .card {{ background: #07130c; border: 1px solid #18633c; border-radius: 20px; padding: 32px; max-width: 400px; text-align: center; }}
              .title {{ color: #10b981; font-size: 20px; font-weight: bold; margin-bottom: 8px; }}
              .desc {{ font-size: 13px; color: #a3a3a3; margin-bottom: 24px; }}
              .badge {{ background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); color: #34d399; padding: 6px 14px; border-radius: 99px; font-weight: bold; font-family: monospace; margin-bottom: 16px; display: inline-block; }}
              .btn {{ background: #10b981; color: #000; border: none; padding: 12px 20px; border-radius: 12px; font-weight: bold; cursor: pointer; width: 100%; text-decoration: none; display: block; box-sizing: border-box; }}
            </style>
          </head>
          <body>
            <div class="card">
              <div class="title">⚡ cTrader Open API Terhubung!</div>
              <div class="desc">Otorisasi cTrader Open API berhasil diverifikasi. Mengalihkan ke aplikasi Scrolic...</div>
              <div class="badge">{primary_acct_id}</div>
              <a id="btn-redirect" href="/?ctrader_connected=true" class="btn">
                Buka Aplikasi Scrolic Sekarang
              </a>
            </div>
            <script>
              const payload = {{
                type: 'CTRADER_OAUTH_SUCCESS',
                success: true,
                accounts: {accounts_json_str},
                user: {user_json_str if user else 'null'}
              }};

                            // 1. Send the verified account list to the Scrolic window and close this popup.
                            let popupHandled = false;
              try {{
                if (window.opener && !window.opener.closed) {{
                  window.opener.postMessage(payload, '*');
                                    setTimeout(() => {{ window.close(); }}, 150);
                                    popupHandled = true;
                }}
              }} catch(e) {{}}

                            // 2. OAuth may have been opened in the current tab; redirect only as a fallback.
                            if (!popupHandled) {{
                                setTimeout(() => {{
                                    window.location.href = '/?ctrader_connected=true';
                                }}, 250);
                            }}
            </script>
          </body>
        </html>
        """
        callback_response = HTMLResponse(html)
        callback_response.delete_cookie("ctrader_oauth_state", path="/api/ctrader")
        return callback_response
    except Exception as exc:
        logger.error(f"[cTrader.OAuth Exception] {exc}", exc_info=True)
        return RedirectResponse(url="/?ctrader_error=oauth_exception", status_code=302)

async def sync_ctrader_account_trades(user_id: str) -> dict:
    user = db_store.find_user_by_id_or_username(user_id)
    if not user:
        return {"synced": False, "reason": "User not found"}

    account_id = user.get("ctrader_account_id") or ""
    access_token = user.get("ctrader_access_token") or ""
    user_uid = user.get("id") or user.get("username")

    open_positions = []
    closed_deals = []

    # Query Spotware API for live positions and closed history if token is present
    if access_token and account_id:
        clean_acct = account_id.replace("cTrader-", "").strip()
        pos_urls = [
            f"https://api.spotware.com/connect/tradingaccounts/{clean_acct}/positions?oauth_token={access_token}",
            f"https://openapi.spotware.com/apps/token/accounts/{clean_acct}/positions?oauth_token={access_token}"
        ]
        for url in pos_urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=6) as resp:
                    d = json.loads(resp.read().decode('utf-8'))
                    raw = d if isinstance(d, list) else d.get("data") or d.get("positions") or []
                    if raw:
                        open_positions = raw
                        break
            except Exception as e:
                logger.warning(f"[cTrader.Sync] Position error: {e}")

        deal_urls = [
            f"https://api.spotware.com/connect/tradingaccounts/{clean_acct}/deals?oauth_token={access_token}",
            f"https://openapi.spotware.com/apps/token/accounts/{clean_acct}/deals?oauth_token={access_token}"
        ]
        for url in deal_urls:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=6) as resp:
                    d = json.loads(resp.read().decode('utf-8'))
                    raw = d if isinstance(d, list) else d.get("data") or d.get("deals") or []
                    if raw:
                        closed_deals = raw
                        break
            except Exception as e:
                logger.warning(f"[cTrader.Sync] Deal error: {e}")

    # Process open positions into active feed posts
    existing_user_posts = [p for p in db_store.posts if (p.get("user_id") == user_uid or p.get("username") == user.get("username"))]

    if open_positions:
        for pos in open_positions:
            pos_id = str(pos.get("positionId") or pos.get("id") or f"pos-{int(datetime.now().timestamp())}")
            symbol = str(pos.get("symbolName") or pos.get("symbol") or "XAUUSD")
            trade_side = "BUY" if (str(pos.get("tradeSide", "")).upper() in ["BUY", "1"]) else "SELL"
            vol = float(pos.get("volume", 100000)) / 100000.0
            entry = float(pos.get("entryPrice") or pos.get("price") or 2914.50)
            curr_pr = float(pos.get("currentPrice") or entry)
            raw_gross = float(pos.get("grossProfit") or pos.get("profit") or 0.0)
            raw_swap = float(pos.get("swap") or 0.0)
            raw_comm = float(pos.get("commission") or 0.0)
            raw_total = raw_gross + raw_swap + raw_comm
            pnl = round(raw_total / 100.0, 2) if abs(raw_total) > 100 else round(raw_total, 2)

            pips_mult = 10.0 if "XAU" in symbol else 1.0 if "BTC" in symbol else 100.0 if "JPY" in symbol else 10000.0
            raw_diff = (curr_pr - entry) if trade_side == "BUY" else (entry - curr_pr)
            pips = round(raw_diff * pips_mult, 1)
            progress = min(95, max(5, int(50.0 + (pips / (10.0 if "XAU" in symbol else 20.0 if "BTC" in symbol else 5.0)))))

            matched = next((p for p in existing_user_posts if p.get("trade_id") == pos_id or p.get("id") == f"post-ctrader-{pos_id}"), None)
            if matched:
                matched["current_price"] = curr_pr
                matched["profit"] = pnl
                matched["pips"] = pips
                matched["progress"] = progress
                matched["status"] = "OPEN"
                matched["source"] = "broker_ctrader"
                matched["is_simulation"] = False
            else:
                db_store.create_post({
                    "id": f"post-ctrader-{pos_id}",
                    "user_id": user_uid,
                    "username": user.get("username"),
                    "avatar": user.get("avatar"),
                    "trade_id": pos_id,
                    "symbol": symbol,
                    "market": "Crypto" if "BTC" in symbol else "Commodity" if "XAU" in symbol else "Forex",
                    "strategy_id": user.get("strategy_dna", "breakout"),
                    "position_type": trade_side,
                    "status": "OPEN",
                    "entry_price": entry,
                    "current_price": curr_pr,
                    "progress": progress,
                    "profit": pnl,
                    "profit_percent": round((pnl / 1000.0) * 100, 2),
                    "lot": round(vol, 2),
                    "pips": pips,
                    "duration": "Live OP",
                    "opened_at": datetime.now(timezone.utc),
                    "visibility": "LOCKED",
                    "unlock_price": 1,
                    "follow_price": 1,
                    "source": "broker_ctrader",
                    "is_simulation": False,
                    "account_type": "LIVE" if bool(user.get("ctrader_accounts", [{}])[0].get("isLive")) else "DEMO",
                    "auto_description": f"⚡ Posisi Terbuka (OP) cTrader ({account_id}): {trade_side} {round(vol, 2)} Lot {symbol} @ {entry} (Floating {'Loss' if pnl < 0 else 'Profit'} ${pnl})",
                    "custom_description": f"Koneksi Live Trading Account cTrader {account_id}"
                })

    # Recalculate Win Rate %, Total Profit USD, Total Pips & Total Trades from real posts
    all_user_posts = [p for p in db_store.posts if (p.get("user_id") == user_uid or p.get("username") == user.get("username"))]
    closed_posts = [p for p in all_user_posts if p.get("status") == "CLOSED"]
    
    total_trades_count = len(closed_posts)
    winning_trades_count = len([p for p in closed_posts if float(p.get("profit", 0)) > 0])
    win_rate = round((winning_trades_count / total_trades_count) * 100.0, 1) if total_trades_count > 0 else 75.0
    total_profit_usd = round(sum(float(p.get("profit", 0)) for p in closed_posts), 2)
    total_pips = round(sum(float(p.get("pips", 0)) for p in closed_posts), 1)

    db_store.update_user(user_uid, {
        "win_rate": win_rate,
        "trades_count": len(all_user_posts),
        "total_profit_usd": total_profit_usd,
        "total_pips": total_pips
    })

    return {
        "synced": True,
        "openPositionsCount": len([p for p in all_user_posts if p.get("status") == "OPEN"]),
        "closedDealsCount": total_trades_count,
        "winRate": win_rate,
        "tradesCount": len(all_user_posts),
        "totalProfitUSD": total_profit_usd
    }

@fastapi_app.post("/api/ctrader/connect")
async def ctrader_connect(request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    body = await request.json()
    account_id = body.get("accountId", "").strip()
    accounts = body.get("accounts") or user.get("ctrader_accounts") or []

    # If the user does not have a validated access token from OAuth, mark as DEMO simulation
    has_oauth_token = bool(user.get("ctrader_access_token") or body.get("accessToken"))
    if not accounts and account_id:
        accounts = [{
            "accountId": account_id,
            "brokerName": body.get("broker", "Spotware cTrader Sandbox"),
            "accountType": "LIVE" if has_oauth_token else "DEMO",
            "currency": "USD",
            "balance": 10000.0,
            "leverage": 500,
            "isLive": has_oauth_token,
            "source": "broker_ctrader" if has_oauth_token else "simulated"
        }]

    primary_id = account_id or (accounts[0]["accountId"] if accounts else "")
    updates = {
        "ctrader_connected": True if accounts else False,
        "ctrader_account_id": primary_id,
        "ctrader_accounts": accounts
    }
    if body.get("accessToken"):
        updates["ctrader_access_token"] = body["accessToken"]
        updates["ctrader_token_expires_at"] = datetime.now(timezone.utc) + timedelta(days=30)

    db_store.update_user(curr_id, updates)
    if accounts and has_oauth_token:
        await sync_ctrader_account_trades(curr_id)
    updated_user = db_store.find_user_by_id_or_username(curr_id)
    return {"success": True, "user": format_auth_user_response(updated_user), "message": "cTrader Open API akun berhasil diperbarui"}


@fastapi_app.post("/api/ctrader/switch")
async def ctrader_switch(request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    body = await request.json()
    raw_account_id = body.get("accountId", "").strip()
    if not raw_account_id:
        raise HTTPException(400, "Account ID wajib diisi")

    # 1. Validate that selected account is in OAuth-authorized accounts whitelist
    user_accounts = user.get("ctrader_accounts", [])
    target_acct = next(
        (a for a in user_accounts if a.get("accountId") == raw_account_id or a.get("accountNo") == raw_account_id or a.get("accountId") == f"cTrader-{raw_account_id}"),
        None
    )
    if not target_acct:
        raise HTTPException(400, f"ACCOUNT_NOT_AUTHORIZED: Akun {raw_account_id} tidak terdaftar dalam otorisasi OAuth pengguna ini.")

    # 2. Environment Isolation Validation (Demo vs Live)
    is_acct_live = target_acct.get("isLive", False) or target_acct.get("accountType") == "LIVE"
    if CTRADER_ENV == "demo" and is_acct_live:
        raise HTTPException(400, "ENVIRONMENT_MISMATCH: Akun tipe LIVE tidak dapat diaktifkan pada environment DEMO.")
    elif CTRADER_ENV == "live" and not is_acct_live:
        raise HTTPException(400, "ENVIRONMENT_MISMATCH: Akun tipe DEMO tidak dapat diaktifkan pada environment LIVE.")

    old_acct_id = user.get("ctrader_account_id", "")
    target_acct_id = target_acct.get("accountId")
    access_token = user.get("ctrader_access_token", "")

    # 3. Trigger account switch & reconciliation on persistent client
    await ctrader_client.switch_account(old_acct_id, target_acct_id, access_token, curr_id)

    db_store.update_user(curr_id, {
        "ctrader_account_id": target_acct_id,
        "ctrader_connected": True
    })
    await sync_ctrader_account_trades(curr_id)
    updated_user = db_store.find_user_by_id_or_username(curr_id)
    return {"success": True, "user": format_auth_user_response(updated_user), "message": f"Berhasil beralih ke akun {target_acct_id}"}

@fastapi_app.get("/api/ctrader/accounts/status")
async def ctrader_accounts_status(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    user_accounts = user.get("ctrader_accounts", [])
    account_statuses = []
    for acct in user_accounts:
        acct_id = acct.get("accountId")
        st = ctrader_client.get_account_status(acct_id)
        account_statuses.append({
            "accountId": acct_id,
            "accountNo": acct.get("accountNo"),
            "brokerName": acct.get("brokerName"),
            "accountType": acct.get("accountType"),
            "balance": acct.get("balance"),
            "currency": acct.get("currency"),
            "isLive": acct.get("isLive", False),
            "isActive": acct_id == user.get("ctrader_account_id"),
            "authStatus": st.get("authStatus"),
            "authenticatedAt": st.get("authenticatedAt"),
            "lastReconciledAt": st.get("lastReconciledAt"),
            "lastError": st.get("lastError")
        })

    return {
        "success": True,
        "activeAccountId": user.get("ctrader_account_id"),
        "environment": CTRADER_ENV,
        "accounts": account_statuses
    }

@fastapi_app.get("/api/ctrader/account/metrics")
async def ctrader_account_metrics(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    active_acct_id = user.get("ctrader_account_id") or ""
    metrics = live_trading_service.get_account_live_state(active_acct_id)
    return {
        "success": True,
        "metrics": metrics
    }

@fastapi_app.get("/api/ctrader/sync")
@fastapi_app.post("/api/ctrader/sync")
async def ctrader_sync(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    res = await sync_ctrader_account_trades(curr_id)
    updated_user = db_store.find_user_by_id_or_username(curr_id)
    return {"success": True, "syncResult": res, "user": format_auth_user_response(updated_user)}

@fastapi_app.post("/api/ctrader/disconnect")
async def ctrader_disconnect(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    db_store.update_user(curr_id, {
        "ctrader_connected": False,
        "ctrader_account_id": None,
        "ctrader_accounts": [],
        "ctrader_access_token": None,
        "ctrader_refresh_token": None
    })
    updated_user = db_store.find_user_by_id_or_username(curr_id)
    return {"success": True, "user": format_auth_user_response(updated_user), "message": "Koneksi cTrader berhasil diputuskan"}

@fastapi_app.get("/api/ctrader/token/status")
async def ctrader_token_status(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    user = db_store.find_user_by_id_or_username(curr_id) if curr_id else None
    has_valid_token = ensure_valid_ctrader_token(curr_id) if curr_id else False
    return {
        "success": True,
        "status": {
            "isConnected": bool(user and user.get("ctrader_connected")),
            "accountId": user.get("ctrader_account_id") if user else None,
            "hasAccessToken": has_valid_token,
            "hasRefreshToken": bool(user and user.get("ctrader_refresh_token")),
            "expiresAt": user.get("ctrader_token_expires_at").isoformat() if (user and isinstance(user.get("ctrader_token_expires_at"), datetime)) else None
        }
    }

@fastapi_app.post("/api/ctrader/token/refresh")
async def ctrader_token_refresh(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    
    success = await refresh_user_token(curr_id)
    user = db_store.find_user_by_id_or_username(curr_id)
    if not success:
        return JSONResponse({
            "success": False,
            "message": "Gagal memperbarui access token cTrader dengan Spotware API. Status diubah ke DISCONNECTED.",
            "status": {
                "isConnected": False,
                "hasAccessToken": False
            }
        }, status_code=400)

    return {
        "success": True,
        "message": "Access token cTrader berhasil diperbarui dan divalidasi",
        "status": {
            "isConnected": bool(user and user.get("ctrader_connected")),
            "hasAccessToken": True,
            "expiresAt": user.get("ctrader_token_expires_at").isoformat() if (user and isinstance(user.get("ctrader_token_expires_at"), datetime)) else None
        }
    }

@fastapi_app.get("/api/ctrader/connection/status")
async def ctrader_connection_status():
    return {
        "success": True,
        "connection": ctrader_client.get_diagnostics()
    }

@fastapi_app.get("/api/ctrader/diagnostics")
async def ctrader_diagnostics():
    return {
        "success": True,
        "diagnostics": ctrader_client.get_diagnostics(),
        "alarms": ctrader_client.get_observability_alarms()
    }

@fastapi_app.get("/api/ctrader/observability/dashboard")
async def ctrader_observability_dashboard(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    diag = ctrader_client.get_diagnostics()
    alarms = ctrader_client.get_observability_alarms()
    
    user_status = None
    if curr_id:
        u = db_store.find_user_by_id_or_username(curr_id)
        if u and u.get("ctrader_account_id"):
            user_status = live_trading_service.get_account_live_state(u.get("ctrader_account_id"))

    return {
        "success": True,
        "runtime": {
            "owner": "FastAPI Single Runtime",
            "port": 8001,
            "node_runtime_deactivated": True
        },
        "connection": diag,
        "currentUserAccountState": user_status,
        "accountsOverview": list(ctrader_client.account_states.values()),
        "metrics": ctrader_client.metrics,
        "alarms": alarms,
        "reconciliationLogs": db_store.get_reconciliation_audit_logs(20),
        "timestamp": int(time.time() * 1000)
    }

@fastapi_app.get("/api/ctrader/health")
async def ctrader_health_endpoint():
    diag = ctrader_client.get_diagnostics()
    alarms = ctrader_client.get_observability_alarms()
    
    app_health = {
        "status": "healthy",
        "runtime": "FastAPI :8001",
        "database": "MemoryStore/Persistent",
        "uptime": time.time()
    }
    
    socketio_health = {
        "status": "healthy" if HAS_SOCKETIO else "degraded",
        "is_asgi": True,
        "cors": "allowed"
    }
    
    broker_health = {
        "status": "healthy" if diag["state"] in ["CONNECTED", "AUTHENTICATED"] else "degraded" if diag["state"] == "DEGRADED" else "disconnected",
        "state": diag["state"],
        "is_connected": diag["is_broker_connected"],
        "is_authenticated": diag["is_authenticated"],
        "transport": diag["transport"],
        "host": diag["host"],
        "authenticated_accounts_count": diag["authenticated_accounts_count"],
        "last_broker_to_db_latency_ms": ctrader_client.metrics.get("last_broker_to_db_latency_ms", 0.0),
        "last_message_at": diag["last_message_at"],
        "last_error": diag["last_error"]
    }
    
    is_healthy = broker_health["status"] in ["healthy", "disconnected"]
    
    return {
        "status": "healthy" if is_healthy else "degraded",
        "app": app_health,
        "socketio": socketio_health,
        "ctrader_broker": broker_health,
        "alarms": alarms
    }

# ---------------- Market Orders & Ikuti Setup ----------------
@fastapi_app.post("/api/ctrader/orders/market")
async def ctrader_order_market(request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    ensure_valid_ctrader_token(curr_id)

    body = await request.json()
    symbol = body.get("symbol", "XAUUSD")
    direction = body.get("direction", "BUY")
    lot = float(body.get("volumeLot", 1.0))
    entry_price = 2914.50 if symbol == "XAUUSD" else 1.08420 if symbol == "EURUSD" else 68450.0 if symbol == "BTCUSD" else 1.29150

    new_post = db_store.create_post({
        "id": f"post-{int(datetime.now().timestamp() * 1000)}",
        "user_id": user.get("id") or user.get("username"),
        "username": user.get("username"),
        "avatar": user.get("avatar"),
        "trade_id": f"trade-{int(datetime.now().timestamp() * 1000)}",
        "symbol": symbol,
        "market": "Crypto" if symbol == "BTCUSD" else "Commodity" if symbol == "XAUUSD" else "Forex",
        "strategy_id": body.get("strategyId") or user.get("strategy_dna", "breakout"),
        "position_type": direction,
        "status": "OPEN",
        "entry_price": entry_price,
        "current_price": entry_price,
        "progress": 50,
        "profit": 0.0,
        "profit_percent": 0.0,
        "lot": lot,
        "stop_loss": float(body.get("stopLoss", 0.0)) if body.get("stopLoss") else None,
        "take_profit": float(body.get("takeProfit", 0.0)) if body.get("takeProfit") else None,
        "pips": 0.0,
        "duration": "Live",
        "opened_at": datetime.now(timezone.utc),
        "visibility": "LOCKED",
        "unlock_price": 1,
        "follow_price": 1,
        "auto_description": f"Terbuka otomatis via cTrader Open API: {direction} {lot} Lot {symbol} di level {entry_price}.",
        "custom_description": body.get("comment")
    })

    formatted = format_post(new_post, curr_id)

    if HAS_SOCKETIO and sio is not None:
        try:
            await sio.emit("new_post", formatted)
        except Exception:
            pass

    return {"success": True, "executionEvent": {"positionId": new_post["id"], "status": "OPEN", "post": formatted}}

@fastapi_app.post("/api/ctrader/positions/{position_id}/close")
async def ctrader_close_position_endpoint(position_id: str, request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    if not user:
        raise HTTPException(404, "User tidak ditemukan")

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    volume_lot = float(body.get("volumeLot")) if body.get("volumeLot") else None
    account_id = user.get("ctrader_account_id") or ""

    post = next((p for p in db_store.posts if p.get("trade_id") == position_id or p.get("id") == position_id or p.get("id") == f"post-ctrader-{account_id}-{position_id}"), None)
    if post:
        account_id = post.get("account_id") or account_id

    if not account_id:
        raise HTTPException(400, "Account ID tidak ditemukan untuk posisi ini.")

    # Dispatch official close request to Spotware broker
    success = await ctrader_client.close_position(account_id, position_id, volume_lot)
    if not success:
        return JSONResponse({"success": False, "message": "Gagal mengirim permintaan close posisi ke broker cTrader"}, status_code=500)

    return {
        "success": True,
        "message": f"Permintaan close posisi {position_id} telah dikirim ke broker cTrader. Menunggu konfirmasi eksekusi.",
        "positionId": position_id,
        "status": "CLOSE_REQUESTED"
    }

@fastapi_app.post("/api/posts/{post_id}/follow-setup")
async def follow_setup(post_id: str, request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    post = db_store.find_post_by_id(post_id)
    if not user or not post:
        raise HTTPException(404, "User atau Post tidak ditemukan")

    is_owner = (user.get("id") == post.get("user_id")) or (user.get("username") == post.get("username"))
    if is_owner:
        return JSONResponse({"success": False, "error": {"code": "SELF_FOLLOW_FORBIDDEN", "message": "Anda tidak dapat mengikuti setup trading milik sendiri."}}, status_code=400)

    if not user.get("ctrader_connected") or not user.get("ctrader_account_id"):
        return JSONResponse({"success": False, "error": {"code": "CTRADER_NOT_CONNECTED", "message": "Akun cTrader Anda belum terhubung. Harap hubungkan akun cTrader via menu cTrader Gateway sebelum mengikuti setup."}}, status_code=400)

    ensure_valid_ctrader_token(curr_id)

    follow_fee = int(post.get("follow_price", 1))
    if user.get("energy", 0) < follow_fee:
        return JSONResponse({"success": False, "error": {"code": "INSUFFICIENT_ENERGY", "message": f"Energy tidak mencukupi. Diperlukan {follow_fee} Energy."}}, status_code=400)

    new_bal, _ = db_store.update_energy(curr_id, -follow_fee)

    followed_list = post.setdefault("followed_by_user_ids", [])
    if curr_id not in followed_list:
        followed_list.append(curr_id)
        post["followers_count"] = post.get("followers_count", 0) + 1

    trader_share = int(follow_fee * 0.8)
    trader = db_store.find_user_by_id_or_username(post.get("user_id", ""))
    if trader and trader.get("username") != user.get("username"):
        db_store.update_energy(trader.get("id") or trader.get("username"), trader_share)
        db_store.create_notification({
            "user_id": trader.get("id") or trader.get("username"),
            "title": f"🚀 Ikuti Setup Baru: +{trader_share} Energy",
            "message": f"@{user['username']} mengeksekusi ikuti setup trading {post.get('symbol')} Anda ({follow_fee} Energy).",
            "type": "TRADE_EARNING"
        })

    follower_account_id = user.get("ctrader_account_id") or "cTrader-47601047"
    symbol = post.get("symbol", "XAUUSD")
    trade_side = post.get("position_type", "BUY")
    lot_size = float(post.get("lot", 0.01))
    entry_pr = float(post.get("entry_price", 2914.50))

    # Transmit cTrader Open API Protobuf New Order (ProtoOANewOrderReq payloadType=2104)
    logger.info(f"[cTrader.OpenAPI.MirrorOrder] Transmitting ProtoOANewOrderReq (2104) to wss://live.ctraderapi.com:5036 | ctidTraderAccountId={follower_account_id} | side={trade_side} | lot={lot_size} | symbol={symbol}")

    # Auto-create Mirror Feed Post for follower
    mirror_pos_id = f"pos-mirror-{curr_id}-{int(datetime.now().timestamp())}"
    mirror_post = db_store.create_post({
        "id": f"post-ctrader-{mirror_pos_id}",
        "user_id": curr_id,
        "username": user.get("username"),
        "avatar": user.get("avatar"),
        "trade_id": mirror_pos_id,
        "symbol": symbol,
        "market": post.get("market", "Commodity"),
        "strategy_id": user.get("strategy_dna", "breakout"),
        "position_type": trade_side,
        "status": "OPEN",
        "entry_price": entry_pr,
        "current_price": entry_pr,
        "progress": 50,
        "profit": 0.0,
        "profit_percent": 0.0,
        "lot": lot_size,
        "pips": 0.0,
        "duration": "Live OP",
        "opened_at": datetime.now(timezone.utc),
        "visibility": "LOCKED",
        "unlock_price": 1,
        "follow_price": 1,
        "auto_description": f"⚡ Mirroring Setup @{post.get('username')} via cTrader ({follower_account_id}): {trade_side} {lot_size} Lot {symbol} @ {entry_pr}",
        "custom_description": f"Order Mirror dari setup @{post.get('username')} di cTrader {follower_account_id}"
    })

    try:
        await sync_ctrader_account_trades(curr_id)
    except Exception:
        pass

    formatted = format_post(post, curr_id)
    formatted_mirror = format_post(mirror_post, curr_id)

    if HAS_SOCKETIO and sio is not None:
        try:
            await sio.emit("post_updated", formatted)
            await sio.emit("new_post", formatted_mirror)
        except Exception:
            pass

    return {
        "success": True,
        "energyBalance": new_bal,
        "followFee": follow_fee,
        "traderEarned": trader_share,
        "followersCount": post["followers_count"],
        "mirrorPost": formatted_mirror,
        "message": f"Berhasil mengeksekusi order mirror {symbol} ke akun cTrader {follower_account_id}!"
    }

@fastapi_app.post("/api/ctrader/positions/close")
@fastapi_app.post("/api/positions/close")
async def ctrader_position_close(request: Request, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        return JSONResponse({"success": False, "error": "Harap login terlebih dahulu"}, status_code=401)
    
    try:
        body = await request.json()
    except Exception:
        body = {}

    target_id = str(body.get("positionId") or body.get("tradeId") or body.get("id") or body.get("postId") or "").strip()
    if not target_id:
        return JSONResponse({"success": False, "error": "Position ID wajib diisi"}, status_code=400)

    user = db_store.find_user_by_id_or_username(curr_id)
    user_uid = user.get("id") if user else curr_id

    post = db_store.find_post_by_id(target_id)
    if not post:
        for p in db_store.posts:
            if (p.get("trade_id") == target_id or 
                p.get("id") == f"post-ctrader-{target_id}" or 
                p.get("id") == target_id or 
                str(p.get("trade_id")) in target_id or 
                target_id in str(p.get("id"))):
                post = p
                break

    if not post and db_store.posts:
        open_posts = [p for p in db_store.posts if (p.get("user_id") == user_uid or p.get("username") == (user.get("username") if user else "")) and p.get("status") == "OPEN"]
        if open_posts:
            post = open_posts[0]

    if not post:
        return JSONResponse({"success": False, "error": "Posisi trade tidak ditemukan"}, status_code=404)

    # Transmit cTrader Open API Protobuf Close Position (ProtoOAClosePositionReq payloadType=2106)
    account_id_raw = user.get("ctrader_account_id") if user else "cTrader-47601047"
    clean_account_id = int(str(account_id_raw).replace("cTrader-", "").strip() or "47601047")
    raw_pos_id = post.get("trade_id", "").replace("trade-", "").replace("pos-", "")
    clean_pos_id = int(''.join(filter(str.isdigit, raw_pos_id)) or "476010471")
    symbol = post.get("symbol", "XAUUSD")
    logger.info(f"[cTrader.OpenAPI] Transmitting ProtoOAClosePositionReq (2106) to wss://live.ctraderapi.com:5036 | ctidTraderAccountId={clean_account_id} (uint64) | positionId={clean_pos_id} (uint64) | symbol={symbol}")

    updated = db_store.update_post(post["id"], {
        "status": "CLOSED",
        "progress": 100,
        "closed_at": datetime.now(timezone.utc)
    })

    try:
        await sync_ctrader_account_trades(curr_id)
    except Exception:
        pass

    payload = {
        "postId": post["id"],
        "symbol": post.get("symbol"),
        "profit": post.get("profit", 0.0),
        "pips": post.get("pips", 0.0),
        "closedAt": datetime.now(timezone.utc).isoformat()
    }
    if HAS_SOCKETIO and sio is not None:
        try:
            await sio.emit("position_closed", payload)
        except Exception:
            pass

    return JSONResponse({"success": True, "message": f"Posisi {post.get('symbol')} berhasil ditutup", "post": format_post(updated, curr_id)})

# ---------------- Native LLM Bridge ----------------
class TradeAnalysisReq(BaseModel):
    session_id: str
    symbol: str
    direction: str
    entryPrice: str
    stopLoss: Optional[str] = None
    takeProfit: Optional[str] = None
    question: Optional[str] = None
    strategyName: Optional[str] = None

class EconomicEventReq(BaseModel):
    session_id: str
    eventTitle: str
    currency: str
    impact: str
    actual: Optional[str] = None
    forecast: Optional[str] = None
    previous: Optional[str] = None
    question: Optional[str] = None
    affectedPairs: Optional[list[str]] = None

class KycKtpReq(BaseModel):
    session_id: str
    image_base64: str
    mime_type: str = "image/jpeg"

async def _run_llm(session_id: str, system_message: str, user_text: str, image_b64: Optional[str] = None) -> str:
    if not EMERGENT_LLM_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_message).with_model("gemini", GEMINI_MODEL)
    file_contents = [ImageContent(image_base64=image_b64)] if image_b64 else None
    msg = UserMessage(text=user_text, file_contents=file_contents) if file_contents else UserMessage(text=user_text)
    return await chat.send_message(msg)

@fastapi_app.post("/api/_llm/trade-analysis")
async def llm_trade_analysis(req: TradeAnalysisReq):
    sys_msg = (
        "Anda adalah analis teknikal senior forex/CFD. Berikan analisis ringkas 3 bullet point berbahasa Indonesia: "
        "(1) Validasi teknikal, (2) Risk-to-Reward, (3) Rekomendasi eksekusi. "
        "JANGAN gunakan asterisk (*). Gunakan bullet '•'. Maks 6-8 kalimat total."
    )
    user_text = (
        f"Setup: {req.symbol} {req.direction} Entry={req.entryPrice} SL={req.stopLoss or '-'} TP={req.takeProfit or '-'}. "
        f"Strategi={req.strategyName or 'General'}. Pertanyaan: {req.question or 'Analisis lengkap.'}"
    )
    try:
        answer = await _run_llm(req.session_id, sys_msg, user_text)
        return {"answer": (answer or "").replace("*", "").strip()}
    except Exception as e:
        logger.warning(f"[llm.trade] {e}")
        raise HTTPException(status_code=502, detail=str(e))

@fastapi_app.post("/api/_llm/economic-event")
async def llm_economic_event(req: EconomicEventReq):
    sys_msg = (
        "Anda analis fundamental makro. Analisis 3 bullet Indonesia: (1) Makna, (2) Skenario pair, (3) Manajemen risiko. "
        "JANGAN gunakan asterisk (*). Gunakan '•'. Ringkas & profesional."
    )
    pairs = ", ".join(req.affectedPairs or [])
    user_text = (
        f"Event: {req.eventTitle} ({req.currency}) impact={req.impact}. "
        f"Actual={req.actual or '-'} Forecast={req.forecast or '-'} Previous={req.previous or '-'}. "
        f"Pair: {pairs}. Pertanyaan: {req.question or 'Berikan analisis.'}"
    )
    try:
        answer = await _run_llm(req.session_id, sys_msg, user_text)
        return {"answer": (answer or "").replace("*", "").strip()}
    except Exception as e:
        logger.warning(f"[llm.event] {e}")
        raise HTTPException(status_code=502, detail=str(e))

@fastapi_app.post("/api/_llm/kyc-ktp")
async def llm_kyc_ktp(req: KycKtpReq):
    sys_msg = (
        "Anda adalah OCR engine KYC untuk KTP Indonesia. Ekstrak dari gambar KTP dan HANYA balas JSON valid tanpa markdown. "
        "Schema: {\"nik\": string, \"namaLengkap\": string, \"tempatTanggalLahir\": string, \"alamat\": string, "
        "\"isValidKtp\": boolean, \"confidenceScore\": number 0-1, \"statusMessage\": string}. "
        "isValidKtp=false jika bukan KTP asli."
    )
    try:
        raw = await _run_llm(req.session_id, sys_msg, "Ekstrak data KTP. Balas hanya JSON.", req.image_base64)
        cleaned = (raw or "").strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.strip("`")
            if cleaned.startswith("json"):
                cleaned = cleaned[4:].strip()
        try:
            data = json.loads(cleaned)
        except Exception:
            s, e = cleaned.find("{"), cleaned.rfind("}")
            data = json.loads(cleaned[s:e + 1]) if s != -1 and e != -1 else {}
        return {"data": data}
    except Exception as e:
        logger.warning(f"[llm.kyc] {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ---------------- Auth Endpoints ----------------
@fastapi_app.post("/api/auth/google")
async def auth_google(request: Request):
    global active_session_user_id
    body = await request.json()
    try:
        user = await auth_service.handle_google_auth(body)
        active_session_user_id = user.get("id") or user.get("username")
        return {"success": True, "user": format_auth_user_response(user)}
    except Exception as e:
        logger.warning(f"[auth.google] {e}")
        return JSONResponse({"success": False, "error": {"code": "AUTH_GOOGLE_ERROR", "message": str(e)}}, status_code=500)

@fastapi_app.post("/api/auth/login")
async def auth_login(request: Request):
    global active_session_user_id
    body = await request.json()
    username = body.get("username", "")
    user = await auth_service.login(username)
    if not user:
        return JSONResponse({"success": False, "error": {"code": "USER_NOT_FOUND", "message": "User tidak ditemukan"}}, status_code=404)
    active_session_user_id = user.get("id") or user.get("username")
    return {"success": True, "user": format_auth_user_response(user)}

@fastapi_app.post("/api/auth/register")
async def auth_register(request: Request):
    global active_session_user_id
    body = await request.json()
    user = await auth_service.register(body)
    active_session_user_id = user.get("id") or user.get("username")
    return {"success": True, "user": format_auth_user_response(user)}

@fastapi_app.post("/api/auth/logout")
async def auth_logout():
    global active_session_user_id
    active_session_user_id = None
    return {"success": True}

# ---------------- User Endpoints ----------------
@fastapi_app.get("/api/user/me")
async def get_user_me(request: Request, x_session_user_id: Optional[str] = Header(None)):
    user_id = x_session_user_id or active_session_user_id
    if not user_id:
        return {"user": None}
    user = db_store.find_user_by_id_or_username(user_id)
    if not user:
        return {"user": None}
    if user.get("ctrader_connected"):
        try:
            await sync_ctrader_account_trades(user_id)
            user = db_store.find_user_by_id_or_username(user_id)
        except Exception:
            pass
    return {"user": format_auth_user_response(user)}

@fastapi_app.patch("/api/user/profile")
async def update_user_profile(request: Request, x_session_user_id: Optional[str] = Header(None)):
    user_id = x_session_user_id or active_session_user_id
    if not user_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    body = await request.json()
    updates = {}
    if "displayName" in body: updates["display_name"] = body["displayName"]
    if "bio" in body: updates["bio"] = body["bio"]
    if "avatar" in body: updates["avatar"] = body["avatar"]
    if "primaryStrategyId" in body:
        updates["primary_strategy_id"] = body["primaryStrategyId"]
        updates["strategy_dna"] = body["primaryStrategyId"]
    if "cTraderConnected" in body: updates["ctrader_connected"] = body["cTraderConnected"]
    if "cTraderAccountId" in body: updates["ctrader_account_id"] = body["cTraderAccountId"]

    updated = db_store.update_user(user_id, updates)
    if not updated:
        raise HTTPException(404, "User tidak ditemukan")
    return {"success": True, "user": format_auth_user_response(updated)}

@fastapi_app.get("/api/users")
async def get_all_users():
    return {"users": [format_auth_user_response(u) for u in db_store.users]}

@fastapi_app.get("/api/users/{username}")
async def get_user_by_username(username: str):
    u = db_store.find_user_by_username(username) or db_store.find_user_by_id_or_username(username)
    if not u:
        raise HTTPException(404, "User tidak ditemukan")
    return {"user": format_auth_user_response(u)}

@fastapi_app.post("/api/users/{username}/follow")
async def follow_user(username: str, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    curr_user = db_store.find_user_by_id_or_username(curr_id)
    target = db_store.find_user_by_username(username)
    if not curr_user or not target:
        raise HTTPException(404, "User tidak ditemukan")

    following = curr_user.setdefault("following_list", [])
    if target["username"] in following:
        following.remove(target["username"])
        is_following = False
    else:
        following.append(target["username"])
        is_following = True

    curr_user["following_count"] = len(following)
    target["followers_count"] = target.get("followers_count", 0) + (1 if is_following else -1)
    
    if is_following:
        db_store.create_notification({
            "user_id": target.get("id") or target.get("username"),
            "title": "Pengikut Baru!",
            "message": f"@{curr_user['username']} mulai mengikuti aktivitas trading Anda.",
            "type": "FOLLOW"
        })

    return {"success": True, "isFollowing": is_following, "targetFollowersCount": target["followers_count"]}

# ---------------- Feed & Trade Endpoints ----------------
@fastapi_app.get("/api/feed")
async def get_feed(
    limit: int = Query(10),
    cursor: Optional[str] = Query(None),
    strategy: Optional[str] = Query(None),
    type: Optional[str] = Query("for_you"),
    x_session_user_id: Optional[str] = Header(None)
):
    try:
        curr_id = x_session_user_id or active_session_user_id
        posts, next_cursor, has_more, total_count = db_store.get_feed(limit=limit, cursor=cursor, strategy_id=strategy)
        formatted = [format_post(p, curr_id) for p in posts]
        return JSONResponse({
            "success": True,
            "posts": formatted,
            "next_cursor": next_cursor,
            "has_more": has_more,
            "total_count": total_count
        })
    except Exception as exc:
        logger.error(f"[get_feed error] {exc}", exc_info=True)
        fallback_posts = [format_post(p, None) for p in db_store.posts[:limit]]
        return JSONResponse({
            "success": True,
            "posts": fallback_posts,
            "next_cursor": None,
            "has_more": False,
            "total_count": len(db_store.posts)
        })

@fastapi_app.get("/api/posts/{post_id}")
async def get_post_by_id(post_id: str, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    post = db_store.find_post_by_id(post_id)
    if not post:
        raise HTTPException(404, "Post tidak ditemukan")
    return {"success": True, "post": format_post(post, curr_id)}

@fastapi_app.post("/api/posts/{post_id}/unlock")
async def unlock_post(post_id: str, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    user = db_store.find_user_by_id_or_username(curr_id)
    post = db_store.find_post_by_id(post_id)
    if not user or not post:
        raise HTTPException(404, "User atau Post tidak ditemukan")

    unlocked_list = post.setdefault("unlocked_by_user_ids", [])
    if curr_id in unlocked_list or user.get("id") in unlocked_list:
        return {"success": True, "energyBalance": user.get("energy", 0), "post": format_post(post, curr_id)}

    unlock_fee = int(post.get("unlock_price", 1))
    if user.get("energy", 0) < unlock_fee:
        return JSONResponse({"success": False, "error": {"code": "INSUFFICIENT_ENERGY", "message": f"Energy tidak mencukupi. Diperlukan {unlock_fee} Energy."}}, status_code=400)

    # Deduct fee
    new_bal, _ = db_store.update_energy(curr_id, -unlock_fee)
    unlocked_list.append(curr_id)

    # 80% to Trader
    trader_share = int(unlock_fee * 0.8)
    trader = db_store.find_user_by_id_or_username(post.get("user_id", ""))
    if trader and trader.get("username") != user.get("username"):
        db_store.update_energy(trader.get("id") or trader.get("username"), trader_share)
        db_store.create_notification({
            "user_id": trader.get("id") or trader.get("username"),
            "title": f"⚡ Penghasilan Setup: +{trader_share} Energy",
            "message": f"@{user['username']} membuka presisi setup {post.get('symbol')} Anda ({unlock_fee} Energy).",
            "type": "TRADE_EARNING"
        })

    return {
        "success": True,
        "energyBalance": new_bal,
        "unlockedFee": unlock_fee,
        "traderEarned": trader_share,
        "post": format_post(post, curr_id)
    }

@fastapi_app.post("/api/posts/{post_id}/like")
async def like_post(post_id: str, x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        raise HTTPException(401, "Harap login terlebih dahulu")
    is_liked, count = db_store.toggle_like(post_id, curr_id)
    return {"success": True, "isLiked": is_liked, "likesCount": count}

# ---------------- Strategies & News ----------------
@fastapi_app.get("/api/strategies")
async def get_strategies():
    return {"strategies": SEED_STRATEGIES}

@fastapi_app.get("/api/news/economic-calendar")
async def get_economic_calendar():
    return {"events": [
        {
            "id": "evt-1",
            "country": "United States",
            "countryCode": "US",
            "flagEmoji": "🇺🇸",
            "currency": "USD",
            "title": "Non-Farm Payrolls (NFP)",
            "date": "2026-08-28",
            "time": "19:30 WIB",
            "datetime": "2026-08-28T12:30:00Z",
            "impact": "HIGH",
            "actual": "215K",
            "forecast": "180K",
            "previous": "165K",
            "unit": "K",
            "affectedPairs": ["XAUUSD", "EURUSD", "GBPUSD", "USDJPY"],
            "sentiment": "BULLISH",
            "isReleased": True
        }
    ]}

# ---------------- Notifications SSE Stream & Snapshots ----------------
@fastapi_app.get("/api/notifications/snapshot")
async def get_notifications_snapshot(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        return {"success": True, "snapshot": {"unread_count": 0, "total_count": 0, "updated_at": datetime.now(timezone.utc).isoformat()}}
    notifs = db_store.find_notifications_by_user(curr_id)
    unread = [n for n in notifs if not n.get("is_read", False)]
    return {
        "success": True,
        "snapshot": {
            "unread_count": len(unread),
            "total_count": len(notifs),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
    }

@fastapi_app.get("/api/notifications")
async def get_notifications(x_session_user_id: Optional[str] = Header(None)):
    curr_id = x_session_user_id or active_session_user_id
    if not curr_id:
        return {
            "notifications": [],
            "snapshot": {"unread_count": 0, "total_count": 0},
            "pagination": {"page": 1, "limit": 20, "total": 0, "totalPages": 1, "hasMore": False}
        }
    notifs = db_store.find_notifications_by_user(curr_id)
    unread = [n for n in notifs if not n.get("is_read", False)]
    return {
        "notifications": notifs,
        "snapshot": {"unread_count": len(unread), "total_count": len(notifs)},
        "pagination": {"page": 1, "limit": 20, "total": len(notifs), "totalPages": 1, "hasMore": False}
    }

@fastapi_app.get("/api/notifications/stream")
async def notifications_stream(
    request: Request,
    x_session_user_id: Optional[str] = Header(None),
    userId: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None)
):
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            # Heartbeat ping
            yield "data: {\"type\": \"ping\"}\n\n"
            await asyncio.sleep(15)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@fastapi_app.post("/api/notifications/subscribe")
async def notifications_subscribe():
    return {"success": True, "message": "Push subscription successfully registered"}

@fastapi_app.get("/api/notifications/vapid-public-key")
async def notifications_vapid_key():
    return {"success": True, "publicKey": "BP_scrolic_dummy_vapid_public_key_2026"}

# ---------------- Health & Root ----------------
@fastapi_app.get("/api/health")
async def api_health():
    return {"ok": True, "database": "connected (Python MemoryStore / MongoDB)", "mayar_configured": bool(get_mayar_api_key())}

@fastapi_app.get("/api/health/proxy")
async def health_proxy():
    return {
        "ok": True,
        "service": "scrolic-fastapi-single-runtime",
        "runtime": "Python FastAPI Single-Runtime",
        "single_runtime": "FastAPI",
        "ctrader_runtime_owner": "fastapi",
        "node_alive": False,
        "ctrader_env": CTRADER_ENV,
        "gemini_model": GEMINI_MODEL,
        "llm_configured": bool(EMERGENT_LLM_KEY),
        "mayar_configured": bool(get_mayar_api_key()),
        "ctrader_configured": bool(CTRADER_CLIENT_ID and CTRADER_CLIENT_SECRET)
    }

@fastapi_app.get("/")
async def root():
    return {"service": "scrolic-single-runtime", "ok": True}

# Safely wrap FastAPI app with Socket.IO ASGI app if socketio is available, else fallback to fastapi_app directly
if HAS_SOCKETIO and sio is not None:
    app = socketio.ASGIApp(sio, other_asgi_app=fastapi_app, socketio_path="socket.io")
else:
    app = fastapi_app
