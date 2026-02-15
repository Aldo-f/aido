#!/usr/bin/env python3
"""
AIDO Database - SQLite for query tracking and model performance
"""

import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Optional

DATA_DIR = Path(os.path.expanduser("~/.aido-data"))
DB_FILE = DATA_DIR / "aido.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)


def get_connection():
    """Get database connection"""
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Initialize database schema"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            query_text TEXT NOT NULL,
            query_summary TEXT,
            model_used TEXT NOT NULL,
            provider TEXT NOT NULL,
            api_mode TEXT NOT NULL,
            response_time_ms INTEGER,
            response_length INTEGER,
            success INTEGER DEFAULT 1,
            error_message TEXT,
            user_agent TEXT
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS model_stats (
            model_name TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            total_requests INTEGER DEFAULT 0,
            successful_requests INTEGER DEFAULT 0,
            failed_requests INTEGER DEFAULT 0,
            avg_response_time_ms REAL DEFAULT 0,
            min_response_time_ms INTEGER,
            max_response_time_ms INTEGER,
            last_used TEXT,
            last_failure TEXT,
            failure_count INTEGER DEFAULT 0,
            is_cloud INTEGER DEFAULT 0
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS classifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            query_text TEXT NOT NULL,
            keywords_detected TEXT,
            model_classification TEXT,
            selected_model TEXT,
            correct INTEGER
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS key_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            key_hash TEXT NOT NULL,
            model_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(provider, key_hash, model_id)
        )
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_queries_timestamp ON queries(timestamp)
    """)

    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_queries_model ON queries(model_used)
    """)

    conn.commit()
    conn.close()


def log_query(
    query_text: str,
    model_used: str,
    provider: str,
    api_mode: str,
    response_time_ms: int,
    response_length: int,
    success: bool = True,
    error_message: Optional[str] = None,
    query_summary: Optional[str] = None,
):
    """Log a query to the database"""
    conn = get_connection()
    cursor = conn.cursor()

    timestamp = datetime.now().isoformat()

    cursor.execute(
        """
        INSERT INTO queries 
        (timestamp, query_text, query_summary, model_used, provider, api_mode, 
         response_time_ms, response_length, success, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """,
        (
            timestamp,
            query_text,
            query_summary,
            model_used,
            provider,
            api_mode,
            response_time_ms,
            response_length,
            1 if success else 0,
            error_message,
        ),
    )

    cursor.execute(
        """
        INSERT OR REPLACE INTO model_stats 
        (model_name, provider, total_requests, successful_requests, failed_requests,
         avg_response_time_ms, last_used, is_cloud)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?)
    """,
        (
            model_used,
            provider,
            1 if success else 0,
            0 if success else 1,
            response_time_ms,
            timestamp,
            1 if ":cloud" in model_used or "-cloud" in model_used else 0,
        ),
    )

    conn.commit()
    conn.close()


