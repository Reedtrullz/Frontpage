import { auth, signOut } from "@/auth";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/api/auth/signin");

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-6">
          <Link
            href="/admin"
            className="font-mono text-sm text-green-500 hover:text-green-400"
          >
            admin
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-400">
            <Link href="/" className="hover:text-zinc-200">
              View site →
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-zinc-500 font-mono">
            {session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </div>
      {children}
    </div>
  );
}
