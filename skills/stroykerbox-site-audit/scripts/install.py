#!/usr/bin/env python3
"""Copy the skill into a project's skills directory; never replace an existing skill."""
import argparse
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True, help='Target project root')
    parser.add_argument('--host', choices=['codex', 'claude'], default='codex')
    args = parser.parse_args()
    source = Path(__file__).resolve().parents[1]
    directory = '.agents' if args.host == 'codex' else '.claude'
    target = Path(args.project).expanduser().resolve() / directory / 'skills' / source.name
    if target.exists() or target.is_symlink():
        parser.error(f'Skill already exists at {target}; review changes before replacing it')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target, ignore=shutil.ignore_patterns('node_modules', '__pycache__', '*.zip', 'audit-results'))
    print(f'Skill copied to {target}. Start a new agent session in that project.')


if __name__ == '__main__':
    main()
