---
description: Explore available ARC-AGI environments - lists games, shows details with ASCII grid visualization, and displays historical scores
---

# ARC-AGI Browse Tests

You are browsing available ARC-AGI environments. This skill lets users explore what games are available, view game details with training examples rendered as ASCII grids, and check historical benchmark scores.

## Step 1: Pre-flight Checks

> **Note**: All relative paths in this skill (e.g., `.arc-agi-benchmarks/`, `.arc-agi-venv/`) assume the current working directory is the project root. Ensure you run all commands from the project root directory.

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

### 1c: Verify arc-agi is Available

```bash
$VENV_PYTHON -c "
from arc_agi import Arcade, OperationMode
from arcengine import GameAction, GameState
print('arc-agi: OK')
"
```

**If this fails**, tell the user to run `/arc-setup` first and stop.

## Step 2: Parse User Arguments

The user may provide arguments after `/arc-browse`. Parse them as follows:

| Argument | Format | Default | Example |
|----------|--------|---------|---------|
| Game ID | bare word | (none -- list mode) | `bt11` |
| `--filter <prefix>` | string prefix | (none) | `--filter ls` |
| `--tag <tag>` | tag name | (none) | `--tag logic` |

- **No arguments**: list all environments (table mode)
- **Single game ID**: show detailed view for that game
- **`--filter <prefix>`**: list environments whose game_id starts with the given prefix
- **`--tag <tag>`**: list environments that have the given tag

## Step 3: List Environments (Table Mode)

This step runs when no specific game ID is provided (with or without filters).

```bash
$VENV_PYTHON -c "
import json, sys, os

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')

from arc_agi import Arcade, OperationMode

op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
arc = Arcade(operation_mode=op_mode, environments_dir=env_dir)
envs = arc.get_environments()

if not envs:
    print('No environments found. Run /arc-setup to configure environments.')
    sys.exit(0)

# Build environment info list
env_list = []
for env in envs:
    game_id = getattr(env, 'game_id', getattr(env, 'id', str(env)))
    tags = getattr(env, 'tags', [])
    level_tags = getattr(env, 'level_tags', [])
    env_list.append({
        'game_id': game_id,
        'tags': tags,
        'level_tags': level_tags
    })

print(json.dumps(env_list))
"
```

**IMPORTANT**: The angle-bracket placeholders in code templates below are NOT shell or Python variables. You MUST substitute them with actual literal values before running the command.

### 3a: Apply Filters

If the user provided `--filter <PREFIX>`, filter the list to only environments whose `game_id` starts with `<PREFIX>`.

If the user provided `--tag <TAG>`, filter the list to only environments whose `tags` list contains `<TAG>`.

### 3b: Check Historical Play Status

For each environment in the filtered list, check if it has been played in any previous benchmark run by scanning existing scorecards:

```bash
$VENV_PYTHON -c "
import json, os

played_games = set()

# Scan standard runs directory
runs_dir = '.arc-agi-benchmarks/runs'
if os.path.isdir(runs_dir):
    for run_dir_name in os.listdir(runs_dir):
        scorecard_path = os.path.join(runs_dir, run_dir_name, 'scorecard.json')
        if os.path.isfile(scorecard_path):
            try:
                with open(scorecard_path) as f:
                    sc = json.load(f)
                for game in sc.get('games', []):
                    played_games.add(game.get('id', ''))
            except (json.JSONDecodeError, KeyError):
                pass

# Also scan cross-harness directories for historical play status
cross_dir = '.arc-agi-benchmarks/cross-harness'
if os.path.isdir(cross_dir):
    for harness_name in os.listdir(cross_dir):
        harness_runs = os.path.join(cross_dir, harness_name, 'runs')
        if os.path.isdir(harness_runs):
            for run_dir_name in os.listdir(harness_runs):
                scorecard_path = os.path.join(harness_runs, run_dir_name, 'scorecard.json')
                if os.path.isfile(scorecard_path):
                    try:
                        with open(scorecard_path) as f:
                            sc = json.load(f)
                        for game in sc.get('games', []):
                            played_games.add(game.get('id', ''))
                    except (json.JSONDecodeError, KeyError):
                        pass

print(json.dumps(list(played_games)))
"
```

### 3c: Display Table

Format the results as an ASCII table. Compute the `Played` column by checking if each game_id is in the set of played games from step 3b.

Display format:

```
+----------+--------+------------------+--------+
| Game ID  | Levels | Tags             | Played |
+----------+--------+------------------+--------+
| bt11     | 5      | logic, pattern   | Yes    |
| ls20     | 5      | spatial          | No     |
+----------+--------+------------------+--------+
```

