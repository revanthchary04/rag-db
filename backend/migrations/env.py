"""Alembic environment (sync SQLAlchemy engine for migrations)."""

from __future__ import annotations

import os
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

_backend_dir = Path(__file__).resolve().parent.parent
load_dotenv(_backend_dir.parent / ".env")
load_dotenv(_backend_dir / ".env")


def get_sync_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError("DATABASE_URL is required for Alembic migrations")
    if url.startswith("postgresql+asyncpg://"):
        url = "postgresql://" + url.removeprefix("postgresql+asyncpg://")
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url.removeprefix("postgresql://")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=get_sync_url(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = create_engine(get_sync_url(), poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(connection=connection)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
