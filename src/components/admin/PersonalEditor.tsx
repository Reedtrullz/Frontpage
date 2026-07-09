"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Plus, Save, Trash2 } from "lucide-react";
import {
  personalSchema,
  type PersonalContent,
} from "@/lib/content/schema";
import {
  EditorSection,
  TextAreaField,
  TextField,
} from "./EditorFields";
import { useUnsavedChanges } from "./useUnsavedChanges";

function issueText(input: unknown): string[] {
  const result = personalSchema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

export function PersonalEditor({
  initial,
  canonical,
  hasDraft,
}: {
  initial: PersonalContent;
  canonical: PersonalContent;
  hasDraft: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [baseline, setBaseline] = useState(JSON.stringify(initial));
  const [draftExists, setDraftExists] = useState(hasDraft);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const issues = useMemo(() => issueText(data), [data]);
  const dirty = JSON.stringify(data) !== baseline;
  useUnsavedChanges(dirty);

  function updateList(
    key: "whatIDo" | "skills",
    index: number,
    value: string,
  ) {
    const values = [...data[key]];
    values[index] = value;
    setData({ ...data, [key]: values });
  }

  async function saveDraft() {
    if (issues.length) {
      setMessage("Resolve validation issues before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/data/personal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = (await response.json()) as { error?: string; savedAt?: string };
      if (!response.ok) {
        setMessage(body.error ?? "The draft could not be saved.");
        return;
      }
      setBaseline(JSON.stringify(data));
      setDraftExists(true);
      setMessage("Personal draft saved locally. It is not published.");
      router.refresh();
    } catch {
      setMessage("The draft could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!window.confirm("Discard the saved personal draft?")) return;
    setBusy(true);
    try {
      const response = await fetch("/api/data/personal", { method: "DELETE" });
      if (!response.ok) {
        setMessage("The saved draft could not be discarded.");
        return;
      }
      setData(canonical);
      setBaseline(JSON.stringify(canonical));
      setDraftExists(false);
      setMessage("Personal draft discarded. Published content is unchanged.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_360px]">
      <form onSubmit={(event) => { event.preventDefault(); void saveDraft(); }} className="space-y-10">
        <EditorSection title="Identity">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Name" value={data.name} onChange={(event) => setData({ ...data, name: event.target.value })} />
            <TextField label="Title" value={data.title} onChange={(event) => setData({ ...data, title: event.target.value })} />
          </div>
          <TextField label="Location" value={data.location} onChange={(event) => setData({ ...data, location: event.target.value })} />
          <TextAreaField label="Bio" rows={5} value={data.bio} onChange={(event) => setData({ ...data, bio: event.target.value })} />
        </EditorSection>

        <EditorSection title="What I build" description="Each line becomes one published scope statement.">
          {data.whatIDo.map((item, index) => (
            <div key={index} className="flex items-end gap-2">
              <TextField label={`Statement ${index + 1}`} value={item} onChange={(event) => updateList("whatIDo", index, event.target.value)} containerClassName="flex-1" />
              <IconButton label={`Remove statement ${index + 1}`} onClick={() => setData({ ...data, whatIDo: data.whatIDo.filter((_, itemIndex) => itemIndex !== index) })} icon={Trash2} />
            </div>
          ))}
          <button type="button" onClick={() => setData({ ...data, whatIDo: [...data.whatIDo, ""] })} className="secondary-command w-fit"><Plus className="h-4 w-4" aria-hidden="true" />Add statement</button>
        </EditorSection>

        <EditorSection title="Skills">
          <div className="grid gap-3 sm:grid-cols-2">
            {data.skills.map((skill, index) => (
              <div key={index} className="flex items-end gap-2">
                <TextField label={`Skill ${index + 1}`} value={skill} onChange={(event) => updateList("skills", index, event.target.value)} containerClassName="flex-1" />
                <IconButton label={`Remove ${skill || `skill ${index + 1}`}`} onClick={() => setData({ ...data, skills: data.skills.filter((_, itemIndex) => itemIndex !== index) })} icon={Trash2} />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setData({ ...data, skills: [...data.skills, ""] })} className="secondary-command w-fit"><Plus className="h-4 w-4" aria-hidden="true" />Add skill</button>
        </EditorSection>

        <EditorSection title="Social links">
          {data.socials.map((social, index) => (
            <div key={index} className="grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-[180px_minmax(0,1fr)_44px]">
              <TextField label="Label" value={social.label} onChange={(event) => {
                const socials = [...data.socials];
                socials[index] = { ...social, label: event.target.value };
                setData({ ...data, socials });
              }} />
              <TextField label="URL" type="url" value={social.url} onChange={(event) => {
                const socials = [...data.socials];
                socials[index] = { ...social, url: event.target.value };
                setData({ ...data, socials });
              }} />
              <IconButton label={`Remove ${social.label || "social link"}`} onClick={() => setData({ ...data, socials: data.socials.filter((_, itemIndex) => itemIndex !== index) })} icon={Trash2} />
            </div>
          ))}
          <button type="button" onClick={() => setData({ ...data, socials: [...data.socials, { label: "", url: "" }] })} className="secondary-command w-fit"><Plus className="h-4 w-4" aria-hidden="true" />Add social link</button>
        </EditorSection>

        <div className="flex flex-wrap items-center gap-3 border-y border-[var(--border)] bg-[var(--surface)] py-4 sm:sticky sm:bottom-0 sm:z-10">
          <button type="submit" disabled={busy || !dirty || issues.length > 0} className="primary-command disabled:cursor-not-allowed disabled:opacity-40"><Save className="h-4 w-4" aria-hidden="true" />{busy ? "Saving" : "Save draft"}</button>
          <button type="button" onClick={() => setPreview((value) => !value)} className="secondary-command">
            {preview ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            {preview ? "Hide preview" : "Preview"}
          </button>
          {draftExists ? <button type="button" onClick={discardDraft} disabled={busy} className="secondary-command text-[var(--role-failure)]"><Trash2 className="h-4 w-4" aria-hidden="true" />Discard draft</button> : null}
          <span className="text-xs text-[var(--text-subtle)]">{dirty ? "Unsaved changes" : draftExists ? "Draft saved" : "Canonical content"}</span>
        </div>
        <p aria-live="polite" className="text-sm text-[var(--text-muted)]">{message}</p>
      </form>

      <aside className="xl:sticky xl:top-24 xl:self-start">
        <h2 className="text-lg font-semibold text-[var(--text)]">Validation</h2>
        {issues.length ? (
          <ul className="mt-3 space-y-2 border-l-2 border-[var(--role-failure)] pl-4 text-sm text-[var(--role-failure)]">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        ) : <p className="mt-3 text-sm text-[var(--role-positive)]">All personal fields validate.</p>}
        {preview ? (
          <div className="mt-8 border-y border-[var(--border)] py-5">
            <p className="font-mono text-xs text-[var(--accent)]">DRAFT PREVIEW</p>
            <h3 className="mt-3 text-3xl font-semibold text-[var(--text)]">{data.name}</h3>
            <p className="mt-2 text-base text-[var(--text)]">{data.title}</p>
            <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">{data.bio}</p>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

function IconButton({ label, onClick, icon: Icon }: { label: string; onClick: () => void; icon: typeof Trash2 }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text-subtle)] hover:border-[var(--role-failure-border)] hover:text-[var(--role-failure)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
