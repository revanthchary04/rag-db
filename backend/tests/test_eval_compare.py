"""Tests for the eval regression gate (eval/compare_eval.py).

Pure comparison logic — no database or OpenAI required.
"""

import json

from eval.compare_eval import (
    _COMMENT_MARKER,
    compare,
    main,
    render_markdown,
)


def _summary(hit5, mrr, cases=None, *, hit1=0.7, git_sha="abc1234def", judge=None):
    metrics = {
        "hit_at_1": hit1,
        "hit_at_3": 0.8,
        "hit_at_5": hit5,
        "hit_at_8": 0.95,
        "mrr": mrr,
        "llm_judge_correctness_rate": judge,
        "llm_judge_faithfulness_rate": judge,
    }
    return {
        "git_sha": git_sha,
        "config": {"dataset": "dataset.jsonl", "total_cases": len(cases or []) or 49},
        "metrics": metrics,
        "cases": cases or [],
    }


class TestCompare:
    def test_identical_runs_no_regression(self):
        base = _summary(0.90, 0.80)
        cur = _summary(0.90, 0.80)
        result = compare(base, cur, tolerance=0.02)
        assert result.regressed is False

    def test_hit5_drop_beyond_tolerance_is_regression(self):
        base = _summary(0.90, 0.80)
        cur = _summary(0.83, 0.80)  # -0.07 on gated Hit@5
        result = compare(base, cur, tolerance=0.02)
        assert result.regressed is True
        hit5_row = next(r for r in result.rows if r.key == "hit_at_5")
        assert hit5_row.regressed is True

    def test_small_drop_within_tolerance_passes(self):
        base = _summary(0.90, 0.80)
        cur = _summary(0.89, 0.79)  # -0.01, within ±0.02
        assert compare(base, cur, tolerance=0.02).regressed is False

    def test_non_gated_metric_drop_does_not_fail(self):
        # Hit@1 is not gated by default; a big drop there must not fail the gate.
        base = _summary(0.90, 0.80, hit1=0.90)
        cur = _summary(0.90, 0.80, hit1=0.50)
        result = compare(base, cur, tolerance=0.02)
        assert result.regressed is False
        hit1_row = next(r for r in result.rows if r.key == "hit_at_1")
        assert hit1_row.regressed is False

    def test_mrr_is_gated(self):
        base = _summary(0.90, 0.80)
        cur = _summary(0.90, 0.70)  # -0.10 MRR
        assert compare(base, cur, tolerance=0.02).regressed is True

    def test_custom_gated_set(self):
        base = _summary(0.90, 0.80, hit1=0.90)
        cur = _summary(0.90, 0.80, hit1=0.50)
        # Gate on hit_at_1 explicitly -> now the drop fails.
        assert compare(base, cur, tolerance=0.02, gated=("hit_at_1",)).regressed is True

    def test_hit5_flips_detected_by_case_id(self):
        base = _summary(
            0.90,
            0.80,
            cases=[
                {"case_id": "case-1", "query": "q1", "hit_at_5": True},
                {"case_id": "case-2", "query": "q2", "hit_at_5": False},
            ],
        )
        cur = _summary(
            0.90,
            0.80,
            cases=[
                {"case_id": "case-1", "query": "q1", "hit_at_5": False},  # regressed
                {"case_id": "case-2", "query": "q2", "hit_at_5": True},  # improved
            ],
        )
        result = compare(base, cur)
        assert [c["case_id"] for c in result.regressed_flips] == ["case-1"]
        assert [c["case_id"] for c in result.improved_flips] == ["case-2"]

    def test_judge_metrics_absent_are_skipped(self):
        base = _summary(0.90, 0.80, judge=None)
        cur = _summary(0.90, 0.80, judge=None)
        keys = {r.key for r in compare(base, cur).rows}
        assert "llm_judge_correctness_rate" not in keys


class TestRenderMarkdown:
    def test_markdown_has_marker_and_table(self):
        cur = _summary(0.83, 0.80)
        md = render_markdown(compare(_summary(0.90, 0.80), cur), cur)
        assert _COMMENT_MARKER in md
        assert "| Metric | Baseline | Current | Δ |" in md
        assert "Regression" in md

    def test_clean_run_reports_no_regression(self):
        cur = _summary(0.90, 0.80)
        md = render_markdown(compare(_summary(0.90, 0.80), cur), cur)
        assert "No regression" in md


class TestCli:
    def _write(self, path, data):
        path.write_text(json.dumps(data))

    def test_main_exits_1_on_regression(self, tmp_path):
        base = tmp_path / "baseline.json"
        cur = tmp_path / "summary.json"
        out = tmp_path / "comment.md"
        self._write(base, _summary(0.90, 0.80))
        self._write(cur, _summary(0.80, 0.80))
        code = main(["--baseline", str(base), "--current", str(cur), "--output", str(out)])
        assert code == 1
        assert _COMMENT_MARKER in out.read_text()

    def test_main_exits_0_when_clean(self, tmp_path):
        base = tmp_path / "baseline.json"
        cur = tmp_path / "summary.json"
        self._write(base, _summary(0.90, 0.80))
        self._write(cur, _summary(0.91, 0.81))
        assert main(["--baseline", str(base), "--current", str(cur)]) == 0

    def test_missing_baseline_bootstraps_when_allowed(self, tmp_path):
        cur = tmp_path / "summary.json"
        out = tmp_path / "comment.md"
        self._write(cur, _summary(0.90, 0.80))
        code = main(
            [
                "--baseline",
                str(tmp_path / "nope.json"),
                "--current",
                str(cur),
                "--output",
                str(out),
                "--allow-missing-baseline",
            ]
        )
        assert code == 0
        assert "establishing baseline" in out.read_text()

    def test_missing_baseline_errors_without_flag(self, tmp_path):
        cur = tmp_path / "summary.json"
        self._write(cur, _summary(0.90, 0.80))
        assert main(["--baseline", str(tmp_path / "nope.json"), "--current", str(cur)]) == 2
