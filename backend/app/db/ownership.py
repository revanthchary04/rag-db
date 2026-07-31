"""Per-device document visibility rules.

A document is visible to a request when it is either public (``owner_key IS NULL``,
the seeded demo corpus) or owned by the requesting device (``owner_key = <key>``),
and it has not expired (``expires_at IS NULL OR expires_at > NOW()``).

These helpers build the SQL fragment + parameters so every retrieval and listing
path applies the same rule, threading positional parameters through queries that
already carry their own ``$N`` placeholders.

The isolation columns (``owner_key``, ``expires_at``) are added by migration 007.
Because the backend does not run migrations automatically on deploy, this module
also self-heals: ``ensure_isolation_schema()`` adds the columns idempotently at
startup, and every builder degrades to an unfiltered (no-isolation) query if the
columns are somehow still absent, so a stale schema never takes down retrieval.
"""

from typing import Any

import structlog

logger = structlog.get_logger()

# None = not yet probed (assume available so filters are applied); True/False once known.
_isolation_available: bool | None = None


def isolation_available() -> bool:
    """Whether the owner_key/expires_at columns are known to exist.

    Defaults to True until a probe proves otherwise, so isolation is applied
    normally on a correctly-migrated database without an extra round-trip.
    """
    return _isolation_available is not False


async def ensure_isolation_schema() -> bool:
    """Idempotently create the isolation columns + indexes and cache availability.

    Runs at startup so a deploy that ships this code but skips the Alembic
    migration still gets a working, isolated schema. Additive and safe to run
    repeatedly. If the DDL fails (e.g. a read-only replica), falls back to a
    read-only probe and, when the columns are missing, disables filtering so
    retrieval keeps working (degraded to no isolation) instead of crashing.
    """
    global _isolation_available
    from app.db.session import get_db_pool

    pool = await get_db_pool()
    async with pool.acquire() as conn:
        try:
            await conn.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS owner_key TEXT")
            await conn.execute(
                "ALTER TABLE documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS documents_owner_key_idx ON documents (owner_key)"
            )
            await conn.execute(
                "CREATE INDEX IF NOT EXISTS documents_expires_at_idx "
                "ON documents (expires_at) WHERE expires_at IS NOT NULL"
            )
            _isolation_available = True
            logger.info("Per-device document isolation schema ensured")
        except Exception as exc:
            _isolation_available = await _probe_columns(conn)
            logger.warning(
                "Could not ensure isolation schema; running with detected state",
                available=_isolation_available,
                error=str(exc),
            )
    return _isolation_available


async def _probe_columns(conn: Any) -> bool:
    """Read-only check for the presence of both isolation columns."""
    try:
        found = await conn.fetchval(
            """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = 'documents' AND column_name IN ('owner_key', 'expires_at')
            """
        )
        return (found or 0) >= 2
    except Exception:
        return False


def visibility_sql(
    owner_key: str | None,
    next_param_index: int,
    *,
    column_prefix: str = "",
) -> tuple[str, list[Any]]:
    """Return an ``AND (...)`` visibility clause and its bound parameters.

    Args:
        owner_key: The requesting device's key, or None for public-only access.
        next_param_index: The next free ``$N`` positional parameter number.
        column_prefix: Table alias/prefix for the columns (e.g. ``"d."``).

    Returns:
        (sql_fragment, params). ``sql_fragment`` begins with " AND " (or is empty
        when isolation is unavailable) and is safe to append directly to a WHERE
        clause; ``params`` is appended to the query's parameter list in order.
    """
    # Stale schema (columns absent): apply no filter rather than referencing
    # non-existent columns and crashing the query.
    if not isolation_available():
        return "", []

    owner_col = f"{column_prefix}owner_key"
    expires_col = f"{column_prefix}expires_at"

    not_expired = f"({expires_col} IS NULL OR {expires_col} > NOW())"

    if owner_key:
        clause = f" AND ({owner_col} IS NULL OR {owner_col} = ${next_param_index}) AND {not_expired}"
        return clause, [owner_key]

    # No device key: only public documents are visible.
    clause = f" AND {owner_col} IS NULL AND {not_expired}"
    return clause, []
