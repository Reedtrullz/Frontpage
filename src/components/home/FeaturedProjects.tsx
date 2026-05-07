import Link from "next/link";
import { ProjectCard } from "@/components/projects/ProjectCard";
import type { Project } from "@/data/projects";

interface FeaturedProjectsProps {
  projects: Project[];
}

export function FeaturedProjects({ projects }: FeaturedProjectsProps) {
  const featured = projects.filter((p) => p.featured);

  return (
    <section className="py-16 px-6 max-w-5xl mx-auto border-t border-zinc-800">
      <div className="flex items-center justify-between mb-8">
        <h2 className="font-mono text-sm text-green-500">
          Featured Projects
        </h2>
        <Link
          href="/projects"
          className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          View all →
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {featured.map((project) => (
          <ProjectCard key={project.slug} project={project} />
        ))}
      </div>
    </section>
  );
}
