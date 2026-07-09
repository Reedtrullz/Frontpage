import {
  deriveOwnerMetrics,
  derivePublicMetrics,
  type MetricsReadResult,
  type OwnerMetricsModel,
  type PublicMetricsModel,
} from "./reader";

export interface StatusPageModel {
  public: PublicMetricsModel;
  owner: OwnerMetricsModel | null;
}

export function createStatusPageModel({
  readResult,
  isOwner,
  now = new Date(),
}: {
  readResult: MetricsReadResult;
  isOwner: boolean;
  now?: Date;
}): StatusPageModel {
  return {
    public: derivePublicMetrics(readResult, now),
    owner: isOwner ? deriveOwnerMetrics(readResult) : null,
  };
}
