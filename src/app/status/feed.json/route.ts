import { getCanonicalMaintenance } from "@/lib/content";
import { createPublicStatusV2 } from "@/lib/metrics/v2/public-status";
import { createPublicStatusFeed } from "@/lib/metrics/v2/status-feed";
import {
  getPublicMetricsRootV2,
  readPublicIncidentsV2,
  readPublicLatestV2,
} from "@/lib/metrics/v2/reader";

export const dynamic = "force-dynamic";

function feedResponse(feed: ReturnType<typeof createPublicStatusFeed>, status: number): Response {
  const serialized = JSON.stringify(feed).replace(/[<>&\u2028\u2029]/g, (character) => {
    if (character === "<") return "\\u003c";
    if (character === ">") return "\\u003e";
    if (character === "&") return "\\u0026";
    return character === "\u2028" ? "\\u2028" : "\\u2029";
  });
  return new Response(serialized, {
    status,
    headers: {
      "Cache-Control": status === 200 ? "public, max-age=0, s-maxage=60" : "no-store",
      "Content-Type": "application/feed+json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(): Promise<Response> {
  const now = new Date();
  const checkedAt = now.toISOString();
  try {
    const root = getPublicMetricsRootV2();
    const latest = readPublicLatestV2(root, now);
    const incidents = readPublicIncidentsV2(root, now);
    if (
      latest.availability !== "available" ||
      incidents.availability !== "available" ||
      !latest.data ||
      !incidents.data
    ) {
      return feedResponse(
        createPublicStatusFeed(null, {
          availability: "unavailable",
          checkedAt,
        }),
        503,
      );
    }
    const model = createPublicStatusV2({
      latest: latest.data,
      incidents: incidents.data,
      maintenance: getCanonicalMaintenance(),
      now,
    });
    return feedResponse(
      createPublicStatusFeed(model, {
        checkedAt,
        incidentGeneratedAt: incidents.data.generated_at,
      }),
      200,
    );
  } catch {
    return feedResponse(
      createPublicStatusFeed(null, {
        availability: "unavailable",
        checkedAt,
      }),
      503,
    );
  }
}
