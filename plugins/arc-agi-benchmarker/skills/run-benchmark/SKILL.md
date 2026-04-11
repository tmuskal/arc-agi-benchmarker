---
description: Execute benchmark runs against ARC-AGI games - plays games with Claude Code as the agent and records scores
---

# ARC-AGI Run Benchmark

You are running an ARC-AGI benchmark. **You are the game-playing agent.** You will observe grid data, reason about patterns, choose actions, and submit them. Your goal is to complete as many levels as possible, as efficiently as possible (fewer actions = higher score).

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
    'game_set': game_selection,  # Store the user's original selection intent: 'all', a tag, or comma-separated IDs
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

Create the game driver script and initialize the game. The driver script is a persistent Python script that maintains Arcade/environment state across action steps for a single game, avoiding the need to recreate the Arcade and replay actions on every step.

First, write the driver script:

```bash
$VENV_PYTHON -c "
import json, os
run_dir = '.arc-agi-benchmarks/runs/<RUN_ID>'
game_id = '<GAME_ID>'
seed = <SEED>

driver_code = '''
import json, sys, os
from arc_agi import Arcade, OperationMode
from arcengine import GameAction

# Read config
with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
run_dir = sys.argv[1]
game_id = sys.argv[2]
seed = int(sys.argv[3])
request_file = sys.argv[4]

recordings_dir = run_dir + '/recordings'

# Read the action request
with open(request_file) as f:
    request = json.load(f)

command = request.get('command', 'init')

# Load session
session_file = os.path.join(run_dir, f'session_{game_id}.json')
if command == 'init':
    session = {
        'game_id': game_id,
        'seed': seed,
        'action_history': [],
        'resets': 0,
        'steps': 0
    }
else:
    with open(session_file) as f:
        session = json.load(f)

# Load or create scorecard ID for consistent identity across invocations
scorecard_id_file = os.path.join(run_dir, 'scorecard_id.txt')
if os.path.exists(scorecard_id_file):
    with open(scorecard_id_file) as f:
        scorecard_id = f.read().strip()
else:
    scorecard_id = None

# Create Arcade and environment with consistent scorecard identity
op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
arc = Arcade(operation_mode=op_mode, environments_dir=env_dir, recordings_dir=recordings_dir)
if scorecard_id is None:
    import uuid as _uuid
    scorecard_id = str(_uuid.uuid4())
    with open(scorecard_id_file, 'w') as f:
        f.write(scorecard_id)

# arc.make() returns an EnvironmentWrapper, NOT a FrameDataRaw observation.
# arc.make() calls reset internally; do NOT call env.reset() again.
env = arc.make(game_id, seed=seed, save_recording=True, render_mode=None, scorecard_id=scorecard_id)
obs = env.observation_space  # Get the initial FrameDataRaw observation

# Replay all previous actions to restore state.
# PERFORMANCE NOTE: This replays the full action history on every invocation,
# resulting in O(n^2) total work across a game session. For games approaching
# max_steps (e.g., 500 steps), replay will be noticeably slow. This is a known
# tradeoff of the stateless driver design.
# FUTURE OPTIMIZATION: Consider checkpointing environment state every N steps
# to reduce replay length, or batching multiple actions per driver invocation.
for prev in session.get('action_history', []):
    if prev.get('is_reset'):
        obs = env.reset()
    else:
        action = GameAction(prev['action_id'])
        step_kwargs = {'action': action}
        if prev.get('data'):
            step_kwargs['data'] = prev['data']
        if prev.get('reasoning'):
            step_kwargs['reasoning'] = prev['reasoning']
        obs = env.step(**step_kwargs)
    if obs is None:
        print(json.dumps({'error': 'env.step() or env.reset() returned None during replay'}))
        sys.exit(1)

# Execute the requested command
if command == 'init':
    pass  # obs already has the initial state from make()
elif command == 'step':
    action_name = request['action']
    action = GameAction[action_name]
    step_kwargs = {'action': action}
    if request.get('data'):
        step_kwargs['data'] = request['data']
    if request.get('reasoning'):
        step_kwargs['reasoning'] = request['reasoning']
    obs = env.step(**step_kwargs)
    if obs is None:
        print(json.dumps({'error': f'env.step() returned None for action {action_name}'}))
        sys.exit(1)

    # Update session - store action_id (int) for replay via GameAction(int)
    entry = {'action': action_name, 'action_id': action.value}
    if request.get('data'):
        entry['data'] = request['data']
    if request.get('reasoning'):
        entry['reasoning'] = request['reasoning']
    session['action_history'].append(entry)
    session['steps'] += 1
elif command == 'reset':
    obs = env.reset()
    if obs is None:
        print(json.dumps({'error': 'env.reset() returned None'}))
        sys.exit(1)
    session['resets'] += 1
    session['action_history'].append({'is_reset': True})

# Extract observation - recursively convert numpy arrays to lists
import numpy as np
def to_serializable(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, list):
        return [to_serializable(x) for x in obj]
    return obj

frame = to_serializable(obs.frame)

# Use env.action_space (returns GameAction objects with .name) instead of
# obs.available_actions (which returns integer IDs, not GameAction objects).
available_actions = []
action_details = {}
for a in env.action_space:
    name = a.name if hasattr(a, 'name') else str(a)
    available_actions.append(name)
    # NOTE: is_complex() returns True when the action requires x,y data.
    action_details[name] = {
        'is_complex': a.is_complex() if hasattr(a, 'is_complex') else False
    }

result = {
    'frame': frame,
    'state': obs.state.name if hasattr(obs.state, 'name') else str(obs.state),
    'levels_completed': getattr(obs, 'levels_completed', 0),
    'win_levels': getattr(obs, 'win_levels', 0),
    'available_actions': available_actions,
    'action_details': action_details,
    'guid': getattr(obs, 'guid', ''),
    'step_number': session['steps'],
    'resets': session['resets']
}

# Save session
with open(session_file, 'w') as f:
    json.dump(session, f)

# Write observation output
obs_file = os.path.join(run_dir, f'observation_{game_id}.json')
with open(obs_file, 'w') as f:
    json.dump(result, f, indent=2)

print(json.dumps(result))
'''

driver_path = os.path.join(run_dir, 'game_driver.py')
with open(driver_path, 'w') as f:
    f.write(driver_code)
print(json.dumps({'driver_path': driver_path}))
"
```

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

