import { EnergyPackageConfig, PremiumPackageConfig } from '../models/types';

// Default Energy Packages
let memoryEnergyPackages: EnergyPackageConfig[] = [
  {
    id: 'pkg-10',
    energy: 10,
    basePriceRp: 10000,
    discountPercent: 0,
    discountPriceRp: 10000,
    label: 'Starter',
    bonus: '',
    isPopular: false,
    isActive: true
  },
  {
    id: 'pkg-25',
    energy: 25,
    basePriceRp: 25000,
    discountPercent: 0,
    discountPriceRp: 25000,
    label: 'Standard',
    bonus: '',
    isPopular: false,
    isActive: true
  },
  {
    id: 'pkg-50',
    energy: 50,
    basePriceRp: 50000,
    discountPercent: 10,
    discountPriceRp: 45000,
    label: 'Popular',
    bonus: '+2 Bonus',
    isPopular: true,
    isActive: true
  },
  {
    id: 'pkg-100',
    energy: 100,
    basePriceRp: 100000,
    discountPercent: 15,
    discountPriceRp: 85000,
    label: 'Pro Trader',
    bonus: '+5 Bonus',
    isPopular: false,
    isActive: true
  },
  {
    id: 'pkg-250',
    energy: 250,
    basePriceRp: 250000,
    discountPercent: 20,
    discountPriceRp: 200000,
    label: 'Elite Squad',
    bonus: '+15 Bonus',
    isPopular: false,
    isActive: true
  },
  {
    id: 'pkg-500',
    energy: 500,
    basePriceRp: 500000,
    discountPercent: 25,
    discountPriceRp: 375000,
    label: 'Master Fund',
    bonus: '+35 Bonus',
    isPopular: false,
    isActive: true
  }
];

// Default Premium Packages (VIP)
let memoryPremiumPackages: PremiumPackageConfig[] = [
  {
    id: 'prem-monthly',
    tier: 'premium_monthly',
    name: 'Pro Monthly Pass (1 Bulan)',
    durationMonths: 1,
    priceEnergy: 99,
    basePriceEnergy: 99,
    basePriceRp: 99000,
    discountPercent: 0,
    discountPriceRp: 99000,
    maxGenerations: 2,
    totalCommissionPercent: 20,
    energyBonus: 0,
    features: [
      'Atur Biaya Unlock Setup & Ikuti Setup (1-10 ⚡)',
      'Buka Hak Komisi Generasi ke-2 (Total 20%)',
      'cTrader Auto-Mirror 1-Click',
      'AI Setup Analysis by Gemini',
      'Lencana Verified Pro Trader Emas'
    ],
    isActive: true,
    isPopular: true
  },
  {
    id: 'prem-3m',
    tier: 'premium_3m',
    name: 'Quarterly Growth (3 Bulan)',
    durationMonths: 3,
    priceEnergy: 249,
    basePriceEnergy: 297,
    basePriceRp: 297000,
    discountPercent: 16,
    discountPriceRp: 249000,
    maxGenerations: 3,
    totalCommissionPercent: 30,
    energyBonus: 50,
    features: [
      'Semua Keuntungan Pro Monthly',
      'Buka Hak Komisi Generasi ke-3 (Total 30%)',
      'Bonus +50 Energy Tambahan',
      'Akses Early Strategy SMC & ICT'
    ],
    isActive: true
  },
  {
    id: 'prem-6m',
    tier: 'premium_6m',
    name: 'Semi-Annual Alpha (6 Bulan)',
    durationMonths: 6,
    priceEnergy: 449,
    basePriceEnergy: 594,
    basePriceRp: 594000,
    discountPercent: 24,
    discountPriceRp: 449000,
    maxGenerations: 4,
    totalCommissionPercent: 40,
    energyBonus: 100,
    features: [
      'Semua Keuntungan Quarterly',
      'Buka Hak Komisi Generasi ke-4 (Total 40%)',
      'Bonus +100 Energy Tambahan',
      'VIP Telegram Channel Signals & Prioritas Eksekusi'
    ],
    isActive: true
  },
  {
    id: 'prem-yearly',
    tier: 'premium_yearly',
    name: 'Annual Institutional (1 Tahun)',
    durationMonths: 12,
    priceEnergy: 799,
    basePriceEnergy: 1188,
    basePriceRp: 1188000,
    discountPercent: 33,
    discountPriceRp: 799000,
    maxGenerations: 5,
    totalCommissionPercent: 50,
    energyBonus: 200,
    features: [
      'Hemat 33% (Hanya 66⚡/Bulan) + Bonus 200⚡',
      'Buka Hak Komisi Generasi ke-5 Penuh (Total 50%)',
      'Unlimited Cloud cTrader Sync 24/7',
      'Akses Eksklusif Semua Algoritma Trading'
    ],
    isActive: true,
    isPopular: true
  }
];

export class ConfigRepository {
  async getEnergyPackages(): Promise<EnergyPackageConfig[]> {
    return [...memoryEnergyPackages];
  }

  async updateEnergyPackage(id: string, updates: Partial<EnergyPackageConfig>): Promise<EnergyPackageConfig | null> {
    const pkg = memoryEnergyPackages.find((p) => p.id === id);
    if (!pkg) return null;

    Object.assign(pkg, updates);
    if (updates.basePriceRp !== undefined || updates.discountPercent !== undefined) {
      const base = updates.basePriceRp !== undefined ? updates.basePriceRp : pkg.basePriceRp;
      const disc = updates.discountPercent !== undefined ? updates.discountPercent : pkg.discountPercent;
      pkg.discountPriceRp = Math.round(base * (1 - disc / 100));
    }
    return { ...pkg };
  }

