import os
import asyncio
import re
import requests
from datetime import date, timedelta, datetime
from contextlib import asynccontextmanager
from dateutil.relativedelta import relativedelta

import yfinance as yf
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from cache import get, set as cache_set, make_key

load_dotenv()

from nselib import capital_market

# Brotli fix for nselib (Python 3.13 chunked decode issue)
_original_urlfetch = None
try:
    import nselib.libutil as libutil

    _original_urlfetch = libutil.nse_urlfetch

    def _patched_nse_urlfetch(url, origin_url="http://nseindia.com"):
        r_session = requests.Session()
        r_session.headers["Accept-Encoding"] = "gzip, deflate"
        nse_live = r_session.get(origin_url, headers=libutil.default_header)
        cookies = nse_live.cookies
        return r_session.get(url, headers=libutil.default_header, cookies=cookies)

    libutil.nse_urlfetch = _patched_nse_urlfetch
except Exception:
    pass

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


def _parse_indian_num(val):
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        return float(s.replace(",", ""))
    except:
        return None


def _find_latest_trading_date():
    for i in range(10):
        d = (date.today() - timedelta(days=i)).strftime("%d-%m-%Y")
        try:
            df = capital_market.price_volume_data("RELIANCE", period="1D")
            if df is not None and not df.empty:
                return d
        except:
            continue
    return date.today().strftime("%d-%m-%Y")


def _find_date_with_52wk_data():
    for i in range(10):
        d = (date.today() - timedelta(days=i)).strftime("%d-%m-%Y")
        try:
            df = capital_market.week_52_high_low_report(d)
            if df is not None and not df.empty:
                rel = df[df["SYMBOL"] == "RELIANCE"]
                if not rel.empty:
                    vh = rel.iloc[0].get("Adjusted_52_Week_High")
                    if vh and str(vh) != "-":
                        return d
        except:
            continue
    return None


def _nse_quote(symbol: str):
    sym = symbol.upper()
    trading_date = _find_latest_trading_date()
    week52_date = _find_date_with_52wk_data() or trading_date

    latest = None
    try:
        df = capital_market.price_volume_data(sym, period="1D")
        if df is not None and not df.empty:
            latest = df.iloc[0]
    except Exception:
        pass

    price = None
    prev_close = None
    day_high = None
    day_low = None
    volume = None
    if latest is not None:
        price = _parse_indian_num(latest.get("ClosePrice"))
        prev_close = _parse_indian_num(latest.get("PrevClose"))
        day_high = _parse_indian_num(latest.get("HighPrice"))
        day_low = _parse_indian_num(latest.get("LowPrice"))
        volume = _parse_indian_num(latest.get("TotalTradedQuantity"))

    change = None
    change_pct = None
    if price and prev_close:
        change = round(price - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2)

    year_high = None
    year_low = None
    try:
        df52 = capital_market.week_52_high_low_report(week52_date)
        if df52 is not None and not df52.empty:
            df52 = df52[df52["SYMBOL"] == sym]
            if not df52.empty:
                vh = df52.iloc[0].get("Adjusted_52_Week_High")
                vl = df52.iloc[0].get("Adjusted_52_Week_Low")
                year_high = _parse_indian_num(vh) if vh and str(vh) != "-" else None
                year_low = _parse_indian_num(vl) if vl and str(vl) != "-" else None
    except Exception:
        pass

    pe_ratio = None
    try:
        df_pe = capital_market.pe_ratio(trading_date)
        if df_pe is not None and not df_pe.empty:
            row = df_pe[df_pe["SYMBOL"] == sym]
            if not row.empty:
                pe_ratio = _parse_indian_num(row.iloc[0].get("SYMBOLP/E"))
    except Exception:
        pass

    return {
        "symbol": sym,
        "price": round(price, 2) if price else None,
        "change": change,
        "changePercent": change_pct,
        "dayHigh": day_high,
        "dayLow": day_low,
        "yearHigh": year_high,
        "yearLow": year_low,
        "volume": int(volume) if volume else None,
        "peRatio": pe_ratio,
    }


def _nse_history(symbol: str, period: str = "1Y"):
    sym = symbol.upper()
    today = date.today()
    period_days = {"3mo": 90, "1y": 365, "5y": 1825}
    days = period_days.get(period.lower(), 365)
    from_date = (today - timedelta(days=days)).strftime("%d-%m-%Y")
    to_date = today.strftime("%d-%m-%Y")

    try:
        df = capital_market.price_volume_data(sym, from_date=from_date, to_date=to_date)
    except Exception:
        return {"symbol": sym, "values": []}

    if df is None or df.empty:
        return {"symbol": sym, "values": []}

    values = []
    for _, row in df.iterrows():
        dt = row.get("Date", "")
        try:
            dt_obj = datetime.strptime(dt, "%d-%b-%Y")
            dt_str = dt_obj.strftime("%Y-%m-%d")
        except:
            dt_str = dt

        values.append(
            {
                "datetime": dt_str,
                "open": round(_parse_indian_num(row.get("OpenPrice")) or 0, 2),
                "high": round(_parse_indian_num(row.get("HighPrice")) or 0, 2),
                "low": round(_parse_indian_num(row.get("LowPrice")) or 0, 2),
                "close": round(_parse_indian_num(row.get("ClosePrice")) or 0, 2),
                "volume": int(_parse_indian_num(row.get("TotalTradedQuantity")) or 0),
            }
        )

    values.reverse()
    return {"symbol": sym, "values": values}


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


