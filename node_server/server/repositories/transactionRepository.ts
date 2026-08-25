import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoTransaction } from '../models/types';

let memoryTransactions: MongoTransaction[] = [];

export class TransactionRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoTransaction>('transactions') : null;
  }

  async findByUserId(userId: string, limit = 50): Promise<MongoTransaction[]> {
    const col = this.collection;
    if (col) {
      return await col.find({ user_id: userId }).sort({ created_at: -1 }).limit(limit).toArray();
    }
    return memoryTransactions.filter((t) => t.user_id === userId).slice(0, limit);
  }

  async create(tx: Partial<MongoTransaction>): Promise<MongoTransaction> {
    const now = new Date();
    const doc: MongoTransaction = {
      _id: new ObjectId(),
      user_id: tx.user_id || '',
      type: tx.type || 'TOPUP',
      amount: tx.amount || 0,
      balance_before: tx.balance_before || 0,
      balance_after: tx.balance_after || 0,
      reference_id: tx.reference_id,
      status: tx.status || 'COMPLETED',
      metadata: tx.metadata || {},
      created_at: now
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryTransactions.unshift(doc);
    }
    return doc;
  }
}

export const transactionRepository = new TransactionRepository();
