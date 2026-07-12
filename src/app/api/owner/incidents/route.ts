import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import {
  getOwnerMetricsRootV2,
  readOwnerIncidentsV2,
} from "@/lib/metrics/v2/reader";
import {
  PRIVATE_HEADERS,
  privateJson,
  projectionErrorResponse,
} from "../observability-response";

export async function GET(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: PRIVATE_HEADERS,
    });
  }
  if (!isOwnerUser(session.user)) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: PRIVATE_HEADERS,
    });
  }

  try {
    const result = readOwnerIncidentsV2(getOwnerMetricsRootV2());
    if (!result.data) return projectionErrorResponse(new Error("Unavailable"));
    return privateJson(result.data, request);
  } catch (error) {
    return projectionErrorResponse(error);
  }
}
