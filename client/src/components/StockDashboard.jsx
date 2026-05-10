import { useState, useEffect, useCallback, useRef, memo, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Bar, ComposedChart, Area, Cell, ReferenceLine,
} from 'recharts'

const API = import.meta.env.VITE_API_URL || 'https://stockvedic.onrender.com'
const FH = 'https://finnhub.io/api/v1'
const FH_KEY = import.meta.env.VITE_FINNHUB_KEY

const POPULAR = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'BHARTIARTL', 'ITC', 'WIPRO', 'TITAN']

const PERIOD_MAP = { '3m': '3mo', '1y': '1y', '5y': '5y' }
const PERIOD_DAYS = { '3m': 63, '1y': 252, '5y': 1260 }

function fmt(n) {
  if (n === null || n === undefined || n === '') return '—'
  const v = parseFloat(String(n).replace(/,/g, ''))
  if (isNaN(v)) return n
  return v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtCr(n) {
  if (!n || n === '—') return '—'
  const s = String(n).replace(/[₹,Cr.]/g, '')
  const v = parseFloat(s)
  if (isNaN(v)) return n
  if (v >= 100000) return '₹' + (v / 100000).toFixed(1) + 'L Cr'
  return n
}

function fmtCap(n) {
  if (!n) return '—'
  const v = +n
  if (v >= 1e12) return '₹' + (v / 1e12).toFixed(2) + 'T'
  if (v >= 1e9) return '₹' + (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr'
  return '₹' + fmt(n)
}

function parseFinNum(v) {
  if (v === null || v === undefined || v === '') return null
  return parseFloat(String(v).replace(/,/g, ''))
}

function calcSMA(data, period) {
  const r = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { r.push(null); continue }
    let s = 0; for (let j = i - period + 1; j <= i; j++) s += data[j]
    r.push(s / period)
  }
  return r
}

function calcBB(data, period = 20, std = 2) {
  const sma = calcSMA(data, period)
  const upper = [], lower = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { upper.push(null); lower.push(null); continue }
    let sq = 0; for (let j = i - period + 1; j <= i; j++) sq += (data[j] - sma[i]) ** 2
    const sd = Math.sqrt(sq / period)
    upper.push(sma[i] + std * sd)
    lower.push(sma[i] - std * sd)
  }
  return { upper, mid: sma, lower }
}

function calcRSI(closes, p = 14) {
  const r = []; let g = 0, l = 0
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    if (d > 0) g += d; else l -= d
    if (i === p) { g /= p; l /= p }
    if (i >= p) {
      const rs = l === 0 ? 100 : g / l
      r.push(100 - 100 / (1 + rs))
      const d2 = closes[i] - closes[i - 1]
      g = (g * (p - 1) + (d2 > 0 ? d2 : 0)) / p
      l = (l * (p - 1) + (d2 < 0 ? -d2 : 0)) / p
    } else r.push(null)
  }
  return r
}

function calcMACD(closes) {
  const ema12 = [], ema26 = [], macd = [], signal = [], hist = []
  const k12 = 2 / 13, k26 = 2 / 27
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { ema12.push(closes[i]); ema26.push(closes[i]); macd.push(0); signal.push(0); hist.push(0); continue }
    const e12 = closes[i] * k12 + ema12[i - 1] * (1 - k12)
    const e26 = closes[i] * k26 + ema26[i - 1] * (1 - k26)
    ema12.push(e12); ema26.push(e26)
    const m = e12 - e26; macd.push(m)
    const s = i > 0 ? m * 0.2 + (signal[i - 1] || m) * 0.8 : m
    signal.push(s); hist.push(m - s)
  }
  return { macd, signal, hist }
}

function calcADX(highs, lows, closes, p = 14) {
  const tr = [], pdm = [], mdm = [], atr = [], pdi = [], mdi = [], dx = [], adx = []
  for (let i = 1; i < highs.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
    const up = highs[i] - highs[i - 1], dn = lows[i - 1] - lows[i]
    pdm.push(up > dn && up > 0 ? up : 0)
    mdm.push(dn > up && dn > 0 ? dn : 0)
  }
  for (let i = 0; i < highs.length; i++) {
    if (i < p) { atr.push(null); pdi.push(null); mdi.push(null); dx.push(null); adx.push(null); continue }
    let at = 0, pd = 0, md = 0; for (let j = i - p; j < i; j++) { at += tr[j]; pd += pdm[j]; md += mdm[j] }
    at /= p; pd /= p; md /= p; atr.push(at); pdi.push(pd); mdi.push(md)
    const ds = pd + md; dx.push(ds > 0 ? Math.abs(pd - md) / ds * 100 : 0)
  }
  for (let i = 0; i < highs.length; i++) {
    if (i < p * 2 - 1) { adx.push(null); continue }
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += dx[j] || 0
    adx.push(s / p)
  }
  return { adx, pdi, mdi }
}

function calcATR(highs, lows, closes, p = 14) {
  const tr = []
  for (let i = 1; i < highs.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])))
  }
  const r = []
  for (let i = 0; i < highs.length; i++) {
    if (i < p) { r.push(null); continue }
    let s = 0
    for (let j = i - p + 1; j <= i; j++) s += tr[j - 1]
    r.push(s / p)
  }
  return r
}

function calcVWAP(high, low, close, volume) {
  const typical = high.map((h, i) => ((h + low[i] + close[i]) / 3) * volume[i])
  const cumVol = []
  let volSum = 0, tpSum = 0
  for (let i = 0; i < high.length; i++) {
    volSum += volume[i]
    tpSum += typical[i]
    cumVol.push(volSum > 0 ? tpSum / volSum : null)
  }
  return cumVol
}

function calcVolAvg(volumes) {
  const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length
  const last = volumes[volumes.length - 1]
  return { avg, ratio: last / avg, level: last > avg * 1.3 ? 'high' : last < avg * 0.7 ? 'low' : 'avg' }
}

async function fetchLazy(ticker, type) {
  if (!FH_KEY) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    if (type === 'earnings') {
      const r = await fetch(`${FH}/stock/earnings?symbol=${ticker}.NS&token=${FH_KEY}`, { signal: controller.signal })
      const j = await r.json()
      if (!Array.isArray(j)) return null
      return j.slice(0, 4).map(e => ({ quarter: `Q${e.quarter} ${e.year}`, actual: e.actual, estimate: e.estimate, surprise: e.surprisePercent }))
    }
    if (type === 'recommendations') {
      const r = await fetch(`${FH}/stock/recommendation?symbol=${ticker}.NS&token=${FH_KEY}`, { signal: controller.signal })
      const j = await r.json()
      if (!Array.isArray(j) || j.length === 0) return null
      const l = j[0]
      const total = l.strongBuy + l.buy + l.hold + l.sell + l.strongSell
      if (total === 0) return null
      const score = (l.strongBuy * 2 + l.buy + l.hold * 0 - l.sell - l.strongSell * 2) / total
      const label = score >= 1.5 ? 'Strong Buy' : score >= 0.5 ? 'Buy' : score >= -0.5 ? 'Hold' : score >= -1.5 ? 'Sell' : 'Strong Sell'
      return { strongBuy: l.strongBuy, buy: l.buy, hold: l.hold, sell: l.sell, strongSell: l.strongSell, total, score: Math.round(score * 100) / 100, label }
    }
  } catch { return null }
  finally { clearTimeout(timeout) }
  return null
}

