import Link from "next/link";
import { CheckCircle2, CircleAlert, TriangleAlert } from "lucide-react";
import type { OwnerAttentionItem } from "@/lib/metrics/status-page";

export function OwnerAttentionSummary({
  items,
}: {
  items: OwnerAttentionItem[];
}) {
  if (items.length === 0) {
    return (
      <section className="border-y border-[var(--role-positive-border)] bg-[var(--role-positive-soft)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-7xl items-start gap-3 text-[var(--role-positive)]">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">No attention needed</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Freshness, resource thresholds, services, and allowlisted containers are healthy.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)]">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="flex items-center gap-3 text-[var(--role-warning)]">
          <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Owner attention</h2>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="border border-[var(--role-warning-border)] bg-[var(--surface)] p-4">
              <div className="flex items-start gap-3">
                <CircleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${item.severity === "critical" ? "text-[var(--role-failure)]" : "text-[var(--role-warning)]"}`} aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">{item.label}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{item.reason}</p>
                  <Link href={item.destination.href} className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                    {item.destination.label}
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
