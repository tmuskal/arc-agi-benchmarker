"""
ARC-AGI Game Driver - Stateless driver that replays action history to restore
environment state, then executes a single command (init/step/reset).

Usage:
    python game_driver.py <run_dir> <game_id> <seed> <request_file>

The request_file is a JSON file with:
    {"command": "init"}                                  -- initialize game
    {"command": "step", "action": "ACTION1", ...}        -- take an action
    {"command": "reset"}                                 -- reset the game
    {"command": "batch", "actions": [{...}, {...}]}      -- execute many steps/resets in one invocation
                                                            (each item: {"action":"ACTIONn", "data"?:{}, "reasoning"?:""}
                                                             or {"reset": true}). Stops early on None obs or optional
                                                             {"stopOn": "GAME_OVER"|"WIN"|"level_change"}.

Output: JSON observation on the LAST line of stdout.
Note: arc_agi may print INFO log lines to stdout before the JSON.
Always parse only the last line, or read observation_<game_id>.json from disk.
"""

import json
import sys
import os
import logging

# Suppress INFO logs from arc_agi/arcengine so they don't contaminate stdout JSON
logging.getLogger('arc_agi').setLevel(logging.WARNING)
logging.getLogger('arcengine').setLevel(logging.WARNING)

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

# Load or initialize session
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
# IMPORTANT: Use GameAction[name] (name-based lookup), NOT GameAction(int).
# GameAction enum uses composite tuple values internally, so GameAction(6)
# raises ValueError. GameAction['ACTION6'] works correctly.
for prev in session.get('action_history', []):
    if prev.get('is_reset'):
        obs = env.reset()
    else:
        action = GameAction[prev['action']]
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

    # Update session - store action name for replay via GameAction[name]
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
elif command == 'batch':
    stop_on = request.get('stopOn')
    prev_level = getattr(obs, 'levels_completed', None)
    executed = 0
    batch_stop_reason = None
    for item in request.get('actions', []):
        if item.get('reset') or item.get('is_reset'):
            obs = env.reset()
            if obs is None:
                batch_stop_reason = 'reset_returned_none'
                break
            session['resets'] += 1
            session['action_history'].append({'is_reset': True})
        else:
            action_name = item['action']
            action = GameAction[action_name]
            step_kwargs = {'action': action}
            if item.get('data'):
                step_kwargs['data'] = item['data']
            if item.get('reasoning'):
                step_kwargs['reasoning'] = item['reasoning']
            obs = env.step(**step_kwargs)
            if obs is None:
                batch_stop_reason = f'step_returned_none_at_index_{executed}'
                break
            entry = {'action': action_name, 'action_id': action.value}
            if item.get('data'):
                entry['data'] = item['data']
            if item.get('reasoning'):
                entry['reasoning'] = item['reasoning']
            session['action_history'].append(entry)
            session['steps'] += 1
        executed += 1
        state_str = str(getattr(obs, 'state', ''))
        cur_level = getattr(obs, 'levels_completed', None)
        if stop_on == 'GAME_OVER' and 'GAME_OVER' in state_str:
            batch_stop_reason = 'GAME_OVER'
            break
        if stop_on == 'WIN' and 'WIN' in state_str:
            batch_stop_reason = 'WIN'
            break
        if stop_on == 'level_change' and prev_level is not None and cur_level != prev_level:
            batch_stop_reason = 'level_change'
            break
        prev_level = cur_level
    # Annotate result with batch info (injected into observation_file below via session)
    session['_last_batch'] = {'executed': executed, 'stopReason': batch_stop_reason}

# Extract observation - recursively convert numpy arrays to lists for JSON
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

# Write observation to file (reliable alternative to stdout parsing)
obs_file = os.path.join(run_dir, f'observation_{game_id}.json')
with open(obs_file, 'w') as f:
    json.dump(result, f, indent=2)

# Print JSON result (last line of stdout)
print(json.dumps(result))
