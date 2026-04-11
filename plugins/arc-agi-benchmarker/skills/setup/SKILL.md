---
description: Set up the ARC-AGI benchmarking environment - installs dependencies, configures API access, and verifies the setup works
---

# ARC-AGI Setup

You are setting up the ARC-AGI benchmarking environment. Follow each step below in order. If any step fails, report the error with the remediation guidance provided and stop.

## Step 1: Check Python Availability

Run the following command to check if Python >= 3.12 is available:

```bash
python3 --version 2>/dev/null || python --version 2>/dev/null
```

Parse the version string (e.g., `Python 3.12.4`). Extract the major and minor version numbers.

**If Python is not found:**
Tell the user:
> Python 3.12 or higher is required but was not found on PATH.
> Install it from https://python.org/downloads/ or via your system package manager:
> - macOS: `brew install python@3.12`
> - Ubuntu/Debian: `sudo apt install python3.12`
> - Windows: Download from https://python.org/downloads/
> - Or use pyenv: `pyenv install 3.12 && pyenv global 3.12`

Stop here if Python is not found.

**If Python version is < 3.12:**
Tell the user:
> Python {detected_version} was found, but arc-agi requires Python 3.12 or higher.
> Please upgrade Python. You can use pyenv to manage multiple versions:
> `pyenv install 3.12 && pyenv global 3.12`

Stop here if Python is too old.

Record which Python command works (`python3` or `python`) -- use that command for all subsequent steps. Call it `PYTHON_CMD` below.

## Step 2: Create or Reuse Virtual Environment

Check if a virtual environment already exists:

```bash
ls -d .arc-agi-venv 2>/dev/null
```

**If `.arc-agi-venv` does NOT exist**, create one:

```bash
$PYTHON_CMD -m venv .arc-agi-venv
```

**Activate the virtual environment** by determining the pip path. Do NOT try to source activate scripts (they do not work in non-interactive bash). Instead, use the venv pip and python directly:

- On Unix/macOS: `.arc-agi-venv/bin/pip` and `.arc-agi-venv/bin/python`
- On Windows: `.arc-agi-venv/Scripts/pip` and `.arc-agi-venv/Scripts/python`

Detect the platform by checking which path exists:

```bash
if [ -f ".arc-agi-venv/bin/pip" ]; then
  VENV_PIP=".arc-agi-venv/bin/pip"
  VENV_PYTHON=".arc-agi-venv/bin/python"
elif [ -f ".arc-agi-venv/Scripts/pip.exe" ]; then
  VENV_PIP=".arc-agi-venv/Scripts/pip"
  VENV_PYTHON=".arc-agi-venv/Scripts/python"
fi
```

Use `$VENV_PIP` and `$VENV_PYTHON` for all subsequent commands.

## Step 3: Install arc-agi Package

First check if `arc-agi` is already installed:

```bash
$VENV_PYTHON -c "import importlib.metadata; print(importlib.metadata.version('arc-agi'))" 2>/dev/null
```

**If not installed**, install it:

```bash
$VENV_PIP install arc-agi
```

**If pip install fails:**
Tell the user:
> Failed to install arc-agi. Possible remediation:
> 1. Check your network connection
> 2. Try using uv: `uv pip install arc-agi`
> 3. Check if pip is up to date: `$VENV_PIP install --upgrade pip`

Stop here if installation fails.

## Step 4: Verify Imports

Run a verification script to confirm both `arc_agi` and `arcengine` are importable:

```bash
$VENV_PYTHON -c "
import importlib.metadata
version = importlib.metadata.version('arc-agi')
print(f'arc_agi version: {version}')

from arcengine import GameAction, GameState
print('arcengine: OK')

from arc_agi import Arcade, OperationMode
print('Arcade import: OK')
print('All imports verified successfully.')
"
```

**If arcengine import fails:**
Tell the user:
> arcengine failed to import. This is a transitive dependency of arc-agi.
> Try reinstalling: `$VENV_PIP install --force-reinstall arc-agi`
> Ensure you are using Python 3.12+.

