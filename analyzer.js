const https = require('https');
const http = require('http');
const urlModule = require('url');

// Helper to fetch HTML content with support for redirects and large headers
function fetchHtml(url, redirectLimit = 5) {
  return new Promise((resolve, reject) => {
    if (redirectLimit <= 0) {
      return reject(new Error('Too many redirects'));
    }
    const parsedUrl = urlModule.parse(url);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    };
    client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let newUrl = res.headers.location;
        if (!newUrl.startsWith('http')) {
          newUrl = parsedUrl.protocol + '//' + parsedUrl.host + newUrl;
        }
        return resolve(fetchHtml(newUrl, redirectLimit - 1));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Status ${res.statusCode} for URL: ${url}`));
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Helper to fetch JSON data
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            reject(new Error(`Status ${res.statusCode} for URL: ${url}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

// Core Data Collector
async function collectStockData(ticker) {
  ticker = ticker.toUpperCase().trim();
  const statsUrl = `https://finance.yahoo.com/quote/${ticker}/key-statistics/`;
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=6mo&interval=1d`;
  const newsUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${ticker}&newsCount=10`;

  const results = {
    summary: {},
    chart: [],
    news: [],
    meta: {}
  };

  // 1. Fetch Key Statistics
  try {
    const html = await fetchHtml(statsUrl);
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    let quoteSummaryResult = null;
    while ((match = scriptRegex.exec(html)) !== null) {
      const content = match[1].trim();
      if (content.startsWith('{') && content.includes('quoteSummary')) {
        try {
          const parsed = JSON.parse(content);
          if (parsed.body) {
            const bodyParsed = JSON.parse(parsed.body);
            if (bodyParsed.quoteSummary && bodyParsed.quoteSummary.result) {
              quoteSummaryResult = bodyParsed.quoteSummary.result[0];
              break;
            }
          }
        } catch (e) {
          // Continue scanning
        }
      }
    }

    if (quoteSummaryResult) {
      const fd = quoteSummaryResult.financialData || {};
      const ks = quoteSummaryResult.defaultKeyStatistics || {};
      const sd = quoteSummaryResult.summaryDetail || {};
      const pr = quoteSummaryResult.price || {};

      results.meta = {
        name: pr.longName || pr.shortName || ticker,
        symbol: ticker,
        currency: pr.financialCurrency || sd.currency || 'USD',
        sector: pr.sector || 'N/A',
        industry: pr.industry || 'N/A'
      };

      results.summary = {
        currentPrice: pr.regularMarketPrice?.raw || sd.regularMarketPrice?.raw || fd.currentPrice?.raw || 0,
        trailingPE: sd.trailingPE?.raw || ks.trailingPE?.raw || null,
        forwardPE: sd.forwardPE?.raw || ks.forwardPE?.raw || null,
        trailingEps: ks.trailingEps?.raw || 0,
        forwardEps: ks.forwardEps?.raw || 0,
        beta: sd.beta?.raw || ks.beta?.raw || null,
        marketCap: sd.marketCap?.raw || pr.marketCap?.raw || 0,
        totalRevenue: fd.totalRevenue?.raw || 0,
        revenueGrowth: fd.revenueGrowth?.raw || 0,
        earningsGrowth: fd.earningsGrowth?.raw || 0,
        profitMargin: fd.profitMargins?.raw || ks.profitMargins?.raw || 0,
        operatingMargin: fd.operatingMargins?.raw || ks.operatingMargins?.raw || 0,
        returnOnEquity: fd.returnOnEquity?.raw || 0,
        totalDebt: fd.totalDebt?.raw || 0,
        totalCash: fd.totalCash?.raw || 0,
        debtToEquity: fd.debtToEquity?.raw || 0,
        freeCashflow: fd.freeCashflow?.raw || 0,
        operatingCashflow: fd.operatingCashflow?.raw || 0
      };
    } else {
      throw new Error('Key statistics block not found on page.');
    }
  } catch (err) {
    console.error(`Error fetching statistics for ${ticker}:`, err.message);
    throw new Error(`Failed to retrieve fundamentals for ${ticker}. Check ticker spelling.`);
  }

  // 2. Fetch Chart (Historical Prices)
  try {
    const chartData = await fetchJson(chartUrl);
    if (chartData.chart?.result?.[0]) {
      const resObj = chartData.chart.result[0];
      const timestamps = resObj.timestamp || [];
      const quotes = resObj.indicators.quote[0] || {};
      const closes = quotes.close || [];
      const volumes = quotes.volume || [];
      const opens = quotes.open || [];
      const highs = quotes.high || [];
      const lows = quotes.low || [];

      const chartList = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] !== null && closes[i] !== undefined) {
          chartList.push({
            date: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
            timestamp: timestamps[i],
            open: opens[i] || closes[i],
            high: highs[i] || closes[i],
            low: lows[i] || closes[i],
            close: closes[i],
            volume: volumes[i] || 0
          });
        }
      }
      results.chart = chartList;
    }
  } catch (err) {
    console.error(`Error fetching chart for ${ticker}:`, err.message);
    results.chart = []; // Return empty chart if failed, app will mock/skip indicators
  }

  // 3. Fetch News
  try {
    const newsData = await fetchJson(newsUrl);
    if (newsData.news) {
      results.news = newsData.news.map(item => ({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        time: item.providerPublishTime
      }));
    }
  } catch (err) {
    console.error(`Error fetching news for ${ticker}:`, err.message);
    results.news = [];
  }

  return results;
}

