import { Router } from 'express';
import { aiService } from '../services/aiService';
import { postRepository } from '../repositories/postRepository';

export const aiRoutes = Router();

// 1. POST /api/ai/ask-trade & /api/ai/ask
const handleAskTrade = async (req: any, res: any) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    let { postId, symbol, direction, entryPrice, stopLoss, takeProfit, question, strategyName } = req.body;

    if (postId && (!symbol || !direction)) {
      const post = await postRepository.findById(postId);
      if (post) {
        symbol = post.symbol;
        direction = post.position_type;
        entryPrice = post.entry_price;
        stopLoss = post.stop_loss;
        takeProfit = post.take_profit;
        strategyName = post.strategy_name;
      }
    }

    const result = await aiService.askTradeAnalysis(currentUserId, {
      symbol: symbol || 'XAUUSD',
      direction: direction || 'BUY',
      entryPrice: entryPrice || 2914.50,
      stopLoss,
      takeProfit,
      question,
      strategyName: strategyName || 'MOMENTUM BREAKOUT'
    });

    res.json({
      success: true,
      answer: result.answer,
      energyBalance: result.energyBalance
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
};

aiRoutes.post('/api/ai/ask-trade', handleAskTrade);
aiRoutes.post('/api/ai/ask', handleAskTrade);

// 2. POST /api/ai/ask-economic
aiRoutes.post('/api/ai/ask-economic', async (req, res) => {
  const currentUserId = (req.headers['x-session-user-id'] as string) || (req as any).currentSessionUserId || null;
  if (!currentUserId) return res.status(401).json({ error: 'Harap login terlebih dahulu' });

  try {
    const { eventTitle, currency, impact, actual, forecast, previous, question, affectedPairs } = req.body;
    const result = await aiService.askEconomicEvent(currentUserId, {
      eventTitle: eventTitle || 'Economic Release',
      currency: currency || 'USD',
      impact: impact || 'HIGH',
      actual,
      forecast,
      previous,
      question,
      affectedPairs
    });

    res.json({
      success: true,
      answer: result.answer,
      energyBalance: result.energyBalance
    });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});
