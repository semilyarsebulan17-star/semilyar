import { ObjectId } from 'mongodb';

// 1. Users Collection
export interface MongoUser {
  _id: ObjectId;
  id?: string;
  username: string;
  display_name: string;
  email?: string;
  avatar: string;
  bio?: string;
  role?: 'user' | 'admin';
  is_banned?: boolean;
  premium: boolean;
  premium_until?: string | null;
  subscription_tier?: 'free' | 'premium_monthly' | 'premium_3m' | 'premium_6m' | 'premium_yearly';
  energy: number;
  followers_count: number;
  following_count: number;
  trades_count: number;
  win_rate: number;
  is_verified: boolean;
  strategy_dna: string;
  primary_strategy_id?: string;
  following_list: string[];
  saved_post_ids: string[];
  referral_code: string;
  referrer_id?: string;
  referrals_count: number;
  affiliate_earnings_energy: number;
  trade_earnings_energy?: number;
  kyc_status?: 'unverified' | 'pending' | 'verified' | 'rejected';
  kyc_full_name?: string;
  kyc_nik?: string;
  kyc_birth_date?: string;
  kyc_address?: string;
  kyc_verified_at?: Date;
  bank_accounts?: Array<{
    id: string;
    bank_code: string;
    bank_name: string;
    account_number: string;
    account_holder_name: string;
    is_primary: boolean;
    created_at: Date;
  }>;
  default_unlock_price?: number;
  default_follow_price?: number;
  ctrader_account_id?: string;
  ctrader_accounts?: Array<{
    accountId: string;
    brokerName?: string;
    accountType?: 'DEMO' | 'LIVE';
    currency?: string;
    balance?: number;
    leverage?: number;
    isLive?: boolean;
  }>;
  ctrader_connected: boolean;
  ctrader_access_token?: string;
  ctrader_refresh_token?: string;
  ctrader_token_expires_at?: Date;
  ctrader_token_type?: string;
  created_at: Date;
  updated_at: Date;
}

// 2. Posts Collection
export interface MongoPost {
  _id: ObjectId;
  id?: string;
  user_id: string;
  username: string;
  avatar: string;
  trade_id: string;
  symbol: string;
  market?: string;
  strategy_id: string;
  strategy_name: string;
  position_type: 'BUY' | 'SELL';
  status: 'OPEN' | 'CLOSED';
  entry_price: number;
  current_price: number;
  progress: number;
  profit: number;
  profit_percent: number;
  lot: number;
  stop_loss?: number;
  take_profit?: number;
  pips?: number;
  duration?: string;
  opened_at: Date;
  closed_at?: Date | null;
  visibility: 'PUBLIC' | 'LOCKED' | 'PREMIUM';
  unlock_price: number;
  follow_price?: number;
  auto_description: string;
  custom_description?: string;
  likes_count: number;
  comments_count: number;
  liked_by_user_ids: string[];
  followers_count?: number;
  followed_by_user_ids?: string[];
  created_at: Date;
  updated_at: Date;
}

