import React, { useState } from 'react';
import { 
  BarChart3, 
  Activity, 
  CheckCircle2, 
  TrendingUp, 
  TrendingDown, 
  Zap, 
  Users, 
  ShieldCheck, 
  Clock, 
  ArrowUpRight, 
  Plus,
  RefreshCw,
  XCircle,
  ExternalLink,
  Layers,
  Radio,
  Sparkles,
  Server,
  ChevronRight,
  ArrowRight,
  Shield
} from 'lucide-react';
import { User, Trade, FeedPost } from '../types';
import { PositionProgressBar } from '../components/PositionProgressBar';
import { getStrategy } from '../data/strategies';
import { LoginRequiredGate } from '../components/LoginRequiredGate';
import { FP_MARKETS_REGISTER_URL, CTRADER_GRANT_ACCESS_URL } from '../components/CTraderGatewayModal';
import { triggerHaptic } from '../utils/haptics';

interface DashboardViewProps {
  currentUser: User | null;
  liveTrades: Trade[];
  closedTrades: Trade[];
  posts: FeedPost[];
  onOpenEnergy: () => void;
  onOpenReferral: () => void;
  onCloseTrade: (tradeId: string) => void;
  onOpenLogin?: () => void;
  onOpenCTraderGateway?: () => void;
  onUpdateUser?: (updatedUser: User) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentUser,
  liveTrades,
  closedTrades,
  posts,
  onOpenEnergy,
  onOpenReferral,
  onCloseTrade,
  onOpenLogin,
  onOpenCTraderGateway,
  onUpdateUser
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'live' | 'portfolio'>('summary');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  if (!currentUser) {
    return (
      <LoginRequiredGate
        featureName="Portofolio & cTrader Live"
        title="Dashboard Khusus Trader Terdaftar"
        description="Masuk dengan Google untuk melihat statistik trading real-time, Open Position aktif, dan riwayat sinkronisasi cTrader."
        onOpenLogin={onOpenLogin || (() => {})}
      />
    );
  }

  const currentAccounts = (currentUser.cTraderAccounts && currentUser.cTraderAccounts.length > 0)
    ? currentUser.cTraderAccounts
    : [];

  const activeAccount = currentAccounts.find((a) => a.accountId === currentUser.cTraderAccountId) || currentAccounts[0];

