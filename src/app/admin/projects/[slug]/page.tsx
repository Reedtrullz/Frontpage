import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectEditor } from "@/components/admin/ProjectEditor";
import { readAdminContentView } from "@/lib/content/admin-view";

export default async function ProjectAdminPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const view = readAdminContentView();
  const project = view.projects.find((item) => item.slug === slug);
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
        <ProjectEditor initial={project} allProjects={view.projects} hasDraft={view.hasProjectsDraft} />
      </div>
    </div>
  );
}
