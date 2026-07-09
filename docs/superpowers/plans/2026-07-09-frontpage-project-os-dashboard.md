# Frontpage Project OS Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Project OS Dashboard facelift for `reidar.tech`, including public project/service health, owner-only VPS metrics, a 60-second host collector, and a detailed `/status` page.

**Architecture:** A VPS-side collector writes bounded `latest.json` and `history.json` files under `/var/lib/frontpage-metrics`; the Next.js app only reads those files through `METRICS_DIR`, validates schema version `1`, and derives separate public and owner-safe models server-side. The homepage becomes the public live workbench; `/status` shows public status plus owner-only exact metrics after server-side owner verification.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Auth.js v5, Zod 4, Vitest, Python 3 standard library collector, Ansible, Docker.

## Global Constraints

- Node 22 is required: run `source ~/.nvm/nvm.sh && nvm use 22` before JS package, lint, test, or build commands.
- The Next.js app must not SSH to the VPS, shell out for metrics, read Docker sockets, or need privileged host access.
- Production metrics directory is `/var/lib/frontpage-metrics`.
- Production app metrics path must be configured explicitly through `METRICS_DIR`; do not silently fall back to a writable app-local path in production.
- Collector runs every 60 seconds through `frontpage-metrics-collector.timer`.
- Collector writes `${METRICS_DIR}/latest.json` and `${METRICS_DIR}/history.json` atomically.
- `latest.json` must match `docs/superpowers/specs/2026-07-09-frontpage-metrics.schema.v1.json`.
- `history.json` must match `docs/superpowers/specs/2026-07-09-frontpage-metrics-history.schema.v1.json`.
- Both files require `schema_version: 1`.
- Snapshot timestamps must be ISO 8601 UTC strings ending in `Z`.
- `cpu_percent` must be normalized to a 0-100 host-capacity percentage.
- `services` and `containers` are capped at 64 entries each.
- Collector and reader must enforce unique `id` values within `services` and within `containers`.
- History keeps at most 1,440 samples, matching one sample per minute for 24 hours.
- Timed-out checks record `latency_ms: null`; completed checks round latency to integer milliseconds and clamp to 10,000 ms.
- Freshness states are `fresh` at 90 seconds old or newer, `stale` when older than 90 seconds and not older than 5 minutes, and `unavailable` when missing, invalid, or older than 5 minutes.
- Public views must receive derived models, not filtered exact host metrics.
- Public views must not include exact CPU percent, RAM bytes or percent, disk bytes or percent, load averages, uptime seconds, raw container list, or internal-only service labels.
- Owner-only metrics require server-side session and owner verification through Auth.js.
- No `?admin=true`, client-side filtering, or hidden public payload may reveal exact metrics.
- Static service checks only: HTTP/HTTPS GET with expected status and timeout.
- No custom headers, secrets in URLs, dynamic probe admin UI, arbitrary command probes, `docker exec`, raw Docker inventory, or socket-level probes in v1.
- Container statuses are owner-only in v1; public container health must be represented by a public HTTP service check.
- Existing `/api/health` remains app-health only.
- Do not expose Auth.js secrets, OAuth secrets, GitHub tokens, vault passwords, `.env` values, or production runtime data.
- Admin UI and write APIs are owner-only. Never remove auth checks.
- Do not claim live/deployed status without fresh CI/deploy and curl/browser verification for the exact SHA.
- Keep project status labels conservative.
- Use `.superpowers/` only for local scratch; it is ignored and must not be staged.

---

## File Structure

Create and modify these focused units:

- `vitest.config.ts`: Vitest config with `@/*` alias and Node test environment.
- `package.json` and `package-lock.json`: add `test` script and `vitest` dev dependency.
- `src/lib/authz.ts`: shared owner-check helper used by Auth.js, admin, status, and API routes.
- `src/lib/authz.test.ts`: owner-check tests.
- `src/auth.ts`: Auth.js `authorized` callback delegates owner checks to `isOwnerUser`.
- `src/auth.test.ts`: focused Auth.js callback delegation tests.
- `src/lib/metrics/types.ts`: shared metrics TypeScript types, constants, and public/owner model interfaces.
- `src/lib/metrics/schema.ts`: Zod schemas and parse helpers mirroring the committed JSON Schema v1 contract.
- `src/lib/metrics/schema.test.ts`: schema, timestamp, duplicate ID, and history validation tests.
- `src/lib/metrics/reader.ts`: filesystem reader, freshness state, public derivation, owner derivation, and project-health join.
- `src/lib/metrics/reader.test.ts`: missing/malformed/stale/fresh/public/owner derivation tests.
- `ops/frontpage-metrics.config.json`: static service/container check config shipped with the app.
- `ops/frontpage-metrics-collector.py`: host-side Python collector using standard library only.
- `ops/systemd/frontpage-metrics-collector.service`: one-shot collector service.
- `ops/systemd/frontpage-metrics-collector.timer`: 60-second timer.
- `ops/tests/test_frontpage_metrics_collector.py`: collector unit tests for config validation, service result sanitization, Docker status mapping, history pruning, and atomic writes.
- `ansible-playbook.yml`: install collector, config, systemd units, metrics dir, and read-only metrics mount; set `METRICS_DIR`.
- `DEPLOYMENT.md`: document collector/status verification commands.
- `src/components/dashboard/StatusToken.tsx`: small status label component.
- `src/components/dashboard/MetricsSparkline.tsx`: SVG sparkline tolerant of empty history.
- `src/components/dashboard/VpsStatusSummary.tsx`: public-safe VPS summary.
- `src/components/dashboard/ProjectHealthRow.tsx`: project posture plus live health row.
- `src/components/dashboard/ProjectDashboard.tsx`: homepage dashboard orchestration.
- `src/components/dashboard/OwnerMetricsPanel.tsx`: exact owner-only status panel.
- `src/components/dashboard/StatusInventory.tsx`: `/status` public and owner service inventories.
- `src/app/page.tsx`: async homepage that reads project data, GitHub stats, and public metrics.
- `src/app/status/page.tsx`: dynamic public/owner status page.
- `src/components/layout/Header.tsx`: add `Status` navigation link.
- `src/app/globals.css`: small dashboard utility styles only if Tailwind classes are insufficient.

Task boundaries:

- Task 1 establishes test runner and shared owner authorization.
- Task 2 establishes metrics validation.
- Task 3 establishes metrics reading and derivation.
- Task 4 builds the collector and static config.
- Task 5 wires deployment and runbook.
- Task 6 builds homepage dashboard UI.
- Task 7 builds `/status` owner/public UI.
- Task 8 performs final verification, visual QA, and Obsidian logging.

### Task 1: Test Runner And Owner Authorization Helper

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `vitest.config.ts`
- Create: `src/lib/authz.ts`
- Create: `src/lib/authz.test.ts`
- Modify: `src/auth.ts`
- Create: `src/auth.test.ts`
- Modify: `src/app/api/data/projects/route.ts`
- Modify: `src/app/api/data/personal/route.ts`
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Consumes: `session?.user` objects from Auth.js.
- Produces:
  - `type AuthzUser = { id?: string | number | null; email?: string | null }`
  - `function isOwnerUser(user: AuthzUser | null | undefined, env?: NodeJS.ProcessEnv): boolean`
  - `function requireOwnerUser(user: AuthzUser | null | undefined, env?: NodeJS.ProcessEnv): void`

- [ ] **Step 1: Install Vitest and add scripts**

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm install --save-dev vitest
```

Expected: `package.json` gains `vitest` in `devDependencies`, and `package-lock.json` updates.

Edit `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: Create Vitest config**

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
```

- [ ] **Step 3: Write failing owner-auth tests**

Create `src/lib/authz.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isOwnerUser, requireOwnerUser } from "./authz";

