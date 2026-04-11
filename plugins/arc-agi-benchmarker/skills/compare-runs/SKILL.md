---
description: Compare two or more ARC-AGI benchmark runs - shows score deltas, config changes, and trends to track improvement or regression
---

# ARC-AGI Compare Runs

You are comparing two or more ARC-AGI benchmark runs to identify improvements, regressions, and trends. This skill reads scorecard data from multiple runs, computes deltas, diffs configurations, and saves a structured comparison.

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

The user may provide arguments after `/arc-compare`. Parse them as follows:

| Argument | Format | Default | Example |
|----------|--------|---------|---------|
| Run IDs | space-separated UUIDs or aliases | (required, minimum 2) | `latest previous` |
| `--tolerance` | float (0-100) | `1.0` | `--tolerance 5.0` |

> **Note**: Unlike the report skill, `/arc-compare` does not support a `--format` flag. Output is always markdown (rendered to console). The structured comparison data is automatically saved as JSON to `.arc-agi-benchmarks/comparisons/`.

**Aliases**:
- `latest`: most recent completed run
- `previous`: second most recent completed run

Minimum 2 run IDs are required. The first run ID is the **baseline**, subsequent runs are **current** (compared against baseline).

If fewer than 2 run IDs are provided, tell the user:
> Usage: `/arc-compare <run1> <run2> [run3 ...]`
> Use `latest` and `previous` as aliases for recent runs.
> Example: `/arc-compare previous latest`

## Step 3: Resolve Run ID Aliases

Resolve `latest` and `previous` aliases to actual run IDs:

```bash
$VENV_PYTHON -c "
import json, os, sys

runs_dir = '.arc-agi-benchmarks/runs'
if not os.path.isdir(runs_dir):
    print(json.dumps({'error': 'No runs directory found. Run /arc-benchmark first.'}))
    sys.exit(1)

completed_runs = []
for run_dir_name in os.listdir(runs_dir):
    meta_path = os.path.join(runs_dir, run_dir_name, 'run-meta.json')
    if os.path.isfile(meta_path):
        try:
            with open(meta_path) as f:
                meta = json.load(f)
            if meta.get('status') == 'completed':
                completed_runs.append({
                    'run_id': meta.get('run_id', run_dir_name),
                    'timestamp': meta.get('timestamp', ''),
                    'dir_name': run_dir_name
                })
        except (json.JSONDecodeError, KeyError):
            pass

completed_runs.sort(key=lambda r: r['timestamp'], reverse=True)

# Also check cross-harness runs
cross_harness_dir = '.arc-agi-benchmarks/cross-harness'
cross_runs = []
if os.path.isdir(cross_harness_dir):
    for harness_name in os.listdir(cross_harness_dir):
        harness_runs_dir = os.path.join(cross_harness_dir, harness_name, 'runs')
        if os.path.isdir(harness_runs_dir):
            for run_dir_name in os.listdir(harness_runs_dir):
                meta_path = os.path.join(harness_runs_dir, run_dir_name, 'run-meta.json')
                if os.path.isfile(meta_path):
                    try:
                        with open(meta_path) as f:
                            meta = json.load(f)
                        if meta.get('status') == 'completed':
                            cross_runs.append({
                                'run_id': meta.get('run_id', run_dir_name),
                                'timestamp': meta.get('timestamp', ''),
                                'dir_name': run_dir_name,
                                'harness': harness_name,
                                'path': os.path.join(harness_runs_dir, run_dir_name)
                            })
                    except (json.JSONDecodeError, KeyError):
                        pass

result = {
    'completed_runs': completed_runs,
    'cross_runs': cross_runs,
    'latest': completed_runs[0]['run_id'] if len(completed_runs) >= 1 else None,
    'previous': completed_runs[1]['run_id'] if len(completed_runs) >= 2 else None
}
print(json.dumps(result))
"
```

Use this output to resolve aliases:
- Replace `latest` with the `latest` run_id from the output
- Replace `previous` with the `previous` run_id from the output

> **Note**: The `latest` and `previous` aliases only resolve against standard runs in `.arc-agi-benchmarks/runs/`. Cross-harness runs are not considered for alias resolution. To compare cross-harness runs, provide their explicit run IDs.

If `latest` is requested but no completed runs exist, tell the user:
> No completed runs found. Run `/arc-benchmark` first.

