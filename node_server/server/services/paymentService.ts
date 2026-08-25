import { userRepository } from '../repositories/userRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { configRepository } from '../repositories/configRepository';
import { paymentRepository } from '../repositories/paymentRepository';
import { socketService } from './socketService';
import { MongoUser, MongoPayment } from '../models/types';

// Helper to ensure all Mayar URLs strictly point to scrolic.myr.id and never renko.myr.id
export function sanitizeMayarUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return 'https://scrolic.myr.id';
  }
  return rawUrl.replace(/renko\.myr\.id/gi, 'scrolic.myr.id').trim();
}

export class PaymentService {
  private mayarBaseUrl = process.env.MAYAR_BASE_URL || 'https://api.mayar.id';

  /**
   * Determine max unlocked generation levels based on user subscription tier
   * Free = Gen 1 (10%)
   * Premium 1 Bulan = Gen 2 (20% total)
   * Premium 3 Bulan = Gen 3 (30% total)
   * Premium 6 Bulan = Gen 4 (40% total)
   * Premium Tahunan = Gen 5 (50% total)
   */
  getMaxUnlockedGenerations(user: MongoUser): { maxGen: number; tierLabel: string } {
    const tier = user.subscription_tier || 'free';
    switch (tier) {
      case 'premium_yearly':
        return { maxGen: 5, tierLabel: 'Annual Institutional (5 Generasi / 50%)' };
      case 'premium_6m':
        return { maxGen: 4, tierLabel: 'Semi-Annual (4 Generasi / 40%)' };
      case 'premium_3m':
        return { maxGen: 3, tierLabel: 'Quarterly (3 Generasi / 30%)' };
      case 'premium_monthly':
        return { maxGen: 2, tierLabel: 'Pro Monthly (2 Generasi / 20%)' };
      default:
        // If user has generic premium flag but no specific tier, default to 2
        if (user.premium) return { maxGen: 2, tierLabel: 'Premium Member (2 Generasi)' };
        return { maxGen: 1, tierLabel: 'Free Member (Gen 1 Saja)' };
    }
  }

  /**
   * Distribute multi-generation affiliate commission in Energy (⚡)
   * 10% per level up to 5 generations based on upline's tier
   */
  async distributeAffiliateCommissions(sourceUser: MongoUser, energyAmount: number, originLabel: string = 'transaksi') {
    const genShares = [0.10, 0.10, 0.10, 0.10, 0.10];
    let currentReferrerId = sourceUser.referrer_id;
    let genLevel = 1;

    while (currentReferrerId && genLevel <= 5) {
      const upline = (await userRepository.findById(currentReferrerId)) || (await userRepository.findByUsername(currentReferrerId));
      if (!upline) break;

      const share = genShares[genLevel - 1];
      const commissionEnergy = Math.max(1, Math.round(energyAmount * share));
      const { maxGen } = this.getMaxUnlockedGenerations(upline);

      if (genLevel <= maxGen) {
        // Upline is ELIGIBLE for this generation
        const uplineBefore = upline.energy;
        const { newBalance: uplineNew } = await userRepository.updateEnergy(upline.id || upline.username, commissionEnergy);
        
        await userRepository.update(upline.id || upline.username, {
          affiliate_earnings_energy: (upline.affiliate_earnings_energy || 0) + commissionEnergy
        });

        await transactionRepository.create({
          user_id: upline.id || upline.username,
          type: 'AFFILIATE_COMMISSION',
          amount: commissionEnergy,
          balance_before: uplineBefore,
          balance_after: uplineNew,
          reference_id: `AFF-G${genLevel}-${Date.now()}`,
          metadata: {
            fromUserId: sourceUser.id || sourceUser.username,
            fromUsername: sourceUser.username,
            genLevel,
            sharePercent: share * 100,
            origin: originLabel
          }
        });

        await interactionRepository.createNotification({
          user_id: upline.id || upline.username,
          title: `⚡ Komisi Afiliasi Gen-${genLevel} Masuk!`,
          message: `+${commissionEnergy} Energy dari ${originLabel} @${sourceUser.username} (Generasi Level ${genLevel} - ${(share * 100).toFixed(0)}%). Komisi dapat ditarik BI-FAST atau ditransfer ke Saldo Energy.`,
          type: 'AFFILIATE_COMMISSION'
        });

        socketService.broadcastEnergyUpdate(upline.id || upline.username, uplineNew, commissionEnergy);
      } else {
        // Upline is LOCKED out of this generation tier
        const requiredTierName = genLevel === 2 
          ? 'Premium 1 Bulan (Pro Monthly Pass - 99⚡)' 
          : genLevel === 3 
          ? 'Premium 3 Bulan (Quarterly Growth - 249⚡)'
          : genLevel === 4
          ? 'Premium 6 Bulan (Semi-Annual Alpha - 449⚡)'
          : 'Premium Tahunan (Annual Institutional - 799⚡)';

        await interactionRepository.createNotification({
          user_id: upline.id || upline.username,
          title: `🔒 Komisi Gen-${genLevel} Terkunci (+${commissionEnergy}⚡)`,
          message: `Ada potensi komisi +${commissionEnergy} Energy dari ${originLabel} @${sourceUser.username} di jaringan Gen-${genLevel} Anda. Upgrade ke ${requiredTierName} untuk membuka komisi generasi ke-${genLevel}!`,
          type: 'AFFILIATE_COMMISSION'
        });
      }

      currentReferrerId = upline.referrer_id;
      genLevel++;
    }
  }