describe("isOwnerUser", () => {
  it("accepts the configured immutable GitHub id", () => {
    expect(
      isOwnerUser(
        { id: "12345", email: "other@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(true);
  });

  it("accepts the configured owner email when id is absent", () => {
    expect(
      isOwnerUser(
        { id: null, email: "owner@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(true);
  });

  it("rejects missing users and non-owners", () => {
    expect(isOwnerUser(null, { OWNER_GITHUB_ID: "12345" })).toBe(false);
    expect(
      isOwnerUser(
        { id: "999", email: "other@example.com" },
        { OWNER_GITHUB_ID: "12345", OWNER_EMAIL: "owner@example.com" },
      ),
    ).toBe(false);
  });

  it("throws a stable forbidden error from requireOwnerUser", () => {
    expect(() =>
      requireOwnerUser({ id: "999", email: "other@example.com" }, {
        OWNER_GITHUB_ID: "12345",
      }),
    ).toThrow("Forbidden");
  });
});
```

- [ ] **Step 4: Run the focused test and confirm it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/authz.test.ts
```

Expected: FAIL with an import error like `Failed to resolve import "./authz"`.

- [ ] **Step 5: Implement owner-auth helper**

Create `src/lib/authz.ts`:

```ts
export interface AuthzUser {
  id?: string | number | null;
  email?: string | null;
}

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export function isOwnerUser(
  user: AuthzUser | null | undefined,
  env: Pick<NodeJS.ProcessEnv, "OWNER_GITHUB_ID" | "OWNER_EMAIL"> = process.env,
): boolean {
  if (!user) return false;

  const ownerGitHubId = env.OWNER_GITHUB_ID;
  if (ownerGitHubId && user.id && String(user.id) === ownerGitHubId) {
    return true;
  }

  const ownerEmail = env.OWNER_EMAIL;
  if (ownerEmail && user.email && user.email === ownerEmail) {
    return true;
  }

  return false;
}

export function requireOwnerUser(
  user: AuthzUser | null | undefined,
  env: Pick<NodeJS.ProcessEnv, "OWNER_GITHUB_ID" | "OWNER_EMAIL"> = process.env,
): void {
  if (!isOwnerUser(user, env)) {
    throw new ForbiddenError();
  }
}
```

- [ ] **Step 6: Refactor existing owner checks**

In `src/app/api/data/projects/route.ts`, import the helper:

```ts
import { isOwnerUser } from "@/lib/authz";
```

Replace the inline owner block:

```ts
const ownerGitHubId = process.env.OWNER_GITHUB_ID;
const ownerEmail = process.env.OWNER_EMAIL;
const isOwner = Boolean(
  user &&
    ((ownerGitHubId && user.id && String(user.id) === ownerGitHubId) ||
      (ownerEmail && user.email && user.email === ownerEmail)),
);
if (!isOwner) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

with:

```ts
if (!isOwnerUser(user)) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
```

Apply the same replacement in `src/app/api/data/personal/route.ts`.

In `src/app/admin/layout.tsx`, import:

```ts
import { isOwnerUser } from "@/lib/authz";
```

Replace the inline owner-env block with:

```ts
if (!isOwnerUser(user)) redirect("/api/auth/signin");
```

In `src/middleware.ts`, import:

```ts
import { isOwnerUser } from "@/lib/authz";
```

Replace the inline owner check with:

```ts
if (!isOwnerUser(req.auth?.user)) {
  const signInUrl = new URL("/api/auth/signin", req.nextUrl.origin);
  signInUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
  return NextResponse.redirect(signInUrl);
}
```

- [ ] **Step 7: Add Auth.js callback delegation coverage**

Create `src/auth.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const nextAuthMock = vi.fn();
const githubProviderMock = vi.fn(() => ({
  id: "github",
  name: "GitHub",
  type: "oauth",
}));
const isOwnerUserMock = vi.fn();
let capturedConfig: {
  callbacks: {
    authorized: (args: { auth: { user?: { id?: string; email?: string } } | null }) => boolean;
  };
};

vi.mock("next-auth", () => ({
  default: nextAuthMock,
}));

vi.mock("next-auth/providers/github", () => ({
  default: githubProviderMock,
}));

vi.mock("@/lib/authz", () => ({
  isOwnerUser: isOwnerUserMock,
}));

describe("auth authorized callback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    nextAuthMock.mockImplementation((config) => {
      capturedConfig = config;

      return {
        handlers: {},
        signIn: vi.fn(),
        signOut: vi.fn(),
        auth: vi.fn(),
      };
    });
  });

  it("returns false for missing users", async () => {
    await import("./auth");
    const result = capturedConfig.callbacks.authorized({ auth: null });

    expect(result).toBe(false);
    expect(isOwnerUserMock).not.toHaveBeenCalled();
  });

  it("delegates signed-in owner checks to isOwnerUser", async () => {
    isOwnerUserMock.mockReturnValue(true);

    await import("./auth");
    const user = { id: "12345", email: "owner@example.com" };
    const result = capturedConfig.callbacks.authorized({
      auth: { user },
    });

    expect(isOwnerUserMock).toHaveBeenCalledWith(user);
    expect(result).toBe(true);
  });
});
```

In `src/auth.ts`, import:

```ts
import { isOwnerUser } from "@/lib/authz";
```

Replace the inline owner check in the `authorized` callback with:

```ts
authorized({ auth }) {
  const user = auth?.user;
  if (!user) return false;

  return isOwnerUser(user);
},
```

- [ ] **Step 8: Run focused and safety checks**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/authz.test.ts src/auth.test.ts
npm run lint
git diff --check
```

Expected:

- `npm test -- src/lib/authz.test.ts src/auth.test.ts`: PASS.
- `npm run lint`: exit 0.
- `git diff --check`: no output.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/authz.ts src/lib/authz.test.ts src/auth.ts src/auth.test.ts src/app/api/data/projects/route.ts src/app/api/data/personal/route.ts src/app/admin/layout.tsx src/middleware.ts
git commit -m "test: add owner auth test foundation"
```

### Task 2: Metrics Schema Validation Layer

**Files:**
- Create: `src/lib/metrics/types.ts`
- Create: `src/lib/metrics/schema.ts`
- Create: `src/lib/metrics/schema.test.ts`

**Interfaces:**
- Consumes: committed JSON Schema field names and version `1`.
- Produces:
  - `type CheckStatus = "up" | "down" | "unknown"`
  - `type ServiceVisibility = "public" | "owner"`
  - `interface MetricsSnapshot`
  - `interface MetricsHistory`
  - `function parseMetricsSnapshot(input: unknown): MetricsSnapshot`
  - `function parseMetricsHistory(input: unknown): MetricsHistory`
  - `function assertUniqueIds(items: { id: string }[], label: string): void`
  - constants `METRICS_SCHEMA_VERSION`, `MAX_SERVICE_ITEMS`, `MAX_CONTAINER_ITEMS`, `MAX_HISTORY_SAMPLES`, `FRESH_MS`, `UNAVAILABLE_MS`

- [ ] **Step 1: Write failing schema tests**

Create `src/lib/metrics/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  parseMetricsHistory,
  parseMetricsSnapshot,
} from "./schema";

const validSnapshot = {
  schema_version: 1,
  collected_at: "2026-07-09T02:00:00Z",
  host: {
    cpu_percent: 12.5,
    ram_used_bytes: 1024,
    ram_total_bytes: 4096,
    disk_used_bytes: 2048,
    disk_total_bytes: 8192,
    load_1m: 0.3,
    load_5m: 0.4,
    load_15m: 0.5,
    uptime_seconds: 123456,
  },
  services: [
    {
      id: "frontpage-public",
      label: "Frontpage",
      project_slug: "frontpage",
      visibility: "public",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: 42,
    },
  ],
  containers: [
    {
      id: "frontpage-container",
      label: "Frontpage container",
      project_slug: "frontpage",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
    },
  ],
};

describe("parseMetricsSnapshot", () => {
  it("accepts a valid v1 snapshot", () => {
    expect(parseMetricsSnapshot(validSnapshot)).toEqual(validSnapshot);
  });

  it("rejects wrong schema versions", () => {
    expect(() =>
      parseMetricsSnapshot({ ...validSnapshot, schema_version: 2 }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects non-UTC timestamps", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        collected_at: "2026-07-09T02:00:00+02:00",
      }),
    ).toThrow("Invalid metrics snapshot");
  });

  it("rejects duplicate service ids", () => {
    expect(() =>
      parseMetricsSnapshot({
        ...validSnapshot,
        services: [validSnapshot.services[0], validSnapshot.services[0]],
      }),
    ).toThrow("Duplicate service id");
  });

  it("allows null latency for timed-out checks", () => {
    const parsed = parseMetricsSnapshot({
      ...validSnapshot,
      services: [{ ...validSnapshot.services[0], latency_ms: null }],
    });

    expect(parsed.services[0]?.latency_ms).toBeNull();
  });
});

