import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjects, getProject } from "@/lib/data";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TechBadge } from "@/components/ui/TechBadge";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getProjects().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return { title: "Not Found" };
  return {
    title: `${project.name} — Project`,
    description: project.shortDescription,
  };
}

export default async function ProjectDetail({ params }: Props) {
  const { slug } = await params;
  const project = getProject(slug);

  if (!project) notFound();

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-300 transition-colors mb-8"
      >
        ← Back to projects
      </Link>

      <div className="flex items-start justify-between mb-4">
        <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>

      <p className="text-zinc-400 leading-relaxed mb-8">
        {project.shortDescription}
      </p>

      <div className="grid sm:grid-cols-[1fr_auto] gap-10 mb-12">
        <div className="space-y-4 text-sm text-zinc-400 leading-relaxed">
          {project.longDescription.split("\n\n").map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="font-mono text-xs text-green-500 mb-2">Tech Stack</h3>
            <div className="flex flex-wrap gap-1.5">
              {project.techStack.map((tech) => (
                <TechBadge key={tech} tech={tech} />
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-mono text-xs text-green-500 mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1.5">
              {project.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-2 py-0.5 text-xs text-zinc-600 font-mono lowercase"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div>
            <h3 className="font-mono text-xs text-green-500 mb-2">Category</h3>
            <p className="text-xs text-zinc-400 capitalize">
              {project.category}
            </p>
          </div>

          {(project.repoUrl || project.liveUrl) && (
            <div>
              <h3 className="font-mono text-xs text-green-500 mb-2">Links</h3>
              <div className="flex flex-col gap-1.5">
                {project.repoUrl && (
                  <a
                    href={project.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-zinc-400 hover:text-green-400 transition-colors"
                  >
                    Repository →
                  </a>
                )}
                {project.liveUrl && (
                  <a
                    href={project.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-zinc-400 hover:text-green-400 transition-colors"
                  >
                    Live Site →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
