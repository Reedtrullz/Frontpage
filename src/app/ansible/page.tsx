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
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Main branch CI deploys the Cloudflare Worker after checks pass. This page copies verification commands; it never executes them.</p>
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
        <h2 id="standard-deploy" className="text-2xl font-semibold text-[var(--text)]">Cloudflare deploy</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">A push to main runs the build, browser, Docker, and Cloudflare deployment checks. Inspect the CI result and compare the live health version with the main commit.</p>
        <div className="mt-5"><CopyCommand {...RUNBOOK_COMMANDS[0]} /></div>
      </section>

      <section className="mt-12" aria-labelledby="verify-deploy">
        <h2 id="verify-deploy" className="text-2xl font-semibold text-[var(--text)]">Verification</h2>
        <div className="mt-5 grid gap-4 lg:grid-cols-3">
          {RUNBOOK_COMMANDS.slice(1).map((command) => <CopyCommand key={command.id} {...command} />)}
        </div>
      </section>

      <section className="mt-12 border-y border-[var(--role-warning-border)] bg-[var(--role-warning-soft)] px-5 py-6">
        <h2 className="text-lg font-semibold text-[var(--role-warning)]">VPS rollback</h2>
        <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--text-muted)]">The VPS app playbook is reserved for an intentional rollback. Restore the saved Caddy route and DNS, then run it with an immutable image SHA and FRONTPAGE_VPS_ROLLBACK=1. The metrics collectors and protected proposals origin remain on the VPS.</p>
      </section>

      <div className="mt-12 space-y-4">
        <details className="border-y border-[var(--border)] py-4" open>
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Architecture reference</summary>
          <ol className="mt-4 grid gap-4 text-sm leading-6 text-[var(--text-muted)] md:grid-cols-4">
            <li><strong className="block text-[var(--text)]">1. GitHub</strong>CI validates source and publishes an immutable container image for rollback.</li>
            <li><strong className="block text-[var(--text)]">2. Cloudflare</strong>CI deploys the exact main commit to the Worker and checks its health version.</li>
            <li><strong className="block text-[var(--text)]">3. Durable Object</strong>Owner drafts, receipts, and metrics snapshots persist in SQLite storage.</li>
            <li><strong className="block text-[var(--text)]">4. VPS</strong>Collectors upload metrics and the protected proposals origin serves its separate backend.</li>
          </ol>
        </details>
        <details className="border-b border-[var(--border)] py-4">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Secret handling</summary>
          <div className="mt-4 max-w-3xl space-y-3 text-sm leading-6 text-[var(--text-muted)]">
            <p>Worker credentials are Cloudflare secrets sourced from 1Password. The encrypted Ansible Vault and local password file remain restricted rollback assets.</p>
            <p>Never paste vault contents, tokens, environment dumps, raw host addresses, or private key paths into this page, logs, commits, or support notes.</p>
          </div>
        </details>
        <details className="border-b border-[var(--border)] py-4">
          <summary className="min-h-11 cursor-pointer text-lg font-semibold text-[var(--text)]">Metrics collector boundary</summary>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">The host collector writes schema-bound latest and history JSON. A separate uploader sends compressed snapshots to the Worker; the site has no Docker socket, shell, restart, prune, or deployment capability.</p>
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
