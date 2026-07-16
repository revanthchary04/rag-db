import time
from collections import defaultdict
from dataclasses import dataclass, field

import structlog

logger = structlog.get_logger()

# Cumulative latency histogram bucket upper bounds, in milliseconds. Chosen to
# straddle a RAG request: fast DB-only paths (<50ms), retrieval (100-500ms),
# and LLM generation (1s-10s). The implicit +Inf bucket captures the tail.
LATENCY_BUCKET_BOUNDS_MS: tuple[float, ...] = (
    5,
    10,
    25,
    50,
    100,
    250,
    500,
    1000,
    2500,
    5000,
    10000,
)


class LatencyHistogram:
    """Fixed-bucket latency histogram with quantile estimation.

    Records observations into cumulative buckets so we can (a) emit real
    Prometheus histogram series (``_bucket``/``_sum``/``_count``) that
    ``histogram_quantile()`` understands, and (b) estimate p50/p95/p99
    in-process for the JSON API and the dashboard. Percentiles use the same
    linear-interpolation-within-bucket approach as Prometheus, so the numbers
    agree with what Grafana computes from the scraped series.
    """

    __slots__ = ("bounds", "bucket_counts", "count", "sum_ms")

    def __init__(self, bounds: tuple[float, ...] = LATENCY_BUCKET_BOUNDS_MS) -> None:
        self.bounds = bounds
        # One slot per finite bound, plus a trailing +Inf overflow slot.
        self.bucket_counts: list[int] = [0] * (len(bounds) + 1)
        self.count: int = 0
        self.sum_ms: float = 0.0

    def observe(self, latency_ms: float) -> None:
        self.count += 1
        self.sum_ms += latency_ms
        for i, bound in enumerate(self.bounds):
            if latency_ms <= bound:
                self.bucket_counts[i] += 1
                return
        self.bucket_counts[-1] += 1  # +Inf

    @property
    def avg_ms(self) -> float:
        return self.sum_ms / self.count if self.count else 0.0

    def quantile(self, q: float) -> float:
        """Estimate the q-th quantile (0..1) in milliseconds.

        Linear interpolation within the matching bucket, matching Prometheus
        ``histogram_quantile`` semantics. Observations in the +Inf bucket are
        reported at the largest finite bound (we cannot interpolate to infinity).
        """
        if self.count == 0:
            return 0.0
        rank = q * self.count
        cumulative = 0.0
        for i, bound in enumerate(self.bounds):
            bucket_count = self.bucket_counts[i]
            if cumulative + bucket_count >= rank:
                lower = self.bounds[i - 1] if i > 0 else 0.0
                if bucket_count == 0:
                    return round(bound, 2)
                fraction = (rank - cumulative) / bucket_count
                return round(lower + (bound - lower) * fraction, 2)
            cumulative += bucket_count
        # Fell into the +Inf bucket: report the largest finite bound.
        return round(self.bounds[-1], 2)

    def percentiles(self) -> dict[str, float]:
        return {
            "p50_ms": self.quantile(0.50),
            "p95_ms": self.quantile(0.95),
            "p99_ms": self.quantile(0.99),
        }

    def prometheus_lines(self, metric: str, label_pairs: str = "") -> list[str]:
        """Render this histogram as Prometheus ``_bucket``/``_sum``/``_count`` series.

        ``label_pairs`` is the already-escaped inner label set without braces
        (e.g. ``route="/api/v1/query"``); the ``le`` label is appended per bucket.
        """
        prefix = f"{label_pairs}," if label_pairs else ""
        lines: list[str] = []
        cumulative = 0
        for i, bound in enumerate(self.bounds):
            cumulative += self.bucket_counts[i]
            lines.append(f'{metric}_bucket{{{prefix}le="{bound}"}} {cumulative}')
        cumulative += self.bucket_counts[-1]
        lines.append(f'{metric}_bucket{{{prefix}le="+Inf"}} {cumulative}')
        brace = f"{{{label_pairs}}}" if label_pairs else ""
        lines.append(f"{metric}_sum{brace} {self.sum_ms}")
        lines.append(f"{metric}_count{brace} {cumulative}")
        return lines


