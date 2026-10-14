#!/usr/bin/env python3
"""Prompt privately, then read documentation in Microsoft Edge. Credentials are not saved."""
import argparse
import getpass
import json
import shutil
import subprocess
import urllib.parse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    parser.add_argument('--username', help='Omit to enter username privately')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    parsed = urllib.parse.urlsplit(args.url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        parser.error('Use HTTPS URL without credentials')
    node = shutil.which('node')
    if not node:
        parser.error('Node.js is required to open documentation in Microsoft Edge')
    credentials = {
        'username': args.username or getpass.getpass('Documentation username: '),
        'password': getpass.getpass('Documentation password (not saved): '),
    }
    script = Path(__file__).with_suffix('.cjs')
    # Credentials only go through child-process stdin, not args/env/files.
    result = subprocess.run(
        [node, str(script), '--url', args.url, '--output', args.output],
        input=json.dumps(credentials), text=True, encoding='utf-8',
    )
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
