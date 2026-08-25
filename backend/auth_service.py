"""
Auth Service & Google OAuth Handler for Python FastAPI Backend
Decodes Google Identity Services (GSI) credential JWT tokens, handles login, registration,
and processes referral rewards (+20 Energy).
"""
import base64, json, re, sys, logging
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

logger = logging.getLogger("scrolic.auth")

def format_auth_user_response(user: Dict[str, Any]) -> Dict[str, Any]:
    """Formats Python user dict into the standard AuthUser payload expected by the frontend."""
    created_at = user.get("created_at")
    if isinstance(created_at, datetime):
        created_at_str = created_at.isoformat()
    elif created_at:
        created_at_str = str(created_at)
    else:
        created_at_str = datetime.now(timezone.utc).isoformat()

    bank_accounts = []
    for b in user.get("bank_accounts", []):
        b_created = b.get("created_at")
        b_created_str = b_created.isoformat() if isinstance(b_created, datetime) else (str(b_created) if b_created else created_at_str)
        bank_accounts.append({
            "id": b.get("id", f"bank-{b.get('bank_code', 'id')}"),
            "bankCode": b.get("bank_code", b.get("bankCode", "")),
            "bankName": b.get("bank_name", b.get("bankName", "")),
            "accountNumber": b.get("account_number", b.get("accountNumber", "")),
            "accountHolderName": b.get("account_holder_name", b.get("accountHolderName", "")),
            "isPrimary": bool(b.get("is_primary", b.get("isPrimary", False))),
            "createdAt": b_created_str
        })

    return {
        "id": str(user.get("id") or user.get("_id") or "user-unknown"),
        "username": user.get("username", "trader"),
        "displayName": user.get("display_name") or user.get("displayName") or user.get("username", "Trader"),
        "email": user.get("email"),
        "avatar": user.get("avatar") or f"https://api.dicebear.com/7.x/bottts/svg?seed={user.get('username', 'trader')}",
        "bio": user.get("bio", ""),
        "role": user.get("role", "user"),
        "isBanned": bool(user.get("is_banned", False)),
        "strategyDNA": user.get("strategy_dna") or user.get("strategyDNA") or "breakout",
        "primaryStrategyId": user.get("primary_strategy_id") or user.get("primaryStrategyId") or "breakout",
        "subscriptionTier": user.get("subscription_tier") or user.get("subscriptionTier") or "free",
        "isVerified": bool(user.get("is_verified", user.get("isVerified", True))),
        "winRate": float(user.get("win_rate", user.get("winRate", 75.0))),
        "totalTrades": int(user.get("trades_count", user.get("totalTrades", 0))),
        "totalTradesCount": int(user.get("trades_count", user.get("totalTradesCount", 0))),
        "totalProfitUSD": float(user.get("total_profit_usd", user.get("totalProfitUSD", 0.0))),
        "totalPips": float(user.get("total_pips", user.get("totalPips", 0.0))),
        "followersCount": int(user.get("followers_count", user.get("followersCount", 0))),
        "followingCount": int(user.get("following_count", user.get("followingCount", 0))),
        "followingList": user.get("following_list", user.get("followingList", [])),
        "energyBalance": int(user.get("energy", user.get("energyBalance", 0))),
        "referralCode": user.get("referral_code", user.get("referralCode", "")),
        "referralsCount": int(user.get("referrals_count", user.get("referralsCount", 0))),
        "affiliateEarningsEnergy": int(user.get("affiliate_earnings_energy", user.get("affiliateEarningsEnergy", 0))),
        "tradeEarningsEnergy": int(user.get("trade_earnings_energy", user.get("tradeEarningsEnergy", 0))),
        "kycStatus": user.get("kyc_status", user.get("kycStatus", "unverified")),
        "kycFullName": user.get("kyc_full_name") or user.get("kycFullName") or None,
        "bankAccounts": bank_accounts,
        "cTraderAccountId": user.get("ctrader_account_id") or user.get("cTraderAccountId") or None,
        "cTraderAccounts": user.get("ctrader_accounts") or user.get("cTraderAccounts") or [],
        "cTraderConnected": bool(user.get("ctrader_connected", user.get("cTraderConnected", False))),
        "defaultUnlockFee": int(user.get("default_unlock_price", user.get("defaultUnlockFee", 1))),
        "defaultFollowFee": int(user.get("default_follow_price", user.get("defaultFollowFee", 1))),
        "createdAt": created_at_str
    }

