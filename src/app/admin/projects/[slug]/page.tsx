import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectEditor } from "@/components/admin/ProjectEditor";
import { readAdminContentView } from "@/lib/content/admin-view";
import type { ProjectContent } from "@/lib/content/schema";

function blankProject(): ProjectContent {
  return { slug: "", name: "", outcome: "", shortDescription: "", longDescription: "", lifecycle: "active", maturity: "experimental", category: "tooling", tags: [], techStack: [], evidence: { reviewedAt: "", level: "source-reviewed", note: "" }, sections: { whatItSolves: [""], currentState: [""], howItWorks: [""] }, limitations: [] };
}

export default async function ProjectAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = readAdminContentView();
  const previewNow = new Date().toISOString();
  const project = view.projects.find((item) => item.slug === slug);
  if (slug === "new" && !project) return (
    <div>
      <Link href="/admin/projects" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-muted)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All project editors</Link>
      <header className="mt-5 max-w-3xl"><p className="font-mono text-sm text-[var(--role-info)]">OWNER / NEW PROJECT</p><h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">Create project draft</h1><p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Required editorial fields start empty so no project facts or evidence are invented. Complete validation, save locally, then preview and review the bundle diff.</p></header>
      <div className="mt-10"><ProjectEditor initial={blankProject()} allProjects={view.projects} hasDraft={view.hasProjectsDraft} initialRevision={view.reviewedRevisions.projects} previewNow={previewNow} /></div>
    </div>
  );
  if (!project) notFound();
  return (
    <div>
      <Link href="/admin/projects" className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" />All project editors</Link>
      <header className="mt-5 max-w-3xl">
        <p className="font-mono text-sm text-[var(--role-info)]">OWNER / PROJECT EDITOR</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">{project.name}</h1>
        <p className="mt-4 text-base leading-7 text-[var(--text-muted)]">Every canonical field is editable here. Saving writes the complete validated project bundle as one local draft.</p>
      </header>
      <div className="mt-10">
        <ProjectEditor initial={project} allProjects={view.projects} hasDraft={view.hasProjectsDraft} initialRevision={view.reviewedRevisions.projects} previewNow={previewNow} />
      </div>
    </div>
  );
}
