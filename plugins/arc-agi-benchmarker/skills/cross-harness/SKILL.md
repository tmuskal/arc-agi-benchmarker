---
description: Cross-harness benchmarking - generate instructions for Codex/Gemini/OpenCode, import results, and compare across harnesses
---

# ARC-AGI Cross-Harness

You are managing cross-harness benchmarking for ARC-AGI. This skill lets users generate benchmark instructions for other CLI harnesses (Codex, Gemini CLI, OpenCode), import their results, and compare them against Claude Code runs.

## Sub-commands

This skill has three sub-commands, parsed from user arguments after `/arc-cross-harness`:

| Sub-command | Syntax | Purpose |
|-------------|--------|---------|
| `generate` | `/arc-cross-harness generate <HARNESS> [--ref <RUN_ID>] [--seed <N>] [--games <LIST>]` | Generate instruction document + helper scripts for a target harness |
| `import` | `/arc-cross-harness import <HARNESS> <PATH>` | Import and normalize a result file from another harness |
| `compare` | `/arc-cross-harness compare [run-ids...] [--all]` | Compare runs across harnesses (delegates to `/arc-compare`) |

If no sub-command is provided, display the table above as usage help and stop.

Supported harness values: `codex`, `gemini`, `opencode`.

---

## Step 1: Pre-flight Checks

### 1a: Detect Virtual Environment

Determine the venv paths. Do NOT try to source activate scripts.

```bash
if [ -f ".arc-agi-venv/bin/python" ]; then
  VENV_PYTHON=".arc-agi-venv/bin/python"
elif [ -f ".arc-agi-venv/Scripts/python.exe" ]; then
  VENV_PYTHON=".arc-agi-venv/Scripts/python.exe"
else
  echo "ERROR: Virtual environment not found. Run /arc-setup first."
  exit 1
fi
echo "VENV_PYTHON=$VENV_PYTHON"
```

Use `$VENV_PYTHON` for ALL Python commands below. Store the resolved path.

### 1b: Read Configuration

```bash
$VENV_PYTHON -c "
import json, sys
try:
    with open('.arc-agi-benchmarks/config.json') as f:
        cfg = json.load(f)
    print(json.dumps(cfg, indent=2))
except FileNotFoundError:
    print('ERROR: config.json not found. Run /arc-setup first.', file=sys.stderr)
    sys.exit(1)
"
```

Extract from the config:
- `environments_dir` (default: `./environment_files`)
- `default_seed` (default: `0`)
- `default_max_steps` (default: `500`)
- `default_max_resets` (default: `3`)

### 1c: Verify arc-agi is Available

```bash
$VENV_PYTHON -c "
from arc_agi import Arcade, OperationMode
from arcengine import GameAction, GameState
print('arc-agi: OK')
"
```

**If this fails**, tell the user to run `/arc-setup` first and stop.

### 1d: Parse Sub-command and Arguments

Parse the first argument as the sub-command (`generate`, `import`, or `compare`). If not recognized, display usage help and stop.

Then parse remaining arguments based on the sub-command:

**For `generate`:**

| Argument | Format | Required | Default | Example |
|----------|--------|----------|---------|---------|
| Harness name | `codex`, `gemini`, `opencode` | yes | -- | `codex` |
| `--ref <RUN_ID>` | UUID or `latest` | no | (none) | `--ref latest` |
| `--seed <N>` | integer | no | from config | `--seed 42` |
| `--games <LIST>` | comma-separated or `all` | no | `all` | `--games bt11,ls20` |

**For `import`:**

| Argument | Format | Required | Example |
|----------|--------|----------|---------|
| Harness name | `codex`, `gemini`, `opencode` | yes | `codex` |
| Result file path | file path | yes | `./codex-results.json` |

**For `compare`:**

| Argument | Format | Required | Example |
|----------|--------|----------|---------|
| Run IDs | space-separated UUIDs | Required unless `--all` | `<run-id-1> <run-id-2>` |
| `--all` | flag | no | auto-select latest run from each harness (still requires 2+ runs to exist) |

Validate that harness names are one of: `codex`, `gemini`, `opencode`. If invalid, report:
> Invalid harness `<NAME>`. Supported harnesses: codex, gemini, opencode

---

## Step 2: Execute Sub-command

Branch based on the parsed sub-command. Follow the corresponding section below.

---

## Sub-command: Generate (`/arc-cross-harness generate <HARNESS>`)

### G1: Resolve Game Set and Parameters

If `--ref` is provided, resolve the reference run:

```bash
$VENV_PYTHON -c "
import json, os, sys

ref_arg = '<REF_ARG>'  # 'latest' or a UUID

runs_dir = '.arc-agi-benchmarks/runs'
if ref_arg == 'latest':
    completed = []
    if os.path.isdir(runs_dir):
        for d in os.listdir(runs_dir):
            meta_path = os.path.join(runs_dir, d, 'run-meta.json')
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                if meta.get('status') == 'completed':
                    completed.append(meta)
    completed.sort(key=lambda m: m.get('timestamp', ''), reverse=True)
    if not completed:
        print(json.dumps({'error': 'No completed runs found. Run /arc-benchmark first.'}))
        sys.exit(1)
    ref_meta = completed[0]
else:
    meta_path = os.path.join(runs_dir, ref_arg, 'run-meta.json')
    if not os.path.isfile(meta_path):
        print(json.dumps({'error': f'Reference run {ref_arg} not found.'}))
        sys.exit(1)
    with open(meta_path) as f:
        ref_meta = json.load(f)

print(json.dumps({
    'run_id': ref_meta.get('run_id'),
    'game_ids': ref_meta.get('game_ids', []),
    'seed': ref_meta.get('seed', 0),
    'max_steps': ref_meta.get('max_steps', 500),
    'max_resets': ref_meta.get('max_resets', 3),
    'game_set': ref_meta.get('game_set', 'all')
}))
"
```

**IMPORTANT**: Replace `<REF_ARG>` with the actual `--ref` value provided by the user.

If no `--ref` is provided, resolve the game list from available environments:

