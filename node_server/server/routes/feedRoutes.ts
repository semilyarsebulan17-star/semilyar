import { Router } from 'express';
import { feedService } from '../services/feedService';
import { userRepository } from '../repositories/userRepository';
import { postRepository } from '../repositories/postRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { commentRepository } from '../repositories/commentRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { ctraderService } from '../services/ctraderService';
import { socketService } from '../services/socketService';
import { notificationService } from '../services/notificationService';

export const feedRoutes = Router();

// 1. GET /api/feed (Instant cursor pagination)
feedRoutes.get('/api/feed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const cursor = (req.query.cursor as string) || null;
    const strategyId = (req.query.strategy as string) || undefined;
    const feedType = (req.query.type as string) || 'for_you';
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;

    const result = await feedService.getFeed(
      {
        limit,
        cursor,
        strategyId,
        userFilterList: feedType === 'following' ? [] : undefined
      },
      currentUserId
    );

    res.json({
      success: true,
      posts: result.posts,
      next_cursor: result.next_cursor,
      has_more: result.has_more,
      total_count: result.total_count
    });
  } catch (error: any) {
    console.error('Error in GET /api/feed:', error);
    res.status(500).json({
      success: false,
      error: { code: 'FEED_FETCH_ERROR', message: error.message }
    });
  }
});

// 2. GET /api/posts/:id
feedRoutes.get('/api/posts/:id', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    const post = await feedService.getPostById(req.params.id, currentUserId);
    if (!post) {
      return res.status(404).json({ success: false, error: { code: 'POST_NOT_FOUND', message: 'Post tidak ditemukan' } });
    }
    res.json({ success: true, post });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'POST_FETCH_ERROR', message: error.message } });
  }
});

// 3. POST /api/posts/:id/unlock (Energy transaction with 80% Trader / 20% Platform split)
feedRoutes.post('/api/posts/:id/unlock', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login terlebih dahulu' } });
    }

    const user = await userRepository.findById(currentUserId);
    const post = await postRepository.findById(req.params.id);
    if (!user || !post) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User atau Post tidak ditemukan' } });
    }

    const alreadyUnlocked = await interactionRepository.isUnlocked(user.id || user.username, post.id || post._id.toString());
    if (alreadyUnlocked) {
      const enriched = await feedService.getPostById(post.id || post._id.toString(), user.id || user.username);
      return res.json({ success: true, energyBalance: user.energy, post: enriched });
    }

    const unlockFee = Math.min(10, Math.max(1, Math.round(Number(post.unlock_price || 1))));

    if (user.energy < unlockFee) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          code: 'INSUFFICIENT_ENERGY', 
          message: `Energy tidak mencukupi. Diperlukan ${unlockFee} Energy untuk membuka setup ini. Silakan Top-Up Energy via Mayar.id` 
        } 
      });
    }

    // Deduct unlock fee from buyer
    const beforeBuyer = user.energy;
    const { newBalance: buyerNewBalance } = await userRepository.updateEnergy(user.id || user.username, -unlockFee);
    await interactionRepository.createUnlock(user.id || user.username, post.id || post._id.toString(), unlockFee);

    // 80% Trader Allocation, 20% Platform Fee
    const traderShare = Math.round(unlockFee * 0.80 * 100) / 100;
    const platformFee = Math.round((unlockFee - traderShare) * 100) / 100;

    // Buyer transaction record
    await transactionRepository.create({
      user_id: user.id || user.username,
      type: 'UNLOCK',
      amount: -unlockFee,
      balance_before: beforeBuyer,
      balance_after: buyerNewBalance,
      reference_id: post.id || post._id.toString(),
      metadata: { 
        symbol: post.symbol, 
        author: post.username, 
        total_fee: unlockFee,
        trader_share: traderShare,
        platform_fee: platformFee,
        revenue_split: '80% Trader / 20% Platform'
      }
    });

    // Credit 80% to Trader (Applies to both free and premium traders)
    const trader = (await userRepository.findById(post.user_id)) || (await userRepository.findByUsername(post.username));
    if (trader && (trader.id || trader.username) !== (user.id || user.username)) {
      const beforeTrader = trader.energy || 0;
      const { newBalance: traderNewBalance } = await userRepository.updateEnergy(trader.id || trader.username, traderShare);
      
      // Update trader accumulated setup earnings
      await userRepository.update(trader.id || trader.username, {
        trade_earnings_energy: ((trader as any).trade_earnings_energy || 0) + traderShare
      });

      // Trader earning transaction record
      await transactionRepository.create({
        user_id: trader.id || trader.username,
        type: 'UNLOCK_EARNING',
        amount: traderShare,
        balance_before: beforeTrader,
        balance_after: traderNewBalance,
        reference_id: post.id || post._id.toString(),
        metadata: {
          from_user: user.username,
          symbol: post.symbol,
          total_fee: unlockFee,
          trader_share: traderShare,
          platform_fee: platformFee,
          revenue_split: '80% Trader / 20% Platform'
        }
      });

      // Notification for trader
      await interactionRepository.createNotification({
        user_id: trader.id || trader.username,
        title: `⚡ Penghasilan Setup: +${traderShare} Energy`,
        message: `@${user.username} membuka presisi setup ${post.symbol} Anda (${unlockFee} Energy). Anda menerima 80% alokasi (${traderShare} Energy).`,
        type: 'TRADE_EARNING'
      });
    }

    const enriched = await feedService.getPostById(post.id || post._id.toString(), user.id || user.username);
    res.json({
      success: true,
      energyBalance: buyerNewBalance,
      unlockedFee: unlockFee,
      traderEarned: traderShare,
      post: enriched
    });
  } catch (error: any) {
    console.error('Error in POST /api/posts/:id/unlock:', error);
    res.status(500).json({ success: false, error: { code: 'UNLOCK_ERROR', message: error.message } });
  }
});

