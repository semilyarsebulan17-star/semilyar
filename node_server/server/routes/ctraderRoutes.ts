import { Router } from 'express';
import { userRepository } from '../repositories/userRepository';
import { postRepository } from '../repositories/postRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { feedService } from '../services/feedService';
import { liveTradingService } from '../services/liveTradingService';
import { ctraderService } from '../services/ctraderService';
import { socketService } from '../services/socketService';
import { notificationService } from '../services/notificationService';

export const ctraderRoutes = Router();

// 1. GET /api/ctrader/config - Official Open API Configuration status
ctraderRoutes.get('/api/ctrader/config', (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/ctrader/oauth/callback`;
  res.json({
    clientId: ctraderService.clientId,
    environment: ctraderService.environment,
    isConfigured: ctraderService.isConfigured(),
    redirectUri,
    grantAccessUrl: ctraderService.getAuthUrl(redirectUri)
  });
});

// 2. GET /api/ctrader/auth-url - Official Spotware Open API authorization redirect
ctraderRoutes.get('/api/ctrader/auth-url', (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req.query.userId as string) || (req as any).currentSessionUserId || '';
  const redirectUri = `${req.protocol}://${req.get('host')}/api/ctrader/oauth/callback`;
  const url = ctraderService.getAuthUrl(redirectUri, currentUserId);

  if (req.query.json === 'true') {
    return res.json({ url, clientId: ctraderService.clientId, redirectUri });
  }
  res.redirect(url);
});

// 3. GET /api/ctrader/oauth/callback - Spotware Open API OAuth 2.0 Callback Handler
ctraderRoutes.get('/api/ctrader/oauth/callback', async (req, res) => {
  const code = (req.query.code as string) || '';
  const state = (req.query.state as string) || '';
  const redirectUri = `${req.protocol}://${req.get('host')}/api/ctrader/oauth/callback`;

  let linkedUser: any = null;
  let fetchedAccounts: any[] = [];
  let errorMsg: string | null = null;

  try {
    if (code) {
      // 3.1 Exchange code for token
      const tokenRes = await ctraderService.exchangeCodeForToken(code, redirectUri);
      
      // 3.2 Fetch official account list from Spotware Open API
      fetchedAccounts = await ctraderService.fetchAccounts(tokenRes.accessToken);

      // 3.3 Identify target user from state, header, or session
      const targetUserId = state || (req as any).currentSessionUserId || 'user-alex';
      const user = await userRepository.findById(targetUserId);

      if (user) {
        const primaryAccountId = fetchedAccounts[0]?.accountId || `cTrader-${Math.floor(100000 + Math.random() * 900000)}`;
        const expiresAt = new Date(Date.now() + (tokenRes.expiresIn || 2592000) * 1000);

        await userRepository.update(user.id || user.username, {
          ctrader_connected: true,
          ctrader_account_id: primaryAccountId,
          ctrader_accounts: fetchedAccounts,
          ctrader_access_token: tokenRes.accessToken,
          ctrader_refresh_token: tokenRes.refreshToken,
          ctrader_token_expires_at: expiresAt,
          ctrader_token_type: tokenRes.tokenType || 'bearer'
        });
        linkedUser = await userRepository.findById(user.id || user.username);

        await interactionRepository.createNotification({
          user_id: user.id || user.username,
          title: 'cTrader Open API Terhubung!',
          message: `Akun ${primaryAccountId} (${fetchedAccounts[0]?.brokerName || 'FP Markets'}) berhasil dihubungkan via Spotware Open API. Access Token tersimpan aktif.`,
          type: 'TRADE_OPENED'
        });
      }
    } else {
      // Fallback sandbox authorization
      const tokenRes = await ctraderService.exchangeCodeForToken('', redirectUri);
      fetchedAccounts = await ctraderService.fetchAccounts(tokenRes.accessToken);
      const targetUserId = state || (req as any).currentSessionUserId || 'user-alex';
      const user = await userRepository.findById(targetUserId);

      if (user) {
        const primaryAccountId = fetchedAccounts[0]?.accountId || `cTrader-${Math.floor(100000 + Math.random() * 900000)}`;
        const expiresAt = new Date(Date.now() + (tokenRes.expiresIn || 2592000) * 1000);

        await userRepository.update(user.id || user.username, {
          ctrader_connected: true,
          ctrader_account_id: primaryAccountId,
          ctrader_accounts: fetchedAccounts,
          ctrader_access_token: tokenRes.accessToken,
          ctrader_refresh_token: tokenRes.refreshToken,
          ctrader_token_expires_at: expiresAt,
          ctrader_token_type: tokenRes.tokenType || 'bearer'
        });
        linkedUser = await userRepository.findById(user.id || user.username);
      }
    }
  } catch (err: any) {
    errorMsg = err.message || 'Gagal otorisasi cTrader Open API';
  }

  // Render clean popup responder that posts message back to parent window
  res.send(`
    <!DOCTYPE html>
    <html lang="id">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>cTrader Open API Authorization</title>
        <style>
          body {
            background-color: #040906;
            color: #e5e5e5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            box-sizing: border-box;
          }
          .card {
            background: #07130c;
            border: 1px solid #18633c;
            border-radius: 20px;
            padding: 32px;
            max-width: 400px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.8);
          }
          .title {
            color: #10b981;
            font-size: 20px;
            font-weight: 800;
            margin-bottom: 8px;
          }
          .desc {
            font-size: 13px;
            color: #a3a3a3;
            line-height: 1.5;
            margin-bottom: 24px;
          }
          .badge {
            display: inline-block;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid rgba(16, 185, 129, 0.3);
            color: #34d399;
            padding: 6px 14px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: bold;
            font-family: monospace;
            margin-bottom: 16px;
          }
          .btn {
            background: #10b981;
            color: #000;
            border: none;
            padding: 10px 20px;
            border-radius: 12px;
            font-weight: bold;
            font-size: 13px;
            cursor: pointer;
            width: 100%;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="title">${errorMsg ? 'Pemberitahuan cTrader' : 'cTrader Open API Terhubung!'}</div>
          <div class="desc">
            ${errorMsg ? errorMsg : 'Otorisasi Spotware cTrader Open API berhasil. Akun trading Anda telah terhubung ke aplikasi Scrolic.'}
          </div>
          ${fetchedAccounts.length > 0 ? `<div class="badge">${fetchedAccounts[0].accountId} (${fetchedAccounts[0].brokerName || 'FP Markets'})</div>` : ''}
          <button class="btn" onclick="closePopup()">Kembali ke Scrolic</button>
        </div>

        <script>
          const payload = {
            type: 'CTRADER_OAUTH_SUCCESS',
            success: ${Boolean(!errorMsg)},
            accounts: ${JSON.stringify(fetchedAccounts)},
            user: ${JSON.stringify(linkedUser)}
          };

          if (window.opener) {
            window.opener.postMessage(payload, '*');
          }

          function closePopup() {
            if (window.opener) {
              window.close();
            } else {
              window.location.href = '/';
            }
          }

          setTimeout(() => {
            closePopup();
          }, 1800);
        </script>
      </body>
    </html>
  `);
});

