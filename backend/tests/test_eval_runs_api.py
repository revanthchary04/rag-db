"""Tests for persisted eval run HTTP API."""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.db.eval_queries import insert_eval_run_completed
from app.main import app


@pytest.mark.asyncio
async def test_eval_runs_list_and_detail():
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            run_id = str(uuid.uuid4())
            await insert_eval_run_completed(
                run_id=run_id,
                dataset_path="eval/dataset.jsonl",
                use_llm_judge=False,
                total_cases=1,
                successful=1,
                failed=0,
                hit_at_1=1.0,
                hit_at_3=1.0,
                hit_at_5=1.0,
                hit_at_8=1.0,
                mrr=1.0,
                llm_judge_correctness_rate=None,
                llm_judge_faithfulness_rate=None,
                config_json={"test": True},
                case_rows=[
                    {
                        "case_index": 1,
                        "case_id": "case-1",
                        "query": "q1",
                        "expected_sources": ["a.md"],
                        "retrieved_sources": ["a.md"],
                        "answer": "ans",
                        "hit_at_1": True,
                        "hit_at_3": True,
                        "hit_at_5": True,
                        "hit_at_8": True,
                        "mrr": 1.0,
                        "llm_judge_correctness": None,
                        "llm_judge_faithfulness": None,
                        "llm_judge_reasoning": None,
                        "error": None,
                        "citations": [],
                    }
                ],
            )

            r = await client.get("/api/v1/eval/runs?limit=20")
            assert r.status_code == 200
            ids = [x["id"] for x in r.json()["runs"]]
            assert run_id in ids

            d = await client.get(f"/api/v1/eval/runs/{run_id}")
            assert d.status_code == 200
            body = d.json()
            assert body["id"] == run_id
            assert body["total_cases"] == 1
            assert len(body["cases"]) == 1
            assert body["cases"][0]["query"] == "q1"

            missing = await client.get(f"/api/v1/eval/runs/{uuid.uuid4()}")
            assert missing.status_code == 404

            ex_json = await client.get(f"/api/v1/eval/runs/{run_id}/export?format=json")
            assert ex_json.status_code == 200
            assert "attachment" in ex_json.headers.get("content-disposition", "")
            body_json = ex_json.json()
            assert body_json["id"] == run_id
            assert body_json["cases"][0]["query"] == "q1"

            ex_csv = await client.get(f"/api/v1/eval/runs/{run_id}/export?format=csv")
            assert ex_csv.status_code == 200
            assert "case_index" in ex_csv.text
            assert "q1" in ex_csv.text
