"""Frontpage-only Linux adapter. Frozen util-linux controls precede real browser admission."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time
import uuid
from typing import TypedDict

HERE = Path(__file__).resolve().parent
GUARD = HERE / 'public-linux-guard.json'
GUARD_SHA = '6428ed96d1a44b42ba85002cec711ae8377ddc88fbdf53db98b8a46e85591801'
assert hashlib.sha256(GUARD.read_bytes()).hexdigest() == GUARD_SHA, 'guard source drift'
FROZEN = json.loads(GUARD.read_bytes())
MIB = 1024 ** 2
CGROUP_ROOT = Path('/sys/fs/cgroup')
MEMORY_MAX = 512 * MIB


class MemoryReport(TypedDict):
    max: int
    swapMax: int
    oomGroup: int
    peak: int
    events: dict[str, int]
    populated: int
    procs: list[str]
    leaf: str


def cgroup_read(path: Path) -> str:
    bound = 131072 if str(path) == '/proc/self/mountinfo' else 8192
    with path.open() as handle:
        value = handle.read(bound + 1)
    assert len(value) <= bound, 'oversized cgroup readback'
    return value.strip()


class MemoryCgroup:
    """Own exactly one exclusive leaf; never enable or delegate a controller."""
    def __init__(self, nonce: str):
        assert re.fullmatch('[0-9a-f]{32}', nonce), 'invalid cgroup nonce'
        membership = cgroup_read(Path('/proc/self/cgroup'))
        assert membership.startswith('0::/') and '\n' not in membership, 'unified cgroup required'
        relative = membership[3:]
        assert relative == '/' or (relative.startswith('/') and all(p not in ('', '.', '..') for p in relative[1:].split('/'))), 'invalid cgroup parent path'
        self.parent = CGROUP_ROOT / relative.lstrip('/')
        assert self.parent.resolve() == self.parent, 'symlink cgroup parent'
        mounts = [line.split() for line in cgroup_read(Path('/proc/self/mountinfo')).splitlines()]
        mounted = [row for row in mounts if row[4] == str(CGROUP_ROOT)]
        assert len(mounted) == 1 and mounted[0][3] == '/' and mounted[0][mounted[0].index('-') + 1] == 'cgroup2', 'exact cgroup2 mount required'
        assert not any(row[4].startswith(str(CGROUP_ROOT) + '/') for row in mounts), 'nested cgroup mounts rejected'
        current = self.parent
        while True:
            self.root_owned(current)
            assert current.stat().st_mode & 0o005 == 0o005, 'cgroup ancestors must permit readonly workload traversal'
            if current == CGROUP_ROOT:
                break
            current = current.parent
        while 'memory' not in cgroup_read(self.parent / 'cgroup.subtree_control').split():
            assert self.parent != CGROUP_ROOT, 'no usable already-active memory parent'
            self.neutral_ambient(self.parent)
            self.parent = self.parent.parent
        assert cgroup_read(self.parent / 'cgroup.type') == 'domain', 'domain cgroup required'
        parent_relative = '/' + '/'.join(self.parent.relative_to(CGROUP_ROOT).parts)
        self.relative = parent_relative.rstrip('/') + '/fpm-' + nonce
        self.parent_membership = membership
        self.leaf = self.parent / ('fpm-' + nonce)
        self.identity = None
        self.prepared = False

    @staticmethod
    def neutral_ambient(path: Path) -> None:
        """An ancestor is safe only when moving skips no ambient controller guard."""
        controllers = cgroup_read(path / 'cgroup.controllers').split()
        assert set(controllers) <= {'memory', 'cpu', 'cpuset', 'pids', 'io'}, 'unknown ambient controller'
        neutral = {'cgroup.type': 'domain', 'cgroup.freeze': '0', 'cgroup.max.depth': 'max', 'cgroup.max.descendants': 'max',
                   'memory.max': 'max', 'memory.high': 'max', 'memory.low': '0', 'memory.min': '0',
                   'memory.swap.max': 'max', 'memory.swap.high': 'max', 'memory.oom.group': '0',
                   'memory.zswap.max': 'max', 'memory.zswap.writeback': '1', 'pids.max': 'max',
                   'cpu.weight': '100', 'cpu.weight.nice': '0', 'cpu.max.burst': '0', 'cpu.idle': '0',
                   'cpu.uclamp.min': '0.00', 'cpu.uclamp.max': 'max', 'cpuset.cpus': '', 'cpuset.mems': '',
                   'cpuset.cpus.exclusive': '', 'cpuset.cpus.partition': 'member',
                   'io.max': '', 'io.weight': 'default 100', 'io.latency': '', 'io.prio.class': 'no-change'}
        for name, expected in neutral.items():
            target = path / name
            if target.exists():
                MemoryCgroup.root_owned(target)
                assert cgroup_read(target) == expected, 'ancestor would bypass ambient guard: ' + name
        if 'cpu' in controllers:
            assert cgroup_read(path / 'cpu.max').split()[0] == 'max', 'ancestor would bypass cpu cap'
        for controller, required in (('memory', 'memory.max'), ('pids', 'pids.max'), ('io', 'io.max'), ('cpuset', 'cpuset.cpus')):
            if controller in controllers:
                assert (path / required).exists(), 'missing ambient control readback'

    @staticmethod
    def root_owned(path: Path) -> None:
        status = path.lstat()
        assert status.st_uid == 0 and status.st_mode & 0o022 == 0 and not path.is_symlink(), 'root-owned nondelegated cgroup required'

    def owned(self) -> None:
        self.root_owned(self.leaf)
        status = self.leaf.stat()
        assert self.identity == (status.st_dev, status.st_ino), 'owned cgroup identity changed'

    def prepare(self) -> None:
        self.leaf.mkdir(mode=0o755)
        status = self.leaf.stat()
        self.identity = (status.st_dev, status.st_ino)
        self.leaf.chmod(0o755)
        self.owned()
        for name in ('memory.max', 'memory.swap.max', 'memory.oom.group', 'memory.events', 'memory.peak',
                     'cgroup.kill', 'cgroup.events', 'cgroup.procs'):
            self.root_owned(self.leaf / name)
            if name in ('memory.max', 'memory.swap.max', 'memory.oom.group', 'memory.events', 'memory.peak'):
                assert (self.leaf / name).stat().st_mode & 0o004, 'workload memory readback inaccessible'
        assert not cgroup_read(self.leaf / 'cgroup.procs'), 'new cgroup is populated'
        (self.leaf / 'cgroup.kill').write_text('1')
        for name, value in (('memory.max', '536870912'), ('memory.swap.max', '0'), ('memory.oom.group', '1')):
            (self.leaf / name).write_text(value)
        self.read_limits()
        self.snapshot()
        self.prepared = True

    def read_limits(self) -> None:
        self.owned()
        assert [cgroup_read(self.leaf / name) for name in ('memory.max', 'memory.swap.max', 'memory.oom.group')] == ['536870912', '0', '1'], 'memory control readback mismatch'

    def join(self) -> None:
        self.read_limits()
        assert cgroup_read(Path('/proc/self/cgroup')) == self.parent_membership, 'parent membership changed before launch'
        (self.leaf / 'cgroup.procs').write_text('0')
        assert cgroup_read(Path('/proc/self/cgroup')) == '0::' + self.relative, 'launcher memory membership mismatch'

    def snapshot(self) -> MemoryReport:
        events = dict(line.split() for line in cgroup_read(self.leaf / 'memory.events').splitlines())
        populated = dict(line.split() for line in cgroup_read(self.leaf / 'cgroup.events').splitlines())
        assert {'max', 'oom', 'oom_kill'} <= events.keys() and all(int(value) >= 0 for value in events.values()), 'invalid memory events'
        assert int(cgroup_read(self.leaf / 'memory.peak')) >= 0, 'invalid memory peak'
        return {'max': int(cgroup_read(self.leaf / 'memory.max')), 'swapMax': int(cgroup_read(self.leaf / 'memory.swap.max')),
                'oomGroup': int(cgroup_read(self.leaf / 'memory.oom.group')), 'peak': int(cgroup_read(self.leaf / 'memory.peak')),
                'events': {key: int(value) for key, value in events.items()}, 'populated': int(populated['populated']),
                'procs': cgroup_read(self.leaf / 'cgroup.procs').split(), 'leaf': str(self.leaf)}

    def finish(self, process: subprocess.Popen[bytes] | None) -> MemoryReport | None:
        if self.identity is None:
            return None
        self.owned()
        if (self.leaf / 'cgroup.kill').exists():
            (self.leaf / 'cgroup.kill').write_text('1')
        else:
            assert process is None, 'missing cgroup.kill after launch'
        if process is not None:
            process.wait(timeout=2)
        deadline = time.monotonic() + 2
        while True:
            events = dict(line.split() for line in cgroup_read(self.leaf / 'cgroup.events').splitlines())
            procs = cgroup_read(self.leaf / 'cgroup.procs')
            if events.get('populated') == '0' and not procs:
                break
            assert time.monotonic() < deadline, 'owned memory cgroup did not empty'
            time.sleep(.02)
        try:
            if self.prepared:
                report = self.snapshot()
            else:
                readbacks = {name: cgroup_read(self.leaf / name) if (self.leaf / name).exists() else None
                             for name in ('memory.max', 'memory.swap.max', 'memory.oom.group', 'memory.events', 'memory.peak', 'cgroup.events', 'cgroup.procs')}
                print(json.dumps({'partialMemory': readbacks})[:8192], file=sys.stderr)
                report = None
        finally:
            self.owned()
            self.leaf.rmdir()
        return report


class RunResult(TypedDict):
    returncode: int
    overflow: bool
    late: bool
    elapsed: float
    survivors: list[int]
    scratchRemoved: bool
    scratch: str
    memory: MemoryReport


def namespace_script():
    script = FROZEN['SCRIPT'].replace('shift 8', 'app_cache=$9; base_git=${10}; candidate_git=${11}; shift 11', 1)
    mount = 'install -d -o "$uid" -g "$gid" -m 0700 "$scratch/app-cache"\nmount --bind "$scratch/app-cache" "$app_cache"\n'
    mount += 'for dotgit in "$base_git" "$candidate_git"; do\nif [ -d "$dotgit" ]; then mount -t tmpfs -o size=4k,mode=0555,ro tmpfs "$dotgit"; elif [ -e "$dotgit" ]; then mount --bind /dev/null "$dotgit"; fi\ndone\n'
    script = script.replace('while read -r mp; do', mount + 'while read -r mp; do', 1)
    script = script.replace('"$scratch"|"$scratch"/*|/proc', '"$app_cache"|"$scratch"|"$scratch"/*|/proc', 1)
    script = script.replace('mount --make-rprivate /', 'mount --make-rprivate /\nmount --bind /sys/fs/cgroup /sys/fs/cgroup\nmount -o remount,bind,ro /sys/fs/cgroup', 1)
    return script


def supervisor_output(process: subprocess.Popen[bytes], limit: float) -> tuple[bytes, bytes]:
    """Bound both pipes while the root supervisor owns exact-leaf teardown."""
    assert process.stdout is not None and process.stderr is not None
    stdout_fd, stderr_fd = process.stdout.fileno(), process.stderr.fileno()
    streams = {stdout_fd: bytearray(), stderr_fd: bytearray()}
    started = time.monotonic()
    finished = False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            selector.register(process.stderr, selectors.EVENT_READ)
            remaining = 2
            while remaining:
                assert time.monotonic() - started < limit + 7, 'privileged supervisor deadline'
                for key, _ in selector.select(.1):
                    chunk = os.read(key.fd, 4096)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        remaining -= 1
                        continue
                    available = MIB - sum(len(value) for value in streams.values())
                    assert len(chunk) <= available, 'privileged supervisor stream overflow'
                    streams[key.fd].extend(chunk)
            finished = True
    finally:
        if not finished and process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=min(5, max(.1, limit + 9 - (time.monotonic() - started))))
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=1)
            raise AssertionError('supervisor forced terminal; kernel cleanup unverified')
        finally:
            process.stdout.close()
            process.stderr.close()
    return bytes(streams[stdout_fd]), bytes(streams[stderr_fd])


def execute(config, inner, request, *, limit=110, nonce=None):
    nonce = nonce or uuid.uuid4().hex
    assert re.fullmatch('[0-9a-f]{32}', nonce), 'invalid invocation nonce'
    assert 0 < limit <= 110, 'invocation limit exceeds frozen bound'
    if os.geteuid() != 0:
        payload = {'config': {**config, '_fixtureUid': os.getuid(), '_fixtureGid': os.getgid()},
                   'inner': inner, 'request': request, 'limit': limit, 'nonce': nonce}
        process = subprocess.Popen(['sudo', '-n', 'timeout', '--signal=TERM', '--kill-after=5', str(limit + 1),
                                    sys.executable, '-I', '-B', str(Path(__file__).resolve()),
                                    '--memory-supervisor', json.dumps(payload)], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        output, errors = supervisor_output(process, limit)
        assert process.returncode == 0, diagnostic(errors)
        assert len(output) <= MIB, 'supervisor stream overflow'
        header, body = output.split(b'\n', 1)
        assert len(header) <= 8192, 'supervisor metadata overflow'
        return json.loads(header), body
    scratch = '/run/fpm-' + nonce
    assert not Path(scratch).exists(), 'scratch nonce already exists'
    phase = request.get('phase', 'baseline')
    cache = str(Path(config['sources'][phase]['cwd']) / '.next/standalone/.next/cache')
    env = [f'PATH={Path(config["node"]).parent}:/usr/sbin:/usr/bin:/sbin:/bin',
           f'HOME={scratch}/home', f'TMPDIR={scratch}/work', f'XDG_CACHE_HOME={scratch}/cache',
           f'XDG_CONFIG_HOME={scratch}/config', f'XDG_RUNTIME_DIR={scratch}/run',
           f'PLAYWRIGHT_BROWSERS_PATH={config["browsers"]}', 'LANG=C', 'PYTHONDONTWRITEBYTECODE=1',
           'MEASURE_REQUEST=' + json.dumps(request), 'NEXT_TELEMETRY_DISABLED=1']
    uid, gid = config['_fixtureUid'], config['_fixtureGid']
    assert type(uid) is int and uid > 0 and type(gid) is int and gid > 0, 'unprivileged workload identity required'
    argv = ['unshare', '--net', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc',
            'sh', '-c', namespace_script(), 'frontpage-public', scratch, str(uid), str(gid),
            config['root'], config['hostHome'], config['browsers'], str(limit), str(48 * MIB), cache,
            str(Path(config['sources']['baseline']['cwd']) / '.git'), str(Path(config['sources']['candidate']['cwd']) / '.git'), 'env', '-i', *env, *inner]
    started = time.monotonic()
    memory = MemoryCgroup(nonce)
    process = None
    output, overflow, late = bytearray(), False, False
    try:
        memory.prepare()
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   preexec_fn=memory.join)
        assert process.stdout is not None
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                if time.monotonic() - started > (limit - 5 if limit > 10 else limit + 5):
                    late = True
                    break
                if not selector.select(.1):
                    continue
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    break
                available = MIB - 8192 - len(output)
                output.extend(chunk[:available])
                if len(chunk) > available:
                    overflow = True
                    break
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        signal.signal(signal.SIGINT, signal.SIG_IGN)
        try:
            report = memory.finish(process)
        finally:
            if process is not None and process.stdout is not None:
                process.stdout.close()
            subprocess.run(['rmdir', scratch], capture_output=True, check=False, timeout=1)
    assert process is not None and report is not None, 'memory setup did not complete'
    result: RunResult = {'returncode': process.returncode, 'overflow': overflow, 'late': late,
              'elapsed': time.monotonic() - started, 'survivors': [], 'scratchRemoved': not Path(scratch).exists(), 'scratch': scratch,
              'memory': report}
    return result, bytes(output)


def clean(result, *, allow_oom=False):
    memory = result.get('memory')
    return (not result['survivors'] and result['scratchRemoved'] and not result['late']
            and memory is not None and memory['max'] == MEMORY_MAX and memory['swapMax'] == 0
            and memory['oomGroup'] == 1 and memory['populated'] == 0 and not memory['procs']
            and (allow_oom or (memory['peak'] <= MEMORY_MAX and memory['events'].get('oom_kill', 0) == 0)))


def controls(config):
    reports = []
    home = Path(config['hostHome'])
    canary = home / ('fpm-canary-' + uuid.uuid4().hex)
    canary.write_bytes(b'authored-public-fixture-canary')
    try:
        def probe(name, code, args=(), *, limit=110, allow_oom=False):
            result, output = execute(config, [sys.executable, '-I', '-B', '-c', code, *args], {}, limit=limit)
            try:
                seen = json.loads(output)
            except ValueError:
                seen = {}
            reports.append({'control': name, 'cleanup': result, 'observed': seen})
            assert clean(result, allow_oom=allow_oom), name + ': cleanup'
            return result, seen
        cache = Path(config['sources']['baseline']['cwd']) / '.next/standalone/.next/cache'
        code = ('import json,os,pathlib,sys; p=pathlib.Path(sys.argv[1]); '
                'same=os.stat(p).st_dev==os.stat(os.environ["TMPDIR"]).st_dev; '
                '(p/"counted-cache-canary").write_bytes(b"x"); '
                'print(json.dumps({"sameFilesystem":same,"writable":True}))')
        code = ('import errno,json,os,pathlib,sys\n'
                'base=pathlib.Path("/sys/fs/cgroup"); membership=pathlib.Path("/proc/self/cgroup").read_text().strip(); '
                'assert membership.startswith("0::/"); leaf=base/membership[4:]; '
                'assert leaf.name.startswith("fpm-")\n'
                'assert [(leaf/n).read_text().strip() for n in ("memory.max","memory.swap.max","memory.oom.group")]==["536870912","0","1"]\n'
                'for target,value in ((leaf/"memory.max","max"),(leaf/"memory.swap.max","max"),(leaf/"memory.oom.group","0"),(leaf/"cgroup.procs","0"),(leaf.parent/"cgroup.procs","0"),(leaf/"cgroup.subtree_control","+memory")):\n'
                ' try: target.write_text(value)\n'
                ' except OSError as error: assert error.errno==errno.EROFS\n'
                ' else: raise AssertionError("cgroup guard write allowed")\n'
                'try: (leaf/"escape").mkdir()\n'
                'except OSError as error: assert error.errno==errno.EROFS\n'
                'else: raise AssertionError("cgroup delegation allowed")\n') + code
        r, seen = probe('positive-counted-cache-alias', code, [str(cache)])
        assert r['returncode'] == 0 and seen == {'sameFilesystem': True, 'writable': True}
        assert not any(cache.iterdir()), 'cache write reached host'
        r, seen = probe('external-egress-loopback', FROZEN['EGRESS'])
        assert r['returncode'] == 0 and not r['overflow'] and seen['loopback'] == 'OK' and all(seen[k] != 'CONNECTED' for k in ('192.0.2.1', '1.1.1.1'))
        r, seen = probe('read-only-host-counted-scratch', FROZEN['WRITES'], [config['root'], config['hostHome']])
        assert r['returncode'] == 0 and seen == {'checkout': 30, 'home': 30, 'scratch': 'WRITABLE'}
        marker = 'fpm-' + uuid.uuid4().hex
        hostdir = str(home / ('fpm-absent-' + uuid.uuid4().hex))
        r, seen = probe('private-home-git-outside-writes', FROZEN['PRIVATE'], [str(canary), config['root'], hostdir, marker, config['hostHome']])
        assert r['returncode'] == 0 and seen['home_canary'] in ('ENOENT', 'EACCES', 'EPERM') and seen['git_head'] in ('ENOENT', 'EACCES', 'EPERM', 'ENOTDIR')
        assert seen['outside'] == {'checkout': 30, 'home': 30, 'host_dir': 'ABSENT'} and canary.read_bytes() == b'authored-public-fixture-canary'
        assert all(not (Path(p) / marker).exists() for p in ('/tmp', '/var/tmp', '/dev/shm'))
        r, seen = probe('no-capabilities-or-privilege', FROZEN['PRIVS'])
        assert r['returncode'] == 0 and seen['nnp'] == 1 and seen['sudo'] == 'DENIED' and seen['mount'] == 'DENIED' and seen['setuid0'] == 'EPERM'
        assert len(seen['caps']) == 5 and all(int(v, 16) == 0 for v in seen['caps'].values())
        r, seen = probe('48MiB-enospc', FROZEN['OVERLIMIT'])
        assert r['returncode'] == 0 and seen['errno'] == 28 and seen['mib'] <= 48
        r, _ = probe('detached-child-reaped', FROZEN['SURVIVOR'], ['fpm-child'])
        assert r['returncode'] == 0 and not r['overflow']
        r, _ = probe('deadline', FROZEN['SLEEP'], limit=3)
        assert r['returncode'] in (124, 137, -9) and 3 <= r['elapsed'] < 15
        r, _ = probe('output-cap', FROZEN['FLOOD'])
        assert r['overflow'] and r['returncode'] != 0
        r, _ = probe('512MiB-memory-oom', 'chunks=[]\nwhile True: chunks.append(bytearray(8*1024*1024))', allow_oom=True)
        assert r['returncode'] != 0 and not r['overflow'] and not r['late']
        assert r['memory']['events'].get('oom_kill', 0) > 0, 'kernel did not report capped memory termination'
        return reports
    except BaseException:
        Path(config['controlReceipt']).write_text(json.dumps({'status': 'ERROR', 'controls': reports}))
        raise
    finally:
        canary.unlink()


def diagnostic(output, limit=4096):
    text = output.decode('utf-8', 'replace')
    text = re.sub(r'(?i)(authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key)([^\n]*)', r'\1=[REDACTED]', text)
    text = re.sub(r'(?i)bearer\s+\S+', 'Bearer [REDACTED]', text)
    text = re.sub(r'/(?:Users|home|root|run/fpm-)[^\s"\':,]*', '[PATH]', text)
    data = text.encode()
    if len(data) <= limit:
        return text
    marker = b'\n[...omitted...]\n'
    half = (limit - len(marker)) // 2  # head keeps the first cause, tail the terminal one
    # shortcut: regex redaction is best effort; cut multibyte edges are dropped
    return (data[:half] + marker + data[-half:]).decode('utf-8', 'ignore')


def invoke(config, request):
    started = time.monotonic()
    for name, expected in json.loads(Path(config['immutableInputs']).read_bytes()).items():
        assert hashlib.sha256(Path(name).read_bytes()).hexdigest() == expected, 'immutable production input drift'
    for name, target in json.loads(Path(config['dependencyLinks']).read_bytes()).items():
        assert Path(name).is_symlink() and os.readlink(name) == target, 'immutable dependency link drift'
    result, output = execute(config, [config['node'], str(HERE / 'public-m-browser.mjs'), config['manifest']], request)
    cache = Path(config['sources'][request['phase']]['cwd']) / '.next/standalone/.next/cache'
    host_cache_unchanged = not any(cache.iterdir())
    assert host_cache_unchanged, 'runtime cache escaped counted namespace'
    assert clean(result) and result['returncode'] == 0 and not result['overflow'], (result, diagnostic(output))
    native = json.loads(output)
    elapsed = time.monotonic() - started
    assert elapsed <= 120, 'whole invocation including immutable-input hashing exceeded120s'
    native['containment'] = {**result, 'hostCacheUnchanged': host_cache_unchanged, 'wholeInvocationSeconds': elapsed}
    return native


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--memory-supervisor':
        def cancelled(signum, frame):
            raise KeyboardInterrupt('memory supervisor cancelled')
        signal.signal(signal.SIGTERM, cancelled)
        signal.signal(signal.SIGINT, cancelled)
        payload = json.loads(sys.argv[2])
        result, output = execute(payload['config'], payload['inner'], payload['request'],
                                 limit=payload['limit'], nonce=payload['nonce'])
        header = json.dumps(result).encode()
        assert len(header) < 8192, 'memory metadata exceeds stream reservation'
        sys.stdout.buffer.write(header + b'\n' + output)
        sys.exit(0)
    config = json.loads(Path(sys.argv[1]).read_bytes())
    config['manifest'] = str(Path(sys.argv[1]).resolve())
    if len(sys.argv) == 3 and sys.argv[2] == '--controls':
        print(json.dumps({'controls': controls(config), 'status': 'CONTROLS_ONLY'}))
    else:
        print(json.dumps(invoke(config, json.loads(os.environ['MEASURE_REQUEST']))))
