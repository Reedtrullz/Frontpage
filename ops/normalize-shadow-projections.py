#!/usr/bin/env python3
"""Normalize shadow projection ownership without following symlinks."""

from __future__ import annotations

import argparse
import errno
import grp
import json
import os
import pwd
import stat
from collections.abc import Iterable


DIRECTORY_MODE = 0o2750
FILE_MODE = 0o640


def _change_directory(fd: int, owner_uid: int, group_gid: int) -> bool:
    info = os.fstat(fd)
    changed = False
    ownership_changed = info.st_uid != owner_uid or info.st_gid != group_gid
    if ownership_changed:
        os.fchown(fd, owner_uid, group_gid)
        changed = True
    if ownership_changed or stat.S_IMODE(info.st_mode) != DIRECTORY_MODE:
        os.fchmod(fd, DIRECTORY_MODE)
        changed = True
    return changed


def _change_file(fd: int, owner_uid: int, group_gid: int) -> bool:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode):
        return False
    changed = False
    ownership_changed = info.st_uid != owner_uid or info.st_gid != group_gid
    if ownership_changed:
        os.fchown(fd, owner_uid, group_gid)
        changed = True
    if ownership_changed or stat.S_IMODE(info.st_mode) != FILE_MODE:
        os.fchmod(fd, FILE_MODE)
        changed = True
    return changed


def normalize_roots(
    roots: Iterable[os.PathLike[str] | str],
    owner_uid: int,
    group_gid: int,
    max_entries: int = 4096,
) -> dict[str, int]:
    if max_entries < 1:
        raise ValueError("maximum entry count must be positive")

    result = {
        "visited": 0,
        "changed": 0,
        "directories": 0,
        "files": 0,
        "symlinks_skipped": 0,
    }

    def consume() -> None:
        result["visited"] += 1
        if result["visited"] > max_entries:
            raise ValueError(f"maximum entry count exceeded: {max_entries}")

    for root in roots:
        root_path = os.fspath(root)
        try:
            root_info = os.lstat(root_path)
        except FileNotFoundError:
            continue
        consume()
        if stat.S_ISLNK(root_info.st_mode):
            result["symlinks_skipped"] += 1
            continue
        if not stat.S_ISDIR(root_info.st_mode):
            continue

        for _dirpath, dirnames, filenames, dirfd in os.fwalk(
            root_path,
            topdown=True,
            follow_symlinks=False,
        ):
            result["directories"] += 1
            if _change_directory(dirfd, owner_uid, group_gid):
                result["changed"] += 1

            safe_dirnames = []
            for name in dirnames:
                consume()
                try:
                    info = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
                except (FileNotFoundError, NotADirectoryError):
                    continue
                if stat.S_ISLNK(info.st_mode):
                    result["symlinks_skipped"] += 1
                    continue
                if stat.S_ISDIR(info.st_mode):
                    safe_dirnames.append(name)
            dirnames[:] = safe_dirnames

            for name in filenames:
                consume()
                try:
                    info = os.stat(name, dir_fd=dirfd, follow_symlinks=False)
                except (FileNotFoundError, NotADirectoryError):
                    continue
                if stat.S_ISLNK(info.st_mode):
                    result["symlinks_skipped"] += 1
                    continue
                if not stat.S_ISREG(info.st_mode):
                    continue
                try:
                    fd = os.open(
                        name,
                        os.O_RDONLY
                        | os.O_NOFOLLOW
                        | os.O_NONBLOCK
                        | os.O_CLOEXEC,
                        dir_fd=dirfd,
                    )
                except (FileNotFoundError, NotADirectoryError):
                    continue
                except OSError as error:
                    if error.errno == errno.ELOOP:
                        result["symlinks_skipped"] += 1
                        continue
                    raise
                try:
                    result["files"] += 1
                    if _change_file(fd, owner_uid, group_gid):
                        result["changed"] += 1
                finally:
                    os.close(fd)

    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True)
    parser.add_argument("--group", required=True)
    parser.add_argument("--max-entries", type=int, default=4096)
    parser.add_argument("roots", nargs="+")
    args = parser.parse_args()
    if len(args.roots) != 2:
        parser.error("exactly two projection roots are required")

    result = normalize_roots(
        args.roots,
        pwd.getpwnam(args.owner).pw_uid,
        grp.getgrnam(args.group).gr_gid,
        args.max_entries,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
