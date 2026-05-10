# StockVedic — Indian Stock Analysis Tool

<p align="center">
  <img src="https://img.shields.io/badge/NSE-Stocks-blue" alt="NSE">
  <img src="https://img.shields.io/badge/React-Vite-purple" alt="React">
  <img src="https://img.shields.io/badge/FastAPI-Python-green" alt="FastAPI">
  <img src="https://img.shields.io/badge/License-MIT-orange" alt="License">
</p>

> Professional-grade technical analysis for Indian Stock Markets (NSE only)

## Live App

| Component | URL |
|-----------|-----|
| **Frontend** | https://theveerakumar.github.io/StockVedic/ |
| **Backend API** | https://stockvedic.onrender.com |

---

## Features

### 📊 Technical Analysis
- **Price Charts** — Interactive candlestick-style line charts with SMA 20/50, Bollinger Bands, VWAP
- **RSI (14)** — Momentum oscillator with overbought/oversold zones, divergence detection
- **MACD (12,26,9)** — Trend following indicator with histogram, zero-line crossovers
- **ADX (14)** — Trend strength measurement with +DI/-DI
- **ATR (14)** — Daily volatility for position sizing and stop loss
- **VWAP** — Intraday fair value indicator

### 🎯 Trading Signals
- **Pivot Points** — 63-day lookback (R1, R2, S1, S2)
- **Fibonacci Retracements** — 23.6%, 38.2%, 50%, 61.8%, 78.6%
- **Entry Zone** — Based on nearest support level
- **Stop Loss** — Support minus 0.5× ATR
- **Target** — Pivot R1
- **Risk/Reward Ratio** — Calculated and displayed
- **Position Sizing** — Risk ₹10,000 → calculated share count

### 📈 Market Context
- **Regime Detection** — Trend-up, Trend-down, or Ranging
- **Market Sentiment Row** — Regime, SMAs, RSI, Volume summary
- **Tactical Entry Guidance** — Context-aware entry advice based on regime, RSI, SMAs

### 💼 Fundamentals
- **Quarterly Results** — Sales, Net Profit, EPS with YoY changes
- **Annual P&L** — Revenue and profit trends
- **Balance Sheet** — Key metrics
- **Cash Flow** — Operating/Investing/Financing
- **Ratios** — P/E, ROCE, ROE, Book Value, Dividend Yield, Debt/Equity
- **Shareholding** — Promoter, FII, DII breakdown

### 📰 Market Data
- **Earnings Surprise** — Last 4 quarters (Finnhub)
- **Analyst Consensus** — Buy/Hold/Sell recommendations (Finnhub)
- **Company News** — Latest market news (Finnhub)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19, Vite, Recharts |
| **Styling** | CSS Variables (Dark/Light theme) |
| **Backend** | FastAPI, Python 3 |
| **Data Sources** | Yahoo Finance (yfinance), Finnhub, Fincrux |
| **Deployment** | GitHub Pages + Render |

---

## Project Structure

```
stockVedic/
├── client/                     # React frontend
│   ├── src/
│   │   ├── App.jsx            # Main app shell
│   │   ├── App.css            # Styling (terminal aesthetic)
│   │   ├── main.jsx           # React entry point
│   │   └── components/
│   │       └── StockDashboard.jsx  # Main dashboard component
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── server/                     # FastAPI backend
│   ├── main.py               # API endpoints
│   ├── cache.py              # SQLite caching layer
│   ├── requirements.txt      # Python dependencies
│   ├── .env.example          # Env variable template
│   └── Procfile              # Render deployment config
│
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Pages deployment
│
├── .gitignore
├── README.md
└── stockVedic/               # Python package (if needed)
```

---

## Local Development

### Prerequisites

- **Node.js 18+** — for the frontend
- **Python 3.10+** — for the backend

### Step 1: Clone the Repository

```bash
git clone https://github.com/theveerakumar/StockVedic.git
cd StockVedic
```

### Step 2: Start the Backend

```bash
cd server

# Create virtual environment (optional but recommended)
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy env file and add your API keys
cp .env.example .env
# Edit .env with your keys:
#   FINNHUB_KEY=your_finnhub_key
#   FINCRUX_KEY=your_fincrux_key

# Start the server
uvicorn main:app --port 8001 --reload
```

The backend runs at `http://localhost:8001`

### Step 3: Start the Frontend