// Fundamental Analysis Module
function analyzeFundamentals(summary) {
  let score = 0;
  const rationale = [];

  // P/E Score (Valuation) - Max 30
  const pe = summary.trailingPE;
  if (pe === null || pe === undefined || pe < 0) {
    rationale.push('Negative or unavailable P/E ratio indicates no earnings or high speculative pricing.');
    score += 5;
  } else if (pe < 15) {
    rationale.push(`Highly attractive valuation with a low P/E ratio of ${pe.toFixed(2)}.`);
    score += 30;
  } else if (pe <= 25) {
    rationale.push(`Reasonable valuation with a moderate P/E ratio of ${pe.toFixed(2)}.`);
    score += 20;
  } else if (pe <= 40) {
    rationale.push(`Elevated valuation with a P/E ratio of ${pe.toFixed(2)}, pricing in growth expectations.`);
    score += 10;
  } else {
    rationale.push(`High P/E ratio of ${pe.toFixed(2)} suggests the stock may be overvalued relative to historical earnings.`);
    score += 5;
  }

  // ROE Score (Profitability) - Max 25
  const roe = summary.returnOnEquity;
  if (roe > 0.25) {
    rationale.push(`Outstanding profitability with a Return on Equity (ROE) of ${(roe * 100).toFixed(2)}%.`);
    score += 25;
  } else if (roe > 0.15) {
    rationale.push(`Solid profitability with a Return on Equity (ROE) of ${(roe * 100).toFixed(2)}%.`);
    score += 18;
  } else if (roe > 0.05) {
    rationale.push(`Moderate Return on Equity (ROE) of ${(roe * 100).toFixed(2)}%.`);
    score += 10;
  } else if (roe > 0) {
    rationale.push(`Low Return on Equity (ROE) of ${(roe * 100).toFixed(2)}%.`);
    score += 5;
  } else {
    rationale.push(`Negative Return on Equity (ROE) of ${(roe * 100).toFixed(2)}% indicates capital destruction.`);
    score += 0;
  }

  // Profit Margin (Efficiency) - Max 15
  const margin = summary.profitMargin;
  if (margin > 0.20) {
    rationale.push(`High profit margins of ${(margin * 100).toFixed(2)}% show excellent pricing power.`);
    score += 15;
  } else if (margin > 0.10) {
    rationale.push(`Good profit margins of ${(margin * 100).toFixed(2)}%.`);
    score += 10;
  } else if (margin > 0) {
    rationale.push(`Thin profit margins of ${(margin * 100).toFixed(2)}%, vulnerable to cost inflation.`);
    score += 5;
  } else {
    rationale.push(`Negative profit margin of ${(margin * 100).toFixed(2)}% indicates unprofitable operations.`);
    score += 0;
  }

  // Debt-to-Equity (Solvency) - Max 15
  const de = summary.debtToEquity; // Note: D/E can be raw numeric e.g. 79.55 representing 79.55%
  if (de === null || de === undefined || de <= 0) {
    rationale.push('No long-term debt or debt info unavailable, indicating minimal leverage risk.');
    score += 15;
  } else if (de < 50) {
    rationale.push(`Very conservative balance sheet with a low Debt-to-Equity ratio of ${de.toFixed(2)}%.`);
    score += 15;
  } else if (de <= 120) {
    rationale.push(`Manageable leverage with a Debt-to-Equity ratio of ${de.toFixed(2)}%.`);
    score += 10;
  } else if (de <= 200) {
    rationale.push(`Elevated debt levels with a Debt-to-Equity ratio of ${de.toFixed(2)}%.`);
    score += 5;
  } else {
    rationale.push(`High financial leverage with a Debt-to-Equity ratio of ${de.toFixed(2)}%, indicating solvency risk.`);
    score += 0;
  }

  // Growth Score (Revenue Growth) - Max 15
  const revGrowth = summary.revenueGrowth;
  if (revGrowth > 0.15) {
    rationale.push(`Robust revenue growth of ${(revGrowth * 100).toFixed(2)}% YoY.`);
    score += 15;
  } else if (revGrowth > 0.05) {
    rationale.push(`Stable revenue growth of ${(revGrowth * 100).toFixed(2)}% YoY.`);
    score += 10;
  } else if (revGrowth >= 0) {
    rationale.push(`Slow or stagnant revenue growth of ${(revGrowth * 100).toFixed(2)}% YoY.`);
    score += 5;
  } else {
    rationale.push(`Declining revenue growth of ${(revGrowth * 100).toFixed(2)}% YoY.`);
    score += 0;
  }

  let label = 'Fairly Valued';
  if (score >= 70) label = 'Undervalued / Strong Buy Candidate';
  else if (score < 40) label = 'Overvalued / Weak Fundamentals';

  return {
    score,
    label,
    rationale,
    metrics: {
      pe: pe ? pe.toFixed(2) : 'N/A',
      forwardPe: summary.forwardPE ? summary.forwardPE.toFixed(2) : 'N/A',
      roe: (summary.returnOnEquity * 100).toFixed(2) + '%',
      profitMargin: (summary.profitMargin * 100).toFixed(2) + '%',
      debtToEquity: de ? de.toFixed(2) + '%' : 'N/A',
      revenueGrowth: (summary.revenueGrowth * 100).toFixed(2) + '%'
    }
  };
}

