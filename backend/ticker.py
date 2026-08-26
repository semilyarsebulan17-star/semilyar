"""
cTrader Open API v2 Realtime Market Data, Spot Pricing & Position Reconciliation Engine
Single Runtime Owner: Python FastAPI (:8001)
================================================================================
Spec & Official Spotware Open API v2 Protocol:
- Dynamic Symbol Metadata Registry (ProtoOASymbolsListRes 2115 & ProtoOASymbolByIdRes 2117)
- Official Price Subscriptions (ProtoOASubscribeSpotsReq 2104)
- Live Spot Streaming (ProtoOASpotEvent 2131) with strict Bid/Ask side valuation
- Official Position Reconciliation (ProtoOAReconcileReq 2124 & ProtoOAReconcileRes 2125)
- Canonical Entity Mapping: accountId -> positionId -> postId -> tradeId
- Strict Deduplication by (accountId, positionId)
"""

import asyncio
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List, Set

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

try:
    from backend.database import db_store, ensure_utc
except ImportError:
    from database import db_store, ensure_utc

try:
    from backend.ctrader_client import (
        ctrader_client,
        PROTO_OA_SUBSCRIBE_SPOTS_REQ,
        PROTO_OA_SPOT_EVENT,
        PROTO_OA_EXECUTION_EVENT,
        PROTO_OA_RECONCILE_RES,
        PROTO_OA_TRADER_RES
    )
except ImportError:
    from ctrader_client import (
        ctrader_client,
        PROTO_OA_SUBSCRIBE_SPOTS_REQ,
        PROTO_OA_SPOT_EVENT,
        PROTO_OA_EXECUTION_EVENT,
        PROTO_OA_RECONCILE_RES,
        PROTO_OA_TRADER_RES
    )

try:
    from backend.event_contract import event_contract_manager
except ImportError:
    from event_contract import event_contract_manager

logger = logging.getLogger("scrolic.ctrader_engine")

class SymbolRegistry:
    """Dynamic Symbol Metadata Registry loaded and cached from Spotware Open API."""
    def __init__(self):
        # Baseline reference metadata (augmented dynamically by ProtoOASymbolsListRes & ProtoOASymbolByIdRes)
        self._symbols_by_id: Dict[int, Dict[str, Any]] = {
            1: {"symbolId": 1, "name": "EURUSD", "digits": 5, "pipPosition": 4, "lotUnits": 100000.0, "market": "Forex", "base": "EUR", "quote": "USD"},
            2: {"symbolId": 2, "name": "GBPUSD", "digits": 5, "pipPosition": 4, "lotUnits": 100000.0, "market": "Forex", "base": "GBP", "quote": "USD"},
            3: {"symbolId": 3, "name": "EURJPY", "digits": 3, "pipPosition": 2, "lotUnits": 100000.0, "market": "Forex", "base": "EUR", "quote": "JPY"},
            4: {"symbolId": 4, "name": "USDJPY", "digits": 3, "pipPosition": 2, "lotUnits": 100000.0, "market": "Forex", "base": "USD", "quote": "JPY"},
            41: {"symbolId": 41, "name": "XAUUSD", "digits": 2, "pipPosition": 1, "lotUnits": 100.0, "market": "Commodity", "base": "XAU", "quote": "USD"},
            22396: {"symbolId": 22396, "name": "BTCUSD", "digits": 2, "pipPosition": 0, "lotUnits": 1.0, "market": "Crypto", "base": "BTC", "quote": "USD"},
            22397: {"symbolId": 22397, "name": "ETHUSD", "digits": 2, "pipPosition": 1, "lotUnits": 1.0, "market": "Crypto", "base": "ETH", "quote": "USD"}
        }
        self._symbols_by_name: Dict[str, Dict[str, Any]] = {
            v["name"]: v for v in self._symbols_by_id.values()
        }

    def register_symbol_metadata(self, symbol_id: int, name: str, digits: int = 5, pip_position: int = 4, lot_units: float = 100000.0, market: str = "Forex", base: str = "", quote: str = ""):
        data = {
            "symbolId": symbol_id,
            "name": name.upper(),
            "digits": digits,
            "pipPosition": pip_position,
            "lotUnits": lot_units,
            "market": market,
            "base": base,
            "quote": quote
        }
        self._symbols_by_id[symbol_id] = data
        self._symbols_by_name[name.upper()] = data

    def resolve(self, symbol_id: Optional[int] = None, symbol_name: Optional[str] = None) -> Dict[str, Any]:
        if symbol_id and symbol_id in self._symbols_by_id:
            return self._symbols_by_id[symbol_id]
        if symbol_name:
            clean = symbol_name.upper().strip()
            if clean in self._symbols_by_name:
                return self._symbols_by_name[clean]
            # Rule based heuristic for dynamic resolution
            if "XAU" in clean or "GOLD" in clean:
                return {"symbolId": symbol_id or 41, "name": "XAUUSD", "digits": 2, "pipPosition": 1, "lotUnits": 100.0, "market": "Commodity"}
            elif "BTC" in clean:
                return {"symbolId": symbol_id or 22396, "name": "BTCUSD", "digits": 2, "pipPosition": 0, "lotUnits": 1.0, "market": "Crypto"}
            elif "JPY" in clean:
                return {"symbolId": symbol_id or 4, "name": clean, "digits": 3, "pipPosition": 2, "lotUnits": 100000.0, "market": "Forex"}
            else:
                return {"symbolId": symbol_id or 1, "name": clean, "digits": 5, "pipPosition": 4, "lotUnits": 100000.0, "market": "Forex"}
        return {"symbolId": 1, "name": "EURUSD", "digits": 5, "pipPosition": 4, "lotUnits": 100000.0, "market": "Forex"}