def update_model_stats(model_name: str, response_time_ms: int, success: bool):
    """Update model statistics after a request"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT * FROM model_stats WHERE model_name = ?
    """,
        (model_name,),
    )

    row = cursor.fetchone()

    if row:
        total = row["total_requests"] + 1
        success_count = row["successful_requests"] + (1 if success else 0)
        fail_count = row["failed_requests"] + (0 if success else 1)
        avg_time = (
            (row["avg_response_time_ms"] * row["total_requests"]) + response_time_ms
        ) / total

        cursor.execute(
            """
            UPDATE model_stats SET
                total_requests = ?,
                successful_requests = ?,
                failed_requests = ?,
                avg_response_time_ms = ?,
                min_response_time_ms = COALESCE(?, min_response_time_ms),
                max_response_time_ms = COALESCE(?, max_response_time_ms),
                last_used = ?,
                last_failure = ?,
                failure_count = ?
            WHERE model_name = ?
        """,
            (
                total,
                success_count,
                fail_count,
                avg_time,
                response_time_ms if not row["min_response_time_ms"] else None,
                response_time_ms if not row["max_response_time_ms"] else None,
                datetime.now().isoformat(),
                datetime.now().isoformat() if not success else None,
                fail_count,
                model_name,
            ),
        )
    else:
        cursor.execute(
            """
            INSERT INTO model_stats 
            (model_name, provider, total_requests, successful_requests, failed_requests,
             avg_response_time_ms, min_response_time_ms, max_response_time_ms, last_used, 
             last_failure, failure_count, is_cloud)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
            (
                model_name,
                "unknown",
                1 if success else 0,
                0 if success else 1,
                response_time_ms,
                response_time_ms,
                response_time_ms,
                datetime.now().isoformat(),
                datetime.now().isoformat() if not success else None,
                0 if success else 1,
                1 if ":cloud" in model_name or "-cloud" in model_name else 0,
            ),
        )

    conn.commit()
    conn.close()


def log_classification(
    query_text: str,
    keywords: str,
    model_classification: str,
    selected_model: str,
    correct: Optional[bool] = None,
):
    """Log classification results"""
    conn = get_connection()
    cursor = conn.cursor()

    timestamp = datetime.now().isoformat()

    cursor.execute(
        """
        INSERT INTO classifications
        (timestamp, query_text, keywords_detected, model_classification, selected_model, correct)
        VALUES (?, ?, ?, ?, ?, ?)
    """,
        (
            timestamp,
            query_text,
            keywords,
            model_classification,
            selected_model,
            correct,
        ),
    )

    conn.commit()
    conn.close()


def get_model_stats():
    """Get all model statistics"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT * FROM model_stats ORDER BY avg_response_time_ms ASC
    """)

    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def get_failed_models(min_failures: int = 1, hours: int = 24):
    """Get models that have failed recently"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT model_name, failure_count, last_failure, avg_response_time_ms
        FROM model_stats
        WHERE failure_count >= ? 
        AND last_failure > datetime('now', '-' || ? || ' hours')
        ORDER BY failure_count DESC
    """,
        (min_failures, hours),
    )

    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def get_fastest_model(cloud_first: bool = True):
    """Get the fastest model, optionally preferring cloud"""
    conn = get_connection()
    cursor = conn.cursor()

    if cloud_first:
        cursor.execute("""
            SELECT * FROM model_stats 
            WHERE successful_requests > 0
            ORDER BY 
                CASE WHEN is_cloud = 1 THEN 0 ELSE 1 END,
                avg_response_time_ms ASC
            LIMIT 1
        """)
    else:
        cursor.execute("""
            SELECT * FROM model_stats 
            WHERE successful_requests > 0
            ORDER BY avg_response_time_ms ASC
            LIMIT 1
        """)

    row = cursor.fetchone()
    conn.close()

    return dict(row) if row else None


def get_recent_queries(limit: int = 10):
    """Get recent queries"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT * FROM queries ORDER BY timestamp DESC LIMIT ?
    """,
        (limit,),
    )

    rows = cursor.fetchall()
    conn.close()

    return [dict(row) for row in rows]


def save_key_models(provider: str, key_hash: str, model_ids: list):
    """Save available models for a key"""
    conn = get_connection()
    cursor = conn.cursor()
    timestamp = datetime.now().isoformat()

    for model_id in model_ids:
        try:
            cursor.execute(
                """
                INSERT OR REPLACE INTO key_models (provider, key_hash, model_id, created_at)
                VALUES (?, ?, ?, ?)
            """,
                (provider, key_hash, model_id, timestamp),
            )
        except:
            pass

    conn.commit()
    conn.close()


def get_key_models(provider: str, key_hash: str) -> list:
    """Get available models for a specific key"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT model_id FROM key_models WHERE provider = ? AND key_hash = ?
    """,
        (provider, key_hash),
    )

    rows = cursor.fetchall()
    conn.close()
    return [row[0] for row in rows]


def get_provider_models(provider: str) -> dict:
    """Get all models grouped by key for a provider"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT key_hash, model_id FROM key_models WHERE provider = ?
    """,
        (provider,),
    )

    rows = cursor.fetchall()
    conn.close()

    result = {}
    for key_hash, model_id in rows:
        if key_hash not in result:
            result[key_hash] = []
        result[key_hash].append(model_id)

    return result


def clear_key_models(provider: str, key_hash: str):
    """Clear models for a removed key"""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute(
        "DELETE FROM key_models WHERE provider = ? AND key_hash = ?",
        (provider, key_hash),
    )

    conn.commit()
    conn.close()


def summarize_query(query_text: str) -> str:
    """Generate a short summary of the query"""
    words = query_text.split()

    if len(words) <= 10:
        return query_text[:100]

    first_words = " ".join(words[:8])
    return f"{first_words}... ({len(words)} words)"


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DB_FILE}")

    stats = get_model_stats()
    print(f"\nModel stats ({len(stats)} models):")
    for s in stats[:5]:
        print(
            f"  {s['model_name']}: {s['avg_response_time_ms']:.0f}ms avg, "
            f"{s['successful_requests']} success, {s['failed_requests']} failed"
        )
