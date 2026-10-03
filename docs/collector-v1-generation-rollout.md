# V1 generation rollout and rollback

Deploy the compatible receiver before installing the new uploader. The new uploader checks the authenticated, bounded `/__collector/v1/capabilities` response before sending any member. An old receiver rejects that GET, so a new uploader cannot fall back to independent writes after receiver rollback.

Before the first coherent generation, the new reader requires a complete legacy pair whose latest snapshot exactly matches the last history member. A missing, invalid, or mixed legacy pair is unavailable evidence until a valid pair arrives. Legacy clients can upload only before an active coherent generation exists.

Every successful generation commit also mirrors latest and history into the legacy table in the same SQL transaction. That preserves a coherent last committed fallback for compatible code rollback. Generation storage and staged data remain retained under their bounds. A rollback to an old receiver stops new uploader writes at capability preflight; last data then ages honestly to stale/unavailable. Recover the compatible receiver rather than enabling an old independent uploader. Never roll both receiver and uploader back to the old independent protocol and claim pair atomicity.

Collector installation is separate from the existing v2 shadow acceptance window. This branch has not restarted or replaced the live collector/uploader. Document evidence implications and retain backups before installation. Public freshness, exact deployed identity and safe v1 fallback must be checked after any planned rollout or rollback.