```bash
$VENV_PYTHON -c "
import json
with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
seed = <SEED>
games_filter = '<GAMES_FILTER>'  # 'all' or comma-separated IDs

from arc_agi import Arcade, OperationMode
arc = Arcade(operation_mode=OperationMode.OFFLINE, environments_dir=env_dir)
envs = arc.get_environments()

all_ids = []
for env in envs:
    gid = getattr(env, 'game_id', getattr(env, 'id', str(env)))
    all_ids.append(gid)

if games_filter == 'all':
    game_ids = all_ids
else:
    requested = [g.strip() for g in games_filter.split(',')]
    game_ids = [g for g in requested if g in all_ids]
    missing = [g for g in requested if g not in all_ids]
    if missing:
        import sys
        print(f'WARNING: Games not found: {missing}', file=sys.stderr)

print(json.dumps({
    'game_ids': game_ids,
    'seed': seed,
    'max_steps': cfg.get('default_max_steps', 500),
    'max_resets': cfg.get('default_max_resets', 3)
}))
"
```

**IMPORTANT**: Replace `<SEED>` with the seed integer (from `--seed` or config default) and `<GAMES_FILTER>` with the `--games` value (default `all`).

Store the resolved `game_ids`, `seed`, `max_steps`, `max_resets`, and optionally the reference `run_id`.

### G2: Generate Instruction Document, Game Driver, and Result Collector

Generate all three files in a single Python script:

