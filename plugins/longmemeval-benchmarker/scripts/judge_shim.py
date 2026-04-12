"""LLM-as-judge shim. Anthropic default, OpenAI fallback.

Uses upstream `get_anscheck_prompt` from longmemeval/src/evaluation/evaluate_qa.py.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import backoff


def _load_get_anscheck_prompt(longmemeval_root: Path):
    sys.path.insert(0, str(longmemeval_root / "src" / "evaluation"))
    from evaluate_qa import get_anscheck_prompt  # type: ignore
    return get_anscheck_prompt


@backoff.on_exception(backoff.expo, Exception, max_tries=6, jitter=backoff.full_jitter)
def _call_anthropic(model: str, prompt: str) -> str:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=16,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = getattr(msg, "content", []) or []
    for p in parts:
        text = getattr(p, "text", None)
        if text:
            return text.strip()
    return ""


@backoff.on_exception(backoff.expo, Exception, max_tries=6, jitter=backoff.full_jitter)
def _call_openai(model: str, prompt: str) -> str:
    import openai

    client = openai.OpenAI()
    resp = client.chat.completions.create(
        model=model,
        max_tokens=16,
        messages=[{"role": "user", "content": prompt}],
    )
    return (resp.choices[0].message.content or "").strip()


def judge(
    question_type: str,
    question: str,
    answer: str,
    hypothesis: str,
    longmemeval_root: Path,
    provider: str = "anthropic",
    model: str | None = None,
) -> dict[str, Any]:
    """Return {model, label: bool, raw: str}. Falls back to OpenAI if needed."""
    get_anscheck_prompt = _load_get_anscheck_prompt(longmemeval_root)
    prompt = get_anscheck_prompt(question_type, question, answer, hypothesis)

    chosen_provider = provider
    chosen_model = model

    if chosen_provider == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
        chosen_provider = "openai"
    if chosen_provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
        # Only raise if neither works
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("No ANTHROPIC_API_KEY or OPENAI_API_KEY set")
        chosen_provider = "anthropic"

    if chosen_provider == "anthropic":
        chosen_model = chosen_model or "claude-opus-4-6"
        try:
            raw = _call_anthropic(chosen_model, prompt)
        except Exception as e:
            if os.environ.get("OPENAI_API_KEY"):
                chosen_provider = "openai"
                chosen_model = "gpt-4o"
                raw = _call_openai(chosen_model, prompt)
            else:
                raise e
    else:
        chosen_model = chosen_model or "gpt-4o"
        raw = _call_openai(chosen_model, prompt)

    label = raw.strip().lower().startswith("yes")
    return {"model": chosen_model, "provider": chosen_provider, "label": bool(label), "raw": raw}


if __name__ == "__main__":
    # Smoke test: python judge_shim.py <longmemeval_root>
    if len(sys.argv) < 2:
        print("usage: judge_shim.py <longmemeval_root>")
        sys.exit(1)
    root = Path(sys.argv[1])
    out = judge(
        "single-session-user",
        "What color is the sky?",
        "blue",
        "The sky is blue.",
        root,
    )
    print(out)