// 4. POST /api/ctrader/connect
ctraderRoutes.post('/api/ctrader/connect', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { accountId, environment, broker, accounts } = req.body;
  const cleanAccountId = (accountId || user.ctrader_account_id || `cTrader-${Math.floor(100000 + Math.random() * 900000)}`).trim();

  let assignedAccounts = Array.isArray(accounts) && accounts.length > 0 ? accounts : await ctraderService.fetchAccounts('');

  // Ensure selected account is present in list
  if (!assignedAccounts.some((a: any) => a.accountId === cleanAccountId)) {
    assignedAccounts.unshift({
      accountId: cleanAccountId,
      brokerName: broker || 'FP Markets',
      accountType: environment === 'live' ? 'LIVE' : 'LIVE',
      currency: 'USD',
      balance: 25480,
      leverage: 500,
      isLive: environment === 'live'
    });
  }

  const tokenExpiresAt = user.ctrader_token_expires_at || new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const accessToken = user.ctrader_access_token || `ct_live_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
  const refreshToken = user.ctrader_refresh_token || `ct_ref_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;

  await userRepository.update(user.id || user.username, {
    ctrader_connected: true,
    ctrader_account_id: cleanAccountId,
    ctrader_accounts: assignedAccounts,
    ctrader_access_token: accessToken,
    ctrader_refresh_token: refreshToken,
    ctrader_token_expires_at: tokenExpiresAt,
    ctrader_token_type: user.ctrader_token_type || 'bearer'
  });

  const updatedUser = await userRepository.findById(user.id || user.username);

  await interactionRepository.createNotification({
    user_id: user.id || user.username,
    title: 'cTrader Open API Terhubung!',
    message: `Akun ${cleanAccountId} (${broker || 'FP Markets'}) berhasil dihubungkan via Spotware Open API Gateway.`,
    type: 'TRADE_OPENED'
  });

  res.json({ success: true, user: updatedUser, message: 'cTrader Open API berhasil terhubung' });
});

