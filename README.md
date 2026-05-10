# StockVedic

Professional-grade technical analysis tool for Indian Stock Markets (NSE).

## Live App

**Frontend:** https://theveerakumar.github.io/StockVedic/

**Backend API:** https://stockvedic.onrender.com

## Features

- Real-time stock quotes and price charts
- Technical indicators: RSI, MACD, ADX, Bollinger Bands, VWAP, SMAs
- Trading signals with pivot points and ATR-based stop loss
- Position sizing calculator
- Quarterly fundamentals, P&L, balance sheet, cash flow
- Earnings surprise and analyst consensus
- Market sentiment and tactical entry guidance

## Tech Stack

- **Frontend:** React, Vite, Recharts
- **Backend:** FastAPI, Python
- **Data:** Yahoo Finance (via yfinance), Finnhub, Fincrux

## Local Development

```bash
# Backend
cd server
pip install -r requirements.txt
uvicorn main:app --port 8001

# Frontend
cd client
npm install
npm run dev
```

## Deployment

- Frontend → GitHub Pages (via GitHub Actions)
- Backend → Render (free tier)