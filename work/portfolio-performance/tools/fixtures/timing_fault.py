"""Native adverse producer: a completed receipt with unusable timing instrumentation."""
import json
import os
import hashlib
from pathlib import Path

request = json.loads(os.environ['MEASURE_REQUEST'])
result = {**request, 'status': 'complete',
          'semanticDigest': hashlib.sha256(str(sum(int(v) for v in Path(__file__).with_name('numbers.txt').read_text().split())).encode()).hexdigest(),
          'capabilities': ['sum'],
          'metrics': {'iterations': {'scope': 'nested', 'unit': 's', 'values': [float('nan')] * 3},
                      'outputs': {'scope': 'invocation', 'unit': 'count', 'values': [1]}}}
print(json.dumps(result))
