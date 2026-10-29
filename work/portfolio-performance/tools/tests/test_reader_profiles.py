"""Reader container profiles, terminal-state enforcement, container accounting, gzip receipts and the bridge request parser."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import test_adapter
from compare import compare_case, container_accounting
from container_resources import MIB, READER, READER_ENTRY, ContainerJob, validate
from protocol import DECODED_BOUND, GZIP_MAGIC, Case, Rejected, WORK, digest, file_hash, load, save, slot

IMAGE_ID = 'sha256:' + 'a' * 64
BRIDGE = WORK.parents[1] / 'scripts/perf/reader-m-bridge.mjs'


class ProfileAdmission(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='reader-profile-')
        root = Path(self.temp.name).resolve()
        self.docker = str(Path(sys.executable).resolve())  # any hash-bound regular executable file
        self.freeze = root / 'freeze.json'
        self.freeze.write_text(json.dumps({'imageId': IMAGE_ID, 'manifestSha': 'm', 'protocolSha': 'p'}))
        self.bridge = root / 'reader-m-bridge.mjs'
        self.bridge.write_text('// authored mount fixture')
        sources = {str(self.bridge): file_hash(self.bridge)}
        self.data = {'runtime': {'platform': 'Linux-6.8-aarch64'}, 'timeout': 120, 'scratchBytes': 16 * MIB, 'fixtures': {},
                     'harness': {**sources, str(self.freeze): file_hash(self.freeze)}, 'baseline': {'sources': sources},
                     'executables': {self.docker: file_hash(Path(self.docker))},
                     'commands': {'happy': {'baseline': [self.docker, READER_ENTRY]}},
                     'container': {'profile': 'reader-linux-do-v1', 'image': IMAGE_ID, 'docker': self.docker, 'scratchBytes': 7 * MIB,
                                   'freeze': str(self.freeze), 'entrypoint': READER_ENTRY, 'mounts': {str(self.bridge): READER_ENTRY}}}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_accepts_both_profiles_and_binds_envelopes(self) -> None:
        for name, pids, memory in (('reader-linux-local-v1', 32, 128 * MIB), ('reader-linux-do-v1', 128, 512 * MIB)):
            self.data['container']['profile'] = name
            self.assertEqual(validate(self.data, 'baseline')['profile'], name)
            self.assertEqual((READER[name].pids, READER[name].memory), (pids, memory))
        self.assertIn('--permission', READER['reader-linux-local-v1'].node)
        self.assertEqual(READER['reader-linux-do-v1'].node, ())

    def test_rejects_wrong_host_image_freeze_entry_reservation_and_fields(self) -> None:
        def host(d): d['runtime']['platform'] = 'macOS-26-arm64'
        def image(d): d['container']['image'] = 'sha256:' + 'b' * 64
        def tag(d): d['container']['image'] = 'node:latest'
        def freeze(d): self.freeze.write_text('{"imageId": "' + IMAGE_ID + '", "manifestSha": "changed", "protocolSha": "p"}')
        def malformed(d): self.freeze.write_text('{'); d['harness'][str(self.freeze)] = file_hash(self.freeze)
        def foreign(d): self.freeze.write_text(json.dumps({'imageId': 'sha256:' + 'c' * 64, 'manifestSha': 'm', 'protocolSha': 'p'})); d['harness'][str(self.freeze)] = file_hash(self.freeze)
        def unbound(d): del d['harness'][str(self.freeze)]
        def entry(d): d['container']['entrypoint'] = '/work/other.mjs'
        def scratch(d): d['container']['scratchBytes'] = 8 * MIB
        def extra(d): d['container']['socket'] = '/tmp/remote.sock'
        expected = {host: 'actual Linux host', image: 'does not bind the reader image', tag: 'immutable image ID', freeze: 'stale reader freeze',
                    malformed: '', foreign: 'does not bind the reader image', unbound: 'unbound or stale reader freeze', entry: 'entrypoint binding',
                    scratch: 'namespace reservation', extra: 'container fields'}
        for mutate, reason in expected.items():
            data = copy.deepcopy(self.data)
            mutate(data)
            with self.subTest(mutation=mutate.__name__), self.assertRaisesRegex((Rejected, ValueError), reason):
                validate(data, 'baseline')
            self.freeze.write_text(json.dumps({'imageId': IMAGE_ID, 'manifestSha': 'm', 'protocolSha': 'p'}))


class FakeDaemon:
    """Scripted control(): records argv and answers the way the daemon does for one owned container."""
    def __init__(self, state: dict | None, running: bool = False) -> None:
        self.calls: list[list[str]] = []
        self.state, self.running, self.removed = state, running, False

    def __call__(self, arguments: list[str], *, cleanup: bool = False) -> str:
        self.calls.append(arguments)
        if arguments[0] == 'ps':
            return '' if self.removed or self.state is None else 'owned\n'
        if arguments[0] == 'kill':
            self.running = False
        if arguments[0] == 'rm':
            self.removed = True
        return ''


class TerminalState(unittest.TestCase):
    def job(self, state: dict | None, running: bool = False) -> tuple[ContainerJob, FakeDaemon]:
        job = object.__new__(ContainerJob)
        job.attempted = job.create_acknowledged = True
        job.name = 'owned'
        job.identity = {'cleaned': False}
        daemon = FakeDaemon(state, running)
        def inspect(*, cleanup: bool = False) -> dict:
            return {'State': {'Running': daemon.running, 'Pid': 0, **(state or {})}}
        job.control = daemon  # type: ignore[method-assign]
        job.inspect = inspect  # type: ignore[method-assign]
        return job, daemon

    def test_clean_exit_passes_and_records_state(self) -> None:
        job, _ = self.job({'ExitCode': 0, 'OOMKilled': False})
        job.close()
        self.assertTrue(job.identity['cleaned'])
        self.assertEqual(job.identity['terminalState']['ExitCode'], 0)

    def test_oom_nonzero_and_killed_fail_only_after_exact_removal(self) -> None:
        for state, running, reason in (({'ExitCode': 137, 'OOMKilled': True}, False, 'OOM'),
                                       ({'ExitCode': 2, 'OOMKilled': False}, False, 'nonzero'),
                                       ({'ExitCode': 0, 'OOMKilled': False}, True, 'nonzero')):
            with self.subTest(reason=reason):
                job, daemon = self.job(state, running)
                with self.assertRaisesRegex(Rejected, reason):
                    job.close()
                self.assertTrue(daemon.removed and job.identity['cleaned'], 'container must be removed before failure is reported')
                self.assertIn(['rm', 'owned'], daemon.calls)

    def test_missing_terminal_state_is_rejected_not_defaulted(self) -> None:
        job, daemon = self.job(None)
        with self.assertRaisesRegex(Rejected, 'terminal state'):
            job.close()


class Accounting(unittest.TestCase):
    def unit(self) -> tuple[dict, dict]:
        data = {'scratchBytes': 16 * MIB, 'container': {'profile': 'reader-linux-do-v1', 'image': IMAGE_ID, 'scratchBytes': 7 * MIB}}
        unit = {'combinedScratchUpperBoundBytes': 8 * MIB, 'container': {
            'cleaned': True, 'profile': 'reader-linux-do-v1', 'image': IMAGE_ID, 'guardReadback': {'host': {}},
            'terminalState': {'ExitCode': 0, 'OOMKilled': False, 'Running': False, 'Pid': 0}}}
        return unit, data

    def test_upper_bound_accepted_and_every_missing_or_wrong_field_rejected(self) -> None:
        unit, data = self.unit()
        container_accounting(unit, data)
        edits = {'no-bound': lambda u: u.pop('combinedScratchUpperBoundBytes'), 'peak-only': lambda u: (u.pop('combinedScratchUpperBoundBytes'), u.update(combinedScratchPeakBytes=1)),
                 'below-reservation': lambda u: u.update(combinedScratchUpperBoundBytes=MIB), 'above-case': lambda u: u.update(combinedScratchUpperBoundBytes=17 * MIB),
                 'float': lambda u: u.update(combinedScratchUpperBoundBytes=8.0 * MIB),
                 'uncleaned': lambda u: u['container'].update(cleaned=False), 'wrong-image': lambda u: u['container'].update(image='sha256:' + 'd' * 64),
                 'oom': lambda u: u['container']['terminalState'].update(OOMKilled=True), 'nonzero': lambda u: u['container']['terminalState'].update(ExitCode=1),
                 'no-state': lambda u: u['container'].pop('terminalState'), 'no-guard': lambda u: u['container'].pop('guardReadback'),
                 'killed': lambda u: u['container'].update(killedByCleanup=True)}
        for name, edit in edits.items():
            candidate, _ = self.unit()
            edit(candidate)
            with self.subTest(edit=name), self.assertRaises(Rejected):
                container_accounting(candidate, data)


class GzipReceipts(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='gz-')
        self.path = Path(self.temp.name) / '000.json'

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_default_json_bytes_unchanged_and_gzip_round_trips_same_logical_record(self) -> None:
        value = {'b': [1, 2], 'a': 'x' * 5000}
        save(self.path, value)
        plain = self.path.read_bytes()
        self.assertEqual(plain, (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + '\n').encode())
        save(self.path, value, gzip=True)
        self.assertTrue(self.path.read_bytes().startswith(GZIP_MAGIC))
        self.assertLess(self.path.stat().st_size, len(plain))
        self.assertEqual(load(self.path), value)

    def test_corrupt_truncated_trailing_and_expanding_receipts_are_rejected(self) -> None:
        save(self.path, {'a': 'x' * 5000}, gzip=True)
        good = self.path.read_bytes()
        bomb = zlib.compress(b'{"a":"' + b'0' * (DECODED_BOUND + 10) + b'"}', 9, wbits=31)
        flipped = bytearray(good); flipped[-6] ^= 0xFF  # CRC32 field
        for name, raw in {'crc': bytes(flipped), 'truncated': good[:-9], 'trailing': good + b'junk', 'bomb': GZIP_MAGIC + bomb,
                          'garbage': GZIP_MAGIC + b'not gzip', 'header-only': GZIP_MAGIC}.items():
            self.path.write_bytes(raw)
            with self.subTest(case=name), self.assertRaises((Rejected, ValueError)):
                load(self.path)
        self.assertLess(len(bomb), 4096)  # a tiny file really does expand past the bound

    def test_decode_bound_applies_when_saving(self) -> None:
        with self.assertRaises(Rejected):
            save(self.path, {'a': 'x' * (DECODED_BOUND + 1)}, gzip=True)


class GzipThroughRealReaders(test_adapter.AdapterTests):
    def test_cli_collects_gzip_receipts_and_compare_reads_them(self) -> None:
        self.case['receiptEncoding'] = 'gzip-v1'
        save(self.path, self.case)
        for i in range(20):
            result = self.measure(sample=i)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        directory = self.root / self.case['id'] / 'happy'
        self.assertTrue((directory / '000.json').read_bytes().startswith(GZIP_MAGIC))
        self.assertEqual(compare_case(Case.read(self.path), directory)['outcome'], 'VERIFIED_GAIN')
        # A damaged receipt must stop the real compare reader.
        raw = bytearray((directory / '003.json').read_bytes()); raw[-6] ^= 0xFF
        (directory / '003.json').write_bytes(bytes(raw))
        with self.assertRaises((Rejected, ValueError)):
            compare_case(Case.read(self.path), directory)

    def test_unknown_receipt_encoding_is_rejected_at_admission(self) -> None:
        self.case['receiptEncoding'] = 'gzip-v2'
        save(self.path, self.case)
        with self.assertRaisesRegex(Rejected, 'receipt encoding'):
            Case.read(self.path)


class BridgeRequest(unittest.TestCase):
    pass


class CaseGenerator(unittest.TestCase):
    def test_refuses_foreign_host_and_missing_semantic_digest(self) -> None:
        import reader_m_case
        args = dict(case_id='x', task=15, identities=['Reedtrullz/Frontpage'], target='do', query_index=0, window='1h', view='host',
                    docker='/d', image=IMAGE_ID, freeze='/f', bridge='/b', fixture='/x', baseline={}, candidate={}, economics_digest='e')
        with self.assertRaisesRegex(Rejected, 'semantic digest'):
            reader_m_case.build_case(**args, semantic_digest='')
        with patch.object(sys, 'platform', 'darwin'), self.assertRaisesRegex(Rejected, 'Linux host'):
            reader_m_case.build_case(**args, semantic_digest='0' * 64)
        with self.assertRaisesRegex(Rejected, 'target/query index'):
            reader_m_case.build_case(**{**args, 'query_index': 8}, semantic_digest='0' * 64)


class BridgeRequest(unittest.TestCase):
    def parse(self, text: str) -> subprocess.CompletedProcess[str]:
        script = 'import {parseRequest} from ' + json.dumps(BRIDGE.as_uri()) + '; console.log(JSON.stringify(parseRequest(process.argv[1])))'
        return subprocess.run(['node', '--input-type=module', '-e', script, text], capture_output=True, text=True, timeout=20)

    def request(self, **shape: object) -> dict:
        keys = ('caseHash', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'economicsDigest')
        return {**{k: 'x' for k in keys}, 'phase': 'candidate', 'shape': {'target': 'do', 'queryIndex': 5, **shape}}

    def test_original_index_survives_and_malformed_requests_fail(self) -> None:
        ok = self.parse(json.dumps(self.request()))
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(ok.stdout)['shape']['queryIndex'], 5)
        bad = ['', '{', '[]', 'null', json.dumps({**self.request(), 'phase': 'warmup'}), json.dumps(self.request(queryIndex=8)),
               json.dumps(self.request(queryIndex=-1)), json.dumps(self.request(queryIndex=1.5)), json.dumps(self.request(queryIndex='0')),
               json.dumps(self.request(target='mac')), json.dumps({k: v for k, v in self.request().items() if k != 'caseHash'})]
        for text in bad:
            with self.subTest(text=text[:60]):
                self.assertNotEqual(self.parse(text).returncode, 0)


if __name__ == '__main__':
    unittest.main()
