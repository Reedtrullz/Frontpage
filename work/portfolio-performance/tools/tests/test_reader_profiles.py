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
import synthetic_inputs  # noqa: F401  (synthetic scope only when the private one is absent)
from compare import compare_case, container_accounting
from container_resources import MIB, READER, READER_ENTRY, ContainerJob, TerminalFailure, check_guard, validate
from protocol import DECODED_BOUND, GZIP_MAGIC, Case, Rejected, WORK, digest, file_hash, load, save, slot

IMAGE_ID = 'sha256:' + 'a' * 64
BRIDGE = WORK.parents[1] / 'scripts/perf/reader-m-bridge.mjs'


FIXTURE = BRIDGE.with_name('reader-m-fixture.mjs')
GOOD_GUARD = {'user': '1000:1000', 'mounts': [{'Type': 'tmpfs', 'Destination': '/tmp'}],
              'host': {'NetworkMode': 'none', 'ReadonlyRootfs': True, 'Privileged': False, 'Init': True, 'CapDrop': ['ALL'], 'CapAdd': None,
                       'SecurityOpt': ['no-new-privileges'], 'PidsLimit': 128, 'Memory': 512 * MIB, 'MemorySwap': 512 * MIB, 'NanoCpus': 10 ** 9,
                       'ShmSize': MIB, 'LogConfig': {'Type': 'none'}, 'Dns': ['127.0.0.1'], 'Binds': None,
                       'Tmpfs': {'/tmp': 'rw,nosuid,nodev,noexec,size=' + str(6 * MIB) + ',mode=1777'}}}


def write_controls(root: Path, *, image: str = IMAGE_ID, bridge_hash: str | None = None, qualified: bool = True) -> dict:
    """SYNTHETIC unit controls (not a real image, freeze or qualification) bound the same way the real ones are."""
    from container_resources import image_bridge_hash
    manifest = root / 'manifest.json'
    manifest.write_text(json.dumps({'protocolSha': 'p', 'files': {'bridge.mjs': bridge_hash or image_bridge_hash(BRIDGE),
                                                                  'fixture.mjs': file_hash(FIXTURE)}}))
    freeze = root / 'freeze.json'
    freeze.write_text(json.dumps({'imageId': image, 'manifestSha': file_hash(manifest), 'protocolSha': 'p'}))
    (root / 'image.id').write_text(image + '\n')
    (root / 'qualification.json').write_text(json.dumps({'pass': qualified, 'imageId': image, 'manifestSha': file_hash(manifest),
                                                         'protocolSha': 'p', 'freezeSha': file_hash(freeze)}))
    return {str(root / n): file_hash(root / n) for n in ('freeze.json', 'manifest.json', 'image.id', 'qualification.json')}


