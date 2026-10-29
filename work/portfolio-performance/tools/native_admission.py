"""Actual-host native admission for reader M cases. QUALIFICATION_ONLY: never an M pilot, sample or gain.

Usage (hosted Linux, after reader-m-prepare.mjs ci): python3 native_admission.py --control .reader-m --out .reader-m-admission
The literal protocol is written and hashed before the first observation. The helper then creates two real task-owned checkouts at
the pinned reader commits, generates a minimal Frontpage-only scope/ownership on this host, runs every (target, query, phase,
scenario) cell through the real ContainerJob and image-internal bridge, derives semantic digests from that parity, writes the
sixteen cold cases and strict-loads each with the unmocked Case.read. Future M (960 units) is frozen and estimated; it executes only
with the explicit --collect-m opt-in (original plan M: measure.py per slot, then one compare.py), never by default.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import selectors
import signal
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

import reader_m_case
from container_resources import MIB, READER, TerminalFailure, ContainerJob
from protocol import ROOT, RUN_TMP, SCOPE, WORK, Case, Record, Rejected, digest, file_hash, load, record, require, runtime, save, slot
from resource_limits import ResourceBudget

LABEL = 'QUALIFICATION_ONLY'
OWNERSHIP = WORK / 'ownership.json'
READER_PATH = 'src/lib/metrics/v2/reader.ts'
TARGETS, PHASES, SCENARIOS = ('local', 'do'), ('baseline', 'candidate'), ('happy', 'failure')
CLEAN_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
FAILURE_HASH = hashlib.sha256(json.dumps(['failure', 'unavailable'], separators=(',', ':')).encode()).hexdigest()
KEYS = ('caseHash', 'phase', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'shape', 'economicsDigest')
M_PARENT = 'unblocking-20261028'
M_UNIT_SECONDS, M_CASE_SECONDS, M_RUN_SECONDS = 120, 1800, 3300  # run bound leaves room inside the 60 minute CI step for compare/copy/teardown


def order() -> list[list[object]]:
    return [[t, q, p, s] for t in TARGETS for q in range(8) for p in PHASES for s in SCENARIOS]


def m_output(artifact_root: str, task: int) -> str:
    """compare.py reads <evidence>/t<task>/<case>/<scenario>, so measure.py must write beneath that same t<task> directory."""
    return str(Path(artifact_root) / f't{task:02d}')


def m_plan(py: str, cases: list[tuple[str, dict]]) -> list[dict]:
    """Literal original-M argv for every unit: sorted case paths, every fixed slot, both scenarios; frozen before the first observation."""
    plan = []
    for path, data in sorted(cases, key=lambda c: c[0]):
        output = m_output(data['artifactRoot'], data['task'])
        for index in range(10 + (4 if data['temperature'] == 'warm' else 0) + 2 * data['pairs']):
            phase = slot(data, index)['phase']
            for scenario in SCENARIOS:
                plan.append({'case': data['id'], 'scenario': scenario, 'sample': index, 'phase': phase,
                             'argv': [py, str(WORK / 'tools/measure.py'), '--case', path, '--phase', phase, '--scenario', scenario,
                                      '--sample', str(index), '--output', output]})
    return plan


def run_process(argv: list[str], env: dict, timeout: float) -> tuple[int, str, str]:
    """Run argv with the combined stdout/stderr ceiling enforced while it runs; a breach or deadline kills and reaps the whole process group."""
    process = subprocess.Popen(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, shell=False)
    assert process.stdout is not None and process.stderr is not None
    output, deadline = [bytearray(), bytearray()], time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ, 0)
            selector.register(process.stderr, selectors.EVENT_READ, 1)
            while selector.get_map():
                if deadline <= time.monotonic():
                    raise subprocess.TimeoutExpired(argv, timeout, bytes(output[0]), bytes(output[1]))
                for key, _ in selector.select(timeout=min(0.05, max(0, deadline - time.monotonic()))):
                    chunk = os.read(key.fd, 65536)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    room = MIB - len(output[0]) - len(output[1])
                    output[key.data].extend(chunk[:room])
                    if len(chunk) > room:
                        raise Rejected('process output exceeded the combined 1MiB bound; killed. stdout head: ' + output[0][:300].decode(errors='replace')
                                       + ' stderr head: ' + output[1][:300].decode(errors='replace'))
        process.wait(timeout=max(0.001, deadline - time.monotonic()))
    finally:
        try:
            os.killpg(process.pid, signal.SIGKILL)  # also reaps any owned descendant still holding the group
        except OSError:
            pass
        process.wait(timeout=5)
        process.stdout.close()
        process.stderr.close()
    return process.returncode, output[0].decode(errors='replace'), output[1].decode(errors='replace')


class Counted:
    """Budget view that also counts every mutable byte under out/ (qualification records, M metadata, logs, archived raw units).
    Only the frozen read-only inputs/ byte snapshots are excluded."""

    def __init__(self, budget: ResourceBudget, out: Path) -> None:
        self.budget, self.out = budget, out

    def __getattr__(self, name: str):
        return getattr(self.budget, name)

    def mutable(self) -> int:
        size = 0
        for path in self.out.rglob('*'):
            require(not path.is_symlink(), 'output symlink')
            if path.is_file() and not path.is_relative_to(self.out / 'inputs'):
                size += path.stat().st_size
        return size

    def usage(self) -> int:
        return self.budget.usage() + self.mutable()

    def enforce(self, reserved_bytes: int = 0) -> int:
        size = self.usage() + reserved_bytes
        require(size <= self.budget.limit, 'combined scratch/artifact bound exceeded')
        return size


def archive_raw(root: Path, target: Path) -> dict:
    """Move the live raw-unit tree once into the counted output archive (no second copy), keeping an original-path -> sha256 mapping."""
    if not root.exists():
        return {'files': 0}
    files = sorted(p for p in root.rglob('*') if p.is_file())
    before = {str(p): (hashlib.sha256(p.read_bytes()).hexdigest(), p.stat().st_size) for p in files}
    shutil.move(root, target)
    mapping = []
    for original, (hash_, size) in before.items():
        moved = target / Path(original).relative_to(root)
        require(moved.is_file() and hashlib.sha256(moved.read_bytes()).hexdigest() == hash_, 'archived raw unit missing or altered: ' + original)
        mapping.append({'originalPath': original, 'archivedPath': str(moved), 'sha256': hash_, 'size': size})
    save(target.parent / 'artifact-map.json', mapping)
    return {'files': len(mapping)}


def run_m(plan: list[dict], env: dict, runner, budget: ResourceBudget | Counted, reservation: int, rows: list[dict], clock=time.monotonic, start: float | None = None) -> dict:
    """Run the frozen plan strictly in order. The first rejected unit, bound or deadline stops everything: no retry, skip or extra sample."""
    start = clock() if start is None else start
    case_start, peak = {}, 0
    for n, unit in enumerate(plan):
        now = clock()
        case_start.setdefault(unit['case'], now)
        row = {'index': n, **{k: unit[k] for k in ('case', 'scenario', 'sample', 'phase')}, 'status': 'ERROR'}
        rows.append(row)
        try:
            require(now - start < M_RUN_SECONDS and now - case_start[unit['case']] < M_CASE_SECONDS, 'whole-run or case deadline reached')
            peak = max(peak, budget.enforce(reservation))  # namespace reservation for this unit, counted with every retained artifact
            code, out, err = runner(unit['argv'], env, min(M_UNIT_SECONDS + 15, M_RUN_SECONDS - (now - start)))
            row.update(returncode=code, stdout=out, stderr=err)
            receipt = json.loads(out)
            require(code == 0 and receipt.get('status') == 'PASS' and not receipt.get('error'), 'measure.py rejected unit: ' + (receipt.get('error') or err[-200:] or str(code)))
            peak = max(peak, budget.enforce(reservation))
            row['status'] = 'PASS'
        except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
            row['error'] = str(error)
            return {'status': 'ERROR', 'error': f'M unit {n} {unit["case"]} {unit["scenario"]} sample {unit["sample"]}: {error}', 'maxOccupancyBytes': peak}
    return {'status': 'PASS', 'units': len(plan), 'maxOccupancyBytes': peak}


def collect_m(out: Path, index: Record, py: str, runner=run_process, read_case=Case.read, read_budget=ResourceBudget.read, clock=time.monotonic) -> dict:
    """Original M on this actual host, after strict Case.read of all sixteen cases and before checkouts/scope/environment are destroyed.
    Raw units live in the original u04/t15 tree until no workload remains, then move once into out/m/artifacts on every exit. All out/ bytes
    except inputs/ are counted with the invocation root and u04 against the one 16MiB bound. read_case/read_budget/clock are test injection points."""
    start, mdir, rows = clock(), out / 'm', []
    mdir.mkdir()
    result: dict = {'label': 'M_COLLECTION', 'status': 'ERROR'}
    root: Path | None = None
    counted: Counted | None = None
    try:
        cases = [(e['path'], read_case(Path(e['path']))) for e in index['cases']]
        plan = m_plan(py, [(path, case.data) for path, case in cases])
        require(len(plan) == 960 and len({tuple(u['argv']) for u in plan}) == 960, 'M plan must be 960 unique units')
        data = cases[0][1].data
        live = Path(m_output(index['artifactRoot'], data['task']))
        require(not live.exists(), 'prior M artifacts exist')  # never archive (move) a tree this run did not create
        root = live
        env = dict(os.environ)
        evidence = [py, str(WORK / 'tools/compare.py'), '--task', str(data['task']), *[a for path, _ in sorted(cases, key=lambda c: c[0]) for a in ('--case', path)],
                    '--evidence', index['artifactRoot']]
        save(mdir / 'protocol.json', {'schema': 'native-m-protocol/v1', 'label': 'M_COLLECTION', 'plan': plan, 'compare': evidence, 'outputRoot': str(root),
                                      'caseHashes': {c.data['id']: c.sha256 for _, c in cases}, 'environment': env,
                                      'limits': {'scratchBytes': 16 * MIB, 'unitSeconds': M_UNIT_SECONDS, 'caseSeconds': M_CASE_SECONDS, 'runSeconds': M_RUN_SECONDS,
                                                 'outputBytes': MIB, 'namespaceBytes': 7 * MIB}})
        result['protocolSha'] = sha(mdir / 'protocol.json')
        budget = counted = Counted(read_budget(data), out)
        try:
            result.update(run_m(plan, env, runner, budget, 7 * MIB, rows, clock=clock, start=start))
        finally:
            save(mdir / 'units.json', rows)
        if result['status'] == 'PASS':
            remaining = M_RUN_SECONDS - (clock() - start)
            require(remaining > 0, 'whole-run deadline reached before comparison')
            compare: dict = {'argv': evidence, 'returncode': None, 'stdout': '', 'stderr': ''}
            try:
                code, text, err = runner(evidence, env, min(600, remaining))
                compare.update(returncode=code, stdout=text, stderr=err)
                comparison = json.loads(text)
                require(code == 0 and comparison.get('status') == 'PASS' and len(comparison['cases']) == 32, 'compare.py did not accept all 32 case-scenario comparisons')
            except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
                compare['error'] = str(error)
                raise
            finally:
                save(mdir / 'compare.json', compare)
            result['maxOccupancyBytes'] = max(result['maxOccupancyBytes'], budget.enforce())
            result['comparisons'] = 32
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        result.update(status='ERROR', error=str(error))
    finally:
        try:
            if root is not None:
                result['archive'] = archive_raw(root, mdir / 'artifacts')
                result['finalOccupancyBytes'] = counted.enforce() if counted else None
        except (Rejected, OSError, ValueError, KeyError, TypeError) as error:
            result.update(status='ERROR', archiveError=str(error))
        save(mdir / 'result.json', result)
    return result


def frozen_protocol(manifest: dict) -> dict:
    """Everything below is fixed before any observation; its hash binds every later record."""
    return {'schema': 'native-admission-protocol/v1', 'label': LABEL, 'queryIndices': list(range(8)), 'targets': list(TARGETS),
            'phases': list(PHASES), 'scenarios': list(SCENARIOS), 'invocations': len(order()), 'order': order(),
            'limits': {'scratchBytes': 16 * MIB, 'timeoutSeconds': 120, 'outputBytes': MIB, 'namespaceBytes': 7 * MIB},
            'profiles': {t: {'name': 'reader-linux-' + t + '-v1', 'pids': READER['reader-linux-' + t + '-v1'].pids,
                             'cpus': READER['reader-linux-' + t + '-v1'].cpus, 'memory': READER['reader-linux-' + t + '-v1'].memory,
                             'node': list(READER['reader-linux-' + t + '-v1'].node)} for t in TARGETS},
            'pins': manifest['pins'], 'readerProtocolSha': manifest['protocolSha'],
            'futureM': {'executed': False, 'cases': 16, 'scenarios': 2, 'pairs': 10, 'slots': 30, 'units': 960},
            'noStatistics': 'no gain, no timing comparison, no sample extension; records are never M samples'}


def sha(path: Path) -> str:
    return file_hash(path)


def git(*args: str, env: dict, cwd: Path = ROOT) -> str:
    result = subprocess.run(['git', *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
    require(result.returncode == 0, 'git ' + ' '.join(args) + ': ' + result.stderr[-300:])
    return result.stdout.strip()


def make_checkouts(base: Path, pins: dict, env: dict) -> dict:
    """Two real, separate, clean Git checkouts at the pinned commits; the pinned reader blob is read back from each."""
    result = {}
    for phase, variant in (('baseline', 'before'), ('candidate', 'candidate')):
        pin = pins[variant]
        if subprocess.run(['git', 'cat-file', '-e', pin['commit'] + '^{commit}'], cwd=ROOT, env=env).returncode != 0:
            git('fetch', '--no-tags', '--depth=1', 'origin', pin['commit'], env=env)
        cwd = base / phase
        git('worktree', 'add', '--detach', str(cwd), pin['commit'], env=env)
        head, tree = git('rev-parse', 'HEAD', cwd=cwd, env=env), git('rev-parse', 'HEAD^{tree}', cwd=cwd, env=env)
        blob = git('rev-parse', 'HEAD:' + READER_PATH, cwd=cwd, env=env)
        require(head == pin['commit'] and blob == pin['blob'], 'checkout does not match pin ' + variant)
        require(git('status', '--porcelain', cwd=cwd, env=env) == '', 'dirty checkout')
        result[phase] = {'cwd': str(cwd), 'revision': head, 'tree': tree, 'readerBlob': blob}
    require(result['baseline']['cwd'] != result['candidate']['cwd'], 'checkouts must be separate')
    return result


def write_scope_and_ownership(checkouts: dict, scope_path: Path = SCOPE, ownership_path: Path = OWNERSHIP) -> None:
    """Minimal real Frontpage-only inputs generated on this host; an existing file (e.g. the private scope) is never overwritten."""
    require(not scope_path.exists() and not ownership_path.exists(), 'refusing to overwrite existing scope/ownership')
    scope_path.parent.mkdir(parents=True, exist_ok=True)
    scope_path.write_text(json.dumps({'generatedOnHost': True, 'label': LABEL, 'includedGithubRepositories': list(reader_m_case.IDENTITIES),
                                      'includedAdditionalLocalIdentities': []}, sort_keys=True))
    claims = [{'taskId': reader_m_case.TASK, 'checkout': c['cwd'], 'created': True} for c in checkouts.values()]
    ownership_path.write_text(json.dumps({'generatedOnHost': True, 'rows': [{'identity': reader_m_case.IDENTITIES[0], 'roots': [{'path': str(ROOT)}],
                                                                              'taskOwnedCheckouts': claims}]}, sort_keys=True))


INPUT_CLASS = 'immutable-input'


def archive_input(out: Path, path: str, role: str, manifest: dict) -> None:
    """Byte-copy one immutable referenced input, read-only and content-addressed, before any observation that depends on it.
    Inputs live beside (never inside) the writable scratch/caches/M outputs; they are frozen provenance, not an allowance."""
    data = Path(path).read_bytes()
    digest_ = hashlib.sha256(data).hexdigest()
    directory = out / 'inputs'
    directory.mkdir(exist_ok=True)
    target = directory / digest_
    if not target.exists():
        target.write_bytes(data)
        target.chmod(0o444)
    manifest[path] = {'sourcePath': path, 'resolvedPath': str(Path(path).resolve()), 'sha256': digest_, 'size': len(data), 'archivedAs': 'inputs/' + digest_,
                      'classification': INPUT_CLASS, 'role': role}
    save(directory / 'manifest.json', {'label': LABEL, 'classification': INPUT_CLASS, 'inputs': manifest})


def verify_inputs(out: Path, cases: list[dict]) -> dict:
    """Every direct case binding (harness, fixtures, executables, both phase sources) must have archived bytes that hash to the bound value."""
    manifest = load(out / 'inputs' / 'manifest.json')['inputs']
    bindings = 0
    for data in cases:
        for group in (data['harness'], data['fixtures'], data['executables'], data['baseline']['sources'], data['candidate']['sources']):
            for source, expected in group.items():
                entry = manifest.get(source)
                require(entry is not None and entry['sha256'] == expected, 'case binding has no archived input snapshot: ' + source)
                archived = out / entry['archivedAs']
                require(archived.is_file() and not archived.stat().st_mode & (stat.S_IWUSR | stat.S_IWGRP | stat.S_IWOTH)
                        and hashlib.sha256(archived.read_bytes()).hexdigest() == expected, 'archived input bytes missing, writable or altered: ' + source)
                bindings += 1
    return {'cases': len(cases), 'bindingsVerified': bindings, 'distinctInputs': len(manifest), 'missing': [], 'classification': INPUT_CLASS}


def parity(records: list[dict]) -> dict:
    """Per-target semantic digests from the real baseline/candidate outputs; every digest is recomputed from the reader output hash."""
    semantic: dict[str, list[str]] = {t: [] for t in TARGETS}
    cells: dict[tuple, dict] = {}
    for r in records:
        cells[(r['target'], r['query'], r['phase'], r['scenario'])] = r['native']
    for t in TARGETS:
        for q in range(8):
            digests = set()
            for s in SCENARIOS:
                a, b = cells[(t, q, 'baseline', s)], cells[(t, q, 'candidate', s)]
                require(a['outputHash'] == b['outputHash'] and a['semanticDigest'] == b['semanticDigest'], f'parity mismatch {t} q{q} {s}')
                expected = FAILURE_HASH if s == 'failure' else None
                require(expected is None or a['outputHash'] == expected, f'failure output is not the unavailable error {t} q{q}')
                digests.add(a['semanticDigest'])
            happy = cells[(t, q, 'baseline', 'happy')]['outputHash']
            recomputed = hashlib.sha256(('{"%d":"%s"}' % (q, happy)).encode()).hexdigest()
            require(digests == {recomputed} and len(recomputed) == 64 and set(recomputed) != {'0'}, f'semantic digest is not derived from the reader output {t} q{q}')
            semantic[t].append(recomputed)
        require(len(set(semantic[t])) > 1, 'all queries share one digest: placeholder suspected')
    return semantic


def run_unit(budget: ResourceBudget | Counted, data: dict, target: str, query: int, phase: str, scenario: str, index: int, protocol_sha: str) -> dict:
    scratch = Path(tempfile.mkdtemp(prefix='unit-', dir=budget.native_root))
    for sub in ('docker',):
        (scratch / sub).mkdir()
    shape = {'target': target, 'queryIndex': query, 'window': reader_m_case.WINDOWS[query // 2], 'view': reader_m_case.VIEWS[query % 2]}
    request = {'phase': phase, 'unit': f'qualification-{index:03d}', 'sample': index, 'scenario': scenario, 'caseHash': protocol_sha, 'revision': data[phase]['revision'],
               'fixtureDigest': digest(data['fixtures']), 'harnessDigest': digest(data['harness']), 'shape': shape, 'economicsDigest': data['economicsDigest']}
    env = {'PATH': data['parentEnvironment']['PATH'], 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1', 'HOME': str(scratch), 'TMPDIR': str(scratch),
           'NODE_COMPILE_CACHE': str(scratch / 'node'), 'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(scratch / 'bun'), 'DOCKER_CONFIG': str(scratch / 'docker'),
           'MEASURE_REQUEST': json.dumps(request)}
    rec: dict = {'label': LABEL, 'index': index, 'target': target, 'query': query, 'phase': phase, 'scenario': scenario, 'request': request,
                 'status': 'ERROR', 'peakBytes': 0}
    job, process, stop = None, None, threading.Event()
    reservation = data['container']['scratchBytes']

    def sample() -> None:
        while not stop.is_set():
            try:
                rec['peakBytes'] = max(rec['peakBytes'], budget.enforce(reservation))
            except (Rejected, OSError) as error:
                rec['scratchError'] = str(error)
                if process is not None:
                    process.kill()
                return
            time.sleep(0.05)
    watcher = threading.Thread(target=sample, daemon=True)
    try:
        job = ContainerJob(data, phase, scratch, env, time.monotonic() + data['timeout'])
        rec['container'] = job.identity
        argv = job.prepare(data['commands'][scenario][phase], env['MEASURE_REQUEST'], data['timeout'])
        rec['controlArgv'] = argv
        rec['peakBytes'] = budget.enforce(reservation)
        watcher.start()
        process = subprocess.Popen(argv, cwd=data[phase]['cwd'], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        out, err = process.communicate(timeout=data['timeout'] - 12)
        rec.update(returncode=process.returncode, stdout=out[:data['outputBytes']].decode(errors='replace'), stderr=err[:data['outputBytes']].decode(errors='replace'))
        require(len(out) + len(err) <= data['outputBytes'] and process.returncode == 0 and 'scratchError' not in rec, 'nonzero/oversized/over-budget run')
        native = record(json.loads(rec['stdout']))
        require(native.get('status') == 'complete' and all(native.get(k) == request[k] for k in KEYS if k != 'caseHash') and native.get('caseHash') == protocol_sha
                and native.get('queryIndex') == query and native.get('capabilities') == data['capabilities']
                and set(native['metrics']) == set(data['metrics']), 'native receipt does not echo/bind the request')
        rec['native'] = native
        rec['status'] = 'PASS'
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        rec['error'] = str(error)
    finally:
        stop.set()
        if process is not None and process.poll() is None:
            process.kill()
            process.wait(timeout=5)
        if watcher.is_alive():
            watcher.join(timeout=2)
        if job is not None:
            try:
                job.close()
            except TerminalFailure as error:
                rec.update(status='ERROR', terminalError=str(error))
            except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
                rec.update(status='ERROR', cleanupError=str(error))
            rec['cleaned'] = job.identity.get('cleaned') is True
            state = job.identity.get('terminalState') or {}
            rec['terminal'] = {k: state.get(k) for k in ('ExitCode', 'OOMKilled', 'Running', 'Pid', 'Status')}
        shutil.rmtree(scratch, ignore_errors=True)
        budget.clear_parent_caches()
        rec['postCleanupBytes'] = budget.usage()
    if rec['status'] == 'PASS':
        require(rec.get('cleaned') is True and rec['terminal'].get('ExitCode') == 0 and rec['terminal'].get('OOMKilled') is False, 'container not cleanly terminated')
    return rec


def projection(index: Record, records: list[dict]) -> Record:
    """Whole-960-unit artifact estimate from real envelope sizes; an estimate, never a benchmark result."""
    by = {(r['target'], r['query'], r['phase'], r['scenario']): r for r in records}
    total, per_case = 0, {}
    for entry in index['cases']:
        case = load(Path(entry['path']))
        for s in SCENARIOS:
            sizes = {}
            for p in PHASES:
                r = by[(entry['target'], entry['queryIndex'], p, s)]
                tmp = Path(tempfile.mkdtemp(prefix='size-', dir=RUN_TMP)) / 'r.json'
                save(tmp, {**r, 'definition': case, 'state': slot(case, 0)}, gzip=True)
                sizes[p] = tmp.stat().st_size
                shutil.rmtree(tmp.parent)
            slots = [slot(case, i)['phase'] for i in range(30)]
            use = sum(sizes[p] for p in slots)
            per_case[entry['id'] + '/' + s] = use
            total += use
    return {'label': 'ESTIMATE_ONLY', 'units': 960, 'artifactBytes': total, 'perCaseScenarioBytes': per_case,
            'reservationPerUnitBytes': 7 * MIB, 'scratchLimitBytes': 16 * MIB, 'maxObservedPeakBytes': max(r['peakBytes'] for r in records),
            'note': 'size of gzip receipts incl. definition for every one of the 30 slots; excludes host namespace reservation which is not retained'}


def execute(args: argparse.Namespace) -> int:
    out, control = Path(args.out).resolve(), Path(args.control).resolve()
    root = Path(os.environ['TMPDIR']).parent
    result: dict = {'label': LABEL, 'status': 'ERROR', 'phases': {}}
    checkouts: dict = {}
    generated = False
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    git_env = {'PATH': CLEAN_PATH, 'HOME': os.environ['HOME'], 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_TERMINAL_PROMPT': '0'}
    try:
        require(sys.platform == 'linux', 'admission runs only on the actual Linux host')
        freeze, manifest = load(control / 'freeze.json'), load(control / 'manifest.json')
        require(load(control / 'qualification.json').get('pass') is True and (control / 'image.id').read_text().strip() == freeze['imageId'], 'reader qualification not passed')
        inputs: dict = {}
        docker = shutil.which('docker', path=CLEAN_PATH)
        require(docker is not None, 'docker executable missing')
        assert docker is not None
        bridge, fixture = ROOT / 'scripts/perf/reader-m-bridge.mjs', ROOT / 'scripts/perf/reader-m-fixture.mjs'
        py = str(Path(sys.executable).resolve())
        for name, role in (('freeze.json', 'control'), ('manifest.json', 'control'), ('image.id', 'control'), ('qualification.json', 'control')):
            archive_input(out, str(control / name), role, inputs)
        for p, role in ((str(bridge), 'bridge'), (str(fixture), 'fixture'), (docker, 'docker-control-binary'), (py, 'python-interpreter')):
            archive_input(out, p, role, inputs)
        protocol = frozen_protocol(manifest)
        save(out / 'protocol.json', protocol)
        protocol_sha = sha(out / 'protocol.json')
        result['protocolSha'] = protocol_sha
        result['protocolFrozenAtNs'] = time.monotonic_ns()
        archive_input(out, str(out / 'protocol.json'), 'frozen-protocol', inputs)
        graph = record(manifest['graph'])
        require(graph['lock'] == sha(ROOT / 'pnpm-lock.yaml'), 'pnpm lock differs from the attested image graph')
        checkouts = make_checkouts(ROOT / '.omo/native-admission/checkouts', manifest['pins'], git_env)
        write_scope_and_ownership(checkouts)
        generated = True
        archive_input(out, str(SCOPE), 'generated-scope', inputs)
        archive_input(out, str(OWNERSHIP), 'generated-ownership', inputs)
        result['provenance'] = {'checkouts': checkouts, 'graph': graph, 'pins': manifest['pins'], 'imageId': freeze['imageId'], 'python': {'path': py, 'sha256': sha(Path(py)), 'version': sys.version},
                                'docker': {'path': docker, 'sha256': sha(Path(docker))}, 'git': git('--version', env=git_env), 'runtime': runtime(),
                                'head': git('rev-parse', 'HEAD', env=git_env), 'tree': git('rev-parse', 'HEAD^{tree}', env=git_env), 'environment': dict(os.environ)}
        common = {'task': reader_m_case.TASK, 'identities': reader_m_case.IDENTITIES, 'docker': docker, 'image': freeze['imageId'], 'freeze': str(control / 'freeze.json'),
                  'bridge': str(bridge), 'fixture': str(fixture), 'economics_digest': protocol_sha,
                  'baseline': {k: checkouts['baseline'][k] for k in ('cwd', 'revision', 'tree')}, 'candidate': {k: checkouts['candidate'][k] for k in ('cwd', 'revision', 'tree')}}
        hashed = {str(p): sha(p) for p in (bridge, fixture, SCOPE, OWNERSHIP, out / 'protocol.json', *(control / n for n in ('freeze.json', 'manifest.json', 'image.id', 'qualification.json')))}
        save(out / 'before-case-read.json', {'label': LABEL, 'literalBytesHashedBeforeCaseRead': hashed, 'common': common})
        bootstrap_digest = hashlib.sha256((LABEL + ':' + protocol_sha).encode()).hexdigest()
        bootstrap = {}
        for t in TARGETS:
            bootstrap[t] = reader_m_case.build_case(**common, case_id=reader_m_case.make_case_id(t, '1h', 'host', 'cold'), target=t, query_index=0, window='1h', view='host',
                                                    semantic_digest=bootstrap_digest, temperature='cold')
            bootstrap[t]['qualificationOnly'] = True
        save(out / 'qualification-bootstrap-cases.json', bootstrap)
        budget = Counted(ResourceBudget.read(bootstrap['local']), out)
        records: list[dict] = []
        (out / 'records').mkdir()
        for i, (t, q, p, s) in enumerate(order()):
            rec = run_unit(budget, bootstrap[t], t, q, p, s, i, protocol_sha)
            records.append(rec)
            save(out / 'records' / f'{i:03d}-{t}-q{q}-{p}-{s}.json.gz', rec, gzip=True)
            if rec['status'] != 'PASS':
                raise Rejected(f'qualification unit {i} {t} q{q} {p} {s}: {rec.get("error") or rec.get("terminalError") or rec.get("cleanupError")}')
        semantic = parity(records)
        save(out / 'semantic-parity.json', {'label': LABEL, 'semantic': semantic})
        cases = out / 'cases'
        cases.mkdir()
        reader_m_case.build_matrix(common=common, semantic=semantic, directory=cases)
        index = reader_m_case.read_index(cases / 'index.json')  # unmocked Case.read on every case, on this host
        require(hashed == {k: sha(Path(k)) for k in hashed}, 'literal common bytes changed during admission')
        result['inputSnapshots'] = verify_inputs(out, [load(Path(e['path'])) for e in index['cases']])
        result['caseRead'] = {'cases': len(index['cases']), 'strictLoad': 'PASS', 'caseDigests': {e['id']: Case.read(Path(e['path'])).sha256 for e in index['cases']}}
        save(out / 'estimate.json', projection(index, records))
        slots = [slot(load(Path(index['cases'][0]['path'])), i) for i in range(30)]
        save(out / 'future-m-protocol.json', {'label': 'FROZEN_NOT_EXECUTED', 'protocolSha': protocol_sha, 'cases': len(index['cases']), 'scenarios': list(SCENARIOS), 'slots': slots,
                                              'units': 960, 'artifactRoot': index['artifactRoot'],
                                              'argvTemplate': [py, str(WORK / 'tools/measure.py'), '--case', '<case.path>', '--phase', '<slot.phase>', '--scenario', '<scenario>',
                                                               '--sample', '<slot.sample>', '--output', m_output(index['artifactRoot'], reader_m_case.TASK)],
                                              'outstanding': index['outstanding']})
        result.update(status='PASS', units=len(records), semanticDigests=semantic)
        if args.collect_m:
            result['measurement'] = collect_m(out, index, py)
    except (Rejected, OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired) as error:
        result['error'] = str(error)
    finally:
        td: dict = {}
        ps = subprocess.run([shutil.which('docker', path=CLEAN_PATH) or 'docker', 'ps', '-a', '--filter', 'label=portfolio.guard', '--format', '{{.Names}}'], capture_output=True, text=True, env={'PATH': CLEAN_PATH, 'HOME': os.environ['HOME']})
        td['guardContainersRemaining'] = ps.stdout.split() if ps.returncode == 0 else 'docker ps failed'
        if generated:
            for p in (SCOPE, OWNERSHIP):
                shutil.copy2(p, out / ('generated-' + p.name))
                p.unlink()
        for c in checkouts.values():
            subprocess.run(['git', 'worktree', 'remove', '--force', c['cwd']], cwd=ROOT, env=git_env, capture_output=True)
        td['checkoutsRemoved'] = [not Path(c['cwd']).exists() for c in checkouts.values()]
        td['runRootBytesBeforeRemoval'] = sum(f.stat().st_size for f in root.rglob('*') if f.is_file())
        result['teardown'] = td
        save(out / 'result.json', result)
        shutil.rmtree(root, ignore_errors=True)
    print(json.dumps({k: result.get(k) for k in ('status', 'error', 'units', 'protocolSha')}))
    measured = not args.collect_m or result.get('measurement', {}).get('status') == 'PASS'
    return 0 if result['status'] == 'PASS' and measured and result['teardown']['guardContainersRemaining'] == [] else 1


def clean_exec(argv: list[str]) -> None:
    """Re-run under the canonical sanitized parent environment: only the declared keys, every cache inside one owned counted root."""
    parent = RUN_TMP / M_PARENT if '--collect-m' in argv else RUN_TMP  # original M: one invocation root under the approved prefix
    parent.mkdir(parents=True, exist_ok=True)
    root = parent / ('admission-' + uuid.uuid4().hex[:8])
    paths = {k: root / v for k, v in (('HOME', 'home'), ('TMPDIR', 'tmp'), ('NODE_COMPILE_CACHE', 'node'), ('BUN_RUNTIME_TRANSPILER_CACHE_PATH', 'bun'))}
    for p in (*paths.values(), root / 'native'):
        p.mkdir(parents=True)
    env = {**{k: str(v) for k, v in paths.items()}, 'PATH': CLEAN_PATH, 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1'}
    os.execve(sys.executable, [sys.executable, str(Path(__file__).resolve()), '--clean', *argv], env)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--control', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--clean', action='store_true')
    parser.add_argument('--collect-m', action='store_true', help='explicit opt-in: execute the original M plan after qualification')
    args = parser.parse_args()
    if not args.clean:
        clean_exec(['--control', args.control, '--out', args.out, *(['--collect-m'] if args.collect_m else [])])
    return execute(args)


if __name__ == '__main__':
    sys.exit(main())
