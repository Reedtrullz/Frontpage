"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyCommand({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="border border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3">
        <h3 className="text-sm font-semibold text-[var(--text)]">{label}</h3>
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          title={`Copy ${label}`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          {copied ? <Check className="h-4 w-4 text-[var(--role-positive)]" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-[var(--text-muted)]"><code>{command}</code></pre>
      <p className="sr-only" aria-live="polite">{copied ? `${label} copied` : ""}</p>
    </div>
  );
}