class ProfileAdmission(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='reader-profile-')
        self.root = Path(self.temp.name).resolve()
        self.docker = str(Path(sys.executable).resolve())  # any hash-bound regular executable file
        self.data = self.build()

    def build(self, **controls: object) -> dict:
        sources = {str(BRIDGE): file_hash(BRIDGE), str(FIXTURE): file_hash(FIXTURE)}
        return {'shape': {'target': 'do'}, 'runtime': {'platform': 'Linux-6.8-aarch64'}, 'timeout': 120, 'scratchBytes': 16 * MIB, 'fixtures': {str(FIXTURE): sources[str(FIXTURE)]},
                'harness': {**sources, **write_controls(self.root, **controls)}, 'baseline': {'sources': sources},
                'executables': {self.docker: file_hash(Path(self.docker))},
                'commands': {'happy': {'baseline': [self.docker, READER_ENTRY]}, 'failure': {'baseline': [self.docker, READER_ENTRY]}},
                'container': {'profile': 'reader-linux-do-v1', 'image': IMAGE_ID, 'docker': self.docker, 'scratchBytes': 7 * MIB,
                              'freeze': str(self.root / 'freeze.json'), 'entrypoint': READER_ENTRY, 'mounts': {}}}

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_accepts_both_profiles_and_binds_envelopes(self) -> None:
        for name, pids, memory in (('reader-linux-local-v1', 32, 128 * MIB), ('reader-linux-do-v1', 128, 512 * MIB)):
            self.data['container']['profile'] = name
            self.data['shape'] = {'target': name.split('-')[2]}
            self.assertEqual(validate(self.data, 'baseline')['profile'], name)
            self.assertEqual((READER[name].pids, READER[name].memory), (pids, memory))
        self.assertIn('--permission', READER['reader-linux-local-v1'].node)
        self.assertNotIn('--allow-fs-read=/work', READER['reader-linux-local-v1'].node)
        self.assertEqual(READER['reader-linux-do-v1'].node, ())

    def test_rejects_every_mismatched_binding(self) -> None:
        def host(d): d['runtime']['platform'] = 'macOS-26-arm64'
        def image(d): d['container']['image'] = 'sha256:' + 'b' * 64
        def profile(d): d['container']['profile'] = 'reader-linux-local-v1'
        def shape(d): d['shape'] = {'target': 'local'}
        def no_shape(d): del d['shape']
        def tag(d): d['container']['image'] = 'node:latest'
        def freeze(d): (self.root / 'freeze.json').write_text('{"imageId": "' + IMAGE_ID + '", "manifestSha": "changed", "protocolSha": "p"}')
        def malformed(d): (self.root / 'freeze.json').write_text('{'); d['harness'][str(self.root / 'freeze.json')] = file_hash(self.root / 'freeze.json')
        def foreign(d): d['harness'] = self.build(image='sha256:' + 'c' * 64)['harness']
        def unbound(d): del d['harness'][str(self.root / 'freeze.json')]
        def entry(d): d['container']['entrypoint'] = '/work/other.mjs'
        def argv(d): d['commands']['failure']['baseline'] = [self.docker, '/work/other.mjs']
        def scratch(d): d['container']['scratchBytes'] = 8 * MIB
        def extra(d): d['container']['socket'] = '/tmp/remote.sock'
        def mount(d): d['container']['mounts'] = {str(BRIDGE): READER_ENTRY}
        def work(d): d['container']['mounts'] = {str(FIXTURE): '/work/reader-m-fixture.mjs'}
        def manifest(d): (self.root / 'manifest.json').write_text('{"protocolSha": "p", "files": {}}'); d['harness'][str(self.root / 'manifest.json')] = file_hash(self.root / 'manifest.json')
        def bridge_hash(d): d['harness'] = self.build(bridge_hash='0' * 64)['harness']
        def image_id(d): (self.root / 'image.id').write_text('sha256:' + 'e' * 64 + '\n'); d['harness'][str(self.root / 'image.id')] = file_hash(self.root / 'image.id')
        def qualification(d): d['harness'] = self.build(qualified=False)['harness']
        def no_bridge(d): del d['baseline']['sources'][str(BRIDGE)]
        expected = {host: 'actual Linux host', profile: 'does not match shape.target', shape: 'does not match shape.target', no_shape: 'does not match shape.target', image: 'does not bind the reader image', tag: 'immutable image ID', freeze: 'unbound or stale reader freeze',
                    malformed: '', foreign: 'does not bind the reader image', unbound: 'unbound or stale reader freeze.json', entry: 'entrypoint binding',
                    argv: 'entry binding', scratch: 'namespace reservation', extra: 'container fields', mount: 'no bind mounts', work: 'no bind mounts',
                    manifest: 'does not bind the manifest', bridge_hash: 'differ from committed sources', image_id: 'image.id does not bind',
                    qualification: 'qualification does not bind', no_bridge: 'sources not bound'}
        for mutate, reason in expected.items():
            self.temp.cleanup()
            self.setUp()
            data = copy.deepcopy(self.data)
            mutate(data)
            with self.subTest(mutation=mutate.__name__), self.assertRaisesRegex((Rejected, ValueError), reason):
                validate(data, 'baseline')


