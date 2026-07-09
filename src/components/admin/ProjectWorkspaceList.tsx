"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import type { ProjectContent } from "@/lib/content/schema";
import type { ProjectDraftMarker } from "@/lib/content/admin-view";
import { PostureBadge } from "@/components/ui/PostureBadge";

export function ProjectWorkspaceList({
  projects,
  markers,
}: {
  projects: ProjectContent[];
  markers: Record<string, ProjectDraftMarker>;
}) {
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState("all");
  const [maturity, setMaturity] = useState("all");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (normalized && !`${project.name} ${project.slug} ${project.outcome}`.toLowerCase().includes(normalized)) return false;
      if (lifecycle !== "all" && project.lifecycle !== lifecycle) return false;
      if (maturity !== "all" && project.maturity !== maturity) return false;
      return true;
    });
  }, [projects, query, lifecycle, maturity]);

  return (
    <div>
      <section aria-label="Project editor filters" className="grid gap-3 border-y border-[var(--border)] py-4 md:grid-cols-[minmax(220px,1fr)_180px_180px]">
        <label className="relative">
          <span className="sr-only">Search editable projects</span>
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--text-subtle)]" aria-hidden="true" />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] pl-10 pr-3 text-sm text-[var(--text)] focus:border-[var(--focus)] focus:outline-none" />
        </label>
        <label>
          <span className="sr-only">Lifecycle</span>
          <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)} className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text)]">
            <option value="all">All lifecycle</option>
            {['active', 'maintained', 'paused', 'archived'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span className="sr-only">Maturity</span>
          <select value={maturity} onChange={(event) => setMaturity(event.target.value)} className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text)]">
            <option value="all">All maturity</option>
            {['flagship', 'stable', 'experimental', 'reference'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </section>
      <p className="mt-4 text-sm text-[var(--text-muted)]">{filtered.length} of {projects.length} editable projects</p>
      <div className="mt-4 border-y border-[var(--border)]">
        {filtered.map((project) => (
          <Link key={project.slug} href={`/admin/projects/${project.slug}`} className="grid gap-4 border-t border-[var(--border)] px-1 py-5 first:border-t-0 hover:bg-[var(--surface-raised)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center md:px-3">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-[var(--text)]">{project.name}</h2>
              <p className="mt-1 line-clamp-1 text-sm text-[var(--text-muted)]">{project.outcome}</p>
            </div>
            <div className="flex flex-wrap gap-2"><PostureBadge dimension="lifecycle" value={project.lifecycle} /><PostureBadge dimension="maturity" value={project.maturity} /></div>
            <span className={`text-xs ${markers[project.slug] && markers[project.slug] !== "unchanged" ? "text-[var(--role-info)]" : "text-[var(--text-subtle)]"}`}>
              {markers[project.slug] === "modified" ? "Draft changed" : markers[project.slug] === "added" ? "Draft added" : "Published"}
            </span>
            <ArrowRight className="h-4 w-4 text-[var(--text-subtle)]" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </div>
  );
}
