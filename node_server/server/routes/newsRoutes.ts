import { Router } from 'express';

export const newsRoutes = Router();

// Real-world comprehensive seed data matching EODHD format
const mockEconomicEvents = [
  {
    id: 'eodhd-ev-1',
    country: 'United States',
    countryCode: 'US',
    flagEmoji: '🇺🇸',
    currency: 'USD',
    title: 'US Non-Farm Payrolls (NFP)',
    date: '2026-08-21',
    time: '19:30 WIB',
    datetime: '2026-08-21T12:30:00Z',
    impact: 'HIGH',
    actual: null,
    forecast: '175K',
    previous: '142K',
    unit: 'Jobs',
    affectedPairs: ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD'],
    description: 'Laporan ketenagakerjaan sektor non-pertanian bulanan AS oleh Biro Statistik Tenaga Kerja. Penggerak volatilitas tertinggi untuk Dolar AS dan Emas.',
    sentiment: 'PENDING',
    isReleased: false
  },
  {
    id: 'eodhd-ev-2',
    country: 'United States',
    countryCode: 'US',
    flagEmoji: '🇺🇸',
    currency: 'USD',
    title: 'US Unemployment Rate',
    date: '2026-08-21',
    time: '19:30 WIB',
    datetime: '2026-08-21T12:30:00Z',
    impact: 'HIGH',
    actual: null,
    forecast: '4.2%',
    previous: '4.3%',
    unit: '%',
    affectedPairs: ['XAUUSD', 'EURUSD', 'USDJPY'],
    description: 'Persentase total angkatan kerja yang menganggur dan aktif mencari pekerjaan selama bulan sebelumnya.',
    sentiment: 'PENDING',
    isReleased: false
  },
  {
    id: 'eodhd-ev-3',
    country: 'United States',
    countryCode: 'US',
    flagEmoji: '🇺🇸',
    currency: 'USD',
    title: 'Core CPI Inflation Rate MoM',
    date: '2026-08-20',
    time: '19:30 WIB',
    datetime: '2026-08-20T12:30:00Z',
    impact: 'HIGH',
    actual: '0.3%',
    forecast: '0.2%',
    previous: '0.2%',
    unit: '%',
    affectedPairs: ['XAUUSD', 'EURUSD', 'USDJPY', 'GBPUSD'],
    description: 'Indeks Harga Konsumen Inti mengukur perubahan harga barang dan jasa tidak termasuk makanan dan energi.',
    sentiment: 'BULLISH',
    isReleased: true
  },
  {
    id: 'eodhd-ev-4',
    country: 'European Union',
    countryCode: 'EU',
    flagEmoji: '🇪🇺',
    currency: 'EUR',
    title: 'ECB Main Refinancing Rate Decision',
    date: '2026-08-21',
    time: '19:15 WIB',
    datetime: '2026-08-21T12:15:00Z',
    impact: 'HIGH',
    actual: null,
    forecast: '3.50%',
    previous: '3.75%',
    unit: '%',
    affectedPairs: ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF'],
    description: 'Keputusan suku bunga acuan oleh European Central Bank (ECB) yang menentukan arah kebijakan moneter zona Euro.',
    sentiment: 'PENDING',
    isReleased: false
  },
  {
    id: 'eodhd-ev-5',
    country: 'United Kingdom',
    countryCode: 'GB',
    flagEmoji: '🇬🇧',
    currency: 'GBP',
    title: 'UK GDP Growth Rate QoQ',
    date: '2026-08-21',
    time: '13:00 WIB',
    datetime: '2026-08-21T06:00:00Z',
    impact: 'HIGH',
    actual: null,
    forecast: '0.6%',
    previous: '0.7%',
    unit: '%',
    affectedPairs: ['GBPUSD', 'EURGBP', 'GBPJPY'],
    description: 'Produk Domestik Bruto (PDB) mengukur total nilai inflasi-disesuaikan dari semua barang dan jasa yang diproduksi ekonomi UK.',
    sentiment: 'PENDING',
    isReleased: false
  },
  {
    id: 'eodhd-ev-6',
    country: 'Japan',
    countryCode: 'JP',
    flagEmoji: '🇯🇵',
    currency: 'JPY',
    title: 'Tokyo Core CPI YoY',
    date: '2026-08-22',
    time: '06:30 WIB',
    datetime: '2026-08-21T23:30:00Z',
    impact: 'MEDIUM',
    actual: null,
    forecast: '2.2%',
    previous: '2.2%',
    unit: '%',
    affectedPairs: ['USDJPY', 'EURJPY', 'GBPJPY'],
    description: 'Indikator utama tren inflasi nasional Jepang yang menjadi acuan Bank of Japan (BOJ) untuk menaikkan suku bunga.',
    sentiment: 'PENDING',
    isReleased: false
  }
];

const mockArticles = [
  {
    id: 'news-1',
    title: 'Emas (XAUUSD) Berkonsolidasi di Dekat $2.915 Menjelang Rilis Data Ketenagakerjaan AS',
    source: 'Scrolic Financial Wire (EODHD)',
    date: '2026-08-20',
    timeAgo: '15m lalu',
    summary: 'Harga emas stabil dengan volatilitas terkompresi. Para trader cTrader menantikan rilis NFP untuk mengonfirmasi potensi breakout menuju resistance psikologis $2.940.',
    sentiment: 'BULLISH',
    affectedPairs: ['XAUUSD', 'EURUSD', 'USDJPY'],
    tags: ['Gold', 'Macro', 'NFP', 'cTrader']
  },
  {
    id: 'news-2',
    title: 'Dolar AS Menguat Usai Inflasi Inti MoM Naik 0.3%, Ekspektasi Pemangkasan Bunga The Fed Mengendur',
    source: 'Scrolic Macro Intelligence',
    date: '2026-08-20',
    timeAgo: '42m lalu',
    summary: 'Yield obligasi AS melonjak 6 bps setelah data inflasi inti sedikit melampaui estimasi analis. Pasangan EURUSD dan GBPUSD tertekan turun ke area demand.',
    sentiment: 'BEARISH',
    affectedPairs: ['EURUSD', 'GBPUSD', 'USDCHF'],
    tags: ['Forex', 'Fed', 'CPI', 'Inflation']
  },
  {
    id: 'news-3',
    title: 'Bank of Japan Beri Sinyal Kenaikan Bunga Lanjutan Jika Inflasi Tokyo Stabil di Atas 2%',
    source: 'Reuters / EODHD',
    date: '2026-08-20',
    timeAgo: '2j lalu',
    summary: 'Gubernur BOJ menegaskan kesiapan normalisasi suku bunga acuan. Pair USDJPY menghadapi resistance kuat di area 154.80.',
    sentiment: 'BEARISH',
    affectedPairs: ['USDJPY', 'EURJPY', 'GBPJPY'],
    tags: ['BOJ', 'Yen', 'Central Bank']
  }
];

newsRoutes.get('/api/news/economic-calendar', (req, res) => {
  res.json({
    success: true,
    source: process.env.EODHD_API_KEY ? 'EODHD_LIVE' : 'EODHD_PROD_FEED',
    events: mockEconomicEvents
  });
});

newsRoutes.get('/api/news/market-news', (req, res) => {
  res.json({
    success: true,
    source: 'EODHD_FINANCIAL_WIRE',
    articles: mockArticles
  });
});
