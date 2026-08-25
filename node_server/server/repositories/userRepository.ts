import { ObjectId, Filter } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoUser } from '../models/types';
import { SEED_USERS } from '../db/seedData';

// In-memory fallback store initialized with seeds
let memoryUsers: MongoUser[] = [...SEED_USERS];

export class UserRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoUser>('users') : null;
  }

  async findById(id: string): Promise<MongoUser | null> {
    const col = this.collection;
    if (col) {
      if (ObjectId.isValid(id)) {
        const byOid = await col.findOne({ _id: new ObjectId(id) });
        if (byOid) return byOid;
      }
      return await col.findOne({ $or: [{ id }, { username: id }] } as Filter<MongoUser>);
    }
    return memoryUsers.find((u) => u.id === id || u.username === id || u._id.toString() === id) || null;
  }

  async findByUsername(username: string): Promise<MongoUser | null> {
    const clean = username.toLowerCase().trim();
    const col = this.collection;
    if (col) {
      return await col.findOne({ username: clean });
    }
    return memoryUsers.find((u) => u.username.toLowerCase() === clean) || null;
  }

  async findByEmail(email: string): Promise<MongoUser | null> {
    const clean = email.toLowerCase().trim();
    const col = this.collection;
    if (col) {
      return await col.findOne({ email: clean });
    }
    return memoryUsers.find((u) => u.email?.toLowerCase() === clean) || null;
  }

  async findByReferralCode(code: string): Promise<MongoUser | null> {
    const clean = code.toUpperCase().trim();
    const col = this.collection;
    if (col) {
      return await col.findOne({ referral_code: clean });
    }
    return memoryUsers.find((u) => u.referral_code?.toUpperCase() === clean) || null;
  }

  async findAll(limit = 50): Promise<MongoUser[]> {
    const col = this.collection;
    if (col) {
      return await col.find().sort({ followers_count: -1 }).limit(limit).toArray();
    }
    return [...memoryUsers];
  }

  async create(user: Partial<MongoUser>): Promise<MongoUser> {
    const now = new Date();
    const doc: MongoUser = {
      _id: new ObjectId(),
      id: user.id || `user-${user.username}`,
      username: (user.username || 'trader').toLowerCase().trim(),
      display_name: user.display_name || user.username || 'Trader',
      email: user.email,
      avatar: user.avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`,
      bio: user.bio || '',
      role: user.role || 'user',
      is_banned: user.is_banned || false,
      premium: user.premium || false,
      premium_until: user.premium_until || null,
      subscription_tier: user.subscription_tier || 'free',
      energy: user.energy ?? 0,
      followers_count: user.followers_count ?? 0,
      following_count: user.following_count ?? 0,
      trades_count: user.trades_count ?? 0,
      win_rate: user.win_rate ?? 75.0,
      is_verified: user.is_verified ?? true,
      strategy_dna: user.strategy_dna || 'breakout',
      primary_strategy_id: user.primary_strategy_id || 'breakout',
      following_list: user.following_list || [],
      saved_post_ids: user.saved_post_ids || [],
      referral_code: user.referral_code || (user.username?.toUpperCase() + '50'),
      referrer_id: user.referrer_id,
      referrals_count: user.referrals_count ?? 0,
      affiliate_earnings_energy: user.affiliate_earnings_energy ?? 0,
      ctrader_account_id: user.ctrader_account_id || `cTrader-${Math.floor(100000 + Math.random() * 900000)}`,
      ctrader_accounts: user.ctrader_accounts || [],
      ctrader_connected: user.ctrader_connected ?? true,
      created_at: now,
      updated_at: now
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryUsers.push(doc);
    }
    return doc;
  }

  async update(id: string, updates: Partial<MongoUser>): Promise<MongoUser | null> {
    const now = new Date();
    const cleanUpdates = { ...updates, updated_at: now };

    const col = this.collection;
    if (col) {
      const query = ObjectId.isValid(id) ? { $or: [{ _id: new ObjectId(id) }, { id }, { username: id }] } : { $or: [{ id }, { username: id }] };
      await col.updateOne(query as Filter<MongoUser>, { $set: cleanUpdates });
      return await this.findById(id);
    }

    const user = memoryUsers.find((u) => u.id === id || u.username === id || u._id.toString() === id);
    if (user) {
      Object.assign(user, cleanUpdates);
      return user;
    }
    return null;
  }

  async updateEnergy(userId: string, deltaEnergy: number): Promise<{ success: boolean; newBalance: number }> {
    const col = this.collection;
    if (col) {
      const query = ObjectId.isValid(userId) ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] } : { id: userId };
      const res = await col.findOneAndUpdate(
        query as Filter<MongoUser>,
        { $inc: { energy: deltaEnergy }, $set: { updated_at: new Date() } },
        { returnDocument: 'after' }
      );
      if (res) {
        return { success: true, newBalance: res.energy };
      }
      return { success: false, newBalance: 0 };
    }

    const user = memoryUsers.find((u) => u.id === userId || u._id.toString() === userId);
    if (user) {
      user.energy = Math.max(0, user.energy + deltaEnergy);
      user.updated_at = new Date();
      return { success: true, newBalance: user.energy };
    }
    return { success: false, newBalance: 0 };
  }
}

export const userRepository = new UserRepository();
