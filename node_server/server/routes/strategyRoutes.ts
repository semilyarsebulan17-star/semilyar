import { Router } from 'express';
import { strategyRepository } from '../repositories/strategyRepository';

export const strategyRoutes = Router();

strategyRoutes.get('/api/strategies', async (req, res) => {
  const strategies = await strategyRepository.findAll();
  res.json({ success: true, strategies });
});

strategyRoutes.get('/api/strategies/:id', async (req, res) => {
  const strategy = await strategyRepository.findByIdOrSlug(req.params.id);
  if (!strategy) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Strategi tidak ditemukan' } });
  }
  res.json({ success: true, strategy });
});
