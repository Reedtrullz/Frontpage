"""Offline native fixture: executes real structured workloads, with deliberate faults."""
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

request = json.loads(os.environ['MEASURE_REQUEST'])
scenario = request['scenario']
if scenario == 'timeout':
    time.sleep(10)
if scenario == 'nonzero':
    print('native failed', file=sys.stderr)
    sys.exit(7)
if scenario == 'empty':
    sys.exit(0)
if scenario == 'malicious':
    print('__import__("os").system("touch DISPATCHED")')
    sys.exit(0)
if scenario == 'output':
    sys.stdout.write('x' * 100000)
    sys.exit(0)
if scenario == 'scratch':
    (Path(os.environ['TMPDIR']) / 'large').write_bytes(b'x' * (20 * 1024 * 1024))
if scenario == 'partial':
    print('{"status":"partial"}')
    sys.exit(0)

# The counter measures actual duplicate work over an authored fixed fixture.
values = [int(v) for v in Path(__file__).with_name('numbers.txt').read_text().split()]
candidate = request['phase'] == 'candidate'
loops = 1 if candidate and scenario != 'same' else 2
iterations = 0
durations = []
total = 0
for repetition in range(3):
    start = time.perf_counter()
    for _ in range(loops):
        total = 0
        for value in values:
            total += value
            iterations += 1
    durations.append(time.perf_counter() - start)
result: dict[str, Any] = {**request, 'status': 'complete', 'semanticDigest': hashlib.sha256(str(total).encode()).hexdigest(),
          'interpreter': {'isolated': sys.flags.isolated, 'noSite': sys.flags.no_site,
                          'noBytecode': sys.flags.dont_write_bytecode},
          'capabilities': ['sum'], 'metrics': {
              'iterations': {'scope': 'invocation', 'unit': 'count', 'values': [iterations]},
              'outputs': {'scope': 'invocation', 'unit': 'count', 'values': [1]}}}
# Native timing is retained but deliberately unsupported for this deterministic counter case.
result['unsupported'] = {'cpu': 'not instrumented', 'rss': 'not instrumented'}
result['nativeDurationsSeconds'] = durations
if scenario == 'missing':
    del result['metrics']['iterations']
if scenario == 'nan':
    result['metrics']['iterations']['values'] = [float('nan')]
if scenario == 'revision':
    result['revision'] = 'wrong'
if scenario == 'fixture':
    result['fixtureDigest'] = 'wrong'
if scenario == 'economics':
    result['economicsDigest'] = 'changed'
if scenario == 'repeated':
    result['metrics']['iterations']['values'] = [iterations] * 3
if scenario == 'parity':
    result['semanticDigest'] = 'incorrect-output'
if scenario == 'secondary' and candidate:
    result['metrics']['outputs']['values'] = [2]
print(json.dumps(result))