```bash
$VENV_PYTHON -c "
import json, os, textwrap
from datetime import datetime, timezone

harness = '<HARNESS>'
game_ids = <GAME_IDS_JSON>
seed = <SEED>
max_steps = <MAX_STEPS>
max_resets = <MAX_RESETS>
ref_run_id = '<REF_RUN_ID>'  # or 'none'

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')

out_dir = f'.arc-agi-benchmarks/cross-harness/{harness}'
os.makedirs(f'{out_dir}/runs', exist_ok=True)

# ===== 1. GAME DRIVER SCRIPT =====
game_driver = '''#!/usr/bin/env python3
\"\"\"
ARC-AGI Game Driver for cross-harness benchmarking.
Provides a stdin/stdout interface for any harness to play ARC-AGI games.

Usage:
  python game_driver.py <game_id> <seed> [--env-dir <path>]

Protocol:
  1. On start, prints an observation JSON to stdout.
  2. Reads action JSON from stdin (one line).
  3. Executes action, prints next observation JSON to stdout.
  4. Repeat until state is WIN or GAME_OVER.
  5. On GAME_OVER, send {\"command\": \"reset\"} to reset (up to max_resets).
  6. Send {\"command\": \"quit\"} to end the session.

Observation JSON:
  {
    \"state\": \"PLAYING|WIN|GAME_OVER\",
    \"frame\": [[[int, ...], ...], ...],
    \"levels_completed\": int,
    \"total_levels\": int,
    \"baseline_actions\": [int, ...],
    \"available_actions\": [{\"name\": str, \"is_complex\": bool}, ...],
    \"step\": int,
    \"resets\": int
  }

Action JSON:
  {\"command\": \"step\", \"action\": \"ACTION1\", \"data\": {\"x\": 0, \"y\": 0}, \"reasoning\": \"...\"}
  {\"command\": \"reset\"}
  {\"command\": \"quit\"}
\"\"\"
import json, sys, argparse

def main():
    parser = argparse.ArgumentParser(description='ARC-AGI Game Driver')
    parser.add_argument('game_id', help='Game ID to play')
    parser.add_argument('seed', type=int, help='Random seed')
    parser.add_argument('--env-dir', default='./environment_files', help='Path to environment files')
    parser.add_argument('--max-steps', type=int, default=''' + str(max_steps) + ''', help='Max steps per game')
    parser.add_argument('--max-resets', type=int, default=''' + str(max_resets) + ''', help='Max resets per game')
    args = parser.parse_args()

    from arc_agi import Arcade, OperationMode
    from arcengine import GameAction

    arc = Arcade(operation_mode=OperationMode.OFFLINE, environments_dir=args.env_dir)

    # Query environment metadata for baseline_actions and total_levels
    env_meta_baseline_actions = []
    env_meta_total_levels = 5
    try:
        envs = arc.get_environments()
        for e in envs:
            eid = getattr(e, 'game_id', getattr(e, 'id', str(e)))
            if eid == args.game_id:
                env_meta_baseline_actions = getattr(e, 'baseline_actions', [])
                if hasattr(env_meta_baseline_actions, 'tolist'):
                    env_meta_baseline_actions = env_meta_baseline_actions.tolist()
                env_meta_total_levels = getattr(e, 'number_of_levels', getattr(e, 'total_levels', 5))
                break
    except Exception:
        pass

    if env_meta_total_levels == 5 and not env_meta_baseline_actions:
        print(f'WARNING: Could not determine total_levels from environment metadata for {args.game_id}; falling back to total_levels=5', file=sys.stderr, flush=True)

    env = arc.make(args.game_id, seed=args.seed, save_recording=False, render_mode=None)
    # NOTE: In arc-agi, env.observation_space returns a FrameDataRaw object
    # (the current observation), not a Gym-style Space descriptor.
    obs = env.observation_space

    step_count = 0
    reset_count = 0

    def obs_to_dict(obs):
        frame = obs.frame
        if hasattr(frame, 'tolist'):
            frame = frame.tolist()
        actions = []
        for a in env.action_space:
            name = a.name if hasattr(a, 'name') else str(a)
            is_complex = a.is_complex() if hasattr(a, 'is_complex') else False
            actions.append({'name': name, 'is_complex': is_complex})
        return {
            'state': obs.state.name if hasattr(obs.state, 'name') else str(obs.state),
            'frame': frame,
            'levels_completed': getattr(obs, 'levels_completed', 0),
            'total_levels': env_meta_total_levels,
            'baseline_actions': env_meta_baseline_actions,
            'available_actions': actions,
            'step': step_count,
            'resets': reset_count
        }

    # Print initial observation
    print(json.dumps(obs_to_dict(obs)), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            print(json.dumps({'error': 'Invalid JSON'}), flush=True)
            continue

        cmd = request.get('command', 'step')

        if cmd == 'quit':
            break
        elif cmd == 'reset':
            if reset_count >= args.max_resets:
                print(json.dumps({'error': 'Max resets exceeded'}), flush=True)
                continue
            obs = env.reset()
            if obs is None:
                print(json.dumps({'error': 'env.reset() returned None'}), flush=True)
                continue
            reset_count += 1
            print(json.dumps(obs_to_dict(obs)), flush=True)
        elif cmd == 'step':
            if step_count >= args.max_steps:
                print(json.dumps({'error': 'Max steps exceeded'}), flush=True)
                continue
            action_name = request.get('action', '')
            try:
                action = GameAction[action_name]
            except KeyError:
                print(json.dumps({'error': f'Unknown action: {action_name}'}), flush=True)
                continue
            step_kwargs = {'action': action}
            if request.get('data'):
                step_kwargs['data'] = request['data']
            if request.get('reasoning'):
                step_kwargs['reasoning'] = {'thought': request['reasoning']}
            obs = env.step(**step_kwargs)
            if obs is None:
                print(json.dumps({'error': 'env.step() returned None'}), flush=True)
                continue
            step_count += 1
            print(json.dumps(obs_to_dict(obs)), flush=True)
        else:
            print(json.dumps({'error': f'Unknown command: {cmd}'}), flush=True)

if __name__ == '__main__':
    main()
'''

with open(f'{out_dir}/game_driver.py', 'w', newline='\\n') as f:
    f.write(game_driver)

# ===== 2. RESULT COLLECTOR SCRIPT =====
collect_results = '''#!/usr/bin/env python3
\"\"\"
ARC-AGI Result Collector for cross-harness benchmarking.
Reads session log files and produces the cross-harness result JSON.

Usage:
  python collect_results.py --sessions-dir <dir> --output <path> --harness <name> [--seed <N>]

Session log format (one file per game, named <game_id>.jsonl):
  Each line is a JSON object with:
    {\"type\": \"observation\", \"data\": {...}}  -- observation from game_driver
    {\"type\": \"action\", \"data\": {...}}       -- action sent to game_driver

If you are using the game_driver.py interactively, you can capture the session
by logging all stdin/stdout exchanges to a JSONL file.

Alternatively, pass --results-file <path> to directly provide a pre-built result JSON
for validation only (the script will validate and pretty-print it).
\"\"\"
import json, sys, argparse, os
from datetime import datetime, timezone

def compute_level_score(baseline_actions, actions_taken, completed):
    if not completed:
        return 0.0
    if actions_taken == 0:
        return 0.0
    return min((baseline_actions / actions_taken) ** 2, 1.0)

def compute_game_score(level_scores):
    if not level_scores:
        return 0.0
    n = len(level_scores)
    weighted = sum(level_scores[i] * (i + 1) for i in range(n))
    total_weight = sum(range(1, n + 1))
    return weighted / total_weight if total_weight > 0 else 0.0

def main():
    parser = argparse.ArgumentParser(description='ARC-AGI Result Collector')
    parser.add_argument('--sessions-dir', help='Directory containing session JSONL files')
    parser.add_argument('--results-file', help='Pre-built result JSON to validate')
    parser.add_argument('--output', default='result.json', help='Output file path')
    parser.add_argument('--harness', default=''' + repr(harness) + ''', help='Harness name')
    parser.add_argument('--seed', type=int, default=''' + str(seed) + ''', help='Seed used')
    parser.add_argument('--model', default='unknown', help='Model identifier')
    parser.add_argument('--version', default='unknown', help='Harness version')
    parser.add_argument('--notes', default='', help='Additional notes')
    args = parser.parse_args()

    if args.results_file:
        with open(args.results_file) as f:
            result = json.load(f)
        print(json.dumps(result, indent=2))
        return

    if not args.sessions_dir:
        print('ERROR: --sessions-dir or --results-file required', file=sys.stderr)
        sys.exit(1)

    games = []
    for fname in sorted(os.listdir(args.sessions_dir)):
        if not fname.endswith('.jsonl'):
            continue
        game_id = fname.replace('.jsonl', '')
        observations = []
        actions = []
        with open(os.path.join(args.sessions_dir, fname)) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                if entry.get('type') == 'observation':
                    observations.append(entry['data'])
                elif entry.get('type') == 'action':
                    actions.append(entry['data'])

        if not observations:
            games.append({
                'game_id': game_id,
                'state': 'NOT_PLAYED',
                'levels_completed': 0,
                'total_levels': 5,
                'total_actions': 0,
                'total_resets': 0,
                'levels': []
            })
            continue

        last_obs = observations[-1]
        first_obs = observations[0]
        state = last_obs.get('state', 'GAME_OVER')
        levels_completed = last_obs.get('levels_completed', 0)
        total_actions = sum(1 for a in actions if a.get('command') == 'step')
        total_resets = sum(1 for a in actions if a.get('command') == 'reset')

        # Read baseline_actions and total_levels from observation data (set by game_driver.py)
        env_baseline_actions = first_obs.get('baseline_actions', [])
        env_total_levels = first_obs.get('total_levels', 5)

        # Build level info by iterating action entries with command='step'.
        # We pair each step action with the observation that follows it
        # (observations[action_index + 1]) to detect level transitions.
        # This avoids over-counting from initial/reset observations.
        levels = []
        current_level = 0
        level_action_count = 0
        step_obs_idx = 0  # tracks which observation corresponds to next step result
        for act in actions:
            if act.get('command') != 'step':
                continue
            step_obs_idx += 1  # skip past the preceding observation
            level_action_count += 1
            # The observation after this step (if available) tells us the new state
            if step_obs_idx < len(observations):
                lc = observations[step_obs_idx].get('levels_completed', 0)
                if lc > current_level:
                    ba = env_baseline_actions[current_level] if current_level < len(env_baseline_actions) else 0
                    levels.append({
                        'level_index': current_level + 1,
                        'completed': True,
                        'actions_taken': level_action_count,
                        'baseline_actions': ba
                    })
                    current_level = lc
                    level_action_count = 0

        # Add final level (may be incomplete)
        if level_action_count > 0 or not levels:
            ba = env_baseline_actions[current_level] if current_level < len(env_baseline_actions) else 0
            levels.append({
                'level_index': current_level + 1,
                'completed': state == 'WIN' and current_level + 1 <= levels_completed,
                'actions_taken': level_action_count,
                'baseline_actions': ba
            })

        games.append({
            'game_id': game_id,
            'state': state,
            'levels_completed': levels_completed,
            'total_levels': env_total_levels,
            'total_actions': total_actions,
            'total_resets': total_resets,
            'levels': levels
        })

    result = {
        'schema_version': '1.0.0',
        'scoring_formula_version': '1.0.0',
        'harness': args.harness,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'seed': args.seed,
        'games': games,
        'metadata': {
            'model': args.model,
            'version': args.version,
            'notes': args.notes
        }
    }

    with open(args.output, 'w') as f:
        json.dump(result, f, indent=2)
    print(f'Result written to {args.output}')
    print(f'Games: {len(games)}, Completed: {sum(1 for g in games if g[\"state\"] == \"WIN\")}')

if __name__ == '__main__':
    main()
'''

with open(f'{out_dir}/collect_results.py', 'w', newline='\\n') as f:
    f.write(collect_results)

# ===== 3. INSTRUCTION DOCUMENT =====

game_ids_str = ', '.join(game_ids)
game_ids_json = json.dumps(game_ids)
ref_line = f'Reference run: {ref_run_id}' if ref_run_id != 'none' else 'Reference run: none'
now = datetime.now(timezone.utc).isoformat()

# Harness-specific sections
if harness == 'codex':
    harness_guidance = '''## Harness-Specific Guidance: Codex CLI

### Sandbox Awareness

Codex operates in a sandboxed environment. You must install `arc-agi` inside the sandbox:

```bash
pip install arc-agi
```

Verify the installation:

```bash
python -c \"from arc_agi import Arcade, OperationMode; print('OK')\"
```

### Execution Model

Codex uses file I/O rather than interactive stdin/stdout. The recommended approach:

1. Write a Python script for each game (or a single script that iterates all games)
2. The script should:
   - Initialize the game via the arc-agi API
   - Analyze the frame data
   - Choose actions based on pattern recognition
   - Loop until WIN or GAME_OVER
   - Write results to a JSON file
3. Execute the script via Codex sandbox

### Running Codex

Use the `codex exec` command for unattended execution:

```bash
codex exec -m <model> --full-auto "<prompt>"
```

Additional flags:
- `--sandbox workspace-write` -- control sandbox write permissions
- `--json` -- enable JSON event streaming for structured output parsing

### Prompt Template

Use this system prompt when invoking Codex:

> You are playing ARC-AGI games. For each game, you will analyze grid patterns
> and choose actions to transform the grid. Use the game_driver.py script to
> interact with games. Read observations, reason about patterns, and submit
> actions. Collect results using collect_results.py.

### Limitations

- Codex sandbox may have network restrictions -- ensure arc-agi is pre-installed
- File system access is sandboxed -- keep all files in the working directory
'''
elif harness == 'gemini':
    harness_guidance = '''## Harness-Specific Guidance: Gemini CLI

### Tool Use

Gemini CLI uses function calling / tool_use for shell commands. Ensure tool_use is enabled
so Gemini can execute Python commands.

### Running Gemini CLI

For headless (non-interactive) mode, use the `-p` flag:

```bash
gemini -p "<prompt>"
```

Use `--output-format json` for structured output parsing:

```bash
gemini -p "<prompt>" --output-format json
```

**Important**: Gemini CLI has a 5-minute timeout on shell tool invocations. For games
that may take longer, consider breaking them into smaller batches or using a wrapper
script that handles individual game sessions.

### Execution Model

Gemini drives a Python session, reading observations and choosing actions:

1. Start by running the game_driver.py script
2. Gemini reads the observation JSON output
3. Gemini reasons about the grid pattern
4. Gemini sends an action JSON to stdin
5. Repeat until WIN or GAME_OVER

### Prompt Structure

Structure the Gemini conversation to maintain context across turns within a game:

> You are playing ARC-AGI games. Use the provided game_driver.py to interact with
> each game. Run it as: python game_driver.py <game_id> <seed>
> Read the JSON observations, analyze the grid patterns, and send action JSON via stdin.
> After all games, run collect_results.py to produce the final result file.

### Multi-Turn Context

Gemini should maintain context across turns within a game. Each observation builds on
the previous one. Share your reasoning about the pattern as you discover it across levels.
'''
elif harness == 'opencode':
    harness_guidance = '''## Harness-Specific Guidance: OpenCode

### Configuration

Create or update `opencode.json` (no leading dot) in the project root:

```json
{
  \"tools\": {
    \"shell\": true
  }
}
```

### Running OpenCode

For scripted execution, use the `opencode run` command:

```bash
opencode run --model <model> "<prompt>"
```

### Backend Flexibility

OpenCode supports multiple LLM backends. Configure your preferred backend in `opencode.json`.
The game interaction is the same regardless of backend.

### Execution Model

Similar to Claude Code -- OpenCode uses shell tool execution to run Python scripts:

1. Execute `python game_driver.py <game_id> <seed>` via shell tool
2. Read the observation JSON
3. Reason about the grid pattern
4. Send action JSON to stdin (or use the batch approach below)
5. Repeat until WIN or GAME_OVER

### Session Management

Maintain game state across OpenCode tool calls. The game_driver.py uses stdin/stdout,
so you can either:
- Run it interactively in a single shell session
- Use the batch approach: write a wrapper script that plays the full game autonomously
'''
else:
    harness_guidance = ''

instructions = f'''# ARC-AGI Cross-Harness Benchmark Instructions

**Target harness**: {harness}
**Generated**: {now}
**{ref_line}**
**Game set**: {len(game_ids)} games
**Seed**: {seed}
**Max steps per game**: {max_steps}
**Max resets per game**: {max_resets}

---

## Prerequisites

- Python >= 3.12
- pip or uv package manager

## Environment Setup

### 1. Install arc-agi

```bash
pip install arc-agi
```

Or with uv:

```bash
uv add arc-agi
```

### 2. Verify Installation

```bash
python -c \"from arc_agi import Arcade, OperationMode; print('OK')\"
```

### 3. Environment Files

Ensure ARC-AGI environment files are available. They should be in `{env_dir}` relative to the project root, or set a custom path when running the game driver:

```bash
python game_driver.py <game_id> {seed} --env-dir {env_dir}
```

---

## Game Set

Play these {len(game_ids)} games with seed={seed}:

```
{game_ids_str}
```

Game IDs as JSON array (for scripting):

```json
{game_ids_json}
```

---

## Game Interaction Protocol

### How ARC-AGI Games Work

Each game has multiple levels (typically 5). Each level presents a grid (2D array of integers).
You must figure out the transformation rule and apply it by choosing actions. The same rule
applies across all levels -- use early levels to learn the pattern.

### Grid Interpretation

- `frame` is a list of 2D integer arrays (grid layers)
- Each integer represents a color (0 = background, 1-9 = colors)
- Grid sizes start small (e.g., 3x3) and grow with each level
- Look for: symmetry, borders, objects, repeating patterns, color relationships

### Using the Game Driver

The `game_driver.py` script (included alongside these instructions) provides a simple
stdin/stdout protocol:

```bash
python game_driver.py <game_id> {seed} --env-dir {env_dir}
```

**Observation output** (printed to stdout as JSON):

```json
{{
  "state": "PLAYING",
  "frame": [[[0, 1, 0], [1, 0, 1], [0, 1, 0]]],
  "levels_completed": 0,
  "total_levels": 5,
  "baseline_actions": [4, 6, 8, 10, 12],
  "available_actions": [
    {{"name": "ACTION1", "is_complex": false}},
    {{"name": "ACTION2", "is_complex": true}}
  ],
  "step": 0,
  "resets": 0
}}
```

**Action input** (send as JSON to stdin):

For simple actions (is_complex=false):
```json
{{"command": "step", "action": "ACTION1", "reasoning": "Applying rotation pattern"}}
```

For complex actions (is_complex=true, requiring x,y coordinates):
```json
{{"command": "step", "action": "ACTION2", "data": {{"x": 2, "y": 1}}, "reasoning": "Filling cell at column 2, row 1"}}
```

To reset after GAME_OVER:
```json
{{"command": "reset"}}
```

To end the session:
```json
{{"command": "quit"}}
```

### Game States

| State | Meaning | Action |
|-------|---------|--------|
| PLAYING | Game continues | Analyze grid, choose action |
| WIN | All levels completed | Move to next game |
| GAME_OVER | Failed current level | Reset (if under max_resets={max_resets}) or move on |

### Action Space

**Important**: The set of available actions varies between games and may change between
levels within the same game. Always consult the `available_actions` array in each
observation before choosing an action. Do not assume actions from one game are valid
in another.

### Strategy Tips

1. **Level 1**: Experiment to discover what each action does
2. **Level 2+**: Apply the rule learned from earlier levels
3. **After reset**: Try a different approach based on what you learned
4. **Efficiency matters**: Fewer actions = higher score

---

{harness_guidance}

---

## Scoring Reference

Scores are calculated using these formulas:

**Per-level score** (0.0 to 1.0):
```
level_score = min((baseline_actions / actions_taken) ** 2, 1.0) if completed else 0.0
```

**Per-game score** (weighted average, later levels weighted more):
```
game_score = sum(level_score[i] * (i+1) for i in 0..N-1) / sum(1..N)
```

**Overall score**:
```
overall_score = average(all game scores)
```

---

## Result Collection

After playing all games, produce a result JSON file using `collect_results.py` or manually.

### Automated Collection

If you logged sessions as JSONL files (one per game, in a `sessions/` directory):

```bash
python collect_results.py \\
  --sessions-dir ./sessions \\
  --output result.json \\
  --harness {harness} \\
  --seed {seed} \\
  --model \"<your-model-name>\" \\
  --version \"<harness-version>\" \\
  --notes \"<any context>\"