The `Levels` column defaults to `5` (standard ARC-AGI game structure). If level count metadata is available from the environment, use that instead.

Report the total count at the bottom:

```
Total: <N> environments (<M> matching filter)
```

## Step 4: Detailed Game View

This step runs when a specific game ID is provided as an argument.

### 4a: Load Game Metadata and Initial Frame

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

game_id = '<GAME_ID>'
target_env = None
for env in envs:
    eid = getattr(env, 'game_id', getattr(env, 'id', str(env)))
    if eid == game_id:
        target_env = env
        break

if target_env is None:
    # List similar game IDs for suggestions
    all_ids = [getattr(e, 'game_id', getattr(e, 'id', str(e))) for e in envs]
    similar = [eid for eid in all_ids if game_id[:2] in eid][:5]
    print(json.dumps({'error': 'Game not found', 'game_id': game_id, 'suggestions': similar}))
    sys.exit(1)

tags = getattr(target_env, 'tags', [])
level_tags = getattr(target_env, 'level_tags', [])

# Instantiate the environment to get frame data and action info
env = arc.make(game_id, seed=0, render_mode=None)
try:
    obs = env.observation_space

    frame = obs.frame
    if hasattr(frame, 'tolist'):
        frame = frame.tolist()

    available_actions = []
    action_details = {}
    for a in env.action_space:
        name = a.name if hasattr(a, 'name') else str(a)
        available_actions.append(name)
        action_details[name] = {
            'is_complex': a.is_complex() if hasattr(a, 'is_complex') else False
        }

    result = {
        'game_id': game_id,
        'tags': tags,
        'level_tags': level_tags,
        'frame': frame,
        'state': obs.state.name if hasattr(obs.state, 'name') else str(obs.state),
        'levels_completed': getattr(obs, 'levels_completed', 0),
        'available_actions': available_actions,
        'action_details': action_details,
        'grid_dimensions': {
            'layers': len(frame),
            'rows': len(frame[0]) if frame else 0,
            'cols': len(frame[0][0]) if frame and frame[0] else 0
        }
    }

    print(json.dumps(result))
finally:
    env.close()
"
```

**IMPORTANT**: Replace `<GAME_ID>` with the actual game ID string literal.

### 4b: Display Game Details

Format the output as follows:

```
============================================
  Game: <game_id>
============================================

  Tags:         <tag1>, <tag2>
  Level Tags:   <level_tag1>, <level_tag2>
  Levels:       5
  Grid Size:    <rows> x <cols> (Level 1)
  State:        <state>

  Note: Baseline actions and grid sizes for levels beyond
  Level 1 are only available after playing the game.

  Available Actions:
    - ACTION1 (simple)
    - ACTION2 (simple)
    - ACTION3 (complex - requires x,y)

============================================
```

### 4c: Render ASCII Grid

Render the initial frame as ASCII art using this character mapping:

```
Color Map: 0=.  1=#  2=@  3=+  4=*  5=~  6=^  7=&  8=%  9=!
```

For each layer in the frame, render it as a grid:

```
Layer 0:
     0 1 2 3 4
  0: . . # . .
  1: . # # # .
  2: . . # . .
  3: . . . . .
```

Column indices go across the top, row indices on the left. Each cell is one character, separated by spaces.

For multi-layer frames, render each layer separately with a `Layer N:` header.

Keep rendering compact. If the grid is larger than 20x20, show first 20 rows/cols and note the full dimensions.

## Step 5: Historical Scores

Check for previous benchmark results for this specific game. This applies in detailed view mode only.

```bash
$VENV_PYTHON -c "
import json, os

game_id = '<GAME_ID>'
runs_dir = '.arc-agi-benchmarks/runs'
results = []

if os.path.isdir(runs_dir):
    for run_dir_name in sorted(os.listdir(runs_dir)):
        run_dir_path = os.path.join(runs_dir, run_dir_name)
        scorecard_path = os.path.join(run_dir_path, 'scorecard.json')
        meta_path = os.path.join(run_dir_path, 'run-meta.json')

        if not os.path.isfile(scorecard_path):
            continue

        try:
            with open(scorecard_path) as f:
                sc = json.load(f)
            meta = {}
            if os.path.isfile(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)

            for game in sc.get('games', []):
                if game.get('id') == game_id:
                    game_runs = game.get('runs', [])
                    best_run = max(game_runs, key=lambda r: r.get('score', 0)) if game_runs else {}
                    # Use run_id from metadata if available, fall back to directory name
                    display_run_id = meta.get('run_id', run_dir_name)[:8]
                    # Fallback: derive score from best run if game-level score missing
                    game_score = game.get('score')
                    if game_score is None and game_runs:
                        game_score = max(r.get('score', 0) for r in game_runs)
                    if game_score is None:
                        game_score = 0
                    results.append({
                        'run_id': display_run_id,
                        'date': meta.get('timestamp', 'unknown')[:10],
                        'score': round(game_score * 100, 1),
                        'levels_completed': best_run.get('levels_completed', 0),
                        'total_levels': best_run.get('number_of_levels', 5),
                        'actions': best_run.get('actions', 0)
                    })
        except (json.JSONDecodeError, KeyError):
            pass

