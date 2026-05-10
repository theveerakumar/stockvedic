import os
import asyncio
from datetime import date
from contextlib import asynccontextmanager

import yfinance as yf
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cache import get, set as cache_set, make_key

load_dotenv()

FINCRUX_KEY = os.getenv("FINCRUX_KEY")
FINNHUB_KEY = os.getenv("FINNHUB_KEY")

FINCRUX_BASE = "https://api.fincrux.org/api"

client = httpx.AsyncClient(timeout=15)


def _yf_quote(symbol: str):
    t = yf.Ticker(symbol + ".NS")
    info = t.info
    price = info.get("currentPrice") or info.get("regularMarketPrice")
    prev_close = info.get("regularMarketPreviousClose")
    change = price - prev_close if price and prev_close else None
    change_pct = (change / prev_close * 100) if change and prev_close else None
    return {
        "symbol": symbol.upper(),
        "price": round(price, 2) if price else None,
        "change": round(change, 2) if change else None,
        "changePercent": round(change_pct, 2) if change_pct else None,
        "dayHigh": info.get("dayHigh"),
        "dayLow": info.get("dayLow"),
        "yearHigh": info.get("fiftyTwoWeekHigh"),
        "yearLow": info.get("fiftyTwoWeekLow"),
        "volume": info.get("volume"),
        "marketCap": info.get("marketCap"),
        "peRatio": info.get("trailingPE"),
        "eps": info.get("trailingEps"),
        "dividendYield": info.get("dividendYield"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
    }


def _yf_history(symbol: str, period: str = "1y"):
    t = yf.Ticker(symbol + ".NS")
    df = t.history(period=period)
    values = []
    for idx, row in df.iterrows():
        values.append(
            {
                "datetime": idx.strftime("%Y-%m-%d"),
                "open": round(row["Open"], 2),
                "high": round(row["High"], 2),
                "low": round(row["Low"], 2),
                "close": round(row["Close"], 2),
                "volume": int(row["Volume"]),
            }
        )
    return {"symbol": symbol.upper(), "values": values}


def _yf_fundamentals(symbol: str):
    t = yf.Ticker(symbol + ".NS")
    info = t.info
    if not info or not info.get("currentPrice") and not info.get("longName"):
        return {"success": "false", "error": "Stock not found"}

    def _safe(v):
        if v is None or (isinstance(v, float) and v != v):
            return None
        return float(v)

    def _cr(v):
        return "—" if v is None else f"{v / 1e7:.2f} Cr"

    def _cap(v):
        if v is None:
            return "—"
        if v >= 1e12:
            return f"\u20b9{v / 1e12:.2f}L Cr"
        if v >= 1e7:
            return f"\u20b9{v / 1e7:.2f} Cr"
        return f"\u20b9{v:.2f}"

    def _safe_row(df, name):
        if df is None or df.empty or name not in df.index:
            return [None] * len(df.columns) if df is not None and not df.empty else []
        return [_safe(v) for v in df.loc[name].values]

    # ----- Quarterly Results -----
    qis = t.quarterly_income_stmt
    qr = []
    if qis is not None and not qis.empty:
        dates_raw = [d.strftime("%Y-%m-%d") for d in qis.columns]
        rev_vals_raw = _safe_row(qis, "Total Revenue")
        if rev_vals_raw and len(rev_vals_raw) > 1:
            valid = [v for v in rev_vals_raw if v is not None]
            if valid:
                med = sorted(valid)[len(valid) // 2]
                dates = [
                    d + " (FY)" if v is not None and v > med * 2.5 else d
                    for d, v in zip(dates_raw, rev_vals_raw)
                ]
            else:
                dates = dates_raw
        else:
            dates = dates_raw
        n = len(dates)
        qr.append(["Category"] + dates)

        def add_qr(name, yf_name):
            vals = _safe_row(qis, yf_name)
            if any(v is not None for v in vals):
                qr.append(
                    [name] + [_cr(v) if v is not None else "\u2014" for v in vals]
                )

        add_qr("Sales", "Total Revenue")
        add_qr("Expenses", "Cost Of Revenue")
        add_qr("Operating Profit", "EBIT")

        rev_vals = _safe_row(qis, "Total Revenue")
        ebit_vals = _safe_row(qis, "EBIT")
        if any(v is not None for v in rev_vals) and any(
            v is not None for v in ebit_vals
        ):
            r = ["OPM %"]
            for i in range(n):
                r.append(
                    f"{ebit_vals[i] / rev_vals[i] * 100:.2f}%"
                    if rev_vals[i] and ebit_vals[i]
                    else "\u2014"
                )
            qr.append(r)

        add_qr("Interest", "Interest Expense")
        add_qr("PBT", "Pretax Income")

        tax_vals = _safe_row(qis, "Tax Provision")
        pbt_vals = _safe_row(qis, "Pretax Income")
        if any(v is not None for v in tax_vals):
            r = ["Tax %"]
            for i in range(n):
                if pbt_vals[i] and tax_vals[i]:
                    r.append(f"{tax_vals[i] / pbt_vals[i] * 100:.2f}%")
                else:
                    r.append(_cr(tax_vals[i]))
            qr.append(r)

        add_qr("Net Profit", "Net Income")

        ni_vals = _safe_row(qis, "Net Income")
        sh_vals = _safe_row(qis, "Diluted Average Shares")
        if any(v is not None for v in ni_vals):
            r = ["EPS"]
            for i in range(n):
                r.append(
                    f"{ni_vals[i] / sh_vals[i]:.2f}"
                    if ni_vals[i] and sh_vals[i] and sh_vals[i] > 0
                    else "\u2014"
                )
            qr.append(r)

    # ----- P&L (Annual) -----
    is_ = t.income_stmt
    pl = []
    if is_ is not None and not is_.empty:
        dates = [d.strftime("%Y-%m-%d") for d in is_.columns]
        n = len(dates)
        pl.append(["Category"] + dates)

        def add_pl(name, yf_name):
            vals = _safe_row(is_, yf_name)
            if any(v is not None for v in vals):
                pl.append(
                    [name] + [_cr(v) if v is not None else "\u2014" for v in vals]
                )

        add_pl("Total Revenue", "Total Revenue")
        add_pl("EBITDA", "EBITDA")
        add_pl("EBIT", "EBIT")
        add_pl("Interest", "Interest Expense")
        add_pl("Depreciation", "Reconciled Depreciation")
        add_pl("PBT", "Pretax Income")
        add_pl("Tax", "Tax Provision")
        add_pl("Net Profit", "Net Income")

        ni_vals = _safe_row(is_, "Net Income")
        sh_vals = _safe_row(is_, "Diluted Average Shares")
        if any(v is not None for v in ni_vals):
            r = ["EPS"]
            for i in range(n):
                r.append(
                    f"{ni_vals[i] / sh_vals[i]:.2f}"
                    if ni_vals[i] and sh_vals[i] and sh_vals[i] > 0
                    else "\u2014"
                )
            pl.append(r)

    # ----- Balance Sheet -----
    bs = t.balance_sheet
    bsr = []
    if bs is not None and not bs.empty:
        dates = [d.strftime("%Y-%m-%d") for d in bs.columns]
        bsr.append(["Category"] + dates)

        def add_bs(name, yf_name):
            vals = _safe_row(bs, yf_name)
            if any(v is not None for v in vals):
                bsr.append(
                    [name] + [_cr(v) if v is not None else "\u2014" for v in vals]
                )

        add_bs("Shareholders Equity", "Stockholders Equity")
        add_bs("Total Assets", "Total Assets")
        add_bs("Current Assets", "Current Assets")
        add_bs("Current Liabilities", "Current Liabilities")
        add_bs("Total Debt", "Total Debt")
        add_bs("Cash & Equivalents", "Cash And Cash Equivalents")

    # ----- Cash Flow -----
    cf = t.cashflow
    cfr = []
    if cf is not None and not cf.empty:
        dates = [d.strftime("%Y-%m-%d") for d in cf.columns]
        cfr.append(["Category"] + dates)

        def add_cf(name, yf_name):
            vals = _safe_row(cf, yf_name)
            if any(v is not None for v in vals):
                cfr.append(
                    [name] + [_cr(v) if v is not None else "\u2014" for v in vals]
                )

        add_cf("Operating Cash Flow", "Operating Cash Flow")
        add_cf("Capital Expenditure", "Capital Expenditure")
        add_cf("Free Cash Flow", "Free Cash Flow")
        add_cf("Investing Cash Flow", "Investing Cash Flow")
        add_cf("Financing Cash Flow", "Financing Cash Flow")

    # ----- Shareholding (snapshot) -----
    shq = []
    try:
        mh = t.major_holders
        if mh is not None and not mh.empty:
            if "insidersPercentHeld" in mh.index:
                insiders = _safe(mh.loc["insidersPercentHeld"].values[0]) or 0
            else:
                insiders = 0
            if "institutionsPercentHeld" in mh.index:
                institutions = _safe(mh.loc["institutionsPercentHeld"].values[0]) or 0
            else:
                institutions = 0
            ip = insiders * 100
            itp = institutions * 100
            pub = max(0, 100 - ip - itp)
            shq = [
                ["Category", "Latest"],
                ["Promoters", f"{ip:.1f}%"],
                ["Institutions", f"{itp:.1f}%"],
                ["Public / Others", f"{pub:.1f}%"],
            ]
    except Exception:
        shq = []

    # ----- Top Ratios -----
    top_ratios = {}

    pe = _safe(info.get("trailingPE"))
    if pe:
        top_ratios["Stock P/E"] = f"{pe:.2f}"

    if is_ is not None and not is_.empty and bs is not None and not bs.empty:
        ebit = _safe_row(is_, "EBIT")[0] if "EBIT" in is_.index else None
        ta = _safe_row(bs, "Total Assets")[0] if "Total Assets" in bs.index else None
        cl = (
            _safe_row(bs, "Current Liabilities")[0]
            if "Current Liabilities" in bs.index
            else None
        )
        ni = _safe_row(is_, "Net Income")[0] if "Net Income" in is_.index else None
        eq = (
            _safe_row(bs, "Stockholders Equity")[0]
            if "Stockholders Equity" in bs.index
            else None
        )

        if ebit and ta and cl is not None and (ta - cl) > 0:
            top_ratios["ROCE"] = f"{ebit / (ta - cl) * 100:.2f}%"
        if ni and eq and eq > 0:
            top_ratios["ROE"] = f"{ni / eq * 100:.2f}%"

    bv = _safe(info.get("bookValue"))
    if bv:
        top_ratios["Book Value"] = f"\u20b9{bv:.2f}"

    mcap = _safe(info.get("marketCap"))
    if mcap:
        top_ratios["Market Cap"] = _cap(mcap)

    dy = _safe(info.get("dividendYield"))
    if dy:
        top_ratios["Dividend Yield"] = f"{dy:.2f}%"

    yh = _safe(info.get("fiftyTwoWeekHigh"))
    yl = _safe(info.get("fiftyTwoWeekLow"))
    if yh and yl:
        top_ratios["High / Low"] = f"\u20b9{yh:.2f} / \u20b9{yl:.2f}"

    # ----- Ratios (red flags) -----
    ratio_rows = []
    if bs is not None and not bs.empty:
        td = _safe_row(bs, "Total Debt")[0] if "Total Debt" in bs.index else None
        eq = (
            _safe_row(bs, "Stockholders Equity")[0]
            if "Stockholders Equity" in bs.index
            else None
        )
        if td is not None and eq and eq > 0:
            ratio_rows.append(["Debt / Equity", f"{td / eq:.2f}"])

    about = info.get("longBusinessSummary") or ""
    company_name = info.get("longName") or info.get("shortName") or symbol

    return {
        "success": "true",
        "trading_symbol": symbol.upper(),
        "company": company_name,
        "data": {
            "top_ratios": top_ratios,
            "quaterly_results": qr,
            "profit_and_loss": pl,
            "balance_sheet": bsr,
            "cash_flows": cfr,
            "shareholding_quarterly": shq,
            "ratios": ratio_rows,
            "about": about,
        },
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await client.aclose()


app = FastAPI(title="StockVedic API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/search")
async def search(q: str = Query(min_length=1)):
    cache_key = make_key("search", q.upper())
    cached = get(cache_key)
    if cached:
        return cached
    try:
        r = await client.get(
            f"{FINCRUX_BASE}/search/{q.upper()}", params={"api_key": FINCRUX_KEY}
        )
        data = r.json()
        if data.get("success") == "true":
            cache_set(cache_key, data, 86400)
            return data
        return {
            "success": "false",
            "results": [],
            "error": data.get("message", "Search failed"),
        }
    except Exception as e:
        return JSONResponse(
            status_code=502, content={"success": "false", "error": str(e)}
        )


@app.get("/api/yf/quote/{symbol}")
async def yf_quote(symbol: str):
    cache_key = make_key("yf_quote", symbol.upper())
    cached = get(cache_key)
    if cached:
        return cached
    try:
        data = await asyncio.to_thread(_yf_quote, symbol.upper())
        if data.get("price"):
            cache_set(cache_key, data, 30)
            return data
        return {"error": "Quote not found"}
    except Exception as e:
        return JSONResponse(
            status_code=502, content={"success": "false", "error": str(e)}
        )


@app.get("/api/yf/history/{symbol}")
async def yf_history(symbol: str, period: str = "1y"):
    cache_key = make_key("yf_history", symbol.upper(), period)
    cached = get(cache_key)
    if cached:
        return cached
    try:
        data = await asyncio.to_thread(_yf_history, symbol.upper(), period)
        if data.get("values"):
            cache_set(cache_key, data, 3600)
            return data
        return {"error": "History not found"}
    except Exception as e:
        return JSONResponse(
            status_code=502, content={"success": "false", "error": str(e)}
        )


@app.get("/api/yf/fundamentals/{symbol}")
async def yf_fundamentals(symbol: str):
    cache_key = make_key("yf_fundamentals", symbol.upper())
    cached = get(cache_key)
    if cached:
        return cached
    try:
        data = await asyncio.to_thread(_yf_fundamentals, symbol.upper())
        if data.get("success") == "true":
            cache_set(cache_key, data, 43200)
            return data
        return {"success": "false", "error": "Fundamentals not found"}
    except Exception as e:
        return JSONResponse(
            status_code=502, content={"success": "false", "error": str(e)}
        )


@app.get("/api/news/{symbol}")
async def news(symbol: str):
    if not FINNHUB_KEY:
        return {"news": []}
    try:
        r = await client.get(
            "https://finnhub.io/api/v1/company-news",
            params={
                "symbol": symbol.upper(),
                "from": "2025-01-01",
                "to": date.today().isoformat(),
                "token": FINNHUB_KEY,
            },
        )
        data = r.json()
        if isinstance(data, list):
            return {"news": data[:10]}
        return {"news": []}
    except Exception:
        return {"news": []}


@app.get("/api/company-list")
async def company_list():
    return {"message": "Use /api/search?q= to search"}
