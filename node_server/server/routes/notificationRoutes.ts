import { Router } from 'express';
import { notificationService, notificationStreamManager } from '../services/notificationService';

export const notificationRoutes = Router();

/**
 * 1. GET /api/notifications/snapshot - Ultra-fast unread badge snapshot (<100ms)
 */
notificationRoutes.get('/api/notifications/snapshot', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.json({
        success: true,
        snapshot: { unread_count: 0, total_count: 0, updated_at: new Date().toISOString() }
      });
    }

    const snapshot = await notificationService.getSnapshot(currentUserId);
    res.json({ success: true, snapshot });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 2. GET /api/notifications/stream - Realtime Server-Sent Events (SSE) live channel
 */
notificationRoutes.get('/api/notifications/stream', (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req.query.userId as string) || (req as any).currentSessionUserId || null;

  if (!currentUserId) {
    return res.status(401).json({ error: 'Harap login untuk streaming realtime notifikasi' });
  }

  // Set SSE Headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Send initial handshake ping
  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', userId: currentUserId, timestamp: new Date().toISOString() })}\n\n`);

  // Register client to stream manager
  const unsubscribe = notificationStreamManager.addClient(currentUserId, res);

  // Keep-alive heartbeat interval every 25 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

/**
 * 3. GET /api/notifications/vapid-public-key - Get VAPID public key for Web Push subscription
 */
notificationRoutes.get('/api/notifications/vapid-public-key', (req, res) => {
  const publicKey = notificationService.getVapidPublicKey();
  res.json({ success: true, publicKey });
});

/**
 * 4. POST /api/notifications/subscribe - Register multi-device push subscription
 */
notificationRoutes.post('/api/notifications/subscribe', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Harap login terlebih dahulu' });
    }

    const { subscription, deviceId } = req.body;
    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ success: false, error: 'Format Web Push subscription tidak valid' });
    }

    const userAgent = req.headers['user-agent'] || 'Unknown Device';
    await notificationService.registerPushSubscription(currentUserId, {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      deviceId,
      userAgent
    });

    res.json({ success: true, message: 'Push subscription berhasil didaftarkan' });
  } catch (error: any) {
    console.error('Error in POST /api/notifications/subscribe:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 5. POST /api/notifications/unsubscribe - Unregister push subscription endpoint
 */
notificationRoutes.post('/api/notifications/unsubscribe', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Harap login terlebih dahulu' });
    }

    const { endpoint } = req.body;
    if (!endpoint) {
      return res.status(400).json({ success: false, error: 'Endpoint push wajib disertakan' });
    }

    const removed = await notificationService.unregisterPushSubscription(currentUserId, endpoint);
    res.json({ success: true, removed });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 6. GET /api/notifications - Paginated notification list
 */
notificationRoutes.get('/api/notifications', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.json({
        notifications: [],
        snapshot: { unread_count: 0, total_count: 0 },
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1, hasMore: false }
      });
    }

    const { page, limit, cursor, unreadOnly } = req.query;
    const result = await notificationService.getNotifications(currentUserId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      cursor: cursor as string | undefined,
      unreadOnly: unreadOnly === 'true'
    });

    res.json({
      notifications: result.notifications,
      snapshot: result.snapshot,
      pagination: result.pagination
    });
  } catch (error: any) {
    console.error('Error in GET /api/notifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 7. POST /api/notifications/:id/read - Mark single notification as read
 */
notificationRoutes.post('/api/notifications/:id/read', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Harap login terlebih dahulu' });
    }

    const result = await notificationService.markAsRead(currentUserId, req.params.id);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 8. POST /api/notifications/read-all - Mark all notifications as read
 */
notificationRoutes.post('/api/notifications/read-all', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.json({ success: true, snapshot: { unread_count: 0 } });
    }

    const result = await notificationService.markAllAsRead(currentUserId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * 9. POST /api/notifications/test-push - Send a test event to verify end-to-end flow
 */
notificationRoutes.post('/api/notifications/test-push', async (req, res) => {
  try {
    const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
    if (!currentUserId) {
      return res.status(401).json({ success: false, error: 'Harap login terlebih dahulu' });
    }

    const notif = await notificationService.sendNotification({
      userId: currentUserId,
      title: 'Uji Coba Notifikasi Scrolic ⚡',
      message: 'Sistem Event → Database → Snapshot → Realtime SSE & Web Push berjalan optimal!',
      type: 'ENERGY_TOPUP',
      linkUrl: '/',
      metadata: { isTest: true }
    });

    res.json({ success: true, notification: notif });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

