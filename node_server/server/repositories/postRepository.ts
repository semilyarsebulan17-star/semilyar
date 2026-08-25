import { ObjectId, Filter } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoPost } from '../models/types';
import { SEED_POSTS } from '../db/seedData';

let memoryPosts: MongoPost[] = [...SEED_POSTS];

export interface FeedQueryOptions {
  limit?: number;
  cursor?: string | null; // ISO Date string cursor
  strategyId?: string;
  userId?: string;
  userFilterList?: string[]; // For 'following' feed
  status?: 'OPEN' | 'CLOSED';
}

export interface PaginatedFeedResult {
  posts: MongoPost[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
}

export class PostRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoPost>('posts') : null;
  }

  async findById(id: string): Promise<MongoPost | null> {
    const col = this.collection;
    if (col) {
      if (ObjectId.isValid(id)) {
        const byOid = await col.findOne({ _id: new ObjectId(id) });
        if (byOid) return byOid;
      }
      return await col.findOne({ $or: [{ id }, { trade_id: id }] } as Filter<MongoPost>);
    }
    return memoryPosts.find((p) => p.id === id || p.trade_id === id || p._id.toString() === id) || null;
  }

  async findFeedWithCursor(options: FeedQueryOptions): Promise<PaginatedFeedResult> {
    const limit = Math.min(options.limit || 10, 50);
    const col = this.collection;

    if (col) {
      const filter: Filter<MongoPost> = {};

      if (options.cursor) {
        const cursorDate = new Date(options.cursor);
        if (!isNaN(cursorDate.getTime())) {
          filter.created_at = { $lt: cursorDate };
        }
      }

      if (options.strategyId && options.strategyId !== 'ALL') {
        filter.strategy_id = options.strategyId;
      }

      if (options.userId) {
        filter.user_id = options.userId;
      }

      if (options.userFilterList && options.userFilterList.length > 0) {
        filter.username = { $in: options.userFilterList };
      }

      if (options.status) {
        filter.status = options.status;
      }

      // Fetch limit + 1 items to determine hasMore
      const results = await col
        .find(filter)
        .sort({ created_at: -1 })
        .limit(limit + 1)
        .toArray();

      const hasMore = results.length > limit;
      const posts = hasMore ? results.slice(0, limit) : results;
      const nextCursor = posts.length > 0 ? posts[posts.length - 1].created_at.toISOString() : null;
      const totalCount = await col.countDocuments(filter);

      return {
        posts,
        nextCursor: hasMore ? nextCursor : null,
        hasMore,
        totalCount
      };
    }

    // Memory Fallback
    let filtered = [...memoryPosts];

    if (options.strategyId && options.strategyId !== 'ALL') {
      filtered = filtered.filter((p) => p.strategy_id === options.strategyId);
    }

    if (options.userId) {
      filtered = filtered.filter((p) => p.user_id === options.userId);
    }

    if (options.userFilterList && options.userFilterList.length > 0) {
      filtered = filtered.filter((p) => options.userFilterList!.includes(p.username));
    }

    if (options.status) {
      filtered = filtered.filter((p) => p.status === options.status);
    }

    filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (options.cursor) {
      const cursorTime = new Date(options.cursor).getTime();
      filtered = filtered.filter((p) => new Date(p.created_at).getTime() < cursorTime);
    }

    const totalCount = filtered.length;
    const hasMore = filtered.length > limit;
    const posts = filtered.slice(0, limit);
    const nextCursor = posts.length > 0 && hasMore ? posts[posts.length - 1].created_at.toISOString() : null;

    return {
      posts,
      nextCursor,
      hasMore,
      totalCount
    };
  }

  async create(post: Partial<MongoPost>): Promise<MongoPost> {
    const now = new Date();
    const doc: MongoPost = {
      _id: new ObjectId(),
      id: post.id || `post-${Date.now()}`,
      user_id: post.user_id || 'user-unknown',
      username: post.username || 'trader',
      avatar: post.avatar || '',
      trade_id: post.trade_id || `trade-${Date.now()}`,
      symbol: post.symbol || 'XAUUSD',
      market: post.market || 'Commodity',
      strategy_id: post.strategy_id || 'breakout',
      strategy_name: post.strategy_name || 'BREAKOUT HUNTER',
      position_type: post.position_type || 'BUY',
      status: post.status || 'OPEN',
      entry_price: post.entry_price || 0,
      current_price: post.current_price || post.entry_price || 0,
      progress: post.progress || 50,
      profit: post.profit || 0,
      profit_percent: post.profit_percent || 0,
      lot: post.lot || 1.0,
      stop_loss: post.stop_loss,
      take_profit: post.take_profit,
      pips: post.pips || 0,
      duration: post.duration || 'Live',
      opened_at: post.opened_at || now,
      closed_at: post.closed_at || null,
      visibility: post.visibility || 'LOCKED',
      unlock_price: post.unlock_price || 1,
      follow_price: post.follow_price || 1,
      auto_description: post.auto_description || '',
      custom_description: post.custom_description,
      likes_count: post.likes_count || 0,
      comments_count: post.comments_count || 0,
      liked_by_user_ids: post.liked_by_user_ids || [],
      created_at: now,
      updated_at: now
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryPosts.unshift(doc);
    }
    return doc;
  }

  async update(id: string, updates: Partial<MongoPost>): Promise<MongoPost | null> {
    const cleanUpdates = { ...updates, updated_at: new Date() };
    const col = this.collection;
    if (col) {
      const query = ObjectId.isValid(id) ? { $or: [{ _id: new ObjectId(id) }, { id }] } : { id };
      await col.updateOne(query as Filter<MongoPost>, { $set: cleanUpdates });
      return await this.findById(id);
    }

    const post = memoryPosts.find((p) => p.id === id || p._id.toString() === id);
    if (post) {
      Object.assign(post, cleanUpdates);
      return post;
    }
    return null;
  }

  async updateLivePrice(postId: string, currentPrice: number, pips: number, profit: number, progress: number): Promise<void> {
    const col = this.collection;
    if (col) {
      const query = ObjectId.isValid(postId) ? { $or: [{ _id: new ObjectId(postId) }, { id: postId }] } : { id: postId };
      await col.updateOne(query as Filter<MongoPost>, {
        $set: {
          current_price: currentPrice,
          pips,
          profit,
          progress,
          updated_at: new Date()
        }
      });
      return;
    }

    const p = memoryPosts.find((item) => item.id === postId || item._id.toString() === postId);
    if (p) {
      p.current_price = currentPrice;
      p.pips = pips;
      p.profit = profit;
      p.progress = progress;
      p.updated_at = new Date();
    }
  }
}

export const postRepository = new PostRepository();
