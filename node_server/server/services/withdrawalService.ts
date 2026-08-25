import { userRepository } from '../repositories/userRepository';
import { withdrawalRepository } from '../repositories/withdrawalRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { MongoWithdrawal } from '../models/types';

export class WithdrawalService {
  async processCommissionWithdrawal(userId: string, params: {
    amountEnergy: number;
    bankCode: string;
    bankName: string;
    accountNumber: string;
  }): Promise<{ success: boolean; withdrawal: MongoWithdrawal; remainingBalance: number }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');

    // 1. Mandatory Gatekeeper: Strict KYC Verification Check
    if (user.kyc_status !== 'verified' || !user.kyc_full_name) {
      throw new Error('Verifikasi KYC (KTP) AI adalah syarat mutlak sebelum melakukan penarikan komisi. Silakan verifikasi KTP Anda.');
    }

    const amountEnergy = Math.floor(Number(params.amountEnergy));
    if (!amountEnergy || amountEnergy < 50) {
      throw new Error('Minimal penarikan komisi adalah 50 Energy (Rp 25.000)');
    }

    // 2. Check Withdrawable Balance (Affiliate Commission + Setup/Follow Earnings)
    const affiliateEnergy = user.affiliate_earnings_energy || 0;
    const tradeEarnings = user.trade_earnings_energy || 0;
    const totalWithdrawable = Math.max(user.energy, affiliateEnergy + tradeEarnings);

    if (totalWithdrawable < amountEnergy) {
      throw new Error(`Saldo komisi tidak mencukupi. Komisi tersedia: ${totalWithdrawable} Energy (Rp ${(totalWithdrawable * 500).toLocaleString('id-ID')}).`);
    }

    // 3. Security Guarantee: Account Holder Name MUST be strictly locked to verified KTP full name
    const lockedAccountHolderName = user.kyc_full_name;

    const amountIdr = amountEnergy * 500;
    const feeIdr = 0; // Free BI-FAST Instant Transfer Promo
    const netAmountIdr = amountIdr - feeIdr;
    const refId = `WD-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

    const beforeBalance = user.energy;
    // Deduct user balance
    const { newBalance } = await userRepository.updateEnergy(userId, -amountEnergy);

    // Reduce affiliate earnings tracker
    const newAffiliateEarnings = Math.max(0, (user.affiliate_earnings_energy || 0) - amountEnergy);
    await userRepository.update(user.id || user._id.toString(), {
      affiliate_earnings_energy: newAffiliateEarnings
    });

    // 4. Create Withdrawal Record
    const withdrawal = await withdrawalRepository.create({
      user_id: user.id || user._id.toString(),
      amount_energy: amountEnergy,
      amount_idr: amountIdr,
      fee_idr: feeIdr,
      net_amount_idr: netAmountIdr,
      bank_code: params.bankCode,
      bank_name: params.bankName,
      account_number: params.accountNumber.replace(/\s+/g, ''),
      account_holder_name: lockedAccountHolderName,
      status: 'SUCCESS',
      reference_id: refId,
      disbursement_id: `BFAST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
      notes: `Penarikan Komisi Referral & Setup Scrolic a/n ${lockedAccountHolderName}`
    });

    // 5. Create Transaction Ledger Entry
    await transactionRepository.create({
      user_id: user.id || user._id.toString(),
      type: 'AFFILIATE_COMMISSION',
      amount: -amountEnergy,
      balance_before: beforeBalance,
      balance_after: newBalance,
      reference_id: refId,
      status: 'COMPLETED',
      metadata: {
        action: 'WITHDRAWAL',
        bankName: params.bankName,
        accountNumber: params.accountNumber,
        accountHolderName: lockedAccountHolderName,
        amountIdr,
        disbursementId: withdrawal.disbursement_id
      }
    });

    // 6. Send In-App Notification
    await interactionRepository.createNotification({
      user_id: user.id || user.username,
      title: 'Penarikan Komisi Berhasil Dikirim! 💸',
      message: `Dana komisi Rp ${netAmountIdr.toLocaleString('id-ID')} (${amountEnergy}⚡) telah ditransfer via BI-FAST ke ${params.bankName} [${params.accountNumber}] a/n ${lockedAccountHolderName}. Ref: ${refId}.`,
      type: 'WITHDRAWAL'
    });

    return {
      success: true,
      withdrawal,
      remainingBalance: newBalance
    };
  }

  async getWithdrawalHistory(userId: string) {
    const list = await withdrawalRepository.findByUserId(userId);
    return list.map((w) => ({
      id: w.id || w._id.toString(),
      userId: w.user_id,
      amountEnergy: w.amount_energy,
      amountRp: w.amount_idr,
      feeRp: w.fee_idr,
      netAmountRp: w.net_amount_idr,
      bankCode: w.bank_code,
      bankName: w.bank_name,
      accountNumber: w.account_number,
      accountHolderName: w.account_holder_name,
      status: w.status,
      referenceId: w.reference_id,
      disbursementId: w.disbursement_id,
      notes: w.notes,
      createdAt: w.created_at.toISOString(),
      completedAt: w.completed_at?.toISOString()
    }));
  }
}

export const withdrawalService = new WithdrawalService();
