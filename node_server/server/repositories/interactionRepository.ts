import { ObjectId, Filter } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoLike, MongoFollow, MongoUnlock, MongoNotification } from '../models/types';
import { notificationService } from '../services/notificationService';

let memoryLikes: MongoLike[] = [];
let memoryFollows: MongoFollow[] = [];
let memoryUnlocks: MongoUnlock[] = [];

export class InteractionRepository {
  // --- LIKES ---
  async isLiked(postId: string, userId: string): Promise<boolean> {
    const db = getDatabase();
    if (db) {
      const doc = await db.collection<MongoLike>('likes').findOne({ post_id: postId, user_id: userId });
      return Boolean(doc);
    }
    return memoryLikes.some((l) => l.post_id === postId && l.user_id === userId);
  }

  async toggleLike(postId: string, userId: string): Promise<{ isLiked: boolean; likesCount: number }> {
    const db = getDatabase();
    if (db) {
      const existing = await db.collection<MongoLike>('likes').findOne({ post_id: postId, user_id: userId });
      if (existing) {
        await db.collection<MongoLike>('likes').deleteOne({ post_id: postId, user_id: userId });
        await db.collection('posts').updateOne({ id: postId }, { $inc: { likes_count: -1 }, $pull: { liked_by_user_ids: userId } as any });
      } else {
        await db.collection<MongoLike>('likes').insertOne({
          _id: new ObjectId(),
          post_id: postId,
          user_id: userId,
          created_at: new Date()
        });
        await db.collection('posts').updateOne({ id: postId }, { $inc: { likes_count: 1 }, $addToSet: { liked_by_user_ids: userId } as any });
      }
      const count = await db.collection<MongoLike>('likes').countDocuments({ post_id: postId });
      return { isLiked: !existing, likesCount: count };
    }

    const idx = memoryLikes.findIndex((l) => l.post_id === postId && l.user_id === userId);
    if (idx !== -1) {
      memoryLikes.splice(idx, 1);
      const count = memoryLikes.filter((l) => l.post_id === postId).length;
      return { isLiked: false, likesCount: count };
    } else {
      memoryLikes.push({
        _id: new ObjectId(),
        post_id: postId,
        user_id: userId,
        created_at: new Date()
      });
      const count = memoryLikes.filter((l) => l.post_id === postId).length;
      return { isLiked: true, likesCount: count };
    }
  }

  // --- FOLLOWS ---
  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const db = getDatabase();
    if (db) {
      const doc = await db.collection<MongoFollow>('follows').findOne({ follower_id: followerId, following_id: followingId });
      return Boolean(doc);
    }
    return memoryFollows.some((f) => f.follower_id === followerId && f.following_id === followingId);
  }

  async toggleFollow(followerId: string, followingId: string): Promise<{ isFollowing: boolean }> {
    const db = getDatabase();
    if (db) {
      const existing = await db.collection<MongoFollow>('follows').findOne({ follower_id: followerId, following_id: followingId });
      if (existing) {
        await db.collection<MongoFollow>('follows').deleteOne({ follower_id: followerId, following_id: followingId });
        await db.collection('users').updateOne({ $or: [{ id: followerId }, { username: followerId }] }, { $inc: { following_count: -1 } });
        await db.collection('users').updateOne({ $or: [{ id: followingId }, { username: followingId }] }, { $inc: { followers_count: -1 } });
        return { isFollowing: false };
      } else {
        await db.collection<MongoFollow>('follows').insertOne({
          _id: new ObjectId(),
          follower_id: followerId,
          following_id: followingId,
          created_at: new Date()
        });
        await db.collection('users').updateOne({ $or: [{ id: followerId }, { username: followerId }] }, { $inc: { following_count: 1 } });
        await db.collection('users').updateOne({ $or: [{ id: followingId }, { username: followingId }] }, { $inc: { followers_count: 1 } });
        return { isFollowing: true };
      }
    }

    const idx = memoryFollows.findIndex((f) => f.follower_id === followerId && f.following_id === followingId);
    if (idx !== -1) {
      memoryFollows.splice(idx, 1);
      return { isFollowing: false };
    } else {
      memoryFollows.push({
        _id: new ObjectId(),
        follower_id: followerId,
        following_id: followingId,
        created_at: new Date()
      });
      return { isFollowing: true };
    }
  }

  // --- UNLOCKS ---
  async isUnlocked(userId: string, postId: string): Promise<boolean> {
    const db = getDatabase();
    if (db) {
      const doc = await db.collection<MongoUnlock>('unlocks').findOne({ user_id: userId, post_id: postId });
      return Boolean(doc);
    }
    return memoryUnlocks.some((u) => u.user_id === userId && u.post_id === postId);
  }

  async createUnlock(userId: string, postId: string, energyCost: number): Promise<MongoUnlock> {
    const now = new Date();
    const doc: MongoUnlock = {
      _id: new ObjectId(),
      user_id: userId,
      post_id: postId,
      energy_cost: energyCost,
      created_at: now
    };

    const db = getDatabase();
    if (db) {
      await db.collection<MongoUnlock>('unlocks').insertOne(doc);
    } else {
      memoryUnlocks.push(doc);
    }
    return doc;
  }

  // --- NOTIFICATIONS (Forwarded to NotificationService for Snapshot & Realtime/Push) ---
  async findNotificationsByUser(userId: string, limit = 30): Promise<MongoNotification[]> {
    const res = await notificationService.getNotifications(userId, { limit });
    return res.notifications as any;
  }

  async createNotification(notif: Partial<MongoNotification>): Promise<MongoNotification> {
    return await notificationService.sendNotification({
      userId: notif.user_id || '',
      title: notif.title || '',
      message: notif.message || '',
      type: notif.type || 'TRADE_OPENED',
      eventId: notif.event_id,
      linkUrl: notif.link_url,
      metadata: notif.metadata
    });
  }

  async markAllNotificationsRead(userId: string): Promise<void> {
    await notificationService.markAllAsRead(userId);
  }
}

export const interactionRepository = new InteractionRepository();

