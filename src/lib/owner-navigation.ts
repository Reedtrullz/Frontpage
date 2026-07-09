const DEFAULT_OWNER_PATH = "/admin";
const SITE_ORIGIN = "https://reidar.tech";

export function ownerCallbackPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return DEFAULT_OWNER_PATH;
  }

  try {
    const parsed = new URL(value, SITE_ORIGIN);
    if (parsed.origin !== SITE_ORIGIN) return DEFAULT_OWNER_PATH;
    if (parsed.pathname === "/ansible") return parsed.pathname;
    if (
      parsed.pathname === "/admin" ||
      parsed.pathname.startsWith("/admin/")
    ) {
      return parsed.pathname;
    }
  } catch {
    return DEFAULT_OWNER_PATH;
  }

  return DEFAULT_OWNER_PATH;
}
