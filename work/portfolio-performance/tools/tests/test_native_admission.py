"""Native admission helper: frozen protocol, semantic parity derivation, host-generated scope and Task 15 attribution. No native evidence here."""
from __future__ import annotations

import copy
import hashlib
import json
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


if __name__ == '__main__':
    unittest.main()
