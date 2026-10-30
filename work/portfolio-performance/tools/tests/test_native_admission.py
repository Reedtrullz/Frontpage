"""Native admission helper: frozen protocol, semantic parity derivation, host-generated scope and Task 15 attribution. No native evidence here."""
from __future__ import annotations

import copy
import hashlib
import inspect
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS))
import synthetic_inputs  # noqa: F401
import native_admission as na
import reader_m_case
from protocol import Rejected

MANIFEST = {'pins': {'before': {'commit': 'a' * 40, 'blob': 'b' * 40}, 'candidate': {'commit': 'c' * 40, 'blob': 'd' * 40}}, 'protocolSha': 'p'}


def cells(mutate=None) -> list[dict]:
    rows = []
    for t, q, p, s in na.order():
        happy = hashlib.sha256(f'{t}{q}'.encode()).hexdigest()
        semantic = hashlib.sha256(('{"%d":"%s"}' % (q, happy)).encode()).hexdigest()
        rows.append({'target': t, 'query': q, 'phase': p, 'scenario': s,
                     'native': {'outputHash': na.FAILURE_HASH if s == 'failure' else happy, 'semanticDigest': semantic}})
    if mutate:
        mutate(rows)
    return rows


class Protocol(unittest.TestCase):
    def test_protocol_is_literal_complete_and_not_m(self) -> None:
        protocol = na.frozen_protocol(MANIFEST)
        self.assertEqual(protocol['invocations'], 64)
        self.assertEqual(len({tuple(x) for x in protocol['order']}), 64)
        self.assertEqual(protocol['limits'], {'scratchBytes': 16 << 20, 'timeoutSeconds': 120, 'outputBytes': 1 << 20, 'namespaceBytes': 7 << 20})
        self.assertEqual((protocol['profiles']['local']['pids'], protocol['profiles']['do']['memory']), (32, 512 << 20))
        self.assertEqual(protocol['futureM'], {'executed': False, 'cases': 16, 'scenarios': 2, 'pairs': 10, 'slots': 30, 'units': 960})
        self.assertEqual(protocol['label'], 'QUALIFICATION_ONLY')


class Parity(unittest.TestCase):
    def test_derived_digests_pass(self) -> None:
        semantic = na.parity(cells())
        self.assertEqual({t: len(v) for t, v in semantic.items()}, {'local': 8, 'do': 8})

    def test_every_parity_gap_is_rejected(self) -> None:
        def pick(rows, **k): return next(r for r in rows if all(r[a] == b for a, b in k.items()))
        def output(rows): pick(rows, target='do', query=3, phase='candidate', scenario='happy')['native']['outputHash'] = 'f' * 64
        def digest_(rows): pick(rows, target='local', query=1, phase='candidate', scenario='failure')['native']['semanticDigest'] = 'f' * 64
        def zeros(rows):
            for r in rows:
                if r['target'] == 'local': r['native']['semanticDigest'] = '0' * 64
        def echo(rows):
            for r in rows:
                if r['target'] == 'do' and r['query'] == 2: r['native']['semanticDigest'] = hashlib.sha256(b'echo').hexdigest()
        def failure(rows):
            for r in rows:
                if r['target'] == 'do' and r['query'] == 0 and r['scenario'] == 'failure': r['native']['outputHash'] = 'e' * 64
        def one_digest(rows):
            for r in rows:
                if r['target'] == 'local': r['native']['semanticDigest'] = r['native']['semanticDigest'] if r['query'] == 0 else cells()[0]['native']['semanticDigest']
        for mutate in (output, digest_, zeros, echo, failure, one_digest):
            with self.subTest(mutation=mutate.__name__), self.assertRaises(Rejected):
                na.parity(cells(mutate))


