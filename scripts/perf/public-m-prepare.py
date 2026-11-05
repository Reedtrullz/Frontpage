"""Hosted Frontpage public cohort: production builds, real guard admission, then original M only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'work/portfolio-performance/tools'
sys.path.insert(0, str(TOOLS))
from protocol import Case, EVIDENCE, RUN_TMP, digest, file_hash, runtime, save, slot
from resource_limits import capture_environment, FRONTPAGE_APPROVAL, FRONTPAGE_APPROVAL_SHA, ResourceBudget
from native_admission import make_checkouts, write_scope_and_ownership, run_process, m_plan, archive_input, verify_inputs

spec = importlib.util.spec_from_file_location('frontpage_public_linux', ROOT / 'scripts/perf/public-m-linux.py')
assert spec and spec.loader
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
PINS = {'before': {'commit': '683b0af0c5d5aa71933a731f108ff8cc5ba6e11e', 'blob': 'bf6bee6cc7eff7b363b4fbb5e3bafbc48719a6f8'},
        'candidate': {'commit': 'd4180dbc68810e8e5c33dfc285c6b6f080ce1c39', 'blob': 'b632bfc560defa03fdbf97a1566de22555728bae'}}
CAPABILITIES = ['public-production-browser-v1', 'signed-out-redaction', 'actual-encoded-http']
SOURCES = ['scripts/perf/public-m-browser.mjs', 'scripts/perf/public-m-linux.py', 'scripts/perf/public-linux-guard.json',
           'scripts/perf/public-m-prepare.py', 'work/portfolio-performance/tools/native.py',
           'work/portfolio-performance/tools/protocol.py', 'work/portfolio-performance/tools/resource_limits.py',
           'work/portfolio-performance/tools/native_admission.py', 'work/portfolio-performance/tools/measure.py',
           'work/portfolio-performance/tools/compare.py', 'work/portfolio-performance/tools/decisions.py']
CAPACITY_FLOOR_BYTES = 30 * 1024 ** 3


# Root runs this literal with python -I -B. It must not import the repository.
OBSERVER_LIB = r'''
import os
import stat
MEMBERSHIP = '/proc/self/cgroup'
MOUNTINFO = '/proc/self/mountinfo'
ROOT = '/sys/fs/cgroup'
ORDINARY = 8192
MOUNT_BYTES = 65536
CONTEXT_BYTES = 1048576
MAX_READS = 128
MAX_ANCESTORS = 8
DEADLINE = 5
KNOWN = {'memory', 'cpu', 'cpuset', 'pids', 'io'}
STRUCTURAL = {'cgroup.controllers', 'cgroup.subtree_control', 'cgroup.type'}
NAMES = (
    'cgroup.controllers', 'cgroup.subtree_control', 'cgroup.type', 'cgroup.freeze',
    'cgroup.max.depth', 'cgroup.max.descendants', 'memory.max', 'memory.high', 'memory.low',
    'memory.min', 'memory.swap.max', 'memory.swap.high', 'memory.oom.group', 'memory.zswap.max',
    'memory.zswap.writeback', 'pids.max', 'cpu.max', 'cpu.weight', 'cpu.weight.nice',
    'cpu.max.burst', 'cpu.idle', 'cpu.uclamp.min', 'cpu.uclamp.max', 'cpuset.cpus', 'cpuset.mems',
    'cpuset.cpus.exclusive', 'cpuset.cpus.partition', 'io.max', 'io.weight', 'io.latency', 'io.prio.class')


def _once(items, reason):
    if reason not in items:
        items.append(reason)


def _cgroup_path(path):
    if path == ROOT:
        return True
    prefix = ROOT + '/'
    if not path.startswith(prefix):
        return False
    return all(part not in ('', '.', '..') for part in path[len(prefix):].split('/'))


def _named_file(path):
    return _cgroup_path(path) and path.rsplit('/', 1)[-1] in NAMES


class Real:
    def uid(self):
        return os.getuid()

    def pid(self):
        return os.getpid()

    def lstat(self, path):
        if not _cgroup_path(path):
            raise PermissionError(path)
        return os.lstat(path)

    def read(self, path, limit):
        if path not in (MEMBERSHIP, MOUNTINFO) and not _named_file(path):
            raise PermissionError(path)
        flags = os.O_RDONLY | os.O_NONBLOCK
        if hasattr(os, 'O_NOFOLLOW'):
            flags |= os.O_NOFOLLOW
        handle = os.open(path, flags)
        try:
            info = os.fstat(handle)
            if not stat.S_ISREG(info.st_mode):
                return b'', info
            return os.read(handle, limit + 1), info
        finally:
            os.close(handle)


def _relative(membership):
    if chr(10) in membership or not membership.startswith('0::/'):
        return None
    relative = membership[3:]
    if relative == '/':
        return relative
    parts = relative.split('/')
    if parts[0] != '' or any(part in ('', '.', '..') for part in parts[1:]):
        return None
    return relative


def _mount(text):
    chosen = []
    nested = False
    for line in text.splitlines():
        row = line.split()
        if len(row) < 6:
            continue
        if row[4].startswith(ROOT + '/'):
            nested = True
        if row[4] == ROOT:
            chosen.append(row)
    if nested:
        return None, 'nested cgroup mount'
    if len(chosen) != 1 or '-' not in chosen[0]:
        return None, 'cgroup2 mount'
    row = chosen[0]
    marker = row.index('-')
    if row[3] != '/' or marker + 1 >= len(row) or row[marker + 1] != 'cgroup2':
        return None, 'cgroup2 mount'
    source = row[marker + 2] if marker + 2 < len(row) else ''
    return {'mountpoint': ROOT, 'root': row[3], 'fstype': row[marker + 1], 'source': source}, None


def inventory(io, clock):
    start = clock()
    unresolved = []
    reads = 0
    total = 0

    def room():
        nonlocal reads
        if clock() - start > DEADLINE:
            _once(unresolved, 'deadline')
            return False
        if reads >= MAX_READS:
            _once(unresolved, 'file bound')
            return False
        reads += 1
        return True

    def take(path, limit, expected=None):
        nonlocal total
        if not room():
            return 'stop', b'', None
        try:
            opened = io.read(path, limit)
        except FileNotFoundError:
            return 'missing', b'', None
        except PermissionError:
            return 'denied', b'', None
        if isinstance(opened, tuple):
            data, info = opened
        else:
            data, info = opened, None
        if info is None or not stat.S_ISREG(info.st_mode):
            return 'special', b'', info
        if expected is not None and (info.st_uid != expected.st_uid or (info.st_dev, info.st_ino) != (expected.st_dev, expected.st_ino) or info.st_mode & 0o022):
            return 'changed', b'', info
        if len(data) > limit:
            return 'oversized', b'', info
        total += len(data)
        if total > CONTEXT_BYTES:
            _once(unresolved, 'byte bound')
            return 'stop', b'', info
        return 'ok', data, info

    def look(path):
        if not room():
            return 'stop', None
        try:
            return 'ok', io.lstat(path)
        except FileNotFoundError:
            return 'missing', None
        except PermissionError:
            return 'denied', None

    membership = None
    relative = None
    state, data, fd = take(MEMBERSHIP, ORDINARY)
    if state == 'ok':
        membership = data.decode('utf-8', 'replace').strip()
        relative = _relative(membership)
        if relative is None:
            unresolved.append('malformed membership')
    elif state == 'missing':
        unresolved.append('missing:' + MEMBERSHIP)
    elif state == 'denied':
        unresolved.append('denied:' + MEMBERSHIP)
    elif state == 'oversized':
        unresolved.append('oversized:' + MEMBERSHIP)
    elif state == 'special':
        unresolved.append('special file')
    mount = None
    mount_ok = False
    state, data, fd = take(MOUNTINFO, MOUNT_BYTES)
    if state == 'ok':
        mount, problem = _mount(data.decode('utf-8', 'replace'))
        if problem:
            unresolved.append(problem)
        else:
            mount_ok = True
    elif state == 'missing':
        unresolved.append('missing:' + MOUNTINFO)
    elif state == 'denied':
        unresolved.append('denied:' + MOUNTINFO)
    elif state == 'oversized':
        unresolved.append('oversized:' + MOUNTINFO)
    elif state == 'special':
        unresolved.append('special file')
    ancestors = []
    identity = None
    leaf = None
    if relative is not None and mount_ok:
        path = ROOT if relative == '/' else ROOT + relative
        leaf = path
        while True:
            if len(ancestors) >= MAX_ANCESTORS:
                _once(unresolved, 'ancestor bound')
                break
            state, info = look(path)
            if state == 'stop':
                break
            if state == 'missing':
                unresolved.append('missing:' + path)
                break
            if state == 'denied':
                unresolved.append('denied:' + path)
                break
            if stat.S_ISLNK(info.st_mode):
                unresolved.append('symlink')
                ancestors.append({'path': path, 'state': 'symlink'})
                break
            if info.st_uid != 0:
                unresolved.append('nonroot')
                ancestors.append({'path': path, 'state': 'nonroot'})
                break
            if info.st_mode & 0o022:
                unresolved.append('delegated mode')
                ancestors.append({'path': path, 'state': 'delegated'})
                break
            if path == leaf:
                identity = (info.st_dev, info.st_ino)
            ancestors.append({'path': path, 'uid': info.st_uid, 'dev': info.st_dev, 'ino': info.st_ino, 'files': {}})
            if path == ROOT:
                break
            path = path.rsplit('/', 1)[0]
    def ident(info):
        if info is None:
            return None
        return {'uid': info.st_uid, 'mode': info.st_mode, 'dev': info.st_dev, 'ino': info.st_ino}

    def read_named(names):
        stopped = False
        for row in ancestors:
            if stopped or 'files' not in row:
                continue
            for name in names:
                target = row['path'] + '/' + name
                state, info = look(target)
                if state == 'stop':
                    stopped = True
                    break
                if state == 'missing':
                    row['files'][name] = {'state': 'missing'}
                    if name in STRUCTURAL:
                        unresolved.append('missing:' + target)
                    continue
                if state == 'denied':
                    row['files'][name] = {'state': 'denied'}
                    unresolved.append('denied:' + target)
                    continue
                if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
                    row['files'][name] = {'state': 'rejected', 'lstat': ident(info)}
                    unresolved.append('symlink' if stat.S_ISLNK(info.st_mode) else 'nonroot' if info.st_uid != 0 else 'delegated mode')
                    continue
                state, data, fd = take(target, ORDINARY, info)
                if state == 'stop':
                    stopped = True
                    break
                if state == 'special':
                    row['files'][name] = {'state': 'special', 'lstat': ident(info), 'fd': ident(fd)}
                    unresolved.append('special file')
                    continue
                if state == 'changed':
                    row['files'][name] = {'state': 'changed', 'lstat': ident(info), 'fd': ident(fd)}
                    unresolved.append('changed identity')
                    continue
                if state != 'ok':
                    row['files'][name] = {'state': state, 'lstat': ident(info), 'fd': ident(fd)}
                    unresolved.append(state + ':' + target)
                    continue
                value = data.decode('utf-8', 'replace').strip()
                row['files'][name] = {'state': 'read', 'value': value}
                if name == 'cgroup.controllers':
                    row['controllers'] = value.split()
                    for control in row['controllers']:
                        if control not in KNOWN:
                            unresolved.append('unknown ambient controller: ' + control)
                elif name == 'cgroup.subtree_control':
                    row['subtree'] = value.split()
                elif name == 'cgroup.type':
                    row['type'] = value
            if stopped:
                break
        return stopped

    if not read_named(('cgroup.controllers', 'cgroup.subtree_control', 'cgroup.type')):
        read_named(tuple(name for name in NAMES if name not in STRUCTURAL))
    if identity is not None and 'deadline' not in unresolved and 'file bound' not in unresolved:
        state, info = look(leaf)
        if state == 'ok' and (info.st_dev, info.st_ino) != identity:
            unresolved.append('stale identity')
    return {'uid': io.uid(), 'pid': io.pid(), 'membership': membership, 'mount': mount, 'ancestors': ancestors,
            'unresolved': unresolved, 'reads': reads, 'bytes': total, 'complete': not unresolved}
'''

OBSERVER_RUNNER = """
import json,sys,time
json.dump(inventory(Real(), time.monotonic), sys.stdout, sort_keys=True)
sys.stdout.write(chr(10))
"""


def host_cgroup_io():
    namespace = {}
    exec(OBSERVER_LIB, namespace)
    return namespace['Real']()


def host_cgroup_spawn(argv, timeout):
    return subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)


def _cgroup_supervisor_path(path: object) -> bool:
    root = '/sys/fs/cgroup'
    if not isinstance(path, str) or chr(10) in path:
        return False
    if path == root:
        return True
    prefix = root + '/'
    if not path.startswith(prefix):
        return False
    return all(part not in ('', '.', '..') for part in path[len(prefix):].split('/'))


def _supervisor_chain(membership: object, ancestors: object) -> bool:
    root = '/sys/fs/cgroup'
    if not isinstance(membership, str) or not membership.startswith('0::/') or chr(10) in membership:
        return False
    relative = membership[3:]
    if relative != '/' and any(part in ('', '.', '..') for part in relative.split('/')[1:]):
        return False
    leaf = root if relative == '/' else root + relative
    if not _cgroup_supervisor_path(leaf):
        return False
    expected: list[str] = []
    path = leaf
    while True:
        expected.append(path)
        if len(expected) > 8:
            return False
        if path == root:
            break
        path = path.rsplit('/', 1)[0]
    if not isinstance(ancestors, list) or [row.get('path') if isinstance(row, dict) else None for row in ancestors] != expected:
        return False
    return True


def _structural_readback(row: dict[str, Any]) -> bool:
    files = row.get('files')
    if not isinstance(files, dict):
        return False
    for name in ('cgroup.controllers', 'cgroup.subtree_control', 'cgroup.type'):
        item = files.get(name)
        if not isinstance(item, dict) or item.get('state') != 'read' or not isinstance(item.get('value'), str):
            return False
    for item in files.values():
        if not isinstance(item, dict):
            return False
        if item.get('state') == 'missing':
            continue
        if item.get('state') != 'read' or not isinstance(item.get('value'), str):
            return False
    return True


def _complete_supervisor_readback(parsed: dict[str, Any]) -> bool:
    mount = parsed.get('mount')
    ancestors = parsed.get('ancestors')
    if not isinstance(mount, dict) or not isinstance(ancestors, list) or not 1 <= len(ancestors) <= 8:
        return False
    source = mount.get('source')
    if mount.get('mountpoint') != '/sys/fs/cgroup' or mount.get('root') != '/' or mount.get('fstype') != 'cgroup2':
        return False
    if not isinstance(source, str) or chr(10) in source:
        return False
    if not _supervisor_chain(parsed.get('membership'), ancestors):
        return False
    for row in ancestors:
        if not isinstance(row, dict) or row.get('state') in ('symlink', 'nonroot', 'delegated'):
            return False
        if type(row.get('uid')) is not int or row.get('uid') != 0:
            return False
        if type(row.get('dev')) is not int or type(row.get('ino')) is not int or row['ino'] <= 0:
            return False
        if not _structural_readback(row):
            return False
    return True


def _supervisor_schema(parsed: dict[str, Any]) -> list[str]:
    required = ('uid', 'pid', 'membership', 'reads', 'bytes', 'complete', 'unresolved', 'ancestors', 'mount')
    if any(key not in parsed for key in required):
        return ['supervisor schema']
    reasons: list[str] = []
    uid, pid, reads, nbytes = parsed['uid'], parsed['pid'], parsed['reads'], parsed['bytes']
    membership = parsed['membership']
    if type(uid) is not int or uid < 0 or type(pid) is not int or pid <= 0:
        reasons.append('supervisor schema')
    elif uid != 0:
        reasons.append('ordinary uid is not the supervisor context')
    if not isinstance(membership, str) or chr(10) in membership or not membership.startswith('0::/'):
        reasons.append('supervisor schema')
    if type(reads) is not int or reads < 0 or reads > 128 or type(nbytes) is not int or nbytes < 0 or nbytes > 1048576:
        reasons.append('supervisor schema')
    reported = parsed['unresolved']
    if type(parsed['complete']) is not bool or not isinstance(reported, list) or not isinstance(parsed['ancestors'], list):
        reasons.append('supervisor schema')
    elif any(not isinstance(item, str) for item in reported):
        reasons.append('supervisor schema')
    if parsed['mount'] is not None and not isinstance(parsed['mount'], dict):
        reasons.append('supervisor schema')
    if parsed['complete'] is True and (not isinstance(membership, str) or not membership.strip() or not _complete_supervisor_readback(parsed)):
        reasons.append('supervisor schema')
    return list(dict.fromkeys(reasons))


def checkout_cgroup_inventory(stage, io, spawn, clock, python):
    if stage != 'checkout':
        return {'stage': stage, 'disposition': 'not_applicable', 'allowed': False, 'contexts': [], 'reads': 0}
    namespace = {}
    exec(OBSERVER_LIB, namespace)
    invoking = namespace['inventory'](io, clock)
    invoking['context'] = 'invoking'
    argv = ['sudo', '-n', 'timeout', '--signal=TERM', '--kill-after=1', '10', python, '-I', '-B', '-c', OBSERVER_LIB + OBSERVER_RUNNER]
    reasons: list[str] = []
    supervisor: dict[str, Any] = {'context': 'supervisor', 'complete': False}
    try:
        done = spawn(argv, 10)
    except subprocess.TimeoutExpired:
        reasons.append('deadline')
        done = None
    if done is not None and done.returncode != 0:
        reasons.append('supervisor exit %s' % done.returncode)
    elif done is not None:
        raw = done.stdout if isinstance(done.stdout, bytes) else str(done.stdout).encode()
        if len(raw) > 1048576:
            reasons.append('oversized supervisor output')
            parsed = None
        else:
            try:
                parsed = json.loads(raw)
            except (json.JSONDecodeError, TypeError, UnicodeError):
                parsed = None
        if parsed is None:
            if 'oversized supervisor output' not in reasons:
                reasons.append('malformed supervisor output')
        elif not isinstance(parsed, dict):
            reasons.append('malformed supervisor output')
        else:
            supervisor.update(parsed)
            supervisor['context'] = 'supervisor'
            reasons.extend(_supervisor_schema(parsed))
            reported = parsed.get('unresolved')
            if isinstance(reported, list):
                for item in reported:
                    if isinstance(item, str) and item not in reasons:
                        reasons.append(item)
    supervisor['unresolved'] = reasons
    if reasons:
        supervisor['complete'] = False
    ready = invoking.get('complete') is True and not invoking.get('unresolved') and supervisor.get('complete') is True and supervisor.get('uid') == 0 and not supervisor.get('unresolved')
    return {'stage': 'checkout', 'disposition': 'read' if ready else 'unresolved', 'allowed': False,
            'sameMembership': invoking.get('membership') == supervisor.get('membership'), 'reads': invoking.get('reads', 0),
            'contexts': [invoking, supervisor]}


def clock_source() -> str:
    return """const D=Date;function C(...a){return new.target?Reflect.construct(D,a.length?a:[1793203200000],new.target):new D(1793203200000).toString()}