// Sentiment Analysis Module
function analyzeSentiment(news) {
  if (!news || news.length === 0) {
    return {
      score: 50,
      label: 'Neutral',
      positiveCount: 0,
      negativeCount: 0,
      details: 'No recent news available to analyze.'
    };
  }

  const positiveLexicon = [
    'surge', 'growth', 'profit', 'upbeat', 'beat', 'outperform', 'gain', 'higher', 'positive', 
    'raise', 'increase', 'expansion', 'bullish', 'record', 'strong', 'acquire', 'acquisition', 
    'dividend', 'success', 'innovative', 'buy', 'opportunity', 'partnership', 'expand'
  ];

  const negativeLexicon = [
    'decline', 'fall', 'loss', 'drop', 'deficit', 'miss', 'underperform', 'lower', 'negative', 
    'cut', 'decrease', 'bearish', 'slump', 'plummet', 'debt', 'lawsuit', 'investigation', 
    'layoff', 'layoffs', 'risk', 'warn', 'sell', 'lawsuits', 'concerns', 'fears', 'disappointing', 'charges'
  ];

  let positiveCount = 0;
  let negativeCount = 0;
  const analyzedArticles = [];

  news.forEach(art => {
    const text = art.title.toLowerCase();
    let posInArticle = 0;
    let negInArticle = 0;

    positiveLexicon.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) posInArticle += matches.length;
    });

    negativeLexicon.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = text.match(regex);
      if (matches) negInArticle += matches.length;
    });

    positiveCount += posInArticle;
    negativeCount += negInArticle;

    let sentiment = 'Neutral';
    if (posInArticle > negInArticle) sentiment = 'Positive';
    else if (negInArticle > posInArticle) sentiment = 'Negative';

    analyzedArticles.push({
      title: art.title,
      publisher: art.publisher,
      sentiment
    });
  });

  const totalHits = positiveCount + negativeCount;
  let score = 50; // default neutral
  if (totalHits > 0) {
    const ratio = (positiveCount - negativeCount) / totalHits; // Range -1 to +1
    score = Math.round(((ratio + 1) / 2) * 100); // Scale to 0-100
  }

  let label = 'Neutral';
  if (score >= 60) label = 'Bullish / Positive';
  else if (score < 40) label = 'Bearish / Negative';

  const details = `Analyzed ${news.length} news articles. Found ${positiveCount} positive keywords and ${negativeCount} negative keywords.`;

  return {
    score,
    label,
    positiveCount,
    negativeCount,
    details,
    articles: analyzedArticles.slice(0, 5) // Send top 5 analyzed articles
  };
}

