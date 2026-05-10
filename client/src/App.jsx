import { useState } from 'react'
import StockDashboard from './components/StockDashboard'
import './App.css'

// StockVedic - Indian Stock Analysis Tool - v1.0
export default function App() {
  const [theme, setTheme] = useState('dark')

  return (
    <div className="app" data-theme={theme}>
      <header className="header">
        <span className="header-brand">StockVedic</span>
        <span className="header-tag">Professional-grade technical analysis for Indian Stock markets</span>
        <button className="theme-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      <main className="main">
        <StockDashboard />
      </main>
      <footer className="footer">
        StockVedic &copy; {new Date().getFullYear()} &mdash; Data: NSE India, Finnhub
        <span className="footer-rev"> rev {import.meta.env.VITE_GIT_COMMIT || 'dev'}</span>
      </footer>
    </div>
  )
}