for(const k of['parse','UTC'])Object.defineProperty(C,k,Object.getOwnPropertyDescriptor(D,k));
Object.defineProperty(C,'now',{...Object.getOwnPropertyDescriptor(D,'now'),value:()=>1793203200000});
Object.setPrototypeOf(C.prototype,D.prototype);global.Date=C;
"""


def owned_graph(source: Path, target: Path) -> dict[str, str]:
    shutil.copytree(source, target, symlinks=True, copy_function=os.link)
    links = {}
    for path in target.rglob('*'):
        if path.is_symlink():
            assert path.exists() and path.resolve().is_relative_to(target.resolve()), 'dependency link escapes owned graph'
            links[str(path)] = os.readlink(path)
        elif path.is_file():
            original = source / path.relative_to(target)
            assert os.stat(original).st_ino == path.stat().st_ino and os.stat(original).st_dev == path.stat().st_dev
    return links


def request(case, phase, scenario, index=0):
    return {**slot(case, index), 'caseHash': digest(case), 'phase': phase, 'scenario': scenario,
            'revision': case[phase]['revision'], 'fixtureDigest': digest(case['fixtures']),
            'harnessDigest': digest(case['harness']), 'shape': case['shape'], 'economicsDigest': case['economicsDigest']}


def case_for(config, viewport, temperature, semantic) -> dict[str, Any]:
    identity = f'T15-public-{viewport["width"]}-{temperature}'
    argv = [str(Path(sys.executable).resolve()), str(ROOT / 'scripts/perf/public-m-linux.py'), config['manifest']]
    harness = {str(ROOT / p): file_hash(ROOT / p) for p in SOURCES}
    fixtures = {config['manifest']: file_hash(Path(config['manifest'])), config['clock']: file_hash(Path(config['clock'])),
                config['immutableInputs']: file_hash(Path(config['immutableInputs'])),
                str(FRONTPAGE_APPROVAL): FRONTPAGE_APPROVAL_SHA}
    parent = capture_environment()
    return {'schema': 'measurement-case/v1', 'id': identity, 'task': 15, 'identities': ['Reedtrullz/Frontpage'],
            'mode': 'native', 'offline': True, 'pairs': 10, 'temperature': temperature, 'samplingUnit': 'invocation',
            'shape': {'viewport': viewport, 'temperature': temperature, 'routes': ['/', '/status']},
            'economicsDigest': digest({'offline': True, 'providers': False, 'fixtureClock': 1793203200000}),
            'timeout': 120, 'outputBytes': 1048576, 'scratchBytes': 64 * 1024 ** 2,
            'resourceProfile': 'browser-64m-20261028', 'modality': 'browser', 'namespaceReservationBytes': 48 * 1024 ** 2,
            'browserProfileApproval': {'path': str(FRONTPAGE_APPROVAL), 'sha256': FRONTPAGE_APPROVAL_SHA},
            'parentEnvironment': parent, 'artifactRoot': str(EVIDENCE / 'unblocking-20261028/u04-public'),
            'scratchRoot': str(Path(parent['root']) / 'native'), 'runtime': runtime(), 'harness': harness, 'fixtures': fixtures,
            **{p: {**config['sources'][p], 'sources': harness} for p in ('baseline', 'candidate')},
            'semanticDigest': semantic, 'capabilities': CAPABILITIES, 'primary': 'navigationMs',
            'metrics': {name: {'unit': unit, 'kind': kind, 'direction': 'lower', 'scope': 'nested', 'aggregate': aggregate, 'repetitions': 2}
                        for name, unit, kind, aggregate in [('navigationMs', 'ms', 'timing', 'median'), ('encodedBytes', 'bytes', 'counter', 'sum')]},
            'commands': {s: {p: argv for p in ('baseline', 'candidate')} for s in ('happy', 'failure')},
            'allowlist': [argv], 'executables': {p: file_hash(Path(p)) for p in (argv[0], config['node'])}, 'receiptEncoding': 'gzip-v1'}


def main(collect=False, capacity_only=None):
    assert sys.platform == 'linux' and os.getuid() != 0, 'hosted unprivileged Linux only'
    disk = shutil.disk_usage(ROOT)
    print(json.dumps({'stage': capacity_only or 'pre-public', 'root': str(ROOT), 'device': ROOT.stat().st_dev,
                      'freeBytes': disk.free, 'floorBytes': CAPACITY_FLOOR_BYTES}, sort_keys=True), flush=True)
    assert disk.free >= CAPACITY_FLOOR_BYTES, '30GiB build admission floor'
    if capacity_only == 'checkout':
        print(json.dumps(checkout_cgroup_inventory('checkout', host_cgroup_io(), host_cgroup_spawn, time.monotonic, sys.executable), sort_keys=True), flush=True)
    if capacity_only is not None:
        return
    setup = ROOT / '.public-m-setup'
    setup.mkdir()
    node_path = shutil.which('node')
    assert node_path, 'preinstalled Node required'
    node = str(Path(node_path).resolve())
    host_home = str(Path.home())
    clean = {'PATH': os.environ['PATH'], 'HOME': str(setup / 'build-home'), 'TMPDIR': str(setup / 'build-tmp'),
             'NEXT_TELEMETRY_DISABLED': '1', 'AUTH_SECRET': 'frontpage-public-m-fixture-only', 'LANG': 'C'}
    for key in ('HOME', 'TMPDIR'):
        Path(clean[key]).mkdir()
    save(setup / 'build-toolchain.json', {'compiler': 'default-turbopack', 'dependencyStaging': 'owned graph of existing installed bytes, hardlinked files and contained relative links',
                                        'next': json.loads((ROOT / 'node_modules/next/package.json').read_bytes())['version'], 'packageManagerInvocations': 0})
    checkouts = make_checkouts(setup, PINS, clean)
    write_scope_and_ownership(checkouts)
    clock = setup / 'clock.cjs'
    clock.write_text(clock_source())
    fixtures, links = {}, {}
    installed = {str(p.relative_to(ROOT / 'node_modules')): file_hash(p) for p in (ROOT / 'node_modules').rglob('*') if p.is_file() and not p.is_symlink()}
    save(setup / 'installed-graph.json', installed)
    for phase, source in checkouts.items():
        cwd = Path(source['cwd'])
        assert (cwd / 'pnpm-lock.yaml').read_bytes() == (ROOT / 'pnpm-lock.yaml').read_bytes(), 'dependency graph changed'
        links.update(owned_graph(ROOT / 'node_modules', cwd / 'node_modules'))
        subprocess.run([node, str(cwd / 'node_modules/next/dist/bin/next'), 'build'], cwd=cwd, env=clean, check=True, timeout=600)
        assert all(file_hash(ROOT / 'node_modules' / p) == sha for p, sha in installed.items()), 'build changed installed dependency bytes'
        subprocess.run([node, '--require', str(clock), str(cwd / 'tests/e2e/prepare-runtime.mjs')], cwd=cwd, env=clean, check=True, timeout=60)
        (cwd / '.next/standalone/.next/cache').mkdir(parents=True, exist_ok=True)
        fixtures[phase] = {k: str(cwd / 'tests/e2e' / v) for k, v in [('legacy', '.metrics'), ('public', '.metrics-v2-public'), ('owner', '.metrics-v2-owner')]}
    manifest = setup / 'manifest.json'
    save(setup / 'dependency-links.json', links)
    artifacts = EVIDENCE / 'unblocking-20261028/u04-public'
    artifacts.mkdir(parents=True)
    config = {'root': str(ROOT), 'hostHome': host_home, 'browsers': os.environ.get('PLAYWRIGHT_BROWSERS_PATH', host_home + '/.cache/ms-playwright'),
              'node': node, 'clock': str(clock), 'sources': checkouts, 'fixtures': fixtures, 'manifest': str(manifest),
              'immutableInputs': str(setup / 'immutable-inputs.json'), 'controlReceipt': str(artifacts / 'controls.json'),
              'dependencyLinks': str(setup / 'dependency-links.json')}
    save(manifest, config)
    # Freeze every setup file's identity separately from counted writable runtime data.
    immutable = {str(p): file_hash(p) for p in sorted(setup.rglob('*')) if p.is_file() and not p.is_symlink()}
    immutable.update({p: file_hash(Path(p)) for p in (node, str(Path(sys.executable).resolve()))})
    save(setup / 'immutable-inputs.json', immutable)
    viewports = [{'width': 1440, 'height': 1000}, {'width': 390, 'height': 844}]
    temperatures = ['cold', 'warm']
    protocol = {'pairs': 10, 'scenarios': ['happy', 'failure'], 'viewports': viewports,
                'temperatures': ['cold', 'warm'], 'units': 256, 'unitSeconds': 120, 'caseSeconds': 1800, 'wholeSeconds': 3300,
                'compareSeconds': 600, 'qualificationSeconds': 1200, 'namespaceBytes': 48 * 1024 ** 2, 'parentHeadroomBytes': 16 * 1024 ** 2,
                'pins': PINS, 'harness': {str(ROOT / p): file_hash(ROOT / p) for p in SOURCES}}
    save(setup / 'protocol.json', protocol)
    RUN_TMP.mkdir(parents=True, exist_ok=True)
    parent = RUN_TMP / 'public-parent'
    parent.mkdir()
    env = {'PATH': ':'.join(p for p in os.environ['PATH'].split(':') if Path(p).is_absolute()), 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1'}
    for key in ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH'):
        directory = parent / key.lower()
        directory.mkdir()
        env[key] = str(directory)
    old = dict(os.environ)
    os.environ.clear()
    os.environ.update(env)
    started = time.monotonic()
    try:
        budget_case = case_for(config, viewports[0], 'cold', '0' * 64)
        budget = ResourceBudget.read(budget_case)
        budget.enforce(48 * 1024 ** 2)
        save(artifacts / 'controls.json', guard.controls(config))
        budget.enforce(48 * 1024 ** 2)
        cases = []
        for viewport in viewports:
            for temperature in temperatures:
                case = case_for(config, viewport, temperature, '0' * 64)
                results = [guard.invoke(config, request(case, p, s)) for p in ('baseline', 'candidate') for s in ('happy', 'failure')]
                budget.enforce(48 * 1024 ** 2)
                assert len({r['semanticDigest'] for r in results}) == 1, 'full functional public content parity'
                assert results[0]['outputHash'] == results[2]['outputHash'] and results[1]['outputHash'] == results[3]['outputHash'], 'happy/adverse parity'
                case['semanticDigest'] = results[0]['semanticDigest']
                casepath = setup / (case['id'] + '.json')
                save(casepath, case)
                Case.read(casepath)
                save(artifacts / (case['id'] + '-qualification.json'), results)
                cases.append((str(casepath), case))
                assert time.monotonic() - started < 1200, 'qualification deadline'
        plan = m_plan(str(Path(sys.executable).resolve()), cases)
        assert len(plan) == 256
        inputs = {}
        for _, case in cases:
            for role in ('harness', 'fixtures', 'executables'):
                for source in case[role]:
                    archive_input(setup, source, role, inputs)
        save(artifacts / 'input-snapshot-verification.json', verify_inputs(setup, [case for _, case in cases]))
        save(artifacts / 'm-plan.json', plan)
        if collect:
            case_starts = {}
            for unit in plan:
                case_starts.setdefault(unit['case'], time.monotonic())
                assert time.monotonic() - case_starts[unit['case']] < 1800, 'per-case deadline'
                remaining = 3300 - (time.monotonic() - started)
                assert remaining > 0, 'whole cohort deadline'
                code, stdout, stderr = run_process(unit['argv'], env, min(150, remaining))
                assert code == 0, (unit, stdout[-1000:], stderr[-1000:])
            compare = [sys.executable, str(TOOLS / 'compare.py'), '--task', '15', '--evidence', cases[0][1]['artifactRoot']]
            for casepath, _ in cases:
                compare.extend(['--case', casepath])
            code, stdout, stderr = run_process(compare, env, min(600, 3300 - (time.monotonic() - started)))
            assert code == 0, (stdout[-1000:], stderr[-1000:])
        save(artifacts / 'completion.json', {'status': 'M_COMPLETE' if collect else 'QUALIFIED_ONLY', 'units': len(plan) if collect else 0, 'elapsed': time.monotonic() - started})
        budget.enforce(48 * 1024 ** 2)
    finally:
        os.environ.clear()
        os.environ.update(old)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--collect-m', action='store_true')
    mode.add_argument('--capacity-only', nargs='?', const='pre-public', metavar='STAGE',
                      help='record capacity at STAGE and exit before preparation')
    args = parser.parse_args()
    main(args.collect_m, args.capacity_only)