// Technical Analysis Module
function analyzeTechnicals(chart) {
  if (!chart || chart.length < 50) {
    // If historical price is too short, return mock trend or sideways placeholder
    return {
      score: 50,
      label: 'Sideways / Incomplete Data',
      indicators: { rsi: 'N/A', macdHist: 'N/A', sma20: 'N/A', sma50: 'N/A' },
      details: 'Historical chart data is too short to compute technical indicators.'
    };
  }

  const closes = chart.map(c => c.close);
  const latestPrice = closes[closes.length - 1];

  // 1. Simple Moving Averages (SMA)
  const computeSMA = (data, period) => {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        sma.push(null);
      } else {
        const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        sma.push(sum / period);
      }
    }
    return sma;
  };

  const sma20List = computeSMA(closes, 20);
  const sma50List = computeSMA(closes, 50);
  const latestSma20 = sma20List[sma20List.length - 1];
  const latestSma50 = sma50List[sma50List.length - 1];

  // 2. Exponential Moving Averages (EMA)
  const computeEMA = (data, period) => {
    const ema = [];
    const k = 2 / (period + 1);
    let prevEma = null;

    for (let i = 0; i < data.length; i++) {
      if (i < period - 1) {
        ema.push(null);
      } else if (i === period - 1) {
        const sum = data.slice(0, period).reduce((a, b) => a + b, 0);
        prevEma = sum / period;
        ema.push(prevEma);
      } else {
        const curEma = (data[i] - prevEma) * k + prevEma;
        ema.push(curEma);
        prevEma = curEma;
      }
    }
    return ema;
  };

  // 3. RSI (Relative Strength Index)
  const computeRSI = (data, period = 14) => {
    const rsi = [];
    let avgGain = 0;
    let avgLoss = 0;

    for (let i = 0; i < data.length; i++) {
      if (i === 0) {
        rsi.push(null);
        continue;
      }
      const change = data[i] - data[i - 1];
      const gain = change > 0 ? change : 0;
      const loss = change < 0 ? -change : 0;

      if (i < period) {
        avgGain += gain;
        avgLoss += loss;
        rsi.push(null);
        if (i === period - 1) {
          avgGain /= period;
          avgLoss /= period;
        }
      } else {
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        const val = 100 - 100 / (1 + rs);
        rsi.push(val);
      }
    }
    return rsi;
  };

  const rsiList = computeRSI(closes, 14);
  const latestRsi = rsiList[rsiList.length - 1];

  // 4. MACD (12, 26, 9)
  const ema12 = computeEMA(closes, 12);
  const ema26 = computeEMA(closes, 26);
  const macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      macdLine.push(ema12[i] - ema26[i]);
    } else {
      macdLine.push(null);
    }
  }

  // Filter out nulls to compute Signal (9-EMA of MACD line)
  const validMacdStartIndex = macdLine.findIndex(x => x !== null);
  const validMacdLine = macdLine.slice(validMacdStartIndex);
  const rawSignal = computeEMA(validMacdLine, 9);
  
  // Re-align Signal Line to full quotes length
  const signalLine = new Array(closes.length).fill(null);
  for (let i = 0; i < rawSignal.length; i++) {
    signalLine[validMacdStartIndex + i] = rawSignal[i];
  }

  const macdHist = [];
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      macdHist.push(macdLine[i] - signalLine[i]);
    } else {
      macdHist.push(null);
    }
  }

  const latestMacdLine = macdLine[macdLine.length - 1];
  const latestSignal = signalLine[signalLine.length - 1];
  const latestHist = macdHist[macdHist.length - 1];

  // 5. Technical Trend Scoring Logic
  let score = 50; // baseline neutral
  const signals = [];

  if (latestPrice > latestSma20) {
    score += 10;
    signals.push('Price is trading above its short-term 20-day SMA, indicating upward pressure.');
  } else {
    score -= 10;
    signals.push('Price is below its 20-day SMA, indicating short-term weakness.');
  }

  if (latestPrice > latestSma50) {
    score += 10;
    signals.push('Price is trading above its medium-term 50-day SMA, confirming intermediate bullish trend.');
  } else {
    score -= 10;
    signals.push('Price is below its 50-day SMA, indicating an intermediate bearish trend.');
  }

  if (latestSma20 > latestSma50) {
    score += 10;
    signals.push('Golden Cross support (20-day SMA is above 50-day SMA).');
  } else {
    score -= 10;
    signals.push('Death Cross resistance (20-day SMA is below 50-day SMA).');
  }

  if (latestRsi > 70) {
    score -= 5;
    signals.push(`RSI is at ${latestRsi.toFixed(1)} (Overbought condition - risk of pullbacks).`);
  } else if (latestRsi < 30) {
    score += 10;
    signals.push(`RSI is at ${latestRsi.toFixed(1)} (Oversold condition - potential for short-term bounce).`);
  } else if (latestRsi >= 50) {
    score += 10;
    signals.push(`RSI is at ${latestRsi.toFixed(1)}, showing healthy bullish momentum.`);
  } else {
    score -= 5;
    signals.push(`RSI is at ${latestRsi.toFixed(1)}, indicating weak momentum.`);
  }

  if (latestHist > 0) {
    score += 10;
    signals.push('MACD histogram is positive, indicating expanding bullish momentum.');
  } else if (latestHist < 0) {
    score -= 10;
    signals.push('MACD histogram is negative, showing rising bearish momentum.');
  }

  score = Math.max(0, Math.min(100, score));

  let label = 'Sideways';
  if (score >= 60) label = 'Bullish';
  else if (score < 40) label = 'Bearish';

  return {
    score,
    label,
    signals,
    indicators: {
      price: latestPrice.toFixed(2),
      rsi: latestRsi ? latestRsi.toFixed(2) : 'N/A',
      macdHist: latestHist ? latestHist.toFixed(4) : 'N/A',
      macdLine: latestMacdLine ? latestMacdLine.toFixed(4) : 'N/A',
      macdSignal: latestSignal ? latestSignal.toFixed(4) : 'N/A',
      sma20: latestSma20 ? latestSma20.toFixed(2) : 'N/A',
      sma50: latestSma50 ? latestSma50.toFixed(2) : 'N/A'
    }
  };
}

