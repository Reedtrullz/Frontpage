import Link from "next/link";
import type { Project } from "@/data/projects";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TechBadge } from "@/components/ui/TechBadge";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="block p-5 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-900 hover:border-zinc-700 transition-colors group"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-mono text-sm text-green-400 group-hover:text-green-300 transition-colors">
          {project.name}
        </h3>
        <StatusBadge status={project.status} />
      </div>
      <p className="text-sm text-zinc-400 leading-relaxed mb-4 line-clamp-3">
        {project.shortDescription}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {project.techStack.slice(0, 4).map((tech) => (
          <TechBadge key={tech} tech={tech} />
        ))}
        {project.techStack.length > 4 && (
          <span className="inline-block px-2.5 py-0.5 text-xs text-zinc-600 font-mono">
            +{project.techStack.length - 4}
          </span>
        )}
      </div>
    </Link>
  );
}
