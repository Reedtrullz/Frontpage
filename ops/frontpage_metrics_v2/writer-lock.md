# Metrics database writer ownership

`MetricsStore.open()` takes a nonblocking exclusive `flock` on the stable sibling
file `<database>.writer.lock` and holds its descriptor until the store closes.
The lock file remains in place; the kernel lock, rather than file existence or a
PID recorded in the file, identifies the current writer. Process exit, including
`SIGKILL`, releases ownership without deleting history or the lock inode.

The active and shadow v2 systemd units share the same SQLite database and declare
mutual conflicts, so only one mode runs at a time while both retain the same
history. The process lock also rejects a second writer started outside systemd.
Read-only projections and SQLite backups do not acquire writer ownership.

Do not remove the lock file to resolve a collector start failure. Stop and inspect
the competing process, then let `flock` release naturally. Installing this change
requires a separately reviewed maintenance step; code and synthetic process tests
do not establish production installation or collection acceptance.