class GuardReadback(unittest.TestCase):
    def test_strict_guard_accepts_the_frozen_envelope_and_rejects_each_weakening(self) -> None:
        from container_resources import check_guard
        check_guard(GOOD_GUARD, 'reader-linux-do-v1')
        weaken = {'no-noexec': lambda g: g['host']['Tmpfs'].update({'/tmp': 'rw,nosuid,nodev,size=' + str(6 * MIB)}),
                  'privileged': lambda g: g['host'].update(Privileged=True), 'network': lambda g: g['host'].update(NetworkMode='bridge'),
                  'writable': lambda g: g['host'].update(ReadonlyRootfs=False), 'bind': lambda g: g['host'].update(Binds=['/a:/b']),
                  'bind-mount': lambda g: g['mounts'].append({'Type': 'bind', 'Destination': '/work'}),
                  'caps': lambda g: g['host'].update(CapDrop=[]), 'root': lambda g: g.update(user='0:0'),
                  'extra-tmpfs': lambda g: g['host']['Tmpfs'].update({'/run': 'rw'}), 'memory': lambda g: g['host'].update(Memory=1)}
        for name, edit in weaken.items():
            guard = copy.deepcopy(GOOD_GUARD)
            edit(guard)
            with self.subTest(weakening=name), self.assertRaisesRegex(Rejected, 'guard readback'):
                check_guard(guard, 'reader-linux-do-v1')


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
                with self.assertRaisesRegex(TerminalFailure, reason):
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
            'cleaned': True, 'profile': 'reader-linux-do-v1', 'image': IMAGE_ID, 'guardReadback': copy.deepcopy(GOOD_GUARD),
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
                 'killed': lambda u: u['container'].update(killedByCleanup=True),
                 'weak-guard': lambda u: u['container']['guardReadback']['host']['Tmpfs'].update({'/tmp': 'rw,size=' + str(6 * MIB)})}
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


