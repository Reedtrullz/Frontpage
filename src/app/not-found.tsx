import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[65vh] max-w-7xl items-center px-4 py-16 sm:px-6">
      <section className="max-w-2xl">
        <SearchX className="h-8 w-8 text-[var(--role-warning)]" aria-hidden="true" />
        <p className="mt-5 font-mono text-sm text-[var(--role-warning)]">404 / NOT FOUND</p>
        <h1 className="mt-3 text-4xl font-semibold text-[var(--text)]">Page not found</h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--text-muted)]">
          The address does not match a published project or dashboard route.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link href="/" className="primary-command">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back home
          </Link>
          <Link href="/projects" className="secondary-command">Browse projects</Link>
        </div>
      </section>
    </div>
  );
}
