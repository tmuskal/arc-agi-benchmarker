---
description: Generate and display comprehensive reports from completed ARC-AGI benchmark runs - shows scores, per-game breakdowns, and performance analysis
---

# ARC-AGI Report

You are generating a report from a completed ARC-AGI benchmark run. This skill reads run data, computes derived metrics, and produces a formatted markdown report.

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

## Step 2: Parse User Arguments

The user may provide arguments after `/arc-report`. Parse them as follows:

| Argument | Format | Default | Example |
|----------|--------|---------|---------|
| Run ID | UUID or `latest` | `latest` | `abc123...` |
| `--format` | `markdown` / `json` / `summary` | `markdown` | `--format json` |

- If no run ID is provided, default to `latest`.
- If `--format` is not specified, default to `markdown`.

## Step 3: Resolve Run ID

### 3a: Resolve `latest` Alias

If the run ID is `latest` (or no run ID was provided), resolve it to the most recent completed run:

```bash
$VENV_PYTHON -c "
import json, os, sys

runs_dir = '.arc-agi-benchmarks/runs'
if not os.path.isdir(runs_dir):
    print(json.dumps({'error': 'No runs directory found. Run /arc-benchmark first.'}))
    sys.exit(1)

runs = []
for run_dir_name in os.listdir(runs_dir):
    meta_path = os.path.join(runs_dir, run_dir_name, 'run-meta.json')
    if os.path.isfile(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            if meta.get('status') == 'completed':
                runs.append({
                    'run_id': meta.get('run_id', run_dir_name),
                    'timestamp': meta.get('timestamp', ''),
                    'dir_name': run_dir_name
                })
        except (json.JSONDecodeError, KeyError):
            pass

if not runs:
    print(json.dumps({'error': 'No completed runs found. Run /arc-benchmark first.'}))
    sys.exit(1)

runs.sort(key=lambda r: r['timestamp'], reverse=True)
latest = runs[0]
print(json.dumps(latest))
"
```

### 3b: Validate Run ID

If a specific run ID was provided (not `latest`), verify the run directory exists:

```bash
$VENV_PYTHON -c "
import json, os, sys

run_id = '<RUN_ID>'
run_dir = '.arc-agi-benchmarks/runs/' + run_id

if not os.path.isdir(run_dir):
    # List available run IDs for the user
    runs_dir = '.arc-agi-benchmarks/runs'
    available = []
    if os.path.isdir(runs_dir):
        for d in os.listdir(runs_dir):
            meta_path = os.path.join(runs_dir, d, 'run-meta.json')
            if os.path.isfile(meta_path):
                available.append(d[:8] + '...')
    print(json.dumps({'error': 'Run not found', 'run_id': run_id, 'available_runs': available}))
    sys.exit(1)

print(json.dumps({'run_id': run_id, 'run_dir': run_dir}))
"
```

**IMPORTANT**: Replace `<RUN_ID>` with the actual run ID string literal.

## Step 4: Load Run Data

Load all data files from the resolved run directory:

```bash
$VENV_PYTHON -c "
import json, os, sys

run_id = '<RUN_ID>'
run_dir = '.arc-agi-benchmarks/runs/' + run_id

# Load run metadata
meta_path = os.path.join(run_dir, 'run-meta.json')
if not os.path.isfile(meta_path):
    print(json.dumps({'error': 'run-meta.json not found in run directory'}))
    sys.exit(1)

with open(meta_path) as f:
    meta = json.load(f)

# Load scorecard
scorecard_path = os.path.join(run_dir, 'scorecard.json')
if not os.path.isfile(scorecard_path):
    print(json.dumps({
        'error': 'scorecard.json not found',
        'run_status': meta.get('status', 'unknown'),
        'message': 'The run may not have completed. Check run-meta.json for status.'
    }))
    sys.exit(1)

with open(scorecard_path) as f:
    scorecard = json.load(f)

# Load environment scores if available (optional)
env_scores_path = os.path.join(run_dir, 'environment-scores.json')
env_scores = None
if os.path.isfile(env_scores_path):
    with open(env_scores_path) as f:
        env_scores = json.load(f)

print(json.dumps({
    'meta': meta,
    'scorecard': scorecard,
    'env_scores': env_scores,
    'has_env_scores': env_scores is not None
}))
"
```

**IMPORTANT**: Replace `<RUN_ID>` with the actual resolved run ID string literal.

If `scorecard.json` is missing, report the error with the run status from `run-meta.json` and stop.