def _screener_fundamentals(symbol: str):
    sym = symbol.upper()

    try:
        from screener_cli.scraper import fetch_page_with_fallback
        from screener_cli.parsers import (
            quarterly,
            balance_sheet,
            cash_flow,
            profit_loss,
            shareholding,
            pros_cons,
        )
    except ImportError:
        return _yf_fundamentals(symbol)

    def _cr(v):
        return "\u2014" if v is None else f"{v:.2f} Cr"

    def _pct(v):
        return "\u2014" if v is None else f"{v:.1f}%"

    def _val(v):
        return "\u2014" if v is None else str(v)

    def _find_row(rows, label):
        for r in rows:
            if r.label == label:
                return list(r.values)
        return None

    def _find_row_val(rows, label):
        vals = _find_row(rows, label)
        return vals[0] if vals and len(vals) > 0 else None

    try:
        soup, view = fetch_page_with_fallback(sym, view="consolidated")
    except Exception:
        return _yf_fundamentals(symbol)

    q_data = quarterly.parse(soup)
    pl_dict = profit_loss.parse(soup)
    pl_data = pl_dict.get("table") if isinstance(pl_dict, dict) else pl_dict
    bs_data = balance_sheet.parse(soup)
    cf_data = cash_flow.parse(soup)
    sh_data = shareholding.parse(soup)
    pc_data = pros_cons.parse(soup)

    # Company name
    h1 = soup.find("h1")
    company_name = h1.text.strip() if h1 else sym

    # ----- Top Ratios -----
    top_ratios = {}
    km = pc_data.key_metrics if pc_data and hasattr(pc_data, "key_metrics") else {}
    for fk in [
        "Stock P/E",
        "ROCE",
        "ROE",
        "Book Value",
        "Market Cap",
        "Dividend Yield",
        "High / Low",
    ]:
        if fk in km:
            top_ratios[fk] = km[fk]

    # ----- Quarterly Results -----
    qr = []
    if q_data and q_data.headers:
        headers = list(q_data.headers)
        qr.append(["Category"] + headers)

        def add_qr_row(label_override, screener_label, fmt=_cr):
            vals = _find_row(q_data.rows, screener_label)
            if vals:
                qr.append(
                    [label_override]
                    + [fmt(v) if v is not None else "\u2014" for v in vals]
                )

        add_qr_row("Sales", "Sales")
        add_qr_row("Expenses", "Expenses")
        add_qr_row("Operating Profit", "Operating Profit")
        add_qr_row("OPM %", "OPM %", _pct)
        add_qr_row("Other Income", "Other Income")
        add_qr_row("Interest", "Interest")
        add_qr_row("PBT", "Profit before tax")
        add_qr_row("Tax %", "Tax %", _pct)
        add_qr_row("Net Profit", "Net Profit")
        add_qr_row("EPS", "EPS in Rs", _val)

    # ----- P&L (Annual) -----
    pl = []
    if pl_data and pl_data.headers:
        headers = list(pl_data.headers)
        pl.append(["Category"] + headers)

        def add_pl_row(label_override, screener_label, fmt=_cr):
            vals = _find_row(pl_data.rows, screener_label)
            if vals:
                pl.append(
                    [label_override]
                    + [fmt(v) if v is not None else "\u2014" for v in vals]
                )

        add_pl_row("Total Revenue", "Sales")
        add_pl_row("EBIT", "Operating Profit")
        add_pl_row("Interest", "Interest")
        add_pl_row("Depreciation", "Depreciation")
        add_pl_row("PBT", "Profit before tax")

        # Tax (absolute from PBT * Tax%)
        pbt_vals = _find_row(pl_data.rows, "Profit before tax")
        tax_pct_vals = _find_row(pl_data.rows, "Tax %")
        if pbt_vals and tax_pct_vals:
            n = min(len(pbt_vals), len(tax_pct_vals))
            vals = [
                pbt_vals[i] * tax_pct_vals[i] / 100
                if pbt_vals[i] is not None and tax_pct_vals[i] is not None
                else None
                for i in range(n)
            ]
            pl.append(["Tax"] + [_cr(v) if v is not None else "\u2014" for v in vals])

        add_pl_row("Net Profit", "Net Profit")
        add_pl_row("EPS", "EPS in Rs", _val)

        # EBITDA = EBIT + Depreciation
        op_vals = _find_row(pl_data.rows, "Operating Profit")
        depr_vals = _find_row(pl_data.rows, "Depreciation")
        if op_vals and depr_vals:
            n = min(len(op_vals), len(depr_vals))
            vals = [
                op_vals[i] + depr_vals[i]
                if op_vals[i] is not None and depr_vals[i] is not None
                else None
                for i in range(n)
            ]
            ebitda_row = ["EBITDA"] + [
                _cr(v) if v is not None else "\u2014" for v in vals
            ]
            pl.insert(3, ebitda_row)

    # ----- Balance Sheet -----
    bsr = []
    if bs_data and bs_data.headers:
        headers = list(bs_data.headers)
        bsr.append(["Category"] + headers)

        eq_cap_vals = _find_row(bs_data.rows, "Equity Capital")
        reserves_vals = _find_row(bs_data.rows, "Reserves")
        borrowings_vals = _find_row(bs_data.rows, "Borrowings")
        total_assets_vals = _find_row(bs_data.rows, "Total Assets")

        if eq_cap_vals and reserves_vals:
            n = min(len(eq_cap_vals), len(reserves_vals))
            vals = [
                eq_cap_vals[i] + reserves_vals[i]
                if eq_cap_vals[i] is not None and reserves_vals[i] is not None
                else None
                for i in range(n)
            ]
            bsr.append(
                ["Shareholders Equity"]
                + [_cr(v) if v is not None else "\u2014" for v in vals]
            )

        if total_assets_vals:
            bsr.append(
                ["Total Assets"]
                + [_cr(v) if v is not None else "\u2014" for v in total_assets_vals]
            )

        if borrowings_vals:
            bsr.append(
                ["Total Debt"]
                + [_cr(v) if v is not None else "\u2014" for v in borrowings_vals]
            )

    # ----- Cash Flow -----
    cfr = []
    if cf_data and cf_data.headers:
        headers = list(cf_data.headers)
        cfr.append(["Category"] + headers)

        for fname, sname in [
            ("Operating Cash Flow", "Cash from Operating Activity"),
            ("Investing Cash Flow", "Cash from Investing Activity"),
            ("Financing Cash Flow", "Cash from Financing Activity"),
            ("Free Cash Flow", "Free Cash Flow"),
        ]:
            vals = _find_row(cf_data.rows, sname)
            if vals:
                cfr.append(
                    [fname] + [_cr(v) if v is not None else "\u2014" for v in vals]
                )

    # ----- Shareholding -----
    shq = []
    if sh_data and sh_data.latest:
        promoters = sh_data.latest.get("Promoters", 0)
        fiis = sh_data.latest.get("FIIs", 0)
        diis = sh_data.latest.get("DIIs", 0)
        govt = sh_data.latest.get("Government", 0)
        public = sh_data.latest.get("Public", 0)
        institutions = fiis + diis + govt
        shq = [
            ["Category", "Latest"],
            ["Promoters", f"{promoters:.1f}%"],
            ["Institutions", f"{institutions:.1f}%"],
            ["Public / Others", f"{public:.1f}%"],
        ]

    # ----- Ratios (red flags) -----
    ratio_rows = []
    if bs_data:
        borrowings = _find_row_val(bs_data.rows, "Borrowings")
        eq_cap = _find_row_val(bs_data.rows, "Equity Capital")
        reserves = _find_row_val(bs_data.rows, "Reserves")
        if (
            borrowings is not None
            and eq_cap is not None
            and reserves is not None
            and (eq_cap + reserves) > 0
        ):
            d2e = borrowings / (eq_cap + reserves)
            ratio_rows.append(["Debt / Equity", f"{d2e:.2f}"])

    about = pc_data.about if pc_data and pc_data.about else ""

    return {
        "success": "true",
        "trading_symbol": sym,
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


@app.get("/")
async def root():
    return {
        "status": "ok",
        "app": "StockVedic API",
        "version": "1.0",
        "endpoints": [
            "/api/search",
            "/api/nse/quote/{symbol}",
            "/api/nse/history/{symbol}",
            "/api/yf/fundamentals/{symbol}",
        ],
    }


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


@app.get("/api/nse/quote/{symbol}")
async def nse_quote(symbol: str):
    cache_key = make_key("nse_quote", symbol.upper())
    cached = get(cache_key)
    if cached:
        return cached
    try:
        data = await asyncio.to_thread(_nse_quote, symbol.upper())
        if data.get("price"):
            cache_set(cache_key, data, 60)
            return data
        return {"error": "Quote not found"}
    except Exception as e:
        return JSONResponse(
            status_code=502, content={"success": "false", "error": str(e)}
        )


@app.get("/api/nse/history/{symbol}")
async def nse_history(symbol: str, period: str = "1y"):
    cache_key = make_key("nse_history", symbol.upper(), period)
    cached = get(cache_key)
    if cached:
        return cached
    try:
        data = await asyncio.to_thread(_nse_history, symbol.upper(), period)
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
        data = await asyncio.to_thread(_screener_fundamentals, symbol.upper())
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