describe("parseMetricsHistory", () => {
  it("accepts a bounded history wrapper", () => {
    expect(
      parseMetricsHistory({
        schema_version: 1,
        samples: [validSnapshot],
      }),
    ).toEqual({
      schema_version: 1,
      samples: [validSnapshot],
    });
  });

  it("rejects a bad sample without rejecting latest elsewhere", () => {
    expect(() =>
      parseMetricsHistory({
        schema_version: 1,
        samples: [{ ...validSnapshot, schema_version: 2 }],
      }),
    ).toThrow("Invalid metrics history");
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/schema.test.ts
```

Expected: FAIL with an import error for `./schema`.

- [ ] **Step 3: Define metrics types and constants**

Create `src/lib/metrics/types.ts`:

```ts
export const METRICS_SCHEMA_VERSION = 1;
export const MAX_SERVICE_ITEMS = 64;
export const MAX_CONTAINER_ITEMS = 64;
export const MAX_HISTORY_SAMPLES = 1440;
export const FRESH_MS = 90_000;
export const UNAVAILABLE_MS = 5 * 60_000;

export type CheckStatus = "up" | "down" | "unknown";
export type ServiceVisibility = "public" | "owner";
export type MetricsFreshness = "fresh" | "stale" | "unavailable";
export type PublicVpsState = "online" | "pressure" | "stale" | "unknown";
export type DiskPressure = "ok" | "watch" | "critical" | "unknown";
export type PublicMetricBucket = "low" | "medium" | "high" | "unknown";

export interface HostMetrics {
  cpu_percent: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
  disk_used_bytes: number;
  disk_total_bytes: number;
  load_1m: number;
  load_5m: number;
  load_15m: number;
  uptime_seconds: number;
}

export interface ServiceCheck {
  id: string;
  label: string;
  project_slug?: string;
  visibility: ServiceVisibility;
  status: CheckStatus;
  checked_at: string;
  latency_ms: number | null;
}

export interface ContainerStatus {
  id: string;
  label: string;
  project_slug?: string;
  status: CheckStatus;
  checked_at: string;
}

export interface MetricsSnapshot {
  schema_version: 1;
  collected_at: string;
  host: HostMetrics;
  services: ServiceCheck[];
  containers: ContainerStatus[];
}

export interface MetricsHistory {
  schema_version: 1;
  samples: MetricsSnapshot[];
}
```

- [ ] **Step 4: Implement Zod schemas and parse helpers**

Create `src/lib/metrics/schema.ts`:

```ts
import { z } from "zod";
import {
  MAX_CONTAINER_ITEMS,
  MAX_HISTORY_SAMPLES,
  MAX_SERVICE_ITEMS,
  METRICS_SCHEMA_VERSION,
  type MetricsHistory,
  type MetricsSnapshot,
} from "./types";

const utcDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/,
    "Timestamp must be an ISO 8601 UTC value ending in Z.",
  )
  .refine((value) => !Number.isNaN(Date.parse(value)), "Timestamp must be a real date.");

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const statusSchema = z.enum(["up", "down", "unknown"]);

export function assertUniqueIds(
  items: { id: string }[],
  label: "service" | "container",
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id: ${item.id}`);
    }
    seen.add(item.id);
  }
}

const hostSchema = z.object({
  cpu_percent: z.number().min(0).max(100),
  ram_used_bytes: z.number().int().min(0),
  ram_total_bytes: z.number().int().min(1),
  disk_used_bytes: z.number().int().min(0),
  disk_total_bytes: z.number().int().min(1),
  load_1m: z.number().min(0),
  load_5m: z.number().min(0),
  load_15m: z.number().min(0),
  uptime_seconds: z.number().int().min(0),
}).strict();

const serviceCheckSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(80),
  project_slug: idSchema.optional(),
  visibility: z.enum(["public", "owner"]),
  status: statusSchema,
  checked_at: utcDateTimeSchema,
  latency_ms: z.number().int().min(0).max(10_000).nullable(),
}).strict();

const containerStatusSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(80),
  project_slug: idSchema.optional(),
  status: statusSchema,
  checked_at: utcDateTimeSchema,
}).strict();

export const metricsSnapshotSchema = z.object({
  schema_version: z.literal(METRICS_SCHEMA_VERSION),
  collected_at: utcDateTimeSchema,
  host: hostSchema,
  services: z.array(serviceCheckSchema).max(MAX_SERVICE_ITEMS),
  containers: z.array(containerStatusSchema).max(MAX_CONTAINER_ITEMS),
}).strict();

export const metricsHistorySchema = z.object({
  schema_version: z.literal(METRICS_SCHEMA_VERSION),
  samples: z.array(metricsSnapshotSchema).max(MAX_HISTORY_SAMPLES),
}).strict();

export function parseMetricsSnapshot(input: unknown): MetricsSnapshot {
  const parsed = metricsSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid metrics snapshot: ${parsed.error.message}`);
  }
  assertUniqueIds(parsed.data.services, "service");
  assertUniqueIds(parsed.data.containers, "container");
  return parsed.data as MetricsSnapshot;
}

export function parseMetricsHistory(input: unknown): MetricsHistory {
  const parsed = metricsHistorySchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Invalid metrics history: ${parsed.error.message}`);
  }
  for (const sample of parsed.data.samples) {
    assertUniqueIds(sample.services, "service");
    assertUniqueIds(sample.containers, "container");
  }
  return parsed.data as MetricsHistory;
}
```

- [ ] **Step 5: Run focused tests and schema artifact sanity checks**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/schema.test.ts
node -e "const fs=require('fs'); for (const f of ['docs/superpowers/specs/2026-07-09-frontpage-metrics.schema.v1.json','docs/superpowers/specs/2026-07-09-frontpage-metrics-history.schema.v1.json']) JSON.parse(fs.readFileSync(f,'utf8'));"
git diff --check
```

Expected:

- Focused Vitest file: PASS.
- Node schema parse command: exit 0.
- `git diff --check`: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/types.ts src/lib/metrics/schema.ts src/lib/metrics/schema.test.ts
git commit -m "feat: validate vps metrics schema"
```

### Task 3: Metrics Reader And Public/Owner Derivation

**Files:**
- Create: `src/lib/metrics/reader.ts`
- Create: `src/lib/metrics/reader.test.ts`

**Interfaces:**
- Consumes: `parseMetricsSnapshot`, `parseMetricsHistory`, `MetricsSnapshot`, `MetricsHistory`, project `slug` fields.
- Produces:
  - `interface MetricsReadResult`
  - `interface PublicMetricsModel`
  - `interface OwnerMetricsModel`
  - `function readMetricsFromDir(metricsDir: string | undefined, now?: Date): MetricsReadResult`
  - `function getMetricsDir(): string | undefined`
  - `function derivePublicMetrics(result: MetricsReadResult, now?: Date): PublicMetricsModel`
  - `function deriveOwnerMetrics(result: MetricsReadResult): OwnerMetricsModel | null`
  - `function getProjectHealthBySlug(services: PublicServiceStatus[]): Record<string, PublicServiceStatus>`

- [ ] **Step 1: Write failing reader tests**

Create `src/lib/metrics/reader.test.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deriveOwnerMetrics,
  derivePublicMetrics,
  getProjectHealthBySlug,
  readMetricsFromDir,
} from "./reader";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontpage-metrics-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const snapshot = {
  schema_version: 1,
  collected_at: "2026-07-09T02:00:00Z",
  host: {
    cpu_percent: 10,
    ram_used_bytes: 20,
    ram_total_bytes: 100,
    disk_used_bytes: 70,
    disk_total_bytes: 100,
    load_1m: 0.1,
    load_5m: 0.2,
    load_15m: 0.3,
    uptime_seconds: 99,
  },
  services: [
    {
      id: "frontpage-public",
      label: "Frontpage",
      project_slug: "frontpage",
      visibility: "public",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: 33,
    },
    {
      id: "frontpage-internal",
      label: "Frontpage internal",
      project_slug: "frontpage",
      visibility: "owner",
      status: "down",
      checked_at: "2026-07-09T02:00:00Z",
      latency_ms: null,
    },
  ],
  containers: [
    {
      id: "frontpage-container",
      label: "Frontpage container",
      project_slug: "frontpage",
      status: "up",
      checked_at: "2026-07-09T02:00:00Z",
    },
  ],
};

describe("readMetricsFromDir", () => {
  it("returns unavailable when METRICS_DIR is not configured", () => {
    const result = readMetricsFromDir(undefined, new Date("2026-07-09T02:00:30Z"));
    expect(result.freshness).toBe("unavailable");
    expect(result.diagnostics).toContain("METRICS_DIR is not configured.");
  });

  it("reads fresh latest and history snapshots", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [snapshot] }),
    );

    const result = readMetricsFromDir(dir, new Date("2026-07-09T02:00:30Z"));
    expect(result.freshness).toBe("fresh");
    expect(result.latest?.services).toHaveLength(2);
    expect(result.history).toHaveLength(1);
  });

  it("keeps latest usable when history is malformed", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(path.join(dir, "history.json"), "{bad json");

    const result = readMetricsFromDir(dir, new Date("2026-07-09T02:00:30Z"));
    expect(result.freshness).toBe("fresh");
    expect(result.latest).not.toBeNull();
    expect(result.history).toEqual([]);
    expect(result.diagnostics.join(" ")).toContain("history.json");
  });

  it("marks old metrics unavailable after five minutes", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));

    const result = readMetricsFromDir(dir, new Date("2026-07-09T02:06:00Z"));
    expect(result.freshness).toBe("unavailable");
  });
});

describe("derivePublicMetrics", () => {
  it("derives coarse public status without exact host metrics", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    fs.writeFileSync(
      path.join(dir, "history.json"),
      JSON.stringify({ schema_version: 1, samples: [snapshot] }),
    );
    const result = readMetricsFromDir(dir, new Date("2026-07-09T02:00:30Z"));

    const publicModel = derivePublicMetrics(result, new Date("2026-07-09T02:00:30Z"));
    expect(publicModel.host.diskPressure).toBe("ok");
    expect(publicModel.services).toHaveLength(1);
    expect(publicModel.history[0]).toEqual({
      collectedAt: "2026-07-09T02:00:00Z",
      cpu: "low",
      ram: "low",
      disk: "ok",
    });
    expect(JSON.stringify(publicModel)).not.toContain("ram_used_bytes");
    expect(JSON.stringify(publicModel)).not.toContain("cpu_percent");
    expect(JSON.stringify(publicModel)).not.toContain("cpuPercent");
    expect(JSON.stringify(publicModel)).not.toContain("ramPercent");
    expect(JSON.stringify(publicModel)).not.toContain("diskPercent");
    expect(JSON.stringify(publicModel)).not.toContain("load_1m");
  });

  it("joins public services by project slug", () => {
    const model = getProjectHealthBySlug([
      {
        id: "frontpage-public",
        label: "Frontpage",
        projectSlug: "frontpage",
        status: "up",
        latencyMs: 33,
        checkedAt: "2026-07-09T02:00:00Z",
      },
    ]);

    expect(model.frontpage?.status).toBe("up");
  });
});

describe("deriveOwnerMetrics", () => {
  it("keeps exact host and owner-only data for authenticated owner rendering", () => {
    const dir = makeTempDir();
    fs.writeFileSync(path.join(dir, "latest.json"), JSON.stringify(snapshot));
    const result = readMetricsFromDir(dir, new Date("2026-07-09T02:00:30Z"));

    const ownerModel = deriveOwnerMetrics(result);
    expect(ownerModel?.latest?.host.ram_used_bytes).toBe(20);
    expect(ownerModel?.latest?.services).toHaveLength(2);
    expect(ownerModel?.latest?.containers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/reader.test.ts
```

Expected: FAIL with an import error for `./reader`.

- [ ] **Step 3: Implement the reader and derivation functions**

Create `src/lib/metrics/reader.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { parseMetricsHistory, parseMetricsSnapshot } from "./schema";
import {
  FRESH_MS,
  UNAVAILABLE_MS,
  type CheckStatus,
  type DiskPressure,
  type MetricsFreshness,
  type MetricsSnapshot,
  type PublicMetricBucket,
  type PublicVpsState,
} from "./types";

export interface MetricsReadResult {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  diagnostics: string[];
}

export interface PublicServiceStatus {
  id: string;
  label: string;
  projectSlug?: string;
  status: CheckStatus;
  latencyMs: number | null;
  checkedAt: string;
}

export interface PublicMetricsModel {
  freshness: MetricsFreshness;
  host: {
    state: PublicVpsState;
    diskPressure: DiskPressure;
    lastUpdatedAt: string | null;
    lastUpdatedLabel: string;
    serviceSummary: {
      total: number;
      up: number;
      down: number;
      unknown: number;
    };
  };
  services: PublicServiceStatus[];
  projectHealthBySlug: Record<string, PublicServiceStatus>;
  history: Array<{
    collectedAt: string;
    cpu: PublicMetricBucket;
    ram: PublicMetricBucket;
    disk: DiskPressure;
  }>;
  diagnostics: string[];
}

export interface OwnerMetricsModel {
  freshness: MetricsFreshness;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
  diagnostics: string[];
}

export function getMetricsDir(): string | undefined {
  return process.env.METRICS_DIR;
}

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ageMs(snapshot: MetricsSnapshot, now: Date): number {
  return now.getTime() - new Date(snapshot.collected_at).getTime();
}

function freshnessFor(snapshot: MetricsSnapshot | null, now: Date): MetricsFreshness {
  if (!snapshot) return "unavailable";
  const age = ageMs(snapshot, now);
  if (age < 0) return "unavailable";
  if (age <= FRESH_MS) return "fresh";
  if (age <= UNAVAILABLE_MS) return "stale";
  return "unavailable";
}

export function readMetricsFromDir(
  metricsDir: string | undefined,
  now: Date = new Date(),
): MetricsReadResult {
  const diagnostics: string[] = [];
  if (!metricsDir) {
    return {
      freshness: "unavailable",
      latest: null,
      history: [],
      diagnostics: ["METRICS_DIR is not configured."],
    };
  }

  let latest: MetricsSnapshot | null = null;
  try {
    latest = parseMetricsSnapshot(readJsonFile(path.join(metricsDir, "latest.json")));
  } catch (error) {
    diagnostics.push(`latest.json unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  let history: MetricsSnapshot[] = [];
  try {
    history = parseMetricsHistory(readJsonFile(path.join(metricsDir, "history.json"))).samples;
  } catch (error) {
    diagnostics.push(`history.json unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    freshness: freshnessFor(latest, now),
    latest,
    history,
    diagnostics,
  };
}

function percent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
}

function diskPressureFromPercent(diskPercent: number): DiskPressure {
  if (diskPercent >= 90) return "critical";
  if (diskPercent >= 75) return "watch";
  return "ok";
}

function diskPressure(snapshot: MetricsSnapshot | null): DiskPressure {
  if (!snapshot) return "unknown";
  return diskPressureFromPercent(percent(snapshot.host.disk_used_bytes, snapshot.host.disk_total_bytes));
}

function usageBucket(percentValue: number): PublicMetricBucket {
  if (!Number.isFinite(percentValue)) return "unknown";
  if (percentValue >= 85) return "high";
  if (percentValue >= 60) return "medium";
  return "low";
}

function publicState(freshness: MetricsFreshness, snapshot: MetricsSnapshot | null): PublicVpsState {
  if (freshness === "unavailable" || !snapshot) return "unknown";
  if (freshness === "stale") return "stale";
  return diskPressure(snapshot) === "critical" ? "pressure" : "online";
}

function ageLabel(snapshot: MetricsSnapshot | null, now: Date): string {
  if (!snapshot) return "unknown";
  const seconds = Math.max(0, Math.round(ageMs(snapshot, now) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

function publicServices(snapshot: MetricsSnapshot | null): PublicServiceStatus[] {
  if (!snapshot) return [];
  return snapshot.services
    .filter((service) => service.visibility === "public")
    .map((service) => ({
      id: service.id,
      label: service.label,
      projectSlug: service.project_slug,
      status: service.status,
      latencyMs: service.latency_ms,
      checkedAt: service.checked_at,
    }));
}

export function getProjectHealthBySlug(
  services: PublicServiceStatus[],
): Record<string, PublicServiceStatus> {
  const bySlug: Record<string, PublicServiceStatus> = {};
  for (const service of services) {
    if (service.projectSlug && !bySlug[service.projectSlug]) {
      bySlug[service.projectSlug] = service;
    }
  }
  return bySlug;
}

export function derivePublicMetrics(
  result: MetricsReadResult,
  now: Date = new Date(),
): PublicMetricsModel {
  const services = publicServices(result.latest);
  const serviceSummary = services.reduce(
    (summary, service) => {
      summary.total += 1;
      summary[service.status] += 1;
      return summary;
    },
    { total: 0, up: 0, down: 0, unknown: 0 },
  );

  return {
    freshness: result.freshness,
    host: {
      state: publicState(result.freshness, result.latest),
      diskPressure: diskPressure(result.latest),
      lastUpdatedAt: result.latest?.collected_at ?? null,
      lastUpdatedLabel: ageLabel(result.latest, now),
      serviceSummary,
    },
    services,
    projectHealthBySlug: getProjectHealthBySlug(services),
    history: result.history.map((sample) => ({
      collectedAt: sample.collected_at,
      cpu: usageBucket(sample.host.cpu_percent),
      ram: usageBucket(percent(sample.host.ram_used_bytes, sample.host.ram_total_bytes)),
      disk: diskPressureFromPercent(percent(sample.host.disk_used_bytes, sample.host.disk_total_bytes)),
    })),
    diagnostics: result.diagnostics,
  };
}

export function deriveOwnerMetrics(result: MetricsReadResult): OwnerMetricsModel | null {
  if (!result.latest) return null;
  return {
    freshness: result.freshness,
    latest: result.latest,
    history: result.history,
    diagnostics: result.diagnostics,
  };
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/reader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run metrics test suite**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics
npm run lint
git diff --check
```

Expected:

- Metrics tests: PASS.
- Lint: exit 0.
- Diff check: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/reader.ts src/lib/metrics/reader.test.ts
git commit -m "feat: derive public vps metrics"
```

### Task 4: Host Metrics Collector And Static Config

**Files:**
- Create: `ops/frontpage-metrics.config.json`
- Create: `ops/frontpage-metrics-collector.py`
- Create: `ops/tests/test_frontpage_metrics_collector.py`

**Interfaces:**
- Consumes: static JSON config, `/proc/stat`, `/proc/meminfo`, `df`, `/proc/uptime`, HTTP/HTTPS service URLs, allowlisted Docker container names.
- Produces:
  - `latest.json` matching snapshot schema v1.
  - `history.json` matching history schema v1.
  - Python functions `load_config`, `clamp_timeout_ms`, `service_result`, `container_status_from_inspect`, `prune_history`, `atomic_write_json`, `collect_snapshot`.

- [ ] **Step 1: Write failing collector tests**

Create `ops/tests/test_frontpage_metrics_collector.py`:

```py
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "frontpage-metrics-collector.py"
SPEC = importlib.util.spec_from_file_location("frontpage_metrics_collector", MODULE_PATH)
collector = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_clamp_timeout_ms(self):
        self.assertEqual(collector.clamp_timeout_ms(50), 1000)
        self.assertEqual(collector.clamp_timeout_ms(5000), 5000)
        self.assertEqual(collector.clamp_timeout_ms(50000), 10000)

    def test_load_config_rejects_secret_url(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "config.json"
            config_path.write_text(json.dumps({
                "schema_version": 1,
                "services": [{
                    "id": "bad",
                    "label": "Bad",
                    "visibility": "public",
                    "url": "https://user:pass@example.com/health",
                    "expected_status": 200,
                    "timeout_ms": 5000
                }],
                "containers": []
            }))

            with self.assertRaises(ValueError):
                collector.load_config(config_path)

    def test_service_result_sanitizes_errors(self):
        result = collector.service_result(
            {
                "id": "frontpage-public",
                "label": "Frontpage",
                "visibility": "public",
                "url": "https://example.invalid/health",
                "expected_status": 200,
                "timeout_ms": 1000,
            },
            opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("secret path /root/x")),
            now=lambda: "2026-07-09T02:00:00Z",
        )

        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["latency_ms"], None)
        self.assertNotIn("secret", json.dumps(result))

    def test_container_status_from_inspect(self):
        self.assertEqual(
            collector.container_status_from_inspect({"State": {"Running": True, "Health": {"Status": "healthy"}}}),
            "up",
        )
        self.assertEqual(
            collector.container_status_from_inspect({"State": {"Running": False}}),
            "down",
        )
        self.assertEqual(collector.container_status_from_inspect({}), "unknown")

    def test_prune_history_keeps_latest_1440(self):
        samples = [{"schema_version": 1, "collected_at": f"2026-07-09T00:{i % 60:02d}:00Z"} for i in range(1500)]
        pruned = collector.prune_history(samples)
        self.assertEqual(len(pruned), 1440)
        self.assertEqual(pruned[0]["collected_at"], samples[-1440]["collected_at"])

    def test_atomic_write_json_writes_complete_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "latest.json"
            collector.atomic_write_json(target, {"schema_version": 1})
            self.assertEqual(json.loads(target.read_text()), {"schema_version": 1})
            self.assertFalse((Path(tmp) / "latest.json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run collector tests and confirm they fail**

Run:

```bash
python3 -m unittest ops/tests/test_frontpage_metrics_collector.py
```

Expected: FAIL because `ops/frontpage-metrics-collector.py` does not exist.

- [ ] **Step 3: Add static config**

Create `ops/frontpage-metrics.config.json`:

```json
{
  "schema_version": 1,
  "services": [
    {
      "id": "frontpage-public",
      "label": "Frontpage",
      "project_slug": "frontpage",
      "visibility": "public",
      "url": "https://reidar.tech/api/health",
      "expected_status": 200,
      "timeout_ms": 5000
    },
    {
      "id": "frontpage-internal",
      "label": "Frontpage internal",
      "project_slug": "frontpage",
      "visibility": "owner",
      "url": "http://127.0.0.1:3002/api/health",
      "expected_status": 200,
      "timeout_ms": 3000
    }
  ],
  "containers": [
    {
      "id": "frontpage-container",
      "label": "Frontpage container",
      "project_slug": "frontpage",
      "name": "frontpage"
    }
  ]
}
```

- [ ] **Step 4: Implement collector**

Create `ops/frontpage-metrics-collector.py`:

```py
#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 1
MAX_HISTORY = 1440
MAX_ITEMS = 64


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def clamp_timeout_ms(value):
    return max(1000, min(int(value), 10000))


def _validate_id(value):
    if not isinstance(value, str) or not value or len(value) > 63:
        raise ValueError("Invalid id")
    if not value[0].isalnum() or value.lower() != value:
        raise ValueError("Invalid id")
    for char in value:
        if not (char.isdigit() or char.islower() or char == "-"):
            raise ValueError("Invalid id")


def _reject_secret_url(url):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("Service URL must be http or https")
    if parsed.username or parsed.password:
        raise ValueError("Service URL must not contain credentials")


def load_config(path):
    data = json.loads(Path(path).read_text())
    if data.get("schema_version") != SCHEMA_VERSION:
        raise ValueError("Unsupported config schema_version")
    services = data.get("services", [])
    containers = data.get("containers", [])
    if len(services) > MAX_ITEMS or len(containers) > MAX_ITEMS:
        raise ValueError("Too many configured services or containers")

    seen_services = set()
    for service in services:
        _validate_id(service["id"])
        if service["id"] in seen_services:
            raise ValueError(f"Duplicate service id: {service['id']}")
        seen_services.add(service["id"])
        _reject_secret_url(service["url"])
        service["timeout_ms"] = clamp_timeout_ms(service.get("timeout_ms", 5000))
        if service.get("visibility") not in {"public", "owner"}:
            raise ValueError("Service visibility must be public or owner")

    seen_containers = set()
    for container in containers:
        _validate_id(container["id"])
        if container["id"] in seen_containers:
            raise ValueError(f"Duplicate container id: {container['id']}")
        seen_containers.add(container["id"])
        name = container.get("name")
        if not isinstance(name, str) or not name or any(c in name for c in "*?[]"):
            raise ValueError("Container names must be exact strings")

    return {"schema_version": SCHEMA_VERSION, "services": services, "containers": containers}


def read_cpu_times():
    first_line = Path("/proc/stat").read_text().splitlines()[0]
    parts = [int(part) for part in first_line.split()[1:]]
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
    total = sum(parts)
    return idle, total


def collect_cpu_percent():
    idle_a, total_a = read_cpu_times()
    time.sleep(0.1)
    idle_b, total_b = read_cpu_times()
    total_delta = total_b - total_a
    idle_delta = idle_b - idle_a
    if total_delta <= 0:
        return 0
    return round(max(0, min(100, (1 - idle_delta / total_delta) * 100)), 1)


def collect_meminfo():
    values = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        key, raw = line.split(":", 1)
        values[key] = int(raw.strip().split()[0]) * 1024
    total = values["MemTotal"]
    available = values.get("MemAvailable", 0)
    return total - available, total


def collect_host_metrics():
    ram_used, ram_total = collect_meminfo()
    disk = shutil.disk_usage("/")
    load_1m, load_5m, load_15m = os.getloadavg()
    uptime_seconds = int(float(Path("/proc/uptime").read_text().split()[0]))
    return {
        "cpu_percent": collect_cpu_percent(),
        "ram_used_bytes": int(ram_used),
        "ram_total_bytes": int(ram_total),
        "disk_used_bytes": int(disk.used),
        "disk_total_bytes": int(disk.total),
        "load_1m": round(float(load_1m), 2),
        "load_5m": round(float(load_5m), 2),
        "load_15m": round(float(load_15m), 2),
        "uptime_seconds": uptime_seconds,
    }


def service_result(service, opener=urllib.request.urlopen, now=utc_now):
    started = time.monotonic()
    timeout_seconds = clamp_timeout_ms(service.get("timeout_ms", 5000)) / 1000
    status = "unknown"
    latency_ms = None
    try:
        request = urllib.request.Request(service["url"], method="GET")
        with opener(request, timeout=timeout_seconds) as response:
            latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
            status = "up" if response.status == int(service.get("expected_status", 200)) else "down"
    except urllib.error.HTTPError as error:
        latency_ms = min(10000, int(round((time.monotonic() - started) * 1000)))
        status = "up" if error.code == int(service.get("expected_status", 200)) else "down"
    except Exception:
        status = "unknown"
        latency_ms = None

    result = {
        "id": service["id"],
        "label": service["label"],
        "visibility": service["visibility"],
        "status": status,
        "checked_at": now(),
        "latency_ms": latency_ms,
    }
    if service.get("project_slug"):
        result["project_slug"] = service["project_slug"]
    return result


def container_status_from_inspect(data):
    state = data.get("State", {})
    if not state:
        return "unknown"
    if not state.get("Running"):
        return "down"
    health = state.get("Health")
    if isinstance(health, dict):
        return "up" if health.get("Status") == "healthy" else "down"
    return "up"


def inspect_container(name):
    try:
        completed = subprocess.run(
            ["docker", "inspect", name],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
        )
        if completed.returncode != 0:
            return "unknown"
        parsed = json.loads(completed.stdout)
        if not parsed:
            return "unknown"
        return container_status_from_inspect(parsed[0])
    except Exception:
        return "unknown"


def container_result(container, now=utc_now):
    result = {
        "id": container["id"],
        "label": container["label"],
        "status": inspect_container(container["name"]),
        "checked_at": now(),
    }
    if container.get("project_slug"):
        result["project_slug"] = container["project_slug"]
    return result


def prune_history(samples):
    return list(samples)[-MAX_HISTORY:]


def atomic_write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    os.replace(tmp, path)


def load_history(path):
    try:
        data = json.loads(Path(path).read_text())
        if data.get("schema_version") != SCHEMA_VERSION:
            return []
        return list(data.get("samples", []))
    except Exception:
        return []


def collect_snapshot(config):
    collected_at = utc_now()
    return {
        "schema_version": SCHEMA_VERSION,
        "collected_at": collected_at,
        "host": collect_host_metrics(),
        "services": [service_result(service) for service in config["services"]],
        "containers": [container_result(container) for container in config["containers"]],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--metrics-dir", required=True)
    args = parser.parse_args()

    config = load_config(Path(args.config))
    metrics_dir = Path(args.metrics_dir)
    snapshot = collect_snapshot(config)
    atomic_write_json(metrics_dir / "latest.json", snapshot)
    samples = prune_history(load_history(metrics_dir / "history.json") + [snapshot])
    atomic_write_json(metrics_dir / "history.json", {"schema_version": SCHEMA_VERSION, "samples": samples})


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run collector tests and syntax checks**

Run:

```bash
python3 -m unittest ops/tests/test_frontpage_metrics_collector.py
python3 -m py_compile ops/frontpage-metrics-collector.py
python3 ops/frontpage-metrics-collector.py --config ops/frontpage-metrics.config.json --metrics-dir "$(mktemp -d)"
git diff --check
```

Expected:

- Unit tests: PASS.
- `py_compile`: exit 0.
- One-shot collector: exit 0 and writes metrics to the temporary directory.
- Diff check: no output.

- [ ] **Step 6: Commit**

```bash
git add ops/frontpage-metrics.config.json ops/frontpage-metrics-collector.py ops/tests/test_frontpage_metrics_collector.py
git commit -m "feat: add frontpage metrics collector"
```

### Task 5: Deployment Wiring And Runbook

**Files:**
- Create: `ops/systemd/frontpage-metrics-collector.service`
- Create: `ops/systemd/frontpage-metrics-collector.timer`
- Modify: `ansible-playbook.yml`
- Modify: `DEPLOYMENT.md`

**Interfaces:**
- Consumes: `ops/frontpage-metrics-collector.py`, `ops/frontpage-metrics.config.json`.
- Produces:
  - `/usr/local/bin/frontpage-metrics-collector`
  - `/etc/frontpage-metrics/config.json`
  - `/var/lib/frontpage-metrics/latest.json`
  - `/var/lib/frontpage-metrics/history.json`
  - `frontpage-metrics-collector.service`
  - `frontpage-metrics-collector.timer`
  - Frontpage container env `METRICS_DIR=/metrics`
  - Frontpage container read-only bind mount `/var/lib/frontpage-metrics:/metrics:ro`

- [ ] **Step 1: Add systemd unit files**

Create `ops/systemd/frontpage-metrics-collector.service`:

```ini
[Unit]
Description=Frontpage VPS metrics collector
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=oneshot
User=frontpage-metrics
Group=frontpage-metrics
ExecStart=/usr/local/bin/frontpage-metrics-collector --config /etc/frontpage-metrics/config.json --metrics-dir /var/lib/frontpage-metrics
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=/var/lib/frontpage-metrics
```

Create `ops/systemd/frontpage-metrics-collector.timer`:

```ini
[Unit]
Description=Run Frontpage VPS metrics collector every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s
Unit=frontpage-metrics-collector.service

[Install]
WantedBy=timers.target
```

- [ ] **Step 2: Patch Ansible playbook**

In `ansible-playbook.yml`, add vars:

```yaml
    metrics_dir: "/var/lib/frontpage-metrics"
    metrics_config_dir: "/etc/frontpage-metrics"
    metrics_user: "frontpage-metrics"
```

Before `Pull latest image from GHCR`, add tasks:

```yaml
    - name: Create metrics collector user
      become: true
      ansible.builtin.user:
        name: "{{ metrics_user }}"
        system: true
        shell: /usr/sbin/nologin
        create_home: false

    - name: Create metrics directories
      become: true
      ansible.builtin.file:
        path: "{{ item.path }}"
        state: directory
        owner: "{{ item.owner }}"
        group: "{{ item.group }}"
        mode: "{{ item.mode }}"
      loop:
        - { path: "{{ metrics_dir }}", owner: "{{ metrics_user }}", group: "{{ metrics_user }}", mode: "0755" }
        - { path: "{{ metrics_config_dir }}", owner: "root", group: "root", mode: "0755" }

    - name: Install metrics collector script
      become: true
      ansible.builtin.copy:
        src: ops/frontpage-metrics-collector.py
        dest: /usr/local/bin/frontpage-metrics-collector
        owner: root
        group: root
        mode: "0755"

    - name: Install metrics collector config
      become: true
      ansible.builtin.copy:
        src: ops/frontpage-metrics.config.json
        dest: "{{ metrics_config_dir }}/config.json"
        owner: root
        group: root
        mode: "0644"

    - name: Install metrics collector systemd units
      become: true
      ansible.builtin.copy:
        src: "ops/systemd/{{ item }}"
        dest: "/etc/systemd/system/{{ item }}"
        owner: root
        group: root
        mode: "0644"
      loop:
        - frontpage-metrics-collector.service
        - frontpage-metrics-collector.timer
      notify: Reload systemd

    - name: Enable metrics collector timer
      become: true
      ansible.builtin.systemd:
        name: frontpage-metrics-collector.timer
        enabled: true
        state: started
        daemon_reload: true

    - name: Run metrics collector once before app swap
      become: true
      ansible.builtin.systemd:
        name: frontpage-metrics-collector.service
        state: started

    - name: Verify metrics latest file exists
      become: true
      ansible.builtin.stat:
        path: "{{ metrics_dir }}/latest.json"
      register: metrics_latest

    - name: Fail if metrics latest file is missing
      ansible.builtin.fail:
        msg: "Frontpage metrics collector did not write latest.json"
      when: not metrics_latest.stat.exists
```

Add handlers at the end of the play:

```yaml
  handlers:
    - name: Reload systemd
      become: true
      ansible.builtin.systemd:
        daemon_reload: true
```

In the `Start new container` task, add env:

```yaml
          METRICS_DIR: "/metrics"
```

Add a volume:

```yaml
          - "{{ metrics_dir }}:/metrics:ro"
```

Apply the same `METRICS_DIR` env and read-only volume in the rollback container task.

- [ ] **Step 3: Add deploy read-only verification task**

After `Verify container is running`, add:

```yaml
    - name: Verify app container can read metrics read-only
      community.docker.docker_container_exec:
        container: "{{ container_name }}"
        command: "node -e \"const fs=require('fs'); fs.accessSync('/metrics/latest.json', fs.constants.R_OK); try { fs.writeFileSync('/metrics/.write-test', 'x'); process.exit(2); } catch { process.exit(0); }\""
      register: metrics_mount_check
      changed_when: false
```

- [ ] **Step 4: Add runbook docs**

In `DEPLOYMENT.md`, add a `VPS metrics collector` section:

```markdown
## VPS metrics collector

Frontpage v1 ships a host collector installed by Ansible:

- `/usr/local/bin/frontpage-metrics-collector`
- `/etc/frontpage-metrics/config.json`
- `/var/lib/frontpage-metrics/latest.json`
- `/var/lib/frontpage-metrics/history.json`
- `frontpage-metrics-collector.service`
- `frontpage-metrics-collector.timer`

Verify on the VPS:

```bash
ssh deploy@198.23.137.16 "systemctl is-active frontpage-metrics-collector.timer"
ssh deploy@198.23.137.16 "sudo systemctl start frontpage-metrics-collector.service && sudo test -s /var/lib/frontpage-metrics/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage test -r /metrics/latest.json"
ssh deploy@198.23.137.16 "docker exec frontpage sh -lc '! touch /metrics/write-test'"
```

Non-claim: `/api/health` remains app-health only; host status is surfaced by the dashboard and `/status`.
```
```

- [ ] **Step 5: Run syntax checks**

Run:

```bash
python3 -m py_compile ops/frontpage-metrics-collector.py
python3 -m unittest ops/tests/test_frontpage_metrics_collector.py
ansible-playbook --syntax-check -i inventory/hosts.yml ansible-playbook.yml
git diff --check
```

Expected:

- Python compile and tests: PASS.
- Ansible syntax check: PASS. If local Ansible is missing, install it or record the missing tool as a blocker before proceeding.
- Diff check: no output.

- [ ] **Step 6: Commit**

```bash
git add ops/systemd/frontpage-metrics-collector.service ops/systemd/frontpage-metrics-collector.timer ansible-playbook.yml DEPLOYMENT.md
git commit -m "deploy: install frontpage metrics collector"
```

### Task 6: Homepage Project OS Dashboard UI

**Files:**
- Create: `src/components/dashboard/StatusToken.tsx`
- Create: `src/components/dashboard/MetricsSparkline.tsx`
- Create: `src/components/dashboard/VpsStatusSummary.tsx`
- Create: `src/components/dashboard/ProjectHealthRow.tsx`
- Create: `src/components/dashboard/ProjectDashboard.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/layout/Header.tsx`
- Modify: `src/components/home/Hero.tsx` only to remove unused homepage ownership if `ProjectDashboard` replaces it.
- Modify: `src/components/home/About.tsx` only if the dashboard keeps a compact skills band.
- Modify: `src/components/home/FeaturedProjects.tsx` only if it becomes unused and is removed from `page.tsx`.

**Interfaces:**
- Consumes:
  - `Project[]` from `src/data/projects.ts`
  - `GitHubStats` map from `src/lib/github-stats.ts`
  - `PublicMetricsModel` from `src/lib/metrics/reader.ts`
- Produces:
  - `ProjectDashboard({ personal, projects, statsBySlug, metrics })`
  - public homepage first viewport with workbench band, project table, VPS summary, and recent signals.

- [ ] **Step 1: Create reusable dashboard components**

Create `src/components/dashboard/StatusToken.tsx`:

```tsx
import type { CheckStatus, MetricsFreshness } from "@/lib/metrics/types";

const statusClasses: Record<CheckStatus | MetricsFreshness, string> = {
  up: "border-green-500/30 bg-green-500/10 text-green-300",
  down: "border-red-500/30 bg-red-500/10 text-red-300",
  unknown: "border-zinc-700 bg-zinc-900 text-zinc-400",
  fresh: "border-green-500/30 bg-green-500/10 text-green-300",
  stale: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  unavailable: "border-zinc-700 bg-zinc-900 text-zinc-400",
};

interface StatusTokenProps {
  value: CheckStatus | MetricsFreshness;
  label?: string;
}

export function StatusToken({ value, label = value }: StatusTokenProps) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-mono uppercase ${statusClasses[value]}`}>
      {label}
    </span>
  );
}
```

Create `src/components/dashboard/MetricsSparkline.tsx`:

```tsx
interface MetricsSparklineProps {
  values: number[];
  label: string;
}

export function MetricsSparkline({ values, label }: MetricsSparklineProps) {
  if (values.length < 2) {
    return (
      <div className="h-10 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-3 text-[11px] font-mono text-zinc-600">
        {label}: no history
      </div>
    );
  }

  const width = 120;
  const height = 32;
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <figure className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
      <figcaption className="mb-1 text-[11px] font-mono text-zinc-500">{label}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-8 w-full" role="img" aria-label={`${label} 24 hour sparkline`}>
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} className="text-cyan-300" />
      </svg>
    </figure>
  );
}
```

- [ ] **Step 2: Create dashboard composition components**

Create `src/components/dashboard/VpsStatusSummary.tsx`:

```tsx
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { StatusToken } from "./StatusToken";

