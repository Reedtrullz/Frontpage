import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
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

function atomicWriteJson(filePath: string, value: unknown): void {
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
): T | null {
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
  atomicWriteJson(filePath, personalDraftSchema.parse(envelope));
  return envelope;
}

export function saveProjectsDraft(
  input: unknown,
  options: DraftWriteOptions,
): DraftEnvelope<ProjectContent[]> {
  const envelope = makeEnvelope(parseProjects(input), options);
  const filePath = path.join(resolveDataDir(options.dataDir), "drafts", "projects.json");
  atomicWriteJson(filePath, projectsDraftSchema.parse(envelope));
  return envelope;
}

export function readDraftBundle(dataDir?: string): DraftBundle {
  const root = resolveDataDir(dataDir);
  return {
    personal: readJson(
      path.join(root, "drafts", "personal.json"),
      personalDraftSchema,
    ),
    projects: readJson(
      path.join(root, "drafts", "projects.json"),
      projectsDraftSchema,
    ),
    receipt: readJson(
      path.join(root, "receipts", "publication.json"),
      publishReceiptSchema,
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
  );
  return parsed;
}

export function clearDrafts(dataDir?: string): void {
  const directory = path.join(resolveDataDir(dataDir), "drafts");
  fs.rmSync(path.join(directory, "personal.json"), { force: true });
  fs.rmSync(path.join(directory, "projects.json"), { force: true });
}

export function discardPersonalDraft(dataDir?: string): void {
  fs.rmSync(
    path.join(resolveDataDir(dataDir), "drafts", "personal.json"),
    { force: true },
  );
}

export function discardProjectsDraft(dataDir?: string): void {
  fs.rmSync(
    path.join(resolveDataDir(dataDir), "drafts", "projects.json"),
    { force: true },
  );
}

function commitToken(value: string): string | null {
  return value.toLowerCase().match(/[a-f0-9]{7,40}/)?.[0] ?? null;
}

export function versionsMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const leftToken = commitToken(left);
  const rightToken = commitToken(right);
  if (!leftToken || !rightToken) return false;
  return leftToken.startsWith(rightToken) || rightToken.startsWith(leftToken);
}

export function derivePublicationState(input: {
  draftChanged: boolean;
  receipt: PublishReceipt | null;
  deployedVersion: string;
}): ContentPublicationState {
  if (input.draftChanged && input.receipt?.kind === "conflict") {
    return {
      kind: "conflict",
      label: "Conflict",
      message: input.receipt.message,
    };
  }
  if (input.draftChanged && input.receipt?.kind === "failed") {
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