```

### Manual Result File

Create a JSON file matching this schema:

```json
{{
  "schema_version": "1.0.0",
  "scoring_formula_version": "1.0.0",
  "harness": "{harness}",
  "timestamp": "<ISO 8601 timestamp>",
  "seed": {seed},
  "games": [
    {{
      "game_id": "<game_id>",
      "state": "WIN or GAME_OVER or NOT_PLAYED",
      "levels_completed": 5,
      "total_levels": 5,
      "total_actions": 45,
      "total_resets": 0,
      "levels": [
        {{
          "level_index": 1,
          "completed": true,
          "actions_taken": 4,
          "baseline_actions": 4
        }}
      ]
    }}
  ],
  "metadata": {{
    "model": "<model used>",
    "version": "<harness version>",
    "notes": "<any context>"
  }}
}}
```

### Result Template

Here is a pre-filled template with all {len(game_ids)} game IDs:

```python
import json
from datetime import datetime, timezone

games = []
for gid in {game_ids_json}:
    games.append({{
        \"game_id\": gid,
        \"state\": \"NOT_PLAYED\",
        \"levels_completed\": 0,
        \"total_levels\": 5,
        \"total_actions\": 0,
        \"total_resets\": 0,
        \"levels\": []
    }})

result = {{
    \"schema_version\": \"1.0.0\",
    \"scoring_formula_version\": \"1.0.0\",
    \"harness\": \"{harness}\",
    \"timestamp\": datetime.now(timezone.utc).isoformat(),
    \"seed\": {seed},
    \"games\": games,
    \"metadata\": {{
        \"model\": \"<your-model>\",
        \"version\": \"<version>\",
        \"notes\": \"\"
    }}
}}