Parse the observation JSON output. Note the `frame`, `state`, `available_actions`, and `action_details`.

> **Note on recordings**: Recordings are saved by arcengine using the naming convention `{game_id}.{agent_type}.{max_actions}.{guid}.recording.jsonl` within the recordings directory (under a scorecard ID subdirectory).

### 3b: Observe and Reason About the Grid

**This is where YOU (Claude Code) analyze the game state.**

Read the `frame` data from the observation. The frame is a list of 2D integer arrays (grid layers). Analyze it as follows:

#### How to Read ARC-AGI Grids

1. **Structure**: `frame` is a list of layers. Each layer is a 2D array (rows x columns) of integers.
2. **Colors**: Each integer represents a color. Typical mapping:
   - `0` = black / empty / background
   - `1` through `9` = distinct colors (the exact visual color does not matter; what matters is the pattern of WHICH cells share the same value)
3. **Grid size**: Grids start small (e.g., 3x3 on level 1) and grow with each level (up to 30x30 on level 5). The same transformation rule applies at all sizes.

#### Pattern Analysis Strategy

When observing a frame, look for:

1. **Spatial patterns**: Symmetry (horizontal, vertical, rotational), borders, filled regions, isolated objects
2. **Color relationships**: Which colors appear? Are they grouped? Is there a foreground/background distinction?
3. **Transformation clues**: If you have seen a previous level's input and output, what changed? Was it a fill, a copy, a rotation, a reflection, a color swap?
4. **Object identification**: Connected groups of same-colored cells often form "objects". Count them, note their shapes and positions.
5. **Regularities**: Repeating patterns, grids-within-grids, alternating colors

#### Multi-Level Learning

Games have multiple levels (typically 5). The SAME rule applies across all levels. Use this to your advantage:
- On level 1: experiment to discover what actions do
- On levels 2+: apply the rule you learned from earlier levels
- If you fail a level and reset, try a different approach using what you learned

### 3c: Choose and Submit an Action

Based on your analysis, select an action from `available_actions`.

**Simple actions** (where `action_details[action].is_complex` is `false`):
- Just provide the action name. No additional data needed.

**Complex actions** (where `action_details[action].is_complex` is `true`):
- You must also provide `x` and `y` coordinates (integers) indicating a position on the grid.
- `x` is the column index (0-based from left)
- `y` is the row index (0-based from top)

