"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ChevronDown,
  CircleDashed,
  GitFork,
  LockKeyhole,
  Menu,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";

interface HeaderClientProps {
  isOwner: boolean;
}

const publicLinks = [
  { href: "/projects", label: "Projects" },
  { href: "/status", label: "Status" },
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function PublicLink({
  href,
  label,
  pathname,
  onNavigate,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate?: () => void;
}) {
  const active = isActive(pathname, href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`inline-flex min-h-11 items-center border-b-2 px-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
        active
          ? "border-[var(--accent)] text-[var(--text)]"
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </Link>
  );
}

export function HeaderClient({ isOwner }: HeaderClientProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);

  return (
    <>
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          aria-label="Reidar home"
          className="inline-flex min-h-11 items-center gap-2 font-mono text-sm font-semibold text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        >
          <span className="h-2 w-2 bg-[var(--accent)]" aria-hidden="true" />
          <span>REIDAR</span>
          <span className="text-[var(--text-subtle)]">/ OS</span>
        </Link>

        <div className="hidden h-full items-center gap-6 md:flex">
          {publicLinks.map((link) => (
            <PublicLink key={link.href} {...link} pathname={pathname} />
          ))}
          <a
            href="https://github.com/Reedtrullz"
            target="_blank"
            rel="noreferrer"
            aria-label="Reidar on GitHub"
            title="GitHub"
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <GitFork className="h-5 w-5" aria-hidden="true" />
          </a>
          {isOwner ? (
            <div className="relative">
              <button
                type="button"
                aria-expanded={ownerOpen}
                aria-controls="owner-navigation"
                onClick={() => setOwnerOpen((open) => !open)}
                className="inline-flex min-h-11 items-center gap-2 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-medium text-[var(--text)] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                Owner
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              {ownerOpen ? (
                <div
                  id="owner-navigation"
                  className="absolute right-0 top-12 w-52 border border-[var(--border)] bg-[var(--surface-overlay)] p-2 shadow-xl"
                >
                  <Link className="owner-menu-link" href="/admin">Content workspace</Link>
                  <Link className="owner-menu-link" href="/ansible">Operations runbook</Link>
                  <a className="owner-menu-link" href="/proposals">Proposals</a>
                  <form action={signOutAction}>
                    <button className="owner-menu-link w-full" type="submit">Sign out</button>
                  </form>
                </div>
              ) : null}
            </div>
          ) : (
            <Link
              href="/signin"
              className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--text-subtle)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
            >
              <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              Owner access
            </Link>
          )}
        </div>

        <div className="flex items-center gap-1 md:hidden">
          <Link
            href="/status"
            aria-label="View system status"
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <CircleDashed className="h-5 w-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-navigation"
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        </div>
      </nav>

      {mobileOpen ? (
        <nav
          id="mobile-navigation"
          aria-label="Mobile"
          className="border-t border-[var(--border)] bg-[var(--surface-overlay)] px-4 py-3 md:hidden"
        >
          <div className="mx-auto flex max-w-7xl flex-col">
            {publicLinks.map((link) => (
              <PublicLink
                key={link.href}
                {...link}
                pathname={pathname}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
            {isOwner ? (
              <>
                <Link className="mobile-menu-link" href="/admin" onClick={() => setMobileOpen(false)}>Content workspace</Link>
                <Link className="mobile-menu-link" href="/ansible" onClick={() => setMobileOpen(false)}>Operations runbook</Link>
                <form action={signOutAction}>
                  <button className="mobile-menu-link w-full" type="submit">Sign out</button>
                </form>
              </>
            ) : (
              <Link
                className="mobile-menu-link"
                href="/signin"
                onClick={() => setMobileOpen(false)}
              >
                Owner access
              </Link>
            )}
          </div>
        </nav>
      ) : null}
    </>
  );
}
