import type { Metadata } from "next";
import { CircleAlert, CircleCheck, Clock3, ServerCog } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { CopyCommand } from "@/components/admin/CopyCommand";
import { isOwnerUser } from "@/lib/authz";
import { RUNBOOK_COMMANDS } from "@/lib/content/admin-view";
import { derivePublicMetrics, getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { deriveOverallPublicStatus } from "@/lib/metrics/status-page";

export const metadata: Metadata = {
  title: "Operations runbook",
  description: "Owner-only read-only deployment and verification runbook for Frontpage.",
};

export default async function AnsiblePage() {
  const session = await auth();
  if (!isOwnerUser(session?.user)) {
    redirect("/signin?callbackUrl=/ansible");
  }
  const metrics = derivePublicMetrics(readMetricsFromDir(getMetricsDir()));
  const overall = deriveOverallPublicStatus(metrics);
  const deployedVersion = process.env.VERSION || "dev";

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="max-w-3xl">
        <div className="flex items-center gap-2 text-sm text-[var(--role-info)]"><ServerCog className="h-4 w-4" aria-hidden="true" />READ-ONLY RUNBOOK</div>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)] sm:text-5xl">Frontpage operations</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Health-checked deployment with automatic rollback and a brief container replacement window. This page copies commands; it never executes them.</p>
      </header>

      <section className="mt-10" aria-labelledby="deployment-posture">
        <h2 id="deployment-posture" className="text-2xl font-semibold text-[var(--text)]">Current posture</h2>
        <dl className="mt-5 grid gap-px border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
          <PostureField label="Deployed version" value={deployedVersion} icon={Clock3} />
          <PostureField label="Public status" value={overall.label} icon={overall.kind === "operational" ? CircleCheck : CircleAlert} />
          <PostureField label="Metrics freshness" value={metrics.freshness} icon={metrics.freshness === "fresh" ? CircleCheck : CircleAlert} />
        </dl>
      </section>

      <section className="mt-12" aria-labelledby="standard-deploy">
        <h2 id="standard-deploy" className="text-2xl font-semibold text-[var(--text)]">Standard deploy</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">Run from the repository root after the intended main commit and image are available. The playbook records the previous image, replaces the container, checks app health, and restores the previous image on failure.</p>
        <div className="mt-5"><CopyCommand {...RUNBOOK_COMMANDS[0]} /></div>
      </section>

      <section className="mt-12" aria-labelledby="verify-deploy">
        <h2 id="verify-deploy" className="text-2xl font-semibold text-[var(--text)]">Verification</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {RUNBOOK_COMMANDS.slice(1).map((command) => <CopyCommand key={command.id} {...command} />)}
        </div>
      </section>

      <section className="mt-12 border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)] px-5 py-6">
        <h2 className="text-lg font-semibold text-[var(--role-warning)]">Rollback and maintenance window</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--text-muted)]">The current playbook stops and removes the running container before starting its replacement, so a short maintenance window is expected. If the new container does not become healthy, the recorded previous image is started automatically. Manual intervention remains an operator terminal task, not a web action.</p>
      </section>

      <div className="mt-12 space-y-4">
        <details className="border-y border-[var(--border)] py-4" open>
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Architecture reference</summary>
          <ol className="mt-4 grid gap-4 text-sm leading-6 text-[var(--text-muted)] md:grid-cols-4">
            <li><strong className="block text-[var(--text)]">1. GitHub</strong>CI validates source and publishes commit-addressed container images.</li>
            <li><strong className="block text-[var(--text)]">2. Ansible</strong>The inventory alias targets the managed host and applies the playbook.</li>
            <li><strong className="block text-[var(--text)]">3. Docker</strong>The previous image is recorded before the replacement container starts.</li>
            <li><strong className="block text-[var(--text)]">4. Health proof</strong>The app endpoint is polled before success; failed health triggers rollback.</li>
          </ol>
        </details>
        <details className="border-b border-[var(--border)] py-4">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Secret handling</summary>
          <div className="mt-4 max-w-3xl space-y-3 text-sm leading-6 text-[var(--text-muted)]">
            <p>GitHub OAuth, Auth.js, and publication credentials remain in encrypted Ansible Vault variables. The repository-local vault password file is ignored and must keep restrictive permissions.</p>
            <p>Never paste vault contents, tokens, environment dumps, raw host addresses, or private key paths into this page, logs, commits, or support notes.</p>
          </div>
        </details>
        <details className="border-b border-[var(--border)] py-4">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Metrics collector boundary</summary>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">The host collector writes schema-bound latest and history JSON. The application receives a read-only metrics mount and no Docker socket, shell, restart, prune, or deployment capability.</p>
        </details>
      </div>
    </div>
  );
}

function PostureField({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return (
    <div className="bg-[var(--surface-raised)] p-5">
      <dt className="flex items-center gap-2 text-xs text-[var(--text-subtle)]"><Icon className="h-4 w-4" aria-hidden="true" />{label}</dt>
      <dd className="mt-2 break-words font-mono text-sm capitalize text-[var(--text)]">{value}</dd>
    </div>
  );
}
