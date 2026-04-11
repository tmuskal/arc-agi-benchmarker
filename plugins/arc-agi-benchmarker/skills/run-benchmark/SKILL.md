---
description: Execute benchmark runs against ARC-AGI games - plays games with Claude Code as the agent and records scores
---

# ARC-AGI Run Benchmark

You are running an ARC-AGI benchmark. **You are the game-playing agent.** You will observe grid data, reason about patterns, choose actions, and submit them. Your goal is to complete as many levels as possible, as efficiently as possible (fewer actions = higher score).

## CRITICAL RULE: No Source Code Reading

**You MUST NOT read, open, or examine the Python source code of game environments** located under `environment_files/` (or wherever `environments_dir` points). You also must NOT read arc-agi or arcengine library source code to understand game mechanics.

Understanding of game mechanics must come ONLY from:
- **Behavioral observation** -- observing how frames change after each action
- **The API surface** described in this skill (obs.frame, obs.state, env.step, etc.)
- **Trial and error** during gameplay

This is a fundamental requirement of the benchmark. Reading source code would invalidate the benchmark results. If you encounter errors, debug them using error messages and the API documentation in this skill, not by reading library internals.

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
- `operation_mode` (default: `normal`)
- `default_seed` (default: `0`)
- `default_max_steps` (default: `500`)
- `default_max_resets` (default: `10`)

### 1c: Parse User Arguments

The user may provide arguments after `/arc-benchmark`. Parse them as follows:

| Argument | Format | Default | Example |
|----------|--------|---------|---------|
| Game selection | bare word(s) or comma-separated | `all` | `bt11`, `bt11,ls20`, `all` |
| `--seed N` | integer | from config | `--seed 42` |
| `--max-steps N` | integer | from config | `--max-steps 200` |
| `--max-resets N` | integer | from config | `--max-resets 5` |

If the user provides no arguments, use defaults from config (run ALL games).

If the user specifies game IDs, store them as a list. If they say "all", set game selection to "all".

### 1d: Verify arc-agi is Available

```bash
$VENV_PYTHON -c "
from arc_agi import Arcade, OperationMode
from arcengine import GameAction, GameState
print('arc-agi: OK')
"
```

**If this fails**, tell the user to run `/arc-setup` first and stop.

## Step 2: Initialize Run

### 2a: Generate Run ID and Create Directory

```bash
$VENV_PYTHON -c "
import uuid, os, json
from datetime import datetime, timezone

run_id = str(uuid.uuid4())
run_dir = f'.arc-agi-benchmarks/runs/{run_id}'
os.makedirs(run_dir, exist_ok=True)
os.makedirs(f'{run_dir}/recordings', exist_ok=True)

print(json.dumps({'run_id': run_id, 'run_dir': run_dir}))
"
```

Store the `run_id` and `run_dir` values for use in subsequent steps.

### 2b: List Available Games

```bash
$VENV_PYTHON -c "
import json, sys
with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')

from arc_agi import Arcade, OperationMode
op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
arc = Arcade(operation_mode=op_mode, environments_dir=env_dir)
envs = arc.get_environments()

result = []
for env in envs:
    game_id = getattr(env, 'game_id', getattr(env, 'id', str(env)))
    tags = getattr(env, 'tags', [])
    result.append({'game_id': game_id, 'tags': tags})

print(json.dumps(result))
"
```

**If no environments are found**, tell the user and stop.

### 2c: Filter Games

Based on the user's game selection:
- If `all`: use every game from the list
- If specific IDs (e.g., `bt11,ls20`): filter to only those IDs. Warn if any ID is not found.
- If a tag (e.g., `logic`): filter to games matching that tag

Store the final list of `game_ids` to play.

### 2d: Write Initial Run Metadata

