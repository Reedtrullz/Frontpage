"""Stdlib tests. Run: python3 -m unittest discover -s work/portfolio-performance/tools/tests -v."""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from decisions import decide, summary, timing
from native import normalize, scratch_size
from protocol import Case, EVIDENCE, RUN_TMP, Record, Rejected, digest, load, save, slot
from selftest_case import definition


class AdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        RUN_TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='qa-', dir=RUN_TMP)
        self.root = Path(self.temp.name)
        values = {'TMPDIR': str(self.root / 'tmp'), 'NODE_COMPILE_CACHE': str(self.root / 'node'),
                  'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(self.root / 'bun'), 'HOME': str(self.root / 'home'),
                  'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1', 'PATH': '/usr/bin:/bin'}
        for key in ('TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH', 'HOME'):
            Path(values[key]).mkdir()
        self.env = patch.dict(os.environ, values, clear=True)
        self.env.start()
        self.case = definition()
        self.path = self.root / 'case.json'
        save(self.path, self.case)

    def tearDown(self) -> None:
        self.env.stop()
        self.temp.cleanup()

    def cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run([sys.executable, str(TOOLS / args[0]), *args[1:]],
                              capture_output=True, text=True, timeout=10,
                              env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})

    def measure(self, scenario: str = 'happy', sample: int = 0) -> subprocess.CompletedProcess[str]:
        return self.cli('measure.py', '--case', str(self.path), '--phase', slot(self.case, sample)['phase'],
                        '--scenario', scenario, '--sample', str(sample), '--output', str(self.root))

    def test_native_counter_when_cli_collects_full_alternating_schedule(self) -> None:
        # Given a literal native workload and locked five-pair experiment.
        # When every independent unit is collected through the executable CLI.
        for i in range(20):
            result = self.measure(sample=i)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        # Then direct compare over this retained layout proves actual work reduction.
        from compare import compare_case
        comparison = compare_case(Case.read(self.path), self.root / self.case['id'] / 'happy')
        self.assertEqual(comparison['outcome'], 'VERIFIED_GAIN')
        self.assertEqual(comparison['metrics']['iterations']['baseline']['median'], 60)
        self.assertEqual(comparison['metrics']['iterations']['candidate']['median'], 30)

    def test_stdlib_probe_uses_actual_isolated_no_site_no_bytecode_flags(self) -> None:
        result = self.measure()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = load(self.root / self.case['id'] / 'happy/000.json')
        self.assertEqual(receipt['native'].get('interpreter'), {
            'isolated': 1, 'noSite': 1, 'noBytecode': 1,
        })
        self.assertEqual(self.case['timeout'], .3)

    def test_native_faults_when_real_subprocess_emits_adverse_results(self) -> None:
        for scenario in ('timeout', 'nonzero', 'empty', 'malicious', 'output', 'scratch', 'partial',
                         'missing', 'nan', 'revision', 'fixture', 'economics', 'repeated'):
            with self.subTest(scenario=scenario):
                # Given the actual native fault producer; when invoked by the CLI.
                result = self.measure(scenario)
                # Then failure is retained and every process/scratch resource is closed.
                self.assertEqual(result.returncode, 2, result.stdout)
                receipt = load(self.root / self.case['id'] / scenario / '000.json')
                self.assertEqual(receipt['status'], 'ERROR')
                self.assertTrue(receipt['reaped'] and receipt['scratchCleaned'])
                self.assertNotIn('metrics', receipt)
                self.assertLessEqual(len(receipt['stdout'].encode()) + len(receipt['stderr'].encode()), 16384)

    def test_boundary_when_case_has_invalid_dispatch_or_binding(self) -> None:
        mutations = [lambda c: c.update(identities=['excluded/repo']),
                     lambda c: c.update(scratchRoot='/tmp/foreign'),
                     lambda c: c['commands']['happy'].update(baseline=['/bin/sh', '-c', 'false']),
                     lambda c: c['baseline'].update(revision='swapped'),
                     lambda c: c.update(runtime={'platform': 'wrong'}),
                     lambda c: c.update(pairs=6),
                     lambda c: c['metrics']['iterations'].update(repetitions=3),
                     lambda c: c.update(identities=['NAV Innsyn']),
                     lambda c: c.update(timeout=float('inf'))]
        for change in mutations:
            with self.subTest(change=change):
                # Given changed untrusted case; when the actual CLI reads it.
                altered = copy.deepcopy(self.case)
                change(altered)
                self.path.write_text(json.dumps(altered))
                result = self.measure()
                # Then dispatch is rejected before any native unit exists.
                self.assertEqual(result.returncode, 2)
                self.assertFalse((self.root / self.case['id']).exists())

    def test_order_when_candidate_or_missing_pair_is_requested_early(self) -> None:
        # Given no collection; when candidate or a later unit is requested.
        for phase, index in [('candidate', 0), ('baseline', 2)]:
            result = self.cli('measure.py', '--case', str(self.path), '--phase', phase,
                              '--sample', str(index), '--output', str(self.root))
            # Then the CLI fails closed.
            self.assertEqual(result.returncode, 2)

    def test_timeout_admission_when_case_declares_finite_process_allowance(self) -> None:
        # Given frozen per-case process bounds, including launch/teardown allowance.
        for timeout in (.1, 60, 120):
            with self.subTest(timeout=timeout):
                self.case['timeout'] = timeout
                save(self.path, self.case)
                # When admitted; then the declared bound is retained exactly.
                self.assertEqual(Case.read(self.path).data['timeout'], timeout)
        for timeout in (120.000001, 121, 0, -1, float('nan'), float('inf'), -float('inf')):
            with self.subTest(timeout=timeout):
                self.case['timeout'] = timeout
                self.path.write_text(json.dumps(self.case))
                # When a nonpositive, nonfinite or excessive bound is read, reject.
                with self.assertRaisesRegex(Rejected, 'bound|non-finite'):
                    Case.read(self.path)

    def test_timeout_cleanup_when_short_native_deadline_expires(self) -> None:
        # Given a native fixture that deliberately sleeps beyond its short bound.
        self.case['timeout'] = .1
        self.case['scratchRoot'] = str(self.root / 'native')
        save(self.path, self.case)
        # When the actual measurement CLI reaches the frozen deadline.
        result = self.measure('timeout')
        receipt = load(self.root / self.case['id'] / 'timeout/000.json')
        # Then it fails with no metrics, reaps the process and removes scratch.
        self.assertEqual(result.returncode, 2)
        self.assertEqual(receipt['error'], 'timeout')
        self.assertTrue(receipt['reaped'] and receipt['scratchCleaned'])
        self.assertNotIn('metrics', receipt)
        self.assertFalse(Path(receipt['scratch']).exists())
        with self.assertRaises(ProcessLookupError):
            os.kill(receipt['pid'], 0)

    def test_scratch_accounting_when_links_could_escape_loop_or_double_count(self) -> None:
        # Given three actual bytes plus distinct risky symlink target classes.
        root = self.root / 'scratch'
        root.mkdir()
        (root / 'data').write_bytes(b'abc')
        self.assertEqual(scratch_size(root), 3)
        for target in ('data', '.', '..', 'absent', '/absent-external', 'link', str(self.root)):
            with self.subTest(target=target):
                link = root / 'link'
                link.symlink_to(target)
                try:
                    # When accounting, reject without following or double counting.
                    with self.assertRaisesRegex(Rejected, 'scratch symlink'):
                        scratch_size(root)
                finally:
                    link.unlink()

    def test_grouping_when_units_or_nested_shape_are_wrong(self) -> None:
        # Given independently declared nested timing plus once-per-invocation bytes.
        case = {'metrics': {'latency': {'scope': 'nested', 'unit': 'ms', 'repetitions': 3, 'aggregate': 'median'},
                            'rss': {'scope': 'invocation', 'unit': 'bytes', 'repetitions': 1, 'aggregate': 'max'}}}
        native: Record = {'metrics': {'latency': {'scope': 'nested', 'unit': 'us', 'values': [1000, 2000, 9000]},
                              'rss': {'scope': 'invocation', 'unit': 'KiB', 'values': [2]}}}
        # When normalized, repetitions remain one independent unit.
        result = normalize(case, native)
        # Then platform-independent units and nested median are exact.
        self.assertEqual(result, {'latency': .002, 'rss': 2048})
        for name, values in [('latency', [1]), ('rss', [2, 2, 2]), ('latency', [float('nan')] * 3)]:
            changed = copy.deepcopy(native)
            changed['metrics'][name]['values'] = values
            with self.assertRaises(Rejected):
                normalize(case, changed)

    def test_timing_when_noise_or_zero_prevents_proven_gain(self) -> None:
        # Given real paired vectors; when local inference is evaluated.
        self.assertTrue(timing([100.] * 10, [80.] * 10, .01, 'lower')['proven'])
        self.assertFalse(timing([100.] * 10, [97.] * 10, .01, 'lower')['proven'])
        self.assertFalse(timing([100.] * 10, [80.] * 10, .15, 'lower')['proven'])
        self.assertFalse(timing([100.] * 10, [80., 80., 80., 80., 120.] * 2, .01, 'lower')['proven'])
        for value in (0., -1., float('nan'), float('inf')):
            with self.assertRaises(Rejected):
                timing([value] * 5, [1.] * 5, .01, 'lower')
        # Then descriptive percentiles appear only at the declared minimum count.
        self.assertNotIn('descriptiveP95', summary([1.] * 19))
        self.assertIn('descriptiveP95', summary([1.] * 20))

    def test_secondary_when_exact_counter_increases_or_zero_baseline(self) -> None:
        # Given a deterministic primary improvement with a secondary increase.
        case = copy.deepcopy(self.case)
        units = []
        for i in range(20):
            state = slot(case, i)
            units.append({'state': state, 'metrics': {'iterations': 10 if state['phase'] == 'baseline' else 5,
                                                      'outputs': 0 if state['phase'] == 'baseline' else 1}})
        # When aggregated; then one extra secondary unit defeats the gain.
        result = decide(case, units)
        self.assertEqual(result['status'], 'NO_PROVEN_GAIN')
        self.assertIsNone(result['metrics']['outputs']['relativeSaving'])
        self.assertEqual(result['secondaryRegressions'], ['outputs'])

    def test_secondary_timing_when_regression_exceeds_pilot_tolerance(self) -> None:
        # Given a faster deterministic primary and a 30 percent slower secondary.
        case = copy.deepcopy(self.case)
        case['metrics']['latency'] = {'kind': 'timing', 'direction': 'lower'}
        units = [{'state': slot(case, i), 'metrics': {'iterations': 10 if slot(case, i)['phase'] == 'baseline' else 5,
                  'outputs': 1, 'latency': 100 if slot(case, i)['phase'] == 'baseline' else 130}} for i in range(20)]
        # When actual paired/pilot arithmetic is evaluated.
        result = decide(case, units)
        # Then the secondary blocks the otherwise qualifying primary gain.
        self.assertEqual(result['status'], 'NO_PROVEN_GAIN')
        self.assertIn('latency', result['secondaryRegressions'])


if __name__ == '__main__':
    unittest.main()