const Ct = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{label}</div>
      {payload.filter(p => p.value !== null).map((p, i) => (
        <div key={i} className="tooltip-row">
          <span style={{ color: p.color }}>{p.name}</span>
          <span>{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

const PriceChartPanel = memo(({ data }) => {
  if (!data || data.length === 0) return null
  return (
    <div className="chart-card">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--surface3)" />
          <XAxis dataKey="date" tick={{ fill: 'var(--text2)', fontSize: 9 }} interval="preserveStartEnd" />
          <YAxis domain={['auto', 'auto']} tick={{ fill: 'var(--text2)', fontSize: 9 }} />
          <Tooltip content={<Ct />} />
          <Area type="monotone" dataKey="bbUpper" stroke="transparent" fill="var(--accent)" fillOpacity={0.04} />
          <Area type="monotone" dataKey="bbLower" stroke="transparent" fill="var(--accent)" fillOpacity={0.04} />
          <Line type="monotone" dataKey="close" stroke="var(--accent)" name="Price" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="sma20" stroke="var(--green)" name="SMA 20" dot={false} strokeWidth={1} strokeDasharray="4 2" />
          <Line type="monotone" dataKey="sma50" stroke="var(--amber)" name="SMA 50" dot={false} strokeWidth={1} />
          <Line type="monotone" dataKey="bbUpper" stroke="var(--text2)" name="B.Band" dot={false} strokeWidth={0.5} />
          <Line type="monotone" dataKey="bbLower" stroke="var(--text2)" name="" dot={false} strokeWidth={0.5} />
          {data[0]?.vwap && <Line type="monotone" dataKey="vwap" stroke="var(--text3)" name="VWAP" dot={false} strokeWidth={1} strokeDasharray="4 4" />}
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ height: 40, marginTop: 2 }}>
        <ResponsiveContainer width="100%" height={40}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--surface3)" />
            <XAxis dataKey="date" hide />
            <YAxis hide domain={[0, 'auto']} />
            <Bar dataKey="volume" fill="var(--text2)" opacity={0.3} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
})

const RSIPanel = memo(({ data }) => {
  if (!data || data.length === 0) return null
  return (
    <div className="chart-card" style={{ padding: '0.5rem 0.5rem 0.25rem' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text2)', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
        RSI (14)<span className="info-tip" style={{ marginLeft: 4 }}>ℹ<span className="tip-text">RSI measures speed/magnitude of price changes on a 0–100 scale. 🔴 &gt;70 = Overbought — in strong trends, RSI can stay overbought for weeks, don't short blindly. 🟢 &lt;30 = Oversold — in strong downtrends, RSI can stay oversold, don't buy blindly. ⚠️ DIVERGENCE is most reliable: price makes lower low + RSI higher low = bullish reversal ahead.</span></span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <ComposedChart data={data}>
          <XAxis dataKey="date" tick={{ fill: 'var(--text2)', fontSize: 7 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fill: 'var(--text2)', fontSize: 7 }} ticks={[30, 50, 70]} />
          <Tooltip content={<Ct />} />
          <ReferenceLine y={70} stroke="var(--red)" strokeDasharray="2 2" strokeOpacity={0.4} />
          <ReferenceLine y={30} stroke="var(--green)" strokeDasharray="2 2" strokeOpacity={0.4} />
          <ReferenceLine y={50} stroke="var(--text2)" strokeOpacity={0.2} />
          <Line type="monotone" dataKey="rsi" stroke="var(--amber)" name="RSI" dot={false} strokeWidth={1.5} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

const MACDPanel = memo(({ data }) => {
  if (!data || data.length === 0) return null
  return (
    <div className="chart-card" style={{ padding: '0.5rem 0.5rem 0.25rem' }}>
      <div style={{ fontSize: '0.6rem', color: 'var(--text2)', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>
        MACD (12, 26, 9)<span className="info-tip" style={{ marginLeft: 4 }}>ℹ<span className="tip-text">MACD tracks momentum using 12/26-day EMAs. MACD &gt; Signal = bullish (buy), MACD &lt; Signal = bearish (sell). • Histogram green = momentum accelerating, red = decelerating. • MACD crosses above zero = uptrend established, below zero = downtrend. ⚠️ Divergence is key: price higher high + MACD lower high = trend weakening.</span></span>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={data}>
          <XAxis dataKey="date" tick={{ fill: 'var(--text2)', fontSize: 7 }} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text2)', fontSize: 7 }} />
          <Tooltip content={<Ct />} />
          <ReferenceLine y={0} stroke="var(--text2)" strokeOpacity={0.3} />
          <Bar dataKey="macdHist" fill="var(--text2)" name="Histogram" opacity={0.5}>
            {data.map((entry, i) => <Cell key={i} fill={(entry.macdHist || 0) >= 0 ? 'var(--green)' : 'var(--red)'} fillOpacity={0.5} />)}
          </Bar>
          <Line type="monotone" dataKey="macd" stroke="var(--accent)" name="MACD" dot={false} strokeWidth={1.5} />
          <Line type="monotone" dataKey="macdSignal" stroke="var(--amber)" name="Signal" dot={false} strokeWidth={1} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

export default function StockDashboard() {
  const [symbol, setSymbol] = useState('RELIANCE')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [fundamentals, setFundamentals] = useState(null)
  const [data, setData] = useState(null)
  const [lazyData, setLazyData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [finTab, setFinTab] = useState('quarterly')
  const [chartPeriod, setChartPeriod] = useState('1y')

  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  const fetchPhase1 = useCallback(async (sym, histPeriod) => {
    setLoading(true)
    setError(null)
    setData(null)
    setLazyData(null)
    try {
      const [fundR, histR, quoteR] = await Promise.all([
        fetch(`${API}/api/yf/fundamentals/${sym}`).then(r => r.json()),
        fetch(`${API}/api/nse/history/${sym}?period=${histPeriod}`).then(r => r.json()),
        fetch(`${API}/api/nse/quote/${sym}`).then(r => r.json()),
      ])
      if (fundR.success === 'true') setFundamentals(fundR)
      else setError(fundR.error || 'Failed to load fundamentals')

      if (histR.values && histR.values.length > 0) {
        const daily = histR.values.map(v => ({
          date: v.datetime, open: v.open, high: v.high, low: v.low, close: v.close, volume: v.volume,
        }))
        const c = daily.map(d => d.close), h = daily.map(d => d.high), l = daily.map(d => d.low), v = daily.map(d => d.volume)

        const sma20 = calcSMA(c, 20), sma50 = calcSMA(c, 50)
        const bb = calcBB(c, 20, 2)
        const rsiArr = calcRSI(c)
        const macd = calcMACD(c)
        const adx = calcADX(h, l, c)
        const vol = calcVolAvg(v)
        const atr = calcATR(h, l, c, 14)
        const vwap = calcVWAP(h, l, c, v)

        const merged = daily.map((p, i) => ({
          ...p,
          sma20: sma20[i], sma50: sma50[i],
          bbUpper: bb.upper[i], bbLower: bb.lower[i],
          rsi: rsiArr[i],
          macd: macd.macd[i], macdSignal: macd.signal[i], macdHist: macd.hist[i],
          adx: adx.adx[i], pdi: adx.pdi[i], mdi: adx.mdi[i],
          vwap: vwap[i], atr: atr[i],
        }))

        const last = merged[merged.length - 1]
        const lc = last?.close || 0
        const lr = last?.rsi || 50
        const lm = last?.macd || 0
        const ls = last?.macdSignal || 0
        const sma20v = last?.sma20
        const sma50v = last?.sma50

        let regime = 'ranging'
        const adxv = adx.adx[adx.adx.length - 1] || 0
        const pdv = adx.pdi[adx.pdi.length - 1] || 0
        const mdv = adx.mdi[adx.mdi.length - 1] || 0
        if (adxv >= 25 && pdv > mdv) regime = 'trend-up'
        if (adxv >= 25 && mdv > pdv) regime = 'trend-down'

        let score = 50
        if (lr < 30) score += 20; else if (lr < 45) score += 10; else if (lr > 70) score -= 20; else if (lr > 60) score -= 10
        if (lm > ls) score += 15; else score -= 15
        if (regime === 'trend-up') score += 10; else if (regime === 'trend-down') score -= 10
        if (lc > (last?.sma50 || lc * 10)) score += 10; else score -= 10
        if (sma20v && sma50v && sma20v > sma50v) score += 5; else score -= 5
        if (vol.level === 'high') score += 5; else if (vol.level === 'low') score -= 5

        const overall = score >= 70 ? 'Strong Buy' : score >= 55 ? 'Buy' : score >= 40 ? 'Hold' : score >= 25 ? 'Sell' : 'Strong Sell'
        const signalClass = score >= 70 ? 'strong-buy' : score >= 55 ? 'buy' : score >= 40 ? 'hold' : score >= 25 ? 'sell' : 'strong-sell'

        const lookback = Math.min(63, h.length)
        const recentH = h.slice(-lookback).filter(Boolean)
        const recentL = l.slice(-lookback).filter(Boolean)
        const pivotH = recentH.length > 0 ? Math.max(...recentH) : lc
        const pivotL = recentL.length > 0 ? Math.min(...recentL) : lc
        const pivot = (pivotH + pivotL + lc) / 3
        const diff = pivotH - pivotL

        const atrVal = last?.atr || 0
        const supportLevels = [sma20v, pivotL, last?.bbLower].filter(x => x && x < lc)
        const nearestSupport = supportLevels.length > 0 ? Math.max(...supportLevels) : lc - atrVal * 1.5

        const entryLow = Math.round(nearestSupport * 100) / 100
        const entryHigh = Math.round((lc + nearestSupport) / 2 * 100) / 100
        const sl = Math.round((nearestSupport - atrVal * 0.5) * 100) / 100
        const target = Math.round((2 * pivot - pivotL) * 100) / 100
        const risk = lc - sl
        const reward = target - lc
        const rr = risk > 0 && reward > 0 ? (reward / risk).toFixed(1) : risk > 0 ? '\u221e' : '\u2014'

        const posSize = Math.round(10000 / Math.max(risk, 0.01))

        setData({
          merged, price: lc, close: lc, change: merged.length > 1 ? ((lc / merged[merged.length - 2]?.close - 1) * 100).toFixed(2) : '0',
          rsi: lr, macd: lm, macdSignal: ls, macdHist: last?.macdHist || 0,
          adx: adxv, pdi: pdv, mdi: mdv, regime, trade: adxv >= 25 ? 'Trend trading: buy dips in direction' : 'Range trading: buy support, sell resistance',
          sma20: sma20v, sma50: sma50v,
          bbUpper: bb.upper[bb.upper.length - 1], bbLower: bb.lower[bb.lower.length - 1],
          volume: v[v.length - 1], volAvg: vol.avg, volRatio: vol.ratio, volLevel: vol.level,
          overall, signalClass, conf: score,
          entryLow, entryHigh, sl, target, rr, posSize,
          vwap: vwap[vwap.length - 1], atr: atrVal,
          support: nearestSupport,
          overview: quoteR,
          pivot, r1: 2 * pivot - pivotL, r2: pivot + diff, s1: 2 * pivot - pivotH, pivotS2: pivot - diff,
          fib236: pivotL + diff * 0.236, fib382: pivotL + diff * 0.382, fib500: pivotL + diff * 0.5, fib618: pivotL + diff * 0.618, fib786: pivotL + diff * 0.786,
        })
      }
      setLoading(false)
    } catch (e) {
      setError(e.message); setLoading(false)
    }
  }, [])

  const fetchPhase2 = useCallback(async (sym) => {
    const [earningsD, recsD] = await Promise.all([
      fetchLazy(sym, 'earnings'),
      fetchLazy(sym, 'recommendations'),
    ])
    if (earningsD || recsD) setLazyData({ earnings: earningsD, recommendations: recsD })
  }, [])

  useEffect(() => {
    fetchPhase1(symbol, PERIOD_MAP[chartPeriod] || '5y')
    fetchPhase2(symbol)
  }, [symbol, chartPeriod, fetchPhase1, fetchPhase2])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (searchQuery.length < 1) { setSearchResults([]); setShowDropdown(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`${API}/api/search?q=${encodeURIComponent(searchQuery)}`)
        const j = await r.json()
        setSearchResults(j.search_results || [])
        setShowDropdown(true)
      } catch { setSearchResults([]) }
      setSearching(false)
      setActiveIndex(-1)
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  useEffect(() => {
    const handler = (e) => { if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selectStock = (item) => { setSymbol(item.trading_symbol); setSearchQuery(''); setSearchResults([]); setShowDropdown(false) }
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(i => i < searchResults.length - 1 ? i + 1 : 0) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(i => i > 0 ? i - 1 : searchResults.length - 1) }
    if (e.key === 'Enter' && activeIndex >= 0) selectStock(searchResults[activeIndex])
    if (e.key === 'Escape') setShowDropdown(false)
  }

  const chartView = useMemo(() => {
    if (!data?.merged) return []
    return data.merged.slice(-(PERIOD_DAYS[chartPeriod] || 252))
  }, [data?.merged, chartPeriod])

  const d = fundamentals?.data || {}
  const ratios = d.top_ratios || {}
  const qrHeaders = d.quaterly_results?.[0] || []
  const qrRows = d.quaterly_results?.slice(1) || []
  const plRows = d.profit_and_loss || []
  const bsRows = d.balance_sheet || []
  const cfRows = d.cash_flows || []
  const shqRows = d.shareholding_quarterly || []

  return (
    <div>
      <div className="search-section" ref={searchRef}>
        <div className="search-row">
          <div className="search-wrapper">
            <div className="search-input-wrap">
              <span className="search-icon">$</span>
              <input type="text" className="search-input" placeholder="Search NSE stocks..." value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)} onFocus={() => { if (searchResults.length > 0) setShowDropdown(true) }} onKeyDown={handleKeyDown} />
              {searching && <div className="spinner" style={{ width: 14, height: 14, marginRight: 8 }} />}
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="search-dropdown">
                {searchResults.map((item, i) => (
                  <div key={item.trading_symbol} className={`search-item ${i === activeIndex ? 'active' : ''}`}
                    onClick={() => selectStock(item)} onMouseEnter={() => setActiveIndex(i)}>
                    <span className="search-symbol">{item.trading_symbol}</span>
                    <span className="search-name">{item.name}</span>
                  </div>
                ))}
              </div>
            )}
            {showDropdown && searchResults.length === 0 && !searching && searchQuery.length >= 1 && (
              <div className="search-dropdown"><div className="search-empty">No results</div></div>
            )}
          </div>
        </div>
        {!searchQuery && (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {POPULAR.map(t => (
              <button key={t} onClick={() => setSymbol(t)}
                style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', fontFamily: 'var(--font-mono)',
                  background: symbol === t ? 'var(--accent)' : 'transparent', color: symbol === t ? '#000' : 'var(--text2)',
                  border: `1px solid ${symbol === t ? 'var(--accent)' : 'var(--surface3)'}`, borderRadius: 4, cursor: 'pointer' }}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="loading-box"><div className="spinner" /><span>Loading {symbol}...</span></div>}
      {error && <div className="error-box">{error}</div>}

      {!loading && fundamentals && (
        <>
          <div className="stock-header">
            <span className="stock-ticker">{fundamentals.trading_symbol}</span>
            <span className="stock-company-name">{fundamentals.company}</span>
            {data?.price > 0 && <span className="stock-price">₹{fmt(data.price)}</span>}
            {data?.change && <span className={`stock-change ${+data.change >= 0 ? 'pos' : 'neg'}`}>{+data.change >= 0 ? '▲' : '▼'} {Math.abs(data.change)}%</span>}
          </div>

          <div className="snapshot-grid">
            {ratios['Stock P/E'] && <div className="snapshot-card"><div className="snapshot-label">P/E</div><div className="snapshot-value">{ratios['Stock P/E']}</div></div>}
            {ratios['ROCE'] && <div className="snapshot-card"><div className="snapshot-label">ROCE</div><div className="snapshot-value">{ratios['ROCE']}</div></div>}
            {ratios['ROE'] && <div className="snapshot-card"><div className="snapshot-label">ROE</div><div className="snapshot-value">{ratios['ROE']}</div></div>}
            {ratios['Book Value'] && <div className="snapshot-card"><div className="snapshot-label">Book Value</div><div className="snapshot-value">{ratios['Book Value']}</div></div>}
            {ratios['Market Cap'] && <div className="snapshot-card"><div className="snapshot-label">Market Cap</div><div className="snapshot-value">{fmtCr(ratios['Market Cap'])}</div></div>}
            {ratios['Dividend Yield'] && <div className="snapshot-card"><div className="snapshot-label">Div Yield</div><div className="snapshot-value">{ratios['Dividend Yield']}</div></div>}
            {ratios['High / Low'] && <div className="snapshot-card" style={{ gridColumn: 'span 2' }}><div className="snapshot-label">52W Range</div><div className="snapshot-value" style={{ fontSize: '0.8rem' }}>{ratios['High / Low']}</div></div>}
          </div>

          <div className="dashboard-layout">
            <div className="main-col">
              {chartView.length > 0 && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {['3m', '1y', '5y'].map(p => (
                      <button key={p} onClick={() => setChartPeriod(p)}
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.6rem', fontFamily: 'var(--font-mono)',
                          background: chartPeriod === p ? 'var(--accent)' : 'var(--surface2)', color: chartPeriod === p ? '#000' : 'var(--text2)',
                          border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        {p === '3m' ? '3 Months' : p === '1y' ? '1 Year' : '5 Years'}
                      </button>
                    ))}
                  </div>
                  <div className="chart-legend">
                    <span className="legend-item">
                      <span className="legend-line" style={{ background: 'var(--green)', height: 2, width: 16 }} />
                      <span className="legend-label">SMA 20</span>
                    </span>
                    <span className="legend-item">
                      <span className="legend-line" style={{ background: 'var(--amber)', height: 2, width: 16 }} />
                      <span className="legend-label">SMA 50</span>
                    </span>
                    <span className="legend-item">
                      <span className="legend-line dashed" style={{ width: 16 }} />
                      <span className="legend-label">BB</span>
                    </span>
                    {data?.vwap && <span className="legend-item"><span className="legend-line" style={{ background: 'var(--text3)', height: 2, width: 16 }} /><span className="legend-label">VWAP</span></span>}
                  </div>
                  <PriceChartPanel data={chartView} />
                  <RSIPanel data={chartView} />
                  <MACDPanel data={chartView} />
                </div>
              )}

              {data && (
                <div style={{ marginBottom: '0.5rem', padding: '0.35rem 0.5rem', background: 'var(--surface2)', borderRadius: 4, fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--text2)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span><span style={{ color: 'var(--accent)' }}>📊</span> Market Sentiment:</span>
                  <span style={{ color: data.regime === 'trend-up' ? 'var(--green)' : data.regime === 'trend-down' ? 'var(--red)' : 'var(--amber)' }}>{data.regime === 'trend-up' ? 'Uptrend' : data.regime === 'trend-down' ? 'Downtrend' : 'Range-bound'}</span>
                  <span>|</span>
                  <span style={{ color: data.sma20 > data.sma50 ? 'var(--green)' : 'var(--red)' }}>{data.sma20 > data.sma50 ? 'Bullish SMAs' : 'Bearish SMAs'}</span>
                  <span>|</span>
                  <span style={{ color: data.rsi < 30 ? 'var(--green)' : data.rsi > 70 ? 'var(--red)' : 'var(--amber)' }}>{data.rsi < 30 ? 'Oversold RSI' : data.rsi > 70 ? 'Overbought RSI' : 'Neutral RSI'}</span>
                  <span>|</span>
                  <span style={{ color: data.volLevel === 'high' ? 'var(--green)' : data.volLevel === 'low' ? 'var(--red)' : 'var(--text2)' }}>{data.volLevel === 'high' ? 'High Volume' : data.volLevel === 'low' ? 'Low Volume' : 'Normal Volume'}</span>
                </div>
              )}
              {data && (
                <div className={`signal-banner ${data.signalClass}`}>
                  <span className="signal-label">SIGNAL</span>
                  <span className="signal-value">{data.overall}</span>
                  <span className="signal-conf">{data.conf}% confidence</span>
                </div>
              )}
              {data && (
                <div className="regime-line">
                  <span className={`regime-badge ${data.regime}`}>{data.regime.replace('-', ' ').toUpperCase()}</span>
                  <span className="regime-strat">{data.trade}</span>
                </div>
              )}
              {data && (
                <div className="indicator-grid">
                  <div className="indicator-card">
                    <span className="indicator-name">RSI {fmt(data.rsi)}</span>
                    <span className={`indicator-status ${data.rsi > 70 ? 'overbought' : data.rsi < 30 ? 'oversold' : 'neutral'}`}>{data.rsi > 70 ? 'Overbought' : data.rsi < 30 ? 'Oversold' : 'Neutral'}</span>
                    <span className="indicator-desc">
                      {data.rsi < 30 ? 'Oversold — potential bounce &bull; Divergence bullish' : data.rsi > 70 ? 'Overbought &bull; In strong uptrend, can stay extended' : 'Neutral range &bull; No clear signal'}
                      <br/><span style={{ fontSize: '0.55rem', color: 'var(--text2)' }}>Strategy: Mean reversion (range) | Trend continuation (strong)</span>
                    </span>
                  </div>
                  <div className="indicator-card">
                    <span className="indicator-name">MACD {fmt(data.macd)}</span>
                    <span className={`indicator-status ${data.macd > data.macdSignal ? 'bullish' : 'bearish'}`}>{data.macd > data.macdSignal ? 'Bullish' : 'Bearish'}</span>
                    <span className="indicator-desc">
                      {data.macd > data.macdSignal ? 'Momentum up &bull; Histogram expanding' : 'Momentum fading &bull; Histogram contracting'} | Hist: {fmt(data.macdHist)}
                      <br/><span style={{ fontSize: '0.55rem', color: 'var(--text2)' }}>Strategy: Trend following | Watch for zero-line crossovers</span>
                    </span>
                  </div>
                  <div className="indicator-card">
                    <span className="indicator-name">ADX {fmt(data.adx)}</span>
                    <span className={`indicator-status ${data.adx >= 25 ? 'trending' : 'neutral'}`}>{data.adx >= 25 ? 'Trending' : 'Ranging'}</span>
                    <span className="indicator-desc">
                      +DI: {fmt(data.pdi)} / -DI: {fmt(data.mdi)}
                      <br/><span style={{ fontSize: '0.55rem', color: 'var(--text2)' }}>Strategy: ADX&gt;25 = trend mode, use momentum indicators | ADX&lt;25 = range mode, use oscillators</span>
                    </span>
                  </div>
                  <div className="indicator-card">
                    <span className="indicator-name">SMAs</span>
                    <span className="indicator-desc">20: ₹{data.sma20 ? fmt(data.sma20) : '—'} &nbsp; 50: ₹{data.sma50 ? fmt(data.sma50) : '—'}</span>
                    {data.sma20 && data.sma50 && <span className="indicator-desc" style={{ color: data.sma20 > data.sma50 ? 'var(--green)' : 'var(--red)' }}>{data.sma20 > data.sma50 ? 'Golden cross &bull; Bullish trend' : 'Death cross &bull; Bearish trend'}</span>}
                    <span style={{ fontSize: '0.55rem', color: 'var(--text2)' }}>Strategy: SMA crossovers for swing entry | Price vs SMA for trend confirmation</span>
                  </div>
                  <div className="indicator-card">
                    <span className="indicator-name">ATR(14)</span>
                    <span className="indicator-status">{data.atr ? '₹' + data.atr.toFixed(2) : '—'}</span>
                    <span className="indicator-desc">{data.atr ? 'Daily volatility &bull; Use for position sizing & SL placement' : 'N/A'}</span>
                  </div>
                  <div className="indicator-card">
                    <span className="indicator-name">VWAP</span>
                    <span className={`indicator-status ${data.vwap && data.price > data.vwap ? 'bullish' : 'bearish'}`}>{data.vwap ? '₹' + fmt(data.vwap) : '—'}</span>
                    <span className="indicator-desc">
                      {data.vwap ? (data.price > data.vwap ? 'Above fair value &bull; Bullish intraday bias' : 'Below fair value &bull; Bearish intraday bias') : 'Intraday only'}
                      <br/><span style={{ fontSize: '0.55rem', color: 'var(--text2)' }}>Strategy: VWAP as dynamic support/resistance</span>
                    </span>
                  </div>
                </div>
              )}
              {data && (
                <div className="entry-box">
                  <div className="entry-row">
                    <div className="entry-item"><span className="label">Entry Zone</span><span className="value green">₹{fmt(data.entryLow)} – ₹{fmt(data.entryHigh)}</span></div>
                    <div className="entry-item"><span className="label">Stop Loss</span><span className="value red">₹{fmt(data.sl)}</span></div>
                    <div className="entry-item"><span className="label">Target</span><span className="value green">₹{fmt(data.target)}</span></div>
                    <div className="entry-item"><span className="label">Risk/Reward</span><span className="value">{data.rr}</span></div>
                  </div>
                  {data.rr !== '—' && <div className="rr-bar"><div className="rr-fill" style={{ width: `${Math.min(100, +data.rr * 50)}%` }}></div></div>}
                  {data.posSize && <div style={{ marginTop: 8, padding: '0.4rem 0.5rem', background: 'var(--surface2)', borderRadius: 4, fontSize: '0.65rem', color: 'var(--text2)' }}><span style={{ color: 'var(--accent)' }}>💰 Position Sizing:</span> Risk ₹10,000 → Buy <strong style={{ color: 'var(--text)' }}>{data.posSize}</strong> shares (1R = ₹{fmt(Math.abs(data.price - data.sl) * data.posSize)})</div>}
                  {data && (
                    <div style={{ marginTop: '0.4rem', padding: '0.35rem 0.5rem', background: 'var(--surface1)', borderRadius: 4, fontSize: '0.6rem', color: 'var(--text2)', borderLeft: `3px solid ${data.regime === 'trend-up' ? 'var(--green)' : data.regime === 'trend-down' ? 'var(--red)' : 'var(--amber)'}` }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 600 }}>🎯 Tactical Entry Guidance: </span>
                      {data.regime === 'trend-up' && data.rsi < 50 && data.sma20 > data.sma50 && (
                        <>Optimal pullback entry — price near SMA20 support, RSI normalizing. Enter on bounce from {fmt(data.sma20)}.</>
                      )}
                      {data.regime === 'trend-up' && data.rsi >= 50 && data.price > data.sma50 && (
                        <>Momentum entry — price above SMA50, RSI in strength zone. Trail SL at {fmt(data.sma20)}.</>
                      )}
                      {data.regime === 'trend-up' && data.rsi > 65 && (
                        <>Caution — RSI overbought, wait for pullback. Look for entry at {fmt(data.sma20)} or {fmt(data.s1)}.</>
                      )}
                      {data.regime === 'trend-down' && data.rsi > 50 && data.sma20 < data.sma50 && (
                        <>Optimal short entry — price near SMA20 resistance, RSI normalizing. Enter on rejection from {fmt(data.sma20)}.</>
                      )}
                      {data.regime === 'trend-down' && data.rsi < 35 && (
                        <>Caution — RSI oversold, avoid shorts. Wait for recovery above {fmt(data.sma50)}.</>
                      )}
                      {data.regime === 'ranging' && data.rsi < 35 && data.price < data.pivot && (
                        <>Range long entry — near support {fmt(data.s1)}, RSI oversold. Target pivot {fmt(data.pivot)}.</>
                      )}
                      {data.regime === 'ranging' && data.rsi > 65 && data.price > data.pivot && (
                        <>Range short entry — near resistance {fmt(data.r1)}, RSI overbought. Target pivot {fmt(data.pivot)}.</>
                      )}
                      {data.regime === 'ranging' && (data.rsi < 65 && data.rsi > 35) && (
                        <>No clear edge — wait for RSI extreme or price at {fmt(data.s1)}/{fmt(data.r1)}.</>
                      )}
                    </div>
                  )}
                </div>
              )}
              {data && (
                <div className="quarter-box" style={{ marginBottom: '0.75rem' }}>
                  <div className="quarter-stats">
                    <span>Volume: <strong>{fmt(data.volume)}</strong></span>
                    <span>Avg Vol: <strong>{fmt(data.volAvg)}</strong></span>
                    <span>Vol Ratio: <strong className={data.volLevel === 'high' ? 'green' : data.volLevel === 'low' ? 'red' : ''}>{data.volLevel === 'high' ? '▲' : data.volLevel === 'low' ? '▼' : '●'} {data.volRatio ? fmt(data.volRatio) + 'x' : '—'}</strong></span>
                  </div>
                </div>
              )}

              <div className="tab-bar">
                {['quarterly', 'profit_loss', 'balance_sheet', 'cash_flow'].map(t => (
                  <button key={t} className={`tab-btn ${finTab === t ? 'active' : ''}`} onClick={() => setFinTab(t)}>
                    {{ quarterly: 'Quarterly', profit_loss: 'P&L', balance_sheet: 'Balance Sheet', cash_flow: 'Cash Flow' }[t]}
                  </button>
                ))}
              </div>
              {finTab === 'quarterly' && qrRows.length > 0 && (
                <div className="table-wrap"><table className="data-table"><thead><tr>{qrHeaders.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{qrRows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci === 0 ? 'cat' : 'num'}>{cell}</td>)}</tr>)}</tbody></table></div>
              )}
              {finTab === 'profit_loss' && plRows.length > 1 && <div className="table-wrap"><table className="data-table"><thead><tr>{(plRows[0] || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{plRows.slice(1).map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci === 0 ? 'cat' : 'num'}>{cell}</td>)}</tr>)}</tbody></table></div>}
              {finTab === 'balance_sheet' && bsRows.length > 1 && <div className="table-wrap"><table className="data-table"><thead><tr>{(bsRows[0] || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{bsRows.slice(1).map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci === 0 ? 'cat' : 'num'}>{cell}</td>)}</tr>)}</tbody></table></div>}
              {finTab === 'cash_flow' && cfRows.length > 1 && <div className="table-wrap"><table className="data-table"><thead><tr>{(cfRows[0] || []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{cfRows.slice(1).map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} className={ci === 0 ? 'cat' : 'num'}>{cell}</td>)}</tr>)}</tbody></table></div>}

              {(() => {
                const revRow = qrRows.find(r => r[0] === 'Sales' || r[0] === 'Net Sales' || r[0] === 'Revenue')
                const patRow = qrRows.find(r => r[0] === 'Net Profit' || r[0] === 'PAT' || r[0] === 'Profit')
                const hasChart = revRow && patRow && qrHeaders.length > 1
                let chartNode = null

                if (hasChart) {
                  const labels = qrHeaders.slice(1).filter(h => h !== 'Category')
                  const trendData = labels.map((l, i) => ({ quarter: l.slice(-7), revenue: parseFinNum(revRow[i + 1]), profit: parseFinNum(patRow[i + 1]) })).filter(d => d.revenue !== null)
                  if (trendData.length > 0) {
                    const last = trendData[trendData.length - 1]
                    const prev = trendData[trendData.length - 2]
                    const revChg = prev?.revenue ? ((last.revenue - prev.revenue) / prev.revenue * 100).toFixed(1) : null
                    const patChg = prev?.profit ? ((last.profit - prev.profit) / prev.profit * 100).toFixed(1) : null
                    const barW = Math.min(40, Math.max(20, 280 / trendData.length))
                    chartNode = (
                      <div className="trend-chart-card" style={{ padding: '0.5rem 0.5rem 0.25rem', flex: 1, marginBottom: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>Revenue vs Net Profit</div>
                          <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.55rem', fontFamily: 'var(--font-mono)' }}>
                            <span><span style={{ color: 'var(--accent)' }}>──</span> Rev {revChg >= 0 ? '+' : ''}{revChg}%</span>
                            <span><span style={{ color: 'var(--green)' }}>──</span> PAT {patChg >= 0 ? '+' : ''}{patChg}%</span>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={240}>
                          <ComposedChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--surface3)" />
                            <XAxis dataKey="quarter" tick={{ fill: 'var(--text2)', fontSize: 7 }} interval="preserveStartEnd" />
                            <YAxis yAxisId="left" tick={false} axisLine={false} />
                            <YAxis yAxisId="right" orientation="right" tick={false} axisLine={false} />
                            <Tooltip content={<Ct />} />
                            <Bar yAxisId="left" barSize={barW} dataKey="revenue" fill="var(--accent)" name="Revenue" opacity={0.7} radius={[2,2,0,0]} />
                            <Bar yAxisId="right" barSize={barW} dataKey="profit" fill="var(--green)" name="Net Profit" opacity={0.9} radius={[2,2,0,0]} />
                            <Line yAxisId="left" type="monotone" dataKey="revenue" stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" dot={false} opacity={0.6} />
                            <Line yAxisId="right" type="monotone" dataKey="profit" stroke="var(--green)" strokeWidth={2} strokeDasharray="4 3" dot={false} opacity={0.6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    )
                  }
                }

                const ratiosData = d.ratios || []
                const deRow = ratiosData.find(r => r[0] === 'Debt / Equity' || r[0] === 'Debt to Equity')
                const dEquity = deRow ? parseFinNum(deRow[deRow.length - 1]) : null
                const promoter = shqRows.find(r => r[0]?.toLowerCase().includes('promoter'))
                const promoterPct = promoter ? parseFinNum(promoter[promoter.length - 1]) : null
                const hasFlags = dEquity !== null || promoterPct !== null

                return (
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
                    {chartNode}
                    {hasFlags && (
                      <div className="flags-box" style={{ width: 190, flexShrink: 0, marginBottom: 0 }}>
                        <div className="flags-title">Red Flag Scanner</div>
                        <div className="flag-row">
                          <span className={`flag-icon ${dEquity === null ? 'pass' : dEquity > 2 ? 'warn' : 'pass'}`}>{dEquity === null ? '●' : dEquity > 2 ? '⚠' : '✓'}</span>
                          <span className="flag-label">Debt/Equity:</span>
                          <span className={`flag-value ${dEquity === null ? '' : dEquity > 2 ? 'warn' : 'pass'}`}>{dEquity !== null ? dEquity.toFixed(2) : '—'}</span>
                          <span style={{ fontSize: '0.6rem', color: 'var(--text2)' }}>{dEquity === null ? 'N/A' : dEquity > 2 ? 'HIGH' : 'Safe'}</span>
                        </div>
                        <div className="flag-row">
                          <span className={`flag-icon ${promoterPct === null ? 'pass' : promoterPct < 25 ? 'warn' : 'pass'}`}>{promoterPct === null ? '●' : promoterPct < 25 ? '⚠' : '✓'}</span>
                          <span className="flag-label">Promoter Holding:</span>
                          <span className={`flag-value ${promoterPct === null ? '' : promoterPct < 25 ? 'warn' : 'pass'}`}>{promoterPct !== null ? promoterPct.toFixed(1) + '%' : '—'}</span>
                          <span style={{ fontSize: '0.6rem', color: 'var(--text2)' }}>{promoterPct === null ? 'N/A' : promoterPct < 25 ? 'LOW' : 'Adequate'}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}

              {shqRows.length > 1 && (() => {
                const shHeaders = shqRows[0]
                const quarterLabels = shHeaders.slice(1)
                const lastIdx = quarterLabels.length - 1
                return (
                  <div className="trend-chart-card">
                    <div className="trend-chart-title">Shareholding (Latest: {quarterLabels[lastIdx] || 'N/A'})</div>
                    <div className="shareholding-grid">
                      {shqRows.slice(1).map((row, ri) => {
                        const num = parseFinNum(row[lastIdx + 1])
                        return (
                          <div key={ri} className="shareholding-row">
                            <span className="sh-holder">{row[0]}</span>
                            <div className="sh-bar-wrap"><div className="sh-bar" style={{ width: `${Math.min(num || 0, 100)}%`, background: num >= 50 ? 'var(--accent)' : num >= 25 ? 'var(--green)' : 'var(--amber)' }} /></div>
                            <span className="sh-value">{num !== null ? num.toFixed(1) + '%' : row[lastIdx + 1]}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}
            </div>

            <div className="side-col">
              {data?.overview && (
                <div className="side-card">
                  <div className="side-card-title">Company Overview</div>
                  <div className="overview-grid">
                    <div className="overview-item"><span className="ov-label">Mkt Cap</span><span className="ov-value">{fmtCap(data.overview.marketCap)}</span></div>
                    <div className="overview-item">
                      <span className="ov-label">P/E</span>
                      <span className="ov-value">
                        {data.overview.peRatio ? (
                          <>
                            <span style={{ color: data.overview.sectorPE && +data.overview.peRatio > data.overview.sectorPE ? 'var(--red)' : 'var(--green)' }}>{fmt(+data.overview.peRatio)}</span>
                            {data.overview.sectorPE && <span style={{ fontSize: '0.6rem', color: 'var(--text2)' }}> / {fmt(+data.overview.sectorPE)}</span>}
                          </>
                        ) : '—'}
                      </span>
                    </div>
                    <div className="overview-item"><span className="ov-label">ATR(14)</span><span className="ov-value">₹{data.atr ? data.atr.toFixed(2) : '—'}</span></div>
                    <div className="overview-item"><span className="ov-label">EPS</span><span className="ov-value">{data.overview.eps ? '₹' + fmt(+data.overview.eps) : '—'}</span></div>
                    <div className="overview-item"><span className="ov-label">Div Yield</span><span className="ov-value">{data.overview.dividendYield ? (data.overview.dividendYield).toFixed(2) + '%' : '—'}</span></div>
                    <div className="overview-item"><span className="ov-label">52W High</span><span className="ov-value" style={{ color: 'var(--green)' }}>₹{data.overview.yearHigh ? fmt(+data.overview.yearHigh) : '—'}</span></div>
                    <div className="overview-item"><span className="ov-label">52W Low</span><span className="ov-value" style={{ color: 'var(--red)' }}>₹{data.overview.yearLow ? fmt(+data.overview.yearLow) : '—'}</span></div>
                    <div className="overview-item full"><span className="ov-label">Sector</span><span className="ov-value">{data.overview.sector || '—'}</span></div>
                  </div>
                </div>
              )}
              {plRows.length > 1 && (() => {
                const revRow = plRows.find(r => r[0] === 'Total Revenue' || r[0] === 'Revenue' || r[0] === 'Net Sales' || r[0] === 'Sales')
                const patRow = plRows.find(r => r[0] === 'Net Profit' || r[0] === 'PAT')
                const headers = plRows[0] || []
                const lastYear = headers[1] || ''; const prevYear = headers[2] || ''
                const revLatest = revRow ? parseFinNum(revRow[1]) : null; const revPrev = revRow ? parseFinNum(revRow[2]) : null
                const patLatest = patRow ? parseFinNum(patRow[1]) : null; const patPrev = patRow ? parseFinNum(patRow[2]) : null
                const revGrowth = revPrev && revLatest ? ((revLatest - revPrev) / revPrev * 100) : null; const patGrowth = patPrev && patLatest ? ((patLatest - patPrev) / patPrev * 100) : null
                return (
                  <div className="side-card">
                    <div className="side-card-title">Annual Performance</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text2)', marginBottom: 4 }}>{prevYear} → {lastYear}</div>
                    {revLatest && <div style={{ fontSize: '0.75rem', marginBottom: 2 }}>Revenue: <strong>{fmt(revLatest)}</strong> {revGrowth !== null && <span style={{ color: revGrowth >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.65rem' }}>({revGrowth >= 0 ? '+' : ''}{revGrowth.toFixed(1)}%)</span>}</div>}
                    {patLatest && <div style={{ fontSize: '0.75rem' }}>Net Profit: <strong>{fmt(patLatest)}</strong> {patGrowth !== null && <span style={{ color: patGrowth >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.65rem' }}>({patGrowth >= 0 ? '+' : ''}{patGrowth.toFixed(1)}%)</span>}</div>}
                  </div>
                )
              })()}
              {data && (
                <div className="side-card">
                  <div className="side-card-title">Key Levels</div>
                  <div className="levels-section">
                    <div className="levels-subtitle">Pivot Points<span className="info-tip" style={{ marginLeft: 4 }}>ℹ<span className="tip-text">Support/resistance levels from prior period's High, Low, Close. R1/R2 = resistance above pivot, S1/S2 = support below. Often act as price targets or reversal zones.</span></span></div>
                    <div className="level-row"><span className="level-label">R2</span><span className="level-value" style={{ color: 'var(--red)' }}>₹{fmt(data.r2)}</span></div>
                    <div className="level-row"><span className="level-label">R1</span><span className="level-value" style={{ color: 'var(--red)' }}>₹{fmt(data.r1)}</span></div>
                    <div className="level-row"><span className="level-label pivot">Pivot</span><span className="level-value pivot">₹{fmt(data.pivot)}</span></div>
                    <div className="level-row"><span className="level-label">S1</span><span className="level-value" style={{ color: 'var(--green)' }}>₹{fmt(data.s1)}</span></div>
                    <div className="level-row"><span className="level-label">S2</span><span className="level-value" style={{ color: 'var(--green)' }}>₹{fmt(data.pivotS2)}</span></div>
                  </div>
                  <div className="levels-divider"></div>
                  <div className="levels-section">
                    <div className="levels-subtitle">Fibonacci<span className="info-tip" style={{ marginLeft: 4 }}>ℹ<span className="tip-text">Retracement levels from the Fibonacci sequence. After a price swing, these levels often act as support/resistance. 61.8% is the "golden ratio" — the most significant level.</span></span></div>
                    <div className="level-row"><span className="level-label">0.236</span><span className="level-value">₹{fmt(data.fib236)}</span></div>
                    <div className="level-row"><span className="level-label">0.382</span><span className="level-value">₹{fmt(data.fib382)}</span></div>
                    <div className="level-row"><span className="level-label">0.500</span><span className="level-value">₹{fmt(data.fib500)}</span></div>
                    <div className="level-row"><span className="level-label">0.618</span><span className="level-value">₹{fmt(data.fib618)}</span></div>
                    <div className="level-row"><span className="level-label">0.786</span><span className="level-value">₹{fmt(data.fib786)}</span></div>
                  </div>
                </div>
              )}
              {lazyData?.earnings && (
                <div className="side-card">
                  <div className="side-card-title">Earnings Surprise</div>
                  <div className="earnings-table">
                    <div className="earnings-hdr"><span>Quarter</span><span>Est</span><span>Act</span><span>Surp</span></div>
                    {lazyData.earnings.map(e => (
                      <div className="earnings-row" key={e.quarter}>
                        <span className="e-q">{e.quarter}</span>
                        <span className="e-n">{e.estimate?.toFixed(2) || '—'}</span>
                        <span className="e-n">{e.actual?.toFixed(2) || '—'}</span>
                        <span className={`e-s ${e.surprise >= 0 ? 'pos' : 'neg'}`}>{e.surprise >= 0 ? '+' : ''}{e.surprise?.toFixed(1) || '—'}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(lazyData?.recommendations || FH_KEY) && (
                <div className="side-card">
                  <div className="side-card-title">Analyst Consensus</div>
                  {lazyData?.recommendations ? (
                    <>
                      <div className="rec-bar">
                        {lazyData.recommendations.strongBuy > 0 && <div className="rec-seg sb" style={{ width: `${lazyData.recommendations.strongBuy / lazyData.recommendations.total * 100}%` }} />}
                        {lazyData.recommendations.buy > 0 && <div className="rec-seg buy" style={{ width: `${lazyData.recommendations.buy / lazyData.recommendations.total * 100}%` }} />}
                        {lazyData.recommendations.hold > 0 && <div className="rec-seg hold" style={{ width: `${lazyData.recommendations.hold / lazyData.recommendations.total * 100}%` }} />}
                        {lazyData.recommendations.sell > 0 && <div className="rec-seg sell" style={{ width: `${lazyData.recommendations.sell / lazyData.recommendations.total * 100}%` }} />}
                        {lazyData.recommendations.strongSell > 0 && <div className="rec-seg ss" style={{ width: `${lazyData.recommendations.strongSell / lazyData.recommendations.total * 100}%` }} />}
                      </div>
                      <div className="rec-labels">
                        <span>SB {lazyData.recommendations.strongBuy}</span><span>B {lazyData.recommendations.buy}</span><span>H {lazyData.recommendations.hold}</span><span>S {lazyData.recommendations.sell}</span><span>SS {lazyData.recommendations.strongSell}</span>
                      </div>
                      <div style={{ marginTop: '0.3rem', fontSize: '0.6rem', color: 'var(--text2)', lineHeight: 1.4, padding: '0.25rem 0.3rem', background: 'var(--surface2)', borderRadius: 4 }}>
                        {lazyData.recommendations.score >= 1.5 ? 'Strong Buy: Significant upside expected. Attractive entry for accumulation.' :
                         lazyData.recommendations.score >= 0.5 ? 'Buy: Moderate upside expected. Consider initiating a position.' :
                         lazyData.recommendations.score >= -0.5 ? 'Hold: Neutral outlook. No urgent action needed.' :
                         lazyData.recommendations.score >= -1.5 ? 'Sell: Downside risk expected. Consider reducing position.' :
                         'Strong Sell: Significant downside risk. Avoid the stock.'}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: '0.65rem', color: 'var(--text2)', padding: '0.5rem', textAlign: 'center' }}>
                      {FH_KEY ? 'Loading consensus data...' : 'No analyst data available'}
                    </div>
                  )}
                </div>
              )}
              {d.about && (
                <div className="side-card"><div className="side-card-title">About</div><p className="about-text">{d.about}</p></div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
