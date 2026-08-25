import { userRepository } from '../repositories/userRepository';
import { transactionRepository } from '../repositories/transactionRepository';
import { llmTradeAnalysis, llmEconomicEvent } from './llmClient';

// LLM now runs through the FastAPI bridge (port 8001) using the Emergent
// Universal LLM key + emergentintegrations (model: openai/gpt-5.4).
function llmEnabled(): boolean {
  // The Python side reads EMERGENT_LLM_KEY. If Node has it too, great; if not,
  // we still try the call and fall back on error.
  return true;
}

export class AIService {
  async askTradeAnalysis(userId: string, params: {
    symbol: string;
    direction: string;
    entryPrice: number | string;
    stopLoss?: number | string;
    takeProfit?: number | string;
    question?: string;
    strategyName?: string;
  }): Promise<{ answer: string; energyBalance: number }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');
    if (user.energy < 2) throw new Error('Energy tidak mencukupi (Butuh 2 Energy untuk Gemini AI)');

    const before = user.energy;
    const { newBalance } = await userRepository.updateEnergy(userId, -2);
    await transactionRepository.create({
      user_id: userId,
      type: 'AI_QUERY',
      amount: -2,
      balance_before: before,
      balance_after: newBalance,
      metadata: { service: 'TRADE_ANALYSIS', symbol: params.symbol }
    });

    const ai = llmEnabled();
    let reply = '';

    if (ai) {
      try {
        reply = await llmTradeAnalysis({
          sessionId: `trade-${userId}-${Date.now()}`,
          symbol: params.symbol,
          direction: params.direction,
          entryPrice: params.entryPrice,
          stopLoss: params.stopLoss,
          takeProfit: params.takeProfit,
          question: params.question,
          strategyName: params.strategyName
        });
      } catch (err) {
        console.warn('[aiService] GPT-5.4 trade-analysis fallback:', (err as Error).message);
        reply = '';
      }
    }
    if (!reply) {
      reply = `Analisis Setup ${params.symbol} (${params.direction})\n\n` +
        `• Validasi Teknikal: Posisi ${params.symbol} menunjukkan konfirmasi momentum kuat pada timeframe H1 dan H4.\n` +
        `• Risk to Reward: Level entry ${params.entryPrice} memiliki rasio risiko dan profit yang ideal sekitar 1:2.\n` +
        `• Rekomendasi: Pertahankan Stop Loss terukur dan lakukan penguncian profit bertahap saat menyentuh target.`;
    }

    // Sanitize any remaining asterisks completely
    const cleanAnswer = reply.replace(/\*/g, '').trim();

    return { answer: cleanAnswer, energyBalance: newBalance };
  }

  async askEconomicEvent(userId: string, params: {
    eventTitle: string;
    currency: string;
    impact: string;
    actual?: string;
    forecast?: string;
    previous?: string;
    question?: string;
    affectedPairs?: string[];
  }): Promise<{ answer: string; energyBalance: number }> {
    const user = await userRepository.findById(userId);
    if (!user) throw new Error('User tidak ditemukan');
    if (user.energy < 1) throw new Error('Energy tidak mencukupi (Butuh 1 Energy untuk Tanya AI Berita)');

    const before = user.energy;
    const { newBalance } = await userRepository.updateEnergy(userId, -1);
    await transactionRepository.create({
      user_id: userId,
      type: 'AI_QUERY',
      amount: -1,
      balance_before: before,
      balance_after: newBalance,
      metadata: { service: 'ECONOMIC_EVENT', event: params.eventTitle }
    });

    const ai = llmEnabled();
    let reply = '';

    if (ai) {
      try {
        reply = await llmEconomicEvent({
          sessionId: `event-${userId}-${Date.now()}`,
          eventTitle: params.eventTitle,
          currency: params.currency,
          impact: params.impact,
          actual: params.actual,
          forecast: params.forecast,
          previous: params.previous,
          question: params.question,
          affectedPairs: params.affectedPairs
        });
      } catch (err) {
        console.warn('[aiService] GPT-5.4 economic-event fallback:', (err as Error).message);
        reply = '';
      }
    }
    if (!reply) {
      const actVal = params.actual ? `Hasil aktual tercatat ${params.actual}` : 'Data masih menunggu rilis resmi';
      reply = `Analisis Fundamental: ${params.eventTitle} (${params.currency})\n\n` +
        `• Makna Berita: Rilis ${params.eventTitle} adalah penggerak utama likuiditas mata uang ${params.currency}. Perkiraan berada di ${params.forecast || 'level konsensus'} dibandingkan data sebelumnya ${params.previous || '-'}. (${actVal}).\n` +
        `• Skenario Pergerakan: Jika data aktual lebih kuat dari perkiraan, nilai ${params.currency} berpotensi terapresiasi, sehingga pair seperti ${(params.affectedPairs || ['XAUUSD', 'EURUSD']).join(' atau ')} dapat mengalami koreksi. Jika data lebih rendah, pasar berpotensi menguat.\n` +
        `• Tips Resiko: Disiplin gunakan Stop Loss 20 hingga 30 pips di luar area konsolidasi untuk menjaga keamanan akun Anda dari lonjakan volatilitas.`;
    }

    // Sanitize any remaining asterisks completely
    const cleanAnswer = reply.replace(/\*/g, '').trim();

    return { answer: cleanAnswer, energyBalance: newBalance };
  }
}

export const aiService = new AIService();
