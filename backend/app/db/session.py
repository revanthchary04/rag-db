import asyncpg
import structlog

from app.core.config import settings

logger = structlog.get_logger()

_pool: asyncpg.Pool | None = None


async def init_db_pool() -> None:
    """Initialize database connection pool."""
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(
                settings.DATABASE_URL,
                min_size=settings.DB_POOL_MIN_SIZE,
                max_size=settings.DB_POOL_MAX_SIZE,
                command_timeout=settings.DB_COMMAND_TIMEOUT,
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error("Failed to initialize database pool", error=str(e))
            raise


async def close_db_pool() -> None:
    """Close database connection pool."""
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
        logger.info("Database connection pool closed")


async def get_db_pool() -> asyncpg.Pool:
    """Get database connection pool."""
    if _pool is None:
        raise RuntimeError("Database pool not initialized")
    return _pool


async def check_db_connection() -> bool:
    """Check database connectivity."""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception as e:
        logger.error("Database connection check failed", error=str(e))
        return False