export function VpsStatusSummary({ metrics }: { metrics: PublicMetricsModel }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-mono text-sm text-green-400">VPS</h2>
        <StatusToken value={metrics.freshness} />
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="font-mono text-xs text-zinc-600">state</dt>
          <dd className="text-zinc-200">{metrics.host.state}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">disk</dt>
          <dd className="text-zinc-200">{metrics.host.diskPressure}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">services</dt>
          <dd className="text-zinc-200">
            {metrics.host.serviceSummary.up}/{metrics.host.serviceSummary.total} up
          </dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-zinc-600">updated</dt>
          <dd className="text-zinc-200">{metrics.host.lastUpdatedLabel}</dd>
        </div>
      </dl>
    </section>
  );
}
```

Create `src/components/dashboard/ProjectHealthRow.tsx`:

```tsx
import Link from "next/link";
import type { Project } from "@/data/projects";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicServiceStatus } from "@/lib/metrics/reader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StatusToken } from "./StatusToken";

function repoSignal(stats: GitHubStats | null): string {
  if (!stats?.lastCommitDate) return "no repo signal";
  const days = Math.floor((Date.now() - new Date(stats.lastCommitDate).getTime()) / 86_400_000);
  if (days <= 0) return "updated today";
  if (days === 1) return "updated 1d ago";
  return `updated ${days}d ago`;
}

