from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent.parent
_ROOT_ENV = _BACKEND_DIR.parent / ".env"
_BACKEND_ENV = _BACKEND_DIR / ".env"


def _env_files() -> tuple[str, ...]:
    """Repo root .env first, then backend/.env (later file overrides)."""
    paths: list[Path] = []
    if _ROOT_ENV.is_file():
        paths.append(_ROOT_ENV)
    if _BACKEND_ENV.is_file():
        paths.append(_BACKEND_ENV)
    if not paths:
        return (".env",)
    return tuple(str(p) for p in paths)


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=_env_files(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str
    DB_POOL_MIN_SIZE: int = 5
    DB_POOL_MAX_SIZE: int = 20
    DB_COMMAND_TIMEOUT: int = 60

    # Ingest: replace chunks in place when (source, title) already exists (no versioned source)
    INGEST_REPLACE_IF_EXISTS: bool = False

    # OpenAI
    OPENAI_API_KEY: str
    OPENAI_EMBEDDING_MODEL: str = "text-embedding-3-small"
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"
    EMBEDDING_DIMENSION: int = 1536

    # OpenAI API settings
    OPENAI_MAX_RETRIES: int = 3  # Reduced back to 3 - rate limits handled separately
    OPENAI_TIMEOUT: int = 60  # seconds

    # Request limits
    MAX_INGEST_PAYLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    # Optional PDF bytes (decoded size) attached at ingest for UI preview; base64 JSON is larger.
    MAX_INGEST_ORIGINAL_FILE_BYTES: int = 25 * 1024 * 1024  # 25MB

    # Chat history (Postgres). When CHAT_RETENTION_DAYS > 0, stale threads are deleted on list/create.
    CHAT_RETENTION_DAYS: int = 0  # 0 = disable pruning
    MAX_QUERY_LENGTH: int = 5000  # characters
    MAX_CONTEXT_CHARS: int = 50000  # characters for retrieved context
    MAX_CONTEXT_TOKENS: int = 12000  # tokens for context (approximate)

    # Rate limiting
    RATE_LIMIT_REQUESTS: int = 100  # requests per window
    RATE_LIMIT_WINDOW: int = 60  # seconds

    # Redis (optional, for distributed rate limiting)
    REDIS_URL: str = ""
    REDIS_ENABLED: bool = False

    # Legacy support (for backward compatibility)
    @property
    def embedding_model(self) -> str:
        """Legacy property for backward compatibility."""
        return self.OPENAI_EMBEDDING_MODEL

    @property
    def llm_model(self) -> str:
        """Legacy property for backward compatibility."""
        return self.OPENAI_CHAT_MODEL

    # Chunking
    CHUNK_SIZE: int = 1000
    CHUNK_OVERLAP: int = 200

    # Ingest preprocessing / chunk hygiene (production defaults)
    # Collapse runs longer than N newlines down to exactly N (e.g. 2 keeps one blank line between blocks).
    INGEST_COLLAPSE_BLANK_LINES_TO: int = 2
    INGEST_DEDUPE_CONSECUTIVE_PARAGRAPHS: bool = True
    # Merge chunks shorter than this into neighbors when combined size stays under soft cap.
    INGEST_MIN_CHUNK_CHARS: int = 80
    INGEST_MERGED_CHUNK_SOFT_CAP_RATIO: float = 1.35

    # Adaptive chunk size per ingest (from preprocessed character count)
    INGEST_ADAPTIVE_CHUNKING: bool = True
    INGEST_ADAPTIVE_CHUNK_MIN: int = 400
    INGEST_ADAPTIVE_CHUNK_MAX: int = 2000
    # Overlap as a fraction of resolved chunk_size, capped by CHUNK_OVERLAP.
    INGEST_ADAPTIVE_OVERLAP_RATIO: float = 0.2

    # CORS (comma-separated string, will be parsed to list)
    # Supports both CORS_ORIGINS (legacy) and CORS_ALLOW_ORIGINS
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:3001"
    CORS_ALLOW_ORIGINS: str = ""  # Override CORS_ORIGINS if set

    # Server
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # OpenTelemetry (install backend with: uv sync --extra otel)
    OTEL_ENABLED: bool = False
    OTEL_SERVICE_NAME: str = "rag-eval-backend"

    # Optional API key for all /api/v1/* routes except health and metrics (empty = disabled).
    # Recommended for any public deployment: set this on the backend and pass the same
    # value as BACKEND_API_KEY on the frontend proxy. See docs/HARDENING.md.
    API_KEY: str = ""

    @property
    def is_production(self) -> bool:
        """True when ENVIRONMENT indicates a production deployment."""
        return self.ENVIRONMENT.strip().lower() in ("production", "prod")

    @property
    def cors_origins_list(self) -> list[str]:
        """Get CORS origins as a list."""
        # Use CORS_ALLOW_ORIGINS if set, otherwise fall back to CORS_ORIGINS
        origins_str = self.CORS_ALLOW_ORIGINS.strip() or self.CORS_ORIGINS
        # Always include localhost:3000 and localhost:3001 for development
        origins = [origin.strip() for origin in origins_str.split(",") if origin.strip()]
        for default_origin in ["http://localhost:3000", "http://localhost:3001"]:
            if default_origin not in origins:
                origins.append(default_origin)
        return origins


settings = Settings()
