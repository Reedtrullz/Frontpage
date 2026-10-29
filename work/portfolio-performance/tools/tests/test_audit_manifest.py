"""Exercise the audit producer's actual files, CLI and publication trust boundaries."""
from __future__ import annotations

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
from protocol import RUN_TMP, Rejected, file_hash, save, scope
from build_audit_manifest import produce


class AuditProducerTests(unittest.TestCase):
    def setUp(self) -> None:
        RUN_TMP.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='audit-producer-', dir=RUN_TMP)
        self.root = Path(self.temp.name)
        self.authorization = self.root / 'authorization.md'
        self.authorization.write_text('Authored test authorization, not human or product acceptance.\n')
        self.native = self.root / 'native.json'
        save(self.native, {'fixtureOnly': True, 'number': 1})
        self.journal = self.root / 'journal.json'
        self.event = {'id': 'publish', 'repository': 'Reedtrullz/Frontpage', 'sha': 'a' * 40,
                      'state': 'RECONCILED', 'result': 'SUCCEEDED', 'native_receipt': str(self.native)}
        save(self.journal, {'schema': 'github-agent-engineering/action-journal-v1', 'events': [self.event]})
        snapshot = self.root / 'wave.json'
        save(snapshot, {'wave_id': 'authored-only', 'input_bindings': [
            {'path': str(self.authorization), 'sha256': file_hash(self.authorization)}]})
        self.checkpoint = self.root / 'current.json'
        save(self.checkpoint, {'schema': 'github-agent-engineering/current-wave-pointer-v1',
                               'snapshot_path': str(snapshot), 'snapshot_sha256': file_hash(snapshot),
                               'wave_id': 'authored-only'})
        self.index = self.root / 'receipt-index.json'
        save(self.index, {'schema': 'measurement-receipt-index/v1', 'cases': [], 'blockedClaims': []})
        self.action = {'id': 'draft', 'repository': 'Reedtrullz/Frontpage', 'state': 'verified',
                       'journal': str(self.journal), 'eventId': 'publish', 'sha': 'a' * 40,
                       'authorization': {str(self.authorization): file_hash(self.authorization)},
                       'readbacks': {str(self.native): file_hash(self.native)},
                       'issues': ['https://github.com/Reedtrullz/Frontpage/issues/38']}
        self.document = {'schema': 'portfolio-publication-actions/v1', 'coverage': 'partial',
                         'selftestOnly': True, 'journals': {str(self.journal): file_hash(self.journal)},
                         'actions': [self.action]}
        self.actions = self.root / 'actions.json'
        self.output = self.root / 'state/audit-manifest.json'

    def tearDown(self) -> None:
        self.temp.cleanup()

    def build(self):
        save(self.actions, self.document)
        return produce(self.checkpoint, self.actions, self.index, self.output)

    def test_actual_cli_emits_a_bridge_that_the_existing_auditor_reads(self) -> None:
        save(self.actions, self.document)
        argv = [sys.executable, str(TOOLS / 'build_audit_manifest.py'), '--checkpoint', str(self.checkpoint),
                '--actions', str(self.actions), '--receipt-index', str(self.index), '--output', str(self.output)]
        result = subprocess.run(argv, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        manifest = json.loads(self.output.read_text())
        self.assertTrue(manifest['selftestOnly'])
        self.assertEqual(manifest['coverage'], 'partial')
        frozen = Path(next(iter(manifest['journal'])))
        self.assertEqual(frozen.read_bytes(), self.journal.read_bytes())
        self.assertNotEqual(frozen, self.journal)
        reports = self.root / 'reports'
        for i, identity in enumerate(sorted(set.union(*scope()))):
            save(reports / f'{i}.manifest.json', {'identity': identity, 'outcome': 'NO_CHANGE_NEEDED',
                 'evidence': {str(self.authorization): file_hash(self.authorization)}, 'selftestOnly': True})
        from compare import audit_run
        self.assertEqual(audit_run(self.output.parent, reports)['status'], 'PASS')

    def test_changed_journal_does_not_rewrite_its_captured_bytes(self) -> None:
        manifest = self.build()
        frozen = Path(next(iter(manifest['journal'])))
        before = frozen.read_bytes()
        self.journal.write_text('{"changed":true}\n')
        self.assertEqual(frozen.read_bytes(), before)
        self.assertEqual(file_hash(frozen), manifest['journal'][str(frozen)])

    def test_checkpoint_publication_does_not_invalidate_the_captured_pointer(self) -> None:
        before = self.checkpoint.read_bytes()
        manifest = self.build()
        self.assertNotIn(str(self.checkpoint), manifest['inputs'])
        captured = Path(manifest['checkpointPointer']['path'])
        self.assertEqual(captured.read_bytes(), before)
        self.checkpoint.write_text('{"laterCheckpoint":true}')
        self.assertEqual(captured.read_bytes(), before)
        self.assertEqual(file_hash(captured), manifest['inputs'][str(captured)])

    def test_wrong_event_owner_sha_receipt_or_authorization_rejects_before_output(self) -> None:
        original = copy.deepcopy(self.document)
        changes = [lambda a: a.update(eventId='absent'), lambda a: a.update(repository='Reedtrullz/Nytt-Trondheim'),
                   lambda a: a.update(sha='b' * 40), lambda a: a.update(authorization={}),
                   lambda a: a.update(readbacks={}),
                   lambda a: a['readbacks'].update({str(self.native): '0' * 64}),
                   lambda a: a.update(repository='Reedtrullz/ClankerOS'),
                   lambda a: a.update(issues=['https://github.com/Reedtrullz/Frontpage/pull/84']),
                   lambda a: a.update(issues=['https://github.com/Reedtrullz/Nytt-Trondheim/issues/38']),
                   lambda a: a.update(state='DISPATCH_UNKNOWN')]
        for change in changes:
            with self.subTest(change=change):
                self.document = copy.deepcopy(original)
                change(self.document['actions'][0])
                with self.assertRaises(Rejected):
                    self.build()
                self.assertFalse(self.output.exists())

    def test_pending_failed_or_excluded_owning_journal_cannot_be_verified(self) -> None:
        for updates in ({'state': 'DISPATCHED'}, {'result': 'FAILED'},
                        {'result': 'NOT_DISPATCHED'}, {'repository': 'Reedtrullz/ClankerOS'}):
            with self.subTest(updates=updates):
                save(self.journal, {'schema': 'github-agent-engineering/action-journal-v1',
                                   'events': [{**self.event, **updates}]})
                self.document['journals'][str(self.journal)] = file_hash(self.journal)
                with self.assertRaises(Rejected):
                    self.build()
                self.assertFalse(self.output.exists())

    def test_waiting_and_not_dispatched_are_retained_without_success(self) -> None:
        self.event.update(result='NOT_DISPATCHED')
        save(self.journal, {'schema': 'github-agent-engineering/action-journal-v1', 'events': [self.event]})
        self.document['journals'][str(self.journal)] = file_hash(self.journal)
        self.action.update(state='WAITING_EXTERNAL', reason='Authored missing native admission')
        manifest = self.build()
        self.assertEqual(manifest['actions'][0]['state'], 'WAITING_EXTERNAL')
        self.assertEqual(manifest['actions'][0]['journalResult'], 'NOT_DISPATCHED')

    def test_successful_event_cannot_hide_its_bindings_as_waiting(self) -> None:
        self.action.update(state='WAITING_EXTERNAL', reason='Still waiting for an unrelated dependency')
        self.action.pop('sha')
        self.action.pop('authorization')
        self.action.pop('readbacks')
        with self.assertRaisesRegex(Rejected, 'successful event'):
            self.build()
        self.assertFalse(self.output.exists())

    def test_stale_checkpoint_journal_and_readback_are_not_published(self) -> None:
        self.native.write_text('changed native bytes')
        with self.assertRaises(Rejected):
            self.build()
        self.assertFalse(self.output.exists())
        self.native.write_text('{"fixtureOnly":true,"number":1}')
        self.document['actions'][0]['readbacks'][str(self.native)] = file_hash(self.native)
        self.journal.write_text('changed journal')
        with self.assertRaises(Rejected):
            self.build()
        save(self.journal, {'schema': 'github-agent-engineering/action-journal-v1', 'events': [self.event]})
        self.document['journals'][str(self.journal)] = file_hash(self.journal)
        self.authorization.write_text('changed original authorization')
        with self.assertRaises(Rejected):
            self.build()

    def test_existing_output_and_symlink_are_preserved(self) -> None:
        self.output.parent.mkdir()
        self.output.write_text('existing output must remain unchanged')
        with self.assertRaises(Rejected):
            self.build()
        self.assertEqual(self.output.read_text(), 'existing output must remain unchanged')
        self.output.unlink()
        foreign = self.root / 'foreign.json'
        foreign.write_text('preserve')
        self.output.symlink_to(foreign)
        with self.assertRaises(Rejected):
            self.build()
        self.assertEqual(foreign.read_text(), 'preserve')

    def test_changed_pointer_duplicate_keys_and_false_completion_claims_reject(self) -> None:
        pointer = self.checkpoint.read_bytes()
        value = json.loads(pointer)
        value['snapshot_sha256'] = '0' * 64
        save(self.checkpoint, value)
        with self.assertRaises(Rejected):
            self.build()
        self.checkpoint.write_bytes(pointer)
        self.actions.write_text('{"schema":"x","schema":"portfolio-publication-actions/v1"}')
        with self.assertRaisesRegex(Rejected, 'duplicate JSON key'):
            produce(self.checkpoint, self.actions, self.index, self.output)
        self.document['coverage'] = 'complete'
        with self.assertRaisesRegex(Rejected, 'identity coverage'):
            self.build()
        self.document['coverage'] = 'partial'
        self.action['closesIssues'] = ['https://github.com/Reedtrullz/Frontpage/issues/38']
        with self.assertRaisesRegex(Rejected, 'closing claim'):
            self.build()
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