```bash
$VENV_PYTHON -c "
import json, hashlib
from datetime import datetime, timezone

# Read these from your parsed values:
run_id = '<RUN_ID>'
game_ids = <GAME_IDS_JSON>  # e.g., [\"bt11\", \"ls20\"]
game_selection = '<GAME_SELECTION>'  # The user's original selection: 'all', a tag name, or comma-separated IDs
seed = <SEED>
max_steps = <MAX_STEPS>
max_resets = <MAX_RESETS>

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)

config_hash = hashlib.sha256(json.dumps(cfg.get('harness_config', {}), sort_keys=True).encode()).hexdigest()

import importlib.metadata
try:
    arc_agi_version = importlib.metadata.version('arc-agi')
except Exception:
    arc_agi_version = 'unknown'

meta = {
    'run_id': run_id,
    'harness': 'claude-code',
    'timestamp': datetime.now(timezone.utc).isoformat(),
    'duration_seconds': 0,
    'game_set': game_selection,
    'game_ids': game_ids,
    'seed': seed,
    'max_steps': max_steps,
    'max_resets': max_resets,
    'config_hash': config_hash,
    'harness_config': cfg.get('harness_config', {}),
    'status': 'running',
    'arc_agi_version': arc_agi_version,
    'plugin_version': '1.0.0'
}

run_dir = f'.arc-agi-benchmarks/runs/{run_id}'
with open(f'{run_dir}/run-meta.json', 'w') as f:
    json.dump(meta, f, indent=2)
print(json.dumps({'status': 'run initialized', 'run_id': run_id, 'games': len(game_ids)}))
"
```

**IMPORTANT**: The angle-bracket placeholders (`<RUN_ID>`, `<GAME_IDS_JSON>`, `<SEED>`, etc.) in the code above are NOT shell or Python variables. You MUST substitute them with actual literal values before running the command. For example, replace `<RUN_ID>` with the actual UUID string, `<SEED>` with the integer `0`, etc. Either embed values directly as Python literals or write them to a temporary JSON file and read from Python.

Tell the user:
> Starting benchmark run `<run_id>` with `<N>` games, seed=`<seed>`, max_steps=`<max_steps>`, max_resets=`<max_resets>`

## Step 3: Play Each Game

For EACH `game_id` in the selected game list, perform the following sub-steps. Track progress and report after each game.

### 3a: Initialize Game

Copy the game driver script from the plugin's scripts directory to the run directory, then initialize the game.

```bash
cp "$(dirname "$0")/../plugins/arc-agi-benchmarker/skills/run-benchmark/scripts/game_driver.py" \
   .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py 2>/dev/null || \
cp plugins/arc-agi-benchmarker/skills/run-benchmark/scripts/game_driver.py \
   .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py 2>/dev/null || \
# If the plugin path is not found, locate it from the plugin cache:
find ~/.claude/plugins -path "*/arc-agi-benchmarker/*/scripts/game_driver.py" -exec cp {} .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py \; 2>/dev/null
```

**NOTE**: The game driver script is at `skills/run-benchmark/scripts/game_driver.py` relative to the plugin root. You need to find the actual installed path. Common locations:
- Project-local: `plugins/arc-agi-benchmarker/skills/run-benchmark/scripts/game_driver.py`
- Plugin cache: `~/.claude/plugins/cache/arc-agi-benchmarker/*/skills/run-benchmark/scripts/game_driver.py`

If the copy fails, you may write the driver script inline (see `scripts/game_driver.py` for the reference implementation).

Then initialize the game by writing an init request and running the driver:

```bash
$VENV_PYTHON -c "
import json
run_dir = '.arc-agi-benchmarks/runs/<RUN_ID>'
request = {'command': 'init'}
with open(f'{run_dir}/action_request.json', 'w') as f:
    json.dump(request, f)
"
$VENV_PYTHON .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py \
  .arc-agi-benchmarks/runs/<RUN_ID> \
  <GAME_ID> \
  <SEED> \
  .arc-agi-benchmarks/runs/<RUN_ID>/action_request.json
```

