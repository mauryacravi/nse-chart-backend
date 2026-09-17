const express = require('express');
const cors = require('cors');
const yahooFinance = require('yahoo-finance2').default;

const app = express();

app.use(cors());
yahooFinance.suppressNotices(['yahooSurvey']);

function getYahooInterval(intervalStr) {
  switch (intervalStr) {
    case '1m': return '1m';
    case '5m': return '5m';
    case '15m': return '15m';
    case '1d': return '1d';
    default: return '5m';
  }
}

// Helper function to calculate a past Date object for period1
function getStartDateForInterval(intervalStr) {
  const now = new Date();
  switch (intervalStr) {
    case '1m':
      now.setDate(now.getDate() - 1); // 1 day back (Yahoo limits 1m data)
      break;
    case '5m':
      now.setDate(now.getDate() - 5); // 5 days back
      break;
    case '15m':
      now.setDate(now.getDate() - 15); // 15 days back
      break;
    case '1d':
      now.setFullYear(now.getFullYear() - 1); // 1 year back
      break;
    default:
      now.setDate(now.getDate() - 5);
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

    // Calculate a valid JS Date object for period1
    const period1Date = getStartDateForInterval(interval);

    const queryOptions = {
      period1: period1Date, // Pass valid Date object
      interval: getYahooInterval(interval),
    };

    const result = await yahooFinance.chart(formattedSymbol, queryOptions);

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

    res.json(finalBars);
  } catch (error) {
    console.error('Yahoo Finance Fetch Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch market data', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.send('Server is active');
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Backend API running on port ${PORT}`);
});