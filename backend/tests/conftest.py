import pytest_asyncio
from httpx import AsyncClient

from app.db import session
from app.main import app


@pytest_asyncio.fixture(autouse=True)
async def _isolate_db_pool():
    """Prevent the global asyncpg pool from leaking across tests.

    asyncpg pools bind to the event loop that created them, and pytest-asyncio
    gives each test its own loop. The lifespan's shutdown (``close_db_pool``)
    runs after ``yield`` and is *not* wrapped in ``try/finally``, so a test that
    raises inside ``app.router.lifespan_context(app)`` skips it and leaves the
    global pool set. The next test's ``init_db_pool`` then reuses that pool via
    its ``if _pool is None`` guard — but its loop is already closed, so every DB
    call fails with "pool is closed" / "Event loop is closed".

    Closing and resetting the global in teardown (which runs on this test's own,
    still-live loop even when the test failed) guarantees each test builds and
    disposes of its own pool on its own loop.
    """
    yield
    if session._pool is not None:
        try:
            await session.close_db_pool()
        finally:
            session._pool = None


@pytest_asyncio.fixture
async def client():
    """Create test client."""
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
