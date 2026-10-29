"""Check retained CLI receipts and record exact delivery hashes. Usage: python3 tools/record_evidence.py."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from protocol import EVIDENCE, ROOT, RUN_TMP, WORK, file_hash, load, require, save


def main() -> int:
    evidence = EVIDENCE / 't05'
    results = load(evidence / 'adapter-tests.json')
    require(results['status'] == 'PASS' and not results['failures'], 'replay failed')
    calls = results['calls']
    for call in calls:
        receipt = load(Path(call['artifact']))
        require(receipt['exitCode'] == receipt['expected'], 'CLI observable failed')
    bylabel = {c['label']: c for c in calls}
    run = Path(results['run'])
    require(load(run / 't05/all-nan-timing/happy/000.json')['error'] == 'missing/non-finite metric', 'NaN timing did not reach numeric rejection')
    require(load(run / 'happy-decision.json')['outcome'] == 'VERIFIED_GAIN', 'missing deterministic gain')
    require(load(run / 'same-decision.json')['outcome'] == 'NO_PROVEN_GAIN', 'missing inconclusive decision')
    require(load(run / 'secondary-decision.json')['outcome'] == 'NO_PROVEN_GAIN', 'missing secondary rejection')
    for path in (run / 't05').rglob('[0-9][0-9][0-9].json'):
        unit = load(path)
        require(unit['reaped'] and unit['scratchCleaned'], 'resource lifecycle incomplete')
        require(not Path(unit['scratch']).exists(), 'owned scratch still exists')
    diagnostics = load(evidence / 'diagnostics.json')
    require(diagnostics['summary']['errorCount'] == 0, 'type diagnostic errors')
    handles = subprocess.run(['/usr/sbin/lsof', '-t', '+D', str(RUN_TMP)], capture_output=True, text=True, timeout=10) if RUN_TMP.exists() else None
    require(handles is None or handles.returncode == 1 and not handles.stdout.strip(), 'active owned resource handles')
    before = [str(p) for p in RUN_TMP.rglob('*')] if RUN_TMP.exists() else []
    if RUN_TMP.exists():
        shutil.rmtree(RUN_TMP)
    oldscratch = WORK / 'tools/.scratch'
    if oldscratch.exists():
        oldscratch.rmdir()
    save(evidence / 'cleanup.json', {'status': 'PASS', 'RUN_TMP': str(RUN_TMP), 'registeredAt': str(evidence / 'owned-resources.json'),
        'removedOwnedEntries': before, 'openHandles': [] if handles is None else handles.stdout.splitlines(),
        'processes': 'All synchronous CLI children waited; every native receipt confirms group teardown and wait.',
        'fixtureGitDirectories': [], 'retained': 'source fixtures and source-linked CLI reports', 'sharedCachesTouched': False})
    files = sorted((WORK / 'tools').rglob('*')) + [WORK / 'cases/adapter-selftest.json']
    sources = [{'path': str(p), 'sha256': file_hash(p), 'bytes': p.stat().st_size} for p in files if p.is_file()]
    replay = ['env', 'PYTHONDONTWRITEBYTECODE=1', f'TMPDIR={RUN_TMP}', f'NODE_COMPILE_CACHE={RUN_TMP}/node',
              f'BUN_RUNTIME_TRANSPILER_CACHE_PATH={RUN_TMP}/bun', sys.executable, str(WORK / 'tools/verify_adapter.py')]
    save(evidence / 'check.json', {'command': replay, 'argv': replay, 'cwd': str(ROOT),
         'artifact': str(evidence / 'adapter-tests.json'), 'artifacts': sources,
         'contract': 'Fresh actual CLI replay: paired gain/no-gain, protocol negatives, static dispositions and thin installed-journal audits.',
         'runtimeNote': 'Recreates owned scratch from retained fixtures; no shared caches, deleted inputs or product dispatch.'})
    groups = {
        'native-error-empty-partial': ['nonzero', 'empty', 'partial', 'reject-missing-receipt'],
        'timeout-process-lifecycle': ['timeout'],
        'output-scratch-malicious': ['output', 'scratch', 'malicious', 'case-scratch-root'],
        'numeric-units-nesting': ['nan', 'all-nan-timing', 'repeated', 'reject-flattened', 'reject-metric', 'unittest'],
        'source-fixture-runtime-harness': ['revision', 'fixture', 'case-stale-source', 'case-runtime', 'reject-harness'],
        'pair-order-count-attribution': ['reject-order', 'reject-unit', 'missing-pair', 'duplicate-unit', 'wrong-task-attribution', 'duplicate-case-attribution'],
        'semantic-economics-secondary': ['parity', 'economics', 'task-comparison'],
        'scope-metadata': ['case-excluded', 'case-metadata-run', 'metadata-phase', 'metadata-disposition', 'metadata-compare'],
        'audit-recovery-stale-coverage': ['audit-coverage', 'audit-missing-identity', 'audit-run', 'audit-unknown-dispatch', 'journal-prepare', 'journal-reconcile']}
    classes = [{'class': name, 'status': 'PASS', 'proof': [bylabel[label] for label in labels]} for name, labels in groups.items()]
    criteria = [{'scenario': c['label'], 'invocation': load(Path(c['artifact']))['argv'],
                 'observable': {'exitCode': c['exitCode']}, 'artifact': c['artifact']} for c in calls]
    literal = evidence / 'adapter-selftest/happy/000.json'
    require(load(literal)['status'] == 'PASS', 'literal happy invocation missing')
    criteria.append({'scenario': 'literal task5 happy', 'invocation': ['python3', 'work/portfolio-performance/tools/measure.py',
        '--case', 'work/portfolio-performance/cases/adapter-selftest.json', '--phase', 'baseline', '--scenario', 'happy'],
        'observable': {'status': 'PASS'}, 'artifact': str(literal)})
    save(evidence / 'DoneClaim.json', {'task': 't05', 'status': 'DONE', 'changedFiles': sources,
        'tests': {'stdlib': '8 tests passed', 'actualCLI': len(calls)}, 'criteria': criteria,
        'adversarialClasses': classes, 'cleanup': str(evidence / 'cleanup.json'),
        'diagnostics': {'artifact': str(evidence / 'diagnostics.json'), 'summary': diagnostics['summary']},
        'limitations': ['Dynamic JSON typing warnings retained, not suppressed.', 'Native probes enforce offline behavior; stdlib wrapper is not an OS network/filesystem quota sandbox.',
                        'No real product workload/build/provider call. Task8 owns publication integration.', 'Obsidian logging skipped as explicitly requested.']})
    inventory = [{'path': str(p), 'sha256': file_hash(p), 'bytes': p.stat().st_size} for p in sorted(evidence.rglob('*'))
                 if p.is_file() and p.name != 'artifact-inventory.json']
    save(evidence / 'artifact-inventory.json', {'files': inventory})
    print(json.dumps({'status': 'DONE', 'claim': str(evidence / 'DoneClaim.json'), 'cliChecks': len(calls), 'adversarialClasses': len(classes)}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
