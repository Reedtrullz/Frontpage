import Link from "next/link";
import type { PersonalData } from "@/data/personal";
import type { Project } from "@/data/projects";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { ProjectHealthRow } from "./ProjectHealthRow";
import { StatusToken } from "./StatusToken";
import { VpsStatusSummary } from "./VpsStatusSummary";

export function ProjectDashboard({
  personal,
  projects,
  statsBySlug,
  metrics,
}: {
  personal: PersonalData;
  projects: Project[];
  statsBySlug: Record<string, GitHubStats>;
  metrics: PublicMetricsModel;
}) {
  const activeCount = projects.filter((project) => project.status === "active")
    .length;
  const featured = projects.filter((project) => project.featured);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <section className="grid gap-6 border-b border-zinc-800 pb-10 lg:grid-cols-[1.35fr_0.65fr]">
        <div>
          <p className="mb-4 font-mono text-xs uppercase text-green-400">
            reidar.tech / project OS
          </p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-zinc-100 sm:text-5xl">
            Live workbench for projects, infra, and trust signals.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">
            {personal.bio}
          </p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">
                {projects.length}
              </div>
              <div className="font-mono text-xs text-zinc-600">projects</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">
                {activeCount}
              </div>
              <div className="font-mono text-xs text-zinc-600">active</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">
                {metrics.host.serviceSummary.up}
              </div>
              <div className="font-mono text-xs text-zinc-600">
                services up
              </div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">
                {metrics.host.lastUpdatedLabel}
              </div>
              <div className="font-mono text-xs text-zinc-600">metrics</div>
            </div>
          </div>
        </div>
        <VpsStatusSummary metrics={metrics} />
      </section>

      <section className="grid gap-6 border-b border-zinc-800 py-10 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm text-green-400">
              Project Operations
            </h2>
            <Link
              href="/projects"
              className="text-sm text-zinc-500 transition-colors hover:text-zinc-300"
            >
              View all
            </Link>
          </div>
          <div className="border-b border-zinc-800">
            {featured.map((project) => (
              <ProjectHealthRow
                key={project.slug}
                project={project}
                stats={statsBySlug[project.slug] ?? null}
                health={metrics.projectHealthBySlug[project.slug]}
              />
            ))}
          </div>
        </div>
        <aside className="border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="font-mono text-sm text-green-400">Recent Signals</h2>
          <div className="mt-4 space-y-3">
            {metrics.services.slice(0, 5).map((service) => (
              <div
                key={service.id}
                className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3"
              >
                <div>
                  <div className="font-mono text-xs text-zinc-200">
                    {service.label}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-600">
                    {service.latencyMs === null
                      ? "no latency"
                      : `${service.latencyMs}ms`}
                  </div>
                </div>
                <StatusToken value={service.status} />
              </div>
            ))}
            {metrics.services.length === 0 ? (
              <p className="border-t border-zinc-800 pt-3 text-sm text-zinc-500">
                No public service checks are configured.
              </p>
            ) : null}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 text-sm">
            <div>
              <dt className="font-mono text-xs text-zinc-600">host</dt>
              <dd className="text-zinc-200">{metrics.host.state}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-zinc-600">disk</dt>
              <dd className="text-zinc-200">{metrics.host.diskPressure}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </div>
  );
}
