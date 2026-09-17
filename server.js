const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());

// In-Memory Cache (10 Seconds TTL to prevent hitting Yahoo rate limits)
const dataCache = new Map();
const CACHE_TTL_MS = 10000;

function getRangeAndInterval(intervalStr) {
  switch (intervalStr) {
    case '1m':
      return { range: '1d', interval: '1m' };
    case '5m':
      return { range: '5d', interval: '5m' };
    case '15m':
      return { range: '15d', interval: '15m' };
    case '1d':
      return { range: '1y', interval: '1d' };
    default:
      return { range: '5d', interval: '5m' };
  }
}

function calculateEMA(data, period) {
  const k = 2 / (period + 1);
  let emaArray = new Array(data.length);
  let sum = 0;

  for (let i = 0; i < data.length; i++) {
    const close = data[i].close;
    if (i < period - 1) {
      sum += close;
      emaArray[i] = null;
    } else if (i === period - 1) {
      sum += close;
      emaArray[i] = sum / period;
    } else {
      emaArray[i] = (close * k) + (emaArray[i - 1] * (1 - k));
    }
  }
  return emaArray;
}

app.get('/api/bars', async (req, res) => {
  try {
    // Force query params to plain strings safely
    const rawSymbol = Array.isArray(req.query.symbol) ? req.query.symbol[0] : req.query.symbol;
    const rawInterval = Array.isArray(req.query.interval) ? req.query.interval[0] : req.query.interval;

    const symbolParam = String(rawSymbol || 'RELIANCE').trim();
    const intervalParam = String(rawInterval || '5m').split(']')[0].trim();

    // Universal symbol formatting (NSE, US Stocks, Forex, and Crypto)
    const uppercaseSymbol = symbolParam.toUpperCase();
    const isUSOrCrypto = ['AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'BTC-USD', 'ETH-USD'].includes(uppercaseSymbol);
    const hasSuffix = uppercaseSymbol.includes('.') || uppercaseSymbol.includes('-');

    const formattedSymbol = (hasSuffix || isUSOrCrypto) 
      ? uppercaseSymbol 
      : `${uppercaseSymbol}.NS`;

    const { range, interval } = getRangeAndInterval(intervalParam);

    const cacheKey = `${formattedSymbol}_${interval}`;
    const cachedData = dataCache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
      return res.json(cachedData.data);
    }

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}?range=${range}&interval=${interval}&includePrePost=false`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 8000
    });

    const result = response.data?.chart?.result?.[0];

    if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
      return res.status(404).json({ error: 'No data found for symbol' });
    }

    const timestamps = result.timestamp;
    const quote = result.indicators.quote[0];

    const cleanBars = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (quote.open[i] != null && quote.high[i] != null && quote.low[i] != null && quote.close[i] != null) {
        cleanBars.push({
          time: timestamps[i],
          open: Number(quote.open[i].toFixed(2)),
          high: Number(quote.high[i].toFixed(2)),
          low: Number(quote.low[i].toFixed(2)),
          close: Number(quote.close[i].toFixed(2)),
        });
      }
    }

    const ema9Values = calculateEMA(cleanBars, 9);
    const ema21Values = calculateEMA(cleanBars, 21);

    const finalBars = cleanBars.map((bar, index) => ({
      ...bar,
      ema9: ema9Values[index] !== null ? Number(ema9Values[index].toFixed(2)) : undefined,
      ema21: ema21Values[index] !== null ? Number(ema21Values[index].toFixed(2)) : undefined,
    }));

    dataCache.set(cacheKey, { timestamp: Date.now(), data: finalBars });

    res.json(finalBars);

  } catch (error) {
    console.error('Fetch Error:', error.message);

    const fallbackKey = `${(req.query.symbol || 'RELIANCE').toString().toUpperCase()}.NS_${req.query.interval || '5m'}`;
    const fallback = dataCache.get(fallbackKey);
    if (fallback) return res.json(fallback.data);

    res.status(500).json({ error: 'Failed to fetch market data', details: error.message });
  }
});

app.get('/health', (req, res) => res.send('Server Active'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));