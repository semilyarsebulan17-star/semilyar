import { ObjectId, Filter } from 'mongodb';
import webpush from 'web-push';
import { getDatabase } from '../config/database';
import { 
  MongoNotification, 
  MongoNotificationSnapshot, 
  MongoPushSubscription 
} from '../models/types';
import { SEED_NOTIFICATIONS } from '../db/seedData';

// --- In-Memory Fallback Stores ---
let memoryNotifications: MongoNotification[] = SEED_NOTIFICATIONS.map((n) => ({
  ...n,
  event_id: `seed-evt-${n.id || n._id.toString()}`,
  is_read: n.is_read || false,
  read_at: n.is_read ? new Date() : null,
  link_url: '/',
  metadata: {}
}));
let memorySnapshots: Map<string, MongoNotificationSnapshot> = new Map();
let memoryPushSubscriptions: MongoPushSubscription[] = [];

// --- VAPID Configuration & Fallback ---
// Fallback keys for local development if not provided in environment
const DEFAULT_VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const DEFAULT_VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'UUxI28g-x5aU9k5jO_4c40-V5z8yD6vE6jP_kQ3j2-0';
const DEFAULT_VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:support@scrolic.trade';

try {
  webpush.setVapidDetails(
    DEFAULT_VAPID_SUBJECT,
    DEFAULT_VAPID_PUBLIC_KEY,
    DEFAULT_VAPID_PRIVATE_KEY
  );
} catch (vapidErr: any) {
  console.warn('[NotificationService] VAPID initialization notice:', vapidErr.message);
}

// --- Realtime SSE Stream Connection Manager ---
export interface NotificationStreamClient {
  userId: string;
  res: any;
}

class NotificationStreamManager {
  private clients: Set<NotificationStreamClient> = new Set();

  addClient(userId: string, res: any): () => void {
    const client: NotificationStreamClient = { userId, res };
    this.clients.add(client);

    return () => {
      this.clients.delete(client);
    };
  }

  broadcastToUser(userId: string, payload: any) {
    const dataString = `data: ${JSON.stringify(payload)}\n\n`;
    const targetUserId = userId.replace(/^user-/, '');

    this.clients.forEach((client) => {
      const clientUserId = client.userId.replace(/^user-/, '');
      if (clientUserId === targetUserId || client.userId === userId) {
        try {
          client.res.write(dataString);
        } catch (err) {
          console.warn('[NotificationStream] Failed to write to client, removing:', err);
          this.clients.delete(client);
        }
      }
    });
  }
}

export const notificationStreamManager = new NotificationStreamManager();

export interface SendNotificationInput {
  userId: string;
  title: string;
  message: string;
  type: MongoNotification['type'];
  eventId?: string;
  linkUrl?: string;
  metadata?: Record<string, any>;
}

export class NotificationService {
  /**
   * Return VAPID Public Key for client-side subscription registration
   */
  getVapidPublicKey(): string {
    return process.env.VAPID_PUBLIC_KEY || DEFAULT_VAPID_PUBLIC_KEY;
  }

  /**
   * Retrieve or initialize fast notification snapshot (<100ms response)
   */
  async getSnapshot(userId: string): Promise<{ unread_count: number; total_count: number; updated_at: string }> {
    const cleanUserId = userId.replace(/^user-/, '');
    const db = getDatabase();

    if (db) {
      const snapshot = await db.collection<MongoNotificationSnapshot>('notification_snapshots').findOne({
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      });

      if (snapshot) {
        return {
          unread_count: Math.max(0, snapshot.unread_count || 0),
          total_count: snapshot.total_count || 0,
          updated_at: snapshot.updated_at ? snapshot.updated_at.toISOString() : new Date().toISOString()
        };
      }

      // If snapshot doc doesn't exist yet, calculate initial unread count once and persist snapshot
      const unreadCount = await db.collection<MongoNotification>('notifications').countDocuments({
        $or: [{ user_id: userId }, { user_id: cleanUserId }],
        is_read: false
      });
      const totalCount = await db.collection<MongoNotification>('notifications').countDocuments({
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      });

      const newSnapshot: MongoNotificationSnapshot = {
        _id: new ObjectId(),
        user_id: userId,
        unread_count: Math.max(0, unreadCount),
        total_count: totalCount,
        updated_at: new Date()
      };

      await db.collection<MongoNotificationSnapshot>('notification_snapshots').insertOne(newSnapshot);

      return {
        unread_count: newSnapshot.unread_count,
        total_count: newSnapshot.total_count,
        updated_at: newSnapshot.updated_at.toISOString()
      };
    }

    // Memory store fallback
    let mem = memorySnapshots.get(userId) || memorySnapshots.get(cleanUserId);
    if (!mem) {
      const unread = memoryNotifications.filter(
        (n) => (n.user_id === userId || n.user_id === cleanUserId) && !n.is_read
      ).length;
      const total = memoryNotifications.filter(
        (n) => n.user_id === userId || n.user_id === cleanUserId
      ).length;

      mem = {
        _id: new ObjectId(),
        user_id: userId,
        unread_count: Math.max(0, unread),
        total_count: total,
        updated_at: new Date()
      };
      memorySnapshots.set(userId, mem);
    }

    return {
      unread_count: Math.max(0, mem.unread_count || 0),
      total_count: mem.total_count || 0,
      updated_at: mem.updated_at.toISOString()
    };
  }

