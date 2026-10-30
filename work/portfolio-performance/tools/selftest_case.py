"""Build retained fake-native case. Usage: python3 tools/selftest_case.py."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from protocol import Record, RUN_TMP, WORK, digest, file_hash, runtime, save, require
from resource_limits import capture_environment


def definition() -> Record:
    fixture = Path(__file__).with_name('fixtures')
    producer = fixture / 'native_selftest.py'
    executable = str(Path(sys.executable).resolve())
    argv = [executable, '-I', '-S', '-B', str(producer)]
    sources = {str(producer): file_hash(producer)}
    scenarios = ('happy', 'timeout', 'nonzero', 'empty', 'malicious', 'output', 'scratch',
                 'partial', 'missing', 'nan', 'revision', 'fixture', 'economics', 'repeated', 'same', 'parity', 'secondary')
    parent = capture_environment()
    return {'schema': 'measurement-case/v1', 'id': 'adapter-selftest-u03', 'task': 5,
            'identities': ['Reedtrullz/Asset-Tracker'], 'mode': 'native', 'offline': True,
            'selftestOnly': True, 'pairs': 5, 'temperature': 'cold', 'samplingUnit': 'invocation',
            'shape': {'fixtureRows': 10, 'repetitions': 3}, 'economicsDigest': 'authored-no-provider',
            'timeout': .3, 'outputBytes': 16384, 'scratchBytes': 16777216,
            'parentEnvironment': parent, 'artifactRoot': parent['root'],
            'scratchRoot': str(Path(parent['root']) / 'native'),
            'runtime': runtime(), 'harness': sources,
            'fixtures': {str(fixture / 'numbers.txt'): file_hash(fixture / 'numbers.txt')},
            'baseline': {'cwd': str(fixture), 'revision': digest(sources), 'sources': sources},
            'candidate': {'cwd': str(fixture), 'revision': digest(sources), 'sources': sources},
            'semanticDigest': hashlib.sha256(b'55').hexdigest(), 'capabilities': ['sum'],
            'primary': 'iterations', 'metrics': {
                'iterations': {'kind': 'counter', 'direction': 'lower', 'scope': 'invocation',
                               'unit': 'count', 'aggregate': 'sum', 'repetitions': 1},
                'outputs': {'kind': 'counter', 'direction': 'lower', 'scope': 'invocation',
                            'unit': 'count', 'aggregate': 'sum', 'repetitions': 1}},
            'commands': {s: {'baseline': argv, 'candidate': argv} for s in scenarios},
            'allowlist': [argv], 'executables': {executable: file_hash(Path(executable))}}


if __name__ == '__main__':
    path = WORK / 'cases/adapter-selftest-u03.json'
    require(not path.exists(), 'selftest case already frozen; use verify_adapter.py for a fresh owned run')
    save(path, definition())
    print(path)
