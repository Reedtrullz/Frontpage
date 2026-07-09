export interface AuthzUser {
  id?: string | number | null;
  email?: string | null;
}

export type AuthzEnv =
  | NodeJS.ProcessEnv
  | Partial<Record<"OWNER_GITHUB_ID" | "OWNER_EMAIL", string | undefined>>;

export class ForbiddenError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "ForbiddenError";
  }
}

export function isOwnerUser(
  user: AuthzUser | null | undefined,
  env: AuthzEnv = process.env,
): boolean {
  if (!user) {
    return false;
  }

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
  env: AuthzEnv = process.env,
): void {
  if (!isOwnerUser(user, env)) {
    throw new ForbiddenError();
  }
}
