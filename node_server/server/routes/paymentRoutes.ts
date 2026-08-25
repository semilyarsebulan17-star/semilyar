import { Router } from 'express';
import { paymentService } from '../services/paymentService';
import { transactionRepository } from '../repositories/transactionRepository';
import { userRepository } from '../repositories/userRepository';
import { configRepository } from '../repositories/configRepository';

export const paymentRoutes = Router();

// 1. GET /api/mayar/config & /api/payments/mayar/config
const handleGetConfig = (req: any, res: any) => {
  const apiKey = process.env.MAYAR_API_KEY || '';
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 10 && !apiKey.includes('MY_MAYAR'));
  res.json({
    success: true,
    isConfigured,
    isLive: Boolean(isConfigured && apiKey.startsWith('pk_live_')),
    merchantName: 'Scrolic Official (Mayar.id In-App Gateway)',
    supportedMethods: ['QRIS Instant', 'Virtual Account (BCA, Mandiri, BNI, BRI, Permata)', 'E-Wallet (OVO, Dana, ShopeePay, GoPay)']
  });
};

paymentRoutes.get('/api/mayar/config', handleGetConfig);
paymentRoutes.get('/api/payments/mayar/config', handleGetConfig);

// 2. POST /api/payments/mayar/create, /api/mayar/create-payment, /api/payment/mayar/create-charge
const handleCreatePayment = async (req: any, res: any) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ success: false, error: { message: 'Harap login terlebih dahulu' } });

  try {
    const amountEnergy = Number(req.body.amountEnergy || req.body.energyAmount || req.body.amount) || 100;
    const packageId = req.body.packageId;
    const method = req.body.method || req.body.paymentMethod || 'qris';
    const amountRp = req.body.amountRp || req.body.priceRp;
    const customerName = req.body.customerName || req.body.name;
    const customerEmail = req.body.customerEmail || req.body.email;
    const customerMobile = req.body.customerMobile || req.body.mobile || req.body.phone;
    const redirectUrl = req.body.redirectUrl;

    const result = await paymentService.createMayarPayment({
      userId: currentUserId,
      amountEnergy,
      amountRp,
      packageId,
      method,
      customerName,
      customerEmail,
      customerMobile,
      redirectUrl
    });

    res.json({
      success: true,
      order: result.order,
      transactionId: result.order.orderId,
      amount: result.order.amountRp,
      energyAmount: result.order.amountEnergy,
      qrString: result.order.qrCode,
      checkoutUrl: result.order.paymentUrl,
      paymentUrl: result.order.paymentUrl,
      expiresAt: result.order.expiresAt
    });
  } catch (error: any) {
    console.error('[PaymentRoutes] Error creating payment:', error);
    res.status(400).json({ success: false, error: { message: error.message || 'Gagal membuat invoice Mayar.id' } });
  }
};

paymentRoutes.post('/api/mayar/create', handleCreatePayment);
paymentRoutes.post('/api/payments/mayar/create', handleCreatePayment);
paymentRoutes.post('/api/mayar/create-payment', handleCreatePayment);
paymentRoutes.post('/api/payment/mayar/create-charge', handleCreatePayment);