class HostInputs(unittest.TestCase):
    def test_scope_is_frontpage_only_and_never_overwrites(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            scope, ownership = Path(name) / 'scope.json', Path(name) / 'ownership.json'
            checkouts = {'baseline': {'cwd': '/a'}, 'candidate': {'cwd': '/b'}}
            na.write_scope_and_ownership(checkouts, scope, ownership)
            data = json.loads(scope.read_text())
            self.assertEqual((data['includedGithubRepositories'], data['includedAdditionalLocalIdentities']), (['Reedtrullz/Frontpage'], []))
            claims = json.loads(ownership.read_text())['rows'][0]['taskOwnedCheckouts']
            self.assertEqual([(c['taskId'], c['checkout'], c['created']) for c in claims], [(15, '/a', True), (15, '/b', True)])
            for keep in (scope, ownership):
                other = scope if keep is ownership else ownership
                other.unlink()
                with self.assertRaisesRegex(Rejected, 'overwrite'):
                    na.write_scope_and_ownership(checkouts, scope, ownership)
                other.write_text('{}')


class Attribution(unittest.TestCase):
    def args(self, **o) -> dict:
        base = dict(case_id='T15-history-do-1h-host-cold', task=15, identities=['Reedtrullz/Frontpage'], target='do', query_index=0, window='1h', view='host',
                    docker='/d', image='sha256:' + 'a' * 64, freeze='/f', bridge='/b', fixture='/x', baseline={}, candidate={}, economics_digest='e',
                    semantic_digest='1' * 64, temperature='cold')
        return {**base, **o}

    def test_generator_requires_task15_frontpage_ten_pairs(self) -> None:
        for override in ({'task': 14}, {'identities': ['Reedtrullz/Asset-Tracker']}, {'identities': ['Reedtrullz/Frontpage', 'Reedtrullz/Asset-Tracker']}, {'pairs': 5}, {'pairs': 20}):
            with self.subTest(override=override), self.assertRaisesRegex(Rejected, 'Task 15'):
                reader_m_case.build_case(**self.args(**override))


class InputSnapshots(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / 'out'
        self.out.mkdir()
        self.files = {}
        for n in ('bridge', 'fixture', 'docker', 'python', 'freeze'):
            f = Path(self.tmp.name) / n
            f.write_bytes(n.encode() * 7)
            self.files[n] = f
        self.manifest: dict = {}
        for n, f in self.files.items():
            na.archive_input(self.out, str(f), n, self.manifest)
        h = lambda n: hashlib.sha256(n.encode() * 7).hexdigest()
        src = {str(self.files['bridge']): h('bridge'), str(self.files['fixture']): h('fixture')}
        self.case = {'harness': {**src, str(self.files['freeze']): h('freeze')}, 'fixtures': {str(self.files['fixture']): h('fixture')},
                     'executables': {str(self.files['docker']): h('docker'), str(self.files['python']): h('python')},
                     'baseline': {'sources': src}, 'candidate': {'sources': src}}

    def tearDown(self) -> None:
        for f in (self.out / 'inputs').iterdir():
            f.chmod(0o644)
        self.tmp.cleanup()

    def test_every_binding_has_readonly_bytes(self) -> None:
        got = na.verify_inputs(self.out, [self.case])
        self.assertEqual((got['bindingsVerified'], got['missing'], got['classification']), (10, [], 'immutable-input'))

    def test_missing_binding_hash_only_altered_or_writable_snapshots_are_rejected(self) -> None:
        extra = copy.deepcopy(self.case)
        extra['executables']['/no/such/docker'] = 'f' * 64
        with self.assertRaises(Rejected):
            na.verify_inputs(self.out, [extra])  # expected hash repeated in a document with no archived bytes
        wrong = copy.deepcopy(self.case)
        wrong['fixtures'][str(self.files['fixture'])] = 'e' * 64
        with self.assertRaises(Rejected):
            na.verify_inputs(self.out, [wrong])
        archived = self.out / 'inputs' / hashlib.sha256(b'docker' * 7).hexdigest()
        archived.chmod(0o644)
        with self.assertRaises(Rejected):
            na.verify_inputs(self.out, [self.case])  # writable
        archived.write_bytes(b'tampered')
        archived.chmod(0o444)
        with self.assertRaises(Rejected):
            na.verify_inputs(self.out, [self.case])  # altered
        archived.unlink()
        with self.assertRaises(Rejected):
            na.verify_inputs(self.out, [self.case])  # manifest entry without bytes


def case_data(index: int, temperature: str = 'cold') -> dict:
    return {'id': f'case-{index:02d}', 'task': 15, 'temperature': temperature, 'pairs': 10, 'artifactRoot': '/evidence/unblocking-20261028/u04'}


class FakeBudget:
    def __init__(self, limit: int = 1 << 40) -> None:
        self.limit, self.calls = limit, []

    def enforce(self, reserved: int = 0) -> int:
        self.calls.append(reserved)
        if len(self.calls) > self.limit:
            raise Rejected('combined scratch/artifact bound exceeded')
        return 1000 + len(self.calls)


def passing(calls: list):
    def runner(argv, env, timeout):
        calls.append(argv)
        return 0, json.dumps({'status': 'PASS', 'error': None}), ''
    return runner


class OriginalM(unittest.TestCase):
    def plan(self) -> list[dict]:
        return na.m_plan('/py', [(f'/cases/c{i:02d}.json', case_data(i)) for i in reversed(range(16))])  # unsorted input

    def test_plan_is_literal_sorted_complete_and_writes_beneath_t15(self) -> None:
        from protocol import slot
        plan = self.plan()
        self.assertEqual((len(plan), len({tuple(u['argv']) for u in plan})), (960, 960))
        self.assertEqual([u['case'] for u in plan[::60]], [f'case-{i:02d}' for i in range(16)])
        self.assertEqual(plan[0]['argv'], ['/py', str(na.WORK / 'tools/measure.py'), '--case', '/cases/c00.json', '--phase', 'baseline', '--scenario', 'happy',
                                           '--sample', '0', '--output', '/evidence/unblocking-20261028/u04/t15'])
        self.assertEqual([(u['sample'], u['scenario']) for u in plan[:4]], [(0, 'happy'), (0, 'failure'), (1, 'happy'), (1, 'failure')])
        self.assertTrue(all(u['argv'][-1].endswith('/u04/t15') for u in plan))
        self.assertEqual([u['phase'] for u in plan[:60:2]], [slot(case_data(0), i)['phase'] for i in range(30)])
        self.assertEqual(len(na.m_plan('/py', [('/c.json', case_data(0, 'warm'))])), 2 * 34)

    def test_default_cli_does_not_collect_and_flag_is_explicit(self) -> None:
        self.assertEqual(na.m_output('/u04', 15), '/u04/t15')
        for flag, expected in (([], False), (['--collect-m'], True)):
            with patch.object(sys, 'argv', ['na', '--control', 'c', '--out', 'o', *flag]), patch.object(na, 'clean_exec') as clean, patch.object(na, 'execute', return_value=0):
                na.main()
            self.assertEqual('--collect-m' in clean.call_args.args[0], expected)

    def test_first_failure_stops_without_retry_or_later_unit(self) -> None:
        calls, rows = [], []
        def runner(argv, env, timeout):
            calls.append(argv)
            ok = len(calls) != 6
            return (0 if ok else 2), json.dumps({'status': 'PASS' if ok else 'REJECTED', 'error': None if ok else 'duplicate independent unit'}), ''
        result = na.run_m(self.plan(), {}, runner, FakeBudget(), 7 << 20, rows)
        self.assertEqual((result['status'], len(calls), len(rows), rows[-1]['status']), ('ERROR', 6, 6, 'ERROR'))
        self.assertIn('duplicate independent unit', result['error'])

    def test_all_units_pass_in_frozen_order_with_reservation(self) -> None:
        calls, rows, budget = [], [], FakeBudget()
        plan = self.plan()
        result = na.run_m(plan, {}, passing(calls), budget, 7 << 20, rows)
        self.assertEqual((result['status'], result['units'], calls), ('PASS', 960, [u['argv'] for u in plan]))
        self.assertEqual(set(budget.calls), {7 << 20})

    def test_resource_bound_and_deadline_stop(self) -> None:
        for budget, step in ((FakeBudget(limit=3), 1), (FakeBudget(), na.M_RUN_SECONDS)):
            calls, rows, ticks = [], [], iter(range(0, 10 ** 7, step))
            result = na.run_m(self.plan(), {}, passing(calls), budget, 7 << 20, rows, clock=lambda: next(ticks))
            self.assertEqual(result['status'], 'ERROR')
            self.assertLess(len(calls), 5)


class CleanRoot(unittest.TestCase):
    def test_collect_m_root_is_under_approved_prefix_default_is_not(self) -> None:
        for flags, parent in (([], None), (['--collect-m'], na.M_PARENT)):
            with tempfile.TemporaryDirectory() as tmp, patch.object(na, 'RUN_TMP', Path(tmp)), patch.object(na.os, 'execve') as execve:
                na.clean_exec(['--control', 'c', '--out', 'o', *flags])
                env = execve.call_args.args[2]
                invocation = Path(env['TMPDIR']).parent
                self.assertEqual(invocation.parent, Path(tmp) / parent if parent else Path(tmp))
                self.assertTrue(all(Path(env[k]).parent == invocation and Path(env[k]).is_dir() for k in ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH')))


class CollectM(unittest.TestCase):
    """Real collect_m with synthetic injected case/budget readers and a fake measure/compare runner; production Case.read stays the default."""

    def setUp(self) -> None:
        from resource_limits import ResourceBudget
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        self.tmp = Path(holder.name).resolve()
        self.out, self.u04, self.root = self.tmp / 'out', self.tmp / 'u04', self.tmp / 'root'
        self.live = self.u04 / 'live'
        (self.out / 'inputs').mkdir(parents=True)
        (self.root / 'native').mkdir(parents=True)
        (self.out / 'inputs' / 'frozen').write_bytes(b'x' * (20 << 20))  # frozen input bytes live outside the artifact root and are not counted
        self.index = {'artifactRoot': str(self.u04), 'cases': [{'path': f'/cases/c{i:02d}.json'} for i in range(16)]}
        self.budget = ResourceBudget(16 << 20, self.root, self.root / 'native', self.u04, ())

    def collect(self, runner, **kwargs) -> dict:
        from types import SimpleNamespace
        def read_case(path):
            n = int(path.stem[1:])
            return SimpleNamespace(data={**case_data(n), 'artifactRoot': str(self.u04)}, sha256=f'h{n}')
        return na.collect_m(self.out, self.index, '/py', runner, read_case=read_case, read_budget=lambda data: self.budget, live=self.live, **kwargs)

    def runner(self, fail_call=None, compare_status='PASS', size=6000):
        calls = []
        def run(argv, env, timeout):
            calls.append(argv)
            if len(calls) == 1:  # the child's own ResourceBudget must already see the protocol/progress metadata
                self.assertGreaterEqual(self.budget.usage(), (self.live / 'm' / 'protocol.json').stat().st_size)
                self.assertTrue(self.budget.artifacts.joinpath('live/m/protocol.json').is_file())
            if argv[1].endswith('compare.py'):
                return 0, json.dumps({'status': compare_status, 'cases': list(range(32))}), ''
            args = dict(zip(argv[2::2], argv[3::2]))
            target = Path(args['--output']) / Path(args['--case']).stem / args['--scenario'] / (args['--sample'] + '.json')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bytes([len(calls) % 251]) * size)
            ok = len(calls) != fail_call
            return (0 if ok else 2), json.dumps({'status': 'PASS' if ok else 'REJECTED', 'error': None if ok else 'unit failed'}), ''
        run.calls = calls
        return run

    def assert_archived(self, result: dict, files: int) -> list:
        archive = na.archive_live(self.out, self.live, [Path(result['outputRoot'])])
        mapping = json.loads((self.out / 'live-map.json').read_text())
        self.assertEqual((len(mapping), self.u04.joinpath('t15').exists(), self.live.exists()), (archive['files'], False, False))
        raw = [m for m in mapping if '/t15/' in m['archivedPath']]
        self.assertEqual(len(raw), files)
        for entry in mapping:
            self.assertEqual(hashlib.sha256(Path(entry['archivedPath']).read_bytes()).hexdigest(), entry['sha256'])
            self.assertTrue(Path(entry['archivedPath']).is_relative_to(self.out / 'live'))
        self.assertEqual(json.loads((self.out / 'live' / 'qualification' / 'm' / 'result.json').read_text())['status'], result['status'])
        return mapping

    def test_production_case_read_is_the_default(self) -> None:
        self.assertEqual(inspect.signature(na.collect_m).parameters['read_case'].default, na.Case.read)

    def test_success_counts_one_tree_and_moves_live_outputs_once(self) -> None:
        run = self.runner()
        result = self.collect(run)
        self.assertEqual((result['status'], result['comparisons'], len(run.calls)), ('PASS', 32, 961))
        self.assertTrue(self.u04.joinpath('t15').is_dir() and (self.live / 'm' / 'compare.json').is_file())  # nothing moved while workloads could still need it
        self.assertEqual(len(json.loads((self.live / 'm' / 'units.json').read_text())), 960)
        self.assertLessEqual(result['finalOccupancyBytes'], 16 << 20)
        self.assertGreater(result['finalOccupancyBytes'], 960 * 6000)
        self.assert_archived(result, 960)

    def test_failures_preserve_raw_receipts_on_every_exit(self) -> None:
        for name, kwargs, files, rows in (('first unit', {'fail_call': 1}, 1, 1), ('late unit', {'fail_call': 500}, 500, 500), ('compare', {'compare_status': 'REJECTED'}, 960, 960)):
            with self.subTest(name):
                shutil.rmtree(self.out / 'live', ignore_errors=True)
                shutil.rmtree(self.u04, ignore_errors=True)
                result = self.collect(self.runner(**kwargs))
                self.assertEqual(result['status'], 'ERROR')
                self.assertEqual(len(json.loads((self.live / 'm' / 'units.json').read_text())), rows)
                self.assert_archived(result, files)

    def test_live_bytes_under_artifact_root_count_but_inputs_do_not(self) -> None:
        (self.live / 'records').mkdir(parents=True)
        (self.live / 'records' / 'q').write_bytes(b'q' * (10 << 20))  # 10MiB + 7MiB reservation > 16MiB
        run = self.runner()
        result = self.collect(run)
        self.assertEqual((result['status'], len(run.calls)), ('ERROR', 0))
        self.assertIn('bound exceeded', result['error'])
        (self.live / 'records' / 'q').write_bytes(b'q' * (2 << 20))
        shutil.rmtree(self.live / 'm')
        self.assertEqual(self.collect(self.runner())['status'], 'PASS')

    def test_transient_child_occupancy_is_visible_to_child_budget(self) -> None:
        # B1 gate signature: 5MiB mutable output + a 15MiB transient under the native root must trip the child's own real budget.
        (self.live / 'records').mkdir(parents=True)
        (self.live / 'records' / 'q').write_bytes(b'q' * (5 << 20))
        transient = self.root / 'native' / 'transient'
        transient.write_bytes(b't' * (15 << 20))
        with self.assertRaisesRegex(Rejected, 'bound exceeded'):
            self.budget.enforce()

    def test_prior_live_tree_is_never_overwritten(self) -> None:
        (self.u04 / 't15').mkdir(parents=True)
        (self.u04 / 't15' / 'keep').write_text('prior')
        result = self.collect(self.runner())
        self.assertIn('prior M artifacts exist', result['error'])
        self.assertEqual((self.u04 / 't15' / 'keep').read_text(), 'prior')

    def test_deadline_includes_comparison_and_cleanup_reserve(self) -> None:
        ticks = iter([*[0] * 961, *[na.M_RUN_SECONDS + 1] * 10])
        result = self.collect(self.runner(), clock=lambda: next(ticks))
        self.assertEqual(result['status'], 'ERROR')
        self.assert_archived(result, 960)
        self.assertLess(na.M_RUN_SECONDS - na.M_COMPARE_SECONDS - 2 * na.M_TERM_GRACE, na.M_RUN_SECONDS)
        self.assertLessEqual(na.QUAL_SECONDS + na.M_COMPARE_SECONDS + 2 * na.M_TERM_GRACE, na.M_RUN_SECONDS)


class RunProcess(unittest.TestCase):
    def test_normal_and_oversized_streams(self) -> None:
        self.assertEqual(na.run_process([sys.executable, '-c', 'print("ok")'], {}, 10), (0, 'ok\n', ''))
        for stream in ('stdout', 'stderr'):
            with self.assertRaisesRegex(Rejected, 'combined 1MiB bound'):
                na.run_process([sys.executable, '-c', f'import sys; sys.{stream}.write("x" * 3_000_000)'], {}, 20)

    def test_deadline_kills_descendants(self) -> None:
        import subprocess, time
        marker = f'ponytail-sleep-{os.getpid()}'
        code = f'import subprocess,time; subprocess.Popen(["sleep","30",{marker!r}]); time.sleep(30)'
        start = time.monotonic()
        with self.assertRaises(subprocess.TimeoutExpired):
            na.run_process([sys.executable, '-c', code], {}, 1)
        self.assertLess(time.monotonic() - start, 10)
        time.sleep(0.2)
        self.assertNotEqual(subprocess.run(['pgrep', '-f', marker], capture_output=True).returncode, 0)

    def test_sigterm_lets_the_child_run_its_own_cleanup_before_any_kill(self) -> None:
        import subprocess
        with tempfile.TemporaryDirectory() as name:
            marker = Path(name) / 'cleaned'
            code = ('import signal,sys,time,pathlib\n'
                    'def h(*a):\n time.sleep(0.5); pathlib.Path(sys.argv[1]).write_text("cleaned"); sys.exit(3)\n'
                    'signal.signal(signal.SIGTERM,h)\nprint("up",flush=True)\ntime.sleep(60)')
            with self.assertRaises(subprocess.TimeoutExpired):
                na.run_process([sys.executable, '-c', code, str(marker)], dict(os.environ), 1)
            self.assertEqual(marker.read_text(), 'cleaned')

    def test_child_ignoring_sigterm_is_killed_after_the_bounded_grace(self) -> None:
        import subprocess, time
        code = 'import signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ntime.sleep(60)'
        start = time.monotonic()
        with patch.object(na, 'M_TERM_GRACE', 1, create=True), self.assertRaises(subprocess.TimeoutExpired):
            na.run_process([sys.executable, '-c', code], dict(os.environ), 1)
        self.assertLess(time.monotonic() - start, 6)


HARNESS = r'''
import sys, types, tempfile, time
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import native, container_resources
marker, out = sys.argv[2], Path(sys.argv[3])
tmp = Path(tempfile.mkdtemp(dir=out))
class Budget:
    native_root = tmp / 'native'
    def namespace_reservation(self, data): return 0
    def enforce(self, reserved=0): return 0
    def clear_parent_caches(self): pass
native.ResourceBudget = types.SimpleNamespace(read=lambda data: Budget())
class Job:  # stands in only for the Docker control client; the cleanup entry under test is native.invoke's own finally
    def __init__(self, data, phase, scratch, env, deadline):
        self.spec, self.identity, self.deadline = {'scratchBytes': 0}, {}, deadline
    def prepare(self, argv, request, timeout): return argv
    def close(self):
        (out / 'closed').write_text(str(self.deadline - time.monotonic() > 5))
container_resources.ContainerJob = Job
native.install_term_handler()
data = {'timeout': 60, 'outputBytes': 4096, 'container': {}, 'parentEnvironment': {'PATH': '/usr/bin:/bin'}, 'baseline': {'cwd': str(tmp)},
        'commands': {'s': {'baseline': [sys.executable, '-c', 'import time; time.sleep(60)', marker]}}}
receipt = native.invoke(types.SimpleNamespace(data=data), {'phase': 'baseline', 'scenario': 's'})
(out / 'receipt').write_text(repr((receipt['status'], receipt['error'], receipt['reaped'])))
'''


class NativeCancellation(unittest.TestCase):
    def test_outer_timeout_runs_native_cleanup_for_the_separate_workload_session(self) -> None:
        import subprocess, time
        with tempfile.TemporaryDirectory() as name:
            marker = f'ponytail-workload-{os.getpid()}-{time.monotonic_ns()}'
            with self.assertRaises(subprocess.TimeoutExpired):
                na.run_process([sys.executable, '-c', HARNESS, str(TOOLS), marker, name], dict(os.environ), 2)
            time.sleep(0.3)
            self.assertNotEqual(subprocess.run(['pgrep', '-f', marker], capture_output=True).returncode, 0, 'workload session survived the outer timeout')
            self.assertEqual((Path(name) / 'closed').read_text(), 'True')  # ContainerJob.close ran with its own bounded cleanup allowance
            self.assertIn("'ERROR', 'terminated by outer runner', True", (Path(name) / 'receipt').read_text())



if __name__ == '__main__':
    unittest.main()
