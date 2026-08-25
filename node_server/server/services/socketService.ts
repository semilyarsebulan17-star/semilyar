import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { liveTradingService, LivePriceUpdate } from './liveTradingService';

export interface FeedSocketEventMap {
  'feed:new_post': (post: any) => void;
  'feed:position_update': (update: LivePriceUpdate) => void;
  'feed:position_closed': (payload: { postId: string; symbol: string; profit: number; pips: number; closedAt: string }) => void;
  'feed:stats_update': (stats: { totalOpenPositions: number; activeTraders: number }) => void;
  'ctrader:log': (log: any) => void;
  'user:energy_update': (payload: { userId: string; energyBalance: number; addedEnergy?: number }) => void;
}

class SocketService {
  private io: SocketIOServer | null = null;
  private connectedClientsCount: number = 0;

  /**
   * Initializes the Socket.IO server on top of the Node HTTP server
   */
  public init(httpServer: HttpServer): SocketIOServer {
    if (this.io) return this.io;

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      pingInterval: 10000,
      pingTimeout: 5000
    });

    this.io.on('connection', (socket: Socket) => {
      this.connectedClientsCount++;
      console.log(`[Socket.IO] Client connected: ${socket.id} (Total: ${this.connectedClientsCount})`);

      // Automatically join public feed room
      socket.join('feed:public');

      // Allow client to subscribe to specific user or post rooms
      socket.on('join:user', (userId: string) => {
        if (userId) {
          const room = `user:${userId.replace(/^user-/, '')}`;
          socket.join(room);
        }
      });

      socket.on('join:post', (postId: string) => {
        if (postId) {
          socket.join(`post:${postId}`);
        }
      });

      socket.on('disconnect', (reason) => {
        this.connectedClientsCount = Math.max(0, this.connectedClientsCount - 1);
        console.log(`[Socket.IO] Client disconnected: ${socket.id} (Reason: ${reason}, Total: ${this.connectedClientsCount})`);
      });
    });

    // Bridge LiveTradingService updates to all Socket.IO clients in real-time
    liveTradingService.subscribe((update: LivePriceUpdate) => {
      this.broadcastPositionUpdate(update);
    });

    console.log('[Socket.IO] Real-time Feed WebSocket Server initialized successfully');
    return this.io;
  }

  public getIO(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Broadcast a new trader position / trade post to all connected clients
   */
  public broadcastNewPost(post: any): void {
    if (!this.io) return;
    this.io.to('feed:public').emit('feed:new_post', post);
    console.log(`[Socket.IO] Broadcasted new trade post ${post.id} (${post.trade?.symbol} by @${post.user?.username})`);
  }

  /**
   * Broadcast position price, pips, and PnL tick updates
   */
  public broadcastPositionUpdate(update: LivePriceUpdate): void {
    if (!this.io) return;
    this.io.to('feed:public').emit('feed:position_update', update);
    this.io.to(`post:${update.postId}`).emit('feed:position_update', update);
  }

  /**
   * Broadcast when a position is closed with final settlement stats
   */
  public broadcastPositionClosed(payload: {
    postId: string;
    symbol: string;
    profit: number;
    pips: number;
    closedAt: string;
  }): void {
    if (!this.io) return;
    this.io.to('feed:public').emit('feed:position_closed', payload);
    this.io.to(`post:${payload.postId}`).emit('feed:position_closed', payload);
    console.log(`[Socket.IO] Broadcasted position closed for ${payload.postId} (${payload.symbol}, PnL: $${payload.profit})`);
  }

  /**
   * Broadcast official cTrader protocol logs
   */
  public broadcastCTraderLog(log: any): void {
    if (!this.io) return;
    this.io.emit('ctrader:log', log);
  }

  /**
   * Broadcast real-time Energy balance update to specific user
   */
  public broadcastEnergyUpdate(userId: string, energyBalance: number, addedEnergy?: number): void {
    if (!this.io) return;
    const cleanId = userId.replace(/^user-/, '');
    this.io.to(`user:${cleanId}`).emit('user:energy_update', {
      userId,
      energyBalance,
      addedEnergy
    });
    // Also emit broadcast to general in case client hasn't joined individual room
    this.io.emit('user:energy_update', {
      userId,
      energyBalance,
      addedEnergy
    });
    console.log(`[Socket.IO] Broadcasted energy balance update for user ${userId}: ${energyBalance}⚡ (+${addedEnergy || 0})`);
  }
}

export const socketService = new SocketService();
