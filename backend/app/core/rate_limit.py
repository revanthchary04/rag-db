import time
from collections import defaultdict

import structlog

from app.core.config import settings

logger = structlog.get_logger()


class RateLimiter:
    """
    Simple in-memory rate limiter per IP address.

    WARNING: This is a per-instance rate limiter. In production with multiple
    instances, each instance maintains its own rate limit state. For distributed
    rate limiting, use a shared store like Redis.
    """

    def __init__(self, max_requests: int | None = None, window_seconds: int | None = None):
        """
        Initialize rate limiter.

        Args:
            max_requests: Maximum requests per window (defaults to settings)
            window_seconds: Time window in seconds (defaults to settings)
        """
        self.max_requests = max_requests or settings.RATE_LIMIT_REQUESTS
        self.window_seconds = window_seconds or settings.RATE_LIMIT_WINDOW
        self.requests: dict[str, list] = defaultdict(list)

    def is_allowed(self, identifier: str) -> tuple[bool, int]:
        """
        Check if request is allowed.

        Args:
            identifier: Client identifier (e.g., IP address)

        Returns:
            Tuple of (is_allowed, remaining_requests)
        """
        now = time.time()
        window_start = now - self.window_seconds

        # Clean old requests outside the window
        self.requests[identifier] = [
            req_time for req_time in self.requests[identifier] if req_time > window_start
        ]

        # Check if limit exceeded
        request_count = len(self.requests[identifier])
        if request_count >= self.max_requests:
            logger.warning(
                "Rate limit exceeded",
                identifier=identifier,
                requests=request_count,
                limit=self.max_requests,
            )
            return False, 0

        # Record this request
        self.requests[identifier].append(now)

        remaining = self.max_requests - request_count - 1
        return True, remaining

    def reset(self, identifier: str | None = None) -> None:
        """
        Reset rate limit for identifier or all identifiers.

        Args:
            identifier: Specific identifier to reset, or None for all
        """
        if identifier:
            self.requests.pop(identifier, None)
        else:
            self.requests.clear()


# Global rate limiter instance
_rate_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    """Get or create global rate limiter."""
    global _rate_limiter
    if _rate_limiter is None:
        _rate_limiter = RateLimiter()
    return _rate_limiter