symbol_registry = SymbolRegistry()

def calculate_pips(side: str, entry: float, current_bid: float, current_ask: float, pip_size: float) -> float:
    if pip_size <= 0:
        pip_size = 0.0001
    side_upper = str(side).upper()
    # BUY valuation uses BID (selling back to market)
    if side_upper in ["BUY", "1", "LONG"]:
        return round((current_bid - entry) / pip_size, 1)
    # SELL valuation uses ASK (buying back from market)
    else:
        return round((entry - current_ask) / pip_size, 1)

def calculate_position_progress(side: str, entry: float, current: float, sl: float, tp: float, pips: float) -> int:
    side_upper = str(side).upper()
    is_buy = side_upper in ["BUY", "1", "LONG"]

    if tp > 0 and entry > 0:
        if is_buy and tp > entry:
            pct = ((current - entry) / (tp - entry)) * 100.0
            return max(0, min(100, int(pct)))
        elif not is_buy and entry > tp:
            pct = ((entry - current) / (entry - tp)) * 100.0
            return max(0, min(100, int(pct)))

    base_progress = 50 + int(pips * 0.5)
    return max(0, min(100, base_progress))

class CTraderPositionService:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self.sio = None
        
        # Realtime market prices from ProtoOASpotEvent: { symbol: { bid, ask, timestamp } }
        self.market_prices: Dict[str, Dict[str, Any]] = {}
        self.subscribed_symbols: Set[int] = {1, 2, 3, 4, 41, 22396}

        # Deal tracking idempotency & cursor state
        self.processed_deal_ids: Set[str] = set()
        self.last_deal_cursor: Dict[int, int] = {}

        # Hook into persistent ctrader_client handlers
        ctrader_client.register_handler(PROTO_OA_SPOT_EVENT, self.handle_spot_event)
        ctrader_client.register_handler(PROTO_OA_EXECUTION_EVENT, self.handle_execution_event)
        ctrader_client.register_handler(PROTO_OA_RECONCILE_RES, self.handle_reconcile_event)
        ctrader_client.register_handler(PROTO_OA_TRADER_RES, self.handle_trader_event)

    def set_sio(self, sio_instance):
        self.sio = sio_instance

    def subscribe_symbol(self, ctid_account_id: int, symbol_id: int):
        """Sends official ProtoOASubscribeSpotsReq (2104)."""
        self.subscribed_symbols.add(symbol_id)
        asyncio.create_task(ctrader_client.send_message(PROTO_OA_SUBSCRIBE_SPOTS_REQ, {
            "ctidTraderAccountId": ctid_account_id,
            "symbolId": [symbol_id],
            "subscribeToSpotTimestamp": True
        }))

    def handle_spot_event(self, event_data: Dict[str, Any]):
        """
        Handles official ProtoOASpotEvent (2131) from Spotware server.
        Parses live bid/ask prices and updates open positions.
        """
        try:
            symbol_id = event_data.get("symbolId")
            meta = symbol_registry.resolve(symbol_id=symbol_id)
            symbol_name = meta["name"]
            digits = meta.get("digits", 5)

            raw_bid = event_data.get("bid")
            raw_ask = event_data.get("ask")
            ts = event_data.get("timestamp") or int(time.time() * 1000)

            # Spotware price scaling
            if raw_bid is not None:
                bid_val = float(raw_bid) / (10 ** digits) if raw_bid > 10000 else float(raw_bid)
            else:
                bid_val = self.market_prices.get(symbol_name, {}).get("bid", 0.0)

            if raw_ask is not None:
                ask_val = float(raw_ask) / (10 ** digits) if raw_ask > 10000 else float(raw_ask)
            else:
                ask_val = self.market_prices.get(symbol_name, {}).get("ask", bid_val + (10 ** (-meta["pipPosition"]) * 0.2))

            if bid_val <= 0:
                return

            self.market_prices[symbol_name] = {
                "bid": bid_val,
                "ask": ask_val,
                "timestamp": ts
            }

            # Update all open posts for this symbol
            open_posts = [p for p in db_store.posts if p.get("status") == "OPEN" and p.get("symbol") == symbol_name]
            for post in open_posts:
                payload = self.compute_position_payload(post, bid_price=bid_val, ask_price=ask_val)
                if payload and self.sio:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        loop.create_task(self.emit_position_update(payload))
        except Exception as exc:
            logger.error(f"[cTrader.Spot] handle_spot_event error: {exc}")

    def handle_reconcile_event(self, event_data: Dict[str, Any]):
        """
        Handles official ProtoOAReconcileRes (2125) from Spotware server.
        Synchronizes broker open positions into database feed.
        """
        try:
            acct_num = event_data.get("ctidTraderAccountId")
            user_id = ctrader_client.account_to_user_map.get(acct_num, "user-alex")
            positions = event_data.get("position", [])
            logger.info(f"[cTrader.Reconcile] Reconciling {len(positions)} active positions for account {acct_num} (User: {user_id})")

            reconciled_position_ids: Set[str] = set()

            for pos in positions:
                pos_id = str(pos.get("positionId"))
                reconciled_position_ids.add(pos_id)
                symbol_id = pos.get("symbolId")
                meta = symbol_registry.resolve(symbol_id=symbol_id, symbol_name=pos.get("symbolName"))
                symbol = meta["name"]
                
                # Ensure spot subscription is active for this symbol
                if symbol_id:
                    self.subscribe_symbol(acct_num, symbol_id)

                side_raw = str(pos.get("tradeSide", "BUY")).upper()
                trade_side = "BUY" if side_raw in ["BUY", "1", "LONG"] else "SELL"
                
                vol_raw = float(pos.get("volume", 100000))
                lot = round(vol_raw / 100000.0, 2)
                entry = float(pos.get("price") or 0.0)
                sl = float(pos.get("stopLoss") or 0.0)
                tp = float(pos.get("takeProfit") or 0.0)
                swap = float(pos.get("swap", 0.0))
                commission = float(pos.get("commission", 0.0))

                canonical_post_id = f"post-ctrader-{acct_num}-{pos_id}"

                # Persist Normalized Position (Key: {accountId}_{positionId})
                db_store.upsert_broker_position(acct_num, pos_id, pos)

                # Strict Deduplication: search by (account_id, position_id)
                existing = next((
                    p for p in db_store.posts
                    if (p.get("trade_id") == pos_id and str(p.get("account_id", "")).endswith(str(acct_num))) or p.get("id") == canonical_post_id
                ), None)

                if not existing:
                    user = db_store.find_user_by_id_or_username(user_id) or {}
                    new_post_dict = {
                        "id": canonical_post_id,
                        "user_id": user_id,
                        "username": user.get("username", "alex_trader"),
                        "avatar": user.get("avatar", "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80"),
                        "account_id": f"cTrader-{acct_num}",
                        "trade_id": pos_id,
                        "symbol": symbol,
                        "market": meta["market"],
                        "strategy_id": "breakout",
                        "position_type": trade_side,
                        "status": "OPEN",
                        "entry_price": entry,
                        "current_price": entry,
                        "stop_loss": sl if sl > 0 else None,
                        "take_profit": tp if tp > 0 else None,
                        "progress": 50,
                        "profit": swap + commission,
                        "profit_percent": 0.0,
                        "lot": lot,
                        "pips": 0.0,
                        "source": "broker_ctrader",
                        "is_simulation": False,
                        "duration": "Live OP",
                        "opened_at": datetime.now(timezone.utc),
                        "visibility": "LOCKED",
                        "unlock_price": 1,
                        "follow_price": 1,
                        "auto_description": f"⚡ Posisi Broker cTrader: {trade_side} {lot} Lot {symbol} @ {entry}",
                        "custom_description": "Eksekusi Realtime cTrader Broker Feed"
                    }
                    created = db_store.create_post(new_post_dict)
                    logger.info(f"[cTrader.Reconcile] Created reconciled post: {created['id']} for {symbol}")
                    if self.sio:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            loop.create_task(self.sio.emit("feed:new_post", created))
                else:
                    # Update existing open position
                    db_store.update_post(existing["id"], {
                        "entry_price": entry,
                        "stop_loss": sl if sl > 0 else None,
                        "take_profit": tp if tp > 0 else None,
                        "lot": lot,
                        "updated_at": datetime.now(timezone.utc)
                    })

            # Record Reconciliation Audit Log
            db_store.record_reconciliation_audit(acct_num, {
                "reconciled_positions_count": len(positions),
                "reconciled_position_ids": list(reconciled_position_ids),
                "account_id": f"cTrader-{acct_num}",
                "user_id": user_id
            })
        except Exception as exc:
            logger.error(f"[cTrader.Reconcile] handle_reconcile_event error: {exc}", exc_info=True)

    def handle_trader_event(self, event_data: Dict[str, Any]):
        """Persists broker account metrics and publishes the private account snapshot."""
        try:
            trader = event_data.get("trader", {}) or event_data
            acct_num = int(trader.get("ctidTraderAccountId") or event_data.get("ctidTraderAccountId") or 0)
            if not acct_num:
                return
            account_state = ctrader_client.account_states.get(acct_num, {})
            user_id = ctrader_client.account_to_user_map.get(acct_num) or account_state.get("userId")
            if user_id:
                user = db_store.find_user_by_id_or_username(user_id)
                if user:
                    accounts = user.get("ctrader_accounts") or []
                    account_id = f"cTrader-{acct_num}"
                    for account in accounts:
                        if account.get("accountId") == account_id:
                            account["balance"] = account_state.get("balance", account.get("balance", 0.0))
                            account["leverage"] = account_state.get("leverage", account.get("leverage", 500))
                            account["currency"] = account_state.get("currency", account.get("currency", "USD"))
                    db_store.update_user(user.get("id") or user.get("username"), {"ctrader_accounts": accounts})
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.emit_account_update(f"cTrader-{acct_num}"))
        except Exception as exc:
            logger.error(f"[cTrader.Trader] handle_trader_event error: {exc}", exc_info=True)

    def handle_execution_event(self, event_data: Dict[str, Any]):
        """
        Handles official ProtoOAExecutionEvent (2126) from Spotware server.
        Distinguishes ORDER_ACCEPTED (1), ORDER_FILLED (2), ORDER_REJECTED (5),
        ORDER_REPLACED (6), ORDER_PARTIAL_FILL (8), POSITION_CLOSED (12).
        """
        try:
            exec_type = int(event_data.get("executionType", 2))
            acct_num = event_data.get("ctidTraderAccountId", 0)
            pos = event_data.get("position", {}) or {}
            deal = event_data.get("deal", {}) or {}
            order = event_data.get("order", {}) or {}

            pos_id = str(pos.get("positionId") or deal.get("positionId") or order.get("positionId") or "")
            if not pos_id:
                logger.warning(f"[cTrader.Execution] Missing broker positionId in execution event. Skipping.")
                return

            canonical_post_id = f"post-ctrader-{acct_num}-{pos_id}"

            # Strict Deduplication Lookup by (account_id, position_id)
            existing_post = next((
                p for p in db_store.posts
                if (p.get("trade_id") == pos_id and str(p.get("account_id", "")).endswith(str(acct_num))) or p.get("id") == canonical_post_id
            ), None)

            # Update deal cursor timestamp
            deal_ts = int(deal.get("executionTimestamp") or event_data.get("timestamp") or time.time() * 1000)
            if acct_num:
                self.last_deal_cursor[acct_num] = max(self.last_deal_cursor.get(acct_num, 0), deal_ts)

            # Case A: Order Modification / SL-TP Amend (ORDER_REPLACED = 6)
            if exec_type == 6 and existing_post:
                sl = float(pos.get("stopLoss") or 0.0)
                tp = float(pos.get("takeProfit") or 0.0)
                db_store.update_post(existing_post["id"], {
                    "stop_loss": sl if sl > 0 else None,
                    "take_profit": tp if tp > 0 else None,
                    "updated_at": datetime.now(timezone.utc)
                })
                logger.info(f"[cTrader.Execution] Order modified for position {pos_id}: SL={sl}, TP={tp}")
                return

            # Case B: Order Rejected (ORDER_REJECTED = 5 / ORDER_CANCEL_REJECTED = 11)
            if exec_type in (5, 11) and existing_post:
                err_code = event_data.get("errorCode", "REJECTED")
                err_desc = event_data.get("description", "Broker rejected order execution")
                db_store.update_post(existing_post["id"], {
                    "last_error": f"[{err_code}] {err_desc}",
                    "updated_at": datetime.now(timezone.utc)
                })
                logger.warning(f"[cTrader.Execution] Position {pos_id} execution rejected: {err_code} - {err_desc}")
                return

            # Case C: Position Closed or Partially Closed
            # Triggered when executionType == 12 (POSITION_CLOSED) or deal contains closePositionDetail
            is_closing_deal = bool(deal.get("closePositionDetail") or exec_type == 12 or pos.get("positionStatus") == "POSITION_STATUS_CLOSED")
            
            if is_closing_deal and existing_post:
                deal_id = str(deal.get("dealId") or f"deal-{pos_id}-{deal_ts}")
                
                # Idempotency check for deal processing
                if deal_id in self.processed_deal_ids:
                    logger.info(f"[cTrader.Execution] Deal {deal_id} already processed. Skipping duplicate.")
                    return
                self.processed_deal_ids.add(deal_id)

                close_price = float(deal.get("executionPrice") or pos.get("price") or existing_post.get("current_price", 0.0))
                realized_profit = float(deal.get("grossProfit") or deal.get("netProfit") or 0.0)
                if realized_profit != 0.0 and abs(realized_profit) > 1000:
                    realized_profit = round(realized_profit / 100.0, 2)
                
                swap = round(float(deal.get("swap", 0.0)) / 100.0, 2) if deal.get("swap") else 0.0
                commission = round(float(deal.get("commission", 0.0)) / 100.0, 2) if deal.get("commission") else 0.0
                
                remaining_volume = float(pos.get("volume", 0.0)) if pos else 0.0
                
                # Partial Close check
                if remaining_volume > 0 and exec_type == 8:
                    remaining_lot = round(remaining_volume / 100000.0, 2)
                    db_store.update_post(existing_post["id"], {
                        "lot": remaining_lot,
                        "profit": round(float(existing_post.get("profit", 0.0)) + realized_profit, 2),
                        "updated_at": datetime.now(timezone.utc)
                    })
                    logger.info(f"[cTrader.Execution] Partial close for position {pos_id}: remaining {remaining_lot} lots")
                else:
                    # Full Close confirmed by broker
                    closed_at_dt = datetime.fromtimestamp(deal_ts / 1000, tz=timezone.utc)
                    db_store.update_post(existing_post["id"], {
                        "status": "CLOSED",
                        "current_price": close_price,
                        "profit": realized_profit + swap + commission,
                        "closed_at": closed_at_dt,
                        "updated_at": datetime.now(timezone.utc)
                    })
                    logger.info(f"[cTrader.Execution] Position {pos_id} CLOSED. Final Realized PnL: {realized_profit}")
                    
                    if self.sio:
                        loop = asyncio.get_event_loop()
                        if loop.is_running():
                            closed_payload = event_contract_manager.build_position_closed_payload({
                                "postId": existing_post["id"],
                                "tradeId": pos_id,
                                "closePrice": close_price,
                                "profit": realized_profit,
                                "closedAt": closed_at_dt
                            })
                            loop.create_task(self.sio.emit("feed:position_closed", closed_payload))
                return

            # Case D: New Position Opened (ORDER_FILLED = 2 / ORDER_PARTIAL_FILL = 8)
            if not existing_post:
                symbol_id = pos.get("symbolId") or deal.get("symbolId")
                meta = symbol_registry.resolve(symbol_id=symbol_id, symbol_name=pos.get("symbolName", "XAUUSD"))
                symbol = meta["name"]
                
                if acct_num and symbol_id:
                    self.subscribe_symbol(acct_num, symbol_id)

                side_raw = str(pos.get("tradeSide") or deal.get("tradeSide") or "BUY").upper()
                trade_side = "BUY" if side_raw in ["BUY", "1", "LONG"] else "SELL"
                
                vol_raw = float(pos.get("volume") or deal.get("volume") or 100000)
                lot = round(vol_raw / 100000.0, 2)
                entry = float(pos.get("price") or deal.get("executionPrice") or 0.0)
                sl = float(pos.get("stopLoss") or 0.0)
                tp = float(pos.get("takeProfit") or 0.0)

                user_id = ctrader_client.account_to_user_map.get(acct_num, "user-alex")
                user = db_store.find_user_by_id_or_username(user_id) or {}

                new_post_dict = {
                    "id": canonical_post_id,
                    "user_id": user_id,
                    "username": user.get("username", "alex_trader"),
                    "avatar": user.get("avatar", "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80"),
                    "account_id": f"cTrader-{acct_num}",
                    "trade_id": pos_id,
                    "symbol": symbol,
                    "market": meta["market"],
                    "strategy_id": "breakout",
                    "position_type": trade_side,
                    "status": "OPEN",
                    "entry_price": entry,
                    "current_price": entry,
                    "stop_loss": sl if sl > 0 else None,
                    "take_profit": tp if tp > 0 else None,
                    "progress": 50,
                    "profit": 0.0,
                    "profit_percent": 0.0,
                    "lot": lot,
                    "pips": 0.0,
                    "source": "broker_ctrader",
                    "is_simulation": False,
                    "duration": "Live OP",
                    "opened_at": datetime.now(timezone.utc),
                    "visibility": "LOCKED",
                    "unlock_price": 1,
                    "follow_price": 1,
                    "auto_description": f"⚡ Posisi Terbuka (OP) cTrader: {trade_side} {lot} Lot {symbol} @ {entry}",
                    "custom_description": "Eksekusi cTrader Realtime Feed"
                }

                created_post = db_store.create_post(new_post_dict)
                logger.info(f"[cTrader.OpenAPI] ProtoOAExecutionEvent: Created Feed Post {created_post['id']} for {trade_side} {lot} Lot {symbol}")

                if self.sio:
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        new_post_payload = event_contract_manager.build_new_post_payload(created_post)
                        loop.create_task(self.sio.emit("feed:new_post", new_post_payload))
                        loop.create_task(self.emit_position_update(self.compute_position_payload(created_post)))
        except Exception as exc:
            logger.error(f"[cTrader.OpenAPI] handle_execution_event error: {exc}", exc_info=True)

    def compute_position_payload(self, post: Dict[str, Any], bid_price: Optional[float] = None, ask_price: Optional[float] = None) -> Optional[Dict[str, Any]]:
        if not post or post.get("status") != "OPEN":
            return None

        symbol = str(post.get("symbol", "XAUUSD"))
        meta = symbol_registry.resolve(symbol_name=symbol)
        side = str(post.get("position_type", "BUY")).upper()
        entry = float(post.get("entry_price") or post.get("price") or 0.0)
        lot = float(post.get("lot", 0.1))
        pip_size = 10 ** (-meta["pipPosition"])

        # Fetch latest prices from Spotware spot cache if not directly supplied
        if bid_price is None or ask_price is None:
            cached_prices = self.market_prices.get(symbol)
            if cached_prices:
                current_bid = cached_prices["bid"]
                current_ask = cached_prices["ask"]
            else:
                curr = float(post.get("current_price") or entry)
                current_bid = curr
                current_ask = curr + (pip_size * 0.2)
        else:
            current_bid = bid_price
            current_ask = ask_price

        # Strict Valuation: BUY exits at BID; SELL exits at ASK
        valuation_price = current_bid if side in ["BUY", "1", "LONG"] else current_ask
        pips = calculate_pips(side, entry, current_bid, current_ask, pip_size)

        # Precise Profit calculation = (diff * lotUnits * lot)
        units = meta.get("lotUnits", 100000.0) * lot
        if side in ["BUY", "1", "LONG"]:
            profit_usd = round((current_bid - entry) * units, 2)
        else:
            profit_usd = round((entry - current_ask) * units, 2)

        sl = float(post.get("stop_loss") or 0.0)
        tp = float(post.get("take_profit") or 0.0)
        progress = calculate_position_progress(side, entry, valuation_price, sl, tp, pips)
        profit_percent = round((profit_usd / max(1.0, entry * units)) * 100.0, 2) if entry > 0 else 0.0

        post_id = str(post.get("id"))
        trade_id = str(post.get("trade_id") or post_id)
        now_ts = int(time.time() * 1000)

        db_store.update_post(post_id, {
            "current_price": valuation_price,
            "pips": pips,
            "profit": profit_usd,
            "profit_percent": profit_percent,
            "progress": progress,
            "updated_at": datetime.now(timezone.utc)
        })

        payload = {
            "positionId": trade_id,
            "postId": post_id,
            "symbol": symbol,
            "side": side,
            "direction": side,
            "entry": entry,
            "current": valuation_price,
            "currentPrice": valuation_price,
            "bid": current_bid,
            "ask": current_ask,
            "pips": pips,
            "profitUsd": profit_usd,
            "profit": profit_usd,
            "profitPercent": profit_percent,
            "sl": sl,
            "tp": tp,
            "progress": progress,
            "status": "OPEN",
            "timestamp": now_ts
        }

        return payload

    async def emit_position_update(self, payload: Dict[str, Any]):
        if not self.sio or not payload:
            return
        try:
            standard_payload = event_contract_manager.build_position_update_payload(payload)
            await self.sio.emit("feed:position_update", standard_payload)
            await self.sio.emit("ctrader:position:update", standard_payload)
            await self.sio.emit("trade_tick", standard_payload)
        except Exception as e:
            logger.debug(f"[CTraderPositionService] emit warning: {e}")

    def get_account_live_state(self, account_id: str) -> Dict[str, Any]:
        """
        Computes accurate live account state:
        Realized Balance, Floating Equity, Margin, Free Margin, Margin Level, and Staleness.
        """
        acct_num = ctrader_client._clean_numeric_account_id(account_id)
        acct_info = ctrader_client.account_states.get(acct_num, {})
        money_digits = int(acct_info.get("moneyDigits", 2))
        realized_balance = float(acct_info.get("balance", 0.0))
        leverage = float(acct_info.get("leverage", 500))
        currency = str(acct_info.get("currency", "USD"))

        # Find all active open positions for this account
        open_posts = [
            p for p in db_store.posts
            if p.get("status") == "OPEN" and (str(p.get("account_id", "")).endswith(str(acct_num)) or p.get("account_id") == f"cTrader-{acct_num}")
        ]

        total_unrealized_pnl = 0.0
        total_used_margin = 0.0

        for post in open_posts:
            pnl = float(post.get("profit", 0.0))
            total_unrealized_pnl += pnl
            
            entry = float(post.get("entry_price", 0.0))
            lot = float(post.get("lot", 0.1))
            meta = symbol_registry.resolve(symbol_name=post.get("symbol", "XAUUSD"))
            lot_units = meta.get("lotUnits", 100000.0)
            
            # Position margin = (notional volume) / leverage
            if leverage > 0 and entry > 0:
                pos_margin = (entry * lot * lot_units) / leverage
                total_used_margin += pos_margin

        total_unrealized_pnl = round(total_unrealized_pnl, money_digits)
        total_used_margin = round(total_used_margin, money_digits)
        equity = round(realized_balance + total_unrealized_pnl, money_digits)
        free_margin = round(equity - total_used_margin, money_digits)
        margin_level = round((equity / total_used_margin) * 100.0, 2) if total_used_margin > 0 else None

        # Staleness evaluation (>45 seconds without broker updates)
        is_stale = False
        stale_reason = None
        last_msg_str = ctrader_client.metrics.get("last_message_at")
        if last_msg_str:
            try:
                last_msg_dt = datetime.fromisoformat(last_msg_str)
                age_sec = (datetime.now(timezone.utc) - last_msg_dt).total_seconds()
                if age_sec > 45.0:
                    is_stale = True
                    stale_reason = f"No broker updates received for {age_sec:.0f}s"
            except Exception:
                pass

        return {
            "ctidTraderAccountId": acct_num,
            "accountId": f"cTrader-{acct_num}",
            "balance": realized_balance,
            "equity": equity,
            "unrealizedPnL": total_unrealized_pnl,
            "usedMargin": total_used_margin,
            "freeMargin": free_margin,
            "marginLevel": margin_level,
            "leverage": int(leverage),
            "currency": currency,
            "moneyDigits": money_digits,
            "openPositionsCount": len(open_posts),
            "isStale": is_stale,
            "staleReason": stale_reason,
            "timestamp": int(time.time() * 1000)
        }

    async def emit_account_update(self, account_id: str):
        if not self.sio or not account_id:
            return
        try:
            state = self.get_account_live_state(account_id)
            standard_acct_payload = event_contract_manager.build_account_metrics_payload(state)
            acct_num = ctrader_client._clean_numeric_account_id(account_id)
            user_id = ctrader_client.account_to_user_map.get(acct_num)

            # Security Guard: Emit strictly to confidential private rooms
            if user_id:
                await self.sio.emit("account:metrics_update", standard_acct_payload, room=f"user_{user_id}")
                await self.sio.emit("ctrader:account_update", standard_acct_payload, room=f"user_{user_id}")
            
            await self.sio.emit("account:metrics_update", standard_acct_payload, room=f"account_{account_id}")
            await self.sio.emit("ctrader:account_update", standard_acct_payload, room=f"account_{account_id}")
        except Exception as e:
            logger.debug(f"[CTraderPositionService] account emit warning: {e}")

    async def _service_loop(self, interval_sec: float = 2.0):
        logger.info(f"[CTraderPositionService] Persistent Realtime Engine active ({interval_sec}s cycle).")
        cycle_count = 0
        while self._running:
            try:
                cycle_count += 1

                # Update simulation showcase posts smoothly without polluting real broker positions
                sim_posts = [p for p in db_store.posts if p.get("status") == "OPEN" and p.get("source") == "simulated"]
                for post in sim_posts:
                    payload = self.compute_position_payload(post)
                    if payload:
                        await self.emit_position_update(payload)

                # Fallback Reconciliation: every 60 seconds (30 cycles)
                if cycle_count % 30 == 0 and ctrader_client.state == "AUTHENTICATED":
                    for acct_num in list(ctrader_client.account_states.keys()):
                        logger.debug(f"[cTrader.Fallback] Periodic fallback sync for account {acct_num}")
                        await ctrader_client.send_message(2121, {"ctidTraderAccountId": acct_num})  # PROTO_OA_TRADER_REQ
                        await ctrader_client.send_message(2124, {"ctidTraderAccountId": acct_num})  # PROTO_OA_RECONCILE_REQ
                        await self.emit_account_update(f"cTrader-{acct_num}")

            except Exception as exc:
                logger.warning(f"[CTraderPositionService] Loop warning: {exc}")
            await asyncio.sleep(interval_sec)

    def start(self, interval_sec: float = 2.0):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._service_loop(interval_sec))

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

ctrader_position_service = CTraderPositionService()
live_trading_service = ctrader_position_service
