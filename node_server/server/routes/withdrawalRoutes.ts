import { Router } from 'express';
import { withdrawalService } from '../services/withdrawalService';
import { userRepository } from '../repositories/userRepository';

export const withdrawalRoutes = Router();

// Master list of supported Indonesian Banks & E-Wallets for instant withdrawal
const SUPPORTED_BANKS = [
  { code: 'BCA', name: 'Bank Central Asia (BCA)', type: 'BANK', icon: 'Building2' },
  { code: 'MANDIRI', name: 'Bank Mandiri', type: 'BANK', icon: 'Building2' },
  { code: 'BRI', name: 'Bank Rakyat Indonesia (BRI)', type: 'BANK', icon: 'Building2' },
  { code: 'BNI', name: 'Bank Negara Indonesia (BNI)', type: 'BANK', icon: 'Building2' },
  { code: 'BSI', name: 'Bank Syariah Indonesia (BSI)', type: 'BANK', icon: 'Building2' },
  { code: 'JAGO', name: 'Bank Jago', type: 'BANK', icon: 'Building2' },
  { code: 'SEABANK', name: 'SeaBank Indonesia', type: 'BANK', icon: 'Building2' },
  { code: 'BLU', name: 'Blu by BCA Digital', type: 'BANK', icon: 'Building2' },
  { code: 'CIMB', name: 'Bank CIMB Niaga', type: 'BANK', icon: 'Building2' },
  { code: 'DANA', name: 'DANA (E-Wallet)', type: 'EWALLET', icon: 'Wallet' },
  { code: 'GOPAY', name: 'GoPay (E-Wallet)', type: 'EWALLET', icon: 'Wallet' },
  { code: 'OVO', name: 'OVO (E-Wallet)', type: 'EWALLET', icon: 'Wallet' },
  { code: 'SHOPEEPAY', name: 'ShopeePay (E-Wallet)', type: 'EWALLET', icon: 'Wallet' }
];

// 1. GET /api/withdrawals/banks
withdrawalRoutes.get('/api/withdrawals/banks', (req, res) => {
  res.json({
    success: true,
    banks: SUPPORTED_BANKS
  });
});

// 2. GET /api/withdrawals/history
withdrawalRoutes.get('/api/withdrawals/history', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const history = await withdrawalService.getWithdrawalHistory(currentUserId);
    res.json({
      success: true,
      withdrawals: history
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 3. POST /api/withdrawals/create
withdrawalRoutes.post('/api/withdrawals/create', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const { amountEnergy, bankCode, bankName, accountNumber } = req.body;

    if (!amountEnergy || !bankCode || !accountNumber) {
      return res.status(400).json({ error: 'Jumlah penarikan, bank, dan nomor rekening wajib diisi' });
    }

    const selectedBank = SUPPORTED_BANKS.find((b) => b.code === bankCode);
    const resolvedBankName = bankName || selectedBank?.name || bankCode;

    const result = await withdrawalService.processCommissionWithdrawal(currentUserId, {
      amountEnergy: Number(amountEnergy),
      bankCode,
      bankName: resolvedBankName,
      accountNumber
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 4. GET /api/withdrawals/stats
withdrawalRoutes.get('/api/withdrawals/stats', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  const history = await withdrawalService.getWithdrawalHistory(currentUserId);
  const totalWithdrawnRp = history.filter((w) => w.status === 'SUCCESS').reduce((acc, curr) => acc + curr.netAmountRp, 0);
  const totalWithdrawnEnergy = history.filter((w) => w.status === 'SUCCESS').reduce((acc, curr) => acc + curr.amountEnergy, 0);

  const affiliateEarnings = user.affiliate_earnings_energy || 0;
  const tradeEarnings = user.trade_earnings_energy || 0;
  const availableEarnings = affiliateEarnings + tradeEarnings;

  res.json({
    success: true,
    availableEnergy: user.energy,
    availableEarningsEnergy: availableEarnings,
    availableEarningsRp: availableEarnings * 500,
    totalWithdrawnEnergy,
    totalWithdrawnRp,
    kycStatus: user.kyc_status || 'unverified',
    kycFullName: user.kyc_full_name || null,
    isKycVerified: user.kyc_status === 'verified',
    primaryBankAccount: user.bank_accounts && user.bank_accounts.length > 0 ? user.bank_accounts[0] : null
  });
});
