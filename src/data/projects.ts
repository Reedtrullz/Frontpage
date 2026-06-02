export type ProjectStatus = "active" | "in-progress" | "completed" | "paused";
export type ProjectCategory = "defi" | "bot" | "frontend" | "tooling" | "infra" | "wiki";

export interface Project {
  slug: string;
  name: string;
  shortDescription: string;
  longDescription: string;
  tags: string[];
  techStack: string[];
  status: ProjectStatus;
  category: ProjectCategory;
  repoUrl?: string;
  liveUrl?: string;
  featured: boolean;
}

export const projects: Project[] = [
  {
    slug: "nytt",
    name: "Nytt",
    shortDescription:
      "Flagship active public-transport intelligence app for Trondheim-area disruptions, provenance, and Situation Room analysis.",
    longDescription:
      "Nytt is the flagship active transport product: a provenance-first disruption intelligence app built around Entur alerts, DATEX traffic context, stop/line impact, and Situation Room explanations.\n\nThe current direction is not just a map or feed clone — it is a verified incident workspace with source freshness, link-level context, telemetry invariants, restore rehearsal documentation, and a bias toward explaining why an incident matters before promoting it to users.",
    tags: ["transport", "trondheim", "maps", "alerts", "provenance", "situation-room"],
    techStack: ["Next.js", "TypeScript", "Python", "PostgreSQL", "GIS"],
    status: "active",
    category: "frontend",
    featured: true,
  },
  {
    slug: "rfs",
    name: "RFS",
    shortDescription:
      "Active technical flight-simulation flagship focused on credible physics, usable cockpit systems, and validation in progress.",
    longDescription:
      "RFS is an active technical flagship for browser-based flight simulation. The focus is real playability: credible aerodynamics, a usable cockpit/PFD/FMA, camera/input ergonomics, honest unsupported-mode handling, and incremental validation rather than visual-only simulation.\n\nRecent remediation work captured the vertical-speed autopilot failure, bounded pitch-loop derivative kick, and created a data-backed flight-dynamics plan so future changes can be checked against explicit physics assumptions instead of tuning by feel.",
    tags: ["aviation", "flight-sim", "physics", "autopilot", "webgl"],
    techStack: ["React", "TypeScript", "Vite", "Three.js", "Zustand"],
    status: "active",
    category: "tooling",
    repoUrl: "https://github.com/Reedtrullz/RFS",
    liveUrl: "https://fly.reidar.tech",
    featured: true,
  },
  {
    slug: "rfmc",
    name: "RFMC / VirtualCDU",
    shortDescription:
      "Active technical avionics flagship for Boeing 737 NG CDU/FMC and Airbus MCDU training; validation remains in progress.",
    longDescription:
      "RFMC is a browser-based avionics procedure trainer for learning CDU/MCDU flows, route setup, cockpit scanning, navigation-display interpretation, and trainer-level autoflight concepts. It covers Boeing 737 NG CDU/FMC foundations with scoped Airbus A320 MCDU pages.\n\nCockpit mode includes CDU/MCDU hardware-style panels, Navigation Display and PFD presentations, MCP/FCU visual controls, and task modes for focused practice. The app runs as an offline PWA with touch-first controls and kiosk-mode support. The public posture is active technical flagship, with LOC/G/S and other unsupported-vs-real behavior still being validated rather than oversold.",
    tags: ["aviation", "fmc", "boeing", "airbus", "simulation", "training", "pwa"],
    techStack: ["React 18", "TypeScript", "Vite", "Zustand", "Node.js", "WebSocket"],
    status: "active",
    category: "tooling",
    repoUrl: "https://github.com/Reedtrullz/RFMC",
    liveUrl: "https://fmc.reidar.tech",
    featured: true,
  },
  {
    slug: "heimdall",
    name: "Heimdall",
    shortDescription:
      "Active THORChain intelligence dashboard for bond providers, node health, rewards, risk metrics, and LP context.",
    longDescription:
      "Heimdall is an active THORChain intelligence dashboard for bond providers. It tracks bonded RUNE with USD valuation, real-time RUNE price, weighted APY calculations with benchmark comparison, and portfolio health scoring.\n\nNode health monitoring covers active/standby/ready status, bond amount and rank tracking, slash points and jail status, churn-out risk assessment, and node operator fee impact analysis. The project is canonical alongside tcwiki for THORChain intelligence work, while stale duplicates are documented as archived pointers.",
    tags: ["thorchain", "dashboard", "defi", "monitoring", "bonds"],
    techStack: ["Next.js 16", "TypeScript", "Tailwind CSS 4", "Vitest", "Playwright"],
    status: "active",
    category: "defi",
    repoUrl: "https://github.com/Reedtrullz/Heimdall",
    featured: true,
  },
  {
    slug: "thorchain-wiki",
    name: "tcwiki / THORChain Wiki",
    shortDescription:
      "Active THORChain knowledge and data workspace with freshness metadata and generated-search planning.",
    longDescription:
      "tcwiki / THORChain Wiki is an active knowledge workspace for THORChain concepts, RUNE economics, protocol mechanics, and data exploration.\n\nThe current remediation posture is active intelligence infrastructure: static content now needs freshness metadata, generated-index search is planned, and shared THORChain data conventions link this work with Heimdall instead of letting duplicated assumptions drift.",
    tags: ["thorchain", "wiki", "documentation", "charts", "data"],
    techStack: ["Next.js 16", "React 19", "Recharts", "lunr", "SWR", "date-fns"],
    status: "active",
    category: "wiki",
    repoUrl: "https://github.com/Reedtrullz/thorchain-wiki",
    featured: false,
  },
  {
    slug: "thorarb",
    name: "THORArb",
    shortDescription:
      "Experimental THOR arbitrage monitor with execution disabled by default; not production-safe trading infrastructure.",
    longDescription:
      "THORArb monitors $THOR opportunities across UniSwap, SushiSwap, THORChain, and vTHOR-style paths, but its public status is experimental. It is not production-safe trading infrastructure.\n\nRecent remediation added disabled-by-default execution guards, dry-run-safe startup, typed triangular/vTHOR opportunity handling, quote-derived minimum-output enforcement for supported SushiSwap paths, explicit UniSwap refusal until a V3 quoter exists, and CI. Real trading still requires deliberate opt-in and further review.",
    tags: ["thorchain", "arbitrage", "defi", "trading", "experimental", "safety"],
    techStack: ["TypeScript", "Node.js", "ethers.js", "Jest", "GitHub Actions"],
    status: "in-progress",
    category: "bot",
    repoUrl: "https://github.com/Reedtrullz/THORArb",
    featured: false,
  },
  {
    slug: "thor-maya-swap",
    name: "thor-maya-swap",
    shortDescription:
      "Experimental quotes-only THORChain/Maya swap frontend; real swap execution is disabled and not production-safe.",
    longDescription:
      "thor-maya-swap is a Next.js frontend for THORChain and Maya quote exploration. Its current product label is quotes-only: wallet signing, transaction execution, and production swap safety are intentionally out of scope until min-out/slippage, address validation, and security review are complete.\n\nRecent remediation froze existing WIP on a task branch, added visible quotes-only warnings, restored lint/build health, and added Vitest coverage for address validation, asset mapping, quote parameter construction, and static no-execution checks.",
    tags: ["thorchain", "maya", "swap", "frontend", "quotes-only", "experimental"],
    techStack: ["Next.js 15", "React 19", "Zustand", "Vitest", "Tailwind"],
    status: "in-progress",
    category: "frontend",
    repoUrl: "https://github.com/Reedtrullz/thor-maya-swap-frontend",
    featured: false,
  },
  {
    slug: "harmony-sync",
    name: "Harmony Sync",
    shortDescription:
      "Experimental, not production-safe mobile/backend music-analysis prototype; backend durability, cleanup, auth, and real ML boundaries are still planned.",
    longDescription:
      "Harmony Sync is an experimental prototype for submitting a YouTube URL from a mobile app, creating a backend job, and eventually returning chords and lyrics. It should not be presented as a durable or production ML/music product yet.\n\nRecent remediation made the Expo mobile backend URL configurable via `EXPO_PUBLIC_API_BASE_URL` and added a backend hardening plan covering SQLite jobs, status models, URL validation, auth/rate limits, temp download cleanup, and honest chord/lyrics mock/model boundaries.",
    tags: ["mobile", "music", "machine-learning", "expo", "prototype", "experimental"],
    techStack: ["Expo", "React Native", "Python", "FastAPI", "yt-dlp"],
    status: "in-progress",
    category: "tooling",
    featured: false,
  },
  {
    slug: "vifty",
    name: "Vifty",
    shortDescription:
      "Focused macOS fan-control utility for local/signed distribution with privileged XPC safety boundaries.",
    longDescription:
      "Vifty is a focused native macOS fan-control app for Apple Silicon MacBook Pros. It reads temperature sensors via SMC and HID, displays them in a menu bar utility, and steers fan speeds through a privileged XPC daemon that survives app restarts.\n\nThe current status is local/signed distribution utility rather than broad consumer release. Recent hardening added an XPC client-validation seam, enforced daemon-side validation, and documented fail-safe recovery behavior.",
    tags: ["macos", "fan-control", "swift", "menu-bar", "utility", "xpc"],
    techStack: ["Swift 6", "SwiftUI", "XPC", "IOKit", "SMC"],
    status: "active",
    category: "tooling",
    repoUrl: "https://github.com/Reedtrullz/Vifty",
    featured: false,
  },
  {
    slug: "hermes-antigravity-auth",
    name: "Hermes Antigravity Auth",
    shortDescription:
      "Unofficial high-risk Hermes Agent OAuth/plugin infrastructure for Antigravity-backed model access.",
    longDescription:
      "Hermes Antigravity Auth is unofficial, high-risk AI infrastructure for Hermes Agent. It bridges Google Antigravity OAuth into Hermes model access, request transformation, token/session handling, and account rotation.\n\nBecause it monkey-patches runtime HTTP behavior and depends on external OAuth/provider quirks, it should be treated as infrastructure glue requiring explicit review, smoke tests, and Terms-of-Service awareness rather than a stable platform feature.",
    tags: ["hermes", "oauth", "claude", "gemini", "plugin", "antigravity", "high-risk"],
    techStack: ["Python", "httpx", "PKCE OAuth", "YAML", "pytest"],
    status: "active",
    category: "infra",
    repoUrl: "https://github.com/Reedtrullz/hermes-antigravity-auth",
    featured: false,
  },
  {
    slug: "codex-antigravity-auth",
    name: "codex-antigravity-auth",
    shortDescription:
      "Experimental Codex Desktop/Antigravity auth adapter; adapter glue until CI and version-specific patching are proven.",
    longDescription:
      "codex-antigravity-auth is experimental adapter infrastructure for exploring Codex Desktop and Antigravity authentication integration. It is useful research infrastructure, but it should not be framed as a stable product.\n\nThe known risk is version-specific patching and auth disruption: previous shim work could break Codex login/history when the Desktop app or provider assumptions changed. Treat this as adapter glue until CI, import smoke tests, and exact-version patch verification are green for the targeted app version.",
    tags: ["codex", "antigravity", "auth", "adapter", "experimental", "infra"],
    techStack: ["Python", "OAuth", "pytest", "GitHub Actions"],
    status: "in-progress",
    category: "infra",
    repoUrl: "https://github.com/Reedtrullz/codex-antigravity-auth",
    featured: false,
  },
  {
    slug: "inebotten",
    name: "inebotten",
    shortDescription:
      "Active Discord/community automation bot with signed-session hardening and ongoing modular extraction.",
    longDescription:
      "inebotten is a Discord bot built for community infrastructure. It handles automated moderation tasks, THORChain network information, scheduled announcements, and integrations with external APIs.\n\nRecent remediation clarified duplicate checkouts, replaced raw API-key cookies with signed session tokens, added login throttling coverage, and started MessageMonitor extraction through a feature registry.",
    tags: ["discord", "bot", "automation", "community", "thorchain"],
    techStack: ["TypeScript", "discord.js", "Node.js"],
    status: "active",
    category: "bot",
    featured: false,
  },
  {
    slug: "thornode-watcher",
    name: "THORNode Watcher",
    shortDescription:
      "Older THORNode bond-monitoring automation retained as a historical/tooling reference.",
    longDescription:
      "THORNode Watcher is a Puppeteer-based monitoring tool that tracks bond data from THORNodes. It scraped and logged bond amounts, node status, and churn data on a schedule for historical bond-provider decision support.\n\nCompared with Heimdall and tcwiki, this is retained as older tooling rather than the primary THORChain intelligence surface.",
    tags: ["thorchain", "monitoring", "puppeteer", "nodes", "automation"],
    techStack: ["JavaScript", "Puppeteer", "Node.js"],
    status: "completed",
    category: "tooling",
    featured: false,
  },
  {
    slug: "frontpage",
    name: "Frontpage",
    shortDescription:
      "This site — an active personal portfolio and project database with curated status labels for each project.",
    longDescription:
      "Frontpage is the website you're viewing right now. It serves as both a personal introduction and a curated project database: not just what exists, but what is flagship, active, experimental, paused, or unsafe to overstate.\n\nBuilt with Next.js 16, TypeScript, Tailwind CSS 4, Auth.js, GitHub OAuth, and a small admin/data workflow, it is the public-facing index for the portfolio remediation work.",
    tags: ["portfolio", "nextjs", "tailwind", "personal-site", "projects"],
    techStack: ["Next.js 16", "TypeScript", "Tailwind CSS 4", "Auth.js"],
    status: "active",
    category: "frontend",
    featured: false,
  },
];