  async addEnergyPackage(pkg: Omit<EnergyPackageConfig, 'id'> & { id?: string }): Promise<EnergyPackageConfig> {
    const id = pkg.id || `pkg-${Date.now()}`;
    const base = pkg.basePriceRp;
    const disc = pkg.discountPercent || 0;
    const finalPrice = Math.round(base * (1 - disc / 100));

    const newPkg: EnergyPackageConfig = {
      ...pkg,
      id,
      discountPercent: disc,
      discountPriceRp: finalPrice,
      bonus: pkg.bonus || '',
      isActive: pkg.isActive ?? true
    };
    memoryEnergyPackages.push(newPkg);
    return newPkg;
  }

  async deleteEnergyPackage(id: string): Promise<boolean> {
    const prevLen = memoryEnergyPackages.length;
    memoryEnergyPackages = memoryEnergyPackages.filter((p) => p.id !== id);
    return memoryEnergyPackages.length < prevLen;
  }

  async applyGlobalEnergyDiscount(discountPercent: number): Promise<EnergyPackageConfig[]> {
    memoryEnergyPackages = memoryEnergyPackages.map((pkg) => {
      const disc = Math.max(0, Math.min(90, discountPercent));
      const discountPriceRp = Math.round(pkg.basePriceRp * (1 - disc / 100));
      return {
        ...pkg,
        discountPercent: disc,
        discountPriceRp
      };
    });
    return [...memoryEnergyPackages];
  }

  async getPremiumPackages(): Promise<PremiumPackageConfig[]> {
    return [...memoryPremiumPackages];
  }

  async getPremiumPackageById(id: string): Promise<PremiumPackageConfig | null> {
    return memoryPremiumPackages.find((p) => p.id === id || p.tier === id) || null;
  }

  async updatePremiumPackage(id: string, updates: Partial<PremiumPackageConfig>): Promise<PremiumPackageConfig | null> {
    const pkg = memoryPremiumPackages.find((p) => p.id === id);
    if (!pkg) return null;

    Object.assign(pkg, updates);
    
    // Recalculate priceEnergy and discountPriceRp
    if (updates.priceEnergy !== undefined) {
      pkg.priceEnergy = Number(updates.priceEnergy);
      pkg.discountPriceRp = pkg.priceEnergy * 1000;
    } else if (updates.basePriceEnergy !== undefined || updates.discountPercent !== undefined) {
      const baseEnergy = updates.basePriceEnergy !== undefined ? updates.basePriceEnergy : (pkg.basePriceEnergy || pkg.priceEnergy);
      const disc = updates.discountPercent !== undefined ? updates.discountPercent : pkg.discountPercent;
      pkg.priceEnergy = Math.round(baseEnergy * (1 - disc / 100));
      pkg.discountPriceRp = pkg.priceEnergy * 1000;
    } else if (updates.basePriceRp !== undefined || updates.discountPercent !== undefined) {
      const base = updates.basePriceRp !== undefined ? updates.basePriceRp : pkg.basePriceRp;
      const disc = updates.discountPercent !== undefined ? updates.discountPercent : pkg.discountPercent;
      pkg.discountPriceRp = Math.round(base * (1 - disc / 100));
      pkg.priceEnergy = Math.round(pkg.discountPriceRp / 1000);
    }

    if (updates.durationMonths !== undefined) {
      pkg.durationMonths = Number(updates.durationMonths);
    }
    if (updates.maxGenerations !== undefined) {
      pkg.maxGenerations = Number(updates.maxGenerations);
    }
    if (updates.totalCommissionPercent !== undefined) {
      pkg.totalCommissionPercent = Number(updates.totalCommissionPercent);
    }

    return { ...pkg };
  }

  async addPremiumPackage(pkg: Omit<PremiumPackageConfig, 'id'> & { id?: string }): Promise<PremiumPackageConfig> {
    const id = pkg.id || `prem-${Date.now()}`;
    const priceEnergy = pkg.priceEnergy || (pkg.discountPriceRp ? Math.round(pkg.discountPriceRp / 1000) : 99);
    const baseEnergy = pkg.basePriceEnergy || priceEnergy;
    const basePriceRp = pkg.basePriceRp || (baseEnergy * 1000);
    const disc = pkg.discountPercent || 0;
    const discountPriceRp = priceEnergy * 1000;

    const newPkg: PremiumPackageConfig = {
      ...pkg,
      id,
      priceEnergy,
      basePriceEnergy: baseEnergy,
      basePriceRp,
      discountPercent: disc,
      discountPriceRp,
      maxGenerations: pkg.maxGenerations || 2,
      totalCommissionPercent: pkg.totalCommissionPercent || 20,
      energyBonus: pkg.energyBonus || 0,
      features: pkg.features || [],
      isActive: pkg.isActive ?? true
    };
    memoryPremiumPackages.push(newPkg);
    return newPkg;
  }

  async deletePremiumPackage(id: string): Promise<boolean> {
    const prevLen = memoryPremiumPackages.length;
    memoryPremiumPackages = memoryPremiumPackages.filter((p) => p.id !== id);
    return memoryPremiumPackages.length < prevLen;
  }
}

export const configRepository = new ConfigRepository();
