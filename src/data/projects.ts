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
    slug: "heimdall",
    name: "Heimdall",
    shortDescription:
      "Investment command center for THORChain bond providers — monitor bonded RUNE, node health, rewards, risk metrics, and LP positions.",
    longDescription:
      "Heimdall is a professional-grade dashboard for THORChain bond providers. It tracks total bonded RUNE with USD valuation, real-time RUNE price, weighted APY calculations with benchmark comparison, and portfolio health scoring (A–F grade).\n\nNode health monitoring covers active/standby/ready status, bond amount and rank tracking, slash points and jail status, churn-out risk assessment, and node operator fee impact analysis. The rewards dashboard shows P&L with initial bond tracking, and the LP section tracks liquidity positions across THORChain pools.",
    tags: ["thorchain", "dashboard", "defi", "monitoring", "bonds"],
    techStack: ["Next.js 16", "TypeScript", "Tailwind CSS 4", "Vitest", "Playwright"],
    status: "active",
    category: "defi",
    repoUrl: "https://github.com/Reedtrullz/Heimdall",
    featured: true,
  },
  {
    slug: "thorarb",
    name: "THORArb",
    shortDescription:
      "Arbitrage trading platform for $THOR token across THORChain, UniSwap, SushiSwap, and vTHOR Pool with a real-time web dashboard.",
    longDescription:
      "THORArb is a professional arbitrage bot that monitors $THOR token prices across four DEX venues: UniSwap V3 (THOR/ETH), SushiSwap V2 (THOR/ETH), THORChain (THOR/RUNE), and vTHOR Pool (vTHOR/RUNE) with redemption rate tracking.\n\nIt features intelligent arbitrage detection with gas cost, slippage, and liquidity accounting. Dual execution modes let you run manually (review opportunities) or auto-execute profitable trades. A real-time web dashboard shows live price cards, arbitrage opportunity rankings, and trade history.",
    tags: ["thorchain", "arbitrage", "defi", "trading", "uniswap", "sushiswap"],
    techStack: ["TypeScript", "Node.js", "ethers.js", "REST APIs"],
    status: "completed",
    category: "bot",
    repoUrl: "https://github.com/Reedtrullz/THORArb",
    featured: true,
  },
  {
    slug: "inebotten",
    name: "inebotten",
    shortDescription:
      "Multi-purpose Discord bot for community management, automation, and THORChain-related utilities.",
    longDescription:
      "inebotten is a Discord bot built for community infrastructure. It handles automated moderation tasks, provides THORChain network information, runs scheduled announcements, and integrates with various APIs for real-time data.\n\nBuilt with discord.js, it supports slash commands, event handling, and modular plugin architecture across two deployment versions.",
    tags: ["discord", "bot", "automation", "community", "thorchain"],
    techStack: ["TypeScript", "discord.js", "Node.js"],
    status: "active",
    category: "bot",
    featured: true,
  },
  {
    slug: "thornode-watcher",
    name: "THORNode Watcher",
    shortDescription:
      "Automated bond tracking and THORNode monitoring tool using headless browser automation.",
    longDescription:
      "THORNode Watcher is a Puppeteer-based monitoring tool that automatically tracks bond data from THORNodes. It scrapes and logs bond amounts, node status, and churn data on a schedule, providing historical tracking for bond provider decision-making.",
    tags: ["thorchain", "monitoring", "puppeteer", "nodes", "automation"],
    techStack: ["JavaScript", "Puppeteer", "Node.js"],
    status: "completed",
    category: "tooling",
    featured: false,
  },
  {
    slug: "thorchain-wiki",
    name: "THORChain Wiki",
    shortDescription:
      "Comprehensive knowledge base and data explorer for the THORChain ecosystem with charts, search, and live data.",
    longDescription:
      "THORChain Wiki is a Next.js-powered knowledge hub for the THORChain ecosystem. It features full-text search powered by lunr.js, interactive charts with Recharts, live network data via SWR, and organized documentation on THORChain concepts, RUNE economics, and protocol mechanics.",
    tags: ["thorchain", "wiki", "documentation", "charts", "data"],
    techStack: ["Next.js 16", "React 19", "Recharts", "lunr", "SWR", "date-fns"],
    status: "active",
    category: "wiki",
    repoUrl: "https://github.com/Reedtrullz/thorchain-wiki",
    featured: false,
  },
  {
    slug: "thor-maya-swap",
    name: "thor-maya-swap",
    shortDescription:
      "Frontend interface for cross-chain swaps between THORChain and Maya Protocol with real-time quotes.",
    longDescription:
      "A Next.js frontend application for cross-chain token swaps across THORChain and Maya Protocol. It provides real-time swap quotes, wallet connection, transaction tracking, and a clean swap interface. Uses React Query for data fetching and Zustand for client state management.",
    tags: ["thorchain", "maya", "swap", "frontend", "cross-chain", "defi"],
    techStack: ["Next.js 15", "React 19", "Zustand", "React Query", "Tailwind"],
    status: "in-progress",
    category: "frontend",
    repoUrl: "https://github.com/Reedtrullz/thor-maya-swap-frontend",
    featured: false,
  },
  {
    slug: "harmony-sync",
    name: "Harmony Sync",
    shortDescription:
      "Full-stack application with backend services, mobile app, and ML models for synchronized data workflows.",
    longDescription:
      "Harmony Sync is a full-stack application spanning backend services, a mobile client, and machine learning models. It orchestrates synchronized data workflows across platforms with a focus on reliability and real-time updates.",
    tags: ["full-stack", "mobile", "machine-learning", "sync"],
    techStack: ["Node.js", "React Native", "Python", "TypeScript"],
    status: "in-progress",
    category: "tooling",
    featured: false,
  },
  {
    slug: "vifty",
    name: "Vifty",
    shortDescription:
      "Native macOS fan control utility for Apple Silicon MacBook Pros with menu bar monitoring and daemon-based SMC control.",
    longDescription:
      "Vifty is a native macOS fan control app for Apple Silicon MacBook Pros. It reads temperature sensors via SMC and HID, displays them in a menu bar utility, and steers fan speeds through a privileged XPC daemon that survives app restarts.\n\nThree fan modes are supported: Auto (restore system control), Fixed RPM, and Temperature Curve (3-point). The live temperature panel shows all SMC and HID sensors with source labels. A standalone ViftyHelper CLI enables direct SMC key reads and fan writes from the terminal.\n\nSafety features include RPM clamping, auto-restore on sensor loss, an unclean-exit recovery marker, and hardware validation that refuses manual control on non-MacBook-Pro hardware.",
    tags: ["macos", "fan-control", "swift", "menu-bar", "utility"],
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
      "Google OAuth plugin for Hermes Agent — access Claude Opus 4.6, Sonnet 4.6, and Gemini models via Google Antigravity.",
    longDescription:
      "Hermes Antigravity Auth is a Python plugin for Hermes Agent that enables access to Claude and Gemini models through Google's Antigravity OAuth gateway. It handles PKCE OAuth authentication, request transformation (OpenAI → Gemini format), multi-account load balancing with health-score-based rotation, and session recovery from interrupted tool calls.\n\nThe plugin monkey-patches Hermes' internal HTTP client via httpx event hooks to inject Antigravity-specific headers. It supports dual quota pools (Antigravity headers + Gemini CLI headers), per-account device fingerprints, and proactive token refresh via a background watchdog thread. Claude thinking blocks are stripped from outgoing requests, and tool schemas are sanitized for Antigravity compatibility.",
    tags: ["hermes", "oauth", "claude", "gemini", "plugin", "antigravity"],
    techStack: ["Python", "httpx", "PKCE OAuth", "YAML", "pytest"],
    status: "active",
    category: "infra",
    repoUrl: "https://github.com/Reedtrullz/hermes-antigravity-auth",
    featured: false,
  },
  {
    slug: "rfmc",
    name: "RFMC / VirtualCDU",
    shortDescription:
      "Web-based Boeing 737 NG CDU/FMC trainer with Airbus A320 MCDU support, cockpit-mode instruments, and optional MSFS bridge.",
    longDescription:
      "RFMC is a browser-based avionics procedure trainer for learning CDU/MCDU flows, route setup, cockpit scanning, navigation-display interpretation, and trainer-level autoflight concepts. It covers the Boeing 737 NG CDU/FMC with over 16 page foundations (IDENT through DIR INTC) and scoped Airbus A320 MCDU pages.\n\nCockpit mode includes CDU/MCDU hardware-style panels, Navigation Display and PFD presentations, MCP/FCU visual controls, and task modes for focused practice. The app runs as an offline PWA with touch-first controls and kiosk-mode support for installed iPad and desktop use.\n\nAn optional MSFS bridge connects to PMDG 737 via SimConnect for live data, while standalone mode keeps state in the frontend. Over 845 unit tests and Playwright visual regression baselines validate display accuracy across multiple viewport presets.",
    tags: ["aviation", "fmc", "boeing", "airbus", "simulation", "training", "pwa"],
    techStack: ["React 18", "TypeScript", "Vite", "Zustand", "Node.js", "WebSocket"],
    status: "active",
    category: "tooling",
    repoUrl: "https://github.com/Reedtrullz/RFMC",
    liveUrl: "https://fmc.reidar.tech",
    featured: true,
  },
  {
    slug: "frontpage",
    name: "Frontpage",
    shortDescription:
      "This site — a personal portfolio and project database detailing what I build and why.",
    longDescription:
      "Frontpage is the website you're viewing right now. It serves as both a personal introduction and a curated database of all my projects. Built with Next.js 16, TypeScript, and Tailwind CSS 4, it features a terminal-inspired design and a Heimdall-influenced card dashboard for showcasing projects.",
    tags: ["portfolio", "nextjs", "tailwind", "personal-site"],
    techStack: ["Next.js 16", "TypeScript", "Tailwind CSS 4"],
    status: "active",
    category: "frontend",
    featured: false,
  },
];
