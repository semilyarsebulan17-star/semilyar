import { MongoClient, Db } from 'mongodb';

interface DatabaseConnection {
  client: MongoClient | null;
  db: Db | null;
  isConnected: boolean;
  isMockFallback: boolean;
}

const state: DatabaseConnection = {
  client: null,
  db: null,
  isConnected: false,
  isMockFallback: false
};

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'scrolic';

/**
 * Connect to MongoDB with connection pooling
 * Falls back gracefully to memory/in-process store if MONGODB_URI is not configured in development
 */
export async function connectToDatabase(): Promise<{ db: Db | null; isConnected: boolean; isMockFallback: boolean }> {
  if (state.db && state.isConnected) {
    return { db: state.db, isConnected: state.isConnected, isMockFallback: state.isMockFallback };
  }

  const uri = process.env.MONGODB_URI?.trim();
  const isValidMongoUri = Boolean(uri && (uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://')));

  if (!isValidMongoUri) {
    console.log('[MongoDB] MONGODB_URI is not set or not a valid mongodb scheme. Running in high-performance Memory Repository mode.');
    state.isMockFallback = true;
    state.isConnected = false;
    return { db: null, isConnected: false, isMockFallback: true };
  }

  try {
    const client = new MongoClient(uri!, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 4000,
      connectTimeoutMS: 5000
    });

    await client.connect();
    state.client = client;
    state.db = client.db(MONGODB_DB_NAME);
    state.isConnected = true;
    state.isMockFallback = false;

    console.log(`[MongoDB] Connected successfully to database: ${MONGODB_DB_NAME} (pool size: 20)`);
    return { db: state.db, isConnected: true, isMockFallback: false };
  } catch (error: any) {
    console.error(`[MongoDB] Connection error: ${error.message}. Activating Memory Fallback.`);
    state.isConnected = false;
    state.isMockFallback = true;
    return { db: null, isConnected: false, isMockFallback: true };
  }
}

export function getDatabase(): Db | null {
  return state.db;
}

export function isDatabaseConnected(): boolean {
  return state.isConnected;
}

export async function closeDatabase(): Promise<void> {
  if (state.client) {
    await state.client.close();
    state.client = null;
    state.db = null;
    state.isConnected = false;
    console.log('[MongoDB] Connection closed.');
  }
}
