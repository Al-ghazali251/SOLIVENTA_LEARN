import { describe, expect, it } from 'vitest';
import { scopeForRoles } from './school-membership';

describe('school membership scope', () => {
  it('keeps a platform operator constrained to their guardian scope inside a school', () => {
    expect(scopeForRoles(['parent', 'moderator'])).toEqual({ kind: 'linked-children' });
  });

  it('uses platform scope only without a school-scoped role', () => {
    expect(scopeForRoles(['moderator'])).toEqual({ kind: 'platform' });
  });
});
