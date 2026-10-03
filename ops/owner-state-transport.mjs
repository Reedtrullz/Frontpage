export class UnknownRestoreOutcomeError extends Error {
  constructor() {super('SQL restore outcome is unknown. Keep owner writes stopped and verify the target against the backup before retrying.');}
}
/** A response lost after commit is reconciled by the desired state, never a second PUT. */
export async function restoreRemoteOwnerState({backup,target,put,read,validate}) {
  let writeAcknowledged=false;
  try {await put(backup);writeAcknowledged=true;} catch { /* The remote commit may have completed. */ }
  try {
    const readback=validate(await read());
    if(readback.source.target!==target || JSON.stringify(readback.records)!==JSON.stringify(backup.records))throw new UnknownRestoreOutcomeError();
    return {stateConfirmed:true,writeAcknowledged,reconciled:!writeAcknowledged};
  } catch {throw new UnknownRestoreOutcomeError();}
}
