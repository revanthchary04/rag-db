"""Tests for latency histograms, per-stage RAG metrics, and the tracing shim.

These cover the observability upgrade (real percentiles + OpenTelemetry pipeline
spans) and run without a database or OpenAI — pure in-process metrics.
"""

import pytest

from app.core.metrics import (
    LATENCY_BUCKET_BOUNDS_MS,
    LatencyHistogram,
    get_metrics,
    reset_metrics,
)
from app.core.tracing import (
    current_trace_id,
    observe_stage,
    otel_available,
    record_stage_latency,
    span,
)


@pytest.fixture(autouse=True)
def _reset():
    reset_metrics()
    yield
    reset_metrics()


class TestLatencyHistogram:
    def test_empty_histogram_returns_zero(self):
        hist = LatencyHistogram()
        assert hist.count == 0
        assert hist.avg_ms == 0.0
        assert hist.quantile(0.95) == 0.0

    def test_single_observation_interpolates_within_bucket(self):
        # 30ms lands in the (25, 50] bucket. With one observation, the median
        # interpolates halfway across that bucket: 25 + (50-25)*0.5 = 37.5.
        hist = LatencyHistogram()
        hist.observe(30.0)
        assert hist.count == 1
        assert hist.quantile(0.5) == 37.5

    def test_percentiles_are_monotonic(self):
        hist = LatencyHistogram()
        for value in [5, 20, 40, 80, 120, 300, 700, 1500, 3000, 8000]:
            hist.observe(value)
        p = hist.percentiles()
        assert p["p50_ms"] <= p["p95_ms"] <= p["p99_ms"]

    def test_overflow_bucket_reports_largest_finite_bound(self):
        hist = LatencyHistogram()
        hist.observe(99_999.0)  # beyond the last finite bound
        assert hist.bucket_counts[-1] == 1
        assert hist.quantile(0.99) == LATENCY_BUCKET_BOUNDS_MS[-1]

    def test_avg_tracks_sum_over_count(self):
        hist = LatencyHistogram()
        hist.observe(100.0)
        hist.observe(300.0)
        assert hist.avg_ms == 200.0

    def test_prometheus_lines_are_cumulative_and_well_formed(self):
        hist = LatencyHistogram()
        hist.observe(30.0)
        hist.observe(700.0)
        lines = hist.prometheus_lines("http_request_latency_ms", 'route="/q"')
        text = "\n".join(lines)
        # +Inf bucket and count both equal total observations (cumulative).
        assert 'http_request_latency_ms_bucket{route="/q",le="+Inf"} 2' in text
        assert 'http_request_latency_ms_count{route="/q"} 2' in text
        assert 'http_request_latency_ms_sum{route="/q"}' in text
        # The le=25 bucket precedes both observations, so it is 0.
        assert 'http_request_latency_ms_bucket{route="/q",le="25"} 0' in text


class TestMetricsCollector:
    def test_route_metrics_expose_percentiles(self):
        metrics = get_metrics()
        for latency in [40, 120, 900]:
            metrics.record_request("/api/v1/query", 200, latency)
        data = metrics.get_metrics()
        route = data["routes"]["/api/v1/query"]
        assert route["request_count"] == 3
        assert set(route["percentiles"]) == {"p50_ms", "p95_ms", "p99_ms"}

    def test_stage_metrics_recorded_and_exposed(self):
        metrics = get_metrics()
        metrics.record_stage("retrieve", 45.0)
        metrics.record_stage("retrieve", 55.0)
        metrics.record_stage("chat_completion", 1200.0)
        data = metrics.get_metrics()
        assert data["stages"]["retrieve"]["count"] == 2
        assert data["stages"]["chat_completion"]["count"] == 1
        assert "p95_ms" in data["stages"]["retrieve"]["percentiles"]

    def test_prometheus_text_includes_histograms(self):
        metrics = get_metrics()
        metrics.record_request("/api/v1/query", 200, 150)
        metrics.record_stage("retrieve", 45.0)
        text = metrics.prometheus_text()
        assert "# TYPE http_request_latency_ms histogram" in text
        assert 'http_request_latency_ms_bucket{route="/api/v1/query"' in text
        assert "# TYPE rag_stage_latency_ms histogram" in text
        assert 'rag_stage_latency_ms_bucket{stage="retrieve"' in text

    def test_note_mentions_percentiles(self):
        assert "percentile" in get_metrics().get_metrics()["note"].lower()


class TestTracingShim:
    def test_current_trace_id_none_without_active_span(self):
        # With no span active there is no trace to correlate. True whether or
        # not the otel extra is installed (no-op returns None; real SDK reports
        # an invalid span context), so this stays green in both environments.
        assert current_trace_id() is None

    def test_otel_available_is_boolean(self):
        # Reflects whether the otel extra is importable; must not raise either way.
        assert isinstance(otel_available(), bool)

    def test_span_is_safe_in_both_modes(self):
        with span("rag.retrieve", **{"rag.top_k": 5}) as active:
            active.set("rag.result_count", 3)
            active.set("skip_none", None)
            active.set("coerced", ["a", "b"])  # non-primitive -> coerced to str

    def test_observe_stage_records_latency(self):
        with observe_stage("teststage"):
            pass
        stages = get_metrics().get_metrics()["stages"]
        assert stages["teststage"]["count"] == 1

    def test_observe_stage_records_latency_even_on_error(self):
        with pytest.raises(ValueError):
            with observe_stage("failstage"):
                raise ValueError("boom")
        assert get_metrics().get_metrics()["stages"]["failstage"]["count"] == 1

    def test_record_stage_latency_helper(self):
        record_stage_latency("manual", 12.5)
        assert get_metrics().get_metrics()["stages"]["manual"]["count"] == 1