// Risk Assessment Module
function assessRisk(summary) {
  let volScore = 50;
  let betaScore = 50;
  let debtScore = 50;
  const factors = [];

  // 1. Beta Risk Assessment
  const beta = summary.beta;
  if (beta === null || beta === undefined) {
    betaScore = 50;
    factors.push('Beta value is unavailable, market sensitivity risk is unrated.');
  } else {
    if (beta < 0.8) {
      betaScore = 20;
      factors.push(`Low volatility risk profile with a Beta of ${beta.toFixed(2)} (significantly less volatile than the broader market).`);
    } else if (beta <= 1.2) {
      betaScore = 45;
      factors.push(`Market matching risk profile with a Beta of ${beta.toFixed(2)} (moves in tandem with index standard).`);
    } else if (beta <= 1.6) {
      betaScore = 75;
      factors.push(`High volatility risk with a Beta of ${beta.toFixed(2)} (experiences larger moves than the broader market).`);
    } else {
      betaScore = 95;
      factors.push(`Aggressive risk profile with an extreme Beta of ${beta.toFixed(2)} (highly volatile and sensitive to market declines).`);
    }
  }

  // 2. Debt / Leverage Risk Assessment
  const de = summary.debtToEquity;
  if (de === null || de === undefined || de <= 0) {
    debtScore = 10;
    factors.push('Clean balance sheet with no long-term liabilities recorded.');
  } else {
    if (de < 50) {
      debtScore = 20;
      factors.push(`Low debt risk: Debt-to-Equity is highly conservative at ${de.toFixed(2)}%.`);
    } else if (de <= 120) {
      debtScore = 45;
      factors.push(`Moderate debt risk: Debt-to-Equity is balanced at ${de.toFixed(2)}%.`);
    } else if (de <= 220) {
      debtScore = 75;
      factors.push(`High debt risk: Elevated Debt-to-Equity at ${de.toFixed(2)}% increases interest rate vulnerability.`);
    } else {
      debtScore = 95;
      factors.push(`Severe debt risk: Leverage of ${de.toFixed(2)}% represents significant cash-flow and insolvency risk.`);
    }
  }

  // 3. Volatility Score (approximate based on current stats and beta)
  // Standard Deviation is usually highly correlated with Beta, but we add a buffer for sector risks
  volScore = betaScore; 

  const aggregateScore = Math.round(volScore * 0.3 + betaScore * 0.35 + debtScore * 0.35);

  let label = 'Medium Risk';
  if (aggregateScore < 35) label = 'Low Risk';
  else if (aggregateScore > 65) label = 'High Risk';

  return {
    score: aggregateScore,
    label,
    factors,
    breakdown: {
      beta: beta ? beta.toFixed(2) : 'N/A',
      debtToEquity: de ? de.toFixed(2) + '%' : 'N/A',
      solvencyRisk: debtScore > 65 ? 'High' : (debtScore > 35 ? 'Moderate' : 'Low'),
      marketSensitivity: betaScore > 65 ? 'High' : (betaScore > 35 ? 'Moderate' : 'Low')
    }
  };
}

