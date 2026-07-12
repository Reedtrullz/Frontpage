import type { PublicStatusV2Model } from "@/lib/metrics/v2/public-status";

export function PublicIncidentHistory({ model }: { model: PublicStatusV2Model }) {
  const events = [
    ...model.maintenance.map((window) => ({
      id: `maintenance-${window.id}`,
      label: window.status === "active" ? "Maintenance" : window.status === "planned" ? "Planned" : "Completed",
      title: window.title,
      description: window.description,
      timestamp: window.startsAt,
    })),
    ...model.recentIncidents.map((incident) => ({
      id: `incident-${incident.id}`,
      label: incident.state === "recovered" ? "Recovered" : incident.state === "active" ? "Active" : "Maintenance",
      title: incident.title,
      description: incident.summary,
      timestamp: incident.updatedAt,
    })),
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  if (events.length === 0) return null;
  return (
    <section aria-labelledby="public-events-heading" className="border-t border-[var(--border)] py-12 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <p className="font-mono text-sm text-[var(--accent)]">PUBLIC HISTORY</p>
        <h2 id="public-events-heading" className="mt-2 text-2xl font-semibold text-[var(--text)]">Recent events</h2>
        <ol className="mt-6 border-y border-[var(--border)]">
          {events.map((event) => (
            <li className="grid gap-2 border-t border-[var(--border)] py-5 first:border-t-0 sm:grid-cols-[110px_minmax(0,1fr)_160px]" key={event.id}>
              <span className="font-mono text-xs uppercase text-[var(--text-subtle)]">{event.label}</span>
              <span>
                <span className="block text-sm font-semibold text-[var(--text)]">{event.title}</span>
                <span className="mt-1 block text-sm leading-6 text-[var(--text-muted)]">{event.description}</span>
              </span>
              <time className="text-xs text-[var(--text-subtle)] sm:text-right" dateTime={event.timestamp}>
                {new Date(event.timestamp).toISOString().slice(0, 16).replace("T", " ")} UTC
              </time>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
