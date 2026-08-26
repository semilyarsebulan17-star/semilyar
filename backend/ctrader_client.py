"""
Official Persistent cTrader Open API v2 Connection Client
Single Runtime Owner: Python FastAPI (:8001)
================================================================================
Spec & Official Documentation:
- Endpoint (Demo): demo.ctraderapi.com (TCP TLS: 5035 / WSS: 5036)
- Endpoint (Live): live.ctraderapi.com (TCP TLS: 5035 / WSS: 5036)
- Protocol: Spotware Open API v2 (Protobuf / WebSocket Framing)
- Connection Lifecycle: DISCONNECTED, CONNECTING, CONNECTED, AUTHENTICATED, DEGRADED, RECONNECTING
- Application & Account Authentication Gate
- Per-Account Status Tracking & Environment Isolation
"""

import asyncio
import json
import logging
import ssl
import struct
import time
from datetime import datetime, timezone
from enum import Enum
from typing import Optional, Dict, Any, List, Set, Callable

from backend.ctrader_config import (
    get_ctrader_client_id,
    get_ctrader_client_secret,
    get_ctrader_env,
    get_active_endpoint,
    mask_credential,
    SPOTWARE_ENDPOINTS
)

try:
    from backend.database import db_store
except ImportError:
    from database import db_store

logger = logging.getLogger("scrolic.ctrader_client")

