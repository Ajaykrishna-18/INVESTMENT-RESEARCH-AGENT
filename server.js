const express = require('express');
const path = require('path');
const {
  collectStockData,
  analyzeFundamentals,
  analyzeSentiment,
  analyzeTechnicals,
  assessRisk,
  generateRecommendation
} = require('./analyzer.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve static client-side dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Cache to store the latest analysis results for chatbot queries
const analysisCache = {};

// 1. Stock Analysis Endpoint
app.get('/api/analyze/:ticker', async (req, res) => {
  const ticker = req.params.ticker.toUpperCase().trim();
  console.log(`[API] Triggering analysis for ticker: ${ticker}`);

  try {
    const rawData = await collectStockData(ticker);

    const fundamentals = analyzeFundamentals(rawData.summary);
    const sentiment = analyzeSentiment(rawData.news);
    const technicals = analyzeTechnicals(rawData.chart);
    const risk = assessRisk(rawData.summary);
    const recommendation = generateRecommendation(fundamentals, sentiment, technicals, risk);

    const report = {
      meta: rawData.meta,
      summary: rawData.summary,
      fundamentals,
      sentiment,
      technicals,
      risk,
      recommendation,
      chart: rawData.chart.slice(-30) // Return last 30 trading days for the visual chart
    };

    // Store in cache for chatbot reference
    analysisCache[ticker] = report;

    res.json({ success: true, data: report });
  } catch (error) {
    console.error(`[API ERROR] Analysis failed for ${ticker}:`, error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Chatbot Assistant Endpoint
app.post('/api/chat', (req, res) => {
  const { ticker, message } = req.body;
  
  if (!ticker) {
    return res.json({ reply: "Please analyze a stock first, so I can answer questions about it!" });
  }

  const stockTicker = ticker.toUpperCase().trim();
  const report = analysisCache[stockTicker];

  if (!report) {
    return res.json({ reply: `I don't have active analysis data for ${stockTicker}. Please run a search for it first!` });
  }

  const query = message.toLowerCase().trim();
  let reply = "";

  // Dynamic Rule-based responder mimicking financial analyst response
  if (query.includes('risk') || query.includes('safe') || query.includes('dangerous') || query.includes('beta')) {
    const factorsList = report.risk.factors.map(f => `• ${f}`).join('\n');
    reply = `Regarding the risk profile of **${report.meta.name} (${stockTicker})**:\n` +
            `It is currently rated as **${report.risk.label}** with a risk score of **${report.risk.score}/100**.\n\n` +
            `**Key Risk Factors:**\n${factorsList}\n\n` +
            `*Additional metrics:* Beta is **${report.risk.breakdown.beta}**, and Debt-to-Equity is **${report.risk.breakdown.debtToEquity}**.`;
  } 
  else if (query.includes('pe') || query.includes('eps') || query.includes('roe') || query.includes('fundamental') || query.includes('revenue') || query.includes('debt') || query.includes('valuation') || query.includes('undervalued') || query.includes('overvalued')) {
    const rationals = report.fundamentals.rationale.map(r => `• ${r}`).join('\n');
    reply = `Here is the fundamental financial breakdown for **${report.meta.name} (${stockTicker})**:\n` +
            `The company's fundamental state is flagged as **${report.fundamentals.label}** (Score: **${report.fundamentals.score}/100**).\n\n` +
            `**Fundamental Observations:**\n${rationals}\n\n` +
            `**Key Stats:**\n` +
            `• Current Price: $${report.summary.currentPrice.toFixed(2)}\n` +
            `• Trailing P/E: ${report.fundamentals.metrics.pe}\n` +
            `• Forward P/E: ${report.fundamentals.metrics.forwardPe}\n` +
            `• Trailing EPS: $${report.summary.trailingEps.toFixed(2)}\n` +
            `• Return on Equity (ROE): ${report.fundamentals.metrics.roe}\n` +
            `• Net Profit Margin: ${report.fundamentals.metrics.profitMargin}\n` +
            `• Debt-to-Equity: ${report.fundamentals.metrics.debtToEquity}\n` +
            `• Revenue Growth (YoY): ${report.fundamentals.metrics.revenueGrowth}`;
  }
  else if (query.includes('trend') || query.includes('rsi') || query.includes('macd') || query.includes('indicator') || query.includes('technical') || query.includes('chart') || query.includes('average')) {
    const signalsList = report.technicals.signals.map(s => `• ${s}`).join('\n');
    reply = `Technical momentum signals for **${report.meta.name} (${stockTicker})**:\n` +
            `The current market trend is classified as **${report.technicals.label}** (Technical Score: **${report.technicals.score}/100**).\n\n` +
            `**Technical Indicators:**\n` +
            `• RSI (14-day): **${report.technicals.indicators.rsi}**\n` +
            `• MACD Histogram: **${report.technicals.indicators.macdHist}**\n` +
            `• SMA (20-day): $${report.technicals.indicators.sma20}\n` +
            `• SMA (50-day): $${report.technicals.indicators.sma50}\n\n` +
            `**Trend Rationale:**\n${signalsList}`;
  }
  else if (query.includes('sentiment') || query.includes('news') || query.includes('headline') || query.includes('media') || query.includes('feel')) {
    const articlesList = report.sentiment.articles.map(a => `• *[${a.sentiment}]* "${a.title}" (published by ${a.publisher})`).join('\n');
    reply = `Media and news sentiment analysis for **${report.meta.name} (${stockTicker})**:\n` +
            `Sentiment is classified as **${report.sentiment.label}** (Score: **${report.sentiment.score}/100**).\n\n` +
            `**Details:** ${report.sentiment.details}\n\n` +
            `**Recent Analyzed Headlines:**\n${articlesList}`;
  }
  else if (query.includes('recommendation') || query.includes('buy') || query.includes('sell') || query.includes('hold') || query.includes('why') || query.includes('opinion')) {
    const summaryList = report.recommendation.summaryBullets.map(b => `• ${b}`).join('\n');
    reply = `The Investment Recommendation Engine has outputted a **${report.recommendation.rating}** rating for **${report.meta.name} (${stockTicker})**.\n\n` +
            `**Engine Analysis Results:**\n${summaryList}\n\n` +
            `**Confidence Rating:** **${report.recommendation.confidence}%**\n` +
            `*Scoring weights: Fundamental Health (35%), News Sentiment (20%), Technical Trend (25%), and Risk Shielding (20%).*`;
  }
  else {
    reply = `I am ready to assist you with specific details about **${report.meta.name} (${stockTicker})**.\n` +
            `You can ask me questions about:\n` +
            `1. **Risk Assessment** (e.g. "What is the risk level?" or "Explain the Beta risk")\n` +
            `2. **Fundamental Metrics** (e.g. "What is the P/E ratio?" or "Show profit margins")\n` +
            `3. **Technical Trend** (e.g. "Is the trend bullish?" or "What are the MACD/RSI values?")\n` +
            `4. **Sentiment / News** (e.g. "What is the news sentiment?" or "Show headlines")\n` +
            `5. **Recommendation Justification** (e.g. "Why is it a BUY/HOLD/SELL?")`;
  }

  res.json({ reply });
});

// Launch Server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  Investment Research Agent running on port ${PORT}`);
  console.log(`  Access dashboard at: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
