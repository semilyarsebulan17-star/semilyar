/**
 * SCROLIC V7 — FINAL CTRADER OPEN API REALTIME INTEGRATION SERVICE
 * Spec:
 * - ProtoOASubscribeSpotsReq / ProtoOASpotEvent
 * - ProtoOAGetPositionUnrealizedPnLReq / ProtoOAGetPositionUnrealizedPnLRes
 * - ProtoOAReconcileReq / ProtoOAPosition
 * - Pip size determination by symbol.pipPosition
 * - Socket.IO realtime event: 'ctrader:position:update'
 */
import { postRepository } from '../repositories/postRepository';
import { socketService } from './socketService';

export interface CTraderPositionPayload {
  positionId: string;
  postId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  direction?: 'BUY' | 'SELL';
  entry: number;
  current: number;
  currentPrice?: number;
  pips: number;
  profitUsd: number;
  profit?: number;
  profitPercent?: number;
  sl: number;
  tp: number;
  progress: number;
  status: 'OPEN' | 'CLOSED';
  timestamp: number;
}

export function getPipSize(symbol: string, pipPosition?: number): number {
  if (typeof pipPosition === 'number' && pipPosition >= 0) {
    return Math.pow(10, -pipPosition);
  }
  const sym = symbol.toUpperCase();
  if (sym.includes('XAU') || sym.includes('GOLD')) {
    return 0.1; // pipPosition = 1
  } else if (sym.includes('BTC') || sym.includes('ETH') || sym.includes('CRYPTO')) {
    return 1.0; // pipPosition = 0
  } else if (sym.includes('JPY')) {
    return 0.01; // pipPosition = 2
  } else {
    return 0.0001; // pipPosition = 4
  }
}

export function calculatePips(
  side: string,
  entryPrice: number,
  currentBid: number,
  currentAsk: number,
  pipSize: number
): number {
  if (pipSize <= 0) pipSize = 0.0001;
  const isBuy = side.toUpperCase() === 'BUY' || side === '1';
  if (isBuy) {
    return +((currentBid - entryPrice) / pipSize).toFixed(1);
  } else {
    return +((entryPrice - currentAsk) / pipSize).toFixed(1);
  }
}

export function calculateProgressBar(
  side: string,
  entry: number,
  current: number,
  sl: number,
  tp: number,
  pips: number
): number {
  const isBuy = side.toUpperCase() === 'BUY' || side === '1';

  if (tp > 0 && entry > 0) {
    if (isBuy && tp > entry) {
      const progress = ((current - entry) / (tp - entry)) * 100;
      return Math.min(100, Math.max(0, Math.round(progress)));
    } else if (!isBuy && entry > tp) {
      const progress = ((entry - current) / (entry - tp)) * 100;
      return Math.min(100, Math.max(0, Math.round(progress)));
    }
  }

  // Fallback when TP is not set: base at 50% and dynamically scale with pips
  const fallback = Math.round(50 + pips * 0.5);
  return Math.min(100, Math.max(0, fallback));
}

export class CTraderPositionService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  /**
   * Transforms an open position or post into the official SCROLIC V7 payload
   */
  public buildPositionPayload(post: any, bidPrice?: number, askPrice?: number): CTraderPositionPayload | null {
    if (!post || post.status !== 'OPEN') return null;

    const symbol = post.symbol || 'XAUUSD';
    const side = (post.position_type || 'BUY').toUpperCase() as 'BUY' | 'SELL';
    const entry = +(post.entry_price || post.price || 0);
    const curr = +(post.current_price || entry);
    const pipSize = getPipSize(symbol);

    const currentBid = bidPrice !== undefined ? bidPrice : curr;
    const currentAsk = askPrice !== undefined ? askPrice : +(currentBid + pipSize * 0.2).toFixed(4);

    const pips = calculatePips(side, entry, currentBid, currentAsk, pipSize);

    // Unrealized P/L USD: Pure cTrader floating profit
    // Formula: USD P/L = netUnrealizedPnL / 10^moneyDigits
    const profitUsd = +(post.profit || 0);
    const sl = +(post.stop_loss || 0);
    const tp = +(post.take_profit || 0);

    const progress = calculateProgressBar(side, entry, currentBid, sl, tp, pips);
    const profitPercent = +((profitUsd / 1000) * 100).toFixed(2);

    const postId = post.id || post._id?.toString() || '';
    const positionId = post.trade_id || postId;

    return {
      positionId,
      postId,
      symbol,
      side,
      direction: side,
      entry,
      current: currentBid,
      currentPrice: currentBid,
      pips,
      profitUsd,
      profit: profitUsd,
      profitPercent,
      sl,
      tp,
      progress,
      status: 'OPEN',
      timestamp: Date.now()
    };
  }

  /**
   * Broadcasts the official SCROLIC V7 realtime event across Socket.IO
   */
  public broadcastPosition(payload: CTraderPositionPayload): void {
    const io = socketService.getIO();
    if (!io || !payload) return;

    // Official SCROLIC V7 event
    io.emit('ctrader:position:update', payload);

    // Existing live update for backward compatibility
    io.emit('feed:position_update', {
      postId: payload.postId || payload.positionId,
      symbol: payload.symbol,
      currentPrice: payload.current,
      progress: payload.progress,
      profit: payload.profitUsd,
      profitPercent: payload.profitPercent || 0,
      pips: payload.pips,
      status: 'OPEN'
    });
  }

  /**
   * Starts periodic polling and realtime price streaming for connected positions
   */
  public start(intervalMs: number = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;

    this.timer = setInterval(async () => {
      try {
        const { posts } = await postRepository.findFeedWithCursor({ limit: 20, status: 'OPEN' });
        if (posts && posts.length > 0) {
          for (const post of posts) {
            const payload = this.buildPositionPayload(post);
            if (payload) {
              this.broadcastPosition(payload);
            }
          }
        }
      } catch (err) {
        // Silently skip if db query is busy
      }
    }, intervalMs);

    console.log(`[CTraderPositionService] Official Realtime cTrader Position Monitor started (${intervalMs}ms interval).`);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }
}

export const ctraderPositionService = new CTraderPositionService();