// 4. POST /api/posts/:id/like
feedRoutes.post('/api/posts/:id/like', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login' } });
    }

    const result = await interactionRepository.toggleLike(req.params.id, currentUserId);
    
    // Trigger notification on like (if liked and not own post)
    if (result.isLiked) {
      const post = await postRepository.findById(req.params.id);
      const user = await userRepository.findById(currentUserId);
      if (post && user && (post.user_id !== user.id && post.username !== user.username)) {
        await interactionRepository.createNotification({
          user_id: post.user_id || post.username,
          title: `❤️ @${user.username} menyukai analisa Anda`,
          message: `@${user.username} menyukai analisa setup ${post.symbol || 'trading'} Anda.`,
          type: 'LIKE',
          event_id: `evt_like_${user.id || user.username}_${post.id || post._id.toString()}`,
          link_url: `/#post-${post.id || post._id.toString()}`,
          metadata: { postId: post.id || post._id.toString(), userId: user.id || user.username }
        });
      }
    }

    res.json({ success: true, isLiked: result.isLiked, likesCount: result.likesCount });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'LIKE_ERROR', message: error.message } });
  }
});

// 5. POST /api/posts/:id/save
feedRoutes.post('/api/posts/:id/save', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login' } });
    }

    const user = await userRepository.findById(currentUserId);
    if (!user) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User tidak ditemukan' } });

    const saved = user.saved_post_ids || [];
    const idx = saved.indexOf(req.params.id);
    let isSaved = false;
    if (idx === -1) {
      saved.push(req.params.id);
      isSaved = true;
    } else {
      saved.splice(idx, 1);
      isSaved = false;
    }

    await userRepository.update(user.id || user.username, { saved_post_ids: saved });
    res.json({ success: true, isSaved });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'SAVE_ERROR', message: error.message } });
  }
});

