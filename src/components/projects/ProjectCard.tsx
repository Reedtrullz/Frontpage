"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Project } from "@/data/projects";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TechBadge } from "@/components/ui/TechBadge";
import type { GitHubStats } from "@/lib/github-stats";

interface ProjectCardProps {
  project: Project;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function Stars({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500 font-mono">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
      {count}
    </span>
  );
}

function GitStats({ stats }: { stats: GitHubStats | null }) {
  if (!stats || (!stats.language && !stats.lastCommitDate && !stats.stars)) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 mt-3 pt-3 border-t border-zinc-800/50">
      {stats.stars > 0 && <Stars count={stats.stars} />}
      {stats.language && stats.language !== "—" && (
        <span className="inline-flex items-center gap-1 text-xs text-zinc-500 font-mono">
          <span
            className="w-2 h-2 rounded-full inline-block"
            style={{ backgroundColor: langColor(stats.language) }}
          />
          {stats.language}
        </span>
      )}
      {stats.lastCommitDate && (
        <span className="text-xs text-zinc-600 font-mono" title={stats.lastCommitMessage ?? undefined}>
          {timeAgo(stats.lastCommitDate)}
        </span>
      )}
    </div>
  );
}

// GitHub language colors — common ones
function langColor(lang: string): string {
  const colors: Record<string, string> = {
    TypeScript: "#3178c6",
    JavaScript: "#f1e05a",
    Python: "#3572a5",
    Swift: "#f05138",
    CSS: "#563d7c",
    HTML: "#e34c26",
    Go: "#00ADD8",
    Rust: "#dea584",
    Shell: "#89e051",
  };
  return colors[lang] ?? "#8b949e";
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [stats, setStats] = useState<GitHubStats | null>(null);

  useEffect(() => {
    if (!project.repoUrl) return;
    let cancelled = false;

    fetch("/api/github/stats")
      .then((r) => r.json())
      .then((data: Record<string, GitHubStats>) => {
        if (!cancelled && data[project.slug]) {
          setStats(data[project.slug]);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [project.slug, project.repoUrl]);

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
      <GitStats stats={stats} />
    </Link>
  );
}
