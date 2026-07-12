import { createHash } from "node:crypto";
import { ProjectionReadError } from "@/lib/metrics/v2/reader";

export const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
} as const;

export function privateJson(payload: unknown, request: Request): Response {
  const body = JSON.stringify(payload);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = { ...PRIVATE_HEADERS, ETag: etag };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

export function projectionErrorResponse(error: unknown): Response {
  const status =
    error instanceof ProjectionReadError && error.code === "too_large" ? 413 : 503;
  return new Response(
    JSON.stringify({
      error: status === 413 ? "Projection exceeds its response cap." : "Observability data is unavailable.",
    }),
    { status, headers: PRIVATE_HEADERS },
  );
}
