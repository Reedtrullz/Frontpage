import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).parents[1] / "normalize-shadow-projections.py"
SPEC = importlib.util.spec_from_file_location("normalize_shadow_projections", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NormalizeShadowProjectionsTests(unittest.TestCase):
    def test_normalizes_regular_entries_without_following_symlinks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "public"
            nested = root / "host"
            nested.mkdir(parents=True)
            payload = nested / "latest.v2.json"
            payload.write_text("{}")
            outside = Path(temporary) / "outside.json"
            outside.write_text("outside")
            file_link = nested / "file-link"
            file_link.symlink_to(outside)
            dir_target = Path(temporary) / "outside-dir"
            dir_target.mkdir()
            dir_link = root / "dir-link"
            dir_link.symlink_to(dir_target, target_is_directory=True)
            os.chmod(root, 0o755)
            os.chmod(nested, 0o755)
            os.chmod(payload, 0o600)

            first = MODULE.normalize_roots(
                [root, Path(temporary) / "owner"],
                os.getuid(),
                os.getgid(),
            )
            second = MODULE.normalize_roots(
                [root, Path(temporary) / "owner"],
                os.getuid(),
                os.getgid(),
            )

            self.assertEqual(first["directories"], 2)
            self.assertEqual(first["files"], 1)
            self.assertEqual(first["symlinks_skipped"], 2)
            self.assertGreater(first["changed"], 0)
            self.assertEqual(second["changed"], 0)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o2750)
            self.assertEqual(stat.S_IMODE(nested.stat().st_mode), 0o2750)
            self.assertEqual(stat.S_IMODE(payload.stat().st_mode), 0o640)
            self.assertEqual(outside.read_text(), "outside")
            self.assertEqual(stat.S_IMODE(outside.stat().st_mode), 0o644)

    def test_rejects_an_unbounded_projection_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "public"
            root.mkdir()
            (root / "one.json").write_text("{}")

            with self.assertRaisesRegex(ValueError, "maximum entry count"):
                MODULE.normalize_roots([root], os.getuid(), os.getgid(), max_entries=1)

    def test_restores_setgid_after_ownership_change(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "public"
            root.mkdir()

            real_fchmod = MODULE.os.fchmod

            def chown_that_clears_setgid(fd, owner_uid, group_gid):
                real_fchmod(fd, 0o750)

            with patch.object(MODULE.os, "fchown", side_effect=chown_that_clears_setgid):
                MODULE.normalize_roots([root], os.getuid(), os.getgid() + 1)

            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o2750)

    def test_ignores_atomic_unlink_between_stat_and_open(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "public"
            root.mkdir()
            payload = root / "latest.v2.json"
            payload.write_text("{}")
            real_open = MODULE.os.open

            def unlink_once(path, flags, *, dir_fd=None):
                if path == payload.name:
                    payload.unlink()
                    return real_open(path, flags, dir_fd=dir_fd)
                return real_open(path, flags, dir_fd=dir_fd)

            with patch.object(MODULE.os, "open", side_effect=unlink_once):
                result = MODULE.normalize_roots([root], os.getuid(), os.getgid())

            self.assertEqual(result["files"], 0)

    def test_ignores_atomic_unlink_before_stat(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "public"
            root.mkdir()
            payload = root / "latest.v2.json"
            payload.write_text("{}")
            real_stat = MODULE.os.stat
            disappeared = False

            def stat_once(path, *, dir_fd=None, follow_symlinks=True):
                nonlocal disappeared
                if path == payload.name and not disappeared:
                    disappeared = True
                    payload.unlink()
                    raise FileNotFoundError(path)
                return real_stat(path, dir_fd=dir_fd, follow_symlinks=follow_symlinks)

            with patch.object(MODULE.os, "stat", side_effect=stat_once):
                result = MODULE.normalize_roots([root], os.getuid(), os.getgid())

            self.assertEqual(result["files"], 0)


if __name__ == "__main__":
    unittest.main()
