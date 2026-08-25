import { Router } from 'express';
import { userRepository } from '../repositories/userRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { postRepository } from '../repositories/postRepository';

export const userRoutes = Router();

// 1. GET /api/user/me
userRoutes.get('/api/user/me', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) {
    return res.json({ user: null });
  }
  const user = await userRepository.findById(currentUserId);
  if (!user) return res.json({ user: null });

  res.json({
    user: {
      id: user.id || user._id.toString(),
      username: user.username,
      displayName: user.display_name,
      avatar: user.avatar,
      bio: user.bio,
      role: user.role || 'user',
      isBanned: Boolean(user.is_banned),
      strategyDNA: user.strategy_dna,
      primaryStrategyId: user.primary_strategy_id,
      subscriptionTier: user.subscription_tier || 'free',
      isVerified: user.is_verified,
      winRate: user.win_rate,
      totalTrades: user.trades_count,
      totalTradesCount: user.trades_count,
      followersCount: user.followers_count,
      followingCount: user.following_count,
      followingList: user.following_list,
      savedPostIds: user.saved_post_ids,
      energyBalance: user.energy,
      referralCode: user.referral_code,
      referralsCount: user.referrals_count,
      affiliateEarningsEnergy: user.affiliate_earnings_energy,
      tradeEarningsEnergy: (user as any).trade_earnings_energy || 0,
      kycStatus: user.kyc_status || 'unverified',
      kycFullName: user.kyc_full_name || null,
      kycNik: user.kyc_nik ? `${user.kyc_nik.slice(0, 6)}******${user.kyc_nik.slice(-2)}` : null,
      kycBirthDate: user.kyc_birth_date || null,
      kycAddress: user.kyc_address || null,
      kycVerifiedAt: user.kyc_verified_at ? user.kyc_verified_at.toISOString() : null,
      bankAccounts: (user.bank_accounts || []).map((b) => ({
        id: b.id,
        bankCode: b.bank_code,
        bankName: b.bank_name,
        accountNumber: b.account_number,
        accountHolderName: b.account_holder_name,
        isPrimary: b.is_primary,
        createdAt: b.created_at?.toISOString ? b.created_at.toISOString() : new Date().toISOString()
      })),
      defaultUnlockFee: (user as any).default_unlock_price || 1,
      defaultFollowFee: (user as any).default_follow_price || 1,
      cTraderAccountId: user.ctrader_account_id,
      cTraderAccounts: user.ctrader_accounts,
      cTraderConnected: user.ctrader_connected
    }
  });
});

// 2. PATCH /api/user/profile
userRoutes.patch('/api/user/profile', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const { displayName, bio, primaryStrategyId, avatar, cTraderConnected, cTraderAccountId, defaultUnlockFee, defaultFollowFee } = req.body;
  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const isPremium = Boolean(user.premium || (user.subscription_tier && user.subscription_tier !== 'free'));

  const updates: any = {};
  if (displayName) updates.display_name = displayName;
  if (bio !== undefined) updates.bio = bio;
  if (avatar) updates.avatar = avatar;
  if (primaryStrategyId) {
    updates.primary_strategy_id = primaryStrategyId;
    updates.strategy_dna = primaryStrategyId;
  }
  if (cTraderConnected !== undefined) updates.ctrader_connected = cTraderConnected;
  if (cTraderAccountId !== undefined) updates.ctrader_account_id = cTraderAccountId;

  if (defaultUnlockFee !== undefined) {
    const val = Math.round(Number(defaultUnlockFee));
    if (!isPremium && val > 1) {
      return res.status(403).json({ error: 'Biaya custom default unlock hanya dapat diatur oleh user Premium (1-10 Energy).' });
    }
    updates.default_unlock_price = isPremium ? Math.min(10, Math.max(1, val)) : 1;
  }

  if (defaultFollowFee !== undefined) {
    const val = Math.round(Number(defaultFollowFee));
    if (!isPremium && val > 1) {
      return res.status(403).json({ error: 'Biaya custom default ikuti setup hanya dapat diatur oleh user Premium (1-10 Energy).' });
    }
    updates.default_follow_price = isPremium ? Math.min(10, Math.max(1, val)) : 1;
  }

  const updated = await userRepository.update(currentUserId, updates);
  if (!updated) return res.status(404).json({ error: 'User tidak ditemukan' });

  res.json({
    success: true,
    user: {
      id: updated.id || updated._id.toString(),
      username: updated.username,
      displayName: updated.display_name,
      avatar: updated.avatar,
      bio: updated.bio,
      strategyDNA: updated.strategy_dna,
      primaryStrategyId: updated.primary_strategy_id,
      energyBalance: updated.energy,
      defaultUnlockFee: (updated as any).default_unlock_price || 1,
      defaultFollowFee: (updated as any).default_follow_price || 1,
      tradeEarningsEnergy: (updated as any).trade_earnings_energy || 0,
      followersCount: updated.followers_count,
      followingCount: updated.following_count
    }
  });
});

