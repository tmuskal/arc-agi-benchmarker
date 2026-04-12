"""Per-item hypothesis generation. Uses the full-history-session layout:
the entire haystack_sessions transcript is prepended as context.
"""
from __future__ import annotations

import os
import time
from typing import Any

import backoff

SYSTEM = (
    "You are a helpful assistant. You will be given a long, chronological "
    "log of prior chat sessions between a user and an assistant, then a new "
    "question from the user. Answer the question as accurately as possible "
    "using only what is stated in the history. If the answer cannot be "
    "determined, say you don't know."
)


def _format_history(item: dict[str, Any]) -> str:
    sessions = item.get("haystack_sessions") or []
    dates = item.get("haystack_dates") or [None] * len(sessions)
    lines: list[str] = []
    for idx, (sess, dt) in enumerate(zip(sessions, dates)):
        lines.append(f"\n===== Session {idx + 1} ({dt or 'unknown date'}) =====")
        for turn in sess or []:
            role = turn.get("role", "user")
            content = turn.get("content", "")
            lines.append(f"[{role}] {content}")
    return "\n".join(lines)


def build_prompt(item: dict[str, Any]) -> str:
    history = _format_history(item)
    q = item.get("question", "")
    return f"{history}\n\n===== Question =====\n{q}\n\nAnswer:"


@backoff.on_exception(backoff.expo, Exception, max_tries=6, jitter=backoff.full_jitter)
def _gen_anthropic(model: str, prompt: str, max_tokens: int = 512) -> tuple[str, int, int]:
    import anthropic

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    parts = getattr(msg, "content", []) or []
    text = ""
    for p in parts:
        t = getattr(p, "text", None)
        if t:
            text += t
    usage = getattr(msg, "usage", None)
    tin = getattr(usage, "input_tokens", 0) if usage else 0
    tout = getattr(usage, "output_tokens", 0) if usage else 0
    return text.strip(), tin, tout


@backoff.on_exception(backoff.expo, Exception, max_tries=6, jitter=backoff.full_jitter)
def _gen_openai(model: str, prompt: str, max_tokens: int = 512) -> tuple[str, int, int]:
    import openai

    client = openai.OpenAI()
    resp = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
    )
    text = (resp.choices[0].message.content or "").strip()
    usage = getattr(resp, "usage", None)
    tin = getattr(usage, "prompt_tokens", 0) if usage else 0
    tout = getattr(usage, "completion_tokens", 0) if usage else 0
    return text, tin, tout


def generate_hypothesis(
    item: dict[str, Any],
    provider: str = "anthropic",
    model: str | None = None,
) -> dict[str, Any]:
    """Returns {hypothesis, latencyMs, tokensIn, tokensOut, model, provider}."""
    prompt = build_prompt(item)

    if provider == "anthropic" and not os.environ.get("ANTHROPIC_API_KEY"):
        provider = "openai"
    if provider == "openai" and not os.environ.get("OPENAI_API_KEY"):
        if os.environ.get("ANTHROPIC_API_KEY"):
            provider = "anthropic"
        else:
            raise RuntimeError("No ANTHROPIC_API_KEY or OPENAI_API_KEY set")

    if provider == "anthropic":
        model = model or "claude-opus-4-6"
        fn = _gen_anthropic
    else:
        model = model or "gpt-4o"
        fn = _gen_openai

    t0 = time.time()
    hypothesis, tin, tout = fn(model, prompt)
    latency = int((time.time() - t0) * 1000)
    return {
        "hypothesis": hypothesis,
        "latencyMs": latency,
        "tokensIn": tin,
        "tokensOut": tout,
        "model": model,
        "provider": provider,
    }
