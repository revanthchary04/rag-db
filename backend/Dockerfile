FROM python:3.11-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Copy dependency files
COPY backend/pyproject.toml backend/uv.lock* ./

# Install dependencies using uv sync (installs from pyproject.toml)
RUN uv sync --frozen --no-install-project

# Copy application code
COPY backend/ ./backend/

# Set working directory to backend
WORKDIR /app/backend

# Expose port
EXPOSE 8000

# Run the application using uv run to use the virtual environment
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