with open(\"result.json\", \"w\") as f:
    json.dump(result, f, indent=2)
print(\"Template written to result.json -- fill in game results.\")
```

---

## Importing Results

Once you have the result JSON file, import it back into the ARC-AGI benchmarker:

```
/arc-cross-harness import {harness} <path-to-result.json>
```

This will validate, normalize scores, and store the results for comparison.
'''

with open(f'{out_dir}/instructions.md', 'w', newline='\\n') as f:
    f.write(instructions)

print(json.dumps({
    'status': 'generated',
    'instructions': f'{out_dir}/instructions.md',
    'game_driver': f'{out_dir}/game_driver.py',
    'collect_results': f'{out_dir}/collect_results.py',
    'game_count': len(game_ids),
    'seed': seed,
    'ref_run_id': ref_run_id
}))
"
```

**IMPORTANT**: Replace the following angle-bracket placeholders with actual literal values:
- `<HARNESS>`: the harness name (e.g., `codex`)
- `<GAME_IDS_JSON>`: Python list literal of game IDs (e.g., `["bt11", "ls20"]`)
- `<SEED>`: integer seed value
- `<MAX_STEPS>`: integer max steps
- `<MAX_RESETS>`: integer max resets
- `<REF_RUN_ID>`: the reference run ID string, or `none` if no `--ref` was provided

### G3: Report to User

After generation, report:

```
Instructions generated: .arc-agi-benchmarks/cross-harness/<HARNESS>/instructions.md
Game driver:            .arc-agi-benchmarks/cross-harness/<HARNESS>/game_driver.py
Result collector:       .arc-agi-benchmarks/cross-harness/<HARNESS>/collect_results.py
Game set:               <N> games, seed=<SEED>
Reference run:          <RUN_ID or "none">

Next steps:
1. Open the instructions file and follow the setup steps in the target harness
2. Run the benchmark on the target harness
3. Save the result JSON file
4. Import with: /arc-cross-harness import <HARNESS> <result-file-path>
```

---

## Sub-command: Import (`/arc-cross-harness import <HARNESS> <PATH>`)

### I1: Validate the Result File

```bash
$VENV_PYTHON -c "
import json, sys, os

harness = '<HARNESS>'
result_path = '<RESULT_PATH>'

# Validate harness
if harness not in ('codex', 'gemini', 'opencode'):
    print(f'ERROR: Invalid harness \"{harness}\". Supported: codex, gemini, opencode', file=sys.stderr)
    sys.exit(1)

# Validate file exists
if not os.path.isfile(result_path):
    print(f'ERROR: Result file not found: {result_path}', file=sys.stderr)
    sys.exit(1)

# Read and validate schema
with open(result_path) as f:
    try:
        result = json.load(f)
    except json.JSONDecodeError as e:
        print(f'ERROR: Invalid JSON in result file: {e}', file=sys.stderr)
        sys.exit(1)

errors = []
warnings = []

# Required top-level fields
for field in ['schema_version', 'harness', 'timestamp', 'seed', 'games', 'metadata']:
    if field not in result:
        errors.append(f'Missing required field: {field}')

if 'scoring_formula_version' not in result:
    result['scoring_formula_version'] = '1.0.0'

# Warn on harness mismatch
if result.get('harness') and result['harness'] != harness:
    warnings.append(f'Harness field in result (\"{result[\"harness\"]}\") does not match argument (\"{harness}\")')

# Warn on schema version
if result.get('schema_version') and result['schema_version'] != '1.0.0':
    warnings.append(f'Schema version {result[\"schema_version\"]} may not be fully supported (expected 1.0.0)')

# Validate games array
games = result.get('games', [])
if not isinstance(games, list):
    errors.append('\"games\" must be an array')
else:
    for i, game in enumerate(games):
        prefix = f'games[{i}]'
        for field in ['game_id', 'state', 'levels_completed', 'total_levels', 'total_actions', 'total_resets', 'levels']:
            if field not in game:
                errors.append(f'Missing required field: {prefix}.{field}')

        levels = game.get('levels', [])
        if isinstance(levels, list):
            for j, level in enumerate(levels):
                lprefix = f'{prefix}.levels[{j}]'
                for field in ['level_index', 'completed', 'actions_taken', 'baseline_actions']:
                    if field not in level:
                        errors.append(f'Missing required field: {lprefix}.{field}')

if errors:
    print('Schema validation errors:', file=sys.stderr)
    for e in errors:
        print(f'  - {e}', file=sys.stderr)
    sys.exit(1)

if warnings:
    for w in warnings:
        print(f'WARNING: {w}', file=sys.stderr)

print(json.dumps({'status': 'valid', 'games': len(games), 'warnings': warnings}))
"
```

**IMPORTANT**: Replace `<HARNESS>` with the harness name and `<RESULT_PATH>` with the actual file path to the result JSON.

### I2: Normalize Scores and Create Run Directory

```bash
$VENV_PYTHON -c "
import json, sys, os, uuid
from datetime import datetime, timezone

harness = '<HARNESS>'
result_path = '<RESULT_PATH>'

with open(result_path) as f:
    result = json.load(f)

if 'scoring_formula_version' not in result:
    result['scoring_formula_version'] = '1.0.0'

# Duplicate import check: reject if same timestamp+harness already imported
import_ts = result.get('timestamp', '')
existing_runs_dir = f'.arc-agi-benchmarks/cross-harness/{harness}/runs'
if os.path.isdir(existing_runs_dir):
    for existing_dir in os.listdir(existing_runs_dir):
        existing_meta_path = os.path.join(existing_runs_dir, existing_dir, 'run-meta.json')
        if os.path.isfile(existing_meta_path):
            with open(existing_meta_path) as ef:
                existing_meta = json.load(ef)
            if existing_meta.get('timestamp') == import_ts and existing_meta.get('harness') == harness:
                print(f'ERROR: Duplicate import detected. A run with timestamp {import_ts} for harness {harness} already exists (run_id: {existing_dir}).', file=sys.stderr)
                sys.exit(1)

run_id = str(uuid.uuid4())
run_dir = f'.arc-agi-benchmarks/cross-harness/{harness}/runs/{run_id}'
os.makedirs(run_dir, exist_ok=True)

games = result.get('games', [])
metadata = result.get('metadata', {})

# ===== Recalculate all scores =====

def compute_level_score(baseline_actions, actions_taken, completed):
    if not completed:
        return 0.0
    if actions_taken <= 0:
        return 0.0
    return min((baseline_actions / actions_taken) ** 2, 1.0)

def compute_game_score(level_scores):
    if not level_scores:
        return 0.0
    n = len(level_scores)
    weighted = sum(level_scores[i] * (i + 1) for i in range(n))
    total_weight = sum(range(1, n + 1))
    return weighted / total_weight if total_weight > 0 else 0.0

total_environments = len(games)
total_environments_completed = 0
total_levels_completed_sum = 0
total_levels_sum = 0
total_actions_sum = 0
game_scores = []

scorecard_games = []

for game in games:
    game_id = game['game_id']
    state = game.get('state', 'NOT_PLAYED')
    levels_completed = game.get('levels_completed', 0)
    total_levels = game.get('total_levels', 5)
    total_actions = game.get('total_actions', 0)
    total_resets = game.get('total_resets', 0)
    levels = game.get('levels', [])

    if state == 'WIN':
        total_environments_completed += 1
    total_levels_completed_sum += levels_completed
    total_levels_sum += total_levels
    total_actions_sum += total_actions

    # Compute per-level scores
    level_scores_list = []
    level_actions_list = []
    level_baselines_list = []
    for lvl in levels:
        ls = compute_level_score(
            lvl.get('baseline_actions', 0),
            lvl.get('actions_taken', 0),
            lvl.get('completed', False)
        )
        level_scores_list.append(ls)
        level_actions_list.append(lvl.get('actions_taken', 0))
        level_baselines_list.append(lvl.get('baseline_actions', 0))

    # Pad to total_levels if needed
    while len(level_scores_list) < total_levels:
        level_scores_list.append(0.0)
        level_actions_list.append(0)
        level_baselines_list.append(0)

    game_score = compute_game_score(level_scores_list)
    game_scores.append(game_score)

    run_guid = str(uuid.uuid4())
    scorecard_games.append({
        'id': game_id,
        'score': game_score,
        'runs': [{
            'id': game_id,
            'guid': run_guid,
            'score': game_score,
            'levels_completed': levels_completed,
            'actions': total_actions,
            'resets': total_resets,
            'state': state,
            'completed': state == 'WIN',
            'level_scores': level_scores_list,
            'level_actions': level_actions_list,
            'level_baseline_actions': level_baselines_list,
            'number_of_levels': total_levels
        }]
    })

overall_score = sum(game_scores) / len(game_scores) if game_scores else 0.0

# ===== Write run-meta.json =====

run_meta = {
    'run_id': run_id,
    'harness': harness,
    'timestamp': result.get('timestamp', datetime.now(timezone.utc).isoformat()),
    'duration_seconds': 0,
    'game_set': 'imported',
    'game_ids': [g['game_id'] for g in games],
    'seed': result.get('seed', 0),
    'max_steps': metadata.get('max_steps', result.get('max_steps', 0)),
    'max_resets': metadata.get('max_resets', result.get('max_resets', 0)),
    'config_hash': '',
    'harness_config': {
        'model': metadata.get('model', 'unknown'),
        'plugins': [],
        'skills': [],
        'mcp_servers': []
    },
    'status': 'completed',
    'arc_agi_version': 'unknown',
    'plugin_version': '1.0.0'
}

with open(os.path.join(run_dir, 'run-meta.json'), 'w') as f:
    json.dump(run_meta, f, indent=2)

# ===== Write scorecard.json =====

scorecard = {
    'card_id': run_id,
    'source_url': None,
    'tags': [],
    'opaque': None,
    'competition_mode': False,
    'score': overall_score,
    'total_environments_completed': total_environments_completed,
    'total_environments': total_environments,
    'total_levels_completed': total_levels_completed_sum,
    'total_levels': total_levels_sum,
    'total_actions': total_actions_sum,
    'games': scorecard_games,
    'tags_scores': []
}

with open(os.path.join(run_dir, 'scorecard.json'), 'w') as f:
    json.dump(scorecard, f, indent=2)

# ===== Write environment-scores.json =====

env_scores = {
    'run_id': run_id,
    'overall_score': overall_score * 100,
    'environments': []
}

for i, game in enumerate(games):
    game_id = game['game_id']
    sc_game = scorecard_games[i]
    best_run = sc_game['runs'][0]

    env_data = {
        'game_id': game_id,
        'title': game_id,
        'tags': [],
        'score': sc_game['score'] * 100,
        'levels_completed': game.get('levels_completed', 0),
        'total_levels': game.get('total_levels', 5),
        'total_actions': game.get('total_actions', 0),
        'total_resets': game.get('total_resets', 0),
        'state': game.get('state', 'NOT_PLAYED'),
        'completed': game.get('state') == 'WIN',
        'levels': []
    }

    for j, lvl in enumerate(game.get('levels', [])):
        env_data['levels'].append({
            'level_index': lvl.get('level_index', j + 1),
            'score': best_run['level_scores'][j] * 100 if j < len(best_run['level_scores']) else 0,
            'actions_taken': lvl.get('actions_taken', 0),
            'baseline_actions': lvl.get('baseline_actions', 0),
            'completed': lvl.get('completed', False)
        })

    env_scores['environments'].append(env_data)

with open(os.path.join(run_dir, 'environment-scores.json'), 'w') as f:
    json.dump(env_scores, f, indent=2)

# ===== Report =====

print(json.dumps({
    'run_id': run_id,
    'run_dir': run_dir,
    'overall_score': overall_score,
    'total_environments': total_environments,
    'total_environments_completed': total_environments_completed,
    'total_levels_completed': total_levels_completed_sum,
    'total_levels': total_levels_sum,
    'total_actions': total_actions_sum
}))
"
```

**IMPORTANT**: Replace `<HARNESS>` with the harness name and `<RESULT_PATH>` with the actual file path.

### I3: Report Import Results

After the import script runs, display the results:

```
Imported results from <HARNESS>:
  Run ID:          <RUN_ID>
  Games:           <N>
  Overall Score:   <SCORE> / 100
  Levels Complete: <N> / <TOTAL>
  Stored at:       .arc-agi-benchmarks/cross-harness/<HARNESS>/runs/<RUN_ID>/

To compare with a Claude Code run:
  /arc-compare <claude-run-id> <RUN_ID>

Or use:
  /arc-cross-harness compare <claude-run-id> <RUN_ID>
```

### I4: Suggest Auto-Compare (Optional)

Check if a Claude Code run exists and suggest comparison (do NOT auto-invoke):

```bash
$VENV_PYTHON -c "
import json, os

runs_dir = '.arc-agi-benchmarks/runs'
if os.path.isdir(runs_dir):
    completed = []
    for d in os.listdir(runs_dir):
        meta_path = os.path.join(runs_dir, d, 'run-meta.json')
        if os.path.isfile(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            if meta.get('status') == 'completed':
                completed.append(meta)
    completed.sort(key=lambda m: m.get('timestamp', ''), reverse=True)
    if completed:
        latest = completed[0]
        print(json.dumps({'latest_claude_run': latest['run_id']}))
    else:
        print(json.dumps({'latest_claude_run': None}))
else:
    print(json.dumps({'latest_claude_run': None}))
"
```

If a Claude Code run was found, tell the user:

```
A Claude Code run is available (latest: <LATEST_RUN_ID>).
Would you like to compare? Run: /arc-compare <LATEST_RUN_ID> <IMPORTED_RUN_ID>
```

Do NOT automatically invoke the comparison.

---

## Sub-command: Compare (`/arc-cross-harness compare [run-ids...] [--all]`)

### C1: Resolve Run IDs

If `--all` flag is provided, find the latest run from each source:

```bash
$VENV_PYTHON -c "
import json, os

run_ids = []

# Latest Claude Code run
runs_dir = '.arc-agi-benchmarks/runs'
if os.path.isdir(runs_dir):
    completed = []
    for d in os.listdir(runs_dir):
        meta_path = os.path.join(runs_dir, d, 'run-meta.json')
        if os.path.isfile(meta_path):
            with open(meta_path) as f:
                meta = json.load(f)
            if meta.get('status') == 'completed':
                completed.append(meta)
    completed.sort(key=lambda m: m.get('timestamp', ''), reverse=True)
    if completed:
        run_ids.append({'run_id': completed[0]['run_id'], 'harness': 'claude-code'})

# Latest from each cross-harness
cross_dir = '.arc-agi-benchmarks/cross-harness'
if os.path.isdir(cross_dir):
    for harness_name in sorted(os.listdir(cross_dir)):
        harness_runs = os.path.join(cross_dir, harness_name, 'runs')
        if not os.path.isdir(harness_runs):
            continue
        completed = []
        for d in os.listdir(harness_runs):
            meta_path = os.path.join(harness_runs, d, 'run-meta.json')
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                if meta.get('status') == 'completed':
                    completed.append(meta)
        completed.sort(key=lambda m: m.get('timestamp', ''), reverse=True)
        if completed:
            run_ids.append({'run_id': completed[0]['run_id'], 'harness': harness_name})

if len(run_ids) < 2:
    print(json.dumps({'error': 'Fewer than 2 runs available. Generate instructions and import results first.', 'found': run_ids}))
else:
    print(json.dumps({'run_ids': run_ids}))
"
```

If `--all` was not provided, use the run IDs directly as provided by the user.

### C2: Delegate to Compare-Runs

Once you have at least 2 run IDs, invoke the compare-runs skill:

> Now invoke `/arc-compare` with the resolved run IDs.

Pass the run IDs as space-separated arguments, e.g.:

```
/arc-compare <RUN_ID_1> <RUN_ID_2>
```

The compare-runs skill already supports cross-harness directory lookup (it checks `.arc-agi-benchmarks/cross-harness/*/runs/<run-id>/` when a run is not found in the standard runs directory).

If fewer than 2 runs are available, tell the user:

```
Fewer than 2 runs available for comparison.

To get started:
1. Run a Claude Code benchmark: /arc-benchmark
2. Generate cross-harness instructions: /arc-cross-harness generate <harness>
3. Run the benchmark on the target harness
4. Import results: /arc-cross-harness import <harness> <result-file>
5. Compare: /arc-cross-harness compare --all
```

---

## Error Handling

### Invalid Harness Name

If the user provides an unrecognized harness name:

> Invalid harness `<NAME>`. Supported harnesses: codex, gemini, opencode

### Reference Run Not Found

If `--ref <run-id>` points to a non-existent run:

> Run `<RUN_ID>` not found. Available runs:

Then list available completed runs from `.arc-agi-benchmarks/runs/`.

### Result File Not Found

If the import path does not exist:

> Result file not found: `<PATH>`
> Ensure the file exists and the path is correct.

### Schema Validation Failure

If required fields are missing from the result JSON, report each error:

> Schema validation errors:
>   - Missing required field: games[0].levels_completed
>   - Missing required field: games[1].levels[0].baseline_actions

### No Environments Available

If `arc.get_environments()` returns empty:

> No ARC-AGI environments found. Run `/arc-setup` first to configure environment files.

## Notes

- Always use `$VENV_PYTHON` (the shell variable set in Step 1a), never system Python.
- All scores are recalculated by the plugin using the standard scoring formula. Never trust externally-reported scores.
- Scoring scale: `scorecard.json` stores game scores on a 0-1 float scale (e.g., 0.85). `environment-scores.json` stores per-level scores multiplied by 100 for display (e.g., 85). When showing scores to users, multiply by 100 to get the percentage form.
- The cross-harness skill does NOT install or invoke other CLI tools -- it only generates instructions and processes result files.
- Generated instruction documents are self-contained: a user with no prior context can follow them.
- Angle-bracket placeholders (`<HARNESS>`, `<PATH>`, etc.) must be substituted with actual literal values before running commands.