export function ProjectHealthRow({
  project,
  stats,
  health,
}: {
  project: Project;
  stats: GitHubStats | null;
  health?: PublicServiceStatus;
}) {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="grid gap-3 border-t border-zinc-800 px-1 py-4 transition-colors hover:bg-zinc-900/40 sm:grid-cols-[1.2fr_0.8fr_0.8fr_0.7fr]"
    >
      <div>
        <h3 className="font-mono text-sm text-zinc-100">{project.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{project.shortDescription}</p>
      </div>
      <div className="flex items-center">
        <StatusBadge status={project.status} />
      </div>
      <div className="flex items-center">
        {health ? <StatusToken value={health.status} /> : <span className="text-xs font-mono text-zinc-600">not probed</span>}
      </div>
      <div className="flex items-center text-xs font-mono text-zinc-600">{repoSignal(stats)}</div>
    </Link>
  );
}
```

Create `src/components/dashboard/ProjectDashboard.tsx`:

```tsx
import type { PersonalData } from "@/data/personal";
import type { Project } from "@/data/projects";
import type { GitHubStats } from "@/lib/github-stats";
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { ProjectHealthRow } from "./ProjectHealthRow";
import { StatusToken } from "./StatusToken";
import { VpsStatusSummary } from "./VpsStatusSummary";

