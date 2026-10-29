"""Author one canonical reader-M case definition from literal inputs. No observation, no child process, no defaults for missing data.

Usage (hosted Linux only): python3 reader_m_case.py --spec SPEC.json --output CASE.json
SPEC fields are the keyword arguments of build_case. semanticDigest must be supplied from the untimed parity step; it is never invented here.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from container_resources import MIB, READER, READER_ENTRY
from protocol import Record, Rejected, digest, file_hash, require, runtime, save
from resource_limits import capture_environment

CAPABILITIES = {'local': ['reader-m-bridge-v1', 'target-local'], 'do': ['reader-m-bridge-v1', 'target-do']}
TIMING = {'unit': 'ms', 'kind': 'timing'}
COUNT = {'unit': 'count', 'kind': 'counter'}
BYTES = {'unit': 'bytes', 'kind': 'counter'}
METRICS = {
    'local': {'cpuMicros': {'unit': 'us', 'kind': 'timing'}, 'wallMs': TIMING, 'parse': COUNT, 'files': COUNT, 'decoded': BYTES, 'manifest': BYTES},
    'do': {'cgroupCpuMicros': {'unit': 'us', 'kind': 'timing'}, 'wallMs': TIMING, 'parse': COUNT, 'sql': COUNT, 'files': COUNT,
           'compressed': BYTES, 'decoded': BYTES, 'manifest': BYTES},
}


def build_case(*, case_id: str, task: int, identities: list[str], target: str, query_index: int, window: str, view: str,
               docker: str, image: str, freeze: str, bridge: str, fixture: str, baseline: Record, candidate: Record,
               semantic_digest: str, economics_digest: str, pairs: int = 10, temperature: str = 'warm') -> Record:
    """baseline/candidate: {'cwd', 'revision', 'tree'} of the task-owned checkouts holding the pinned reader blobs."""
    require(target in METRICS and type(query_index) is int and 0 <= query_index < 8, 'target/query index')
    require(len(semantic_digest) == 64 and semantic_digest.strip('0123456789abcdef') == '', 'semantic digest must come from the untimed parity step')
    require(sys.platform == 'linux', 'reader cases are authored only on the Linux host that will run them')
    profile = 'reader-linux-' + target + '-v1'
    require(profile in READER, 'unknown reader profile')
    sources = {bridge: file_hash(Path(bridge)), fixture: file_hash(Path(fixture))}
    harness = {**sources, freeze: file_hash(Path(freeze))}
    executable = str(Path(sys.executable).resolve())
    argv = [docker, READER_ENTRY]
    parent = capture_environment()
    metrics = {name: {**spec, 'direction': 'lower', 'scope': 'invocation', 'aggregate': 'median', 'repetitions': 1}
               for name, spec in METRICS[target].items()}
    phase = lambda p: {'cwd': p['cwd'], 'revision': p['revision'], 'tree': p['tree'], 'sources': sources}
    return {'schema': 'measurement-case/v1', 'id': case_id, 'task': task, 'identities': identities, 'mode': 'native', 'offline': True,
            'pairs': pairs, 'temperature': temperature, 'samplingUnit': 'invocation',
            'shape': {'target': target, 'queryIndex': query_index, 'window': window, 'view': view}, 'economicsDigest': economics_digest,
            'timeout': 120, 'outputBytes': 1048576, 'scratchBytes': 16 * MIB, 'parentEnvironment': parent, 'artifactRoot': parent['root'],
            'scratchRoot': str(Path(parent['root']) / 'native'), 'runtime': runtime(), 'harness': harness,
            'fixtures': {fixture: sources[fixture]}, 'baseline': phase(baseline), 'candidate': phase(candidate),
            'semanticDigest': semantic_digest, 'capabilities': CAPABILITIES[target], 'primary': next(iter(metrics)), 'metrics': metrics,
            'commands': {'happy': {'baseline': argv, 'candidate': argv}}, 'allowlist': [argv],
            'executables': {docker: file_hash(Path(docker)), executable: file_hash(Path(executable))},
            'container': {'profile': profile, 'image': image, 'docker': docker, 'scratchBytes': 7 * MIB, 'freeze': freeze,
                          'entrypoint': READER_ENTRY, 'mounts': {bridge: READER_ENTRY, fixture: '/work/reader-m-fixture.mjs'}},
            'receiptEncoding': 'gzip-v1'}


def main() -> int:
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        spec = json.loads(Path(args.spec).read_text())
        require(isinstance(spec, dict), 'spec must be an object')
        case = build_case(**spec)
        save(Path(args.output), case)
        print(json.dumps({'status': 'PASS', 'case': args.output, 'digest': digest(case)}))
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'REJECTED', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
