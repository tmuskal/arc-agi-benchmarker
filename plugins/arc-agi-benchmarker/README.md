# ARC-AGI Benchmarker

A Claude Code plugin that benchmarks your Claude Code setup -- including all installed plugins, skills, hooks, and MCP servers -- against ARC-AGI-3 interactive tasks.

## Overview

The ARC-AGI Benchmarker lets you:

- Run ARC-AGI game benchmarks with Claude Code as the game-playing agent
- Browse available test environments and their metadata
- Generate detailed scoring reports with per-game and per-level breakdowns
- Compare benchmark runs to track improvements and regressions
- Generate cross-harness instructions for Codex, Gemini CLI, and OpenCode, then import and compare their results

The plugin operates in **OFFLINE mode** by default, using local environment files with no API key required. All rendering uses `render_mode=None` (no terminal-fast).

## Requirements

- **Python >= 3.12** (install from python.org or via your system package manager)
- **pip** or **uv** package manager
- **Claude Code CLI**
- The `arc-agi` Python package (installed automatically by `/arc-agi-benchmarker:setup`)

## Quick Start

```
1. /arc-agi-benchmarker:setup                    # Install dependencies, create venv, validate
2. /arc-agi-benchmarker:run-benchmark            # Run a benchmark (you are the game-playing agent)
3. /arc-agi-benchmarker:report latest            # View your benchmark report
```

That is the core workflow. From there you can browse tests, compare runs, or set up cross-harness benchmarks:

```
4. /arc-agi-benchmarker:browse-tests                   # Explore available games and metadata
5. /arc-agi-benchmarker:compare-runs <RUN_A> <RUN_B>  # Compare two runs side by side
6. /arc-agi-benchmarker:cross-harness generate codex  # Generate instructions for Codex
```

## Available Skills

| Command | Skill | Description |
|---------|-------|-------------|
| `/arc-agi-benchmarker:setup` | setup | Install dependencies, configure environment, validate readiness |
| `/arc-agi-benchmarker:run-benchmark` | run-benchmark | Execute benchmark runs against ARC-AGI games |
| `/arc-agi-benchmarker:browse-tests` | browse-tests | Explore available environments, metadata, and game details |
| `/arc-agi-benchmarker:report` | report | Generate and display reports from completed runs |
| `/arc-agi-benchmarker:compare-runs` | compare-runs | Compare two or more benchmark runs |
| `/arc-agi-benchmarker:cross-harness` | cross-harness | Generate cross-harness instructions, import results, compare across harnesses |

### Skill Details and Example Invocations

**setup** (`/arc-agi-benchmarker:setup`)
Sets up the benchmarking environment: checks Python version, creates a `.arc-agi-venv` virtual environment, installs the `arc-agi` package, writes `.arc-agi-benchmarks/config.json`, and validates everything works.

```
/arc-agi-benchmarker:setup
```

**run-benchmark** (`/arc-agi-benchmarker:run-benchmark`)
Runs a benchmark session. Claude Code becomes the game-playing agent -- observing grids, reasoning about patterns, choosing actions, and submitting solutions. Fewer actions yield higher scores. After completing the benchmark, it automatically invokes `/arc-agi-benchmarker:report`.

```
/arc-agi-benchmarker:run-benchmark
/arc-agi-benchmarker:run-benchmark bt11 --seed 42
/arc-agi-benchmarker:run-benchmark bt11 bt12 bt13
```

**browse-tests** (`/arc-agi-benchmarker:browse-tests`)
Explores available ARC-AGI environments. Lists games, shows details with ASCII grid visualization of training examples, and displays historical scores from both standard runs and cross-harness runs.

```
/arc-agi-benchmarker:browse-tests
/arc-agi-benchmarker:browse-tests bt11
/arc-agi-benchmarker:browse-tests --filter bt
/arc-agi-benchmarker:browse-tests --tag training
```

**report** (`/arc-agi-benchmarker:report`)
Generates a formatted markdown report from a completed benchmark run. Shows overall score, per-game breakdowns, per-level action counts, and performance analysis.

