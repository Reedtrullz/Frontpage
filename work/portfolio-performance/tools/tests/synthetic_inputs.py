"""SYNTHETIC unit-test inputs for checkouts that lack the private portfolio scope (CI, clean clones).

Importing this module writes an explicitly synthetic scope file at the path production code reads, only when that
file is absent, and removes it at exit. It never touches an existing private file, never fakes an owner approval or a
native receipt, and production gates are unchanged. Nothing here is native admission evidence.
"""
from __future__ import annotations

import atexit
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from protocol import SCOPE

SYNTHETIC_SCOPE = {
    'syntheticUnitFixture': True,
    'includedGithubRepositories': ['Reedtrullz/Frontpage', 'Reedtrullz/Asset-Tracker'],
    'includedAdditionalLocalIdentities': [{'identity': 'Synthetic Local', 'mode': 'metadata-disposition-only', 'task': 32}],
    'excludedGithubRepositories': ['Reedtrullz/Nytt-Trondheim', 'Reedtrullz/ClankerOS'],
}
_created: list[Path] = []


def _cleanup() -> None:
    for path in reversed(_created):
        path.unlink(missing_ok=True)
        try:
            path.parent.rmdir()
        except OSError:
            pass


def synthetic() -> bool:
    """True when the scope in use is this synthetic one."""
    return bool(_created)


if not SCOPE.exists():
    SCOPE.parent.mkdir(parents=True, exist_ok=True)
    SCOPE.write_text(json.dumps(SYNTHETIC_SCOPE, sort_keys=True))
    _created.append(SCOPE)
    atexit.register(_cleanup)
