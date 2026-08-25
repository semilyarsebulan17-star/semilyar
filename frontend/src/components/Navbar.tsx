import React from 'react';
import { Zap, Bell, Activity, Gift, Sparkles, ShieldCheck } from 'lucide-react';
import { User } from '../types';
import { triggerHaptic } from '../utils/haptics';
import { ScrolicLogo } from './ScrolicLogo';

interface NavbarProps {
  currentUser: User | null;
  unreadNotificationsCount: number;
  onOpenEnergy: () => void;
  onOpenNotifications: () => void;
  onOpenLogin: () => void;
  onOpenPromotion?: () => void;
  onOpenAdmin?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentUser,
  unreadNotificationsCount,
  onOpenEnergy,
  onOpenNotifications,
  onOpenLogin,
  onOpenPromotion,
  onOpenAdmin
}) => {
  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#07130c]/90 border-b border-[#18633c]/30 select-none shadow-sm shadow-black/40">
      <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
        
        {/* Brand Logo & Live Signal with official Scrolic Icon */}
        <div 
          onClick={() => triggerHaptic('light')}
          className="flex items-center gap-2 cursor-pointer group"
        >
          <ScrolicLogo size={32} showText pulseLive />
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {currentUser ? (
            <>
              {/* Admin Dashboard Badge Link (If user is Admin) */}
              {currentUser.role === 'admin' && onOpenAdmin && (
                <button
                  id="btn-nav-admin-dashboard"
                  onClick={() => {
                    triggerHaptic('medium');
                    onOpenAdmin();
                  }}
                  className="px-2 py-1 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-[10px] flex items-center gap-1 shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer transition-all animate-in fade-in duration-200"
                  title="Panel Admin Scrolic"
                >
                  <ShieldCheck className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span>ADMIN</span>
                </button>
              )}

              {/* Quick Promo / Affiliate Trigger */}
              {onOpenPromotion && (
                <button
                  id="btn-nav-promo"
                  onClick={() => {
                    triggerHaptic('medium');
                    onOpenPromotion();
                  }}
                  className="p-1.5 rounded-xl bg-[#0c1a11] border border-[#1b432a] text-emerald-300 hover:text-emerald-200 hover:border-emerald-500/50 hover:bg-[#12281b] transition-all active:scale-95 cursor-pointer flex items-center gap-1"
                  title="Halaman Promosi & Bonus Afiliasi 50%"
                >
                  <Gift className="w-4 h-4 text-emerald-400" />
                  <span className="hidden sm:inline text-[10px] font-bold text-emerald-300">50% Afiliasi</span>
                </button>
              )}

              {/* Energy Balance Pill */}
              <button
                id="btn-nav-energy-wallet"
                onClick={() => {
                  triggerHaptic('light');
                  onOpenEnergy();
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#133320] border border-emerald-500/40 text-emerald-300 hover:border-emerald-400 hover:bg-[#18442a] transition-all cursor-pointer shadow-sm active:scale-95"
              >
                <Zap className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" />
                <span className="text-xs font-mono font-extrabold">{currentUser.energyBalance}</span>
              </button>

              {/* Notification Bell */}
              <button
                id="btn-nav-notifications"
                onClick={() => {
                  triggerHaptic('light');
                  onOpenNotifications();
                }}
                className="relative p-2 rounded-full bg-[#0c1a11] border border-[#1b432a] text-neutral-300 hover:text-white hover:border-emerald-500/40 transition-all active:scale-95 cursor-pointer"
              >
                <Bell className="w-4 h-4 text-emerald-300" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-400 rounded-full animate-ping" />
                )}
              </button>
            </>
          ) : (
            /* Unauthenticated / Guest View: Promo link & Google Sign In Button */
            <div className="flex items-center gap-2">
              {onOpenPromotion && (
                <button
                  id="btn-nav-guest-promo"
                  onClick={() => {
                    triggerHaptic('light');
                    onOpenPromotion();
                  }}
                  className="p-1.5 px-2.5 rounded-full bg-[#0c1a11] border border-[#1b432a] text-emerald-300 hover:text-white hover:bg-[#12281b] text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                >
                  <Gift className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Promo 50%</span>
                </button>
              )}
              <button
                id="btn-nav-google-login"
                onClick={() => {
                  triggerHaptic('medium');
                  onOpenLogin();
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs shadow-md shadow-emerald-500/20 transition-all active:scale-95 cursor-pointer"
              >
                {/* Google G icon */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
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
                <span>Masuk</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