If `previous` is requested but fewer than 2 completed runs exist, tell the user:
> Only one completed run exists. Need at least 2 runs to compare.
> Run `/arc-benchmark` again and then try `/arc-compare latest previous`.

For specific run IDs (not aliases), verify each one exists as a directory under `.arc-agi-benchmarks/runs/` or `.arc-agi-benchmarks/cross-harness/*/runs/`. If a run ID is not found, list available runs and stop.

## Step 4: Load and Validate Runs

Load scorecard and metadata for each resolved run ID:

```bash
$VENV_PYTHON -c "
import json, os, sys

run_ids = <RUN_IDS_JSON>  # e.g., ['uuid1', 'uuid2']

runs_data = []
for run_id in run_ids:
    # Check standard runs directory first
    run_dir = '.arc-agi-benchmarks/runs/' + run_id
    if not os.path.isdir(run_dir):
        # Check cross-harness directories
        cross_dir = '.arc-agi-benchmarks/cross-harness'
        found = False
        if os.path.isdir(cross_dir):
            for harness in os.listdir(cross_dir):
                candidate = os.path.join(cross_dir, harness, 'runs', run_id)
                if os.path.isdir(candidate):
                    run_dir = candidate
                    found = True
                    break
        if not found:
            print(json.dumps({'error': 'Run not found', 'run_id': run_id}))
            sys.exit(1)

    meta_path = os.path.join(run_dir, 'run-meta.json')
    scorecard_path = os.path.join(run_dir, 'scorecard.json')

    if not os.path.isfile(meta_path):
        print(json.dumps({'error': 'run-meta.json not found', 'run_id': run_id}))
        sys.exit(1)
    if not os.path.isfile(scorecard_path):
        print(json.dumps({'error': 'scorecard.json not found', 'run_id': run_id, 'warning': 'Run may not have completed'}))
        sys.exit(1)

    with open(meta_path) as f:
        meta = json.load(f)
    with open(scorecard_path) as f:
        scorecard = json.load(f)

    # Extract per-game scores
    game_scores = {}
    game_level_scores = {}
    for game in scorecard.get('games', []):
        gid = game.get('id', '')
        # Fallback: if game-level score is missing/zero, derive from best run score
        game_score_val = game.get('score')
        game_runs_list = game.get('runs', [])
        if game_score_val is None and game_runs_list:
            game_score_val = max(run.get('score', 0) for run in game_runs_list)
        if game_score_val is None:
            game_score_val = 0
        game_scores[gid] = game_score_val
        game_runs = game.get('runs', [])
        best_run = max(game_runs, key=lambda r: r.get('score', 0)) if game_runs else {}
        game_level_scores[gid] = {
            'level_scores': best_run.get('level_scores', []),
            'levels_completed': best_run.get('levels_completed', 0),
            'num_levels': best_run.get('number_of_levels', 5),
            'actions': best_run.get('actions', 0),
            'state': best_run.get('state', 'NOT_PLAYED')
        }

    runs_data.append({
        'run_id': run_id,
        'run_dir': run_dir,
        'timestamp': meta.get('timestamp', ''),
        'harness': meta.get('harness', 'unknown'),
        'overall_score': scorecard.get('score', 0),
        'config_hash': meta.get('config_hash', ''),
        'harness_config': meta.get('harness_config', {}),
        'game_set': meta.get('game_set', ''),
        'seed': meta.get('seed', 0),
        'arc_agi_version': meta.get('arc_agi_version', 'unknown'),
        'game_scores': game_scores,
        'game_level_scores': game_level_scores
    })

# Comparability warnings
warnings = []
game_sets = list(set(r['game_set'] for r in runs_data))
if len(game_sets) > 1:
    warnings.append('WARNING: Runs used different game sets: ' + str(game_sets) + '. Game coverage may differ.')

seeds = list(set(r['seed'] for r in runs_data))
if len(seeds) > 1:
    warnings.append('WARNING: Runs used different seeds: ' + str(seeds) + '. Randomization differs.')

versions = list(set(r['arc_agi_version'] for r in runs_data))
if len(versions) > 1:
    warnings.append('WARNING: Runs used different arc-agi versions: ' + str(versions) + '. Scoring may differ.')

import tempfile
tmp_path = os.path.join(tempfile.gettempdir(), 'arc_compare_runs_data.json')
with open(tmp_path, 'w') as tmp_f:
    json.dump({'runs': runs_data, 'warnings': warnings}, tmp_f, default=str)
print(json.dumps({'runs_data_path': tmp_path, 'runs': runs_data, 'warnings': warnings}))
"
```

