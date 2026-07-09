import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!isOwnerUser(session?.user)) {
    redirect("/signin?callbackUrl=/admin");
  }

  return (
    <div>
      <header className="bg-[var(--surface-raised)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="flex items-center gap-2 text-sm text-[var(--role-info)]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Owner authenticated
            </div>
            <p className="mt-2 text-xl font-semibold text-[var(--text)]">Content and operations workspace</p>
          </div>
          <div className="flex flex-wrap items-center gap-5 text-sm">
            <span className="text-[var(--text-subtle)]">{session?.user?.email ?? "GitHub owner"}</span>
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
              View public site <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>
      <AdminNav />
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12">{children}</div>
    </div>
  );
}