**IMPORTANT**: The angle-bracket placeholders (`<RUN_ID>`, `<GAME_ID>`, `<SEED>`) are NOT variables. You MUST substitute them with actual literal values before running the command.

Parse the observation JSON output. **The JSON result is always the LAST line of stdout.** Earlier lines may contain INFO log messages from arc_agi -- ignore them. Alternatively, read the observation from `observation_<GAME_ID>.json` which the driver writes to disk.

Note the `frame`, `state`, `available_actions`, and `action_details`.

> **Note on recordings**: Recordings are saved by arcengine using the naming convention `{game_id}.{agent_type}.{max_actions}.{guid}.recording.jsonl` within the recordings directory (under a scorecard ID subdirectory).

### 3b: Observe and Reason About the Grid

**This is where YOU (Claude Code) analyze the game state.**

Read the `frame` data from the observation. The frame is a list of 2D integer arrays (grid layers). Analyze it as follows:

#### How to Read ARC-AGI Grids

1. **Structure**: `frame` is a list of layers. Each layer is a 2D array (rows x columns) of integers.
2. **Grid size**: All grids are **64x64 pixels**. Do NOT assume small grids. The game world is rendered at 64x64 regardless of the logical puzzle size inside.
3. **Colors**: Each integer represents a color. Values range from `0` to `15` or higher:
   - `0` = black / empty / transparent
   - `1`-`15` = distinct colors
   - The exact visual color does not matter; what matters is the pattern of WHICH cells share the same value.
4. **Multiple layers**: Some games use multiple frame layers. Check `len(frame)` and examine each layer.

#### Grid Layout Patterns

ARC-AGI games typically organize the 64x64 grid into regions:

- **Header/UI area** (top rows): Level indicators, counters, color selectors. Look for small bordered boxes showing current state.
- **Example pairs**: Many games show one or more input-output example pairs to demonstrate the transformation rule. These appear as bordered rectangles with patterns inside.
- **Target/work area**: A separate region where you must apply the discovered rule. Often has empty (0-value) cells waiting to be filled.
- **Status bar** (row 63): Often a solid bar of a single color indicating game progress or state.
- **Separators**: Color 4 (often yellow) borders separate regions. Color 5 (often gray) is common background fill.

#### Pattern Analysis Strategy

When observing a frame, look for:

1. **Region identification**: First identify distinct regions by looking for borders (rectangles of a single color). Map out where the examples are and where the target area is.
2. **Spatial patterns**: Symmetry (horizontal, vertical, rotational), borders, filled regions, isolated objects within each region.
3. **Color relationships**: Which colors appear? Are they grouped? Is there a foreground/background distinction?
4. **Transformation clues**: Compare input regions to output regions. What changed? Was it a fill, a copy, a rotation, a reflection, a color swap?
5. **Object identification**: Connected groups of same-colored cells often form "objects". Count them, note their shapes and positions.

#### Multi-Level Learning

Games have multiple levels (typically 5). The SAME rule applies across all levels. Use this to your advantage:
- On level 1: experiment to discover what actions do
- On levels 2+: apply the rule you learned from earlier levels
- If you fail a level and reset, try a different approach using what you learned

#### Game Type Recognition

Identify the game type from the available actions:

- **Keyboard-only games** (ACTION1-ACTION5, no complex actions): Actions control transformations, movements, or selections. Effects may be subtle -- compare frames cell-by-cell after each action.
- **Click-only games** (only ACTION6 with `is_complex: true`): Require x,y coordinates targeting specific grid cells. You must figure out WHERE to click.
- **Hybrid games** (keyboard + click): Keyboard actions may change mode/state, click actions target cells. Try keyboard actions first to understand modes.

#### Troubleshooting: When Actions Seem to Do Nothing

This is common and does NOT mean the action failed. Possible reasons and strategies:

