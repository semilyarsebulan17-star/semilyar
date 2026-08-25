"""
Live Market Ticker Engine for Python FastAPI Backend
Simulates live price micro-fluctuations (2.5s interval) for open trade positions and broadcasts ticks via Socket.IO.
"""
import asyncio, random, sys, logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timezone

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

try:
    from backend.database import db_store
except ImportError:
    from database import db_store

logger = logging.getLogger("scrolic.ticker")

class LiveTradingService:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self.sio = None

    def set_sio(self, sio_instance):
        self.sio = sio_instance

    def process_tick(self, post: Dict[str, Any], delta: float) -> Optional[Dict[str, Any]]:
        if not post or post.get("status") != "OPEN":
            return None

        curr_price = float(post.get("current_price", post.get("entry_price", 0)))
        new_price = round(curr_price + delta, 4 if "USD" in post.get("symbol", "") and not "BTC" in post.get("symbol", "") else 2)
        
        symbol = post.get("symbol", "")
        pip_multiplier = 100.0 if "JPY" in symbol else 10.0 if "XAU" in symbol else 1.0 if "BTC" in symbol else 10000.0
        entry_price = float(post.get("entry_price", 0))
        pos_type = post.get("position_type", "BUY")

        if pos_type == "BUY":
            pips = round((new_price - entry_price) * pip_multiplier, 1)
        else:
            pips = round((entry_price - new_price) * pip_multiplier, 1)

        lot = float(post.get("lot", 1.0))
        profit = round(pips * lot * (1.0 if "BTC" in symbol else 10.0), 2)
        profit_percent = round((profit / (entry_price * lot * 10.0)) * 100.0, 2) if entry_price > 0 else 0.0
        progress = min(98, max(5, int(50 + pips * 0.5)))

        post_id = post.get("id")
        db_store.update_post(post_id, {
            "current_price": new_price,
            "pips": pips,
            "profit": profit,
            "profit_percent": profit_percent,
            "progress": progress,
            "updated_at": datetime.now(timezone.utc)
        })

        update = {
            "postId": post_id,
            "symbol": symbol,
            "currentPrice": new_price,
            "progress": progress,
            "profit": profit,
            "profitPercent": profit_percent,
            "pips": pips,
            "status": post.get("status")
        }

        if self.sio:
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.sio.emit("trade_tick", update))
            except Exception:
                pass

        return update

    async def _ticker_loop(self, interval_sec: float = 2.5):
        logger.info(f"[LiveTradingService] Real-time market tick engine started ({interval_sec}s interval).")
        while self._running:
            try:
                posts, _, _, _ = db_store.get_feed(limit=20)
                open_posts = [p for p in posts if p.get("status") == "OPEN"]
                for post in open_posts:
                    symbol = post.get("symbol", "")
                    max_delta = 12.5 if symbol == "BTCUSD" else 0.35 if symbol == "XAUUSD" else 0.00015
                    delta = (random.random() - 0.48) * max_delta
                    self.process_tick(post, delta)
            except Exception as e:
                logger.warning(f"[ticker.loop] Error in ticker cycle: {e}")
            await asyncio.sleep(interval_sec)

    def start(self, interval_sec: float = 2.5):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._ticker_loop(interval_sec))

    def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            self._task = None

live_trading_service = LiveTradingService()