// 6. GET /api/posts/:id/comments
feedRoutes.get('/api/posts/:id/comments', async (req, res) => {
  try {
    const comments = await commentRepository.findByPostId(req.params.id);
    const enriched = await Promise.all(
      comments.map(async (c) => {
        const u = (await userRepository.findById(c.user_id)) || (await userRepository.findByUsername(c.user_id));
        return {
          id: c.id || c._id.toString(),
          postId: c.post_id,
          content: c.text,
          createdAt: c.created_at.toISOString(),
          user: {
            id: u?.id || c.user_id,
            username: u?.username || 'trader',
            displayName: u?.display_name || 'Trader',
            avatar: u?.avatar || ''
          }
        };
      })
    );
    res.json({ success: true, comments: enriched });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'COMMENTS_ERROR', message: error.message } });
  }
});

// 7. POST /api/posts/:id/comments
feedRoutes.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login untuk berkomentar' } });
    }

    const { content } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: { code: 'EMPTY_COMMENT', message: 'Komentar tidak boleh kosong' } });
    }

    const post = await postRepository.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, error: { code: 'POST_NOT_FOUND', message: 'Post tidak ditemukan' } });
    }

    const user = await userRepository.findById(currentUserId);
    const newComment = await commentRepository.create({
      post_id: post.id || post._id.toString(),
      user_id: user?.id || currentUserId,
      text: content.trim()
    });

    await postRepository.update(post.id || post._id.toString(), {
      comments_count: (post.comments_count || 0) + 1
    });

    // Send notification to post author if not self
    if (user && post && (post.user_id !== user.id && post.username !== user.username)) {
      await interactionRepository.createNotification({
        user_id: post.user_id || post.username,
        title: `💬 Komentar baru dari @${user.username}`,
        message: `@${user.username}: "${content.trim().slice(0, 80)}${content.length > 80 ? '...' : ''}"`,
        type: 'COMMENT',
        event_id: `evt_comment_${newComment.id || newComment._id.toString()}`,
        link_url: `/#post-${post.id || post._id.toString()}`,
        metadata: { postId: post.id || post._id.toString(), commentId: newComment.id || newComment._id.toString() }
      });
    }

    res.json({
      success: true,
      comment: {
        id: newComment.id || newComment._id.toString(),
        postId: newComment.post_id,
        content: newComment.text,
        createdAt: newComment.created_at.toISOString(),
        user: {
          id: user?.id || currentUserId,
          username: user?.username || 'trader',
          displayName: user?.display_name || 'Trader',
          avatar: user?.avatar || ''
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'COMMENT_POST_ERROR', message: error.message } });
  }
});

