# Claude Code Self-Benchmarking Marketplace

A marketplace of Claude Code plugins that benchmark your Claude Code setup -- including all installed plugins, skills, hooks, and MCP servers -- against external benchmarks.

## Plugins in this marketplace

| Plugin | Benchmark | Description |
|--------|-----------|-------------|
| [`arc-agi-benchmarker`](./plugins/arc-agi-benchmarker) | [ARC-AGI-3](https://github.com/arcprize/arc-agi) | Interactive agentic grid-world tasks |
| [`longmemeval-benchmarker`](./plugins/longmemeval-benchmarker) | [LongMemEval](https://github.com/xiaowu0162/longmemeval) | Long-term memory QA over multi-session chat histories (Claude-default judge, OpenAI fallback, resume-from-checkpoint) |

New benchmark plugins are generated via the `/benchmark-adder` skill (see `.claude/skills/benchmark-adder`), which wraps the `benchmark-plugin-creator` babysitter process.

---

# ARC-AGI Self-Benchmarking

A Claude Code plugin that benchmarks your Claude Code setup -- including all installed plugins, skills, hooks, and MCP servers -- against ARC-AGI-3 interactive tasks.

## Installation

### 1. Add the marketplace

From within a Claude Code session:

```
/plugin marketplace add tmuskal/arc-agi-benchmarker
```

Or from the terminal:

```bash
claude plugin marketplace add tmuskal/arc-agi-benchmarker
```

You can also add it from a local clone:

```bash
claude plugin marketplace add ./path/to/arc-agi-self-benchmarking
```

### 2. Install the plugin

```
/plugin install arc-agi-benchmarker@arc-agi-benchmarker
```

Or from the terminal:

```bash
claude plugin install arc-agi-benchmarker@arc-agi-benchmarker
```

To install for a specific scope:

```bash
# User-level (default) - available across all projects
claude plugin install arc-agi-benchmarker@arc-agi-benchmarker --scope user

# Project-level - shared with your team via .claude/settings.json
claude plugin install arc-agi-benchmarker@arc-agi-benchmarker --scope project
```

### 3. Verify installation

In a Claude Code session, run:

```
/arc-setup
```

This installs dependencies (Python venv, `arc-agi` package), validates your environment, and creates the configuration at `.arc-agi-benchmarks/config.json`.

## Quick Start

```
1. /arc-setup                    # Install dependencies, create venv, validate
2. /arc-benchmark                # Run a benchmark (Claude Code plays ARC-AGI games)
3. /arc-report latest            # View your benchmark report
```

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| **setup** | `/arc-setup` | Install dependencies, create venv, validate environment |
| **run-benchmark** | `/arc-benchmark` | Run ARC-AGI games with Claude Code as the agent |
| **browse-tests** | `/arc-browse` | Explore available environments with ASCII grid visualization |
| **report** | `/arc-report` | Generate formatted scoring reports |
| **compare-runs** | `/arc-compare` | Compare benchmark runs, track improvements |
| **cross-harness** | `/arc-cross` | Generate instructions for Codex/Gemini/OpenCode, import and compare results |

## Cross-Harness Benchmarking

Compare Claude Code against other AI coding tools:

```
/arc-cross generate codex         # Generate instructions for Codex CLI
/arc-cross generate gemini        # Generate instructions for Gemini CLI
/arc-cross import codex results/  # Import results from another harness
/arc-cross compare                # Compare across harnesses
```

Supported harnesses: **Codex CLI**, **Gemini CLI**, **OpenCode**.

## Managing the Plugin

```
/plugin                                  # Open interactive plugin manager
/plugin disable arc-agi-benchmarker      # Disable without uninstalling
/plugin enable arc-agi-benchmarker       # Re-enable
/plugin uninstall arc-agi-benchmarker    # Uninstall
/plugin update arc-agi-benchmarker       # Update to latest version
/reload-plugins                          # Reload plugins in current session
```

## Managing the Marketplace

```
/plugin marketplace list                                          # List configured marketplaces
/plugin marketplace update arc-agi-benchmarker       # Update listings
/plugin marketplace remove arc-agi-benchmarker       # Remove marketplace
```

## Requirements

- **Python >= 3.12**
- **pip** or **uv** package manager
- **Claude Code CLI**
- The `arc-agi` Python package (installed automatically by `/arc-setup`)

## Data Storage

All benchmark data is stored locally in `.arc-agi-benchmarks/`:

```
.arc-agi-benchmarks/
  config.json                    # Plugin configuration
  runs/
    <run-id>/
      run-meta.json              # Run metadata and harness config
      scorecard.json             # Official ARC-AGI scorecard (0-1 scale)
      environment-scores.json    # Per-environment scores (0-100 scale)
      report.md                  # Generated report
      session_<game_id>.json     # Per-game action/observation replay
  cross-harness/
    <harness>-<run-id>/          # Imported cross-harness results
  comparisons/
    <comparison-id>.json         # Saved comparison results
```

## LongMemEval Benchmarker

Benchmark your Claude Code harness+model against [LongMemEval](https://github.com/xiaowu0162/longmemeval), a long-term memory QA benchmark over multi-session chat histories.

```
/plugin install longmemeval-benchmarker@arc-agi-benchmarker
/longmemeval-benchmarker:setup           # conda env, clone upstream, download 3 dataset variants
/longmemeval-benchmarker:run-benchmark   # sequential gen+judge with resume-from-checkpoint
/longmemeval-benchmarker:report          # per-question-type scorecard
```

Supports the `_s` (~115k tokens), `_m` (~500 sessions with retrieval), and `_oracle` (evidence-only smoke) dataset variants. Default judge is Claude; OpenAI `gpt-4o` is available as a fallback for upstream reproduction. See [`plugins/longmemeval-benchmarker/README.md`](./plugins/longmemeval-benchmarker/README.md) for details.

## License

MIT