@dataclass
class RouteMetrics:
    """Metrics for a specific route."""

    route: str
    request_count: int = 0
    status_counts: dict[int, int] = field(default_factory=lambda: defaultdict(int))
    latency_buckets: dict[str, int] = field(
        default_factory=lambda: {
            "<100ms": 0,
            "100-500ms": 0,
            "500ms-1s": 0,
            "1s-5s": 0,
            ">5s": 0,
        }
    )
    total_latency_ms: int = 0
    histogram: LatencyHistogram = field(default_factory=LatencyHistogram)

    def record_request(self, status_code: int, latency_ms: int) -> None:
        """Record a request."""
        self.request_count += 1
        self.status_counts[status_code] += 1
        self.total_latency_ms += latency_ms
        self.histogram.observe(latency_ms)

        # Coarse human-readable buckets (kept for the existing dashboard card).
        if latency_ms < 100:
            self.latency_buckets["<100ms"] += 1
        elif latency_ms < 500:
            self.latency_buckets["100-500ms"] += 1
        elif latency_ms < 1000:
            self.latency_buckets["500ms-1s"] += 1
        elif latency_ms < 5000:
            self.latency_buckets["1s-5s"] += 1
        else:
            self.latency_buckets[">5s"] += 1

    def get_avg_latency_ms(self) -> float:
        """Get average latency in milliseconds."""
        if self.request_count == 0:
            return 0.0
        return self.total_latency_ms / self.request_count


