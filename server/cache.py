import sqlite3
import json
import time
from pathlib import Path

DB_PATH = Path(__file__).parent / "cache.db"

CACHE_TTL = {
    "search": 86400,
    "fundamentals": 43200,
    "quote": 60,
    "price_history": 3600,
}


def _get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, data TEXT, expires INTEGER)"
    )
    conn.commit()
    return conn


def get(key):
    conn = _get_db()
    row = conn.execute(
        "SELECT data, expires FROM cache WHERE key = ?", (key,)
    ).fetchone()
    conn.close()
    if row and row[1] > int(time.time()):
        return json.loads(row[0])
    return None


def set(key, data, ttl=300):
    conn = _get_db()
    conn.execute(
        "INSERT OR REPLACE INTO cache (key, data, expires) VALUES (?, ?, ?)",
        (key, json.dumps(data), int(time.time()) + ttl),
    )
    conn.commit()
    conn.close()


def make_key(prefix, *parts):
    return f"{prefix}:{'|'.join(str(p) for p in parts)}"
