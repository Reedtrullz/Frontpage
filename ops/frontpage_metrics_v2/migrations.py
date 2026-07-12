SCHEMA_VERSION = 1


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS host_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  coverage_percent REAL NOT NULL CHECK(coverage_percent BETWEEN 0 AND 100),
  PRIMARY KEY(tier, ts_ms)
);
CREATE TABLE IF NOT EXISTS workload_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  workload_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  coverage_percent REAL NOT NULL CHECK(coverage_percent BETWEEN 0 AND 100),
  PRIMARY KEY(tier, ts_ms, workload_id)
);
CREATE TABLE IF NOT EXISTS service_points(
  tier TEXT NOT NULL CHECK(tier IN ('15s','1m','15m')),
  ts_ms INTEGER NOT NULL,
  service_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(tier, ts_ms, service_id)
);
CREATE TABLE IF NOT EXISTS incidents(
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  opened_at_ms INTEGER NOT NULL,
  recovered_at_ms INTEGER,
  visibility TEXT NOT NULL CHECK(visibility IN ('public','owner')),
  summary_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK(length(evidence_json) <= 262144)
);
CREATE TABLE IF NOT EXISTS capabilities(
  key TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT NOT NULL,
  observed_at_ms INTEGER NOT NULL
);
"""


def migrate(connection) -> None:
    connection.executescript(SCHEMA_SQL)
    rows = connection.execute("SELECT version FROM schema_meta").fetchall()
    if not rows:
        connection.execute("INSERT INTO schema_meta(version) VALUES(?)", (SCHEMA_VERSION,))
    elif len(rows) != 1 or rows[0][0] != SCHEMA_VERSION:
        raise RuntimeError("Unsupported observability database schema")

