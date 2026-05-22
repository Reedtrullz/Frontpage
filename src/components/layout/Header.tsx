import Link from "next/link";
import { auth, signOut } from "@/auth";

export async function Header() {
  const session = await auth();

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <nav className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link
          href="/"
          className="font-mono text-sm text-green-500 hover:text-green-400 transition-colors"
        >
          ~/reidar<span className="text-zinc-600">$</span>
        </Link>
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Home
          </Link>
          <Link
            href="/projects"
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Projects
          </Link>
          {session?.user && (
            <>
              <a
                href="/proposals"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Proposals
              </a>
              <Link
                href="/admin"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Admin
              </Link>
              <Link
                href="/ansible"
                className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
              >
                Ansible
              </Link>
            </>
          )}
          {session?.user ? (
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">
                Sign out
              </button>
            </form>
          ) : (
            <Link
              href="/api/auth/signin"
              className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
