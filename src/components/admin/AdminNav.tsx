"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/personal", label: "Personal" },
  { href: "/admin/projects", label: "Projects" },
  { href: "/ansible", label: "Operations" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Owner workspace" className="overflow-x-auto border-y border-[var(--border)]">
      <div className="mx-auto flex min-w-max max-w-7xl px-4 sm:px-6">
        {links.map((link) => {
          const active = "exact" in link && link.exact
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-12 items-center border-b-2 px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] ${
                active
                  ? "border-[var(--role-info)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