  /**
   * Create Official Mayar.id Payment Invoice via Backend
   */
  async createMayarPayment(params: {
    userId: string;
    amountEnergy: number;
    amountRp?: number;
    packageId?: string;
    method?: string;
    customerName?: string;
    customerEmail?: string;
    customerMobile?: string;
    redirectUrl?: string;
  }): Promise<{
    success: boolean;
    order: any;
    payment: MongoPayment;
  }> {
    const user = await userRepository.findById(params.userId);
    if (!user) throw new Error('User tidak ditemukan. Harap login terlebih dahulu.');

    const amountEnergy = Math.max(1, Number(params.amountEnergy) || 100);
    const packages = await configRepository.getEnergyPackages();
    const matchedPkg = packages.find((p) => (params.packageId && p.id === params.packageId) || p.energy === amountEnergy);

    let amountRp = params.amountRp;
    if (!amountRp) {
      if (matchedPkg) {
        amountRp = matchedPkg.discountPriceRp || matchedPkg.basePriceRp || (amountEnergy * 1000);
      } else {
        amountRp = amountEnergy * 1000;
      }
    }

    const orderId = `MAYAR-SCR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const mayarApiKey = process.env.MAYAR_API_KEY;
    const isLiveKey = Boolean(mayarApiKey && (mayarApiKey.startsWith('pk_live_') || mayarApiKey.startsWith('sk_live_') || mayarApiKey.length > 20));

    let mayarInvoiceId = orderId;
    let checkoutUrl = `https://scrolic.myr.id`;
    let qrCode = '';
    let rawResponse: Record<string, any> = {};

    const customerName = params.customerName || user.display_name || user.username || 'Scrolic Trader';
    const customerEmail = params.customerEmail || (user as any).email || `${user.username}@scrolic.com`;
    const customerMobile = params.customerMobile || (user as any).kyc_phone_number || (user as any).phone || '081234567890';
    const redirectUrl = params.redirectUrl || `${process.env.APP_URL || ''}/?payment=return&orderId=${orderId}`;

    // Call Mayar.id Official API if API Key is configured
    if (mayarApiKey && mayarApiKey.trim().length > 10 && !mayarApiKey.includes('MY_MAYAR_API_KEY')) {
      try {
        console.log(`[Mayar.id API] Requesting payment invoice creation for Rp ${amountRp} (${amountEnergy} Energy)...`);
        const response = await fetch(`${this.mayarBaseUrl}/hl/v1/payment/create`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${mayarApiKey.trim()}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: customerName,
            email: customerEmail,
            mobile: customerMobile,
            amount: amountRp,
            description: `Top Up ${amountEnergy} Energy di Scrolic Trading Platform (@${user.username})`,
            redirectUrl,
            expiredAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
          })
        });

        const resData: any = await response.json();
        rawResponse = resData;

