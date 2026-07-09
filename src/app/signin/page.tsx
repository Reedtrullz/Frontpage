import Link from "next/link";
import { GitFork, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { signInWithGitHub } from "@/app/actions/auth";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  if (isOwnerUser(session?.user)) {
    redirect("/admin");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-7xl items-center px-4 py-16 sm:px-6">
      <section className="w-full max-w-xl border-l-2 border-[var(--accent)] pl-6 sm:pl-10">
        <div className="inline-flex items-center gap-2 text-sm font-medium text-[var(--accent)]">
          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
          Private workspace
        </div>
        <h1 className="mt-5 text-4xl font-semibold text-[var(--text)]">
          Owner sign in
        </h1>
        <p className="mt-4 max-w-lg text-base leading-7 text-[var(--text-muted)]">
          GitHub verifies access to content drafts, exact host telemetry, and the operations runbook. Public project and status pages do not require an account.
        </p>

        {params.error ? (
          <p role="alert" className="mt-6 border border-[var(--role-failure-border)] bg-[var(--role-failure-soft)] p-3 text-sm text-[var(--role-failure)]">
            Sign-in could not be completed. Check the GitHub authorization and try again.
          </p>
        ) : null}

        <form action={signInWithGitHub} className="mt-8">
          <button
            type="submit"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--text)] px-4 py-2 text-sm font-semibold text-[var(--surface)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <GitFork className="h-5 w-5" aria-hidden="true" />
            Continue with GitHub
          </button>
        </form>

        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center text-sm text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          Return to public dashboard
        </Link>
      </section>
    </div>
  );
}
