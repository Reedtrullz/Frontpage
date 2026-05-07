import Link from "next/link";

export function Header() {
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
          <Link
            href="/ansible"
            className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            Ansible
          </Link>
        </div>
      </nav>
    </header>
  );
}
