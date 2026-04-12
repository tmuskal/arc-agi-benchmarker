"""Atomic JSONL append + completed-set loader for longmemeval runs."""
from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def load_completed(run_dir: Path) -> set[str]:
    """Return the set of question_ids already completed for a run."""
    path = run_dir / "questions_completed.jsonl"
    done: set[str] = set()
    if not path.exists():
        return done
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                qid = row.get("question_id")
                if qid:
                    done.add(str(qid))
            except json.JSONDecodeError:
                continue
    return done


def append_jsonl(path: Path, row: dict[str, Any]) -> None:
    """Append-only JSONL with flush+fsync for crash safety."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def mark_completed(run_dir: Path, question_id: str) -> None:
    append_jsonl(
        run_dir / "questions_completed.jsonl",
        {
            "question_id": question_id,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        },
    )


def append_item_result(run_dir: Path, result: dict[str, Any]) -> None:
    append_jsonl(run_dir / "item-results.jsonl", result)


def write_atomic_json(path: Path, data: dict[str, Any]) -> None:
    """Atomic write: tmpfile in same dir + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def filter_pending(items: Iterable[dict[str, Any]], completed: set[str]) -> list[dict]:
    return [it for it in items if str(it.get("question_id")) not in completed]


if __name__ == "__main__":
    import sys

    if len(sys.argv) >= 2:
        rd = Path(sys.argv[1])
        print(f"completed: {len(load_completed(rd))}")
