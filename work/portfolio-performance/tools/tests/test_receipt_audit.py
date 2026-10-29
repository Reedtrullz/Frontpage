"""Authored foreign-host wire fixtures test the auditor, never product execution."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
from typing import TypedDict

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from protocol import Case, ROOT, RUN_TMP, Rejected, digest, file_hash, save, slot
from receipt_audit import ReceiptArchive
from selftest_case import definition


class Reference(TypedDict):
    path: str
    sha256: str


class ReceiptTests(unittest.TestCase):
    def setUp(self) -> None:
        RUN_TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='u03-receipt-fixture-', dir=RUN_TMP)
        self.root = Path(self.temp.name)
        variables = {'HOME': str(self.root / 'home'), 'TMPDIR': str(self.root / 'tmp'),
                     'NODE_COMPILE_CACHE': str(self.root / 'node'), 'BUN_RUNTIME_TRANSPILER_CACHE_PATH': str(self.root / 'bun'),
                     'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1', 'PATH': '/usr/bin:/bin'}
        for key in ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH'):
            Path(variables[key]).mkdir()
        self.env = patch.dict(os.environ, variables, clear=True)
        self.env.start()
        data = definition()
        data['runtime'] = {'python': 'authored foreign-host fixture', 'machine': 'fixture', 'platform': 'fixture-linux'}
        argv = data['commands']['happy']
        data['commands'] = {'happy': argv, 'failure': argv}
        self.case_path = self.root / 'foreign-case.json'
        save(self.case_path, data)
        case_hash = digest(data)
        self.refs = []

        def reference(path: Path) -> Reference:
            ref: Reference = {'path': str(path.relative_to(ROOT)), 'sha256': file_hash(path)}
            self.refs.append(ref)
            return ref

        attestation_path = self.root / 'attestation.json'
        hashes = {**data['harness'], **data['fixtures'], **data['executables'],
                  **data['baseline']['sources'], **data['candidate']['sources']}
        artifacts = {}
        archived_sources = self.root / 'archived-sources'
        archived_sources.mkdir()
        for index, source in enumerate(hashes):
            destination = archived_sources / str(index)
            shutil.copyfile(source, destination)
            artifacts[source] = reference(destination)
        save(attestation_path, {'caseHash': case_hash, 'runtime': data['runtime'],
             **{k: data[k] for k in ('harness', 'fixtures', 'executables')},
             'sources': {p: data[p] for p in ('baseline', 'candidate')}, 'artifacts': artifacts})
        guards = self.root / 'guards.json'
        save(guards, {'caseHash': case_hash, 'passed': True, 'scope': 'AUTHORED_VALIDATOR_FIXTURE_ONLY'})
        native = self.root / 'native.json'
        save(native, {'fixtureOnly': True, 'accepted': False, 'scope': 'NO_NATIVE_ADMISSION_CLAIM'})
        self.entry = {'case': reference(self.case_path), 'attestation': reference(attestation_path),
                      'guards': reference(guards), 'native': reference(native), 'scenarios': {}}
        for scenario in data['commands']:
            directory = self.root / scenario
            units = []
            for index in range(20):
                state = slot(data, index)
                phase = state['phase']
                request = {**state, 'scenario': scenario, 'caseHash': case_hash,
                    'revision': data[phase]['revision'], 'fixtureDigest': digest(data['fixtures']),
                    'harnessDigest': digest(data['harness']), 'shape': data['shape'], 'economicsDigest': data['economicsDigest']}
                count = 60 if phase == 'baseline' else 30
                output = {**request, 'status': 'complete', 'semanticDigest': data['semanticDigest'],
                    'capabilities': data['capabilities'], 'metrics': {
                    'iterations': {'scope': 'invocation', 'unit': 'count', 'values': [count]},
                    'outputs': {'scope': 'invocation', 'unit': 'count', 'values': [1]}}}
                path = directory / f'{index:03d}.json'
                save(path, {'definition': data, 'state': state, 'request': request, 'caseHash': case_hash,
                    'status': 'PASS', 'returncode': 0, 'reaped': True, 'scratchCleaned': True,
                    'parentScratchCleaned': True, 'combinedScratchPeakBytes': 1024,
                    'startedNs': index * 2000 + 1, 'endedNs': index * 2000 + 100,
                    'argv': data['commands'][scenario][phase], 'cwd': data[phase]['cwd'],
                    'stdout': json.dumps(output), 'native': output, 'metrics': {'iterations': count, 'outputs': 1}})
                units.append(reference(path))
            self.entry['scenarios'][scenario] = {'directory': str(directory.relative_to(ROOT)),
                                               'units': units, 'outcome': 'VERIFIED_GAIN'}
        self.index_path = self.root / 'index.json'
        self.pointer = self.root / 'fixture-caller-trust.json'
        self.checkpoint = self.root / 'fixture-checkpoint.json'
        self.freeze_fixture()

    def tearDown(self) -> None:
        self.env.stop()
        self.temp.cleanup()

    def freeze_fixture(self) -> None:
        # The caller supplies this test trust root; the production CLI has no override.
        for ref in self.refs:
            ref['sha256'] = file_hash(ROOT / ref['path'])
        save(self.checkpoint, {'input_bindings': [{'path': str(ROOT / r['path']), 'sha256': r['sha256']} for r in self.refs]})
        save(self.pointer, {'snapshot_path': str(self.checkpoint), 'snapshot_sha256': file_hash(self.checkpoint)})
        save(self.index_path, {'schema': 'measurement-receipt-index/v1', 'checkpointSha256': file_hash(self.checkpoint),
                              'cases': [self.entry], 'blockedClaims': []})

    def archive(self) -> ReceiptArchive:
        return ReceiptArchive.read(self.index_path, self.pointer)

    def authored_native_wire(self) -> ReceiptArchive:
        """A serialized admission fixture, never a production CLI trust root."""
        data = json.loads(self.case_path.read_text())
        data['selftestOnly'] = False
        save(self.case_path, data)
        case_hash = digest(data)
        attestation = self.root / 'attestation.json'
        witness = json.loads(attestation.read_text())
        witness['caseHash'] = case_hash
        save(attestation, witness)
        save(self.root / 'guards.json', {'caseHash': case_hash, 'passed': True,
             'qaPassed': True, 'scope': 'native-process', 'authoredFixture': True})
        for scenario in data['commands']:
            for path in (self.root / scenario).glob('*.json'):
                unit = json.loads(path.read_text())
                unit.update(definition=data, caseHash=case_hash)
                unit['request']['caseHash'] = case_hash
                unit['native']['caseHash'] = case_hash
                unit['stdout'] = json.dumps(unit['native'])
                save(path, unit)

        def reference(path: Path) -> Reference:
            ref: Reference = {'path': str(path.relative_to(ROOT)), 'sha256': file_hash(path)}
            self.refs.append(ref)
            return ref

        check = self.root / 'authored-check.json'
        save(check, {'status': 'PASS', 'authoredFixture': True})
        check_ref = reference(check)
        native = {'accepted': True, 'interrupted': False, 'finalObserved': True,
                  'taskId': 'authored-task', 'agentId': 'authored-agent',
                  'sourceFingerprint': 'authored-fingerprint', 'checks': [
                      {'artifact': check_ref['path'], 'sha256': check_ref['sha256'], 'exitCode': 0}]}
        save(self.root / 'native.json', native)
        run = self.root / 'authored-run.json'
        self.entry['case']['originalPath'] = str(self.case_path)
        save(run, {'tasks': [{'id': native['taskId'], 'status': 'complete',
             'agentId': native['agentId'], 'sourceFingerprint': native['sourceFingerprint'],
             'receipt': native, 'inputs': [str(self.case_path)]}]})
        self.entry['run'] = reference(run)
        self.freeze_fixture()
        archive = self.archive()
        return ReceiptArchive(archive.bindings, archive.entries, (), False)

    def test_native_wire_without_original_claim_cannot_admit_unrelated_units(self) -> None:
        # A copied accepted wire envelope cannot supply missing original unit provenance.
        archive = self.authored_native_wire()
        with self.assertRaisesRegex(Rejected, 'original claim'):
            archive.all()

    def test_source_bytes_when_attestation_only_copies_expected_hashes(self) -> None:
        # Valid transport hashes cannot turn different archived source bytes into the frozen source.
        path = self.root / 'attestation.json'
        witness = json.loads(path.read_text())
        ref = next(iter(witness['artifacts'].values()))
        artifact = ROOT / ref['path']
        artifact.write_bytes(b'authored different source')
        ref['sha256'] = file_hash(artifact)
        save(path, witness)
        self.freeze_fixture()
        with self.assertRaisesRegex(Rejected, 'source artifact hash'):
            self.archive().all()

    def test_source_coverage_when_a_required_archived_file_is_missing(self) -> None:
        path = self.root / 'attestation.json'
        witness = json.loads(path.read_text())
        witness['artifacts'].pop(next(iter(witness['artifacts'])))
        save(path, witness)
        self.freeze_fixture()
        with self.assertRaisesRegex(Rejected, 'source artifact coverage'):
            self.archive().all()

    def test_foreign_receipt_when_strict_live_admission_rejects_it(self) -> None:
        # Given an explicitly synthetic foreign definition, when audited, no live admission occurs.
        with self.assertRaisesRegex(Rejected, 'runtime/platform mismatch'):
            Case.read(self.case_path)
        result = self.archive().all()[0]
        self.assertTrue(result['selftestOnly'])
        self.assertEqual(len(result['scenarios']), 2)
        with self.assertRaisesRegex(Rejected, 'not product gain'):
            self.archive().report_gain({'case': str(self.case_path), 'units': str(self.root / 'happy')})

    def test_legacy_foreign_case_rejects_before_reading_new_live_resource_fields(self) -> None:
        data = json.loads(self.case_path.read_text())
        data.pop('parentEnvironment')
        save(self.case_path, data)
        with self.assertRaisesRegex(Rejected, 'runtime/platform mismatch'):
            Case.read(self.case_path)

    def test_raw_hash_when_a_retained_unit_changes(self) -> None:
        # Given the frozen graph, when a raw byte changes, reject before arithmetic.
        path = self.root / 'happy/010.json'
        path.write_bytes(path.read_bytes() + b' ')
        with self.assertRaisesRegex(Rejected, 'raw hash'):
            self.archive().all()

    def test_coverage_when_a_native_unit_is_omitted(self) -> None:
        # Given complete ordered references, when one file is missing, reject.
        (self.root / 'failure/019.json').unlink()
        with self.assertRaises(Rejected):
            self.archive().all()

    def test_source_attestation_when_hashes_match_but_source_differs(self) -> None:
        # Given valid transport hashes, when the source witness disagrees, reject semantically.
        path = self.root / 'attestation.json'
        data = json.loads(path.read_text())
        data['sources']['baseline']['revision'] = 'different-source'
        save(path, data)
        self.freeze_fixture()
        with self.assertRaisesRegex(Rejected, 'wrong source attestation'):
            self.archive().all()

    def test_gain_aggregate_when_units_show_no_improvement(self) -> None:
        # Given unchanged fixture output, when every candidate costs as much, reject the gain.
        for path in (self.root / 'happy').glob('*.json'):
            unit = json.loads(path.read_text())
            if unit['state']['phase'] == 'candidate':
                unit['native']['metrics']['iterations']['values'] = [60]
                unit['stdout'] = json.dumps(unit['native'])
                unit['metrics']['iterations'] = 60
                save(path, unit)
        self.freeze_fixture()
        with self.assertRaisesRegex(Rejected, 'false archived gain'):
            self.archive().all()

    def test_runtime_when_transport_is_valid_but_host_binding_differs(self) -> None:
        # Given valid transport hashes, when the host witness differs, reject.
        path = self.root / 'attestation.json'
        data = json.loads(path.read_text())
        data['runtime'] = {'platform': 'different-host'}
        save(path, data)
        self.freeze_fixture()
        with self.assertRaisesRegex(Rejected, 'misbound archived runtime'):
            self.archive().all()

    def test_production_trust_when_index_declares_its_own_checkpoint(self) -> None:
        # Given an index naming this fixture's checkpoint, the real CLI trust root rejects it.
        with self.assertRaises(Rejected):
            ReceiptArchive.read(self.index_path)

    def test_external_path_when_untrusted_index_points_outside_workspace(self) -> None:
        # Given an authored path outside this workspace, reject without reading its bytes.
        self.entry['case']['path'] = '/authored-outside-workspace/case.json'
        save(self.index_path, {'schema': 'measurement-receipt-index/v1', 'checkpointSha256': file_hash(self.checkpoint),
                              'cases': [self.entry], 'blockedClaims': []})
        with self.assertRaisesRegex(Rejected, 'external archive path'):
            self.archive().all()


if __name__ == '__main__':
    unittest.main()
