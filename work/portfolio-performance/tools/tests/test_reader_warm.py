"""Warm reader-M cohort regression. Executable source-level checks only: node runs the real bridge exports, Python runs the real case
generator, Case.read, matrix/index reader and native_admission planning/request code. Container, browser, server and observations are never started."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import synthetic_inputs  # noqa: F401
import test_adapter
import test_native_admission as tna
import test_reader_profiles as trp
import native_admission as na
import reader_m_case
from protocol import Case, Rejected, file_hash, load, save, slot

BRIDGE = trp.BRIDGE
WARM = {'temperature': 'warm', 'pairs': 10}
SPEC = dict(task=15, identities=['Reedtrullz/Frontpage'], target='local', query_index=2, window='24h', view='host', docker='/x', image='i',
            freeze='/x/freeze.json', bridge='/b', fixture='/f', baseline={}, candidate={}, semantic_digest='0' * 64, economics_digest='e')
NODE_PATH = '/usr/bin:/usr/local/bin:/opt/homebrew/bin'


def node(code: str, **env: str) -> subprocess.CompletedProcess:
    script = "import * as b from '" + BRIDGE.as_uri() + "';" + code
    return subprocess.run(['node', '--input-type=module', '-e', script], env={'PATH': NODE_PATH, **env}, capture_output=True, text=True, timeout=30)


def request(shape: dict, scenario: str = 'happy') -> dict:
    return {'caseHash': 'c', 'phase': 'baseline', 'unit': 'u', 'sample': 0, 'scenario': scenario, 'revision': 'r', 'fixtureDigest': 'f',
            'harnessDigest': 'h', 'economicsDigest': 'e', 'shape': shape}


class BridgeWarm(unittest.TestCase):
    def test_request_temperature_contract(self):
        base = {'target': 'local', 'queryIndex': 3}
        parse = lambda r: node('b.parseRequest(process.env.R);', R=json.dumps(r)).returncode
        self.assertEqual(parse(request(base)), 0)  # historical cold shape
        self.assertEqual(parse(request({**base, 'temperature': 'warm'})), 0)
        for bad in ('hot', None, 'WARM'):
            self.assertNotEqual(parse(request({**base, 'temperature': bad})), 0)
        self.assertNotEqual(parse(request({'target': 'local', 'queryIndex': 8, 'temperature': 'warm'})), 0)
        self.assertNotEqual(parse(request({'target': 'cdn', 'queryIndex': 0, 'temperature': 'warm'})), 0)

    def test_do_prior_must_equal_timed_and_keeps_original_classification(self):
        out = node('''
          const run = (f) => { try { return ['ok', f()]; } catch (e) { return ['err', e.message]; } };
          const h = 'a'.repeat(64);
          const failure = b.doOutcome({ code: b.FAILURE_CODE }, 'failure');
          process.stdout.write(JSON.stringify({
            happyEqual: run(() => b.requireWarmParity(b.doOutcome({ hash: h }, 'happy'), b.doOutcome({ hash: h }, 'happy'))),
            happyDiffers: run(() => b.requireWarmParity(b.doOutcome({ hash: h }, 'happy'), b.doOutcome({ hash: 'b'.repeat(64) }, 'happy'))),
            failureEqual: run(() => b.requireWarmParity(failure, b.doOutcome({ code: b.FAILURE_CODE }, 'failure'))),
            failureVsHappy: run(() => b.requireWarmParity(failure, h)),
            wrongCode: run(() => b.doOutcome({ code: 'boom' }, 'failure')),
            failureSucceeded: run(() => b.doOutcome({ hash: h }, 'failure')),
            happyMissingHash: run(() => b.doOutcome({}, 'happy')),
            failureOutcome: failure,
          }));''')
        self.assertEqual(out.returncode, 0, out.stderr)
        got = json.loads(out.stdout)
        self.assertEqual(got['happyEqual'][0], 'ok')
        self.assertEqual(got['failureEqual'][0], 'ok')
        for name in ('happyDiffers', 'failureVsHappy'):
            self.assertEqual(got[name], ['err', 'warm prior read differs from timed read'])
        self.assertEqual(got['wrongCode'], ['err', 'failure scenario error code boom'])  # original classification text preserved
        self.assertEqual(got['failureSucceeded'], ['err', 'failure scenario error code undefined'])
        self.assertEqual(got['happyMissingHash'][0], 'err')
        # the failure outcome is the historical failure hash the local path and parity() already use
        self.assertEqual(got['failureOutcome'], na.FAILURE_HASH)


class WarmCases(unittest.TestCase):
    setUp, tearDown = test_adapter.AdapterTests.setUp, test_adapter.AdapterTests.tearDown
    common, one, read = trp.CaseGenerator.common, trp.CaseGenerator.one, trp.CaseGenerator.read
    ID = 'T15-history-do-1h-host-warm'

    def test_case_labels_reject_mislabel(self):
        with patch.object(sys, 'platform', 'linux'):
            for kwargs in (dict(temperature='warm', case_id='T15-history-local-24h-host-cold'),  # warm relabelled cold
                           dict(temperature='cold', case_id='T15-history-local-24h-host-warm'),
                           dict(temperature='hot', case_id='T15-history-local-24h-host-hot'),
                           dict(temperature='warm', case_id='T15-history-local-24h-host-warm', query_index=3)):
                with self.assertRaises(Rejected):
                    reader_m_case.build_case(**{**SPEC, **kwargs})

    def test_positive_warm_case_generates_and_strictly_reads(self):
        case = self.one(case_id=self.ID, temperature='warm')
        self.assertEqual(case['shape'], {'target': 'do', 'queryIndex': 0, 'window': '1h', 'view': 'host', 'temperature': 'warm'})
        with patch('platform.platform', return_value='Linux-6.8-aarch64'):
            data = self.read(case).data
        self.assertEqual((data['temperature'], data['id'], sorted(data['commands'])), ('warm', self.ID, ['failure', 'happy']))
        self.assertEqual(na.slot_count(data), 34)
        self.assertEqual([slot(data, i)['stage'] for i in range(34)].count('warmup'), 4)
        cold = self.one()
        self.assertNotIn('temperature', cold['shape'])  # historical cold shape and hash input unchanged
        with patch('platform.platform', return_value='Linux-6.8-aarch64'):
            self.assertEqual(self.read(cold).data['temperature'], 'cold')

    def matrix(self, name: str, temperature: str = 'warm') -> tuple[Path, dict]:
        directory = self.root / name
        directory.mkdir()
        semantic = {'local': [format(i + 1, '064x') for i in range(8)], 'do': [format(i + 9, '064x') for i in range(8)]}
        with patch.object(sys, 'platform', 'linux'), patch('platform.platform', return_value='Linux-6.8-aarch64'), patch('protocol.verify_source'):
            index = reader_m_case.build_matrix(common=self.common(), semantic=semantic, directory=directory, temperature=temperature)
        return directory, index

    def read_index(self, directory: Path, temperature: str = 'warm') -> dict:
        with patch('platform.platform', return_value='Linux-6.8-aarch64'), patch('protocol.verify_source'):
            return reader_m_case.read_index(directory / 'index.json', temperature)

    def test_warm_matrix_is_sixteen_ordered_warm_cases_and_cold_default_is_unchanged(self):
        directory, index = self.matrix('warm')
        self.assertEqual(self.read_index(directory), index)
        ids = [c['id'] for c in index['cases']]
        self.assertEqual((len(ids), ids, index['temperature']), (16, sorted(ids), 'warm'))
        self.assertTrue(all(i.endswith('-warm') for i in ids))
        self.assertEqual({(c['target'], c['queryIndex']) for c in index['cases']}, {(t, q) for t in ('local', 'do') for q in range(8)})
        self.assertEqual([o['cohort'] for o in index['outstanding']], ['public-mobile-desktop', 'warm-user-session'])  # not complete: unobserved
        self.assertTrue(all(o['status'] == 'OUTSTANDING' for o in index['outstanding']))
        for entry in index['cases']:
            data = load(Path(entry['path']))
            self.assertEqual((data['temperature'], data['shape']['temperature'], data['shape']['queryIndex']), ('warm', 'warm', entry['queryIndex']))
        with self.assertRaisesRegex(Rejected, 'schema/temperature'):
            self.read_index(directory, 'cold')
        cold_dir, cold = self.matrix('cold', 'cold')
        self.assertEqual(self.read_index(cold_dir, 'cold'), cold)
        self.assertTrue(all(load(Path(c['path']))['temperature'] == 'cold' and 'temperature' not in load(Path(c['path']))['shape'] for c in cold['cases']))
        with self.assertRaisesRegex(Rejected, 'schema/temperature'):
            self.read_index(cold_dir, 'warm')
        self.assertEqual(set(ids) & {c['id'] for c in cold['cases']}, set())  # the two cohorts never share a case id

    def test_warm_matrix_tampering_is_rejected(self):
        def rewrite(entry, mutate, directory, index):
            path = Path(entry['path'])
            data = load(path)
            mutate(data)
            save(path, data)
            entry['sha256'] = file_hash(path)
            save(directory / 'index.json', index)

        def entry_edit(change):
            def apply(directory, index):
                change(index['cases'][3])
                save(directory / 'index.json', index)
            return apply

        def drop(directory, index):
            index['cases'].pop(5)
            save(directory / 'index.json', index)

        def duplicate(directory, index):
            index['cases'][5] = copy.deepcopy(index['cases'][4])
            save(directory / 'index.json', index)

        def stale(directory, index):
            path = Path(index['cases'][2]['path'])
            path.write_bytes(path.read_bytes() + b' ')

        cases = {
            'mislabeled shape temperature': lambda d, i: rewrite(i['cases'][0], lambda c: c['shape'].pop('temperature'), d, i),
            'mislabeled case temperature': lambda d, i: rewrite(i['cases'][0], lambda c: c.update(temperature='cold'), d, i),
            'partial result missing failure command': lambda d, i: rewrite(i['cases'][1], lambda c: c['commands'].pop('failure'), d, i),
            'wrong query index in entry': entry_edit(lambda e: e.update(queryIndex=(e['queryIndex'] + 2) % 8)),
            'wrong entry temperature': entry_edit(lambda e: e.update(temperature='cold')),
            'missing case': drop, 'duplicated case': duplicate, 'stale hash': stale,
        }
        for name, tamper in cases.items():
            with self.subTest(name):
                directory, index = self.matrix('t' + str(abs(hash(name))))
                tamper(directory, index)
                with self.assertRaises(Rejected):
                    self.read_index(directory)


class WarmNativeAdmission(unittest.TestCase):
    def test_protocol_freezes_warm_counts_and_leaves_cold_bytes_unchanged(self):
        cold, warm = na.frozen_protocol(tna.MANIFEST), na.frozen_protocol(tna.MANIFEST, 'warm')
        self.assertNotIn('temperature', cold)
        self.assertEqual(cold['futureM'], {'executed': False, 'cases': 16, 'scenarios': 2, 'pairs': 10, 'slots': 30, 'units': 960})
        self.assertEqual(warm['futureM'], {'executed': False, 'cases': 16, 'scenarios': 2, 'pairs': 10, 'slots': 34, 'units': 1088})
        self.assertEqual(warm['temperature'], 'warm')
        self.assertEqual({k: v for k, v in warm.items() if k not in ('futureM', 'temperature')}, {k: v for k, v in cold.items() if k != 'futureM'})

    def test_cli_selection_defaults_cold_and_forwards_warm(self):
        for flags, expected in (([], []), (['--temperature', 'warm'], ['--temperature', 'warm']), (['--collect-m', '--temperature', 'warm'], ['--collect-m', '--temperature', 'warm'])):
            with patch.object(sys, 'argv', ['na', '--control', 'c', '--out', 'o', *flags]), patch.object(na, 'clean_exec') as clean, patch.object(na, 'execute', return_value=0):
                na.main()
            self.assertEqual(clean.call_args.args[0][4:], expected)
        with patch.object(sys, 'argv', ['na', '--control', 'c', '--out', 'o']), patch.object(na, 'clean_exec'), patch.object(na, 'execute', return_value=0) as ex:
            na.main()
        self.assertEqual(ex.call_args.args[0].temperature if ex.call_args else 'cold', 'cold')

    def test_qualification_request_carries_warm_only_for_warm_cases(self):
        class Stop:
            def __init__(self, data, phase, scratch, env, deadline):
                seen.append(json.loads(env['MEASURE_REQUEST']))
                raise Rejected('stop before any container exists')
        budget = SimpleNamespace(native_root=Path(tempfile.mkdtemp()), enforce=lambda reserved=0: 1, clear_parent_caches=lambda: None, usage=lambda: 0)
        self.addCleanup(__import__('shutil').rmtree, budget.native_root, True)
        for temperature, expected in (('warm', {'temperature': 'warm'}), ('cold', {})):
            seen: list = []
            data = {'temperature': temperature, 'fixtures': {}, 'harness': {}, 'economicsDigest': 'e', 'timeout': 120, 'outputBytes': 1 << 20,
                    'parentEnvironment': {'PATH': '/usr/bin'}, 'container': {'scratchBytes': 7 << 20},
                    'baseline': {'revision': 'a' * 40, 'cwd': '/x'}, 'candidate': {'revision': 'b' * 40, 'cwd': '/y'}}
            with patch.object(na, 'ContainerJob', Stop):
                record = na.run_unit(budget, data, 'do', 5, 'candidate', 'failure', 7, 'p')
            self.assertEqual(record['status'], 'ERROR')
            self.assertEqual(seen[0]['shape'], {'target': 'do', 'queryIndex': 5, 'window': '7d', 'view': 'workloads', **expected})

    def test_warm_plan_is_exactly_the_sixteen_warm_cases_1088_units(self):
        cases = [(f'/cases/w{i:02d}.json', {**tna.case_data(i, 'warm'), 'id': f'case-{i:02d}-warm'}) for i in reversed(range(16))]
        plan = na.m_plan('/py', cases)
        self.assertEqual((len(plan), len({tuple(u['argv']) for u in plan})), (1088, 1088))
        self.assertTrue(all(u['case'].endswith('-warm') for u in plan))
        self.assertEqual([(u['sample'], u['scenario']) for u in plan[:2 * 34]][-2:], [(33, 'happy'), (33, 'failure')])
        self.assertEqual([u['phase'] for u in plan[:68:2]], [slot(tna.case_data(0, 'warm'), i)['phase'] for i in range(34)])
        self.assertEqual(len(na.m_plan('/py', [(f'/cases/c{i}.json', tna.case_data(i)) for i in range(16)])), 960)  # cold unchanged


class WarmCollect(unittest.TestCase):
    setUp, runner = tna.CollectM.setUp, tna.CollectM.runner

    def collect(self, runner, count: int = 16, temperature: str = 'warm', data_temperature: str = 'warm', duplicate: bool = False, live: Path | None = None) -> dict:
        paths = [f'/cases/c{i:02d}.json' for i in range(count)]
        if duplicate:
            paths[-1] = paths[-2]
        self.index = {'artifactRoot': str(self.u04), 'temperature': temperature, 'cases': [{'path': p} for p in paths]}

        def read_case(path):
            n = int(path.stem[1:])
            return SimpleNamespace(data={**tna.case_data(n, data_temperature), 'id': f'case-{n:02d}-' + data_temperature, 'artifactRoot': str(self.u04)}, sha256=f'h{n}')
        return na.collect_m(self.out, self.index, '/py', runner, read_case=read_case, read_budget=lambda data: self.budget, live=live or self.live)

    def test_warm_collection_runs_only_1088_warm_units_then_one_compare(self):
        run = self.runner()
        result = self.collect(run)
        self.assertEqual((result['status'], result['comparisons'], len(run.calls)), ('PASS', 32, 1089), result)
        measured = [c for c in run.calls if c[1].endswith('measure.py')]
        self.assertEqual(len(measured), 1088)
        self.assertTrue(all(Path(c[c.index('--case') + 1]).stem[1:].isdigit() for c in measured))
        protocol = load(self.live / 'm' / 'protocol.json')
        self.assertEqual((len(protocol['plan']), set(protocol['caseHashes'])), (1088, {f'case-{i:02d}-warm' for i in range(16)}))
        self.assertTrue(all(p['case'].endswith('-warm') for p in protocol['plan']))

    def test_incomplete_duplicated_or_mixed_warm_plans_execute_nothing(self):
        for name, kwargs in (('missing case', {'count': 15}), ('duplicated case', {'duplicate': True}), ('cold cases under warm index', {'data_temperature': 'cold'}),
                             ('warm cases under cold index', {'temperature': 'cold'})):
            with self.subTest(name):
                run = self.runner()
                result = self.collect(run, live=self.u04 / ('live-' + name.replace(' ', '-')), **kwargs)
                self.assertEqual(result['status'], 'ERROR')
                self.assertEqual(run.calls, [])


if __name__ == '__main__':
    unittest.main()

