import httpx
import pytest

from app.main import app


@pytest.mark.asyncio
async def test_health_endpoint():
    """Test health check endpoint."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")
        assert response.status_code == 200
        data = response.json()
        assert "ok" in data
        assert "db" in data
        assert data["version"] == "0.1.0"