1. **Subtle changes**: The effect may be a single cell changing in a border or counter area. Compare frames cell-by-cell, especially in header/UI regions (rows 0-10) and status areas.
2. **Click targeting**: For click games, try clicking on:
   - Empty (0-value) cells in the target area
   - Colored cells within bordered regions
   - Border edges or intersections
   - Cells at specific grid coordinates matching a pattern you see
3. **State changes without visual change**: Some actions change internal state (like selecting a color or tool) without changing the visible grid. Try an action, then try a click -- the click behavior may differ based on the prior action.
4. **Wrong area**: You may be clicking outside the interactive region. Focus clicks within bordered areas that contain the target/work zone.
5. **Energy/resource constraints**: Some games have resource bars that deplete with each action. If a bar is shrinking, choose actions more carefully.

### 3c: Choose and Submit an Action

Based on your analysis, select an action from `available_actions`.

**Simple actions** (where `action_details[action].is_complex` is `false`):
- Just provide the action name. No additional data needed.

**Complex actions** (where `action_details[action].is_complex` is `true`):
- You must also provide `x` and `y` coordinates (integers) indicating a position on the grid.
- `x` is the column index (0-based from left)
- `y` is the row index (0-based from top)

Submit the action by writing an action request JSON file and running the game driver:

```bash
$VENV_PYTHON -c "
import json
run_dir = '.arc-agi-benchmarks/runs/<RUN_ID>'
request = {
    'command': 'step',
    'action': 'ACTION_NAME_HERE',
    'reasoning': {'thought': 'YOUR_REASONING_HERE'}
}
# For complex actions (is_complex=True), add data with x,y coordinates:
# request['data'] = {'x': COLUMN, 'y': ROW}
with open(f'{run_dir}/action_request.json', 'w') as f:
    json.dump(request, f)
"
$VENV_PYTHON .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py \
  .arc-agi-benchmarks/runs/<RUN_ID> \
  <GAME_ID> \
  <SEED> \
  .arc-agi-benchmarks/runs/<RUN_ID>/action_request.json
```

Replace the following angle-bracket placeholders in the Python code with actual values (embed literals directly):
- `<RUN_ID>`: the current run ID (embed as a Python string literal)
- `<GAME_ID>`: the current game ID (embed as a Python string literal)
- `<SEED>`: the seed value (embed as a Python integer literal)
- `ACTION_NAME_HERE`: the GameAction enum name (e.g., `ACTION1`, `ACTION3`)
- `YOUR_REASONING_HERE`: your reasoning for this action
- For complex actions, uncomment the `request['data']` line and set `COLUMN` (x) and `ROW` (y) to integer values

**IMPORTANT**: Action parameters (action name, reasoning, coordinates) are written to a JSON file and read by the driver script. This avoids shell injection and SyntaxError issues. Never embed free-form text directly in Python source via shell variables.

**IMPORTANT**: Parse only the LAST line of stdout as JSON. The driver may print INFO log lines before the JSON result. Alternatively, read `observation_<GAME_ID>.json` from the run directory.

### 3d: Evaluate the Result

After each step, check the `state` field in the observation:

| State | Meaning | Action |
|-------|---------|--------|
| `NOT_FINISHED` | Game continues | Go back to 3b (observe and reason) |
| `WIN` | All levels completed! | Report success, proceed to next game |
| `GAME_OVER` | Failed the current level | Check reset budget (see below) |

**On GAME_OVER:**

Check the session's reset count from the observation output (`resets` field):

If `resets < max_resets`:
- Issue a reset command through the game driver:

```bash
$VENV_PYTHON -c "
import json
run_dir = '.arc-agi-benchmarks/runs/<RUN_ID>'
request = {'command': 'reset'}
with open(f'{run_dir}/action_request.json', 'w') as f:
    json.dump(request, f)
"
$VENV_PYTHON .arc-agi-benchmarks/runs/<RUN_ID>/game_driver.py \
  .arc-agi-benchmarks/runs/<RUN_ID> \
  <GAME_ID> \
  <SEED> \
  .arc-agi-benchmarks/runs/<RUN_ID>/action_request.json
```