Stop here if imports fail.

Record the `arc_agi` version for the summary.

## Step 5: Configure API Key (Optional)

Check if the user has an ARC_API_KEY environment variable set:

```bash
echo "${ARC_API_KEY:-NOT_SET}"
```

**If NOT_SET**, inform the user:
> No ARC_API_KEY environment variable found. This is fine for OFFLINE mode (the default).
> If you want to use ONLINE mode later, register at https://three.arcprize.org to get an API key,
> then set it: `export ARC_API_KEY=your_key_here`

This step is informational only. OFFLINE mode does not require an API key. Do not block setup.

## Step 6: Initialize Configuration

Create the `.arc-agi-benchmarks/` directory and `config.json` if they do not exist.

First, check if config already exists:

```bash
cat .arc-agi-benchmarks/config.json 2>/dev/null
```

**If config does NOT exist**, create it by running:

```bash
mkdir -p .arc-agi-benchmarks
$VENV_PYTHON -c "
import json
from datetime import datetime, timezone

config = {
    'version': '1.0.0',
    'operation_mode': 'normal',
    'environments_dir': './environment_files',
    'recordings_dir': '.arc-agi-benchmarks/runs',
    'default_seed': 0,
    'default_game_set': 'all',
    'default_max_steps': 500,
    'default_max_resets': 10,
    'harness': 'claude-code',
    'harness_config': {
        'model': 'unknown',
        'plugins': [],
        'skills': [],
        'mcp_servers': []
    },
    'cross_harness': {
        'result_schema_version': '1.0.0',
        'supported_harnesses': ['codex', 'gemini', 'opencode']
    },
    'created_at': datetime.now(timezone.utc).isoformat(),
    'updated_at': datetime.now(timezone.utc).isoformat()
}

with open('.arc-agi-benchmarks/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Config created: .arc-agi-benchmarks/config.json')
"
```

**If config already exists**, update only the `updated_at` timestamp (preserving all user modifications):

```bash
$VENV_PYTHON -c "
import json
from datetime import datetime, timezone

with open('.arc-agi-benchmarks/config.json', 'r') as f:
    config = json.load(f)

config['updated_at'] = datetime.now(timezone.utc).isoformat()

with open('.arc-agi-benchmarks/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Config updated: .arc-agi-benchmarks/config.json')
"
```

## Step 7: Detect Harness Configuration

Populate the `harness_config` section of config.json with information about the current environment. This information is stored in run metadata so benchmark results can be compared meaningfully.

**Detect model**: Check for `CLAUDE_MODEL` or `ANTHROPIC_MODEL` environment variables. If not set, try to detect from the current Claude Code session.

**Detect plugins, skills, and MCP servers**: Use the Claude Code CLI if available, or manually inspect the environment.