class CaseGenerator(unittest.TestCase):
    setUp = test_adapter.AdapterTests.setUp
    tearDown = test_adapter.AdapterTests.tearDown

    """Positive and negative fixtures for the authored reader cases. All inputs are SYNTHETIC: the freeze/manifest/qualification are
    unit controls, Python stands in for docker, and no observation or native Linux evidence is produced."""
    def common(self) -> dict:
        controls = write_controls(self.root)
        self.assertEqual(len(controls), 4)
        docker = str(Path(sys.executable).resolve())
        source = lambda name: {'cwd': str(self.root / name), 'revision': 'a' * 40, 'tree': 'b' * 40}
        return {'task': 15, 'identities': ['Reedtrullz/Frontpage'], 'docker': docker, 'image': IMAGE_ID, 'freeze': str(self.root / 'freeze.json'),
                'bridge': str(BRIDGE), 'fixture': str(FIXTURE), 'baseline': source('base'), 'candidate': source('cand'), 'economics_digest': 'synthetic-e'}

    def one(self, **override: object) -> dict:
        import reader_m_case
        args = {**self.common(), 'case_id': 'T15-history-do-1h-host-cold', 'target': 'do', 'query_index': 0, 'window': '1h', 'view': 'host',
                'semantic_digest': '0' * 64, 'temperature': 'cold', **override}
        with patch.object(sys, 'platform', 'linux'), patch('platform.platform', return_value='Linux-6.8-aarch64'):
            return reader_m_case.build_case(**args)

    def read(self, case: dict) -> Case:
        save(self.path, case)
        with patch('protocol.verify_source'):  # task-owned Git checkout verification is covered by the adapter tests
            return Case.read(self.path)

    def test_positive_case_covers_happy_and_failure_with_empty_mounts(self) -> None:
        with patch('platform.platform', return_value='Linux-6.8-aarch64'):
            case = self.read(self.one())
        data = case.data
        self.assertEqual(sorted(data['commands']), ['failure', 'happy'])
        self.assertEqual(data['container']['mounts'], {})
        self.assertEqual(data['commands']['failure']['candidate'], [data['container']['docker'], READER_ENTRY])
        self.assertEqual(data['artifactRoot'], str(__import__('reader_m_case').ARTIFACT_ROOT))
        self.assertEqual(data['temperature'], 'cold')

    def test_refuses_foreign_host_missing_digest_warm_and_misshapen_cases(self) -> None:
        import reader_m_case
        args = dict(case_id='T15-history-do-1h-host-cold', task=15, identities=['Reedtrullz/Frontpage'], target='do', query_index=0, window='1h', view='host',
                    docker='/d', image=IMAGE_ID, freeze='/f', bridge='/b', fixture='/x', baseline={}, candidate={}, economics_digest='e', temperature='cold')
        with self.assertRaisesRegex(Rejected, 'semantic digest'):
            reader_m_case.build_case(**args, semantic_digest='')
        with patch.object(sys, 'platform', 'darwin'), self.assertRaisesRegex(Rejected, 'Linux host'):
            reader_m_case.build_case(**args, semantic_digest='0' * 64)
        with self.assertRaisesRegex(Rejected, 'target/query index'):
            reader_m_case.build_case(**{**args, 'query_index': 8}, semantic_digest='0' * 64)
        for override, reason in (({'temperature': 'warm'}, 'cold fresh-container'), ({'window': '24h'}, 'window/view'), ({'case_id': 'other'}, 'case id'),
                                 ({'candidate': self.common()['baseline']}, 'separate owned checkouts'),
                                 ({'baseline': {'cwd': 'relative', 'revision': 'a' * 40, 'tree': 'b' * 40}}, 'source ownership')):
            with self.subTest(override=list(override)), self.assertRaisesRegex(Rejected, reason):
                self.one(**override)

    def test_artifact_root_outside_evidence_is_rejected_by_case_read(self) -> None:
        case = self.one()
        case['artifactRoot'] = str(self.root / 'elsewhere')
        with patch('platform.platform', return_value='Linux-6.8-aarch64'), self.assertRaisesRegex(Rejected, 'artifact root'):
            self.read(case)

    def test_matrix_index_lists_all_sixteen_cold_cases_and_rejects_tampering(self) -> None:
        import reader_m_case
        directory = self.root / 'matrix'
        directory.mkdir()
        with patch.object(sys, 'platform', 'linux'), patch('platform.platform', return_value='Linux-6.8-aarch64'), patch('protocol.verify_source'):
            index = reader_m_case.build_matrix(common=self.common(), semantic={'local': ['0' * 64] * 8, 'do': ['1' * 64] * 8}, directory=directory)
            self.assertEqual(len(index['cases']), 16)
            self.assertEqual({c['target'] for c in index['cases']}, {'local', 'do'})
            self.assertEqual([o['cohort'] for o in index['outstanding']], ['public-mobile-desktop', 'warm-user-session'])
            reader_m_case.read_index(directory / 'index.json')
            # A happy-only case, a dropped entry and a stale case file must each stop the strict reader.
            first = Path(index['cases'][0]['path'])
            original = first.read_bytes()
            data = load(first)
            del data['commands']['failure']
            save(first, data)
            index['cases'][0]['sha256'] = file_hash(first)
            save(directory / 'index.json', index)
            with self.assertRaises(Rejected):
                reader_m_case.read_index(directory / 'index.json')
            first.write_bytes(original)
            with self.assertRaisesRegex(Rejected, 'stale indexed case'):
                reader_m_case.read_index(directory / 'index.json')
            index['cases'][0]['sha256'] = file_hash(first)
            index['cases'].pop()
            save(directory / 'index.json', index)
            with self.assertRaisesRegex(Rejected, 'sixteen|missing'):
                reader_m_case.read_index(directory / 'index.json')


