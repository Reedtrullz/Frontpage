"""Behavioral regression checks for approved resource envelopes."""
from __future__ import annotations

import copy
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from native import invoke
from protocol import Case, ROOT, RUN_TMP, Rejected, digest, save, slot
from selftest_case import definition


class ResourceTests(unittest.TestCase):
    def setUp(self) -> None:
        RUN_TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='u03-resources-', dir=RUN_TMP)
        self.root = Path(self.temp.name)
        values = {'TMPDIR': str(self.root / 'tmp'), 'NODE_COMPILE_CACHE': str(self.root / 'node'),
                  'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(self.root / 'bun'), 'HOME': str(self.root / 'home'),
                  'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1', 'PATH': '/usr/bin:/bin'}
        for key in ('TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH', 'HOME'):
            Path(values[key]).mkdir()
        self.env = patch.dict(os.environ, values, clear=True)
        self.env.start()
        self.case = definition()
        self.case.update(parentEnvironment={'root': str(self.root), **values},
                         scratchRoot=str(self.root / 'native'), artifactRoot=str(self.root / 'artifacts'))
        self.path = self.root / 'case.json'

    def tearDown(self) -> None:
        self.env.stop()
        self.temp.cleanup()

    def admitted(self) -> Case:
        save(self.path, self.case)
        return Case.read(self.path)

    def browser(self) -> None:
        self.case.update(resourceProfile='browser-64m-20261028', modality='browser', scratchBytes=64 * 1024 * 1024,
                         browserProfileApproval={'path': str(ROOT / '.omo/operations/portfolio-unblocking-execute-20261028/metis-closure-plan.md'),
                         'sha256': '781cd061013ec6227385fb3b8b6a29766df50747a867e537c41ab6f9480472c3'})

    def test_admission_when_browser_uses_approved_envelope(self) -> None:
        # Given the actual frozen browser allowance, when parsed, preserve64MiB.
        self.browser()
        self.assertEqual(self.admitted().data['scratchBytes'], 64 * 1024 * 1024)

    def test_rejection_when_envelope_or_approval_is_changed(self) -> None:
        # Given the same case, when one trust boundary changes, reject before launch.
        self.browser()
        original = copy.deepcopy(self.case)
        for change in (lambda c: c.update(scratchBytes=65 * 1024 * 1024),
                       lambda c: c.update(modality='cli'),
                       lambda c: c.pop('resourceProfile'),
                       lambda c: c.update(outputBytes=1048577),
                       lambda c: c['browserProfileApproval'].update(sha256='0' * 64),
                       lambda c: c.update(resourceProfile='unapproved')):
            with self.subTest(change=change):
                self.case = copy.deepcopy(original)
                change(self.case)
                with self.assertRaises(Rejected):
                    self.admitted()

    def test_rejection_when_adapter_environment_is_missing(self) -> None:
        # Given a frozen environment, when its real cache variable disappears, reject.
        save(self.path, self.case)
        with patch.dict(os.environ):
            del os.environ['NODE_COMPILE_CACHE']
            with self.assertRaises(Rejected):
                Case.read(self.path)

    def test_invocation_when_parent_cache_exceeds_case_bound(self) -> None:
        # Given an admitted native source, when parent cache grows, no child may pass.
        self.case['scratchBytes'] = 16384
        case = self.admitted()
        (self.root / 'node' / 'large').write_bytes(b'x' * 20000)
        request = {**slot(self.case, 0), 'scenario': 'happy', 'caseHash': case.sha256,
                   'revision': self.case['baseline']['revision'], 'fixtureDigest': digest(self.case['fixtures']),
                   'harnessDigest': digest(self.case['harness']), 'shape': self.case['shape'],
                   'economicsDigest': self.case['economicsDigest']}
        result = invoke(case, request)
        self.assertEqual(result['status'], 'ERROR')
        self.assertNotIn('pid', result)

    def test_group_signal_failure_records_error_and_still_cleans_owned_scratch(self) -> None:
        case = self.admitted()
        request = {**slot(self.case, 0), 'scenario': 'happy', 'caseHash': case.sha256,
                   'revision': self.case['baseline']['revision'], 'fixtureDigest': digest(self.case['fixtures']),
                   'harnessDigest': digest(self.case['harness']), 'shape': self.case['shape'],
                   'economicsDigest': self.case['economicsDigest']}
        with patch('native.os.killpg', side_effect=PermissionError('authored EPERM')):
            result = invoke(case, request)
        self.assertEqual(result['status'], 'ERROR')
        self.assertIn('authored EPERM', result['cleanupError'])
        self.assertNotIn('metrics', result)
        self.assertTrue(result['reaped'] and result['scratchCleaned'])
        self.assertFalse(Path(result['scratch']).exists())

    def test_native_writer_when_approved_envelope_exceeds_default(self) -> None:
        # Given the approved resource profile, when a real subprocess writes20MiB, account it.
        self.browser()
        case = self.admitted()
        request = {**slot(self.case, 0), 'scenario': 'scratch', 'caseHash': case.sha256,
                   'revision': self.case['baseline']['revision'], 'fixtureDigest': digest(self.case['fixtures']),
                   'harnessDigest': digest(self.case['harness']), 'shape': self.case['shape'],
                   'economicsDigest': self.case['economicsDigest']}
        result = invoke(case, request)
        self.assertEqual(result['status'], 'PASS', result.get('error'))
        self.assertGreater(result['combinedScratchPeakBytes'], 16 * 1024 * 1024)
        self.assertTrue(result['scratchCleaned'] and result['parentScratchCleaned'])

    def test_rejection_when_cache_symlink_points_outside_owner(self) -> None:
        # Given an authored foreign directory, when cache points there, reject before launch.
        with tempfile.TemporaryDirectory(prefix='u03-foreign-', dir=RUN_TMP) as foreign:
            cache = self.root / 'node'
            cache.rmdir()
            cache.symlink_to(foreign, target_is_directory=True)
            with self.assertRaisesRegex(Rejected, 'symlink'):
                self.admitted()

    def test_rejection_when_parent_inherits_undeclared_secret(self) -> None:
        # Given a sanitized recorded map, when an extra credential-like key exists, reject.
        with patch.dict(os.environ, {'AUTHORED_CANARY_TOKEN': 'fixture-not-secret'}):
            with self.assertRaisesRegex(Rejected, 'undeclared environment'):
                self.admitted()


if __name__ == '__main__':
    unittest.main()