class AuthService:
    @staticmethod
    def decode_google_credential(credential: str) -> Dict[str, Any]:
        """Base64 decode Google GSI JWT token payload."""
        try:
            parts = credential.split(".")
            if len(parts) == 3:
                # Add padding if needed
                payload_b64 = parts[1]
                padded = payload_b64 + "=" * (-len(payload_b64) % 4)
                decoded_bytes = base64.urlsafe_b64decode(padded)
                return json.loads(decoded_bytes.decode("utf-8"))
        except Exception as e:
            logger.warning(f"[auth.google] Failed to decode Google credential: {e}")
        return {}

    async def handle_google_auth(self, body: Dict[str, Any]) -> Dict[str, Any]:
        credential = body.get("credential")
        email = body.get("email")
        name = body.get("name")
        avatar = body.get("avatar")
        username_req = body.get("username")
        strategy_id = body.get("strategyId", "breakout")
        referral_code = body.get("referralCode")

        if credential:
            payload = self.decode_google_credential(credential)
            if payload.get("email"):
                email = payload.get("email")
            if payload.get("name"):
                name = payload.get("name")
            if payload.get("picture"):
                avatar = payload.get("picture")

        clean_email = email.lower().strip() if email else None
        if not clean_email and not username_req:
            raise ValueError("Email Google atau Username wajib diisi untuk autentikasi")

        raw_user_name = username_req or (clean_email.split("@")[0] if clean_email else "trader")
        clean_username = re.sub(r"[^a-z0-9_]", "_", raw_user_name.lower())

        user = None
        if clean_email:
            user = db_store.find_user_by_email(clean_email)
        if not user:
            user = db_store.find_user_by_username(clean_username)

        if not user:
            referrer_id = None
            if referral_code:
                referrer = db_store.find_user_by_referral_code(referral_code)
                if referrer:
                    referrer_id = referrer.get("id") or referrer.get("username")
                    # Reward referrer with 20 Energy
                    db_store.update_energy(referrer_id, 20)
                    db_store.update_user(referrer_id, {
                        "referrals_count": referrer.get("referrals_count", 0) + 1,
                        "affiliate_earnings_energy": referrer.get("affiliate_earnings_energy", 0) + 20
                    })
                    db_store.create_transaction({
                        "user_id": referrer_id,
                        "type": "AFFILIATE_COMMISSION",
                        "amount": 20,
                        "balance_before": referrer.get("energy", 0),
                        "balance_after": referrer.get("energy", 0) + 20,
                        "metadata": {"newUserId": f"user-{clean_username}", "referralCode": referral_code}
                    })
                    db_store.create_notification({
                        "user_id": referrer_id,
                        "title": "Referral Baru Bergabung!",
                        "message": f"@{clean_username} mendaftar lewat link referral Anda. Anda mendapatkan +20 ENERGY!",
                        "type": "AFFILIATE_COMMISSION"
                    })

            display_name = name or (clean_email.split("@")[0].title() if clean_email else clean_username)
            new_user = {
                "id": f"user-{clean_username}",
                "username": clean_username,
                "display_name": display_name,
                "email": clean_email,
                "avatar": avatar or f"https://api.dicebear.com/7.x/bottts/svg?seed={clean_username}",
                "bio": "Trader Scrolic V7",
                "role": "user",
                "premium": False,
                "subscription_tier": "free",
                "strategy_dna": strategy_id,
                "primary_strategy_id": strategy_id,
                "energy": 0,
                "referral_code": f"{clean_username.upper()}50",
                "referrer_id": referrer_id
            }
            user = db_store.create_user(new_user)

        return user

    async def login(self, identifier: str) -> Optional[Dict[str, Any]]:
        clean = (identifier or "").lower().strip()
        if "@" in clean:
            by_email = db_store.find_user_by_email(clean)
            if by_email:
                return by_email
        return db_store.find_user_by_username(clean)

    async def register(self, body: Dict[str, Any]) -> Dict[str, Any]:
        username_raw = body.get("username", "trader")
        clean = re.sub(r"[^a-z0-9_]", "_", username_raw.lower())
        existing = db_store.find_user_by_username(clean)
        if existing:
            return existing

        strategy_id = body.get("strategyId", "breakout")
        new_user = {
            "id": f"user-{clean}",
            "username": clean,
            "display_name": body.get("displayName") or clean,
            "strategy_dna": strategy_id,
            "primary_strategy_id": strategy_id,
            "energy": 0,
            "referral_code": f"{clean.upper()}50"
        }
        return db_store.create_user(new_user)

auth_service = AuthService()
