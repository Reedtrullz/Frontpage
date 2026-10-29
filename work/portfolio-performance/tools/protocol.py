"""Run-local JSON bindings. Usage: imported by measure.py and compare.py."""
from __future__ import annotations

import hashlib
import json
import math
import os
import platform
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypeAlias

JSON: TypeAlias = 'None | bool | int | float | str | list[JSON] | dict[str, JSON]'
Record: TypeAlias = dict[str, Any]
ROOT = Path(__file__).resolve().parents[3]
WORK = ROOT / 'work/portfolio-performance'
EVIDENCE = ROOT / '.omo/evidence/portfolio-performance'
RUN_TMP = ROOT / '.omo/t05-run-tmp'
SCOPE = ROOT / '.omo/drafts/portfolio-performance-optimization-scope.json'


class Rejected(ValueError):
    """An input violates the measurement contract."""


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise Rejected(reason)


def record(value: JSON) -> Record:
    if not isinstance(value, dict):
        raise Rejected('expected JSON object')
    return value


GZIP_MAGIC = b'PPGZ1\n'  # versioned opt-in receipt transport; plain JSON never starts with it
DECODED_BOUND = 2_000_000  # same bound as plain JSON load


def decode(raw: bytes) -> str:
    if not raw.startswith(GZIP_MAGIC):
        return raw.decode()
    inflater = zlib.decompressobj(wbits=31)  # gzip framing: header, CRC32 and ISIZE are checked by zlib
    try:
        text = inflater.decompress(raw[len(GZIP_MAGIC):], DECODED_BOUND + 1)
    except zlib.error as error:
        raise Rejected('corrupt gzip receipt') from error
    require(len(text) <= DECODED_BOUND and not inflater.unconsumed_tail, 'gzip receipt expands beyond decode bound')
    require(inflater.eof and not inflater.unused_data, 'truncated or trailing gzip receipt')
    return text.decode()


def load(path: Path) -> Record:
    require(path.stat().st_size <= 2_000_000, 'manifest exceeds bound')
    return record(json.loads(decode(path.read_bytes())))


