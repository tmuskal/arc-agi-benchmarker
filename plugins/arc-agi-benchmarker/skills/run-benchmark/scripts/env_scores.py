"""
ARC-AGI Environment Scores Generator - Reads scorecard.json and generates
detailed per-environment scoring breakdown.

Usage:
    python env_scores.py <run_dir>
"""

import json
import sys
import logging

logging.getLogger('arc_agi').setLevel(logging.WARNING)
logging.getLogger('arcengine').setLevel(logging.WARNING)

from arc_agi import Arcade, OperationMode

run_dir = sys.argv[1]

with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
op_mode = cfg.get('operation_mode', 'normal')

with open(f'{run_dir}/scorecard.json') as f:
    scorecard = json.load(f)

# Get environment metadata (title, tags) from arc.get_environments()
arc = Arcade(operation_mode=OperationMode(op_mode), environments_dir=env_dir)
env_list = arc.get_environments()
env_metadata = {}
for e in env_list:
    eid = getattr(e, 'game_id', getattr(e, 'id', str(e)))
    env_metadata[eid] = {
        'title': getattr(e, 'title', eid),
        'tags': getattr(e, 'tags', [])
    }

env_scores = {
    'run_id': scorecard.get('card_id', ''),
    'overall_score': scorecard.get('score', 0) * 100,
    'environments': []
}

# The scorecard serializes per-game data under the 'environments' field
for env_entry in scorecard.get('environments', scorecard.get('games', [])):
    env_id = env_entry.get('id', '')
    env_score = env_entry.get('score', 0)
    runs = env_entry.get('runs', [])

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

print(json.dumps({
    'status': 'environment-scores.json written',
    'environments': len(env_scores['environments'])
}))