// 3. Strategies Collection
export interface MongoStrategy {
  _id: ObjectId;
  id?: string;
  name: string;
  slug: string;
  description: string;
  template_id: string;
  tagline?: string;
  win_rate_avg?: number;
  premium: boolean;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

// 4. Comments Collection
export interface MongoComment {
  _id: ObjectId;
  id?: string;
  post_id: string;
  user_id: string;
  text: string;
  created_at: Date;
  updated_at: Date;
}

// 5. Likes Collection (Unique compound: post_id + user_id)
export interface MongoLike {
  _id: ObjectId;
  post_id: string;
  user_id: string;
  created_at: Date;
}

// 6. Follows Collection (Unique compound: follower_id + following_id)
export interface MongoFollow {
  _id: ObjectId;
  follower_id: string;
  following_id: string;
  created_at: Date;
}

// 7. Unlocks Collection (Unique compound: user_id + post_id)
export interface MongoUnlock {
  _id: ObjectId;
  user_id: string;
  post_id: string;
  energy_cost: number;
  created_at: Date;
}

// 8. Transactions Collection (Energy / Payments / Affiliate)
export interface MongoTransaction {
  _id: ObjectId;
  id?: string;
  user_id: string;
  type: 'TOPUP' | 'UNLOCK' | 'FOLLOW_SETUP' | 'UNLOCK_EARNING' | 'FOLLOW_EARNING' | 'AI_QUERY' | 'AFFILIATE_COMMISSION' | 'REFUND' | 'WELCOME_BONUS' | 'PREMIUM_UPGRADE' | 'COMMISSION_TRANSFER';
  amount: number;
  balance_before: number;
  balance_after: number;
  reference_id?: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  metadata?: Record<string, any>;
  created_at: Date;
}

// 8b. Payments Collection (Mayar.id Official Gateway Records)
export interface MongoPayment {
  _id: ObjectId;
  id?: string;
  user_id: string;
  amount: number;
  energy_amount: number;
  mayar_invoice_id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired';
  payment_method?: string;
  checkout_url?: string;
  qr_code?: string;
  package_id?: string;
  customer_name?: string;
  customer_email?: string;
  customer_mobile?: string;
  raw_response?: Record<string, any>;
  webhook_payload?: Record<string, any>;
  created_at: Date;
  paid_at?: Date | null;
  expired_at?: Date | null;
}

// 9. Notifications & Realtime Snapshot
export interface MongoNotification {
  _id: ObjectId;
  id?: string;
  event_id?: string; // Unique idempotency key
  user_id: string;
  title: string;
  message: string;
  type: 'TRADE_OPENED' | 'TRADE_CLOSED' | 'TRADE_EARNING' | 'FOLLOW' | 'AFFILIATE_COMMISSION' | 'ENERGY_TOPUP' | 'LIKE' | 'COMMENT' | 'KYC_VERIFIED' | 'WITHDRAWAL' | 'PREMIUM_UPGRADE' | 'COMMISSION_TRANSFER' | 'SYSTEM';
  is_read: boolean;
  link_url?: string;
  metadata?: Record<string, any>;
  read_at?: Date | null;
  created_at: Date;
}

export interface MongoNotificationSnapshot {
  _id: ObjectId;
  user_id: string;
  unread_count: number;
  total_count: number;
  last_notification_id?: string;
  last_notification_at?: Date;
  updated_at: Date;
}

export interface MongoPushSubscription {
  _id: ObjectId;
  user_id: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  device_id?: string;
  user_agent?: string;
  created_at: Date;
  updated_at: Date;
}

// 10. Withdrawals Collection
export interface MongoWithdrawal {
  _id: ObjectId;
  id?: string;
  user_id: string;
  amount_energy: number;
  amount_idr: number;
  fee_idr: number;
  net_amount_idr: number;
  bank_code: string;
  bank_name: string;
  account_number: string;
  account_holder_name: string; // Locked to user's kyc_full_name
  status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED';
  reference_id: string;
  disbursement_id?: string;
  notes?: string;
  created_at: Date;
  completed_at?: Date;
}

// 11. Energy Package & Discount Config
export interface EnergyPackageConfig {
  id: string;
  energy: number;
  basePriceRp: number;
  discountPercent: number; // e.g. 20 for 20% off
  discountPriceRp: number; // calculated final price
  label: string;
  bonus: string;
  isPopular?: boolean;
  isActive: boolean;
}

// 12. Premium Package Config
export interface PremiumPackageConfig {
  id: string;
  tier: 'premium_monthly' | 'premium_3m' | 'premium_6m' | 'premium_yearly';
  name: string;
  durationMonths: number;
  priceEnergy: number; // e.g. 99 Energy for 1 month
  basePriceEnergy?: number; // e.g. 99 Energy
  basePriceRp: number; // e.g. Rp 99.000
  discountPercent: number;
  discountPriceRp: number; // e.g. Rp 99.000
  maxGenerations: number; // 2 for 1m, 3 for 3m, 4 for 6m, 5 for yearly
  totalCommissionPercent: number; // 20% for 1m, 30% for 3m, 40% for 6m, 50% for yearly
  energyBonus: number;
  features: string[];
  isActive: boolean;
  isPopular?: boolean;
}

