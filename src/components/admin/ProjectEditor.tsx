"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Save, Trash2 } from "lucide-react";
import {
  projectSchema,
  projectGallerySchema,
  projectMilestonesSchema,
  preserveProjectSlugAliases,
  type ProjectContent,
  type ProjectMedia,
} from "@/lib/content/schema";
import { ProjectDetailContent } from "@/components/projects/ProjectDetailContent";
import { PostureBadge } from "@/components/ui/PostureBadge";
import {
  EditorSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./EditorFields";
import { confirmUnsavedNavigation, useUnsavedChanges } from "./useUnsavedChanges";

function asLines(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}

function issueLines(
  project: ProjectContent,
  galleryJson: string,
  milestonesJson: string,
  allProjects: ProjectContent[],
  originalSlug: string,
): { candidate: ProjectContent | null; issues: string[] } {
  let candidate: unknown = project;
  let galleryIssues: string[] = [];
  let milestonesIssues: string[] = [];
  let milestones: unknown;
  try { milestones = JSON.parse(milestonesJson); }
  catch { milestones = undefined; }
  const milestonesResult = projectMilestonesSchema.safeParse(milestones);
  milestonesIssues = milestonesResult.success ? [] : milestonesResult.error.issues.map((issue) => `milestones${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`);
  const nextCandidate: Record<string, unknown> = { ...project, milestones: milestonesResult.success && milestonesResult.data.length ? milestonesResult.data : undefined };
  if (project.media) {
    let parsed: unknown;
    try { parsed = JSON.parse(galleryJson); }
    catch { parsed = undefined; }
    const galleryResult = projectGallerySchema.safeParse(parsed);
    galleryIssues = galleryResult.success ? [] : galleryResult.error.issues.map((issue) => `media.gallery${issue.path.length ? `.${issue.path.join(".")}` : ""}: ${issue.message}`);
    nextCandidate.media = { cover: project.media.cover, gallery: galleryResult.success ? galleryResult.data : [] };
  }
  candidate = nextCandidate;

  const result = projectSchema.safeParse(candidate);
  const issues = [...(result.success
    ? []
    : result.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      })), ...galleryIssues, ...milestonesIssues];
  const effectiveProject = result.success ? preserveProjectSlugAliases(result.data, originalSlug) : null;
  if (
    project.slug !== originalSlug &&
    allProjects.some((item) => item.slug === project.slug || item.aliases?.includes(project.slug))
  ) {
    issues.push("slug: Must be unique across projects.");
  }
  if (originalSlug && project.slug !== originalSlug) {
    const aliases = effectiveProject?.aliases ?? [];
    if (aliases.length > 32) issues.push("aliases: At most 32 historical slugs are allowed.");
    for (const alias of aliases) {
      if (allProjects.some((item) => item.slug === alias && item.slug !== originalSlug || item.aliases?.includes(alias) && item.slug !== originalSlug)) {
        issues.push(`aliases: ${alias} is already used by another project.`);
      }
    }
  }
  const allowedHealthIds = new Set(
    allProjects.flatMap((item) => item.healthServiceIds ?? []),
  );
  for (const id of project.healthServiceIds ?? []) {
    if (!allowedHealthIds.has(id)) {
      issues.push(`healthServiceIds: ${id || "Blank value"} is not in the configured safe allowlist.`);
    }
  }
  return {
    candidate: effectiveProject && issues.length === 0 ? effectiveProject : null,
    issues,
  };
}