export function ProjectDashboard({
  personal,
  projects,
  statsBySlug,
  metrics,
}: {
  personal: PersonalData;
  projects: Project[];
  statsBySlug: Record<string, GitHubStats>;
  metrics: PublicMetricsModel;
}) {
  const activeCount = projects.filter((project) => project.status === "active").length;
  const featured = projects.filter((project) => project.featured);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <section className="grid gap-6 border-b border-zinc-800 pb-10 lg:grid-cols-[1.35fr_0.65fr]">
        <div>
          <p className="mb-4 font-mono text-xs uppercase text-green-400">reidar.tech / project OS</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-zinc-100 sm:text-5xl">
            Live workbench for projects, infra, and trust signals.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-400">{personal.bio}</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">{projects.length}</div>
              <div className="font-mono text-xs text-zinc-600">projects</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">{activeCount}</div>
              <div className="font-mono text-xs text-zinc-600">active</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">{metrics.host.serviceSummary.up}</div>
              <div className="font-mono text-xs text-zinc-600">services up</div>
            </div>
            <div className="border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="font-mono text-xl text-zinc-100">{metrics.host.lastUpdatedLabel}</div>
              <div className="font-mono text-xs text-zinc-600">metrics</div>
            </div>
          </div>
        </div>
        <VpsStatusSummary metrics={metrics} />
      </section>

      <section className="grid gap-6 border-b border-zinc-800 py-10 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-mono text-sm text-green-400">Project Operations</h2>
            <a href="/projects" className="text-sm text-zinc-500 hover:text-zinc-300">View all</a>
          </div>
          <div className="border-b border-zinc-800">
            {featured.map((project) => (
              <ProjectHealthRow
                key={project.slug}
                project={project}
                stats={statsBySlug[project.slug] ?? null}
                health={metrics.projectHealthBySlug[project.slug]}
              />
            ))}
          </div>
        </div>
        <aside className="border border-zinc-800 bg-zinc-900/30 p-4">
          <h2 className="font-mono text-sm text-green-400">Recent Signals</h2>
          <div className="mt-4 space-y-3">
            {metrics.services.slice(0, 5).map((service) => (
              <div key={service.id} className="flex items-center justify-between gap-3 border-t border-zinc-800 pt-3">
                <div>
                  <div className="font-mono text-xs text-zinc-200">{service.label}</div>
                  <div className="mt-1 font-mono text-[11px] text-zinc-600">
                    {service.latencyMs === null ? "no latency" : `${service.latencyMs}ms`}
                  </div>
                </div>
                <StatusToken value={service.status} />
              </div>
            ))}
            {metrics.services.length === 0 ? (
              <p className="border-t border-zinc-800 pt-3 text-sm text-zinc-500">No public service checks are configured.</p>
            ) : null}
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-zinc-800 pt-4 text-sm">
            <div>
              <dt className="font-mono text-xs text-zinc-600">host</dt>
              <dd className="text-zinc-200">{metrics.host.state}</dd>
            </div>
            <div>
              <dt className="font-mono text-xs text-zinc-600">disk</dt>
              <dd className="text-zinc-200">{metrics.host.diskPressure}</dd>
            </div>
          </dl>
        </aside>
      </section>
    </div>
  );
}
```

- [ ] **Step 3: Modify homepage data flow**

Replace `src/app/page.tsx` with:

```tsx
import { ProjectDashboard } from "@/components/dashboard/ProjectDashboard";
import { getPersonal, getProjects } from "@/lib/data";
import {
  extractRepoPairs,
  fetchAllRepoStats,
  type GitHubStats,
} from "@/lib/github-stats";
import {
  derivePublicMetrics,
  getMetricsDir,
  readMetricsFromDir,
} from "@/lib/metrics/reader";

