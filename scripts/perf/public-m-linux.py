"""Frontpage-only Linux adapter. Frozen util-linux controls precede real browser admission."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
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


class RunResult(TypedDict):
    returncode: int
    overflow: bool
    late: bool
    elapsed: float
    survivors: list[int]
    scratchRemoved: bool
    scratch: str


def namespace_script():
    script = FROZEN['SCRIPT'].replace('shift 8', 'app_cache=$9; base_git=${10}; candidate_git=${11}; shift 11', 1)
    mount = 'install -d -o "$uid" -g "$gid" -m 0700 "$scratch/app-cache"\nmount --bind "$scratch/app-cache" "$app_cache"\n'
    mount += 'for dotgit in "$base_git" "$candidate_git"; do\nif [ -d "$dotgit" ]; then mount -t tmpfs -o size=4k,mode=0555,ro tmpfs "$dotgit"; elif [ -e "$dotgit" ]; then mount --bind /dev/null "$dotgit"; fi\ndone\n'
    script = script.replace('while read -r mp; do', mount + 'while read -r mp; do', 1)
    script = script.replace('"$scratch"|"$scratch"/*|/proc', '"$app_cache"|"$scratch"|"$scratch"/*|/proc', 1)
    return script


def execute(config, inner, request, *, limit=110, nonce=None):
    nonce = nonce or uuid.uuid4().hex
    scratch = '/run/fpm-' + nonce
    phase = request.get('phase', 'baseline')
    cache = str(Path(config['sources'][phase]['cwd']) / '.next/standalone/.next/cache')
    env = [f'PATH={Path(config["node"]).parent}:/usr/sbin:/usr/bin:/sbin:/bin',
           f'HOME={scratch}/home', f'TMPDIR={scratch}/work', f'XDG_CACHE_HOME={scratch}/cache',
           f'XDG_CONFIG_HOME={scratch}/config', f'XDG_RUNTIME_DIR={scratch}/run',
           f'PLAYWRIGHT_BROWSERS_PATH={config["browsers"]}', 'LANG=C', 'PYTHONDONTWRITEBYTECODE=1',
           'MEASURE_REQUEST=' + json.dumps(request), 'NEXT_TELEMETRY_DISABLED=1']
    argv = ['sudo', '-n', 'unshare', '--net', '--mount', '--pid', '--fork', '--kill-child', '--mount-proc',
            'sh', '-c', namespace_script(), 'frontpage-public', scratch, str(os.getuid()), str(os.getgid()),
            config['root'], config['hostHome'], config['browsers'], str(limit), str(48 * MIB), cache,
            str(Path(config['sources']['baseline']['cwd']) / '.git'), str(Path(config['sources']['candidate']['cwd']) / '.git'), 'env', '-i', *env, *inner]
    started = time.monotonic()
    process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    assert process.stdout is not None
    output, overflow, late = bytearray(), False, False
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                if time.monotonic() - started > limit + 5:
                    late = True
                    break
                if not selector.select(.1):
                    continue
                chunk = os.read(process.stdout.fileno(), 4096)
                if not chunk:
                    break
                available = MIB - len(output)
                output.extend(chunk[:available])
                if len(chunk) > available:
                    overflow = True
                    break
    finally:
        if overflow or late:
            process.stdout.close()
            process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=3)
        process.stdout.close()
    survivors = []
    for item in Path('/proc').iterdir():
        if item.name.isdigit() and int(item.name) != os.getpid():
            try:
                if scratch.encode() in (item / 'cmdline').read_bytes():
                    survivors.append(int(item.name))
            except OSError:
                pass
    subprocess.run(['sudo', '-n', 'rmdir', scratch], capture_output=True, check=False, timeout=3)
    result: RunResult = {'returncode': process.returncode, 'overflow': overflow, 'late': late,
              'elapsed': time.monotonic() - started, 'survivors': survivors, 'scratchRemoved': not Path(scratch).exists(), 'scratch': scratch}
    return result, bytes(output)


def clean(result):
    return not result['survivors'] and result['scratchRemoved'] and not result['late']


def controls(config):
    reports = []
    home = Path(config['hostHome'])
    canary = home / ('fpm-canary-' + uuid.uuid4().hex)
    canary.write_bytes(b'authored-public-fixture-canary')
    try:
        def probe(name, code, args=(), *, limit=110):
            result, output = execute(config, [sys.executable, '-I', '-B', '-c', code, *args], {}, limit=limit)
            try:
                seen = json.loads(output)
            except ValueError:
                seen = {}
            reports.append({'control': name, 'cleanup': result, 'observed': seen})
            assert clean(result), name + ': cleanup'
            return result, seen
        cache = Path(config['sources']['baseline']['cwd']) / '.next/standalone/.next/cache'
        code = ('import json,os,pathlib,sys; p=pathlib.Path(sys.argv[1]); '
                'same=os.stat(p).st_dev==os.stat(os.environ["TMPDIR"]).st_dev; '
                '(p/"counted-cache-canary").write_bytes(b"x"); '
                'print(json.dumps({"sameFilesystem":same,"writable":True}))')
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
    config = json.loads(Path(sys.argv[1]).read_bytes())
    config['manifest'] = str(Path(sys.argv[1]).resolve())
    if len(sys.argv) == 3 and sys.argv[2] == '--controls':
        print(json.dumps({'controls': controls(config), 'status': 'CONTROLS_ONLY'}))
    else:
        print(json.dumps(invoke(config, json.loads(os.environ['MEASURE_REQUEST']))))