If `environment-scores.json` is missing, derive the data from `scorecard.json` in the report generation step.

## Step 5: Generate Report

Generate the full report using the loaded data. Write a Python script that produces the markdown report:

```bash
$VENV_PYTHON -c "
import json, os, sys

run_id = '<RUN_ID>'
run_dir = '.arc-agi-benchmarks/runs/' + run_id
output_format = '<FORMAT>'  # 'markdown', 'json', or 'summary'

with open(os.path.join(run_dir, 'run-meta.json')) as f:
    meta = json.load(f)

with open(os.path.join(run_dir, 'scorecard.json')) as f:
    scorecard = json.load(f)

# Extract overall stats from scorecard
overall_score = scorecard.get('score', 0)
total_envs = scorecard.get('total_environments', 0)
total_envs_completed = scorecard.get('total_environments_completed', 0)
total_levels = scorecard.get('total_levels', 0)
total_levels_completed = scorecard.get('total_levels_completed', 0)
total_actions = scorecard.get('total_actions', 0)
card_id = scorecard.get('card_id', '')
competition_mode = scorecard.get('competition_mode', '')

# Build per-environment data from scorecard games
games_data = []
for game_entry in scorecard.get('games', []):
    gid = game_entry.get('id', '')
    game_score = game_entry.get('score')
    game_runs = game_entry.get('runs', [])
    # Fallback: if game-level score is missing, derive from best run score
    if game_score is None and game_runs:
        game_score = max(run.get('score', 0) for run in game_runs)
    if game_score is None:
        game_score = 0
    best_run = max(game_runs, key=lambda r: r.get('score', 0)) if game_runs else {}

    levels_completed = best_run.get('levels_completed', 0)
    num_levels = best_run.get('number_of_levels', 5)
    actions = best_run.get('actions', 0)
    resets = best_run.get('resets', 0)
    state = best_run.get('state', 'NOT_PLAYED')
    level_scores = best_run.get('level_scores', [])
    level_actions = best_run.get('level_actions', [])
    level_baselines = best_run.get('level_baseline_actions', [])

    games_data.append({
        'game_id': gid,
        'score': game_score,
        'levels_completed': levels_completed,
        'num_levels': num_levels,
        'actions': actions,
        'resets': resets,
        'state': state,
        'level_scores': level_scores,
        'level_actions': level_actions,
        'level_baselines': level_baselines
    })

# Sort by score descending
games_data.sort(key=lambda g: g['score'], reverse=True)

# --- Section 1: Header / Summary ---
harness_config = meta.get('harness_config', {})
model = harness_config.get('model', 'unknown')
plugins = harness_config.get('plugins', [])

lines = []
lines.append('# ARC-AGI Benchmark Report')
lines.append('')
lines.append('- **Run ID**: ' + run_id)
lines.append('- **Date**: ' + meta.get('timestamp', 'unknown'))
lines.append('- **Duration**: ' + str(round(meta.get('duration_seconds', 0), 1)) + 's')
lines.append('- **Harness**: ' + meta.get('harness', 'unknown') + ' (model: ' + model + ')')
lines.append('- **Game Set**: ' + meta.get('game_set', 'unknown') + ' (' + str(len(games_data)) + ' games)')
lines.append('- **Seed**: ' + str(meta.get('seed', 0)))
if card_id:
    lines.append('- **Card ID**: ' + card_id)
if competition_mode:
    lines.append('- **Competition Mode**: ' + str(competition_mode))
lines.append('- **Overall Score**: ' + str(round(overall_score * 100, 1)) + ' / 100')
lines.append('- **Environments Completed**: ' + str(total_envs_completed) + ' / ' + str(total_envs))
lines.append('- **Levels Completed**: ' + str(total_levels_completed) + ' / ' + str(total_levels))
lines.append('- **Total Actions**: ' + str(total_actions))
# Total Resets: sum resets across all best runs
total_resets = sum(g['resets'] for g in games_data)
lines.append('- **Total Resets**: ' + str(total_resets))
if plugins:
    lines.append('- **Plugins**: ' + ', '.join(plugins))
lines.append('')

header = chr(10).join(lines)

# --- Section 2: Per-Environment Breakdown ---
env_lines = []
env_lines.append('## Per-Environment Breakdown')
env_lines.append('')
env_lines.append('| Game ID | Score | Levels | Actions | Resets | State |')
env_lines.append('|---------|-------|--------|---------|--------|-------|')
for g in games_data:
    score_display = str(round(g['score'] * 100, 1))
    levels_display = str(g['levels_completed']) + '/' + str(g['num_levels'])
    env_lines.append('| ' + g['game_id'] + ' | ' + score_display + ' | ' + levels_display + ' | ' + str(g['actions']) + ' | ' + str(g['resets']) + ' | ' + g['state'] + ' |')
env_lines.append('')
env_table = chr(10).join(env_lines)

# --- Section 3: Per-Level Detail ---
detail_lines = []
detail_lines.append('## Per-Level Detail')
detail_lines.append('')
for g in games_data:
    score_display = str(round(g['score'] * 100, 1))
    detail_lines.append('### ' + g['game_id'] + ' (Score: ' + score_display + ')')
    detail_lines.append('')
    detail_lines.append('| Level | Score | Actions | Baseline | Efficiency (lower=better) |')
    detail_lines.append('|-------|-------|---------|----------|----------------------------|')
    for i in range(g['num_levels']):
        lscore = g['level_scores'][i] * 100 if i < len(g['level_scores']) else 0.0
        lactions = g['level_actions'][i] if i < len(g['level_actions']) else 0
        lbaseline = g['level_baselines'][i] if i < len(g['level_baselines']) else 0

        if lactions > 0 and lbaseline > 0:
            efficiency = str(round(lactions / lbaseline, 2)) + 'x'
        else:
            efficiency = '--'

        lscore_str = str(round(lscore, 1)) if lactions > 0 else '0.0'
        lactions_str = str(lactions) if lactions > 0 else '--'
        lbaseline_str = str(lbaseline) if lbaseline > 0 else '--'

        detail_lines.append('| ' + str(i + 1) + ' | ' + lscore_str + ' | ' + lactions_str + ' | ' + lbaseline_str + ' | ' + efficiency + ' |')
    detail_lines.append('')
level_detail = chr(10).join(detail_lines)

# --- Section 4: Performance Analysis ---
analysis_lines = []
analysis_lines.append('## Performance Analysis')
analysis_lines.append('')

# Best and worst games
if len(games_data) >= 1:
    best = games_data[:min(3, len(games_data))]
    worst = [g for g in reversed(games_data) if g not in best][:3]

    analysis_lines.append('### Best Performing Games')
    analysis_lines.append('')
    for i, g in enumerate(best, 1):
        analysis_lines.append(str(i) + '. **' + g['game_id'] + '**: ' + str(round(g['score'] * 100, 1)) + ' (' + str(g['levels_completed']) + '/' + str(g['num_levels']) + ' levels)')
    analysis_lines.append('')

    if worst:
        analysis_lines.append('### Worst Performing Games')
        analysis_lines.append('')
        for i, g in enumerate(worst, 1):
            analysis_lines.append(str(i) + '. **' + g['game_id'] + '**: ' + str(round(g['score'] * 100, 1)) + ' (' + str(g['levels_completed']) + '/' + str(g['num_levels']) + ' levels)')
        analysis_lines.append('')

# Overall efficiency
total_baseline = 0
total_taken = 0
for g in games_data:
    for i in range(len(g['level_baselines'])):
        if i < len(g['level_actions']) and g['level_actions'][i] > 0:
            total_baseline += g['level_baselines'][i]
            total_taken += g['level_actions'][i]

if total_baseline > 0 and total_taken > 0:
    overall_eff = total_taken / total_baseline
    analysis_lines.append('### Overall Efficiency')
    analysis_lines.append('')
    analysis_lines.append('- **Total actions taken**: ' + str(total_taken))
    analysis_lines.append('- **Total baseline actions**: ' + str(total_baseline))
    analysis_lines.append('- **Efficiency ratio**: ' + str(round(overall_eff, 2)) + 'x (lower is better; 1.00x = optimal)')
    analysis_lines.append('')

# Level progression
if games_data:
    max_levels = max(g['num_levels'] for g in games_data)
    analysis_lines.append('### Level Progression')
    analysis_lines.append('')
    for level_idx in range(max_levels):
        games_with_level = [g for g in games_data if g['num_levels'] > level_idx]
        completed_at_level = sum(
            1 for g in games_with_level
            if level_idx < len(g['level_scores']) and g['level_scores'][level_idx] > 0
        )
        total_at_level = len(games_with_level)
        if total_at_level > 0:
            pct = completed_at_level / total_at_level * 100
            analysis_lines.append('- Level ' + str(level_idx + 1) + ': ' + str(completed_at_level) + '/' + str(total_at_level) + ' (' + str(round(pct)) + '%)')
    analysis_lines.append('')

# Failure analysis
game_over_games = [g for g in games_data if g['state'] == 'GAME_OVER']
if game_over_games:
    analysis_lines.append('### Failure Analysis')
    analysis_lines.append('')
    analysis_lines.append('Games ending in GAME_OVER:')
    analysis_lines.append('')
    for g in game_over_games:
        failed_level = g['levels_completed'] + 1
        analysis_lines.append('- **' + g['game_id'] + '**: Failed at level ' + str(failed_level) + ' after ' + str(g['actions']) + ' actions (' + str(g['resets']) + ' resets)')
    analysis_lines.append('')

analysis = chr(10).join(analysis_lines)

# Assemble the full report
if output_format == 'summary':
    report = header
elif output_format == 'json':
    report_json = {
        'run_id': run_id,
        'timestamp': meta.get('timestamp'),
        'duration_seconds': meta.get('duration_seconds', 0),
        'harness': meta.get('harness'),
        'model': model,
        'game_set': meta.get('game_set'),
        'seed': meta.get('seed', 0),
        'overall_score': overall_score * 100,
        'total_environments': total_envs,
        'total_environments_completed': total_envs_completed,
        'total_levels': total_levels,
        'total_levels_completed': total_levels_completed,
        'total_actions': total_actions,
        'total_resets': total_resets,
        'games': games_data
    }
    report = json.dumps(report_json, indent=2, default=str)
else:
    report = header + env_table + level_detail + analysis

# Always save markdown report to run directory
if output_format != 'summary':
    if output_format == 'json':
        with open(os.path.join(run_dir, 'report.json'), 'w') as f:
            f.write(report)
    # Always save the markdown version
    markdown_report = header + env_table + level_detail + analysis
    with open(os.path.join(run_dir, 'report.md'), 'w') as f:
        f.write(markdown_report)

print(report)
"
```