**IMPORTANT**: Replace `<RUN_IDS_JSON>` with the actual Python list literal of resolved run IDs, e.g., `['abc-123', 'def-456']`.

Display any comparability warnings to the user before proceeding.

## Step 5: Compute Deltas and Generate Comparison

Generate the full comparison output. The first run is the **baseline**, the second is the **current**:

```bash
$VENV_PYTHON -c "
import json, os, sys, uuid, tempfile
from datetime import datetime, timezone

# Load runs_data from temp file written by Step 4
tmp_path = '<RUNS_DATA_PATH>'  # The path returned by Step 4 (e.g., from runs_data_path)
with open(tmp_path) as f:
    step4_data = json.load(f)
runs_data = step4_data['runs']
warnings = step4_data['warnings']
tolerance = <TOLERANCE>  # float, default 1.0

baseline = runs_data[0]
current = runs_data[1] if len(runs_data) >= 2 else None

# --- Overall Delta ---
score_delta = 0
score_delta_pct = 0
if current:
    baseline_score = baseline['overall_score'] * 100
    current_score = current['overall_score'] * 100
    score_delta = current_score - baseline_score
    if baseline_score > 0:
        score_delta_pct = (score_delta / baseline_score) * 100
    else:
        score_delta_pct = 0.0 if score_delta == 0 else float('inf')

    delta_sign = '+' if score_delta >= 0 else ''
    overall_line = 'Overall Score: ' + str(round(baseline_score, 1)) + ' -> ' + str(round(current_score, 1)) + ' (' + delta_sign + str(round(score_delta, 1)) + ', ' + delta_sign + str(round(score_delta_pct, 1)) + '%)'
else:
    overall_line = 'Overall Score: ' + str(round(baseline['overall_score'] * 100, 1))

# --- Per-Environment Delta Table ---
all_game_ids = set()
for r in runs_data:
    all_game_ids.update(r['game_scores'].keys())
all_game_ids = sorted(all_game_ids)

env_deltas = []
if current:
    for gid in all_game_ids:
        b_score = baseline['game_scores'].get(gid)
        c_score = current['game_scores'].get(gid)

        if b_score is not None and c_score is not None:
            delta = (c_score - b_score) * 100
            if delta > tolerance:
                status = 'Improved'
            elif delta < -tolerance:
                status = 'Regressed'
            else:
                status = 'Unchanged'
            env_deltas.append({
                'game_id': gid,
                'baseline_score': b_score * 100,
                'current_score': c_score * 100,
                'delta': delta,
                'status': status
            })
        elif b_score is None and c_score is not None:
            env_deltas.append({
                'game_id': gid,
                'baseline_score': None,
                'current_score': c_score * 100,
                'delta': c_score * 100,
                'status': 'New'
            })
        elif b_score is not None and c_score is None:
            env_deltas.append({
                'game_id': gid,
                'baseline_score': b_score * 100,
                'current_score': None,
                'delta': -(b_score * 100),
                'status': 'Missing'
            })

# Sort: regressions first, then improvements, then unchanged/new/missing
status_order = {'Regressed': 0, 'Improved': 1, 'New': 2, 'Unchanged': 3, 'Missing': 4}
env_deltas.sort(key=lambda d: (status_order.get(d['status'], 5), -abs(d['delta'])))

# --- Per-Level Deltas (for games in both runs) ---
level_deltas_by_game = {}
if current:
    for gid in all_game_ids:
        if gid in baseline['game_level_scores'] and gid in current['game_level_scores']:
            b_levels = baseline['game_level_scores'][gid].get('level_scores', [])
            c_levels = current['game_level_scores'][gid].get('level_scores', [])
            max_lvl = max(len(b_levels), len(c_levels)) if b_levels or c_levels else 0
            level_deltas = []
            for i in range(max_lvl):
                b_ls = b_levels[i] * 100 if i < len(b_levels) else 0.0
                c_ls = c_levels[i] * 100 if i < len(c_levels) else 0.0
                level_deltas.append({
                    'level': i + 1,
                    'baseline': b_ls,
                    'current': c_ls,
                    'delta': c_ls - b_ls
                })
            b_total = baseline['game_scores'].get(gid, 0) * 100
            c_total = current['game_scores'].get(gid, 0) * 100
            level_deltas_by_game[gid] = {
                'baseline_total': b_total,
                'current_total': c_total,
                'delta_total': c_total - b_total,
                'levels': level_deltas
            }

# --- Configuration Diff ---
config_diff = {}
if current and baseline['config_hash'] != current['config_hash']:
    b_cfg = baseline['harness_config']
    c_cfg = current['harness_config']

    b_model = b_cfg.get('model', 'unknown')
    c_model = c_cfg.get('model', 'unknown')
    config_diff['model_changed'] = b_model != c_model
    config_diff['old_model'] = b_model
    config_diff['new_model'] = c_model

    b_plugins = set(b_cfg.get('plugins', []))
    c_plugins = set(c_cfg.get('plugins', []))
    config_diff['plugins_added'] = sorted(c_plugins - b_plugins)
    config_diff['plugins_removed'] = sorted(b_plugins - c_plugins)

    b_skills = set(b_cfg.get('skills', []))
    c_skills = set(c_cfg.get('skills', []))
    config_diff['skills_added'] = sorted(c_skills - b_skills)
    config_diff['skills_removed'] = sorted(b_skills - c_skills)

# --- Trend Analysis (3+ runs) ---
trend_data = []
if len(runs_data) >= 3:
    for i, r in enumerate(runs_data):
        delta_str = ''
        if i > 0:
            d = (r['overall_score'] - runs_data[i-1]['overall_score']) * 100
            sign = '+' if d >= 0 else ''
            delta_str = sign + str(round(d, 1))
        trend_data.append({
            'index': i + 1,
            'run_id': r['run_id'][:8],
            'date': r['timestamp'][:10],
            'score': r['overall_score'] * 100,
            'delta': delta_str
        })

# --- Build Markdown Output ---
out = []
out.append('# ARC-AGI Run Comparison')
out.append('')

# Warnings
if warnings:
    for w in warnings:
        out.append('> ' + w)
        out.append('')

# Run info
out.append('## Runs Compared')
out.append('')
out.append('| # | Run ID | Date | Harness | Score |')
out.append('|---|--------|------|---------|-------|')
for i, r in enumerate(runs_data):
    role = 'baseline' if i == 0 else 'current'
    # Use run_id from metadata (already resolved in Step 4)
    display_id = r['run_id'][:8]
    out.append('| ' + str(i+1) + ' (' + role + ') | ' + display_id + '... | ' + r['timestamp'][:10] + ' | ' + r['harness'] + ' | ' + str(round(r['overall_score']*100, 1)) + ' |')
out.append('')

# Overall delta
out.append('## ' + overall_line)
out.append('')

# Per-environment delta table
if env_deltas:
    out.append('## Per-Environment Deltas')
    out.append('')
    out.append('| Game ID | Baseline | Current | Delta | Status |')
    out.append('|---------|----------|---------|-------|--------|')
    for d in env_deltas:
        b_str = str(round(d['baseline_score'], 1)) if d['baseline_score'] is not None else '--'
        c_str = str(round(d['current_score'], 1)) if d['current_score'] is not None else '--'
        delta_sign = '+' if d['delta'] >= 0 else ''
        out.append('| ' + d['game_id'] + ' | ' + b_str + ' | ' + c_str + ' | ' + delta_sign + str(round(d['delta'], 1)) + ' | ' + d['status'] + ' |')
    out.append('')

    # Summary counts
    improved_count = sum(1 for d in env_deltas if d['status'] == 'Improved')
    regressed_count = sum(1 for d in env_deltas if d['status'] == 'Regressed')
    unchanged_count = sum(1 for d in env_deltas if d['status'] == 'Unchanged')
    new_count = sum(1 for d in env_deltas if d['status'] == 'New')
    missing_count = sum(1 for d in env_deltas if d['status'] == 'Missing')

    out.append('**Summary**: ' + str(improved_count) + ' improved, ' + str(regressed_count) + ' regressed, ' + str(unchanged_count) + ' unchanged, ' + str(new_count) + ' new, ' + str(missing_count) + ' missing')
    out.append('')

# Per-level deltas (only for games with notable changes)
notable_games = [gid for gid in level_deltas_by_game if abs(level_deltas_by_game[gid]['delta_total']) > tolerance]
if notable_games:
    out.append('## Per-Level Deltas')
    out.append('')
    for gid in sorted(notable_games):
        ld = level_deltas_by_game[gid]
        delta_sign = '+' if ld['delta_total'] >= 0 else ''
        out.append('### ' + gid + ': ' + str(round(ld['baseline_total'], 1)) + ' -> ' + str(round(ld['current_total'], 1)) + ' (' + delta_sign + str(round(ld['delta_total'], 1)) + ')')
        out.append('')
        out.append('| Level | Baseline | Current | Delta |')
        out.append('|-------|----------|---------|-------|')
        for lv in ld['levels']:
            lv_sign = '+' if lv['delta'] >= 0 else ''
            out.append('| ' + str(lv['level']) + ' | ' + str(round(lv['baseline'], 1)) + ' | ' + str(round(lv['current'], 1)) + ' | ' + lv_sign + str(round(lv['delta'], 1)) + ' |')
        out.append('')

# Configuration diff
if config_diff:
    out.append('## Configuration Changes')
    out.append('')
    if config_diff.get('model_changed'):
        out.append('- **Model**: ' + config_diff['old_model'] + ' -> ' + config_diff['new_model'])
    if config_diff.get('plugins_added'):
        out.append('- **Plugins added**: ' + ', '.join(config_diff['plugins_added']))
    if config_diff.get('plugins_removed'):
        out.append('- **Plugins removed**: ' + ', '.join(config_diff['plugins_removed']))
    if config_diff.get('skills_added'):
        out.append('- **Skills added**: ' + ', '.join(config_diff['skills_added']))
    if config_diff.get('skills_removed'):
        out.append('- **Skills removed**: ' + ', '.join(config_diff['skills_removed']))
    if not config_diff.get('model_changed') and not config_diff.get('plugins_added') and not config_diff.get('plugins_removed') and not config_diff.get('skills_added') and not config_diff.get('skills_removed'):
        out.append('- Config hashes differ but no significant changes detected in model/plugins/skills')
    out.append('')

# Trend analysis (3+ runs)
if trend_data:
    out.append('## Score Trend')
    out.append('')
    out.append('| Run | Date | Score | Delta |')
    out.append('|-----|------|-------|-------|')
    for t in trend_data:
        delta_display = t['delta'] if t['delta'] else '--'
        out.append('| ' + str(t['index']) + ' | ' + t['date'] + ' | ' + str(round(t['score'], 1)) + ' | ' + delta_display + ' |')
    out.append('')

    # Per-game trend for games in all runs
    games_in_all = set(runs_data[0]['game_scores'].keys())
    for r in runs_data[1:]:
        games_in_all = games_in_all.intersection(set(r['game_scores'].keys()))

    if games_in_all:
        out.append('### Per-Game Trends (games present in all runs)')
        out.append('')
        header_row = '| Game ID |'
        sep_row = '|---------|'
        for i in range(len(runs_data)):
            header_row += ' Run ' + str(i+1) + ' |'
            sep_row += '-------|'
        out.append(header_row)
        out.append(sep_row)
        for gid in sorted(games_in_all):
            row = '| ' + gid + ' |'
            for r in runs_data:
                row += ' ' + str(round(r['game_scores'][gid] * 100, 1)) + ' |'
            out.append(row)
        out.append('')

output_text = chr(10).join(out)
print(output_text)

# --- Save Comparison JSON ---
comparison_id = str(uuid.uuid4())
comparison = {
    'comparison_id': comparison_id,
    'timestamp': datetime.now(timezone.utc).isoformat(),
    'runs': [
        {
            'run_id': r['run_id'],
            'harness': r['harness'],
            'timestamp': r['timestamp'],
            'overall_score': r['overall_score'],
            'config_hash': r['config_hash']
        }
        for r in runs_data
    ],
    'overall_delta': {
        'baseline_run_id': baseline['run_id'],
        'current_run_id': current['run_id'] if current else baseline['run_id'],
        'score_delta': score_delta / 100,
        'score_delta_percent': score_delta_pct
    },
    'environment_deltas': [
        {
            'game_id': d['game_id'],
            'status': d['status'].lower(),
            'baseline_score': d['baseline_score'] / 100 if d['baseline_score'] is not None else 0,
            'current_score': d['current_score'] / 100 if d['current_score'] is not None else 0,
            'score_delta': d['delta'] / 100,
            'baseline_levels_completed': baseline['game_level_scores'].get(d['game_id'], {}).get('levels_completed', 0),
            'current_levels_completed': current['game_level_scores'].get(d['game_id'], {}).get('levels_completed', 0) if current else 0,
            'level_deltas': [
                {
                    'level_index': lv['level'],  # 1-based level index
                    'baseline_score': lv['baseline'],
                    'current_score': lv['current'],
                    'delta': lv['delta']
                }
                for lv in level_deltas_by_game.get(d['game_id'], {}).get('levels', [])
            ]
        }
        for d in env_deltas
    ],
    'config_diff': config_diff,
    'summary': {
        'total_improved': sum(1 for d in env_deltas if d['status'] == 'Improved'),
        'total_regressed': sum(1 for d in env_deltas if d['status'] == 'Regressed'),
        'total_unchanged': sum(1 for d in env_deltas if d['status'] == 'Unchanged'),
        'total_new': sum(1 for d in env_deltas if d['status'] == 'New'),
        'total_missing': sum(1 for d in env_deltas if d['status'] == 'Missing')
    }
}

comparisons_dir = '.arc-agi-benchmarks/comparisons'
os.makedirs(comparisons_dir, exist_ok=True)
comparison_path = os.path.join(comparisons_dir, comparison_id + '.json')
with open(comparison_path, 'w') as f:
    json.dump(comparison, f, indent=2, default=str)

# Clean up temp file
if os.path.isfile(tmp_path):
    os.remove(tmp_path)

print('', file=sys.stderr)
print('Comparison saved to: ' + comparison_path, file=sys.stderr)
"
```

