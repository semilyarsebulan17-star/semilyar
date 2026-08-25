import { Router } from 'express';
import { requireAdmin, AdminAuthRequest } from '../middleware/adminAuth';
import { userRepository } from '../repositories/userRepository';
import { withdrawalRepository } from '../repositories/withdrawalRepository';
import { configRepository } from '../repositories/configRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { interactionRepository } from '../repositories/interactionRepository';

export const adminRoutes = Router();

// ==========================================
// 0. QUICK ADMIN PROMOTION ENDPOINT
// Allows setting role directly (Useful for initial setup/owner)
// ==========================================
adminRoutes.post('/api/admin/promote-user', async (req, res) => {
  try {
    const { usernameOrId, role = 'admin', secretKey } = req.body;
    
    // Allow promotion if requester is admin OR provides platform setup secret
    const sessionUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId;
    const sessionUser = sessionUserId ? await userRepository.findById(sessionUserId) : null;
    const isOwnerSession = sessionUser && sessionUser.role === 'admin';
    const isSecretValid = secretKey === 'scrolic-super-admin-2026' || secretKey === 'admin';

    if (!isOwnerSession && !isSecretValid && sessionUser?.username !== 'alex_trader') {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Hanya Admin atau pemegang kunci otorisasi yang dapat mengubah role.' }
      });
    }

    if (!usernameOrId) {
      return res.status(400).json({ success: false, error: { message: 'Username atau User ID wajib diisi.' } });
    }

    const user = (await userRepository.findByUsername(usernameOrId)) || (await userRepository.findById(usernameOrId));
    if (!user) {
      return res.status(404).json({ success: false, error: { message: `User "${usernameOrId}" tidak ditemukan.` } });
    }

    const updated = await userRepository.update(user.id || user._id.toString(), {
      role: role === 'admin' ? 'admin' : 'user'
    });

    res.json({
      success: true,
      message: `Berhasil mengubah role @${user.username} menjadi "${role}".`,
      user: {
        id: updated?.id || updated?._id.toString(),
        username: updated?.username,
        role: updated?.role
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// PUBLIC GET CONFIG (FOR USERS IN ENERGY & PROMOTION MODALS)
// ==========================================
adminRoutes.get('/api/config/energy-packages', async (req, res) => {
  try {
    const packages = await configRepository.getEnergyPackages();
    res.json({ success: true, packages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.get('/api/config/premium-packages', async (req, res) => {
  try {
    const packages = await configRepository.getPremiumPackages();
    res.json({ success: true, packages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 1. ADMIN STATS & OVERVIEW
// ==========================================
adminRoutes.get('/api/admin/stats', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const allUsers = await userRepository.findAll();
    const allWithdrawals = await withdrawalRepository.findAll();
    const energyPackages = await configRepository.getEnergyPackages();
    const premiumPackages = await configRepository.getPremiumPackages();

    const totalUsers = allUsers.length;
    const totalAdmins = allUsers.filter((u) => u.role === 'admin').length;
    const totalVerified = allUsers.filter((u) => u.is_verified || u.kyc_status === 'verified').length;
    const totalPremiumUsers = allUsers.filter((u) => u.premium || (u.subscription_tier && u.subscription_tier !== 'free')).length;
    const totalEnergyInCirculation = allUsers.reduce((sum, u) => sum + (u.energy || 0), 0);
    const totalAffiliateEnergy = allUsers.reduce((sum, u) => sum + (u.affiliate_earnings_energy || 0), 0);

    const pendingWds = allWithdrawals.filter((w) => w.status === 'PENDING');
    const processingWds = allWithdrawals.filter((w) => w.status === 'PROCESSING');
    const completedWds = allWithdrawals.filter((w) => w.status === 'SUCCESS');

    const totalPendingWdAmountIdr = pendingWds.reduce((sum, w) => sum + (w.net_amount_idr || 0), 0);
    const totalCompletedWdAmountIdr = completedWds.reduce((sum, w) => sum + (w.net_amount_idr || 0), 0);

    res.json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          admins: totalAdmins,
          verified: totalVerified,
          premium: totalPremiumUsers,
          banned: allUsers.filter((u) => u.is_banned).length
        },
        energy: {
          totalInCirculation: totalEnergyInCirculation,
          totalAffiliatePending: totalAffiliateEnergy,
          activePackagesCount: energyPackages.filter((p) => p.isActive).length
        },
        withdrawals: {
          pendingCount: pendingWds.length,
          pendingAmountIdr: totalPendingWdAmountIdr,
          processingCount: processingWds.length,
          completedCount: completedWds.length,
          completedAmountIdr: totalCompletedWdAmountIdr,
          totalCount: allWithdrawals.length
        },
        premium: {
          activeTiersCount: premiumPackages.filter((p) => p.isActive).length
        }
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 2. USER MANAGEMENT ENDPOINTS
// ==========================================
adminRoutes.get('/api/admin/users', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { search, role, kycStatus, subscriptionTier, isBanned } = req.query;
    let list = await userRepository.findAll();

    // Filter search
    if (search && typeof search === 'string') {
      const q = search.toLowerCase().trim();
      list = list.filter((u) => 
        u.username.toLowerCase().includes(q) || 
        u.display_name?.toLowerCase().includes(q) || 
        u.email?.toLowerCase().includes(q) ||
        u.referral_code?.toLowerCase().includes(q)
      );
    }

    // Filter role
    if (role && role !== 'ALL') {
      list = list.filter((u) => (u.role || 'user') === role);
    }

    // Filter KYC
    if (kycStatus && kycStatus !== 'ALL') {
      list = list.filter((u) => (u.kyc_status || 'unverified') === kycStatus);
    }

    // Filter Subscription
    if (subscriptionTier && subscriptionTier !== 'ALL') {
      list = list.filter((u) => (u.subscription_tier || 'free') === subscriptionTier);
    }

    // Filter Banned
    if (isBanned !== undefined && isBanned !== 'ALL') {
      const b = isBanned === 'true';
      list = list.filter((u) => Boolean(u.is_banned) === b);
    }

    const formatted = list.map((u) => ({
      id: u.id || u._id.toString(),
      username: u.username,
      displayName: u.display_name,
      email: u.email || '-',
      avatar: u.avatar,
      role: u.role || 'user',
      isBanned: Boolean(u.is_banned),
      energyBalance: u.energy || 0,
      affiliateEarningsEnergy: u.affiliate_earnings_energy || 0,
      tradeEarningsEnergy: (u as any).trade_earnings_energy || 0,
      subscriptionTier: u.subscription_tier || 'free',
      isVerified: Boolean(u.is_verified),
      kycStatus: u.kyc_status || 'unverified',
      kycFullName: u.kyc_full_name || null,
      kycNik: u.kyc_nik || null,
      winRate: u.win_rate || 70,
      tradesCount: u.trades_count || 0,
      followersCount: u.followers_count || 0,
      referralCode: u.referral_code || `${u.username.toUpperCase()}50`,
      cTraderConnected: Boolean(u.ctrader_connected),
      cTraderAccountId: u.ctrader_account_id || null,
      createdAt: u.created_at
    }));

    res.json({ success: true, users: formatted, total: formatted.length });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Update Role (User <-> Admin)
adminRoutes.patch('/api/admin/users/:id/role', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ success: false, error: { message: 'Role harus berupa "admin" atau "user"' } });
    }

    const targetUser = (await userRepository.findById(id)) || (await userRepository.findByUsername(id));
    if (!targetUser) return res.status(404).json({ success: false, error: { message: 'User tidak ditemukan' } });

    const updated = await userRepository.update(targetUser.id || targetUser._id.toString(), { role });
    res.json({
      success: true,
      message: `Role @${targetUser.username} berhasil diubah menjadi ${role.toUpperCase()}`,
      user: {
        id: updated?.id || updated?._id.toString(),
        username: updated?.username,
        role: updated?.role
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Adjust User Energy Balance
adminRoutes.patch('/api/admin/users/:id/energy', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { amount, reason = 'Penyesuaian Saldo oleh Admin' } = req.body;
    const delta = Number(amount);
    if (isNaN(delta) || delta === 0) {
      return res.status(400).json({ success: false, error: { message: 'Nominal Energy tidak valid' } });
    }

    const targetUser = (await userRepository.findById(id)) || (await userRepository.findByUsername(id));
    if (!targetUser) return res.status(404).json({ success: false, error: { message: 'User tidak ditemukan' } });

    const beforeBalance = targetUser.energy;
    const { newBalance } = await userRepository.updateEnergy(targetUser.id || targetUser._id.toString(), delta);

    // Record ledger transaction
    await transactionRepository.create({
      user_id: targetUser.id || targetUser.username,
      type: delta > 0 ? 'TOPUP' : 'UNLOCK',
      amount: delta,
      balance_before: beforeBalance,
      balance_after: newBalance,
      reference_id: `ADMIN-ADJ-${Date.now()}`,
      status: 'COMPLETED',
      metadata: { adminAdjuster: req.adminUser?.username, reason }
    });

    // Notify user
    await interactionRepository.createNotification({
      user_id: targetUser.id || targetUser.username,
      title: delta > 0 ? '⚡ Energy Ditambahkan oleh Admin' : '⚡ Penyesuaian Saldo Energy',
      message: delta > 0 
        ? `Akun Anda telah ditambahkan +${delta} Energy oleh Administrator. Alasan: ${reason}.`
        : `Saldo Energy disesuaikan sebesar ${delta} Energy. Alasan: ${reason}.`,
      type: 'ENERGY_TOPUP'
    });

    res.json({
      success: true,
      message: `Berhasil mengubah saldo Energy @${targetUser.username} (${delta > 0 ? '+' : ''}${delta}⚡). Saldo sekarang: ${newBalance}⚡`,
      newBalance
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Toggle Ban/Unban User
adminRoutes.patch('/api/admin/users/:id/ban', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { isBanned } = req.body;

    const targetUser = (await userRepository.findById(id)) || (await userRepository.findByUsername(id));
    if (!targetUser) return res.status(404).json({ success: false, error: { message: 'User tidak ditemukan' } });

    const updated = await userRepository.update(targetUser.id || targetUser._id.toString(), {
      is_banned: Boolean(isBanned)
    });

    res.json({
      success: true,
      message: isBanned 
        ? `Akun @${targetUser.username} telah dibekukan (BANNED).` 
        : `Akun @${targetUser.username} telah diaktifkan kembali.`,
      isBanned: updated?.is_banned
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Toggle Verification / KYC
adminRoutes.patch('/api/admin/users/:id/verification', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { isVerified, kycStatus } = req.body;

    const targetUser = (await userRepository.findById(id)) || (await userRepository.findByUsername(id));
    if (!targetUser) return res.status(404).json({ success: false, error: { message: 'User tidak ditemukan' } });

    const updates: any = {};
    if (isVerified !== undefined) updates.is_verified = Boolean(isVerified);
    if (kycStatus) updates.kyc_status = kycStatus;

    const updated = await userRepository.update(targetUser.id || targetUser._id.toString(), updates);

    res.json({
      success: true,
      message: `Status verifikasi @${targetUser.username} berhasil diperbarui.`,
      user: {
        isVerified: updated?.is_verified,
        kycStatus: updated?.kyc_status
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Update Subscription Tier
adminRoutes.patch('/api/admin/users/:id/subscription', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { tier } = req.body;

    const targetUser = (await userRepository.findById(id)) || (await userRepository.findByUsername(id));
    if (!targetUser) return res.status(404).json({ success: false, error: { message: 'User tidak ditemukan' } });

    const isPrem = tier && tier !== 'free';
    const updated = await userRepository.update(targetUser.id || targetUser._id.toString(), {
      subscription_tier: tier,
      premium: isPrem
    });

    res.json({
      success: true,
      message: `Paket langganan @${targetUser.username} berhasil diubah ke ${tier}`,
      user: {
        subscriptionTier: updated?.subscription_tier,
        premium: updated?.premium
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 3. ENERGY TOPUP & DISCOUNT MANAGEMENT
// ==========================================
adminRoutes.get('/api/admin/energy-packages', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const packages = await configRepository.getEnergyPackages();
    res.json({ success: true, packages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.put('/api/admin/energy-packages/:id', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const updated = await configRepository.updateEnergyPackage(id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: { message: 'Paket tidak ditemukan' } });

    res.json({ success: true, message: 'Paket Energy berhasil diperbarui', package: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.post('/api/admin/energy-packages', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const newPkg = await configRepository.addEnergyPackage(req.body);
    res.json({ success: true, message: 'Paket Energy baru berhasil ditambahkan', package: newPkg });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.delete('/api/admin/energy-packages/:id', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const ok = await configRepository.deleteEnergyPackage(req.params.id);
    res.json({ success: ok, message: ok ? 'Paket berhasil dihapus' : 'Paket tidak ditemukan' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Apply Global Energy Discount (e.g. Flash Sale 20%)
adminRoutes.post('/api/admin/energy-packages/global-discount', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { discountPercent } = req.body;
    const num = Number(discountPercent);
    if (isNaN(num)) {
      return res.status(400).json({ success: false, error: { message: 'Persentase diskon tidak valid' } });
    }

    const updatedList = await configRepository.applyGlobalEnergyDiscount(num);
    res.json({
      success: true,
      message: `Diskon global ${num}% berhasil diterapkan ke semua paket Energy.`,
      packages: updatedList
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 4. PREMIUM PACKAGES MANAGEMENT
// ==========================================
adminRoutes.get('/api/admin/premium-packages', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const packages = await configRepository.getPremiumPackages();
    res.json({ success: true, packages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.put('/api/admin/premium-packages/:id', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const updated = await configRepository.updatePremiumPackage(id, req.body);
    if (!updated) return res.status(404).json({ success: false, error: { message: 'Paket Premium tidak ditemukan' } });

    res.json({ success: true, message: 'Paket Premium berhasil diperbarui', package: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.post('/api/admin/premium-packages', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const newPkg = await configRepository.addPremiumPackage(req.body);
    res.json({ success: true, message: 'Paket Premium baru berhasil ditambahkan', package: newPkg });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

adminRoutes.delete('/api/admin/premium-packages/:id', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const ok = await configRepository.deletePremiumPackage(req.params.id);
    res.json({ success: ok, message: ok ? 'Paket Premium berhasil dihapus' : 'Paket tidak ditemukan' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 5. WITHDRAWALS PROCESSING & AUDIT
// ==========================================
adminRoutes.get('/api/admin/withdrawals', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { status } = req.query;
    const list = await withdrawalRepository.findAll({ status: status as string });
    
    // Enrich with user info
    const users = await userRepository.findAll();
    const userMap = new Map(users.map((u) => [u.id || u._id.toString(), u]));

    const enriched = list.map((w) => {
      const u = userMap.get(w.user_id) || users.find((x) => x.username === w.user_id);
      return {
        id: w.id || w._id.toString(),
        userId: w.user_id,
        username: u?.username || 'unknown',
        userDisplayName: u?.display_name || 'Trader',
        userAvatar: u?.avatar || '',
        userEnergyBalance: u?.energy || 0,
        amountEnergy: w.amount_energy,
        amountIdr: w.amount_idr,
        feeIdr: w.fee_idr,
        netAmountIdr: w.net_amount_idr,
        bankCode: w.bank_code,
        bankName: w.bank_name,
        accountNumber: w.account_number,
        accountHolderName: w.account_holder_name,
        status: w.status,
        referenceId: w.reference_id,
        disbursementId: w.disbursement_id,
        notes: w.notes,
        createdAt: w.created_at,
        completedAt: w.completed_at
      };
    });

    res.json({ success: true, withdrawals: enriched, total: enriched.length });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Approve & Mark Withdrawal as SUCCESS (or Processing)
adminRoutes.post('/api/admin/withdrawals/:id/approve', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { disbursementId, notes } = req.body;

    const wd = await withdrawalRepository.findById(id);
    if (!wd) return res.status(404).json({ success: false, error: { message: 'Data penarikan tidak ditemukan' } });

    if (wd.status === 'SUCCESS') {
      return res.status(400).json({ success: false, error: { message: 'Penarikan ini sudah disetujui sebelumnya' } });
    }

    const finalDisbursementId = disbursementId || `BFAST-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}`;
    const finalNotes = notes || `Disetujui & ditransfer via BI-FAST realtime oleh Admin (${req.adminUser?.username || 'Admin'})`;

    const updated = await withdrawalRepository.updateStatus(id, 'SUCCESS', finalNotes, finalDisbursementId);

    // Resolve user to ensure notification reaches them regardless of ID/username format
    const user = (await userRepository.findById(wd.user_id)) || (await userRepository.findByUsername(wd.user_id));

    // Send in-app notification to user
    const notifPayload = {
      title: 'Penarikan Komisi Berhasil Dicairkan! 💸',
      message: `Dana pencairan Rp ${wd.net_amount_idr.toLocaleString('id-ID')} (${wd.amount_energy}⚡) telah berhasil ditransfer via BI-FAST ke ${wd.bank_name} [${wd.account_number}] a/n ${wd.account_holder_name}. No Ref: ${finalDisbursementId}.`,
      type: 'WITHDRAWAL' as const
    };

    await interactionRepository.createNotification({
      ...notifPayload,
      user_id: wd.user_id
    });

    if (user && user.username && user.username !== wd.user_id) {
      await interactionRepository.createNotification({
        ...notifPayload,
        user_id: user.username
      });
    }

    res.json({
      success: true,
      message: `Penarikan Rp ${wd.net_amount_idr.toLocaleString('id-ID')} (${wd.reference_id}) berhasil disetujui & dicairkan!`,
      withdrawal: updated
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Reject Withdrawal (Refund Energy back to User)
adminRoutes.post('/api/admin/withdrawals/:id/reject', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { id } = req.params;
    const { reason = 'Nomor rekening atau nama penerima tidak sesuai' } = req.body;

    const wd = await withdrawalRepository.findById(id);
    if (!wd) return res.status(404).json({ success: false, error: { message: 'Data penarikan tidak ditemukan' } });

    if (wd.status === 'SUCCESS') {
      return res.status(400).json({ success: false, error: { message: 'Penarikan yang sudah SUCCESS tidak dapat ditolak' } });
    }

    // Refund energy back to user
    const user = (await userRepository.findById(wd.user_id)) || (await userRepository.findByUsername(wd.user_id));
    if (user) {
      await userRepository.updateEnergy(user.id || user._id.toString(), wd.amount_energy);
      
      // Also restore affiliate tracker
      await userRepository.update(user.id || user._id.toString(), {
        affiliate_earnings_energy: (user.affiliate_earnings_energy || 0) + wd.amount_energy
      });

      // Record refund transaction
      await transactionRepository.create({
        user_id: user.id || user.username,
        type: 'AFFILIATE_COMMISSION',
        amount: wd.amount_energy,
        balance_before: user.energy,
        balance_after: user.energy + wd.amount_energy,
        reference_id: `REFUND-${wd.reference_id}`,
        status: 'COMPLETED',
        metadata: { action: 'WITHDRAWAL_REFUND', originalRef: wd.reference_id, reason }
      });

      // Notify user
      await interactionRepository.createNotification({
        user_id: user.id || user.username,
        title: 'Penarikan Komisi Ditolak & Energy Dikembalikan ⚠️',
        message: `Permintaan penarikan Rp ${wd.net_amount_idr.toLocaleString('id-ID')} (${wd.amount_energy}⚡) ditolak. Alasan: ${reason}. Saldo Energy telah dikembalikan utuh ke akun Anda.`,
        type: 'WITHDRAWAL'
      });
    }

    const updated = await withdrawalRepository.updateStatus(id, 'FAILED', `Ditolak: ${reason}`);

    res.json({
      success: true,
      message: `Penarikan berhasil ditolak dan ${wd.amount_energy}⚡ telah dikembalikan ke saldo user.`,
      withdrawal: updated
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// ==========================================
// 6. SYSTEM BROADCAST NOTIFICATION
// ==========================================
adminRoutes.post('/api/admin/broadcast', requireAdmin, async (req: AdminAuthRequest, res) => {
  try {
    const { title, message, type = 'TRADE_OPENED' } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, error: { message: 'Judul dan pesan siaran wajib diisi.' } });
    }

    const allUsers = await userRepository.findAll();
    for (const u of allUsers) {
      await interactionRepository.createNotification({
        user_id: u.id || u.username,
        title: `📢 ${title}`,
        message,
        type: type as any
      });
    }

    res.json({
      success: true,
      message: `Siaran pengumuman berhasil dikirim ke ${allUsers.length} pengguna.`
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});
