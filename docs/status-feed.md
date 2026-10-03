# Public status feed

`https://reidar.tech/status/feed.json` serves JSON Feed 1.1 with at most 256
approved public incident and maintenance summaries. Item IDs are stable URNs;
incident publication and modification dates come from the public incident
projection. Maintenance items use their published start time and omit a
modification date because the canonical maintenance record has no update field.
Summaries are emitted as `content_text`, never `content_html`.

The `_frontpage` metadata reports source availability, telemetry freshness,
collection time, incident projection generation time, and whether the bounded
item list was truncated. A valid zero-event source returns HTTP 200 with no
items and `availability: "available"`. If the public v2 projection is disabled,
missing, invalid, or cannot be read, the route returns HTTP 503 with an empty
feed-shaped response, `availability: "unavailable"`, `freshness: "unavailable"`,
`overall_state: "unknown"`, and `Cache-Control: no-store`. Consumers can therefore
distinguish no recorded events from unavailable telemetry; the route does not
fall back to owner data or claim operational health.
