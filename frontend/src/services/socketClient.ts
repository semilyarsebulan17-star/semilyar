import { io, Socket } from 'socket.io-client';
import { FeedPost } from '../types';

export interface LivePositionUpdate {
  postId: string;
  symbol: string;
  currentPrice: number;
  progress: number;
  profit: number;
  profitPercent: number;
  pips: number;
  status: 'OPEN' | 'CLOSED';
}

export interface PositionClosedPayload {
  postId: string;
  symbol: string;
  profit: number;
  pips: number;
  closedAt: string;
}

export interface EnergyUpdatePayload {
  userId: string;
  energyBalance: number;
  addedEnergy?: number;
}

export interface CTraderPositionUpdatePayload {
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
  sl?: number;
  tp?: number;
  progress?: number;
  status?: 'OPEN' | 'CLOSED';
  timestamp: number;
}

class SocketClient {
  private socket: Socket | null = null;
  private newPostListeners: Set<(post: FeedPost) => void> = new Set();
  private positionUpdateListeners: Set<(update: LivePositionUpdate) => void> = new Set();
  private cTraderPositionListeners: Set<(payload: CTraderPositionUpdatePayload) => void> = new Set();
  private positionClosedListeners: Set<(payload: PositionClosedPayload) => void> = new Set();
  private cTraderLogListeners: Set<(log: any) => void> = new Set();
  private energyUpdateListeners: Set<(payload: EnergyUpdatePayload) => void> = new Set();
  private isConnecting: boolean = false;

  public connect(userId?: string): void {
    if (this.socket?.connected || this.isConnecting) return;
    this.isConnecting = true;

    try {
      this.socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 10000
      });

      this.socket.on('connect', () => {
        this.isConnecting = false;
        console.log(`[SocketClient] Connected to Scrolic Real-time Feed Socket: ${this.socket?.id}`);
        if (userId) {
          this.socket?.emit('join:user', userId);
        }
      });

      // SCROLIC V7 Official cTrader Realtime Event
      this.socket.on('ctrader:position:update', (payload: CTraderPositionUpdatePayload) => {
        this.cTraderPositionListeners.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            console.error('[SocketClient] ctrader:position:update listener error:', err);
          }
        });
      });

      this.socket.on('feed:new_post', (post: FeedPost) => {
        this.newPostListeners.forEach((cb) => {
          try {
            cb(post);
          } catch (err) {
            console.error('[SocketClient] new_post listener error:', err);
          }
        });
      });

      this.socket.on('feed:position_update', (update: LivePositionUpdate) => {
        this.positionUpdateListeners.forEach((cb) => {
          try {
            cb(update);
          } catch (err) {
            console.error('[SocketClient] position_update listener error:', err);
          }
        });
      });

      this.socket.on('feed:position_closed', (payload: PositionClosedPayload) => {
        this.positionClosedListeners.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            console.error('[SocketClient] position_closed listener error:', err);
          }
        });
      });

      this.socket.on('ctrader:log', (log: any) => {
        this.cTraderLogListeners.forEach((cb) => {
          try {
            cb(log);
          } catch (err) {
            console.error('[SocketClient] ctrader_log listener error:', err);
          }
        });
      });

      this.socket.on('user:energy_update', (payload: EnergyUpdatePayload) => {
        this.energyUpdateListeners.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            console.error('[SocketClient] energy_update listener error:', err);
          }
        });
      });

      this.socket.on('disconnect', (reason) => {
        this.isConnecting = false;
        console.log('[SocketClient] Disconnected from server:', reason);
      });
    } catch (err) {
      this.isConnecting = false;
      console.warn('[SocketClient] Socket.IO initialization warning:', err);
    }
  }

  public onCTraderPositionUpdate(callback: (payload: CTraderPositionUpdatePayload) => void): () => void {
    this.cTraderPositionListeners.add(callback);
    return () => this.cTraderPositionListeners.delete(callback);
  }

  public onEnergyUpdate(callback: (payload: EnergyUpdatePayload) => void): () => void {
    this.energyUpdateListeners.add(callback);
    return () => this.energyUpdateListeners.delete(callback);
  }

  public onNewPost(callback: (post: FeedPost) => void): () => void {
    this.newPostListeners.add(callback);
    return () => this.newPostListeners.delete(callback);
  }

  public onPositionUpdate(callback: (update: LivePositionUpdate) => void): () => void {
    this.positionUpdateListeners.add(callback);
    return () => this.positionUpdateListeners.delete(callback);
  }

  public onPositionClosed(callback: (payload: PositionClosedPayload) => void): () => void {
    this.positionClosedListeners.add(callback);
    return () => this.positionClosedListeners.delete(callback);
  }

  public onCTraderLog(callback: (log: any) => void): () => void {
    this.cTraderLogListeners.add(callback);
    return () => this.cTraderLogListeners.delete(callback);
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnecting = false;
  }
}

export const socketClient = new SocketClient();
