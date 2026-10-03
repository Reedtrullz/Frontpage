import { createHash } from "node:crypto";
import {createPublicationIntent,findPublicationIntent,updatePublicationIntent,type PublicationIntent} from "./publication-intents";
import {
  clearDrafts,
  readDraftBundle,
  type ReviewedRevisions,
  savePublishReceipt,
} from "./drafts";
import { parseDeploymentVersion, parseFullCommitSha } from './identity';
import {
  parsePersonal,
  parseProjects,
  type PersonalContent,
  type ProjectContent,
} from "./schema";

export interface GitPublicationClient {
  getHead(): Promise<{ commitSha: string; treeSha: string }>;
  createBlob(content: string): Promise<string>;
  createTree(
    baseTreeSha: string,
    files: Array<{ path: string; blobSha: string }>,
  ): Promise<string>;
  createCommit(input: {
    message: string;
    treeSha: string;
    parentSha: string;
  }): Promise<string>;
  updateHead(commitSha: string): Promise<void>;
  getCommitUrl(commitSha: string): string;
  getCommitIdentity(commitSha: string): Promise<{treeSha: string; parentSha: string}>;
  isAncestor(commitSha: string, headSha: string): Promise<boolean>;
}

export interface PublishCanonicalContentInput {
  personal: PersonalContent;
  projects: ProjectContent[];
  baseVersion: string;
  reviewedRevisions?: ReviewedRevisions;
  dataDir?: string;
  now?: () => Date;
}

export type PublishCanonicalContentResult =
  | { kind: "published"; commitSha: string; commitUrl: string }
  | { kind: "published-recovery-pending"; commitSha: string; commitUrl: string; message: string }
  | { kind: "outcome-unknown"; message: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

const CONFLICT_MESSAGE =
  "Published content changed after this draft was created. Refresh before publishing.";
const FAILURE_MESSAGE = "Publication failed. The draft was preserved.";

function safeProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

export function summarizePublicationError(error: unknown): string {
  const rawName = safeProperty(error, "name");
  const name =
    typeof rawName === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(rawName)
      ? rawName
      : "Error";
  const status = safeProperty(error, "status");
  if (typeof status === "number" && Number.isInteger(status)) {
    return `${name} (HTTP ${status})`;
  }
  const rawCode = safeProperty(error, "code");
  if (
    typeof rawCode === "string" &&
    /^[A-Za-z0-9_.-]{1,64}$/.test(rawCode)
  ) {
    return `${name} (${rawCode})`;
  }
  return name;
}

function isRefConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return false;
  }
  return error.status === 409 || error.status === 422;
}

function recordedAt(input: PublishCanonicalContentInput): string {
  return (input.now?.() ?? new Date()).toISOString();
}

function saveConflict(input: PublishCanonicalContentInput): void {
  savePublishReceipt(
    {
      schemaVersion: 1,
      kind: "conflict",
      recordedAt: recordedAt(input),
      baseVersion: input.baseVersion,
      message: CONFLICT_MESSAGE,
    },
    input.dataDir,
  );
}

