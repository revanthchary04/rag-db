"""
Apply docker/init/*.sql to DATABASE_URL.

Uses the same idempotent scripts as Docker's first-time DB init, so this is safe
for dev DBs that were created without docker-entrypoint-initdb.d (e.g. local Postgres).
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def _init_dir() -> Path:
    return _repo_root() / "docker" / "init"


def _load_database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if url:
        return url
    try:
        from dotenv import load_dotenv

        backend = Path(__file__).resolve().parent.parent
        load_dotenv(backend.parent / ".env")
        load_dotenv(backend / ".env")
    except ImportError:
        pass
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        print(
            "DATABASE_URL is not set. Export it or add it to backend/.env or the repo root .env.",
            file=sys.stderr,
        )
        sys.exit(1)
    return url


def _split_sql_statements(sql: str) -> list[str]:
    """Split on semicolons (one statement per execute for asyncpg)."""
    lines: list[str] = []
    for line in sql.splitlines():
        if line.strip().startswith("--"):
            continue
        lines.append(line)
    text = "\n".join(lines)
    return [p.strip() for p in text.split(";") if p.strip()]


async def _main() -> None:
    dsn = _load_database_url()
    init_dir = _init_dir()
    if not init_dir.is_dir():
        print(f"Init directory not found: {init_dir}", file=sys.stderr)
        sys.exit(1)

    files = sorted(init_dir.glob("*.sql"))
    if not files:
        print(f"No .sql files in {init_dir}", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(dsn)
    try:
        for path in files:
            sql = path.read_text(encoding="utf-8")
            for stmt in _split_sql_statements(sql):
                await conn.execute(stmt)
            print(f"Applied {path.name}", file=sys.stderr)
    finally:
        await conn.close()
    print("Schema apply complete.", file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(_main())
