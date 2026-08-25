import React from 'react';
import { 
  Lock, 
  Sparkles, 
  ShieldCheck, 
  Zap, 
  Activity, 
  Users, 
  ArrowRight, 
  TrendingUp 
} from 'lucide-react';
import { ScrolicLogo } from './ScrolicLogo';

interface LoginRequiredGateProps {
  title?: string;
  description?: string;
  featureName?: string;
  onOpenLogin: () => void;
}

export const LoginRequiredGate: React.FC<LoginRequiredGateProps> = ({
  title = 'Akses Database & Portofolio Memerlukan Login',
  description = 'Fitur ini membutuhkan akses database user, sinkronisasi cTrader real-time, dan manajemen saldo Energy.',
  featureName = 'Portofolio & cTrader Live',
  onOpenLogin
}) => {
  return (
    <div className="w-full max-w-md mx-auto py-10 px-4">
      <div className="relative rounded-3xl bg-[#07130c] border border-[#18633c]/40 p-6 text-center overflow-hidden shadow-2xl">
        
        {/* Ambient background glows */}
        <div className="absolute -top-20 -right-20 w-44 h-44 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-44 h-44 bg-[#18633c]/30 rounded-full blur-3xl pointer-events-none" />

        {/* Floating Scrolic Logo */}
        <div className="relative inline-flex items-center justify-center mb-5">
          <ScrolicLogo size={64} pulseLive />
        </div>

        {/* Main Headings */}
        <span className="inline-block px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-bold uppercase tracking-wider mb-2">
          {featureName}
        </span>
        <h2 className="text-xl font-black text-white tracking-tight mb-2">
          {title}
        </h2>
        <p className="text-xs text-neutral-400 max-w-xs mx-auto leading-relaxed mb-6">
          {description}
        </p>

        {/* Benefits Grid */}
        <div className="grid grid-cols-2 gap-2.5 text-left mb-6">
          <div className="p-3 rounded-xl bg-[#0d2216] border border-emerald-500/20">
            <Activity className="w-4 h-4 text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-white">cTrader Sync</div>
            <div className="text-[10px] text-neutral-400 leading-tight">1 OP otomatis jadi feed post live.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#0d2216] border border-emerald-500/20">
            <Zap className="w-4 h-4 text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-white">Energy Wallet</div>
            <div className="text-[10px] text-neutral-400 leading-tight">Unlock SL/TP & Tanya AI Gemini.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#0d2216] border border-emerald-500/20">
            <TrendingUp className="w-4 h-4 text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-white">Mirror Order</div>
            <div className="text-[10px] text-neutral-400 leading-tight">Ikuti setup trader terverifikasi.</div>
          </div>
          <div className="p-3 rounded-xl bg-[#0d2216] border border-emerald-500/20">
            <Users className="w-4 h-4 text-emerald-400 mb-1.5" />
            <div className="text-xs font-bold text-white">Affiliate 5-Gen</div>
            <div className="text-[10px] text-neutral-400 leading-tight">Dapatkan komisi Energy 5 level.</div>
          </div>
        </div>

        {/* Google Login Trigger */}
        <button
          onClick={onOpenLogin}
          className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl bg-emerald-500 text-black font-extrabold text-sm hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
        >
          {/* Google SVG Icon */}
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#000000"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
            />
            <path
              fill="#000000"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#000000"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#000000"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>Masuk dengan Google</span>
        </button>

        <div className="mt-3 text-[11px] text-neutral-400">
          Belum punya akun? Registrasi otomatis saat masuk dengan Google.
        </div>
      </div>
    </div>
  );
};