```bash
$VENV_PYTHON -c "
import json, subprocess, os

with open('.arc-agi-benchmarks/config.json', 'r') as f:
    config = json.load(f)

harness_config = config.get('harness_config', {})

# Detect model
model = os.environ.get('CLAUDE_MODEL', os.environ.get('ANTHROPIC_MODEL', ''))
if not model:
    # Try to read from Claude Code settings
    settings_paths = [
        os.path.expanduser('~/.claude/settings.json'),
        os.path.expanduser('~/.config/claude/settings.json'),
    ]
    for sp in settings_paths:
        if os.path.exists(sp):
            try:
                with open(sp) as f:
                    settings = json.load(f)
                model = settings.get('model', '')
                if model:
                    break
            except Exception:
                pass
    if not model:
        model = 'unknown'
harness_config['model'] = model

# Detect installed plugins
try:
    result = subprocess.run(['claude', 'plugins', 'list', '--json'],
                          capture_output=True, text=True, timeout=10)
    if result.returncode == 0 and result.stdout.strip():
        plugins_data = json.loads(result.stdout)
        harness_config['plugins'] = [p.get('name', str(p)) for p in plugins_data] if isinstance(plugins_data, list) else [result.stdout.strip()]
except Exception:
    # Fallback: check plugin directories
    plugin_dirs = []
    for pd in ['plugins', os.path.expanduser('~/.claude/plugins/cache')]:
        if os.path.isdir(pd):
            for item in os.listdir(pd):
                if os.path.isdir(os.path.join(pd, item)):
                    plugin_dirs.append(item)
    harness_config['plugins'] = plugin_dirs if plugin_dirs else harness_config.get('plugins', [])

# Detect MCP servers
try:
    mcp_config_paths = [
        os.path.expanduser('~/.claude/mcp_servers.json'),
        os.path.expanduser('~/.config/claude/mcp_servers.json'),
        '.claude/mcp_servers.json',
    ]
    mcp_servers = []
    for mcp_path in mcp_config_paths:
        if os.path.exists(mcp_path):
            with open(mcp_path) as f:
                mcp_data = json.load(f)
            if isinstance(mcp_data, dict):
                mcp_servers.extend(list(mcp_data.keys()))
    harness_config['mcp_servers'] = mcp_servers
except Exception:
    harness_config['mcp_servers'] = harness_config.get('mcp_servers', [])

config['harness_config'] = harness_config
from datetime import datetime, timezone
config['updated_at'] = datetime.now(timezone.utc).isoformat()

with open('.arc-agi-benchmarks/config.json', 'w') as f:
    json.dump(config, f, indent=2)
print('Harness config populated:')
print(json.dumps(harness_config, indent=2))
"
```

**Note**: The detection is best-effort. If the agent has access to more accurate information about its own model, plugins, skills, or MCP servers, it should update `harness_config` in config.json directly. The key fields are:
- `model`: The Claude model being used (e.g., `claude-sonnet-4-6`, `claude-opus-4-6`)
- `plugins`: List of installed plugin names
- `skills`: List of available skill names (the agent can fill this in from its own knowledge)
- `mcp_servers`: List of configured MCP server names

## Step 8: Scan Environments

Count the available local environments:

```bash
$VENV_PYTHON -c "
from arc_agi import Arcade, OperationMode
import json

try:
    # Read environments_dir from config
    with open('.arc-agi-benchmarks/config.json') as f:
        cfg = json.load(f)
    env_dir = cfg.get('environments_dir', './environment_files')

    op_mode = OperationMode(cfg.get('operation_mode', 'normal'))
    arc = Arcade(operation_mode=op_mode, environments_dir=env_dir)
    envs = arc.get_environments()
    env_count = len(envs)
    print(f'Environment count: {env_count}')
    if envs:
        print('Available environments:')
        for env in envs[:10]:
            game_id = getattr(env, 'game_id', getattr(env, 'id', str(env)))
            print(f'  - {game_id}')
        if len(envs) > 10:
            print(f'  ... and {len(envs) - 10} more')

    # Cache environment count in config for quick reference
    cfg['cached_env_count'] = env_count
    from datetime import datetime, timezone
    cfg['updated_at'] = datetime.now(timezone.utc).isoformat()
    with open('.arc-agi-benchmarks/config.json', 'w') as f:
        json.dump(cfg, f, indent=2)
except Exception as e:
    print(f'Error scanning environments: {e}')
    print('Environment count: 0')
"
```

**If no environments are found (count is 0):**
Tell the user:
> No local environments found. To get environments:
> 1. Check if environment files exist in `./environment_files/`
> 2. The arc-agi package may include bundled environments -- try reinstalling: `$VENV_PIP install --force-reinstall arc-agi`
> 3. Check the arc-agi documentation for environment file locations
> 4. You can set a custom path in `.arc-agi-benchmarks/config.json` via the `environments_dir` field

Do NOT stop setup if no environments are found -- just warn the user. The rest of validation will be skipped.

Record the environment count for the summary.

## Step 9: End-to-End Validation

Only perform this step if environments were found in Step 8 (count > 0).

Run a full validation by creating an Arcade, making an environment, resetting it, and verifying FrameDataRaw:

