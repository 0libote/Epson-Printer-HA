#!/usr/bin/env python3
"""One build identity for both images. CI run N maps to build 131 + N.
Local release: --bump. Development rebuilds keep the recorded identity.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser()
group = parser.add_mutually_exclusive_group(required=True)
group.add_argument('--ci-run', type=int)
group.add_argument('--bump', action='store_true')
parser.add_argument('--revision', default='local')
args = parser.parse_args()
old = json.loads((root / 'src/build-info.json').read_text())
number = 131 + args.ci_run if args.ci_run is not None else old['number'] + 1
if number < 132:
    parser.error('Build numbers start at 132; CI run must be positive')
data = dict(number=number, revision=args.revision[:80], builtAt=datetime.now(timezone.utc).isoformat())
for path in (root / 'src/build-info.json', root / 'scan-bridge/build-info.json'):
    path.write_text(json.dumps(data, indent=2) + '\n')
print(f'Build {number}')
