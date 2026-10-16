import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { failure, success } from './api/responses/respond';
import { routes } from './api/contract';
import { bindingsAreConfigured, type Bindings } from './config/bindings';
import { isAppError } from './errors/app-error';
import { authenticationMiddleware } from './middleware/authentication';
import { corsMiddleware } from './middleware/cors';
import { loggingMiddleware } from './middleware/logging';
import { requirePermission } from './middleware/permission';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { requestIdMiddleware } from './middleware/request-id';
import { schoolMembershipMiddleware } from './middleware/school-membership';
import { securityHeadersMiddleware } from './middleware/security-headers';
import { tenantResolutionMiddleware } from './middleware/tenant-resolution';
import { trustedHostMiddleware } from './middleware/trusted-host';
import type { BackendServices } from './services/contracts';
import { defaultServices } from './services/default-services';
import { getPublicBootstrap } from './services/bootstrap-service';
import { ConfigurationStudioService } from './services/configuration-studio.service';
import { AcademicStructureService } from './services/academic-structure.service';
import { DomainLifecycleService } from './services/domain-provisioning.service';
import { cloudflareCustomHostnames } from './integrations/cloudflare/custom-hostnames';
import { BackgroundJobService } from './services/background-jobs.service';
import { issuePreviewToken, verifyPreviewToken } from './configuration/preview-token';
import type { AppVariables } from './types/context';
import { normalizedRoute, recordMetric, structuredLog } from './observability/telemetry';
import { CorePortalService } from './services/core-portal.service';
import { PaymentService } from './services/payments.service';
import { verifyPaystackSignature } from './integrations/paystack/client';
import { CompletePlatformService } from './services/complete-platform.service';
import { PlatformStudioService } from './services/platform-studio.service';
import { ApplicantService } from './services/applicant.service';
import { CommunicationsService } from './services/communications.service';

type AppEnvironment = { Bindings: Bindings; Variables: AppVariables };