  /**
   * CORE FLOW:
   * Event → Notification Service → Database → Notification Snapshot → Realtime SSE / Web Push
   */
  async sendNotification(input: SendNotificationInput): Promise<MongoNotification> {
    const { userId, title, message, type, eventId, linkUrl, metadata } = input;
    const cleanUserId = userId.replace(/^user-/, '');
    const finalEventId = eventId || `evt_${type.toLowerCase()}_${userId}_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const db = getDatabase();

    // 1. Idempotency Check: Don't duplicate if event_id already processed
    if (db) {
      const existing = await db.collection<MongoNotification>('notifications').findOne({
        event_id: finalEventId,
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      });

      if (existing) {
        return existing;
      }
    } else {
      const existing = memoryNotifications.find(
        (n) => n.event_id === finalEventId && (n.user_id === userId || n.user_id === cleanUserId)
      );
      if (existing) {
        return existing;
      }
    }

    // 2. Persist Notification in Database
    const notifDoc: MongoNotification = {
      _id: new ObjectId(),
      id: `notif-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      event_id: finalEventId,
      user_id: userId,
      title,
      message,
      type,
      is_read: false,
      link_url: linkUrl || '/',
      metadata: metadata || {},
      read_at: null,
      created_at: now
    };

    let newUnreadCount = 1;
    let newTotalCount = 1;

    if (db) {
      await db.collection<MongoNotification>('notifications').insertOne(notifDoc);

      // 3. Atomically Update Snapshot (upsert)
      const snapshotResult = await db.collection<MongoNotificationSnapshot>('notification_snapshots').findOneAndUpdate(
        { $or: [{ user_id: userId }, { user_id: cleanUserId }] },
        {
          $inc: { unread_count: 1, total_count: 1 },
          $set: {
            user_id: userId,
            last_notification_id: notifDoc.id,
            last_notification_at: now,
            updated_at: now
          }
        },
        { upsert: true, returnDocument: 'after' }
      );

      if (snapshotResult && snapshotResult.unread_count !== undefined) {
        newUnreadCount = Math.max(0, snapshotResult.unread_count);
        newTotalCount = snapshotResult.total_count || 1;
      }
    } else {
      memoryNotifications.unshift(notifDoc);

      const mem = memorySnapshots.get(userId) || {
        _id: new ObjectId(),
        user_id: userId,
        unread_count: 0,
        total_count: 0,
        updated_at: now
      };
      mem.unread_count = Math.max(0, (mem.unread_count || 0) + 1);
      mem.total_count = (mem.total_count || 0) + 1;
      mem.last_notification_id = notifDoc.id;
      mem.last_notification_at = now;
      mem.updated_at = now;
      memorySnapshots.set(userId, mem);
      memorySnapshots.set(cleanUserId, mem);

      newUnreadCount = mem.unread_count;
      newTotalCount = mem.total_count;
    }

    // 4. Realtime Broadcast via SSE (Instant live update)
    const realtimePayload = {
      type: 'NOTIFICATION_RECEIVED',
      snapshot: {
        unread_count: newUnreadCount,
        total_count: newTotalCount,
        updated_at: now.toISOString()
      },
      notification: {
        id: notifDoc.id || notifDoc._id.toString(),
        userId: notifDoc.user_id,
        title: notifDoc.title,
        message: notifDoc.message,
        type: notifDoc.type,
        isRead: false,
        linkUrl: notifDoc.link_url,
        createdAt: notifDoc.created_at.toISOString()
      }
    };

    notificationStreamManager.broadcastToUser(userId, realtimePayload);

    // 5. Asynchronous Web Push Dispatch (Non-blocking resilience)
    this.dispatchWebPush(userId, {
      title,
      body: message,
      icon: '/logo.svg',
      badge: '/icon-scrolic.svg',
      data: {
        id: notifDoc.id,
        eventId: finalEventId,
        url: linkUrl || '/',
        type
      }
    }).catch((pushErr) => {
      console.warn('[NotificationService] Web push background error:', pushErr.message);
    });

