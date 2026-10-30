"""Author one canonical reader-M case definition from literal inputs. No observation, no child process, no defaults for missing data.

Usage (hosted Linux only): python3 reader_m_case.py --spec SPEC.json --output CASE.json
SPEC fields are the keyword arguments of build_case. semanticDigest must be supplied from the untimed parity step; it is never invented here.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from container_resources import MIB, READER, READER_ENTRY
from protocol import Case, EVIDENCE, Record, Rejected, digest, file_hash, load, require, runtime, save
from resource_limits import capture_environment

CAPABILITIES = {'local': ['reader-m-bridge-v1', 'target-local'], 'do': ['reader-m-bridge-v1', 'target-do']}
# The eight original queries are fixture.mjs queries: index = 2 * window + view.
WINDOWS = ('1h', '24h', '7d', '30d')
VIEWS = ('host', 'workloads')
SCENARIOS = ('happy', 'failure')
ARTIFACT_ROOT = EVIDENCE / 'unblocking-20261028/u04'
# Task 15 is exactly Reedtrullz/Frontpage with the frozen ten-pair native protocol.
TASK, IDENTITIES, PAIRS = 15, ['Reedtrullz/Frontpage'], 10
# Cold cases are fresh-container invocations; warm cases are authored here but unobserved. These cohorts stay OUTSTANDING until qualified observations exist.
OUTSTANDING = ({'cohort': 'public-mobile-desktop', 'status': 'OUTSTANDING'}, {'cohort': 'warm-user-session', 'status': 'OUTSTANDING'})


def make_case_id(target: str, window: str, view: str, temperature: str) -> str:
    return f'T15-history-{target}-{window}-{view}-{temperature}'


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
               semantic_digest: str, economics_digest: str, temperature: str, pairs: int = 10) -> Record:
    """baseline/candidate: {'cwd', 'revision', 'tree'} of the task-owned checkouts holding the pinned reader blobs."""
    require(target in METRICS and type(query_index) is int and 0 <= query_index < 8, 'target/query index')
    require(task == TASK and identities == IDENTITIES and pairs == PAIRS, 'reader cases are Task 15, exactly Reedtrullz/Frontpage, ten pairs')
    require(len(semantic_digest) == 64 and semantic_digest.strip('0123456789abcdef') == '', 'semantic digest must come from the untimed parity step')
    require(sys.platform == 'linux', 'reader cases are authored only on the Linux host that will run them')
    require(temperature in ('cold', 'warm'), 'temperature must be cold or warm')
    require((window, view) == (WINDOWS[query_index // 2], VIEWS[query_index % 2]), 'window/view do not match the original query index')
    require(case_id == make_case_id(target, window, view, temperature), 'case id does not match target/window/view/temperature')
    for phase_name, source in (('baseline', baseline), ('candidate', candidate)):
        require(Path(str(source.get('cwd'))).is_absolute() and all(isinstance(source.get(k), str) and len(source[k]) == 40
                and source[k].strip('0123456789abcdef') == '' for k in ('revision', 'tree')), 'unsupported ' + phase_name + ' source ownership')
    require(baseline['cwd'] != candidate['cwd'], 'baseline and candidate need separate owned checkouts')
    profile = 'reader-linux-' + target + '-v1'
    require(profile in READER, 'unknown reader profile')
    sources = {bridge: file_hash(Path(bridge)), fixture: file_hash(Path(fixture))}
    directory = Path(freeze).parent
    require(Path(freeze).name == 'freeze.json', 'freeze must be freeze.json')
    controls = {str(directory / name): file_hash(directory / name) for name in ('freeze.json', 'manifest.json', 'image.id', 'qualification.json')}
    harness = {**sources, **controls}
    executable = str(Path(sys.executable).resolve())
    argv = [docker, READER_ENTRY]
    parent = capture_environment()
    metrics = {name: {**spec, 'direction': 'lower', 'scope': 'invocation', 'aggregate': 'median', 'repetitions': 1}
               for name, spec in METRICS[target].items()}
    phase = lambda p: {'cwd': p['cwd'], 'revision': p['revision'], 'tree': p['tree'], 'sources': sources}
    return {'schema': 'measurement-case/v1', 'id': case_id, 'task': task, 'identities': identities, 'mode': 'native', 'offline': True,
            'pairs': pairs, 'temperature': temperature, 'samplingUnit': 'invocation',
            'shape': {'target': target, 'queryIndex': query_index, 'window': window, 'view': view, **({'temperature': 'warm'} if temperature == 'warm' else {})}, 'economicsDigest': economics_digest,
            'timeout': 120, 'outputBytes': 1048576, 'scratchBytes': 16 * MIB, 'parentEnvironment': parent, 'artifactRoot': str(ARTIFACT_ROOT),
            'scratchRoot': str(Path(parent['root']) / 'native'), 'runtime': runtime(), 'harness': harness,
            'fixtures': {fixture: sources[fixture]}, 'baseline': phase(baseline), 'candidate': phase(candidate),
            'semanticDigest': semantic_digest, 'capabilities': CAPABILITIES[target], 'primary': next(iter(metrics)), 'metrics': metrics,
            'commands': {s: {'baseline': argv, 'candidate': argv} for s in SCENARIOS}, 'allowlist': [argv],
            'executables': {docker: file_hash(Path(docker)), executable: file_hash(Path(executable))},
            'container': {'profile': profile, 'image': image, 'docker': docker, 'scratchBytes': 7 * MIB, 'freeze': freeze,
                          'entrypoint': READER_ENTRY, 'mounts': {}},
            'receiptEncoding': 'gzip-v1'}


def build_matrix(*, common: Record, semantic: Record, directory: Path, temperature: str = 'cold') -> Record:
    """Write the 16 native cases (2 targets x 8 original queries) of one temperature (default: the historical cold matrix) and their index.
    semantic: {target: [8 digests]}. A warm matrix carries temperature 'warm' in every case and shape; cold bytes are unchanged."""
    require(temperature in ('cold', 'warm'), 'temperature must be cold or warm')
    entries = []
    for target in ('local', 'do'):
        require(isinstance(semantic.get(target), list) and len(semantic[target]) == 8, 'eight semantic digests per target')
        for index, digest_ in enumerate(semantic[target]):
            window, view = WINDOWS[index // 2], VIEWS[index % 2]
            identity = make_case_id(target, window, view, temperature)
            case = build_case(**common, case_id=identity, target=target, query_index=index, window=window, view=view,
                              semantic_digest=digest_, temperature=temperature)
            path = directory / (identity + '.json')
            save(path, case)
            entries.append({'id': identity, 'path': str(path), 'target': target, 'queryIndex': index, 'window': window, 'view': view,
                            'temperature': temperature, 'sha256': file_hash(path)})
    index = {'schema': 'reader-m-case-index/v1', 'temperature': temperature, 'scenarios': list(SCENARIOS), 'artifactRoot': str(ARTIFACT_ROOT),
             'cases': sorted(entries, key=lambda e: e['id']), 'outstanding': list(OUTSTANDING)}
    save(directory / 'index.json', index)
    return index


def expected_shape(target: str, query: int, temperature: str) -> Record:
    shape = {'target': target, 'queryIndex': query, 'window': WINDOWS[query // 2], 'view': VIEWS[query % 2]}
    return {**shape, 'temperature': 'warm'} if temperature == 'warm' else shape


def read_index(path: Path, temperature: str = 'cold') -> Record:
    """Strictly re-read every indexed case of the requested temperature; a saved JSON file alone is never a pass."""
    index = load(path)
    require(index.get('schema') == 'reader-m-case-index/v1' and index.get('temperature') == temperature, 'index schema/temperature')
    require(index.get('scenarios') == list(SCENARIOS) and index.get('artifactRoot') == str(ARTIFACT_ROOT), 'index scenarios/artifact root')
    require(index.get('outstanding') == list(OUTSTANDING), 'index must list the outstanding public/warm cohorts')
    expected = {(t, i) for t in ('local', 'do') for i in range(8)}
    seen = set()
    for entry in index['cases']:
        target, query = entry['target'], entry['queryIndex']
        require((target, query) in expected and (target, query) not in seen, 'missing/duplicate/unknown native case')
        seen.add((target, query))
        require(entry['id'] == make_case_id(target, WINDOWS[query // 2], VIEWS[query % 2], temperature)
                and (entry['window'], entry['view']) == (WINDOWS[query // 2], VIEWS[query % 2]), 'index window/view/index mismatch')
        require(file_hash(Path(entry['path'])) == entry['sha256'], 'stale indexed case')
        case = Case.read(Path(entry['path']))
        data = case.data
        require(entry.get('temperature') == temperature and data['id'] == entry['id'] and data['shape'] == expected_shape(target, query, temperature)
                and data['temperature'] == temperature and sorted(data['commands']) == sorted(SCENARIOS)
                and data['artifactRoot'] == index['artifactRoot'], 'indexed case does not match its entry')
        require((data['task'], data['identities'], data['pairs']) == (TASK, IDENTITIES, PAIRS)
                and data['container']['profile'] == 'reader-linux-' + target + '-v1', 'indexed case task/identity/pairs/profile attribution')
    require(seen == expected, 'index must list all sixteen native cases')
    return index


def main() -> int:
    import json
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', required=True)
    parser.add_argument('--output', help='single case file')
    parser.add_argument('--matrix-dir', help='write the sixteen-case matrix and index.json; SPEC is {common, semantic}')
    parser.add_argument('--temperature', choices=('cold', 'warm'), default='cold', help='matrix temperature; cold (historical) unless warm is selected')
    args = parser.parse_args()
    try:
        spec = json.loads(Path(args.spec).read_text())
        require(isinstance(spec, dict), 'spec must be an object')
        if args.matrix_dir:
            index = build_matrix(common=spec['common'], semantic=spec['semantic'], directory=Path(args.matrix_dir), temperature=args.temperature)
            read_index(Path(args.matrix_dir) / 'index.json', args.temperature)
            print(json.dumps({'status': 'PASS', 'index': str(Path(args.matrix_dir) / 'index.json'), 'cases': len(index['cases'])}))
            return 0
        require(bool(args.output), '--output or --matrix-dir required')
        case = build_case(**spec)
        save(Path(args.output), case)
        print(json.dumps({'status': 'PASS', 'case': args.output, 'digest': digest(case)}))
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'REJECTED', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
