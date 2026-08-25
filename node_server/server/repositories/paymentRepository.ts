import { ObjectId } from 'mongodb';
import { getDatabase } from '../config/database';
import { MongoPayment } from '../models/types';

let memoryPayments: MongoPayment[] = [];

export class PaymentRepository {
  private get collection() {
    const db = getDatabase();
    return db ? db.collection<MongoPayment>('payments') : null;
  }

  async findById(id: string): Promise<MongoPayment | null> {
    const col = this.collection;
    if (col) {
      if (ObjectId.isValid(id)) {
        const found = await col.findOne({ _id: new ObjectId(id) });
        if (found) return found;
      }
      return await col.findOne({ id } as any);
    }
    return memoryPayments.find((p) => (p.id === id || p._id?.toString() === id)) || null;
  }

  async findByMayarInvoiceId(mayarInvoiceId: string): Promise<MongoPayment | null> {
    const col = this.collection;
    if (col) {
      return await col.findOne({ mayar_invoice_id: mayarInvoiceId });
    }
    return memoryPayments.find((p) => p.mayar_invoice_id === mayarInvoiceId) || null;
  }

  async findByUserId(userId: string, limit = 50): Promise<MongoPayment[]> {
    const col = this.collection;
    if (col) {
      return await col.find({ user_id: userId }).sort({ created_at: -1 }).limit(limit).toArray();
    }
    return memoryPayments.filter((p) => p.user_id === userId).slice(0, limit);
  }

  async create(payment: Partial<MongoPayment>): Promise<MongoPayment> {
    const now = new Date();
    const doc: MongoPayment = {
      _id: new ObjectId(),
      id: payment.id || `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      user_id: payment.user_id || '',
      amount: payment.amount || 0,
      energy_amount: payment.energy_amount || 0,
      mayar_invoice_id: payment.mayar_invoice_id || '',
      status: payment.status || 'pending',
      payment_method: payment.payment_method || 'qris',
      checkout_url: payment.checkout_url || '',
      qr_code: payment.qr_code || '',
      package_id: payment.package_id,
      customer_name: payment.customer_name,
      customer_email: payment.customer_email,
      customer_mobile: payment.customer_mobile,
      raw_response: payment.raw_response,
      webhook_payload: payment.webhook_payload,
      created_at: now,
      paid_at: payment.paid_at || null,
      expired_at: payment.expired_at || null
    };

    const col = this.collection;
    if (col) {
      await col.insertOne(doc);
    } else {
      memoryPayments.unshift(doc);
    }
    return doc;
  }

  async update(mayarInvoiceId: string, updates: Partial<MongoPayment>): Promise<MongoPayment | null> {
    const col = this.collection;
    if (col) {
      await col.updateOne(
        { mayar_invoice_id: mayarInvoiceId },
        { $set: updates }
      );
      return await this.findByMayarInvoiceId(mayarInvoiceId);
    }

    const index = memoryPayments.findIndex((p) => p.mayar_invoice_id === mayarInvoiceId);
    if (index !== -1) {
      memoryPayments[index] = { ...memoryPayments[index], ...updates };
      return memoryPayments[index];
    }
    return null;
  }

  async updateStatus(
    mayarInvoiceId: string, 
    status: 'pending' | 'paid' | 'failed' | 'expired', 
    paidAt?: Date | null, 
    webhookPayload?: Record<string, any>
  ): Promise<MongoPayment | null> {
    const updates: Partial<MongoPayment> = { status };
    if (paidAt !== undefined) updates.paid_at = paidAt;
    if (webhookPayload) updates.webhook_payload = webhookPayload;

    return this.update(mayarInvoiceId, updates);
  }
}

export const paymentRepository = new PaymentRepository();
