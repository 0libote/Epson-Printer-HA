#!/usr/bin/env python3
"""One build identity for both images. CI run N maps to build 131 + N.
Local release: --bump. Development rebuilds keep the recorded identity.
"""
import argparse
import json
import re
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
# Docker cannot read a JSON value in LABEL. Keep local ARG defaults generated
# from the same source, while CI still supplies its explicit build argument.
for path in (root / 'Dockerfile', root / 'scan-bridge/Dockerfile'):
    if path.exists():
        path.write_text(re.sub(r'^ARG BUILD_NUMBER=.*$', f'ARG BUILD_NUMBER={number}', path.read_text(), flags=re.M))
print(f'Build {number}')
