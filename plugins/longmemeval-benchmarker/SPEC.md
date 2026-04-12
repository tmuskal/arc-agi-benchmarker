# longmemeval-benchmarker — SPEC

## Architecture

```
 user
  |
  v
 skills (setup | run-benchmark | judge | browse-tests | report | compare-runs | cross-harness | resume)
  |
  v
 scripts/
   generation_driver.py   — per-item hypothesis generation via Anthropic (default) or OpenAI
   judge_shim.py          — wraps upstream get_anscheck_prompt; calls Anthropic (default) or OpenAI
   checkpoint_io.py       — atomic jsonl append + completed-set loader
   scorecard.py           — computes overall + per-question_type accuracy
  |
  v
 upstream longmemeval (cloned separately; src/evaluation/evaluate_qa.py:21-47 get_anscheck_prompt)
```

The plugin does NOT modify upstream. It imports `get_anscheck_prompt` from
`longmemeval/src/evaluation/evaluate_qa.py` at runtime by adding that path to
`sys.path`.

## Dataset variants

| Variant | Purpose | Default? |
|---|---|---|
| `longmemeval_s.json` | ~115k tokens / item, ~40 sessions | YES |
| `longmemeval_m.json` | ~500 sessions / item (retrieval) | no |
| `longmemeval_oracle.json` | evidence-only, small | no |

## Runtime layout

```
.longmemeval-benchmarks/
  config.json                       # persistent plugin config
  runs/<runId>/
    run-meta.json                   # written atomically on start + finish
    item-results.jsonl              # append-only, one row per judged item
    questions_completed.jsonl       # append-only checkpoint (question_id only)
    scorecard.json                  # written atomically by /longmemeval-report
```

## Schemas

### `run-meta.json` v1.0.0

```json
{
  "schemaVersion": "1.0.0",
  "runId": "uuid4",
  "harness": "claude-code",
  "timestamp": "ISO-8601",
  "duration_seconds": 0,
  "datasetVariant": "longmemeval_s",
  "datasetPath": "longmemeval/data/longmemeval_s.json",
  "maxEvals": 500,
  "seed": 0,
  "targetModel": "claude-opus-4-6",
  "judgeModel": "claude-opus-4-6",
  "judgeProvider": "anthropic",
  "harness_config": {
    "model": "claude-opus-4-6",
    "plugins": [],
    "skills": [],
    "mcp_servers": []
  },
  "status": "running|completed|failed",
  "plugin_version": "1.0.0"
}
```

### `item-results.jsonl` v1.0.0

One JSON object per line:

```json
{
  "schemaVersion": "1.0.0",
  "question_id": "string",
  "question_type": "single-session-user|single-session-assistant|multi-session|temporal-reasoning|knowledge-update|preference|abstention",
  "question": "string",
  "answer": "string",
  "hypothesis": "string",
  "judgment": {"model": "claude-opus-4-6", "label": true, "raw": "yes"},
  "latencyMs": 0,
  "tokensIn": 0,
  "tokensOut": 0
}
```

### `questions_completed.jsonl`

```json
{"question_id": "abc123", "completed_at": "ISO-8601"}
```

### `scorecard.json` v1.0.0

```json
{
  "schemaVersion": "1.0.0",
  "runId": "uuid4",
  "datasetVariant": "longmemeval_s",
  "overall_accuracy": 0.0,
  "per_type_accuracy": {
    "single-session-user": 0.0,
    "single-session-assistant": 0.0,
    "multi-session": 0.0,
    "temporal-reasoning": 0.0,
    "knowledge-update": 0.0,
    "preference": 0.0,
    "abstention": 0.0
  },
  "turn_recall": null,
  "session_recall": null,
  "retrieval_recall_at_k": null,
  "n_evaluated": 0,
  "n_total": 0
}
```

`turn_recall`, `session_recall`, and `retrieval_recall_at_k` are `null` for
`longmemeval_s` / `_oracle` (no retrieval stage). They are populated only
when `datasetVariant == longmemeval_m` and upstream retrieval was run.

## Atomicity

- Every jsonl file is append-only; one row == one `flush()+fsync()`.
- `run-meta.json` and `scorecard.json` are written via tmpfile + `os.replace`.

## Judge model fallback

1. If `ANTHROPIC_API_KEY` is set AND `judgeProvider == "anthropic"`, use `anthropic.Anthropic().messages.create(model="claude-opus-4-6", ...)`.
2. Otherwise fall back to `openai.OpenAI().chat.completions.create(model="gpt-4o", ...)`.
3. Both paths wrapped with `backoff.on_exception(backoff.expo, Exception, max_tries=6)`.

## Target model fallback

Same as judge, but the default target is set to the harness's current Claude
model (from `config.harness_config.model`), falling back to `claude-opus-4-6`.

## Resume semantics

- On benchmark start: load `questions_completed.jsonl` into a set `completed`.
- Filter the dataset: `items = [i for i in items if i["question_id"] not in completed]`.
- Cap at `maxEvals`.
- After each successful judgment: append to `questions_completed.jsonl` then `item-results.jsonl`.
