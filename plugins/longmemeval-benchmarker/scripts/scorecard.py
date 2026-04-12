"""Compute scorecard.json from item-results.jsonl."""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from checkpoint_io import write_atomic_json

QUESTION_TYPES = [
    "single-session-user",
    "single-session-assistant",
    "multi-session",
    "temporal-reasoning",
    "knowledge-update",
    "preference",
    "abstention",
]


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def compute(run_dir: Path, n_total: int, dataset_variant: str, run_id: str) -> dict[str, Any]:
    rows = _read_jsonl(run_dir / "item-results.jsonl")
    per_type_correct: dict[str, int] = defaultdict(int)
    per_type_total: dict[str, int] = defaultdict(int)
    overall_correct = 0

    for r in rows:
        qt = r.get("question_type", "unknown")
        label = bool((r.get("judgment") or {}).get("label"))
        per_type_total[qt] += 1
        if label:
            per_type_correct[qt] += 1
            overall_correct += 1

    per_type_accuracy: dict[str, float | None] = {}
    for qt in QUESTION_TYPES:
        total = per_type_total.get(qt, 0)
        per_type_accuracy[qt] = (per_type_correct[qt] / total) if total else None

    n_eval = len(rows)
    overall = (overall_correct / n_eval) if n_eval else 0.0

    return {
        "schemaVersion": "1.0.0",
        "runId": run_id,
        "datasetVariant": dataset_variant,
        "overall_accuracy": overall,
        "per_type_accuracy": per_type_accuracy,
        "turn_recall": None,
        "session_recall": None,
        "retrieval_recall_at_k": None,
        "n_evaluated": n_eval,
        "n_total": n_total,
    }


def main() -> None:
    if len(sys.argv) < 5:
        print("usage: scorecard.py <run_dir> <n_total> <dataset_variant> <run_id>")
        sys.exit(1)
    run_dir = Path(sys.argv[1])
    n_total = int(sys.argv[2])
    variant = sys.argv[3]
    run_id = sys.argv[4]
    card = compute(run_dir, n_total, variant, run_id)
    write_atomic_json(run_dir / "scorecard.json", card)
    print(json.dumps(card, indent=2))


if __name__ == "__main__":
    main()