Then go back to **3b** (observe and reason) using the new observation. Rethink your strategy based on what you learned.

If `resets >= max_resets`: Report failure for this game and proceed to the next game.

**On max steps exceeded** (step_number >= max_steps): Report timeout for this game and proceed to the next game.

### 3e: Report Game Progress

After completing (or abandoning) each game, report:

```
Game: <game_id> | State: <WIN/GAME_OVER/TIMEOUT> | Levels: <completed>/<total> | Steps: <N> | Resets: <N>
```

## Step 4: Finalize the Run

After all games have been played:

### 4a: Close Scorecard and Save Results

Run the finalization script from the plugin's scripts directory. The script replays all games to populate the scorecard, then saves scorecard.json, game-results.json, and updates run-meta.json.

```bash
$VENV_PYTHON plugins/arc-agi-benchmarker/skills/run-benchmark/scripts/finalize.py \
  .arc-agi-benchmarks/runs/<RUN_ID> \
  <SEED>
```

**NOTE**: Find the finalize.py script in the same location as game_driver.py (plugin root or cache). If the path doesn't work, try:
```bash
find ~/.claude/plugins -path "*/arc-agi-benchmarker/*/scripts/finalize.py" -exec $VENV_PYTHON {} .arc-agi-benchmarks/runs/<RUN_ID> <SEED> \;
```

The script reads `game_ids` from `run-meta.json` automatically.

### 4b: Generate Environment Scores

Run the environment scores script:

```bash
$VENV_PYTHON plugins/arc-agi-benchmarker/skills/run-benchmark/scripts/env_scores.py \
  .arc-agi-benchmarks/runs/<RUN_ID>
```

Same path resolution as finalize.py.

### 4c: Print Final Summary

After all files are saved, print a summary:

```
============================================
  ARC-AGI Benchmark Run Complete
============================================

  Run ID:           <run_id>
  Games Played:     <N>
  Overall Score:    <score>
  Levels Completed: <completed> / <total>
  Total Actions:    <N>
  Duration:         <seconds>s

  Per-Game Results:
  +-----------+-------+--------+---------+--------+
  | Game      | Score | Levels | Actions | State  |
  +-----------+-------+--------+---------+--------+
  | bt11      | 85.2  | 4/5    | 32      | G_OVER |
  | ls20      | 100.0 | 5/5    | 20      | WIN    |
  +-----------+-------+--------+---------+--------+

  Results saved to: .arc-agi-benchmarks/runs/<run_id>/
============================================
```

## Important: Session Management Across Games

Each game uses its own session file from the start: `session_<game_id>.json`. The game driver script creates and updates this file automatically. There is no generic `session.json` -- each game is isolated by design.

This means:
- **No renaming or copying** of session files is needed between games
- The finalization step (Step 4a) reads each `session_<game_id>.json` directly to replay actions and build the final scorecard
- Resets do NOT re-initialize the session. A reset appends `{'is_reset': True}` to the action history and increments the reset counter. The session file is updated in-place. Only the `init` command creates a fresh session, which happens once per game at the start.

## Important: GameAction Enum Gotcha

**NEVER construct GameAction by integer value**: `GameAction(6)` will raise `ValueError: 6 is not a valid GameAction` because the enum internally uses composite tuple values.

**ALWAYS use name-based lookup**: `GameAction['ACTION6']` works correctly.

This applies everywhere: the game driver replay loop, the finalization replay, and any custom scripts.

## Error Handling

### Game Initialization Failure
If `arc.make()` fails for a game:
- Log the error
- Skip that game
- Continue with the next game
- Mark as "failed" in the results

### Step Execution Failure
If `env.step()` raises an exception:
- Log the error and the action that caused it
- Treat it as a GAME_OVER
- Use a reset if budget allows, otherwise skip the game