```
/arc-agi-benchmarker:report latest
/arc-agi-benchmarker:report <RUN_ID>
```

**compare-runs** (`/arc-agi-benchmarker:compare-runs`)
Compares two or more benchmark runs side by side. Shows score deltas, identifies improvements and regressions, diffs configurations, and saves a structured comparison. Supports runs from both standard and cross-harness directories.

```
/arc-agi-benchmarker:compare-runs <RUN_A> <RUN_B>
/arc-agi-benchmarker:compare-runs <RUN_A> <RUN_B> <RUN_C>
```

**cross-harness** (`/arc-agi-benchmarker:cross-harness`)
Manages cross-harness benchmarking with three sub-commands:

```
/arc-agi-benchmarker:cross-harness generate codex           # Generate instructions for Codex
/arc-agi-benchmarker:cross-harness generate gemini --ref <RUN_ID>  # Use a specific run as reference
/arc-agi-benchmarker:cross-harness import codex ./results.json     # Import results from Codex
/arc-agi-benchmarker:cross-harness compare --all                   # Compare all cross-harness runs
```

## Cross-Harness Workflow

The cross-harness feature lets you benchmark the same ARC-AGI tasks across different AI CLI tools and compare their performance.

**Supported harnesses:** `codex`, `gemini`, `opencode`

**Workflow:**

1. **Generate** -- Create instruction documents and helper scripts for the target harness:
   ```
   /arc-agi-benchmarker:cross-harness generate codex
   ```
   This produces a markdown instruction file and any needed helper scripts in `.arc-agi-benchmarks/cross-harness/<harness>/`.

2. **Run externally** -- Execute the generated instructions in the target harness (Codex, Gemini CLI, or OpenCode). The instructions guide the external harness through the same games.

3. **Import** -- Bring the results back into the benchmarker:
   ```
   /arc-agi-benchmarker:cross-harness import codex ./path/to/results.json
   ```
   Results are normalized into the standard scorecard format and stored in `.arc-agi-benchmarks/cross-harness/<harness>/runs/`.

4. **Compare** -- Compare performance across harnesses:
   ```
   /arc-agi-benchmarker:cross-harness compare --all
   ```
   This delegates to the `compare-runs` skill to show score deltas across harnesses.

## Scoring Model

Scores measure how efficiently you complete each level relative to a baseline action count.

- **Level score**: `min((baseline_actions / actions_taken)^2, 1.0)` -- returns 0 if the level is not completed
- **Game score**: Weighted average of level scores, where level N has weight N (1-indexed). This means later, harder levels contribute more to the game score.
- **Environment score**: Best score across all runs of that environment
- **Overall score**: Average across all environment scores

Scores are stored internally on a 0.0-1.0 scale in `scorecard.json`. Display values are multiplied by 100 (shown as 0-100).

## Data Storage

All benchmark data is stored in `.arc-agi-benchmarks/` in your project root:

```
.arc-agi-benchmarks/
  config.json                              # Plugin configuration
  runs/
    <run-id>/
      scorecard.json                       # Scores on 0-1 scale
      run-meta.json                        # Timestamps, config snapshot
      environment-scores.json              # Per-environment scores on 0-100 scale
      session_<game-id>.json               # Per-game session state
      recordings/                          # JSONL recordings (under scorecard_id)
        <scorecard-id>/
          <game>.<agent>.<max>.<guid>.recording.jsonl
      report.md                            # Generated report
  comparisons/                             # Saved comparison results
  cross-harness/
    <harness>/                             # e.g., codex, gemini, opencode
      runs/
        <run-id>/
          scorecard.json
          environment-scores.json          # Scores on 0-100 scale
```

## Configuration

The setup skill creates `.arc-agi-benchmarks/config.json` with defaults. Key fields:

- `operation_mode`: Always `"offline"` (no API key needed)
- `render_mode`: Always `null` (no terminal-fast rendering)
- `default_seed`: Random seed for reproducible runs

## License

MIT
