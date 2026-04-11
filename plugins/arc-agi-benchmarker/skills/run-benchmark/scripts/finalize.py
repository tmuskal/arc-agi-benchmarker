"""
ARC-AGI Benchmark Finalization - Replays all games to populate the scorecard,
saves scorecard.json, game-results.json, and updates run-meta.json.

Usage:
    python finalize.py <run_dir> <seed>

Reads game_ids from run-meta.json in the run directory.
"""

import json
import os
import sys
import logging
from datetime import datetime, timezone

# Suppress INFO logs
logging.getLogger('arc_agi').setLevel(logging.WARNING)
logging.getLogger('arcengine').setLevel(logging.WARNING)

from arc_agi import Arcade, OperationMode
from arcengine import GameAction

run_dir = sys.argv[1]
seed = int(sys.argv[2])

# Read game_ids from run metadata
with open(f'{run_dir}/run-meta.json') as f:
    run_meta = json.load(f)
game_ids = run_meta['game_ids']

# Read config
with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
op_mode = cfg.get('operation_mode', 'normal')
recordings_dir = run_dir + '/recordings'

# Load scorecard ID
scorecard_id_file = os.path.join(run_dir, 'scorecard_id.txt')
with open(scorecard_id_file) as f:
    scorecard_id = f.read().strip()

# Create Arcade and replay all games
arc = Arcade(operation_mode=OperationMode(op_mode), environments_dir=env_dir, recordings_dir=recordings_dir)

played = 0
game_results = []

for game_id in game_ids:
    session_file = f'{run_dir}/session_{game_id}.json'
    if not os.path.exists(session_file):
        game_results.append({
            'game_id': game_id,
            'status': 'NOT_PLAYED',
            'steps': 0,
            'resets': 0,
            'levels_completed': 0
        })
        continue

    with open(session_file) as f:
        session = json.load(f)

    actions = session.get('action_history', [])
    env = arc.make(game_id, seed=seed, save_recording=True, render_mode=None, scorecard_id=scorecard_id)

    last_state = 'NOT_FINISHED'
    obs = env.observation_space
    replay_error = False

    for prev in actions:
        if prev.get('is_reset'):
            obs = env.reset()
        else:
            # Use name-based lookup (GameAction[name]), NOT value-based (GameAction(int))
            action = GameAction[prev['action']]
            step_kwargs = {'action': action}
            if prev.get('data'):
                step_kwargs['data'] = prev['data']
            if prev.get('reasoning'):
                step_kwargs['reasoning'] = prev['reasoning']
            obs = env.step(**step_kwargs)
        if obs is None:
            print(f'ERROR: Replay returned None for game {game_id}', file=sys.stderr)
            replay_error = True
            break
        last_state = obs.state.name if hasattr(obs.state, 'name') else str(obs.state)

    played += 1
    game_results.append({
        'game_id': game_id,
        'status': 'REPLAY_ERROR' if replay_error else last_state,
        'steps': session.get('steps', 0),
        'resets': session.get('resets', 0),
        'levels_completed': getattr(obs, 'levels_completed', 0) if obs else 0
    })
    print(f'Replayed {game_id}: {len(actions)} actions -> {last_state}')

# Get scorecard as JSON BEFORE closing (close_scorecard() prevents further reads)
scorecard_str = str(arc.get_scorecard())
scorecard_data = json.loads(scorecard_str) if scorecard_str.startswith('{') else {}

# Close the scorecard (marks it as complete)
arc.close_scorecard()

# Save scorecard
with open(f'{run_dir}/scorecard.json', 'w') as f:
    json.dump(scorecard_data, f, indent=2)

# Save game results
with open(f'{run_dir}/game-results.json', 'w') as f:
    json.dump(game_results, f, indent=2)

# Update run metadata
with open(f'{run_dir}/run-meta.json') as f:
    meta = json.load(f)
start_time = datetime.fromisoformat(meta['timestamp'])
now = datetime.now(timezone.utc)
meta['duration_seconds'] = (now - start_time).total_seconds()
meta['status'] = 'completed'
meta['games_played'] = played
meta['games_total'] = len(game_ids)
with open(f'{run_dir}/run-meta.json', 'w') as f:
    json.dump(meta, f, indent=2)

# Print summary
print(json.dumps({
    'status': 'completed',
    'played': played,
    'total': len(game_ids),
    'score': scorecard_data.get('score', 0),
    'duration_seconds': meta['duration_seconds'],
    'game_results': game_results
}, default=str))
