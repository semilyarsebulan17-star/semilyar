/**
 * Scrolic Node Backend (API-only, adapted for Emergent hybrid stack).
 * FastAPI proxy at :8001 forwards /api/* here (:3001) and /socket.io/* via WS.
 * Vite serves the React frontend independently at :3000.
 */
import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import { connectToDatabase } from './server/config/database';
import { runDatabaseSeeding } from './server/scripts/seed';
import { serverCurrentSessionUserId, authRoutes } from './server/routes/authRoutes';
import { userRoutes } from './server/routes/userRoutes';
import { feedRoutes } from './server/routes/feedRoutes';
import { paymentRoutes } from './server/routes/paymentRoutes';
import { aiRoutes } from './server/routes/aiRoutes';
import { newsRoutes } from './server/routes/newsRoutes';
import { ctraderRoutes } from './server/routes/ctraderRoutes';
import { notificationRoutes } from './server/routes/notificationRoutes';
import { strategyRoutes } from './server/routes/strategyRoutes';
import { healthRoutes } from './server/routes/healthRoutes';
import { kycRoutes } from './server/routes/kycRoutes';
import { withdrawalRoutes } from './server/routes/withdrawalRoutes';
import { adminRoutes } from './server/routes/adminRoutes';
import { socketService } from './server/services/socketService';
import { liveTradingService } from './server/services/liveTradingService';
import { ctraderPositionService } from './server/services/ctraderPositionService';

dotenv.config({ path: '/app/backend/.env' });

const app = express();
const httpServer = http.createServer(app);
const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

socketService.init(httpServer);

app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  (req as any).currentSessionUserId = req.headers['x-session-user-id'] || serverCurrentSessionUserId;
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path.startsWith('/api') && req.path !== '/api/health') {
      console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

app.use(healthRoutes);
app.use(authRoutes);
app.use(userRoutes);
app.use(feedRoutes);
app.use(paymentRoutes);
app.use(aiRoutes);
app.use(newsRoutes);
app.use(ctraderRoutes);
app.use(notificationRoutes);
app.use(strategyRoutes);
app.use(kycRoutes);
app.use(withdrawalRoutes);
app.use(adminRoutes);

app.all('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Endpoint ${req.method} ${req.path} tidak ditemukan` }
  });
});

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    error: { code: err.code || 'INTERNAL_SERVER_ERROR', message: err.message || 'Terjadi kesalahan pada server' }
  });
});

async function startServer() {
  try {
    const { isConnected } = await connectToDatabase();
    if (isConnected) {
      await runDatabaseSeeding();
    }
  } catch (dbErr: any) {
    console.warn('[Server Startup] Database connection warning:', dbErr.message);
  }

  ctraderPositionService.start(2000);

  httpServer.listen(PORT, HOST, () => {
    console.log(`[Scrolic.node] SCROLIC V7 API + Socket.IO on http://${HOST}:${PORT}`);
  });
}

startServer();
