"""Freeze owning publication journals into the existing read-only audit bridge."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from protocol import ROOT, SCOPE, Record, Rejected, record, require, scope
from resource_limits import regular_path


def local(path: Path) -> Path:
    path = Path(os.path.abspath(path))
    regular_path(path)
    require(path != ROOT and path.is_relative_to(ROOT), 'audit path outside workspace')
    return path


def sha(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            hasher.update(chunk)
    return hasher.hexdigest()


def document(path: Path) -> Record:
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'duplicate JSON key')
            result[key] = value
        return result

    require(path.stat().st_size <= 2_000_000, 'audit input exceeds bound')
    return record(json.loads(path.read_text(), object_pairs_hook=unique))


def checked(files: Record) -> Record:
    require(bool(files), 'empty audit binding')
    for name, expected in files.items():
        path = local(Path(name))
        require(str(path) == name and isinstance(expected, str)
                and re.fullmatch(r'[0-9a-f]{64}', expected) is not None, 'invalid audit binding')
        require(path.is_file() and sha(path) == expected, 'stale audit binding')
    return files


def immutable(path: Path, data: bytes) -> None:
    local(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == data, 'existing audit output differs')
    else:
        with path.open('xb') as stream:
            stream.write(data)


def produce(checkpoint: Path, actions: Path, receipt_index: Path, output: Path) -> Record:
    checkpoint, actions, receipt_index, output = map(local, (checkpoint, actions, receipt_index, output))
    require(output not in (checkpoint, actions, receipt_index), 'audit output overlaps input')
    pointer_bytes = checkpoint.read_bytes()
    pointer_hash = hashlib.sha256(pointer_bytes).hexdigest()
    pointer = document(checkpoint)
    require(sha(checkpoint) == pointer_hash, 'checkpoint changed during capture')
    require(pointer['schema'] == 'github-agent-engineering/current-wave-pointer-v1', 'checkpoint pointer schema')
    snapshot = local(Path(pointer['snapshot_path']))
    checked({str(snapshot): pointer['snapshot_sha256']})
    frozen = document(snapshot)
    require(frozen['wave_id'] == pointer['wave_id'], 'checkpoint wave mismatch')
    original = {}
    for binding in frozen['input_bindings']:
        row = record(binding)
        require(row['path'] not in original, 'duplicate checkpoint binding')
        original[row['path']] = row['sha256']
    # Check the actual checkpoint rather than treating its digest as source proof.
    for name, expected in original.items():
        require(sha(Path(name)) == expected, 'stale checkpoint input')
    require(bool(original), 'empty checkpoint bindings')
    index = document(receipt_index)
    require(index['schema'] == 'measurement-receipt-index/v1' and isinstance(index['cases'], list), 'receipt index schema')
    source = document(actions)
    require(source['schema'] == 'portfolio-publication-actions/v1', 'publication actions schema')
    require(source['coverage'] in ('partial', 'complete'), 'publication coverage')
    require(isinstance(source.get('selftestOnly', False), bool), 'selftest marker')
    github, metadata = scope()
    journals = checked(record(source['journals']))
    captures = {}
    for name in journals:
        content = Path(name).read_bytes()
        require(hashlib.sha256(content).hexdigest() == journals[name], 'journal changed during capture')
        journal = document(Path(name))
        require(journal['schema'] == 'github-agent-engineering/action-journal-v1', 'owning journal schema')
        events = {}
        for row in journal['events']:
            event = record(row)
            require(event['id'] not in events and event['repository'] in github, 'duplicate/excluded journal event')
            require(event['state'] == 'RECONCILED' and event['result'] in ('SUCCEEDED', 'FAILED', 'NOT_DISPATCHED'),
                    'unreconciled publication journal')
            events[event['id']] = event
        captures[name] = (content, events)
    rows, ids = [], set()
    inputs = {str(p): sha(p) for p in (checkpoint, snapshot, actions, receipt_index, SCOPE, Path(__file__))}
    inputs[str(checkpoint)] = pointer_hash
    require(isinstance(source['actions'], list) and bool(source['actions']), 'missing action dispositions')
    for value in source['actions']:
        action = dict(record(value))
        require(set(action) <= {'id', 'repository', 'state', 'journal', 'eventId', 'sha', 'authorization',
                                'readbacks', 'issues', 'reason'}, 'unsupported action/closing claim')
        require(isinstance(action['id'], str) and bool(action['id']) and action['id'] not in ids, 'duplicate/missing action id')
        ids.add(action['id'])
        require(action['repository'] in github | metadata, 'excluded action repository')
        require(action['state'] in ('verified', 'no-change', 'WAITING_EXTERNAL'), 'unknown publication dispatch')
        event = None
        if 'eventId' in action:
            require(action.get('journal') in captures, 'action has no owning journal')
            event = captures[action['journal']][1].get(action['eventId'])
            require(event is not None and event['repository'] == action['repository'], 'missing/wrong owning event')
            action['journalResult'] = event['result']
        if action['state'] == 'verified':
            if event is None or event['result'] != 'SUCCEEDED':
                raise Rejected('missing successful owning event')
            require(re.fullmatch(r'[0-9a-f]{40}', action['sha']) is not None and action['sha'] == event['sha'], 'action head mismatch')
            authorization, readbacks = checked(record(action['authorization'])), checked(record(action['readbacks']))
            require(event.get('native_receipt') in readbacks, 'owning native receipt missing from readbacks')
            inputs.update(authorization)
            inputs.update(readbacks)
        else:
            require(isinstance(action.get('reason'), str) and bool(action['reason'].strip()), 'missing unresolved/no-change reason')
            require(event is None or event['result'] != 'SUCCEEDED', 'successful event requires verified bindings')
            require(action['state'] != 'no-change' or event is None or event['result'] == 'NOT_DISPATCHED',
                    'dispatched event cannot become no-change')
        for issue in action.get('issues', []):
            url = urlsplit(issue)
            require(url.scheme == 'https' and url.netloc == 'github.com' and not url.query and not url.fragment
                    and re.fullmatch('/' + re.escape(action['repository']) + r'/issues/[1-9][0-9]*', url.path) is not None,
                    'invalid/wrong-owner Issue URL')
        rows.append(action)
    if source['coverage'] == 'complete':
        require({a['repository'] for a in rows} == github | metadata, 'incomplete identity coverage')
    target_journals, provenance = {}, {}
    for name, (content, _) in captures.items():
        target = output.parent / 'audit-inputs' / ('journal-' + journals[name] + '.json')
        require(str(target) not in provenance, 'duplicate owning journal bytes')
        target_journals[str(target)] = journals[name]
        provenance[str(target)] = {'source': name, 'sha256': journals[name]}
        for action in rows:
            if action.get('journal') == name:
                action['journal'] = str(target)
    live_inputs = dict(inputs)
    pointer_snapshot = output.parent / 'audit-inputs' / ('checkpoint-' + pointer_hash + '.json')
    inputs.pop(str(checkpoint))
    inputs[str(pointer_snapshot)] = pointer_hash
    manifest = {'schema': 'checkpoint-audit/v1', 'coverage': source['coverage'],
                'selftestOnly': source.get('selftestOnly', False), 'inputs': inputs,
                'checkpointPointer': {'source': str(checkpoint), 'path': str(pointer_snapshot), 'sha256': pointer_hash},
                'journal': target_journals, 'journalSources': provenance, 'actions': rows,
                'receiptIndex': {'path': str(receipt_index), 'sha256': inputs[str(receipt_index)]},
                'scope': 'Publication bindings only; no GitHub authentication or original task/gain acceptance'}
    encoded = (json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + '\n').encode()
    require(len(encoded) <= 2_000_000, 'audit output exceeds bound')
    checked(live_inputs)
    checked(journals)
    if output.exists():
        require(output.read_bytes() == encoded, 'existing audit output differs')
    immutable(pointer_snapshot, pointer_bytes)
    for target, item in provenance.items():
        immutable(Path(target), captures[item['source']][0])
    immutable(output, encoded)
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('checkpoint', 'actions', 'receipt-index', 'output'):
        parser.add_argument('--' + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        manifest = produce(args.checkpoint, args.actions, args.receipt_index, args.output)
        print(json.dumps({'status': 'PASS', 'output': str(local(args.output)), 'coverage': manifest['coverage'],
                          'actions': len(manifest['actions']), 'scope': manifest['scope']}))
        return 0
    except (Rejected, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'status': 'BLOCKED', 'error': str(error)}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
