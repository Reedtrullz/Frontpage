"""Public browser envelope fails closed before a workload can start."""
import copy
import io
import os
import shutil
import subprocess
import sys
import unittest
import importlib.util
import json
import errno
import shlex
from contextlib import redirect_stdout
from types import SimpleNamespace
from typing import TypedDict
from unittest.mock import patch
from pathlib import Path
from contextlib import ExitStack

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_resources import ResourceTests
from protocol import Rejected
from resource_limits import FRONTPAGE_APPROVAL, FRONTPAGE_APPROVAL_SHA, ResourceBudget

NODE = os.environ.get('NODE') or shutil.which('node')
CONTAINED_MEMORY = {'max': 536870912, 'swapMax': 0, 'oomGroup': 1, 'peak': 4194304,
                    'events': {'oom_kill': 0}, 'populated': 0, 'procs': [], 'leaf': '/mock-cgroup/fpm-fixture'}


class MemoryFixtureState(TypedDict):
    launched: bool
    joined: bool
    killed: bool
    waited: bool
    removed: bool
    membership: str
    writes: list[tuple[str, str]]


class PublicEnvelopeTests(ResourceTests):
    def browser(self) -> None:
        self.case.update(identities=['Reedtrullz/Frontpage'], modality='browser',
                         resourceProfile='browser-64m-20261028', scratchBytes=64 * 1024 ** 2,
                         browserProfileApproval={'path': str(FRONTPAGE_APPROVAL), 'sha256': FRONTPAGE_APPROVAL_SHA})

    def test_namespace_is_counted_with_parent(self) -> None:
        self.browser()
        self.case['namespaceReservationBytes'] = 48 * 1024 ** 2
        self.admitted()
        budget = ResourceBudget.read(self.case)
        reservation = budget.namespace_reservation(self.case)
        self.assertEqual(budget.enforce(reservation), budget.usage() + 48 * 1024 ** 2)
        with self.assertRaisesRegex(Rejected, 'combined scratch'):
            budget.enforce(reservation + 17 * 1024 ** 2)

    def test_bad_namespace_and_foreign_approval_rejected(self) -> None:
        self.browser()
        original = copy.deepcopy(self.case)
        for changes in ({'namespaceReservationBytes': True}, {'namespaceReservationBytes': -1},
                        {'namespaceReservationBytes': 49 * 1024 ** 2}, {'namespaceReservationBytes': 0},
                        {'namespaceReservationBytes': 48 * 1024 ** 2, 'container': {}},
                        {'identities': ['Reedtrullz/NAVigator']}, {'modality': 'cli'}):
            with self.subTest(changes=changes):
                self.case = {**copy.deepcopy(original), **changes}
                with self.assertRaises(Rejected):
                    self.admitted()

    def test_default_has_no_namespace_reservation(self) -> None:
        self.assertEqual(ResourceBudget.read(self.case).namespace_reservation(self.case), 0)

    def test_public_schedule_is_exactly_original_four_cohorts(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        spec = importlib.util.spec_from_file_location('public_prepare_test', path)
        self.assertIsNotNone(spec)
        assert spec and spec.loader
        producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(producer)
        script = producer.guard.namespace_script()
        import subprocess
        checked = subprocess.run(['/bin/sh', '-n'], input=script, text=True, capture_output=True, check=False)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertIn('"$app_cache"|"$scratch"|"$scratch"/*|/proc', script)
        for boundary in ('--no-new-privs', '--bounding-set=-all', 'ip link set lo up', 'mount --make-rprivate /',
                         'exit 97', 'mount --bind "$scratch/shm" /dev/shm'):
            self.assertIn(boundary, script)
        from protocol import slot, save
        manifest, clock, inputs = (self.root / n for n in ('manifest.json', 'clock.cjs', 'inputs.json'))
        for file in (manifest, clock, inputs):
            save(file, {})
        config = {'manifest': str(manifest), 'clock': str(clock), 'immutableInputs': str(inputs), 'node': sys.executable,
                  'sources': {p: self.case[p] for p in ('baseline', 'candidate')}}
        cases = [(str(self.root / f'{width}-{temperature}.json'), producer.case_for(config, {'width': width, 'height': height}, temperature, '0' * 64))
                 for width, height in ((1440, 1000), (390, 844)) for temperature in ('cold', 'warm')]
        plan = producer.m_plan(sys.executable, cases)
        self.assertEqual(len(plan), 256)
        self.assertEqual(len({unit['case'] for unit in plan}), 4)
        self.assertEqual({unit['scenario'] for unit in plan}, {'happy', 'failure'})
        for _, case in cases:
            self.assertEqual(case['namespaceReservationBytes'], 48 * 1024 ** 2)
            self.assertEqual(case['metrics']['navigationMs']['repetitions'], 2)
            self.assertEqual(case['shape']['routes'], ['/', '/status'])
        warm = [slot({'temperature': 'warm', 'pairs': 10}, n) for n in range(34)]
        self.assertEqual(sum(s['stage'] == 'warmup' for s in warm), 4)
        self.assertEqual(sum(s['stage'] == 'measured' for s in warm), 20)

    def test_whole_invocation_counts_hashing_and_rejects_stale_input(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-linux.py'
        spec = importlib.util.spec_from_file_location('public_linux_boundary_test', path)
        assert spec and spec.loader
        guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guard)
        cache = self.root / 'source/.next/standalone/.next/cache'
        cache.mkdir(parents=True)
        inputs = self.root / 'inputs.json'
        inputs.write_text('{}')
        config = {'immutableInputs': str(inputs), 'dependencyLinks': str(inputs), 'node': '/node', 'manifest': '/fixture-manifest',
                  'sources': {'baseline': {'cwd': str(self.root / 'source')}}}
        result = {'returncode': 0, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True,
                  'memory': copy.deepcopy(CONTAINED_MEMORY)}
        with patch.object(guard, 'execute', return_value=(result, b'{"status":"complete"}')), patch.object(guard.time, 'monotonic', side_effect=[0, 121]):
            with self.assertRaisesRegex(AssertionError, 'including immutable-input hashing'):
                guard.invoke(config, {'phase': 'baseline'})
        inputs.write_text(json.dumps({str(inputs): '0' * 64}))
        with patch.object(guard, 'execute') as launch:
            with self.assertRaisesRegex(AssertionError, 'immutable production input drift'):
                guard.invoke(config, {'phase': 'baseline'})
            launch.assert_not_called()

    def test_failed_invocation_keeps_bounded_redacted_diagnostic(self) -> None:
        guard = self.guard()
        cache = self.root / 'source/.next/standalone/.next/cache'
        cache.mkdir(parents=True)
        inputs = self.root / 'inputs.json'
        inputs.write_text('{}')
        config = {'immutableInputs': str(inputs), 'dependencyLinks': str(inputs), 'node': '/node', 'manifest': '/m',
                  'sources': {'baseline': {'cwd': str(self.root / 'source')}}}
        result = {'returncode': 1, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True,
                  'memory': copy.deepcopy(CONTAINED_MEMORY)}
        noisy = b'fixture-renderer-cause\nAuthorization: Bearer abc123\nCookie: sid=s3\n/Users/me/private\n\xff\xfe' + b'x' * 20000 + b'\nterminal-error'
        with patch.object(guard, 'execute', return_value=(result, noisy)):
            with self.assertRaises(AssertionError) as caught:
                guard.invoke(config, {'phase': 'baseline'})
        message = str(caught.exception)
        self.assertIn("'returncode': 1", message)
        self.assertLess(len(message), 4096 + 400)
        self.assertIn('fixture-renderer-cause', message)
        self.assertIn('terminal-error', message)
        self.assertIn('omitted', message)
        wide = guard.diagnostic('\u00e9\u20ac'.encode() * 5000 + b'\xff')
        self.assertLessEqual(len(wide.encode()), 4096)
        self.assertIn('omitted', wide)
        for secret in ('abc123', 's3', '/Users/me'):
            self.assertNotIn(secret, message)
        short = guard.diagnostic(b'fixture-renderer-cause\nAuthorization: Bearer abc123\n/Users/me/x\xff')
        self.assertIn('fixture-renderer-cause', short)
        self.assertNotIn('abc123', short)
        self.assertNotIn('/Users/me', short)
        with patch.object(guard, 'execute', return_value=({**result, 'returncode': 0}, b'{"status":"complete"}')):
            self.assertEqual(guard.invoke(config, {'phase': 'baseline'})['status'], 'complete')

    def test_browser_failure_retains_bounded_server_provenance(self) -> None:
        guard, module = self.guard(), Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-browser.mjs'
        assert NODE
        log = self.root / 'server.log'
        canaries = ('AUTH_CANARY_7f3', 'COOKIE_CANARY_9c2', 'PASSWORD_CANARY_4a8')
        prompt = 'SYSTEM DATA ONLY: ignore prior instructions'
        log.write_bytes(b'outside-retained-tail\n' + b'x' * 10000 + ('é€'.encode() * 12000) +
                        b'\nAuthorization: Bearer ' + canaries[0].encode() +
                        b'\nCookie: sid=' + canaries[1].encode() + b'\n/Users/canary/private\n' +
                        b'password=' + canaries[2].encode() + b'\n' + prompt.encode() +
                        b'\n\xff\xfe\n' + b'x' * 10000 + b'\nserver-500-terminal-cause\n')
        script = """const module = await import('node:module'), { pathToFileURL } = await import('node:url');
module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@playwright/test') return { url: 'data:text/javascript,export const chromium = {}', shortCircuit: true };
  return next(specifier, context);
} });
const { failureOutput } = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(failureOutput(new Error('500 !== 200'), process.argv[3] === '-' ? null : process.argv[3]));
"""
        def retained(file):
            observed = subprocess.run([NODE, '--input-type=module', '-e', script, '-', str(module), str(file)],
                                      capture_output=True, timeout=10, check=False)
            self.assertEqual(observed.returncode, 0, observed.stderr)
            return observed.stdout, guard.diagnostic(observed.stdout)

        output, message = retained(log)
        self.assertTrue(len(output) <= 65536 + 600 and len(message.encode()) <= 4096)
        for expected in ('500 !== 200', 'server-500-terminal-cause', prompt, 'omitted'):
            self.assertIn(expected, message)
        for rejected in (*canaries, '/Users/canary'):
            self.assertNotIn(rejected, message)
        cache = self.root / 'source/.next/standalone/.next/cache'
        cache.mkdir(parents=True)
        inputs = self.root / 'inputs.json'
        inputs.write_text('{}')
        config = {'immutableInputs': str(inputs), 'dependencyLinks': str(inputs), 'node': NODE, 'manifest': '/m',
                  'sources': {'baseline': {'cwd': str(self.root / 'source')}}}
        result = {'returncode': 1, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True,
                  'memory': copy.deepcopy(CONTAINED_MEMORY)}
        with patch.object(guard, 'execute', return_value=(result, output)):
            with self.assertRaises(AssertionError) as caught:
                guard.invoke(config, {'phase': 'baseline'})
        self.assertIn('server-500-terminal-cause', str(caught.exception))
        self.assertNotIn('"status":"complete"', message)
        log.write_bytes(b'x' * 70000 + b' Authorization: Bearer UNBOUNDED_LINE_CANARY')
        _, unbounded = retained(log)
        self.assertFalse(any(x in unbounded for x in ('UNBOUNDED_LINE_CANARY', '[server.log tail]')))
        log.unlink()
        _, missing = retained(log)
        self.assertIn('500 !== 200', missing)
        self.assertNotIn('[server.log tail]', missing)
        with patch.object(guard, 'execute', return_value=({**result, 'returncode': 0}, b'{"status":"complete"}')):
            self.assertEqual(guard.invoke(config, {'phase': 'baseline'})['status'], 'complete')

    def test_frozen_date_survives_framework_rewrap_for_server_and_browser(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        spec = importlib.util.spec_from_file_location('public_clock_source_test', path)
        assert spec and spec.loader and NODE
        producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(producer)
        clock = self.root / 'clock.cjs'
        clock.write_text(producer.clock_source())
        module = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-browser.mjs'
        script = """const module = await import('node:module'), { createRequire } = module,
  { pathToFileURL } = await import('node:url'), assert = (await import('node:assert/strict')).default;
module.registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@playwright/test') return { url: 'data:text/javascript,export const chromium = {}', shortCircuit: true };
  return next(specifier, context);
} });
const original = Date;
function rewrap(source) {
  const properties = Object.getOwnPropertyDescriptors(source);
  properties.now.value = () => source.now();
  const fresh = Object.defineProperties(function Date() {
    return new.target === undefined ? Reflect.apply(source, undefined, arguments) : Reflect.construct(source, arguments, new.target);
  }, properties);
  Object.defineProperty(source.prototype, 'constructor', { value: fresh });
  return fresh;
}
 const fixedCall = new original(1793203200000).toString();
 function verify() {
  assert.equal(typeof Date.parse, 'function');
  assert.equal(Date.parse('1970-01-01T00:00:00.000Z'), 0);
  assert.equal(Date.UTC(1970, 0, 1), 0);
  assert.ok(Number.isNaN(Date.parse('invalid')));
  assert.equal(Date(), fixedCall);
  assert.equal(Date(42), fixedCall);
  assert.equal(Date.call(null, 'ignored'), fixedCall);
  assert.equal(Date.apply(null, ['ignored', 42]), fixedCall);
  assert.equal(new Date().getTime(), 1793203200000);
  assert.equal(Date.now(), 1793203200000);
  assert.equal(new Date(42).getTime(), 42);
  assert.ok(Number.isNaN(new Date(undefined).getTime()));
  assert.ok(Number.isNaN(new Date('invalid').getTime()));
  assert.ok(new Date() instanceof Date);
  class ChildDate extends Date {}
  const child = new ChildDate(7);
  assert.equal(child.getTime(), 7);
  assert.ok(child instanceof ChildDate && child instanceof Date);
}
createRequire(import.meta.url)(process.argv[3]);
Date = rewrap(Date);
verify();
Date = original;
const browser = await import(pathToFileURL(process.argv[2]).href);
browser.installDate(browser.CLOCK);
Date = rewrap(Date);
verify();
process.stdout.write('server+browser frozen Date contract PASS\\n');
"""
        result = subprocess.run([NODE, '--input-type=module', '-e', script, '-', str(module), str(clock)],
                                text=True, capture_output=True, timeout=10, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'server+browser frozen Date contract PASS\n')

    def guard(self):
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-linux.py'
        spec = importlib.util.spec_from_file_location('public_linux_diag_test', path)
        assert spec and spec.loader
        guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(guard)
        return guard

    def memory_fixture(self, guard, failure=''):
        """Fake only cgroup filesystem/process syscalls, never the admission owner."""
        stack = ExitStack()
        self.addCleanup(stack.close)
        root = self.root / 'cgroup'
        parent = root / 'worker'
        parent.mkdir(parents=True)
        (parent / 'cgroup.subtree_control').write_text('memory pids')
        (parent / 'cgroup.type').write_text('domain')
        nonce = 'a' * 32
        leaf = parent / ('fpm-' + nonce)
        state: MemoryFixtureState = {'launched': False, 'joined': False, 'killed': False, 'waited': False,
                 'removed': False, 'membership': '/worker', 'writes': []}
        real_mkdir, real_write, real_stat, real_rmdir = Path.mkdir, Path.write_text, Path.stat, Path.rmdir
        primitives = {'memory.max': 'max', 'memory.swap.max': 'max', 'memory.oom.group': '0',
                      'memory.events': 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n',
                      'memory.peak': '0', 'cgroup.events': 'populated 0\nfrozen 0\n',
                      'cgroup.procs': '', 'cgroup.kill': ''}

        def mkdir(path, *args, **kwargs):
            real_mkdir(path, *args, **kwargs)
            if path == leaf:
                for name, value in primitives.items():
                    real_write(path / name, value)
                if failure == 'primitive':
                    (path / 'memory.peak').unlink()

        def write(path, value, *args, **kwargs):
            if path.is_relative_to(root):
                state['writes'].append((path.name, value))
                if failure == 'readback' and path.name == 'memory.max':
                    return real_write(path, 'max')
                if path == leaf / 'cgroup.procs':
                    self.assertEqual(value.strip(), '0')
                    state['membership'] = '/worker/fpm-' + nonce
                    state['joined'] = True
                    real_write(leaf / 'cgroup.events', 'populated 1\nfrozen 0\n')
                if path == leaf / 'cgroup.kill':
                    state['killed'] = True
                    if failure != 'populated':
                        real_write(leaf / 'cgroup.procs', '')
                        real_write(leaf / 'cgroup.events', 'populated 0\nfrozen 0\n')
            return real_write(path, value, *args, **kwargs)

        def read(path):
            if str(path) == '/proc/self/cgroup':
                return '0::' + state['membership']
            if str(path) == '/proc/self/mountinfo':
                return f'1 0 0:1 / {root} rw - cgroup2 cgroup rw\n'
            with path.open() as handle:
                value = handle.read(8193)
            assert len(value) <= 8192, 'bounded cgroup read'
            return value.strip()

        def stat(path, *args, **kwargs):
            value = real_stat(path, *args, **kwargs)
            if path.is_relative_to(root):
                return SimpleNamespace(st_uid=1000 if failure == 'owner' and path == parent else 0,
                                       st_mode=value.st_mode, st_dev=value.st_dev, st_ino=value.st_ino)
            return value

        def rmdir(path):
            if path == leaf:
                self.assertTrue(state['killed'], 'owned leaf must be killed before removal')
                self.assertEqual((leaf / 'cgroup.procs').read_text(), '')
                self.assertIn('populated 0', (leaf / 'cgroup.events').read_text())
                if state['launched']:
                    self.assertTrue(state['waited'], 'launcher must be joined before removal')
                for item in leaf.iterdir():
                    item.unlink()
                state['removed'] = True
            return real_rmdir(path)

        class Process:
            stdout = SimpleNamespace(fileno=lambda: 99, close=lambda: None)
            returncode = 137 if failure == 'oom' else 0
            def wait(self, timeout):
                state['waited'] = True
                return self.returncode
            def terminate(self):
                self.returncode = -15
            def kill(self):
                self.returncode = -9

        def launch(argv, **kwargs):
            self.assertTrue(leaf.exists(), 'kernel memory cap must exist before application launch')
            self.assertEqual(leaf.stat().st_mode & 0o777, 0o755, 'nonroot proof requires traversal without delegation')
            self.assertEqual((leaf / 'memory.max').read_text(), '536870912')
            self.assertEqual((leaf / 'memory.swap.max').read_text(), '0')
            self.assertEqual((leaf / 'memory.oom.group').read_text(), '1')
            self.assertIn('preexec_fn', kwargs, 'launcher must join before exec/fork')
            if failure == 'stale':
                state['membership'] = '/worker/other'
            kwargs['preexec_fn']()
            self.assertTrue(state['joined'])
            if failure == 'spawn':
                raise OSError('authored spawn failure')
            state['launched'] = True
            if failure == 'oom':
                real_write(leaf / 'memory.events', 'max 5\noom 1\noom_kill 1\n')
                real_write(leaf / 'memory.peak', str(536870912 + 4096))
            else:
                real_write(leaf / 'memory.peak', '4194304')
            return Process()

        class Selector:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def register(self, *args): pass
            def select(self, timeout):
                if failure == 'cancel': raise KeyboardInterrupt('authored cancellation')
                return [True]

        stack.enter_context(patch.object(guard, 'CGROUP_ROOT', root, create=True))
        stack.enter_context(patch.object(guard, 'cgroup_read', read, create=True))
        stack.enter_context(patch.object(guard.os, 'geteuid', return_value=0))
        stack.enter_context(patch.object(guard.signal if hasattr(guard, 'signal') else __import__('signal'), 'signal'))
        stack.enter_context(patch.object(Path, 'mkdir', mkdir))
        stack.enter_context(patch.object(Path, 'write_text', write))
        stack.enter_context(patch.object(Path, 'stat', stat))
        stack.enter_context(patch.object(Path, 'lstat', lambda path: stat(path, follow_symlinks=False)))
        stack.enter_context(patch.object(Path, 'rmdir', rmdir))
        stack.enter_context(patch.object(guard.subprocess, 'Popen', launch))
        stack.enter_context(patch.object(guard.subprocess, 'run', return_value=SimpleNamespace(returncode=0)))
        stack.enter_context(patch.object(guard.selectors, 'DefaultSelector', Selector))
        chunks = iter([b'{"status":"complete"}', b''])
        stack.enter_context(patch.object(guard.os, 'read', side_effect=lambda fd, size: next(chunks)))
        if failure == 'timeout':
            ticks = iter([0, 0, 116, 116, 116, 116, 116, 116])
            stack.enter_context(patch.object(guard.time, 'monotonic', side_effect=lambda: next(ticks, 116)))
        if failure == 'controller':
            (parent / 'cgroup.subtree_control').write_text('pids')
        if failure == 'path':
            state['membership'] = '/worker/../escape'
        if failure in ('ancestor', 'ambient', 'unknown'):
            current = parent / 'current'
            current.mkdir()
            for name, value in {'cgroup.subtree_control': '', 'cgroup.controllers': 'memory pids',
                                'cgroup.type': 'domain', 'memory.max': 'max', 'pids.max': 'max'}.items():
                (current / name).write_text(value)
            if failure == 'ambient':
                (current / 'memory.max').write_text('268435456')
            if failure == 'unknown':
                (current / 'cgroup.controllers').write_text('memory pids unknown')
            state['membership'] = '/worker/current'
        config = {'node': '/python', 'root': '/fixture', 'hostHome': '/fixture-home', 'browsers': '/browsers',
                  '_fixtureUid': 1000, '_fixtureGid': 1000,
                  'sources': {p: {'cwd': '/source/' + p} for p in ('baseline', 'candidate')}}
        return config, nonce, leaf, state

    def test_memory_cap_precedes_application_and_reaps_normal_exit(self) -> None:
        guard = self.guard()
        config, nonce, leaf, state = self.memory_fixture(guard)
        result, output = guard.execute(config, ['/never-executed'], {}, nonce=nonce)
        self.assertTrue(state['joined'] and state['killed'] and state['waited'] and state['removed'])
        self.assertEqual(state['writes'].count(('cgroup.kill', '1')), 2, 'kill must work before admission and run again at teardown')
        self.assertFalse(leaf.exists())
        self.assertEqual(result['memory']['max'], 536870912)
        self.assertEqual(result['memory']['peak'], 4194304)
        self.assertEqual(result['memory']['populated'], 0)
        self.assertTrue(guard.clean(result))
        self.assertEqual(output, b'{"status":"complete"}')

    def test_memory_fixture_supports_direct_lstat_dispatch(self) -> None:
        def direct_lstat(path, *, follow_symlinks=False):
            return os.lstat(path)

        with patch.object(Path, 'lstat', direct_lstat):
            guard = self.guard()
            config, nonce, leaf, state = self.memory_fixture(guard)
            result, _ = guard.execute(config, ['/never-executed'], {}, nonce=nonce)
            self.assertTrue(guard.clean(result))
            self.assertTrue(state['joined'] and state['removed'])
            parent = leaf.parent
            original = os.lstat(parent)
            observed = parent.lstat()
            self.assertEqual((observed.st_mode, observed.st_dev, observed.st_ino),
                             (original.st_mode, original.st_dev, original.st_ino))
            link = parent / 'link'
            link.symlink_to(parent, target_is_directory=True)
            with self.assertRaisesRegex(AssertionError, 'root-owned nondelegated'):
                guard.MemoryCgroup.root_owned(link)

    def test_memory_rows_cleanup_after_unexpected_exception(self) -> None:
        original_fixture, original_guard = self.memory_fixture.__func__, self.guard.__func__
        for method, count in (('test_memory_unavailable_or_malformed_parent_fails_closed', 8),
                              ('test_memory_cleanup_handles_spawn_timeout_cancel_and_oom', 4)):
            with self.subTest(method=method):
                clean_rows = []

                def fixture(case, guard, failure=''):
                    clean_rows.append(not (case.root / 'cgroup').exists())
                    return original_fixture(case, guard, failure)

                def guard_for_row(case):
                    guard = original_guard(case)
                    if not clean_rows:
                        def unexpected(*args, **kwargs):
                            raise RuntimeError('authored unexpected row exception')
                        guard.execute = unexpected
                    return guard

                result = unittest.TestResult()
                with patch.object(PublicEnvelopeTests, 'memory_fixture', fixture), \
                     patch.object(PublicEnvelopeTests, 'guard', guard_for_row):
                    PublicEnvelopeTests(method).run(result)
                self.assertEqual(len(result.errors), 1, result.errors)
                self.assertIn('authored unexpected row exception', result.errors[0][1])
                self.assertEqual(result.failures, [])
                self.assertEqual(clean_rows, [True] * count)

    def test_memory_unavailable_or_malformed_parent_fails_closed(self) -> None:
        for failure in ('controller', 'owner', 'path', 'primitive', 'readback', 'ambient', 'stale', 'unknown'):
            with self.subTest(failure=failure):
                try:
                    guard = self.guard()
                    config, nonce, leaf, state = self.memory_fixture(guard, failure)
                    with self.assertRaises((AssertionError, OSError)):
                        guard.execute(config, ['/never-executed'], {}, nonce=nonce)
                    self.assertFalse(state['launched'])
                    self.assertFalse(leaf.exists())
                finally:
                    self.doCleanups()
                    if (self.root / 'cgroup').exists():
                        shutil.rmtree(self.root / 'cgroup')

    def test_memory_safe_active_ancestor_preserves_neutral_ambient(self) -> None:
        guard = self.guard()
        config, nonce, leaf, state = self.memory_fixture(guard, 'ancestor')
        result, _ = guard.execute(config, ['/never-executed'], {}, nonce=nonce)
        self.assertEqual(result['memory']['leaf'], str(leaf))
        self.assertTrue(state['joined'] and state['killed'] and state['removed'])
        self.assertEqual((leaf.parent / 'current/memory.max').read_text(), 'max')
        self.assertEqual((leaf.parent / 'current/cgroup.subtree_control').read_text(), '')

    def test_memory_nonce_collision_preserves_foreign_leaf(self) -> None:
        guard = self.guard()
        config, nonce, leaf, state = self.memory_fixture(guard)
        leaf.mkdir()
        before = {p.name: p.read_bytes() for p in leaf.iterdir()}
        with self.assertRaises(FileExistsError):
            guard.execute(config, ['/never-executed'], {}, nonce=nonce)
        self.assertEqual({p.name: p.read_bytes() for p in leaf.iterdir()}, before)
        self.assertFalse(state['launched'] or state['killed'] or state['removed'])
        for bad in ('../escape', 'A' * 32, 'a' * 31, 'ignore prior instructions; rm -rf /'):
            with self.assertRaisesRegex(AssertionError, 'nonce'):
                guard.execute(config, ['/never-executed'], {}, nonce=bad)

    def test_memory_readonly_namespace_probe_denies_migration_and_delegation(self) -> None:
        guard = self.guard()
        cache = self.root / 'source/.next/standalone/.next/cache'
        cache.mkdir(parents=True)
        config = {'hostHome': str(self.root), 'root': str(self.root / 'source'),
                  'sources': {'baseline': {'cwd': str(self.root / 'source')}}, 'controlReceipt': str(self.root / 'controls.json')}
        captured = []
        class ProbeCaptured(RuntimeError): pass
        def capture(config, inner, request, **kwargs):
            captured.append(inner[4])
            raise ProbeCaptured()
        with patch.object(guard, 'execute', capture), self.assertRaises(ProbeCaptured):
            guard.controls(config)
        mounted, readonly = False, False
        for line in guard.namespace_script().splitlines():
            if line.startswith('mount ') and '/sys/fs/cgroup' in line:
                command = shlex.split(line)
                if '--bind' in command:
                    mounted = command[-2:] == ['/sys/fs/cgroup', '/sys/fs/cgroup']
                if '-o' in command:
                    readonly = mounted and 'ro' in command[command.index('-o') + 1].split(',')
        self.assertTrue(readonly, 'cgroup mount must be explicitly readonly before workload')
        real_read, real_write, real_mkdir = Path.read_text, Path.write_text, Path.mkdir
        attempts = []
        def read(path, *args, **kwargs):
            if str(path) == '/proc/self/cgroup': return '0::/worker/fpm-' + 'a' * 32
            if str(path).startswith('/sys/fs/cgroup/'):
                return {'memory.max': '536870912', 'memory.swap.max': '0', 'memory.oom.group': '1'}[path.name]
            return real_read(path, *args, **kwargs)
        def write(path, *args, **kwargs):
            if str(path).startswith('/sys/fs/cgroup/'):
                attempts.append(path.name)
                raise OSError(errno.EROFS, 'authored readonly mount')
            return real_write(path, *args, **kwargs)
        def mkdir(path, *args, **kwargs):
            if str(path).startswith('/sys/fs/cgroup/'):
                attempts.append('mkdir')
                raise OSError(errno.EROFS, 'authored readonly mount')
            return real_mkdir(path, *args, **kwargs)
        output = io.StringIO()
        with patch.object(Path, 'read_text', read), patch.object(Path, 'write_text', write), \
             patch.object(Path, 'mkdir', mkdir), patch.object(sys, 'argv', ['probe', str(cache)]), redirect_stdout(output):
            exec(compile(captured[0], '<actual-positive-control>', 'exec'), {})
        self.assertEqual(json.loads(output.getvalue()), {'sameFilesystem': True, 'writable': True})
        self.assertEqual(attempts, ['memory.max', 'memory.swap.max', 'memory.oom.group', 'cgroup.procs', 'cgroup.procs', 'cgroup.subtree_control', 'mkdir'])

    def test_supervisor_bounds_both_streams_and_joins_cancel_or_forced_terminal(self) -> None:
        for failure in ('normal', 'stdout', 'stderr', 'cancel', 'forced'):
            with self.subTest(failure=failure), ExitStack() as stack:
                guard = self.guard()
                state = {'terminal': False, 'terminated': False, 'killed': False, 'waits': 0}
                class Pipe(io.BytesIO):
                    def __init__(self, fd, data):
                        super().__init__(data)
                        self.fd = fd
                    def fileno(self): return self.fd
                class Process:
                    stdout = Pipe(81, b'x' * (1048577 if failure == 'stdout' else 3))
                    stderr = Pipe(82, b'x' * (1048577 if failure == 'stderr' else 2))
                    def poll(self): return 0 if state['terminal'] else None
                    def terminate(self): state['terminated'] = True
                    def kill(self): state['killed'] = True
                    def wait(self, timeout):
                        state['waits'] += 1
                        if failure == 'forced' and state['waits'] == 1:
                            raise subprocess.TimeoutExpired('authored', timeout)
                        state['terminal'] = True
                        return 0
                class Selector:
                    keys: dict[int, SimpleNamespace] = {}
                    def __enter__(self): return self
                    def __exit__(self, *args): return False
                    def register(self, pipe, event):
                        self.keys[pipe.fd] = SimpleNamespace(fd=pipe.fd, fileobj=pipe)
                    def unregister(self, pipe): del self.keys[pipe.fd]
                    def select(self, timeout):
                        if failure == 'cancel': raise KeyboardInterrupt('authored cancel')
                        return [(key, 1) for key in self.keys.values()]
                process = Process()
                stack.enter_context(patch.object(guard.selectors, 'DefaultSelector', Selector))
                stack.enter_context(patch.object(guard.os, 'read', side_effect=lambda fd, size: {81: process.stdout, 82: process.stderr}[fd].read(size)))
                if failure == 'normal':
                    self.assertEqual(guard.supervisor_output(process, 110), (b'xxx', b'xx'))
                else:
                    with self.assertRaises((AssertionError, KeyboardInterrupt)):
                        guard.supervisor_output(process, 110)
                self.assertTrue(state['terminal'] and process.stdout.closed and process.stderr.closed)
                if failure == 'forced': self.assertTrue(state['killed'] and state['waits'] == 2)

    def test_memory_cleanup_handles_spawn_timeout_cancel_and_oom(self) -> None:
        for failure in ('spawn', 'timeout', 'cancel', 'oom'):
            with self.subTest(failure=failure):
                try:
                    guard = self.guard()
                    config, nonce, leaf, state = self.memory_fixture(guard, failure)
                    if failure in ('spawn', 'cancel'):
                        with self.assertRaises((OSError, KeyboardInterrupt)):
                            guard.execute(config, ['/never-executed'], {}, nonce=nonce)
                    else:
                        result, _ = guard.execute(config, ['/never-executed'], {}, nonce=nonce)
                        self.assertEqual(result['late'], failure == 'timeout')
                        if failure == 'oom':
                            self.assertEqual(result['memory']['events']['oom_kill'], 1)
                            self.assertGreater(result['memory']['peak'], result['memory']['max'])
                            self.assertFalse(guard.clean(result))
                    self.assertTrue(state['killed'] and state['removed'])
                    self.assertFalse(leaf.exists())
                finally:
                    self.doCleanups()
                    if (self.root / 'cgroup').exists():
                        shutil.rmtree(self.root / 'cgroup')

    def test_owned_dependency_graph_has_real_hardlinks_and_rejects_escape(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        spec = importlib.util.spec_from_file_location('public_owned_graph_test', path)
        assert spec and spec.loader
        producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(producer)
        source, target = self.root / 'installed', self.root / 'owned'
        (source / 'pkg').mkdir(parents=True)
        original = source / 'pkg/index.js'
        original.write_bytes(b'authored module bytes')
        (source / 'alias').symlink_to('pkg', target_is_directory=True)
        links = producer.owned_graph(source, target)
        self.assertEqual((target / 'alias/index.js').read_bytes(), original.read_bytes())
        self.assertEqual((target / 'pkg/index.js').stat().st_ino, original.stat().st_ino)
        self.assertEqual(links[str(target / 'alias')], 'pkg')
        foreign = self.root / 'foreign'
        foreign.write_bytes(b'authored foreign canary')
        (source / 'outside').symlink_to(foreign)
        with self.assertRaisesRegex(AssertionError, 'escapes owned graph'):
            producer.owned_graph(source, self.root / 'rejected')
        self.assertEqual(foreign.read_bytes(), b'authored foreign canary')

    def test_capacity_below_floor_fails_before_setup(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        spec = importlib.util.spec_from_file_location('public_capacity_failure_test', path)
        assert spec and spec.loader
        producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(producer)
        disk = SimpleNamespace(free=producer.CAPACITY_FLOOR_BYTES - 1)
        with patch.object(producer, 'ROOT', self.root), patch.object(producer.shutil, 'disk_usage', return_value=disk), \
             patch.object(producer.sys, 'platform', 'linux'), patch.object(producer.os, 'getuid', return_value=1000), \
             redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(AssertionError, '30GiB'):
                producer.main(capacity_only='pre-public')
        self.assertFalse((self.root / '.public-m-setup').exists())

    def test_capacity_only_logs_and_exits_before_preparation(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        spec = importlib.util.spec_from_file_location('public_capacity_success_test', path)
        assert spec and spec.loader
        producer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(producer)
        disk = SimpleNamespace(free=producer.CAPACITY_FLOOR_BYTES)
        output = io.StringIO()
        with patch.object(producer, 'ROOT', self.root), patch.object(producer.shutil, 'disk_usage', return_value=disk), \
             patch.object(producer.sys, 'platform', 'linux'), patch.object(producer.os, 'getuid', return_value=1000), \
             patch.object(producer, 'make_checkouts') as preparation, redirect_stdout(output):
            producer.main(capacity_only='pre-public')
        observed = json.loads(output.getvalue())
        self.assertEqual(observed['stage'], 'pre-public')
        self.assertEqual(observed['root'], str(self.root))
        self.assertEqual(observed['device'], self.root.stat().st_dev)
        self.assertEqual(observed['freeBytes'], producer.CAPACITY_FLOOR_BYTES)
        self.assertEqual(observed['floorBytes'], producer.CAPACITY_FLOOR_BYTES)
        preparation.assert_not_called()
        self.assertFalse((self.root / '.public-m-setup').exists())

    def test_capacity_and_collect_flags_are_incompatible(self) -> None:
        path = Path(__file__).resolve().parents[4] / 'scripts/perf/public-m-prepare.py'
        result = __import__('subprocess').run(
            [sys.executable, str(path), '--collect-m', '--capacity-only'], text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn('not allowed with argument', result.stderr)


if __name__ == '__main__':
    unittest.main()
