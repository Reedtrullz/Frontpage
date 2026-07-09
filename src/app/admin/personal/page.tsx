import { PersonalEditor } from "@/components/admin/PersonalEditor";
import { readAdminContentView } from "@/lib/content/admin-view";

export default function PersonalAdminPage() {
  const view = readAdminContentView();
  return (
    <div>
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-[var(--role-info)]">OWNER / PERSONAL</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">Personal content</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Changes save to the local owner draft. Public pages remain canonical until explicit publication and deployment.</p>
      </header>
      <div className="mt-10">
        <PersonalEditor initial={view.personal} canonical={view.canonicalPersonal} hasDraft={view.hasPersonalDraft} />
      </div>
    </div>
  );
}
