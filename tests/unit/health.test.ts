import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { bindingsAreConfigured, type Bindings } from '../../src/config/bindings';
import type { BackendServices } from '../../src/services/contracts';
import { defaultServices } from '../../src/services/default-services';

const schoolId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const configurationVersionId = '33333333-3333-4333-8333-333333333333';
const bindings: Bindings = {
  APP_ENV: 'test' as Bindings['APP_ENV'],
  APP_ORIGIN: 'https://app.soliventa.localhost',
  PORTAL_ORIGIN: 'https://portal.soliventa.localhost',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
  SUPABASE_SECRET_KEY: 'sb_secret_test',
};

function services(overrides: Partial<BackendServices> = {}): BackendServices {
  return {
    tenantDirectory: {
      findActiveByHostname: (_bindings, hostname) =>
        Promise.resolve({
          schoolId,
          hostname,
          domainType: 'public',
          configurationVersion: 1,
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
      loadPublic: () => Promise.reject(new Error('not used')),
      loadPortal: () => Promise.reject(new Error('not used')),
    },
    ...overrides,
  };
}

describe('health endpoint', () => {
  it('reports that the API is live', async () => {
    const response = await createApp(services()).request('/health/live', undefined, bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toMatch(/^req_/);
    const body = await response.json<{ data: { status: string }; meta: { requestId: string } }>();
    expect(body.data).toEqual({ status: 'ok' });
    expect(body.meta.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('checks dependencies for readiness', async () => {
    const response = await createApp(services()).request('/health/ready', undefined, bindings);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { status: 'ready' } });
  });

  it('rejects the legacy service-role JWT configuration', async () => {
    const response = await createApp(services()).request('/health/ready', undefined, {
      ...bindings,
      SUPABASE_SECRET_KEY: 'eyJhbGciOiJIUzI1NiJ9.legacy.signature',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'SERVICE_NOT_READY' },
    });
  });

  it('rejects reserved local domains as production platform domains', () => {
    const production = {
      ...bindings,
      APP_ENV: 'production',
      PLATFORM_BASE_DOMAIN: 'platform.school-services.ng',
      TENANT_CACHE: {} as KVNamespace,
      RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
      JOB_QUEUE: {} as Queue,
      METRICS: {} as AnalyticsEngineDataset,
      RESEND_API_KEY: 're_test',
      RESEND_FROM_EMAIL: 'notifications@school-services.ng',
    } satisfies Bindings;
    expect(bindingsAreConfigured(production)).toBe(true);
    expect(
      bindingsAreConfigured({ ...production, PLATFORM_BASE_DOMAIN: 'soliventa.localhost' }),
    ).toBe(false);
  });
});