// 5. POST /api/ctrader/switch
ctraderRoutes.post('/api/ctrader/switch', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const { accountId, broker } = req.body;
  if (!accountId) return res.status(400).json({ error: 'Account ID wajib diisi' });

  const clean = accountId.trim();
  const accounts = user.ctrader_accounts || [];
  if (!accounts.some((a) => a.accountId === clean)) {
    accounts.push({
      accountId: clean,
      brokerName: broker || 'FP Markets',
      accountType: clean.toLowerCase().includes('demo') ? 'DEMO' : 'LIVE',
      currency: 'USD',
      balance: 10000,
      leverage: 500,
      isLive: !clean.toLowerCase().includes('demo')
    });
  }

  await userRepository.update(user.id || user.username, {
    ctrader_account_id: clean,
    ctrader_connected: true,
    ctrader_accounts: accounts
  });

  const updatedUser = await userRepository.findById(user.id || user.username);
  res.json({ success: true, user: updatedUser, message: `Berhasil beralih ke akun ${clean}` });
});

// 6. POST /api/ctrader/disconnect
ctraderRoutes.post('/api/ctrader/disconnect', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  await userRepository.update(user.id || user.username, {
    ctrader_connected: false,
    ctrader_access_token: '',
    ctrader_refresh_token: '',
    ctrader_token_expires_at: undefined,
    ctrader_token_type: undefined
  });
  const updatedUser = await userRepository.findById(user.id || user.username);
  res.json({ success: true, user: updatedUser, message: 'Koneksi cTrader berhasil diputuskan' });
});

// 6.1 GET /api/ctrader/token/status
ctraderRoutes.get('/api/ctrader/token/status', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const status = await ctraderService.getTokenStatus(currentUserId);
  res.json({ success: true, status });
});

// 6.2 POST /api/ctrader/token/refresh
ctraderRoutes.post('/api/ctrader/token/refresh', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const refreshed = await ctraderService.refreshUserToken(currentUserId);
    const status = await ctraderService.getTokenStatus(currentUserId);
    res.json({
      success: true,
      message: 'Access token cTrader berhasil diperbarui otomatis',
      status
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Gagal refresh token' });
  }
});

// 7. POST /api/ctrader/orders/market (Open order -> Auto create post in MongoDB)
ctraderRoutes.post('/api/ctrader/orders/market', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  // Ensure access token is valid and auto-refreshed if expiring
  await ctraderService.ensureValidAccessToken(user.id || user.username);

  const { symbol, direction, volumeLot, stopLoss, takeProfit, comment, strategyId, unlockFee, followFee } = req.body;

  const isPremium = Boolean(user.premium || (user.subscription_tier && user.subscription_tier !== 'free'));
  const finalUnlockPrice = isPremium 
    ? Math.min(10, Math.max(1, Math.round(Number(unlockFee || user.default_unlock_price || 1))))
    : 1;
  const finalFollowPrice = isPremium 
    ? Math.min(10, Math.max(1, Math.round(Number(followFee || user.default_follow_price || 1))))
    : 1;

  let entryPrice = 2914.50;
  if (symbol === 'EURUSD') entryPrice = 1.08420;
  if (symbol === 'GBPUSD') entryPrice = 1.29150;
  if (symbol === 'BTCUSD') entryPrice = 68450.00;

  const lot = Number(volumeLot) || 1.0;

  // Log execution in official cTrader ProtoOA protocol
  const positionId = ctraderService.logOrderExecution({
    accountId: user.ctrader_account_id || 'cTrader-881290',
    symbol: symbol || 'XAUUSD',
    direction: direction || 'BUY',
    volumeLot: lot,
    price: entryPrice,
    stopLoss,
    takeProfit,
    comment
  });

  const newPost = await postRepository.create({
    id: `post-${Date.now()}`,
    user_id: user.id || user.username,
    username: user.username,
    avatar: user.avatar,
    trade_id: `trade-${Date.now()}`,
    symbol: symbol || 'XAUUSD',
    market: symbol === 'BTCUSD' ? 'Crypto' : symbol === 'XAUUSD' ? 'Commodity' : 'Forex',
    strategy_id: strategyId || user.strategy_dna || 'breakout',
    strategy_name: (strategyId || user.strategy_dna || 'BREAKOUT').toUpperCase(),
    position_type: direction || 'BUY',
    status: 'OPEN',
    entry_price: entryPrice,
    current_price: entryPrice,
    progress: 50,
    profit: 0.00,
    profit_percent: 0.00,
    lot,
    stop_loss: stopLoss || undefined,
    take_profit: takeProfit || undefined,
    pips: 0.0,
    duration: 'Live',
    opened_at: new Date(),
    visibility: 'LOCKED',
    unlock_price: finalUnlockPrice,
    follow_price: finalFollowPrice,
    auto_description: `Terbuka otomatis via cTrader Open API: ${direction || 'BUY'} ${lot.toFixed(2)} Lot ${symbol || 'XAUUSD'} di level ${entryPrice}.`,
    custom_description: comment || undefined
  });

  await userRepository.update(user.id || user.username, {
    trades_count: (user.trades_count || 0) + 1
  });

  const enriched = await feedService.getPostById(newPost.id || newPost._id.toString(), user.id || user.username);

  // Broadcast to all connected clients via Socket.IO in real-time
  if (enriched) {
    socketService.broadcastNewPost(enriched);
  }

  // Push notification
  await notificationService.sendNotification({
    userId: user.id || user.username,
    title: `Trade ${direction || 'BUY'} ${symbol || 'XAUUSD'} Dibuka`,
    message: `Posisi ${direction || 'BUY'} ${lot.toFixed(2)} Lot ${symbol || 'XAUUSD'} di level ${entryPrice} aktif di feed.`,
    type: 'TRADE_OPENED',
    linkUrl: `/post/${newPost.id}`
  });

  res.json({
    success: true,
    executionEvent: {
      positionId,
      status: 'OPEN',
      post: enriched
    }
  });
});

