"""Per-device document visibility rules.

A document is visible to a request when it is either public (``owner_key IS NULL``,
the seeded demo corpus) or owned by the requesting device (``owner_key = <key>``),
and it has not expired (``expires_at IS NULL OR expires_at > NOW()``).

These helpers build the SQL fragment + parameters so every retrieval and listing
path applies the same rule, threading positional parameters through queries that
already carry their own ``$N`` placeholders.
"""

from typing import Any


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
        (sql_fragment, params). ``sql_fragment`` always begins with " AND " and is
        safe to append directly to a WHERE clause; ``params`` is appended to the
        query's parameter list in order.
    """
    owner_col = f"{column_prefix}owner_key"
    expires_col = f"{column_prefix}expires_at"

    not_expired = f"({expires_col} IS NULL OR {expires_col} > NOW())"

    if owner_key:
        clause = f" AND ({owner_col} IS NULL OR {owner_col} = ${next_param_index}) AND {not_expired}"
        return clause, [owner_key]

    # No device key: only public documents are visible.
    clause = f" AND {owner_col} IS NULL AND {not_expired}"
    return clause, []
