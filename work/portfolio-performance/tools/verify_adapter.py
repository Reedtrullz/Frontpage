"""Replay actual adapter CLI contracts, retaining every invocation. Usage: python3 tools/verify_adapter.py."""
from __future__ import annotations

import copy
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from protocol import EVIDENCE, ROOT, RUN_TMP, WORK, Record, file_hash, load, save, scope, slot
from selftest_case import definition


def main() -> int:
    evidence = EVIDENCE / 't05'
    run = Path(tempfile.mkdtemp(prefix='replay-', dir=evidence))
    tools = WORK / 'tools'
    calls = []
    failures = []

    def cli(label: str, argv: list[str], expected: int = 0) -> Record:
        result = subprocess.run(argv, cwd=ROOT, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                capture_output=True, text=True, timeout=30)
        artifact = run / 'cli' / f'{len(calls):03d}-{label}.json'
        receipt = {'argv': argv, 'cwd': str(ROOT), 'exitCode': result.returncode,
                   'stdout': result.stdout, 'stderr': result.stderr, 'expected': expected}
        save(artifact, receipt)
        calls.append({'label': label, 'artifact': str(artifact), 'exitCode': result.returncode})
        if result.returncode != expected:
            failures.append(str(artifact))
        return receipt

    cli('unittest', [sys.executable, '-m', 'unittest', 'discover', '-s', 'work/portfolio-performance/tools/tests', '-v'])
    case = definition()
    case['artifactRoot'] = str(run)
    casepath = run / 'case.json'
    save(casepath, case)
    measure = [sys.executable, str(tools / 'measure.py'), '--case', str(casepath)]
    for scenario, outcome in [('happy', 'VERIFIED_GAIN'), ('same', 'NO_PROVEN_GAIN'), ('secondary', 'NO_PROVEN_GAIN')]:
        for index in range(20):
            cli(f'{scenario}-{index}', [*measure, '--phase', slot(case, index)['phase'], '--scenario', scenario,
                '--sample', str(index), '--output', str(run / 't05')])
        # Only compare the one explicitly selected scenario's retained units here.
        from compare import compare_case
        from protocol import Case
        result = compare_case(Case.read(casepath), run / 't05' / case['id'] / scenario)
        save(run / f'{scenario}-decision.json', result)
        if result['outcome'] != outcome:
            failures.append(f'{scenario}: wrong outcome')
    # Full --task CLI validates all cases/scenarios, so bind a one-scenario case for it.
    single = copy.deepcopy(case)
    single['commands'] = {'happy': single['commands']['happy']}
    single['id'] = 'cli-happy'
    singlepath = run / 'single.json'
    save(singlepath, single)
    for index in range(20):
        cli(f'cli-unit-{index}', [sys.executable, str(tools / 'measure.py'), '--case', str(singlepath),
            '--phase', slot(single, index)['phase'], '--sample', str(index), '--output', str(run / 't05')])
    compare = [sys.executable, str(tools / 'compare.py'), '--task', '5', '--case', str(singlepath), '--evidence', str(run)]
    cli('task-comparison', compare)
    cli('wrong-task-attribution', [*compare[:3], '9', *compare[4:]], 2)
    cli('duplicate-case-attribution', [*compare, '--case', str(singlepath)], 2)
    cli('duplicate-unit', [*measure, '--phase', 'baseline', '--output', str(run / 't05')], 2)
    rejections = []
    for scenario in ('timeout', 'nonzero', 'empty', 'malicious', 'output', 'scratch', 'partial', 'missing', 'nan',
                     'revision', 'fixture', 'economics', 'repeated', 'parity'):
        result = cli(scenario, [*measure, '--phase', 'baseline', '--scenario', scenario, '--output', str(run / 't05')], 2)
        rejections.append({'scenario': scenario, 'exitCode': result['exitCode'], 'artifact': calls[-1]['artifact']})
    timing = copy.deepcopy(case)
    producer = tools / 'fixtures/timing_fault.py'
    timing['id'] = 'all-nan-timing'
    timing['harness'] = {str(producer): file_hash(producer)}
    from protocol import digest
    for phase in ('baseline', 'candidate'):
        timing[phase].update(sources=timing['harness'], revision=digest(timing['harness']))
    argv = [str(Path(sys.executable).resolve()), str(producer)]
    timing['allowlist'] = [argv]
    timing['commands'] = {'happy': {'baseline': argv, 'candidate': argv}}
    timing['metrics']['iterations'].update(kind='timing', unit='s', scope='nested', repetitions=3, aggregate='median')
    timingpath = run / 'timing.json'
    save(timingpath, timing)
    cli('all-nan-timing', [sys.executable, str(tools / 'measure.py'), '--case', str(timingpath), '--phase', 'baseline', '--output', str(run / 't05')], 2)
    # Corrupt independently retained receipts and drive the real comparator each time.
    source = run / 't05/cli-happy/happy'
    mutations = {
        'stale-receipt': lambda u: u.update(caseHash='stale'),
        'aggregation': lambda u: u['definition']['metrics']['iterations'].update(aggregate='max'),
        'harness': lambda u: u['definition']['harness'].update(wrong='bad'),
        'fixture': lambda u: u['request'].update(fixtureDigest='swapped'),
        'order': lambda u: u['state'].update(order='BA'),
        'unit': lambda u: u['state'].update(unit='duplicate'),
        'flattened': lambda u: u['native']['metrics']['iterations'].update(values=[20, 20, 20]),
        'metric': lambda u: u['metrics'].update(iterations=0),
        'returncode': lambda u: u.update(returncode=7),
        'shape': lambda u: u['request'].update(shape={'rows': 1}),
        'missing-receipt': lambda u: u.pop('native')}
    for name, mutate in mutations.items():
        destination = run / f'corrupt-{name}' / 't05/cli-happy/happy'
        shutil.copytree(source, destination)
        unit = load(destination / '010.json')
        mutate(unit)
        save(destination / '010.json', unit)
        cli('reject-' + name, [*compare[:-1], str(run / f'corrupt-{name}')], 2)
    destination = run / 'missing-pair/t05/cli-happy/happy'
    shutil.copytree(source, destination)
    (destination / '019.json').unlink()
    cli('missing-pair', [*compare[:-1], str(run / 'missing-pair')], 2)
    for name, mutate in {
        'argv': lambda c: c['commands']['happy'].update(baseline=['/bin/echo', 'unsafe']),
        'scratch-root': lambda c: c.update(scratchRoot='/tmp/foreign'),
        'stale-source': lambda c: c['baseline']['sources'].update({str(tools / 'fixtures/numbers.txt'): 'stale'}),
        'excluded': lambda c: c.update(identities=['excluded/identity']),
        'metadata-run': lambda c: c.update(identities=['NAV Innsyn']),
        'runtime': lambda c: c.update(runtime={'platform': 'wrong'})}.items():
        invalid = copy.deepcopy(case)
        mutate(invalid)
        invalidpath = run / f'{name}.json'
        save(invalidpath, invalid)
        cli('case-' + name, [sys.executable, str(tools / 'measure.py'), '--case', str(invalidpath), '--phase', 'baseline', '--output', str(run / 't05')], 2)
    # Thin static/audit checks use authored metadata only, never private record roots.
    allidentities = sorted(set.union(*scope()))
    reports = run / 'reports'
    sourcebinding = {str(tools / 'fixtures/numbers.txt'): file_hash(tools / 'fixtures/numbers.txt')}
    for index, identity in enumerate(allidentities):
        save(reports / f'{index}.manifest.json', {'identity': identity, 'outcome': 'NO_CHANGE_NEEDED', 'evidence': sourcebinding, 'selftestOnly': True})
    coverage = run / 'coverage.json'
    save(coverage, {'rows': [{'identity': i} for i in allidentities]})
    audit = [sys.executable, str(tools / 'compare.py'), '--audit-coverage', str(coverage), '--reports', str(reports)]
    cli('audit-coverage', audit)
    save(coverage, {'rows': [{'identity': i} for i in allidentities[:-1]]})
    cli('audit-missing-identity', audit, 2)
    static = {'schema': 'measurement-case/v1', 'id': 'metadata', 'task': 32, 'mode': 'static',
              'identities': sorted(scope()[1]), 'sources': sourcebinding,
              'dispositions': [{'identity': i, 'outcome': 'NO_CHANGE_NEEDED'} for i in sorted(scope()[1])]}
    staticpath = run / 'static.json'
    save(staticpath, static)
    cli('metadata-disposition', [sys.executable, str(tools / 'measure.py'), '--case', str(staticpath), '--output', str(run / 't32')])
    cli('metadata-phase', [sys.executable, str(tools / 'measure.py'), '--case', str(staticpath), '--phase', 'baseline'], 2)
    cli('metadata-compare', [sys.executable, str(tools / 'compare.py'), '--task', '32', '--case', str(staticpath), '--evidence', str(run)])
    journal = run / 'journal-fixture.json'
    checkpoint = '/Users/reidar/.codex/skills/github-agent-engineering/scripts/checkpoint_ops.py'
    cli('journal-prepare', [sys.executable, checkpoint, 'prepare', '--journal', str(journal), '--event-id', 'offline-selftest',
        '--repository', 'Reedtrullz/Asset-Tracker', '--operation', 'offline-adapter-selftest', '--sha', '0' * 40])
    cli('journal-reconcile', [sys.executable, checkpoint, 'reconcile', '--journal', str(journal), '--event-id', 'offline-selftest',
        '--native-receipt', str(run / 'happy-decision.json'), '--result', 'NOT_DISPATCHED'])
    bridge: Record = {'schema': 'checkpoint-audit/v1', 'inputs': sourcebinding, 'journal': {str(journal): file_hash(journal)},
              'actions': [{'state': 'no-change', 'issues': []}]}
    state = run / 'state'
    save(state / 'audit-manifest.json', bridge)
    auditrun = [sys.executable, str(tools / 'compare.py'), '--audit-run', str(state), '--reports', str(reports)]
    cli('audit-run', auditrun)
    bridge['actions'][0].update(state='DISPATCH_UNKNOWN')
    save(state / 'audit-manifest.json', bridge)
    cli('audit-unknown-dispatch', auditrun, 2)
    result = {'status': 'PASS' if not failures else 'FAIL', 'failures': failures, 'run': str(run), 'calls': calls}
    save(evidence / 'adapter-tests.json', result)
    save(evidence / 'rejections.json', {'status': result['status'], 'nativeFaults': rejections,
         'negativeCLI': [c for c in calls if load(Path(c['artifact']))['expected'] == 2]})
    save(run / 'result.json', result)
    cleanup = {}
    for path in (RUN_TMP / 'native', RUN_TMP):
        try:
            path.rmdir()
            cleanup[str(path)] = 'removed empty owned directory'
        except OSError as error:
            cleanup[str(path)] = f'preserved: {error}'
    save(run / 'cleanup.json', cleanup)
    print(json.dumps({'status': result['status'], 'run': str(run), 'failures': failures, 'cliCalls': len(calls)}))
    return int(bool(failures))


if __name__ == '__main__':
    sys.exit(main())