def _escape_label(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


class MetricsCollector:
    """In-memory metrics collector."""

    def __init__(self):
        """Initialize metrics collector."""
        self.route_metrics: dict[str, RouteMetrics] = {}
        # Per-stage latency histograms for the RAG pipeline (retrieve, embedding,
        # db.vector_search, chat_completion, generate, ...). Populated by
        # app.core.tracing.observe_stage so per-stage p95 is available even
        # without a trace backend.
        self.stage_metrics: dict[str, LatencyHistogram] = {}
        self.token_usage: dict[str, int] = {
            "embedding_prompt_tokens": 0,
            "embedding_total_tokens": 0,
            "chat_prompt_tokens": 0,
            "chat_completion_tokens": 0,
            "chat_total_tokens": 0,
        }
        self.start_time = time.time()

    def record_request(self, route: str, status_code: int, latency_ms: int) -> None:
        """
        Record an HTTP request.

        Args:
            route: API route path
            status_code: HTTP status code
            latency_ms: Request latency in milliseconds
        """
        if route not in self.route_metrics:
            self.route_metrics[route] = RouteMetrics(route=route)

        self.route_metrics[route].record_request(status_code, latency_ms)

    def record_stage(self, stage: str, latency_ms: float) -> None:
        """Record latency for a RAG pipeline stage (e.g. ``retrieve``, ``chat_completion``)."""
        hist = self.stage_metrics.get(stage)
        if hist is None:
            hist = LatencyHistogram()
            self.stage_metrics[stage] = hist
        hist.observe(latency_ms)

    def record_embedding_tokens(self, prompt_tokens: int, total_tokens: int) -> None:
        """
        Record embedding token usage.

        Args:
            prompt_tokens: Prompt tokens used
            total_tokens: Total tokens used
        """
        self.token_usage["embedding_prompt_tokens"] += prompt_tokens
        self.token_usage["embedding_total_tokens"] += total_tokens

    def record_chat_tokens(
        self, prompt_tokens: int, completion_tokens: int, total_tokens: int
    ) -> None:
        """
        Record chat completion token usage.

        Args:
            prompt_tokens: Prompt tokens used
            completion_tokens: Completion tokens used
            total_tokens: Total tokens used
        """
        self.token_usage["chat_prompt_tokens"] += prompt_tokens
        self.token_usage["chat_completion_tokens"] += completion_tokens
        self.token_usage["chat_total_tokens"] += total_tokens

    def get_metrics(self) -> dict:
        """
        Get all metrics as a dictionary.

        Returns:
            Dictionary with all metrics
        """
        routes = {}
        for route, metrics in self.route_metrics.items():
            routes[route] = {
                "request_count": metrics.request_count,
                "status_counts": dict(metrics.status_counts),
                "latency_buckets": dict(metrics.latency_buckets),
                "avg_latency_ms": round(metrics.get_avg_latency_ms(), 2),
                "total_latency_ms": metrics.total_latency_ms,
                "percentiles": metrics.histogram.percentiles(),
            }

        stages = {}
        for stage, hist in self.stage_metrics.items():
            stages[stage] = {
                "count": hist.count,
                "avg_latency_ms": round(hist.avg_ms, 2),
                "percentiles": hist.percentiles(),
            }

        uptime_seconds = int(time.time() - self.start_time)

        return {
            "uptime_seconds": uptime_seconds,
            "routes": routes,
            "stages": stages,
            "token_usage": dict(self.token_usage),
            "note": (
                "Metrics are in-memory and reset on restart (single instance). "
                "Latency percentiles are estimated from fixed histogram buckets; "
                "scrape /metrics/prometheus for histogram_quantile() in Grafana."
            ),
        }

    def prometheus_text(self) -> str:
        """Prometheus text format for scraping (counters / gauges / histograms, in-memory)."""
        lines: list[str] = []
        uptime = int(time.time() - self.start_time)
        lines.append("# HELP app_uptime_seconds Process uptime in seconds")
        lines.append("# TYPE app_uptime_seconds gauge")
        lines.append(f"app_uptime_seconds {uptime}")
        lines.append("# HELP http_requests_total Total HTTP requests by route and status")
        lines.append("# TYPE http_requests_total counter")
        for route, metrics in self.route_metrics.items():
            for status_code, count in metrics.status_counts.items():
                safe_route = _escape_label(route)
                lines.append(
                    f'http_requests_total{{route="{safe_route}",status="{status_code}"}} {count}'
                )
        lines.append("# HELP http_request_duration_ms_sum Sum of request latencies in ms")
        lines.append("# TYPE http_request_duration_ms_sum counter")
        for route, metrics in self.route_metrics.items():
            safe_route = _escape_label(route)
            lines.append(
                f'http_request_duration_ms_sum{{route="{safe_route}"}} {metrics.total_latency_ms}'
            )
        # Real latency histogram per route (enables histogram_quantile in Grafana).
        lines.append("# HELP http_request_latency_ms Request latency histogram in ms")
        lines.append("# TYPE http_request_latency_ms histogram")
        for route, metrics in self.route_metrics.items():
            safe_route = _escape_label(route)
            lines.extend(
                metrics.histogram.prometheus_lines(
                    "http_request_latency_ms", f'route="{safe_route}"'
                )
            )
        # Per-stage RAG pipeline latency histograms.
        if self.stage_metrics:
            lines.append("# HELP rag_stage_latency_ms RAG pipeline stage latency histogram in ms")
            lines.append("# TYPE rag_stage_latency_ms histogram")
            for stage, hist in self.stage_metrics.items():
                safe_stage = _escape_label(stage)
                lines.extend(hist.prometheus_lines("rag_stage_latency_ms", f'stage="{safe_stage}"'))
        for key, val in self.token_usage.items():
            safe_key = key.replace(" ", "_")
            lines.append(f"# HELP openai_tokens_{safe_key} Total OpenAI tokens ({key})")
            lines.append(f"# TYPE openai_tokens_{safe_key} counter")
            lines.append(f"openai_tokens_{safe_key} {val}")
        return "\n".join(lines) + "\n"

    def reset(self) -> None:
        """Reset all metrics (useful for testing)."""
        self.route_metrics.clear()
        self.stage_metrics.clear()
        self.token_usage = {
            "embedding_prompt_tokens": 0,
            "embedding_total_tokens": 0,
            "chat_prompt_tokens": 0,
            "chat_completion_tokens": 0,
            "chat_total_tokens": 0,
        }
        self.start_time = time.time()


# Global metrics instance
_metrics: MetricsCollector | None = None


def get_metrics() -> MetricsCollector:
    """Get or create global metrics collector."""
    global _metrics
    if _metrics is None:
        _metrics = MetricsCollector()
    return _metrics


def reset_metrics() -> None:
    """Reset global metrics (useful for testing)."""
    global _metrics
    if _metrics is not None:
        _metrics.reset()
