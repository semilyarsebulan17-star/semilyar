"""
Database Store (MemoryStore & MongoDB) for Scrolic Python FastAPI Backend
Supports Users, Strategies, Feed Posts, Comments, Notifications, Transactions, Payments
"""
import os, sys, logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone

current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(current_dir) not in sys.path:
    sys.path.insert(0, str(current_dir))
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

try:
    from backend.db_seed import SEED_USERS, SEED_STRATEGIES, SEED_POSTS, SEED_COMMENTS, SEED_NOTIFICATIONS
except ImportError:
    from db_seed import SEED_USERS, SEED_STRATEGIES, SEED_POSTS, SEED_COMMENTS, SEED_NOTIFICATIONS

logger = logging.getLogger("scrolic.database")

def ensure_utc(dt: Any) -> datetime:
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    if isinstance(dt, str):
        try:
            return datetime.fromisoformat(dt.replace("Z", "+00:00"))
        except Exception:
            return datetime.min.replace(tzinfo=timezone.utc)
    if isinstance(dt, datetime):
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt
    return datetime.min.replace(tzinfo=timezone.utc)

class MemoryStore:
    def __init__(self):
        self.users: List[Dict[str, Any]] = [dict(u) for u in SEED_USERS]
        self.strategies: List[Dict[str, Any]] = [dict(s) for s in SEED_STRATEGIES]
        self.posts: List[Dict[str, Any]] = [dict(p) for p in SEED_POSTS]
        self.comments: List[Dict[str, Any]] = [dict(c) for c in SEED_COMMENTS]
        self.notifications: List[Dict[str, Any]] = [dict(n) for n in SEED_NOTIFICATIONS]
        self.transactions: List[Dict[str, Any]] = []
        self.payments: List[Dict[str, Any]] = []
        
        # Dedicated Broker Persistence Collections
        self.broker_positions: Dict[str, Dict[str, Any]] = {}       # Key: {accountId}_{positionId}
        self.broker_deals: Dict[str, Dict[str, Any]] = {}           # Key: {accountId}_{dealId}
        self.broker_raw_events: List[Dict[str, Any]] = []           # Sanitized raw broker events audit
        self.reconciliation_logs: List[Dict[str, Any]] = []         # Periodic reconciliation audit logs
        self.account_snapshots: Dict[str, List[Dict[str, Any]]] = {} # Account balance/equity time series

        self.db = None
        self.client = None
        self.is_mongo_connected = False

    def connect_mongo_if_available(self):
        mongo_uri = os.environ.get("MONGODB_URI", "").strip()
        db_name = os.environ.get("MONGODB_DB_NAME", "ai-config-tool-4").strip()
        if not mongo_uri:
            logger.info("[Database] No MONGODB_URI found. Running in Memory Store mode.")
            return

        try:
            from pymongo import MongoClient
            self.client = MongoClient(mongo_uri, serverSelectionTimeoutMS=4000)
            self.client.admin.command('ping')
            self.db = self.client[db_name]
            self.is_mongo_connected = True
            logger.info(f"[Database] Successfully connected to MongoDB Atlas database: '{db_name}'")
            self._sync_seed_with_mongo()
        except Exception as e:
            logger.warning(f"[MongoDB] Connection warning: {e}. Running in Memory Store mode.")
            self.is_mongo_connected = False

    def _sync_seed_with_mongo(self):
        if not self.db:
            return
        try:
            if self.db.users.count_documents({}) == 0:
                self.db.users.insert_many([dict(u) for u in SEED_USERS])
            else:
                self.users = list(self.db.users.find({}))
                for u in self.users:
                    if "_id" in u: u["_id"] = str(u["_id"])

            if self.db.strategies.count_documents({}) == 0:
                self.db.strategies.insert_many([dict(s) for s in SEED_STRATEGIES])
            else:
                self.strategies = list(self.db.strategies.find({}))
                for s in self.strategies:
                    if "_id" in s: s["_id"] = str(s["_id"])

            if self.db.posts.count_documents({}) == 0:
                self.db.posts.insert_many([dict(p) for p in SEED_POSTS])
            else:
                self.posts = list(self.db.posts.find({}))
                for p in self.posts:
                    if "_id" in p: p["_id"] = str(p["_id"])
        except Exception as e:
            logger.warning(f"[MongoDB] Error syncing seed data: {e}")

    # Users
    def find_user_by_id_or_username(self, identifier: str) -> Optional[Dict[str, Any]]:
        if not identifier:
            return None
        if self.is_mongo_connected and self.db is not None:
            try:
                u = self.db.users.find_one({"$or": [{"id": identifier}, {"username": identifier}]})
                if u:
                    if "_id" in u: u["_id"] = str(u["_id"])
                    return u
            except Exception as e:
                logger.warning(f"[MongoDB] find_user error: {e}")

        for u in self.users:
            if u.get("id") == identifier or u.get("username") == identifier:
                return u
        return None

    def find_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        if not username:
            return None
        if self.is_mongo_connected and self.db is not None:
            try:
                u = self.db.users.find_one({"username": username})
                if u:
                    if "_id" in u: u["_id"] = str(u["_id"])
                    return u
            except Exception as e:
                logger.warning(f"[MongoDB] find_user_by_username error: {e}")

        for u in self.users:
            if u.get("username") == username:
                return u
        return None

    def find_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        clean = (email or "").lower().strip()
        if not clean:
            return None
        if self.is_mongo_connected and self.db is not None:
            try:
                u = self.db.users.find_one({"email": clean})
                if u:
                    if "_id" in u: u["_id"] = str(u["_id"])
                    return u
            except Exception as e:
                logger.warning(f"[MongoDB] find_user_by_email error: {e}")

        for u in self.users:
            if u.get("email", "").lower() == clean:
                return u
        return None

    def find_user_by_referral_code(self, code: str) -> Optional[Dict[str, Any]]:
        clean = (code or "").upper().strip()
        if self.is_mongo_connected and self.db is not None:
            try:
                u = self.db.users.find_one({"referral_code": clean})
                if u:
                    if "_id" in u: u["_id"] = str(u["_id"])
                    return u
            except Exception as e:
                logger.warning(f"[MongoDB] find_user_by_referral_code error: {e}")

        for u in self.users:
            if u.get("referral_code", "").upper() == clean:
                return u
        return None

    def create_user(self, user_dict: Dict[str, Any]) -> Dict[str, Any]:
        user_dict.setdefault("created_at", datetime.now(timezone.utc))
        user_dict.setdefault("updated_at", datetime.now(timezone.utc))
        user_dict.setdefault("followers_count", 0)
        user_dict.setdefault("following_count", 0)
        user_dict.setdefault("following_list", [])
        user_dict.setdefault("saved_post_ids", [])
        user_dict.setdefault("energy", 0)
        user_dict.setdefault("win_rate", 0.0)
        user_dict.setdefault("trades_count", 0)
        user_dict.setdefault("is_verified", False)
        user_dict.setdefault("ctrader_connected", False)
        user_dict.setdefault("ctrader_account_id", None)
        user_dict.setdefault("ctrader_accounts", [])
        user_dict.setdefault("ctrader_access_token", None)
        user_dict.setdefault("ctrader_refresh_token", None)
        user_dict.setdefault("ctrader_token_expires_at", None)
        user_dict.setdefault("bank_accounts", [])

        if self.is_mongo_connected and self.db is not None:
            try:
                self.db.users.insert_one(dict(user_dict))
            except Exception as e:
                logger.warning(f"[MongoDB] create_user insert error: {e}")

        self.users.append(user_dict)
        return user_dict

    def update_user(self, identifier: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        u = self.find_user_by_id_or_username(identifier)
        if u:
            u.update(updates)
            u["updated_at"] = datetime.now(timezone.utc)

            if self.is_mongo_connected and self.db is not None:
                try:
                    self.db.users.update_one(
                        {"$or": [{"id": u.get("id")}, {"username": u.get("username")}]},
                        {"$set": updates}
                    )
                except Exception as e:
                    logger.warning(f"[MongoDB] update_user error: {e}")
            return u
        return None

    def update_energy(self, identifier: str, delta: int) -> tuple[int, Optional[Dict[str, Any]]]:
        u = self.find_user_by_id_or_username(identifier)
        if u:
            curr = u.get("energy", 0)
            new_val = max(0, curr + delta)
            u["energy"] = new_val

            if self.is_mongo_connected and self.db is not None:
                try:
                    self.db.users.update_one(
                        {"$or": [{"id": u.get("id")}, {"username": u.get("username")}]},
                        {"$set": {"energy": new_val}}
                    )
                except Exception as e:
                    logger.warning(f"[MongoDB] update_energy error: {e}")
            return new_val, u
        return 0, None

    # Posts
    def get_feed(self, limit: int = 10, cursor: Optional[str] = None, strategy_id: Optional[str] = None, user_id: Optional[str] = None) -> tuple[List[Dict[str, Any]], Optional[str], bool, int]:
        filtered = self.posts
        if strategy_id:
            filtered = [p for p in filtered if p.get("strategy_id") == strategy_id]
        if user_id:
            filtered = [p for p in filtered if p.get("user_id") == user_id or p.get("username") == user_id]
        
        filtered = sorted(filtered, key=lambda x: x.get("created_at") or datetime.min, reverse=True)
        
        start_idx = 0
        if cursor:
            for idx, p in enumerate(filtered):
                if p.get("id") == cursor:
                    start_idx = idx + 1
                    break
        
        page = filtered[start_idx:start_idx + limit]
        has_more = (start_idx + limit) < len(filtered)
        next_cursor = page[-1].get("id") if page and has_more else None
        return page, next_cursor, has_more, len(filtered)

    def find_post_by_id(self, post_id: str) -> Optional[Dict[str, Any]]:
        for p in self.posts:
            if p.get("id") == post_id:
                return p
        return None

    def create_post(self, post_dict: Dict[str, Any]) -> Dict[str, Any]:
        post_dict.setdefault("created_at", datetime.now(timezone.utc))
        post_dict.setdefault("updated_at", datetime.now(timezone.utc))
        post_dict.setdefault("likes_count", 0)
        post_dict.setdefault("comments_count", 0)
        post_dict.setdefault("followers_count", 0)
        post_dict.setdefault("liked_by_user_ids", [])
        post_dict.setdefault("followed_by_user_ids", [])
        post_dict.setdefault("unlocked_by_user_ids", [])
        self.posts.insert(0, post_dict)
        return post_dict

    def update_post(self, post_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        p = self.find_post_by_id(post_id)
        if p:
            p.update(updates)
            p["updated_at"] = datetime.now(timezone.utc)
            return p
        return None

    def toggle_like(self, post_id: str, user_id: str) -> tuple[bool, int]:
        p = self.find_post_by_id(post_id)
        if not p:
            return False, 0
        likes_list = p.setdefault("liked_by_user_ids", [])
        if user_id in likes_list:
            likes_list.remove(user_id)
            is_liked = False
        else:
            likes_list.append(user_id)
            is_liked = True
        p["likes_count"] = len(likes_list)
        return is_liked, p["likes_count"]

    # Comments
    def find_comments_by_post(self, post_id: str) -> List[Dict[str, Any]]:
        return [c for c in self.comments if c.get("post_id") == post_id]

    def create_comment(self, comment_dict: Dict[str, Any]) -> Dict[str, Any]:
        comment_dict.setdefault("created_at", datetime.now(timezone.utc))
        self.comments.append(comment_dict)
        return comment_dict

    # Notifications
    def find_notifications_by_user(self, user_id: str) -> List[Dict[str, Any]]:
        u = self.find_user_by_id_or_username(user_id)
        target_id = u.get("id") if u else user_id
        target_user = u.get("username") if u else user_id
        return [n for n in self.notifications if n.get("user_id") == target_id or n.get("user_id") == target_user]

    def create_notification(self, notif_dict: Dict[str, Any]) -> Dict[str, Any]:
        notif_dict.setdefault("created_at", datetime.now(timezone.utc))
        notif_dict.setdefault("is_read", False)
        self.notifications.insert(0, notif_dict)
        return notif_dict

    # Transactions & Payments
    def create_transaction(self, tx_dict: Dict[str, Any]) -> Dict[str, Any]:
        tx_dict.setdefault("created_at", datetime.now(timezone.utc))
        self.transactions.insert(0, tx_dict)
        return tx_dict

    def find_transactions_by_user(self, user_id: str) -> List[Dict[str, Any]]:
        u = self.find_user_by_id_or_username(user_id)
        target_id = u.get("id") if u else user_id
        target_user = u.get("username") if u else user_id
        return [t for t in self.transactions if t.get("user_id") == target_id or t.get("user_id") == target_user]

    def create_payment(self, pay_dict: Dict[str, Any]) -> Dict[str, Any]:
        pay_dict.setdefault("created_at", datetime.now(timezone.utc))
        pay_dict.setdefault("status", "pending")
        self.payments.insert(0, pay_dict)
        return pay_dict

    def find_payment_by_invoice_id(self, invoice_id: str) -> Optional[Dict[str, Any]]:
        for p in self.payments:
            if p.get("mayar_invoice_id") == invoice_id or p.get("id") == invoice_id:
                return p
        return None

    def find_payments_by_user(self, user_id: str) -> List[Dict[str, Any]]:
        u = self.find_user_by_id_or_username(user_id)
        target_id = u.get("id") if u else user_id
        target_user = u.get("username") if u else user_id
        return [p for p in self.payments if p.get("user_id") == target_id or p.get("user_id") == target_user]

    def update_payment_status(self, invoice_id: str, status: str, paid_at: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
        p = self.find_payment_by_invoice_id(invoice_id)
        if p:
            p["status"] = status
            if paid_at:
                p["paid_at"] = paid_at
            p["updated_at"] = datetime.now(timezone.utc)
            return p
        return None

    # Strategies
    def find_all_strategies(self) -> List[Dict[str, Any]]:
        return self.strategies

    # Broker Raw Event Sanitized Audit Log (Retention = 1000)
    def save_raw_broker_event(self, payload_type: int, payload_data: Dict[str, Any]):
        sanitized = dict(payload_data)
        # Strip credentials & tokens
        for sensitive_key in ["accessToken", "refreshToken", "clientSecret", "password"]:
            if sensitive_key in sanitized:
                sanitized[sensitive_key] = "[REDACTED]"
        
        event_record = {
            "payload_type": payload_type,
            "data": sanitized,
            "recorded_at": datetime.now(timezone.utc)
        }
        self.broker_raw_events.insert(0, event_record)
        if len(self.broker_raw_events) > 1000:
            self.broker_raw_events.pop()

    # Normalized Open Position Storage (Key: {accountId}_{positionId})
    def upsert_broker_position(self, account_id: Any, position_id: Any, position_data: Dict[str, Any]) -> Dict[str, Any]:
        key = f"{account_id}_{position_id}"
        position_data["account_id"] = str(account_id)
        position_data["position_id"] = str(position_id)
        position_data["updated_at"] = datetime.now(timezone.utc)
        self.broker_positions[key] = position_data
        return position_data

    def get_broker_position(self, account_id: Any, position_id: Any) -> Optional[Dict[str, Any]]:
        return self.broker_positions.get(f"{account_id}_{position_id}")

    def delete_broker_position(self, account_id: Any, position_id: Any) -> bool:
        key = f"{account_id}_{position_id}"
        if key in self.broker_positions:
            del self.broker_positions[key]
            return True
        return False

    # Normalized Closed Deal Storage (Key: {accountId}_{dealId})
    def record_broker_deal(self, account_id: Any, deal_id: Any, deal_data: Dict[str, Any]) -> Dict[str, Any]:
        key = f"{account_id}_{deal_id}"
        deal_data["account_id"] = str(account_id)
        deal_data["deal_id"] = str(deal_id)
        deal_data["recorded_at"] = datetime.now(timezone.utc)
        self.broker_deals[key] = deal_data
        return deal_data

    def get_broker_deals_for_account(self, account_id: Any) -> List[Dict[str, Any]]:
        acct_str = str(account_id)
        return [d for d in self.broker_deals.values() if d.get("account_id") == acct_str]

    # Reconciliation Audit Log (Retention = 200)
    def record_reconciliation_audit(self, account_id: Any, audit_data: Dict[str, Any]):
        audit_record = {
            "account_id": str(account_id),
            "data": audit_data,
            "reconciled_at": datetime.now(timezone.utc)
        }
        self.reconciliation_logs.insert(0, audit_record)
        if len(self.reconciliation_logs) > 200:
            self.reconciliation_logs.pop()

    def get_reconciliation_audit_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.reconciliation_logs[:limit]

    # Historical Account Snapshot Recording
    def record_account_snapshot(self, account_id: Any, snapshot: Dict[str, Any]):
        acct_str = str(account_id)
        if acct_str not in self.account_snapshots:
            self.account_snapshots[acct_str] = []
        snapshot["timestamp"] = datetime.now(timezone.utc)
        self.account_snapshots[acct_str].insert(0, snapshot)
        if len(self.account_snapshots[acct_str]) > 500:
            self.account_snapshots[acct_str].pop()

db_store = MemoryStore()

async def init_db():
    db_store.connect_mongo_if_available()
    if not db_store.is_mongo_connected:
        logger.info("[Database] Initialized Python In-Memory Repository with seeded Scrolic V7 data.")