// 8. POST /api/posts/:id/follow-setup (Execute cTrader Mirrored Order with 80% Trader / 20% Platform split)
feedRoutes.post('/api/posts/:id/follow-setup', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login terlebih dahulu' } });
    }

    const user = await userRepository.findById(currentUserId);
    const post = await postRepository.findById(req.params.id);
    if (!user || !post) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'User atau Post tidak ditemukan' } });
    }

    // 1. VALIDATION: User cannot follow their own setup
    const isOwner = (user.id || user.username) === post.user_id || user.username === post.username;
    if (isOwner) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SELF_FOLLOW_FORBIDDEN',
          message: 'Anda tidak dapat mengikuti setup trading milik sendiri.'
        }
      });
    }

    // 2. VALIDATION: Order only sent to follower's authorized cTrader account
    if (!user.ctrader_connected || !user.ctrader_account_id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CTRADER_NOT_CONNECTED',
          message: 'Akun cTrader Anda belum terhubung. Harap hubungkan akun cTrader via menu cTrader Gateway sebelum mengikuti setup.'
        }
      });
    }

    // Ensure access token is valid and auto-refreshed if needed
    await ctraderService.ensureValidAccessToken(user.id || user.username);

    const { volumeLot = 0.10, rrRatio = '1:2', customSL, customTP, estimatedRiskUSD } = req.body;
    const followFee = Math.min(10, Math.max(1, Math.round(Number(post.follow_price || 1))));

    if (user.energy < followFee) {
      return res.status(400).json({ 
        success: false, 
        error: { 
          code: 'INSUFFICIENT_ENERGY', 
          message: `Energy tidak mencukupi. Diperlukan ${followFee} Energy untuk mengikuti setup ini. Silakan Top-Up Energy via Mayar.id` 
        } 
      });
    }

    // Deduct follow fee from follower
    const beforeFollower = user.energy;
    const { newBalance: followerNewBalance } = await userRepository.updateEnergy(user.id || user.username, -followFee);

    // 80% Trader Allocation, 20% Platform Fee
    const traderShare = Math.round(followFee * 0.80 * 100) / 100;
    const platformFee = Math.round((followFee - traderShare) * 100) / 100;

    // Follower transaction record
    await transactionRepository.create({
      user_id: user.id || user.username,
      type: 'FOLLOW_SETUP',
      amount: -followFee,
      balance_before: beforeFollower,
      balance_after: followerNewBalance,
      reference_id: post.id || post._id.toString(),
      metadata: { 
        symbol: post.symbol, 
        author: post.username, 
        total_fee: followFee,
        trader_share: traderShare,
        platform_fee: platformFee,
        lot: volumeLot,
        rrRatio,
        target_ctrader_account: user.ctrader_account_id,
        revenue_split: '80% Trader / 20% Platform'
      }
    });

    // Credit 80% to Trader (Applies to both free and premium traders)
    const trader = (await userRepository.findById(post.user_id)) || (await userRepository.findByUsername(post.username));
    if (trader && (trader.id || trader.username) !== (user.id || user.username)) {
      const beforeTrader = trader.energy || 0;
      const { newBalance: traderNewBalance } = await userRepository.updateEnergy(trader.id || trader.username, traderShare);
      
      await userRepository.update(trader.id || trader.username, {
        trade_earnings_energy: ((trader as any).trade_earnings_energy || 0) + traderShare
      });

      // Trader earning transaction record
      await transactionRepository.create({
        user_id: trader.id || trader.username,
        type: 'FOLLOW_EARNING',
        amount: traderShare,
        balance_before: beforeTrader,
        balance_after: traderNewBalance,
        reference_id: post.id || post._id.toString(),
        metadata: {
          from_user: user.username,
          symbol: post.symbol,
          total_fee: followFee,
          trader_share: traderShare,
          platform_fee: platformFee,
          lot: volumeLot,
          rrRatio,
          revenue_split: '80% Trader / 20% Platform'
        }
      });

      // Notification for trader
      await interactionRepository.createNotification({
        user_id: trader.id || trader.username,
        title: `🚀 Ikuti Setup Baru: +${traderShare} Energy`,
        message: `@${user.username} mengeksekusi ikuti setup trading ${post.symbol} Anda (${followFee} Energy). Anda menerima 80% alokasi (${traderShare} Energy).`,
        type: 'TRADE_EARNING',
        event_id: `evt_follow_earning_${post.id || post._id.toString()}_${user.id || user.username}_${Date.now()}`,
        link_url: '/#activity',
        metadata: { postId: post.id || post._id.toString(), follower: user.username, amount: traderShare }
      });
    }

    // 3. MULTIPLE FOLLOWERS TRACKING: Increment followers_count and record follower ID
    const currentFollowers = post.followed_by_user_ids || [];
    const isNewFollower = !currentFollowers.includes(user.id || user.username);
    const newFollowersList = isNewFollower ? [...currentFollowers, user.id || user.username] : currentFollowers;
    const newFollowersCount = (post.followers_count || currentFollowers.length) + (isNewFollower ? 1 : 0);

    await postRepository.update(post.id || post._id.toString(), {
      followers_count: newFollowersCount,
      followed_by_user_ids: newFollowersList
    });

    // 4. cTrader Mirrored Order Execution Log
    const followerAccountId = user.ctrader_account_id;
    const executionPositionId = ctraderService.logOrderExecution({
      accountId: followerAccountId,
      symbol: post.symbol,
      direction: post.position_type === 'BUY' ? 'BUY' : 'SELL',
      volumeLot,
      price: Number(post.current_price || post.entry_price || 0),
      stopLoss: customSL || post.stop_loss,
      takeProfit: customTP || post.take_profit,
      comment: `Mirrored from @${post.username} (#${post.id || post._id})`
    });

    const executionEvent = {
      positionId: executionPositionId,
      symbol: post.symbol,
      direction: post.position_type,
      volumeLot,
      entryPrice: post.current_price,
      stopLoss: customSL || post.stop_loss,
      takeProfit: customTP || post.take_profit,
      rrRatio,
      estimatedRiskUSD,
      targetAccountId: followerAccountId,
      status: 'OPEN',
      timestamp: new Date().toISOString()
    };

    // Broadcast updated post state to all clients via Socket.IO
    const enriched = await feedService.getPostById(post.id || post._id.toString(), user.id || user.username);
    if (enriched) {
      socketService.broadcastNewPost(enriched);
    }

    // Notification for follower
    await notificationService.sendNotification({
      userId: user.id || user.username,
      title: `Order Mirror ${post.symbol} Sukses Dikirim`,
      message: `Setup @${post.username} (${volumeLot} Lot) berhasil disinkronkan ke akun cTrader ${followerAccountId}.`,
      type: 'TRADE_OPENED',
      linkUrl: `/post/${post.id || post._id.toString()}`
    });

    res.json({
      success: true,
      energyBalance: followerNewBalance,
      followFee,
      traderEarned: traderShare,
      followersCount: newFollowersCount,
      executionEvent,
      message: `Berhasil mengeksekusi order mirror ${post.symbol} ke akun cTrader ${followerAccountId}!`
    });
  } catch (error: any) {
    console.error('Error in POST /api/posts/:id/follow-setup:', error);
    res.status(500).json({ success: false, error: { code: 'FOLLOW_SETUP_ERROR', message: error.message } });
  }
});

