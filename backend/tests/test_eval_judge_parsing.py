"""Unit tests for the LLM-judge JSON extractor in eval/run_eval.py.

These lock in the fix for the brittle ``\\{[^}]+\\}`` regex, which truncated at the
first ``}`` — so any verdict whose ``reasoning`` contained a brace parsed wrong.
"""

from eval.run_eval import _extract_json_object


def test_pure_json_object():
    out = _extract_json_object('{"correctness": true, "faithfulness": false, "reasoning": "ok"}')
    assert out == {"correctness": True, "faithfulness": False, "reasoning": "ok"}


def test_json_wrapped_in_markdown_fence():
    content = '```json\n{"correctness": true, "faithfulness": true, "reasoning": "grounded"}\n```'
    out = _extract_json_object(content)
    assert out is not None
    assert out["correctness"] is True
    assert out["faithfulness"] is True


def test_json_with_surrounding_prose():
    content = (
        'Here is my verdict:\n{"correctness": false, "faithfulness": true, "reasoning": "x"}\nDone.'
    )
    out = _extract_json_object(content)
    assert out is not None
    assert out["correctness"] is False


def test_brace_inside_reasoning_string():
    # The exact shape the old regex mangled: a `}` inside the reasoning value.
    content = '{"correctness": true, "faithfulness": false, "reasoning": "uses a set like {a, b}"}'
    out = _extract_json_object(content)
    assert out is not None
    assert out["correctness"] is True
    assert out["reasoning"] == "uses a set like {a, b}"


def test_escaped_quote_inside_string():
    content = (
        '{"correctness": true, "faithfulness": true, "reasoning": "the answer says \\"RAG\\""}'
    )
    out = _extract_json_object(content)
    assert out is not None
    assert out["reasoning"] == 'the answer says "RAG"'


def test_no_json_returns_none():
    assert _extract_json_object("I could not decide.") is None


def test_empty_and_none_return_none():
    assert _extract_json_object("") is None
    assert _extract_json_object(None) is None


def test_non_object_json_returns_none():
    # A bare array/number is valid JSON but not a verdict object.
    assert _extract_json_object("[1, 2, 3]") is None
