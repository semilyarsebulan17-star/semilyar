import { Router } from 'express';
import { authService } from '../services/authService';

export const authRoutes = Router();

// Active session user id in server context (null by default for real authentication)
export let serverCurrentSessionUserId: string | null = null;

export function formatAuthUserResponse(user: any) {
  return {
    id: user.id || user._id.toString(),
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    email: user.email,
    avatar: user.avatar,
    bio: user.bio || '',
    role: user.role || 'user',
    isBanned: Boolean(user.is_banned),
    strategyDNA: user.strategy_dna || 'breakout',
    primaryStrategyId: user.primary_strategy_id || 'breakout',
    subscriptionTier: user.subscription_tier || 'free',
    isVerified: Boolean(user.is_verified),
    winRate: user.win_rate || 0,
    totalTrades: user.trades_count || 0,
    totalTradesCount: user.trades_count || 0,
    totalProfitUSD: user.total_profit_usd || 0,
    totalPips: user.total_pips || 0,
    followersCount: user.followers_count || 0,
    followingCount: user.following_count || 0,
    followingList: user.following_list || [],
    energyBalance: user.energy ?? 0,
    referralCode: user.referral_code,
    referralsCount: user.referrals_count || 0,
    affiliateEarningsEnergy: user.affiliate_earnings_energy || 0,
    tradeEarningsEnergy: user.trade_earnings_energy || 0,
    kycStatus: user.kyc_status || 'unverified',
    kycFullName: user.kyc_full_name || null,
    bankAccounts: (user.bank_accounts || []).map((b: any) => ({
      id: b.id,
      bankCode: b.bank_code,
      bankName: b.bank_name,
      accountNumber: b.account_number,
      accountHolderName: b.account_holder_name,
      isPrimary: b.is_primary,
      createdAt: b.created_at?.toISOString ? b.created_at.toISOString() : new Date().toISOString()
    })),
    cTraderAccountId: user.ctrader_account_id,
    cTraderAccounts: user.ctrader_accounts || [],
    cTraderConnected: Boolean(user.ctrader_connected),
    defaultUnlockFee: user.default_unlock_price || 1,
    defaultFollowFee: user.default_follow_price || 1,
    createdAt: user.created_at ? (user.created_at.toISOString ? user.created_at.toISOString() : user.created_at) : new Date().toISOString()
  };
}

authRoutes.post('/api/auth/google', async (req, res) => {
  try {
    const { user } = await authService.handleGoogleAuth(req.body);
    serverCurrentSessionUserId = user.id || user.username;
    res.json({
      success: true,
      user: formatAuthUserResponse(user)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'AUTH_GOOGLE_ERROR', message: error.message } });
  }
});

authRoutes.post('/api/auth/login', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await authService.login(username || '');
    if (!user) {
      return res.status(404).json({ error: 'User tidak ditemukan' });
    }
    serverCurrentSessionUserId = user.id || user.username;
    res.json({
      success: true,
      user: formatAuthUserResponse(user)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'LOGIN_ERROR', message: error.message } });
  }
});

authRoutes.post('/api/auth/register', async (req, res) => {
  try {
    const user = await authService.register(req.body);
    serverCurrentSessionUserId = user.id || user.username;
    res.json({
      success: true,
      user: formatAuthUserResponse(user)
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'REGISTER_ERROR', message: error.message } });
  }
});

authRoutes.post('/api/auth/logout', (req, res) => {
  serverCurrentSessionUserId = null;
  res.json({ success: true });
});