### Stdout JSON Parsing
The game driver prints INFO log lines from arc_agi before the JSON result. To parse correctly:
- **Option A**: Read only the LAST line of stdout as JSON
- **Option B**: Read `observation_<GAME_ID>.json` from the run directory (the driver writes this file on every invocation)
- **Option C**: Redirect stderr in the shell command (INFO logs go to stdout unfortunately, not stderr, so this does not help -- use Option A or B)

### Recording Collection
Recordings are automatically saved by arcengine when `save_recording=True`. They are stored under the `recordings_dir` you passed to `Arcade()`, using the naming convention `{game_id}.{agent_type}.{max_actions}.{guid}.recording.jsonl` (within a scorecard ID subdirectory). After the run, verify recordings exist:

```bash
ls .arc-agi-benchmarks/runs/<run_id>/recordings/
# Recordings will be in subdirectories under the scorecard ID
```

### Run Interruption
If the benchmark is interrupted:
- The `run-meta.json` will still have `status: "running"`
- Session files will contain the last action history
- The user can manually inspect partial results
- A future resume feature could pick up from the session files

## Action Selection Strategy

When choosing actions, follow this approach:

1. **First level of a new game**: You have no prior knowledge. Try actions systematically:
   - Start with ACTION1. Observe what changes in the grid.
   - Try each action once to understand what it does.
   - Most ARC-AGI actions perform grid transformations (rotate, flip, fill, move, etc.)

2. **Subsequent levels**: Apply the rule you discovered:
   - The same transformation logic applies, just on a larger grid.
   - Plan the action sequence based on the pattern.
   - Execute efficiently (fewer actions = higher score).

3. **Complex actions** (requiring x,y):
   - These usually target a specific cell in the grid.
   - Choose coordinates based on the pattern you identified.
   - Common uses: selecting a cell to fill, marking a position, choosing a pivot point.

4. **When stuck**:
   - Re-examine the grid carefully.
   - Consider that the rule might be simpler than you think.
   - Look at what changed after each action.
   - Try the RESET action if available (counts as a reset).

## Scoring Reference

Your score depends on efficiency. Scores are on a **0.0 to 1.0 scale** internally (multiplied by 100 only for display):
- **Level score**: `min((baseline_actions / your_actions) ^ 2, 1.0)`
  - At baseline: score = 1.0 (displayed as 100)
  - At 2x baseline: score = 0.25 (displayed as 25)
  - At 3x baseline: score = 0.111 (displayed as 11.1)
- **Game score**: Weighted average of level scores (later levels weighted more). Formula: `game_score = sum(level_score[i] * (i+1)) / sum(range(1, n_levels+1))`. For example, with 5 levels the denominator is 1+2+3+4+5=15, and level 3's score is multiplied by 3.
- **Overall score**: Average across all game scores

**Maximize your score by using as few actions as possible to complete each level.**

## Notes

- Always use `render_mode=None`. NEVER use `terminal-fast` -- it produces ANSI escape codes you cannot parse.
- Always use `$VENV_PYTHON` (the shell variable set in Step 1a), never system Python.
- The `reasoning` parameter in `env.step()` must be a **dict** (e.g., `reasoning={'thought': 'your reasoning here'}`). The API expects `dict[str, Any]`, not a plain string.
- Frame data is always 64x64. Focus on identifying regions, borders, and patterns rather than printing the entire grid.
- Always read `operation_mode` from config: `OperationMode(cfg.get('operation_mode', 'normal'))`. Do NOT hardcode `OperationMode.OFFLINE`.
- The `get_scorecard()` method returns a JSON string (via `str()`). Call it BEFORE `close_scorecard()`. The `close_scorecard()` return value is an `EnvironmentScorecard` object -- do NOT use `model_dump()` on it (it doesn't work). Use `json.loads(str(arc.get_scorecard()))` instead.

## Step 5: Generate Report

After the benchmark run is complete and the final summary has been printed, invoke the report skill to generate a formatted report:

> Now invoke `/arc-agi-benchmarker:report` to generate the benchmark report for this run.
