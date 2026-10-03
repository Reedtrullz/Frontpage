const listeners = new Set<() => void>();
let expired = false;

export function ownerSessionExpired(): boolean {
  return expired;
}

export function subscribeOwnerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markOwnerSessionExpired(): void {
  if (expired) return;
  expired = true;
  for (const listener of listeners) listener();
}

export function ownerSessionServerSnapshot(): boolean {
  return false;
}
