import { getDatabase, connectToDatabase, closeDatabase } from '../config/database';
import { ensureIndexes } from '../db/indexes';
import { SEED_USERS, SEED_POSTS, SEED_STRATEGIES, SEED_COMMENTS, SEED_NOTIFICATIONS } from '../db/seedData';

export async function runDatabaseSeeding(): Promise<void> {
  const { db, isConnected } = await connectToDatabase();
  if (!db || !isConnected) {
    console.log('[Seed] Database not connected. Skipped seeding to physical MongoDB (using Memory Repository).');
    return;
  }

  console.log('[Seed] Starting database migration & initial seeding...');
  await ensureIndexes(db);

  // 1. Users
  const userCount = await db.collection('users').countDocuments();
  if (userCount === 0) {
    await db.collection('users').insertMany(SEED_USERS as any[]);
    console.log(`[Seed] Inserted ${SEED_USERS.length} seed users.`);
  }

  // 2. Posts
  const postCount = await db.collection('posts').countDocuments();
  if (postCount === 0) {
    await db.collection('posts').insertMany(SEED_POSTS as any[]);
    console.log(`[Seed] Inserted ${SEED_POSTS.length} seed posts.`);
  }

  // 3. Strategies
  const stratCount = await db.collection('strategies').countDocuments();
  if (stratCount === 0) {
    await db.collection('strategies').insertMany(SEED_STRATEGIES as any[]);
    console.log(`[Seed] Inserted ${SEED_STRATEGIES.length} seed strategies.`);
  }

  // 4. Comments
  const commentCount = await db.collection('comments').countDocuments();
  if (commentCount === 0) {
    await db.collection('comments').insertMany(SEED_COMMENTS as any[]);
    console.log(`[Seed] Inserted ${SEED_COMMENTS.length} seed comments.`);
  }

  // 5. Notifications
  const notifCount = await db.collection('notifications').countDocuments();
  if (notifCount === 0) {
    await db.collection('notifications').insertMany(SEED_NOTIFICATIONS as any[]);
    console.log(`[Seed] Inserted ${SEED_NOTIFICATIONS.length} seed notifications.`);
  }

  console.log('[Seed] MongoDB initialization completed successfully.');
}

// Standalone execution check
if (process.argv[1] && process.argv[1].includes('seed.ts')) {
  runDatabaseSeeding().then(() => {
    console.log('Seeding finished.');
    closeDatabase();
  });
}