// 3. POST /api/user/avatar
userRoutes.post('/api/user/avatar', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'Avatar wajib diisi' });

  const updated = await userRepository.update(currentUserId, { avatar });
  if (!updated) return res.status(404).json({ error: 'User tidak ditemukan' });

  res.json({ success: true, avatar: updated.avatar, user: updated });
});

// 4. GET /api/users
userRoutes.get('/api/users', async (req, res) => {
  const list = await userRepository.findAll();
  const formatted = list.map((u) => ({
    id: u.id || u._id.toString(),
    username: u.username,
    displayName: u.display_name,
    avatar: u.avatar,
    bio: u.bio,
    strategyDNA: u.strategy_dna,
    primaryStrategyId: u.primary_strategy_id,
    subscriptionTier: u.subscription_tier || 'free',
    isVerified: u.is_verified,
    winRate: u.win_rate,
    totalTrades: u.trades_count,
    followersCount: u.followers_count,
    followingCount: u.following_count,
    followingList: u.following_list,
    energyBalance: u.energy,
    referralCode: u.referral_code,
    cTraderConnected: u.ctrader_connected
  }));
  res.json({ users: formatted });
});

// 5. GET /api/users/:username
userRoutes.get('/api/users/:username', async (req, res) => {
  const u = (await userRepository.findByUsername(req.params.username)) || (await userRepository.findById(req.params.username));
  if (!u) return res.status(404).json({ error: 'User tidak ditemukan' });

  res.json({
    user: {
      id: u.id || u._id.toString(),
      username: u.username,
      displayName: u.display_name,
      avatar: u.avatar,
      bio: u.bio,
      strategyDNA: u.strategy_dna,
      primaryStrategyId: u.primary_strategy_id,
      subscriptionTier: u.subscription_tier || 'free',
      isVerified: u.is_verified,
      winRate: u.win_rate,
      totalTrades: u.trades_count,
      followersCount: u.followers_count,
      followingCount: u.following_count,
      followingList: u.following_list,
      energyBalance: u.energy,
      referralCode: u.referral_code,
      cTraderConnected: u.ctrader_connected
    }
  });
});

// 6. GET /api/users/:id/posts
userRoutes.get('/api/users/:id/posts', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  const targetUser = (await userRepository.findById(req.params.id)) || (await userRepository.findByUsername(req.params.id));
  if (!targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { posts } = await postRepository.findFeedWithCursor({ userId: targetUser.id || targetUser.username, limit: 30 });
  res.json({ success: true, posts });
});

// 7. POST /api/users/:username/follow
userRoutes.post('/api/users/:username/follow', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const currentUser = await userRepository.findById(currentUserId);
  const targetUser = await userRepository.findByUsername(req.params.username);

  if (!currentUser || !targetUser) return res.status(404).json({ error: 'User tidak ditemukan' });
  if (currentUser.username === targetUser.username) return res.status(400).json({ error: 'Tidak bisa follow akun sendiri' });

  const { isFollowing } = await interactionRepository.toggleFollow(currentUser.username, targetUser.username);

  if (isFollowing) {
    await interactionRepository.createNotification({
      user_id: targetUser.id || targetUser.username,
      title: 'Pengikut Baru!',
      message: `@${currentUser.username} mulai mengikuti aktivitas trading Anda.`,
      type: 'FOLLOW'
    });
  }

  const updatedTarget = await userRepository.findByUsername(req.params.username);
  res.json({
    success: true,
    isFollowing,
    targetFollowersCount: updatedTarget?.followers_count ?? targetUser.followers_count
  });
});
