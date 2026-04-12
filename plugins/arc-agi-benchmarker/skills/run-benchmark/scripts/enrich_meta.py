"""Merge agent-supplied setup recall into an existing run-meta.json.

Skill/MCP/tool discovery is NOT automatic. The agent running the skill recalls
what it actually used and passes those explicitly, either as CLI args or via an
input JSON file (stdin or --input).

Usage:
  python enrich_meta.py <run_dir> --input setup.json
  python enrich_meta.py <run_dir> --skills setup,run-benchmark --mcp playwright \\
      --tools Bash,Read,Write,Agent \\
      --ad-hoc "max_resets=10" --ad-hoc "use BFS solver" \\
      --notes "Iterative creative solver with source-code reading"

The input JSON shape:
  {
    "plugin_skills_used": [...],
    "mcp_servers_used":   [...],
    "tools_used":         [...],
    "ad_hoc_instructions":[...],
    "operator_notes":     "..."
  }

Idempotent; merges into existing run-meta.json without dropping other fields.
"""
import argparse, json, os, sys


FIELDS = (
    'plugin_skills_used',
    'mcp_servers_used',
    'tools_used',
    'ad_hoc_instructions',
    'operator_notes',
)


def load_input(args):
    if args.input:
        with open(args.input) as f:
            return json.load(f)
    if not sys.stdin.isatty() and not any([
        args.skills, args.mcp, args.tools, args.ad_hoc, args.notes,
    ]):
        return json.load(sys.stdin)
    return {
        'plugin_skills_used':  [s for s in (args.skills or '').split(',') if s],
        'mcp_servers_used':    [s for s in (args.mcp or '').split(',') if s],
        'tools_used':          [s for s in (args.tools or '').split(',') if s],
        'ad_hoc_instructions': list(args.ad_hoc or []),
        'operator_notes':      args.notes or '',
    }


def enrich(run_dir, supplied):
    meta_path = os.path.join(run_dir, 'run-meta.json')
    with open(meta_path) as f:
        meta = json.load(f)
    for key in FIELDS:
        if key in supplied:
            meta[key] = supplied[key]
    with open(meta_path, 'w') as f:
        json.dump(meta, f, indent=2)
    print(json.dumps({
        'status': 'enriched',
        'run_dir': run_dir,
        **{k: meta.get(k) for k in FIELDS},
    }))


def main():
    p = argparse.ArgumentParser()
    p.add_argument('run_dir')
    p.add_argument('--input', help='Path to JSON file with the recall fields')
    p.add_argument('--skills', help='Comma-separated skill names')
    p.add_argument('--mcp', help='Comma-separated MCP server names')
    p.add_argument('--tools', help='Comma-separated tool names')
    p.add_argument('--ad-hoc', action='append',
                   help='Ad-hoc instruction (repeatable)')
    p.add_argument('--notes', help='Free-text operator notes')
    args = p.parse_args()
    enrich(args.run_dir, load_input(args))


if __name__ == '__main__':
    main()
