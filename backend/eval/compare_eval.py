#!/usr/bin/env python3
"""Compare an eval run against a pinned baseline and gate on regressions.

Reads two ``summary.json`` files (see ``run_eval.write_summary_json``): a
committed **baseline** (the reference, e.g. last run on ``main``) and the
**current** run. Emits a Markdown delta table suitable for a PR comment and
exits non-zero when a gated metric regresses beyond the tolerance — turning
"eval regression" into a merge-blocking check.

The comparison logic is import-friendly and dependency-free so it can be unit
tested without a database or OpenAI (see ``tests/test_eval_compare.py``).

Usage:
    python eval/compare_eval.py --baseline eval/baseline.json \\
        --current eval/summary.json --tolerance 0.02 --output comment.md
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# metric key -> (display label, format kind). Order defines table row order.
METRICS: list[tuple[str, str, str]] = [
    ("hit_at_1", "Hit@1", "pct"),
    ("hit_at_3", "Hit@3", "pct"),
    ("hit_at_5", "Hit@5", "pct"),
    ("hit_at_8", "Hit@8", "pct"),
    ("mrr", "MRR", "ratio"),
    ("llm_judge_correctness_rate", "Judge correctness", "pct"),
    ("llm_judge_faithfulness_rate", "Judge faithfulness", "pct"),
]

# Metrics whose regression fails the gate. Others are reported but informational.
DEFAULT_GATED = ("hit_at_5", "mrr")

_COMMENT_MARKER = "<!-- eval-regression-gate -->"


@dataclass
class MetricRow:
    key: str
    label: str
    baseline: float | None
    current: float | None
    delta: float | None
    gated: bool
    regressed: bool


@dataclass
class Comparison:
    rows: list[MetricRow]
    regressed_flips: list[dict[str, Any]] = field(default_factory=list)
    improved_flips: list[dict[str, Any]] = field(default_factory=list)
    tolerance: float = 0.02
    baseline_sha: str | None = None

    @property
    def regressed(self) -> bool:
        return any(r.regressed for r in self.rows)


def _fmt_value(value: float | None, kind: str) -> str:
    if value is None:
        return "—"
    if kind == "pct":
        return f"{value * 100:.1f}%"
    return f"{value:.3f}"


def _fmt_delta(delta: float | None, kind: str) -> str:
    if delta is None:
        return "—"
    if kind == "pct":
        return f"{delta * 100:+.1f}pp"
    return f"{delta:+.3f}"


def compare(
    baseline: dict[str, Any],
    current: dict[str, Any],
    tolerance: float = 0.02,
    gated: tuple[str, ...] = DEFAULT_GATED,
) -> Comparison:
    """Compare two run summaries. A gated metric dropping by more than
    ``tolerance`` (in its native 0..1 unit) counts as a regression."""
    base_metrics = baseline.get("metrics", {})
    cur_metrics = current.get("metrics", {})

    rows: list[MetricRow] = []
    for key, label, kind in METRICS:
        b = base_metrics.get(key)
        c = cur_metrics.get(key)
        delta = (c - b) if (b is not None and c is not None) else None
        is_gated = key in gated
        regressed = bool(is_gated and delta is not None and delta < -tolerance)
        # Skip metrics absent from both runs (e.g. judge disabled) to keep the table tight.
        if b is None and c is None:
            continue
        rows.append(
            MetricRow(
                key=key,
                label=label,
                baseline=b,
                current=c,
                delta=delta,
                gated=is_gated,
                regressed=regressed,
            )
        )

    # Per-case Hit@5 flips, matched by case_id.
    base_cases = {c["case_id"]: c for c in baseline.get("cases", [])}
    cur_cases = {c["case_id"]: c for c in current.get("cases", [])}
    regressed_flips: list[dict[str, Any]] = []
    improved_flips: list[dict[str, Any]] = []
    for case_id, cur_case in cur_cases.items():
        base_case = base_cases.get(case_id)
        if not base_case:
            continue
        was = bool(base_case.get("hit_at_5"))
        now = bool(cur_case.get("hit_at_5"))
        if was and not now:
            regressed_flips.append(cur_case)
        elif now and not was:
            improved_flips.append(cur_case)

    return Comparison(
        rows=rows,
        regressed_flips=regressed_flips,
        improved_flips=improved_flips,
        tolerance=tolerance,
        baseline_sha=baseline.get("git_sha"),
    )


def render_markdown(cmp: Comparison, current: dict[str, Any]) -> str:
    """Render the comparison as a PR-comment-ready Markdown block."""
    kind_by_key = {key: kind for key, _, kind in METRICS}
    lines: list[str] = [_COMMENT_MARKER]
    verdict = "🔴 **Regression**" if cmp.regressed else "✅ **No regression**"
    lines.append(f"### 🧪 Eval regression gate — {verdict}")
    lines.append("")

    base_ref = f"`{cmp.baseline_sha[:7]}`" if cmp.baseline_sha else "the pinned baseline"
    cur_sha = current.get("git_sha")
    cur_ref = f"`{cur_sha[:7]}`" if cur_sha else "this run"
    total = current.get("config", {}).get("total_cases")
    dataset = current.get("config", {}).get("dataset", "dataset")
    lines.append(
        f"Comparing {cur_ref} against baseline {base_ref} on "
        f"**{dataset}** ({total} cases), tolerance ±{cmp.tolerance * 100:.0f}pp."
    )
    lines.append("")

    lines.append("| Metric | Baseline | Current | Δ | |")
    lines.append("| --- | ---: | ---: | ---: | :---: |")
    for r in cmp.rows:
        kind = kind_by_key[r.key]
        if r.delta is None:
            status = "➖"
        elif r.regressed:
            status = "🔴"
        elif r.delta > cmp.tolerance:
            status = "🟢"
        elif r.delta < -cmp.tolerance:
            status = "🟡"  # dropped, but not a gated metric
        else:
            status = "➖"
        label = f"**{r.label}**" if r.gated else r.label
        lines.append(
            f"| {label} | {_fmt_value(r.baseline, kind)} | "
            f"{_fmt_value(r.current, kind)} | {_fmt_delta(r.delta, kind)} | {status} |"
        )
    lines.append("")

    if cmp.regressed_flips:
        ids = ", ".join(f"`{c['case_id']}`" for c in cmp.regressed_flips[:10])
        lines.append(f"**🔴 Hit@5 flipped to miss on {len(cmp.regressed_flips)} case(s):** {ids}")
        for c in cmp.regressed_flips[:5]:
            lines.append(f"- `{c['case_id']}` — {c.get('query', '')}")
        lines.append("")
    if cmp.improved_flips:
        lines.append(f"**🟢 Hit@5 recovered on {len(cmp.improved_flips)} case(s).**")
        lines.append("")

    if cmp.regressed:
        gated_labels = ", ".join(r.label for r in cmp.rows if r.regressed)
        lines.append(
            f"**Verdict:** {gated_labels} dropped beyond the "
            f"±{cmp.tolerance * 100:.0f}pp tolerance — this check fails."
        )
    else:
        lines.append("**Verdict:** gated metrics held within tolerance.")
    return "\n".join(lines) + "\n"


def _bootstrap_markdown(current: dict[str, Any]) -> str:
    kind_by_key = {key: kind for key, _, kind in METRICS}
    cur_metrics = current.get("metrics", {})
    lines = [
        _COMMENT_MARKER,
        "### 🧪 Eval regression gate — establishing baseline",
        "",
        "No baseline found (`backend/eval/baseline.json`). Recording this run's "
        "metrics as the reference; future PRs will be gated against it.",
        "",
        "| Metric | Value |",
        "| --- | ---: |",
    ]
    for key, label, kind in METRICS:
        v = cur_metrics.get(key)
        if v is None:
            continue
        lines.append(f"| {label} | {_fmt_value(v, kind_by_key[key])} |")
    return "\n".join(lines) + "\n"


def _load(path: Path) -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Compare an eval run to a baseline and gate.")
    parser.add_argument("--baseline", required=True, type=Path)
    parser.add_argument("--current", required=True, type=Path)
    parser.add_argument("--tolerance", type=float, default=0.02)
    parser.add_argument(
        "--gated",
        default=",".join(DEFAULT_GATED),
        help="Comma-separated metric keys that fail the gate on regression.",
    )
    parser.add_argument("--output", type=Path, help="Write the Markdown comment here.")
    parser.add_argument(
        "--allow-missing-baseline",
        action="store_true",
        help="Exit 0 with a bootstrap message when the baseline file is absent.",
    )
    args = parser.parse_args(argv)

    current = _load(args.current)

    if not args.baseline.exists():
        if args.allow_missing_baseline:
            md = _bootstrap_markdown(current)
            if args.output:
                args.output.write_text(md)
            print(md)
            return 0
        print(f"error: baseline not found: {args.baseline}", file=sys.stderr)
        return 2

    baseline = _load(args.baseline)
    gated = tuple(g.strip() for g in args.gated.split(",") if g.strip())
    cmp = compare(baseline, current, tolerance=args.tolerance, gated=gated)
    md = render_markdown(cmp, current)
    if args.output:
        args.output.write_text(md)
    print(md)
    return 1 if cmp.regressed else 0


if __name__ == "__main__":
    sys.exit(main())