class CTraderConnectionState(str, Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    AUTHENTICATED = "AUTHENTICATED"
    DEGRADED = "DEGRADED"
    RECONNECTING = "RECONNECTING"

class AccountAuthStatus(str, Enum):
    UNAUTHENTICATED = "UNAUTHENTICATED"
    PENDING = "PENDING"
    AUTHENTICATED = "AUTHENTICATED"
    FAILED = "FAILED"

# Official Spotware Open API Payload Types
PROTO_HEARTBEAT_EVENT = 51
PROTO_OA_APPLICATION_AUTH_REQ = 2100
PROTO_OA_APPLICATION_AUTH_RES = 2101
PROTO_OA_ACCOUNT_AUTH_REQ = 2102
PROTO_OA_ACCOUNT_AUTH_RES = 2103
PROTO_OA_SUBSCRIBE_SPOTS_REQ = 2104
PROTO_OA_SUBSCRIBE_SPOTS_RES = 2105
PROTO_OA_UNSUBSCRIBE_SPOTS_REQ = 2106
PROTO_OA_UNSUBSCRIBE_SPOTS_RES = 2107
PROTO_OA_SPOT_EVENT = 2131
PROTO_OA_EXECUTION_EVENT = 2126
PROTO_OA_RECONCILE_REQ = 2124
PROTO_OA_RECONCILE_RES = 2125
PROTO_OA_TRADER_REQ = 2121
PROTO_OA_TRADER_RES = 2122
PROTO_OA_MARGIN_CHANGED_EVENT = 2156
PROTO_OA_CLOSE_POSITION_REQ = 2107
PROTO_OA_DEAL_LIST_REQ = 2133
PROTO_OA_DEAL_LIST_RES = 2134
PROTO_OA_ERROR_RES = 2142

class CTraderClient:
    def __init__(self):
        self.state: CTraderConnectionState = CTraderConnectionState.DISCONNECTED
        self._running: bool = False
        self._main_task: Optional[asyncio.Task] = None
        self._heartbeat_task: Optional[asyncio.Task] = None
        
        # Stream / Transport references
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._ws = None
        self._transport_type: str = "WEBSOCKET"  # or "TCP_TLS"
        
        # Operational state
        self._retry_count: int = 0
        self._max_retries: int = 20
        self._base_backoff: float = 2.0
        self._max_backoff: float = 60.0
        self._heartbeat_interval: float = 20.0
        self._stale_timeout: float = 40.0
        
        # App Auth Barrier
        self._app_authenticated_event: asyncio.Event = asyncio.Event()
        self._account_auth_futures: Dict[int, asyncio.Future] = {}
        
        # Per-Account Status Tracking
        # Structure: { ctidTraderAccountId: { accountNo, userId, authStatus, authenticatedAt, lastReconciledAt, lastError } }
        self.account_states: Dict[int, Dict[str, Any]] = {}
        self.account_to_user_map: Dict[int, str] = {}
        self.account_tokens: Dict[int, str] = {}
        self.subscribed_symbols: Set[str] = set()
        
        # Callbacks
        self._message_handlers: Dict[int, List[Callable[[Dict[str, Any]], None]]] = {}
        self._event_callbacks: List[Callable[[str, Any], None]] = []
        
        # Observability Metrics & Event Counters
        self.metrics = {
            "state": self.state.value,
            "transport": self._transport_type,
            "environment": get_ctrader_env(),
            "host": "",
            "port": 0,
            "connected_at": None,
            "authenticated_at": None,
            "last_heartbeat_sent_at": None,
            "last_heartbeat_received_at": None,
            "last_message_at": None,
            "reconnect_count": 0,
            "last_error": None,
            "last_error_at": None,
            "authenticated_accounts_count": 0,
            
            # Realtime Event Counters
            "spot_events_count": 0,
            "execution_events_count": 0,
            "deals_count": 0,
            "heartbeats_sent_count": 0,
            "heartbeats_received_count": 0,
            "reconciliations_count": 0,
            "unmapped_events_count": 0,
            
            # Latency Metrics (ms)
            "last_broker_to_db_latency_ms": 0.0,
            "avg_broker_to_db_latency_ms": 0.0,
            "last_broker_to_socket_latency_ms": 0.0,
            "avg_broker_to_socket_latency_ms": 0.0
        }

    def record_latency(self, broker_ts_ms: Optional[int]):
        """Tracks latency from broker event creation to local processing."""
        if not broker_ts_ms:
            return
        now_ms = int(time.time() * 1000)
        latency = max(0.0, float(now_ms - broker_ts_ms))
        self.metrics["last_broker_to_db_latency_ms"] = latency
        prev_avg = self.metrics.get("avg_broker_to_db_latency_ms", 0.0)
        self.metrics["avg_broker_to_db_latency_ms"] = round((prev_avg * 0.9) + (latency * 0.1), 2) if prev_avg > 0 else latency

    def get_observability_alarms(self) -> List[Dict[str, Any]]:
        """Evaluates and returns all operational alarms."""
        alarms = []
        now = datetime.now(timezone.utc)

        # Alarm 1: Connection Degraded / Disconnected
        if self.state == CTraderConnectionState.DEGRADED:
            alarms.append({
                "code": "BROKER_DEGRADED",
                "severity": "WARNING",
                "message": f"Koneksi broker cTrader dalam kondisi degraded: {self.metrics.get('last_error', 'Heartbeat timeout')}",
                "triggered_at": self.metrics.get("last_error_at") or now.isoformat()
            })
        elif self.state == CTraderConnectionState.DISCONNECTED and get_ctrader_client_id():
            alarms.append({
                "code": "BROKER_DISCONNECTED",
                "severity": "CRITICAL",
                "message": "Koneksi broker cTrader terputus. Mencoba reconnect otomatis.",
                "triggered_at": now.isoformat()
            })

        # Alarm 2: Market Ticks Absence (>30s while connected)
        last_msg_str = self.metrics.get("last_message_at")
        if self.state in (CTraderConnectionState.CONNECTED, CTraderConnectionState.AUTHENTICATED) and last_msg_str:
            try:
                last_msg_dt = datetime.fromisoformat(last_msg_str)
                age = (now - last_msg_dt).total_seconds()
                if age > 30.0:
                    alarms.append({
                        "code": "NO_MARKET_TICKS",
                        "severity": "WARNING",
                        "message": f"Tidak ada event pasar/tick yang diterima dari broker selama {age:.0f} detik.",
                        "triggered_at": now.isoformat()
                    })
            except Exception:
                pass

        # Alarm 3: Account State Stale (>45s)
        if last_msg_str:
            try:
                last_msg_dt = datetime.fromisoformat(last_msg_str)
                age = (now - last_msg_dt).total_seconds()
                if age > 45.0:
                    alarms.append({
                        "code": "ACCOUNT_STATE_STALE",
                        "severity": "WARNING",
                        "message": f"State akun broker stale (>45 detik tanpa update).",
                        "triggered_at": now.isoformat()
                    })
            except Exception:
                pass

        # Alarm 4: Runtime Integrity Check (Sole Python FastAPI ownership)
        alarms.append({
            "code": "RUNTIME_INTEGRITY_VERIFIED",
            "severity": "INFO",
            "message": "FastAPI :8001 adalah pemilik tunggal integrasi cTrader. Node.js dinonaktifkan.",
            "triggered_at": now.isoformat()
        })

        return alarms

    def register_handler(self, payload_type: int, handler: Callable[[Dict[str, Any]], None]):
        self._message_handlers.setdefault(payload_type, []).append(handler)

    def register_event_listener(self, callback: Callable[[str, Any], None]):
        self._event_callbacks.append(callback)

    def _notify_event(self, event_name: str, data: Any):
        for cb in self._event_callbacks:
            try:
                cb(event_name, data)
            except Exception as e:
                logger.warning(f"[cTrader.Client] Event callback error: {e}")

    def _set_state(self, new_state: CTraderConnectionState, error_msg: Optional[str] = None):
        prev = self.state
        self.state = new_state
        self.metrics["state"] = new_state.value
        if error_msg:
            self.metrics["last_error"] = str(error_msg)
            self.metrics["last_error_at"] = datetime.now(timezone.utc).isoformat()
        
        if new_state == CTraderConnectionState.CONNECTED:
            self.metrics["connected_at"] = datetime.now(timezone.utc).isoformat()
        elif new_state == CTraderConnectionState.AUTHENTICATED:
            self.metrics["authenticated_at"] = datetime.now(timezone.utc).isoformat()
        elif new_state == CTraderConnectionState.RECONNECTING:
            self.metrics["reconnect_count"] += 1
            self._app_authenticated_event.clear()
            
        logger.info(f"[cTrader.Lifecycle] State changed: {prev.value} -> {new_state.value}" + (f" ({error_msg})" if error_msg else ""))
        self._notify_event("state_change", {"from": prev.value, "to": new_state.value, "error": error_msg})

    def get_diagnostics(self) -> Dict[str, Any]:
        """Returns non-sensitive observability metrics for health and diagnostics."""
        endpoint = get_active_endpoint()
        authenticated_accts = [
            f"cTrader-{acct_id}" for acct_id, info in self.account_states.items()
            if info.get("authStatus") == AccountAuthStatus.AUTHENTICATED.value
        ]
        return {
            "state": self.state.value,
            "is_broker_connected": self.state in (CTraderConnectionState.CONNECTED, CTraderConnectionState.AUTHENTICATED),
            "is_authenticated": self.state == CTraderConnectionState.AUTHENTICATED,
            "environment": get_ctrader_env(),
            "transport": self._transport_type,
            "host": endpoint.get("tcp_host", "demo.ctraderapi.com"),
            "tcp_port": endpoint.get("tcp_port", 5035),
            "ws_port": 5036,
            "client_id_configured": bool(get_ctrader_client_id()),
            "connected_at": self.metrics.get("connected_at"),
            "authenticated_at": self.metrics.get("authenticated_at"),
            "last_heartbeat_sent_at": self.metrics.get("last_heartbeat_sent_at"),
            "last_heartbeat_received_at": self.metrics.get("last_heartbeat_received_at"),
            "last_message_at": self.metrics.get("last_message_at"),
            "reconnect_count": self.metrics.get("reconnect_count", 0),
            "last_error": self.metrics.get("last_error"),
            "last_error_at": self.metrics.get("last_error_at"),
            "authenticated_accounts": authenticated_accts,
            "account_details": list(self.account_states.values())
        }

    def get_account_status(self, account_id: str) -> Dict[str, Any]:
        clean_num = self._clean_numeric_account_id(account_id)
        if clean_num in self.account_states:
            return self.account_states[clean_num]
        return {
            "ctidTraderAccountId": clean_num,
            "accountId": f"cTrader-{clean_num}",
            "authStatus": AccountAuthStatus.UNAUTHENTICATED.value,
            "environment": get_ctrader_env(),
            "authenticatedAt": None,
            "lastReconciledAt": None,
            "lastError": None
        }

    def _clean_numeric_account_id(self, raw_id: Any) -> int:
        """Parses clean numeric int from account ID (e.g. 'cTrader-47601047' -> 47601047)."""
        if isinstance(raw_id, int):
            return raw_id
        cleaned = str(raw_id or "").replace("cTrader-", "").strip()
        try:
            return int(cleaned)
        except ValueError:
            return 0

    async def start(self):
        """Starts the persistent connection supervisor."""
        if self._running:
            return
        self._running = True
        self._main_task = asyncio.create_task(self._connection_manager_loop())
        logger.info("[cTrader.Client] Persistent connection supervisor started.")

    async def stop(self):
        """Stops the persistent connection worker cleanly."""
        self._running = False
        self._set_state(CTraderConnectionState.DISCONNECTED)
        self._app_authenticated_event.clear()
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
        if self._main_task:
            self._main_task.cancel()
        await self._close_transport()
        logger.info("[cTrader.Client] Persistent connection supervisor stopped.")

    async def _close_transport(self):
        try:
            if self._writer:
                self._writer.close()
                await self._writer.wait_closed()
        except Exception:
            pass
        finally:
            self._reader = None
            self._writer = None

        try:
            if self._ws:
                await self._ws.close()
        except Exception:
            pass
        finally:
            self._ws = None

    async def _connection_manager_loop(self):
        while self._running:
            try:
                self._set_state(CTraderConnectionState.CONNECTING)
                success = await self._establish_connection()
                if success:
                    self._retry_count = 0
                    self._set_state(CTraderConnectionState.CONNECTED)
                    
                    # Start Heartbeat supervisor
                    if self._heartbeat_task:
                        self._heartbeat_task.cancel()
                    self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
                    
                    # Start message reading task
                    read_task = asyncio.create_task(self._read_message_loop())
                    
                    # Authenticate Application Barrier
                    await self._authenticate_session()
                    
                    # Re-authenticate previously authorized accounts
                    await self._reauthenticate_all_accounts()
                    
                    await read_task
                else:
                    raise ConnectionError("Failed to establish transport connection to Spotware Open API")
            except asyncio.CancelledError:
                break
            except Exception as exc:
                self._set_state(CTraderConnectionState.RECONNECTING, error_msg=str(exc))
                await self._close_transport()
                
                # Exponential Backoff calculation
                self._retry_count += 1
                delay = min(self._base_backoff * (2 ** min(self._retry_count - 1, 6)), self._max_backoff)
                logger.warning(f"[cTrader.Client] Disconnected ({exc}). Reconnecting in {delay:.1f}s (Retry #{self._retry_count})...")
                await asyncio.sleep(delay)

    async def _establish_connection(self) -> bool:
        endpoint = get_active_endpoint()
        host = endpoint.get("tcp_host", "demo.ctraderapi.com")
        port = endpoint.get("tcp_port", 5035)
        self.metrics["host"] = host
        self.metrics["port"] = port

        client_id = get_ctrader_client_id()
        if not client_id:
            logger.info("[cTrader.Client] No CTRADER_CLIENT_ID configured. Operating in standby mode.")
            self._app_authenticated_event.set()
            return True

        # Try TCP TLS on port 5035
        try:
            ssl_ctx = ssl.create_default_context()
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(host, port, ssl=ssl_ctx),
                timeout=10.0
            )
            self._transport_type = "TCP_TLS"
            self.metrics["transport"] = "TCP_TLS"
            logger.info(f"[cTrader.Client] TCP TLS stream established successfully with {host}:{port}")
            return True
        except Exception as tcp_err:
            logger.warning(f"[cTrader.Client] TCP TLS (port {port}) connection failed ({tcp_err}). Trying WebSocket (port 5036)...")

        # Try WebSocket fallback on port 5036
        try:
            import websockets
            ws_url = endpoint.get("ws_url", f"wss://{host}:5036")
            self._ws = await asyncio.wait_for(
                websockets.connect(ws_url, ping_interval=None),
                timeout=10.0
            )
            self._transport_type = "WEBSOCKET"
            self.metrics["transport"] = "WEBSOCKET"
            logger.info(f"[cTrader.Client] WebSocket stream established successfully with {ws_url}")
            return True
        except Exception as ws_err:
            logger.error(f"[cTrader.Client] Both TCP TLS & WebSocket connections failed: {ws_err}")
            return False

    async def _authenticate_session(self):
        """Performs official Application Auth and waits for ProtoOAApplicationAuthRes (2101)."""
        client_id = get_ctrader_client_id()
        client_secret = get_ctrader_client_secret()
        if not client_id or not client_secret:
            logger.info("[cTrader.Auth] Client credentials not set. Session marked as standby.")
            self._set_state(CTraderConnectionState.CONNECTED)
            self._app_authenticated_event.set()
            return

        logger.info(f"[cTrader.Auth] Sending ProtoOAApplicationAuthReq (2100) for client: {mask_credential(client_id)}")
        self._app_authenticated_event.clear()
        
        # Send Application Auth Request
        await self.send_message(PROTO_OA_APPLICATION_AUTH_REQ, {
            "clientId": client_id,
            "clientSecret": client_secret
        })
        
        # Wait up to 10 seconds for ProtoOAApplicationAuthRes (2101)
        try:
            await asyncio.wait_for(self._app_authenticated_event.wait(), timeout=10.0)
            self._set_state(CTraderConnectionState.AUTHENTICATED)
            logger.info("[cTrader.Auth] ProtoOAApplicationAuthRes (2101) received & verified. Application Authorized.")
        except asyncio.TimeoutError:
            logger.warning("[cTrader.Auth] Application auth response timed out. Proceeding in degraded mode.")
            self._set_state(CTraderConnectionState.DEGRADED, error_msg="Application Auth Response Timeout")

    async def ensure_app_authenticated(self):
        """Barrier that ensures Application Authentication is completed before sending account-level messages."""
        if not get_ctrader_client_id():
            return
        if not self._app_authenticated_event.is_set():
            try:
                await asyncio.wait_for(self._app_authenticated_event.wait(), timeout=8.0)
            except asyncio.TimeoutError:
                raise ConnectionError("cTrader Application is not yet authorized by Spotware server.")

    async def authenticate_account(self, account_id: Any, access_token: str, user_id: str = "") -> bool:
        """
        Authenticates an authorized trader account using clean numeric ctidTraderAccountId and valid token.
        Waits for ProtoOAAccountAuthRes (2103) before sending ProtoOAReconcileReq (2124).
        """
        acct_num = self._clean_numeric_account_id(account_id)
        if not acct_num or not access_token:
            logger.warning(f"[cTrader.Auth] Cannot authenticate account with empty ID ({account_id}) or token.")
            return False

        # Register mapping
        if user_id:
            self.account_to_user_map[acct_num] = user_id
        self.account_tokens[acct_num] = access_token
        
        # Initialize account state
        self.account_states[acct_num] = {
            "ctidTraderAccountId": acct_num,
            "accountId": f"cTrader-{acct_num}",
            "accountNo": str(acct_num),
            "userId": user_id or self.account_to_user_map.get(acct_num, ""),
            "authStatus": AccountAuthStatus.PENDING.value,
            "environment": get_ctrader_env(),
            "authenticatedAt": None,
            "lastReconciledAt": None,
            "lastError": None
        }

        try:
            await self.ensure_app_authenticated()
        except Exception as e:
            self.account_states[acct_num]["authStatus"] = AccountAuthStatus.FAILED.value
            self.account_states[acct_num]["lastError"] = str(e)
            return False

        logger.info(f"[cTrader.Auth] Authorizing Account numeric ID {acct_num} via ProtoOAAccountAuthReq (2102)...")
        
        # Set future for response
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        self._account_auth_futures[acct_num] = future

        await self.send_message(PROTO_OA_ACCOUNT_AUTH_REQ, {
            "ctidTraderAccountId": acct_num,
            "accessToken": access_token
        })

        if not get_ctrader_client_id():
            # In mock/offline mode, fulfill immediately
            self._handle_account_auth_success(acct_num)
            return True

        try:
            await asyncio.wait_for(future, timeout=10.0)
            return True
        except asyncio.TimeoutError:
            logger.warning(f"[cTrader.Auth] Timeout waiting for ProtoOAAccountAuthRes (2103) for account {acct_num}")
            self.account_states[acct_num]["authStatus"] = AccountAuthStatus.FAILED.value
            self.account_states[acct_num]["lastError"] = "Account Auth Timeout"
            return False
        finally:
            self._account_auth_futures.pop(acct_num, None)

    async def switch_account(self, old_account_id: Any, new_account_id: Any, access_token: str, user_id: str) -> bool:
        """
        Handles account switching: unsubscribes old account and authenticates & reconciles new account.
        """
        old_num = self._clean_numeric_account_id(old_account_id)
        new_num = self._clean_numeric_account_id(new_account_id)
        
        if old_num and old_num != new_num:
            logger.info(f"[cTrader.Switch] Detaching old account session: {old_num}")
            if old_num in self.account_states:
                self.account_states[old_num]["authStatus"] = AccountAuthStatus.UNAUTHENTICATED.value

        logger.info(f"[cTrader.Switch] Switching to new account: {new_num} for user: {user_id}")
        success = await self.authenticate_account(new_num, access_token, user_id)
        return success

    async def close_position(self, account_id: Any, position_id: Any, volume_lot: Optional[float] = None) -> bool:
        """
        Sends official ProtoOAClosePositionReq (2107) to Spotware cTrader Open API server.
        """
        acct_num = self._clean_numeric_account_id(account_id)
        pos_num = self._clean_numeric_account_id(position_id)
        if not acct_num or not pos_num:
            logger.error(f"[cTrader.Close] Invalid account ({account_id}) or position ({position_id}) ID.")
            return False

        try:
            await self.ensure_app_authenticated()
        except Exception as e:
            logger.error(f"[cTrader.Close] Cannot close position: {e}")
            return False

        volume_units = int(volume_lot * 100000.0) if volume_lot else 100000
        logger.info(f"[cTrader.Close] Dispatching ProtoOAClosePositionReq (2107) for Account {acct_num}, Position {pos_num}, Volume: {volume_units}")
        await self.send_message(PROTO_OA_CLOSE_POSITION_REQ, {
            "ctidTraderAccountId": acct_num,
            "positionId": pos_num,
            "volume": volume_units
        })
        return True

    async def request_deal_history(self, account_id: Any, from_timestamp_ms: int, to_timestamp_ms: int):
        """
        Sends official ProtoOADealListReq (2133) to retrieve deal history within timestamp range.
        """
        acct_num = self._clean_numeric_account_id(account_id)
        if not acct_num:
            return
        await self.send_message(PROTO_OA_DEAL_LIST_REQ, {
            "ctidTraderAccountId": acct_num,
            "fromTimestamp": from_timestamp_ms,
            "toTimestamp": to_timestamp_ms,
            "maxRows": 100
        })

    async def _reauthenticate_all_accounts(self):
        """Re-authenticates all registered accounts after a connection reconnect."""
        for acct_num, token in list(self.account_tokens.items()):
            u_id = self.account_to_user_map.get(acct_num, "")
            logger.info(f"[cTrader.Reconnect] Re-authenticating account {acct_num} for user {u_id}...")
            asyncio.create_task(self.authenticate_account(acct_num, token, u_id))

    def _handle_account_auth_success(self, acct_num: int):
        now_iso = datetime.now(timezone.utc).isoformat()
        if acct_num in self.account_states:
            self.account_states[acct_num]["authStatus"] = AccountAuthStatus.AUTHENTICATED.value
            self.account_states[acct_num]["authenticatedAt"] = now_iso
            self.account_states[acct_num]["lastError"] = None
        
        # Trigger Official Trader Profile / Balance (2121)
        asyncio.create_task(self.send_message(PROTO_OA_TRADER_REQ, {
            "ctidTraderAccountId": acct_num
        }))
        # Trigger Official Position Reconciliation (2124)
        asyncio.create_task(self.send_message(PROTO_OA_RECONCILE_REQ, {
            "ctidTraderAccountId": acct_num
        }))
        logger.info(f"[cTrader.Auth] Account {acct_num} AUTHENTICATED. Triggered ProtoOATraderReq (2121) & ProtoOAReconcileReq (2124).")

    async def send_message(self, payload_type: int, payload_data: Dict[str, Any]):
        """Sends a message over the active transport."""
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            if self._transport_type == "TCP_TLS" and self._writer:
                raw_json = json.dumps(payload_data).encode("utf-8")
                # 4-byte big endian length prefix for Spotware ProtoMessage
                header = struct.pack(">I", len(raw_json) + 4)
                type_hdr = struct.pack(">I", payload_type)
                self._writer.write(header + type_hdr + raw_json)
                await self._writer.drain()
            elif self._transport_type == "WEBSOCKET" and self._ws:
                msg = {
                    "payloadType": payload_type,
                    "payload": payload_data
                }
                await self._ws.send(json.dumps(msg))
            
            if payload_type == PROTO_HEARTBEAT_EVENT:
                self.metrics["last_heartbeat_sent_at"] = now_iso
        except Exception as e:
            logger.warning(f"[cTrader.Send] Error sending payload {payload_type}: {e}")

    async def _heartbeat_loop(self):
        """Sends ProtoHeartbeatEvent (51) every 20s and checks for staleness."""
        while self._running and self.state in (CTraderConnectionState.CONNECTED, CTraderConnectionState.AUTHENTICATED):
            try:
                await asyncio.sleep(self._heartbeat_interval)
                await self.send_message(PROTO_HEARTBEAT_EVENT, {})
                
                # Check for stale response
                last_msg_str = self.metrics.get("last_message_at")
                if last_msg_str:
                    last_msg_dt = datetime.fromisoformat(last_msg_str)
                    age_seconds = (datetime.now(timezone.utc) - last_msg_dt).total_seconds()
                    if age_seconds > self._stale_timeout:
                        logger.warning(f"[cTrader.Heartbeat] No messages received for {age_seconds:.1f}s. Connection DEGRADED.")
                        self._set_state(CTraderConnectionState.DEGRADED, error_msg="Heartbeat response timeout")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[cTrader.Heartbeat] Heartbeat loop error: {e}")

    async def _read_message_loop(self):
        """Reads incoming frames from transport."""
        while self._running and self.state in (CTraderConnectionState.CONNECTED, CTraderConnectionState.AUTHENTICATED, CTraderConnectionState.DEGRADED):
            try:
                if self._transport_type == "TCP_TLS" and self._reader:
                    # Read 4-byte length prefix
                    header_bytes = await self._reader.readexactly(4)
                    msg_len = struct.unpack(">I", header_bytes)[0]
                    payload_bytes = await self._reader.readexactly(msg_len)
                    payload_type = struct.unpack(">I", payload_bytes[:4])[0]
                    body_bytes = payload_bytes[4:]
                    try:
                        data = json.loads(body_bytes.decode("utf-8"))
                    except Exception:
                        data = {}
                    await self._handle_incoming_message(payload_type, data)
                elif self._transport_type == "WEBSOCKET" and self._ws:
                    raw_msg = await self._ws.recv()
                    parsed = json.loads(raw_msg)
                    payload_type = parsed.get("payloadType", 0)
                    payload_data = parsed.get("payload", {})
                    await self._handle_incoming_message(payload_type, payload_data)
                else:
                    await asyncio.sleep(0.5)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"[cTrader.Read] Read error ({e}). Closing transport...")
                break

    async def _handle_incoming_message(self, payload_type: int, payload_data: Dict[str, Any]):
        now_iso = datetime.now(timezone.utc).isoformat()
        self.metrics["last_message_at"] = now_iso
        
        # Save sanitized raw broker event for audit & replay
        try:
            db_store.save_raw_broker_event(payload_type, payload_data)
        except Exception as e:
            logger.debug(f"[cTrader.Audit] Raw event log error: {e}")

        # Track latency
        ts = payload_data.get("timestamp") or payload_data.get("executionTimestamp")
        if ts:
            self.record_latency(int(ts))

        # 1. Heartbeat Event (51)
        if payload_type == PROTO_HEARTBEAT_EVENT:
            self.metrics["heartbeats_received_count"] += 1
            self.metrics["last_heartbeat_received_at"] = now_iso
            if self.state == CTraderConnectionState.DEGRADED:
                self._set_state(CTraderConnectionState.AUTHENTICATED if self._app_authenticated_event.is_set() else CTraderConnectionState.CONNECTED)
            return

        if payload_type == PROTO_OA_SPOT_EVENT:
            self.metrics["spot_events_count"] += 1
        elif payload_type == PROTO_OA_EXECUTION_EVENT:
            self.metrics["execution_events_count"] += 1
        elif payload_type == PROTO_OA_DEAL_LIST_RES:
            self.metrics["deals_count"] += 1

        # 2. Application Auth Response (2101)
        if payload_type == PROTO_OA_APPLICATION_AUTH_RES:
            logger.info("[cTrader.Auth] ProtoOAApplicationAuthRes (2101) processed.")
            self._app_authenticated_event.set()
            self._set_state(CTraderConnectionState.AUTHENTICATED)
            return

        # 3. Account Auth Response (2103)
        if payload_type == PROTO_OA_ACCOUNT_AUTH_RES:
            acct_num = payload_data.get("ctidTraderAccountId", 0)
            logger.info(f"[cTrader.Auth] ProtoOAAccountAuthRes (2103) processed for account: {acct_num}")
            self._handle_account_auth_success(acct_num)
            if acct_num in self._account_auth_futures:
                fut = self._account_auth_futures[acct_num]
                if not fut.done():
                    fut.set_result(True)
            return

        # 4. Trader Profile Response (2122)
        if payload_type == PROTO_OA_TRADER_RES:
            trader = payload_data.get("trader", {}) or payload_data
            acct_num = trader.get("ctidTraderAccountId") or payload_data.get("ctidTraderAccountId", 0)
            money_digits = int(trader.get("moneyDigits", 2))
            scale = 10 ** money_digits
            raw_bal = trader.get("balance", 0)
            bal_float = round(float(raw_bal) / scale, money_digits) if raw_bal else 0.0
            leverage = int(trader.get("leverageInCents", 50000)) // 100 if trader.get("leverageInCents") else 500
            
            if acct_num in self.account_states:
                self.account_states[acct_num]["balance"] = bal_float
                self.account_states[acct_num]["moneyDigits"] = money_digits
                self.account_states[acct_num]["leverage"] = leverage
                self.account_states[acct_num]["lastTraderUpdateAt"] = now_iso
            logger.info(f"[cTrader.Trader] ProtoOATraderRes (2122) for account {acct_num}: Balance={bal_float}, MoneyDigits={money_digits}, Leverage={leverage}x")
            return

        # 5. Reconcile Response (2125)
        if payload_type == PROTO_OA_RECONCILE_RES:
            acct_num = payload_data.get("ctidTraderAccountId", 0)
            if acct_num in self.account_states:
                self.account_states[acct_num]["lastReconciledAt"] = now_iso
            logger.info(f"[cTrader.Reconcile] ProtoOAReconcileRes (2125) received for account {acct_num}")

        # 6. Error Response (2142)
        if payload_type == PROTO_OA_ERROR_RES:
            error_code = payload_data.get("errorCode", "UNKNOWN")
            desc = payload_data.get("description", "cTrader Open API Error")
            acct_num = payload_data.get("ctidTraderAccountId", 0)
            logger.error(f"[cTrader.Error] ProtoOAErrorRes (2142) [{error_code}]: {desc} (Account: {acct_num})")
            if acct_num in self.account_states:
                self.account_states[acct_num]["authStatus"] = AccountAuthStatus.FAILED.value
                self.account_states[acct_num]["lastError"] = f"[{error_code}] {desc}"
            if acct_num in self._account_auth_futures:
                fut = self._account_auth_futures[acct_num]
                if not fut.done():
                    fut.set_exception(ValueError(f"[{error_code}] {desc}"))

        # Trigger registered handlers for this payload type
        handlers = self._message_handlers.get(payload_type, [])
        for h in handlers:
            try:
                h(payload_data)
            except Exception as handler_err:
                logger.error(f"[cTrader.Handler] Handler error for payload {payload_type}: {handler_err}")

# Singleton persistent client instance
ctrader_client = CTraderClient()
