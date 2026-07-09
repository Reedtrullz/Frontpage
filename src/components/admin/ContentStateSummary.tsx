import { CircleAlert, CircleCheck, Clock3, FilePenLine } from "lucide-react";
import type { AdminContentView } from "@/lib/content/admin-view";
import { RelativeTime } from "@/components/ui/RelativeTime";

const stateClasses: Record<AdminContentView["publicationState"]["kind"], string> = {
  clean: "text-[var(--text-muted)]",
  "draft-saved": "text-[var(--role-info)]",
  "awaiting-deploy": "text-[var(--role-warning)]",
  deployed: "text-[var(--role-positive)]",
  conflict: "text-[var(--role-failure)]",
  "publish-failed": "text-[var(--role-failure)]",
};

export function ContentStateSummary({ view }: { view: AdminContentView }) {
  const validationValid = view.validation.personal.valid && view.validation.projects.valid;
  return (
    <section aria-labelledby="content-state-heading">
      <div className="flex items-center gap-3">
        <FilePenLine className="h-5 w-5 text-[var(--role-info)]" aria-hidden="true" />
        <h2 id="content-state-heading" className="text-2xl font-semibold text-[var(--text)]">Content state</h2>
      </div>
      <dl className="mt-6 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
        <StateField label="Publication" value={view.publicationState.label} className={stateClasses[view.publicationState.kind]} />
        <StateField label="Deployed version" value={view.deployedVersion} mono />
        <StateField label="Saved drafts" value={String(view.draftCount)} />
        <StateField label="Draft base" value={view.draftBaseVersion ?? "No draft"} mono />
      </dl>
      <div className="mt-4 flex flex-col gap-3 border-y border-[var(--border)] py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {validationValid ? (
            <CircleCheck className="h-4 w-4 text-[var(--role-positive)]" aria-hidden="true" />
          ) : (
            <CircleAlert className="h-4 w-4 text-[var(--role-failure)]" aria-hidden="true" />
          )}
          <span className="text-[var(--text)]">
            {validationValid ? "Canonical fields validate" : "Validation needs attention"}
          </span>
        </div>
        {view.receipt ? (
          <div className="flex items-center gap-2 text-[var(--text-muted)]">
            <Clock3 className="h-4 w-4" aria-hidden="true" />
            Latest {view.receipt.kind} <RelativeTime value={view.receipt.recordedAt} />
          </div>
        ) : (
          <span className="text-[var(--text-subtle)]">No publication receipt</span>
        )}
      </div>
    </section>
  );
}

function StateField({
  label,
  value,
  className = "text-[var(--text)]",
  mono = false,
}: {
  label: string;
  value: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className="bg-[var(--surface-raised)] p-4">
      <dt className="text-xs text-[var(--text-subtle)]">{label}</dt>
      <dd className={`mt-2 break-words text-sm font-semibold ${mono ? "font-mono" : ""} ${className}`}>{value}</dd>
    </div>
  );
}