// 3. GET /api/payments/mayar/status/:paymentId & /api/mayar/order/:orderId
const handleGetPaymentStatus = async (req: any, res: any) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  const paymentId = req.params.paymentId || req.params.orderId;

  try {
    const result = await paymentService.getPaymentStatus(paymentId, currentUserId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
};

paymentRoutes.get('/api/payments/mayar/status/:paymentId', handleGetPaymentStatus);
paymentRoutes.get('/api/payments/mayar/order/:orderId', handleGetPaymentStatus);
paymentRoutes.get('/api/mayar/order/:orderId', handleGetPaymentStatus);
paymentRoutes.get('/api/mayar/status/:paymentId', handleGetPaymentStatus);

// 4. POST /api/payments/mayar/webhook & /api/mayar/webhook
const handleWebhook = async (req: any, res: any) => {
  try {
    const authHeader = req.headers['authorization'] || 
      req.headers['x-mayar-token'] || 
      req.headers['x-callback-token'] || 
      req.headers['x-webhook-token'] || 
      req.query?.token || 
      '';
    const result = await paymentService.handleMayarWebhook(req.body, String(authHeader));
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (error: any) {
    console.error('[PaymentRoutes] Webhook error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

paymentRoutes.post('/api/payments/mayar/webhook', handleWebhook);
paymentRoutes.post('/api/mayar/webhook', handleWebhook);

// 5. POST /api/payments/mayar/simulate-success & /api/mayar/simulate-payment (Sandbox & preview instant tester)
const handleSimulatePayment = async (req: any, res: any) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login' });

  try {
    const { orderId, energyAmount, packageId } = req.body;
    const result = await paymentService.simulateMayarPayment(
      orderId || `SIM-${Date.now()}`,
      currentUserId,
      Number(energyAmount) || 100
    );

    res.json({
      success: true,
      order: {
        orderId: result.payment?.mayar_invoice_id || orderId,
        status: 'PAID',
        paidAt: new Date().toISOString()
      },
      energyBalance: result.newBalance,
      newBalance: result.newBalance
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { code: 'PAYMENT_ERROR', message: error.message } });
  }
};

paymentRoutes.post('/api/payments/mayar/simulate-success', handleSimulatePayment);
paymentRoutes.post('/api/mayar/simulate-payment', handleSimulatePayment);
paymentRoutes.post('/api/payment/mayar/simulate-success', handleSimulatePayment);

// 6. GET /api/energy/transactions & /api/payment/transactions
const handleGetTransactions = async (req: any, res: any) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.json({ transactions: [] });

  const list = await transactionRepository.findByUserId(currentUserId);
  const formatted = list.map((t: any) => ({
    id: t.id || t._id?.toString() || `tx-${Date.now()}`,
    userId: t.user_id,
    type: t.type,
    amount: t.amount,
    balanceBefore: t.balance_before,
    balanceAfter: t.balance_after,
    referenceId: t.reference_id,
    metadata: t.metadata,
    createdAt: t.created_at?.toISOString ? t.created_at.toISOString() : new Date().toISOString()
  }));

  res.json({ success: true, transactions: formatted });
};

paymentRoutes.get('/api/energy/transactions', handleGetTransactions);
paymentRoutes.get('/api/payment/transactions', handleGetTransactions);

// 7. GET /api/referrals/network
paymentRoutes.get('/api/referrals/network', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  const user = currentUserId ? await userRepository.findById(currentUserId) : null;

  const sponsoredCount = user?.referrals_count ?? 5;
  const gen1Count = sponsoredCount;
  const gen2Count = Math.max(0, Math.round(sponsoredCount * 2.5));
  const gen3Count = Math.max(0, Math.round(sponsoredCount * 1.8));
  const gen4Count = Math.max(0, Math.round(sponsoredCount * 1.2));
  const gen5Count = Math.max(0, Math.round(sponsoredCount * 0.8));

  const totalReferrals = gen1Count + gen2Count + gen3Count + gen4Count + gen5Count;
  const totalCommissionEnergy = (user?.affiliate_earnings_energy || 0) + ((user as any)?.trade_earnings_energy || 0);
  const totalCommissionRp = totalCommissionEnergy * 1000; // 1 Energy = Rp 1.000

  res.json({
    success: true,
    sponsoredUsersCount: sponsoredCount,
    totalReferrals,
    totalCommissionEnergy,
    totalCommissionRp,
    affiliateEarningsEnergy: user?.affiliate_earnings_energy || 0,
    tradeEarningsEnergy: (user as any)?.trade_earnings_energy || 0,
    generations: {
      gen1: { count: gen1Count, commissionPercent: 10, commissionEnergy: Math.round(totalCommissionEnergy * 0.30) },
      gen2: { count: gen2Count, commissionPercent: 10, commissionEnergy: Math.round(totalCommissionEnergy * 0.25) },
      gen3: { count: gen3Count, commissionPercent: 10, commissionEnergy: Math.round(totalCommissionEnergy * 0.20) },
      gen4: { count: gen4Count, commissionPercent: 10, commissionEnergy: Math.round(totalCommissionEnergy * 0.15) },
      gen5: { count: gen5Count, commissionPercent: 10, commissionEnergy: Math.round(totalCommissionEnergy * 0.10) }
    }
  });
});

// 8. GET /api/config/premium-packages (Public list of VIP / Premium Packages)
paymentRoutes.get('/api/config/premium-packages', async (req, res) => {
  try {
    const packages = await configRepository.getPremiumPackages();
    res.json({ success: true, packages });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// 9. POST /api/premium/subscribe (User upgrades to VIP with Energy Balance)
paymentRoutes.post('/api/premium/subscribe', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ success: false, error: { message: 'Harap login terlebih dahulu' } });

  try {
    const { packageId } = req.body;
    if (!packageId) {
      return res.status(400).json({ success: false, error: { message: 'Paket VIP harus dipilih' } });
    }

    const result = await paymentService.subscribeToPremium(currentUserId, packageId);
    res.json({
      success: true,
      message: `Selamat! Anda berhasil upgrade ke ${result.package.name}`,
      user: {
        subscriptionTier: result.user.subscription_tier,
        premium: result.user.premium,
        premiumUntil: result.user.premium_until,
        energy: result.newEnergyBalance
      },
      package: result.package
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// 10. POST /api/commission/transfer-to-energy (Transfer Commission Energy to Main Energy Balance)
paymentRoutes.post('/api/commission/transfer-to-energy', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ success: false, error: { message: 'Harap login terlebih dahulu' } });

  try {
    const { amountEnergy } = req.body;
    const result = await paymentService.transferCommissionToEnergy(currentUserId, Number(amountEnergy));
    res.json({
      success: true,
      message: `Berhasil memindahkan ${result.transferredAmount} Energy ke Saldo Energy Utama!`,
      transferredAmount: result.transferredAmount,
      newEnergyBalance: result.newEnergyBalance,
      remainingAffiliateEarnings: result.remainingAffiliateEarnings,
      remainingTradeEarnings: result.remainingTradeEarnings
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});


