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
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_resources import ResourceTests
from protocol import Rejected
from resource_limits import FRONTPAGE_APPROVAL, FRONTPAGE_APPROVAL_SHA, ResourceBudget

NODE = os.environ.get('NODE') or shutil.which('node')


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
        result = {'returncode': 0, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True}
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
        result = {'returncode': 1, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True}
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
        result = {'returncode': 1, 'overflow': False, 'late': False, 'survivors': [], 'scratchRemoved': True}
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