// Weighted Recommendation Engine
function generateRecommendation(fundamentals, sentiment, technicals, risk) {
  // Weights: Fundamental (35%), Sentiment (20%), Technicals (25%), Risk (20% - Low Risk is Positive)
  const fundamentalWeight = 0.35;
  const sentimentWeight = 0.20;
  const technicalWeight = 0.25;
  const riskWeight = 0.20;

  // Invert the risk score so that low risk adds to recommendation score
  const invertedRiskScore = 100 - risk.score;

  const totalScore = Math.round(
    fundamentals.score * fundamentalWeight +
    sentiment.score * sentimentWeight +
    technicals.score * technicalWeight +
    invertedRiskScore * riskWeight
  );

  let recommendation = 'HOLD';
  let reasoning = '';
  if (totalScore >= 65) {
    recommendation = 'BUY';
  } else if (totalScore < 40) {
    recommendation = 'SELL';
  }

  // Determine confidence score (measure alignment of signals)
  // Confidence is high if signals are consistent, lower if they are mixed
  let bullishSignalsCount = 0;
  let bearishSignalsCount = 0;

  if (fundamentals.score >= 60) bullishSignalsCount++;
  else if (fundamentals.score < 45) bearishSignalsCount++;

  if (sentiment.score >= 60) bullishSignalsCount++;
  else if (sentiment.score < 40) bearishSignalsCount++;

  if (technicals.score >= 60) bullishSignalsCount++;
  else if (technicals.score < 40) bearishSignalsCount++;

  if (risk.score < 45) bullishSignalsCount++;
  else if (risk.score > 65) bearishSignalsCount++;

  let confidence = 50;
  if (recommendation === 'BUY') {
    confidence = 50 + (bullishSignalsCount * 10);
  } else if (recommendation === 'SELL') {
    confidence = 50 + (bearishSignalsCount * 10);
  } else {
    confidence = 50 + Math.abs(bullishSignalsCount - bearishSignalsCount) * 5;
  }
  confidence = Math.min(95, Math.max(45, confidence));

  // Construct comprehensive reasoning summary
  const summaryBullets = [];
  
  if (recommendation === 'BUY') {
    summaryBullets.push(`Attractive option score of ${totalScore}/100, driven by favorable indicator alignment.`);
  } else if (recommendation === 'SELL') {
    summaryBullets.push(`Fails to meet core investment standards with a score of ${totalScore}/100.`);
  } else {
    summaryBullets.push(`Maintains a neutral hold state with a score of ${totalScore}/100.`);
  }

  summaryBullets.push(`Fundamentals: ${fundamentals.label} (Score: ${fundamentals.score}/100)`);
  summaryBullets.push(`Market Momentum: ${technicals.label} (Score: ${technicals.score}/100)`);
  summaryBullets.push(`Sentiment Profile: ${sentiment.label} (Score: ${sentiment.score}/100)`);
  summaryBullets.push(`Risk Level: ${risk.label} (Risk Score: ${risk.score}/100)`);

  return {
    rating: recommendation,
    score: totalScore,
    confidence,
    summaryBullets,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  collectStockData,
  analyzeFundamentals,
  analyzeSentiment,
  analyzeTechnicals,
  assessRisk,
  generateRecommendation
};