# Also scan cross-harness directories for historical scores
cross_dir = '.arc-agi-benchmarks/cross-harness'
if os.path.isdir(cross_dir):
    for harness_name in os.listdir(cross_dir):
        harness_runs = os.path.join(cross_dir, harness_name, 'runs')
        if os.path.isdir(harness_runs):
            for run_dir_name in sorted(os.listdir(harness_runs)):
                run_dir_path = os.path.join(harness_runs, run_dir_name)
                scorecard_path = os.path.join(run_dir_path, 'scorecard.json')
                meta_path = os.path.join(run_dir_path, 'run-meta.json')

                if not os.path.isfile(scorecard_path):
                    continue

                try:
                    with open(scorecard_path) as f:
                        sc = json.load(f)
                    meta = {}
                    if os.path.isfile(meta_path):
                        with open(meta_path) as f:
                            meta = json.load(f)

                    for game in sc.get('games', []):
                        if game.get('id') == game_id:
                            game_runs = game.get('runs', [])
                            best_run = max(game_runs, key=lambda r: r.get('score', 0)) if game_runs else {}
                            display_run_id = meta.get('run_id', run_dir_name)[:8]
                            game_score = game.get('score')
                            if game_score is None and game_runs:
                                game_score = max(r.get('score', 0) for r in game_runs)
                            if game_score is None:
                                game_score = 0
                            results.append({
                                'run_id': display_run_id,
                                'date': meta.get('timestamp', 'unknown')[:10],
                                'score': round(game_score * 100, 1),
                                'levels_completed': best_run.get('levels_completed', 0),
                                'total_levels': best_run.get('number_of_levels', 5),
                                'actions': best_run.get('actions', 0),
                                'harness': harness_name
                            })
                except (json.JSONDecodeError, KeyError):
                    pass

print(json.dumps(results))
"
```

**IMPORTANT**: Replace `<GAME_ID>` with the actual game ID string literal.

Display historical results if any exist:

```
Previous Results:
  Run <run_id_short> (<date>): Score <score>, Levels <completed>/<total>, <actions> actions
  Run <run_id_short> (<date>): Score <score>, Levels <completed>/<total>, <actions> actions
```

If no previous results exist, display:

```
No previous benchmark results found for this game.
```

## Step 6: Game Source (Optional)

If the user specifically asks to see the game source code, attempt to locate and display it:

```bash
$VENV_PYTHON -c "
import json, os

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')

game_id = '<GAME_ID>'

# Try to find the source file in the environments directory
source_path = None
for root, dirs, files in os.walk(env_dir):
    for fname in files:
        if fname.endswith('.py') and game_id in fname.lower():
            source_path = os.path.join(root, fname)
            break
    if source_path:
        break

if source_path and os.path.isfile(source_path):
    with open(source_path) as fh:
        source = fh.read()
    print(json.dumps({'source_path': source_path, 'source': source}))
else:
    print(json.dumps({'source_path': None, 'source': None, 'message': 'Source file not found locally'}))
"
```

**IMPORTANT**: Replace `<GAME_ID>` with the actual game ID string literal.

Only run this step if the user explicitly requests to see the game source. Display the source code if found, otherwise inform the user that the source is not available locally.

## Error Handling

### No Environments Found
If `arc.get_environments()` returns an empty list:
> No environments found. Run `/arc-setup` to configure your environment.
> Check that `environments_dir` in `.arc-agi-benchmarks/config.json` points to a valid directory with game files.

### Game ID Not Found
If the requested game ID does not match any environment:
> Game `<game_id>` not found.
> Did you mean one of these? <list of similar IDs>
> Run `/arc-browse` without arguments to see all available games.

### Corrupt Scorecard Files
If a `scorecard.json` file cannot be parsed:
- Skip that run's historical data silently
- Continue processing other runs
- Do NOT stop or error out

### No Prior Benchmark Runs
The browse skill works fully without any prior benchmark runs. Historical scores simply show "No previous results" in this case.