        if (response.ok && resData && (resData.data || resData.id)) {
          const d = resData.data || resData;
          mayarInvoiceId = d.id || d.paymentId || orderId;
          const rawLink = d.link || d.paymentUrl || d.url || `https://scrolic.myr.id`;
          checkoutUrl = sanitizeMayarUrl(rawLink);
          if (d.qrCode || d.qr_code || d.qrString) {
            qrCode = d.qrCode || d.qr_code || d.qrString;
          }
          console.log(`[Mayar.id API] Created invoice successfully: ${mayarInvoiceId} -> ${checkoutUrl}`);
        } else {
          console.warn('[Mayar.id API] Fallback to Mayar portal (Response not OK):', resData);
          checkoutUrl = `https://scrolic.myr.id`;
        }
      } catch (apiErr: any) {
        console.error('[Mayar.id API] Network error calling Mayar API, defaulting to Mayar portal:', apiErr.message);
        checkoutUrl = `https://scrolic.myr.id`;
      }
    } else {
      console.log('[Mayar.id] Production In-App portal mode: https://scrolic.myr.id');
    }

    checkoutUrl = sanitizeMayarUrl(checkoutUrl);

    const paymentDoc = await paymentRepository.create({
      user_id: params.userId,
      amount: amountRp,
      energy_amount: amountEnergy,
      mayar_invoice_id: mayarInvoiceId,
      status: 'pending',
      payment_method: params.method || 'qris',
      checkout_url: checkoutUrl,
      qr_code: qrCode,
      package_id: matchedPkg ? matchedPkg.id : params.packageId || 'custom',
      customer_name: customerName,
      customer_email: customerEmail,
      customer_mobile: customerMobile,
      raw_response: rawResponse,
      expired_at: new Date(Date.now() + 15 * 60 * 1000)
    });

    const orderObj = {
      orderId: mayarInvoiceId,
      referenceId: orderId,
      userId: params.userId,
      amountEnergy,
      amountRp,
      packageId: matchedPkg ? matchedPkg.id : params.packageId || 'custom',
      packageLabel: matchedPkg ? matchedPkg.label : `${amountEnergy} Energy`,
      paymentUrl: sanitizeMayarUrl(checkoutUrl),
      checkoutUrl: sanitizeMayarUrl(checkoutUrl),
      qrCode,
      status: 'PENDING',
      paymentMethod: params.method || 'qris',
      createdAt: paymentDoc.created_at.toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    return {
      success: true,
      order: orderObj,
      payment: paymentDoc
    };
  }

  /**
   * Check status of a payment (by order ID or Mayar invoice ID)
   */
  async getPaymentStatus(orderIdOrInvoiceId: string, currentUserId?: string): Promise<{
    success: boolean;
    order: any;
    currentEnergyBalance: number;
    isPaid: boolean;
  }> {
    const payment = (await paymentRepository.findByMayarInvoiceId(orderIdOrInvoiceId)) || (await paymentRepository.findById(orderIdOrInvoiceId));
    
    let targetUserId = currentUserId || (payment ? payment.user_id : null);
    const user = targetUserId ? await userRepository.findById(targetUserId) : null;
    const balance = user ? user.energy : 0;

    if (!payment) {
      return {
        success: true,
        order: {
          orderId: orderIdOrInvoiceId,
          amountEnergy: 100,
          amountRp: 50000,
          status: 'PENDING',
          paymentMethod: 'qris'
        },
        currentEnergyBalance: balance,
        isPaid: false
      };
    }

    const isPaid = payment.status === 'paid';
    return {
      success: true,
      order: {
        orderId: payment.mayar_invoice_id,
        id: payment.id,
        amountEnergy: payment.energy_amount,
        amountRp: payment.amount,
        status: payment.status.toUpperCase(),
        paymentMethod: payment.payment_method || 'qris',
        paymentUrl: sanitizeMayarUrl(payment.checkout_url),
        checkoutUrl: sanitizeMayarUrl(payment.checkout_url),
        qrCode: payment.qr_code,
        paidAt: payment.paid_at ? payment.paid_at.toISOString() : null,
        createdAt: payment.created_at.toISOString()
      },
      currentEnergyBalance: balance,
      isPaid
    };
  }

  /**
   * Process and verify Official Mayar.id Webhook with idempotency
   */
  async handleMayarWebhook(payload: any, authHeaderOrToken?: string): Promise<{
    success: boolean;
    message: string;
    credited: boolean;
    payment?: MongoPayment | null;
  }> {
    // 1. Verify token if webhook secret is configured
    const configuredToken = process.env.MAYAR_WEBHOOK_SECRET || process.env.MAYAR_WEBHOOK_TOKEN;
    if (configuredToken && configuredToken.trim().length > 0 && !configuredToken.includes('MY_MAYAR')) {
      const incomingToken = authHeaderOrToken?.replace(/^Bearer\s+/i, '').trim();
      if (incomingToken && incomingToken !== configuredToken.trim()) {
        console.warn('[Mayar Webhook] Invalid webhook token received');
        return { success: false, message: 'Invalid webhook authentication token', credited: false };
      }
    }

    console.log('[Mayar Webhook] Received webhook payload:', JSON.stringify(payload));

    // Extract invoice id and event
    const event = payload?.event || payload?.type || 'payment.received';
    const data = payload?.data || payload;
    const invoiceId = data?.id || data?.paymentId || data?.orderId || payload?.invoiceId || payload?.id;

    if (!invoiceId) {
      return { success: false, message: 'No invoice/order ID found in webhook payload', credited: false };
    }

    // Lookup payment in database
    const payment = (await paymentRepository.findByMayarInvoiceId(invoiceId)) || (await paymentRepository.findById(invoiceId));
    if (!payment) {
      console.warn(`[Mayar Webhook] Payment not found for invoice ID: ${invoiceId}`);
      return { success: false, message: `Payment record not found for invoice ID: ${invoiceId}`, credited: false };
    }

    // 2. IDEMPOTENCY CHECK: Prevent duplicate credit!
    if (payment.status === 'paid') {
      console.log(`[Mayar Webhook] Payment ${invoiceId} has already been credited. Skipping duplicate credit.`);
      return { success: true, message: 'Payment already processed and credited', credited: false, payment };
    }

    // 3. Process status according to Mayar event
    const isPaidEvent = ['payment.received', 'invoice.paid', 'payment.success', 'payment.settled'].includes(event) 
      || String(data?.status || '').toLowerCase() === 'paid'
      || String(data?.status || '').toLowerCase() === 'success';

    const isFailedEvent = ['payment.failed', 'invoice.failed'].includes(event) || String(data?.status || '').toLowerCase() === 'failed';
    const isExpiredEvent = ['payment.expired', 'invoice.expired'].includes(event) || String(data?.status || '').toLowerCase() === 'expired';

    if (isPaidEvent) {
      const now = new Date();
      // Update payment status to paid
      const updatedPayment = await paymentRepository.updateStatus(payment.mayar_invoice_id, 'paid', now, payload);

      // Add energy to user's balance
      const user = await userRepository.findById(payment.user_id);
      if (user) {
        const balanceBefore = user.energy;
        const { newBalance } = await userRepository.updateEnergy(payment.user_id, payment.energy_amount);

        // Record transaction ledger
        await transactionRepository.create({
          user_id: payment.user_id,
          type: 'TOPUP',
          amount: payment.energy_amount,
          balance_before: balanceBefore,
          balance_after: newBalance,
          reference_id: payment.mayar_invoice_id,
          status: 'COMPLETED',
          metadata: {
            gateway: 'MAYAR_ID',
            amountRp: payment.amount,
            method: payment.payment_method || 'QRIS'
          }
        });

        // 5-Generation Affiliate Commission Distribution
        await this.distributeAffiliateCommissions(user, payment.energy_amount, 'top-up Energy via Mayar.id');

        // Send In-App Notification
        await interactionRepository.createNotification({
          user_id: payment.user_id,
          title: '⚡ Top-Up Energy Berhasil!',
          message: `Pembayaran Mayar.id Rp ${payment.amount.toLocaleString('id-ID')} terverifikasi. +${payment.energy_amount} Energy telah ditambahkan ke dompet Anda.`,
          type: 'ENERGY_TOPUP',
          link_url: '/dashboard'
        });

        // Real-time WebSocket event
        socketService.broadcastEnergyUpdate(payment.user_id, newBalance, payment.energy_amount);
      }

      return { success: true, message: 'Payment successfully verified and energy credited', credited: true, payment: updatedPayment };
    } else if (isFailedEvent) {
      const updatedPayment = await paymentRepository.updateStatus(payment.mayar_invoice_id, 'failed', null, payload);
      return { success: true, message: 'Payment marked as failed', credited: false, payment: updatedPayment };
    } else if (isExpiredEvent) {
      const updatedPayment = await paymentRepository.updateStatus(payment.mayar_invoice_id, 'expired', null, payload);
      return { success: true, message: 'Payment marked as expired', credited: false, payment: updatedPayment };
    }

    return { success: true, message: `Webhook event ${event} recorded`, credited: false, payment };
  }

  /**
   * Simulate Payment Success for Sandbox / Instant In-App testing
   */
  async simulateMayarPayment(orderOrInvoiceId: string, userId: string, customEnergy?: number): Promise<{
    newBalance: number;
    payment: MongoPayment | null;
  }> {
    let payment = (await paymentRepository.findByMayarInvoiceId(orderOrInvoiceId)) || (await paymentRepository.findById(orderOrInvoiceId));

    if (!payment) {
      // Create quick payment record if not present
      const energy = customEnergy || 50;
      payment = await paymentRepository.create({
        user_id: userId,
        amount: energy * 1000,
        energy_amount: energy,
        mayar_invoice_id: orderOrInvoiceId,
        status: 'pending',
        payment_method: 'qris'
      });
    }

    // Process payment via webhook handler
    const result = await this.handleMayarWebhook({
      event: 'payment.received',
      data: {
        id: payment.mayar_invoice_id,
        status: 'paid',
        amount: payment.amount,
        simulated: true
      }
    });

    const user = await userRepository.findById(userId);
    return {
      newBalance: user ? user.energy : 100,
      payment: result.payment || payment
    };
  }

  async processMayarSuccess(userId: string, energyAmount: number, packageId?: string): Promise<{ newBalance: number }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');

    const added = Math.max(1, Number(energyAmount) || 100);
    const balanceBefore = user.energy;
    const { newBalance } = await userRepository.updateEnergy(userId, added);

    // Record topup transaction ledger
    await transactionRepository.create({
      user_id: userId,
      type: 'TOPUP',
      amount: added,
      balance_before: balanceBefore,
      balance_after: newBalance,
      reference_id: `MAYAR-${Date.now()}`,
      metadata: { packageId, gateway: 'MAYAR_ID_QRIS' }
    });

    // Process 5-Generation Affiliate Commission Pool (10% at each generation)
    await this.distributeAffiliateCommissions(user, added, 'top-up Energy');

    // Send user notification
    await interactionRepository.createNotification({
      user_id: userId,
      title: 'Top-Up Energy Berhasil!',
      message: `Pembayaran Mayar.id terverifikasi. +${added} ENERGY telah ditambahkan ke dompet Anda.`,
      type: 'ENERGY_TOPUP'
    });

    socketService.broadcastEnergyUpdate(userId, newBalance, added);

    return { newBalance };
  }

  /**
   * Subscribe / Upgrade user to VIP (Premium) package using Energy (⚡)
   * User can pay with their Energy balance directly (e.g. 99 Energy for Pro Monthly Pass)
   */
  async subscribeToPremium(userId: string, packageId: string): Promise<{
    success: boolean;
    user: MongoUser;
    package: any;
    newEnergyBalance: number;
  }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');

    const packages = await configRepository.getPremiumPackages();
    const pkg = packages.find((p) => p.id === packageId || p.tier === packageId);
    if (!pkg) throw new Error('Paket VIP Premium tidak ditemukan');

    const requiredEnergy = pkg.priceEnergy || Math.round(pkg.discountPriceRp / 1000) || 99;
    if (user.energy < requiredEnergy) {
      throw new Error(`Saldo Energy Anda tidak mencukupi (${user.energy}⚡). Diperlukan ${requiredEnergy}⚡ untuk mengupgrade ke ${pkg.name}. Silakan isi saldo Energy terlebih dahulu.`);
    }

    const beforeBalance = user.energy;
    const bonusEnergy = pkg.energyBonus || 0;
    const netDeduction = requiredEnergy - bonusEnergy;

    // Deduct required energy (and add bonus if any)
    const { newBalance } = await userRepository.updateEnergy(userId, -netDeduction);

    // Calculate new expiration date
    const durationDays = (pkg.durationMonths || 1) * 30;
    const currentExpiry = user.premium_until ? new Date(user.premium_until).getTime() : Date.now();
    const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
    const newExpiry = new Date(baseTime + durationDays * 24 * 3600 * 1000).toISOString();

    // Update user profile
    const updatedUser = await userRepository.update(userId, {
      subscription_tier: pkg.tier,
      premium: true,
      is_verified: true,
      premium_until: newExpiry
    });

    if (!updatedUser) throw new Error('Gagal memperbarui status membership');

    // Record ledger transaction
    await transactionRepository.create({
      user_id: userId,
      type: 'PREMIUM_UPGRADE',
      amount: -requiredEnergy,
      balance_before: beforeBalance,
      balance_after: newBalance,
      reference_id: `VIP-${pkg.tier}-${Date.now()}`,
      metadata: {
        packageId: pkg.id,
        packageName: pkg.name,
        durationMonths: pkg.durationMonths,
        priceEnergy: requiredEnergy,
        bonusEnergy,
        maxGenerations: pkg.maxGenerations,
        totalCommissionPercent: pkg.totalCommissionPercent
      }
    });

    // Distribute affiliate commission for VIP subscription purchase in Energy!
    await this.distributeAffiliateCommissions(user, requiredEnergy, `langganan VIP ${pkg.name}`);

    // Send in-app notification
    await interactionRepository.createNotification({
      user_id: userId,
      title: `👑 Upgrade VIP Berhasil: ${pkg.name}!`,
      message: `Selamat! Anda sekarang adalah member ${pkg.name}. Akses terbuka: Atur biaya setup (1-10⚡), Hak komisi jaringan hingga Generasi ke-${pkg.maxGenerations} (${pkg.totalCommissionPercent}%), dan fitur eksklusif cTrader Auto-Mirror.`,
      type: 'PREMIUM_UPGRADE'
    });

    socketService.broadcastEnergyUpdate(userId, newBalance);

    return {
      success: true,
      user: updatedUser,
      package: pkg,
      newEnergyBalance: newBalance
    };
  }

  /**
   * Transfer Commission Energy (Affiliate & Setup Earnings) directly to main Saldo Energy
   * User can use transferred energy for unlocking setups, following setups, asking Gemini AI, or upgrading VIP!
   */
  async transferCommissionToEnergy(userId: string, amountEnergy: number): Promise<{
    success: boolean;
    transferredAmount: number;
    newEnergyBalance: number;
    remainingAffiliateEarnings: number;
    remainingTradeEarnings: number;
  }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');

    const amount = Math.floor(Number(amountEnergy));
    if (!amount || amount < 1) {
      throw new Error('Minimal transfer komisi adalah 1 Energy (⚡)');
    }

    const affiliateEarnings = user.affiliate_earnings_energy || 0;
    const tradeEarnings = (user as any).trade_earnings_energy || 0;
    const totalAvailableCommission = affiliateEarnings + tradeEarnings;

    if (totalAvailableCommission < amount) {
      throw new Error(`Saldo komisi tidak mencukupi. Total komisi tersedia: ${totalAvailableCommission} Energy (⚡).`);
    }

    // Deduct from commission sources (prefer affiliate earnings first, then trade earnings)
    let deductAffiliate = Math.min(affiliateEarnings, amount);
    let deductTrade = amount - deductAffiliate;

    const newAffiliate = affiliateEarnings - deductAffiliate;
    const newTrade = tradeEarnings - deductTrade;

    const beforeBalance = user.energy;
    // Add to main energy wallet
    const { newBalance } = await userRepository.updateEnergy(userId, amount);

    await userRepository.update(userId, {
      affiliate_earnings_energy: newAffiliate,
      trade_earnings_energy: newTrade
    });

    // Record ledger transaction
    await transactionRepository.create({
      user_id: userId,
      type: 'COMMISSION_TRANSFER',
      amount: amount,
      balance_before: beforeBalance,
      balance_after: newBalance,
      reference_id: `TRF-${Date.now()}`,
      metadata: {
        deductedAffiliate: deductAffiliate,
        deductedTrade: deductTrade,
        previousAffiliate: affiliateEarnings,
        previousTrade: tradeEarnings
      }
    });

    await interactionRepository.createNotification({
      user_id: userId,
      title: '⚡ Pemindahan Komisi Berhasil!',
      message: `+${amount} Energy berhasil dipindahkan dari Dompet Komisi ke Saldo Energy Utama.`,
      type: 'COMMISSION_TRANSFER'
    });

    socketService.broadcastEnergyUpdate(userId, newBalance, amount);

    return {
      success: true,
      transferredAmount: amount,
      newEnergyBalance: newBalance,
      remainingAffiliateEarnings: newAffiliate,
      remainingTradeEarnings: newTrade
    };
  }
}

export const paymentService = new PaymentService();


