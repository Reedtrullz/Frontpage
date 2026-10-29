"""Owned, bounded jobs using the already cached public Node image."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
import hashlib
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import time
import uuid

from protocol import Record, Rejected, file_hash, record, require
from resource_limits import regular_path

IMAGE = 'sha256:e21fc383b50d5347dc7a9f1cae45b8f4e2f0d39f7ade28e4eef7d2934522b752'
SOCKET = '/Users/reidar/.colima/default/docker.sock'
MIB = 1024 * 1024
LEGACY = 'node22-pidns-v1'
# Linux reader profiles are frozen before any observation and mirror reader-m-prepare.mjs TARGETS/guardArgs.
# The bridge and fixture are baked into the immutable image (/image/out); the container has no bind mounts and no /work.
READER_SOCKET = '/var/run/docker.sock'
READER_ENTRY = '/image/out/bridge.mjs'
# reader-m-prepare.mjs copies the bridge into the image with its fixture import renamed to the image copy.
SOURCE_IMPORT, IMAGE_IMPORT = b"'./reader-m-fixture.mjs'", b"'./fixture.mjs'"


class TerminalFailure(Rejected):
    """The container ran and exited abnormally (OOM, nonzero, killed); distinct from a failure to clean it up."""


@dataclass(frozen=True, slots=True)
class Envelope:
    pids: int
    cpus: str
    memory: int
    node: tuple[str, ...] = ()


READER = {
    'reader-linux-local-v1': Envelope(32, '0.5', 128 * MIB, ('--permission', '--allow-fs-read=/image', '--allow-fs-read=/tmp',
                                                            '--allow-fs-write=/tmp')),
    'reader-linux-do-v1': Envelope(128, '1', 512 * MIB),
}
READER_FIELDS = {'profile', 'image', 'docker', 'mounts', 'scratchBytes', 'freeze', 'entrypoint'}


def image_bridge_hash(source: Path) -> str:
    """Hash of the bridge bytes as copied into the image."""
    raw = source.read_bytes()
    require(raw.count(SOURCE_IMPORT) == 1, 'bridge fixture import')
    return hashlib.sha256(raw.replace(SOURCE_IMPORT, IMAGE_IMPORT)).hexdigest()


def check_guard(guard: Record, profile: str) -> None:
    """Mirror of reader-m-prepare.mjs checkInspect for reader profiles; run on the live inspect and again on stored receipts."""
    env = READER[profile]
    host = record(guard.get('host'))
    tmpfs = host.get('Tmpfs') or {}
    opts = str(tmpfs.get('/tmp', '')).split(',') if isinstance(tmpfs, dict) else []
    mounts = guard.get('mounts')
    require(isinstance(mounts, list), 'guard readback mounts')
    assert isinstance(mounts, list)
    checks = {
        'user': guard.get('user') == '1000:1000', 'network': host.get('NetworkMode') == 'none', 'readonly': host.get('ReadonlyRootfs') is True,
        'privileged': not host.get('Privileged'), 'init': host.get('Init') is True, 'caps': host.get('CapDrop') == ['ALL'] and not host.get('CapAdd'),
        'no-new-privileges': 'no-new-privileges' in (host.get('SecurityOpt') or []), 'pids': host.get('PidsLimit') == env.pids,
        'memory': host.get('Memory') == env.memory and host.get('MemorySwap') == env.memory,
        'cpus': host.get('NanoCpus') == int(float(env.cpus) * 1e9), 'shm': host.get('ShmSize') == MIB,
        'log': record(host.get('LogConfig') or {}).get('Type') == 'none', 'dns': host.get('Dns') == ['127.0.0.1'],
        'tmpfs': isinstance(tmpfs, dict) and list(tmpfs) == ['/tmp'] and 'size=' + str(6 * MIB) in opts and all(o in opts for o in ('noexec', 'nosuid', 'nodev')),
        'binds': not host.get('Binds'),
        'mounts': all(isinstance(m, dict) and m.get('Type') == 'tmpfs' and m.get('Destination') == '/tmp' for m in mounts),
    }
    failed = [name for name, ok in checks.items() if not ok]
    require(not failed, 'guard readback: ' + ','.join(failed))


def reader_binding(spec: Record, data: Record) -> None:
    """Cross-bind freeze, manifest, image ID, qualification and the committed bridge/fixture sources by bytes."""
    harness, freeze_path = data['harness'], Path(spec['freeze'])
    require(freeze_path.name == 'freeze.json', 'reader freeze name')
    parts = {name: freeze_path.parent / name for name in ('freeze.json', 'manifest.json', 'image.id', 'qualification.json')}
    for name, path in parts.items():
        require(str(path) in harness and file_hash(path) == harness[str(path)], 'unbound or stale reader ' + name)
    freeze = record(json.loads(parts['freeze.json'].read_text()))
    require(freeze.get('imageId') == spec['image'] and all(isinstance(freeze.get(k), str) and freeze[k] for k in ('manifestSha', 'protocolSha')),
            'freeze does not bind the reader image')
    require(file_hash(parts['manifest.json']) == freeze['manifestSha'], 'freeze does not bind the manifest')
    manifest = record(json.loads(parts['manifest.json'].read_text()))
    require(manifest.get('protocolSha') == freeze['protocolSha'], 'manifest does not bind the protocol')
    require(parts['image.id'].read_text().strip() == freeze['imageId'], 'image.id does not bind the freeze')
    qualification = record(json.loads(parts['qualification.json'].read_text()))
    require(qualification.get('pass') is True and all(qualification.get(k) == freeze[v] for k, v in
            (('imageId', 'imageId'), ('manifestSha', 'manifestSha'), ('protocolSha', 'protocolSha')))
            and qualification.get('freezeSha') == file_hash(parts['freeze.json']), 'qualification does not bind the freeze')
    sources = {Path(p).name: p for p in data['baseline']['sources']}
    bridge, fixture = sources.get('reader-m-bridge.mjs'), sources.get('reader-m-fixture.mjs')
    require(bridge is not None and fixture is not None and bridge in harness and fixture in harness, 'bridge/fixture sources not bound')
    assert bridge is not None and fixture is not None
    files = record(manifest.get('files'))
    require(files.get('bridge.mjs') == image_bridge_hash(Path(bridge)) and files.get('fixture.mjs') == file_hash(Path(fixture)),
            'image bridge/fixture differ from committed sources')


def validate(data: Record, phase: str) -> Record:
    spec = record(data['container'])
    reader = spec.get('profile') in READER
    require(set(spec) == (READER_FIELDS if reader else {'profile', 'image', 'docker', 'mounts', 'scratchBytes'}), 'container fields')
    if reader:
        require(str(record(data['runtime']).get('platform', '')).startswith('Linux'), 'reader profile requires an actual Linux host')
        require(isinstance(spec['image'], str) and re.fullmatch(r'sha256:[0-9a-f]{64}', spec['image']) is not None, 'reader image must be an immutable image ID')
        require(spec['scratchBytes'] == 7 * MIB, 'reader namespace reservation is tmpfs 6MiB + shm 1MiB')
        require(spec['entrypoint'] == READER_ENTRY, 'reader entrypoint binding')
        require(spec['mounts'] == {}, 'reader profile has no bind mounts')
        reader_binding(spec, data)
    else:
        require(spec['profile'] == LEGACY and spec['image'] == IMAGE, 'unqualified container profile/image')
    require(12 < data['timeout'] <= 120, 'container timeout must include control reserves')
    capacity = spec['scratchBytes']
    require(type(capacity) is int and 2 * MIB <= capacity <= data['scratchBytes'] - MIB, 'container scratch reservation')
    for executable in (spec['docker'], str(Path(sys.executable).resolve())):
        require(executable in data['executables'] and file_hash(Path(executable)) == data['executables'][executable], 'container control executable binding')
    allowed = {**data['harness'], **data['fixtures'], **data[phase]['sources']}
    mounts = record(spec['mounts'])
    if not reader:
        require(bool(mounts) and set(mounts) <= set(allowed), 'unbound container mount')
        require(len(set(mounts.values())) == len(mounts), 'duplicate container target')
        for source, target in mounts.items():
            regular_path(Path(source))
            require(Path(source).is_file() and file_hash(Path(source)) == allowed[source], 'stale container mount')
            path = PurePosixPath(target)
            require(path.is_relative_to('/work') and len(path.parts) > 2 and '..' not in path.parts
                    and str(path) == target and ',' not in source + target, 'invalid container mount target')
    for phases in data['commands'].values():
        argv = phases[phase]
        require(argv[0] == spec['docker'] and len(argv) >= 2 and (argv == [spec['docker'], READER_ENTRY] if reader else argv[1] in mounts.values()),
                'container entry binding')
    return spec


class ContainerJob:
    def __init__(self, data: Record, phase: str, scratch: Path, env: dict[str, str], deadline: float):
        self.spec = validate(data, phase)
        self.reader = READER.get(self.spec['profile'])
        self.image = self.spec['image']
        self.socket = READER_SOCKET if self.reader else SOCKET
        self.scratch, self.env, self.deadline = scratch, env, deadline
        self.name = 'portfolio-guard-' + uuid.uuid4().hex
        self.identity: Record = {'name': self.name, 'image': self.image, 'nonce': self.name, 'profile': self.spec['profile'],
                                 'control': [], 'cleaned': False, 'namespaceScratchCapacityBytes': self.spec['scratchBytes']}
        self.attempted = False
        self.create_acknowledged = False

    def control(self, arguments: list[str], *, cleanup: bool = False) -> str:
        remaining = self.deadline - time.monotonic() - (0 if cleanup else 6)
        require(remaining > 0, 'container control deadline')
        paths = [self.scratch / ('control.' + stream) for stream in ('out', 'err')]
        # Regular descriptors avoid truncated pipe reads; RLIMIT_FSIZE bounds both streams.
        launcher = 'import resource,os,sys;resource.setrlimit(resource.RLIMIT_FSIZE,(65536,65536));os.execv(sys.argv[1],sys.argv[1:])'
        argv = [str(Path(sys.executable).resolve()), '-S', '-c', launcher, self.spec['docker'],
                '--host', 'unix://' + self.socket, *arguments]
        with paths[0].open('wb') as stdout, paths[1].open('wb') as stderr:
            result = subprocess.run(argv, env=self.env, stdout=stdout, stderr=stderr, timeout=min(3, remaining))
        out, err = (p.read_text(errors='replace') for p in paths)
        self.identity['control'].append({'argv': argv, 'returncode': result.returncode, 'stdout': out, 'stderr': err})
        require(result.returncode == 0, 'container control failed: ' + err.strip())
        return out

    def inspect(self, *, cleanup: bool = False) -> Record:
        items = json.loads(self.control(['inspect', '--type', 'container', self.name], cleanup=cleanup))
        require(isinstance(items, list) and len(items) == 1, 'container inspect shape')
        info = record(items[0])
        require(info['Name'] == '/' + self.name and info['Image'] == self.image
                and info['Config']['Labels'].get('portfolio.guard') == self.name, 'foreign container identity')
        if 'id' in self.identity:
            require(info['Id'] == self.identity['id'], 'changed container ID')
        self.identity['id'] = info['Id']
        return info

    def prepare(self, argv: list[str], request: str, timeout: float) -> list[str]:
        mounts = []
        for source, target in self.spec['mounts'].items():
            mounts += ['--mount', f'type=bind,source={source},target={target},readonly']
        self.attempted = True
        r = self.reader or Envelope(32, '0.5', 128 * MIB)
        noexec = ',noexec' if self.reader else ''
        env = (['--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'SSL_CERT_FILE=/image/out/ca-certificates.crt',
                '--env', 'OPENSSL_CONF=/image/out/openssl.cnf'] if self.reader else
               ['--env', 'HOME=/tmp', '--env', 'TMPDIR=/tmp', '--env', 'NODE_COMPILE_CACHE=/tmp/node',
                '--env', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH=/tmp/bun', '--env', 'LANG=C'])
        self.control(['create', '--pull=never', '--name', self.name, '--label', 'portfolio.guard=' + self.name,
                      '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
                      '--network', 'none', '--dns', '127.0.0.1', '--read-only', '--init', '--pids-limit', str(r.pids),
                      '--cpus', r.cpus, '--memory', str(r.memory), '--memory-swap', str(r.memory),
                      '--log-driver', 'none', '--shm-size', str(MIB),
                      '--tmpfs', f'/tmp:rw,nosuid,nodev{noexec},size={self.spec["scratchBytes"] - MIB},mode=1777',
                      *env, '--env', 'MEASURE_REQUEST=' + request, *mounts, '--entrypoint', '/usr/bin/timeout', self.image,
                      '--signal=KILL', str(timeout - 12), '/usr/local/bin/node', *r.node, *argv[1:]])
        self.create_acknowledged = True
        info = self.inspect()
        host = info['HostConfig']
        guard = {'host': host, 'mounts': info['Mounts'], 'user': info['Config']['User']}
        if self.reader:
            check_guard(guard, self.spec['profile'])
        else:
            require(host['NetworkMode'] == 'none' and host['ReadonlyRootfs'] and host['PidsLimit'] == r.pids
                    and host['Memory'] == r.memory and host['MemorySwap'] == r.memory
                    and host['ShmSize'] == MIB and host['Init'] is True and host['CapDrop'] == ['ALL']
                    and 'no-new-privileges' in host['SecurityOpt'] and host['Dns'] == ['127.0.0.1']
                    and host['LogConfig']['Type'] == 'none' and info['Config']['User'] == '1000:1000', 'container guard readback')
            expected = {(p, t) for p, t in self.spec['mounts'].items()}
            actual = {(m['Source'], m['Destination']) for m in info['Mounts'] if m['Type'] == 'bind' and not m['RW']}
            require(actual == expected and len(info['Mounts']) == len(expected), 'container mount readback')
        self.identity['guardReadback'] = guard
        return [self.spec['docker'], '--host', 'unix://' + self.socket, 'start', '--attach', self.name]

    def close(self) -> None:
        if not self.attempted:
            self.identity['cleaned'] = True
            return
        # A failed create may still have created the owned name; inspect the daemon.
        names = self.control(['ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.Names}}'], cleanup=True).splitlines()
        require(names in ([], [self.name]), 'ambiguous container ownership')
        require(bool(names) or self.create_acknowledged, 'unacknowledged create: cleanup remains unresolved')
        if names:
            info = self.inspect(cleanup=True)
            if info['State']['Running']:
                self.identity['killedByCleanup'] = True
                self.control(['kill', '--signal', 'KILL', self.name], cleanup=True)
            state = self.inspect(cleanup=True)['State']
            require(not state['Running'] and state['Pid'] == 0, 'container process survives')
            self.identity['terminalState'] = state
            self.control(['rm', self.name], cleanup=True)
            require(not self.control(['ps', '-a', '--filter', 'name=^/' + self.name + '$', '--format', '{{.Names}}'], cleanup=True).strip(), 'container removal unconfirmed')
        self.identity['cleaned'] = True
        # Report terminal failure only after the exact owned container is gone: the attach client can succeed after OOM/nonzero exit.
        require('terminalState' in self.identity, 'missing container terminal state')
        state = record(self.identity['terminalState'])
        if state.get('OOMKilled') is not False:
            raise TerminalFailure('container OOM killed')
        if state.get('ExitCode') != 0 or self.identity.get('killedByCleanup'):
            raise TerminalFailure('container nonzero exit')