**IMPORTANT**: Replace `<RUN_ID>` with the actual resolved run ID string literal and `<FORMAT>` with the actual format string (`markdown`, `json`, or `summary`).

## Step 6: Display Report

Print the generated report to the console. The raw markdown output from Step 5 is suitable for display -- Claude Code renders markdown well.

For `--format summary`, only the header section is printed (no file is saved).

For `--format markdown` (default), the full report is printed and saved to `<run_dir>/report.md`.

For `--format json`, the JSON report is printed and saved to `<run_dir>/report.json`. The markdown version is also saved to `<run_dir>/report.md`.

Tell the user where the report was saved:

```
Report saved to: .arc-agi-benchmarks/runs/<RUN_ID>/report.md
```

## Score Display Convention

Scores in the scorecard are stored on a 0.0-1.0 scale. For display in the report, multiply by 100:
- Scorecard `score: 0.852` displays as `85.2`
- Scorecard `score: 1.0` displays as `100.0`
- Scorecard `score: 0.0` displays as `0.0`

## Derived Metrics

The report does NOT recalculate scores from the scorecard -- it reads them as-is. But it computes these derived metrics:

- **Efficiency ratio**: `actions_taken / baseline_actions` (per level and aggregate). Lower is better. A ratio of 1.00x means optimal play.
- **Level progression rate**: `games_completed_at_level_N / total_games_with_level_N` for each level index
- **Failure analysis**: Which games ended in GAME_OVER and at which level

## Error Handling

### Run ID Not Found
If the specified run ID directory does not exist:
> Run `<run_id>` not found.
> Available runs: <list of available run IDs (first 8 chars)>
> Use `latest` to select the most recent completed run.

### No Completed Runs (for `latest`)
If no completed runs exist:
> No completed benchmark runs found.
> Run `/arc-benchmark` to create a benchmark run.

### Missing scorecard.json
If the scorecard file is missing from the run directory:
> scorecard.json not found for run `<run_id>`.
> Run status: `<status from run-meta.json>`
> The run may not have completed successfully.

### Missing environment-scores.json
This is NOT an error. The report derives all needed data from `scorecard.json`. The `environment-scores.json` file is optional and used only for convenience.

### Corrupt or Partial Scorecard
If the scorecard has missing fields:
- Use safe defaults (0 for missing numbers, empty lists for missing arrays)
- Report what data is available
- Flag any missing data in the report with a note
