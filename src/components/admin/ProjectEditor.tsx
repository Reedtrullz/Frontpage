"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Save, Trash2 } from "lucide-react";
import {
  projectSchema,
  type ProjectContent,
  type ProjectMedia,
} from "@/lib/content/schema";
import { PostureBadge } from "@/components/ui/PostureBadge";
import {
  EditorSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./EditorFields";
import { useUnsavedChanges } from "./useUnsavedChanges";

function asLines(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}

function issueLines(
  project: ProjectContent,
  galleryJson: string,
  allProjects: ProjectContent[],
  originalSlug: string,
): { candidate: ProjectContent | null; issues: string[] } {
  let candidate: unknown = project;
  if (project.media) {
    try {
      const gallery = galleryJson.trim()
        ? (JSON.parse(galleryJson) as unknown)
        : [];
      candidate = {
        ...project,
        media: {
          cover: project.media.cover,
          ...(Array.isArray(gallery) && gallery.length > 0 ? { gallery } : {}),
        },
      };
    } catch {
      return { candidate: null, issues: ["media.gallery: Must be valid JSON."] };
    }
  }

  const result = projectSchema.safeParse(candidate);
  const issues = result.success
    ? []
    : result.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      });
  if (
    project.slug !== originalSlug &&
    allProjects.some((item) => item.slug === project.slug)
  ) {
    issues.push("slug: Must be unique across projects.");
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
    candidate: result.success && issues.length === 0 ? result.data : null,
    issues,
  };
}

export function ProjectEditor({
  initial,
  allProjects,
  hasDraft,
}: {
  initial: ProjectContent;
  allProjects: ProjectContent[];
  hasDraft: boolean;
}) {
  const router = useRouter();
  const originalSlug = initial.slug;
  const [project, setProject] = useState(initial);
  const [galleryJson, setGalleryJson] = useState(
    JSON.stringify(initial.media?.gallery ?? [], null, 2),
  );
  const initialBaseline = JSON.stringify({ project: initial, galleryJson: JSON.stringify(initial.media?.gallery ?? [], null, 2) });
  const [baseline, setBaseline] = useState(initialBaseline);
  const [draftExists, setDraftExists] = useState(hasDraft);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const validation = useMemo(
    () => issueLines(project, galleryJson, allProjects, originalSlug),
    [project, galleryJson, allProjects, originalSlug],
  );
  const dirty = JSON.stringify({ project, galleryJson }) !== baseline;
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
      return;
    }
    setBusy(true);
    setMessage("");
    const nextProjects = allProjects.map((item) =>
      item.slug === originalSlug ? validation.candidate! : item,
    );
    try {
      const response = await fetch("/api/data/projects", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextProjects),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The project draft could not be saved.");
        return;
      }
      setProject(validation.candidate);
      setBaseline(JSON.stringify({ project: validation.candidate, galleryJson }));
      setDraftExists(true);
      setMessage("Projects draft saved locally. It is not published.");
      if (validation.candidate.slug !== originalSlug) {
        router.replace(`/admin/projects/${validation.candidate.slug}`);
      } else {
        router.refresh();
      }
    } catch {
      setMessage("The project draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!window.confirm("Discard every saved project draft change?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/data/projects", { method: "DELETE" });
      if (!response.ok) {
        setMessage("The projects draft could not be discarded.");
        return;
      }
      setDraftExists(false);
      setMessage("Projects draft discarded. Published content is unchanged.");
      router.replace("/admin/projects");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={(event) => { event.preventDefault(); void saveDraft(); }} className="space-y-10">
        <EditorSection title="Identity and outcome">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={project.name} onChange={(event) => setProject({ ...project, name: event.target.value })} />
            <TextField label="Slug" value={project.slug} onChange={(event) => setProject({ ...project, slug: event.target.value })} hint="Lowercase URL-safe and unique." />
          </div>
          <TextAreaField label="Outcome" rows={3} value={project.outcome} onChange={(event) => setProject({ ...project, outcome: event.target.value })} />
          <TextAreaField label="Short description" rows={4} value={project.shortDescription} onChange={(event) => setProject({ ...project, shortDescription: event.target.value })} />
          <TextAreaField label="Long description" rows={7} value={project.longDescription} onChange={(event) => setProject({ ...project, longDescription: event.target.value })} />
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
          <TextAreaField label="What it solves" rows={4} value={project.sections.whatItSolves.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, whatItSolves: asLines(event.target.value) } })} />
          <TextAreaField label="Current state" rows={4} value={project.sections.currentState.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, currentState: asLines(event.target.value) } })} />
          <TextAreaField label="How it works" rows={4} value={project.sections.howItWorks.join("\n")} onChange={(event) => setProject({ ...project, sections: { ...project.sections, howItWorks: asLines(event.target.value) } })} />
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
            <TextField label="Reviewed at (UTC)" value={project.evidence.reviewedAt} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, reviewedAt: event.target.value } })} />
            <TextField label="Commit SHA" value={project.evidence.commitSha ?? ""} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, commitSha: event.target.value || undefined } })} />
            <TextField label="Evidence URL" type="url" value={project.evidence.url ?? ""} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, url: event.target.value || undefined } })} />
          </div>
          <TextAreaField label="Evidence note" rows={4} value={project.evidence.note} onChange={(event) => setProject({ ...project, evidence: { ...project.evidence, note: event.target.value } })} />
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
              <TextAreaField label="Gallery JSON" rows={8} value={galleryJson} onChange={(event) => setGalleryJson(event.target.value)} />
            </>
          ) : null}
        </EditorSection>

        <div className="flex flex-wrap items-center gap-3 border-y border-[var(--border)] bg-[var(--surface)] py-4 sm:sticky sm:bottom-0 sm:z-10">
          <button type="submit" disabled={busy || !dirty || !validation.candidate} className="primary-command disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" aria-hidden="true" />{busy ? "Saving" : "Save project draft"}</button>
          <button type="button" onClick={() => setPreview((value) => !value)} className="secondary-command">{preview ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{preview ? "Hide preview" : "Preview"}</button>
          {draftExists ? <button type="button" onClick={discardDraft} disabled={busy} className="secondary-command text-[var(--role-failure)]"><Trash2 className="h-4 w-4" aria-hidden="true" />Discard all project drafts</button> : null}
          <span className="text-xs text-[var(--text-subtle)]">{dirty ? "Unsaved changes" : draftExists ? "Draft saved" : "Canonical content"}</span>
        </div>
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">{message}</p>
      </form>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <h2 className="text-lg font-semibold text-[var(--text)]">Validation</h2>
        {validation.issues.length ? (
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto border-l-2 border-[var(--role-failure)] pl-4 text-sm text-[var(--role-failure)]">{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        ) : <p className="mt-3 text-sm text-[var(--role-positive)]">All project fields validate.</p>}
        {preview ? (
          <div className="mt-8 border-y border-[var(--border)] py-5">
            <p className="font-mono text-xs text-[var(--accent)]">DRAFT PREVIEW</p>
            <h3 className="mt-3 text-3xl font-semibold text-[var(--text)]">{project.name}</h3>
            <p className="mt-3 text-base leading-7 text-[var(--text)]">{project.outcome}</p>
            <div className="mt-4 flex flex-wrap gap-2"><PostureBadge dimension="lifecycle" value={project.lifecycle} /><PostureBadge dimension="maturity" value={project.maturity} /></div>
            <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">{project.shortDescription}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
