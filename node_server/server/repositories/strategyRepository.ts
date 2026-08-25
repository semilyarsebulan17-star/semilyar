import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoStrategy } from '../models/types';
import { SEED_STRATEGIES } from '../db/seedData';

let memoryStrategies: MongoStrategy[] = [...SEED_STRATEGIES];

export class StrategyRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoStrategy>('strategies') : null;
  }

  async findAll(): Promise<MongoStrategy[]> {
    const col = this.collection;
    if (col) {
      return await col.find({ active: true }).sort({ win_rate_avg: -1 }).toArray();
    }
    return memoryStrategies.filter((s) => s.active);
  }

  async findByIdOrSlug(idOrSlug: string): Promise<MongoStrategy | null> {
    const col = this.collection;
    if (col) {
      return await col.findOne({ $or: [{ id: idOrSlug }, { slug: idOrSlug }, { template_id: idOrSlug }] });
    }
    return memoryStrategies.find((s) => s.id === idOrSlug || s.slug === idOrSlug || s.template_id === idOrSlug) || null;
  }
}

export const strategyRepository = new StrategyRepository();
