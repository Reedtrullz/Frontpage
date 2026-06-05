"use client";

import { useState } from "react";
import { ProjectCard } from "@/components/projects/ProjectCard";
import type { Project, ProjectCategory } from "@/data/projects";
import type { GitHubStats } from "@/lib/github-stats";

const categories: { value: ProjectCategory | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "defi", label: "DeFi" },
  { value: "bot", label: "Bots" },
  { value: "frontend", label: "Frontend" },
  { value: "tooling", label: "Tooling" },
  { value: "wiki", label: "Wiki" },
  { value: "infra", label: "Infra" },
];

const Tags = [
  "thorchain",
  "arbitrage",
  "dashboard",
  "discord",
  "swap",
  "monitoring",
  "mobile",
  "aviation",
  "hermes",
  "macos",
  "pwa",
];

interface ProjectListProps {
  projects: Project[];
  statsBySlug: Record<string, GitHubStats>;
}

export function ProjectList({ projects, statsBySlug }: ProjectListProps) {
  const [selectedCategory, setSelectedCategory] = useState<
    ProjectCategory | "all"
  >("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);

  const toggleTag = (tag: string) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const filtered = projects.filter((project) => {
    if (selectedCategory !== "all" && project.category !== selectedCategory)
      return false;
    if (
      activeTags.length > 0 &&
      !activeTags.some((tag) => project.tags.includes(tag))
    )
      return false;
    return true;
  });

  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold tracking-tight mb-2">Projects</h1>
      <p className="text-sm text-zinc-500 mb-10">
        {filtered.length} of {projects.length} projects shown
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {categories.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() => setSelectedCategory(cat.value)}
            aria-pressed={selectedCategory === cat.value}
            className={`px-3 py-1.5 rounded text-xs font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
              selectedCategory === cat.value
                ? "bg-green-500/10 text-green-400 border border-green-500/30"
                : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-10">
        {Tags.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggleTag(tag)}
            aria-pressed={activeTags.includes(tag)}
            className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 ${
              activeTags.includes(tag)
                ? "bg-green-500/20 text-green-400 border border-green-500/20"
                : "bg-zinc-900/50 text-zinc-600 border border-zinc-800 hover:text-zinc-400"
            }`}
          >
            #{tag}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((project) => (
          <ProjectCard
            key={project.slug}
            project={project}
            stats={statsBySlug[project.slug] ?? null}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-zinc-600 text-sm py-16 text-center">
          No projects match the selected filters.
        </p>
      )}
    </div>
  );
}