```bash
cd client

# Install dependencies
npm install

# Start development server
npm run dev
```

The frontend runs at `http://localhost:5173`

### Step 4: Use the App

Open http://localhost:5173 in your browser. Search for any NSE stock (e.g., RELIANCE, TCS, INFY).

---

## API Endpoints (Backend)

| Endpoint | Description |
|----------|-------------|
| `GET /api/yf/history/{symbol}?period=1y` | Historical price data |
| `GET /api/yf/quote/{symbol}` | Current quote, market cap, P/E, etc. |
| `GET /api/yf/fundamentals/{symbol}` | Quarterly results, P&L, ratios |
| `GET /api/search?q=RELIANCE` | Stock search (Fincrux) |
| `GET /api/finnhub/earnings/{symbol}` | Earnings surprise (cached) |
| `GET /api/finnhub/recommendations/{symbol}` | Analyst consensus |
| `GET /api/finnhub/news/{symbol}` | Company news |

---

## Deployment

### Backend → Render

1. Go to [render.com](https://render.com) → **New +** → **Web Service**
2. Connect your GitHub account and select the `stockVedic` repo
3. Configure:
   - **Root Directory:** `server`
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add environment variables:
   - `FINNHUB_KEY`
   - `FINCRUX_KEY`
5. Click **Create Web Service**

Your backend URL will be something like: `https://stockvedic.onrender.com`

### Frontend → GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Source: **GitHub Actions**
3. Go to **Settings** → **Secrets and variables** → **Actions**
4. Add secrets:
   - `VITE_API_URL` → your Render backend URL (e.g., `https://stockvedic.onrender.com`)
   - `VITE_FINNHUB_KEY` → your Finnhub API key
5. Push to `master` — GitHub Actions will auto-deploy

Your frontend URL: `https://theveerakumar.github.io/StockVedic/`

---

## Environment Variables

### Frontend (client/.env)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | Backend API URL (e.g., https://stockvedic.onrender.com) |
| `VITE_FINNHUB_KEY` | Finnhub API key for earnings/consensus |

### Backend (server/.env)

| Variable | Description |
|----------|-------------|
| `FINNHUB_KEY` | Finnhub API key for earnings, recommendations, news |
| `FINCRUX_KEY` | Fincrux API key for stock search |

---

## API Keys

You need to obtain your own API keys:

| Service | Get Key From | Limits |
|---------|--------------|--------|
| **Finnhub** | https://finnhub.io/ | 60 requests/min (free) |
| **Fincrux** | https://fincrux.org/ | 5 requests/day (free) |
| **Yahoo Finance** | Built into yfinance | Unlimited (no key needed) |

---

## Free Tier Limitations

| Service | Limitation |
|---------|------------|
| **Render** | 750 hours/month, spins down after 15 min idle (cold start ~30s) |
| **Fincrux** | 5 search requests/day |
| **Finnhub** | 60 requests/min (plenty for personal use) |

### Keep Render Awake

Add a free cron job to ping your backend every 10 minutes:

1. Go to https://cron-job.org
2. Create a job that GETs: `https://stockvedic.onrender.com/api/yf/quote/RELIANCE`
3. Set to run every 10 minutes

---

## Screenshots

The app features a terminal-inspired dark theme with:

- **Header** — Search bar with popular stocks (RELIANCE, TCS, HDFCBANK, etc.)
- **Main Chart** — Price with SMA, Bollinger Bands, VWAP
- **Indicator Panels** — RSI (120px), MACD (150px) with tooltips
- **Signal Banner** — Buy/Hold/Sell with confidence score
- **Market Sentiment** — Regime, SMAs, RSI, Volume status
- **Entry Box** — Entry zone, SL, Target, R:R, Position sizing
- **Indicator Grid** — All indicators with strategy notes
- **Quarterly Results** — Tabbed view (Quarterly, P&L, Balance Sheet, Cash Flow)
- **Red Flag Scanner** — Debt/Equity, Promoter holdings warnings
- **Sidebar** — Company overview, Annual performance, Key levels, Earnings, Analyst consensus

---

## License

MIT License — feel free to use, modify, and distribute.

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## Acknowledgments

- **Yahoo Finance** — via yfinance Python library
- **Finnhub** — Market data APIs
- **Fincrux** — Indian stock search
- **Recharts** — Beautiful React charts
- **Vite** — Lightning-fast frontend tooling