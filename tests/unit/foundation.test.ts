import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { AppError } from '../../src/errors/app-error';
import type { Bindings } from '../../src/config/bindings';
import type { BackendServices } from '../../src/services/contracts';
import { defaultServices } from '../../src/services/default-services';
import {
  defaultPortalConfiguration,
  type TenantConfiguration,
} from '../../src/configuration/model';

const schoolId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const configurationVersionId = '33333333-3333-4333-8333-333333333333';
const configuration: TenantConfiguration = {
  schemaVersion: 1,
  template: 'modern-academy',
  branding: {
    logoUrl: null,
    faviconUrl: null,
    colors: {
      primary: '#111111',
      secondary: '#222222',
      accent: '#333333',
      background: '#ffffff',
      surface: '#ffffff',
      text: '#111111',
      muted: '#666666',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    buttonStyle: 'rounded',
    cardStyle: 'bordered',
    inputStyle: 'rounded',
  },
  contact: { email: 'hello@example.test', phone: '+2348000000000', address: '1 School Road' },
  socialLinks: [],
  portal: defaultPortalConfiguration,
  features: { admissions: true },
  navigation: [],
  mediaLibrary: [],
  pages: [
    {
      slug: '/',
      title: 'Home',
      visible: true,
      seo: { title: '', description: '', socialImage: null, noindex: false },
      blocks: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          type: 'richText',
          heading: 'Welcome',
          paragraphs: ['Welcome to our school.'],
        },
      ],
    },
  ],
};
const env: Bindings = {
  APP_ENV: 'development',
  APP_ORIGIN: 'https://app.soliventa.localhost',
  PORTAL_ORIGIN: 'https://portal.soliventa.localhost',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

function services(overrides: Partial<BackendServices> = {}): BackendServices {
  return {
    tenantDirectory: {
      findActiveByHostname: (_env, hostname) =>
        Promise.resolve({
          schoolId,
          hostname,
          domainType: 'portal',
          configurationVersion: 7,
          configurationVersionId,
        }),
    },
    tokenVerifier: { verify: () => Promise.resolve({ userId }) },
    membershipDirectory: {
      findForUser: () => Promise.resolve({ roles: ['school_admin'], isModerator: false }),
    },
    readinessProbe: { check: () => Promise.resolve() },
    configurationStudio: defaultServices.configurationStudio,
    academicStructure: defaultServices.academicStructure,
    domainDirectory: defaultServices.domainDirectory,
    jobs: defaultServices.jobs,
    payments: defaultServices.payments,
    completePlatform: defaultServices.completePlatform,
    platformStudio: defaultServices.platformStudio,
    applicant: defaultServices.applicant,
    communications: defaultServices.communications,
    corePortal: {
      workspace: () =>
        Promise.resolve({
          students: [],
          staff: [],
          attendance: [],
          myClasses: [],
          myClassAssignments: [],
          mySubjectAssignments: [],
          academicTerms: [],
          academicSubjects: [],
          attendanceCorrections: [],
          parentLearningSummaries: [],
          parentUpcomingWork: [],
          parentOverdueWork: [],
          parentAnnouncements: [],
          parentApplications: [],
          parentOffers: [],
          studentEnrollments: [],
          academicSessions: [],
          studentClassSubjects: [],
          identifierSettings: [],
          identifierProfiles: [],
          paymentSettings: null,
          payableFees: [],
          assessments: [],
          scores: [],
          releases: [],
          feeDefinitions: [],
          invoices: [],
          payments: [],
          manualTransfers: [],
          receipts: [],
          resultWorkflows: [],
          resultWorkflowEvents: [],
          resultSummaries: [],
          resultPromotionRules: [],
          resultComponentSettings: [],
          resultSessionWeightSettings: [],
          resultScoreImports: [],
          adjustments: [],
          guardians: [],
          guardianLinks: [],
          accounts: [],
          memberships: [],
          roles: [],
          roleAssignments: [],
          membershipEvents: [],
        }),
      execute: () => Promise.resolve({}),
    },
    bootstrapDirectory: {
      loadPublic: (_env, tenant) =>
        Promise.resolve({
          tenant: { id: tenant.schoolId, name: 'School', primaryDomain: tenant.hostname },
          branding: {
            logo: { url: null },
            colors: { primary: '#111111', secondary: '#222222', accent: '#333333' },
            fonts: { heading: 'Inter', body: 'Inter' },
            favicon: { url: null },
          },
          template: 'modern-academy',
          features: { admissions: true },
          navigation: [],
          configuration,
          configurationVersion: tenant.configurationVersion,
        }),
      loadPortal: () => Promise.reject(new Error('not used')),
    },
    ...overrides,
  };
}

describe('backend foundation', () => {
  it('resolves public bootstrap from the URL host and ignores forwarded host', async () => {
    const lookup = vi.fn((_env: Bindings, hostname: string) =>
      Promise.resolve({
        schoolId,
        hostname,
        domainType: 'public' as const,
        configurationVersion: 7,
        configurationVersionId,
      }),
    );
    const response = await createApp(
      services({ tenantDirectory: { findActiveByHostname: lookup } }),
    ).request(
      'https://school.example/v1/public/bootstrap',
      { headers: { 'X-Forwarded-Host': 'attacker.example' } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-tenant-cache')).toBe('MISS');
    expect(response.headers.get('server-timing')).toMatch(/^tenant-bootstrap;dur=/);
    expect(lookup).toHaveBeenCalledWith(env, 'school.example');
    await expect(response.json()).resolves.toMatchObject({
      data: { tenant: { primaryDomain: 'school.example' }, configurationVersion: 7 },
    });
  });

  it('requires authentication and permission for protected routes', async () => {
    const app = createApp(services());
    expect((await app.request('https://school.example/v1/students', undefined, env)).status).toBe(
      401,
    );
    const denied = createApp(
      services({
        membershipDirectory: {
          findForUser: () => Promise.resolve({ roles: ['student'], isModerator: false }),
        },
      }),
    );
    const response = await denied.request(
      'https://school.example/v1/students',
      { headers: { Authorization: 'Bearer valid' } },
      env,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
  });

  it('allows authorized school members', async () => {
    const response = await createApp(services()).request(
      'https://school.example/v1/students',
      { headers: { Authorization: 'Bearer valid' } },
      env,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [], page: { nextCursor: null, limit: 25 } },
    });
  });

  it('returns a private portal bootstrap without shared caching', async () => {
    const portal = createApp(
      services({
        bootstrapDirectory: {
          loadPublic: () => Promise.reject(new Error('not used')),
          loadPortal: (_env, tenant, profileId) =>
            Promise.resolve({
              tenant: { id: tenant.schoolId, name: 'School', primaryDomain: tenant.hostname },
              contact: { email: '', phone: '', address: '' },
              schoolBranding: configuration.branding,
              profile: {
                id: profileId,
                displayName: 'Administrator',
                email: null,
                avatarUrl: null,
              },
              portal: defaultPortalConfiguration,
              portalFeatures: { 'portal.results': true },
              navigation: [],
              schoolStatus: 'active',
              unreadCounts: {},
              configurationVersion: tenant.configurationVersion,
            }),
        },
      }),
    );
    const response = await portal.request(
      'https://portal.school.example/v1/portal/bootstrap',
      { headers: { Authorization: 'Bearer valid' } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      data: { profile: { id: userId }, roles: ['school_admin'], schoolStatus: 'active' },
    });
  });

  it('boots the central platform domain without a school tenant', async () => {
    const platformTenant = {
      schoolId: '00000000-0000-0000-0000-000000000000',
      hostname: 'localhost',
      domainType: 'platform' as const,
      configurationVersion: 0,
      configurationVersionId: '00000000-0000-0000-0000-000000000000',
    };
    const app = createApp(
      services({
        tenantDirectory: { findActiveByHostname: () => Promise.resolve(platformTenant) },
        membershipDirectory: {
          findForUser: () => Promise.resolve({ roles: [], isModerator: true }),
        },
        bootstrapDirectory: {
          loadPublic: () => Promise.reject(new Error('not used')),
          loadPortal: (_env, tenant, profileId) =>
            Promise.resolve({
              tenant: {
                id: tenant.schoolId,
                name: 'Soliventa Learn Platform',
                primaryDomain: tenant.hostname,
              },
              contact: { email: '', phone: '', address: '' },
              schoolBranding: configuration.branding,
              profile: {
                id: profileId,
                displayName: 'Platform operator',
                email: null,
                avatarUrl: null,
              },
              portal: defaultPortalConfiguration,
              portalFeatures: {},
              navigation: [],
              schoolStatus: 'active',
              unreadCounts: {},
              configurationVersion: 0,
            }),
        },
      }),
    );
    const publicResponse = await app.request(
      'http://localhost/v1/platform/public-bootstrap',
      undefined,
      env,
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      data: { tenant: { name: 'Soliventa Learn Platform' } },
    });
    const privateResponse = await app.request(
      'http://localhost/v1/platform/bootstrap',
      { headers: { Authorization: 'Bearer valid' } },
      env,
    );
    expect(privateResponse.status).toBe(200);
    await expect(privateResponse.json()).resolves.toMatchObject({
      data: { tenant: { id: platformTenant.schoolId }, roles: ['moderator'] },
    });
  });

  it('normalizes dependency errors without leaking their cause', async () => {
    const app = createApp(
      services({
        tenantDirectory: {
          findActiveByHostname: () =>
            Promise.reject(
              new AppError({
                code: 'SERVICE_NOT_READY',
                message: 'A required service is unavailable.',
                status: 503,
                cause: new Error('database password leaked'),
              }),
            ),
        },
      }),
    );
    const response = await app.request(
      'https://school.example/v1/public/bootstrap',
      undefined,
      env,
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain('password');
    const body = JSON.parse(text) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('SERVICE_NOT_READY');
    expect(body.error.requestId).toMatch(/^req_/);
  });

  it('rejects cross-origin requests and sets security headers', async () => {
    const response = await createApp(services()).request(
      'https://school.example/health/live',
      { headers: { Origin: 'https://evil.example' } },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('does not grant CORS to an unknown or removed tenant hostname', async () => {
    const unknown = createApp(
      services({ tenantDirectory: { findActiveByHostname: () => Promise.resolve(null) } }),
    );
    const response = await unknown.request(
      'https://removed.school.example/health/live',
      { headers: { Origin: 'https://removed.school.example' } },
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
});
