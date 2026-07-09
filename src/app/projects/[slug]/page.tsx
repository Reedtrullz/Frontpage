import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  GitFork,
  TriangleAlert,
} from "lucide-react";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { ProjectMedia } from "@/components/ui/ProjectMedia";
import { RelativeTime } from "@/components/ui/RelativeTime";
import {
  getCanonicalProject,
  getCanonicalProjects,
} from "@/lib/content";
import type { ProjectContent } from "@/lib/content/schema";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getCanonicalProjects().map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = getCanonicalProject(slug);
  if (!project) return { title: "Project not found" };
  return {
    title: project.name,
    description: project.shortDescription,
    openGraph: project.media
      ? { images: [{ url: project.media.cover.src, alt: project.media.cover.alt }] }
      : undefined,
  };
}

function relatedProjects(project: ProjectContent): ProjectContent[] {
  return getCanonicalProjects()
    .filter((candidate) => candidate.slug !== project.slug)
    .toSorted((left, right) => {
      const leftMatch = left.category === project.category ? 0 : 1;
      const rightMatch = right.category === project.category ? 0 : 1;
      return (
        leftMatch - rightMatch ||
        (left.featuredRank ?? 999) - (right.featuredRank ?? 999) ||
        left.name.localeCompare(right.name)
      );
    })
    .slice(0, 3);
}

function DetailSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="border-t border-[var(--border)] pt-7">
      <h2 className="text-xl font-semibold text-[var(--text)]">{title}</h2>
      <ul className="mt-4 space-y-3 text-base leading-7 text-[var(--text-muted)]">
        {items.map((item) => (
          <li key={item} className="flex gap-3">
            <span className="mt-3 h-1.5 w-1.5 shrink-0 bg-[var(--accent)]" aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProjectDetail({ params }: Props) {
  const { slug } = await params;
  const project = getCanonicalProject(slug);
  if (!project) notFound();
  const related = relatedProjects(project);
  const now = new Date();

  return (
    <article>
      <header className="mx-auto max-w-7xl px-4 pb-10 pt-10 sm:px-6 sm:pb-14 sm:pt-14">
        <Link href="/projects" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All projects
        </Link>
        <div className="mt-7 max-w-4xl">
          <p className="font-mono text-sm uppercase text-[var(--accent)]">{project.category} / {project.slug}</p>
          <h1 className="mt-3 text-4xl font-semibold text-[var(--text)] sm:text-6xl">{project.name}</h1>
          <p className="mt-5 max-w-3xl text-xl leading-8 text-[var(--text)]">{project.outcome}</p>
          <p className="mt-4 max-w-3xl text-base leading-7 text-[var(--text-muted)]">{project.shortDescription}</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <PostureBadge dimension="lifecycle" value={project.lifecycle} />
            <PostureBadge dimension="maturity" value={project.maturity} />
            <PostureBadge dimension="evidence" value={project.evidence.level} />
          </div>
          {(project.liveUrl || project.repoUrl) ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {project.liveUrl ? (
                <a href={project.liveUrl} target="_blank" rel="noreferrer" className="primary-command">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open live product
                </a>
              ) : null}
              {project.repoUrl ? (
                <a href={project.repoUrl} target="_blank" rel="noreferrer" className="secondary-command">
                  <GitFork className="h-4 w-4" aria-hidden="true" />
                  View repository
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {project.media ? (
        <div className="mx-auto max-w-7xl border-y border-[var(--border)] bg-[var(--surface-raised)] sm:border-x">
          <ProjectMedia media={project.media.cover} priority showCaption sizes="(min-width: 1280px) 1200px, 100vw" />
        </div>
      ) : null}

      <div className="mx-auto grid max-w-7xl gap-12 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-10">
          <p className="text-lg leading-8 text-[var(--text-muted)]">{project.longDescription}</p>
          <DetailSection title="What it solves" items={project.sections.whatItSolves} />
          <DetailSection title="Current state" items={project.sections.currentState} />
          <DetailSection title="How it works" items={project.sections.howItWorks} />
          {project.sections.nextPriorities?.length ? (
            <DetailSection title="Next priorities" items={project.sections.nextPriorities} />
          ) : null}
        </div>

        <aside className="border-t border-[var(--border)] pt-8 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <dl className="space-y-7 text-sm">
            <div>
              <dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Evidence reviewed</dt>
              <dd className="mt-2 text-[var(--text)]">
                <RelativeTime value={project.evidence.reviewedAt} now={now} />
              </dd>
              <dd className="mt-2 leading-6 text-[var(--text-muted)]">{project.evidence.note}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Technology</dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {project.techStack.map((tech) => (
                  <span key={tech} className="rounded border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">{tech}</span>
                ))}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-xs uppercase text-[var(--text-subtle)]">Tags</dt>
              <dd className="mt-2 leading-6 text-[var(--text-muted)]">{project.tags.join(" / ")}</dd>
            </div>
          </dl>
        </aside>
      </div>

      {project.limitations.length ? (
        <section className="border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)]">
          <div className="mx-auto max-w-7xl px-4 py-9 sm:px-6">
            <div className="flex gap-4">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--role-warning)]" aria-hidden="true" />
              <div>
                <h2 className="text-lg font-semibold text-[var(--role-warning)]">Current limitations</h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-[var(--text-muted)]">
                  {project.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
                </ul>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
        <h2 className="text-2xl font-semibold text-[var(--text)]">Related projects</h2>
        <div className="mt-6 grid gap-0 border-y border-[var(--border)] md:grid-cols-3 md:divide-x md:divide-[var(--border)]">
          {related.map((item) => (
            <Link key={item.slug} href={`/projects/${item.slug}`} className="group flex min-h-40 flex-col justify-between border-b border-[var(--border)] p-5 last:border-b-0 md:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]">
              <div>
                <p className="font-mono text-xs uppercase text-[var(--text-subtle)]">{item.category}</p>
                <h3 className="mt-2 text-lg font-semibold text-[var(--text)]">{item.name}</h3>
              </div>
              <span className="mt-5 inline-flex items-center gap-2 text-sm text-[var(--accent)]">
                View project <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>
    </article>
  );
}
