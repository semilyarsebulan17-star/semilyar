import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Sparkles, 
  CheckCircle2, 
  Lock,
  ArrowRight,
  ShieldCheck,
  Mail
} from 'lucide-react';
import { User } from '../types';
import { ScrolicLogo } from './ScrolicLogo';
import { triggerHaptic } from '../utils/haptics';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (user: User) => void;
  promptReason?: string | null;
  initialReferralCode?: string | null;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
  promptReason,
  initialReferralCode
}) => {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode || '');
  const [error, setError] = useState<string | null>(null);
  const googleBtnContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode);
    }
  }, [initialReferralCode]);

  // Handle Google Identity Services (GSI) credential response
  const handleCredentialResponse = async (response: any) => {
    if (!response?.credential) return;
    setGoogleLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: response.credential,
          referralCode: referralCode.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.user) {
        throw new Error(data.error?.message || data.error || 'Gagal login dengan Google');
      }

      localStorage.setItem('scrolic_user_id', data.user.id || data.user.username);
      triggerHaptic('success');
      onLoginSuccess(data.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat otentikasi Google');
    } finally {
      setGoogleLoading(false);
    }
  };

  // Initialize Google Identity Services (GSI) if available
  useEffect(() => {
    if (!isOpen) return;

    const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
    const google = (window as any).google;

    if (google?.accounts?.id && googleClientId) {
      try {
        google.accounts.id.initialize({
          client_id: googleClientId,
          callback: handleCredentialResponse,
          auto_select: false,
          cancel_on_tap_outside: true
        });

        if (googleBtnContainerRef.current) {
          google.accounts.id.renderButton(googleBtnContainerRef.current, {
            theme: 'filled_black',
            size: 'large',
            text: 'continue_with',
            shape: 'pill',
            width: 320
          });
        }
      } catch (err) {
        console.warn('Google GSI initialization notice:', err);
      }
    }
  }, [isOpen, referralCode]);

  if (!isOpen) return null;

  // Real Google Sign-In Handler
  const handleGoogleSignIn = async (overrideEmail?: string) => {
    const targetEmail = overrideEmail || emailInput.trim();
    
    // If no email entered yet and user clicked 1-tap Google, check if GSI prompt can be triggered
    const google = (window as any).google;
    const googleClientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
    
    if (!targetEmail && google?.accounts?.id && googleClientId) {
      try {
        google.accounts.id.prompt();
        return;
      } catch (e) {
        // Fallback to direct input
      }
    }

    if (!targetEmail) {
      setError('Masukkan alamat Email Google (Gmail) Anda di bawah untuk melanjutkan');
      return;
    }

    // Basic email format check
    if (targetEmail.includes('@') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
      setError('Format email Google tidak valid. Contoh: nama@gmail.com');
      return;
    }

    setGoogleLoading(true);
    setError(null);

    try {
      const cleanEmail = targetEmail.toLowerCase().trim();
      const cleanName = cleanEmail.includes('@') 
        ? cleanEmail.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        : cleanEmail;
      const cleanUsername = cleanEmail.includes('@')
        ? cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')
        : cleanEmail.toLowerCase().replace(/[^a-z0-9_]/g, '_');

      const payload = {
        email: cleanEmail.includes('@') ? cleanEmail : `${cleanUsername}@gmail.com`,
        name: cleanName,
        username: cleanUsername,
        avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanUsername}`,
        strategyId: 'breakout',
        referralCode: referralCode.trim() || undefined
      };

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok || !data.user) {
        throw new Error(data.error?.message || data.error || 'Gagal login dengan Google');
      }

      // Save real user session locally so app stays persistently logged in
      localStorage.setItem('scrolic_user_id', data.user.id || data.user.username);
      triggerHaptic('success');
      
      onLoginSuccess(data.user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Terjadi kesalahan saat otentikasi Google');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleCustomEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      setError('Masukkan alamat Email Google (Gmail) Anda');
      return;
    }
    await handleGoogleSignIn(emailInput.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-[#07130c] border border-[#18633c]/40 rounded-3xl p-6 shadow-2xl shadow-black/90 overflow-hidden text-neutral-200 max-h-[90vh] overflow-y-auto">
        
        {/* Glow backdrop accent */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-[#18633c]/30 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full bg-[#0d2216] border border-emerald-500/20 text-neutral-400 hover:text-white hover:bg-[#143322] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header Branding */}
        <div className="text-center mb-5">
          <div className="inline-flex items-center justify-center mb-3">
            <ScrolicLogo size={56} />
          </div>
          <h2 className="text-xl font-black text-white tracking-tight flex items-center justify-center gap-2">
            Masuk ke Scrolic
            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              cTrader
            </span>
          </h2>
          <p className="text-xs text-emerald-400/80 mt-1 font-medium">
            Scroll • Trade • Earn
          </p>

          {promptReason && (
            <div className="mt-3 p-2.5 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 text-left">
              <Lock className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{promptReason}</span>
            </div>
          )}

          {referralCode && (
            <div className="mt-2.5 p-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                <span>Undangan Referral:</span>
              </div>
              <span className="font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-200">
                {referralCode}
              </span>
            </div>
          )}
        </div>

        {/* Primary Action: Google 1-Tap Sign-In */}
        <div className="space-y-3 mb-5">
          {/* GSI Container if initialized */}
          <div ref={googleBtnContainerRef} className="flex justify-center empty:hidden mb-2" />

          <button
            id="btn-modal-google-direct"
            type="button"
            onClick={() => handleGoogleSignIn()}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-4 rounded-2xl bg-white hover:bg-neutral-100 text-neutral-900 font-extrabold text-sm transition-all shadow-xl shadow-white/5 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 cursor-pointer"
          >
            {/* Google SVG Icon */}
            <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
              />
            </svg>
            <span>{googleLoading ? 'Menghubungkan Akun Google...' : 'Lanjutkan dengan Google'}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative flex py-2 items-center">
          <div className="flex-grow border-t border-[#18633c]/40" />
          <span className="flex-shrink mx-3 text-[11px] text-neutral-400 uppercase font-semibold">Atau Masukkan Email Google</span>
          <div className="flex-grow border-t border-[#18633c]/40" />
        </div>

        {/* Error notification */}
        {error && (
          <div className="mb-4 p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
            <X className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Google Email Form */}
        <form onSubmit={handleCustomEmailSubmit} className="space-y-3">
          <div>
            <label className="block text-[11px] font-semibold text-neutral-300 mb-1">
              Email Google (Gmail)
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-neutral-400 absolute left-3 top-3" />
              <input
                id="input-google-email"
                type="email"
                required
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="namaanda@gmail.com"
                className="w-full pl-9 pr-3 py-2.5 bg-[#0a1b11] border border-[#18633c]/50 rounded-xl text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <button
            id="btn-submit-email-login"
            type="submit"
            disabled={googleLoading}
            className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            <span>{googleLoading ? 'Memproses Akun...' : 'Masuk / Daftar Akun'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Post-Login Feature Highlights */}
        <div className="mt-5 pt-4 border-t border-[#18633c]/30 space-y-2 text-[11px] text-neutral-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Akun cTrader dapat ditambahkan langsung setelah masuk</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>1 Open Position di cTrader = 1 Feed Post Otomatis</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>Bonus 25 Energy Gratis (KYC) & Komisi Afiliasi hingga 5 Generasi</span>
          </div>
          <div className="flex items-center gap-2 pt-1 text-[10px] text-emerald-500/70">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Enkripsi 256-bit & Data Tersimpan Persisten di Database Cloud</span>
          </div>
        </div>
      </div>
    </div>
  );
};