// 9. PATCH /api/posts/:id/description & /api/posts/:id/setup-config
const handleUpdateSetupConfig = async (req: any, res: any) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Harap login' } });
    }

    const post = await postRepository.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ success: false, error: { code: 'POST_NOT_FOUND', message: 'Post tidak ditemukan' } });
    }

    if (post.user_id !== currentUserId && post.username !== currentUserId) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Hanya pemilik post yang dapat mengubah konfigurasi' } });
    }

    const owner = (await userRepository.findById(currentUserId)) || (await userRepository.findByUsername(currentUserId));
    const isPremium = Boolean(owner && (owner.premium || (owner.subscription_tier && owner.subscription_tier !== 'free')));

    const { customDescription, unlockFee, followFee } = req.body;
    const updates: any = {};

    if (customDescription !== undefined) {
      updates.custom_description = customDescription;
    }

    // Fee Configuration: Only Premium Users can customize fees (1 - 10 Energy)
    if (unlockFee !== undefined) {
      const parsedUnlock = Math.round(Number(unlockFee));
      if (!isPremium && parsedUnlock > 1) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PREMIUM_ONLY',
            message: 'Fitur kustomisasi biaya unlock setup (1-10 Energy) hanya dapat digunakan oleh user Premium. Akun Free menggunakan biaya standar 1 Energy.'
          }
        });
      }
      updates.unlock_price = isPremium ? Math.min(10, Math.max(1, parsedUnlock)) : 1;
    }

    if (followFee !== undefined) {
      const parsedFollow = Math.round(Number(followFee));
      if (!isPremium && parsedFollow > 1) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PREMIUM_ONLY',
            message: 'Fitur kustomisasi biaya ikuti setup (1-10 Energy) hanya dapat digunakan oleh user Premium. Akun Free menggunakan biaya standar 1 Energy.'
          }
        });
      }
      updates.follow_price = isPremium ? Math.min(10, Math.max(1, parsedFollow)) : 1;
    }

    const updated = await postRepository.update(post.id || post._id.toString(), updates);
    const enriched = await feedService.getPostById(post.id || post._id.toString(), currentUserId);

    res.json({
      success: true,
      customDescription: updated?.custom_description,
      unlockFee: updated?.unlock_price,
      followFee: updated?.follow_price,
      post: enriched
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_CONFIG_ERROR', message: error.message } });
  }
};

feedRoutes.patch('/api/posts/:id/description', handleUpdateSetupConfig);
feedRoutes.patch('/api/posts/:id/setup-config', handleUpdateSetupConfig);