**IMPORTANT**: Replace the following angle-bracket placeholders with actual values:
- `<RUNS_DATA_PATH>`: The `runs_data_path` value returned by Step 4 (path to temp JSON file)
- `<TOLERANCE>`: The tolerance value as a float (default: `1.0`)

## Step 6: Display Comparison

The markdown comparison output from Step 5 is printed directly to the console. Claude Code renders markdown well.

Tell the user where the comparison was saved:

```
Comparison saved to: .arc-agi-benchmarks/comparisons/<COMPARISON_ID>.json
```

## Cross-Harness Comparison

The compare skill supports comparing runs from different harnesses. When a run ID is not found in `.arc-agi-benchmarks/runs/`, the skill also checks `.arc-agi-benchmarks/cross-harness/<harness>/runs/<run-id>/`. The same `run-meta.json` and `scorecard.json` format is used regardless of harness origin.

Cross-harness runs may have synthetic scorecards with some fields missing (e.g., no `level_baseline_actions`). Handle gracefully:
- Use 0 for missing numeric fields
- Use empty lists for missing array fields
- Note in the output if baseline data is unavailable for efficiency comparison

## Delta Status Classification

| Status | Condition | Meaning |
|--------|-----------|---------|
| Improved | delta > +tolerance | Score increased beyond tolerance |
| Regressed | delta < -tolerance | Score decreased beyond tolerance |
| Unchanged | abs(delta) <= tolerance | Score within tolerance band |
| New | game in current but not in baseline | New game added |
| Missing | game in baseline but not in current | Game removed or not played |

The default tolerance is 1.0 (on the 0-100 display scale). This means a delta of +0.8 is classified as "Unchanged" while +1.5 is "Improved".

## Error Handling

### Fewer Than 2 Run IDs
> Usage: `/arc-compare <run1> <run2> [run3 ...]`
> Use `latest` and `previous` as aliases for recent runs.
> Example: `/arc-compare previous latest`

### Run ID Not Found
If a specified run ID does not exist:
> Run `<run_id>` not found.
> Available runs:
>   - `<run_id_1>` (<date_1>)
>   - `<run_id_2>` (<date_2>)
> Also checked cross-harness directories.

### No Completed Runs
If no completed runs exist (and `latest`/`previous` was used):
> No completed benchmark runs found. Run `/arc-benchmark` first.

### Corrupt Scorecard
If a scorecard file cannot be parsed:
> WARNING: Could not load scorecard for run `<run_id>`. Skipping this run.
> Remaining runs: <list of valid runs>

If fewer than 2 valid runs remain after skipping, report the error and stop.
