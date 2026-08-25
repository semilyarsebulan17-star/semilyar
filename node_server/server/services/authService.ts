import { userRepository } from '../repositories/userRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { interactionRepository } from '../repositories/interactionRepository';
import { MongoUser } from '../models/types';

export class AuthService {
  async handleGoogleAuth(body: {
    credential?: string;
    email?: string;
    name?: string;
    username?: string;
    avatar?: string;
    strategyId?: string;
    referralCode?: string;
  }): Promise<{ user: MongoUser }> {
    let email = body.email;
    let name = body.name;
    let avatar = body.avatar;

    // Decode Google ID Token if passed from Google Identity Services (GSI)
    if (body.credential) {
      try {
        const parts = body.credential.split('.');
        if (parts.length === 3) {
          const payloadJson = Buffer.from(parts[1], 'base64').toString('utf8');
          const tokenPayload = JSON.parse(payloadJson);
          if (tokenPayload.email) email = tokenPayload.email;
          if (tokenPayload.name) name = tokenPayload.name;
          if (tokenPayload.picture) avatar = tokenPayload.picture;
        }
      } catch (e) {
        console.warn('Failed to parse Google JWT credential:', e);
      }
    }

    const cleanEmail = email ? email.toLowerCase().trim() : undefined;
    if (!cleanEmail && !body.username) {
      throw new Error('Email Google atau Username wajib diisi untuk autentikasi');
    }

    const cleanUsername = (body.username || cleanEmail?.split('@')[0] || 'trader')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');

    let user: MongoUser | null = null;
    if (cleanEmail) {
      user = await userRepository.findByEmail(cleanEmail);
    }
    if (!user) {
      user = await userRepository.findByUsername(cleanUsername);
    }

    if (!user) {
      let referrerId: string | undefined = undefined;
      if (body.referralCode) {
        const referrer = await userRepository.findByReferralCode(body.referralCode);
        if (referrer) {
          referrerId = referrer.id;
          // Reward referrer with 20 Energy and record transaction
          await userRepository.updateEnergy(referrer.id || referrer.username, 20);
          await transactionRepository.create({
            user_id: referrer.id || referrer.username,
            type: 'AFFILIATE_COMMISSION',
            amount: 20,
            balance_before: referrer.energy,
            balance_after: referrer.energy + 20,
            metadata: { newUserId: `user-${cleanUsername}`, referralCode: body.referralCode }
          });
          await interactionRepository.createNotification({
            user_id: referrer.id || referrer.username,
            title: 'Referral Baru Bergabung!',
            message: `@${cleanUsername} mendaftar lewat link referral Anda. Anda mendapatkan +20 ENERGY!`,
            type: 'AFFILIATE_COMMISSION'
          });
        }
      }

      const displayName = name || (cleanEmail ? cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : cleanUsername);

      user = await userRepository.create({
        id: `user-${cleanUsername}`,
        username: cleanUsername,
        display_name: displayName,
        email: cleanEmail,
        avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`,
        strategy_dna: body.strategyId || 'breakout',
        primary_strategy_id: body.strategyId || 'breakout',
        energy: 0,
        referral_code: cleanUsername.toUpperCase() + '50',
        referrer_id: referrerId
      });
    }

    return { user };
  }

  async login(identifier: string): Promise<MongoUser | null> {
    const clean = identifier.toLowerCase().trim();
    if (clean.includes('@')) {
      const byEmail = await userRepository.findByEmail(clean);
      if (byEmail) return byEmail;
    }
    return await userRepository.findByUsername(clean);
  }

  async register(body: {
    username: string;
    displayName?: string;
    strategyId?: string;
    referralCode?: string;
  }): Promise<MongoUser> {
    const clean = (body.username || 'trader').toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const existing = await userRepository.findByUsername(clean);
    if (existing) return existing;

    const newUser = await userRepository.create({
      id: `user-${clean}`,
      username: clean,
      display_name: body.displayName || clean,
      strategy_dna: body.strategyId || 'breakout',
      primary_strategy_id: body.strategyId || 'breakout',
      energy: 0,
      referral_code: clean.toUpperCase() + '50'
    });

    return newUser;
  }
}

export const authService = new AuthService();
