"""
FastAPI Hybrid Proxy Backend for Scrolic
========================================
1. /api/_llm/* handled natively via emergentintegrations (Gemini)
2. All other /api/* -> proxied to Node Express on 127.0.0.1:3001
3. /socket.io/* -> WebSocket + HTTP long-polling proxy to Node
4. Node backend is spawned as child process on startup
"""
import os, asyncio, json, logging, signal, subprocess, sys
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware
from starlette.websockets import WebSocketState
import websockets as ws_client

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("scrolic.proxy")

NODE_HOST = os.environ.get("NODE_BACKEND_HOST", "127.0.0.1")
NODE_PORT = int(os.environ.get("NODE_BACKEND_PORT", "3001"))
NODE_BASE = f"http://{NODE_HOST}:{NODE_PORT}"

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")

app = FastAPI(title="Scrolic Hybrid Backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

_node_proc: Optional[subprocess.Popen] = None


def _start_node_backend() -> None:
    global _node_proc
    node_dir = Path("/app/node_server")
    if not node_dir.exists():
        logger.warning("[node] /app/node_server missing")
        return
    env = os.environ.copy()
    env["PORT"] = str(NODE_PORT)
    env["NODE_ENV"] = "production"
    env["DISABLE_HMR"] = "true"
    env["SCROLIC_LLM_BASE"] = "http://127.0.0.1:8001"
    logger.info(f"[node] spawning on port {NODE_PORT}")
    _node_proc = subprocess.Popen(
        ["/usr/bin/npx", "tsx", "server.ts"],
        cwd=str(node_dir), env=env, stdout=sys.stdout, stderr=sys.stderr, preexec_fn=os.setsid,
    )
    logger.info(f"[node] pid={_node_proc.pid}")


def _stop_node_backend() -> None:
    global _node_proc
    if _node_proc is None:
        return
    try:
        os.killpg(os.getpgid(_node_proc.pid), signal.SIGTERM)
    except Exception:
        pass
    _node_proc = None


@app.on_event("startup")
async def on_startup():
    _start_node_backend()
    await asyncio.sleep(0.5)


@app.on_event("shutdown")
async def on_shutdown():
    _stop_node_backend()


# ---------------- LLM Bridge ----------------
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


async def _run_llm(session_id: str, system_message: str, user_text: str,
                   image_b64: Optional[str] = None) -> str:
    if not EMERGENT_LLM_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY not configured")
    from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent  # type: ignore
    chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=session_id, system_message=system_message).with_model("gemini", GEMINI_MODEL)
    file_contents = [ImageContent(image_base64=image_b64)] if image_b64 else None
    msg = UserMessage(text=user_text, file_contents=file_contents) if file_contents else UserMessage(text=user_text)
    return await chat.send_message(msg)


@app.post("/api/_llm/trade-analysis")
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


@app.post("/api/_llm/economic-event")
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


@app.post("/api/_llm/kyc-ktp")
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


@app.get("/api/health/proxy")
async def health_proxy():
    return {"ok": True, "service": "scrolic-hybrid-proxy", "node_pid": _node_proc.pid if _node_proc else None}


# ---------------- HTTP Proxy ----------------
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=5.0))
    return _http_client


HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailers", "transfer-encoding", "upgrade", "content-length", "content-encoding", "host"}


async def _proxy_http(request: Request, path: str) -> Response:
    url = f"{NODE_BASE}/{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    fwd = {k: v for k, v in request.headers.items() if k.lower() not in HOP_HEADERS}
    fwd["x-forwarded-for"] = fwd.get("x-forwarded-for", (request.client.host if request.client else ""))
    fwd["x-forwarded-proto"] = request.url.scheme
    fwd.setdefault("x-forwarded-host", request.headers.get("host", ""))
    body = await request.body()
    try:
        resp = await _get_http_client().request(request.method, url, headers=fwd, content=body, follow_redirects=False)
    except httpx.ConnectError:
        return JSONResponse({"error": {"code": "NODE_DOWN", "message": "Node backend unreachable"}}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": {"code": "PROXY_ERROR", "message": str(e)}}, status_code=502)
    out = {k: v for k, v in resp.headers.items() if k.lower() not in HOP_HEADERS}
    return Response(content=resp.content, status_code=resp.status_code, headers=out)


@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def api_proxy(request: Request, path: str):
    if path.startswith("_llm/") or path == "health/proxy":
        raise HTTPException(404)
    return await _proxy_http(request, f"api/{path}")


# ---------------- Socket.IO Proxy ----------------
@app.websocket("/socket.io/{path:path}")
async def socketio_ws(ws: WebSocket, path: str):
    await ws.accept()
    target = f"ws://{NODE_HOST}:{NODE_PORT}/socket.io/{path}"
    if ws.url.query:
        target = f"{target}?{ws.url.query}"
    try:
        async with ws_client.connect(target, open_timeout=10) as upstream:
            async def c2u():
                try:
                    while True:
                        m = await ws.receive()
                        if m.get("type") == "websocket.disconnect":
                            break
                        if m.get("text") is not None:
                            await upstream.send(m["text"])
                        elif m.get("bytes") is not None:
                            await upstream.send(m["bytes"])
                except (WebSocketDisconnect, Exception):
                    pass

            async def u2c():
                try:
                    async for m in upstream:
                        if isinstance(m, str):
                            await ws.send_text(m)
                        else:
                            await ws.send_bytes(m)
                except Exception:
                    pass

            await asyncio.gather(c2u(), u2c())
    except Exception as e:
        logger.warning(f"[ws] {e}")
    finally:
        if ws.client_state != WebSocketState.DISCONNECTED:
            try:
                await ws.close()
            except Exception:
                pass


@app.api_route("/socket.io/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def socketio_http(request: Request, path: str):
    return await _proxy_http(request, f"socket.io/{path}")


@app.api_route("/socket.io/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def socketio_root(request: Request):
    return await _proxy_http(request, "socket.io/")


@app.get("/")
async def root():
    return {"service": "scrolic", "ok": True}
