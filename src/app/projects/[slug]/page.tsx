import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  ArrowUpRight,
  ExternalLink,
  GitFork,
} from "lucide-react";
import { PostureBadge } from "@/components/ui/PostureBadge";
import { ProjectDetailContent } from "@/components/projects/ProjectDetailContent";
import { permanentRedirect } from "next/navigation";
import { getCanonicalProjects } from "@/lib/content";
import { resolveProjectSlug, type ProjectContent } from "@/lib/content/schema";
import { derivePublicMetrics, getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { deriveProjectHealth } from "@/lib/metrics/status-page";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getCanonicalProjects().flatMap((project) => [project.slug, ...(project.aliases ?? [])].map((slug) => ({ slug })));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const resolution = resolveProjectSlug(slug, getCanonicalProjects());
  if (resolution.kind === "not-found") return { title: "Project not found" };
  const project = resolution.project;
  return {
    title: project.name,
    description: project.shortDescription,
    alternates: { canonical: `/projects/${project.slug}` },
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

export default async function ProjectDetail({ params }: Props) {
  const { slug } = await params;
  const resolution = resolveProjectSlug(slug, getCanonicalProjects());
  if (resolution.kind === "not-found") notFound();
  if (resolution.kind === "redirect") permanentRedirect(`/projects/${resolution.project.slug}`);
  const project = resolution.project;
  const related = relatedProjects(project);
  const now = new Date();
  const metrics = derivePublicMetrics(readMetricsFromDir(getMetricsDir(), now), now);
  const health = deriveProjectHealth(project, metrics.services, metrics.freshness);

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
            <PostureBadge dimension="health" value={health} />
            <PostureBadge dimension="evidence" value={project.evidence.level} />
          </div>
          {(project.liveUrl || project.repoUrl) ? (
            <div className="mt-8 flex flex-wrap gap-3">
              {project.liveUrl ? (
                <a href={project.liveUrl} target="_blank" rel="noopener noreferrer" className="primary-command">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  Open live product
                </a>
              ) : null}
              {project.repoUrl ? (
                <a href={project.repoUrl} target="_blank" rel="noopener noreferrer" className="secondary-command">
                  <GitFork className="h-4 w-4" aria-hidden="true" />
                  View repository
                </a>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <ProjectDetailContent project={project} now={now} />

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