```bash
$VENV_PYTHON -c "
from arc_agi import Arcade, OperationMode
import json

# Read environments_dir from config
with open('.arc-agi-benchmarks/config.json') as f:
    cfg = json.load(f)
env_dir = cfg.get('environments_dir', './environment_files')
op_mode = OperationMode(cfg.get('operation_mode', 'normal'))

arc = Arcade(operation_mode=op_mode, environments_dir=env_dir)
envs = arc.get_environments()

if not envs:
    print('SKIP: No environments available for validation')
    exit(0)

# Use the first available environment
first_env = envs[0]
game_id = getattr(first_env, 'game_id', getattr(first_env, 'id', str(first_env)))
print(f'Validating with environment: {game_id}')

# Make the environment
env = arc.make(game_id, seed=0, render_mode=None)
print('  arc.make(): OK')

# Reset and get initial observation
obs = env.reset()
print('  env.reset(): OK')

# Verify FrameDataRaw fields
frame = obs.frame
state = obs.state
available_actions = obs.available_actions
print(f'  FrameDataRaw.frame: {type(frame).__name__} (valid)')
print(f'  FrameDataRaw.state: {state}')
print(f'  FrameDataRaw.available_actions: {len(available_actions)} actions')

# Check action space
action_space = env.action_space
print(f'  env.action_space: {len(action_space)} actions')

# Validate step() with the first available action
if available_actions:
    action = available_actions[0]
    step_kwargs = {'action': action, 'reasoning': {'text': 'validation step'}}
    if action.is_complex():
        step_kwargs['data'] = {'x': 0, 'y': 0}
    step_obs = env.step(**step_kwargs)
    print(f'  env.step(): OK (state={step_obs.state})')

print('End-to-end validation: PASSED')
"
```

**If validation fails:**
Tell the user:
> End-to-end validation failed with the following error:
> {error_message}
> Try re-running /arc-setup. If the problem persists, check:
> 1. Python version is 3.12+
> 2. arc-agi package is installed correctly
> 3. Environment files are accessible

## Step 10: Print Summary

After all steps complete, print a summary. Gather the information from previous steps and present it clearly:

```
============================================
  ARC-AGI Benchmarker - Setup Summary
============================================

  Python:         {python_version} ({python_cmd})
  Virtual Env:    .arc-agi-venv
  arc-agi:        {arc_agi_version}
  arcengine:      OK
  Environments:   {env_count} available
  Config:         .arc-agi-benchmarks/config.json
  Operation Mode: {operation_mode}
  Max Resets:     10
  Validation:     {PASSED / SKIPPED / FAILED}

  Harness Config:
    Model:        {model}
    Plugins:      {plugins_list}
    MCP Servers:  {mcp_servers_list}

  Status:         READY / NOT READY ({reason})
============================================
```

The status is **READY** if:
- Python >= 3.12 is available
- arc-agi is installed and importable
- arcengine is importable
- Config file exists
- At least 1 environment is available
- Validation passed

The status is **NOT READY** if any of the above conditions are not met. Include the specific reason.

## Idempotency

This skill is safe to run multiple times:
- Virtual environment creation is skipped if `.arc-agi-venv` already exists
- Package installation is a no-op if already installed
- Config is updated (not overwritten) if it already exists
- Harness config detection always runs fresh
- Validation always runs fresh
- No data is lost on re-run

## Important Notes

- Always use the venv Python/pip (`$VENV_PYTHON` / `$VENV_PIP`), NOT the system Python, for installing and running arc-agi
- Do NOT use `render_mode="terminal-fast"` -- it produces ANSI escape codes unsuitable for LLM parsing. Always use `render_mode=None` and read `FrameDataRaw.frame` directly
- Always read `operation_mode` from config: `OperationMode(cfg.get('operation_mode', 'normal'))`. Do NOT hardcode `OperationMode.OFFLINE`.
- All benchmark data is stored under `.arc-agi-benchmarks/` in the project root
