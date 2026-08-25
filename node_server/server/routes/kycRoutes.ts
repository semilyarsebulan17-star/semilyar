import { Router } from 'express';
import { kycService } from '../services/kycService';
import { userRepository } from '../repositories/userRepository';

export const kycRoutes = Router();

// 1. GET /api/kyc/status
kycRoutes.get('/api/kyc/status', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  const user = await userRepository.findById(currentUserId);
  if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

  res.json({
    success: true,
    kyc: {
      status: user.kyc_status || 'unverified',
      fullName: user.kyc_full_name || null,
      nik: user.kyc_nik ? `${user.kyc_nik.slice(0, 6)}******${user.kyc_nik.slice(-2)}` : null,
      rawNik: user.kyc_nik || null,
      birthDate: user.kyc_birth_date || null,
      address: user.kyc_address || null,
      verifiedAt: user.kyc_verified_at?.toISOString() || null
    },
    bankAccounts: (user.bank_accounts || []).map((b) => ({
      id: b.id,
      bankCode: b.bank_code,
      bankName: b.bank_name,
      accountNumber: b.account_number,
      accountHolderName: b.account_holder_name,
      isPrimary: b.is_primary,
      createdAt: b.created_at?.toISOString()
    }))
  });
});

// 2. POST /api/kyc/verify-ai
kycRoutes.post('/api/kyc/verify-ai', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const { ktpImageBase64, mimeType, nik, fullName, birthDate, address } = req.body;
    
    const result = await kycService.verifyKtpWithAI(currentUserId, {
      ktpImageBase64,
      mimeType,
      nik,
      fullName,
      birthDate,
      address
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// 3. POST /api/kyc/bank-account
kycRoutes.post('/api/kyc/bank-account', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const { bankCode, bankName, accountNumber } = req.body;
    if (!bankCode || !bankName || !accountNumber) {
      return res.status(400).json({ error: 'Data bank dan nomor rekening wajib diisi' });
    }

    const result = await kycService.addOrUpdateBankAccount(currentUserId, {
      bankCode,
      bankName,
      accountNumber
    });

    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
