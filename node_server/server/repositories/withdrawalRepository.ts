import { ObjectId, Filter } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoWithdrawal } from '../models/types';

// In-memory fallback with initial sample withdrawals for admin testing
let memoryWithdrawals: MongoWithdrawal[] = [
  {
    _id: new ObjectId('650000000000000000000091'),
    id: 'wd-demo-1',
    user_id: 'user-sarah',
    amount_energy: 150,
    amount_idr: 75000,
    fee_idr: 0,
    net_amount_idr: 75000,
    bank_code: 'BCA',
    bank_name: 'Bank Central Asia (BCA)',
    account_number: '8830192411',
    account_holder_name: 'Sarah Lin',
    status: 'PENDING',
    reference_id: 'TRX-WD-992101',
    disbursement_id: 'BI-FAST-PENDING-01',
    notes: 'Penarikan Komisi Afiliasi 150⚡',
    created_at: new Date(Date.now() - 3600 * 1000 * 2), // 2 hours ago
  },
  {
    _id: new ObjectId('650000000000000000000092'),
    id: 'wd-demo-2',
    user_id: 'user-elena',
    amount_energy: 300,
    amount_idr: 150000,
    fee_idr: 0,
    net_amount_idr: 150000,
    bank_code: 'MANDIRI',
    bank_name: 'Bank Mandiri',
    account_number: '1370019283719',
    account_holder_name: 'Elena Rostova',
    status: 'PROCESSING',
    reference_id: 'TRX-WD-881234',
    disbursement_id: 'BFAST-1724301-8821',
    notes: 'Penarikan Komisi Setup & Copy Trade 300⚡',
    created_at: new Date(Date.now() - 3600 * 1000 * 5),
  },
  {
    _id: new ObjectId('650000000000000000000093'),
    id: 'wd-demo-3',
    user_id: 'user-ray',
    amount_energy: 80,
    amount_idr: 40000,
    fee_idr: 0,
    net_amount_idr: 40000,
    bank_code: 'BRI',
    bank_name: 'Bank Rakyat Indonesia (BRI)',
    account_number: '012901002918501',
    account_holder_name: 'Ray Pratama',
    status: 'SUCCESS',
    reference_id: 'TRX-WD-771920',
    disbursement_id: 'BI-FAST-1724289-4412',
    notes: 'Penarikan Komisi Referral Scrolic a/n Ray Pratama',
    created_at: new Date(Date.now() - 3600 * 1000 * 24),
    completed_at: new Date(Date.now() - 3600 * 1000 * 23),
  }
];

export class WithdrawalRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoWithdrawal>('withdrawals') : null;
  }

  async create(wd: Partial<MongoWithdrawal>): Promise<MongoWithdrawal> {
    const now = new Date();
    const doc: MongoWithdrawal = {
      _id: new ObjectId(),
      id: wd.id || `wd-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      user_id: wd.user_id!,
      amount_energy: wd.amount_energy || 0,
      amount_idr: wd.amount_idr || 0,
      fee_idr: wd.fee_idr || 0,
      net_amount_idr: wd.net_amount_idr || 0,
      bank_code: wd.bank_code || 'BCA',
      bank_name: wd.bank_name || 'Bank Central Asia (BCA)',
      account_number: wd.account_number || '',
      account_holder_name: wd.account_holder_name || '',
      status: wd.status || 'PENDING',
      reference_id: wd.reference_id || `TRX-WD-${Date.now().toString().slice(-6)}`,
      disbursement_id: wd.disbursement_id || `BI-FAST-${Date.now()}`,
      notes: wd.notes || 'Penarikan Komisi Referral & Setup Scrolic',
      created_at: now,
      completed_at: wd.status === 'SUCCESS' ? now : undefined
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryWithdrawals.unshift(doc);
    }
    return doc;
  }

  async findAll(filter?: { status?: string }): Promise<MongoWithdrawal[]> {
    const col = this.collection;
    if (col) {
      const q: any = {};
      if (filter?.status && filter.status !== 'ALL') {
        q.status = filter.status;
      }
      return await col.find(q).sort({ created_at: -1 }).toArray();
    }

    if (filter?.status && filter.status !== 'ALL') {
      return memoryWithdrawals.filter((w) => w.status === filter.status);
    }
    return [...memoryWithdrawals];
  }

  async findByUserId(userId: string): Promise<MongoWithdrawal[]> {
    const col = this.collection;
    if (col) {
      return await col.find({ user_id: userId } as Filter<MongoWithdrawal>).sort({ created_at: -1 }).toArray();
    }
    return memoryWithdrawals.filter((w) => w.user_id === userId);
  }

  async findById(id: string): Promise<MongoWithdrawal | null> {
    const col = this.collection;
    if (col) {
      if (ObjectId.isValid(id)) {
        const byOid = await col.findOne({ _id: new ObjectId(id) });
        if (byOid) return byOid;
      }
      return await col.findOne({ id } as Filter<MongoWithdrawal>);
    }
    return memoryWithdrawals.find((w) => w.id === id || w._id.toString() === id) || null;
  }

  async updateStatus(
    id: string, 
    status: 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED', 
    notes?: string, 
    disbursementId?: string
  ): Promise<MongoWithdrawal | null> {
    const now = new Date();
    const updates: Partial<MongoWithdrawal> = {
      status,
      ...(notes ? { notes } : {}),
      ...(disbursementId ? { disbursement_id: disbursementId } : {}),
      ...(status === 'SUCCESS' || status === 'FAILED' ? { completed_at: now } : {})
    };

    const col = this.collection;
    if (col) {
      const query = ObjectId.isValid(id) ? { $or: [{ _id: new ObjectId(id) }, { id }] } : { id };
      await col.updateOne(query as Filter<MongoWithdrawal>, { $set: updates });
      return await this.findById(id);
    }

    const item = memoryWithdrawals.find((w) => w.id === id || w._id.toString() === id);
    if (item) {
      Object.assign(item, updates);
      return item;
    }
    return null;
  }
}

export const withdrawalRepository = new WithdrawalRepository();
