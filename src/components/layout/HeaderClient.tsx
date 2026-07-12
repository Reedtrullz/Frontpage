"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Circle,
  GitFork,
  LockKeyhole,
  Menu,
  X,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import type { OverallPublicStatusKind } from "@/lib/metrics/status-page";

interface HeaderClientProps {
  isOwner: boolean;
  statusKind: OverallPublicStatusKind;
}

const statusClasses: Record<OverallPublicStatusKind, string> = {
  operational: "text-[var(--role-positive)]",
  degraded: "text-[var(--role-warning)]",
  delayed: "text-[var(--role-warning)]",
  disruption: "text-[var(--role-failure)]",
  unavailable: "text-[var(--text-subtle)]",
  "no-checks": "text-[var(--text-subtle)]",
};

const statusLabels: Record<OverallPublicStatusKind, string> = {
  operational: "Operational",
  degraded: "Degraded",
  delayed: "Status delayed",
  disruption: "Service disruption",
  unavailable: "Status unavailable",
  "no-checks": "No public checks",
};

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
  statusKind,
}: {
  href: string;
  label: string;
  pathname: string;
  onNavigate?: () => void;
  statusKind?: OverallPublicStatusKind;
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
      {statusKind ? (
        <Circle className={`mr-2 h-2.5 w-2.5 fill-current ${statusClasses[statusKind]}`} aria-hidden="true" />
      ) : null}
      {label}
      {statusKind ? (
        <span className="ml-1 hidden text-xs text-[var(--text-subtle)] xl:inline">
          · {statusLabels[statusKind]}
        </span>
      ) : null}
    </Link>
  );
}

export function HeaderClient({ isOwner, statusKind }: HeaderClientProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const ownerMenuRef = useRef<HTMLDivElement>(null);
  const ownerButtonRef = useRef<HTMLButtonElement>(null);
  const ownerMenuItemsRef = useRef<Array<HTMLElement | null>>([]);
  const ownerInitialFocusRef = useRef<"first" | "last">("first");

  const ownerMenuItems = useCallback((): HTMLElement[] => {
    return ownerMenuItemsRef.current.filter(
      (item): item is HTMLElement => item !== null,
    );
  }, []);

  const focusOwnerMenuItem = useCallback((index: number) => {
    ownerMenuItems()[index]?.focus();
  }, [ownerMenuItems]);

  function handleOwnerMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab") {
      setOwnerOpen(false);
      return;
    }

    const items = ownerMenuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOwnerMenuItem((currentIndex + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOwnerMenuItem((currentIndex - 1 + items.length) % items.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOwnerMenuItem(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOwnerMenuItem(items.length - 1);
    }
  }

  useEffect(() => {
    if (!ownerOpen) return;

    const items = ownerMenuItems();
    focusOwnerMenuItem(
      ownerInitialFocusRef.current === "last" ? items.length - 1 : 0,
    );
    ownerInitialFocusRef.current = "first";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOwnerOpen(false);
      ownerButtonRef.current?.focus();
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!ownerMenuRef.current?.contains(event.target as Node)) {
        setOwnerOpen(false);
      }
    }

    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [focusOwnerMenuItem, ownerMenuItems, ownerOpen]);

  function handleOwnerButtonKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    ownerInitialFocusRef.current = event.key === "ArrowUp" ? "last" : "first";
    setOwnerOpen(true);
  }

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
            <PublicLink
              key={link.href}
              {...link}
              pathname={pathname}
              statusKind={link.href === "/status" ? statusKind : undefined}
            />
          ))}
          <a
            href="https://github.com/Reedtrullz"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Reidar on GitHub"
            title="GitHub"
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <GitFork className="h-5 w-5" aria-hidden="true" />
          </a>
          {isOwner ? (
            <div ref={ownerMenuRef} className="relative">
              <button
                ref={ownerButtonRef}
                type="button"
                aria-expanded={ownerOpen}
                aria-controls="owner-navigation"
                aria-haspopup="menu"
                onClick={() => setOwnerOpen((open) => !open)}
                onKeyDown={handleOwnerButtonKeyDown}
                className="inline-flex min-h-11 items-center gap-2 border border-[var(--border)] bg-[var(--surface-raised)] px-3 text-sm font-medium text-[var(--text)] hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                Owner
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </button>
              {ownerOpen ? (
                <div
                  id="owner-navigation"
                  role="menu"
                  aria-label="Owner navigation"
                  onKeyDown={handleOwnerMenuKeyDown}
                  className="absolute right-0 top-12 w-52 border border-[var(--border)] bg-[var(--surface-overlay)] p-2 shadow-xl"
                >
                  <Link ref={(element) => { ownerMenuItemsRef.current[0] = element; }} tabIndex={-1} role="menuitem" className="owner-menu-link" href="/admin" onClick={() => setOwnerOpen(false)}>Content workspace</Link>
                  <Link ref={(element) => { ownerMenuItemsRef.current[1] = element; }} tabIndex={-1} role="menuitem" className="owner-menu-link" href="/ansible" onClick={() => setOwnerOpen(false)}>Operations runbook</Link>
                  <a ref={(element) => { ownerMenuItemsRef.current[2] = element; }} tabIndex={-1} role="menuitem" className="owner-menu-link" href="/proposals" onClick={() => setOwnerOpen(false)}>Proposals</a>
                  <form action={signOutAction}>
                    <button ref={(element) => { ownerMenuItemsRef.current[3] = element; }} tabIndex={-1} role="menuitem" className="owner-menu-link w-full" type="submit">Sign out</button>
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
            aria-label={`View system status: ${statusLabels[statusKind]}`}
            className="inline-flex h-11 w-11 items-center justify-center text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          >
            <Circle className={`h-3.5 w-3.5 fill-current ${statusClasses[statusKind]}`} aria-hidden="true" />
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
                statusKind={link.href === "/status" ? statusKind : undefined}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
            {isOwner ? (
              <>
                <Link className="mobile-menu-link" href="/admin" onClick={() => setMobileOpen(false)}>Content workspace</Link>
                <Link className="mobile-menu-link" href="/ansible" onClick={() => setMobileOpen(false)}>Operations runbook</Link>
                <a className="mobile-menu-link" href="/proposals" onClick={() => setMobileOpen(false)}>Proposals</a>
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
