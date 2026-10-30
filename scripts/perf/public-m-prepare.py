"""Hosted Frontpage public cohort: production builds, real guard admission, then original M only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'work/portfolio-performance/tools'
sys.path.insert(0, str(TOOLS))
from protocol import Case, EVIDENCE, RUN_TMP, digest, file_hash, runtime, save, slot
from resource_limits import capture_environment, FRONTPAGE_APPROVAL, FRONTPAGE_APPROVAL_SHA, ResourceBudget
from native_admission import make_checkouts, write_scope_and_ownership, run_process, m_plan, archive_input, verify_inputs

spec = importlib.util.spec_from_file_location('frontpage_public_linux', ROOT / 'scripts/perf/public-m-linux.py')
assert spec and spec.loader
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
PINS = {'before': {'commit': '683b0af0c5d5aa71933a731f108ff8cc5ba6e11e', 'blob': 'bf6bee6cc7eff7b363b4fbb5e3bafbc48719a6f8'},
        'candidate': {'commit': 'd4180dbc68810e8e5c33dfc285c6b6f080ce1c39', 'blob': 'b632bfc560defa03fdbf97a1566de22555728bae'}}
CAPABILITIES = ['public-production-browser-v1', 'signed-out-redaction', 'actual-encoded-http']
SOURCES = ['scripts/perf/public-m-browser.mjs', 'scripts/perf/public-m-linux.py', 'scripts/perf/public-linux-guard.json',
           'scripts/perf/public-m-prepare.py', 'work/portfolio-performance/tools/native.py',
           'work/portfolio-performance/tools/protocol.py', 'work/portfolio-performance/tools/resource_limits.py',
           'work/portfolio-performance/tools/native_admission.py', 'work/portfolio-performance/tools/measure.py',
           'work/portfolio-performance/tools/compare.py', 'work/portfolio-performance/tools/decisions.py']


def owned_graph(source: Path, target: Path) -> dict[str, str]:
    shutil.copytree(source, target, symlinks=True, copy_function=os.link)
    links = {}
    for path in target.rglob('*'):
        if path.is_symlink():
            assert path.exists() and path.resolve().is_relative_to(target.resolve()), 'dependency link escapes owned graph'
            links[str(path)] = os.readlink(path)
        elif path.is_file():
            original = source / path.relative_to(target)
            assert os.stat(original).st_ino == path.stat().st_ino and os.stat(original).st_dev == path.stat().st_dev
    return links


def request(case, phase, scenario, index=0):
    return {**slot(case, index), 'caseHash': digest(case), 'phase': phase, 'scenario': scenario,
            'revision': case[phase]['revision'], 'fixtureDigest': digest(case['fixtures']),
            'harnessDigest': digest(case['harness']), 'shape': case['shape'], 'economicsDigest': case['economicsDigest']}


def case_for(config, viewport, temperature, semantic) -> dict[str, Any]:
    identity = f'T15-public-{viewport["width"]}-{temperature}'
    argv = [str(Path(sys.executable).resolve()), str(ROOT / 'scripts/perf/public-m-linux.py'), config['manifest']]
    harness = {str(ROOT / p): file_hash(ROOT / p) for p in SOURCES}
    fixtures = {config['manifest']: file_hash(Path(config['manifest'])), config['clock']: file_hash(Path(config['clock'])),
                config['immutableInputs']: file_hash(Path(config['immutableInputs'])),
                str(FRONTPAGE_APPROVAL): FRONTPAGE_APPROVAL_SHA}
    parent = capture_environment()
    return {'schema': 'measurement-case/v1', 'id': identity, 'task': 15, 'identities': ['Reedtrullz/Frontpage'],
            'mode': 'native', 'offline': True, 'pairs': 10, 'temperature': temperature, 'samplingUnit': 'invocation',
            'shape': {'viewport': viewport, 'temperature': temperature, 'routes': ['/', '/status']},
            'economicsDigest': digest({'offline': True, 'providers': False, 'fixtureClock': 1793203200000}),
            'timeout': 120, 'outputBytes': 1048576, 'scratchBytes': 64 * 1024 ** 2,
            'resourceProfile': 'browser-64m-20261028', 'modality': 'browser', 'namespaceReservationBytes': 48 * 1024 ** 2,
            'browserProfileApproval': {'path': str(FRONTPAGE_APPROVAL), 'sha256': FRONTPAGE_APPROVAL_SHA},
            'parentEnvironment': parent, 'artifactRoot': str(EVIDENCE / 'unblocking-20261028/u04-public'),
            'scratchRoot': str(Path(parent['root']) / 'native'), 'runtime': runtime(), 'harness': harness, 'fixtures': fixtures,
            **{p: {**config['sources'][p], 'sources': harness} for p in ('baseline', 'candidate')},
            'semanticDigest': semantic, 'capabilities': CAPABILITIES, 'primary': 'navigationMs',
            'metrics': {name: {'unit': unit, 'kind': kind, 'direction': 'lower', 'scope': 'nested', 'aggregate': aggregate, 'repetitions': 2}
                        for name, unit, kind, aggregate in [('navigationMs', 'ms', 'timing', 'median'), ('encodedBytes', 'bytes', 'counter', 'sum')]},
            'commands': {s: {p: argv for p in ('baseline', 'candidate')} for s in ('happy', 'failure')},
            'allowlist': [argv], 'executables': {p: file_hash(Path(p)) for p in (argv[0], config['node'])}, 'receiptEncoding': 'gzip-v1'}


def main(collect):
    assert sys.platform == 'linux' and os.getuid() != 0, 'hosted unprivileged Linux only'
    assert shutil.disk_usage(ROOT).free >= 30 * 1024 ** 3, '30GiB build admission floor'
    setup = ROOT / '.public-m-setup'
    setup.mkdir()
    node_path = shutil.which('node')
    assert node_path, 'preinstalled Node required'
    node = str(Path(node_path).resolve())
    host_home = str(Path.home())
    clean = {'PATH': os.environ['PATH'], 'HOME': str(setup / 'build-home'), 'TMPDIR': str(setup / 'build-tmp'),
             'NEXT_TELEMETRY_DISABLED': '1', 'AUTH_SECRET': 'frontpage-public-m-fixture-only', 'LANG': 'C'}
    for key in ('HOME', 'TMPDIR'):
        Path(clean[key]).mkdir()
    save(setup / 'build-toolchain.json', {'compiler': 'default-turbopack', 'dependencyStaging': 'owned graph of existing installed bytes, hardlinked files and contained relative links',
                                        'next': json.loads((ROOT / 'node_modules/next/package.json').read_bytes())['version'], 'packageManagerInvocations': 0})
    checkouts = make_checkouts(setup, PINS, clean)
    write_scope_and_ownership(checkouts)
    clock = setup / 'clock.cjs'
    clock.write_text('const D=Date;global.Date=class extends D{constructor(...a){super(...(a.length?a:[1793203200000]))}static now(){return 1793203200000}};\n')
    fixtures, links = {}, {}
    installed = {str(p.relative_to(ROOT / 'node_modules')): file_hash(p) for p in (ROOT / 'node_modules').rglob('*') if p.is_file() and not p.is_symlink()}
    save(setup / 'installed-graph.json', installed)
    for phase, source in checkouts.items():
        cwd = Path(source['cwd'])
        assert (cwd / 'pnpm-lock.yaml').read_bytes() == (ROOT / 'pnpm-lock.yaml').read_bytes(), 'dependency graph changed'
        links.update(owned_graph(ROOT / 'node_modules', cwd / 'node_modules'))
        subprocess.run([node, str(cwd / 'node_modules/next/dist/bin/next'), 'build'], cwd=cwd, env=clean, check=True, timeout=600)
        assert all(file_hash(ROOT / 'node_modules' / p) == sha for p, sha in installed.items()), 'build changed installed dependency bytes'
        subprocess.run([node, '--require', str(clock), str(cwd / 'tests/e2e/prepare-runtime.mjs')], cwd=cwd, env=clean, check=True, timeout=60)
        (cwd / '.next/standalone/.next/cache').mkdir(parents=True, exist_ok=True)
        fixtures[phase] = {k: str(cwd / 'tests/e2e' / v) for k, v in [('legacy', '.metrics'), ('public', '.metrics-v2-public'), ('owner', '.metrics-v2-owner')]}
    manifest = setup / 'manifest.json'
    save(setup / 'dependency-links.json', links)
    artifacts = EVIDENCE / 'unblocking-20261028/u04-public'
    artifacts.mkdir(parents=True)
    config = {'root': str(ROOT), 'hostHome': host_home, 'browsers': os.environ.get('PLAYWRIGHT_BROWSERS_PATH', host_home + '/.cache/ms-playwright'),
              'node': node, 'clock': str(clock), 'sources': checkouts, 'fixtures': fixtures, 'manifest': str(manifest),
              'immutableInputs': str(setup / 'immutable-inputs.json'), 'controlReceipt': str(artifacts / 'controls.json'),
              'dependencyLinks': str(setup / 'dependency-links.json')}
    save(manifest, config)
    # Freeze every setup file's identity separately from counted writable runtime data.
    immutable = {str(p): file_hash(p) for p in sorted(setup.rglob('*')) if p.is_file() and not p.is_symlink()}
    immutable.update({p: file_hash(Path(p)) for p in (node, str(Path(sys.executable).resolve()))})
    save(setup / 'immutable-inputs.json', immutable)
    viewports = [{'width': 1440, 'height': 1000}, {'width': 390, 'height': 844}]
    temperatures = ['cold', 'warm']
    protocol = {'pairs': 10, 'scenarios': ['happy', 'failure'], 'viewports': viewports,
                'temperatures': ['cold', 'warm'], 'units': 256, 'unitSeconds': 120, 'caseSeconds': 1800, 'wholeSeconds': 3300,
                'compareSeconds': 600, 'qualificationSeconds': 1200, 'namespaceBytes': 48 * 1024 ** 2, 'parentHeadroomBytes': 16 * 1024 ** 2,
                'pins': PINS, 'harness': {str(ROOT / p): file_hash(ROOT / p) for p in SOURCES}}
    save(setup / 'protocol.json', protocol)
    RUN_TMP.mkdir(parents=True, exist_ok=True)
    parent = RUN_TMP / 'public-parent'
    parent.mkdir()
    env = {'PATH': ':'.join(p for p in os.environ['PATH'].split(':') if Path(p).is_absolute()), 'LANG': 'C', 'PYTHONDONTWRITEBYTECODE': '1'}
    for key in ('HOME', 'TMPDIR', 'NODE_COMPILE_CACHE', 'BUN_RUNTIME_TRANSPILER_CACHE_PATH'):
        directory = parent / key.lower()
        directory.mkdir()
        env[key] = str(directory)
    old = dict(os.environ)
    os.environ.clear()
    os.environ.update(env)
    started = time.monotonic()
    try:
        budget_case = case_for(config, viewports[0], 'cold', '0' * 64)
        budget = ResourceBudget.read(budget_case)
        budget.enforce(48 * 1024 ** 2)
        save(artifacts / 'controls.json', guard.controls(config))
        budget.enforce(48 * 1024 ** 2)
        cases = []
        for viewport in viewports:
            for temperature in temperatures:
                case = case_for(config, viewport, temperature, '0' * 64)
                results = [guard.invoke(config, request(case, p, s)) for p in ('baseline', 'candidate') for s in ('happy', 'failure')]
                budget.enforce(48 * 1024 ** 2)
                assert len({r['semanticDigest'] for r in results}) == 1, 'full functional public content parity'
                assert results[0]['outputHash'] == results[2]['outputHash'] and results[1]['outputHash'] == results[3]['outputHash'], 'happy/adverse parity'
                case['semanticDigest'] = results[0]['semanticDigest']
                casepath = setup / (case['id'] + '.json')
                save(casepath, case)
                Case.read(casepath)
                save(artifacts / (case['id'] + '-qualification.json'), results)
                cases.append((str(casepath), case))
                assert time.monotonic() - started < 1200, 'qualification deadline'
        plan = m_plan(str(Path(sys.executable).resolve()), cases)
        assert len(plan) == 256
        inputs = {}
        for _, case in cases:
            for role in ('harness', 'fixtures', 'executables'):
                for source in case[role]:
                    archive_input(setup, source, role, inputs)
        save(artifacts / 'input-snapshot-verification.json', verify_inputs(setup, [case for _, case in cases]))
        save(artifacts / 'm-plan.json', plan)
        if collect:
            case_starts = {}
            for unit in plan:
                case_starts.setdefault(unit['case'], time.monotonic())
                assert time.monotonic() - case_starts[unit['case']] < 1800, 'per-case deadline'
                remaining = 3300 - (time.monotonic() - started)
                assert remaining > 0, 'whole cohort deadline'
                code, stdout, stderr = run_process(unit['argv'], env, min(150, remaining))
                assert code == 0, (unit, stdout[-1000:], stderr[-1000:])
            compare = [sys.executable, str(TOOLS / 'compare.py'), '--task', '15', '--evidence', cases[0][1]['artifactRoot']]
            for casepath, _ in cases:
                compare.extend(['--case', casepath])
            code, stdout, stderr = run_process(compare, env, min(600, 3300 - (time.monotonic() - started)))
            assert code == 0, (stdout[-1000:], stderr[-1000:])
        save(artifacts / 'completion.json', {'status': 'M_COMPLETE' if collect else 'QUALIFIED_ONLY', 'units': len(plan) if collect else 0, 'elapsed': time.monotonic() - started})
        budget.enforce(48 * 1024 ** 2)
    finally:
        os.environ.clear()
        os.environ.update(old)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--collect-m', action='store_true')
    main(parser.parse_args().collect_m)
