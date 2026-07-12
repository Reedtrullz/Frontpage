"use client";

import type { IncidentV2 } from "@/lib/metrics/v2/types";

export function IncidentTimeline({
  incidents,
  selectedId,
  onSelect,
}: {
  incidents: IncidentV2[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ordered = [...incidents].sort((left, right) => {
    const rank = (state: IncidentV2["state"]) =>
      state === "active" ? 0 : state === "maintenance" ? 1 : 2;
    return rank(left.state) - rank(right.state) || right.updated_at.localeCompare(left.updated_at);
  });
  return (
    <section aria-labelledby="owner-incidents-heading" className="border-t border-[var(--border)] pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 id="owner-incidents-heading" className="text-xl font-semibold text-[var(--text)]">Incident timeline</h3>
        {selectedId ? (
          <button className="min-h-11 text-sm font-semibold text-[var(--accent)]" onClick={() => onSelect(null)} type="button">
            Show all markers
          </button>
        ) : null}
      </div>
      {ordered.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No owner incidents recorded.</p>
      ) : (
        <ol className="mt-4 border-y border-[var(--border)]">
          {ordered.map((incident) => (
            <li className="border-t border-[var(--border)] first:border-t-0" key={incident.id}>
              <button
                aria-pressed={selectedId === incident.id}
                className="grid min-h-11 w-full gap-2 py-4 text-left sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-start"
                onClick={() => onSelect(selectedId === incident.id ? null : incident.id)}
                type="button"
              >
                <span className="font-mono text-xs uppercase text-[var(--text-subtle)]">{incident.state}</span>
                <span>
                  <span className="block text-sm font-semibold text-[var(--text)]">{incident.title}</span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--text-muted)]">{incident.summary}</span>
                </span>
                <time className="text-xs text-[var(--text-subtle)]" dateTime={incident.updated_at}>
                  {new Date(incident.updated_at).toISOString().slice(0, 16).replace("T", " ")} UTC
                </time>
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
