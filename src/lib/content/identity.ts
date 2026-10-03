/** Git write preconditions accept only full identities, never display labels. */
export function parseFullCommitSha(value: string): string | null {
  return /^[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null;
}
export function parseDeploymentVersion(value: string): { sha: string; scope: 'main' | 'ci' | 'pr' } | null {
  const match = /^(?:(sha|ci|pr)-)?([a-f0-9]{40})$/i.exec(value);
  if (!match) return null;
  return { sha: match[2].toLowerCase(), scope: match[1]?.toLowerCase() === 'ci' ? 'ci' : match[1]?.toLowerCase() === 'pr' ? 'pr' : 'main' };
}
export function productionVersionMatches(commit: string, version: string): boolean {
  const expected = parseFullCommitSha(commit);
  const deployed = parseDeploymentVersion(version);
  return expected !== null && deployed?.scope === 'main' && deployed.sha === expected;
}