Submit the action by writing an action request JSON file and running the game driver. This avoids shell variable injection issues and keeps state management clean:

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
- `ACTION_NAME_HERE`: the GameAction enum name (e.g., `ACTION1`, `ACTION3`) -- write this as a JSON string value in the Python dict
- `YOUR_REASONING_HERE`: your reasoning for this action -- write this as a string value inside a dict, e.g., `{'thought': 'your reasoning'}`. The API expects `reasoning` to be `dict[str, Any]`.
- For complex actions, uncomment the `request['data']` line and set `COLUMN` (x) and `ROW` (y) to integer values

**IMPORTANT**: Action parameters (action name, reasoning, coordinates) are written to a JSON file and read by the driver script. This avoids shell injection and SyntaxError issues that occur with string interpolation. Never embed free-form text directly in Python source via shell variables.

### 3d: Evaluate the Result

After each step, check the `state` field in the observation:

| State | Meaning | Action |
|-------|---------|--------|
| `PLAYING` | Game continues | Go back to 3b (observe and reason) |
| `WIN` | All levels completed! | Report success, proceed to next game |
| `GAME_OVER` | Failed the current level | Check reset budget (see below) |

**On GAME_OVER:**

Load the session to check reset count:

```bash
$VENV_PYTHON -c "
import json
run_dir = '.arc-agi-benchmarks/runs/<RUN_ID>'
with open(f'{run_dir}/session_<GAME_ID>.json') as f:
    session = json.load(f)
print(json.dumps({'resets': session['resets'], 'steps': session['steps']}))
"
```

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

Write a Python script that does the following (embed `run_dir`, `game_ids`, and `seed` as literal values -- do NOT use shell variable interpolation):

```python
import json, os
from arc_agi import Arcade, OperationMode
from arcengine import GameAction

run_dir = '<RUN_DIR>'  # embed literal value
game_ids = [...]       # embed literal list
seed = 0               # embed literal value

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
recordings_dir = run_dir + '/recordings'

# Load the scorecard ID that was used during gameplay
scorecard_id_file = os.path.join(run_dir, 'scorecard_id.txt')
with open(scorecard_id_file) as f:
    scorecard_id = f.read().strip()

# Create Arcade and replay all games to populate the scorecard.
# NOTE: This creates a new Arcade instance with a new internal scorecard.
# We pass scorecard_id to arc.make() so recordings are filed under the same
# scorecard directory used during gameplay. However, in OFFLINE mode the new
# Arcade's scorecard is a fresh object -- the scorecard_id parameter only
# controls recording file paths, not scorecard state reattachment.
# This is a known limitation: the finalization scorecard is rebuilt from
# replayed actions, not resumed from the gameplay scorecard.
op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
arc = Arcade(operation_mode=op_mode, environments_dir=env_dir, recordings_dir=recordings_dir)

for game_id in game_ids:
    session_file = f'{run_dir}/session_{game_id}.json'
    if not os.path.exists(session_file):
        continue

    with open(session_file) as f:
        session = json.load(f)

    if session.get('game_id') != game_id:
        continue

    env = arc.make(game_id, seed=seed, save_recording=True, render_mode=None, scorecard_id=scorecard_id)
    # arc.make() returns an EnvironmentWrapper. Do NOT call env.reset() again.

    for prev in session.get('action_history', []):
        if prev.get('is_reset'):
            obs = env.reset()
        else:
            action = GameAction(prev['action_id'])
            step_kwargs = {'action': action}
            if prev.get('data'):
                step_kwargs['data'] = prev['data']
            if prev.get('reasoning'):
                step_kwargs['reasoning'] = prev['reasoning']
            obs = env.step(**step_kwargs)
        if obs is None:
            print(json.dumps({'error': f'Replay returned None for game {game_id}'}))
            break

# Finalize the scorecard (marks it as complete, prevents further updates)
final_scorecard = arc.close_scorecard()

# Save scorecard using model_dump_json for clean serialization
try:
    scorecard_json = final_scorecard.model_dump_json(indent=2)
    with open(f'{run_dir}/scorecard.json', 'w') as f:
        f.write(scorecard_json)
except (AttributeError, TypeError):
    scorecard_dict = final_scorecard.model_dump() if hasattr(final_scorecard, 'model_dump') else {}
    with open(f'{run_dir}/scorecard.json', 'w') as f:
        json.dump(scorecard_dict, f, indent=2, default=str)

print(json.dumps({
    'score': getattr(final_scorecard, 'score', 0),
    'total_environments': getattr(final_scorecard, 'total_environments', 0),
    'total_environments_completed': getattr(final_scorecard, 'total_environments_completed', 0),
    'total_levels_completed': getattr(final_scorecard, 'total_levels_completed', 0),
    'total_levels': getattr(final_scorecard, 'total_levels', 0),
    'total_actions': getattr(final_scorecard, 'total_actions', 0)
}, default=str))
```

