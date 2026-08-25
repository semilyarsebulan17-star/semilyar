/**
 * Small helper to call the FastAPI-hosted LLM endpoints on port 8001.
 *
 * The Emergent Universal LLM key + emergentintegrations lib live on the
 * Python side; this file lets the Node services stay unchanged in shape
 * (same function signatures) while their heavy lifting moves to Python.
 */

const LLM_BASE = process.env.SCROLIC_LLM_BASE || 'http://localhost:8001';

async function _post<T = any>(path: string, body: any): Promise<T> {
  const res = await fetch(`${LLM_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail = data?.detail || data?.raw || `LLM ${path} failed (${res.status})`;
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return data as T;
}

export async function llmTradeAnalysis(input: {
  sessionId: string;
  symbol: string;
  direction: string;
  entryPrice: number | string;
  stopLoss?: number | string;
  takeProfit?: number | string;
  question?: string;
  strategyName?: string;
}): Promise<string> {
  const out = await _post<{ answer: string }>('/api/_llm/trade-analysis', {
    session_id: input.sessionId,
    symbol: input.symbol,
    direction: input.direction,
    entryPrice: String(input.entryPrice),
    stopLoss: input.stopLoss !== undefined ? String(input.stopLoss) : undefined,
    takeProfit: input.takeProfit !== undefined ? String(input.takeProfit) : undefined,
    question: input.question,
    strategyName: input.strategyName,
  });
  return out.answer || '';
}

export async function llmEconomicEvent(input: {
  sessionId: string;
  eventTitle: string;
  currency: string;
  impact: string;
  actual?: string;
  forecast?: string;
  previous?: string;
  question?: string;
  affectedPairs?: string[];
}): Promise<string> {
  const out = await _post<{ answer: string }>('/api/_llm/economic-event', {
    session_id: input.sessionId,
    eventTitle: input.eventTitle,
    currency: input.currency,
    impact: input.impact,
    actual: input.actual,
    forecast: input.forecast,
    previous: input.previous,
    question: input.question,
    affectedPairs: input.affectedPairs,
  });
  return out.answer || '';
}

export interface KtpOcrData {
  nik?: string;
  namaLengkap?: string;
  tempatTanggalLahir?: string;
  alamat?: string;
  isValidKtp?: boolean;
  confidenceScore?: number;
  statusMessage?: string;
}

export async function llmKycKtp(input: {
  sessionId: string;
  imageBase64: string;
  mimeType?: string;
}): Promise<KtpOcrData> {
  const out = await _post<{ data: KtpOcrData }>('/api/_llm/kyc-ktp', {
    session_id: input.sessionId,
    image_base64: input.imageBase64,
    mime_type: input.mimeType || 'image/jpeg',
  });
  return out.data || {};
}
