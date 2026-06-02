type SessionLike = {
  user?: {
    name?: string | null;
    githubLogin?: string | null;
    githubId?: string | null;
    email?: string | null;
  } | null;
} | null | undefined;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isOwnerSession(session: SessionLike): boolean {
  if (!session?.user) return false;

  const allowedLogin = normalize(process.env.ADMIN_GITHUB_LOGIN);
  const allowedId = normalize(process.env.ADMIN_GITHUB_ID);
  const allowedEmail = normalize(process.env.ADMIN_GITHUB_EMAIL);
  const userLogin = normalize(session.user.githubLogin);
  const userId = normalize(session.user.githubId);
  const userEmail = normalize(session.user.email);

  if (allowedId && userId === allowedId) return true;
  if (allowedLogin && userLogin === allowedLogin) return true;
  if (allowedEmail && userEmail === allowedEmail) return true;
  return false;
}

export function requireOwnerSession(session: SessionLike): void {
  if (!isOwnerSession(session)) {
    throw new Error("Forbidden");
  }
}
