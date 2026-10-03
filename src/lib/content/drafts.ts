import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { productionVersionMatches } from './identity';
import {
  parsePersonal,
  parseProjects,
  personalSchema,
  projectsSchema,
  type PersonalContent,
  type ProjectContent,
} from "./schema";

const DEFAULT_DATA_DIR = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
);

const versionSchema = z.string().trim().min(1).max(160);
const timestampSchema = z.string().datetime({ offset: true });

function draftEnvelopeSchema<T extends z.ZodType>(content: T) {
  return z
    .object({
      schemaVersion: z.literal(1),
      baseVersion: versionSchema,
      savedAt: timestampSchema,
      content,
    })
    .strict();
}

const personalDraftSchema = draftEnvelopeSchema(personalSchema);
const projectsDraftSchema = draftEnvelopeSchema(projectsSchema);

const publishedReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("published"),
    recordedAt: timestampSchema,
    baseVersion: versionSchema,
    commitSha: z.string().regex(/^[a-f0-9]{7,40}$/),
    commitUrl: z.string().url(),
  })
  .strict();

const conflictReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("conflict"),
    recordedAt: timestampSchema,
    baseVersion: versionSchema,
    message: z.string().trim().min(1).max(240),
  })
  .strict();

const failedReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("failed"),
    recordedAt: timestampSchema,
    baseVersion: versionSchema,
    message: z.string().trim().min(1).max(240),
  })
  .strict();

const publishReceiptSchema = z.discriminatedUnion("kind", [
  publishedReceiptSchema,
  conflictReceiptSchema,
  failedReceiptSchema,
]);

export interface DraftEnvelope<T> {
  schemaVersion: 1;
  baseVersion: string;
  savedAt: string;
  content: T;
}

export type PublishReceipt = z.infer<typeof publishReceiptSchema>;

export interface DraftBundle {
  personal: DraftEnvelope<PersonalContent> | null;
  projects: DraftEnvelope<ProjectContent[]> | null;
  receipt: PublishReceipt | null;
}

export type ContentPublicationState =
  | { kind: "clean"; label: "Clean" }
  | { kind: "draft-saved"; label: "Draft saved" }
  | { kind: "awaiting-deploy"; label: "Awaiting deploy"; commitSha: string }
  | { kind: "deployed"; label: "Deployed"; commitSha: string }
  | { kind: "conflict"; label: "Conflict"; message: string }
  | { kind: "publish-failed"; label: "Publish failed"; message: string };

interface DraftWriteOptions {
  dataDir?: string;
  baseVersion: string;
  now?: () => Date;
}

