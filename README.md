<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:0A0E17,100:F59E0B&text=StockVedic&desc=Indian%20Stock%20Analysis%20Tool%20%E2%80%94%20NSE%20Only&fontColor=ffffff&descAlignY=60&descSize=13" />
  <source media="(prefers-color-scheme: light)" srcset="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:0A0E17,100:F59E0B&text=StockVedic&desc=Indian%20Stock%20Analysis%20Tool%20%E2%80%94%20NSE%20Only&fontColor=ffffff&descAlignY=60&descSize=13" />
  <img src="https://capsule-render.vercel.app/api?type=waving&height=200&color=0:0A0E17,100:F59E0B&text=StockVedic&desc=Indian%20Stock%20Analysis%20Tool%20%E2%80%94%20NSE%20Only&fontColor=ffffff&descAlignY=60&descSize=13" />
</picture>

<p align="center">
  <img src="https://img.shields.io/badge/NSE-Stocks-0A0E17?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBkPSJNOCAxNkwxNiA4TTE2IDE2TDggOCIvPjwvc3ZnPg==&logoColor=white" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white" />
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" />
  <img src="https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge&logo=license&logoColor=white" />
</p>

---

## Live App

| | URL |
|---|---|
| **Frontend** | https://veerakumar.com/stockvedic/ |
| **Backend API** | https://stockvedic.onrender.com |

---

## Features

### Technical Analysis
- **Price Charts** — Interactive candlestick-style line charts with SMA 20/50, Bollinger Bands, VWAP
- **RSI (14)** — Momentum oscillator with overbought/oversold zones, divergence detection
- **MACD (12,26,9)** — Trend following with histogram, zero-line crossovers
- **ADX (14)** — Trend strength measurement with +DI/-DI
- **ATR (14)** — Daily volatility for position sizing and stop loss
- **VWAP** — Intraday fair value indicator

### Trading Signals
- **Pivot Points** — 63-day lookback (R1, R2, S1, S2)
- **Fibonacci Retracements** — 23.6%, 38.2%, 50%, 61.8%, 78.6%
- **Tactical Entry Guidance** — Regime-aware entry advice
- **Position Sizing** — Risk-based share count calculation

### Market Context
- **Regime Detection** — Trend-up, Trend-down, or Ranging
- **Market Sentiment Row** — Regime, SMAs, RSI, Volume summary

### Fundamentals
- **Quarterly Results** — Sales, Net Profit, EPS with YoY changes
- **Annual P&L** — Revenue and profit trends
- **Balance Sheet & Cash Flow** — Key metrics
- **Ratios** — P/E, ROCE, ROE, Book Value, Dividend Yield, Debt/Equity
- **Shareholding** — Promoter, FII, DII breakdown

### Market Data
- **Earnings Surprise** — Last 4 quarters (Finnhub)
- **Analyst Consensus** — Buy/Hold/Sell recommendations (Finnhub)
- **Company News** — Latest headlines (Finnhub)

---

## Tech Stack

```
Frontend    React 19 + Vite + Recharts
Backend     FastAPI + Python 3
Styling     CSS Variables (dark theme)
Data        yfinance + Screener.in + Finnhub + Fincrux
Deploy      GitHub Pages + Render
```

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/yf/history/{symbol}?period=1y` | Historical price data |
| `GET /api/yf/quote/{symbol}` | Current quote, market cap, P/E |
| `GET /api/yf/fundamentals/{symbol}` | Quarterly results, P&L, ratios |
| `GET /api/search?q=RELIANCE` | Stock search (Fincrux) |
| `GET /api/finnhub/earnings/{symbol}` | Earnings surprise (cached) |
| `GET /api/finnhub/recommendations/{symbol}` | Analyst consensus |
| `GET /api/finnhub/news/{symbol}` | Company news |

---

## Local Development

```bash
# Backend
cd server
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Add FINNHUB_KEY + FINCRUX_KEY
uvicorn main:app --port 8001 --reload

# Frontend (separate terminal)
cd client
npm install
npm run dev
```

Frontend at `http://localhost:5173`, backend at `http://localhost:8001`.

---

## Environment Variables

| Variable | Where | Required For |
|---|---|---|
| `VITE_API_URL` | client/.env | Backend URL (dev: localhost:8001, prod: stockvedic.onrender.com) |
| `VITE_FINNHUB_KEY` | client/.env | Earnings, recommendations, news |
| `FINNHUB_KEY` | server/.env | Earnings, recommendations, news |
| `FINCRUX_KEY` | server/.env | Stock search |

**Get free keys:** [Finnhub](https://finnhub.io/) (60 req/min) · [Fincrux](https://fincrux.org/) (5 req/day)

---

## Deployment

**Backend → Render:** Create Web Service → root `server`, build `pip install -r requirements.txt`, start `uvicorn main:app --host 0.0.0.0 --port $PORT`, add env vars.

**Frontend → GitHub Pages:** Push to `main` → GitHub Actions builds and deploys. Set `VITE_API_URL` and `VITE_FINNHUB_KEY` as repo secrets.

> Note: Render free tier spins down after 15 min idle (~30s cold start). Use [cron-job.org](https://cron-job.org) to ping every 10 min to keep it warm.

---

<p align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&height=100&color=0:F59E0B,100:0A0E17&section=footer" />
</p>
