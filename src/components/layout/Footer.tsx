import { ExternalLink } from "lucide-react";
import type { SocialLink } from "@/data/personal";

interface FooterProps {
  name: string;
  socials: SocialLink[];
}

export function Footer({ name, socials }: FooterProps) {
  return (
    <footer className="mt-auto border-t border-[var(--border)] bg-[var(--surface-raised)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="text-[var(--text)]">{name}</span>
          <span className="mx-2 text-[var(--border-strong)]" aria-hidden="true">/</span>
          Built and operated in Norway
        </p>
        <div className="flex flex-wrap items-center gap-5">
          {socials.map((social) => (
            <a
              key={social.label}
              href={social.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              {social.label}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
