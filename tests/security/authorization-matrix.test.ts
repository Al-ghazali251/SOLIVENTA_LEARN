import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Bindings } from '../../src/config/bindings';
import { schoolMembershipMiddleware, scopeForRoles } from '../../src/middleware/school-membership';
import { requirePermission } from '../../src/middleware/permission';
import { permissions, type Permission } from '../../src/permissions/permissions';
import { permissionsForRoles, roles, type Role } from '../../src/permissions/roles';
import type { AppVariables, AuthContext } from '../../src/types/context';
import { AppError } from '../../src/errors/app-error';

const schoolA = '11111111-1111-4111-8111-111111111111';
const schoolB = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function authFor(role: Role): AuthContext {
  return {
    userId,
    schoolId: schoolA,
    roles: [role],
    permissions: permissionsForRoles([role]),
    scope: { kind: role === 'moderator' ? 'platform' : 'school-wide' },
  };
}

function exposeAppErrors(app: Hono<{ Bindings: Bindings; Variables: AppVariables }>) {
  app.onError((error, context) =>
    error instanceof AppError
      ? context.json({ error: { code: error.code } }, error.status as 403)
      : context.json({ error: { code: 'INTERNAL' } }, 500),
  );
}

async function directRequest(role: Role, permission: Permission) {
  const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
  exposeAppErrors(app);
  app.use('*', async (context, next) => {
    context.set('auth', authFor(role));
    await next();
  });
  app.get('/direct', requirePermission(permission), (context) => context.json({ ok: true }));
  return app.request('https://portal.school-a.test/direct');
}

describe('direct API authorization matrix', () => {
  it('assigns every portal role its explicit query-level resource scope', () => {
    const expected = {
      super_admin: 'school-wide', school_admin: 'school-wide', teacher: 'assigned-resources',
      student: 'self', parent: 'linked-children', bursar: 'school-wide', librarian: 'school-wide',
      exam_officer: 'school-wide', applicant: 'self', admissions_officer: 'school-wide',
      registrar: 'school-wide', moderator: 'platform',
    } as const satisfies Record<Role, AuthContext['scope']['kind']>;
    for (const role of roles) expect(scopeForRoles([role]).kind, role).toBe(expected[role]);
  });

  it('enforces every role and permission pair at the API middleware boundary', async () => {
    for (const role of roles) {
      const allowed = permissionsForRoles([role]);
      for (const permission of permissions) {
        const response = await directRequest(role, permission);
        expect(response.status, `${role} -> ${permission}`).toBe(allowed.has(permission) ? 200 : 403);
      }
    }
  });

  it('rejects a valid identity that has no membership in the hostname-resolved tenant', async () => {
    const findForUser = vi.fn((_env: Bindings, requestedSchoolId: string) =>
      Promise.resolve({
        roles: requestedSchoolId === schoolB ? (['student'] as Role[]) : [],
        isModerator: false,
      }),
    );
    const handler = vi.fn((context: { json: (body: unknown) => Response }) =>
      context.json({ reached: true }),
    );
    const app = new Hono<{ Bindings: Bindings; Variables: AppVariables }>();
    exposeAppErrors(app);
    app.use('*', async (context, next) => {
      context.set('tenant', {
        schoolId: schoolA,
        hostname: 'portal.school-a.test',
        domainType: 'portal',
        configurationVersion: 1,
        configurationVersionId: '44444444-4444-4444-8444-444444444444',
      });
      context.set('principal', { userId, token: 'valid-token-for-school-b-user' });
      await next();
    });
    app.use('*', schoolMembershipMiddleware({ findForUser }));
    app.get('/direct', handler);

    const response = await app.request('https://portal.school-a.test/direct');
    expect(response.status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
    expect(findForUser).toHaveBeenCalledWith(undefined, schoolA, userId);
  });
});