export const dynamic = "force-dynamic";

export default async function Home() {
  const personal = getPersonal();
  const projects = getProjects();
  const repoPairs = extractRepoPairs(projects);
  const statsMap = await fetchAllRepoStats(repoPairs);
  const statsBySlug: Record<string, GitHubStats> = {};

  for (const pair of repoPairs) {
    const stats = statsMap.get(`${pair.owner}/${pair.repo}`);
    if (stats) {
      statsBySlug[pair.slug] = stats;
    }
  }

  const metrics = derivePublicMetrics(readMetricsFromDir(getMetricsDir()));

  return (
    <ProjectDashboard
      personal={personal}
      projects={projects}
      statsBySlug={statsBySlug}
      metrics={metrics}
    />
  );
}
```

- [ ] **Step 4: Add Status link to header**

In `src/components/layout/Header.tsx`, add this public link after `Projects`:

```tsx
<Link
  href="/status"
  className="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
>
  Status
</Link>
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics
npm run lint
DATA_DIR="$(mktemp -d)" npm run build
git diff --check
```

Expected:

- Metrics tests: PASS.
- Lint: exit 0.
- Build: exit 0.
- Diff check: no output.

- [ ] **Step 6: Visual smoke**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run dev
```

Open `http://localhost:3000` in the browser and verify:

- First viewport shows `reidar.tech / project OS`.
- The VPS panel renders even when `METRICS_DIR` is unset, showing unknown/unavailable rather than crashing.
- Featured project rows show curated status and `not probed` when no public service exists.
- Text does not overlap at desktop width and mobile width.

Stop the dev server after verification.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard src/app/page.tsx src/components/layout/Header.tsx
git commit -m "feat: add project os homepage"
```

### Task 7: `/status` Page And Owner-Only Metrics Panel

**Files:**
- Create: `src/app/status/page.tsx`
- Create: `src/components/dashboard/OwnerMetricsPanel.tsx`
- Create: `src/components/dashboard/StatusInventory.tsx`
- Create: `src/lib/metrics/status-page.ts`
- Create: `src/lib/metrics/status-page.test.ts`

**Interfaces:**
- Consumes:
  - `auth()` from `src/auth.ts`
  - `isOwnerUser()` from `src/lib/authz.ts`
  - `readMetricsFromDir()`, `derivePublicMetrics()`, `deriveOwnerMetrics()`
- Produces:
  - `/status` public status page.
  - exact owner metrics only when `isOwnerUser(session?.user)` is true.
  - pure helper `createStatusPageModel({ readResult, isOwner, now })`.

- [ ] **Step 1: Write failing status-page model tests**

Create `src/lib/metrics/status-page.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createStatusPageModel } from "./status-page";
import type { MetricsReadResult } from "./reader";

const readResult: MetricsReadResult = {
  freshness: "fresh",
  diagnostics: [],
  latest: {
    schema_version: 1,
    collected_at: "2026-07-09T02:00:00Z",
    host: {
      cpu_percent: 11,
      ram_used_bytes: 20,
      ram_total_bytes: 100,
      disk_used_bytes: 70,
      disk_total_bytes: 100,
      load_1m: 0.1,
      load_5m: 0.2,
      load_15m: 0.3,
      uptime_seconds: 123,
    },
    services: [
      {
        id: "frontpage-public",
        label: "Frontpage",
        visibility: "public",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
        latency_ms: 20,
      },
      {
        id: "frontpage-internal",
        label: "Frontpage internal",
        visibility: "owner",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
        latency_ms: 5,
      },
    ],
    containers: [
      {
        id: "frontpage-container",
        label: "Frontpage container",
        status: "up",
        checked_at: "2026-07-09T02:00:00Z",
      },
    ],
  },
  history: [],
};

if (readResult.latest) {
  readResult.history = [readResult.latest];
}

