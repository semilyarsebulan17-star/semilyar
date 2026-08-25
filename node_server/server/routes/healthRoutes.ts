import { Router } from 'express';
import { isDatabaseConnected } from '../config/database';

export const healthRoutes = Router();

healthRoutes.get('/api/health', (req, res) => {
  const connected = isDatabaseConnected();
  res.json({
    status: connected ? 'ok' : 'degraded',
    database: connected ? 'connected' : 'disconnected',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});
