"""Optional PID namespace admission and real cached-image lifecycle checks."""
from __future__ import annotations

import sys
import copy
import json
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import synthetic_inputs  # noqa: F401  (synthetic scope only when the private one is absent)
from resource_limits import ResourceBudget
from protocol import Rejected
from protocol import Case, EVIDENCE, Record, WORK, digest, file_hash, save, slot
from native import invoke
import test_adapter
from container_resources import IMAGE, MIB, SOCKET
from container_resources import ContainerJob
from unittest.mock import patch


class ReservationTests(unittest.TestCase):
    def test_unacknowledged_create_cannot_claim_cleanup_from_empty_listing(self) -> None:
        # A timed-out daemon request can finish after the client's empty listing.
        job = object.__new__(ContainerJob)
        job.attempted = True
        job.create_acknowledged = False
        job.name = 'authored-no-daemon-call'
        job.identity = {'cleaned': False}
        with patch.object(ContainerJob, 'control', return_value=''):
            with self.assertRaisesRegex(Rejected, 'cleanup remains unresolved'):
                job.close()
        self.assertFalse(job.identity['cleaned'])

    def test_namespace_capacity_is_reserved_in_combined_budget(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as name:
            root = Path(name).resolve()
            (root / 'host').write_bytes(b'abcd')
            budget = ResourceBudget(10, root, root / 'native', root, ())
            self.assertEqual(budget.enforce(6), 10)
            with self.assertRaisesRegex(Rejected, 'combined scratch'):
                budget.enforce(7)


@unittest.skipUnless(sys.platform == 'darwin' and Path(SOCKET).exists() and Path('/opt/homebrew/bin/docker').exists(),
                     'legacy node22-pidns-v1 real-image proof runs only on the supported Mac Colima host')
class ContainerTests(unittest.TestCase):
    root: Path
    path: Path
    case: Record
    setUp = test_adapter.AdapterTests.setUp
    tearDown = test_adapter.AdapterTests.tearDown

    def prepare(self) -> None:
        docker = str(Path('/opt/homebrew/bin/docker').resolve())
        fixture = WORK / 'tools/fixtures/container_selftest.mjs'
        numbers = WORK / 'tools/fixtures/numbers.txt'
        self.private = self.root / 'authored-private-control'
        self.private.write_text('must not be visible in container')
        sources = {str(fixture): file_hash(fixture)}
        argv = [docker, '/work/container_selftest.mjs', str(self.private)]
        self.case.update(id='adapter-container-selftest-u03', timeout=15, harness=sources,
                         commands={s:{p:argv for p in ('baseline','candidate')}
                                   for s in ('happy','detached','timeout','scratch')},
                         allowlist=[argv], container={'profile':'node22-pidns-v1','image':IMAGE,
                         'docker':docker,'scratchBytes':8*MIB,
                         'mounts':{str(fixture):'/work/container_selftest.mjs',str(numbers):'/work/numbers.txt'}})
        self.case['executables'][docker] = file_hash(Path(docker))
        for phase in ('baseline','candidate'):
            self.case[phase].update(sources=sources,revision=digest(sources))
        save(self.path,self.case)

    def test_admission_rejects_unbound_mount_image_entry_and_capacity(self) -> None:
        self.prepare()
        Case.read(self.path)
        for change in (
            lambda c:c['container']['mounts'].update({str(self.private):'/work/private'}),
            lambda c:c['container'].update(image='node:latest'),
            lambda c:c['container'].update(scratchBytes=16*MIB),
            lambda c:c['container'].update(profile='unknown'),
            lambda c:c['container']['mounts'].update({next(iter(c['harness'])):'/work/../private'}),
            lambda c:c.update(timeout=12)):
            altered=copy.deepcopy(self.case);change(altered);save(self.path,altered)
            with self.assertRaises(Rejected): Case.read(self.path)

    def test_actual_cached_image_guards_children_elapsed_timeout_and_scratch(self) -> None:
        self.prepare()
        case = Case.read(self.path)
        receipts = []
        evidence = EVIDENCE / 't05' / f'container-canaries-{self.root.name}.json'
        self.assertFalse(evidence.exists())
        for scenario in ('happy','detached','timeout','scratch'):
            state=slot(self.case,0)
            request={**state,'scenario':scenario,'caseHash':case.sha256,
                     'revision':self.case['baseline']['revision'],
                     'fixtureDigest':digest(self.case['fixtures']), 'harnessDigest':digest(self.case['harness']),
                     'shape':self.case['shape'],'economicsDigest':self.case['economicsDigest']}
            start=time.monotonic()
            receipt=invoke(case,request)
            receipt['elapsedSeconds']=time.monotonic()-start
            receipts.append({'scenario':scenario,**receipt})
            # Retain every actual attempt outside the scratch that tearDown removes.
            payload = {'definition': self.case, 'receipts': receipts}
            self.assertLessEqual(len((json.dumps(payload, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()), 1048576)
            save(evidence, payload)
            self.assertTrue(receipt['container']['cleaned'],json.dumps(receipt))
            self.assertEqual(receipt['container']['terminalState']['Pid'],0)
            self.assertFalse(receipt['container']['terminalState']['Running'])
            self.assertTrue(receipt['reaped'] and receipt['scratchCleaned'])
            self.assertLessEqual(receipt['combinedScratchUpperBoundBytes'],16*MIB)
            if scenario in ('happy','detached'):
                self.assertEqual(receipt['status'],'PASS',json.dumps(receipt))
                self.assertEqual(receipt['metrics']['iterations'],60)
            else:
                self.assertEqual(receipt['status'],'ERROR')
                self.assertNotIn('metrics',receipt)
                self.assertIn('nonzero native result',receipt.get('error',''))
            if scenario in ('detached','timeout'):
                self.assertGreater(json.loads(receipt['stderr'].splitlines()[0])['child']['pid'],1)
            if scenario=='timeout':
                self.assertGreaterEqual(receipt['elapsedSeconds'],3)
            if scenario=='scratch': self.assertIn('ENOSPC',receipt['stderr'])


if __name__ == '__main__':
    unittest.main()
