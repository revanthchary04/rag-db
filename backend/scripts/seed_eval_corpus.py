#!/usr/bin/env python3
"""
Load the eval corpus into Postgres so eval/run_eval.py has documents to retrieve.

The corpus is the set of Markdown files in ``data/sample_docs/`` (repo root): one
document per file, with ``source`` taken from the filename stem and ``title`` from
the first Markdown heading. Keeping the corpus as files (not inline strings) lets it
grow — the eval's difficulty comes from a corpus large enough, with enough topical
overlap, that top-k retrieval has to actually discriminate between similar sources.

Requires DATABASE_URL, OPENAI_API_KEY, and schema from scripts/apply_init_sql.py.
Skips sources that already exist in the database (by `source` field) so CI and
re-runs do not duplicate embeddings.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from typing import Any

# noqa: E402 — path before app imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

from app.db.queries import list_documents
from app.db.session import close_db_pool, init_db_pool
from app.rag.ingest import ingest_document

load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

CORPUS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "sample_docs"


def load_corpus(corpus_dir: Path = CORPUS_DIR) -> list[dict[str, str]]:
    """Read every ``*.md`` file in ``corpus_dir`` into a corpus record.

    ``source`` is the filename stem (matches ``expected_sources`` in the eval
    dataset); ``title`` is the first ``# `` heading, or a humanized stem.
    """
    docs: list[dict[str, str]] = []
    for path in sorted(corpus_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            continue
        title = path.stem.replace("-", " ").title()
        for line in text.splitlines():
            if line.startswith("# "):
                title = line[2:].strip()
                break
        docs.append({"source": path.stem, "title": title, "text": text})
    return docs


async def main() -> None:
    if not os.environ.get("DATABASE_URL", "").strip():
        print("DATABASE_URL is required", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        print("OPENAI_API_KEY is required for embedding ingestion", file=sys.stderr)
        sys.exit(1)

    corpus = load_corpus()
    if not corpus:
        print(f"no corpus documents found in {CORPUS_DIR}", file=sys.stderr)
        sys.exit(1)
    print(f"loaded {len(corpus)} corpus document(s) from {CORPUS_DIR}")

    await init_db_pool()
    try:
        existing_docs = await list_documents(limit=500, offset=0)
        existing_sources = {d.get("source") for d in existing_docs if d.get("source")}

        for doc in corpus:
            if doc["source"] in existing_sources:
                print(f"skip {doc['source']} (already in database)")
                continue
            result: dict[str, Any] = await ingest_document(
                source=doc["source"],
                title=doc["title"],
                text=doc["text"],
                is_markdown=True,
            )
            print(f"ingested {doc['source']}: {result}")
            existing_sources.add(doc["source"])
    finally:
        await close_db_pool()


if __name__ == "__main__":
    asyncio.run(main())
