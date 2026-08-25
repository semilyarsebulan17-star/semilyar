import { Db } from 'mongodb';

/**
 * Ensures all required MongoDB indexes exist for high-performance querying
 * and unique constraint validation.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  try {
    console.log('[MongoDB Indexes] Ensuring collection indexes...');

    // 1. Users collection indexes
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    await db.collection('users').createIndex({ email: 1 }, { unique: true, sparse: true });
    await db.collection('users').createIndex({ referral_code: 1 }, { sparse: true });

    // 2. Posts collection indexes (Feed cursor & filtered queries)
    await db.collection('posts').createIndex({ created_at: -1 });
    await db.collection('posts').createIndex({ user_id: 1, created_at: -1 });
    await db.collection('posts').createIndex({ status: 1, created_at: -1 });
    await db.collection('posts').createIndex({ symbol: 1, status: 1 });
    await db.collection('posts').createIndex({ strategy_id: 1, created_at: -1 });

    // 3. Likes (Unique compound index: post_id + user_id)
    await db.collection('likes').createIndex({ post_id: 1, user_id: 1 }, { unique: true });

    // 4. Follows (Compound indexes for fast relationship resolution)
    await db.collection('follows').createIndex({ follower_id: 1, following_id: 1 }, { unique: true });
    await db.collection('follows').createIndex({ following_id: 1, follower_id: 1 });

    // 5. Comments
    await db.collection('comments').createIndex({ post_id: 1, created_at: -1 });

    // 6. Unlocks (Unique compound index: user_id + post_id)
    await db.collection('unlocks').createIndex({ user_id: 1, post_id: 1 }, { unique: true });

    // 7. Transactions (User audit history)
    await db.collection('transactions').createIndex({ user_id: 1, created_at: -1 });

    // 8. Notifications
    await db.collection('notifications').createIndex({ user_id: 1, created_at: -1 });

    console.log('[MongoDB Indexes] All collection indexes verified successfully.');
  } catch (error: any) {
    console.error('[MongoDB Indexes] Error building indexes:', error.message);
  }
}
