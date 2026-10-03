"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, GitCommitHorizontal, Send } from "lucide-react";
import type {
  ContentPublicationState,
  PublishReceipt,
} from "@/lib/content/drafts";

import type {ContentChange} from "@/lib/content/admin-view";
import type {ReviewedRevisions} from "@/lib/content/drafts";

interface PublishPanelProps {
  state: ContentPublicationState;
  receipt: PublishReceipt | null;
  diff: ContentChange[];
  reviewedRevisions: ReviewedRevisions;
  recoveryRevisions?: ReviewedRevisions | null;
  hasDraft: boolean;
}

export function PublishPanel({ state, receipt, diff, hasDraft, reviewedRevisions, recoveryRevisions }: PublishPanelProps) {
  const router = useRouter();
  const [confirmedRevision, setConfirmedRevision] = useState<string | null>(null);
  const revisionKey = JSON.stringify(reviewedRevisions);
  const confirmed = confirmedRevision === revisionKey;
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");
  const [resultUrl, setResultUrl] = useState<string | null>(
    receipt?.kind === "published" ? receipt.commitUrl : null,
  );

  async function publish(recovery = false) {
    setPublishing(true);
    setMessage("");
    try {
      const response = await fetch("/api/data/publish", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({reviewedRevisions: recovery ? recoveryRevisions : reviewedRevisions}) });
      const body = (await response.json()) as {
        error?: string;
        state?: string;
        commitUrl?: string;
        message?: string;
      };
      if (!response.ok) {
        setMessage(body.error ?? "Publication failed. The draft was preserved.");
        return;
      }
      setResultUrl(body.commitUrl ?? null);
      setMessage(body.message ?? "Published to GitHub. Deployment is still pending.");
      setConfirmedRevision(null);
      router.refresh();
    } catch {
      setMessage("The publication outcome is uncertain. Retry to reconcile the original commit.");
    } finally {
      setPublishing(false);
    }
  }

  const canPublish = !recoveryRevisions && hasDraft && diff.length > 0 && confirmed && !publishing;

  return (
    <section aria-labelledby="publish-heading" className="border-t border-[var(--border)] pt-8">
      <div className="flex items-center gap-3">
        <GitCommitHorizontal className="h-5 w-5 text-[var(--role-info)]" aria-hidden="true" />
        <h2 id="publish-heading" className="text-2xl font-semibold text-[var(--text)]">Review and publish</h2>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
        Publishing creates one commit on main containing both canonical content files. CI then deploys the Worker after its checks pass; verify the live version afterward.
      </p>

      <div className="mt-6 border-y border-[var(--border)] py-4">
        <h3 className="text-sm font-semibold text-[var(--text)]">Draft diff</h3>
        {diff.length ? (
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-sm text-[var(--text-muted)]">
            {diff.map((entry) => <li key={entry.path}><details><summary className="cursor-pointer font-semibold">{entry.path}: {entry.kind}</summary><p className="mt-2">Before</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify(entry.before, null, 2)}</pre><p className="mt-2">After</p><pre className="whitespace-pre-wrap break-words">{JSON.stringify(entry.after, null, 2)}</pre></details></li>)}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-[var(--text-muted)]">
            {hasDraft ? "The saved draft matches deployed canonical content." : "No saved draft."}
          </p>
        )}
      </div>

      {(state.kind === "conflict" || state.kind === "publish-failed") ? (
        <p role="alert" className="mt-5 border border-[var(--role-failure-border)] bg-[var(--role-failure-soft)] p-4 text-sm text-[var(--role-failure)]">
          {state.message} The draft is preserved. Refresh after the current main deploy and save again to rebase, or discard the draft deliberately.
        </p>
      ) : null}

      {recoveryRevisions ? <div className="mt-5 border border-[var(--border)] p-4"><p className="text-sm text-[var(--text-muted)]">A previous publication needs recovery. Retry its recorded commit before publishing newer drafts. Newer drafts are preserved.</p><button type="button" className="secondary-command mt-3" disabled={publishing} onClick={() => void publish(true)}>Recover publication</button></div> : null}

      <label className="mt-5 flex max-w-3xl items-start gap-3 text-sm text-[var(--text-muted)]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmedRevision(event.target.checked ? revisionKey : null)}
          disabled={!hasDraft || diff.length === 0}
          className="mt-1 h-4 w-4 accent-[var(--accent)]"
        />
        <span>I reviewed the diff and understand that publishing commits to main and starts the production CI deployment.</span>
      </label>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => void publish()} disabled={!canPublish} className="primary-command disabled:cursor-not-allowed disabled:opacity-40">
          <Send className="h-4 w-4" aria-hidden="true" />
          {publishing ? "Publishing" : "Publish to GitHub"}
        </button>
        {resultUrl ? (
          <a href={resultUrl} target="_blank" rel="noopener noreferrer" className="secondary-command">
            Commit receipt <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        ) : null}
      </div>
      <p className="mt-4 text-sm text-[var(--text-muted)]" aria-live="polite">{message}</p>
    </section>
  );
}
