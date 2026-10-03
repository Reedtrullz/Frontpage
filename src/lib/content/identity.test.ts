import { expect, it } from 'vitest';
import { parseFullCommitSha, parseDeploymentVersion, productionVersionMatches } from './identity';

it('uses anchored complete identities for writes', () => {
  for (const value of ['dev', 'unknown', 'a'.repeat(7), `unrelated-${'a'.repeat(40)}-text`]) expect(parseFullCommitSha(value)).toBeNull();
  expect(parseFullCommitSha('A'.repeat(40))).toBe('a'.repeat(40));
});
it('separates production, CI and PR versions', () => {
  const sha = 'a'.repeat(40);
  expect(parseDeploymentVersion(`ci-${sha}`)).toEqual({sha, scope: 'ci'});
  expect(productionVersionMatches(sha, `pr-${sha}`)).toBe(false);
  expect(productionVersionMatches(sha, `sha-${sha}`)).toBe(true);
  expect(productionVersionMatches(sha, sha.slice(0, 7))).toBe(false);
  expect(productionVersionMatches(sha, `${sha.slice(0, 7)}${'b'.repeat(33)}`)).toBe(false);
});
