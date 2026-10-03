import { TriangleAlert } from "lucide-react";
import { ProjectMedia } from "@/components/ui/ProjectMedia";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { evidenceReference, evidenceReviewAge, sortProjectMilestones } from "@/lib/projects/presentation";
import type { ProjectContent } from "@/lib/content/schema";

function DetailSection({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="border-t border-[var(--border)] pt-7">
      <h2 className="text-xl font-semibold text-[var(--text)]">{title}</h2>
      <ul className="mt-4 space-y-3 text-base leading-7 text-[var(--text-muted)]">
        {items.map((item, index) => <li key={`${index}:${item}`} className="flex gap-3"><span className="mt-3 h-1.5 w-1.5 shrink-0 bg-[var(--accent)]" aria-hidden="true" /><span>{item}</span></li>)}
      </ul>
    </section>
  );
}

export function ProjectDetailContent({ project, now }: { project: ProjectContent; now: Date }) {
  const age = evidenceReviewAge(project.evidence.reviewedAt, now);
  const reference = evidenceReference(project.evidence);
  return (
    <>
      {project.media ? (
        <div className="mx-auto max-w-7xl border-y border-[var(--border)] bg-[var(--surface-raised)] sm:border-x">
          <ProjectMedia media={project.media.cover} priority showCaption sizes="(min-width: 1280px) 1200px, 100vw" />
          {project.media.gallery?.length ? <section aria-label={`${project.name} image gallery`} className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {project.media.gallery.map((item, index) => <a key={`${item.src}:${index}`} href={item.src} target="_blank" rel="noopener noreferrer" className="block min-h-11 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"><ProjectMedia media={item} showCaption sizes="(min-width: 1024px) 33vw, 100vw" /></a>)}
          </section> : null}
        </div>
      ) : null}
      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-10">
          <p className="text-lg leading-8 text-[var(--text-muted)]">{project.longDescription}</p>
          <DetailSection title="What it solves" items={project.sections.whatItSolves} />
          <DetailSection title="Current state" items={project.sections.currentState} />
          <DetailSection title="How it works" items={project.sections.howItWorks} />
          {project.sections.nextPriorities?.length ? <DetailSection title="Next priorities" items={project.sections.nextPriorities} /> : null}
          {project.milestones?.length ? <section aria-labelledby="project-timeline-heading" className="border-t border-[var(--border)] pt-7">
            <h2 id="project-timeline-heading" className="text-xl font-semibold text-[var(--text)]">Project timeline</h2>
            <ol className="mt-4 space-y-5 border-l border-[var(--border)] pl-5">
              {sortProjectMilestones(project.milestones).map((milestone) => <li key={milestone.id} className="relative"><span className="absolute -left-[1.6rem] top-2 h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" /><p className="text-xs font-mono text-[var(--text-subtle)]">{milestone.occurredAt} · {milestone.scope}</p><h3 className="mt-1 font-semibold text-[var(--text)]">{milestone.title}</h3><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{milestone.summary}</p><a className="mt-2 inline-flex min-h-11 items-center text-sm text-[var(--accent)] underline" href={milestone.evidenceUrl} target="_blank" rel="noopener noreferrer">Evidence{milestone.commitSha ? ` · ${milestone.commitSha}` : ""}</a><p className="text-xs text-[var(--text-subtle)]">Evidence reviewed {milestone.reviewedAt.slice(0, 10)}</p></li>)}
            </ol>
          </section> : null}
        </div>
        <aside className="border-t border-[var(--border)] pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <dl className="space-y-7 text-sm">
            <div><dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Evidence reviewed</dt><dd className="mt-2 text-[var(--text)]">{age.kind === "known" ? `${age.days} days ago` : age.kind === "invalid" ? "Review date invalid" : "Review age unknown"}</dd><dd className="mt-1 text-[var(--text-subtle)]">Review age does not change project posture or verification scope.</dd><dd className="mt-2 text-[var(--text-muted)]">{project.evidence.note}</dd></div>
            <div><dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Evidence scope</dt><dd className="mt-2"><PostureBadge dimension="evidence" value={reference.scope} /></dd>
              {reference.url ? <dd className="mt-2"><a href={reference.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center break-all text-[var(--accent)] underline">Open evidence reference</a></dd> : <dd className="mt-2 text-[var(--text-subtle)]">No evidence URL recorded.</dd>}
              {reference.commitSha ? <dd className="mt-1 font-mono text-xs text-[var(--text-muted)]">Commit {reference.commitSha}</dd> : null}
            </div>
            <div><dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Technology</dt><dd className="mt-2 flex flex-wrap gap-2">{project.techStack.map((tech) => <span key={tech} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">{tech}</span>)}</dd></div>
            <div><dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Tags</dt><dd className="mt-2 leading-6 text-[var(--text-muted)]">{project.tags.join(" / ")}</dd></div>
          </dl>
        </aside>
      </div>
      {project.limitations.length ? <section className="border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)]"><div className="mx-auto max-w-7xl px-4 py-9 sm:px-6"><div className="flex gap-4"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--role-warning)]" aria-hidden="true" /><div><h2 className="text-lg font-semibold text-[var(--role-warning)]">Current limitations</h2><ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-muted)]">{project.limitations.map((item, index) => <li key={`${index}:${item}`}>{item}</li>)}</ul></div></div></div></section> : null}
    </>
  );
}
