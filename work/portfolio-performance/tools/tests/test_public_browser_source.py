"""Public browser envelope fails closed before a workload can start."""
import copy
import sys
import unittest
import importlib.util
import json
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_resources import ResourceTests
from protocol import Rejected
from resource_limits import FRONTPAGE_APPROVAL, FRONTPAGE_APPROVAL_SHA, ResourceBudget


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
        config = {'manifest': str(manifest), 'clock': str(clock), 'immutableInputs': str(inputs),
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
        config = {'immutableInputs': str(inputs), 'node': '/node', 'manifest': '/fixture-manifest',
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


if __name__ == '__main__':
    unittest.main()