class TerminalFailureReceipt(unittest.TestCase):
    setUp = test_adapter.AdapterTests.setUp
    tearDown = test_adapter.AdapterTests.tearDown

    def test_abnormal_container_exit_is_an_execution_error_not_a_cleanup_error(self) -> None:
        from native import invoke
        outcome: dict = {}

        class Job:
            def __init__(self, *args: object) -> None:
                self.spec, self.identity, self.deadline = {'scratchBytes': 2 * MIB}, {'cleaned': True}, 0.0

            def prepare(self, argv: list[str], request: str, timeout: float) -> list[str]:
                return argv

            def close(self) -> None:
                raise outcome['error']

        case = Case.read(self.path)
        case.data['container'] = {}
        request = {**slot(self.case, 0), 'scenario': 'happy', 'caseHash': case.sha256, 'revision': self.case['baseline']['revision'],
                   'fixtureDigest': digest(self.case['fixtures']), 'harnessDigest': digest(self.case['harness']), 'shape': self.case['shape'],
                   'economicsDigest': self.case['economicsDigest']}
        with patch('container_resources.ContainerJob', Job):
            outcome['error'] = TerminalFailure('container OOM killed')
            receipt = invoke(case, request)
            self.assertEqual(receipt['status'], 'ERROR')
            self.assertIn('OOM', receipt['terminalError'])
            self.assertNotIn('cleanupError', receipt)
            self.assertNotIn('metrics', receipt)
            outcome['error'] = Rejected('cleanup remains unresolved')
            receipt = invoke(case, request)
            self.assertEqual(receipt['status'], 'ERROR')
            self.assertIn('cleanupError', receipt)
            self.assertNotIn('terminalError', receipt)


class DecodeBound(unittest.TestCase):
    def test_exactly_two_million_decoded_bytes_pass_and_one_more_fails(self) -> None:
        self.assertEqual(DECODED_BOUND, 2_000_000)
        with tempfile.TemporaryDirectory(prefix='bound-') as name:
            path = Path(name) / '000.json'
            for size, accepted in ((DECODED_BOUND, True), (DECODED_BOUND + 1, False)):
                raw = b'{"a":"' + b'x' * (size - 8) + b'"}'
                self.assertEqual(len(raw), size)
                path.write_bytes(GZIP_MAGIC + zlib.compress(raw, 9, wbits=31))
                if accepted:
                    self.assertEqual(len(load(path)['a']), size - 8)
                else:
                    with self.assertRaises((Rejected, ValueError)):
                        load(path)


class BridgeRequest(unittest.TestCase):
    def parse(self, text: str) -> subprocess.CompletedProcess[str]:
        script = 'import {parseRequest} from ' + json.dumps(BRIDGE.as_uri()) + '; console.log(JSON.stringify(parseRequest(process.argv[1])))'
        return subprocess.run(['node', '--input-type=module', '-e', script, text], capture_output=True, text=True, timeout=20)

    def request(self, **shape: object) -> dict:
        keys = ('caseHash', 'unit', 'sample', 'scenario', 'revision', 'fixtureDigest', 'harnessDigest', 'economicsDigest')
        return {**{k: 'x' for k in keys}, 'scenario': 'happy', 'phase': 'candidate', 'shape': {'target': 'do', 'queryIndex': 5, **shape}}

    def test_original_index_survives_and_malformed_requests_fail(self) -> None:
        ok = self.parse(json.dumps(self.request()))
        self.assertEqual(ok.returncode, 0, ok.stderr)
        self.assertEqual(json.loads(ok.stdout)['shape']['queryIndex'], 5)
        bad = ['', '{', '[]', 'null', json.dumps({**self.request(), 'phase': 'warmup'}), json.dumps(self.request(queryIndex=8)),
               json.dumps(self.request(queryIndex=-1)), json.dumps(self.request(queryIndex=1.5)), json.dumps(self.request(queryIndex='0')),
               json.dumps(self.request(target='mac')), json.dumps({k: v for k, v in self.request().items() if k != 'caseHash'}),
               json.dumps({**self.request(), 'scenario': 'warm'}), json.dumps({**self.request(), 'scenario': 7})]
        for text in bad:
            with self.subTest(text=text[:60]):
                self.assertNotEqual(self.parse(text).returncode, 0)


if __name__ == '__main__':
    unittest.main()
