const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
app.use(cors());

yahooFinance.suppressNotices(['yahooSurvey']);

// Force yahooFinance to fetch fresh crumbs/cookies
async function initYahoo() {
  try {
    // Setting validation/fetch options
    yahooFinance.setGlobalConfig({
      queue: {
        concurrency: 1,
        timeout: 10000,
      },
    });
    console.log('Yahoo Finance initialized successfully');
  } catch (err) {
    console.error('Yahoo Finance Initialization Error:', err.message);
  }
}
initYahoo();

const dataCache = new Map();
const CACHE_TTL_MS = 10000; // Increased to 10s to minimize outgoing IP rate limits

function getStartDateForInterval(intervalStr) {
  const now = new Date();
  switch (intervalStr) {
    case '1m': now.setDate(now.getDate() - 1); break;
    case '5m': now.setDate(now.getDate() - 5); break;
    case '15m': now.setDate(now.getDate() - 15); break;
    case '1d': now.setFullYear(now.getFullYear() - 1); break;
    default: now.setDate(now.getDate() - 5);
  }
  return now;
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
    const { symbol = 'RELIANCE', interval = '5m' } = req.query;

    const formattedSymbol = symbol.toUpperCase().endsWith('.NS') || symbol.toUpperCase().endsWith('.BO')
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}.NS`;

    const cacheKey = `${formattedSymbol}_${interval}`;
    const cachedData = dataCache.get(cacheKey);

    if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL_MS)) {
      return res.json(cachedData.data);
    }

    const period1Date = getStartDateForInterval(interval);

    // Call chart directly
    const result = await yahooFinance.chart(formattedSymbol, {
      period1: period1Date,
      interval: interval,
    });

    if (!result || !result.quotes || result.quotes.length === 0) {
      return res.status(404).json({ error: 'No data found for the given symbol' });
    }

    const cleanBars = result.quotes
      .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
      .map(q => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: Number(q.open.toFixed(2)),
        high: Number(q.high.toFixed(2)),
        low: Number(q.low.toFixed(2)),
        close: Number(q.close.toFixed(2)),
      }));

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
    console.error('Yahoo Fetch Error:', error.message);
    
    // Serve fallback cache if block occurs mid-session
    const cacheKey = `${req.query.symbol || 'RELIANCE'}_${req.query.interval || '5m'}`;
    const fallback = dataCache.get(cacheKey);
    if (fallback) return res.json(fallback.data);

    res.status(500).json({ error: 'Failed to fetch market data', details: error.message });
  }
});

app.get('/health', (req, res) => res.send('Server Active'));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));