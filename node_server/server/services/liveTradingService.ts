import { postRepository } from '../repositories/postRepository';

export interface LivePriceUpdate {
  postId: string;
  symbol: string;
  currentPrice: number;
  progress: number;
  profit: number;
  profitPercent: number;
  pips: number;
  status: 'OPEN' | 'CLOSED';
}

export type LiveUpdateListener = (update: LivePriceUpdate) => void;

export class LiveTradingService {
  private listeners: Set<LiveUpdateListener> = new Set();
  private tickIntervalTimer: NodeJS.Timeout | null = null;

  subscribe(listener: LiveUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcastUpdate(update: LivePriceUpdate): void {
    this.listeners.forEach((fn) => {
      try {
        fn(update);
      } catch (err) {
        console.error('[LiveTradingService] Listener error:', err);
      }
    });
  }

  /**
   * Process a single live tick simulation or incoming cTrader ProtoOASpotEvent
   */
  async processTick(postId: string, delta: number): Promise<LivePriceUpdate | null> {
    const post = await postRepository.findById(postId);
    if (!post || post.status !== 'OPEN') return null;

    const newPrice = +(post.current_price + delta).toFixed(2);
    const pipMultiplier = post.symbol.includes('JPY') ? 100 : post.symbol.includes('XAU') ? 10 : 10000;
    const pips = +(post.position_type === 'BUY' ? (newPrice - post.entry_price) * pipMultiplier : (post.entry_price - newPrice) * pipMultiplier).toFixed(1);
    const profit = +(pips * (post.lot || 1) * 10).toFixed(2);
    const profitPercent = post.entry_price ? +((profit / (post.entry_price * (post.lot || 1) * 10)) * 10).toFixed(2) : 0;
    const progress = Math.min(98, Math.max(5, Math.round(50 + pips * 0.5)));

    await postRepository.updateLivePrice(postId, newPrice, pips, profit, progress);

    const update: LivePriceUpdate = {
      postId,
      symbol: post.symbol,
      currentPrice: newPrice,
      progress,
      profit,
      profitPercent,
      pips,
      status: post.status
    };

    this.broadcastUpdate(update);
    return update;
  }

  /**
   * Starts background live ticker that simulates market fluctuations for open trades
   */
  startBackgroundTicker(intervalMs: number = 3000): void {
    if (this.tickIntervalTimer) return;

    this.tickIntervalTimer = setInterval(async () => {
      try {
        const { posts } = await postRepository.findFeedWithCursor({ limit: 15, status: 'OPEN' });
        if (posts && posts.length > 0) {
          for (const post of posts) {
            // Natural micro fluctuation
            const maxDelta = post.symbol === 'BTCUSD' ? 12.5 : post.symbol === 'XAUUSD' ? 0.35 : 0.00015;
            const delta = (Math.random() - 0.48) * maxDelta;
            await this.processTick(post.id || (post as any)._id?.toString(), delta);
          }
        }
      } catch (err: any) {
        // Silently skip if db is busy
      }
    }, intervalMs);

    console.log(`[LiveTradingService] Real-time market tick engine started (Interval: ${intervalMs}ms)`);
  }

  stopBackgroundTicker(): void {
    if (this.tickIntervalTimer) {
      clearInterval(this.tickIntervalTimer);
      this.tickIntervalTimer = null;
    }
  }
}

export const liveTradingService = new LiveTradingService();

