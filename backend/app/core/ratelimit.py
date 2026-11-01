import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    """Sliding-window rate limiter keyed by client IP (swap for Redis in multi-instance deployments)."""

    def __init__(self, limit: int, window_seconds: int = 60):
        self.limit = limit
        self.window = window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def __call__(self, request: Request) -> None:
        key = request.client.host if request.client else "anonymous"
        now = time.monotonic()
        bucket = self.hits[key]
        while bucket and now - bucket[0] > self.window:
            bucket.popleft()
        if len(bucket) >= self.limit:
            raise HTTPException(429, "Too many requests. Please slow down.")
        bucket.append(now)