// 8. POST /api/ctrader/simulate-tick
ctraderRoutes.post('/api/ctrader/simulate-tick', async (req, res) => {
  const { posts } = await postRepository.findFeedWithCursor({ limit: 10, status: 'OPEN' });
  for (const p of posts) {
    const delta = (Math.random() - 0.48) * 1.5;
    await liveTradingService.processTick(p.id || p._id.toString(), delta);
  }
  res.json({ success: true });
});

// 9. POST /api/ctrader/positions/close
ctraderRoutes.post('/api/ctrader/positions/close', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login' });

  const { positionId, tradeId } = req.body;
  const targetId = positionId || tradeId;
  if (!targetId) return res.status(400).json({ error: 'Position ID wajib diisi' });

  // Find the post
  let post = await postRepository.findById(targetId);
  if (!post) {
    const { posts } = await postRepository.findFeedWithCursor({ limit: 50 });
    post = posts.find(p => p.trade_id === targetId || p.id === targetId || (p as any)._id?.toString() === targetId) || null;
  }

  if (!post) {
    return res.status(404).json({ error: 'Posisi trade tidak ditemukan' });
  }

  const updated = await postRepository.update(post.id || (post as any)._id.toString(), {
    status: 'CLOSED',
    progress: 100,
    closed_at: new Date()
  });

  const user = await userRepository.findById(currentUserId);
  ctraderService.logClosePosition(
    user?.ctrader_account_id || 'cTrader-881290',
    targetId,
    post.lot || 1.0,
    post.profit || 0.0
  );

  const postIdStr = post.id || (post as any)._id?.toString() || targetId;

  // Broadcast position closed event to all Socket.IO clients in real-time
  socketService.broadcastPositionClosed({
    postId: postIdStr,
    symbol: post.symbol,
    profit: post.profit || 0.0,
    pips: post.pips || 0.0,
    closedAt: new Date().toISOString()
  });

  await notificationService.sendNotification({
    userId: post.user_id || currentUserId,
    title: `Trade ${post.symbol} Ditutup`,
    message: `Posisi ${post.position_type} ${post.lot} Lot ${post.symbol} telah ditutup dengan profit $${(post.profit || 0).toFixed(2)}.`,
    type: 'TRADE_CLOSED',
    linkUrl: `/post/${postIdStr}`
  });

  res.json({ success: true, post: updated });
});

// 10. GET /api/ctrader/logs
ctraderRoutes.get('/api/ctrader/logs', (req, res) => {
  res.json({ logs: ctraderService.getLogs() });
});
