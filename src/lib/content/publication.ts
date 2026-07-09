import {
  clearDrafts,
  savePublishReceipt,
  versionsMatch,
  type PublishReceipt,
} from "./drafts";
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
}

export interface PublishCanonicalContentInput {
  personal: PersonalContent;
  projects: ProjectContent[];
  baseVersion: string;
  dataDir?: string;
  now?: () => Date;
}

export type PublishCanonicalContentResult =
  | { kind: "published"; commitSha: string; commitUrl: string }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

const CONFLICT_MESSAGE =
  "Published content changed after this draft was created. Refresh before publishing.";
const FAILURE_MESSAGE = "Publication failed. The draft was preserved.";

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

export async function publishCanonicalContent(
  input: PublishCanonicalContentInput,
  client: GitPublicationClient,
): Promise<PublishCanonicalContentResult> {
  const personal = parsePersonal(input.personal);
  const projects = parseProjects(input.projects);

  try {
    const head = await client.getHead();
    if (!versionsMatch(input.baseVersion, head.commitSha)) {
      saveConflict(input);
      return { kind: "conflict", message: CONFLICT_MESSAGE };
    }

    const [personalBlob, projectsBlob] = await Promise.all([
      client.createBlob(`${JSON.stringify(personal, null, 2)}\n`),
      client.createBlob(`${JSON.stringify(projects, null, 2)}\n`),
    ]);
    const treeSha = await client.createTree(head.treeSha, [
      { path: "content/personal.json", blobSha: personalBlob },
      { path: "content/projects.json", blobSha: projectsBlob },
    ]);
    const commitSha = await client.createCommit({
      message: "content: publish Frontpage updates",
      treeSha,
      parentSha: head.commitSha,
    });
    await client.updateHead(commitSha);
    const commitUrl = client.getCommitUrl(commitSha);
    const receipt: PublishReceipt = {
      schemaVersion: 1,
      kind: "published",
      recordedAt: recordedAt(input),
      baseVersion: input.baseVersion,
      commitSha,
      commitUrl,
    };
    savePublishReceipt(receipt, input.dataDir);
    clearDrafts(input.dataDir);
    return { kind: "published", commitSha, commitUrl };
  } catch (error) {
    if (isRefConflict(error)) {
      saveConflict(input);
      return { kind: "conflict", message: CONFLICT_MESSAGE };
    }

    console.error("Canonical content publication failed", error);
    savePublishReceipt(
      {
        schemaVersion: 1,
        kind: "failed",
        recordedAt: recordedAt(input),
        baseVersion: input.baseVersion,
        message: FAILURE_MESSAGE,
      },
      input.dataDir,
    );
    return { kind: "failed", message: FAILURE_MESSAGE };
  }
}