describe("createStatusPageModel", () => {
  it("does not include exact owner metrics for public visitors", () => {
    const model = createStatusPageModel({
      readResult,
      isOwner: false,
      now: new Date("2026-07-09T02:00:30Z"),
    });

    expect(model.owner).toBeNull();
    expect(model.public.history[0]).toEqual({
      collectedAt: "2026-07-09T02:00:00Z",
      cpu: "low",
      ram: "low",
      disk: "ok",
    });
    expect(JSON.stringify(model.public)).not.toContain("load_1m");
    expect(JSON.stringify(model.public)).not.toContain("cpu_percent");
    expect(JSON.stringify(model.public)).not.toContain("cpuPercent");
    expect(JSON.stringify(model.public)).not.toContain("ramPercent");
    expect(JSON.stringify(model.public)).not.toContain("diskPercent");
    expect(JSON.stringify(model.public)).not.toContain("frontpage-internal");
  });

  it("includes exact owner metrics for owners", () => {
    const model = createStatusPageModel({
      readResult,
      isOwner: true,
      now: new Date("2026-07-09T02:00:30Z"),
    });

    expect(model.owner?.latest?.host.load_1m).toBe(0.1);
    expect(model.owner?.latest?.containers).toHaveLength(1);
    expect(model.owner?.latest?.services).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run focused test and confirm it fails**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/status-page.test.ts
```

Expected: FAIL with an import error for `./status-page`.

- [ ] **Step 3: Implement status-page model helper**

Create `src/lib/metrics/status-page.ts`:

```ts
import {
  deriveOwnerMetrics,
  derivePublicMetrics,
  type MetricsReadResult,
  type OwnerMetricsModel,
  type PublicMetricsModel,
} from "./reader";

export interface StatusPageModel {
  public: PublicMetricsModel;
  owner: OwnerMetricsModel | null;
}

export function createStatusPageModel({
  readResult,
  isOwner,
  now = new Date(),
}: {
  readResult: MetricsReadResult;
  isOwner: boolean;
  now?: Date;
}): StatusPageModel {
  return {
    public: derivePublicMetrics(readResult, now),
    owner: isOwner ? deriveOwnerMetrics(readResult) : null,
  };
}
```

- [ ] **Step 4: Create status inventory and owner panel**

Create `src/components/dashboard/StatusInventory.tsx`:

```tsx
import type { PublicMetricsModel } from "@/lib/metrics/reader";
import { StatusToken } from "./StatusToken";

export function StatusInventory({ metrics }: { metrics: PublicMetricsModel }) {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <h2 className="mb-4 font-mono text-sm text-green-400">Public Services</h2>
      <div className="divide-y divide-zinc-800">
        {metrics.services.length === 0 ? (
          <p className="py-4 text-sm text-zinc-500">No public service checks are available.</p>
        ) : (
          metrics.services.map((service) => (
            <div key={service.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="text-sm text-zinc-100">{service.label}</div>
                <div className="font-mono text-xs text-zinc-600">{service.checkedAt}</div>
              </div>
              <StatusToken value={service.status} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
```

Create `src/components/dashboard/OwnerMetricsPanel.tsx`:

```tsx
import type { OwnerMetricsModel } from "@/lib/metrics/reader";
import { MetricsSparkline } from "./MetricsSparkline";
import { StatusToken } from "./StatusToken";

function pct(used: number, total: number): string {
  return `${Math.round((used / total) * 1000) / 10}%`;
}

export function OwnerMetricsPanel({ metrics }: { metrics: OwnerMetricsModel | null }) {
  if (!metrics?.latest) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
        <h2 className="font-mono text-sm text-green-400">Owner Metrics</h2>
        <p className="mt-4 text-sm text-zinc-500">Exact metrics are unavailable.</p>
      </section>
    );
  }

  const latest = metrics.latest;
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-mono text-sm text-green-400">Owner Metrics</h2>
        <StatusToken value={metrics.freshness} />
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="font-mono text-xs text-zinc-600">CPU</dt><dd>{latest.host.cpu_percent}%</dd></div>
        <div><dt className="font-mono text-xs text-zinc-600">RAM</dt><dd>{pct(latest.host.ram_used_bytes, latest.host.ram_total_bytes)}</dd></div>
        <div><dt className="font-mono text-xs text-zinc-600">Disk</dt><dd>{pct(latest.host.disk_used_bytes, latest.host.disk_total_bytes)}</dd></div>
        <div><dt className="font-mono text-xs text-zinc-600">Load</dt><dd>{latest.host.load_1m} / {latest.host.load_5m} / {latest.host.load_15m}</dd></div>
      </dl>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <MetricsSparkline label="CPU exact" values={metrics.history.map((sample) => sample.host.cpu_percent)} />
        <MetricsSparkline label="RAM exact" values={metrics.history.map((sample) => (sample.host.ram_used_bytes / sample.host.ram_total_bytes) * 100)} />
        <MetricsSparkline label="Disk exact" values={metrics.history.map((sample) => (sample.host.disk_used_bytes / sample.host.disk_total_bytes) * 100)} />
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 font-mono text-xs text-zinc-500">Internal Services</h3>
          {latest.services.map((service) => (
            <div key={service.id} className="flex justify-between border-t border-zinc-800 py-2 text-sm">
              <span>{service.label}</span>
              <StatusToken value={service.status} />
            </div>
          ))}
        </div>
        <div>
          <h3 className="mb-2 font-mono text-xs text-zinc-500">Containers</h3>
          {latest.containers.map((container) => (
            <div key={container.id} className="flex justify-between border-t border-zinc-800 py-2 text-sm">
              <span>{container.label}</span>
              <StatusToken value={container.status} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create `/status` page**

Create `src/app/status/page.tsx`:

```tsx
import { auth } from "@/auth";
import { OwnerMetricsPanel } from "@/components/dashboard/OwnerMetricsPanel";
import { StatusInventory } from "@/components/dashboard/StatusInventory";
import { VpsStatusSummary } from "@/components/dashboard/VpsStatusSummary";
import { isOwnerUser } from "@/lib/authz";
import { getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { createStatusPageModel } from "@/lib/metrics/status-page";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Status — reidar.tech",
  description: "Public project and VPS status for reidar.tech.",
};

export default async function StatusPage() {
  const session = await auth();
  const readResult = readMetricsFromDir(getMetricsDir());
  const model = createStatusPageModel({
    readResult,
    isOwner: isOwnerUser(session?.user),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="mb-3 font-mono text-xs uppercase text-green-400">reidar.tech / status</p>
        <h1 className="text-3xl font-semibold tracking-normal text-zinc-100">Status</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
          Public-safe service and VPS status. Exact host metrics are only rendered server-side for the signed-in owner.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <VpsStatusSummary metrics={model.public} />
        <StatusInventory metrics={model.public} />
      </div>
      {model.owner && (
        <div className="mt-6">
          <OwnerMetricsPanel metrics={model.owner} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run focused and full checks**

Run:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm test -- src/lib/metrics/status-page.test.ts src/lib/metrics/reader.test.ts src/lib/authz.test.ts
npm run lint
DATA_DIR="$(mktemp -d)" npm run build
git diff --check
```

Expected:

- Focused tests: PASS.
- Lint: exit 0.
- Build: exit 0.
- Diff check: no output.

- [ ] **Step 7: Public leak check**

Run local server:

```bash
source ~/.nvm/nvm.sh && nvm use 22
npm run dev
```

In another terminal:

```bash
curl -s http://localhost:3000/status | grep -E "cpu_percent|cpuPercent|ram_used_bytes|ramPercent|disk_used_bytes|diskPercent|load_1m|frontpage-internal|frontpage-container" && exit 1 || exit 0
```

Expected: exit 0, meaning public HTML did not include exact owner-only strings.

Stop the dev server after verification.

- [ ] **Step 8: Commit**

```bash
git add src/app/status/page.tsx src/components/dashboard/OwnerMetricsPanel.tsx src/components/dashboard/StatusInventory.tsx src/lib/metrics/status-page.ts src/lib/metrics/status-page.test.ts
git commit -m "feat: add status page"
```

### Task 8: Final Verification, Visual QA, And Durable Logging

**Files:**
- Modify: `README.md`
- Modify: `DEPLOYMENT.md` if final verification discovers a runbook correction.
- Obsidian: append to `/Users/reidar/Obsidian/Hermes/Hermes/Daily/DD-MM-YYYY.md` and `/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Frontpage.md`.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: final verification evidence, docs/readme update, visual QA result, and Obsidian session summary.

- [ ] **Step 1: Update README with status dashboard summary**

Add this section to `README.md` after `Runtime data`:

```markdown
## VPS status dashboard

Frontpage includes a Project OS Dashboard surface:

- `/` shows the public workbench: curated project posture, public-safe service health, VPS freshness, and coarse disk/service state.
- `/status` shows public service status and, when signed in as the owner, exact VPS metrics.
- The Next.js app reads metrics from `METRICS_DIR`; it does not SSH to the host, shell out, or need privileged host access.
- The host collector writes `latest.json` and `history.json` under `/var/lib/frontpage-metrics` through a systemd timer.

Public views intentionally do not expose exact CPU, RAM, disk, load, uptime, container inventory, or internal-only service labels.
```

- [ ] **Step 2: Run complete local verification**

Run:

```bash
df -h /System/Volumes/Data
source ~/.nvm/nvm.sh && nvm use 22
npm test
npm run lint
DATA_DIR="$(mktemp -d)" npm run build
python3 -m unittest ops/tests/test_frontpage_metrics_collector.py
python3 -m py_compile ops/frontpage-metrics-collector.py
git diff --check
```

Expected:

- Disk free space is at least 50Gi before long checks.
- `npm test`: PASS.
- `npm run lint`: exit 0.
- clean `npm run build`: exit 0.
- Python tests and compile: PASS.
- Diff check: no output.

- [ ] **Step 3: Run local dashboard smoke with sample metrics**

Create a bounded temp metrics directory:

```bash
metrics_dir="$(mktemp -d)"
python3 ops/frontpage-metrics-collector.py --config ops/frontpage-metrics.config.json --metrics-dir "$metrics_dir"
METRICS_DIR="$metrics_dir" DATA_DIR="$(mktemp -d)" npm run dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/status`

Verify:

- Homepage first viewport reads as Project OS Dashboard.
- `/status` public view renders service inventory.
- Public dashboard renders recent service signals without CPU/RAM/disk sparklines.
- Owner-only sparklines render from the single sample as empty/no-history or one-point-tolerant state without layout breakage when an owner session is available.
- Public source does not contain `cpu_percent`, `cpuPercent`, `ram_used_bytes`, `ramPercent`, `disk_used_bytes`, `diskPercent`, `load_1m`, `frontpage-internal`, or `frontpage-container`.
- Mobile width does not overlap text.

Stop the dev server and remove the temp metrics directory:

```bash
rm -rf "$metrics_dir"
```

- [ ] **Step 4: Commit final docs**

```bash
git add README.md DEPLOYMENT.md
git commit -m "docs: document project os dashboard"
```

- [ ] **Step 5: Obsidian log**

Append an evidence-backed entry to today’s daily note under `## Log` and update `/Users/reidar/Obsidian/Hermes/Hermes/Personal/Projects/Frontpage.md` under the existing Project OS Dashboard section.

Use this content shape:

```markdown
- HH:MM  — [[Personal/Projects/Frontpage|Frontpage / reidar.tech]] Project OS Dashboard implementation completed locally on `<branch>` at `<commit>`. Scope: metrics schema/reader, Python collector, Ansible/systemd wiring, homepage dashboard, `/status`, owner-only exact metrics, and docs. Evidence: `<commands and pass/fail results>`. Non-claims: not pushed/not deployed/no live VPS proof unless those checks were actually run.
```

- [ ] **Step 6: Final git and large-temp check**

Run:

```bash
git status --short
du -sh /private/tmp/[Vv]ifty* 2>/dev/null || true
```

Expected:

- `git status --short` shows only intentional uncommitted changes, or no output if everything has been committed.
- Temp check has no relevant Frontpage leftovers. It may print nothing.

- [ ] **Step 7: Completion handoff**

Report:

- Final commit IDs.
- Verification commands and results.
- Whether public leak check passed.
- Whether browser visual QA passed.
- Obsidian note paths and sections updated.
- Explicit non-claims for push, CI, deploy, and live status if not performed.

## Self-Review Checklist

- Spec coverage: Tasks 1-3 cover server-side auth, schema validation, staleness, public/owner derivation, exact metric non-leakage, and history behavior. Task 4 covers static config, collector cadence output, HTTP checks, container allowlist, atomic writes, and bounds. Task 5 covers systemd, metrics directory, read-only mount, `METRICS_DIR`, and deploy runbook. Tasks 6-7 cover homepage and `/status` surfaces. Task 8 covers verification, visual QA, docs, and Obsidian logging.
- Red-flag scan: no incomplete markers, no deferred implementation instructions, no cross-task shorthand, and no unspecified edge handling.
- Type consistency: `MetricsSnapshot`, `MetricsHistory`, `PublicMetricsModel`, `OwnerMetricsModel`, `PublicServiceStatus`, `readMetricsFromDir`, `derivePublicMetrics`, `deriveOwnerMetrics`, `createStatusPageModel`, and `isOwnerUser` names are consistent across tasks.
- Scope check: one implementation plan is acceptable because every task contributes to one testable dashboard feature; the collector/deploy/UI pieces are connected by the committed JSON schema boundary.
