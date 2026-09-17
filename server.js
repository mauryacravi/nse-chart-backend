const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;

const app = express();

// 1. Enable CORS for all origins (allows your Linux site to fetch data)
app.use(cors());

// Optional: Suppress Yahoo Finance notice logging
yahooFinance.suppressNotices(['yahooSurvey']);

// Map chart intervals to Yahoo Finance query intervals
function getYahooInterval(intervalStr) {
  switch (intervalStr) {
    case '1m': return '1m';
    case '5m': return '5m';
    case '15m': return '15m';
    case '1d': return '1d';
    default: return '5m';
  }
}

// Map chart intervals to historical range periods
function getYahooRange(intervalStr) {
  switch (intervalStr) {
    case '1m': return '1d';   // 1-minute data available for up to 7 days max
    case '5m': return '5d';
    case '15m': return '1m';
    case '1d': return '1y';
    default: return '5d';
  }
}

// 2. Simple EMA Calculation Helper
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
      emaArray[i] = sum / period; // Simple moving average as initial EMA value
    } else {
      emaArray[i] = (close * k) + (emaArray[i - 1] * (1 - k));
    }
  }
  return emaArray;
}

// 3. API Endpoint to fetch historical & live candles
app.get('/api/bars', async (req, res) => {
  try {
    const { symbol = 'RELIANCE', interval = '5m' } = req.query;

    // Append .NS suffix for NSE India symbols if omitted
    const formattedSymbol = symbol.toUpperCase().endsWith('.NS') || symbol.toUpperCase().endsWith('.BO')
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}.NS`;

    const queryOptions = {
      period1: getYahooRange(interval),
      interval: getYahooInterval(interval),
    };

    const result = await yahooFinance.chart(formattedSymbol, queryOptions);

    if (!result || !result.quotes || result.quotes.length === 0) {
      return res.status(404).json({ error: 'No data found for the given symbol' });
    }

    // Filter valid OHLC values and map timestamps to Unix seconds
    const cleanBars = result.quotes
      .filter(q => q.open != null && q.high != null && q.low != null && q.close != null)
      .map(q => ({
        time: Math.floor(new Date(q.date).getTime() / 1000), // UTC epoch seconds
        open: Number(q.open.toFixed(2)),
        high: Number(q.high.toFixed(2)),
        low: Number(q.low.toFixed(2)),
        close: Number(q.close.toFixed(2)),
      }));

    // Calculate technical indicators
    const ema9Values = calculateEMA(cleanBars, 9);
    const ema21Values = calculateEMA(cleanBars, 21);

    const finalBars = cleanBars.map((bar, index) => ({
      ...bar,
      ema9: ema9Values[index] !== null ? Number(ema9Values[index].toFixed(2)) : undefined,
      ema21: ema21Values[index] !== null ? Number(ema21Values[index].toFixed(2)) : undefined,
    }));

    res.json(finalBars);
  } catch (error) {
    console.error('Yahoo Finance Fetch Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch market data', details: error.message });
  }
});

// Health check endpoint for Render/Railway monitoring
app.get('/health', (req, res) => {
  res.send('Server is active');
});

// 4. Use process.env.PORT provided by deployment hosts (Render, Railway, Heroku)
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});