export function getRuntimeDataDir(): string {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function resolveDataDir(dataDir?: string): string {
  return dataDir || getRuntimeDataDir();
}

type SqlStore = {
  exec(query: string, ...bindings: string[]): { toArray(): Record<string, unknown>[] };
};

function cloudflareSql(dataDir?: string): SqlStore | null {
  if (dataDir || process.env.FRONTPAGE_CLOUDFLARE !== "1") return null;
  const sql = (getCloudflareContext().env as { FRONTPAGE_SQL?: SqlStore }).FRONTPAGE_SQL;
  if (!sql) throw new Error("Frontpage Durable Object storage is unavailable.");
  sql.exec("CREATE TABLE IF NOT EXISTS owner_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  return sql;
}

function atomicWriteJson(filePath: string, value: unknown, dataDir?: string): void {
  const sql = cloudflareSql(dataDir);
  if (sql) {
    sql.exec(
      "INSERT INTO owner_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      path.relative(getRuntimeDataDir(), filePath),
      JSON.stringify(value),
    );
    return;
  }
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function readJson<T>(
  filePath: string,
  schema: z.ZodType<T>,
  dataDir?: string,
): T | null {
  const sql = cloudflareSql(dataDir);
  if (sql) {
    const row = sql.exec(
      "SELECT value FROM owner_state WHERE key = ?",
      path.relative(getRuntimeDataDir(), filePath),
    ).toArray()[0];
    return row ? schema.parse(JSON.parse(String(row.value))) : null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

function removeJson(filePath: string, dataDir?: string): void {
  const sql = cloudflareSql(dataDir);
  if (sql) {
    sql.exec("DELETE FROM owner_state WHERE key = ?", path.relative(getRuntimeDataDir(), filePath));
  } else {
    fs.rmSync(filePath, { force: true });
  }
}

function makeEnvelope<T>(
  content: T,
  options: DraftWriteOptions,
): DraftEnvelope<T> {
  return {
    schemaVersion: 1,
    baseVersion: versionSchema.parse(options.baseVersion),
    savedAt: (options.now?.() ?? new Date()).toISOString(),
    content,
  };
}

export function savePersonalDraft(
  input: unknown,
  options: DraftWriteOptions,
): DraftEnvelope<PersonalContent> {
  const envelope = makeEnvelope(parsePersonal(input), options);
  const filePath = path.join(resolveDataDir(options.dataDir), "drafts", "personal.json");
  atomicWriteJson(filePath, personalDraftSchema.parse(envelope), options.dataDir);
  return envelope;
}

export function saveProjectsDraft(
  input: unknown,
  options: DraftWriteOptions,
): DraftEnvelope<ProjectContent[]> {
  const envelope = makeEnvelope(parseProjects(input), options);
  const filePath = path.join(resolveDataDir(options.dataDir), "drafts", "projects.json");
  atomicWriteJson(filePath, projectsDraftSchema.parse(envelope), options.dataDir);
  return envelope;
}

export function readDraftBundle(dataDir?: string): DraftBundle {
  const root = resolveDataDir(dataDir);
  return {
    personal: readJson(
      path.join(root, "drafts", "personal.json"),
      personalDraftSchema,
      dataDir,
    ),
    projects: readJson(
      path.join(root, "drafts", "projects.json"),
      projectsDraftSchema,
      dataDir,
    ),
    receipt: readJson(
      path.join(root, "receipts", "publication.json"),
      publishReceiptSchema,
      dataDir,
    ),
  };
}

export function savePublishReceipt(
  receipt: PublishReceipt,
  dataDir?: string,
): PublishReceipt {
  const parsed = publishReceiptSchema.parse(receipt);
  atomicWriteJson(
    path.join(resolveDataDir(dataDir), "receipts", "publication.json"),
    parsed,
    dataDir,
  );
  return parsed;
}

export function clearDrafts(dataDir?: string): void {
  const directory = path.join(resolveDataDir(dataDir), "drafts");
  removeJson(path.join(directory, "personal.json"), dataDir);
  removeJson(path.join(directory, "projects.json"), dataDir);
}

export function discardPersonalDraft(dataDir?: string): void {
  removeJson(path.join(resolveDataDir(dataDir), "drafts", "personal.json"), dataDir);
}

export function discardProjectsDraft(dataDir?: string): void {
  removeJson(path.join(resolveDataDir(dataDir), "drafts", "projects.json"), dataDir);
}

export function versionsMatch(left: string, right: string): boolean {
  return productionVersionMatches(left, right);
}

export function derivePublicationState(input: {
  draftChanged: boolean;
  draftSavedAt?: string | null;
  receipt: PublishReceipt | null;
  deployedVersion: string;
}): ContentPublicationState {
  const receiptPredatesDraft = Boolean(
    input.receipt &&
      input.draftSavedAt &&
      Date.parse(input.receipt.recordedAt) < Date.parse(input.draftSavedAt),
  );
  if (
    input.draftChanged &&
    !receiptPredatesDraft &&
    input.receipt?.kind === "conflict"
  ) {
    return {
      kind: "conflict",
      label: "Conflict",
      message: input.receipt.message,
    };
  }
  if (
    input.draftChanged &&
    !receiptPredatesDraft &&
    input.receipt?.kind === "failed"
  ) {
    return {
      kind: "publish-failed",
      label: "Publish failed",
      message: input.receipt.message,
    };
  }
  if (input.draftChanged) {
    return { kind: "draft-saved", label: "Draft saved" };
  }
  if (input.receipt?.kind === "published") {
    if (versionsMatch(input.receipt.commitSha, input.deployedVersion)) {
      return {
        kind: "deployed",
        label: "Deployed",
        commitSha: input.receipt.commitSha,
      };
    }
    return {
      kind: "awaiting-deploy",
      label: "Awaiting deploy",
      commitSha: input.receipt.commitSha,
    };
  }
  return { kind: "clean", label: "Clean" };
}