def save(path: Path, value: Record | list[JSON] | str, *, gzip: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n'
    if not gzip:
        path.write_text(text)
        return
    require(len(text.encode()) <= DECODED_BOUND, 'receipt exceeds gzip decode bound')
    packer = zlib.compressobj(9, zlib.DEFLATED, 31)
    path.write_bytes(GZIP_MAGIC + packer.compress(text.encode()) + packer.flush())


def digest(value: Record | list[JSON] | str) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()


def file_hash(path: Path) -> str:
    require(path.is_file(), f'missing source: {path}')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def owned(path: str, root: Path) -> Path:
    result = Path(path).resolve()
    require(result.is_relative_to(root.resolve()) and result != root.resolve(), 'out-of-root path')
    return result


def finite(value: JSON) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        raise Rejected('missing/non-finite metric')
    return float(value)


def scope() -> tuple[set[str], set[str]]:
    source = load(SCOPE)
    return set(source['includedGithubRepositories']), {r['identity'] for r in source['includedAdditionalLocalIdentities']}


def bindings(files: Record) -> str:
    require(bool(files), 'empty source binding')
    for path, expected in files.items():
        require(file_hash(Path(path)) == expected, 'stale source/fixture/harness')
    return digest(files)


def runtime() -> Record:
    return {'python': sys.version, 'executable': str(Path(sys.executable).resolve()),
            'platform': platform.platform(), 'machine': platform.machine()}


def verify_source(case: Record, phase: str) -> None:
    """Match task2 ownership and exact native commit/tree; selftests bind authored files."""
    source = case[phase]
    bindings(source['sources'])
    cwd = Path(source['cwd']).resolve()
    if case.get('selftestOnly') is True:
        require(case['task'] == 5 and cwd == WORK / 'tools/fixtures', 'selftest cwd/task')
        require(source['revision'] == digest(source['sources']), 'revision/source mismatch')
        return
    ownership = load(WORK / 'ownership.json')
    permitted = [claim for row in ownership['rows'] if row['identity'] in case['identities']
                 for claim in row.get('taskOwnedCheckouts', [])
                 if claim['taskId'] == case['task'] and Path(claim['checkout']).resolve() == cwd
                 and claim.get('created') is True]
    require(bool(permitted), 'cwd is not an existing task-owned checkout')
    require(all(Path(r['path']).resolve() != cwd for row in ownership['rows'] for r in row['roots']), 'primary checkout forbidden')
    env = {'PATH': '/usr/bin:/bin', 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_OPTIONAL_LOCKS': '0', 'TMPDIR': os.environ['TMPDIR'],
           'NODE_COMPILE_CACHE': os.environ['NODE_COMPILE_CACHE'],
           'BUN_RUNTIME_TRANSPILER_CACHE_PATH': os.environ['BUN_RUNTIME_TRANSPILER_CACHE_PATH']}
    for argv, expected in [(['/usr/bin/git', '-C', str(cwd), 'rev-parse', 'HEAD', 'HEAD^{tree}'], source['revision'] + '\n' + source['tree'] + '\n'),
                           (['/usr/bin/git', '-C', str(cwd), 'diff', '--quiet', '--no-ext-diff', '--no-textconv', 'HEAD', '--'], '')]:
        result = subprocess.run(argv, env=env, capture_output=True, text=True, timeout=3)
        require(result.returncode == 0 and result.stdout == expected and not result.stderr, 'stale/dirty Git source')


def slot(case: Record, index: int) -> Record:
    """Ten pilot units, optional two warmup pairs, then the locked final count."""
    warm = 4 if case['temperature'] == 'warm' else 0
    total = 10 + warm + 2 * case['pairs']
    require(type(index) is int and 0 <= index < total, 'sample outside fixed count')
    stage = 'pilot' if index < 10 else ('warmup' if index < 10 + warm else 'measured')
    offset = index if index < 10 else (index - 10 if stage == 'warmup' else index - 10 - warm)
    pair, member = divmod(offset, 2)
    order = 'AB' if pair % 2 == 0 else 'BA'
    phase = 'baseline' if stage == 'pilot' or order[member] == 'A' else 'candidate'
    return {'sample': index, 'stage': stage, 'pair': pair, 'member': member,
            'order': order, 'phase': phase, 'unit': f'{stage}-{pair}-{member}'}


@dataclass(frozen=True, slots=True)
class Case:
    path: Path
    data: Record
    sha256: str

    @classmethod
    def read(cls, path: Path) -> Case:
        data = load(path)
        github, local = scope()
        identities = data.get('identities', [])
        require(bool(identities) and len(set(identities)) == len(identities), 'missing/duplicate identity')
        require(set(identities) <= github | local, 'excluded identity')
        require(data.get('schema') == 'measurement-case/v1', 'case schema')
        if data.get('mode') == 'static':
            require(not any(k in data for k in ('commands', 'allowlist', 'pairs')), 'static case cannot dispatch')
            bindings(record(data['sources']))
            require(set(identities) <= local if data['task'] == 32 else set(identities) <= github, 'static task scope')
            return cls(path.resolve(), data, digest(data))
        require(not set(identities) & local and data['task'] != 32, 'metadata identity cannot run')
        require(data.get('mode') == 'native', 'unsupported mode')
        require(data.get('pairs') in (5, 10, 20), 'fixed sample count')
        require(data['pairs'] != 20 or bool(data.get('pilotJustification')), '20 pairs needs predeclared justification')
        require(data.get('temperature') in ('warm', 'cold'), 'temperature')
        require(data.get('offline') is True, 'native offline contract required')
        for key, ceiling in [('timeout', 120), ('outputBytes', 1048576)]:
            require(0 < finite(data[key]) <= ceiling, f'invalid {key} bound')
            require(key == 'timeout' or type(data[key]) is int, 'byte bounds must be integers')
        require(data['runtime'] == runtime(), 'runtime/platform mismatch')
        from resource_limits import ResourceBudget
        ResourceBudget.read(data)
        require(data.get('samplingUnit') == 'invocation', 'independent unit must be invocation')
        require(data.get('receiptEncoding') in (None, 'gzip-v1'), 'unknown receipt encoding')
        require(bool(data.get('shape')) and bool(data.get('economicsDigest')), 'shape/economics binding')
        bindings(record(data['harness']))
        bindings(record(data['fixtures']))
        metrics = record(data['metrics'])
        require(data['primary'] in metrics, 'missing primary')
        for spec in metrics.values():
            spec = record(spec)
            require(spec['kind'] in ('timing', 'counter'), 'metric kind')
            require(spec['direction'] in ('lower', 'higher'), 'metric direction')
            require(spec['kind'] != 'counter' or spec['direction'] == 'lower', 'deterministic counters must not increase')
            require(spec['scope'] in ('invocation', 'nested'), 'metric scope')
            require(spec['aggregate'] in ('median', 'sum', 'max'), 'metric aggregation')
            require(spec['unit'] in ('s', 'ms', 'us', 'bytes', 'KiB', 'count'), 'metric unit')
            require((spec['kind'] == 'timing') == (spec['unit'] in ('s', 'ms', 'us')), 'metric kind/unit dimension')
            require(type(spec['repetitions']) is int and spec['repetitions'] > 0, 'repetitions')
            require(spec['scope'] != 'invocation' or spec['repetitions'] == 1, 'repeated invocation metric')
            if 'tolerance' in spec:
                require(finite(spec['tolerance']) >= 0, 'invalid timing tolerance')
            if 'budget' in spec:
                require(finite(spec['budget']) >= 0, 'invalid existing budget')
        for phase in ('baseline', 'candidate'):
            verify_source(data, phase)
        for scenario, phases in record(data['commands']).items():
            require(bool(scenario), 'empty scenario')
            for phase in ('baseline', 'candidate'):
                argv = phases[phase]
                require(isinstance(argv, list) and argv in data['allowlist'], 'rejected argv')
                require(all(isinstance(a, str) and a and '\x00' not in a and '$' not in a for a in argv), 'literal argv required')
                require(Path(argv[0]).is_absolute(), 'absolute executable required')
                require(not any(Path(a).name in ('sh', 'bash', 'zsh', 'curl', 'ssh', 'wget', 'gh') for a in argv), 'forbidden dispatch')
                require(not any('://' in a or 'token=' in a.lower() for a in argv), 'network/credential argv')
                require(argv[0] in data['executables'] and file_hash(Path(argv[0])) == data['executables'][argv[0]], 'executable binding')
        if 'container' in data:
            from container_resources import validate
            for phase in ('baseline', 'candidate'):
                validate(data, phase)
        return cls(path.resolve(), data, digest(data))
