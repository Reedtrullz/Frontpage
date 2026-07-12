import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { derivePublicMetrics, getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { deriveOverallPublicStatus } from "@/lib/metrics/status-page";
import { getCanonicalMaintenance } from "@/lib/content";
import {
  getPublicMetricsRootV2,
  readPublicIncidentsV2,
  readPublicLatestV2,
} from "@/lib/metrics/v2/reader";
import { createPublicStatusV2 } from "@/lib/metrics/v2/public-status";
import { HeaderClient } from "./HeaderClient";

export async function Header() {
  const session = await auth();
  const fallbackStatusKind = deriveOverallPublicStatus(
    derivePublicMetrics(readMetricsFromDir(getMetricsDir())),
  ).kind;
  const publicRoot = getPublicMetricsRootV2();
  const latestV2 = readPublicLatestV2(publicRoot);
  const incidentsV2 = readPublicIncidentsV2(publicRoot);
  const statusV2 = latestV2.data && incidentsV2.data
    ? createPublicStatusV2({
        latest: latestV2.data,
        incidents: incidentsV2.data,
        maintenance: getCanonicalMaintenance(),
      })
    : null;
  const statusKind = statusV2
    ? statusV2.label === "Status delayed"
      ? "delayed"
      : statusV2.overallState === "unknown"
        ? "unavailable"
        : statusV2.overallState === "maintenance"
          ? "degraded"
          : statusV2.overallState
    : fallbackStatusKind;
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[color:var(--surface)/0.94] backdrop-blur-md">
      <HeaderClient
        isOwner={isOwnerUser(session?.user)}
        statusKind={statusKind}
      />
    </header>
  );
}
