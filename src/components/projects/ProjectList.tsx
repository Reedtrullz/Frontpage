"use client";

import { useMemo } from "react";
import { Search, SearchX, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  ProjectCategory,
  ProjectContent,
  ProjectLifecycle,
  ProjectMaturity,
} from "@/lib/content/schema";
import type { GitHubStats } from "@/lib/github-stats";
import {
  filterProjects,
  sortProjects,
  type ProjectSort,
} from "@/lib/projects/presentation";
import { ProjectCard } from "./ProjectCard";

const lifecycleOptions: Array<{ value: ProjectLifecycle | "all"; label: string }> = [
  { value: "all", label: "All lifecycle" },
  { value: "active", label: "Active" },
  { value: "maintained", label: "Maintained" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
];

const maturityOptions: Array<{ value: ProjectMaturity | "all"; label: string }> = [
  { value: "all", label: "All maturity" },
  { value: "flagship", label: "Flagship" },
  { value: "stable", label: "Stable" },
  { value: "experimental", label: "Experimental" },
  { value: "reference", label: "Reference" },
];

const categoryOptions: Array<{ value: ProjectCategory | "all"; label: string }> = [
  { value: "all", label: "All categories" },
  { value: "frontend", label: "Frontend" },
  { value: "tooling", label: "Tooling" },
  { value: "defi", label: "DeFi" },
  { value: "bot", label: "Bots" },
  { value: "infra", label: "Infrastructure" },
  { value: "wiki", label: "Knowledge" },
];

const sortOptions: Array<{ value: ProjectSort; label: string }> = [
  { value: "featured", label: "Featured first" },
  { value: "evidence", label: "Newest evidence" },
  { value: "name", label: "Name" },
];

function optionValue<T extends string>(
  value: string | null,
  options: ReadonlyArray<{ value: T; label: string }>,
  fallback: T,
): T {
  return options.some((option) => option.value === value)
    ? (value as T)
    : fallback;
}

interface ProjectListProps {
  projects: ProjectContent[];
  statsBySlug: Record<string, GitHubStats>;
  nowIso: string;
}

export function ProjectList({ projects, statsBySlug, nowIso }: ProjectListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const lifecycle = optionValue(
    searchParams.get("lifecycle"),
    lifecycleOptions,
    "all",
  );
  const maturity = optionValue(
    searchParams.get("maturity"),
    maturityOptions,
    "all",
  );
  const category = optionValue(
    searchParams.get("category"),
    categoryOptions,
    "all",
  );
  const sort = optionValue(searchParams.get("sort"), sortOptions, "featured");
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const filtered = useMemo(
    () =>
      sortProjects(
        filterProjects(projects, { query, lifecycle, maturity, category }),
        sort,
      ),
    [projects, query, lifecycle, maturity, category, sort],
  );

  function updateParam(name: string, value: string, defaultValue = "all") {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === defaultValue) next.delete(name);
    else next.set(name, value);
    const nextQuery = next.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }

  function clearFilters() {
    router.replace(pathname, { scroll: false });
  }

  const hasFilters =
    query !== "" ||
    lifecycle !== "all" ||
    maturity !== "all" ||
    category !== "all" ||
    sort !== "featured";

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-[var(--accent)]">PROJECT CATALOGUE</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)] sm:text-5xl">Published projects</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">
          Products, tools, and infrastructure with lifecycle, maturity, evidence, and limitations kept separate.
        </p>
      </header>

      <section aria-label="Project filters" className="mt-10 border-y border-[var(--border)] py-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_repeat(4,minmax(150px,auto))_44px]">
          <label className="relative">
            <span className="sr-only">Search projects</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--text-subtle)]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => updateParam("q", event.target.value, "")}
              placeholder="Search projects"
              className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] pl-10 pr-3 text-sm text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:border-[var(--focus)] focus:outline-none"
            />
          </label>
          <FilterSelect label="Lifecycle" value={lifecycle} options={lifecycleOptions} onChange={(value) => updateParam("lifecycle", value)} />
          <FilterSelect label="Maturity" value={maturity} options={maturityOptions} onChange={(value) => updateParam("maturity", value)} />
          <FilterSelect label="Category" value={category} options={categoryOptions} onChange={(value) => updateParam("category", value)} />
          <FilterSelect label="Sort" value={sort} options={sortOptions} onChange={(value) => updateParam("sort", value, "featured")} />
          <button
            type="button"
            onClick={clearFilters}
            disabled={!hasFilters}
            aria-label="Clear project filters"
            title="Clear filters"
            className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>

      <div className="mt-5 flex items-center justify-between gap-4 text-sm text-[var(--text-muted)]">
        <p aria-live="polite">{filtered.length} of {projects.length} projects</p>
        <p>Published posture</p>
      </div>

      {filtered.length > 0 ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          {filtered.map((project) => (
            <ProjectCard key={project.slug} project={project} stats={statsBySlug[project.slug]} now={now} />
          ))}
        </div>
      ) : (
        <div className="flex min-h-64 flex-col items-center justify-center border-b border-[var(--border)] text-center">
          <SearchX className="h-7 w-7 text-[var(--text-subtle)]" aria-hidden="true" />
          <h2 className="mt-4 text-lg font-semibold text-[var(--text)]">No matching projects</h2>
          <button type="button" onClick={clearFilters} className="mt-3 min-h-11 text-sm text-[var(--accent)] hover:text-[var(--role-positive)]">Clear filters</button>
        </div>
      )}
    </div>
  );
}

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--text)] focus:border-[var(--focus)] focus:outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
