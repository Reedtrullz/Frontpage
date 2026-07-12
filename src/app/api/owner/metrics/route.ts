import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import {
  getOwnerMetricsRootV2,
  readSeriesV2,
} from "@/lib/metrics/v2/reader";
import {
  OwnerMetricsQueryError,
  parseOwnerMetricsQuery,
} from "@/lib/metrics/v2/queries";
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

  let query;
  try {
    query = parseOwnerMetricsQuery(new URL(request.url));
  } catch (error) {
    if (error instanceof OwnerMetricsQueryError) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: PRIVATE_HEADERS,
      });
    }
    throw error;
  }

  try {
    return privateJson(readSeriesV2(getOwnerMetricsRootV2(), query), request);
  } catch (error) {
    return projectionErrorResponse(error);
  }
}
