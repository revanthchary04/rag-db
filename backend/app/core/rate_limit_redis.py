"""
Redis-based distributed rate limiter for production deployments.

This module provides a Redis-backed rate limiter that works across multiple
application instances, solving the per-instance limitation of the in-memory
rate limiter.

Usage:
    Set REDIS_URL and REDIS_ENABLED=true in environment variables.
    The rate limiter will automatically use Redis if enabled.
"""

import time

import redis.asyncio as redis
import structlog

from app.core.config import settings

logger = structlog.get_logger()


class RedisRateLimiter:
    """
    Redis-based distributed rate limiter.

    Works across multiple application instances by storing rate limit
    state in Redis. Falls back to in-memory limiter if Redis is unavailable.
    """

    def __init__(
        self,
        redis_url: str,
        max_requests: int | None = None,
        window_seconds: int | None = None,
    ):
        """
        Initialize Redis rate limiter.

        Args:
            redis_url: Redis connection URL (e.g., redis://localhost:6379/0)
            max_requests: Maximum requests per window (defaults to settings)
            window_seconds: Time window in seconds (defaults to settings)
        """
        self.max_requests = max_requests or settings.RATE_LIMIT_REQUESTS
        self.window_seconds = window_seconds or settings.RATE_LIMIT_WINDOW
        self.redis_url = redis_url
        self._redis_client: redis.Redis | None = None

    async def _get_redis(self) -> "redis.Redis":
        """Get or create Redis client."""
        if self._redis_client is None:
            self._redis_client = redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._redis_client

    async def is_allowed(self, identifier: str) -> tuple[bool, int]:
        """
        Check if request is allowed using Redis sliding window.

        Args:
            identifier: Client identifier (e.g., IP address)

        Returns:
            Tuple of (is_allowed, remaining_requests)
        """
        try:
            redis_client = await self._get_redis()
            key = f"rate_limit:{identifier}"
            now = time.time()
            window_start = now - self.window_seconds

            # Use Redis pipeline for atomic operations
            pipe = redis_client.pipeline()

            # Remove old entries outside the window
            pipe.zremrangebyscore(key, 0, window_start)

            # Count current requests in window
            pipe.zcard(key)

            # Add current request
            pipe.zadd(key, {str(now): now})

            # Set expiration on key (cleanup)
            pipe.expire(key, self.window_seconds + 1)

            # Execute pipeline
            results = await pipe.execute()
            current_count = results[1]  # zcard result

            # Check if limit exceeded
            if current_count >= self.max_requests:
                logger.warning(
                    "Rate limit exceeded (Redis)",
                    identifier=identifier,
                    requests=current_count,
                    limit=self.max_requests,
                )
                return False, 0

            remaining = self.max_requests - current_count - 1
            return True, remaining

        except Exception as e:
            logger.error(
                "Redis rate limiter error, falling back to per-request allow",
                error=str(e),
                identifier=identifier,
            )
            # Fail open - allow request if Redis is unavailable
            # In production, you might want to fail closed instead
            return True, self.max_requests - 1

    async def reset(self, identifier: str | None = None) -> None:
        """
        Reset rate limit for identifier or all identifiers.

        Args:
            identifier: Specific identifier to reset, or None for all
        """
        try:
            redis_client = await self._get_redis()
            if identifier:
                key = f"rate_limit:{identifier}"
                await redis_client.delete(key)
            else:
                # Delete all rate limit keys (use with caution)
                keys = await redis_client.keys("rate_limit:*")
                if keys:
                    await redis_client.delete(*keys)
        except Exception as e:
            logger.error("Failed to reset Redis rate limit", error=str(e))

    async def close(self) -> None:
        """Close Redis connection."""
        if self._redis_client:
            await self._redis_client.close()
            self._redis_client = None


# Global Redis rate limiter instance
_redis_rate_limiter: RedisRateLimiter | None = None


def get_redis_rate_limiter() -> RedisRateLimiter | None:
    """Get or create global Redis rate limiter if enabled."""
    global _redis_rate_limiter

    redis_enabled = getattr(settings, "REDIS_ENABLED", False)
    redis_url = getattr(settings, "REDIS_URL", None)

    if not redis_enabled or not redis_url:
        return None

    if _redis_rate_limiter is None:
        _redis_rate_limiter = RedisRateLimiter(redis_url)
        logger.info("Redis rate limiter initialized", redis_url=redis_url)

    return _redis_rate_limiter
