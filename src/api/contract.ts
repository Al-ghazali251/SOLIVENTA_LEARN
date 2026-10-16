import { createRoute, z } from '@hono/zod-openapi';
import { PortalConfigurationSchema, TenantConfigurationSchema } from '../configuration/model';
import { CorePortalCommandSchema } from '../core-portal/model';
import { CompletePlatformCommandSchema } from '../complete-platform/model';
import { PlatformStudioCommandSchema } from '../platform-studio/model';
import { ApplicantCommandSchema, ApplicantStatusSchema } from '../applicant/model';

export const RequestIdSchema = z.string().startsWith('req_').openapi({ example: 'req_abc123' });
export const ErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: RequestIdSchema,
  }),
});

const meta = z.object({ requestId: RequestIdSchema });
const success = <T extends z.ZodType>(data: T) => z.object({ data, meta });
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorSchema } },
});
const bearer = [{ bearerAuth: [] }];
const NavigationSchema = z.array(z.object({ label: z.string(), href: z.string() }));
const TenantSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  primaryDomain: z.string(),
});
const PublicBootstrapSchema = z.object({
  tenant: TenantSummarySchema,
  branding: z.object({
    logo: z.object({ url: z.string().nullable() }),
    colors: z.object({ primary: z.string(), secondary: z.string(), accent: z.string() }),
    fonts: z.object({ heading: z.string(), body: z.string() }),
    favicon: z.object({ url: z.string().nullable() }),
  }),
  template: z.string(),
  features: z.record(z.string(), z.boolean()),
  navigation: NavigationSchema,
  configuration: TenantConfigurationSchema,
  configurationVersion: z.number().int().positive(),
});
const PlatformPublicBootstrapSchema = z.object({
  tenant: TenantSummarySchema,
  branding: z.object({
    logo: z.object({ url: z.string().nullable() }),
    colors: z.object({ primary: z.string(), secondary: z.string(), accent: z.string() }),
    fonts: z.object({ heading: z.string(), body: z.string() }),
    favicon: z.object({ url: z.string().nullable() }),
  }),
});
const PortalBootstrapDataSchema = z.object({
  tenant: TenantSummarySchema,
  contact: z.object({ email: z.string(), phone: z.string(), address: z.string() }),
  schoolBranding: TenantConfigurationSchema.shape.branding,
  profile: z.object({
    id: z.string().uuid(),
    displayName: z.string(),
    email: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  portal: PortalConfigurationSchema,
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  membership: z.object({
    id: z.string().uuid().nullable(),
    kind: z
      .enum(['applicant', 'guardian', 'student', 'teacher', 'administrator', 'specialist'])
      .nullable(),
    lifecycleState: z.string().nullable(),
  }),
  resourceScopes: z.record(z.string(), z.unknown()),
  supportSession: z
    .object({
      id: z.string().uuid(),
      operatorId: z.string().uuid(),
      targetAccountId: z.string().uuid(),
      reason: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  portalFeatures: z.record(z.string(), z.boolean()),
  navigation: NavigationSchema,
  schoolStatus: z.enum(['active', 'suspended']),
  unreadCounts: z.record(z.string(), z.number().int().nonnegative()),
  configurationVersion: z.number().int().nonnegative(),
});
export const BrowserErrorReportSchema = z.object({
  kind: z.enum(['react-boundary', 'unhandled-error', 'unhandled-rejection']),
  errorName: z.string().min(1).max(80),
  route: z.string().startsWith('/').max(200),
  component: z.string().max(100).optional(),
  release: z.string().max(80).optional(),
});
const ConfigurationVersionResponseSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  configuration: TenantConfigurationSchema,
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
});

const StudentSchema = z.object({
  id: z.string().uuid(),
  admissionNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
});

const pageQuery = z.object({
  cursor: z.string().optional().openapi({ description: 'Opaque cursor from the previous page.' }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const DomainSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  domainType: z.enum(['public_site', 'portal']),
  domainKind: z.enum(['platform', 'custom']),
  status: z.enum([
    'pending',
    'awaiting_dns',
    'verifying',
    'active',
    'failed',
    'suspended',
    'removed',
  ]),
  certificateStatus: z.enum(['pending', 'provisioning', 'active', 'failed', 'expired']),
  isPrimary: z.boolean(),
  redirectToPrimary: z.boolean(),
  providerHostnameId: z.string().nullable(),
  ownershipVerification: z.record(z.string(), z.unknown()).nullable(),
  certificateValidation: z.array(z.record(z.string(), z.unknown())),
  failureReason: z.string().nullable(),
  lastCheckedAt: z.string().nullable(),
  createdAt: z.string(),
});
const JobSchema = z.object({
  id: z.string().uuid(),
  schoolId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  traceId: RequestIdSchema,
  operation: z.enum(['domain.verify', 'cache.warm', 'lesson.generate']),
  status: z.enum(['queued', 'running', 'retrying', 'succeeded', 'failed', 'dead_lettered']),
  attemptCount: z.number().int(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  lastErrorMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export const routes = {
  search: createRoute({
    method: 'get',
    path: '/search',
    operationId: 'searchPortal',
    tags: ['Communications'],
    security: bearer,
    request: { query: z.object({ q: z.string().min(2).max(80) }) },
    responses: {
      200: {
        description: 'Scope-filtered search results.',
        content: {
          'application/json': {
            schema: success(
              z.array(
                z.object({
                  type: z.string(),
                  id: z.string(),
                  title: z.string(),
                  description: z.string(),
                  href: z.string(),
                }),
              ),
            ),
          },
        },
      },
      400: errorResponse('Invalid search query.'),
      401: errorResponse('Authentication required.'),
    },
  }),
  notifications: createRoute({
    method: 'get',
    path: '/notifications',
    operationId: 'getNotifications',
    tags: ['Communications'],
    security: bearer,
    responses: {
      200: {
        description: 'Own notifications.',
        content: {
          'application/json': { schema: success(z.array(z.record(z.string(), z.unknown()))) },
        },
      },
      401: errorResponse('Authentication required.'),
    },
  }),
  readNotification: createRoute({
    method: 'post',
    path: '/notifications/:id/read',
    operationId: 'readNotification',
    tags: ['Communications'],
    security: bearer,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Notification marked read.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      401: errorResponse('Authentication required.'),
      404: errorResponse('Notification not found.'),
    },
  }),
  startSupport: createRoute({
    method: 'post',
    path: '/support/sessions',
    operationId: 'startSupportSession',
    tags: ['Support'],
    security: bearer,
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              targetMembershipId: z.string().uuid(),
              reason: z.string().min(10).max(1000),
              durationMinutes: z.number().int().min(5).max(120).default(30),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Support session started.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                id: z.string().uuid(),
                token: z.string(),
                schoolId: z.string().uuid(),
                targetAccountId: z.string().uuid(),
                targetDisplayName: z.string(),
                reason: z.string(),
                expiresAt: z.string(),
              }),
            ),
          },
        },
      },
      403: errorResponse('Platform operator permission required.'),
    },
  }),
  endSupport: createRoute({
    method: 'post',
    path: '/support/sessions/:id/end',
    operationId: 'endSupportSession',
    tags: ['Support'],
    security: bearer,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Support session ended.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      403: errorResponse('Platform operator permission required.'),
    },
  }),
  live: createRoute({
    method: 'get',
    path: '/health/live',
    operationId: 'getLiveness',
    tags: ['Health'],
    summary: 'Confirm the Worker is executing.',
    responses: {
      200: {
        description: 'Worker is live.',
        content: { 'application/json': { schema: success(z.object({ status: z.literal('ok') })) } },
      },
    },
  }),
  ready: createRoute({
    method: 'get',
    path: '/health/ready',
    operationId: 'getReadiness',
    tags: ['Health'],
    summary: 'Confirm required production dependencies are available.',
    responses: {
      200: {
        description: 'API is ready.',
        content: {
          'application/json': { schema: success(z.object({ status: z.literal('ready') })) },
        },
      },
      503: errorResponse('A required dependency is unavailable.'),
    },
  }),
  bootstrap: createRoute({
    method: 'get',
    path: '/bootstrap',
    operationId: 'getTenantBootstrap',
    tags: ['Public'],
    summary: 'Get the published configuration identity for the request hostname.',
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    responses: {
      200: {
        description: 'Active tenant bootstrap.',
        content: {
          'application/json': {
            schema: success(PublicBootstrapSchema),
          },
        },
      },
      404: errorResponse('The hostname does not map to an active tenant.'),
      429: errorResponse('Rate limit exceeded.'),
      503: errorResponse('Tenant dependency unavailable.'),
    },
  }),
  platformPublicBootstrap: createRoute({
    method: 'get',
    path: '/public-bootstrap',
    operationId: 'getPlatformPublicBootstrap',
    tags: ['Platform'],
    summary: 'Get the central platform operator identity.',
    responses: {
      200: {
        description: 'Platform identity.',
        content: { 'application/json': { schema: success(PlatformPublicBootstrapSchema) } },
      },
      404: errorResponse('The hostname is not a configured platform domain.'),
    },
  }),
  reportBrowserError: createRoute({
    method: 'post',
    path: '/browser-errors',
    operationId: 'reportBrowserError',
    tags: ['Telemetry'],
    summary: 'Report a sanitized frontend failure without messages, stacks, or user data.',
    'x-rate-limit': { limit: 20, periodSeconds: 60 },
    request: {
      body: { content: { 'application/json': { schema: BrowserErrorReportSchema } } },
    },
    responses: {
      202: {
        description: 'Report accepted.',
        content: {
          'application/json': { schema: success(z.object({ accepted: z.literal(true) })) },
        },
      },
      404: errorResponse('The hostname does not map to an active tenant.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  portalBootstrap: createRoute({
    method: 'get',
    path: '/bootstrap',
    operationId: 'getPortalBootstrap',
    tags: ['Portal'],
    security: bearer,
    summary: 'Get the private, user-specific portal shell configuration.',
    'x-required-permissions': [],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    responses: {
      200: {
        description: 'Private portal bootstrap.',
        content: {
          'application/json': {
            schema: success(PortalBootstrapDataSchema),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('No active school membership.'),
      429: errorResponse('Rate limit exceeded.'),
      503: errorResponse('Bootstrap dependency unavailable.'),
    },
  }),
  platformPortalBootstrap: createRoute({
    method: 'get',
    path: '/bootstrap',
    operationId: 'getPlatformPortalBootstrap',
    tags: ['Platform'],
    security: bearer,
    summary: 'Get the authenticated platform operator shell.',
    responses: {
      200: {
        description: 'Platform operator bootstrap.',
        content: { 'application/json': { schema: success(PortalBootstrapDataSchema) } },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Platform operator access is required.'),
      404: errorResponse('The hostname is not a configured platform domain.'),
    },
  }),
  currentUser: createRoute({
    method: 'get',
    path: '/me',
    operationId: 'getCurrentUser',
    tags: ['Auth'],
    security: bearer,
    summary: 'Get the authenticated user and current school authorization.',
    'x-required-permissions': [],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    responses: {
      200: {
        description: 'Current user.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                userId: z.string().uuid(),
                schoolId: z.string().uuid(),
                roles: z.array(z.string()),
                permissions: z.array(z.string()),
                scope: z.string(),
                membership: z.object({
                  id: z.string().uuid().nullable(),
                  kind: z
                    .enum([
                      'applicant',
                      'guardian',
                      'student',
                      'teacher',
                      'administrator',
                      'specialist',
                    ])
                    .nullable(),
                  lifecycleState: z.string().nullable(),
                }),
                resourceScopes: z.record(z.string(), z.unknown()),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('No active school membership.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  configurationWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getConfigurationWorkspace',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Load the authorized school website draft, version history, and feature entitlements.',
    'x-required-permissions': ['school.configure'],
    responses: {
      200: {
        description: 'Customization workspace.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                draft: ConfigurationVersionResponseSchema,
                versions: z.array(ConfigurationVersionResponseSchema),
                platformFeatures: z.record(z.string(), z.boolean()),
                entitlements: z.record(z.string(), z.boolean()),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires school.configure.'),
    },
  }),
  uploadConfigurationAsset: createRoute({
    method: 'post',
    path: '/assets',
    operationId: 'uploadConfigurationAsset',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Upload a tenant-scoped image or PDF for Website Studio or Portal Studio.',
    'x-required-permissions': ['school.configure'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              name: z.string().trim().min(1).max(255),
              mimeType: z.enum([
                'image/jpeg',
                'image/png',
                'image/webp',
                'image/avif',
                'application/pdf',
              ]),
              base64: z.string().min(1).max(14000000),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Uploaded public studio asset.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                id: z.string().uuid(),
                name: z.string(),
                url: z.string().url(),
                mimeType: z.string(),
                sizeBytes: z.number().int().positive(),
              }),
            ),
          },
        },
      },
      400: errorResponse('Invalid file or file exceeds 10 MB.'),
      403: errorResponse('Requires school.configure.'),
    },
  }),
  saveConfigurationDraft: createRoute({
    method: 'put',
    path: '/draft',
    operationId: 'saveConfigurationDraft',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Validate and save a private configuration draft.',
    'x-required-permissions': ['school.configure'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              versionId: z.string().uuid().optional(),
              configuration: TenantConfigurationSchema,
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Saved draft.',
        content: { 'application/json': { schema: success(ConfigurationVersionResponseSchema) } },
      },
      400: errorResponse('Configuration validation failed.'),
      403: errorResponse('Requires school.configure.'),
      422: errorResponse('A requested feature is not entitled.'),
    },
  }),
  publishConfiguration: createRoute({
    method: 'post',
    path: '/{versionId}/publish',
    operationId: 'publishConfiguration',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Transactionally publish a validated immutable configuration.',
    'x-required-permissions': ['school.configure'],
    request: { params: z.object({ versionId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Published version.',
        content: { 'application/json': { schema: success(ConfigurationVersionResponseSchema) } },
      },
      400: errorResponse('Configuration is incomplete.'),
      403: errorResponse('Requires school.configure.'),
    },
  }),
  rollbackConfiguration: createRoute({
    method: 'post',
    path: '/{versionId}/rollback',
    operationId: 'rollbackConfiguration',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Clone and republish a prior immutable version.',
    'x-required-permissions': ['school.configure'],
    request: { params: z.object({ versionId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Restored version.',
        content: { 'application/json': { schema: success(ConfigurationVersionResponseSchema) } },
      },
      403: errorResponse('Requires school.configure.'),
      404: errorResponse('Version not found.'),
    },
  }),
  issueConfigurationPreview: createRoute({
    method: 'post',
    path: '/{versionId}/preview-token',
    operationId: 'issueConfigurationPreview',
    tags: ['Configuration'],
    security: bearer,
    summary: 'Issue a signed short-lived draft preview URL.',
    'x-required-permissions': ['school.configure'],
    request: { params: z.object({ versionId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Private preview URL.',
        content: {
          'application/json': {
            schema: success(
              z.object({ token: z.string(), url: z.string().url(), expiresAt: z.string() }),
            ),
          },
        },
      },
      403: errorResponse('Requires school.configure.'),
      503: errorResponse('Preview signing is unavailable.'),
    },
  }),
  configurationPreview: createRoute({
    method: 'get',
    path: '/v1/preview/{schoolId}/{versionId}',
    operationId: 'getConfigurationPreview',
    tags: ['Configuration'],
    summary: 'Load the exact draft authorized by a signed preview token.',
    request: {
      params: z.object({ schoolId: z.string().uuid(), versionId: z.string().uuid() }),
      query: z.object({ token: z.string().min(20) }),
    },
    responses: {
      200: {
        description: 'Private draft configuration.',
        content: { 'application/json': { schema: success(ConfigurationVersionResponseSchema) } },
      },
      401: errorResponse('Preview token invalid or expired.'),
      404: errorResponse('Draft not found.'),
    },
  }),
  listDomains: createRoute({
    method: 'get',
    path: '/',
    operationId: 'listDomains',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    responses: {
      200: {
        description: 'School domains and provisioning state.',
        content: { 'application/json': { schema: success(z.array(DomainSchema)) } },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires domains.manage.'),
    },
  }),
  provisionDefaultDomains: createRoute({
    method: 'post',
    path: '/defaults',
    operationId: 'provisionDefaultDomains',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    responses: {
      200: {
        description: 'Default public and portal domains.',
        content: { 'application/json': { schema: success(z.array(DomainSchema)) } },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires domains.manage.'),
    },
  }),
  createCustomDomain: createRoute({
    method: 'post',
    path: '/custom',
    operationId: 'createCustomDomain',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              hostname: z.string().min(4).max(253),
              domainType: z.enum(['public_site', 'portal']),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Custom hostname created with DNS verification instructions.',
        content: { 'application/json': { schema: success(DomainSchema) } },
      },
      400: errorResponse('Invalid hostname.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires domains.manage.'),
      503: errorResponse('Domain provider unavailable.'),
    },
  }),
  refreshDomain: createRoute({
    method: 'post',
    path: '/{domainId}/refresh',
    operationId: 'refreshDomain',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    request: {
      params: z.object({ domainId: z.string().uuid() }),
      headers: z.object({ 'Idempotency-Key': z.string().min(16).max(128) }),
    },
    responses: {
      202: {
        description: 'Domain verification job accepted.',
        content: { 'application/json': { schema: success(JobSchema) } },
      },
      404: errorResponse('Custom domain not found.'),
      503: errorResponse('Domain provider unavailable.'),
    },
  }),
  getJob: createRoute({
    method: 'get',
    path: '/{jobId}',
    operationId: 'getJob',
    tags: ['Jobs'],
    security: bearer,
    request: { params: z.object({ jobId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Current durable job status.',
        content: { 'application/json': { schema: success(JobSchema) } },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      404: errorResponse('Job not found.'),
    },
  }),
  setPrimaryDomain: createRoute({
    method: 'put',
    path: '/{domainId}/primary',
    operationId: 'setPrimaryDomain',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    request: { params: z.object({ domainId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Active domain selected as primary.',
        content: { 'application/json': { schema: success(DomainSchema) } },
      },
      404: errorResponse('Active domain not found.'),
    },
  }),
  removeDomain: createRoute({
    method: 'delete',
    path: '/{domainId}',
    operationId: 'removeDomain',
    tags: ['Domains'],
    security: bearer,
    'x-required-permissions': ['domains.manage'],
    request: { params: z.object({ domainId: z.string().uuid() }) },
    responses: {
      200: {
        description: 'Custom domain mapping and provider hostname removed.',
        content: { 'application/json': { schema: success(DomainSchema) } },
      },
      404: errorResponse('Custom domain not found.'),
      503: errorResponse('Domain provider unavailable.'),
    },
  }),
  academicWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getAcademicWorkspace',
    tags: ['Academic structure'],
    security: bearer,
    summary: 'Load classes, subjects, sessions, terms and current teacher assignments.',
    'x-required-permissions': ['academic.read'],
    responses: {
      200: {
        description: 'Academic structure workspace.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                classes: z.array(z.record(z.string(), z.unknown())),
                arms: z.array(z.record(z.string(), z.unknown())),
                subjects: z.array(z.record(z.string(), z.unknown())),
                sessions: z.array(z.record(z.string(), z.unknown())),
                terms: z.array(z.record(z.string(), z.unknown())),
                classSubjects: z.array(z.record(z.string(), z.unknown())),
                classTeachers: z.array(z.record(z.string(), z.unknown())),
                teacherAssignments: z.array(z.record(z.string(), z.unknown())),
                students: z.array(z.record(z.string(), z.unknown())),
                staff: z.array(z.record(z.string(), z.unknown())),
                enrollments: z.array(z.record(z.string(), z.unknown())),
                templates: z.array(z.record(z.string(), z.unknown())),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.read.'),
    },
  }),
  saveAcademicRecord: createRoute({
    method: 'put',
    path: '/records',
    operationId: 'saveAcademicRecord',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.discriminatedUnion('entity', [
              z.object({
                entity: z.literal('template'),
                id: z.string().uuid().optional(),
                name: z.string(),
                classId: z.string().uuid().nullable().optional(),
                armId: z.string().uuid().nullable().optional(),
                subjects: z.array(z.string()).min(1).max(100),
                active: z.boolean().optional(),
              }),
              z.object({
                entity: z.literal('arm'),
                id: z.string().uuid().optional(),
                classId: z.string().uuid(),
                name: z.string(),
                code: z.string(),
                capacity: z.number().int().positive().nullable().optional(),
                active: z.boolean().optional(),
              }),
              z.object({
                entity: z.literal('class'),
                id: z.string().uuid().optional(),
                name: z.string(),
                code: z.string(),
                active: z.boolean().optional(),
              }),
              z.object({
                entity: z.literal('subject'),
                id: z.string().uuid().optional(),
                name: z.string(),
                code: z.string(),
                active: z.boolean().optional(),
              }),
              z.object({
                entity: z.literal('session'),
                id: z.string().uuid().optional(),
                name: z.string(),
                startsOn: z.string().date().nullable().optional(),
                endsOn: z.string().date().nullable().optional(),
                status: z.enum(['planned', 'active', 'closed']),
              }),
              z.object({
                entity: z.literal('term'),
                id: z.string().uuid().optional(),
                sessionId: z.string().uuid(),
                name: z.string(),
                position: z.number().int(),
                startsOn: z.string().date().nullable().optional(),
                endsOn: z.string().date().nullable().optional(),
                status: z.enum(['planned', 'active', 'closed']),
              }),
            ]),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Saved academic record.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Record validation failed.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
    },
  }),
  deleteAcademicRecord: createRoute({
    method: 'delete',
    path: '/records/{entity}/{id}',
    operationId: 'deleteAcademicRecord',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      params: z.object({
        entity: z.enum(['class', 'arm', 'subject', 'session', 'term', 'template']),
        id: z.string().uuid(),
      }),
    },
    responses: {
      200: {
        description: 'Record deleted.',
        content: {
          'application/json': { schema: success(z.object({ deleted: z.literal(true) })) },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
      404: errorResponse('Record not found.'),
    },
  }),
  replaceClassSubjects: createRoute({
    method: 'put',
    path: '/classes/{classId}/subjects',
    operationId: 'replaceClassSubjects',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      params: z.object({ classId: z.string().uuid() }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({ subjectIds: z.array(z.string().uuid()).max(100) }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Class subjects replaced.',
        content: {
          'application/json': { schema: success(z.object({ updated: z.literal(true) })) },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
    },
  }),
  assignClassTeacher: createRoute({
    method: 'put',
    path: '/classes/{classId}/teacher',
    operationId: 'assignClassTeacher',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      params: z.object({ classId: z.string().uuid() }),
      body: {
        required: true,
        content: {
          'application/json': { schema: z.object({ teacherUserId: z.string().uuid().nullable() }) },
        },
      },
    },
    responses: {
      200: {
        description: 'Class teacher updated.',
        content: {
          'application/json': { schema: success(z.object({ updated: z.literal(true) })) },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
    },
  }),
  replaceTeacherAssignments: createRoute({
    method: 'put',
    path: '/teachers/{teacherUserId}/assignments',
    operationId: 'replaceTeacherAssignments',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      params: z.object({ teacherUserId: z.string().uuid() }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              assignments: z
                .array(z.object({ classId: z.string().uuid(), subjectId: z.string().uuid() }))
                .max(250),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Teacher assignments replaced.',
        content: {
          'application/json': { schema: success(z.object({ updated: z.literal(true) })) },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
    },
  }),
  manageStudentEnrollment: createRoute({
    method: 'put',
    path: '/enrollments',
    operationId: 'manageStudentEnrollment',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['academic.manage'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              studentId: z.string().uuid(),
              sessionId: z.string().uuid(),
              classId: z.string().uuid(),
              armId: z.string().uuid().nullable().optional(),
              enrolledAt: z.string().date(),
              active: z.boolean().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Student enrolment saved.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Invalid enrolment.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires academic.manage.'),
    },
  }),
  bulkPromoteStudents: createRoute({
    method: 'post',
    path: '/promotions',
    operationId: 'bulkPromoteStudents',
    tags: ['Academic structure'],
    security: bearer,
    'x-required-permissions': ['students.promote'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              studentIds: z.array(z.string().uuid()).min(1).max(500),
              sourceClassId: z.string().uuid(),
              targetSessionId: z.string().uuid(),
              targetClassId: z.string().uuid(),
              targetArmId: z.string().uuid().nullable().optional(),
              enrolledAt: z.string().date(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Students promoted.',
        content: {
          'application/json': {
            schema: success(z.object({ promoted: z.number().int().nonnegative() })),
          },
        },
      },
      400: errorResponse('Invalid promotion request.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires promotion access for the source class.'),
    },
  }),
  listStudents: createRoute({
    method: 'get',
    path: '/',
    operationId: 'listStudents',
    tags: ['Students'],
    security: bearer,
    summary: 'List students visible within the caller authorization scope.',
    'x-required-permissions': ['students.read'],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    request: { query: pageQuery },
    responses: {
      200: {
        description: 'Cursor-paginated students.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                items: z.array(StudentSchema),
                page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires students.read.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  createStudent: createRoute({
    method: 'post',
    path: '/',
    operationId: 'createStudent',
    tags: ['Students'],
    security: bearer,
    summary: 'Create a student. Idempotent for 24 hours by Idempotency-Key.',
    'x-required-permissions': ['students.create'],
    'x-idempotency': { required: true, retentionHours: 24 },
    'x-rate-limit': { limit: 30, periodSeconds: 60 },
    request: {
      headers: z.object({ 'Idempotency-Key': z.string().min(16).max(128) }),
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              admissionNumber: z.string().min(1).max(80),
              firstName: z.string().min(1).max(100),
              lastName: z.string().min(1).max(100),
            }),
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Student created.',
        content: { 'application/json': { schema: success(StudentSchema) } },
      },
      400: errorResponse('Invalid request or idempotency key.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires students.create.'),
      429: errorResponse('Rate limit exceeded.'),
      503: errorResponse('Student write service is not available.'),
    },
  }),
  listStaff: createRoute({
    method: 'get',
    path: '/',
    operationId: 'listStaff',
    tags: ['Staff'],
    security: bearer,
    'x-required-permissions': ['staff.manage'],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    request: { query: pageQuery },
    responses: {
      200: {
        description: 'Cursor-paginated staff.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                items: z.array(z.object({ userId: z.string().uuid(), roles: z.array(z.string()) })),
                page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires staff.manage.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  listAttendance: createRoute({
    method: 'get',
    path: '/',
    operationId: 'listAttendance',
    tags: ['Attendance'],
    security: bearer,
    'x-required-permissions': ['attendance.record'],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    request: { query: pageQuery.extend({ date: z.string().date().optional() }) },
    responses: {
      200: {
        description: 'Cursor-paginated attendance records.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                items: z.array(
                  z.object({
                    studentId: z.string().uuid(),
                    date: z.string().date(),
                    status: z.enum(['present', 'absent', 'late', 'excused']),
                  }),
                ),
                page: z.object({ nextCursor: z.string().nullable(), limit: z.number().int() }),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires attendance.record or an applicable read scope.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  reportCard: createRoute({
    method: 'get',
    path: '/{studentId}/report-card',
    operationId: 'getReportCard',
    tags: ['Results'],
    security: bearer,
    'x-required-permissions': ['results.read'],
    'x-rate-limit': { limit: 100, periodSeconds: 60 },
    request: {
      params: z.object({ studentId: z.string().uuid() }),
      query: z.object({ termId: z.string().uuid() }),
    },
    responses: {
      200: {
        description: 'Student report card.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                studentId: z.string().uuid(),
                termId: z.string().uuid(),
                subjects: z.array(
                  z.object({
                    name: z.string(),
                    score: z.number(),
                    maximumScore: z.number(),
                    grade: z.string(),
                  }),
                ),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires results.read and an applicable student scope.'),
      404: errorResponse('Report card not found.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  corePortalWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getCorePortalWorkspace',
    tags: ['Core Portal'],
    security: bearer,
    summary: 'Load the tenant-scoped working set for Milestone 3 modules.',
    'x-required-permissions': ['students.read'],
    'x-rate-limit': { limit: 60, periodSeconds: 60 },
    responses: {
      200: {
        description: 'Core portal workspace.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                students: z.array(z.record(z.string(), z.unknown())),
                staff: z.array(z.record(z.string(), z.unknown())),
                attendance: z.array(z.record(z.string(), z.unknown())),
                assessments: z.array(z.record(z.string(), z.unknown())),
                scores: z.array(z.record(z.string(), z.unknown())),
                releases: z.array(z.record(z.string(), z.unknown())),
                feeDefinitions: z.array(z.record(z.string(), z.unknown())),
                invoices: z.array(z.record(z.string(), z.unknown())),
                payments: z.array(z.record(z.string(), z.unknown())),
                manualTransfers: z.array(z.record(z.string(), z.unknown())),
                receipts: z.array(z.record(z.string(), z.unknown())),
                resultWorkflows: z.array(z.record(z.string(), z.unknown())),
                resultWorkflowEvents: z.array(z.record(z.string(), z.unknown())),
                resultSummaries: z.array(z.record(z.string(), z.unknown())),
                resultPromotionRules: z.array(z.record(z.string(), z.unknown())),
                resultComponentSettings: z.array(z.record(z.string(), z.unknown())),
                resultSessionWeightSettings: z.array(z.record(z.string(), z.unknown())),
                resultScoreImports: z.array(z.record(z.string(), z.unknown())),
                adjustments: z.array(z.record(z.string(), z.unknown())),
                guardians: z.array(z.record(z.string(), z.unknown())),
                guardianLinks: z.array(z.record(z.string(), z.unknown())),
                accounts: z.array(z.record(z.string(), z.unknown())),
                memberships: z.array(z.record(z.string(), z.unknown())),
                roles: z.array(z.record(z.string(), z.unknown())),
                roleAssignments: z.array(z.record(z.string(), z.unknown())),
                membershipEvents: z.array(z.record(z.string(), z.unknown())),
                myClasses: z.array(z.record(z.string(), z.unknown())),
                myClassAssignments: z.array(z.record(z.string(), z.unknown())),
                mySubjectAssignments: z.array(z.record(z.string(), z.unknown())),
                academicTerms: z.array(z.record(z.string(), z.unknown())),
                academicSubjects: z.array(z.record(z.string(), z.unknown())),
                attendanceCorrections: z.array(z.record(z.string(), z.unknown())),
                parentLearningSummaries: z.array(z.record(z.string(), z.unknown())),
                parentUpcomingWork: z.array(z.record(z.string(), z.unknown())),
                parentOverdueWork: z.array(z.record(z.string(), z.unknown())),
                parentAnnouncements: z.array(z.record(z.string(), z.unknown())),
                parentApplications: z.array(z.record(z.string(), z.unknown())),
                parentOffers: z.array(z.record(z.string(), z.unknown())),
                studentEnrollments: z.array(z.record(z.string(), z.unknown())),
                academicSessions: z.array(z.record(z.string(), z.unknown())),
                studentClassSubjects: z.array(z.record(z.string(), z.unknown())),
                identifierSettings: z.array(z.record(z.string(), z.unknown())),
                identifierProfiles: z.array(z.record(z.string(), z.unknown())),
                paymentSettings: z.record(z.string(), z.unknown()).nullable(),
                payableFees: z.array(z.record(z.string(), z.unknown())),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires access to at least one core portal module.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  executeCorePortalCommand: createRoute({
    method: 'post',
    path: '/commands',
    operationId: 'executeCorePortalCommand',
    tags: ['Core Portal'],
    security: bearer,
    summary: 'Execute one validated, tenant-scoped Milestone 3 operation.',
    'x-required-permissions': ['students.create'],
    'x-rate-limit': { limit: 60, periodSeconds: 60 },
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: CorePortalCommandSchema } },
      },
    },
    responses: {
      200: {
        description: 'Operation completed and audited.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Command validation failed.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('The operation-specific permission is required.'),
      409: errorResponse('The operation conflicts with an existing record.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  initializePayment: createRoute({
    method: 'post',
    path: '/initialize',
    operationId: 'initializePayment',
    tags: ['Payments'],
    security: bearer,
    'x-required-permissions': ['fees.read'],
    'x-idempotency': 'A unique provider reference is generated for each accepted initialization.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              invoiceId: z.string().uuid(),
              email: z.string().email(),
              callbackUrl: z.string().url(),
              amountMinor: z.number().int().positive().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Paystack transaction initialized.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                authorizationUrl: z.string().url(),
                accessCode: z.string(),
                reference: z.string(),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Invoice is not linked to this payer.'),
      409: errorResponse('Invoice is already paid.'),
      502: errorResponse('Payment provider failure.'),
    },
  }),
  verifyPayment: createRoute({
    method: 'post',
    path: '/verify/{reference}',
    operationId: 'verifyPayment',
    tags: ['Payments'],
    security: bearer,
    'x-required-permissions': ['fees.read'],
    'x-idempotency': 'Repeated verification returns the existing successful state.',
    request: { params: z.object({ reference: z.string().min(8).max(160) }) },
    responses: {
      200: {
        description: 'Provider transaction verified.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                reference: z.string(),
                status: z.enum(['initialized', 'successful', 'failed', 'abandoned']),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Requires payments.verify.'),
      404: errorResponse('Payment transaction not found.'),
      409: errorResponse('Provider amount or currency mismatch.'),
      502: errorResponse('Payment provider failure.'),
    },
  }),
  submitManualTransfer: createRoute({
    method: 'post',
    path: '/manual-transfer',
    operationId: 'submitManualTransfer',
    tags: ['Payments'],
    security: bearer,
    'x-required-permissions': ['fees.read'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              invoiceId: z.string().uuid(),
              amountMinor: z.number().int().positive(),
              bankName: z.string().min(2).max(120),
              accountName: z.string().min(2).max(160),
              transferReference: z.string().min(3).max(160),
              transferredAt: z.string().datetime(),
              evidencePath: z.string().max(500).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Transfer submitted for verification.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      401: errorResponse('Authentication required.'),
      403: errorResponse('Invoice is not linked to this payer.'),
      409: errorResponse('Duplicate or invalid transfer.'),
    },
  }),
  reviewManualTransfer: createRoute({
    method: 'post',
    path: '/manual-transfer/review',
    operationId: 'reviewManualTransfer',
    tags: ['Payments'],
    security: bearer,
    'x-required-permissions': ['payments.verify'],
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              submissionId: z.string().uuid(),
              decision: z.enum(['verified', 'rejected']),
              note: z.string().max(1000).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Transfer reviewed, audited and receipted when verified.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      401: errorResponse('Authentication required.'),
      403: errorResponse('Finance verification permission required.'),
      409: errorResponse('Transfer was already reviewed.'),
    },
  }),
  platformStudioWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getPlatformStudioWorkspace',
    tags: ['Platform Studio'],
    security: bearer,
    summary: 'Load the permission-filtered developer and platform operations workspace.',
    responses: {
      200: {
        description: 'Platform operations workspace.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                schools: z.array(z.record(z.string(), z.unknown())),
                domains: z.array(z.record(z.string(), z.unknown())),
                features: z.array(z.record(z.string(), z.unknown())),
                entitlements: z.array(z.record(z.string(), z.unknown())),
                operatorAssignments: z.array(z.record(z.string(), z.unknown())),
                operatorRoles: z.array(z.record(z.string(), z.unknown())),
                accounts: z.array(z.record(z.string(), z.unknown())),
                auditEvents: z.array(z.record(z.string(), z.unknown())),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Platform operator scope and platform.schools.read are required.'),
    },
  }),
  executePlatformStudioCommand: createRoute({
    method: 'post',
    path: '/commands',
    operationId: 'executePlatformStudioCommand',
    tags: ['Platform Studio'],
    security: bearer,
    summary: 'Execute an authorized and audited platform operation.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: PlatformStudioCommandSchema } },
      },
    },
    responses: {
      200: {
        description: 'Platform operation completed and audited.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Platform command validation failed.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Platform operator permission is required.'),
      409: errorResponse('Operation would violate a platform safety invariant.'),
    },
  }),
  applicantWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getApplicantWorkspace',
    tags: ['Applicant Portal'],
    security: bearer,
    summary: 'Load the authenticated applicant aggregate linked to the current account.',
    'x-required-permissions': ['applicant.self.read'],
    responses: {
      200: {
        description: 'Applicant application, relationships, documents, timeline and payments.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                application: z.object({
                  id: z.string().uuid(),
                  applicationNumber: z.string(),
                  applicantName: z.string(),
                  email: z.string().nullable(),
                  phone: z.string().nullable(),
                  entryYear: z.string().nullable(),
                  status: ApplicantStatusSchema,
                  submittedAt: z.string().nullable(),
                  updatedAt: z.string(),
                  formData: z.record(z.string(), z.unknown()),
                }),
                guardians: z.array(z.record(z.string(), z.unknown())),
                documents: z.array(z.record(z.string(), z.unknown())),
                statusHistory: z.array(z.record(z.string(), z.unknown())),
                payments: z.array(z.record(z.string(), z.unknown())),
                offers: z.array(z.record(z.string(), z.unknown())),
                entranceAssignments: z.array(z.record(z.string(), z.unknown())),
                entranceQuestions: z.array(z.record(z.string(), z.unknown())),
                entranceAttempts: z.array(z.record(z.string(), z.unknown())),
                entranceAnswers: z.array(z.record(z.string(), z.unknown())),
                nextActions: z.array(
                  z.object({ code: z.string(), label: z.string(), description: z.string() }),
                ),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Applicant membership is required.'),
      404: errorResponse('No application is linked to this account.'),
    },
  }),
  executeApplicantCommand: createRoute({
    method: 'post',
    path: '/commands',
    operationId: 'executeApplicantCommand',
    tags: ['Applicant Portal'],
    security: bearer,
    summary: 'Update the current applicant aggregate within its allowed lifecycle.',
    'x-required-permissions': ['applicant.self.read'],
    request: {
      body: { required: true, content: { 'application/json': { schema: ApplicantCommandSchema } } },
    },
    responses: {
      200: {
        description: 'Applicant aggregate updated.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Applicant command validation failed.'),
      403: errorResponse('Applicant membership is required.'),
      409: errorResponse('The application lifecycle does not allow this operation.'),
    },
  }),
  completePlatformWorkspace: createRoute({
    method: 'get',
    path: '/',
    operationId: 'getCompletePlatformWorkspace',
    tags: ['Complete Platform'],
    security: bearer,
    summary: 'Load permission-filtered Milestone 4 resources for the resolved tenant.',
    responses: {
      200: {
        description: 'Complete school platform workspace.',
        content: {
          'application/json': {
            schema: success(
              z.object({
                admissions: z.array(z.record(z.string(), z.unknown())),
                admissionPayments: z.array(z.record(z.string(), z.unknown())),
                admissionOffers: z.array(z.record(z.string(), z.unknown())),
                guardians: z.array(z.record(z.string(), z.unknown())),
                parentLinks: z.array(z.record(z.string(), z.unknown())),
                conversations: z.array(z.record(z.string(), z.unknown())),
                messages: z.array(z.record(z.string(), z.unknown())),
                messageRecipients: z.array(z.record(z.string(), z.unknown())),
                conversationParticipants: z.array(z.record(z.string(), z.unknown())),
                libraryBorrowers: z.array(z.record(z.string(), z.unknown())),
                exams: z.array(z.record(z.string(), z.unknown())),
                examQuestions: z.array(z.record(z.string(), z.unknown())),
                examAttempts: z.array(z.record(z.string(), z.unknown())),
                lessons: z.array(z.record(z.string(), z.unknown())),
                classrooms: z.array(z.record(z.string(), z.unknown())),
                classroomMemberships: z.array(z.record(z.string(), z.unknown())),
                lessonResources: z.array(z.record(z.string(), z.unknown())),
                lessonRevisions: z.array(z.record(z.string(), z.unknown())),
                lessonWorkflowEvents: z.array(z.record(z.string(), z.unknown())),
                streamPosts: z.array(z.record(z.string(), z.unknown())),
                streamComments: z.array(z.record(z.string(), z.unknown())),
                assignmentExtensions: z.array(z.record(z.string(), z.unknown())),
                assignmentAttachments: z.array(z.record(z.string(), z.unknown())),
                assignmentEvents: z.array(z.record(z.string(), z.unknown())),
                gradeItems: z.array(z.record(z.string(), z.unknown())),
                classroomGrades: z.array(z.record(z.string(), z.unknown())),
                quizzes: z.array(z.record(z.string(), z.unknown())),
                quizQuestions: z.array(z.record(z.string(), z.unknown())),
                quizAttempts: z.array(z.record(z.string(), z.unknown())),
                quizAnswers: z.array(z.record(z.string(), z.unknown())),
                formalGradeExports: z.array(z.record(z.string(), z.unknown())),
                assignments: z.array(z.record(z.string(), z.unknown())),
                assignmentSubmissions: z.array(z.record(z.string(), z.unknown())),
                books: z.array(z.record(z.string(), z.unknown())),
                loans: z.array(z.record(z.string(), z.unknown())),
                auditEvents: z.array(z.record(z.string(), z.unknown())),
                entranceExams: z.array(z.record(z.string(), z.unknown())),
                entranceVersions: z.array(z.record(z.string(), z.unknown())),
                entranceQuestions: z.array(z.record(z.string(), z.unknown())),
                entranceSchedules: z.array(z.record(z.string(), z.unknown())),
                entranceAssignments: z.array(z.record(z.string(), z.unknown())),
                entranceAttempts: z.array(z.record(z.string(), z.unknown())),
                entranceIntegritySignals: z.array(z.record(z.string(), z.unknown())),
                entranceAccommodations: z.array(z.record(z.string(), z.unknown())),
                classes: z.array(z.record(z.string(), z.unknown())),
                academicSessions: z.array(z.record(z.string(), z.unknown())),
                schools: z.array(z.record(z.string(), z.unknown())),
              }),
            ),
          },
        },
      },
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('A Milestone 4 read permission is required.'),
    },
  }),
  submitPublicContact: createRoute({
    method: 'post',
    path: '/contact',
    operationId: 'submitPublicContact',
    tags: ['Public'],
    summary: 'Submit a public school contact enquiry.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              name: z.string().trim().min(2).max(120),
              email: z.string().email(),
              message: z.string().trim().min(10).max(2000),
            }),
          },
        },
      },
    },
    responses: {
      202: {
        description: 'Contact enquiry accepted.',
        content: {
          'application/json': { schema: success(z.object({ accepted: z.literal(true) })) },
        },
      },
      400: errorResponse('Contact input is invalid.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  submitPublicAdmission: createRoute({
    method: 'post',
    path: '/admissions',
    operationId: 'submitPublicAdmission',
    tags: ['Public'],
    summary: 'Submit a public tenant admission enquiry.',
    request: {
      body: {
        required: true,
        content: {
          'application/json': {
            schema: z.object({
              applicantName: z.string().trim().min(2).max(200),
              email: z.string().email(),
              entryYear: z.string().regex(/^20\d{2}$/),
              phone: z.string().max(30).optional(),
              formData: z.record(z.string(), z.string().max(4000)).optional(),
              documents: z
                .array(
                  z.object({
                    field: z.enum(['studentPhoto', 'birthCertificate', 'previousClassResult']),
                    name: z.string().min(1).max(180),
                    type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
                    base64: z.string().max(7_000_000),
                  }),
                )
                .max(3)
                .optional(),
            }),
          },
        },
      },
    },
    responses: {
      202: {
        description: 'Admission enquiry accepted.',
        content: {
          'application/json': {
            schema: success(z.object({ applicationNumber: z.string(), accessPin: z.string() })),
          },
        },
      },
      400: errorResponse('Admission input is invalid.'),
      429: errorResponse('Rate limit exceeded.'),
    },
  }),
  executeCompletePlatformCommand: createRoute({
    method: 'post',
    path: '/commands',
    operationId: 'executeCompletePlatformCommand',
    tags: ['Complete Platform'],
    security: bearer,
    summary: 'Execute one validated, tenant-scoped Milestone 4 operation.',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: CompletePlatformCommandSchema } },
      },
    },
    responses: {
      200: {
        description: 'Operation completed and audited.',
        content: { 'application/json': { schema: success(z.record(z.string(), z.unknown())) } },
      },
      400: errorResponse('Command validation failed.'),
      401: errorResponse('Bearer token missing or invalid.'),
      403: errorResponse('Operation permission is required.'),
      503: errorResponse('Lesson generation is not configured.'),
      409: errorResponse('Operation conflicts with an existing record.'),
    },
  }),
};