async function finishCommitted(intent: PublicationIntent, input: PublishCanonicalContentInput, client: GitPublicationClient): Promise<PublishCanonicalContentResult> {
  const commitSha = intent.commitSha!;
  const commitUrl = client.getCommitUrl(commitSha);
  try {
    const committed = updatePublicationIntent(intent, {phase: 'committed'}, input.dataDir);
    const previousReceipt=readDraftBundle(input.dataDir).receipt;
    const newerReceipt=previousReceipt?.kind==='published' && previousReceipt.commitSha!==commitSha && await client.isAncestor(commitSha,previousReceipt.commitSha);
    if(!newerReceipt)savePublishReceipt({schemaVersion: 1, kind: 'published', recordedAt: recordedAt(input), baseVersion: intent.baseSha, commitSha, commitUrl}, input.dataDir,previousReceipt);
    clearDrafts(input.dataDir, intent.reviewedRevisions);
    updatePublicationIntent(committed, {phase: 'complete'}, input.dataDir);
    return {kind: 'published', commitSha, commitUrl};
  } catch {
    return {kind: 'published-recovery-pending', commitSha, commitUrl, message: 'Published to GitHub. Local recovery is pending; newer drafts are preserved.'};
  }
}
async function reconcileIntent(intent: PublicationIntent, input: PublishCanonicalContentInput, client: GitPublicationClient): Promise<PublishCanonicalContentResult> {
  if (!intent.commitSha || !intent.treeSha) return {kind: 'outcome-unknown', message: 'Publication preparation is pending. Retry recovery before starting another publication.'};
  try {
    const identity = await client.getCommitIdentity(intent.commitSha);
    if (identity.treeSha !== intent.treeSha || identity.parentSha !== intent.baseSha) return {kind: 'conflict', message: 'The saved publication identity could not be verified.'};
    const head = await client.getHead();
    if (head.commitSha === intent.commitSha || await client.isAncestor(intent.commitSha, head.commitSha)) {
      if(intent.phase==='complete')return {kind:'published',commitSha:intent.commitSha,commitUrl:client.getCommitUrl(intent.commitSha)};
      return finishCommitted(intent, input, client);
    }
    if (head.commitSha !== intent.baseSha) return {kind: 'conflict', message: CONFLICT_MESSAGE};
    // Retry the SAME durable commit; never create a second content commit.
    await client.updateHead(intent.commitSha);
    return finishCommitted(intent, input, client);
  } catch {
    return {kind: 'outcome-unknown', message: 'The remote publication outcome is unknown. Retry to reconcile the original commit.'};
  }
}
export async function publishCanonicalContent(input: PublishCanonicalContentInput, client: GitPublicationClient): Promise<PublishCanonicalContentResult> {
  const personal = parsePersonal(input.personal);
  const projects = parseProjects(input.projects);
  const bundle = readDraftBundle(input.dataDir);
  const reviewed = input.reviewedRevisions ?? {personal: bundle.personal?.revision ?? null, projects: bundle.projects?.revision ?? null};
  const prior = findPublicationIntent(reviewed, input.dataDir);
  if (prior && prior.phase !== 'failed') {
    if(prior.phase==='prepared' && Date.parse(prior.createdAt)<Date.now()-5*60*1000)updatePublicationIntent(prior,{phase:'failed'},input.dataDir);
    else return reconcileIntent(prior, input, client);
  }
  if (reviewed.personal !== (bundle.personal?.revision ?? null) || reviewed.projects !== (bundle.projects?.revision ?? null)) return {kind: 'conflict', message: 'The draft changed. Refresh and review before publishing.'};
  let intent: PublicationIntent | undefined;
  let attemptedRef = false;
  try {
    const head = await client.getHead();
    const deployedBase=parseDeploymentVersion(input.baseVersion);
    if (deployedBase?.scope !== 'main' || deployedBase.sha !== parseFullCommitSha(head.commitSha)) {
      saveConflict(input); return {kind: 'conflict', message: CONFLICT_MESSAGE};
    }
    const key = createHash('sha256').update(JSON.stringify({personal, projects, reviewed, base: head.commitSha})).digest('hex');
    const started = createPublicationIntent(key, head.commitSha, reviewed, input.dataDir);
    intent = started.intent;
    if (!started.created) return reconcileIntent(intent, input, client);
    const [personalBlob, projectsBlob] = await Promise.all([client.createBlob(`${JSON.stringify(personal, null, 2)}\n`), client.createBlob(`${JSON.stringify(projects, null, 2)}\n`)]);
    const treeSha = await client.createTree(head.treeSha, [{path: 'content/personal.json', blobSha: personalBlob}, {path: 'content/projects.json', blobSha: projectsBlob}]);
    const commitSha = await client.createCommit({message: 'content: publish Frontpage updates', treeSha, parentSha: head.commitSha});
    if (!parseFullCommitSha(commitSha)) throw new Error('Invalid commit identity.');
    intent = updatePublicationIntent(intent, {phase: 'ref-pending', commitSha, treeSha}, input.dataDir);
    attemptedRef = true;
    await client.updateHead(commitSha);
    return finishCommitted(intent, input, client);
  } catch (error) {
    if (attemptedRef && intent) return reconcileIntent(intent, input, client);
    if (intent) {try {updatePublicationIntent(intent, {phase: 'failed'}, input.dataDir);} catch { /* Original durable intent remains available to the operator. */ }}
    if (isRefConflict(error)) {try {saveConflict(input);} catch {} return {kind: 'conflict', message: CONFLICT_MESSAGE};}
    console.error('Canonical content publication failed', summarizePublicationError(error));
    try {savePublishReceipt({schemaVersion: 1, kind: 'failed', recordedAt: recordedAt(input), baseVersion: input.baseVersion, message: FAILURE_MESSAGE}, input.dataDir);} catch {}
    return {kind: 'failed', message: FAILURE_MESSAGE};
  }
}