    return notifDoc;
  }

  /**
   * Multi-device Web Push Dispatch
   */
  async dispatchWebPush(userId: string, payload: { title: string; body: string; icon?: string; badge?: string; data?: any }) {
    const cleanUserId = userId.replace(/^user-/, '');
    const db = getDatabase();
    let subscriptions: MongoPushSubscription[] = [];

    if (db) {
      subscriptions = await db.collection<MongoPushSubscription>('push_subscriptions').find({
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      }).toArray();
    } else {
      subscriptions = memoryPushSubscriptions.filter(
        (s) => s.user_id === userId || s.user_id === cleanUserId
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      return;
    }

    const payloadString = JSON.stringify(payload);
    const expiredEndpoints: string[] = [];

    const sendPromises = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth
            }
          },
          payloadString,
          {
            TTL: 86400, // 1 day
            urgency: 'high'
          }
        );
      } catch (err: any) {
        // HTTP 404 Not Found or 410 Gone indicates expired or revoked subscription
        if (err.statusCode === 404 || err.statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
        } else {
          console.warn(`[WebPush] Push notification send failure for endpoint ${sub.endpoint.slice(0, 30)}...:`, err.message);
        }
      }
    });

    await Promise.allSettled(sendPromises);

    // Auto-clean expired subscriptions
    if (expiredEndpoints.length > 0) {
      if (db) {
        await db.collection('push_subscriptions').deleteMany({
          endpoint: { $in: expiredEndpoints }
        });
      } else {
        memoryPushSubscriptions = memoryPushSubscriptions.filter(
          (s) => !expiredEndpoints.includes(s.endpoint)
        );
      }
    }
  }

  /**
   * Register or update push subscription for a user & device
   */
  async registerPushSubscription(userId: string, subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    deviceId?: string;
    userAgent?: string;
  }): Promise<MongoPushSubscription> {
    const now = new Date();
    const doc: MongoPushSubscription = {
      _id: new ObjectId(),
      user_id: userId,
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      device_id: subscription.deviceId,
      user_agent: subscription.userAgent,
      created_at: now,
      updated_at: now
    };

    const db = getDatabase();
    if (db) {
      await db.collection<MongoPushSubscription>('push_subscriptions').updateOne(
        { endpoint: subscription.endpoint },
        { 
          $set: { 
            user_id: userId,
            keys: subscription.keys,
            device_id: subscription.deviceId,
            user_agent: subscription.userAgent,
            updated_at: now
          },
          $setOnInsert: { created_at: now }
        },
        { upsert: true }
      );
    } else {
      const idx = memoryPushSubscriptions.findIndex((s) => s.endpoint === subscription.endpoint);
      if (idx !== -1) {
        memoryPushSubscriptions[idx] = { ...memoryPushSubscriptions[idx], ...doc };
      } else {
        memoryPushSubscriptions.push(doc);
      }
    }

    return doc;
  }

  /**
   * Unregister a push subscription endpoint
   */
  async unregisterPushSubscription(userId: string, endpoint: string): Promise<boolean> {
    const cleanUserId = userId.replace(/^user-/, '');
    const db = getDatabase();

    if (db) {
      const res = await db.collection<MongoPushSubscription>('push_subscriptions').deleteOne({
        endpoint,
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      });
      return (res.deletedCount || 0) > 0;
    }

    const initialLen = memoryPushSubscriptions.length;
    memoryPushSubscriptions = memoryPushSubscriptions.filter(
      (s) => s.endpoint !== endpoint || (s.user_id !== userId && s.user_id !== cleanUserId)
    );
    return memoryPushSubscriptions.length < initialLen;
  }

  /**
   * Fetch paginated notifications
   */
  async getNotifications(userId: string, options: { page?: number; limit?: number; cursor?: string; unreadOnly?: boolean } = {}) {
    const cleanUserId = userId.replace(/^user-/, '');
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 20));
    const skip = (page - 1) * limit;
    const db = getDatabase();

    const filter: any = {
      $or: [{ user_id: userId }, { user_id: cleanUserId }]
    };

    if (options.unreadOnly) {
      filter.is_read = false;
    }

    if (options.cursor) {
      filter.created_at = { $lt: new Date(options.cursor) };
    }

    let items: MongoNotification[] = [];
    let total = 0;

    if (db) {
      total = await db.collection<MongoNotification>('notifications').countDocuments({
        $or: [{ user_id: userId }, { user_id: cleanUserId }]
      });

      items = await db.collection<MongoNotification>('notifications')
        .find(filter)
        .sort({ created_at: -1 })
        .skip(options.cursor ? 0 : skip)
        .limit(limit)
        .toArray();
    } else {
      const allForUser = memoryNotifications.filter(
        (n) => (n.user_id === userId || n.user_id === cleanUserId) && (!options.unreadOnly || !n.is_read)
      );
      total = allForUser.length;

      let filtered = allForUser;
      if (options.cursor) {
        const cursorDate = new Date(options.cursor).getTime();
        filtered = filtered.filter((n) => n.created_at.getTime() < cursorDate);
      }

      items = filtered.slice(options.cursor ? 0 : skip, (options.cursor ? 0 : skip) + limit);
    }

    const snapshot = await this.getSnapshot(userId);
    const hasMore = (options.cursor ? items.length === limit : skip + items.length < total);
    const nextCursor = items.length > 0 ? items[items.length - 1].created_at.toISOString() : null;

    return {
      notifications: items.map((n) => ({
        id: n.id || n._id.toString(),
        userId: n.user_id,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.is_read,
        linkUrl: n.link_url || '/',
        createdAt: n.created_at.toISOString()
      })),
      snapshot,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore,
        nextCursor
      }
    };
  }

  /**
   * Mark a single notification as read & atomically decrement snapshot
   */
  async markAsRead(userId: string, notificationId: string): Promise<{ success: boolean; snapshot: any }> {
    const cleanUserId = userId.replace(/^user-/, '');
    const now = new Date();
    const db = getDatabase();

    let wasUnread = false;

    if (db) {
      const existing = await db.collection<MongoNotification>('notifications').findOne({
        $or: [{ id: notificationId }, { _id: ObjectId.isValid(notificationId) ? new ObjectId(notificationId) : undefined } as any],
        $and: [{ $or: [{ user_id: userId }, { user_id: cleanUserId }] }]
      });

      if (existing && !existing.is_read) {
        wasUnread = true;
        await db.collection<MongoNotification>('notifications').updateOne(
          { _id: existing._id },
          { $set: { is_read: true, read_at: now } }
        );

        // Atomically update snapshot (ensure non-negative)
        await db.collection<MongoNotificationSnapshot>('notification_snapshots').updateOne(
          { $or: [{ user_id: userId }, { user_id: cleanUserId }] },
          [
            {
              $set: {
                unread_count: { $max: [0, { $subtract: ['$unread_count', 1] }] },
                updated_at: now
              }
            }
          ]
        );
      }
    } else {
      const notif = memoryNotifications.find(
        (n) => (n.id === notificationId || n._id.toString() === notificationId) &&
               (n.user_id === userId || n.user_id === cleanUserId)
      );

      if (notif && !notif.is_read) {
        wasUnread = true;
        notif.is_read = true;
        notif.read_at = now;

        const mem = memorySnapshots.get(userId) || memorySnapshots.get(cleanUserId);
        if (mem) {
          mem.unread_count = Math.max(0, (mem.unread_count || 1) - 1);
          mem.updated_at = now;
        }
      }
    }

    const snapshot = await this.getSnapshot(userId);

    // Broadcast snapshot update to SSE stream
    if (wasUnread) {
      notificationStreamManager.broadcastToUser(userId, {
        type: 'SNAPSHOT_UPDATED',
        snapshot,
        readNotificationId: notificationId
      });
    }

    return { success: true, snapshot };
  }

  /**
   * Mark all notifications as read & reset snapshot count to 0 atomically
   */
  async markAllAsRead(userId: string): Promise<{ success: boolean; snapshot: any }> {
    const cleanUserId = userId.replace(/^user-/, '');
    const now = new Date();
    const db = getDatabase();

    if (db) {
      await db.collection<MongoNotification>('notifications').updateMany(
        { 
          $or: [{ user_id: userId }, { user_id: cleanUserId }],
          is_read: false 
        },
        { $set: { is_read: true, read_at: now } }
      );

      await db.collection<MongoNotificationSnapshot>('notification_snapshots').updateOne(
        { $or: [{ user_id: userId }, { user_id: cleanUserId }] },
        {
          $set: {
            unread_count: 0,
            updated_at: now
          }
        },
        { upsert: true }
      );
    } else {
      memoryNotifications.forEach((n) => {
        if ((n.user_id === userId || n.user_id === cleanUserId) && !n.is_read) {
          n.is_read = true;
          n.read_at = now;
        }
      });

      const mem = memorySnapshots.get(userId) || memorySnapshots.get(cleanUserId);
      if (mem) {
        mem.unread_count = 0;
        mem.updated_at = now;
      }
    }

    const snapshot = await this.getSnapshot(userId);

    // Broadcast snapshot reset to SSE stream
    notificationStreamManager.broadcastToUser(userId, {
      type: 'SNAPSHOT_UPDATED',
      snapshot,
      allRead: true
    });

    return { success: true, snapshot };
  }
}

export const notificationService = new NotificationService();
