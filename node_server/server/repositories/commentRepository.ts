import { ObjectId, Filter } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoComment } from '../models/types';
import { SEED_COMMENTS } from '../db/seedData';

let memoryComments: MongoComment[] = [...SEED_COMMENTS];

export class CommentRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoComment>('comments') : null;
  }

  async findByPostId(postId: string): Promise<MongoComment[]> {
    const col = this.collection;
    if (col) {
      return await col.find({ post_id: postId }).sort({ created_at: 1 }).toArray();
    }
    return memoryComments.filter((c) => c.post_id === postId);
  }

  async create(comment: Partial<MongoComment>): Promise<MongoComment> {
    const now = new Date();
    const doc: MongoComment = {
      _id: new ObjectId(),
      id: comment.id || `comm-${Date.now()}`,
      post_id: comment.post_id || '',
      user_id: comment.user_id || '',
      text: comment.text || '',
      created_at: now,
      updated_at: now
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryComments.push(doc);
    }
    return doc;
  }

  async countByPostId(postId: string): Promise<number> {
    const col = this.collection;
    if (col) {
      return await col.countDocuments({ post_id: postId });
    }
    return memoryComments.filter((c) => c.post_id === postId).length;
  }
}

export const commentRepository = new CommentRepository();
