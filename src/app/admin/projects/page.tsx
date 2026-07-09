import { ProjectWorkspaceList } from "@/components/admin/ProjectWorkspaceList";
import { readAdminContentView } from "@/lib/content/admin-view";

export default function ProjectsAdminPage() {
  const view = readAdminContentView();
  return (
    <div>
      <header className="max-w-3xl">
        <p className="font-mono text-sm text-[var(--role-info)]">OWNER / PROJECTS</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">Project content</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Open one compact editor at a time. Draft markers compare the saved project bundle with deployed canonical content.</p>
      </header>
      <div className="mt-10">
        <ProjectWorkspaceList projects={view.projects} markers={Object.fromEntries(view.projectMarkers)} />
      </div>
    </div>
  );
}
