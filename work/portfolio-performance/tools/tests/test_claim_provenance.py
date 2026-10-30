"""Authored hash-chain fixtures test provenance, never native execution or product gains."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import synthetic_inputs  # noqa: F401  (synthetic scope only when the private one is absent)
from protocol import RUN_TMP, Rejected, digest, file_hash, save
from receipt_audit import ReceiptArchive


class ClaimProvenanceTests(unittest.TestCase):
    def setUp(self) -> None:
        RUN_TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='authored-claim-', dir=RUN_TMP)
        self.root = Path(self.temp.name)
        self.unit = self.root / 'unit.json'
        self.guard = self.root / 'guard.json'
        self.claim_path = self.root / 'claim.json'
        save(self.unit, {'authored': 'unit wire fixture, not an observation'})
        save(self.guard, {'authored': 'guard wire fixture, not an executed canary'})
        self.workflow_path = str(self.root / 'original-run.json')
        self.claim = {'taskId': 'authored-task', 'OMO_TASK': 'authored-task',
                      'OMO_RUN': self.workflow_path, 'identity': 'authored-identity',
                      'evidence': {str(p): file_hash(p) for p in (self.unit, self.guard)}}
        self.entry = {'run': {'path': self.workflow_path}, 'scenarios': {'happy': {'units': [
            {'path': str(self.unit), 'sha256': file_hash(self.unit)}]}}}
        self.guards = {'originalEvidence': [{'path': str(self.guard), 'sha256': file_hash(self.guard)}]}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def check(self) -> None:
        save(self.claim_path, self.claim)
        self.entry['claim'] = {'path': str(self.claim_path), 'sha256': file_hash(self.claim_path)}
        bindings = {str(p): file_hash(p) for p in (self.unit, self.guard, self.claim_path)}
        archive = ReceiptArchive(bindings, (), (), True)
        archive.original_claim(self.entry, {'identities': ['authored-identity']},
                               {'taskId': 'authored-task'}, self.guards)

    def test_original_wire_hash_chain_is_consistent_without_claiming_execution(self) -> None:
        self.check()

    def test_rejects_changed_original_scope_or_omitted_original_raw_evidence(self) -> None:
        original = copy.deepcopy(self.claim)
        for key, value in (('taskId', 'other-task'), ('OMO_TASK', 'other-task'),
                           ('OMO_RUN', str(self.root / 'different-run.json')),
                           ('identity', 'different-identity'), ('evidence', {})):
            with self.subTest(key=key):
                self.claim = copy.deepcopy(original)
                self.claim[key] = value
                with self.assertRaises(Rejected):
                    self.check()

    def test_rejects_replaced_unit_even_when_new_transport_hash_is_valid(self) -> None:
        save(self.unit, {'authored': 'different unit after original claim'})
        self.entry['scenarios']['happy']['units'][0]['sha256'] = file_hash(self.unit)
        with self.assertRaisesRegex(Rejected, 'missing from original claim'):
            self.check()

    def test_rejects_unproved_guard(self) -> None:
        self.guards['originalEvidence'] = []
        with self.assertRaisesRegex(Rejected, 'original guard'):
            self.check()

    def manifest_check(self, defect: str = '') -> None:
        case = {'identities': ['authored-identity'], 'baseline': {'revision': 'before'},
                'candidate': {'revision': 'after'}}
        case_path = self.root / 'case.json'
        manifest_path = self.root / 'manifest.json'
        bindings_path = self.root / 'gate-bindings.json'
        transcript_path = self.root / 'gate.jsonl'
        native_path = self.root / 'gate-native.json'
        run_path = Path(self.workflow_path)
        save(case_path, case)
        freeze_path = self.root / 'freeze.json'
        save(freeze_path, {'case': case, 'caseHash': digest(case)})
        claim = {'schema': 'portfolio-done-claim/v1', 'taskId': 'authored-task',
                 'omoTask': 'authored-task', 'omoRun': self.workflow_path,
                 'baseline': 'before', 'candidate': 'after', 'evidenceManifest': str(manifest_path)}
        if defect in ('taskId', 'omoTask', 'omoRun'):
            claim[defect] = str(self.root / 'other-run.json') if defect == 'omoRun' else 'other-task'
        save(self.claim_path, claim)
        manifest = {str(p): {'sha256': file_hash(p), 'bytes': p.stat().st_size}
                    for p in (freeze_path, self.unit, self.guard)}
        if defect == 'omitted-guard':
            del manifest[str(self.guard)]
        save(manifest_path, manifest)
        sealed = {str(p): file_hash(p) for p in (self.claim_path, manifest_path)}
        if defect == 'manifest-binding':
            sealed[str(manifest_path)] = '0' * 64
        save(bindings_path, sealed)
        call_id = 'authored-hash-call'
        transcript_path.write_text(json.dumps({'type': 'response_item', 'payload': {
            'type': 'custom_tool_call_output', 'call_id': call_id,
            'output': [{'type': 'input_text', 'text': json.dumps({'exit_code': 0,
                'output': f'{file_hash(bindings_path)}  {bindings_path}\n'})}]}}) + '\n')
        native = {'taskId': 'authored-gate', 'agentId': 'authored-agent',
                  'role': 'lazycodex-gate-reviewer', 'accepted': True, 'interrupted': False,
                  'finalObserved': True, 'sourceFingerprint': 'authored-source-fingerprint',
                  'transcriptSha256': file_hash(transcript_path),
                  'checks': [{'exitCode': 0, 'artifact': str(self.guard), 'sha256': file_hash(self.guard)}]}
        if defect == 'native-transcript':
            native['transcriptSha256'] = '0' * 64
        save(native_path, native)
        task = {'id': 'authored-gate', 'agentId': 'authored-agent', 'status': 'complete',
                'sourceFingerprint': native['sourceFingerprint'], 'dependsOn': ['authored-task'],
                'receipt': copy.deepcopy(native)}
        if defect == 'admission':
            task['status'] = 'failed'
        save(run_path, {'tasks': [task]})
        ref = lambda p: {'path': str(p), 'sha256': file_hash(p)}
        entry = {**self.entry, 'claim': ref(self.claim_path), 'run': ref(run_path),
                 'case': ref(case_path), 'originalCaseFreeze': ref(freeze_path), 'originalManifestGate': {
                     'native': ref(native_path), 'transcript': ref(transcript_path),
                     'bindings': ref(bindings_path), 'outputCallId': call_id}}
        if defect == 'output-call':
            entry['originalManifestGate']['outputCallId'] = 'other-call'
        if defect == 'case-identity':
            case['identities'] = ['other-identity']
        archive = ReceiptArchive({str(p): file_hash(p) for p in self.root.iterdir()}, (), (), True)
        archive.original_claim(entry, case, {'taskId': 'authored-task'}, self.guards)

    def test_original_manifest_requires_actual_native_gate_output(self) -> None:
        self.manifest_check()

    def test_rejects_laundered_original_manifest_chain(self) -> None:
        for defect in ('omitted-guard', 'manifest-binding', 'native-transcript', 'admission', 'output-call',
                       'taskId', 'omoTask', 'omoRun', 'case-identity'):
            with self.subTest(defect=defect), self.assertRaises(Rejected):
                self.manifest_check(defect)

    def numbered_claim_check(self, defect: str = '') -> None:
        case = {'identities': ['authored-identity'], 'baseline': {'revision': 'before'},
                'candidate': {'revision': 'after'}}
        case_path = self.root / 'case.json'
        save(case_path, case)
        claim = {'schema': 'portfolio-task-done-claim/v1', 'task': 28,
                 'identity': 'authored-identity', 'baseline': 'before', 'candidate': 'after',
                 'evidence': {str(p): file_hash(p) for p in (case_path, self.unit, self.guard)}}
        if defect in ('task-string', 'task-bool', 'task-float'):
            claim['task'] = {'task-string': '28', 'task-bool': True, 'task-float': 28.0}[defect]
        if defect in ('identity', 'baseline', 'candidate', 'schema'):
            claim[defect] = 'other-value'
        if defect == 'omitted-case':
            del claim['evidence'][str(case_path)]
        if defect == 'omitted-guard':
            del claim['evidence'][str(self.guard)]
        if defect == 'omitted-unit':
            del claim['evidence'][str(self.unit)]
        save(self.claim_path, claim)
        ref = lambda p: {'path': str(p), 'sha256': file_hash(p)}
        entry = {**self.entry, 'claim': ref(self.claim_path), 'case': ref(case_path)}
        archive = ReceiptArchive({str(p): file_hash(p) for p in self.root.iterdir()}, (), (), True)
        native = {'taskId': 't29' if defect == 'native-task' else 't28'}
        archive.original_claim(entry, case, native, self.guards)

    def test_original_numbered_claim_keeps_its_original_inline_evidence(self) -> None:
        self.numbered_claim_check()

    def test_rejects_laundered_numbered_claim_scope_and_raw_proof(self) -> None:
        for defect in ('task-string', 'task-bool', 'task-float', 'native-task', 'identity',
                       'baseline', 'candidate', 'schema', 'omitted-case', 'omitted-guard', 'omitted-unit'):
            with self.subTest(defect=defect), self.assertRaises(Rejected):
                self.numbered_claim_check(defect)
