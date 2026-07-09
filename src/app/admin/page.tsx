import Link from "next/link";
import { ArrowRight, FileText, FolderKanban, ServerCog } from "lucide-react";
import { ContentStateSummary } from "@/components/admin/ContentStateSummary";
import { PublishPanel } from "@/components/admin/PublishPanel";
import { readAdminContentView } from "@/lib/content/admin-view";

export default function AdminPage() {
  const view = readAdminContentView();
  return (
    <div>
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-[var(--role-info)]">OWNER OVERVIEW</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">Content workspace</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Draft locally, review exact changes, publish one atomic Git commit, then verify deployment separately.</p>
      </header>

      <div className="mt-10"><ContentStateSummary view={view} /></div>

      <section className="mt-12" aria-labelledby="workspace-destinations">
        <h2 id="workspace-destinations" className="text-2xl font-semibold text-[var(--text)]">Workspace</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <WorkspaceLink href="/admin/personal" title="Personal content" description="Identity, bio, scope, skills, and social links." icon={FileText} state={view.hasPersonalDraft ? "Draft saved" : "Published"} />
          <WorkspaceLink href="/admin/projects" title="Projects" description="Project posture, evidence, media, sections, and limitations." icon={FolderKanban} state={view.hasProjectsDraft ? "Draft saved" : "Published"} />
          <WorkspaceLink href="/ansible" title="Operations" description="Read-only deployment, verification, and rollback runbook." icon={ServerCog} state="Read only" />
        </div>
      </section>

      <div className="mt-12">
        <PublishPanel state={view.publicationState} receipt={view.receipt} diff={view.diff} hasDraft={view.draftCount > 0} />
      </div>
    </div>
  );
}

function WorkspaceLink({ href, title, description, icon: Icon, state }: { href: string; title: string; description: string; icon: typeof FileText; state: string }) {
  return (
    <Link href={href} className="group relative rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] p-5 hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
      <Icon className="h-5 w-5 text-[var(--role-info)]" aria-hidden="true" />
      <h3 className="mt-4 text-lg font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{description}</p>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs text-[var(--text-subtle)]"><span>{state}</span><ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" /></div>
    </Link>
  );
}