export function ProjectEditor({
  initial,
  allProjects,
  hasDraft,
  initialRevision,
  previewNow,
}: {
  initial: ProjectContent;
  allProjects: ProjectContent[];
  hasDraft: boolean;
  initialRevision: string | null;
  previewNow: string;
}) {
  const router = useRouter();
  const [revision, setRevision] = useState(initialRevision);
  const originalSlug = initial.slug;
  const [project, setProject] = useState(initial);
  const [galleryJson, setGalleryJson] = useState(
    JSON.stringify(initial.media?.gallery ?? [], null, 2),
  );
  const [milestonesJson, setMilestonesJson] = useState(JSON.stringify(initial.milestones ?? [], null, 2));
  const initialBaseline = JSON.stringify({ project: initial, galleryJson: JSON.stringify(initial.media?.gallery ?? [], null, 2), milestonesJson: JSON.stringify(initial.milestones ?? [], null, 2) });
  const [baseline, setBaseline] = useState(initialBaseline);
  const [draftExists, setDraftExists] = useState(hasDraft);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const validation = useMemo(
    () => issueLines(project, galleryJson, milestonesJson, allProjects, originalSlug),
    [project, galleryJson, milestonesJson, allProjects, originalSlug],
  );
  const galleryIssues = validation.issues.filter((issue) => issue.startsWith("media.gallery"));
  const milestoneIssues = validation.issues.filter((issue) => issue.startsWith("milestones"));
  const fieldIssue = (path: string) => validation.issues.find((issue) => issue.startsWith(`${path}:`) || issue.startsWith(`${path}.`));
  const invalid = (path: string) => Boolean(fieldIssue(path));
  const dirty = JSON.stringify({ project, galleryJson, milestonesJson }) !== baseline;
  useUnsavedChanges(dirty);

  function updateCover(update: Partial<ProjectMedia["cover"]>) {
    if (!project.media) return;
    setProject({
      ...project,
      media: { ...project.media, cover: { ...project.media.cover, ...update } },
    });
  }

  async function saveDraft() {
    if (!validation.candidate) {
      setMessage("Resolve validation issues before saving.");
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    const exists = allProjects.some((item) => item.slug === originalSlug);
    const nextProjects = exists
      ? allProjects.map((item) => item.slug === originalSlug ? validation.candidate! : item)
      : [...allProjects, validation.candidate!];
    try {
      const response = await fetch("/api/data/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({content: nextProjects, expectedRevision: revision}),
      });
      const body = (await response.json()) as { error?: string; revision?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The project draft could not be saved.");
        return;
      }
      setProject(validation.candidate);
      setBaseline(JSON.stringify({ project: validation.candidate, galleryJson, milestonesJson }));
      setRevision(body.revision ?? null);
      setDraftExists(true);
      setMessage("Projects draft saved locally. It is not published.");
      if (!exists || validation.candidate.slug !== originalSlug) {
        router.replace(`/admin/projects/${validation.candidate.slug}`);
      } else {
        router.refresh();
      }
    } catch {
      setMessage("The save request failed. Your project edits remain in this editor; retry when connected.");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!confirmUnsavedNavigation(dirty)) return;
    if (!window.confirm("Discard every saved project draft change across the entire projects bundle?")) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/data/projects", { method: "DELETE", headers: {"Content-Type":"application/json"}, body: JSON.stringify({expectedRevision: revision}) });
      if (!response.ok) {
        setMessage("The projects draft could not be discarded.");
        return;
      }
      setRevision(null);
      setDraftExists(false);
      setMessage("Projects draft discarded. Published content is unchanged.");
      router.replace("/admin/projects");
      router.refresh();
    } catch {
      setMessage("The projects draft could not be discarded because the request failed. Your editor values are still available; retry when connected.");
    } finally {
      setBusy(false);
    }
  }

  async function archiveProject() {
    if (dirty) {
      setMessage("Save or discard the current editor changes first. Archiving then changes only lifecycle in the saved project bundle.");
      return;
    }
    if (!window.confirm(`Archive ${project.name}? This changes its lifecycle in the project draft and preserves its history and evidence.`)) return;
    const savedProject = allProjects.find((item) => item.slug === originalSlug);
    if (!savedProject) return;
    const candidate = { ...savedProject, lifecycle: "archived" as const };
    setProject(candidate);
    const projects = allProjects.map((item) => item.slug === originalSlug ? candidate : item);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/data/projects", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: projects, expectedRevision: revision }) });
      const body = await response.json() as { error?: string; revision?: string };
      if (!response.ok) { setMessage(body.error ?? "The project could not be archived in the draft."); return; }
      setBaseline(JSON.stringify({ project: candidate, galleryJson, milestonesJson }));
      setRevision(body.revision ?? null);
      setDraftExists(true);
      setMessage("Project archived in the local draft. Existing URLs and evidence are preserved; publish the reviewed bundle to make this public.");
      router.refresh();
    } catch {
      setMessage("The archive request failed. The project remains in the editor; retry when connected.");
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={(event) => { event.preventDefault(); void saveDraft(); }} className="space-y-10">
        <EditorSection title="Identity and outcome">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" id="project-name" aria-invalid={invalid("name")} aria-describedby={invalid("name") ? "project-name-error" : undefined} value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} />
            <TextField label="Slug" id="project-slug" aria-invalid={invalid("slug") || invalid("aliases")} aria-describedby={invalid("slug") || invalid("aliases") ? "project-slug-error" : undefined} value={project.slug} onChange={(event) => setProject({ ...project, slug: event.target.value })} hint="Lowercase URL-safe and unique." />
          </div>
          <TextAreaField label="Outcome" id="project-outcome" aria-invalid={invalid("outcome")} aria-describedby={invalid("outcome") ? "project-outcome-error" : undefined} rows={3} value={project.outcome} onChange={(event) => setProject({ ...project, outcome: event.target.value })} />
          {fieldIssue("outcome") ? <p id="project-outcome-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("outcome")}</p> : null}
          <TextAreaField label="Short description" id="project-short-description" aria-invalid={invalid("shortDescription")} aria-describedby={invalid("shortDescription") ? "project-short-description-error" : undefined} rows={4} value={project.shortDescription} onChange={(event) => setProject({ ...project, shortDescription: event.target.value })} />
          {fieldIssue("shortDescription") ? <p id="project-short-description-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("shortDescription")}</p> : null}
          <TextAreaField label="Long description" id="project-long-description" aria-invalid={invalid("longDescription")} aria-describedby={invalid("longDescription") ? "project-long-description-error" : undefined} rows={7} value={project.longDescription} onChange={(event) => setProject({ ...project, longDescription: event.target.value })} />
          {fieldIssue("longDescription") ? <p id="project-long-description-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("longDescription")}</p> : null}
        </EditorSection>

        <EditorSection title="Posture">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SelectField label="Lifecycle" value={project.lifecycle} onChange={(event) => setProject({ ...project, lifecycle: event.target.value as ProjectContent["lifecycle"] })}>
              {['active', 'maintained', 'paused', 'archived'].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
            <SelectField label="Maturity" value={project.maturity} onChange={(event) => setProject({ ...project, maturity: event.target.value as ProjectContent["maturity"] })}>
              {['flagship', 'stable', 'experimental', 'reference'].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
            <SelectField label="Category" value={project.category} onChange={(event) => setProject({ ...project, category: event.target.value as ProjectContent["category"] })}>
              {['defi', 'bot', 'frontend', 'tooling', 'infra', 'wiki'].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
            <TextField label="Featured rank" type="number" min={1} max={99} value={project.featuredRank ?? ""} onChange={(event) => setProject({ ...project, featuredRank: event.target.value ? Number(event.target.value) : undefined })} />
          </div>
        </EditorSection>

        <EditorSection title="Structured sections" description="One published item per line.">
          <TextAreaField label="What it solves" id="project-solves" aria-invalid={invalid("sections.whatItSolves")} aria-describedby={invalid("sections.whatItSolves") ? "project-solves-error" : undefined} rows={4} value={project.sections.whatItSolves.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, whatItSolves: asLines(event.target.value) } })} />
          {fieldIssue("sections.whatItSolves") ? <p id="project-solves-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("sections.whatItSolves")}</p> : null}
          <TextAreaField label="Current state" id="project-current-state" aria-invalid={invalid("sections.currentState")} aria-describedby={invalid("sections.currentState") ? "project-current-state-error" : undefined} rows={4} value={project.sections.currentState.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, currentState: asLines(event.target.value) } })} />
          {fieldIssue("sections.currentState") ? <p id="project-current-state-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("sections.currentState")}</p> : null}
          <TextAreaField label="How it works" id="project-how-it-works" aria-invalid={invalid("sections.howItWorks")} aria-describedby={invalid("sections.howItWorks") ? "project-how-it-works-error" : undefined} rows={4} value={project.sections.howItWorks.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, howItWorks: asLines(event.target.value) } })} />
          {fieldIssue("sections.howItWorks") ? <p id="project-how-it-works-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("sections.howItWorks")}</p> : null}
          <TextAreaField label="Next priorities" rows={4} value={(project.sections.nextPriorities ?? []).join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, nextPriorities: asLines(event.target.value) } })} />
          <TextAreaField label="Limitations" rows={5} value={project.limitations.join("\n")} onChange={(event) => setProject({ ...project, limitations: asLines(event.target.value) })} />
        </EditorSection>

        <EditorSection title="Taxonomy and links">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Tags" rows={6} value={project.tags.join("\n")} onChange={(event) => setProject({ ...project, tags: asLines(event.target.value) })} hint="One unique tag per line." />
            <TextAreaField label="Technology" rows={6} value={project.techStack.join("\n")} onChange={(event) => setProject({ ...project, techStack: asLines(event.target.value) })} hint="One unique technology per line." />
            <TextField label="Repository URL" type="url" value={project.repoUrl ?? ""} onChange={(event) => setProject({ ...project, repoUrl: event.target.value || undefined })} />
            <TextField label="Live URL" type="url" value={project.liveUrl ?? ""} onChange={(event) => setProject({ ...project, liveUrl: event.target.value || undefined })} />
          </div>
          <TextAreaField label="Health service IDs" rows={4} value={(project.healthServiceIds ?? []).join("\n")} onChange={(event) => setProject({ ...project, healthServiceIds: asLines(event.target.value) })} hint="Only collector allowlist IDs are safe to bind." />
        </EditorSection>

        <EditorSection title="Evidence">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Evidence level" value={project.evidence.level} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, level: event.target.value as ProjectContent["evidence"]["level"] } })}>
              {['source-reviewed', 'ci-verified', 'live-verified'].map((value) => <option key={value} value={value}>{value}</option>)}
            </SelectField>
            <TextField label="Reviewed at (UTC)" id="project-reviewed-at" aria-invalid={invalid("evidence.reviewedAt")} aria-describedby={invalid("evidence.reviewedAt") ? "project-reviewed-at-error" : undefined} value={project.evidence.reviewedAt} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, reviewedAt: event.target.value } })} />
            {fieldIssue("evidence.reviewedAt") ? <p id="project-reviewed-at-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("evidence.reviewedAt")}</p> : null}
            <TextField label="Commit SHA" value={project.evidence.commitSha ?? ""} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, commitSha: event.target.value || undefined } })} />
            <TextField label="Evidence URL" type="url" value={project.evidence.url ?? ""} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, url: event.target.value || undefined } })} />
          </div>
          <TextAreaField label="Evidence note" id="project-evidence-note" aria-invalid={invalid("evidence.note")} aria-describedby={invalid("evidence.note") ? "project-evidence-note-error" : undefined} rows={4} value={project.evidence.note} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, note: event.target.value } })} />
          {fieldIssue("evidence.note") ? <p id="project-evidence-note-error" className="text-sm text-[var(--role-failure)]">{fieldIssue("evidence.note")}</p> : null}
        </EditorSection>

        <EditorSection title="Project timeline (optional)" description="Add only curated milestones with source, CI, or live evidence references. Dates record occurrence and review separately; no Git activity is promoted automatically. Maximum 20 entries.">
          <TextAreaField label="Milestones JSON" id="project-milestones" aria-invalid={milestoneIssues.length > 0} aria-describedby={milestoneIssues.length ? "project-milestones-error" : undefined} rows={10} value={milestonesJson} onChange={(event) => setMilestonesJson(event.target.value)} hint='Use [] for no timeline. Required fields: id, occurredAt, title, summary, scope, evidenceUrl, reviewedAt; optional: commitSha.' />
          {milestoneIssues.length ? <p id="project-milestones-error" className="text-sm text-[var(--role-failure)]">{milestoneIssues.join(" ")}</p> : null}
        </EditorSection>

        <EditorSection title="Media" description="Media remains optional. Gallery entries use the canonical media-item JSON shape.">
          <label className="flex min-h-11 items-center gap-3 text-sm text-[var(--text)]">
            <input type="checkbox" checked={Boolean(project.media)} onChange={(event) => setProject({
              ...project,
              media: event.target.checked
                ? project.media ?? { cover: { src: `/projects/${project.slug}/cover.webp`, alt: "", width: 1440, height: 900 } }
                : undefined,
            })} className="h-4 w-4 accent-[var(--accent)]" />
            Publish project media metadata
          </label>
          {project.media ? (
            <>
              <TextField label="Cover source" value={project.media.cover.src} onChange={(event) => updateCover({ src: event.target.value })} />
              <TextAreaField label="Cover alt text" rows={3} value={project.media.cover.alt} onChange={(event) => updateCover({ alt: event.target.value })} />
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField label="Width" type="number" min={1} value={project.media.cover.width} onChange={(event) => updateCover({ width: Number(event.target.value) })} />
                <TextField label="Height" type="number" min={1} value={project.media.cover.height} onChange={(event) => updateCover({ height: Number(event.target.value) })} />
                <TextField label="Caption" value={project.media.cover.caption ?? ""} onChange={(event) => updateCover({ caption: event.target.value || undefined })} />
              </div>
              <TextAreaField label="Gallery JSON" id="project-gallery" aria-invalid={galleryIssues.length > 0} aria-describedby={galleryIssues.length ? "project-gallery-error" : undefined} rows={8} value={galleryJson} onChange={(event) => setGalleryJson(event.target.value)} />
              {galleryIssues.length ? <p id="project-gallery-error" className="text-sm text-[var(--role-failure)]">{galleryIssues.join(" ")}</p> : null}
            </>
          ) : null}
        </EditorSection>

        <div className="flex flex-wrap items-center gap-3 border-y border-[var(--border)] bg-[var(--surface)] py-4 sm:sticky sm:bottom-0 sm:z-10">
          <button type="submit" disabled={busy || !dirty} className="primary-command disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" aria-hidden="true" />{busy ? "Saving" : "Save project draft"}</button>
          <button type="button" onClick={() => setPreview((value) => !value)} className="secondary-command">{preview ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{preview ? "Hide preview" : "Preview"}</button>
          {draftExists ? <button type="button" onClick={discardDraft} disabled={busy} className="secondary-command text-[var(--role-failure)]"><Trash2 className="h-4 w-4" aria-hidden="true" />Discard all project drafts</button> : null}
          {initial.slug && project.lifecycle !== "archived" ? <button type="button" onClick={archiveProject} disabled={busy || !validation.candidate} className="secondary-command">Archive project</button> : null}
          <span className="text-xs text-[var(--text-subtle)]">{dirty ? "Unsaved changes" : draftExists ? "Draft saved" : "Canonical content"}</span>
        </div>
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">{message}</p>
      </form>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <h2 className="text-lg font-semibold text-[var(--text)]">Validation</h2>
        {validation.issues.length ? (
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto border-l-2 border-[var(--role-failure)] pl-4 text-sm text-[var(--role-failure)]">{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        ) : <p className="mt-3 text-sm text-[var(--role-positive)]">All project fields validate.</p>}
        {invalid("name") ? <p id="project-name-error" className="sr-only">{validation.issues.filter((issue) => issue.startsWith("name:")).join(" ")}</p> : null}
        {validation.issues.some((issue) => issue.startsWith("slug:") || issue.startsWith("aliases:")) ? <p id="project-slug-error" className="sr-only">{validation.issues.filter((issue) => issue.startsWith("slug:") || issue.startsWith("aliases:")).join(" ")}</p> : null}
        {preview ? (
          <div className="mt-8 border-y border-[var(--border)] py-5">
            <p className="mb-5 font-mono text-xs text-[var(--accent)]">DRAFT PREVIEW · NOT PUBLIC</p>
            <p className="font-mono text-xs uppercase text-[var(--text-subtle)]">{project.category} / {project.slug}</p>
            <h2 className="mb-4 mt-2 text-3xl font-semibold text-[var(--text)]">{project.name}</h2>
            <p className="mb-3 text-base leading-7 text-[var(--text)]">{project.outcome}</p>
            <p className="mb-5 text-sm leading-6 text-[var(--text-muted)]">{project.shortDescription}</p>
            <div className="mb-5 flex flex-wrap gap-2"><PostureBadge dimension="lifecycle" value={project.lifecycle} /><PostureBadge dimension="maturity" value={project.maturity} /><PostureBadge dimension="evidence" value={project.evidence.level} /></div>
            {(project.liveUrl || project.repoUrl) ? <div className="mb-5 flex flex-wrap gap-3">{project.liveUrl ? <a className="secondary-command" href={project.liveUrl} target="_blank" rel="noopener noreferrer">Open live product</a> : null}{project.repoUrl ? <a className="secondary-command" href={project.repoUrl} target="_blank" rel="noopener noreferrer">View repository</a> : null}</div> : null}
            <p className="mb-4 text-xs text-[var(--text-subtle)]">Runtime health comes from live public metrics and is not simulated in this draft preview.</p>
            <ProjectDetailContent project={validation.candidate ?? project} now={new Date(previewNow)} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