### 4b: Generate Environment Scores

Write a Python script that generates environment scores (embed `run_dir` as a literal value -- do NOT use shell variable interpolation):

```python
import json
from arc_agi import Arcade, OperationMode

run_dir = '<RUN_DIR>'  # embed literal value

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')

with open(f'{run_dir}/scorecard.json') as f:
    scorecard = json.load(f)

# Get environment metadata (title, tags) from arc.get_environments(),
# NOT from the scorecard -- the scorecard does not carry this metadata.
op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
arc = Arcade(operation_mode=op_mode, environments_dir=env_dir)
env_list = arc.get_environments()
env_metadata = {}
for e in env_list:
    eid = getattr(e, 'game_id', getattr(e, 'id', str(e)))
    env_metadata[eid] = {
        'title': getattr(e, 'title', eid),
        'tags': getattr(e, 'tags', [])
    }

run_id_from_meta = scorecard.get('card_id', '')
env_scores = {
    'run_id': run_id_from_meta,
    'overall_score': scorecard.get('score', 0) * 100,
    'environments': []
}

# NOTE: The scorecard serializes per-game data under the 'games' field, NOT 'environments'.
for env_entry in scorecard.get('games', []):
    env_id = env_entry.get('id', '')
    env_score = env_entry.get('score', 0)
    runs = env_entry.get('runs', [])

    # Use best run data
    best_run = max(runs, key=lambda r: r.get('score', 0)) if runs else {}

    meta = env_metadata.get(env_id, {})
    env_data = {
        'game_id': env_id,
        'title': meta.get('title', env_id),
        'tags': meta.get('tags', []),
        'score': env_score * 100,
        'levels_completed': best_run.get('levels_completed', 0),
        'total_levels': best_run.get('number_of_levels', 5),
        'total_actions': best_run.get('actions', 0),
        'total_resets': best_run.get('resets', 0),
        'state': best_run.get('state', 'NOT_PLAYED'),
        'completed': best_run.get('completed', False),
        'levels': []
    }

    level_scores = best_run.get('level_scores', [])
    level_actions = best_run.get('level_actions', [])
    level_baselines = best_run.get('level_baseline_actions', [])

    for i in range(len(level_scores)):
        env_data['levels'].append({
            'level_index': i + 1,
            'score': level_scores[i] * 100 if i < len(level_scores) else 0,
            'actions_taken': level_actions[i] if i < len(level_actions) else 0,
            'baseline_actions': level_baselines[i] if i < len(level_baselines) else 0,
            'completed': level_scores[i] > 0 if i < len(level_scores) else False
        })

    env_scores['environments'].append(env_data)

with open(f'{run_dir}/environment-scores.json', 'w') as f:
    json.dump(env_scores, f, indent=2)

print(json.dumps({'status': 'environment-scores.json written', 'environments': len(env_scores['environments'])}))
```

### 4c: Update Run Metadata

Write a Python script that updates run metadata (embed `run_dir` as a literal value -- do NOT use shell variable interpolation):

```python
import json
from datetime import datetime, timezone

run_dir = '<RUN_DIR>'  # embed literal value

with open(f'{run_dir}/run-meta.json') as f:
    meta = json.load(f)

start_time = datetime.fromisoformat(meta['timestamp'])
now = datetime.now(timezone.utc)
meta['duration_seconds'] = (now - start_time).total_seconds()
meta['status'] = 'completed'

with open(f'{run_dir}/run-meta.json', 'w') as f:
    json.dump(meta, f, indent=2)

print(json.dumps({'status': 'completed', 'duration_seconds': meta['duration_seconds']}))
```

### 4d: Print Final Summary

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
- Frame data may be large for higher levels (up to 30x30 grids). Focus on the pattern, not individual cells.
- If frame data is too large to display clearly, extract key features (dimensions, unique colors, border patterns) rather than printing the entire grid.

## Step 5: Generate Report

After the benchmark run is complete and the final summary has been printed, invoke the report skill to generate a formatted report:

> Now invoke `/arc-agi-benchmarker:report` to generate the benchmark report for this run.
