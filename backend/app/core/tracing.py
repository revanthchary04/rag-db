"""Optional OpenTelemetry tracing for the RAG pipeline.

A RAG request is a multi-stage pipeline (embed query -> vector search ->
optional rerank -> prompt assembly -> LLM generation). The HTTP-level span
created by ``FastAPIInstrumentor`` only shows the total request time; these
helpers add one span per pipeline stage so a trace waterfall shows *where*
latency and cost actually go.

Spans are emitted only when OpenTelemetry is installed (``uv sync --extra
otel``) and a tracer provider is configured (see ``app.main``). When OTel is
absent the helpers degrade to zero-cost no-ops, so pipeline code can call them
unconditionally without importing OpenTelemetry itself.

``observe_stage`` additionally records the stage latency into the in-process
metrics histogram, so per-stage p95 is available from ``/metrics`` even when no
trace backend (Jaeger/Tempo) is wired up.
"""

from __future__ import annotations

import contextlib
import time
from collections.abc import Iterator
from typing import Any

try:  # pragma: no cover - import guard exercised by the otel extra
    from opentelemetry import trace as _otel_trace

    _OTEL_AVAILABLE = True
except ImportError:  # otel extra not installed -> no-op mode
    _otel_trace = None
    _OTEL_AVAILABLE = False

_TRACER_NAME = "rag-eval.pipeline"


def otel_available() -> bool:
    """True when the OpenTelemetry API is importable (otel extra installed)."""
    return _OTEL_AVAILABLE


class _Span:
    """Thin wrapper that safely sets attributes on a span (or does nothing).

    Holds a real OpenTelemetry span, or ``None`` in no-op mode. Attribute values
    that are ``None`` are skipped, and non-primitive values are coerced to ``str``
    so callers never have to guard the OTel attribute-type rules.
    """

    __slots__ = ("_span",)

    def __init__(self, span: Any = None) -> None:
        self._span = span

    def set(self, key: str, value: Any) -> None:
        if self._span is None or value is None:
            return
        if not isinstance(value, (str, bool, int, float)):
            value = str(value)
        try:
            self._span.set_attribute(key, value)
        except Exception:
            # Instrumentation must never break the request path.
            pass


@contextlib.contextmanager
def span(name: str, **attributes: Any) -> Iterator[_Span]:
    """Start a span named ``name`` as a child of the current span.

    Yields a :class:`_Span` for setting further attributes. Records the
    exception and marks the span status ERROR if the body raises. No-op (yields
    an empty ``_Span``) when OpenTelemetry is not installed.
    """
    if not _OTEL_AVAILABLE:
        yield _Span(None)
        return

    tracer = _otel_trace.get_tracer(_TRACER_NAME)
    with tracer.start_as_current_span(name) as otel_span:
        wrapper = _Span(otel_span)
        for key, value in attributes.items():
            wrapper.set(key, value)
        try:
            yield wrapper
        except Exception as exc:
            from opentelemetry.trace import Status, StatusCode

            otel_span.record_exception(exc)
            otel_span.set_status(Status(StatusCode.ERROR, str(exc)))
            raise


@contextlib.contextmanager
def observe_stage(
    stage: str, *, span_name: str | None = None, **attributes: Any
) -> Iterator[_Span]:
    """Trace and time a RAG pipeline stage.

    Opens a span (``span_name`` or ``rag.<stage>``) and, on exit, records the
    elapsed wall-clock time into the in-process stage-latency histogram under
    the label ``stage``. Latency is recorded even when the body raises.
    """
    start = time.perf_counter()
    with span(span_name or f"rag.{stage}", **attributes) as active_span:
        try:
            yield active_span
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            record_stage_latency(stage, elapsed_ms)


def record_stage_latency(stage: str, latency_ms: float) -> None:
    try:
        from app.core.metrics import get_metrics

        get_metrics().record_stage(stage, latency_ms)
    except Exception:
        # Metrics recording must never break the request path.
        pass


def current_trace_id() -> str | None:
    """Return the active trace id as 32-hex, or ``None`` if no valid trace.

    Used to stamp ``trace_id`` onto structured logs so logs, traces, and query
    audit rows can all be correlated.
    """
    if not _OTEL_AVAILABLE:
        return None
    ctx = _otel_trace.get_current_span().get_span_context()
    if not ctx or not ctx.is_valid:
        return None
    return format(ctx.trace_id, "032x")
