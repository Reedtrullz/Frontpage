import { auth } from "@/auth";
import { OwnerMetricsPanel } from "@/components/dashboard/OwnerMetricsPanel";
import { StatusInventory } from "@/components/dashboard/StatusInventory";
import { VpsStatusSummary } from "@/components/dashboard/VpsStatusSummary";
import { isOwnerUser } from "@/lib/authz";
import { getMetricsDir, readMetricsFromDir } from "@/lib/metrics/reader";
import { createStatusPageModel } from "@/lib/metrics/status-page";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Status — reidar.tech",
  description: "Public project and VPS status for reidar.tech.",
};

export default async function StatusPage() {
  const session = await auth();
  const readResult = readMetricsFromDir(getMetricsDir());
  const model = createStatusPageModel({
    readResult,
    isOwner: isOwnerUser(session?.user),
  });

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8">
        <p className="mb-3 font-mono text-xs uppercase text-green-400">
          reidar.tech / status
        </p>
        <h1 className="text-3xl font-semibold tracking-normal text-zinc-100">
          Status
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
          Public-safe service and VPS status. Exact host metrics are only
          rendered server-side for the signed-in owner.
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <VpsStatusSummary metrics={model.public} />
        <StatusInventory metrics={model.public} />
      </div>
      {model.owner ? (
        <div className="mt-6">
          <OwnerMetricsPanel metrics={model.owner} />
        </div>
      ) : null}
    </div>
  );
}
