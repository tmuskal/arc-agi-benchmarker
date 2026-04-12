# longmemeval-benchmarker

Benchmark your current Claude Code harness+model against [LongMemEval](https://github.com/xiaowu0162/longmemeval) — a long-term memory QA benchmark across sessions.

## What it does

- Drives per-item hypothesis generation using your current Claude model (or OpenAI fallback).
- Scores hypotheses with an LLM-as-judge (Claude `claude-opus-4-6` by default; falls back to OpenAI `gpt-4o`).
- Resumes from checkpoints (`questions_completed.jsonl`).
- Records per-run metadata, per-item results, and a scorecard under `.longmemeval-benchmarks/`.
- Supports cross-harness comparison: emit an instruction pack for Codex/Gemini/OpenCode and ingest their results.

## Quickstart

1. Run `/longmemeval-setup` — walks you through conda env + upstream clone + dataset download.
2. Run `/longmemeval-browse-tests` to preview a few items.
3. Run `/longmemeval-run-benchmark` — executes up to 500 items on `longmemeval_s.json` by default.
4. Run `/longmemeval-report` to print per-type accuracy and the overall scorecard.
5. Optionally `/longmemeval-compare-runs <runIdA> <runIdB>` or `/longmemeval-cross-harness`.

## Requirements

- Python 3.9 (conda recommended by upstream).
- `ANTHROPIC_API_KEY` for the default judge + target.
- `OPENAI_API_KEY` optional — only needed if you explicitly choose the OpenAI fallback.
- HuggingFace access for `xiaowu0162/longmemeval-cleaned`.

## Layout

Runtime artifacts:

```
.longmemeval-benchmarks/
  config.json
  runs/<runId>/
    run-meta.json
    item-results.jsonl
    questions_completed.jsonl
    scorecard.json
```

See `SPEC.md` for schemas and architecture.

## License

MIT. LongMemEval itself is also MIT (https://github.com/xiaowu0162/longmemeval).