export function createApp(services: BackendServices = defaultServices) {
  const app = new OpenAPIHono<AppEnvironment>();

  app.use('*', requestIdMiddleware);
  app.use('*', trustedHostMiddleware);
  app.use('*', securityHeadersMiddleware);
  app.use('*', corsMiddleware(services.tenantDirectory));
  app.use('*', rateLimitMiddleware);
  app.use('*', loggingMiddleware);

  app.openapi(routes.live, (context) => success(context, { status: 'ok' as const }, 200));
  app.openapi(routes.ready, async (context) => {
    if (!bindingsAreConfigured(context.env)) {
      return failure(context, {
        code: 'SERVICE_NOT_READY',
        message: 'A required service is unavailable.',
        status: 503,
      });
    }
    await services.readinessProbe.check(context.env);
    return success(context, { status: 'ready' as const }, 200);
  });

  const publicApi = new OpenAPIHono<AppEnvironment>();
  publicApi.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  publicApi.openapi(routes.bootstrap, async (context) => {
    const startedAt = performance.now();
    const tenant = context.get('tenant');
    const bootstrap = await getPublicBootstrap(context.env, services.bootstrapDirectory, tenant);
    context.header('X-Tenant-Cache', bootstrap.cacheStatus);
    recordMetric(context.env, {
      type: 'cache',
      environment: context.env.APP_ENV,
      schoolId: tenant.schoolId,
      hostname: tenant.hostname,
      outcome: bootstrap.cacheStatus.toLowerCase(),
      value: 1,
    });
    context.header(
      'Server-Timing',
      `tenant-bootstrap;dur=${(performance.now() - startedAt).toFixed(1)}`,
    );
    return success(
      context,
      { ...bootstrap.value, navigation: [...bootstrap.value.navigation] },
      200,
    );
  });
  publicApi.openapi(routes.submitPublicContact, async (context) =>
    success(
      context,
      await services.completePlatform.submitContact(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...context.req.valid('json'),
      }),
      202,
    ),
  );
  publicApi.openapi(routes.submitPublicAdmission, async (context) =>
    success(
      context,
      await services.completePlatform.submitAdmission(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...context.req.valid('json'),
      }),
      202,
    ),
  );
  const paymentAccess = z.object({
    applicationNumber: z.string().min(8).max(80),
    accessPin: z.string().regex(/^\d{6}$/),
  });
  publicApi.post('/admissions/payment/initialize', async (context) => {
    const parsed = paymentAccess
      .extend({ callbackUrl: z.string().url() })
      .parse(await context.req.json());
    return success(
      context,
      await services.completePlatform.initializeAdmissionPayment(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...parsed,
      }),
      200,
    );
  });
  publicApi.post('/admissions/payment/bank-transfer', async (context) => {
    const parsed = paymentAccess
      .extend({ transferReference: z.string().trim().min(3).max(120) })
      .parse(await context.req.json());
    return success(
      context,
      await services.completePlatform.recordAdmissionBankTransfer(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...parsed,
      }),
      202,
    );
  });
  publicApi.post('/admissions/payment/verify', async (context) => {
    const parsed = paymentAccess
      .extend({ reference: z.string().min(8).max(100) })
      .parse(await context.req.json());
    return success(
      context,
      await services.completePlatform.verifyAdmissionPayment(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...parsed,
      }),
      200,
    );
  });
  publicApi.post('/admissions/status', async (context) => {
    const parsed = z
      .object({
        identifier: z
          .string()
          .trim()
          .min(5)
          .max(254)
          .regex(/^[A-Za-z0-9@._+-]+$/),
        accessPin: z.string().regex(/^\d{6}$/),
      })
      .parse(await context.req.json());
    return success(
      context,
      await services.completePlatform.getAdmissionStatus(context.env, {
        schoolId: context.get('tenant').schoolId,
        ...parsed,
      }),
      200,
    );
  });
  publicApi.get('/payments/receipts/:receiptId/verify', async (context) => {
    const receiptId = z.string().uuid().parse(context.req.param('receiptId'));
    const receipt = await new PaymentService(services.payments).verifyReceipt(
      context.env,
      context.get('tenant').schoolId,
      receiptId,
    );
    if (!receipt)
      return context.html(
        '<!doctype html><title>Receipt not verified</title><main><h1>Receipt not verified</h1><p>No matching receipt was found for this school.</p></main>',
        404,
      );
    const escape = (value: string) =>
      value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    context.header('Cache-Control', 'no-store');
    return context.html(
      `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verified receipt</title><style>body{margin:0;background:#f3f6f4;font:16px system-ui;color:#17231f}main{max-width:560px;margin:8vh auto;padding:36px;background:white;border-radius:20px;box-shadow:0 18px 60px #173c2d22}.mark{width:64px;height:64px;border-radius:50%;display:grid;place-items:center;background:#1fa965;color:white;font-size:36px;margin:auto}h1{text-align:center;color:#176044}.sub{text-align:center;color:#68736f}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:28px}.grid div{padding:14px;background:#f4f8f6;border-radius:10px}.grid span{display:block;color:#73807a;font-size:12px}.amount{text-align:center;font-size:30px;font-weight:800;color:#176044}@media(max-width:600px){main{margin:0;min-height:100vh;border-radius:0}.grid{grid-template-columns:1fr}}</style><main><div class="mark">✓</div><h1>Payment verified</h1><p class="sub">${escape(receipt.schoolName)}</p><div class="grid"><div><span>Receipt</span>${escape(receipt.receiptNumber)}</div><div><span>Student</span>${escape(receipt.studentName)}</div><div><span>Fee</span>${escape(receipt.feeName)}</div><div><span>Installment</span>${receipt.installmentNumber} of ${receipt.maximumInstallments}</div><div><span>Payment method</span>${escape(receipt.provider)}</div><div><span>Reference</span>${escape(receipt.reference)}</div><div><span>Issued</span>${escape(new Date(receipt.issuedAt).toLocaleString())}</div><div><span>Total paid to date</span>${escape(receipt.currency)} ${(receipt.totalPaidMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div><div><span>Balance after payment</span>${escape(receipt.currency)} ${(receipt.balanceAfterMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</div></div><p class="amount">${escape(receipt.currency)} ${(receipt.amountMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}</p><p class="sub">${receipt.balanceAfterMinor === 0 ? 'Paid in full' : 'Partial payment'} · This receipt exists in the school's payment records.</p></main>`,
    );
  });
  app.route('/v1/public', publicApi);
  const telemetry = new OpenAPIHono<AppEnvironment>();
  telemetry.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  telemetry.openapi(routes.reportBrowserError, (context) => {
    const tenant = context.get('tenant');
    const report = context.req.valid('json');
    structuredLog('error', {
      type: 'frontend_error',
      requestId: context.get('requestId'),
      environment: context.env.APP_ENV,
      hostname: tenant.hostname,
      schoolId: tenant.schoolId,
      route: normalizedRoute(report.route),
      errorCode: report.errorName,
      operation: report.component,
    });
    recordMetric(context.env, {
      type: 'frontend_error',
      environment: context.env.APP_ENV,
      schoolId: tenant.schoolId,
      hostname: tenant.hostname,
      route: normalizedRoute(report.route),
      errorCode: report.errorName,
      operation: report.kind,
      outcome: 'failure',
    });
    return success(context, { accepted: true as const }, 202);
  });
  app.route('/v1/telemetry', telemetry);
  app.openapi(routes.configurationPreview, async (context) => {
    const { schoolId, versionId } = context.req.valid('param');
    await verifyPreviewToken(context.env, context.req.valid('query').token, {
      schoolId,
      versionId,
    });
    context.header('Cache-Control', 'private, no-store');
    context.header('X-Robots-Tag', 'noindex, nofollow');
    return success(
      context,
      await services.configurationStudio.loadPreview(context.env, schoolId, versionId),
      200,
    );
  });

  const protectedApi = new OpenAPIHono<AppEnvironment>();
  protectedApi.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  protectedApi.use('*', authenticationMiddleware(services.tokenVerifier));
  protectedApi.use('*', schoolMembershipMiddleware(services.membershipDirectory));
  protectedApi.openapi(routes.currentUser, (context) => {
    const auth = context.get('auth');
    return success(
      context,
      {
        userId: auth.userId,
        schoolId: auth.schoolId,
        roles: [...(auth.roleCodes ?? auth.roles)],
        permissions: [...auth.permissions],
        scope: auth.scope.kind,
        membership: {
          id: auth.membershipId ?? null,
          kind: auth.membershipKind ?? null,
          lifecycleState: auth.lifecycleState ?? null,
        },
        resourceScopes: auth.resourceScopes ?? {},
        supportSession: auth.supportSession ?? null,
      },
      200,
    );
  });
  app.route('/v1/auth', protectedApi);

  const portalApi = new OpenAPIHono<AppEnvironment>();
  portalApi.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  portalApi.use('*', authenticationMiddleware(services.tokenVerifier));
  portalApi.use('*', schoolMembershipMiddleware(services.membershipDirectory));
  portalApi.openapi(routes.portalBootstrap, async (context) => {
    const auth = context.get('auth');
    const details = await services.bootstrapDirectory.loadPortal(
      context.env,
      context.get('tenant'),
      auth.userId,
    );
    context.header('Cache-Control', 'private, no-store');
    return success(
      context,
      {
        ...details,
        navigation: [...details.navigation],
        roles: [...(auth.roleCodes ?? auth.roles)],
        permissions: [...auth.permissions],
        membership: {
          id: auth.membershipId ?? null,
          kind: auth.membershipKind ?? null,
          lifecycleState: auth.lifecycleState ?? null,
        },
        resourceScopes: auth.resourceScopes ?? {},
        supportSession: auth.supportSession ?? null,
      },
      200,
    );
  });
  app.route('/v1/portal', portalApi);

  const platformPublic = new OpenAPIHono<AppEnvironment>();
  platformPublic.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  platformPublic.openapi(routes.platformPublicBootstrap, (context) => {
    if (context.get('tenant').domainType !== 'platform')
      return failure(context, {
        code: 'TENANT_NOT_FOUND',
        message: 'This is not a configured platform domain.',
        status: 404,
      });
    const tenant = context.get('tenant');
    return success(
      context,
      {
        tenant: {
          id: tenant.schoolId,
          name: 'Soliventa Learn Platform',
          primaryDomain: tenant.hostname,
        },
        branding: {
          logo: { url: null },
          colors: { primary: '#103f38', secondary: '#61716c', accent: '#d28a35' },
          fonts: { heading: 'Georgia', body: 'Inter' },
          favicon: { url: null },
        },
      },
      200,
    );
  });
  app.route('/v1/platform', platformPublic);

  const platformPortal = new OpenAPIHono<AppEnvironment>();
  platformPortal.use('*', tenantResolutionMiddleware(services.tenantDirectory));
  platformPortal.use('*', authenticationMiddleware(services.tokenVerifier));
  platformPortal.use('*', schoolMembershipMiddleware(services.membershipDirectory));
  platformPortal.openapi(routes.platformPortalBootstrap, async (context) => {
    const tenant = context.get('tenant');
    const auth = context.get('auth');
    if (tenant.domainType !== 'platform' || auth.scope.kind !== 'platform')
      return failure(context, {
        code: 'PERMISSION_DENIED',
        message: 'Platform operator access is required.',
        status: 403,
      });
    const details = await services.bootstrapDirectory.loadPortal(context.env, tenant, auth.userId);
    context.header('Cache-Control', 'private, no-store');
    return success(
      context,
      {
        ...details,
        navigation: [...details.navigation],
        roles: [...(auth.roleCodes ?? auth.roles)],
        permissions: [...auth.permissions],
        membership: {
          id: auth.membershipId ?? null,
          kind: auth.membershipKind ?? null,
          lifecycleState: auth.lifecycleState ?? null,
        },
        resourceScopes: auth.resourceScopes ?? {},
        supportSession: auth.supportSession ?? null,
      },
      200,
    );
  });
  app.route('/v1/platform', platformPortal);

  const protectedGroup = () => {
    const group = new OpenAPIHono<AppEnvironment>();
    group.use('*', tenantResolutionMiddleware(services.tenantDirectory));
    group.use('*', authenticationMiddleware(services.tokenVerifier));
    group.use('*', schoolMembershipMiddleware(services.membershipDirectory));
    return group;
  };

  const studioService = new ConfigurationStudioService(services.configurationStudio);
  const jobService = new BackgroundJobService(services.jobs);
  const configuration = protectedGroup();
  configuration.get('/', requirePermission('school.configure'));
  configuration.openapi(routes.configurationWorkspace, async (context) => {
    const workspace = await studioService.workspace(context.env, context.get('auth'));
    return success(context, { ...workspace, versions: [...workspace.versions] }, 200);
  });
  configuration.post('/assets', requirePermission('school.configure'));
  configuration.openapi(routes.uploadConfigurationAsset, async (context) => {
    const body = context.req.valid('json');
    return success(
      context,
      await studioService.uploadAsset(context.env, context.get('auth'), body),
      201,
    );
  });
  configuration.put('/draft', requirePermission('school.configure'));
  configuration.openapi(routes.saveConfigurationDraft, async (context) => {
    const body = context.req.valid('json');
    return success(
      context,
      await studioService.save(context.env, context.get('auth'), {
        configuration: body.configuration,
        ...(body.versionId ? { versionId: body.versionId } : {}),
      }),
      200,
    );
  });
  configuration.post('/:versionId/publish', requirePermission('school.configure'));
  configuration.openapi(routes.publishConfiguration, async (context) => {
    const auth = context.get('auth');
    const version = await studioService.publish(
      context.env,
      auth,
      context.req.valid('param').versionId,
    );
    if (context.env.JOB_QUEUE)
      await jobService.enqueue(context.env, auth, {
        traceId: context.get('requestId'),
        operation: 'cache.warm',
        idempotencyKey: `cache-warm:publish:${version.id}`,
        resource: { type: 'tenant_configuration', id: version.id },
      });
    return success(context, version, 200);
  });
  configuration.post('/:versionId/rollback', requirePermission('school.configure'));
  configuration.openapi(routes.rollbackConfiguration, async (context) => {
    const auth = context.get('auth');
    const version = await studioService.rollback(
      context.env,
      auth,
      context.req.valid('param').versionId,
    );
    if (context.env.JOB_QUEUE)
      await jobService.enqueue(context.env, auth, {
        traceId: context.get('requestId'),
        operation: 'cache.warm',
        idempotencyKey: `cache-warm:rollback:${version.id}`,
        resource: { type: 'tenant_configuration', id: version.id },
      });
    return success(context, version, 200);
  });
  configuration.post('/:versionId/preview-token', requirePermission('school.configure'));
  configuration.openapi(routes.issueConfigurationPreview, async (context) => {
    const auth = context.get('auth');
    const versionId = context.req.valid('param').versionId;
    const preview = await issuePreviewToken(context.env, {
      schoolId: auth.schoolId,
      versionId,
      actorId: auth.userId,
    });
    const origin = context.env.PREVIEW_ORIGIN ?? 'http://preview.soliventa.localhost';
    return success(
      context,
      {
        ...preview,
        url: `${origin}/${auth.schoolId}/${versionId}?token=${encodeURIComponent(preview.token)}`,
      },
      200,
    );
  });
  app.route('/v1/configuration', configuration);

  const domainService = new DomainLifecycleService(
    services.domainDirectory,
    cloudflareCustomHostnames,
  );
  const domains = protectedGroup();
  domains.get('/', requirePermission('domains.manage'));
  domains.openapi(routes.listDomains, async (context) =>
    success(context, [...(await domainService.list(context.env, context.get('auth')))], 200),
  );
  domains.post('/defaults', requirePermission('domains.manage'));
  domains.openapi(routes.provisionDefaultDomains, async (context) =>
    success(
      context,
      [...(await domainService.provisionDefaults(context.env, context.get('auth')))],
      200,
    ),
  );
  domains.post('/custom', requirePermission('domains.manage'));
  domains.openapi(routes.createCustomDomain, async (context) =>
    success(
      context,
      await domainService.create(context.env, context.get('auth'), context.req.valid('json')),
      201,
    ),
  );
  domains.post('/:domainId/refresh', requirePermission('domains.manage'));
  domains.openapi(routes.refreshDomain, async (context) =>
    success(
      context,
      await jobService.enqueue(context.env, context.get('auth'), {
        traceId: context.get('requestId'),
        operation: 'domain.verify',
        idempotencyKey: context.req.valid('header')['Idempotency-Key'],
        resource: { type: 'tenant_domain', id: context.req.valid('param').domainId },
      }),
      202,
    ),
  );
  domains.put('/:domainId/primary', requirePermission('domains.manage'));
  domains.openapi(routes.setPrimaryDomain, async (context) =>
    success(
      context,
      await domainService.setPrimary(
        context.env,
        context.get('auth'),
        context.req.valid('param').domainId,
      ),
      200,
    ),
  );
  domains.delete('/:domainId', requirePermission('domains.manage'));
  domains.openapi(routes.removeDomain, async (context) =>
    success(
      context,
      await domainService.remove(
        context.env,
        context.get('auth'),
        context.req.valid('param').domainId,
      ),
      200,
    ),
  );
  app.route('/v1/domains', domains);

  const jobs = protectedGroup();
  jobs.openapi(routes.getJob, async (context) =>
    success(
      context,
      await jobService.get(context.env, context.get('auth'), context.req.valid('param').jobId),
      200,
    ),
  );
  app.route('/v1/jobs', jobs);

  const academicService = new AcademicStructureService(services.academicStructure);
  const academic = protectedGroup();
  academic.get('/', requirePermission('academic.read'));
  academic.openapi(routes.academicWorkspace, async (context) => {
    const value = await academicService.workspace(context.env, context.get('auth'));
    return success(
      context,
      {
        classes: [...value.classes],
        arms: [...value.arms],
        subjects: [...value.subjects],
        sessions: [...value.sessions],
        terms: [...value.terms],
        classSubjects: [...value.classSubjects],
        classTeachers: [...value.classTeachers],
        teacherAssignments: [...value.teacherAssignments],
        students: [...value.students],
        staff: [...value.staff],
        enrollments: [...value.enrollments],
        templates: [...value.templates],
      },
      200,
    );
  });
  academic.put('/records', requirePermission('academic.manage'));
  academic.openapi(routes.saveAcademicRecord, async (context) =>
    success(
      context,
      await academicService.save(context.env, context.get('auth'), context.req.valid('json')),
      200,
    ),
  );
  academic.delete('/records/:entity/:id', requirePermission('academic.manage'));
  academic.openapi(routes.deleteAcademicRecord, async (context) => {
    const { entity, id } = context.req.valid('param');
    await academicService.remove(context.env, context.get('auth'), entity, id);
    return success(context, { deleted: true as const }, 200);
  });
  academic.put('/classes/:classId/subjects', requirePermission('academic.manage'));
  academic.openapi(routes.replaceClassSubjects, async (context) => {
    await academicService.replaceClassSubjects(
      context.env,
      context.get('auth'),
      context.req.valid('param').classId,
      context.req.valid('json').subjectIds,
    );
    return success(context, { updated: true as const }, 200);
  });
  academic.put('/classes/:classId/teacher', requirePermission('academic.manage'));
  academic.openapi(routes.assignClassTeacher, async (context) => {
    await academicService.assignClassTeacher(
      context.env,
      context.get('auth'),
      context.req.valid('param').classId,
      context.req.valid('json').teacherUserId,
    );
    return success(context, { updated: true as const }, 200);
  });
  academic.put('/teachers/:teacherUserId/assignments', requirePermission('academic.manage'));
  academic.openapi(routes.replaceTeacherAssignments, async (context) => {
    const params = context.req.valid('param');
    await academicService.replaceTeacherAssignments(
      context.env,
      context.get('auth'),
      params.teacherUserId,
      context.req.valid('json').assignments,
    );
    return success(context, { updated: true as const }, 200);
  });
  academic.put('/enrollments', requirePermission('academic.manage'));
  academic.openapi(routes.manageStudentEnrollment, async (context) => {
    const record = await academicService.manageEnrollment(
      context.env,
      context.get('auth'),
      context.req.valid('json'),
    );
    return success(context, record, 200);
  });
  academic.post('/promotions', requirePermission('students.promote'));
  academic.openapi(routes.bulkPromoteStudents, async (context) => {
    const result = await academicService.bulkPromote(
      context.env,
      context.get('auth'),
      context.req.valid('json'),
    );
    return success(context, result, 200);
  });
  app.route('/v1/academic', academic);

  const corePortalService = new CorePortalService(services.corePortal);
  const students = protectedGroup();
  students.get('/', requirePermission('students.read'));
  students.openapi(routes.listStudents, async (context) => {
    const { limit } = context.req.valid('query');
    const workspace = await corePortalService.workspace(context.env, context.get('auth'));
    const items = workspace.students.slice(0, limit).map((student) => ({
      id: String(student.id),
      admissionNumber: String(student.admission_number),
      firstName: typeof student.first_name === 'string' ? student.first_name : '',
      lastName: typeof student.last_name === 'string' ? student.last_name : '',
    }));
    return success(context, { items, page: { nextCursor: null, limit } }, 200);
  });
  students.post('/', requirePermission('students.create'));
  students.openapi(routes.createStudent, async (context) => {
    const value = context.req.valid('json');
    const created = await corePortalService.execute(context.env, context.get('auth'), {
      operation: 'student.create',
      ...value,
    });
    return success(
      context,
      {
        id: String(created.id),
        admissionNumber: String(created.admission_number),
        firstName: String(created.first_name),
        lastName: String(created.last_name),
      },
      201,
    );
  });
  app.route('/v1/students', students);

  const staff = protectedGroup();
  staff.get('/', requirePermission('staff.manage'));
  staff.openapi(routes.listStaff, async (context) => {
    const { limit } = context.req.valid('query');
    const workspace = await corePortalService.workspace(context.env, context.get('auth'));
    const items = workspace.staff.slice(0, limit).map((member) => ({
      userId: String(member.user_id),
      roles: Array.isArray(member.roles)
        ? member.roles.filter((role): role is string => typeof role === 'string')
        : [],
    }));
    return success(context, { items, page: { nextCursor: null, limit } }, 200);
  });
  app.route('/v1/staff', staff);

  const attendance = protectedGroup();
  attendance.get('/', requirePermission('attendance.record'));
  attendance.openapi(routes.listAttendance, async (context) => {
    const { limit } = context.req.valid('query');
    const workspace = await corePortalService.workspace(context.env, context.get('auth'));
    const items = workspace.attendance.slice(0, limit).map((record) => ({
      studentId: String(record.student_id),
      date: String(record.attendance_date),
      status: String(record.status) as 'present' | 'absent' | 'late' | 'excused',
    }));
    return success(context, { items, page: { nextCursor: null, limit } }, 200);
  });
  app.route('/v1/attendance', attendance);

  const results = protectedGroup();
  results.get('/:studentId/report-card', requirePermission('results.read'));
  results.openapi(routes.reportCard, async (context) => {
    const { studentId } = context.req.valid('param');
    const { termId } = context.req.valid('query');
    const workspace = await corePortalService.workspace(context.env, context.get('auth'));
    const assessments = new Map(
      workspace.assessments
        .filter((assessment) => String(assessment.term_id) === termId)
        .map((assessment) => [String(assessment.id), assessment]),
    );
    const subjects = workspace.scores
      .filter(
        (score) =>
          String(score.student_id) === studentId && assessments.has(String(score.assessment_id)),
      )
      .map((score) => {
        const assessment = assessments.get(String(score.assessment_id))!;
        const value = Number(score.score);
        const maximumScore = Number(assessment.maximum_score);
        return {
          name: String(assessment.name),
          score: value,
          maximumScore,
          grade: value / maximumScore >= 0.7 ? 'A' : value / maximumScore >= 0.5 ? 'C' : 'F',
        };
      });
    return success(context, { studentId, termId, subjects }, 200);
  });
  app.route('/v1/results', results);

  const paymentService = new PaymentService(services.payments);
  app.post('/v1/payments/paystack/webhook', async (context) => {
    const rawBody = await context.req.raw.clone().text();
    const valid = await verifyPaystackSignature(
      context.env.PAYSTACK_SECRET_KEY,
      rawBody,
      context.req.header('x-paystack-signature'),
    );
    if (!valid)
      return failure(context, {
        code: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Webhook signature is invalid.',
        status: 401,
      });
    const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    if (event.event === 'charge.success' && event.data?.reference) {
      if (event.data.reference.startsWith('ADM-'))
        await services.completePlatform.verifyAdmissionPaymentByReference(
          context.env,
          event.data.reference,
        );
      else await paymentService.verify(context.env, event.data.reference);
    }
    return success(context, { accepted: true as const }, 200);
  });
  const payments = protectedGroup();
  payments.post('/initialize', requirePermission('fees.read'));
  payments.openapi(routes.initializePayment, async (context) =>
    success(
      context,
      await paymentService.initialize(context.env, context.get('auth'), context.req.valid('json')),
      200,
    ),
  );
  payments.post('/verify/:reference', requirePermission('fees.read'));
  payments.openapi(routes.verifyPayment, async (context) =>
    success(
      context,
      await paymentService.verify(
        context.env,
        context.req.valid('param').reference,
        context.get('auth'),
      ),
      200,
    ),
  );
  payments.post('/manual-transfer', requirePermission('fees.read'));
  payments.openapi(routes.submitManualTransfer, async (context) =>
    success(
      context,
      await paymentService.submitManual(
        context.env,
        context.get('auth'),
        context.req.valid('json'),
      ),
      200,
    ),
  );
  payments.post('/manual-transfer/review', requirePermission('payments.verify'));
  payments.openapi(routes.reviewManualTransfer, async (context) =>
    success(
      context,
      await paymentService.reviewManual(
        context.env,
        context.get('auth'),
        context.req.valid('json'),
      ),
      200,
    ),
  );
  app.route('/v1/payments', payments);

  const communicationsService = new CommunicationsService(services.communications);
  const communications = protectedGroup();
  communications.openapi(routes.search, async (context) =>
    success(
      context,
      await communicationsService.search(
        context.env,
        context.get('auth'),
        context.req.valid('query'),
      ),
      200,
    ),
  );
  communications.openapi(routes.notifications, async (context) =>
    success(
      context,
      await communicationsService.notifications(context.env, context.get('auth')),
      200,
    ),
  );
  communications.openapi(routes.readNotification, async (context) =>
    success(
      context,
      await communicationsService.read(
        context.env,
        context.get('auth'),
        context.req.valid('param'),
      ),
      200,
    ),
  );
  communications.openapi(routes.startSupport, async (context) =>
    success(
      context,
      await communicationsService.start(
        context.env,
        context.get('auth'),
        context.req.valid('json'),
      ),
      200,
    ),
  );
  communications.openapi(routes.endSupport, async (context) =>
    success(
      context,
      await communicationsService.end(context.env, context.get('auth'), context.req.valid('param')),
      200,
    ),
  );
  app.route('/v1/communications', communications);

  const corePortal = protectedGroup();
  corePortal.openapi(routes.corePortalWorkspace, async (context) =>
    success(context, await corePortalService.workspace(context.env, context.get('auth')), 200),
  );
  corePortal.openapi(routes.executeCorePortalCommand, async (context) =>
    success(
      context,
      await corePortalService.execute(context.env, context.get('auth'), context.req.valid('json')),
      200,
    ),
  );
  app.route('/v1/core-portal', corePortal);

  const applicantService = new ApplicantService(services.applicant);
  const applicant = protectedGroup();
  applicant.openapi(routes.applicantWorkspace, async (context) =>
    success(context, await applicantService.workspace(context.env, context.get('auth')), 200),
  );
  applicant.openapi(routes.executeApplicantCommand, async (context) =>
    success(
      context,
      await applicantService.execute(context.env, context.get('auth'), context.req.valid('json')),
      200,
    ),
  );
  app.route('/v1/applicant', applicant);

  const completePlatformService = new CompletePlatformService(services.completePlatform);
  const completePlatform = protectedGroup();
  completePlatform.openapi(routes.completePlatformWorkspace, async (context) =>
    success(
      context,
      await completePlatformService.workspace(context.env, context.get('auth')),
      200,
    ),
  );
  completePlatform.openapi(routes.executeCompletePlatformCommand, async (context) => {
    const command = context.req.valid('json');
    if (
      command.operation === 'moderator.school.status' &&
      context.get('tenant').domainType !== 'platform'
    )
      return failure(context, {
        code: 'FORBIDDEN',
        message: 'Moderator operations are available only on the platform domain.',
        status: 403,
      });
    if (
      command.operation === 'lesson.generate' &&
      (!context.env.JOB_QUEUE || !context.env.OPENROUTER_API_KEY)
    )
      return failure(context, {
        code: 'SERVICE_NOT_READY',
        message: 'Lesson generation is not configured.',
        status: 503,
      });
    const result = await completePlatformService.execute(context.env, context.get('auth'), command);
    if (command.operation === 'lesson.generate') {
      const job = await jobService.enqueue(context.env, context.get('auth'), {
        traceId: context.get('requestId'),
        operation: 'lesson.generate',
        idempotencyKey: String(result.id),
        resource: { type: 'lesson_generation', id: String(result.id) },
      });
      return success(context, { ...result, jobId: job.id, status: job.status }, 200);
    }
    return success(context, result, 200);
  });
  app.route('/v1/complete-platform', completePlatform);

  const platformStudioService = new PlatformStudioService(services.platformStudio);
  const platformStudio = protectedGroup();
  platformStudio.openapi(routes.platformStudioWorkspace, async (context) => {
    if (context.get('tenant').domainType !== 'platform')
      return failure(context, {
        code: 'FORBIDDEN',
        message: 'Platform Studio is available only on the platform domain.',
        status: 403,
      });
    return success(
      context,
      await platformStudioService.workspace(context.env, context.get('auth')),
      200,
    );
  });
  platformStudio.openapi(routes.executePlatformStudioCommand, async (context) => {
    if (context.get('tenant').domainType !== 'platform')
      return failure(context, {
        code: 'FORBIDDEN',
        message: 'Platform Studio is available only on the platform domain.',
        status: 403,
      });
    return success(
      context,
      await platformStudioService.execute(
        context.env,
        context.get('auth'),
        context.req.valid('json'),
      ),
      200,
    );
  });
  app.route('/v1/platform-studio', platformStudio);

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: { title: 'Soliventa Learn API', version: '0.2.0' },
    servers: [{ url: '/', description: 'Current environment' }],
  });

  app.notFound((context) =>
    failure(context, {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      status: 404,
    }),
  );

  app.onError((error, context) => {
    const normalized = isAppError(error) ? error : undefined;
    const code = normalized?.code ?? 'INTERNAL_ERROR';
    context.set('errorCode', code);
    const tenant = context.get('tenant') as AppVariables['tenant'] | undefined;
    const principal = context.get('principal') as AppVariables['principal'] | undefined;
    structuredLog(normalized && normalized.status < 500 ? 'warn' : 'error', {
      type: normalized ? 'application_error' : 'unexpected_exception',
      requestId: context.get('requestId'),
      environment: context.env.APP_ENV,
      hostname: context.get('requestHostname'),
      schoolId: tenant?.schoolId,
      userId: principal?.userId,
      route: context.req.path,
      method: context.req.method,
      status: normalized?.status ?? 500,
      errorCode: code,
      operation:
        typeof normalized?.details?.operation === 'string'
          ? normalized.details.operation
          : undefined,
    });
    recordMetric(context.env, {
      type: normalized ? 'application_error' : 'unexpected_exception',
      environment: context.env.APP_ENV,
      schoolId: tenant?.schoolId,
      hostname: context.get('requestHostname'),
      route: context.req.path,
      method: context.req.method,
      status: normalized?.status ?? 500,
      errorCode: code,
      outcome: 'failure',
    });
    return failure(context, {
      code: normalized?.code ?? 'INTERNAL_ERROR',
      message: normalized?.message ?? 'An unexpected error occurred.',
      status: normalized?.status ?? 500,
      ...(normalized && normalized.status < 500 && normalized.details
        ? { details: normalized.details }
        : {}),
    });
  });

  return app;
}

export const app = createApp();