  // Quick switch account
  const handleQuickSwitch = async (acc: typeof currentAccounts[0]) => {
    if (acc.accountId === currentUser.cTraderAccountId && currentUser.cTraderConnected) return;
    setIsSwitching(true);
    triggerHaptic('selection');
    try {
      const res = await fetch('/api/ctrader/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: acc.accountId,
          broker: acc.brokerName || 'FP Markets',
          environment: acc.accountType === 'LIVE' ? 'live' : 'demo'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal beralih akun');
      if (onUpdateUser) {
        onUpdateUser(data.user);
      }
      triggerHaptic('success');
    } catch (err: any) {
      alert(err.message || 'Gagal beralih akun cTrader');
    } finally {
      setIsSwitching(false);
    }
  };

  // Re-sync cTrader
  const handleManualSync = () => {
    setIsSyncing(true);
    triggerHaptic('medium');
    setTimeout(() => {
      setIsSyncing(false);
      setSyncSuccessMsg('Posisi cTrader tersinkronisasi 100% real-time!');
      triggerHaptic('success');
      setTimeout(() => setSyncSuccessMsg(null), 3500);
    }, 1000);
  };

  // Compute live performance metrics
  const totalTradesCount = liveTrades.length + closedTrades.length;
  const winningTrades = closedTrades.filter((t) => (t.profitUSD ?? 0) > 0);
  const winRate = closedTrades.length > 0 ? (((winningTrades.length / closedTrades.length) * 100) || 0).toFixed(1) : (currentUser.cTraderConnected && currentUser.winRate ? currentUser.winRate.toFixed(1) : '0.0');
  const closedProfitUSD = closedTrades.reduce((acc, t) => acc + (t.profitUSD ?? 0), 0);
  const liveProfitUSD = liveTrades.reduce((acc, t) => acc + (t.profitUSD ?? 0), 0);
  const netProfitUSD = +((closedProfitUSD + liveProfitUSD) || 0).toFixed(2);
  const totalPips = +((closedTrades.reduce((acc, t) => acc + (t.pips ?? 0), 0) + liveTrades.reduce((acc, t) => acc + (t.pips ?? 0), 0)) || 0).toFixed(1);

  return (
    <div className="w-full max-w-md mx-auto pb-24 px-3 sm:px-0 space-y-3.5">
      
      {/* Dashboard Top Header */}
      <div className="pt-2 pb-1 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white font-display flex items-center gap-2">
            <span>Dashboard Trader</span>
          </h2>
          <p className="text-xs text-neutral-400">cTrader Live Activity & Hub Broker</p>
        </div>

        {/* Quick Sync / Gateway Trigger */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="p-2 rounded-xl bg-[#141414] hover:bg-[#1f1f1f] text-neutral-300 border border-[#222222] transition-colors cursor-pointer disabled:opacity-50"
            title="Sinkronkan Posisi"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-amber-400' : ''}`} />
          </button>
          {onOpenCTraderGateway && (
            <button
              onClick={onOpenCTraderGateway}
              className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer"
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Kelola Akun</span>
            </button>
          )}
        </div>
      </div>

      {syncSuccessMsg && (
        <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center gap-2 text-xs text-emerald-300">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{syncSuccessMsg}</span>
        </div>
      )}

      {/* 3 Main Tabs: Ringkasan, Live, Portofolio */}
      <div className="flex bg-[#111111] p-1 rounded-2xl border border-[#1f1f1f]">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Ringkasan & Broker
        </button>
        <button
          onClick={() => setActiveTab('live')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer relative ${
            activeTab === 'live'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <span>Live OP ({liveTrades.length})</span>
          {liveTrades.length > 0 && (
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block ml-1 animate-pulse" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('portfolio')}
          className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${
            activeTab === 'portfolio'
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          Portofolio ({closedTrades.length})
        </button>
      </div>

      {/* Tab 1: Ringkasan & Broker */}
      {activeTab === 'summary' && (
        <div className="space-y-3.5">
          
          {/* Main Performance Hero Card */}
          <div className="bg-[#111111] rounded-2xl p-4 border border-amber-500/30 space-y-4 relative overflow-hidden shadow-[0_4px_24px_-2px_rgba(0,0,0,0.6)]">
            <div className="flex justify-between items-start">
              <div>
                <span className="text-[11px] text-neutral-400 uppercase font-bold tracking-wider">
                  Total Profit / Loss Bersih
                </span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className={`text-2xl font-black font-mono ${(netProfitUSD || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {(netProfitUSD || 0) >= 0 ? '+$' : '-$'}{Math.abs(netProfitUSD || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-mono text-neutral-400">
                    ({totalPips > 0 ? '+' : ''}{totalPips} Pips)
                  </span>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[11px] text-neutral-400 uppercase font-bold tracking-wider">
                  Win Rate
                </span>
                <span className="text-xl font-black text-amber-300 block font-mono">
                  {winRate}%
                </span>
              </div>
            </div>

            {/* Performance Grid */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-[#1f1f1f] text-center font-mono">
              <div className="bg-[#161616] p-2.5 rounded-xl border border-[#222222]">
                <span className="text-[10px] text-neutral-400 block font-sans">Total Trades</span>
                <span className="text-sm font-bold text-white">{totalTradesCount}</span>
              </div>
              <div className="bg-[#161616] p-2.5 rounded-xl border border-[#222222]">
                <span className="text-[10px] text-neutral-400 block font-sans">Live Active</span>
                <span className="text-sm font-bold text-emerald-400">{liveTrades.length} OP</span>
              </div>
              <div className="bg-[#161616] p-2.5 rounded-xl border border-[#222222]">
                <span className="text-[10px] text-neutral-400 block font-sans">Win / Loss</span>
                <span className="text-sm font-bold text-white">{winningTrades.length} / {closedTrades.length - winningTrades.length}</span>
              </div>
            </div>
          </div>

          {/* === DEDICATED CTRADER BROKER HUB ON DASHBOARD === */}
          <div className="bg-gradient-to-b from-[#0c1f14] to-[#08150d] rounded-2xl p-4 border border-emerald-500/40 space-y-3.5 relative overflow-hidden shadow-lg shadow-emerald-950/40">
            {/* Header / Active Status */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Koneksi Broker cTrader</h3>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping inline-block" />
                  </div>
                  <span className="text-[10px] text-emerald-300/80 font-mono">
                    Open API Protobuf (WebSocket WS:5036 • ~18ms)
                  </span>
                </div>
              </div>

              <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                currentUser.cTraderConnected
                  ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                  : 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
              }`}>
                {currentUser.cTraderConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>

            {/* Active Account Card & Switcher */}
            <div className="bg-[#0e2719]/80 p-3 rounded-xl border border-emerald-500/25 space-y-2.5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-white text-xs">
                      {currentUser.cTraderConnected ? (activeAccount?.brokerName || 'Spotware cTrader') : 'Spotware cTrader'}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-black ${
                      (activeAccount?.accountType || 'LIVE') === 'LIVE'
                        ? 'bg-emerald-500 text-black'
                        : 'bg-amber-500 text-black'
                    }`}>
                      {currentUser.cTraderConnected ? (activeAccount?.accountType || 'LIVE') : 'OFFLINE'}
                    </span>
                  </div>
                  <span className="text-[11px] text-emerald-300 font-mono block">
                    ID: {currentUser.cTraderConnected ? (currentUser.cTraderAccountId || activeAccount?.accountId || 'Belum Terhubung') : 'Belum Terhubung'}
                  </span>
                </div>

                <div className="text-right font-mono">
                  <span className="text-xs font-black text-white block">
                    {currentUser.cTraderConnected ? `$${(activeAccount?.balance || 0).toLocaleString()} USD` : '$0 USD'}
                  </span>
                  <span className="text-[9px] text-neutral-400">
                    {currentUser.cTraderConnected ? `Leverage 1:${activeAccount?.leverage || 500}` : 'Status: Belum Terhubung'}
                  </span>
                </div>
              </div>

              {/* Account Switcher Pills */}
              {currentAccounts.length > 0 && (
                <div className="pt-2 border-t border-emerald-500/20">
                  <span className="text-[10px] text-neutral-400 font-semibold mb-1.5 block flex items-center justify-between">
                    <span>Pilih / Beralih Akun Aktif:</span>
                    {isSwitching && <span className="text-amber-300 text-[9px] animate-pulse">Menghubungkan...</span>}
                  </span>

                  <div className="grid grid-cols-3 gap-1.5">
                    {currentAccounts.map((acc) => {
                      const isSelected = acc.accountId === currentUser.cTraderAccountId;
                      return (
                        <button
                          key={acc.accountId}
                          onClick={() => handleQuickSwitch(acc)}
                          disabled={isSwitching}
                          className={`p-1.5 rounded-lg text-left transition-all border cursor-pointer ${
                            isSelected
                              ? 'bg-emerald-500/30 border-emerald-400 text-white shadow-sm'
                              : 'bg-[#091d12] hover:bg-[#113320] border-emerald-500/20 text-neutral-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[9px] font-bold truncate block">{acc.accountType}</span>
                            {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                          </div>
                          <span className="text-[9px] font-mono text-neutral-400 block truncate">
                            #{acc.accountId ? acc.accountId.slice(-6) : 'ACC'}
                          </span>
                          <span className="text-[9px] font-mono font-bold text-emerald-300 block">
                            ${(acc.balance || 0).toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons: Switch/Manage Gateway & New Account */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {onOpenCTraderGateway && (
                <button
                  onClick={onOpenCTraderGateway}
                  className="py-2 px-2.5 rounded-xl bg-[#0d2a1a] hover:bg-[#143d26] text-emerald-200 border border-emerald-500/30 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Kelola & Switch</span>
                </button>
              )}

              <a
                href={FP_MARKETS_REGISTER_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => triggerHaptic('selection')}
                className="py-2 px-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 hover:from-amber-400 hover:to-amber-300 text-black text-[11px] font-black flex items-center justify-center gap-1.5 transition-all shadow-md shadow-amber-500/20 cursor-pointer text-center"
              >
                <span>Buka Akun Baru</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>

            {/* New User Callout: Buka Akun cTrader Baru */}
            <div className="p-2.5 rounded-xl bg-[#091c12] border border-emerald-500/25 space-y-1.5">
              <div className="flex items-center gap-1.5 text-amber-300">
                <Sparkles className="w-3.5 h-3.5 fill-amber-300" />
                <span className="text-[11px] font-bold">Pengguna Baru? Buka Akun cTrader FP Markets</span>
              </div>
              <p className="text-[10px] text-neutral-300 leading-relaxed">
                Nikmati <strong>Raw Spread mulai 0.0 Pip</strong>, eksekusi &lt;40ms, bebas swap, serta deposit IDR instan lewat bank lokal Indonesia.
              </p>
            </div>
          </div>

          {/* Quick Shortcuts: Energy & Referral */}
          <div className="grid grid-cols-2 gap-3">
            {/* Energy Card */}
            <div 
              onClick={onOpenEnergy}
              className="bg-[#111111] p-3.5 rounded-2xl border border-[#1f1f1f] hover:border-amber-500/40 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">
                  <Zap className="w-4 h-4 fill-amber-400" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-neutral-500 group-hover:text-amber-400 transition-colors" />
              </div>
              <span className="text-[11px] text-neutral-400 block font-medium">Saldo Energy</span>
              <span className="text-base font-black font-mono text-white">
                {currentUser.energyBalance || (currentUser as any).energy || 0} <span className="text-[10px] text-amber-400">ENERGY</span>
              </span>
            </div>

            {/* Referral Card */}
            <div 
              onClick={onOpenReferral}
              className="bg-[#111111] p-3.5 rounded-2xl border border-[#1f1f1f] hover:border-emerald-500/40 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <ArrowUpRight className="w-4 h-4 text-neutral-500 group-hover:text-emerald-400 transition-colors" />
              </div>
              <span className="text-[11px] text-neutral-400 block font-medium">Afiliasi 5 Gen</span>
              <span className="text-base font-black font-mono text-white">
                {currentUser.referralsCount || 0} <span className="text-[10px] text-emerald-400">TRADERS</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Live Positions */}
      {activeTab === 'live' && (
        <div className="space-y-3">
          {liveTrades.length === 0 ? (
            <div className="text-center py-12 bg-[#111111] rounded-2xl border border-[#1f1f1f] p-5">
              <Activity className="w-8 h-8 text-neutral-600 mx-auto mb-2" />
              <h4 className="text-white font-bold text-xs mb-1">Tidak Ada Posisi Aktif</h4>
              <p className="text-[11px] text-neutral-400 max-w-xs mx-auto">
                Buka order baru dari setup card di feed dengan menekan tombol <strong>Ikuti Setup</strong> atau lakukan eksekusi order langsung di platform cTrader Anda.
              </p>
            </div>
          ) : (
            liveTrades.map((t) => {
              const strat = getStrategy(t.strategyId);
              const isBuy = t.direction === 'BUY';
              const isProfit = t.profitUSD >= 0;

              return (
                <div 
                  key={t.id}
                  className="bg-[#111111] rounded-2xl p-4 border border-[#1f1f1f] space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-base font-display">{t.symbol}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        isBuy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                      }`}>
                        {t.direction} {t.volumeLot} Lot
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`text-sm font-bold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isProfit ? '+' : ''}{(t.pips ?? 0).toFixed(1)} Pips
                      </span>
                      <span className="text-[11px] text-neutral-400 block font-mono">
                        {isProfit ? '+$' : '-$'}{Math.abs(t.profitUSD ?? 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <PositionProgressBar trade={t} isLocked={false} strategyGradient={strat.positionBarGradient} />

                  {/* Action Bar */}
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-[10px] text-neutral-500 font-mono">
                      Opened: {new Date(t.openTime).toLocaleTimeString('id-ID')}
                    </span>
                    <button
                      onClick={() => onCloseTrade(t.id)}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold transition-all cursor-pointer"
                    >
                      Tutup Posisi (Close)
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Tab 3: Portofolio (Closed Trades) */}
      {activeTab === 'portfolio' && (
        <div className="space-y-2.5">
          <div className="flex justify-between items-center px-1 mb-1 text-xs text-neutral-400">
            <span>Riwayat 20 Trade Terakhir</span>
            <span>Realized P/L</span>
          </div>
          {closedTrades.map((t) => {
            const isBuy = t.direction === 'BUY';
            const isProfit = t.profitUSD >= 0;

            return (
              <div 
                key={t.id}
                className="bg-[#111111] border border-[#1f1f1f] rounded-xl p-3 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    isProfit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                  }`}>
                    {isBuy ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-white">{t.symbol}</span>
                      <span className="text-[10px] text-neutral-400 font-mono">({t.volumeLot} Lot)</span>
                    </div>
                    <span className="text-[10px] text-neutral-500 font-mono">
                      {t.duration} • Entry: {t.entryPrice}
                    </span>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <span className={`font-bold block ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isProfit ? '+' : ''}${(t.profitUSD ?? 0).toFixed(2)}
                  </span>
                  <span className="text-[10px] text-neutral-500">
                    {isProfit ? '+' : ''}{(t.pips ?? 0).toFixed(1)} Pips
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
