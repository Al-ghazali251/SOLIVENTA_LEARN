import { studentLessonContent, PROMPT_VERSION } from '../../lessons/ai-model';
import {
  generateLesson,
  freeLessonModel,
  GenerationRetryError,
} from '../openrouter/lesson-generator';
import { PermanentJobError, type JobEnvelope } from '../../jobs/model';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { hasSupabaseSecretKey, type Bindings } from '../../config/bindings';
import { AppError } from '../../errors/app-error';
import { roles, type Role } from '../../permissions/roles';
import { permissions, type Permission } from '../../permissions/permissions';
import type {
  MembershipResult,
  PortalBootstrapDetails,
  PublicBootstrap,
} from '../../services/contracts';
import type {
  DomainGateway,
  IdentityGateway,
  ModeratorGateway,
  PaymentGateway,
} from '../../services/privileged-operations';
import type { ConfigurationPublishingGateway } from '../../services/configuration-publishing.service';
import { resolveTemplateDefinition } from '../../configuration/templates';
import type { ConfigurationStudioGateway } from '../../services/configuration-studio.service';
import {
  defaultPortalConfiguration,
  normalizeTemplateId,
  migrateTenantConfiguration,
  TemplateIdSchema,
  type ConfigurationVersion,
} from '../../configuration/model';
import type { AuthContext, TenantContext } from '../../types/context';
import type { AcademicStructureGateway } from '../../services/academic-structure.service';
import type { DomainDirectoryGateway } from '../../services/domain-provisioning.service';
import { DomainRecordSchema, type DomainRecord } from '../../domains/model';
import type { CloudflareHostname } from '../cloudflare/custom-hostnames';
import type { JobGateway } from '../../services/background-jobs.service';
import type { PaymentTransaction } from '../../services/payments.service';
import type { CompletePlatformGateway } from '../../services/complete-platform.service';
import type { PlatformStudioGateway } from '../../services/platform-studio.service';
import type { ApplicantGateway } from '../../services/applicant.service';
import { ApplicantStatusSchema } from '../../applicant/model';
import { initializePaystack, verifyPaystack } from '../paystack/client';
import { importEntranceQuestions } from '../../entrance-exams/importer';
import { gradeEntranceObjectiveAnswers } from '../../entrance-exams/grading';
import { brandedEmail, sendTransactionalEmail } from '../resend/client';

const PaymentTransactionRowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  invoice_id: z.string().uuid(),
  student_id: z.string().uuid(),
  provider_reference: z.string(),
  customer_email: z.string().email(),
  expected_amount_minor: z.coerce.number().int().positive(),
  currency: z.string(),
  status: z.string(),
});
import { JobOperationSchema, type JobSummary } from '../../jobs/model';
import { recordMetric, structuredLog } from '../../observability/telemetry';
import type { CorePortalGateway } from '../../services/core-portal.service';

// Local deterministic fixtures use UUID-shaped identifiers without RFC version bits.
// PostgreSQL accepts them as uuid values, so persistence-bound parsing must as well.
const DatabaseUuidSchema = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu);
const ActiveDomainRowSchema = z.object({
  school_id: DatabaseUuidSchema,
  domain_type: z.enum(['public_site', 'portal']),
});

const SchoolRowSchema = z.object({
  status: z.literal('active'),
  published_config_version_id: DatabaseUuidSchema,
});

const ConfigurationVersionSchema = z.object({ version: z.coerce.number().int().positive() });
const StudioVersionRowSchema = z.object({
  id: z.string().uuid(),
  version: z.coerce.number().int().positive(),
  status: z.enum(['draft', 'published', 'archived']),
  config: z.unknown(),
  created_at: z.string(),
  published_at: z.string().nullable(),
});
const PublicVersionSchema = z.object({ config: z.record(z.string(), z.unknown()) });
const BootstrapSchoolSchema = z.object({
  display_name: z.string(),
  status: z.enum(['active', 'suspended']),
});
const PrimaryDomainSchema = z.object({ normalized_hostname: z.string() });
const BrandingSchema = z.object({
  logo_url: z.string().nullable(),
  favicon_url: z.string().nullable(),
  primary_color: z.string(),
  secondary_color: z.string(),
  accent_color: z.string(),
  heading_font: z.string(),
  body_font: z.string(),
});
const FeatureRowsSchema = z.array(z.object({ feature_key: z.string(), enabled: z.boolean() }));
const PlatformFeaturesSchema = z.array(
  z.object({ feature_key: z.string(), available: z.boolean() }),
);
const EntitlementsSchema = z.array(z.object({ feature_key: z.string(), entitled: z.boolean() }));
const NavigationRowsSchema = z.array(
  z.object({
    location: z.enum(['header', 'footer', 'portal']),
    label: z.string(),
    href: z.string(),
    required_feature: z.string().nullable(),
    visible: z.boolean(),
  }),
);
const ProfileSchema = z.object({
  // PostgreSQL UUID fixture IDs need not encode RFC version bits.
  user_id: z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu),
  display_name: z.string(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
});
const PlatformRoleRowsSchema = z.array(z.object({ role: z.literal('moderator') }));
const PlatformAccessRowsSchema = z.array(
  z.object({ role_codes: z.array(z.string()), permissions: z.array(z.string()) }),
);
const WorkspaceRowsSchema = z.array(
  z.object({
    membership_id: z.string().uuid(),
    school_id: DatabaseUuidSchema,
    school_name: z.string(),
    membership_kind: z.enum([
      'applicant',
      'guardian',
      'student',
      'teacher',
      'administrator',
      'specialist',
    ]),
    membership_status: z.enum(['invited', 'active', 'suspended', 'revoked']),
    lifecycle_state: z.string(),
    role_codes: z.array(z.string()),
    permissions: z.array(z.string()),
    resource_scopes: z.record(z.string(), z.unknown()),
  }),
);

function client(bindings: Bindings) {
  if (!bindings.SUPABASE_URL || !hasSupabaseSecretKey(bindings)) {
    throw new AppError({
      code: 'SERVICE_NOT_READY',
      message: 'A required service is unavailable.',
      status: 503,
    });
  }
  return createClient(bindings.SUPABASE_URL, bindings.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        const started = performance.now();
        let outcome = 'success';
        try {
          const response = await fetch(input, init);
          if (!response.ok) outcome = 'failure';
          return response;
        } catch (error) {
          outcome = 'failure';
          throw error;
        } finally {
          recordMetric(bindings, {
            type: 'database_request',
            environment: bindings.APP_ENV,
            durationMs: performance.now() - started,
            outcome,
          });
        }
      },
    },
  });
}

async function sendSchoolEmail(
  bindings: Bindings,
  input: {
    schoolId: string;
    to: string;
    subject: string;
    lines: string[];
    key: string;
    actionUrl?: string;
    actionLabel?: string;
  },
) {
  if (!input.to) return;
  const admin = client(bindings);
  const [school, domain] = await Promise.all([
    admin
      .from('schools')
      .select('display_name,published_config_version_id')
      .eq('id', input.schoolId)
      .single(),
    admin
      .from('tenant_domains')
      .select('hostname')
      .eq('school_id', input.schoolId)
      .eq('domain_type', 'portal')
      .eq('status', 'active')
      .eq('is_primary', true)
      .maybeSingle(),
  ]);
  const schoolName = school.data?.display_name ? String(school.data.display_name) : 'Your school';
  const portalUrl = domain.data?.hostname
    ? `https://${String(domain.data.hostname)}`
    : bindings.PORTAL_ORIGIN;
  const versionId = school.data?.published_config_version_id;
  const [brandingResult, configResult] = versionId
    ? await Promise.all([
        admin
          .from('tenant_branding')
          .select('logo_url,primary_color,accent_color')
          .eq('config_version_id', versionId)
          .maybeSingle(),
        admin.from('tenant_config_versions').select('config').eq('id', versionId).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];
  const config = configResult.data?.config
    ? migrateTenantConfiguration(configResult.data.config)
    : null;
  const lines = [...input.lines, '', `Open portal: ${portalUrl}`];
  return sendTransactionalEmail(bindings, {
    to: input.to,
    subject: `${schoolName}: ${input.subject}`,
    text: lines.join('\n'),
    html: brandedEmail(input.lines, {
      schoolName,
      portalUrl,
      logoUrl: brandingResult.data?.logo_url ? String(brandingResult.data.logo_url) : null,
      primaryColor: brandingResult.data?.primary_color
        ? String(brandingResult.data.primary_color)
        : undefined,
      accentColor: brandingResult.data?.accent_color
        ? String(brandingResult.data.accent_color)
        : undefined,
      contact: config ? [config.contact.address, config.contact.phone, config.contact.email] : [],
      ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
      ...(input.actionLabel ? { actionLabel: input.actionLabel } : {}),
    }),
    idempotencyKey: input.key,
    schoolId: input.schoolId,
  });
}

async function notifyGuardiansAboutFee(
  bindings: Bindings,
  input: { schoolId: string; feeId: string; feeName: string; amountMinor: number },
) {
  const admin = client(bindings);
  const recipients = await admin.rpc('fee_guardian_notification_recipients', {
    _school: input.schoolId,
    _fee: input.feeId,
  });
  if (recipients.error)
    throw dependencyFailure('core-portal.fee.notification-recipients', recipients.error);
  const rows = z
    .array(
      z.object({
        account_id: DatabaseUuidSchema,
        email: z.string().email(),
        guardian_name: z.string(),
        student_names: z.string(),
      }),
    )
    .parse(recipients.data ?? []);
  if (!rows.length) return;
  const amount = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
  }).format(input.amountMinor / 100);
  const notifications = await admin.from('portal_notifications').insert(
    rows.map((recipient) => ({
      school_id: input.schoolId,
      recipient_account_id: recipient.account_id,
      kind: 'fee',
      title: `New fee: ${input.feeName}`,
      body: `${input.feeName} (${amount}) now applies to ${recipient.student_names}.`,
      href: '/fees',
      resource_type: 'fee_definition',
      resource_id: input.feeId,
    })),
  );
  if (notifications.error)
    throw dependencyFailure('core-portal.fee.portal-notification', notifications.error);
  await Promise.all(
    rows.map((recipient) =>
      sendSchoolEmail(bindings, {
        schoolId: input.schoolId,
        to: recipient.email,
        subject: `New fee for ${recipient.student_names}`,
        lines: [
          `Hello ${recipient.guardian_name},`,
          `${input.feeName} now applies to ${recipient.student_names}.`,
          `Amount: ${amount}`,
          'You can review the fee and available payment options in the school portal.',
        ],
        key: `fee-targeted-${input.feeId}-${recipient.account_id}`,
        actionLabel: 'Review fee',
      }),
    ),
  );
}

async function notifyFamiliesAboutResults(
  bindings: Bindings,
  input: {
    schoolId: string;
    termId: string;
    classId: string;
    reportType: string;
    workflowId: string;
  },
) {
  const admin = client(bindings);
  const [studentsResult, linksResult, termResult] = await Promise.all([
    admin
      .from('students')
      .select('id,user_id,full_name')
      .eq('school_id', input.schoolId)
      .eq('class_id', input.classId)
      .eq('status', 'active'),
    admin
      .from('guardian_student_links')
      .select('student_id,guardians(user_id,display_name)')
      .eq('school_id', input.schoolId),
    admin
      .from('academic_terms')
      .select('name')
      .eq('school_id', input.schoolId)
      .eq('id', input.termId)
      .single(),
  ]);
  if (studentsResult.error || linksResult.error || termResult.error)
    throw dependencyFailure(
      'results.notification.recipients',
      studentsResult.error ?? linksResult.error ?? termResult.error,
    );
  const students = (studentsResult.data ?? []) as {
    id: string;
    user_id: string | null;
    full_name: string;
  }[];
  const links = (linksResult.data ?? []) as unknown as {
    student_id: string;
    guardians: { user_id: string | null; display_name: string } | null;
  }[];
  const recipients = new Map<string, { name: string; students: string[] }>();
  for (const student of students) {
    if (student.user_id)
      recipients.set(student.user_id, { name: student.full_name, students: [student.full_name] });
    for (const link of links.filter((row) => row.student_id === student.id)) {
      const accountId = link.guardians?.user_id;
      if (!accountId) continue;
      const current = recipients.get(accountId) ?? {
        name: link.guardians?.display_name || 'Parent/guardian',
        students: [],
      };
      current.students.push(student.full_name);
      recipients.set(accountId, current);
    }
  }
  if (!recipients.size) return;
  const accountResult = await admin
    .from('accounts')
    .select('id,primary_email')
    .in('id', [...recipients.keys()]);
  if (accountResult.error)
    throw dependencyFailure('results.notification.accounts', accountResult.error);
  const label = input.reportType.replaceAll('_', ' ');
  const notifications = await admin.from('portal_notifications').insert(
    [...recipients].map(([accountId, recipient]) => ({
      school_id: input.schoolId,
      recipient_account_id: accountId,
      kind: 'result',
      title: `${label} results published`,
      body: `${termResult.data.name} results are ready for ${[...new Set(recipient.students)].join(', ')}.`,
      href: '/results',
      resource_type: 'result_workflow',
      resource_id: input.workflowId,
    })),
  );
  if (notifications.error)
    throw dependencyFailure('results.notification.portal', notifications.error);
  await Promise.all(
    (accountResult.data ?? []).flatMap((account) => {
      const recipient = recipients.get(String(account.id));
      return account.primary_email && recipient
        ? [
            sendSchoolEmail(bindings, {
              schoolId: input.schoolId,
              to: String(account.primary_email),
              subject: `${label} results published`,
              lines: [
                `Hello ${recipient.name},`,
                `${termResult.data.name} ${label} results are now available for ${[...new Set(recipient.students)].join(', ')}.`,
                'Sign in to view and download the official PDF report card.',
              ],
              key: `result-release-${input.workflowId}-${account.id}`,
            }),
          ]
        : [];
    }),
  );
}

async function notifyClassTeachersAboutResultRejection(
  bindings: Bindings,
  input: {
    schoolId: string;
    termId: string;
    classId: string;
    reportType: string;
    workflowId: string;
    note: string;
  },
) {
  const admin = client(bindings);
  const [teachersResult, termResult, classResult] = await Promise.all([
    admin
      .from('class_teacher_assignments')
      .select('teacher_user_id')
      .eq('school_id', input.schoolId)
      .eq('class_id', input.classId),
    admin
      .from('academic_terms')
      .select('name')
      .eq('school_id', input.schoolId)
      .eq('id', input.termId)
      .single(),
    admin
      .from('classes')
      .select('name')
      .eq('school_id', input.schoolId)
      .eq('id', input.classId)
      .single(),
  ]);
  if (teachersResult.error || termResult.error || classResult.error)
    throw dependencyFailure(
      'results.rejection.recipients',
      teachersResult.error ?? termResult.error ?? classResult.error,
    );
  const accountIds = [
    ...new Set((teachersResult.data ?? []).map((row) => String(row.teacher_user_id))),
  ];
  if (!accountIds.length) return;
  const accounts = await admin
    .from('accounts')
    .select('id,display_name,primary_email')
    .in('id', accountIds);
  if (accounts.error) throw dependencyFailure('results.rejection.accounts', accounts.error);
  const title = `${input.reportType.replaceAll('_', ' ')} returned for correction`;
  const body = `${classResult.data.name}, ${termResult.data.name}: ${input.note}`;
  const notices = await admin.from('portal_notifications').insert(
    accountIds.map((accountId) => ({
      school_id: input.schoolId,
      recipient_account_id: accountId,
      kind: 'result',
      title,
      body,
      href: '/results',
      resource_type: 'result_workflow',
      resource_id: input.workflowId,
    })),
  );
  if (notices.error) throw dependencyFailure('results.rejection.notification', notices.error);
  await Promise.all(
    (accounts.data ?? []).flatMap((account) =>
      account.primary_email
        ? [
            sendSchoolEmail(bindings, {
              schoolId: input.schoolId,
              to: String(account.primary_email),
              subject: title,
              lines: [
                `Hello ${account.display_name || 'Teacher'},`,
                body,
                'Open the results page, make the corrections, and submit again.',
              ],
              key: `result-rejected-${input.workflowId}-${Date.now()}-${account.id}`,
            }),
          ]
        : [],
    ),
  );
}

function dependencyFailure(operation: string, cause: unknown): AppError {
  return new AppError({
    code: 'SERVICE_NOT_READY',
    message: 'A required service is unavailable.',
    status: 503,
    cause,
    details: { operation },
  });
}

async function findActiveTenant(
  bindings: Bindings,
  hostname: string,
): Promise<TenantContext | null> {
  const platformHostnames = new Set(
    (bindings.PLATFORM_HOSTNAMES ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  if (platformHostnames.has(hostname.toLowerCase()))
    return Object.freeze({
      schoolId: '00000000-0000-0000-0000-000000000000',
      hostname,
      domainType: 'platform' as const,
      configurationVersion: 0,
      configurationVersionId: '00000000-0000-0000-0000-000000000000',
    });
  const admin = client(bindings);
  const domainResult = await admin
    .from('tenant_domains')
    .select('school_id,domain_type')
    .eq('normalized_hostname', hostname)
    .eq('status', 'active')
    .maybeSingle();

  if (domainResult.error) throw dependencyFailure('tenant-domain.lookup', domainResult.error);
  if (!domainResult.data) return null;
  const domain = ActiveDomainRowSchema.parse(domainResult.data);

  const schoolResult = await admin
    .from('schools')
    .select('status,published_config_version_id')
    .eq('id', domain.school_id)
    .eq('status', 'active')
    .maybeSingle();
  if (schoolResult.error) throw dependencyFailure('tenant-school.lookup', schoolResult.error);
  if (!schoolResult.data) return null;
  const school = SchoolRowSchema.parse(schoolResult.data);

  const versionResult = await admin
    .from('tenant_config_versions')
    .select('version')
    .eq('id', school.published_config_version_id)
    .eq('school_id', domain.school_id)
    .eq('status', 'published')
    .maybeSingle();
  if (versionResult.error) throw dependencyFailure('tenant-version.lookup', versionResult.error);
  if (!versionResult.data) return null;
  const configuration = ConfigurationVersionSchema.parse(versionResult.data);

  return Object.freeze({
    schoolId: domain.school_id,
    hostname,
    domainType: domain.domain_type === 'public_site' ? 'public' : 'portal',
    configurationVersion: configuration.version,
    configurationVersionId: school.published_config_version_id,
  });
}

async function bootstrapParts(bindings: Bindings, tenant: TenantContext) {
  const admin = client(bindings);
  const [
    schoolResult,
    domainResult,
    versionResult,
    brandingResult,
    featuresResult,
    navigationResult,
  ] = await Promise.all([
    admin.from('schools').select('display_name,status').eq('id', tenant.schoolId).single(),
    admin
      .from('tenant_domains')
      .select('normalized_hostname')
      .eq('school_id', tenant.schoolId)
      .eq('domain_type', 'public_site')
      .eq('status', 'active')
      .eq('is_primary', true)
      .single(),
    admin
      .from('tenant_config_versions')
      .select('config')
      .eq('id', tenant.configurationVersionId)
      .eq('status', 'published')
      .single(),
    admin
      .from('tenant_branding')
      .select(
        'logo_url,favicon_url,primary_color,secondary_color,accent_color,heading_font,body_font',
      )
      .eq('school_id', tenant.schoolId)
      .eq('config_version_id', tenant.configurationVersionId)
      .single(),
    admin
      .from('tenant_features')
      .select('feature_key,enabled')
      .eq('school_id', tenant.schoolId)
      .eq('config_version_id', tenant.configurationVersionId),
    admin
      .from('tenant_navigation')
      .select('location,label,href,required_feature,visible')
      .eq('school_id', tenant.schoolId)
      .eq('config_version_id', tenant.configurationVersionId)
      .eq('visible', true)
      .order('position'),
  ]);
  for (const [operation, error] of [
    ['bootstrap.school', schoolResult.error],
    ['bootstrap.primary-domain', domainResult.error],
    ['bootstrap.version', versionResult.error],
    ['bootstrap.branding', brandingResult.error],
    ['bootstrap.features', featuresResult.error],
    ['bootstrap.navigation', navigationResult.error],
  ] as const)
    if (error) throw dependencyFailure(operation, error);
  return {
    school: BootstrapSchoolSchema.parse(schoolResult.data),
    domain: PrimaryDomainSchema.parse(domainResult.data),
    version: PublicVersionSchema.parse(versionResult.data),
    branding: BrandingSchema.parse(brandingResult.data),
    features: FeatureRowsSchema.parse(featuresResult.data ?? []),
    navigation: NavigationRowsSchema.parse(navigationResult.data ?? []),
  };
}

async function loadPublicBootstrap(
  bindings: Bindings,
  tenant: TenantContext,
): Promise<PublicBootstrap> {
  const parts = await bootstrapParts(bindings, tenant);
  const features = Object.fromEntries(
    parts.features.map((item) => [item.feature_key, item.enabled]),
  );
  const configuration = migrateTenantConfiguration(parts.version.config);
  const template = normalizeTemplateId(TemplateIdSchema.parse(configuration.template));
  return Object.freeze({
    tenant: {
      id: tenant.schoolId,
      name: parts.school.display_name,
      primaryDomain: parts.domain.normalized_hostname,
    },
    branding: {
      logo: { url: parts.branding.logo_url },
      colors: {
        primary: parts.branding.primary_color,
        secondary: parts.branding.secondary_color,
        accent: parts.branding.accent_color,
      },
      fonts: { heading: parts.branding.heading_font, body: parts.branding.body_font },
      favicon: { url: parts.branding.favicon_url },
    },
    template,
    features,
    navigation: parts.navigation
      .filter(
        (item) =>
          item.location !== 'portal' && (!item.required_feature || features[item.required_feature]),
      )
      .map(({ label, href }) => ({ label, href })),
    configuration,
    configurationVersion: tenant.configurationVersion,
  });
}

async function loadPortalBootstrap(
  bindings: Bindings,
  tenant: TenantContext,
  userId: string,
): Promise<PortalBootstrapDetails> {
  if (tenant.domainType === 'platform')
    return loadPlatformPortalBootstrap(bindings, tenant, userId);
  const admin = client(bindings);
  const [parts, profileResult, notificationResult] = await Promise.all([
    bootstrapParts(bindings, tenant),
    admin
      .from('profiles')
      .select('user_id,display_name,email,avatar_url')
      .eq('user_id', userId)
      .single(),
    admin
      .from('portal_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('school_id', tenant.schoolId)
      .eq('recipient_account_id', userId)
      .is('read_at', null),
  ]);
  if (profileResult.error || notificationResult.error)
    throw dependencyFailure('bootstrap.profile', profileResult.error ?? notificationResult.error);
  const profile = ProfileSchema.parse(profileResult.data);
  const portalFeatures = Object.fromEntries(
    parts.features
      .filter((item) => item.feature_key.startsWith('portal.'))
      .map((item) => [item.feature_key, item.enabled]),
  );
  const configuration = migrateTenantConfiguration(parts.version.config);
  return Object.freeze({
    tenant: {
      id: tenant.schoolId,
      name: parts.school.display_name,
      primaryDomain: parts.domain.normalized_hostname,
    },
    contact: configuration.contact,
    schoolBranding: configuration.branding,
    profile: {
      id: profile.user_id,
      displayName: profile.display_name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
    },
    portal: configuration.portal,
    portalFeatures,
    navigation: parts.navigation
      .filter(
        (item) =>
          item.location === 'portal' &&
          (!item.required_feature || portalFeatures[item.required_feature]),
      )
      .map(({ label, href }) => ({ label, href })),
    schoolStatus: parts.school.status,
    unreadCounts: { notifications: notificationResult.count ?? 0 },
    configurationVersion: tenant.configurationVersion,
  });
}

async function loadPlatformPortalBootstrap(
  bindings: Bindings,
  tenant: TenantContext,
  userId: string,
): Promise<PortalBootstrapDetails> {
  const result = await client(bindings)
    .from('profiles')
    .select('user_id,display_name,email,avatar_url')
    .eq('user_id', userId)
    .single();
  if (result.error) throw dependencyFailure('platform-bootstrap.profile', result.error);
  const profile = ProfileSchema.parse(result.data);
  return Object.freeze({
    tenant: {
      id: tenant.schoolId,
      name: 'Soliventa Learn Platform',
      primaryDomain: tenant.hostname,
    },
    contact: { email: '', phone: '', address: '' },
    schoolBranding: {
      logoUrl: null,
      faviconUrl: null,
      colors: {
        primary: '#174c3c',
        secondary: '#234f45',
        accent: '#c7862d',
        background: '#f5f4ef',
        surface: '#ffffff',
        text: '#17231f',
        muted: '#62706a',
      },
      fonts: { heading: 'Inter', body: 'Inter' },
      buttonStyle: 'rounded',
      cardStyle: 'bordered',
      inputStyle: 'rounded',
    } as const,
    profile: {
      id: profile.user_id,
      displayName: profile.display_name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
    },
    portal: defaultPortalConfiguration,
    portalFeatures: {},
    navigation: [],
    schoolStatus: 'active',
    unreadCounts: {},
    configurationVersion: 0,
  });
}

async function findMembership(
  bindings: Bindings,
  schoolId: string,
  userId: string,
): Promise<MembershipResult> {
  const admin = client(bindings);
  const activated = await admin
    .from('school_memberships')
    .update({ status: 'active' })
    .eq('school_id', schoolId)
    .eq('user_id', userId)
    .eq('status', 'invited');
  if (activated.error) throw dependencyFailure('membership.activate-invitation', activated.error);
  const [workspaceResult, platformResult, platformAccessResult] = await Promise.all([
    admin.rpc('get_account_workspaces', { _account_id: userId }),
    admin.from('platform_role_assignments').select('role').eq('user_id', userId),
    admin.rpc('get_platform_operator_access', { _account_id: userId }),
  ]);
  if (workspaceResult.error) {
    throw dependencyFailure('membership.workspace-lookup', workspaceResult.error);
  }
  if (platformResult.error) {
    throw dependencyFailure('platform-membership.lookup', platformResult.error);
  }
  if (platformAccessResult.error) {
    throw dependencyFailure('platform-access.lookup', platformAccessResult.error);
  }

  const workspaces = WorkspaceRowsSchema.parse(workspaceResult.data ?? []).filter(
    (row) => row.school_id === schoolId,
  );
  const platformRows = PlatformRoleRowsSchema.parse(platformResult.data ?? []);
  const platformAccess = PlatformAccessRowsSchema.parse(platformAccessResult.data ?? []);
  const roleCodes = [
    ...new Set([
      ...workspaces.flatMap((row) => row.role_codes),
      ...platformAccess.flatMap((row) => row.role_codes),
    ]),
  ];
  const permissionCodes = [
    ...new Set([
      ...workspaces.flatMap((row) => row.permissions),
      ...platformAccess.flatMap((row) => row.permissions),
    ]),
  ];
  const validRoles = roleCodes.filter((role): role is Role => roles.includes(role as Role));
  const validPermissions = permissionCodes.filter((permission): permission is Permission =>
    permissions.includes(permission as Permission),
  );
  const primary = workspaces.find((row) => row.membership_status === 'active') ?? workspaces[0];
  return {
    roles: validRoles,
    roleCodes,
    permissions: validPermissions,
    membershipId: primary?.membership_id ?? null,
    membershipKind: primary?.membership_kind ?? null,
    lifecycleState: primary?.lifecycle_state ?? null,
    resourceScopes: workspaces.reduce<Record<string, unknown>>(
      (scopes, row) => ({ ...scopes, ...row.resource_scopes }),
      {},
    ),
    isModerator: platformRows.length > 0 || platformAccess.length > 0,
  };
}

async function checkReadiness(bindings: Bindings): Promise<void> {
  const result = await client(bindings)
    .from('schools')
    .select('id', { head: true, count: 'exact' });
  if (result.error) throw dependencyFailure('readiness.database', result.error);
}

async function provisionIdentity(
  bindings: Bindings,
  input: Parameters<IdentityGateway['provision']>[0],
): Promise<{ userId: string }> {
  const admin = client(bindings);
  const created = await admin.auth.admin.createUser({ email: input.email, email_confirm: true });
  if (created.error) throw dependencyFailure('identity.create', created.error);
  const membership = await admin.from('school_memberships').insert({
    school_id: input.schoolId,
    user_id: created.data.user.id,
    role: input.role,
    status: 'active',
    invited_by: input.invitedBy,
  });
  if (membership.error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw dependencyFailure('identity.membership-create', membership.error);
  }
  return { userId: created.data.user.id };
}

async function recordVerifiedPayment(
  bindings: Bindings,
  input: Parameters<PaymentGateway['recordVerified']>[0],
): Promise<void> {
  const result = await client(bindings).from('fee_payments').insert({
    school_id: input.schoolId,
    student_id: input.studentId,
    provider_reference: input.reference,
    amount_minor: input.amountMinor,
    provider: input.provider,
    recorded_by: input.recordedBy,
    paid_at: input.paidAt,
  });
  if (result.error) {
    recordMetric(bindings, {
      type: 'payment_verification',
      environment: bindings.APP_ENV,
      schoolId: input.schoolId,
      outcome: 'failed',
      errorCode: 'PAYMENT_RECORD_FAILED',
    });
    throw dependencyFailure('payment.record', result.error);
  }
  recordMetric(bindings, {
    type: 'payment_verification',
    environment: bindings.APP_ENV,
    schoolId: input.schoolId,
    outcome: 'succeeded',
  });
}

async function createPendingDomain(
  bindings: Bindings,
  input: Parameters<DomainGateway['createPending']>[0],
): Promise<void> {
  const result = await client(bindings).from('tenant_domains').insert({
    school_id: input.schoolId,
    hostname: input.hostname,
    domain_type: input.domainType,
    verification_token_hash: input.verificationTokenHash,
    status: 'pending',
  });
  if (result.error) throw dependencyFailure('domain.create', result.error);
}

async function setSchoolStatus(
  bindings: Bindings,
  input: Parameters<ModeratorGateway['setSchoolStatus']>[0],
): Promise<void> {
  const result = await client(bindings)
    .from('schools')
    .update({ status: input.status })
    .eq('id', input.schoolId);
  if (result.error) throw dependencyFailure('school.status-update', result.error);
}

async function publishConfiguration(
  bindings: Bindings,
  input: Parameters<ConfigurationPublishingGateway['publish']>[1],
): Promise<{
  publishedVersion: number;
  previousVersion: number | null;
  hostnames: readonly string[];
}> {
  const admin = client(bindings);
  const currentResult = await admin
    .from('schools')
    .select('published_config_version_id')
    .eq('id', input.schoolId)
    .single();
  if (currentResult.error)
    throw dependencyFailure('configuration.current-version', currentResult.error);
  let previousVersion: number | null = null;
  if (currentResult.data.published_config_version_id) {
    const previousResult = await admin
      .from('tenant_config_versions')
      .select('version')
      .eq('id', currentResult.data.published_config_version_id)
      .single();
    if (previousResult.error)
      throw dependencyFailure('configuration.previous-version', previousResult.error);
    previousVersion = ConfigurationVersionSchema.parse(previousResult.data).version;
  }
  const publishResult = await admin.rpc('publish_tenant_config', {
    _school_id: input.schoolId,
    _version_id: input.versionId,
  });
  if (publishResult.error) throw dependencyFailure('configuration.publish', publishResult.error);
  const publishedVersion = ConfigurationVersionSchema.parse(publishResult.data).version;
  const domainsResult = await admin
    .from('tenant_domains')
    .select('normalized_hostname')
    .eq('school_id', input.schoolId)
    .eq('status', 'active');
  if (domainsResult.error) throw dependencyFailure('configuration.domains', domainsResult.error);
  const hostnames = z
    .array(PrimaryDomainSchema)
    .parse(domainsResult.data ?? [])
    .map((row) => row.normalized_hostname);
  return { publishedVersion, previousVersion, hostnames };
}

const studioVersion = (value: unknown): ConfigurationVersion => {
  const row = StudioVersionRowSchema.parse(value);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    configuration: migrateTenantConfiguration(row.config),
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
};

async function saveConfigurationDraft(
  bindings: Bindings,
  input: Parameters<ConfigurationStudioGateway['saveDraft']>[1],
) {
  const result = await client(bindings).rpc('save_tenant_config_draft', {
    _school_id: input.schoolId,
    _version_id: input.versionId ?? null,
    _actor_id: input.actorId,
    _config: input.configuration,
  });
  if (result.error) throw dependencyFailure('configuration.save-draft', result.error);
  return studioVersion(result.data);
}

async function uploadConfigurationAsset(
  bindings: Bindings,
  input: Parameters<ConfigurationStudioGateway['uploadAsset']>[1],
) {
  const allowed = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'application/pdf',
  ]);
  if (!allowed.has(input.mimeType))
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'Unsupported studio asset type.',
      status: 400,
    });
  let binary: Uint8Array;
  try {
    binary = Uint8Array.from(atob(input.base64), (character) => character.charCodeAt(0));
  } catch {
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'The uploaded file is not valid.',
      status: 400,
    });
  }
  if (!binary.byteLength || binary.byteLength > 10 * 1024 * 1024)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'Studio assets must be 10 MB or smaller.',
      status: 400,
    });
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...binary.slice(start, start + length));
  const signatureMatches =
    input.mimeType === 'image/jpeg'
      ? binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff
      : input.mimeType === 'image/png'
        ? binary[0] === 0x89 && ascii(1, 3) === 'PNG'
        : input.mimeType === 'image/webp'
          ? ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP'
          : input.mimeType === 'image/avif'
            ? ascii(4, 8).includes('ftypavif') || ascii(4, 8).includes('ftypavis')
            : ascii(0, 5) === '%PDF-';
  if (!signatureMatches)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'The file contents do not match its declared type.',
      status: 400,
    });
  const id = crypto.randomUUID();
  const safeName = input.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-180) || 'asset';
  const path = `${input.schoolId}/studio/${id}-${safeName}`;
  const admin = client(bindings);
  const uploaded = await admin.storage.from('tenant-public-assets').upload(path, binary, {
    contentType: input.mimeType,
    upsert: false,
  });
  if (uploaded.error) throw dependencyFailure('configuration.asset-upload', uploaded.error);
  const { data } = admin.storage.from('tenant-public-assets').getPublicUrl(path);
  const audit = await admin.from('audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.actorId,
    action: 'configuration.asset.upload',
    entity_type: 'studio_asset',
    entity_id: id,
    metadata: { name: input.name, mimeType: input.mimeType, sizeBytes: binary.byteLength, path },
  });
  if (audit.error) {
    await admin.storage.from('tenant-public-assets').remove([path]);
    throw dependencyFailure('configuration.asset-audit', audit.error);
  }
  return {
    id,
    name: input.name,
    url: data.publicUrl,
    mimeType: input.mimeType,
    sizeBytes: binary.byteLength,
  };
}

async function configurationWorkspace(bindings: Bindings, schoolId: string, actorId: string) {
  const admin = client(bindings);
  const [versionsResult, platformResult, entitlementResult] = await Promise.all([
    admin
      .from('tenant_config_versions')
      .select('id,version,status,config,created_at,published_at')
      .eq('school_id', schoolId)
      .order('version', { ascending: false }),
    admin.from('platform_features').select('feature_key,available'),
    admin
      .from('school_feature_entitlements')
      .select('feature_key,entitled')
      .eq('school_id', schoolId),
  ]);
  for (const [operation, error] of [
    ['configuration.versions', versionsResult.error],
    ['configuration.platform-features', platformResult.error],
    ['configuration.entitlements', entitlementResult.error],
  ] as const)
    if (error) throw dependencyFailure(operation, error);
  let versions = (versionsResult.data ?? []).map(studioVersion);
  let draft = versions.find((version) => version.status === 'draft');
  if (!draft) {
    const source = versions.find((version) => version.status === 'published');
    if (!source)
      throw new AppError({
        code: 'SERVICE_NOT_READY',
        message: 'No configuration baseline is available.',
        status: 503,
      });
    draft = await saveConfigurationDraft(bindings, {
      schoolId,
      actorId,
      configuration: source.configuration,
    });
    versions = [draft, ...versions];
  }
  return {
    draft,
    versions,
    platformFeatures: Object.fromEntries(
      PlatformFeaturesSchema.parse(platformResult.data ?? []).map((row) => [
        row.feature_key,
        row.available,
      ]),
    ),
    entitlements: Object.fromEntries(
      EntitlementsSchema.parse(entitlementResult.data ?? []).map((row) => [
        row.feature_key,
        row.entitled,
      ]),
    ),
  };
}

async function publishStudioConfiguration(
  bindings: Bindings,
  input: Parameters<ConfigurationStudioGateway['publish']>[1],
) {
  const admin = client(bindings);
  const candidate = await admin
    .from('tenant_config_versions')
    .select('config')
    .eq('id', input.versionId)
    .eq('school_id', input.schoolId)
    .eq('status', 'draft')
    .single();
  if (candidate.error) throw dependencyFailure('configuration.publish-candidate', candidate.error);
  const validatedCandidate = migrateTenantConfiguration(candidate.data.config);
  resolveTemplateDefinition(validatedCandidate.template);
  const current = await admin
    .from('schools')
    .select('published_config_version_id')
    .eq('id', input.schoolId)
    .single();
  if (current.error) throw dependencyFailure('configuration.current-version', current.error);
  let previousVersion: number | null = null;
  if (current.data.published_config_version_id) {
    const previous = await admin
      .from('tenant_config_versions')
      .select('version')
      .eq('id', current.data.published_config_version_id)
      .single();
    if (previous.error) throw dependencyFailure('configuration.previous-version', previous.error);
    previousVersion = ConfigurationVersionSchema.parse(previous.data).version;
  }
  const result = await admin.rpc('publish_tenant_config_as_service', {
    _school_id: input.schoolId,
    _version_id: input.versionId,
    _actor_id: input.actorId,
    _action: input.action,
  });
  if (result.error) throw dependencyFailure('configuration.publish', result.error);
  const domains = await admin
    .from('tenant_domains')
    .select('normalized_hostname')
    .eq('school_id', input.schoolId)
    .eq('status', 'active');
  if (domains.error) throw dependencyFailure('configuration.domains', domains.error);
  return {
    version: studioVersion(result.data),
    previousVersion,
    hostnames: z
      .array(PrimaryDomainSchema)
      .parse(domains.data ?? [])
      .map((row) => row.normalized_hostname),
  };
}

async function cloneStudioVersion(
  bindings: Bindings,
  input: Parameters<ConfigurationStudioGateway['cloneVersion']>[1],
) {
  const source = await client(bindings)
    .from('tenant_config_versions')
    .select('config')
    .eq('id', input.sourceVersionId)
    .eq('school_id', input.schoolId)
    .in('status', ['published', 'archived'])
    .single();
  if (source.error) throw dependencyFailure('configuration.rollback-source', source.error);
  return saveConfigurationDraft(bindings, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    configuration: migrateTenantConfiguration(source.data.config),
  });
}

async function loadStudioPreview(bindings: Bindings, schoolId: string, versionId: string) {
  const result = await client(bindings)
    .from('tenant_config_versions')
    .select('id,version,status,config,created_at,published_at')
    .eq('school_id', schoolId)
    .eq('id', versionId)
    .in('status', ['draft', 'published'])
    .single();
  if (result.error) throw dependencyFailure('configuration.preview', result.error);
  return studioVersion(result.data);
}

async function academicWorkspace(bindings: Bindings, schoolId: string) {
  const admin = client(bindings);
  const results = await Promise.all([
    admin.from('classes').select('*').eq('school_id', schoolId),
    admin.from('class_arms').select('*').eq('school_id', schoolId),
    admin.from('subjects').select('*').eq('school_id', schoolId),
    admin.from('academic_sessions').select('*').eq('school_id', schoolId),
    admin.from('academic_terms').select('*').eq('school_id', schoolId),
    admin.from('class_subjects').select('*').eq('school_id', schoolId),
    admin.from('class_teacher_assignments').select('*').eq('school_id', schoolId),
    admin.from('teacher_class_subject_assignments').select('*').eq('school_id', schoolId),
    admin
      .from('students')
      .select('id,admission_number,full_name,class_id,status')
      .eq('school_id', schoolId)
      .order('full_name'),
    admin
      .from('staff_profiles')
      .select('id,user_id,employee_number,full_name,email,status')
      .eq('school_id', schoolId)
      .order('full_name'),
    admin
      .from('student_enrollments')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('academic_subject_templates').select('*').eq('school_id', schoolId).order('name'),
  ]);
  results.forEach((result, index) => {
    if (result.error) throw dependencyFailure(`academic.workspace.${index}`, result.error);
  });
  const classRows = results[0].data ?? [],
    staffRows = results[9].data ?? [];
  const classTeachers = (results[6].data ?? []).map((assignment) => ({
    ...assignment,
    class_name: String(classRows.find((row) => row.id === assignment.class_id)?.name ?? 'Class'),
    teacher_name: String(
      staffRows.find((row) => row.user_id === assignment.teacher_user_id)?.full_name ?? 'Teacher',
    ),
  }));
  return {
    classes: results[0].data ?? [],
    arms: results[1].data ?? [],
    subjects: results[2].data ?? [],
    sessions: results[3].data ?? [],
    terms: results[4].data ?? [],
    classSubjects: results[5].data ?? [],
    classTeachers,
    teacherAssignments: results[7].data ?? [],
    students: results[8].data ?? [],
    staff: results[9].data ?? [],
    enrollments: results[10].data ?? [],
    templates: results[11].data ?? [],
  };
}

const academicTable = {
  class: 'classes',
  arm: 'class_arms',
  subject: 'subjects',
  session: 'academic_sessions',
  term: 'academic_terms',
  template: 'academic_subject_templates',
} as const;
async function auditAcademic(
  admin: ReturnType<typeof client>,
  input: {
    schoolId: string;
    actorId: string;
    action: string;
    entity: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const result = await admin.from('audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entity,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (result.error) throw dependencyFailure('academic.audit', result.error);
}
async function saveAcademicRecord(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['save']>[1],
) {
  const admin = client(bindings);
  const record = input.record;
  const { entity, id } = record;
  let row: Record<string, unknown>;
  if (record.entity === 'template')
    row = {
      name: record.name,
      class_id: record.classId,
      arm_id: record.armId,
      subjects: record.subjects,
      active: record.active,
    };
  else if (record.entity === 'session')
    row = {
      name: record.name,
      starts_on: record.startsOn,
      ends_on: record.endsOn,
      status: record.status,
    };
  else if (record.entity === 'term')
    row = {
      session_id: record.sessionId,
      name: record.name,
      position: record.position,
      starts_on: record.startsOn,
      ends_on: record.endsOn,
      status: record.status,
    };
  else if (record.entity === 'arm')
    row = {
      class_id: record.classId,
      name: record.name,
      code: record.code,
      capacity: record.capacity,
      active: record.active,
    };
  else row = { name: record.name, code: record.code, active: record.active };
  const query = id
    ? admin.from(academicTable[entity]).update(row).eq('school_id', input.schoolId).eq('id', id)
    : admin.from(academicTable[entity]).insert({ ...row, school_id: input.schoolId });
  const result = await query.select().single();
  if (result.error) throw dependencyFailure(`academic.${entity}.save`, result.error);
  const saved = z.record(z.string(), z.unknown()).parse(result.data);
  const entityId = String(saved.id);
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: `academic.${entity}.${id ? 'updated' : 'created'}`,
    entity,
    entityId,
  });
  return saved;
}
async function removeAcademicRecord(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['remove']>[1],
) {
  const admin = client(bindings);
  const result = await admin
    .from(academicTable[input.entity])
    .delete()
    .eq('school_id', input.schoolId)
    .eq('id', input.id)
    .select('id')
    .maybeSingle();
  if (result.error) throw dependencyFailure(`academic.${input.entity}.delete`, result.error);
  if (!result.data)
    throw new AppError({ code: 'NOT_FOUND', message: 'Academic record not found.', status: 404 });
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: `academic.${input.entity}.deleted`,
    entity: input.entity,
    entityId: input.id,
  });
}
async function replaceRows(
  admin: ReturnType<typeof client>,
  table: string,
  schoolId: string,
  filters: Record<string, string>,
  rows: readonly Record<string, unknown>[],
) {
  let deletion = admin.from(table).delete().eq('school_id', schoolId);
  Object.entries(filters).forEach(([key, value]) => {
    deletion = deletion.eq(key, value);
  });
  const removed = await deletion;
  if (removed.error) throw dependencyFailure(`academic.${table}.replace-delete`, removed.error);
  if (rows.length) {
    const inserted = await admin.from(table).insert(rows);
    if (inserted.error) throw dependencyFailure(`academic.${table}.replace-insert`, inserted.error);
  }
}
async function replaceClassSubjects(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['replaceClassSubjects']>[1],
) {
  const admin = client(bindings);
  await replaceRows(
    admin,
    'class_subjects',
    input.schoolId,
    { class_id: input.classId },
    input.subjectIds.map((subjectId) => ({
      school_id: input.schoolId,
      class_id: input.classId,
      subject_id: subjectId,
    })),
  );
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: 'academic.class-subjects.replaced',
    entity: 'class',
    entityId: input.classId,
    metadata: { subjectIds: input.subjectIds },
  });
}
async function assignClassTeacher(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['assignClassTeacher']>[1],
) {
  const admin = client(bindings);
  await replaceRows(
    admin,
    'class_teacher_assignments',
    input.schoolId,
    { class_id: input.classId },
    input.teacherUserId
      ? [
          {
            school_id: input.schoolId,
            class_id: input.classId,
            teacher_user_id: input.teacherUserId,
          },
        ]
      : [],
  );
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: 'academic.class-teacher.assigned',
    entity: 'class',
    entityId: input.classId,
    metadata: { teacherUserId: input.teacherUserId },
  });
}
async function replaceTeacherAssignments(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['replaceTeacherAssignments']>[1],
) {
  const admin = client(bindings);
  await replaceRows(
    admin,
    'teacher_class_subject_assignments',
    input.schoolId,
    { teacher_user_id: input.teacherUserId },
    input.assignments.map((item) => ({
      school_id: input.schoolId,
      teacher_user_id: input.teacherUserId,
      class_id: item.classId,
      subject_id: item.subjectId,
    })),
  );
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: 'academic.teacher-assignments.replaced',
    entity: 'teacher',
    entityId: input.teacherUserId,
    metadata: { assignments: input.assignments },
  });
}
async function manageStudentEnrollment(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['manageEnrollment']>[1],
) {
  const result = await client(bindings).rpc('manage_student_enrolment', {
    _school_id: input.schoolId,
    _student_id: input.studentId,
    _session_id: input.sessionId,
    _class_id: input.classId,
    _arm_id: input.armId,
    _enrolled_at: input.enrolledAt,
    _active: input.active,
    _actor_id: input.actorId,
  });
  if (result.error) throw dependencyFailure('academic.enrollment.manage', result.error);
  return z.record(z.string(), z.unknown()).parse(result.data);
}

const DomainRowSchema = z.object({
  id: z.string().uuid(),
  hostname: z.string(),
  domain_type: z.enum(['public_site', 'portal']),
  domain_kind: z.enum(['platform', 'custom']),
  status: z.enum([
    'pending',
    'awaiting_dns',
    'verifying',
    'active',
    'failed',
    'suspended',
    'removed',
  ]),
  certificate_status: z.enum(['pending', 'provisioning', 'active', 'failed', 'expired']),
  is_primary: z.boolean(),
  redirect_to_primary: z.boolean(),
  provider_hostname_id: z.string().nullable(),
  ownership_verification: z.record(z.string(), z.unknown()).nullable(),
  certificate_validation: z.array(z.record(z.string(), z.unknown())).nullable(),
  failure_reason: z.string().nullable(),
  last_checked_at: z.string().nullable(),
  created_at: z.string(),
});
function domainRecord(value: unknown): DomainRecord {
  const row = DomainRowSchema.parse(value);
  return DomainRecordSchema.parse({
    id: row.id,
    hostname: row.hostname,
    domainType: row.domain_type,
    domainKind: row.domain_kind,
    status: row.status,
    certificateStatus: row.certificate_status,
    isPrimary: row.is_primary,
    redirectToPrimary: row.redirect_to_primary,
    providerHostnameId: row.provider_hostname_id,
    ownershipVerification: row.ownership_verification,
    certificateValidation: row.certificate_validation ?? [],
    failureReason: row.failure_reason,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
  });
}
const domainColumns =
  'id,hostname,domain_type,domain_kind,status,certificate_status,is_primary,redirect_to_primary,provider_hostname_id,ownership_verification,certificate_validation,failure_reason,last_checked_at,created_at';
async function listDomains(bindings: Bindings, schoolId: string) {
  const result = await client(bindings)
    .from('tenant_domains')
    .select(domainColumns)
    .eq('school_id', schoolId)
    .neq('status', 'removed')
    .order('created_at');
  if (result.error) throw dependencyFailure('domains.list', result.error);
  return (result.data ?? []).map(domainRecord);
}
async function provisionDefaultDomains(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['provisionDefaults']>[1],
) {
  const result = await client(bindings).rpc('provision_platform_domains', {
    _school_id: input.schoolId,
    _actor_id: input.actorId,
    _base_domain: input.baseDomain,
  });
  if (result.error) throw dependencyFailure('domains.defaults', result.error);
  return z.array(z.unknown()).parse(result.data).map(domainRecord);
}
function providerLifecycle(provider: CloudflareHostname) {
  const certificateStatus =
    provider.ssl?.status === 'active'
      ? 'active'
      : provider.ssl?.status?.includes('timed_out') || provider.ssl?.status === 'expired'
        ? 'failed'
        : 'provisioning';
  const status =
    provider.status === 'active' && certificateStatus === 'active'
      ? 'active'
      : provider.status === 'blocked'
        ? 'failed'
        : provider.status === 'pending'
          ? 'awaiting_dns'
          : 'verifying';
  return { status, certificateStatus } as const;
}
async function createCustomDomain(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['createCustom']>[1],
) {
  const admin = client(bindings);
  const lifecycle = providerLifecycle(input.provider);
  const result = await admin
    .from('tenant_domains')
    .insert({
      school_id: input.schoolId,
      hostname: input.hostname,
      domain_type: input.domainType,
      domain_kind: 'custom',
      status: lifecycle.status,
      certificate_status: lifecycle.certificateStatus,
      provider_hostname_id: input.provider.id,
      verification_method: 'txt',
      ownership_verification: {
        ...input.provider.ownership_verification,
        cname: { name: input.hostname, target: input.cnameTarget },
      },
      certificate_validation: input.provider.ssl?.validation_records ?? [],
      last_checked_at: new Date().toISOString(),
    })
    .select(domainColumns)
    .single();
  if (result.error) throw dependencyFailure('domains.custom.create', result.error);
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: 'domain.custom.created',
    entity: 'tenant_domain',
    entityId: String(result.data.id),
    metadata: { hostname: input.hostname },
  });
  return domainRecord(result.data);
}
async function updateDomainProviderState(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['updateProviderState']>[1],
) {
  const admin = client(bindings);
  const lifecycle = providerLifecycle(input.provider);
  const result = await admin
    .from('tenant_domains')
    .update({
      status: lifecycle.status,
      certificate_status: lifecycle.certificateStatus,
      ownership_verification: input.provider.ownership_verification ?? null,
      certificate_validation: input.provider.ssl?.validation_records ?? [],
      failure_reason: input.provider.verification_errors?.join('; ') ?? null,
      last_checked_at: new Date().toISOString(),
      verified_at: lifecycle.status === 'active' ? new Date().toISOString() : null,
    })
    .eq('school_id', input.schoolId)
    .eq('id', input.domainId)
    .eq('domain_kind', 'custom')
    .neq('status', 'removed')
    .select(domainColumns)
    .single();
  if (result.error) throw dependencyFailure('domains.custom.refresh', result.error);
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: 'domain.custom.refreshed',
    entity: 'tenant_domain',
    entityId: input.domainId,
    metadata: { status: lifecycle.status, certificateStatus: lifecycle.certificateStatus },
  });
  return domainRecord(result.data);
}
async function setPrimaryDomain(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['setPrimary']>[1],
) {
  const result = await client(bindings).rpc('set_primary_tenant_domain', {
    _school_id: input.schoolId,
    _domain_id: input.domainId,
    _actor_id: input.actorId,
  });
  if (result.error) throw dependencyFailure('domains.primary.set', result.error);
  return domainRecord(result.data);
}
async function markDomainRemoved(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['markRemoved']>[1],
) {
  const result = await client(bindings).rpc('remove_custom_tenant_domain', {
    _school_id: input.schoolId,
    _domain_id: input.domainId,
    _actor_id: input.actorId,
  });
  if (result.error) throw dependencyFailure('domains.remove', result.error);
  const domain = domainRecord(result.data);
  return { domain, providerHostnameId: domain.providerHostnameId };
}
async function reconciliationCandidates(bindings: Bindings, limit: number) {
  const result = await client(bindings)
    .from('tenant_domains')
    .select('school_id,id,hostname,provider_hostname_id')
    .eq('domain_kind', 'custom')
    .in('status', ['awaiting_dns', 'verifying', 'active', 'failed'])
    .not('provider_hostname_id', 'is', null)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);
  if (result.error) throw dependencyFailure('domains.reconciliation.list', result.error);
  return z
    .array(
      z.object({
        school_id: z.string().uuid(),
        id: z.string().uuid(),
        hostname: z.string(),
        provider_hostname_id: z.string(),
      }),
    )
    .parse(result.data ?? [])
    .map((row) => ({
      schoolId: row.school_id,
      domainId: row.id,
      hostname: row.hostname,
      providerHostnameId: row.provider_hostname_id,
    }));
}
async function updateProviderStateAsSystem(
  bindings: Bindings,
  input: Parameters<DomainDirectoryGateway['updateProviderStateAsSystem']>[1],
) {
  const admin = client(bindings);
  const lifecycle = providerLifecycle(input.provider);
  const result = await admin
    .from('tenant_domains')
    .update({
      status: lifecycle.status,
      certificate_status: lifecycle.certificateStatus,
      ownership_verification: input.provider.ownership_verification ?? null,
      certificate_validation: input.provider.ssl?.validation_records ?? [],
      failure_reason: input.provider.verification_errors?.join('; ') ?? null,
      last_checked_at: new Date().toISOString(),
      verified_at: lifecycle.status === 'active' ? new Date().toISOString() : null,
    })
    .eq('school_id', input.schoolId)
    .eq('id', input.domainId)
    .eq('domain_kind', 'custom')
    .neq('status', 'removed')
    .select(domainColumns)
    .single();
  if (result.error) throw dependencyFailure('domains.reconciliation.update', result.error);
  const audit = await admin.from('audit_events').insert({
    school_id: input.schoolId,
    actor_id: null,
    action: 'domain.custom.reconciled',
    entity_type: 'tenant_domain',
    entity_id: input.domainId,
    metadata: { status: lifecycle.status, certificateStatus: lifecycle.certificateStatus },
  });
  if (audit.error) throw dependencyFailure('domains.reconciliation.audit', audit.error);
  return domainRecord(result.data);
}

const JobRowSchema = z.object({
  id: z.string().uuid(),
  school_id: z.string().uuid(),
  actor_id: z.string().uuid().nullable(),
  trace_id: z.string().startsWith('req_'),
  operation: JobOperationSchema,
  status: z.enum(['queued', 'running', 'retrying', 'succeeded', 'failed', 'dead_lettered']),
  attempt_count: z.number().int(),
  resource_type: z.string().nullable(),
  resource_id: z.string().nullable(),
  last_error_code: z.string().nullable(),
  last_error_message: z.string().nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
});
const jobColumns =
  'id,school_id,actor_id,trace_id,operation,status,attempt_count,resource_type,resource_id,last_error_code,last_error_message,created_at,started_at,completed_at';
function jobSummary(value: unknown): JobSummary {
  const row = JobRowSchema.parse(value);
  return {
    id: row.id,
    schoolId: row.school_id,
    actorId: row.actor_id,
    traceId: row.trace_id,
    operation: row.operation,
    status: row.status,
    attemptCount: row.attempt_count,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}
async function createBackgroundJob(bindings: Bindings, input: Parameters<JobGateway['create']>[1]) {
  const admin = client(bindings);
  const inserted = await admin
    .from('background_jobs')
    .insert({
      school_id: input.schoolId,
      actor_id: input.actorId,
      trace_id: input.traceId,
      operation: input.operation,
      idempotency_key: input.idempotencyKey,
      resource_type: input.resourceType,
      resource_id: input.resourceId,
      payload_digest: input.payloadDigest,
    })
    .select(jobColumns)
    .single();
  if (!inserted.error) return { job: jobSummary(inserted.data), created: true };
  if (inserted.error.code !== '23505') throw dependencyFailure('jobs.create', inserted.error);
  const existing = await admin
    .from('background_jobs')
    .select(jobColumns)
    .eq('school_id', input.schoolId)
    .eq('operation', input.operation)
    .eq('idempotency_key', input.idempotencyKey)
    .single();
  if (existing.error) throw dependencyFailure('jobs.idempotency.lookup', existing.error);
  return { job: jobSummary(existing.data), created: false };
}
async function getBackgroundJob(bindings: Bindings, schoolId: string, jobId: string) {
  const result = await client(bindings)
    .from('background_jobs')
    .select(jobColumns)
    .eq('school_id', schoolId)
    .eq('id', jobId)
    .maybeSingle();
  if (result.error) throw dependencyFailure('jobs.get', result.error);
  return result.data ? jobSummary(result.data) : null;
}
async function startBackgroundJob(
  bindings: Bindings,
  envelope: Parameters<JobGateway['start']>[1],
  attempt: number,
) {
  const admin = client(bindings);
  const current = await admin
    .from('background_jobs')
    .select('status')
    .eq('school_id', envelope.tenantId)
    .eq('id', envelope.jobId)
    .single();
  if (current.error) throw dependencyFailure('jobs.start.lookup', current.error);
  if (current.data.status === 'succeeded' || current.data.status === 'dead_lettered')
    return 'already-complete' as const;
  const now = new Date().toISOString();
  const updated = await admin
    .from('background_jobs')
    .update({
      status: 'running',
      attempt_count: attempt,
      started_at: now,
      last_error_code: null,
      last_error_message: null,
    })
    .eq('school_id', envelope.tenantId)
    .eq('id', envelope.jobId);
  if (updated.error) throw dependencyFailure('jobs.start', updated.error);
  const attemptResult = await admin.from('background_job_attempts').upsert(
    {
      school_id: envelope.tenantId,
      job_id: envelope.jobId,
      attempt,
      status: 'running',
      started_at: now,
    },
    { onConflict: 'job_id,attempt' },
  );
  if (attemptResult.error) throw dependencyFailure('jobs.attempt.start', attemptResult.error);
  return 'run' as const;
}
async function succeedBackgroundJob(
  bindings: Bindings,
  envelope: Parameters<JobGateway['succeed']>[1],
  attempt: number,
) {
  const admin = client(bindings);
  const now = new Date().toISOString();
  const [job, attemptResult] = await Promise.all([
    admin
      .from('background_jobs')
      .update({
        status: 'succeeded',
        attempt_count: attempt,
        completed_at: now,
        last_error_code: null,
        last_error_message: null,
      })
      .eq('school_id', envelope.tenantId)
      .eq('id', envelope.jobId),
    admin
      .from('background_job_attempts')
      .update({ status: 'succeeded', finished_at: now })
      .eq('job_id', envelope.jobId)
      .eq('attempt', attempt),
  ]);
  if (job.error || attemptResult.error)
    throw dependencyFailure('jobs.succeed', job.error ?? attemptResult.error);
}
async function failBackgroundJob(
  bindings: Bindings,
  envelope: Parameters<JobGateway['fail']>[1],
  attempt: number,
  error: Parameters<JobGateway['fail']>[3],
) {
  const admin = client(bindings);
  const now = new Date().toISOString();
  const status = error.retry ? 'retrying' : 'failed';
  const [job, attemptResult] = await Promise.all([
    admin
      .from('background_jobs')
      .update({
        status,
        attempt_count: attempt,
        last_error_code: error.code,
        last_error_message: error.message,
      })
      .eq('school_id', envelope.tenantId)
      .eq('id', envelope.jobId),
    admin
      .from('background_job_attempts')
      .update({ status, finished_at: now, error_code: error.code, error_message: error.message })
      .eq('job_id', envelope.jobId)
      .eq('attempt', attempt),
  ]);
  if (job.error || attemptResult.error)
    throw dependencyFailure('jobs.fail', job.error ?? attemptResult.error);
}
async function deadLetterBackgroundJob(
  bindings: Bindings,
  envelope: Parameters<JobGateway['deadLetter']>[1],
  attempt: number,
  error: Parameters<JobGateway['deadLetter']>[3],
) {
  const admin = client(bindings);
  const now = new Date().toISOString();
  const [job, attemptResult] = await Promise.all([
    admin
      .from('background_jobs')
      .update({
        status: 'dead_lettered',
        attempt_count: attempt,
        completed_at: now,
        last_error_code: error.code,
        last_error_message: error.message,
      })
      .eq('school_id', envelope.tenantId)
      .eq('id', envelope.jobId),
    admin.from('background_job_attempts').upsert(
      {
        school_id: envelope.tenantId,
        job_id: envelope.jobId,
        attempt,
        status: 'dead_lettered',
        error_code: error.code,
        error_message: error.message,
        started_at: now,
        finished_at: now,
      },
      { onConflict: 'job_id,attempt' },
    ),
  ]);
  if (job.error || attemptResult.error)
    throw dependencyFailure('jobs.dead-letter', job.error ?? attemptResult.error);
}

async function corePortalWorkspace(
  bindings: Bindings,
  context: Parameters<CorePortalGateway['workspace']>[1],
) {
  const admin = client(bindings);
  const schoolId = context.schoolId;
  // Fetch four school-owned collections in one PostgREST subrequest. The Worker
  // has a strict external-subrequest budget for each portal workspace request.
  const schoolOwnedResult = await admin
    .from('schools')
    .select(
      'student_report_summaries(*),result_promotion_rules(*),result_component_settings(*),result_session_weight_settings(*),result_score_imports(*),school_payment_settings(paystack_enabled,manual_transfer_enabled,installments_enabled,minimum_installment_percent,maximum_installments,bank_name,account_name,account_number,transfer_instructions,updated_at),school_identifier_profiles(id,name,class_id,format,next_number,padding,updated_at)',
    )
    .eq('id', schoolId)
    .single();
  if (schoolOwnedResult.error)
    throw dependencyFailure('core-portal.workspace.school-owned', schoolOwnedResult.error);
  const schoolOwned = z.record(z.string(), z.unknown()).parse(schoolOwnedResult.data);
  const results = await Promise.all([
    admin
      .from('students')
      .select(
        'id,user_id,admission_number,first_name,last_name,full_name,class_id,status,guardian_phone',
      )
      .eq('school_id', schoolId)
      .order('full_name'),
    admin
      .from('staff_profiles')
      .select('id,user_id,employee_number,full_name,email,status')
      .eq('school_id', schoolId)
      .order('full_name'),
    admin
      .from('attendance_records')
      .select('id,student_id,class_id,term_id,attendance_date,status,note')
      .eq('school_id', schoolId)
      .order('attendance_date', { ascending: false })
      .limit(500),
    admin
      .from('assessment_definitions')
      .select('id,term_id,class_id,subject_id,name,maximum_score,weight_percent,report_type')
      .eq('school_id', schoolId),
    admin
      .from('result_scores')
      .select('id,assessment_id,student_id,score,remark')
      .eq('school_id', schoolId),
    admin
      .from('result_releases')
      .select('id,term_id,class_id,report_type,status,released_at')
      .eq('school_id', schoolId),
    admin
      .from('fee_definitions')
      .select(
        'id,session_id,term_id,class_id,class_ids,student_audience,name,amount_minor,currency,active',
      )
      .eq('school_id', schoolId),
    admin
      .from('fee_invoices')
      .select(
        'id,student_id,fee_definition_id,amount_minor,discount_minor,status,due_on,installments_allowed,minimum_installment_percent,maximum_installments',
      )
      .eq('school_id', schoolId),
    admin
      .from('fee_payments')
      .select(
        'id,student_id,invoice_id,amount_minor,currency,provider,provider_reference,paid_at,installment_number,balance_after_minor',
      )
      .eq('school_id', schoolId),
    admin
      .from('teacher_class_subject_assignments')
      .select('class_id,subject_id,teacher_user_id')
      .eq('school_id', schoolId)
      .eq('teacher_user_id', context.userId),
    admin.from('guardians').select('id').eq('school_id', schoolId).eq('user_id', context.userId),
    admin.from('school_memberships').select('user_id,role,status').eq('school_id', schoolId),
    admin
      .from('manual_transfer_submissions')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('payment_receipts')
      .select('*')
      .eq('school_id', schoolId)
      .order('issued_at', { ascending: false }),
    admin
      .from('result_workflows')
      .select('*')
      .eq('school_id', schoolId)
      .order('updated_at', { ascending: false }),
    admin
      .from('result_workflow_events')
      .select('*')
      .eq('school_id', schoolId)
      .order('occurred_at', { ascending: false })
      .limit(500),
    admin
      .from('invoice_adjustments')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('guardians')
      .select('id,user_id,display_name,guardian_number,created_at,updated_at')
      .eq('school_id', schoolId)
      .order('display_name'),
    admin
      .from('guardian_student_links')
      .select('guardian_id,student_id,relationship,created_at')
      .eq('school_id', schoolId),
    admin
      .from('tenant_memberships')
      .select(
        'id,account_id,kind,status,lifecycle_state,external_reference,display_name,joined_at,suspended_at,ended_at,created_at,updated_at,accounts!tenant_memberships_account_id_fkey(id,display_name,primary_email,primary_phone,status,last_seen_at)',
      )
      .eq('school_id', schoolId)
      .order('display_name'),
    admin
      .from('authorization_roles')
      .select('id,school_id,code,name,description,is_system,is_assignable')
      .or(`school_id.is.null,school_id.eq.${schoolId}`)
      .order('name'),
    admin
      .from('membership_role_assignments')
      .select(
        'id,membership_id,role_id,resource_scope,valid_from,valid_until,authorization_roles(code,name)',
      )
      .eq('school_id', schoolId)
      .order('created_at'),
    admin
      .from('membership_lifecycle_events')
      .select(
        'id,membership_id,event_kind,from_state,to_state,reason,actor_account_id,metadata,occurred_at',
      )
      .eq('school_id', schoolId)
      .order('occurred_at', { ascending: false })
      .limit(500),
    admin
      .from('class_teacher_assignments')
      .select('class_id,teacher_user_id')
      .eq('school_id', schoolId),
    admin.from('classes').select('id,name,code,active').eq('school_id', schoolId).order('name'),
    admin.from('subjects').select('id,name,code,active').eq('school_id', schoolId).order('name'),
    admin
      .from('academic_terms')
      .select('id,session_id,name,position,starts_on,ends_on,status')
      .eq('school_id', schoolId)
      .order('starts_on', { ascending: false }),
    admin
      .from('attendance_corrections')
      .select('id,attendance_id,previous_status,corrected_status,reason,corrected_by,corrected_at')
      .eq('school_id', schoolId)
      .order('corrected_at', { ascending: false })
      .limit(500),
    admin
      .from('learning_classrooms')
      .select('id,session_id,class_id,subject_id,title,status')
      .eq('school_id', schoolId),
    admin
      .from('learning_classroom_memberships')
      .select('classroom_id,student_id,active')
      .eq('school_id', schoolId)
      .eq('member_kind', 'student'),
    admin
      .from('assignments')
      .select(
        'id,classroom_id,class_id,subject_id,title,instructions,due_at,maximum_score,status,published_at,released_at',
      )
      .eq('school_id', schoolId),
    admin
      .from('assignment_extensions')
      .select('assignment_id,student_id,extended_due_at')
      .eq('school_id', schoolId),
    admin
      .from('assignment_submissions')
      .select(
        'id,assignment_id,student_id,status,submitted_at,score,feedback,graded_at,released_at',
      )
      .eq('school_id', schoolId),
    admin
      .from('classroom_grade_items')
      .select('id,classroom_id,title,kind,maximum_score,weight,status')
      .eq('school_id', schoolId)
      .eq('status', 'released'),
    admin
      .from('classroom_grades')
      .select('id,grade_item_id,student_id,score,feedback,released_at')
      .eq('school_id', schoolId)
      .not('released_at', 'is', null),
    admin
      .from('classroom_stream_posts')
      .select('id,classroom_id,title,body,pinned,published_at,created_at')
      .eq('school_id', schoolId)
      .eq('kind', 'announcement')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(200),
    admin
      .from('applicant_guardians')
      .select('application_id,account_id,relationship,is_primary,can_receive_updates')
      .eq('school_id', schoolId)
      .eq('account_id', context.userId),
    admin
      .from('admission_applications')
      .select(
        'id,application_number,applicant_name,status,desired_class_id,submitted_at,last_status_changed_at,converted_student_id',
      )
      .eq('school_id', schoolId),
    admin
      .from('admission_offers')
      .select(
        'id,application_id,offer_number,offered_class_id,conditions,status,issued_at,expires_at,responded_at,response_note',
      )
      .eq('school_id', schoolId)
      .order('issued_at', { ascending: false }),
    admin
      .from('student_enrollments')
      .select('id,student_id,class_id,arm_id,session_id,enrolled_at,active')
      .eq('school_id', schoolId)
      .order('enrolled_at', { ascending: false }),
    admin
      .from('academic_sessions')
      .select('id,name,starts_on,ends_on,status')
      .eq('school_id', schoolId)
      .order('starts_on', { ascending: false }),
    admin.from('class_subjects').select('class_id,subject_id').eq('school_id', schoolId),
    admin
      .from('school_identifier_settings')
      .select('kind,format,next_number,padding,updated_at')
      .eq('school_id', schoolId)
      .order('kind'),
  ]);
  results.forEach((result, index) => {
    if (result.error) throw dependencyFailure(`core-portal.workspace.${index}`, result.error);
  });
  const records = (value: unknown): Record<string, unknown>[] =>
    z.array(z.record(z.string(), z.unknown())).parse(value ?? []);
  const allStudents = records(results[0].data);
  const assignments = records(results[9].data);
  const classTeacherAssignments = records(results[23].data).filter(
    (row) => String(row.teacher_user_id) === context.userId,
  );
  const teacherClassIds = new Set(
    [...assignments, ...classTeacherAssignments].map((row) => String(row.class_id)),
  );
  let visibleStudents = allStudents;
  if (context.scope.kind === 'self')
    visibleStudents = allStudents.filter((student) => String(student.user_id) === context.userId);
  else if (context.scope.kind === 'assigned-resources') {
    visibleStudents = allStudents.filter((student) =>
      teacherClassIds.has(String(student.class_id)),
    );
  } else if (context.scope.kind === 'linked-children') {
    const directGuardianIds = records(results[10].data).map((guardian) => String(guardian.id));
    const guardianMembershipIds = records(results[19].data)
      .filter(
        (membership) =>
          String(membership.account_id) === context.userId &&
          String(membership.kind) === 'guardian' &&
          ['active', 'invited'].includes(String(membership.status)),
      )
      .map((membership) => String(membership.id));
    const entityLinks =
      !directGuardianIds.length && guardianMembershipIds.length
        ? await admin
            .from('membership_entity_links')
            .select('entity_id')
            .eq('school_id', schoolId)
            .eq('entity_type', 'guardian')
            .in('membership_id', guardianMembershipIds)
        : { data: [], error: null };
    if (entityLinks.error)
      throw dependencyFailure('core-portal.workspace.guardian-identity-links', entityLinks.error);
    const entityGuardianIds = records(entityLinks.data).map((link) => String(link.entity_id));
    const guardianIds = [
      ...new Set(directGuardianIds.length ? directGuardianIds : entityGuardianIds),
    ];
    const studentIds = new Set(
      records(results[18].data)
        .filter((link) => guardianIds.includes(String(link.guardian_id)))
        .map((link) => String(link.student_id)),
    );
    visibleStudents = allStudents.filter((student) => studentIds.has(String(student.id)));
  }
  const visibleStudentIds = new Set(visibleStudents.map((student) => String(student.id)));
  const assignedClassIds = teacherClassIds;
  const assignedSubjectIds = new Set(
    assignments.map((assignment) => String(assignment.subject_id)),
  );
  let assessments = records(results[3].data).filter(
    (assessment) =>
      context.scope.kind !== 'assigned-resources' ||
      (assignedClassIds.has(String(assessment.class_id)) &&
        assignedSubjectIds.has(String(assessment.subject_id))),
  );
  const resultKey = (row: Record<string, unknown>) => {
    const reportType = typeof row.report_type === 'string' ? row.report_type : 'end_of_term';
    return `${String(row.term_id)}:${String(row.class_id)}:${reportType}`;
  };
  const releasedResultKeys = new Set(
    records(results[5].data)
      .filter((release) => String(release.status) === 'released')
      .map(resultKey),
  );
  if (['self', 'linked-children'].includes(context.scope.kind))
    assessments = assessments.filter((assessment) => releasedResultKeys.has(resultKey(assessment)));
  const assessmentIds = new Set(assessments.map((assessment) => String(assessment.id)));
  const schoolWide = context.scope.kind === 'school-wide' || context.scope.kind === 'platform';
  const memberships = records(results[11].data);
  const staffRows = records(results[1].data).map((member) => ({
    ...member,
    roles: memberships
      .filter(
        (membership) =>
          String(membership.user_id) === String(member.user_id) &&
          String(membership.status) !== 'revoked',
      )
      .map((membership) => String(membership.role)),
  }));
  const peopleMemberships = records(results[19].data);
  const peopleAccounts = Array.from(
    new Map(
      peopleMemberships.flatMap((membership) => {
        const account = membership.accounts;
        return account && typeof account === 'object'
          ? [
              [
                String((account as Record<string, unknown>).id),
                account as Record<string, unknown>,
              ] as const,
            ]
          : [];
      }),
    ).values(),
  );
  const isParent =
    context.scope.kind === 'linked-children' && context.permissions.has('children.read');
  const classroomMemberships = records(results[29].data).filter(
    (row) => row.active === true && visibleStudentIds.has(String(row.student_id)),
  );
  const classroomIds = new Set(classroomMemberships.map((row) => String(row.classroom_id)));
  const classroomRows = records(results[28].data).filter(
    (row) => classroomIds.has(String(row.id)) && String(row.status) === 'active',
  );
  const classroomById = new Map(classroomRows.map((row) => [String(row.id), row]));
  const extensions = records(results[31].data);
  const submissions = records(results[32].data).filter((row) =>
    visibleStudentIds.has(String(row.student_id)),
  );
  const now = Date.now();
  const parentWork = records(results[30].data).flatMap((assignment) => {
    if (
      !classroomIds.has(String(assignment.classroom_id)) ||
      !['published', 'closed', 'released'].includes(String(assignment.status))
    )
      return [];
    return classroomMemberships
      .filter((membership) => String(membership.classroom_id) === String(assignment.classroom_id))
      .map((membership) => {
        const studentId = String(membership.student_id);
        const extension = extensions.find(
          (row) =>
            String(row.assignment_id) === String(assignment.id) &&
            String(row.student_id) === studentId,
        );
        const submission = submissions.find(
          (row) =>
            String(row.assignment_id) === String(assignment.id) &&
            String(row.student_id) === studentId,
        );
        const effectiveDueAt = extension?.extended_due_at ?? assignment.due_at ?? null;
        return {
          ...assignment,
          student_id: studentId,
          effective_due_at: effectiveDueAt,
          submission_status: submission?.status ?? 'not_started',
          submitted_at: submission?.submitted_at ?? null,
          score: submission?.released_at ? (submission.score ?? null) : null,
          feedback: submission?.released_at ? (submission.feedback ?? null) : null,
        };
      });
  });
  const incomplete = (row: Record<string, unknown>) =>
    !['submitted', 'late', 'graded', 'released'].includes(String(row.submission_status));
  const dueTime = (row: Record<string, unknown>) =>
    typeof row.effective_due_at === 'string' ? Date.parse(row.effective_due_at) : Number.NaN;
  const upcoming = parentWork
    .filter((row) => incomplete(row) && dueTime(row) >= now)
    .sort((a, b) => dueTime(a) - dueTime(b));
  const overdue = parentWork
    .filter((row) => incomplete(row) && dueTime(row) < now)
    .sort((a, b) => dueTime(b) - dueTime(a));
  const gradeItems = records(results[33].data).filter((row) =>
    classroomIds.has(String(row.classroom_id)),
  );
  const gradeItemById = new Map(gradeItems.map((row) => [String(row.id), row]));
  const releasedGrades = records(results[34].data).filter(
    (row) =>
      visibleStudentIds.has(String(row.student_id)) && gradeItemById.has(String(row.grade_item_id)),
  );
  const summaries = visibleStudents.map((student) => {
    const studentId = String(student.id);
    const work = parentWork.filter((row) => String(row.student_id) === studentId);
    const grades = releasedGrades.filter((row) => String(row.student_id) === studentId);
    const percentages = grades.flatMap((grade) => {
      const item = gradeItemById.get(String(grade.grade_item_id));
      const maximum = Number(item?.maximum_score);
      return maximum > 0 ? [(Number(grade.score) / maximum) * 100] : [];
    });
    return {
      student_id: studentId,
      total_work: work.length,
      completed_work: work.filter((row) => !incomplete(row)).length,
      upcoming_work: upcoming.filter((row) => String(row.student_id) === studentId).length,
      overdue_work: overdue.filter((row) => String(row.student_id) === studentId).length,
      released_grade_count: grades.length,
      average_percent: percentages.length
        ? Math.round(
            (percentages.reduce((sum, value) => sum + value, 0) / percentages.length) * 10,
          ) / 10
        : null,
    };
  });
  const applicationLinks = records(results[36].data).filter(
    (row) => row.can_receive_updates === true,
  );
  const applicationIds = new Set(applicationLinks.map((row) => String(row.application_id)));
  for (const student of visibleStudents)
    if (student.id)
      records(results[37].data)
        .filter((row) => String(row.converted_student_id) === String(student.id))
        .forEach((row) => applicationIds.add(String(row.id)));
  const allEnrollments = records(results[39].data),
    allInvoices = records(results[7].data),
    allPayments = records(results[8].data);
  const applicableFees: Record<string, unknown>[] = records(results[6].data).flatMap((fee) =>
    visibleStudents.flatMap((student) => {
      if (fee.active === false) return [];
      const studentId = String(student.id),
        sessionId = String(fee.session_id);
      const enrollment = allEnrollments.find(
        (row) =>
          String(row.student_id) === studentId &&
          String(row.session_id) === sessionId &&
          row.active === true,
      );
      const feeSession = records(results[40].data).find((row) => String(row.id) === sessionId);
      if (!enrollment && String(feeSession?.status) !== 'active') return [];
      const effectiveClassId = String(enrollment?.class_id ?? student.class_id ?? '');
      const ids = Array.isArray(fee.class_ids) ? fee.class_ids.map(String) : [];
      const legacyClass = fee.class_id ? String(fee.class_id) : '';
      if (ids.length && (!effectiveClassId || !ids.includes(effectiveClassId))) return [];
      if (!ids.length && legacyClass && legacyClass !== effectiveClassId) return [];
      const returning = allEnrollments.some(
        (row) => String(row.student_id) === studentId && String(row.session_id) !== sessionId,
      );
      if (String(fee.student_audience) === 'new' && returning) return [];
      if (String(fee.student_audience) === 'returning' && !returning) return [];
      const invoice = allInvoices.find(
        (row) =>
          String(row.student_id) === studentId && String(row.fee_definition_id) === String(fee.id),
      );
      const paid = invoice
        ? allPayments
            .filter((row) => String(row.invoice_id) === String(invoice.id))
            .reduce((sum, row) => sum + Number(row.amount_minor), 0)
        : 0;
      const outstanding = Math.max(
        0,
        Number(invoice?.amount_minor ?? fee.amount_minor) -
          Number(invoice?.discount_minor ?? 0) -
          paid,
      );
      return outstanding > 0
        ? [
            {
              ...fee,
              student_id: studentId,
              invoice_id: invoice?.id ?? null,
              invoice_status: invoice?.status ?? 'not_invoiced',
              outstanding_minor: outstanding,
            } as Record<string, unknown>,
          ]
        : [];
    }),
  );
  const applicableFeeIds = new Set(applicableFees.map((row) => String(row.id)));
  return {
    students:
      context.permissions.has('students.read') ||
      context.permissions.has('self.read') ||
      (isParent && context.permissions.has('children.read'))
        ? visibleStudents.map((student) => ({
            ...Object.fromEntries(Object.entries(student).filter(([key]) => key !== 'user_id')),
            has_account: Boolean(student.user_id),
          }))
        : [],
    staff: schoolWide && context.permissions.has('staff.manage') ? staffRows : [],
    attendance:
      context.permissions.has('attendance.record') ||
      context.permissions.has('attendance.manage') ||
      ['self', 'linked-children'].includes(context.scope.kind)
        ? records(results[2].data).filter(
            (record) => schoolWide || visibleStudentIds.has(String(record.student_id)),
          )
        : [],
    assessments: context.permissions.has('results.read') ? assessments : [],
    scores: context.permissions.has('results.read')
      ? records(results[4].data).filter(
          (score) =>
            (schoolWide || visibleStudentIds.has(String(score.student_id))) &&
            assessmentIds.has(String(score.assessment_id)) &&
            (!['self', 'linked-children'].includes(context.scope.kind) ||
              assessments.some(
                (assessment) =>
                  String(assessment.id) === String(score.assessment_id) &&
                  releasedResultKeys.has(resultKey(assessment)),
              )),
        )
      : [],
    releases: context.permissions.has('results.read')
      ? records(results[5].data).filter(
          (release) =>
            schoolWide ||
            visibleStudents.some(
              (student) => String(student.class_id) === String(release.class_id),
            ),
        )
      : [],
    feeDefinitions: context.permissions.has('fees.read')
      ? schoolWide
        ? records(results[6].data)
        : records(results[6].data).filter((row) => applicableFeeIds.has(String(row.id)))
      : [],
    invoices: context.permissions.has('fees.read')
      ? records(results[7].data)
          .filter((invoice) => schoolWide || visibleStudentIds.has(String(invoice.student_id)))
          .map((invoice) => {
            const paidMinor = records(results[8].data)
              .filter((payment) => String(payment.invoice_id) === String(invoice.id))
              .reduce((sum, payment) => sum + Number(payment.amount_minor), 0);
            const netMinor = Number(invoice.amount_minor) - Number(invoice.discount_minor);
            return {
              ...invoice,
              paid_minor: paidMinor,
              outstanding_minor: Math.max(0, netMinor - paidMinor),
              credit_minor: Math.max(0, paidMinor - netMinor),
            };
          })
      : [],
    payments: context.permissions.has('fees.read')
      ? records(results[8].data).filter(
          (payment) => schoolWide || visibleStudentIds.has(String(payment.student_id)),
        )
      : [],
    manualTransfers: context.permissions.has('fees.read')
      ? records(results[12].data).filter(
          (transfer) => schoolWide || visibleStudentIds.has(String(transfer.student_id)),
        )
      : [],
    receipts: context.permissions.has('fees.read')
      ? records(results[13].data).filter(
          (receipt) =>
            schoolWide ||
            records(results[7].data).some(
              (invoice) =>
                String(invoice.id) === String(receipt.invoice_id) &&
                visibleStudentIds.has(String(invoice.student_id)),
            ),
        )
      : [],
    resultWorkflows: context.permissions.has('results.read')
      ? records(results[14].data).filter(
          (row) => schoolWide || assignedClassIds.has(String(row.class_id)),
        )
      : [],
    resultWorkflowEvents:
      schoolWide && context.permissions.has('results.read') ? records(results[15].data) : [],
    resultSummaries: context.permissions.has('results.read')
      ? records(schoolOwned.student_report_summaries).filter(
          (row) => schoolWide || visibleStudentIds.has(String(row.student_id)),
        )
      : [],
    resultPromotionRules:
      schoolWide && context.permissions.has('results.read')
        ? records(schoolOwned.result_promotion_rules)
        : [],
    resultComponentSettings: context.permissions.has('results.read')
      ? records(schoolOwned.result_component_settings)
      : [],
    resultSessionWeightSettings: context.permissions.has('results.read')
      ? records(schoolOwned.result_session_weight_settings)
      : [],
    resultScoreImports: context.permissions.has('results.read')
      ? records(schoolOwned.result_score_imports)
      : [],
    adjustments: context.permissions.has('fees.read')
      ? records(results[16].data).filter(
          (adjustment) =>
            schoolWide ||
            records(results[7].data).some(
              (invoice) =>
                String(invoice.id) === String(adjustment.invoice_id) &&
                visibleStudentIds.has(String(invoice.student_id)),
            ),
        )
      : [],
    guardians:
      schoolWide && context.permissions.has('membership.manage') ? records(results[17].data) : [],
    guardianLinks:
      schoolWide && context.permissions.has('membership.manage') ? records(results[18].data) : [],
    accounts: schoolWide && context.permissions.has('membership.manage') ? peopleAccounts : [],
    memberships:
      schoolWide && context.permissions.has('membership.manage')
        ? peopleMemberships.map(({ accounts: _accounts, ...membership }) => membership)
        : [],
    roles: schoolWide && context.permissions.has('roles.read') ? records(results[20].data) : [],
    roleAssignments:
      schoolWide && context.permissions.has('roles.read') ? records(results[21].data) : [],
    membershipEvents:
      schoolWide && context.permissions.has('membership.manage') ? records(results[22].data) : [],
    myClasses: records(results[24].data).filter(
      (row) =>
        schoolWide ||
        context.permissions.has('students.create') ||
        assignedClassIds.has(String(row.id)) ||
        visibleStudents.some((student) => String(student.class_id) === String(row.id)),
    ),
    myClassAssignments: schoolWide ? records(results[23].data) : classTeacherAssignments,
    mySubjectAssignments: assignments,
    academicTerms: records(results[26].data),
    academicSubjects: records(results[25].data),
    attendanceCorrections: context.permissions.has('attendance.manage')
      ? records(results[27].data)
      : [],
    parentLearningSummaries: isParent ? summaries : [],
    parentUpcomingWork: isParent ? upcoming : [],
    parentOverdueWork: isParent ? overdue : [],
    parentAnnouncements: isParent
      ? records(results[35].data).flatMap((row) =>
          classroomMemberships
            .filter((membership) => String(membership.classroom_id) === String(row.classroom_id))
            .map((membership) => ({
              ...row,
              student_id: membership.student_id,
              classroom_title: classroomById.get(String(row.classroom_id))?.title ?? 'Classroom',
            })),
        )
      : [],
    parentApplications: isParent
      ? records(results[37].data).filter((row) => applicationIds.has(String(row.id)))
      : [],
    parentOffers: isParent
      ? records(results[38].data).filter((row) => applicationIds.has(String(row.application_id)))
      : [],
    studentEnrollments:
      context.scope.kind === 'self'
        ? records(results[39].data).filter((row) => visibleStudentIds.has(String(row.student_id)))
        : [],
    academicSessions:
      context.permissions.has('academic.read') || context.permissions.has('self.read')
        ? records(results[40].data)
        : [],
    studentClassSubjects:
      context.scope.kind === 'self'
        ? records(results[41].data).filter((row) =>
            visibleStudents.some((student) => String(student.class_id) === String(row.class_id)),
          )
        : [],
    identifierSettings:
      schoolWide && context.permissions.has('students.create') ? records(results[42].data) : [],
    identifierProfiles:
      schoolWide && context.permissions.has('students.create')
        ? records(schoolOwned.school_identifier_profiles)
        : [],
    paymentSettings:
      context.permissions.has('fees.read') &&
      schoolOwned.school_payment_settings &&
      typeof schoolOwned.school_payment_settings === 'object'
        ? (schoolOwned.school_payment_settings as Record<string, unknown>)
        : null,
    payableFees: context.permissions.has('fees.read') ? applicableFees : [],
  };
}

async function executeCorePortalCommand(
  bindings: Bindings,
  input: Parameters<CorePortalGateway['execute']>[1],
) {
  const admin = client(bindings);
  const command = input.command;
  let entity = command.operation.split('.')[0] ?? 'record';
  let result: { data: unknown; error: { message: string; code?: string } | null };

  if (command.operation === 'student.create') {
    let admissionNumber = command.admissionNumber?.trim();
    if (!admissionNumber) {
      const generated = await admin.rpc('next_scoped_school_identifier', {
        _school_id: input.schoolId,
        _kind: 'admission',
        _name: `${command.firstName} ${command.lastName}`,
        _class_id: command.classId ?? null,
      });
      if (generated.error) throw dependencyFailure('core-portal.student-number', generated.error);
      admissionNumber = String(generated.data);
    }
    result = await admin
      .from('students')
      .insert({
        school_id: input.schoolId,
        admission_number: admissionNumber,
        first_name: command.firstName,
        last_name: command.lastName,
        full_name: `${command.firstName} ${command.lastName}`,
        class_id: command.classId ?? null,
        guardian_phone: command.guardianPhone ?? null,
      })
      .select()
      .single();
  } else if (command.operation === 'student.update')
    result = await admin
      .from('students')
      .update({
        first_name: command.firstName,
        last_name: command.lastName,
        full_name: `${command.firstName} ${command.lastName}`,
        class_id: command.classId ?? null,
        guardian_phone: command.guardianPhone ?? null,
        status: command.status,
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
  else if (command.operation === 'student.invite') {
    const student = await admin
      .from('students')
      .select('id,user_id,admission_number,full_name')
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .single();
    if (student.error) throw dependencyFailure('core-portal.student.identity', student.error);
    if (student.data.user_id)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This student already has an account.',
        status: 409,
      });
    const displayName = String(student.data.full_name);
    const portalDomain = await admin
      .from('tenant_domains')
      .select('hostname')
      .eq('school_id', input.schoolId)
      .eq('domain_type', 'portal')
      .eq('status', 'active')
      .eq('is_primary', true)
      .maybeSingle();
    if (portalDomain.error)
      throw dependencyFailure('core-portal.student.invite-domain', portalDomain.error);
    const portalOrigin = portalDomain.data?.hostname
      ? `https://${String(portalDomain.data.hostname)}`
      : bindings.PORTAL_ORIGIN.replace(/\/$/, '');
    const invited = await admin.auth.admin.generateLink({
      type: 'invite',
      email: command.email,
      options: {
        data: { display_name: displayName },
        redirectTo: `${portalOrigin}/auth/invite`,
      },
    });
    if (invited.error) throw dependencyFailure('core-portal.student.invite', invited.error);
    const userId = invited.data.user.id;
    try {
      const [profile, linked, legacy] = await Promise.all([
        admin
          .from('profiles')
          .upsert(
            { user_id: userId, display_name: displayName, email: command.email },
            { onConflict: 'user_id' },
          ),
        admin
          .from('students')
          .update({ user_id: userId })
          .eq('school_id', input.schoolId)
          .eq('id', command.id)
          .is('user_id', null)
          .select()
          .single(),
        admin.from('school_memberships').insert({
          school_id: input.schoolId,
          user_id: userId,
          role: 'student',
          status: 'invited',
          invited_by: input.actorId,
        }),
      ]);
      if (profile.error || linked.error || legacy.error)
        throw profile.error ?? linked.error ?? legacy.error;
      const membership = await admin.rpc('provision_person_membership', {
        _school_id: input.schoolId,
        _account_id: userId,
        _kind: 'student',
        _display_name: displayName,
        _external_reference: String(student.data.admission_number),
        _role_code: 'student',
        _entity_type: 'student',
        _entity_id: command.id,
        _actor_id: input.actorId,
      });
      if (membership.error) throw membership.error;
      const emailId = await sendSchoolEmail(bindings, {
        schoolId: input.schoolId,
        to: command.email,
        subject: 'Your student portal invitation',
        lines: [
          `Hello ${displayName},`,
          'Your student portal account is ready.',
          'Use the secure button below to accept this invitation and choose your password.',
        ],
        key: `student-invite/${input.schoolId}/${userId}`,
        actionUrl: invited.data.properties.action_link,
        actionLabel: 'Accept invitation',
      });
      if (!emailId) throw new Error('Invitation email delivery failed.');
      result = { data: { ...membership.data, userId, studentId: command.id }, error: null };
    } catch (cause) {
      await admin.auth.admin.deleteUser(userId);
      throw dependencyFailure('core-portal.student.invite', cause);
    }
  } else if (command.operation === 'identifier.settings.update')
    result = await admin
      .from('school_identifier_settings')
      .upsert(
        {
          school_id: input.schoolId,
          kind: command.kind,
          format: command.format,
          next_number: command.nextNumber,
          padding: command.padding,
          updated_by: input.actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'school_id,kind' },
      )
      .select()
      .single();
  else if (command.operation === 'identifier.profile.upsert') {
    const values = {
      school_id: input.schoolId,
      name: command.name,
      class_id: command.classId,
      format: command.format,
      next_number: command.nextNumber,
      padding: command.padding,
      updated_by: input.actorId,
      updated_at: new Date().toISOString(),
    };
    result = command.id
      ? await admin
          .from('school_identifier_profiles')
          .update(values)
          .eq('school_id', input.schoolId)
          .eq('id', command.id)
          .select()
          .single()
      : await admin
          .from('school_identifier_profiles')
          .upsert(values, { onConflict: 'school_id,class_id' })
          .select()
          .single();
  } else if (command.operation === 'identifier.profile.delete')
    result = await admin
      .from('school_identifier_profiles')
      .delete()
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
  else if (command.operation === 'staff.create') {
    if (command.teachingAssignments?.length) {
      const validAssignments = await admin
        .from('class_subjects')
        .select('class_id,subject_id')
        .eq('school_id', input.schoolId);
      if (validAssignments.error)
        throw dependencyFailure('core-portal.staff.assignment-validation', validAssignments.error);
      const validPairs = new Set(
        (validAssignments.data ?? []).map((row) => `${row.class_id}:${row.subject_id}`),
      );
      if (
        command.teachingAssignments.some(
          (assignment) => !validPairs.has(`${assignment.classId}:${assignment.subjectId}`),
        )
      )
        throw new AppError({
          code: 'BAD_REQUEST',
          message: 'Choose only class and subject combinations configured in Academic setup.',
          status: 400,
        });
    }
    const orphanedStaff = await admin
      .from('staff_profiles')
      .delete()
      .eq('school_id', input.schoolId)
      .is('user_id', null)
      .or(`employee_number.eq.${command.employeeNumber},email.eq.${command.email}`);
    if (orphanedStaff.error)
      throw dependencyFailure('core-portal.staff.orphan-cleanup', orphanedStaff.error);
    const portalDomain = await admin
      .from('tenant_domains')
      .select('hostname')
      .eq('school_id', input.schoolId)
      .eq('domain_type', 'portal')
      .eq('status', 'active')
      .eq('is_primary', true)
      .maybeSingle();
    if (portalDomain.error)
      throw dependencyFailure('core-portal.staff.invite-domain', portalDomain.error);
    const portalOrigin = portalDomain.data?.hostname
      ? `https://${String(portalDomain.data.hostname)}`
      : bindings.PORTAL_ORIGIN.replace(/\/$/, '');
    const invited = await admin.auth.admin.generateLink({
      type: 'invite',
      email: command.email,
      options: {
        data: { display_name: command.fullName },
        redirectTo: `${portalOrigin}/auth/invite`,
      },
    });
    if (invited.error) throw dependencyFailure('core-portal.staff.invite', invited.error);
    const userId = invited.data.user.id;
    try {
      const profile = await admin
        .from('profiles')
        .upsert(
          { user_id: userId, display_name: command.fullName, email: command.email },
          { onConflict: 'user_id' },
        );
      if (profile.error) throw profile.error;
      const membership = await admin.from('school_memberships').insert({
        school_id: input.schoolId,
        user_id: userId,
        role: command.role,
        status: 'invited',
        invited_by: input.actorId,
      });
      if (membership.error) throw membership.error;
      result = await admin
        .from('staff_profiles')
        .insert({
          school_id: input.schoolId,
          user_id: userId,
          employee_number: command.employeeNumber,
          full_name: command.fullName,
          email: command.email,
        })
        .select()
        .single();
      if (result.error) throw dependencyFailure('core-portal.staff.record', result.error);
      const staffId = z.object({ id: z.string().uuid() }).parse(result.data).id;
      const kind = ['school_admin'].includes(command.role)
        ? 'administrator'
        : command.role === 'teacher'
          ? 'teacher'
          : 'specialist';
      const canonical = await admin.rpc('provision_person_membership', {
        _school_id: input.schoolId,
        _account_id: userId,
        _kind: kind,
        _display_name: command.fullName,
        _external_reference: command.employeeNumber,
        _role_code: command.role,
        _entity_type: 'staff_profile',
        _entity_id: staffId,
        _actor_id: input.actorId,
      });
      if (canonical.error) throw canonical.error;
      if (command.role === 'teacher' && command.teachingAssignments?.length) {
        const assignments = await admin.from('teacher_class_subject_assignments').upsert(
          command.teachingAssignments.map((assignment) => ({
            school_id: input.schoolId,
            teacher_user_id: userId,
            class_id: assignment.classId,
            subject_id: assignment.subjectId,
          })),
          { onConflict: 'teacher_user_id,class_id,subject_id' },
        );
        if (assignments.error) throw assignments.error;
      }
      if (command.role === 'teacher' && command.classTeacherClassIds?.length) {
        const classTeachers = await admin.from('class_teacher_assignments').upsert(
          command.classTeacherClassIds.map((classId) => ({
            school_id: input.schoolId,
            teacher_user_id: userId,
            class_id: classId,
            assigned_by: input.actorId,
          })),
          { onConflict: 'class_id' },
        );
        if (classTeachers.error) throw classTeachers.error;
      }
      const emailId = await sendSchoolEmail(bindings, {
        schoolId: input.schoolId,
        to: command.email,
        subject: 'Your staff portal invitation',
        lines: [
          `Hello ${command.fullName},`,
          'Your staff portal account is ready.',
          'Use the secure button below to accept this invitation and choose your password.',
        ],
        key: `staff-invite/${input.schoolId}/${userId}`,
        actionUrl: invited.data.properties.action_link,
        actionLabel: 'Accept staff invitation',
      });
      void emailId;
    } catch (cause) {
      await admin
        .from('staff_profiles')
        .delete()
        .eq('school_id', input.schoolId)
        .eq('user_id', userId);
      await admin
        .from('tenant_memberships')
        .delete()
        .eq('school_id', input.schoolId)
        .eq('account_id', userId);
      await admin
        .from('school_memberships')
        .delete()
        .eq('school_id', input.schoolId)
        .eq('user_id', userId);
      await admin.auth.admin.deleteUser(userId);
      throw dependencyFailure('core-portal.staff.create', cause);
    }
  } else if (command.operation === 'staff.deactivate') {
    result = await admin
      .from('staff_profiles')
      .update({ status: 'inactive' })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
    const row = result.data as { user_id?: string | null } | null;
    if (!result.error && row?.user_id) {
      const memberships = await admin
        .from('school_memberships')
        .update({ status: 'suspended' })
        .eq('school_id', input.schoolId)
        .eq('user_id', row.user_id);
      if (memberships.error)
        throw dependencyFailure('core-portal.staff.deactivate', memberships.error);
      const canonical = await admin
        .from('tenant_memberships')
        .select('id')
        .eq('school_id', input.schoolId)
        .eq('account_id', row.user_id)
        .in('kind', ['teacher', 'administrator', 'specialist']);
      if (canonical.error) throw dependencyFailure('core-portal.staff.membership', canonical.error);
      for (const membership of canonical.data ?? []) {
        const transitioned = await admin.rpc('manage_person_membership', {
          _school_id: input.schoolId,
          _membership_id: membership.id,
          _status: 'suspended',
          _lifecycle_state: 'inactive_staff',
          _reason: 'Staff access deactivated.',
          _actor_id: input.actorId,
        });
        if (transitioned.error)
          throw dependencyFailure('core-portal.staff.deactivate-membership', transitioned.error);
      }
    }
  } else if (command.operation === 'staff.reactivate') {
    result = await admin
      .from('staff_profiles')
      .update({ status: 'active' })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
    const row = result.data as { user_id?: string | null } | null;
    if (!result.error && row?.user_id) {
      const legacy = await admin
        .from('school_memberships')
        .update({ status: 'active' })
        .eq('school_id', input.schoolId)
        .eq('user_id', row.user_id);
      if (legacy.error) throw dependencyFailure('core-portal.staff.reactivate', legacy.error);
      const canonical = await admin
        .from('tenant_memberships')
        .select('id')
        .eq('school_id', input.schoolId)
        .eq('account_id', row.user_id)
        .in('kind', ['teacher', 'administrator', 'specialist']);
      if (canonical.error) throw dependencyFailure('core-portal.staff.membership', canonical.error);
      for (const membership of canonical.data ?? []) {
        const transitioned = await admin.rpc('manage_person_membership', {
          _school_id: input.schoolId,
          _membership_id: membership.id,
          _status: 'active',
          _lifecycle_state: 'active',
          _reason: 'Staff access reactivated.',
          _actor_id: input.actorId,
        });
        if (transitioned.error)
          throw dependencyFailure('core-portal.staff.reactivate-membership', transitioned.error);
      }
    }
  } else if (command.operation === 'membership.transition')
    result = await admin.rpc('manage_person_membership', {
      _school_id: input.schoolId,
      _membership_id: command.membershipId,
      _status: command.status,
      _lifecycle_state: command.lifecycleState,
      _reason: command.reason,
      _actor_id: input.actorId,
    });
  else if (command.operation === 'membership.role.assign')
    result = await admin.rpc('assign_person_role', {
      _school_id: input.schoolId,
      _membership_id: command.membershipId,
      _role_id: command.roleId,
      _actor_id: input.actorId,
    });
  else if (command.operation === 'membership.role.revoke')
    result = await admin.rpc('revoke_person_role', {
      _school_id: input.schoolId,
      _assignment_id: command.assignmentId,
      _actor_id: input.actorId,
    });
  else if (command.operation === 'attendance.record')
    result = await admin
      .rpc('capture_class_attendance', {
        _school_id: input.schoolId,
        _class_id: command.classId,
        _term_id: command.termId,
        _date: command.date,
        _entries: [
          { studentId: command.studentId, status: command.status, note: command.note ?? null },
        ],
        _actor_id: input.actorId,
      })
      .single();
  else if (command.operation === 'attendance.capture') {
    entity = 'attendance';
    const captured = await admin.rpc('capture_class_attendance', {
      _school_id: input.schoolId,
      _class_id: command.classId,
      _term_id: command.termId,
      _date: command.date,
      _entries: command.entries,
      _actor_id: input.actorId,
    });
    result = { data: { captured: captured.data?.length ?? 0 }, error: captured.error };
  } else if (command.operation === 'attendance.correct') {
    entity = 'attendance';
    result = await admin
      .rpc('correct_attendance', {
        _school_id: input.schoolId,
        _attendance_id: command.attendanceId,
        _status: command.status,
        _note: command.note ?? null,
        _reason: command.reason,
        _actor_id: input.actorId,
      })
      .single();
  } else if (command.operation === 'assessment.create') {
    entity = 'assessment';
    result = await admin
      .from('assessment_definitions')
      .insert({
        school_id: input.schoolId,
        term_id: command.termId,
        class_id: command.classId,
        subject_id: command.subjectId,
        name: command.name,
        maximum_score: command.maximumScore,
        weight_percent: command.weightPercent,
        created_by: input.actorId,
      })
      .select()
      .single();
  } else if (command.operation === 'result.record')
    result = await admin
      .from('result_scores')
      .upsert(
        {
          school_id: input.schoolId,
          assessment_id: command.assessmentId,
          student_id: command.studentId,
          score: command.score,
          remark: command.remark ?? null,
          recorded_by: input.actorId,
        },
        { onConflict: 'assessment_id,student_id' },
      )
      .select()
      .single();
  else if (command.operation === 'result.report.ensure') {
    entity = 'assessment';
    const ensured = await admin.rpc('ensure_result_report', {
      _school: input.schoolId,
      _term: command.termId,
      _class: command.classId,
      _report_type: command.reportType,
      _actor: input.actorId,
    });
    result = {
      data: { created: Array.isArray(ensured.data) ? ensured.data.length : 0 },
      error: ensured.error,
    };
  } else if (command.operation === 'result.scores.bulk') {
    entity = 'result_score';
    const saved = await admin.rpc('save_result_scores_bulk', {
      _school: input.schoolId,
      _assessment: command.assessmentId,
      _entries: command.entries,
      _actor: input.actorId,
    });
    result = {
      data: { saved: typeof saved.data === 'number' ? saved.data : 0 },
      error: saved.error,
    };
  } else if (command.operation === 'result.components.configure') {
    entity = 'result_component_setting';
    result = await admin.rpc('configure_result_components', {
      _school: input.schoolId,
      _term: command.termId,
      _class: command.classId,
      _report_type: command.reportType,
      _ca: command.continuousAssessmentPercent,
      _exam: command.examinationPercent,
      _actor: input.actorId,
    });
  } else if (command.operation === 'result.subject-scores.bulk') {
    entity = 'result_score';
    const saved = await admin.rpc('save_subject_result_scores_bulk', {
      _school: input.schoolId,
      _ca_assessment: command.continuousAssessmentId,
      _exam_assessment: command.examinationId,
      _entries: command.entries,
      _actor: input.actorId,
    });
    result = {
      data: { saved: typeof saved.data === 'number' ? saved.data : 0 },
      error: saved.error,
    };
  } else if (command.operation === 'result.period-policy.configure') {
    entity = 'result_component_setting';
    result = await admin.rpc('configure_result_period_policy', {
      _school: input.schoolId,
      _term: command.termId,
      _class: command.classId,
      _midterm_ca_only: command.midtermCaOnly,
      _ca: command.continuousAssessmentPercent,
      _exam: command.examinationPercent,
      _actor: input.actorId,
    });
  } else if (command.operation === 'result.midterm.import') {
    entity = 'result_score_import';
    const imported = await admin.rpc('import_midterm_scores_to_end_term', {
      _school: input.schoolId,
      _term: command.termId,
      _class: command.classId,
      _actor: input.actorId,
    });
    result = {
      data: { imported: typeof imported.data === 'number' ? imported.data : 0 },
      error: imported.error,
    };
  } else if (command.operation === 'result.session-weights.configure') {
    entity = 'result_session_weight_setting';
    result = await admin.rpc('configure_result_session_weights', {
      _school: input.schoolId,
      _session: command.sessionId,
      _class: command.classId,
      _first: command.firstTermPercent,
      _second: command.secondTermPercent,
      _third: command.thirdTermPercent,
      _actor: input.actorId,
    });
  } else if (command.operation === 'result.session.build') {
    entity = 'result_score';
    const calculated = await admin.rpc('build_end_of_session_results', {
      _school: input.schoolId,
      _session: command.sessionId,
      _class: command.classId,
      _actor: input.actorId,
    });
    result = {
      data: { calculated: typeof calculated.data === 'number' ? calculated.data : 0 },
      error: calculated.error,
    };
  } else if (command.operation === 'result.summary.save') {
    entity = 'student_report_summary';
    result = await admin
      .from('student_report_summaries')
      .upsert(
        {
          school_id: input.schoolId,
          term_id: command.termId,
          class_id: command.classId,
          student_id: command.studentId,
          report_type: command.reportType,
          teacher_remark: command.teacherRemark ?? null,
          principal_remark: command.principalRemark ?? null,
          attendance_present: command.attendancePresent ?? null,
          attendance_total: command.attendanceTotal ?? null,
          updated_by: input.actorId,
        },
        { onConflict: 'school_id,term_id,class_id,student_id,report_type' },
      )
      .select()
      .single();
  } else if (command.operation === 'result.summaries.bulk') {
    entity = 'student_report_summary';
    const saved = await admin.rpc('save_result_summaries_bulk', {
      _school: input.schoolId,
      _term: command.termId,
      _class: command.classId,
      _report_type: command.reportType,
      _student_ids: command.studentIds,
      _teacher_remark: command.teacherRemark ?? null,
      _principal_remark: command.principalRemark ?? null,
      _actor: input.actorId,
    });
    result = { data: { saved: Number(saved.data ?? 0) }, error: saved.error };
  } else if (command.operation === 'result.promotion-rule.save') {
    entity = 'result_promotion_rule';
    result = await admin
      .from('result_promotion_rules')
      .upsert(
        {
          school_id: input.schoolId,
          class_id: command.classId,
          report_type: command.reportType,
          minimum_average_percent: command.minimumAveragePercent,
          subject_requirements: command.subjectRequirements,
          active: true,
          updated_by: input.actorId,
        },
        { onConflict: 'school_id,class_id,report_type' },
      )
      .select()
      .single();
  } else if (
    command.operation === 'result.submit' ||
    command.operation === 'result.approve' ||
    command.operation === 'result.reject' ||
    command.operation === 'result.release' ||
    command.operation === 'result.reopen'
  ) {
    entity = 'result_workflow';
    const current = await admin
      .from('result_workflows')
      .select('*')
      .eq('school_id', input.schoolId)
      .eq('term_id', command.termId)
      .eq('class_id', command.classId)
      .eq('report_type', command.reportType)
      .maybeSingle();
    if (current.error) throw dependencyFailure('results.workflow.find', current.error);
    const from = String(current.data?.status ?? 'draft');
    const target = {
      'result.submit': 'submitted',
      'result.approve': 'approved',
      'result.reject': 'reopened',
      'result.release': 'released',
      'result.reopen': 'reopened',
    }[command.operation];
    const allowed: Record<string, string[]> = {
      submitted: ['draft', 'reopened'],
      approved: ['submitted'],
      released: ['approved'],
      reopened: ['submitted', 'approved', 'released'],
    };
    if (!allowed[target]?.includes(from))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: `Results cannot move from ${from} to ${target}.`,
        status: 409,
      });
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      school_id: input.schoolId,
      term_id: command.termId,
      class_id: command.classId,
      report_type: command.reportType,
      status: target,
      review_note: command.note ?? null,
    };
    if (target === 'submitted')
      Object.assign(patch, { submitted_by: input.actorId, submitted_at: now });
    if (target === 'approved')
      Object.assign(patch, { approved_by: input.actorId, approved_at: now });
    if (target === 'released')
      Object.assign(patch, { released_by: input.actorId, released_at: now });
    if (target === 'reopened')
      Object.assign(patch, {
        revision: Number(current.data?.revision ?? 1) + 1,
        released_by: null,
        released_at: null,
      });
    result = await admin
      .from('result_workflows')
      .upsert(patch, { onConflict: 'school_id,term_id,class_id,report_type' })
      .select()
      .single();
    if (!result.error) {
      const event = await admin.from('result_workflow_events').insert({
        school_id: input.schoolId,
        workflow_id: (result.data as { id: string }).id,
        from_status: from,
        to_status: target,
        actor_id: input.actorId,
        note: command.note ?? null,
      });
      if (event.error) throw dependencyFailure('results.workflow.event', event.error);
      if (target === 'released') {
        const legacy = await admin.from('result_releases').upsert(
          {
            school_id: input.schoolId,
            term_id: command.termId,
            class_id: command.classId,
            report_type: command.reportType,
            status: 'released',
            released_by: input.actorId,
            released_at: now,
          },
          { onConflict: 'school_id,term_id,class_id,report_type' },
        );
        if (legacy.error) throw dependencyFailure('results.release.visibility', legacy.error);
      } else if (target === 'reopened')
        await admin
          .from('result_releases')
          .delete()
          .eq('school_id', input.schoolId)
          .eq('term_id', command.termId)
          .eq('class_id', command.classId)
          .eq('report_type', command.reportType);
      if (target === 'reopened') {
        const refreshed = await admin.rpc('ensure_result_report', {
          _school: input.schoolId,
          _term: command.termId,
          _class: command.classId,
          _report_type: command.reportType,
          _actor: input.actorId,
        });
        if (refreshed.error)
          throw dependencyFailure('results.reopen.refresh-subjects', refreshed.error);
      }
      if (target === 'released')
        await notifyFamiliesAboutResults(bindings, {
          schoolId: input.schoolId,
          termId: command.termId,
          classId: command.classId,
          reportType: command.reportType,
          workflowId: String((result.data as { id: string }).id),
        });
      if (command.operation === 'result.reject')
        await notifyClassTeachersAboutResultRejection(bindings, {
          schoolId: input.schoolId,
          termId: command.termId,
          classId: command.classId,
          reportType: command.reportType,
          workflowId: String((result.data as { id: string }).id),
          note: command.note,
        });
    }
  } else if (command.operation === 'payment.settings.update') {
    entity = 'school_payment_settings';
    result = await admin
      .from('school_payment_settings')
      .upsert(
        {
          school_id: input.schoolId,
          paystack_enabled: command.paystackEnabled,
          manual_transfer_enabled: command.manualTransferEnabled,
          bank_name: command.bankName,
          account_name: command.accountName,
          account_number: command.accountNumber,
          transfer_instructions: command.transferInstructions,
          installments_enabled: command.installmentsEnabled,
          minimum_installment_percent: command.minimumInstallmentPercent,
          maximum_installments: command.installmentsEnabled ? command.maximumInstallments : 1,
          updated_by: input.actorId,
        },
        { onConflict: 'school_id' },
      )
      .select()
      .single();
  } else if (command.operation === 'fee.create') {
    entity = 'fee_definition';
    result = await admin
      .from('fee_definitions')
      .insert({
        school_id: input.schoolId,
        session_id: command.sessionId,
        term_id: command.termId ?? null,
        class_id: command.classId ?? null,
        class_ids: command.classIds,
        student_audience: command.studentAudience,
        name: command.name,
        amount_minor: command.amountMinor,
      })
      .select()
      .single();
  } else if (command.operation === 'fee.update') {
    entity = 'fee_definition';
    result = await admin.rpc('update_unpaid_fee_definition', {
      _school: input.schoolId,
      _fee: command.feeDefinitionId,
      _session: command.sessionId,
      _term: command.termId ?? null,
      _class_ids: command.classIds,
      _student_audience: command.studentAudience,
      _name: command.name,
      _amount_minor: command.amountMinor,
      _actor: input.actorId,
    });
    if (result.error?.code === 'P0002')
      throw new AppError({ code: 'NOT_FOUND', message: 'Fee definition not found.', status: 404 });
    if (result.error?.code === '23514')
      throw new AppError({ code: 'BAD_REQUEST', message: result.error.message, status: 409 });
  } else if (command.operation === 'fee.delete') {
    entity = 'fee_definition';
    result = await admin.rpc('delete_unpaid_fee_definition', {
      _school: input.schoolId,
      _fee: command.feeDefinitionId,
      _actor: input.actorId,
    });
    if (result.error?.code === 'P0002')
      throw new AppError({ code: 'NOT_FOUND', message: 'Fee definition not found.', status: 404 });
    if (result.error?.code === '42501')
      throw new AppError({ code: 'PERMISSION_DENIED', message: result.error.message, status: 403 });
    if (result.error?.code === '23514')
      throw new AppError({ code: 'BAD_REQUEST', message: result.error.message, status: 409 });
  } else if (command.operation === 'invoice.claim') {
    entity = 'fee_invoice';
    result = await admin.rpc('claim_fee_invoice', {
      _school: input.schoolId,
      _student: command.studentId,
      _fee: command.feeDefinitionId,
      _actor: input.actorId,
    });
    if (result.error?.code === '42501')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You cannot pay fees for this student.',
        status: 403,
      });
    if (result.error?.code === '23514')
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This fee does not apply to the selected student.',
        status: 409,
      });
  } else if (command.operation === 'invoice.bulk.create') {
    entity = 'fee_invoice_batch';
    result = await admin.rpc('issue_fee_to_eligible_students', {
      _school: input.schoolId,
      _fee: command.feeDefinitionId,
      _due_on: command.dueOn ?? null,
      _actor: input.actorId,
    });
    if (!result.error) result = { ...result, data: { invoiceCount: Number(result.data ?? 0) } };
  } else if (command.operation === 'invoice.create') {
    const definition = await admin
      .from('fee_definitions')
      .select('amount_minor')
      .eq('school_id', input.schoolId)
      .eq('id', command.feeDefinitionId)
      .single();
    if (definition.error) throw dependencyFailure('core-portal.invoice.fee', definition.error);
    result = await admin
      .from('fee_invoices')
      .insert({
        school_id: input.schoolId,
        student_id: command.studentId,
        fee_definition_id: command.feeDefinitionId,
        amount_minor: definition.data.amount_minor,
        discount_minor: command.discountMinor,
        due_on: command.dueOn ?? null,
        created_by: input.actorId,
      })
      .select()
      .single();
  } else if (command.operation === 'invoice.adjust') {
    entity = 'invoice_adjustment';
    const invoice = await admin
      .from('fee_invoices')
      .select('amount_minor,discount_minor,status')
      .eq('school_id', input.schoolId)
      .eq('id', command.invoiceId)
      .single();
    if (invoice.error) throw dependencyFailure('finance.adjust.invoice', invoice.error);
    const amount = Number(invoice.data.amount_minor),
      discount = Number(invoice.data.discount_minor);
    if (command.kind === 'credit' && discount + command.amountMinor > amount)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Credit cannot exceed the invoice amount.',
        status: 409,
      });
    result = await admin
      .from('invoice_adjustments')
      .insert({
        school_id: input.schoolId,
        invoice_id: command.invoiceId,
        kind: command.kind,
        amount_minor: command.amountMinor,
        reason: command.reason,
        created_by: input.actorId,
      })
      .select()
      .single();
    if (!result.error) {
      const update =
        command.kind === 'credit'
          ? { discount_minor: discount + command.amountMinor }
          : { amount_minor: amount + command.amountMinor };
      const updated = await admin
        .from('fee_invoices')
        .update({ ...update, status: 'unpaid' })
        .eq('school_id', input.schoolId)
        .eq('id', command.invoiceId);
      if (updated.error) throw dependencyFailure('finance.adjust.balance', updated.error);
      await admin.from('finance_audit_events').insert({
        school_id: input.schoolId,
        actor_id: input.actorId,
        action: 'invoice.adjusted',
        entity_type: 'invoice',
        entity_id: command.invoiceId,
        before_state: invoice.data,
        after_state: update,
        metadata: { kind: command.kind, reason: command.reason },
      });
    }
  } else {
    entity = 'payment';
    result = await admin
      .from('fee_payments')
      .insert({
        school_id: input.schoolId,
        student_id: command.studentId,
        invoice_id: command.invoiceId,
        amount_minor: command.amountMinor,
        provider: 'manual',
        provider_reference: command.providerReference,
        recorded_by: input.actorId,
        paid_at: command.paidAt,
      })
      .select()
      .single();
    if (!result.error) {
      const paymentRow = result.data as Record<string, unknown>;
      const receipt = await admin.from('payment_receipts').insert({
        school_id: input.schoolId,
        payment_id: paymentRow.id,
        invoice_id: command.invoiceId,
        receipt_number: `RCT-${Date.now()}-${command.providerReference.slice(-6).toUpperCase()}`,
        issued_to: 'School account payer',
        amount_minor: command.amountMinor,
        currency: 'NGN',
        metadata: {
          provider: 'manual',
          reference: command.providerReference,
          installmentNumber: paymentRow.installment_number,
          balanceAfterMinor: paymentRow.balance_after_minor,
          paymentStatus: Number(paymentRow.balance_after_minor) === 0 ? 'paid_in_full' : 'partial',
        },
      });
      if (receipt.error) throw dependencyFailure('core-portal.payment.receipt', receipt.error);
    }
  }

  if (result.error) {
    if (
      command.operation === 'attendance.record' ||
      command.operation === 'attendance.capture' ||
      command.operation === 'attendance.correct'
    ) {
      if (result.error.code === '42501')
        throw new AppError({
          code: 'PERMISSION_DENIED',
          message: result.error.message,
          status: 403,
        });
      if (result.error.code === '23514' || result.error.code === 'P0002')
        throw new AppError({
          code: 'BAD_REQUEST',
          message: result.error.message,
          status: 409,
        });
    }
    if (
      command.operation === 'payment.record' &&
      (result.error.code === '23514' || result.error.code === 'P0002')
    )
      throw new AppError({ code: 'BAD_REQUEST', message: result.error.message, status: 409 });
    throw dependencyFailure(`core-portal.${command.operation}`, result.error);
  }
  const saved = z.record(z.string(), z.unknown()).parse(result.data);
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: command.operation,
    entity,
    ...(typeof saved.id === 'string' ? { entityId: saved.id } : {}),
  });
  if (command.operation === 'fee.create' && typeof saved.id === 'string')
    try {
      await notifyGuardiansAboutFee(bindings, {
        schoolId: input.schoolId,
        feeId: saved.id,
        feeName: command.name,
        amountMinor: command.amountMinor,
      });
    } catch (error) {
      structuredLog('error', {
        type: 'fee_guardian_notification',
        environment: bindings.APP_ENV,
        schoolId: input.schoolId,
        outcome: 'failed',
        errorCode: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
      });
    }
  return saved;
}

async function canInitiateOnlinePayment(
  bindings: Bindings,
  input: {
    schoolId: string;
    actorId: string;
    invoiceId: string;
    scope: AuthContext['scope']['kind'];
  },
) {
  if (input.scope === 'school-wide' || input.scope === 'platform') return true;
  const admin = client(bindings);
  const school = await admin
    .from('schools')
    .select('published_config_version_id')
    .eq('id', input.schoolId)
    .single();
  if (school.error) throw dependencyFailure('payments.initiation.school', school.error);
  const version = await admin
    .from('tenant_config_versions')
    .select('config')
    .eq('id', school.data.published_config_version_id)
    .maybeSingle();
  if (version.error) throw dependencyFailure('payments.initiation.policy', version.error);
  const configuration = (version.data?.config ?? {}) as Record<string, unknown>;
  const portal = (configuration.portal ?? {}) as Record<string, unknown>;
  const policies = (portal.policies ?? {}) as Record<string, unknown>;
  if (input.scope === 'self' && policies.allowStudentPayments === false) return false;
  if (input.scope === 'linked-children' && policies.allowGuardianPayments === false) return false;
  const invoice = await admin
    .from('fee_invoices')
    .select('student_id')
    .eq('school_id', input.schoolId)
    .eq('id', input.invoiceId)
    .maybeSingle();
  if (invoice.error) throw dependencyFailure('payments.initiation.invoice', invoice.error);
  if (!invoice.data) return false;
  if (input.scope === 'self') {
    const student = await admin
      .from('students')
      .select('id')
      .eq('school_id', input.schoolId)
      .eq('id', invoice.data.student_id)
      .eq('user_id', input.actorId)
      .maybeSingle();
    if (student.error) throw dependencyFailure('payments.initiation.student', student.error);
    return Boolean(student.data);
  }
  if (input.scope === 'linked-children') {
    const guardians = await admin
      .from('guardians')
      .select('id')
      .eq('school_id', input.schoolId)
      .eq('user_id', input.actorId);
    if (guardians.error) throw dependencyFailure('payments.initiation.guardian', guardians.error);
    const guardianIds = (guardians.data ?? []).map((row) => row.id);
    if (!guardianIds.length) return false;
    const link = await admin
      .from('guardian_student_links')
      .select('student_id')
      .eq('school_id', input.schoolId)
      .eq('student_id', invoice.data.student_id)
      .in('guardian_id', guardianIds)
      .maybeSingle();
    if (link.error) throw dependencyFailure('payments.initiation.link', link.error);
    return Boolean(link.data);
  }
  return false;
}

export function validateInstallmentAmount(input: {
  amountMinor: number;
  netMinor: number;
  outstandingMinor: number;
  paymentCount: number;
  installmentsAllowed: boolean;
  minimumPercent: number;
  maximumInstallments: number;
}) {
  if (input.amountMinor > input.outstandingMinor)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'Payment exceeds the outstanding balance.',
      status: 409,
    });
  if (!input.installmentsAllowed && input.amountMinor !== input.outstandingMinor)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'This invoice must be paid in full.',
      status: 409,
    });
  if (
    input.installmentsAllowed &&
    input.paymentCount + 1 >= input.maximumInstallments &&
    input.amountMinor !== input.outstandingMinor
  )
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'The final installment must clear the remaining balance.',
      status: 409,
    });
  const minimumMinor = Math.ceil((input.netMinor * input.minimumPercent) / 100);
  if (
    input.installmentsAllowed &&
    input.amountMinor !== input.outstandingMinor &&
    input.amountMinor < minimumMinor
  )
    throw new AppError({
      code: 'BAD_REQUEST',
      message: `The minimum installment is NGN ${(minimumMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`,
      status: 409,
    });
}

async function prepareOnlinePayment(
  bindings: Bindings,
  input: {
    schoolId: string;
    actorId: string;
    invoiceId: string;
    email: string;
    amountMinor?: number | undefined;
  },
) {
  const admin = client(bindings);
  const settings = await admin
    .from('school_payment_settings')
    .select('paystack_enabled')
    .eq('school_id', input.schoolId)
    .maybeSingle();
  if (settings.error) throw dependencyFailure('payments.settings', settings.error);
  if (!settings.data?.paystack_enabled)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'Online payment is not enabled for this school.',
      status: 409,
    });
  const invoice = await admin
    .from('fee_invoices')
    .select(
      'id,student_id,amount_minor,discount_minor,status,installments_allowed,minimum_installment_percent,maximum_installments',
    )
    .eq('school_id', input.schoolId)
    .eq('id', input.invoiceId)
    .single();
  if (invoice.error) throw dependencyFailure('payments.invoice', invoice.error);
  const paid = await admin
    .from('fee_payments')
    .select('amount_minor')
    .eq('school_id', input.schoolId)
    .eq('invoice_id', input.invoiceId);
  if (paid.error) throw dependencyFailure('payments.balance', paid.error);
  const paidMinor = (paid.data ?? []).reduce((sum, row) => sum + Number(row.amount_minor), 0);
  const netMinor = Number(invoice.data.amount_minor) - Number(invoice.data.discount_minor);
  const outstandingMinor = netMinor - paidMinor;
  if (outstandingMinor <= 0)
    throw new AppError({
      code: 'INVOICE_ALREADY_PAID',
      message: 'The invoice has no outstanding balance.',
      status: 409,
    });
  const paymentCount = paid.data?.length ?? 0;
  const amountMinor = input.amountMinor ?? outstandingMinor;
  validateInstallmentAmount({
    amountMinor,
    netMinor,
    outstandingMinor,
    paymentCount,
    installmentsAllowed: invoice.data.installments_allowed === true,
    minimumPercent: Number(invoice.data.minimum_installment_percent),
    maximumInstallments: Number(invoice.data.maximum_installments),
  });
  const open = await admin
    .from('payment_transactions')
    .select('id')
    .eq('school_id', input.schoolId)
    .eq('invoice_id', input.invoiceId)
    .eq('status', 'initialized')
    .maybeSingle();
  if (open.error) throw dependencyFailure('payments.open-transaction', open.error);
  if (open.data)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'A Paystack payment is already open for this invoice. Complete or verify it first.',
      status: 409,
    });
  const reference = `slv_${crypto.randomUUID().replaceAll('-', '')}`;
  const created = await admin
    .from('payment_transactions')
    .insert({
      school_id: input.schoolId,
      invoice_id: input.invoiceId,
      student_id: invoice.data.student_id,
      provider_reference: reference,
      customer_email: input.email,
      expected_amount_minor: amountMinor,
      initialized_by: input.actorId,
    })
    .select(
      'id,school_id,invoice_id,student_id,provider_reference,customer_email,expected_amount_minor,currency,status',
    )
    .single();
  if (created.error?.code === '23514')
    throw new AppError({ code: 'BAD_REQUEST', message: created.error.message, status: 409 });
  if (created.error) throw dependencyFailure('payments.prepare', created.error);
  const row = PaymentTransactionRowSchema.parse(created.data);
  return {
    id: row.id,
    schoolId: row.school_id,
    invoiceId: row.invoice_id,
    studentId: row.student_id,
    reference: row.provider_reference,
    email: row.customer_email,
    amountMinor: row.expected_amount_minor,
    currency: row.currency,
    status: row.status,
  };
}

async function attachPaymentAuthorization(
  bindings: Bindings,
  transactionId: string,
  authorizationUrl: string,
) {
  const result = await client(bindings)
    .from('payment_transactions')
    .update({ authorization_url: authorizationUrl })
    .eq('id', transactionId);
  if (result.error) throw dependencyFailure('payments.authorization', result.error);
}

async function findPaymentTransaction(bindings: Bindings, reference: string) {
  const result = await client(bindings)
    .from('payment_transactions')
    .select(
      'id,school_id,invoice_id,student_id,provider_reference,customer_email,expected_amount_minor,currency,status',
    )
    .eq('provider_reference', reference)
    .maybeSingle();
  if (result.error) throw dependencyFailure('payments.find', result.error);
  if (!result.data) return null;
  const row = PaymentTransactionRowSchema.parse(result.data);
  return {
    id: row.id,
    schoolId: row.school_id,
    invoiceId: row.invoice_id,
    studentId: row.student_id,
    reference: row.provider_reference,
    email: row.customer_email,
    amountMinor: row.expected_amount_minor,
    currency: row.currency,
    status: row.status,
  };
}

async function settleOnlinePayment(
  bindings: Bindings,
  input: {
    transaction: PaymentTransaction;
    paidAt: string;
  },
) {
  const admin = client(bindings);
  const existing = await admin
    .from('fee_payments')
    .select('id,installment_number,balance_after_minor')
    .eq('provider_reference', input.transaction.reference)
    .maybeSingle();
  if (existing.error) throw dependencyFailure('payments.idempotency', existing.error);
  let paymentId = existing.data?.id as string | undefined;
  let installmentNumber = Number(existing.data?.installment_number ?? 1);
  let balanceAfterMinor = Number(existing.data?.balance_after_minor ?? 0);
  if (!existing.data) {
    const payment = await admin
      .from('fee_payments')
      .insert({
        school_id: input.transaction.schoolId,
        student_id: input.transaction.studentId,
        invoice_id: input.transaction.invoiceId,
        amount_minor: input.transaction.amountMinor,
        currency: input.transaction.currency,
        provider: 'paystack',
        provider_reference: input.transaction.reference,
        recorded_by: null,
        paid_at: input.paidAt,
      })
      .select('id,installment_number,balance_after_minor')
      .single();
    if (payment.error) throw dependencyFailure('payments.record', payment.error);
    paymentId = payment.data.id;
    installmentNumber = Number(payment.data.installment_number);
    balanceAfterMinor = Number(payment.data.balance_after_minor);
  }
  const existingReceipt = await admin
    .from('payment_receipts')
    .select('id')
    .eq('payment_id', paymentId!)
    .maybeSingle();
  if (existingReceipt.error)
    throw dependencyFailure('payments.receipt-find', existingReceipt.error);
  if (!existingReceipt.data) {
    const receipt = await admin.from('payment_receipts').insert({
      school_id: input.transaction.schoolId,
      payment_id: paymentId!,
      invoice_id: input.transaction.invoiceId,
      receipt_number: `RCT-${Date.now()}-${input.transaction.reference.slice(-6).toUpperCase()}`,
      issued_to: input.transaction.email,
      amount_minor: input.transaction.amountMinor,
      currency: input.transaction.currency,
      metadata: {
        provider: 'paystack',
        reference: input.transaction.reference,
        installmentNumber,
        balanceAfterMinor,
        paymentStatus: balanceAfterMinor === 0 ? 'paid_in_full' : 'partial',
      },
    });
    if (receipt.error) throw dependencyFailure('payments.receipt', receipt.error);
  }
  const transaction = await admin
    .from('payment_transactions')
    .update({ status: 'successful', verified_at: new Date().toISOString() })
    .eq('id', input.transaction.id);
  if (transaction.error) throw dependencyFailure('payments.transaction', transaction.error);
  const audit = await admin.from('finance_audit_events').insert({
    school_id: input.transaction.schoolId,
    actor_id: null,
    action: 'payment.paystack.verified',
    entity_type: 'invoice',
    entity_id: input.transaction.invoiceId,
    after_state: { reference: input.transaction.reference },
  });
  if (audit.error) throw dependencyFailure('payments.audit', audit.error);
  await sendSchoolEmail(bindings, {
    schoolId: input.transaction.schoolId,
    to: input.transaction.email,
    subject: 'Payment received',
    lines: [
      'Your online fee payment was successful.',
      `Reference: ${input.transaction.reference}`,
      `Amount: ${input.transaction.currency} ${(input.transaction.amountMinor / 100).toFixed(2)}`,
      balanceAfterMinor === 0
        ? 'This invoice is now paid in full.'
        : `Installment ${installmentNumber} received. Remaining balance: ${input.transaction.currency} ${(balanceAfterMinor / 100).toFixed(2)}`,
      'Your receipt is now available in the portal.',
    ],
    key: `payment-success-${input.transaction.reference}`,
  });
}
async function bulkPromoteStudents(
  bindings: Bindings,
  input: Parameters<AcademicStructureGateway['bulkPromote']>[1],
) {
  const result = await client(bindings).rpc('bulk_promote_students', {
    _school_id: input.schoolId,
    _actor_id: input.actorId,
    _student_ids: [...input.studentIds],
    _source_class_id: input.sourceClassId,
    _target_session_id: input.targetSessionId,
    _target_class_id: input.targetClassId,
    _target_arm_id: input.targetArmId,
    _enrolled_at: input.enrolledAt,
  });
  if (result.error) throw dependencyFailure('academic.students.promote', result.error);
  return z.object({ promoted: z.number().int().nonnegative() }).parse(result.data);
}

async function verifyPaymentReceipt(
  bindings: Bindings,
  input: { schoolId: string; receiptId: string },
) {
  const admin = client(bindings);
  const receipt = await admin
    .from('payment_receipts')
    .select('receipt_number,invoice_id,amount_minor,currency,issued_at,metadata')
    .eq('school_id', input.schoolId)
    .eq('id', input.receiptId)
    .maybeSingle();
  if (receipt.error) throw dependencyFailure('receipt.verify', receipt.error);
  if (!receipt.data) return null;
  const invoice = await admin
    .from('fee_invoices')
    .select('student_id,fee_definition_id,amount_minor,discount_minor,maximum_installments')
    .eq('school_id', input.schoolId)
    .eq('id', receipt.data.invoice_id)
    .single();
  if (invoice.error) throw dependencyFailure('receipt.invoice', invoice.error);
  const [school, student, fee] = await Promise.all([
    admin.from('schools').select('display_name').eq('id', input.schoolId).single(),
    admin
      .from('students')
      .select('full_name')
      .eq('school_id', input.schoolId)
      .eq('id', invoice.data.student_id)
      .single(),
    admin
      .from('fee_definitions')
      .select('name')
      .eq('school_id', input.schoolId)
      .eq('id', invoice.data.fee_definition_id)
      .single(),
  ]);
  if (school.error || student.error || fee.error)
    throw dependencyFailure('receipt.details', school.error ?? student.error ?? fee.error);
  const metadata =
    receipt.data.metadata && typeof receipt.data.metadata === 'object'
      ? (receipt.data.metadata as Record<string, unknown>)
      : {};
  return {
    receiptNumber: String(receipt.data.receipt_number),
    schoolName: String(school.data.display_name),
    studentName: String(student.data.full_name),
    feeName: String(fee.data.name),
    amountMinor: Number(receipt.data.amount_minor),
    currency: String(receipt.data.currency),
    issuedAt: String(receipt.data.issued_at),
    provider: String(metadata.provider ?? 'payment'),
    reference: String(metadata.reference ?? ''),
    installmentNumber: Number(metadata.installmentNumber ?? 1),
    maximumInstallments: Number(invoice.data.maximum_installments ?? 1),
    balanceAfterMinor: Number(metadata.balanceAfterMinor ?? 0),
    totalPaidMinor:
      Number(invoice.data.amount_minor) -
      Number(invoice.data.discount_minor) -
      Number(metadata.balanceAfterMinor ?? 0),
  };
}

async function submitManualTransfer(
  bindings: Bindings,
  input: {
    schoolId: string;
    actorId: string;
    invoiceId: string;
    amountMinor: number;
    bankName: string;
    accountName: string;
    transferReference: string;
    transferredAt: string;
    evidencePath?: string | undefined;
  },
) {
  const admin = client(bindings);
  const settings = await admin
    .from('school_payment_settings')
    .select('manual_transfer_enabled')
    .eq('school_id', input.schoolId)
    .maybeSingle();
  if (settings.error) throw dependencyFailure('manual-transfer.settings', settings.error);
  if (!settings.data?.manual_transfer_enabled)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'Manual transfer is not enabled for this school.',
      status: 409,
    });
  const invoice = await admin
    .from('fee_invoices')
    .select(
      'id,student_id,amount_minor,discount_minor,status,installments_allowed,minimum_installment_percent,maximum_installments',
    )
    .eq('school_id', input.schoolId)
    .eq('id', input.invoiceId)
    .single();
  if (invoice.error) throw dependencyFailure('manual-transfer.invoice', invoice.error);
  const payments = await admin
    .from('fee_payments')
    .select('amount_minor')
    .eq('school_id', input.schoolId)
    .eq('invoice_id', input.invoiceId);
  if (payments.error) throw dependencyFailure('manual-transfer.balance', payments.error);
  const netMinor = Number(invoice.data.amount_minor) - Number(invoice.data.discount_minor);
  const paidMinor = (payments.data ?? []).reduce((sum, row) => sum + Number(row.amount_minor), 0);
  const outstandingMinor = netMinor - paidMinor;
  if (invoice.data.status === 'paid' || outstandingMinor <= 0)
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'The invoice has no outstanding balance.',
      status: 409,
    });
  validateInstallmentAmount({
    amountMinor: input.amountMinor,
    netMinor,
    outstandingMinor,
    paymentCount: payments.data?.length ?? 0,
    installmentsAllowed: invoice.data.installments_allowed === true,
    minimumPercent: Number(invoice.data.minimum_installment_percent),
    maximumInstallments: Number(invoice.data.maximum_installments),
  });
  const saved = await admin
    .from('manual_transfer_submissions')
    .insert({
      school_id: input.schoolId,
      invoice_id: input.invoiceId,
      student_id: invoice.data.student_id,
      submitted_by: input.actorId,
      amount_minor: input.amountMinor,
      currency: 'NGN',
      bank_name: input.bankName,
      account_name: input.accountName,
      transfer_reference: input.transferReference,
      transferred_at: input.transferredAt,
      evidence_path: input.evidencePath ?? null,
    })
    .select('*')
    .single();
  if (saved.error?.code === '23514')
    throw new AppError({ code: 'BAD_REQUEST', message: saved.error.message, status: 409 });
  if (saved.error) throw dependencyFailure('manual-transfer.submit', saved.error);
  const audit = await admin.from('finance_audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.actorId,
    action: 'payment.transfer.submitted',
    entity_type: 'manual_transfer',
    entity_id: saved.data.id,
    after_state: saved.data,
  });
  if (audit.error) throw dependencyFailure('manual-transfer.audit', audit.error);
  const payer = await admin
    .from('accounts')
    .select('primary_email')
    .eq('id', input.actorId)
    .maybeSingle();
  if (payer.data?.primary_email)
    await sendSchoolEmail(bindings, {
      schoolId: input.schoolId,
      to: String(payer.data.primary_email),
      subject: 'Bank transfer submitted',
      lines: [
        'Your bank transfer details were received and are awaiting verification.',
        `Reference: ${input.transferReference}`,
        `Amount: NGN ${(input.amountMinor / 100).toFixed(2)}`,
      ],
      key: `transfer-submitted-${String(saved.data.id)}`,
    });
  return z.record(z.string(), z.unknown()).parse(saved.data);
}

async function reviewManualTransfer(
  bindings: Bindings,
  input: {
    schoolId: string;
    actorId: string;
    submissionId: string;
    decision: 'verified' | 'rejected';
    note?: string | undefined;
  },
) {
  const admin = client(bindings);
  const current = await admin
    .from('manual_transfer_submissions')
    .select('*')
    .eq('school_id', input.schoolId)
    .eq('id', input.submissionId)
    .single();
  if (current.error) throw dependencyFailure('manual-transfer.find', current.error);
  if (current.data.status !== 'submitted')
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'This transfer has already been reviewed.',
      status: 409,
    });
  const reviewedAt = new Date().toISOString();
  const updated = await admin
    .from('manual_transfer_submissions')
    .update({
      status: input.decision,
      review_note: input.note ?? null,
      reviewed_by: input.actorId,
      reviewed_at: reviewedAt,
    })
    .eq('id', input.submissionId)
    .eq('status', 'submitted')
    .select('*')
    .single();
  if (updated.error) throw dependencyFailure('manual-transfer.review', updated.error);
  let verifiedInstallment: { number: number; balanceMinor: number } | null = null;
  if (input.decision === 'verified') {
    const payment = await admin
      .from('fee_payments')
      .insert({
        school_id: input.schoolId,
        student_id: current.data.student_id,
        invoice_id: current.data.invoice_id,
        amount_minor: current.data.amount_minor,
        currency: current.data.currency,
        provider: 'bank_transfer',
        provider_reference: current.data.transfer_reference,
        recorded_by: input.actorId,
        paid_at: current.data.transferred_at,
      })
      .select('id,installment_number,balance_after_minor')
      .single();
    if (payment.error) throw dependencyFailure('manual-transfer.payment', payment.error);
    verifiedInstallment = {
      number: Number(payment.data.installment_number),
      balanceMinor: Number(payment.data.balance_after_minor),
    };
    const receipt = await admin.from('payment_receipts').insert({
      school_id: input.schoolId,
      payment_id: payment.data.id,
      invoice_id: current.data.invoice_id,
      receipt_number: `RCT-${Date.now()}-${String(current.data.transfer_reference).slice(-6).toUpperCase()}`,
      issued_to: current.data.account_name,
      amount_minor: current.data.amount_minor,
      currency: current.data.currency,
      metadata: {
        provider: 'bank_transfer',
        submissionId: input.submissionId,
        reference: current.data.transfer_reference,
        installmentNumber: payment.data.installment_number,
        balanceAfterMinor: payment.data.balance_after_minor,
        paymentStatus: Number(payment.data.balance_after_minor) === 0 ? 'paid_in_full' : 'partial',
      },
    });
    if (receipt.error) throw dependencyFailure('manual-transfer.receipt', receipt.error);
  }
  const audit = await admin.from('finance_audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.actorId,
    action: `payment.transfer.${input.decision}`,
    entity_type: 'manual_transfer',
    entity_id: input.submissionId,
    before_state: current.data,
    after_state: updated.data,
    metadata: { note: input.note ?? null },
  });
  if (audit.error) throw dependencyFailure('manual-transfer.review-audit', audit.error);
  const submitter = await admin
    .from('accounts')
    .select('primary_email')
    .eq('id', current.data.submitted_by)
    .maybeSingle();
  if (submitter.data?.primary_email)
    await sendSchoolEmail(bindings, {
      schoolId: input.schoolId,
      to: String(submitter.data.primary_email),
      subject:
        input.decision === 'verified' ? 'Bank transfer verified' : 'Bank transfer needs attention',
      lines: [
        input.decision === 'verified'
          ? 'Your bank transfer was verified and your receipt is available in the portal.'
          : 'Your bank transfer could not be verified.',
        `Reference: ${String(current.data.transfer_reference)}`,
        ...(verifiedInstallment
          ? [
              verifiedInstallment.balanceMinor === 0
                ? 'This invoice is now paid in full.'
                : `Installment ${verifiedInstallment.number} received. Remaining balance: ${String(current.data.currency)} ${(verifiedInstallment.balanceMinor / 100).toFixed(2)}`,
            ]
          : []),
        ...(input.note ? [`Note: ${input.note}`] : []),
      ],
      key: `transfer-${input.decision}-${input.submissionId}`,
    });
  return z.record(z.string(), z.unknown()).parse(updated.data);
}

async function failOnlinePayment(
  bindings: Bindings,
  transactionId: string,
  status: 'failed' | 'abandoned',
) {
  const result = await client(bindings)
    .from('payment_transactions')
    .update({ status })
    .eq('id', transactionId)
    .neq('status', 'successful');
  if (result.error) throw dependencyFailure('payments.failure', result.error);
}

async function completePlatformWorkspace(bindings: Bindings, context: AuthContext) {
  const admin = client(bindings);
  const schoolId = context.schoolId;
  const studentProfile =
    context.scope.kind === 'self'
      ? await admin
          .from('students')
          .select('id,class_id')
          .eq('school_id', schoolId)
          .eq('user_id', context.userId)
          .maybeSingle()
      : { data: null, error: null };
  if (studentProfile.error)
    throw dependencyFailure('complete-platform.student-scope', studentProfile.error);
  const scopedStudentId = studentProfile.data?.id ? String(studentProfile.data.id) : null;
  const scopedClassId = studentProfile.data?.class_id ? String(studentProfile.data.class_id) : null;
  const participantRows = await admin
    .from('conversation_participants')
    .select('conversation_id')
    .eq('school_id', schoolId)
    .eq('user_id', context.userId);
  if (participantRows.error)
    throw dependencyFailure('complete-platform.participants', participantRows.error);
  const participantConversationIds = (participantRows.data ?? []).map((row) =>
    String(row.conversation_id),
  );
  const schoolWide = context.scope.kind === 'school-wide' || context.scope.kind === 'platform';
  const queries = [
    admin
      .from('admission_applications')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('guardians')
      .select('id,user_id,display_name,guardian_number,created_at')
      .eq('school_id', schoolId),
    admin.from('guardian_student_links').select('*').eq('school_id', schoolId),
    schoolWide
      ? admin
          .from('conversations')
          .select('*')
          .eq('school_id', schoolId)
          .order('updated_at', { ascending: false })
      : participantConversationIds.length
        ? admin
            .from('conversations')
            .select('*')
            .eq('school_id', schoolId)
            .in('id', participantConversationIds)
            .order('updated_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    schoolWide
      ? admin
          .from('messages')
          .select('*')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(1000)
      : participantConversationIds.length
        ? admin
            .from('messages')
            .select('*')
            .eq('school_id', schoolId)
            .in('conversation_id', participantConversationIds)
            .order('created_at', { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
    admin
      .from('exams')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('exam_questions').select('*').eq('school_id', schoolId).order('position'),
    admin
      .from('exam_attempts')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('lessons')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('assignment_submissions')
      .select('*')
      .eq('school_id', schoolId)
      .order('updated_at', { ascending: false }),
    admin
      .from('assignments')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('library_books').select('*').eq('school_id', schoolId).order('title'),
    admin
      .from('library_loans')
      .select('*')
      .eq('school_id', schoolId)
      .order('borrowed_at', { ascending: false }),
    context.permissions.has('platform.schools.read')
      ? admin
          .from('schools')
          .select('id,code,name:display_name,status,created_at')
          .order('display_name')
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('admission_application_payments')
      .select(
        'id,application_id,method,customer_reference,expected_amount_minor,currency,status,created_at,verified_at',
      )
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(500),
    context.permissions.has('audit.read')
      ? admin
          .from('audit_events')
          .select('id,actor_id,action,entity_type,entity_id,metadata,occurred_at')
          .eq('school_id', schoolId)
          .order('occurred_at', { ascending: false })
          .limit(250)
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('entrance_exams')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('entrance_exam_versions')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('entrance_questions').select('*').eq('school_id', schoolId).order('position'),
    admin
      .from('entrance_exam_schedules')
      .select('*')
      .eq('school_id', schoolId)
      .order('opens_at', { ascending: false }),
    admin
      .from('entrance_exam_assignments')
      .select('*')
      .eq('school_id', schoolId)
      .order('assigned_at', { ascending: false }),
    admin
      .from('entrance_exam_attempts')
      .select('*')
      .eq('school_id', schoolId)
      .order('started_at', { ascending: false }),
    admin
      .from('entrance_exam_integrity_signals')
      .select('*')
      .eq('school_id', schoolId)
      .order('received_at', { ascending: false })
      .limit(1000),
    admin.from('entrance_exam_accommodations').select('*').eq('school_id', schoolId),
    admin
      .from('admission_offers')
      .select('*')
      .eq('school_id', schoolId)
      .order('issued_at', { ascending: false }),
    admin.from('classes').select('id,name,code').eq('school_id', schoolId).order('name'),
    admin
      .from('academic_sessions')
      .select('id,name,status,starts_on,ends_on')
      .eq('school_id', schoolId)
      .order('starts_on', { ascending: false }),
    admin
      .from('learning_classrooms')
      .select(
        'id,session_id,class_id,subject_id,title,status,provisioned_at,archived_at,updated_at',
      )
      .eq('school_id', schoolId)
      .order('title'),
    admin
      .from('learning_classroom_memberships')
      .select('id,classroom_id,member_kind,user_id,student_id,role,active,joined_at,ended_at')
      .eq('school_id', schoolId),
    admin.from('lesson_resources').select('*').eq('school_id', schoolId).order('position'),
    admin
      .from('lesson_revisions')
      .select('*')
      .eq('school_id', schoolId)
      .order('revision', { ascending: false }),
    admin
      .from('lesson_workflow_events')
      .select('*')
      .eq('school_id', schoolId)
      .order('occurred_at', { ascending: false }),
    admin
      .from('classroom_stream_posts')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin
      .from('classroom_stream_comments')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at'),
    admin.from('assignment_extensions').select('*').eq('school_id', schoolId),
    admin
      .from('assignment_attachments')
      .select('id,assignment_id,submission_id,original_name,mime_type,size_bytes,created_at')
      .eq('school_id', schoolId),
    admin
      .from('assignment_events')
      .select('*')
      .eq('school_id', schoolId)
      .order('occurred_at', { ascending: false }),
    admin
      .from('classroom_grade_items')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('classroom_grades').select('*').eq('school_id', schoolId),
    admin
      .from('classroom_quizzes')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false }),
    admin.from('classroom_quiz_questions').select('*').eq('school_id', schoolId).order('position'),
    admin.from('classroom_quiz_attempts').select('*').eq('school_id', schoolId),
    admin.from('classroom_quiz_answers').select('*').eq('school_id', schoolId),
    admin.from('gradebook_formal_exports').select('*').eq('school_id', schoolId),
    admin
      .from('tenant_memberships')
      .select('account_id,display_name,kind,status')
      .eq('school_id', schoolId)
      .eq('status', 'active')
      .order('display_name'),
    // Participants are loaded below after the visible conversation ids are known. Avoid an
    // unbounded school-wide scan here: older production policies can make that query time out.
    Promise.resolve({ data: [], error: null }),
  ];
  const results = await Promise.all(queries);
  results.forEach((result, index) => {
    if (result.error) throw dependencyFailure(`complete-platform.workspace.${index}`, result.error);
  });
  const visibleConversationIds = z
    .array(z.record(z.string(), z.unknown()))
    .parse(results[3]?.data ?? [])
    .map((row) => String(row.id));
  const conversationParticipants = visibleConversationIds.length
    ? await admin
        .from('conversation_participants')
        .select('conversation_id,user_id')
        .eq('school_id', schoolId)
        .in('conversation_id', visibleConversationIds.slice(0, 500))
    : { data: [], error: null };
  if (conversationParticipants.error)
    throw dependencyFailure(
      'complete-platform.conversation-participants',
      conversationParticipants.error,
    );
  const rows = (index: number) =>
    z
      .array(z.record(z.string(), z.unknown()))
      .parse(index === 45 ? (conversationParticipants.data ?? []) : (results[index]?.data ?? []));
  const stringField = (record: Record<string, unknown>, field: string) =>
    typeof record[field] === 'string' ? record[field] : '';
  const forStudent = (records: Record<string, unknown>[], field: string) =>
    context.scope.kind === 'self'
      ? records.filter((record) => stringField(record, field) === scopedStudentId)
      : records;
  const forStudentClass = (records: Record<string, unknown>[]) =>
    context.scope.kind === 'self'
      ? records.filter((record) => stringField(record, 'class_id') === scopedClassId)
      : records;
  const visibleExams = forStudentClass(rows(5));
  const visibleExamIds = new Set(visibleExams.map((exam) => stringField(exam, 'id')));
  const visibleQuestions = rows(6)
    .filter((question) => visibleExamIds.has(stringField(question, 'exam_id')))
    .map((question) => {
      if (context.permissions.has('exams.manage')) return question;
      const safeQuestion = { ...question };
      delete safeQuestion.correct_answer;
      return safeQuestion;
    });
  const classroomRows = rows(27),
    membershipRows = rows(28);
  const visibleMemberships = schoolWide
    ? membershipRows
    : membershipRows.filter((row) =>
        context.scope.kind === 'self'
          ? stringField(row, 'student_id') === scopedStudentId
          : stringField(row, 'user_id') === context.userId,
      );
  const visibleClassroomIds = new Set(
    visibleMemberships
      .filter((row) => row.active === true)
      .map((row) => stringField(row, 'classroom_id')),
  );
  const visibleClassrooms = schoolWide
    ? classroomRows
    : classroomRows.filter((row) => visibleClassroomIds.has(stringField(row, 'id')));
  const learningKeys = new Set(visibleClassrooms.map((row) => `${row.class_id}:${row.subject_id}`));
  const forLearningScope = (records: Record<string, unknown>[]) =>
    schoolWide
      ? records
      : records.filter((row) => learningKeys.has(`${row.class_id}:${row.subject_id}`));
  const privateLessons =
    context.permissions.has('lessons.manage') || context.permissions.has('academic.manage');
  const scopedLessons = forLearningScope(forStudentClass(rows(8)))
    .filter(
      (row) =>
        schoolWide ||
        !row.classroom_id ||
        visibleClassroomIds.has(stringField(row, 'classroom_id')),
    )
    .filter((row) => privateLessons || row.status === 'published')
    .map((row) => {
      if (privateLessons) return row;
      const safe = { ...row };
      safe.content = studentLessonContent(safe.content);
      delete safe.review_note;
      return safe;
    });
  const scopedLessonIds = new Set(scopedLessons.map((row) => stringField(row, 'id')));
  const scopedAssignments = context.permissions.has('assignments.read')
    ? forLearningScope(forStudentClass(rows(10)))
    : [];
  const scopedAssignmentIds = new Set(scopedAssignments.map((row) => stringField(row, 'id')));
  const visiblePosts = rows(32).filter(
    (row) =>
      visibleClassroomIds.has(stringField(row, 'classroom_id')) &&
      (schoolWide ||
        row.status === 'published' ||
        stringField(row, 'author_id') === context.userId),
  );
  const visiblePostIds = new Set(visiblePosts.map((row) => stringField(row, 'id')));
  const visibleQuizzes = rows(39).filter(
    (r) =>
      visibleClassroomIds.has(stringField(r, 'classroom_id')) &&
      (schoolWide || r.status === 'published'),
  );
  const visibleQuizIds = new Set(visibleQuizzes.map((row) => stringField(row, 'id')));
  return {
    admissions: context.permissions.has('admissions.read') ? rows(0) : [],
    guardians: context.permissions.has('parents.read') ? rows(1) : [],
    parentLinks: context.permissions.has('parents.read') ? rows(2) : [],
    conversations: context.permissions.has('messages.read') ? rows(3) : [],
    messages: context.permissions.has('messages.read') ? rows(4) : [],
    exams: context.permissions.has('exams.read') ? visibleExams : [],
    examQuestions: context.permissions.has('exams.read') ? visibleQuestions : [],
    examAttempts: context.permissions.has('exams.read') ? forStudent(rows(7), 'student_id') : [],
    lessons: context.permissions.has('lessons.read') ? scopedLessons : [],
    assignmentSubmissions: context.permissions.has('assignments.read')
      ? forStudent(rows(9), 'student_id').map((row) => {
          if (context.scope.kind !== 'self' || row.status === 'released') return row;
          const safe = { ...row };
          delete safe.score;
          delete safe.feedback;
          delete safe.graded_by;
          return safe;
        })
      : [],
    assignments: scopedAssignments,
    books: context.permissions.has('library.read') ? rows(11) : [],
    loans: context.permissions.has('library.read')
      ? rows(12).filter(
          (row) => schoolWide || stringField(row, 'borrower_user_id') === context.userId,
        )
      : [],
    schools: context.permissions.has('platform.schools.read') ? rows(13) : [],
    admissionPayments: context.permissions.has('admissions.read') ? rows(14) : [],
    auditEvents: context.permissions.has('audit.read') ? rows(15) : [],
    entranceExams:
      context.permissions.has('exams.read') && context.scope.kind !== 'self' ? rows(16) : [],
    entranceVersions:
      context.permissions.has('exams.read') && context.scope.kind !== 'self' ? rows(17) : [],
    entranceQuestions: context.permissions.has('exams.manage') ? rows(18) : [],
    entranceSchedules:
      context.permissions.has('exams.read') && context.scope.kind !== 'self' ? rows(19) : [],
    entranceAssignments:
      context.permissions.has('exams.read') && context.scope.kind !== 'self' ? rows(20) : [],
    entranceAttempts:
      context.permissions.has('exams.read') && context.scope.kind !== 'self' ? rows(21) : [],
    entranceIntegritySignals: context.permissions.has('exams.manage') ? rows(22) : [],
    entranceAccommodations: context.permissions.has('exams.manage') ? rows(23) : [],
    admissionOffers: context.permissions.has('admissions.read') ? rows(24) : [],
    classes: context.permissions.has('admissions.read') ? rows(25) : [],
    academicSessions: context.permissions.has('admissions.read') ? rows(26) : [],
    classrooms: context.permissions.has('lessons.read') ? visibleClassrooms : [],
    classroomMemberships: context.permissions.has('lessons.read') ? visibleMemberships : [],
    lessonResources: context.permissions.has('lessons.read')
      ? rows(29).filter((row) => scopedLessonIds.has(stringField(row, 'lesson_id')))
      : [],
    lessonRevisions: context.permissions.has('lessons.manage')
      ? rows(30).filter((row) => scopedLessonIds.has(stringField(row, 'lesson_id')))
      : [],
    lessonWorkflowEvents: context.permissions.has('lessons.manage')
      ? rows(31).filter((row) => scopedLessonIds.has(stringField(row, 'lesson_id')))
      : [],
    streamPosts: context.permissions.has('messages.read') ? visiblePosts : [],
    streamComments: context.permissions.has('messages.read')
      ? rows(33).filter(
          (row) =>
            visiblePostIds.has(stringField(row, 'post_id')) &&
            (row.status === 'published' ||
              schoolWide ||
              stringField(row, 'author_id') === context.userId),
        )
      : [],
    assignmentExtensions: context.permissions.has('assignments.read')
      ? rows(34).filter((row) => schoolWide || stringField(row, 'student_id') === scopedStudentId)
      : [],
    assignmentAttachments: context.permissions.has('assignments.read')
      ? rows(35).filter(
          (row) =>
            schoolWide ||
            scopedAssignmentIds.has(stringField(row, 'assignment_id')) ||
            forStudent(rows(9), 'student_id').some(
              (submission) => stringField(submission, 'id') === stringField(row, 'submission_id'),
            ),
        )
      : [],
    assignmentEvents: context.permissions.has('assignments.manage') ? rows(36) : [],
    gradeItems: context.permissions.has('assignments.read')
      ? rows(37).filter(
          (r) =>
            visibleClassroomIds.has(stringField(r, 'classroom_id')) &&
            (schoolWide || r.status === 'released'),
        )
      : [],
    classroomGrades: context.permissions.has('assignments.read')
      ? rows(38).filter(
          (r) =>
            schoolWide ||
            (stringField(r, 'student_id') === scopedStudentId && Boolean(r.released_at)),
        )
      : [],
    quizzes: context.permissions.has('assignments.read') ? visibleQuizzes : [],
    quizQuestions: context.permissions.has('assignments.read')
      ? rows(40)
          .filter((row) => visibleQuizIds.has(stringField(row, 'quiz_id')))
          .map((r) => {
            if (schoolWide) return r;
            const safe = { ...r };
            delete safe.correct_answer;
            return safe;
          })
      : [],
    quizAttempts: context.permissions.has('assignments.read')
      ? rows(41).filter((r) => schoolWide || stringField(r, 'student_id') === scopedStudentId)
      : [],
    quizAnswers: context.permissions.has('assignments.read')
      ? rows(42).filter(
          (r) =>
            schoolWide ||
            rows(41).some(
              (a) =>
                stringField(a, 'id') === stringField(r, 'attempt_id') &&
                stringField(a, 'student_id') === scopedStudentId,
            ),
        )
      : [],
    formalGradeExports: context.permissions.has('results.record') ? rows(43) : [],
    messageRecipients: context.permissions.has('messages.send')
      ? schoolWide
        ? rows(44)
        : rows(44).filter((recipient) =>
            rows(45).some(
              (participant) => String(participant.user_id) === String(recipient.account_id),
            ),
          )
      : [],
    conversationParticipants: context.permissions.has('messages.read') ? rows(45) : [],
    libraryBorrowers: context.permissions.has('library.manage') ? rows(44) : [],
  };
}

async function notifications(bindings: Bindings, context: AuthContext) {
  const result = await client(bindings)
    .from('portal_notifications')
    .select('id,kind,title,body,href,resource_type,resource_id,read_at,created_at')
    .eq('school_id', context.schoolId)
    .eq('recipient_account_id', context.userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (result.error) throw dependencyFailure('notifications.list', result.error);
  return z.array(z.record(z.string(), z.unknown())).parse(result.data ?? []);
}
async function readNotification(bindings: Bindings, context: AuthContext, id: string) {
  const result = await client(bindings)
    .from('portal_notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('school_id', context.schoolId)
    .eq('recipient_account_id', context.userId)
    .eq('id', id)
    .select('id,read_at')
    .single();
  if (result.error) throw dependencyFailure('notifications.read', result.error);
  return z.record(z.string(), z.unknown()).parse(result.data);
}
async function scopedSearch(bindings: Bindings, context: AuthContext, q: string) {
  const admin = client(bindings),
    pattern = `%${q}%`;
  let studentIds: string[] = [];
  if (context.scope.kind === 'self') {
    const own = await admin
      .from('students')
      .select('id')
      .eq('school_id', context.schoolId)
      .eq('user_id', context.userId);
    if (own.error) throw dependencyFailure('search.self', own.error);
    studentIds = (own.data ?? []).map((r) => String(r.id));
  } else if (context.scope.kind === 'linked-children') {
    const guardians = await admin
      .from('guardians')
      .select('id')
      .eq('school_id', context.schoolId)
      .eq('user_id', context.userId);
    if (guardians.error) throw dependencyFailure('search.guardians', guardians.error);
    const ids = (guardians.data ?? []).map((r) => String(r.id));
    if (ids.length) {
      const links = await admin
        .from('guardian_student_links')
        .select('student_id')
        .eq('school_id', context.schoolId)
        .in('guardian_id', ids);
      if (links.error) throw dependencyFailure('search.children', links.error);
      studentIds = (links.data ?? []).map((r) => String(r.student_id));
    }
  } else if (context.scope.kind === 'assigned-resources') {
    const assignments = await admin
      .from('teacher_class_subject_assignments')
      .select('class_id')
      .eq('school_id', context.schoolId)
      .eq('teacher_user_id', context.userId);
    if (assignments.error) throw dependencyFailure('search.assignments', assignments.error);
    const classIds = [...new Set((assignments.data ?? []).map((r) => String(r.class_id)))];
    if (classIds.length) {
      const students = await admin
        .from('students')
        .select('id')
        .eq('school_id', context.schoolId)
        .in('class_id', classIds);
      if (students.error) throw dependencyFailure('search.students', students.error);
      studentIds = (students.data ?? []).map((r) => String(r.id));
    }
  }
  const schoolWide = ['school-wide', 'platform'].includes(context.scope.kind);
  const out: { type: string; id: string; title: string; description: string; href: string }[] = [];
  if (
    context.permissions.has('students.read') ||
    context.permissions.has('self.read') ||
    context.permissions.has('children.read')
  ) {
    let query = admin
      .from('students')
      .select('id,full_name,admission_number')
      .eq('school_id', context.schoolId)
      .or(`full_name.ilike.${pattern},admission_number.ilike.${pattern}`)
      .limit(10);
    if (!schoolWide) query = studentIds.length ? query.in('id', studentIds) : query.in('id', []);
    const result = await query;
    if (result.error) throw dependencyFailure('search.student-records', result.error);
    for (const row of result.data ?? [])
      out.push({
        type: 'student',
        id: String(row.id),
        title: String(row.full_name),
        description: String(row.admission_number),
        href: context.scope.kind === 'self' ? '/student' : '/students',
      });
  }
  if (context.permissions.has('lessons.read')) {
    const memberships = await admin
      .from('learning_classroom_memberships')
      .select('classroom_id')
      .eq('school_id', context.schoolId)
      .eq(
        context.scope.kind === 'self' ? 'student_id' : 'user_id',
        context.scope.kind === 'self'
          ? (studentIds[0] ?? '00000000-0000-0000-0000-000000000000')
          : context.userId,
      )
      .eq('active', true);
    if (memberships.error) throw dependencyFailure('search.classrooms', memberships.error);
    const classroomIds = schoolWide
      ? null
      : (memberships.data ?? []).map((r) => String(r.classroom_id));
    let query = admin
      .from('lessons')
      .select('id,title,summary,status,classroom_id')
      .eq('school_id', context.schoolId)
      .ilike('title', pattern)
      .limit(10);
    if (!schoolWide)
      query = classroomIds?.length
        ? query.in('classroom_id', classroomIds)
        : query.in('classroom_id', []);
    if (context.scope.kind === 'self') query = query.eq('status', 'published');
    const result = await query;
    if (result.error) throw dependencyFailure('search.lessons', result.error);
    for (const row of result.data ?? [])
      out.push({
        type: 'lesson',
        id: String(row.id),
        title: String(row.title),
        description: String(row.summary ?? ''),
        href: context.scope.kind === 'self' ? '/learning' : '/lessons',
      });
  }
  if (context.permissions.has('assignments.read')) {
    const memberships = await admin
      .from('learning_classroom_memberships')
      .select('classroom_id')
      .eq('school_id', context.schoolId)
      .eq(
        context.scope.kind === 'self' ? 'student_id' : 'user_id',
        context.scope.kind === 'self'
          ? (studentIds[0] ?? '00000000-0000-0000-0000-000000000000')
          : context.userId,
      )
      .eq('active', true);
    if (memberships.error)
      throw dependencyFailure('search.assignment-classrooms', memberships.error);
    const classroomIds = (memberships.data ?? []).map((r) => String(r.classroom_id));
    let query = admin
      .from('assignments')
      .select('id,title,instructions,status,classroom_id')
      .eq('school_id', context.schoolId)
      .ilike('title', pattern)
      .limit(10);
    if (!schoolWide)
      query = classroomIds.length
        ? query.in('classroom_id', classroomIds)
        : query.in('classroom_id', []);
    if (context.scope.kind === 'self')
      query = query.in('status', ['published', 'closed', 'released']);
    const result = await query;
    if (result.error) throw dependencyFailure('search.assignments', result.error);
    for (const row of result.data ?? [])
      out.push({
        type: 'assignment',
        id: String(row.id),
        title: String(row.title),
        description: String(row.instructions ?? ''),
        href: context.scope.kind === 'self' ? '/learning' : '/assignments',
      });
  }
  if (context.permissions.has('messages.read')) {
    const participants = await admin
      .from('conversation_participants')
      .select('conversation_id')
      .eq('school_id', context.schoolId)
      .eq('user_id', context.userId);
    if (participants.error)
      throw dependencyFailure('search.message-participants', participants.error);
    const conversationIds = (participants.data ?? []).map((r) => String(r.conversation_id));
    if (conversationIds.length) {
      const result = await admin
        .from('messages')
        .select('id,conversation_id,body,created_at')
        .eq('school_id', context.schoolId)
        .in('conversation_id', conversationIds)
        .ilike('body', pattern)
        .limit(10);
      if (result.error) throw dependencyFailure('search.messages', result.error);
      for (const row of result.data ?? [])
        out.push({
          type: 'message',
          id: String(row.id),
          title: 'Conversation message',
          description: String(row.body),
          href: '/messages',
        });
    }
  }
  if (context.permissions.has('admissions.read')) {
    const result = await admin
      .from('admission_applications')
      .select('id,application_number,applicant_name,status')
      .eq('school_id', context.schoolId)
      .or(`applicant_name.ilike.${pattern},application_number.ilike.${pattern}`)
      .limit(10);
    if (result.error) throw dependencyFailure('search.admissions', result.error);
    for (const row of result.data ?? [])
      out.push({
        type: 'application',
        id: String(row.id),
        title: String(row.applicant_name),
        description: `${String(row.application_number)} · ${String(row.status)}`,
        href: '/admissions',
      });
  }
  if (context.permissions.has('library.read')) {
    const result = await admin
      .from('library_books')
      .select('id,title,author')
      .eq('school_id', context.schoolId)
      .or(`title.ilike.${pattern},author.ilike.${pattern}`)
      .limit(10);
    if (result.error) throw dependencyFailure('search.library', result.error);
    for (const row of result.data ?? [])
      out.push({
        type: 'book',
        id: String(row.id),
        title: String(row.title),
        description: String(row.author),
        href: '/library',
      });
  }
  return out.slice(0, 30);
}
const tokenHash = async (token: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
async function startSupportSession(
  bindings: Bindings,
  input: {
    schoolId: string;
    operatorId: string;
    targetMembershipId: string;
    reason: string;
    durationMinutes: number;
  },
) {
  const admin = client(bindings),
    membership = await admin
      .from('tenant_memberships')
      .select('id,account_id,display_name,status')
      .eq('school_id', input.schoolId)
      .eq('id', input.targetMembershipId)
      .eq('status', 'active')
      .single();
  if (membership.error) throw dependencyFailure('support.target', membership.error);
  const token = `support_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`,
    expiresAt = new Date(Date.now() + input.durationMinutes * 60000).toISOString();
  const saved = await admin
    .from('support_access_sessions')
    .insert({
      school_id: input.schoolId,
      operator_account_id: input.operatorId,
      target_account_id: membership.data.account_id,
      target_membership_id: input.targetMembershipId,
      token_hash: await tokenHash(token),
      reason: input.reason,
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (saved.error) throw dependencyFailure('support.start', saved.error);
  const audit = await admin.from('audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.operatorId,
    action: 'support.session.started',
    entity_type: 'support_access_session',
    entity_id: saved.data.id,
    metadata: {
      targetAccountId: membership.data.account_id,
      targetMembershipId: input.targetMembershipId,
      reason: input.reason,
      expiresAt,
    },
  });
  if (audit.error) throw dependencyFailure('support.start-audit', audit.error);
  return {
    id: String(saved.data.id),
    token,
    schoolId: input.schoolId,
    targetAccountId: String(membership.data.account_id),
    targetDisplayName: String(membership.data.display_name),
    reason: input.reason,
    expiresAt,
  };
}
async function endSupportSession(
  bindings: Bindings,
  input: { schoolId: string; operatorId: string; id: string },
) {
  const admin = client(bindings),
    endedAt = new Date().toISOString();
  const result = await admin
    .from('support_access_sessions')
    .update({ status: 'ended', ended_at: endedAt, ended_by: input.operatorId })
    .eq('school_id', input.schoolId)
    .eq('operator_account_id', input.operatorId)
    .eq('id', input.id)
    .eq('status', 'active')
    .select('id,target_account_id')
    .single();
  if (result.error) throw dependencyFailure('support.end', result.error);
  await admin.from('audit_events').insert({
    school_id: input.schoolId,
    actor_id: input.operatorId,
    action: 'support.session.ended',
    entity_type: 'support_access_session',
    entity_id: input.id,
    metadata: { targetAccountId: result.data.target_account_id },
  });
  return { id: input.id, status: 'ended', ended_at: endedAt };
}
async function resolveSupportSession(
  bindings: Bindings,
  input: { schoolId: string; operatorId: string; token: string },
) {
  const admin = client(bindings),
    hash = await tokenHash(input.token);
  const result = await admin
    .from('support_access_sessions')
    .select('id,target_account_id,reason,expires_at,status')
    .eq('school_id', input.schoolId)
    .eq('operator_account_id', input.operatorId)
    .eq('token_hash', hash)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (result.error) throw dependencyFailure('support.resolve', result.error);
  if (!result.data) return null;
  return {
    membership: await findMembership(
      bindings,
      input.schoolId,
      String(result.data.target_account_id),
    ),
    targetAccountId: String(result.data.target_account_id),
    session: {
      id: String(result.data.id),
      reason: String(result.data.reason),
      expiresAt: String(result.data.expires_at),
    },
  };
}
async function auditSupportRequest(
  bindings: Bindings,
  input: {
    schoolId: string;
    operatorId: string;
    targetAccountId: string;
    sessionId: string;
    method: string;
    route: string;
    status: number;
  },
) {
  const result = await client(bindings)
    .from('audit_events')
    .insert({
      school_id: input.schoolId,
      actor_id: input.operatorId,
      action: 'support.session.request',
      entity_type: 'support_access_session',
      entity_id: input.sessionId,
      metadata: {
        targetAccountId: input.targetAccountId,
        method: input.method,
        route: input.route,
        status: input.status,
      },
    });
  if (result.error) throw dependencyFailure('support.request-audit', result.error);
}

async function submitPublicContact(
  bindings: Bindings,
  input: { schoolId: string; name: string; email: string; message: string },
) {
  const admin = client(bindings);
  const result = await admin
    .from('public_contact_enquiries')
    .insert({
      school_id: input.schoolId,
      name: input.name,
      email: input.email,
      message: input.message,
    })
    .select('id')
    .single();
  if (result.error) throw dependencyFailure('public.contact', result.error);
  await sendSchoolEmail(bindings, {
    schoolId: input.schoolId,
    to: input.email,
    subject: 'We received your message',
    lines: [
      `Hello ${input.name},`,
      'Thank you for contacting us. The school team has received your message and will respond as soon as possible.',
    ],
    key: `contact-confirmation-${String(result.data.id)}`,
  });
  const school = await admin
    .from('schools')
    .select('published_config_version_id')
    .eq('id', input.schoolId)
    .single();
  if (school.data?.published_config_version_id) {
    const version = await admin
      .from('tenant_config_versions')
      .select('config')
      .eq('id', school.data.published_config_version_id)
      .maybeSingle();
    if (version.data?.config) {
      const config = migrateTenantConfiguration(version.data.config);
      if (config.contact.email)
        await sendSchoolEmail(bindings, {
          schoolId: input.schoolId,
          to: config.contact.email,
          subject: `Website enquiry from ${input.name}`,
          lines: [`From: ${input.name} <${input.email}>`, input.message],
          key: `contact-office-${String(result.data.id)}`,
        });
    }
  }
  return { accepted: true as const };
}

async function submitPublicAdmission(
  bindings: Bindings,
  input: {
    schoolId: string;
    applicantName: string;
    email: string;
    entryYear: string;
    phone?: string | undefined;
    formData?: Record<string, string> | undefined;
    documents?: { field: string; name: string; type: string; base64: string }[] | undefined;
  },
) {
  const applicationNumber = `WEB-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const randomValue = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  const accessPin = String(randomValue % 1000000).padStart(6, '0');
  const pinDigest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${input.schoolId}:${accessPin}`),
  );
  const accessPinHash = [...new Uint8Array(pinDigest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const admin = client(bindings);
  const uploadedDocuments: Record<string, string> = {};
  const documentRecords: {
    field: string;
    name: string;
    type: string;
    path: string;
    size: number;
  }[] = [];
  for (const document of input.documents ?? []) {
    const extension =
      document.type === 'application/pdf' ? 'pdf' : (document.type.split('/')[1] ?? 'bin');
    const path = `${input.schoolId}/${applicationNumber}/${document.field}.${extension}`;
    const binary = Uint8Array.from(atob(document.base64), (character) => character.charCodeAt(0));
    const upload = await admin.storage
      .from('admission-documents')
      .upload(path, binary, { contentType: document.type, upsert: false });
    if (upload.error) throw dependencyFailure('admission.document-upload', upload.error);
    uploadedDocuments[document.field] = path;
    documentRecords.push({
      field: document.field,
      name: document.name,
      type: document.type,
      path,
      size: binary.byteLength,
    });
  }
  const result = await admin
    .from('admission_applications')
    .insert({
      school_id: input.schoolId,
      application_number: applicationNumber,
      applicant_name: input.applicantName,
      email: input.email,
      phone: input.phone || null,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      form_data: {
        ...(input.formData ?? {}),
        documents: uploadedDocuments,
        entryYear: input.entryYear,
        source: 'public-site',
        accessPinHash,
        paymentStatus: 'unpaid',
      },
    })
    .select('id')
    .single();
  if (result.error) throw dependencyFailure('complete-platform.public-admission', result.error);
  if (documentRecords.length) {
    const documentType = (field: string) =>
      ({
        studentPhoto: 'student_photo',
        birthCertificate: 'birth_certificate',
        previousClassResult: 'previous_class_result',
      })[field] ?? 'other';
    const savedDocuments = await admin.from('admission_documents').insert(
      documentRecords.map((document) => ({
        school_id: input.schoolId,
        application_id: result.data.id,
        document_type: documentType(document.field),
        original_name: document.name,
        storage_path: document.path,
        mime_type: document.type,
        size_bytes: document.size,
        status: 'received',
      })),
    );
    if (savedDocuments.error)
      throw dependencyFailure('admission.document-records', savedDocuments.error);
  }
  await sendSchoolEmail(bindings, {
    schoolId: input.schoolId,
    to: input.email,
    subject: 'Application received',
    lines: [
      `Hello ${input.applicantName},`,
      `Your application number is ${applicationNumber}.`,
      `Your secure access PIN is ${accessPin}.`,
      'Keep these details safe; you will need them to check your application and complete next steps.',
    ],
    key: `admission-submitted-${String(result.data.id)}`,
  });
  return { applicationNumber, accessPin };
}

async function admissionAccess(
  bindings: Bindings,
  input: { schoolId: string; applicationNumber: string; accessPin: string },
) {
  const admin = client(bindings);
  const result = await admin
    .from('admission_applications')
    .select('id,email,form_data')
    .eq('school_id', input.schoolId)
    .eq('application_number', input.applicationNumber)
    .maybeSingle();
  if (result.error) throw dependencyFailure('admission.access', result.error);
  if (!result.data)
    throw new AppError({
      code: 'NOT_FOUND',
      message: 'Application credentials are invalid.',
      status: 404,
    });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${input.schoolId}:${input.accessPin}`),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const formData = (result.data.form_data ?? {}) as Record<string, unknown>;
  if (formData.accessPinHash !== hash)
    throw new AppError({
      code: 'PERMISSION_DENIED',
      message: 'Application credentials are invalid.',
      status: 403,
    });
  return { id: String(result.data.id), email: String(result.data.email), formData };
}

async function admissionPaymentConfig(bindings: Bindings, schoolId: string) {
  const admin = client(bindings);
  const school = await admin
    .from('schools')
    .select('published_config_version_id')
    .eq('id', schoolId)
    .single();
  if (school.error) throw dependencyFailure('admission.payment-school', school.error);
  const version = await admin
    .from('tenant_config_versions')
    .select('config')
    .eq('id', school.data.published_config_version_id)
    .eq('school_id', schoolId)
    .single();
  if (version.error) throw dependencyFailure('admission.payment-config', version.error);
  const configuration = migrateTenantConfiguration(version.data.config);
  const portal = configuration.pages
    .flatMap((page) => page.blocks)
    .find((block) => block.type === 'admissionPortal');
  if (!portal || portal.type !== 'admissionPortal')
    throw new AppError({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      message: 'Application payment is not configured.',
      status: 503,
    });
  return portal;
}

async function initializeAdmissionPayment(
  bindings: Bindings,
  input: { schoolId: string; applicationNumber: string; accessPin: string; callbackUrl: string },
) {
  const application = await admissionAccess(bindings, input);
  const config = await admissionPaymentConfig(bindings, input.schoolId);
  if (!config.paystackEnabled || config.applicationFeeMinor <= 0)
    throw new AppError({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      message: 'Online application payment is not available.',
      status: 503,
    });
  const reference = `ADM-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  const inserted = await client(bindings)
    .from('admission_application_payments')
    .insert({
      school_id: input.schoolId,
      application_id: application.id,
      method: 'paystack',
      provider_reference: reference,
      expected_amount_minor: config.applicationFeeMinor,
      currency: config.currency,
      status: 'initialized',
    })
    .select('id')
    .single();
  if (inserted.error) throw dependencyFailure('admission.payment-create', inserted.error);
  const initialized = await initializePaystack(bindings.PAYSTACK_SECRET_KEY, {
    email: application.email,
    amountMinor: config.applicationFeeMinor,
    reference,
    callbackUrl: input.callbackUrl,
    metadata: { applicationNumber: input.applicationNumber, paymentId: String(inserted.data.id) },
  });
  const attached = await client(bindings)
    .from('admission_application_payments')
    .update({ authorization_url: initialized.authorizationUrl })
    .eq('id', inserted.data.id)
    .eq('school_id', input.schoolId);
  if (attached.error) throw dependencyFailure('admission.payment-authorize', attached.error);
  return { authorizationUrl: initialized.authorizationUrl, reference };
}

async function recordAdmissionBankTransfer(
  bindings: Bindings,
  input: {
    schoolId: string;
    applicationNumber: string;
    accessPin: string;
    transferReference: string;
  },
) {
  const application = await admissionAccess(bindings, input);
  const config = await admissionPaymentConfig(bindings, input.schoolId);
  if (!config.bankTransferEnabled || config.applicationFeeMinor <= 0)
    throw new AppError({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      message: 'Bank transfer is not available.',
      status: 503,
    });
  const reference = `BANK-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`;
  const result = await client(bindings).from('admission_application_payments').insert({
    school_id: input.schoolId,
    application_id: application.id,
    method: 'bank_transfer',
    provider_reference: reference,
    customer_reference: input.transferReference,
    expected_amount_minor: config.applicationFeeMinor,
    currency: config.currency,
    status: 'pending_verification',
  });
  if (result.error) throw dependencyFailure('admission.bank-transfer', result.error);
  return { status: 'pending_verification' as const, reference };
}

async function verifyAdmissionPayment(
  bindings: Bindings,
  input: { schoolId: string; applicationNumber: string; accessPin: string; reference: string },
) {
  await admissionAccess(bindings, input);
  return verifyAdmissionPaymentByReference(bindings, input.reference, input.schoolId);
}

async function verifyAdmissionPaymentByReference(
  bindings: Bindings,
  reference: string,
  schoolId?: string,
) {
  let query = client(bindings)
    .from('admission_application_payments')
    .select('id,school_id,expected_amount_minor,currency,status')
    .eq('provider_reference', reference);
  if (schoolId) query = query.eq('school_id', schoolId);
  const result = await query.single();
  if (result.error) throw dependencyFailure('admission.payment-find', result.error);
  if (result.data.status === 'successful') return { status: 'successful' };
  const provider = await verifyPaystack(bindings.PAYSTACK_SECRET_KEY, reference);
  if (
    provider.amountMinor !== Number(result.data.expected_amount_minor) ||
    provider.currency !== result.data.currency
  )
    throw new AppError({
      code: 'PAYMENT_MISMATCH',
      message: 'Payment details do not match this application.',
      status: 409,
    });
  const status =
    provider.status === 'success'
      ? 'successful'
      : provider.status === 'abandoned'
        ? 'abandoned'
        : provider.status === 'failed'
          ? 'failed'
          : 'initialized';
  const updated = await client(bindings)
    .from('admission_application_payments')
    .update({
      status,
      paid_at: status === 'successful' ? (provider.paidAt ?? new Date().toISOString()) : null,
      verified_at: new Date().toISOString(),
    })
    .eq('id', result.data.id)
    .eq('school_id', result.data.school_id);
  if (updated.error) throw dependencyFailure('admission.payment-verify', updated.error);
  return { status };
}

async function getAdmissionStatus(
  bindings: Bindings,
  input: { schoolId: string; identifier: string; accessPin: string },
) {
  const admin = client(bindings);
  const result = await admin
    .from('admission_applications')
    .select('id,application_number,applicant_name,email,status,form_data')
    .eq('school_id', input.schoolId)
    .or(`application_number.eq.${input.identifier},email.eq.${input.identifier}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) throw dependencyFailure('admission.status', result.error);
  if (!result.data)
    throw new AppError({
      code: 'NOT_FOUND',
      message: 'Application credentials are invalid.',
      status: 404,
    });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${input.schoolId}:${input.accessPin}`),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  const formData = (result.data.form_data ?? {}) as Record<string, unknown>;
  if (formData.accessPinHash !== hash)
    throw new AppError({
      code: 'PERMISSION_DENIED',
      message: 'Application credentials are invalid.',
      status: 403,
    });
  const payment = await admin
    .from('admission_application_payments')
    .select('status')
    .eq('school_id', input.schoolId)
    .eq('application_id', result.data.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (payment.error) throw dependencyFailure('admission.status-payment', payment.error);
  return {
    applicationNumber: String(result.data.application_number),
    applicantName: String(result.data.applicant_name),
    status: String(result.data.status),
    paymentStatus: String(payment.data?.status ?? 'unpaid'),
  };
}

async function executeCompletePlatformCommand(
  bindings: Bindings,
  input: Parameters<CompletePlatformGateway['execute']>[1],
) {
  const admin = client(bindings);
  const command = input.command;
  if (
    command.operation === 'curriculum.list' ||
    command.operation === 'curriculum.create' ||
    command.operation === 'lesson.generate'
  ) {
    const room = await admin
      .from('learning_classrooms')
      .select('id,class_id,subject_id')
      .eq('school_id', input.schoolId)
      .eq('id', command.classroomId)
      .eq('status', 'active')
      .maybeSingle<{ id: string; class_id: string; subject_id: string }>();
    if (room.error) throw dependencyFailure('curriculum.classroom', room.error);
    if (!room.data)
      throw new AppError({ code: 'NOT_FOUND', message: 'Classroom not found.', status: 404 });
    if (input.scopeKind === 'assigned-resources') {
      const member = await admin
        .from('learning_classroom_memberships')
        .select('user_id')
        .eq('school_id', input.schoolId)
        .eq('classroom_id', command.classroomId)
        .eq('user_id', input.actorId)
        .eq('member_kind', 'teacher')
        .eq('active', true)
        .maybeSingle();
      if (member.error) throw dependencyFailure('curriculum.assignment', member.error);
      if (!member.data)
        throw new AppError({
          code: 'PERMISSION_DENIED',
          message: 'Classroom is outside your teaching assignment.',
          status: 403,
        });
    }
    if (command.operation === 'curriculum.list') {
      const result = await admin
        .from('curriculum_topics')
        .select('*')
        .eq('school_id', input.schoolId)
        .eq('class_id', room.data.class_id)
        .eq('subject_id', room.data.subject_id)
        .order('created_at', { ascending: false })
        .limit(500)
        .returns<Record<string, unknown>[]>();
      if (result.error) throw dependencyFailure('curriculum.list', result.error);
      return { topics: result.data };
    }
    if (command.operation === 'curriculum.create') {
      const result = await admin
        .from('curriculum_topics')
        .insert({
          school_id: input.schoolId,
          class_id: room.data.class_id,
          subject_id: room.data.subject_id,
          curriculum: command.curriculum,
          version: command.version,
          term: command.term,
          week: command.week,
          topic: command.topic,
          objectives: command.objectives,
          source_excerpt: command.sourceExcerpt,
          source_reference: command.sourceReference,
          created_by: input.actorId,
        })
        .select('id')
        .single<{ id: string }>();
      if (result.error) throw dependencyFailure('curriculum.create', result.error);
      return result.data;
    }
    freeLessonModel(bindings);
    const result = await admin
      .rpc('request_lesson_generation', {
        _school: input.schoolId,
        _actor: input.actorId,
        _classroom: command.classroomId,
        _topic: command.topicId,
        _key: command.requestKey,
        _language: command.language,
        _duration: command.duration,
        _prompt: PROMPT_VERSION,
      })
      .single<{ id: string }>();
    if (result.error) throw dependencyFailure('lesson.generate', result.error);
    const request = result.data;
    return { id: request.id };
  }
  if (command.operation === 'lesson.generation.status') {
    const result = await admin
      .from('lesson_generation_requests')
      .select('id,actor_id,lesson_id,attempts,model,created_at')
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .maybeSingle<{
        id: string;
        actor_id: string;
        lesson_id: string | null;
        attempts: number;
        model: string | null;
        created_at: string;
      }>();
    if (result.error) throw dependencyFailure('lesson.generation.status', result.error);
    if (!result.data || result.data.actor_id !== input.actorId)
      throw new AppError({
        code: 'NOT_FOUND',
        message: 'Generation request not found.',
        status: 404,
      });
    const job = await admin
      .from('background_jobs')
      .select('status,last_error_message')
      .eq('school_id', input.schoolId)
      .eq('operation', 'lesson.generate')
      .eq('resource_id', command.id)
      .maybeSingle<{ status: string; last_error_message: string | null }>();
    if (job.error) throw dependencyFailure('lesson.generation.job', job.error);
    return {
      ...result.data,
      status: result.data.lesson_id ? 'succeeded' : (job.data?.status ?? 'pending'),
      error: job.data?.last_error_message ?? null,
    };
  }

  if (input.scopeKind === 'assigned-resources' && 'classId' in command && 'subjectId' in command) {
    const assignment = await admin
      .from('teacher_class_subject_assignments')
      .select('teacher_user_id')
      .eq('school_id', input.schoolId)
      .eq('teacher_user_id', input.actorId)
      .eq('class_id', command.classId)
      .eq('subject_id', command.subjectId)
      .maybeSingle();
    if (assignment.error || !assignment.data)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'This class and subject are outside your assignment.',
        status: 403,
      });
  }
  if (input.scopeKind === 'self' && 'studentId' in command) {
    const student = await admin
      .from('students')
      .select('id')
      .eq('school_id', input.schoolId)
      .eq('id', command.studentId)
      .eq('user_id', input.actorId)
      .maybeSingle();
    if (student.error || !student.data)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'This student record is outside your scope.',
        status: 403,
      });
  }
  let result: { data: unknown; error: { message: string; code?: string } | null };
  if (command.operation === 'admission.create')
    result = await admin
      .from('admission_applications')
      .insert({
        school_id: input.schoolId,
        application_number: command.applicationNumber,
        applicant_name: command.applicantName,
        email: command.email ?? null,
        phone: command.phone ?? null,
        desired_class_id: command.desiredClassId ?? null,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();
  else if (command.operation === 'admission.review') {
    const current = await admin
      .from('admission_applications')
      .select('status')
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .single();
    if (current.error)
      throw dependencyFailure('complete-platform.admission-review-state', current.error);
    const transitions: Record<string, string[]> = {
      submitted: ['under_review', 'rejected'],
      under_review: ['needs_information', 'waitlisted', 'accepted', 'rejected'],
      needs_information: ['under_review', 'rejected'],
      waitlisted: ['under_review', 'accepted', 'rejected'],
    };
    if (!transitions[String(current.data.status)]?.includes(command.status))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: `Application cannot move from ${String(current.data.status).replaceAll('_', ' ')} to ${command.status.replaceAll('_', ' ')}.`,
        status: 409,
      });
    result = await admin
      .from('admission_applications')
      .update({
        status: command.status,
        reviewed_by: input.actorId,
        decision_reason: command.reason ?? null,
        decision_at: ['accepted', 'rejected'].includes(command.status)
          ? new Date().toISOString()
          : null,
        last_status_changed_at: new Date().toISOString(),
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
    if (!result.error) {
      await admin.from('audit_events').insert({
        school_id: input.schoolId,
        actor_id: input.actorId,
        action: 'admission.decision.recorded',
        entity_type: 'admission_application',
        entity_id: command.id,
        metadata: { status: command.status },
      });
    }
  } else if (command.operation === 'admission.offer.issue') {
    const issued = await admin.rpc('issue_admission_offer', {
      _school_id: input.schoolId,
      _application_id: command.applicationId,
      _offer_number: command.offerNumber,
      _class_id: command.classId ?? null,
      _conditions: command.conditions,
      _expires_at: command.expiresAt ?? null,
      _actor_id: input.actorId,
    });
    result = issued;
  } else if (command.operation === 'admission.payment.verify-bank') {
    const now = new Date().toISOString();
    result = await admin
      .from('admission_application_payments')
      .update({
        status: command.status === 'successful' ? 'successful' : 'failed',
        verified_at: now,
        paid_at: command.status === 'successful' ? now : null,
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .eq('method', 'bank_transfer')
      .eq('status', 'pending_verification')
      .select()
      .single();
  } else if (command.operation === 'admission.convert') {
    let admissionNumber = command.admissionNumber?.trim();
    if (!admissionNumber) {
      const application = await admin
        .from('admission_applications')
        .select('applicant_name')
        .eq('school_id', input.schoolId)
        .eq('id', command.id)
        .single();
      if (application.error)
        throw dependencyFailure('admission.convert.application', application.error);
      const generated = await admin.rpc('next_school_identifier', {
        _school_id: input.schoolId,
        _kind: 'admission',
        _name: String(application.data.applicant_name),
      });
      if (generated.error) throw dependencyFailure('admission.convert.number', generated.error);
      admissionNumber = String(generated.data);
    }
    result = await admin.rpc('convert_admission_to_student', {
      _school_id: input.schoolId,
      _application_id: command.id,
      _admission_number: admissionNumber,
      _class_id: command.classId ?? null,
      _session_id: command.sessionId,
      _actor_id: input.actorId,
    });
  } else if (command.operation === 'parent.link')
    result = await admin
      .from('guardian_student_links')
      .upsert(
        {
          school_id: input.schoolId,
          guardian_id: command.guardianId,
          student_id: command.studentId,
          relationship: command.relationship,
        },
        { onConflict: 'guardian_id,student_id' },
      )
      .select()
      .single();
  else if (command.operation === 'parent.unlink') {
    result = await admin
      .from('guardian_student_links')
      .delete()
      .eq('school_id', input.schoolId)
      .eq('guardian_id', command.guardianId)
      .eq('student_id', command.studentId)
      .select()
      .single();
    if (!result.error)
      await admin.from('audit_events').insert({
        school_id: input.schoolId,
        actor_id: input.actorId,
        action: 'people.guardian.unlinked',
        entity_type: 'guardian_student_link',
        entity_id: `${command.guardianId}:${command.studentId}`,
        metadata: { reason: command.reason },
      });
  } else if (command.operation === 'parent.invite') {
    const normalizedEmail = command.email.trim().toLowerCase();
    const [existingAccounts, existingProfiles] = await Promise.all([
      admin.from('accounts').select('id').ilike('primary_email', normalizedEmail).limit(2),
      admin.from('profiles').select('user_id').ilike('email', normalizedEmail).limit(2),
    ]);
    if (existingAccounts.error || existingProfiles.error)
      throw dependencyFailure(
        'complete-platform.parent-account-lookup',
        existingAccounts.error ?? existingProfiles.error,
      );
    const existingUserIds = [
      ...(existingAccounts.data ?? []).map((row) => String(row.id)),
      ...(existingProfiles.data ?? []).map((row) => String(row.user_id)),
    ].filter((id, index, ids) => ids.indexOf(id) === index);
    if (existingUserIds.length > 1)
      throw new AppError({
        code: 'BAD_REQUEST',
        message:
          'More than one account uses this email. Contact platform support before linking it.',
        status: 409,
      });
    let userId = existingUserIds[0];
    let createdUser = false;
    if (!userId) {
      const invited = await admin.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { display_name: command.displayName },
        redirectTo: `${bindings.PORTAL_ORIGIN.replace(/\/$/, '')}/auth/invite`,
      });
      if (invited.error) throw dependencyFailure('complete-platform.parent-invite', invited.error);
      userId = invited.data.user.id;
      createdUser = true;
    }
    try {
      const profile = await admin
        .from('profiles')
        .upsert(
          { user_id: userId, display_name: command.displayName, email: normalizedEmail },
          { onConflict: 'user_id' },
        );
      if (profile.error) throw profile.error;
      const existingMembership = await admin
        .from('school_memberships')
        .select('id,status')
        .eq('school_id', input.schoolId)
        .eq('user_id', userId)
        .eq('role', 'parent')
        .maybeSingle();
      if (existingMembership.error) throw existingMembership.error;
      if (!existingMembership.data) {
        const membership = await admin.from('school_memberships').insert({
          school_id: input.schoolId,
          user_id: userId,
          role: 'parent',
          status: createdUser ? 'invited' : 'active',
          invited_by: input.actorId,
        });
        if (membership.error) throw membership.error;
      } else if (existingMembership.data.status === 'revoked') {
        const membership = await admin
          .from('school_memberships')
          .update({ status: createdUser ? 'invited' : 'active', invited_by: input.actorId })
          .eq('id', existingMembership.data.id);
        if (membership.error) throw membership.error;
      }
      const existingGuardian = await admin
        .from('guardians')
        .select('id')
        .eq('school_id', input.schoolId)
        .eq('user_id', userId)
        .maybeSingle();
      if (existingGuardian.error) throw existingGuardian.error;
      let guardianId = existingGuardian.data?.id as string | undefined;
      if (guardianId) {
        const guardian = await admin
          .from('guardians')
          .update({ display_name: command.displayName })
          .eq('school_id', input.schoolId)
          .eq('id', guardianId);
        if (guardian.error) throw guardian.error;
      } else {
        const generated = await admin.rpc('next_school_identifier', {
          _school_id: input.schoolId,
          _kind: 'guardian',
          _name: command.displayName,
        });
        if (generated.error) throw generated.error;
        const guardian = await admin
          .from('guardians')
          .insert({
            school_id: input.schoolId,
            user_id: userId,
            display_name: command.displayName,
            guardian_number: String(generated.data),
          })
          .select('id')
          .single();
        if (guardian.error) throw guardian.error;
        guardianId = z.object({ id: z.string().uuid() }).parse(guardian.data).id;
      }
      result = await admin
        .from('guardian_student_links')
        .upsert(
          {
            school_id: input.schoolId,
            guardian_id: guardianId,
            student_id: command.studentId,
            relationship: command.relationship,
          },
          { onConflict: 'guardian_id,student_id' },
        )
        .select()
        .single();
      if (result.error) throw dependencyFailure('complete-platform.parent-link', result.error);
      if (!createdUser)
        await sendSchoolEmail(bindings, {
          schoolId: input.schoolId,
          to: normalizedEmail,
          subject: 'Your family portal access was updated',
          lines: [
            `Hello ${command.displayName},`,
            'A student has been linked to your existing parent or guardian account.',
            'Sign in with your existing password to view the updated family portal.',
          ],
          key: `parent-link:${input.schoolId}:${guardianId}:${command.studentId}`,
        }).catch(() => undefined);
    } catch (cause) {
      if (createdUser) await admin.auth.admin.deleteUser(userId);
      throw dependencyFailure('complete-platform.parent-create', cause);
    }
  } else if (command.operation === 'conversation.create') {
    const conversation = await admin
      .from('conversations')
      .insert({ school_id: input.schoolId, subject: command.subject, created_by: input.actorId })
      .select()
      .single();
    if (conversation.error)
      throw dependencyFailure('complete-platform.conversation', conversation.error);
    const conversationId = z.object({ id: z.string().uuid() }).parse(conversation.data).id;
    const participantIds = [...new Set([input.actorId, ...command.participantUserIds])];
    const participants = await admin.from('conversation_participants').insert(
      participantIds.map((userId) => ({
        school_id: input.schoolId,
        conversation_id: conversationId,
        user_id: userId,
      })),
    );
    if (participants.error) {
      await admin.from('conversations').delete().eq('id', conversationId);
      throw dependencyFailure('complete-platform.participants', participants.error);
    }
    result = await admin
      .from('messages')
      .insert({
        school_id: input.schoolId,
        conversation_id: conversationId,
        sender_id: input.actorId,
        body: command.body,
      })
      .select()
      .single();
  } else if (command.operation === 'message.send') {
    const participant = await admin
      .from('conversation_participants')
      .select('user_id')
      .eq('school_id', input.schoolId)
      .eq('conversation_id', command.conversationId)
      .eq('user_id', input.actorId)
      .maybeSingle();
    if (participant.error || !participant.data)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'You are not a participant in this conversation.',
        status: 403,
      });
    result = await admin
      .from('messages')
      .insert({
        school_id: input.schoolId,
        conversation_id: command.conversationId,
        sender_id: input.actorId,
        body: command.body,
      })
      .select()
      .single();
  } else if (command.operation === 'message.read')
    result = await admin
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('school_id', input.schoolId)
      .eq('conversation_id', command.conversationId)
      .eq('user_id', input.actorId)
      .select()
      .single();
  else if (command.operation === 'exam.create')
    result = await admin
      .from('exams')
      .insert({
        school_id: input.schoolId,
        term_id: command.termId,
        class_id: command.classId,
        subject_id: command.subjectId,
        title: command.title,
        duration_minutes: command.durationMinutes,
        starts_at: command.startsAt ?? null,
        ends_at: command.endsAt ?? null,
        created_by: input.actorId,
      })
      .select()
      .single();
  else if (command.operation === 'exam.question.create')
    result = await admin
      .from('exam_questions')
      .insert({
        school_id: input.schoolId,
        exam_id: command.examId,
        position: command.position,
        kind: command.kind,
        prompt: command.prompt,
        options: command.options ?? null,
        correct_answer: command.correctAnswer ?? null,
        marks: command.marks,
      })
      .select()
      .single();
  else if (command.operation === 'exam.status')
    result = await admin
      .from('exams')
      .update({ status: command.status })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
  else if (command.operation === 'exam.attempt.start') {
    const exam = await admin
      .from('exams')
      .select('status,starts_at,ends_at')
      .eq('school_id', input.schoolId)
      .eq('id', command.examId)
      .single();
    if (exam.error) throw dependencyFailure('complete-platform.exam', exam.error);
    const now = Date.now();
    if (
      exam.data.status !== 'active' ||
      (exam.data.starts_at && Date.parse(String(exam.data.starts_at)) > now) ||
      (exam.data.ends_at && Date.parse(String(exam.data.ends_at)) < now)
    )
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This exam is not currently available.',
        status: 422,
      });
    result = await admin
      .from('exam_attempts')
      .upsert(
        {
          school_id: input.schoolId,
          exam_id: command.examId,
          student_id: command.studentId,
          status: 'in_progress',
          last_saved_at: new Date().toISOString(),
        },
        { onConflict: 'exam_id,student_id' },
      )
      .select()
      .single();
  } else if (command.operation === 'exam.answer.save') {
    const attempt = await admin
      .from('exam_attempts')
      .select('student_id,status')
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .single();
    if (attempt.error) throw dependencyFailure('complete-platform.attempt', attempt.error);
    if (attempt.data.status !== 'in_progress')
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This exam attempt is no longer editable.',
        status: 422,
      });
    if (input.scopeKind === 'self') {
      const student = await admin
        .from('students')
        .select('id')
        .eq('school_id', input.schoolId)
        .eq('id', attempt.data.student_id)
        .eq('user_id', input.actorId)
        .maybeSingle();
      if (student.error || !student.data)
        throw new AppError({
          code: 'PERMISSION_DENIED',
          message: 'This attempt is outside your scope.',
          status: 403,
        });
    }
    result = await admin
      .from('exam_answers')
      .upsert(
        {
          school_id: input.schoolId,
          attempt_id: command.attemptId,
          question_id: command.questionId,
          answer: command.answer,
        },
        { onConflict: 'attempt_id,question_id' },
      )
      .select()
      .single();
    if (!result.error)
      await admin
        .from('exam_attempts')
        .update({ last_saved_at: new Date().toISOString() })
        .eq('id', command.attemptId);
  } else if (command.operation === 'exam.attempt.submit') {
    const attempt = await admin
      .from('exam_attempts')
      .select('student_id')
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .single();
    if (attempt.error) throw dependencyFailure('complete-platform.attempt', attempt.error);
    if (input.scopeKind === 'self') {
      const student = await admin
        .from('students')
        .select('id')
        .eq('school_id', input.schoolId)
        .eq('id', attempt.data.student_id)
        .eq('user_id', input.actorId)
        .maybeSingle();
      if (student.error || !student.data)
        throw new AppError({
          code: 'PERMISSION_DENIED',
          message: 'This attempt is outside your scope.',
          status: 403,
        });
    }
    result = await admin
      .from('exam_attempts')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        last_saved_at: new Date().toISOString(),
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .eq('status', 'in_progress')
      .select()
      .single();
  } else if (command.operation === 'entrance.exam.create') {
    result = await admin
      .from('entrance_exams')
      .insert({
        school_id: input.schoolId,
        title: command.title,
        description: command.description ?? null,
        created_by: input.actorId,
      })
      .select()
      .single();
    if (!result.error) {
      const exam = result.data as { id: string };
      const version = await admin.from('entrance_exam_versions').insert({
        school_id: input.schoolId,
        exam_id: exam.id,
        version: 1,
        duration_minutes: command.durationMinutes,
        pass_mark: command.passMark,
        source_format: 'authoring',
        created_by: input.actorId,
      });
      if (version.error) throw dependencyFailure('entrance.version.create', version.error);
    }
  } else if (command.operation === 'entrance.exam.import') {
    let questions;
    try {
      questions = importEntranceQuestions(command.source, command.format);
    } catch (error) {
      throw new AppError({
        code: 'BAD_REQUEST',
        message: error instanceof Error ? error.message : 'Invalid examination import.',
        status: 400,
      });
    }
    const latest = await admin
      .from('entrance_exam_versions')
      .select('version,duration_minutes,pass_mark')
      .eq('school_id', input.schoolId)
      .eq('exam_id', command.examId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw dependencyFailure('entrance.version.latest', latest.error);
    const version = await admin
      .from('entrance_exam_versions')
      .insert({
        school_id: input.schoolId,
        exam_id: command.examId,
        version: Number(latest.data?.version ?? 0) + 1,
        duration_minutes: Number(latest.data?.duration_minutes ?? 60),
        pass_mark: Number(latest.data?.pass_mark ?? 50),
        source_format: command.format,
        source_document: command.source,
        created_by: input.actorId,
      })
      .select()
      .single();
    if (version.error) result = version;
    else {
      const inserted = await admin.from('entrance_questions').insert(
        questions.map((q, index) => ({
          school_id: input.schoolId,
          version_id: version.data.id,
          position: index + 1,
          kind: q.kind,
          prompt: q.prompt,
          options: q.options ?? null,
          correct_answer: q.correctAnswer ?? null,
          marks: q.marks,
          explanation: q.explanation ?? null,
        })),
      );
      if (inserted.error) throw dependencyFailure('entrance.questions.import', inserted.error);
      result = version;
    }
  } else if (command.operation === 'entrance.question.create') {
    const latest = await admin
      .from('entrance_questions')
      .select('position')
      .eq('version_id', command.versionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw dependencyFailure('entrance.question.position', latest.error);
    result = await admin
      .from('entrance_questions')
      .insert({
        school_id: input.schoolId,
        version_id: command.versionId,
        position: Number(latest.data?.position ?? 0) + 1,
        kind: command.kind,
        prompt: command.prompt,
        options: command.options ?? null,
        correct_answer: command.correctAnswer ?? null,
        marks: command.marks,
        explanation: command.explanation ?? null,
      })
      .select()
      .single();
  } else if (command.operation === 'entrance.exam.publish')
    result = await admin
      .from('entrance_exam_versions')
      .update({
        status: 'published',
        published_by: input.actorId,
        published_at: new Date().toISOString(),
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.versionId)
      .eq('status', 'draft')
      .select()
      .single();
  else if (command.operation === 'entrance.exam.schedule')
    result = await admin
      .from('entrance_exam_schedules')
      .insert({
        school_id: input.schoolId,
        version_id: command.versionId,
        opens_at: command.opensAt,
        closes_at: command.closesAt,
        max_attempts: command.maxAttempts,
        created_by: input.actorId,
      })
      .select()
      .single();
  else if (command.operation === 'entrance.exam.assign')
    result = await admin
      .from('entrance_exam_assignments')
      .upsert(
        {
          school_id: input.schoolId,
          schedule_id: command.scheduleId,
          application_id: command.applicationId,
          assigned_by: input.actorId,
        },
        { onConflict: 'schedule_id,application_id' },
      )
      .select()
      .single();
  else if (command.operation === 'entrance.exam.accommodate')
    result = await admin
      .from('entrance_exam_accommodations')
      .upsert(
        {
          school_id: input.schoolId,
          assignment_id: command.assignmentId,
          extra_time_minutes: command.extraTimeMinutes,
          additional_attempts: command.additionalAttempts,
          read_aloud: command.readAloud,
          reduced_motion: command.reducedMotion,
          note: command.note ?? null,
          approved_by: input.actorId,
        },
        { onConflict: 'assignment_id' },
      )
      .select()
      .single();
  else if (command.operation === 'entrance.attempt.review')
    result = await admin
      .from('entrance_exam_attempts')
      .update({
        status: command.decision,
        score: command.score ?? null,
        review_note: command.note ?? null,
        reviewed_by: input.actorId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .in('status', ['submitted', 'auto_submitted'])
      .select()
      .single();
  else if (command.operation === 'classroom.reconcile')
    result = await admin.rpc('reconcile_learning_classrooms', {
      _school_id: input.schoolId,
      _actor_id: input.actorId,
    });
  else if (command.operation === 'stream.post.create')
    result = await admin
      .rpc('manage_stream_post', {
        _school: input.schoolId,
        _classroom: command.classroomId,
        _post: null,
        _kind: command.kind,
        _title: command.title ?? '',
        _body: command.body,
        _action: 'create',
        _reason: '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'stream.post.moderate')
    result = await admin
      .rpc('manage_stream_post', {
        _school: input.schoolId,
        _classroom: command.classroomId,
        _post: command.postId,
        _kind: 'announcement',
        _title: '',
        _body: 'moderation',
        _action: command.action,
        _reason: command.reason,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'stream.comment.create')
    result = await admin
      .rpc('manage_stream_comment', {
        _school: input.schoolId,
        _post: command.postId,
        _comment: null,
        _body: command.body,
        _action: 'create',
        _reason: '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'stream.comment.moderate')
    result = await admin
      .rpc('manage_stream_comment', {
        _school: input.schoolId,
        _post: command.postId,
        _comment: command.commentId,
        _body: 'moderation',
        _action: command.action,
        _reason: command.reason,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.create') {
    const room = await admin
      .from('learning_classrooms')
      .select('id')
      .eq('school_id', input.schoolId)
      .eq('class_id', command.classId)
      .eq('subject_id', command.subjectId)
      .eq('status', 'active')
      .order('provisioned_at', { ascending: false })
      .limit(1)
      .single();
    if (room.error) throw dependencyFailure('lesson.classroom.resolve', room.error);
    result = await admin
      .rpc('save_lesson_document', {
        _school: input.schoolId,
        _lesson: null,
        _classroom: room.data.id,
        _kind: 'plan',
        _title: command.title,
        _summary: command.summary ?? '',
        _content: { objectives: [], sections: [] },
        _actor: input.actorId,
      })
      .single();
  } else if (command.operation === 'lesson.save')
    result = await admin
      .rpc('save_lesson_document', {
        _school: input.schoolId,
        _lesson: command.id ?? null,
        _classroom: command.classroomId,
        _kind: command.kind,
        _title: command.title,
        _summary: command.summary ?? '',
        _content: command.content,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.submit')
    result = await admin
      .rpc('transition_lesson_document', {
        _school: input.schoolId,
        _lesson: command.id,
        _action: 'submit',
        _note: command.note ?? '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.review')
    result = await admin
      .rpc('transition_lesson_document', {
        _school: input.schoolId,
        _lesson: command.id,
        _action: command.decision,
        _note: command.note ?? '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.publish')
    result = await admin
      .rpc('transition_lesson_document', {
        _school: input.schoolId,
        _lesson: command.id,
        _action: 'publish',
        _note: '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.archive')
    result = await admin
      .rpc('transition_lesson_document', {
        _school: input.schoolId,
        _lesson: command.id,
        _action: 'archive',
        _note: command.note ?? '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.resource.add')
    result = await admin
      .rpc('add_lesson_resource', {
        _school: input.schoolId,
        _lesson: command.lessonId,
        _kind: command.kind,
        _title: command.title,
        _url: command.url,
        _description: command.description ?? '',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'lesson.resource.remove')
    result = await admin
      .rpc('remove_lesson_resource', {
        _school: input.schoolId,
        _resource: command.id,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'assignment.create') {
    const resolvedRoom = command.classroomId
      ? { data: { id: command.classroomId }, error: null }
      : await admin
          .from('learning_classrooms')
          .select('id')
          .eq('school_id', input.schoolId)
          .eq('class_id', command.classId)
          .eq('subject_id', command.subjectId)
          .eq('status', 'active')
          .limit(1)
          .single();
    if (resolvedRoom.error)
      throw dependencyFailure('assignment.classroom.resolve', resolvedRoom.error);
    result = await admin
      .from('assignments')
      .insert({
        school_id: input.schoolId,
        classroom_id: resolvedRoom.data.id,
        class_id: command.classId,
        subject_id: command.subjectId,
        lesson_id: command.lessonId ?? null,
        title: command.title,
        instructions: command.instructions,
        due_at: command.dueAt ?? null,
        maximum_score: command.maximumScore,
        created_by: input.actorId,
      })
      .select()
      .single();
  } else if (command.operation === 'assignment.publish')
    result = await admin
      .rpc('transition_assignment', {
        _school: input.schoolId,
        _assignment: command.id,
        _action: 'publish',
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'assignment.transition')
    result = await admin
      .rpc('transition_assignment', {
        _school: input.schoolId,
        _assignment: command.id,
        _action: command.action,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'assignment.extension.grant')
    result = await admin
      .from('assignment_extensions')
      .upsert(
        {
          school_id: input.schoolId,
          assignment_id: command.assignmentId,
          student_id: command.studentId,
          extended_due_at: command.extendedDueAt,
          reason: command.reason,
          granted_by: input.actorId,
        },
        { onConflict: 'assignment_id,student_id' },
      )
      .select()
      .single();
  else if (command.operation === 'assignment.attachment.upload') {
    if (Boolean(command.assignmentId) === Boolean(command.submissionId))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Choose exactly one assignment or submission.',
        status: 400,
      });
    const existing = command.clientRequestId
      ? await admin
          .from('assignment_attachments')
          .select()
          .eq('school_id', input.schoolId)
          .eq('owner_id', input.actorId)
          .eq('client_request_id', command.clientRequestId)
          .maybeSingle()
      : null;
    if (existing?.error) throw dependencyFailure('assignment.attachment.upload', existing.error);
    if (existing?.data) result = existing;
    else {
      const binary = Uint8Array.from(atob(command.base64), (c) => c.charCodeAt(0));
      if (binary.byteLength > 20971520)
        throw new AppError({
          code: 'BAD_REQUEST',
          message: 'Attachment exceeds 20 MB.',
          status: 400,
        });
      const path = `${input.schoolId}/assignments/${command.assignmentId ?? command.submissionId}/${command.clientRequestId ?? crypto.randomUUID()}-${command.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const upload = await admin.storage.from('tenant-private-files').upload(path, binary, {
        contentType: command.mimeType,
        upsert: Boolean(command.clientRequestId),
      });
      if (upload.error) throw dependencyFailure('assignment.attachment.upload', upload.error);
      result = await admin
        .from('assignment_attachments')
        .insert({
          school_id: input.schoolId,
          assignment_id: command.assignmentId ?? null,
          submission_id: command.submissionId ?? null,
          owner_id: input.actorId,
          client_request_id: command.clientRequestId ?? null,
          original_name: command.name,
          storage_path: path,
          mime_type: command.mimeType,
          size_bytes: binary.byteLength,
        })
        .select()
        .single();
    }
  } else if (command.operation === 'assignment.submission.save')
    result = await admin
      .rpc('submit_assignment', {
        _school: input.schoolId,
        _assignment: command.assignmentId,
        _student: command.studentId,
        _response: command.response,
        _submit: false,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'assignment.submission.submit') {
    const draft = await admin
      .from('assignment_submissions')
      .select('assignment_id,student_id,response')
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .single();
    if (draft.error) throw dependencyFailure('assignment.submit.load', draft.error);
    result = await admin
      .rpc('submit_assignment', {
        _school: input.schoolId,
        _assignment: draft.data.assignment_id,
        _student: draft.data.student_id,
        _response: draft.data.response,
        _submit: true,
        _actor: input.actorId,
      })
      .single();
  } else if (command.operation === 'assignment.submission.grade')
    result = await admin
      .from('assignment_submissions')
      .update({
        status: 'graded',
        score: command.score,
        feedback: command.feedback ?? null,
        graded_by: input.actorId,
        graded_at: new Date().toISOString(),
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .in('status', ['submitted', 'late'])
      .select()
      .single();
  else if (command.operation === 'assignment.submission.release')
    result = await admin
      .from('assignment_submissions')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .eq('status', 'graded')
      .select()
      .single();
  else if (command.operation === 'gradebook.item.create')
    result = await admin
      .from('classroom_grade_items')
      .insert({
        school_id: input.schoolId,
        classroom_id: command.classroomId,
        title: command.title,
        kind: command.kind,
        maximum_score: command.maximumScore,
        weight: command.weight,
        created_by: input.actorId,
      })
      .select()
      .single();
  else if (command.operation === 'gradebook.grade.save') {
    const item = await admin
      .from('classroom_grade_items')
      .select('maximum_score')
      .eq('school_id', input.schoolId)
      .eq('id', command.gradeItemId)
      .single();
    if (item.error || command.score > Number(item.data.maximum_score))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Grade exceeds maximum score.',
        status: 400,
      });
    result = await admin
      .from('classroom_grades')
      .upsert(
        {
          school_id: input.schoolId,
          grade_item_id: command.gradeItemId,
          student_id: command.studentId,
          score: command.score,
          feedback: command.feedback ?? null,
          graded_by: input.actorId,
          graded_at: new Date().toISOString(),
        },
        { onConflict: 'grade_item_id,student_id' },
      )
      .select()
      .single();
  } else if (command.operation === 'gradebook.item.release') {
    const releasedAt = new Date().toISOString();
    result = await admin
      .from('classroom_grade_items')
      .update({ status: 'released' })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .select()
      .single();
    if (!result.error)
      await admin
        .from('classroom_grades')
        .update({ released_at: releasedAt })
        .eq('school_id', input.schoolId)
        .eq('grade_item_id', command.id);
  } else if (command.operation === 'gradebook.export.formal')
    result = await admin
      .rpc('export_grade_item_to_formal_results', {
        _school: input.schoolId,
        _item: command.gradeItemId,
        _term: command.termId,
        _weight: command.weightPercent,
        _actor: input.actorId,
      })
      .single();
  else if (command.operation === 'quiz.create')
    result = await admin
      .from('classroom_quizzes')
      .insert({
        school_id: input.schoolId,
        classroom_id: command.classroomId,
        title: command.title,
        instructions: command.instructions ?? null,
        due_at: command.dueAt ?? null,
        attempts_allowed: command.attemptsAllowed,
        created_by: input.actorId,
      })
      .select()
      .single();
  else if (command.operation === 'quiz.question.add') {
    const last = await admin
      .from('classroom_quiz_questions')
      .select('position')
      .eq('quiz_id', command.quizId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    result = await admin
      .from('classroom_quiz_questions')
      .insert({
        school_id: input.schoolId,
        quiz_id: command.quizId,
        position: Number(last.data?.position ?? 0) + 1,
        kind: command.kind,
        prompt: command.prompt,
        options: command.options ?? null,
        correct_answer: command.correctAnswer,
        marks: command.marks,
      })
      .select()
      .single();
  } else if (command.operation === 'quiz.publish')
    result = await admin
      .from('classroom_quizzes')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .eq('status', 'draft')
      .select()
      .single();
  else if (command.operation === 'quiz.attempt.start') {
    const quiz = await admin
      .from('classroom_quizzes')
      .select('attempts_allowed')
      .eq('school_id', input.schoolId)
      .eq('id', command.quizId)
      .eq('status', 'published')
      .single();
    const attempts = await admin
      .from('classroom_quiz_attempts')
      .select('id')
      .eq('quiz_id', command.quizId)
      .eq('student_id', command.studentId);
    if (
      quiz.error ||
      attempts.error ||
      (attempts.data?.length ?? 0) >= Number(quiz.data.attempts_allowed)
    )
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Quiz attempt is unavailable.',
        status: 409,
      });
    result = await admin
      .from('classroom_quiz_attempts')
      .insert({
        school_id: input.schoolId,
        quiz_id: command.quizId,
        student_id: command.studentId,
        attempt_number: (attempts.data?.length ?? 0) + 1,
      })
      .select()
      .single();
  } else if (command.operation === 'quiz.answer.save') {
    const attempt = await admin
      .from('classroom_quiz_attempts')
      .select('student_id,status')
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .single();
    const owner = await admin
      .from('students')
      .select('id')
      .eq('school_id', input.schoolId)
      .eq('id', attempt.data?.student_id)
      .eq('user_id', input.actorId)
      .maybeSingle();
    if (attempt.error || !owner.data || attempt.data.status !== 'in_progress')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Quiz attempt is not editable.',
        status: 403,
      });
    result = await admin
      .from('classroom_quiz_answers')
      .upsert(
        {
          school_id: input.schoolId,
          attempt_id: command.attemptId,
          question_id: command.questionId,
          answer: command.answer,
          saved_at: new Date().toISOString(),
        },
        { onConflict: 'attempt_id,question_id' },
      )
      .select()
      .single();
  } else if (command.operation === 'quiz.attempt.submit') {
    const attempt = await admin
      .from('classroom_quiz_attempts')
      .select('quiz_id,student_id,status')
      .eq('school_id', input.schoolId)
      .eq('id', command.id)
      .single();
    const owner = await admin
      .from('students')
      .select('id')
      .eq('id', attempt.data?.student_id)
      .eq('user_id', input.actorId)
      .maybeSingle();
    if (attempt.error || !owner.data || attempt.data.status !== 'in_progress')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Quiz attempt is unavailable.',
        status: 403,
      });
    const [questions, answers] = await Promise.all([
      admin
        .from('classroom_quiz_questions')
        .select('id,correct_answer,marks')
        .eq('quiz_id', attempt.data.quiz_id),
      admin
        .from('classroom_quiz_answers')
        .select('question_id,answer')
        .eq('attempt_id', command.id),
    ]);
    let score = 0,
      maximum = 0;
    for (const q of questions.data ?? []) {
      maximum += Number(q.marks);
      const a = (answers.data ?? []).find((x) => x.question_id === q.id);
      if (a && JSON.stringify(a.answer) === JSON.stringify(q.correct_answer))
        score += Number(q.marks);
    }
    result = await admin
      .from('classroom_quiz_attempts')
      .update({
        status: 'graded',
        score,
        maximum_score: maximum,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', command.id)
      .select()
      .single();
  } else if (command.operation === 'learning.download.prepare') {
    const attachment = await admin
      .from('assignment_attachments')
      .select('storage_path')
      .eq('school_id', input.schoolId)
      .eq('id', command.attachmentId)
      .single();
    if (attachment.error) throw dependencyFailure('learning.download', attachment.error);
    const signed = await admin.storage
      .from('tenant-private-files')
      .createSignedUrl(attachment.data.storage_path, 300);
    result = { data: { url: signed.data?.signedUrl, expiresIn: 300 }, error: signed.error };
  } else if (command.operation === 'library.book.create')
    result = await admin
      .from('library_books')
      .insert({
        school_id: input.schoolId,
        accession_number: command.accessionNumber,
        isbn: command.isbn ?? null,
        title: command.title,
        author: command.author,
        total_copies: command.copies,
        available_copies: command.copies,
      })
      .select()
      .single();
  else if (command.operation === 'library.loan.create') {
    result = await admin.rpc('issue_library_loan', {
      _school_id: input.schoolId,
      _book_id: command.bookId,
      _borrower: command.borrowerUserId,
      _due_at: command.dueAt,
      _actor: input.actorId,
    });
  } else if (command.operation === 'library.loan.return') {
    result = await admin.rpc('return_library_loan', {
      _school_id: input.schoolId,
      _loan_id: command.id,
      _actor: input.actorId,
    });
  } else {
    if (!input.isModerator)
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Platform permission required.',
        status: 403,
      });
    result = await admin
      .from('schools')
      .update({ status: command.status })
      .eq('id', command.schoolId)
      .select()
      .single();
  }
  if (result.error) throw dependencyFailure(`complete-platform.${command.operation}`, result.error);
  const saved = z.record(z.string(), z.unknown()).parse(result.data);
  await auditAcademic(admin, {
    schoolId: input.schoolId,
    actorId: input.actorId,
    action: command.operation,
    entity: command.operation.split('.')[0] ?? 'record',
    ...(typeof saved.id === 'string' ? { entityId: saved.id } : {}),
  });
  if (
    command.operation === 'admission.review' ||
    command.operation === 'admission.offer.issue' ||
    command.operation === 'entrance.exam.assign'
  ) {
    const applicationId =
      command.operation === 'admission.review'
        ? command.id
        : command.operation === 'admission.offer.issue' ||
            command.operation === 'entrance.exam.assign'
          ? command.applicationId
          : '';
    const application = await admin
      .from('admission_applications')
      .select('email,applicant_name,application_number,status')
      .eq('school_id', input.schoolId)
      .eq('id', applicationId)
      .maybeSingle();
    if (application.data?.email) {
      const subject =
        command.operation === 'admission.offer.issue'
          ? 'Admission offer available'
          : command.operation === 'entrance.exam.assign'
            ? 'Entrance examination assigned'
            : 'Application status updated';
      const detail =
        command.operation === 'admission.review'
          ? `Your application status is now ${String(command.status).replaceAll('_', ' ')}.`
          : command.operation === 'admission.offer.issue'
            ? 'An admission offer is ready for your review and response.'
            : 'An entrance examination has been assigned to your application.';
      await sendSchoolEmail(bindings, {
        schoolId: input.schoolId,
        to: String(application.data.email),
        subject,
        lines: [
          `Hello ${String(application.data.applicant_name)},`,
          detail,
          `Application: ${String(application.data.application_number)}`,
        ],
        key: `${command.operation}-${applicationId}-${String(saved.id ?? saved.status ?? 'updated')}`,
      });
    }
  }
  return saved;
}

async function linkedApplicantApplication(bindings: Bindings, schoolId: string, accountId: string) {
  const result = await client(bindings)
    .from('admission_applications')
    .select(
      'id,application_number,applicant_name,email,phone,status,form_data,submitted_at,created_at,updated_at',
    )
    .eq('school_id', schoolId)
    .eq('applicant_account_id', accountId)
    .maybeSingle();
  if (result.error) throw dependencyFailure('applicant.application', result.error);
  if (!result.data)
    throw new AppError({
      code: 'NOT_FOUND',
      message: 'No application is linked to this account.',
      status: 404,
    });
  return z.record(z.string(), z.unknown()).parse(result.data);
}

async function applicantWorkspace(
  bindings: Bindings,
  input: Parameters<ApplicantGateway['workspace']>[1],
) {
  const admin = client(bindings);
  const application = await linkedApplicantApplication(bindings, input.schoolId, input.accountId);
  const applicationId = String(application.id);
  const assignments = await admin
    .from('entrance_exam_assignments')
    .select(
      'id,status,schedule_id,entrance_exam_accommodations(extra_time_minutes,additional_attempts,read_aloud,reduced_motion),entrance_exam_schedules(id,opens_at,closes_at,max_attempts,entrance_exam_versions(id,duration_minutes,instructions,randomize_questions,randomize_options,entrance_exams(title,description),entrance_questions(id,position,kind,prompt,options,marks)))',
    )
    .eq('school_id', input.schoolId)
    .eq('application_id', applicationId)
    .order('assigned_at', { ascending: false });
  if (assignments.error)
    throw dependencyFailure('applicant.entrance-assignments', assignments.error);
  const assignmentIds = (assignments.data ?? []).map((row) => row.id);
  const [guardians, documents, history, payments, attempts, offers] = await Promise.all([
    admin
      .from('applicant_guardians')
      .select('id,full_name,relationship,email,phone,is_primary,can_receive_updates,updated_at')
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .order('is_primary', { ascending: false }),
    admin
      .from('admission_documents')
      .select(
        'id,document_type,original_name,mime_type,size_bytes,status,review_note,created_at,updated_at',
      )
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .order('created_at'),
    admin
      .from('admission_status_events')
      .select('id,from_status,to_status,public_message,occurred_at')
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .order('occurred_at', { ascending: false }),
    admin
      .from('admission_application_payments')
      .select(
        'id,method,customer_reference,expected_amount_minor,currency,status,created_at,verified_at',
      )
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false }),
    assignmentIds.length
      ? admin
          .from('entrance_exam_attempts')
          .select('*')
          .eq('school_id', input.schoolId)
          .in('assignment_id', assignmentIds)
          .order('started_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    admin
      .from('admission_offers')
      .select(
        'id,offer_number,offered_class_id,conditions,status,issued_at,expires_at,responded_at,response_note',
      )
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .order('issued_at', { ascending: false }),
  ]);
  for (const [operation, result] of [
    ['applicant.guardians', guardians],
    ['applicant.documents', documents],
    ['applicant.history', history],
    ['applicant.payments', payments],
    ['applicant.entrance-attempts', attempts],
    ['applicant.offers', offers],
  ] as const)
    if (result.error) throw dependencyFailure(operation, result.error);
  const rows = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value ?? []);
  const guardianRows = rows(guardians.data),
    documentRows = rows(documents.data),
    paymentRows = rows(payments.data);
  const attemptRows = rows(attempts.data),
    attemptIds = attemptRows.map((row) => String(row.id));
  const answers = attemptIds.length
    ? await admin
        .from('entrance_exam_answers')
        .select('id,attempt_id,question_id,answer,saved_at')
        .eq('school_id', input.schoolId)
        .in('attempt_id', attemptIds)
    : { data: [], error: null };
  if (answers.error) throw dependencyFailure('applicant.entrance-answers', answers.error);
  const nextActions: { code: string; label: string; description: string }[] = [];
  if (!guardianRows.some((guardian) => guardian.is_primary === true))
    nextActions.push({
      code: 'guardian',
      label: 'Add primary guardian',
      description: 'Provide the main parent or guardian contact.',
    });
  if (documentRows.some((document) => document.status === 'replacement_requested'))
    nextActions.push({
      code: 'documents',
      label: 'Replace requested documents',
      description: 'Upload the corrected documents requested by admissions.',
    });
  if (!paymentRows.some((payment) => payment.status === 'successful'))
    nextActions.push({
      code: 'payment',
      label: 'Complete application payment',
      description: 'Pay online or submit a bank-transfer reference.',
    });
  if (application.status === 'offer_issued')
    nextActions.push({
      code: 'offer',
      label: 'Respond to admission offer',
      description: 'Accept or decline the offer before it expires.',
    });
  if (
    (assignments.data ?? []).some(
      (assignment) =>
        !attemptRows.some(
          (attempt) =>
            String(attempt.assignment_id) === String(assignment.id) &&
            ['submitted', 'auto_submitted', 'reviewed'].includes(String(attempt.status)),
        ),
    )
  )
    nextActions.push({
      code: 'entrance-exam',
      label: 'Take your entrance examination',
      description: 'An entrance examination is available in your portal.',
    });
  const formData = z.record(z.string(), z.unknown()).catch({}).parse(application.form_data);
  return {
    application: {
      id: String(application.id),
      applicationNumber: String(application.application_number),
      applicantName: String(application.applicant_name),
      email: typeof application.email === 'string' ? application.email : null,
      phone: typeof application.phone === 'string' ? application.phone : null,
      entryYear: typeof formData.entryYear === 'string' ? formData.entryYear : null,
      status: ApplicantStatusSchema.parse(application.status),
      submittedAt: typeof application.submitted_at === 'string' ? application.submitted_at : null,
      updatedAt: String(application.updated_at),
      formData,
    },
    guardians: guardianRows,
    documents: documentRows,
    statusHistory: rows(history.data),
    payments: paymentRows,
    offers: rows(offers.data),
    nextActions,
    entranceAssignments: rows(assignments.data),
    entranceQuestions: [],
    entranceAttempts: attemptRows,
    entranceAnswers: rows(answers.data),
  };
}

async function executeApplicantCommand(
  bindings: Bindings,
  input: Parameters<ApplicantGateway['execute']>[1],
) {
  const admin = client(bindings);
  const application = await linkedApplicantApplication(bindings, input.schoolId, input.accountId);
  const applicationId = String(application.id),
    command = input.command;
  if (command.operation === 'profile.update') {
    if (!['draft', 'submitted', 'needs_information'].includes(String(application.status)))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This application can no longer be edited.',
        status: 409,
      });
    const formData = z.record(z.string(), z.unknown()).catch({}).parse(application.form_data);
    const result = await admin
      .from('admission_applications')
      .update({
        phone: command.phone,
        form_data: { ...formData, residentialAddress: command.residentialAddress ?? '' },
      })
      .eq('id', applicationId)
      .eq('school_id', input.schoolId)
      .select('id,phone,updated_at')
      .single();
    if (result.error) throw dependencyFailure('applicant.profile-update', result.error);
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  if (command.operation === 'guardian.upsert') {
    if (command.isPrimary) {
      const unset = await admin
        .from('applicant_guardians')
        .update({ is_primary: false })
        .eq('application_id', applicationId)
        .eq('school_id', input.schoolId);
      if (unset.error) throw dependencyFailure('applicant.guardian-primary', unset.error);
    }
    const values = {
      school_id: input.schoolId,
      application_id: applicationId,
      full_name: command.fullName,
      relationship: command.relationship,
      email: command.email,
      phone: command.phone,
      is_primary: command.isPrimary,
      can_receive_updates: command.canReceiveUpdates,
    };
    const query = command.id
      ? admin
          .from('applicant_guardians')
          .update(values)
          .eq('id', command.id)
          .eq('application_id', applicationId)
      : admin.from('applicant_guardians').insert(values);
    const result = await query.select().single();
    if (result.error) throw dependencyFailure('applicant.guardian-upsert', result.error);
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  if (command.operation === 'document.upload') {
    const extension =
      command.mimeType === 'application/pdf' ? 'pdf' : (command.mimeType.split('/')[1] ?? 'bin');
    const path = `${input.schoolId}/${application.application_number}/${command.documentType}-${crypto.randomUUID()}.${extension}`;
    const binary = Uint8Array.from(atob(command.base64), (character) => character.charCodeAt(0));
    const upload = await admin.storage
      .from('admission-documents')
      .upload(path, binary, { contentType: command.mimeType });
    if (upload.error) throw dependencyFailure('applicant.document-upload', upload.error);
    const result = await admin
      .from('admission_documents')
      .upsert(
        {
          school_id: input.schoolId,
          application_id: applicationId,
          document_type: command.documentType,
          original_name: command.name,
          storage_path: path,
          mime_type: command.mimeType,
          size_bytes: binary.byteLength,
          status: 'received',
          review_note: null,
          uploaded_by: input.accountId,
        },
        { onConflict: 'application_id,document_type' },
      )
      .select('id,document_type,original_name,status,created_at')
      .single();
    if (result.error) throw dependencyFailure('applicant.document-record', result.error);
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  if (command.operation === 'entrance.attempt.start') {
    const assignment = await admin
      .from('entrance_exam_assignments')
      .select(
        'id,status,schedule_id,entrance_exam_schedules(opens_at,closes_at,max_attempts,version_id,entrance_exam_versions(duration_minutes))',
      )
      .eq('school_id', input.schoolId)
      .eq('application_id', applicationId)
      .eq('id', command.assignmentId)
      .single();
    if (assignment.error) throw dependencyFailure('entrance.start.assignment', assignment.error);
    const schedule = assignment.data.entrance_exam_schedules as unknown as {
      opens_at: string;
      closes_at: string;
      max_attempts: number;
      entrance_exam_versions: { duration_minutes: number };
    };
    const now = Date.now();
    if (now < Date.parse(schedule.opens_at) || now > Date.parse(schedule.closes_at))
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'This examination is not currently available.',
        status: 409,
      });
    const accommodation = await admin
      .from('entrance_exam_accommodations')
      .select('extra_time_minutes,additional_attempts')
      .eq('assignment_id', command.assignmentId)
      .maybeSingle();
    const existing = await admin
      .from('entrance_exam_attempts')
      .select('id,attempt_number,status,expires_at')
      .eq('assignment_id', command.assignmentId)
      .order('attempt_number', { ascending: false });
    if (existing.error || accommodation.error)
      throw dependencyFailure('entrance.start.state', existing.error ?? accommodation.error);
    const active = (existing.data ?? []).find(
      (row) => row.status === 'in_progress' && Date.parse(row.expires_at) > now,
    );
    if (active) return z.record(z.string(), z.unknown()).parse(active);
    const allowed =
      Number(schedule.max_attempts) + Number(accommodation.data?.additional_attempts ?? 0);
    if ((existing.data ?? []).length >= allowed)
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'No examination attempts remain.',
        status: 409,
      });
    const minutes =
      Number(schedule.entrance_exam_versions.duration_minutes) +
      Number(accommodation.data?.extra_time_minutes ?? 0);
    const expiresAt = new Date(
      Math.min(Date.parse(schedule.closes_at), now + minutes * 60000),
    ).toISOString();
    const result = await admin
      .from('entrance_exam_attempts')
      .insert({
        school_id: input.schoolId,
        assignment_id: command.assignmentId,
        attempt_number: (existing.data ?? []).length + 1,
        expires_at: expiresAt,
      })
      .select()
      .single();
    if (result.error) throw dependencyFailure('entrance.start', result.error);
    await admin
      .from('entrance_exam_assignments')
      .update({ status: 'started' })
      .eq('id', command.assignmentId);
    return z.record(z.string(), z.unknown()).parse(result.data);
  }
  if (
    command.operation === 'entrance.answer.save' ||
    command.operation === 'entrance.integrity.signal' ||
    command.operation === 'entrance.attempt.submit'
  ) {
    const attempt = await admin
      .from('entrance_exam_attempts')
      .select(
        '*,entrance_exam_assignments!inner(application_id,schedule_id,entrance_exam_schedules(version_id))',
      )
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .single();
    if (attempt.error) throw dependencyFailure('entrance.attempt.scope', attempt.error);
    const assignment = attempt.data.entrance_exam_assignments as unknown as {
      application_id: string;
      schedule_id: string;
      entrance_exam_schedules: { version_id: string };
    };
    if (assignment.application_id !== applicationId || attempt.data.status !== 'in_progress')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'This attempt is not editable.',
        status: 403,
      });
    if (command.operation === 'entrance.integrity.signal') {
      const signal = await admin
        .from('entrance_exam_integrity_signals')
        .insert({
          school_id: input.schoolId,
          attempt_id: command.attemptId,
          signal_type: command.signalType,
          severity: command.severity,
          client_occurred_at: command.clientOccurredAt,
          metadata: command.metadata,
        })
        .select()
        .single();
      if (signal.error) throw dependencyFailure('entrance.integrity', signal.error);
      return z.record(z.string(), z.unknown()).parse(signal.data);
    }
    if (
      Date.now() > Date.parse(attempt.data.expires_at) &&
      command.operation !== 'entrance.attempt.submit'
    )
      throw new AppError({
        code: 'BAD_REQUEST',
        message: 'Time has expired. Submit the examination.',
        status: 409,
      });
    if (command.operation === 'entrance.answer.save') {
      const question = await admin
        .from('entrance_questions')
        .select('id')
        .eq('id', command.questionId)
        .eq('version_id', assignment.entrance_exam_schedules.version_id)
        .maybeSingle();
      if (question.error || !question.data)
        throw new AppError({
          code: 'BAD_REQUEST',
          message: 'Question does not belong to this examination.',
          status: 400,
        });
      const answer = await admin
        .from('entrance_exam_answers')
        .upsert(
          {
            school_id: input.schoolId,
            attempt_id: command.attemptId,
            question_id: command.questionId,
            answer: command.answer,
            saved_at: new Date().toISOString(),
          },
          { onConflict: 'attempt_id,question_id' },
        )
        .select()
        .single();
      if (answer.error) throw dependencyFailure('entrance.autosave', answer.error);
      await admin
        .from('entrance_exam_attempts')
        .update({ last_saved_at: new Date().toISOString() })
        .eq('id', command.attemptId);
      return z.record(z.string(), z.unknown()).parse(answer.data);
    }
    const [questions, answers] = await Promise.all([
      admin
        .from('entrance_questions')
        .select('id,kind,options,correct_answer,marks')
        .eq('school_id', input.schoolId)
        .eq('version_id', assignment.entrance_exam_schedules.version_id),
      admin
        .from('entrance_exam_answers')
        .select('question_id,answer')
        .eq('school_id', input.schoolId)
        .eq('attempt_id', command.attemptId),
    ]);
    if (questions.error || answers.error)
      throw dependencyFailure('entrance.submit.grade', questions.error ?? answers.error);
    const grading = gradeEntranceObjectiveAnswers(questions.data ?? [], answers.data ?? []);
    const objectiveAwards = grading.awardedMarks.filter((award) => award.awardedMarks !== null);
    const awardResults = await Promise.all(
      objectiveAwards.map((award) =>
        admin
          .from('entrance_exam_answers')
          .update({ awarded_marks: award.awardedMarks })
          .eq('school_id', input.schoolId)
          .eq('attempt_id', command.attemptId)
          .eq('question_id', award.questionId),
      ),
    );
    const awardError = awardResults.find((award) => award.error)?.error;
    if (awardError) throw dependencyFailure('entrance.submit.awards', awardError);
    const submittedAt = new Date().toISOString(),
      status = Date.now() > Date.parse(attempt.data.expires_at) ? 'auto_submitted' : 'submitted';
    const saved = await admin
      .from('entrance_exam_attempts')
      .update({
        status,
        submitted_at: submittedAt,
        last_saved_at: submittedAt,
        score: grading.score,
        maximum_score: grading.maximumScore,
      })
      .eq('school_id', input.schoolId)
      .eq('id', command.attemptId)
      .eq('status', 'in_progress')
      .select()
      .single();
    if (saved.error) throw dependencyFailure('entrance.submit', saved.error);
    await admin
      .from('entrance_exam_assignments')
      .update({ status: 'submitted' })
      .eq('school_id', input.schoolId)
      .eq('id', attempt.data.assignment_id);
    return z.record(z.string(), z.unknown()).parse(saved.data);
  }
  if (application.status !== 'offer_issued')
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'There is no admission offer awaiting a response.',
      status: 409,
    });
  const result = await admin.rpc('respond_to_admission_offer', {
    _school_id: input.schoolId,
    _application_id: applicationId,
    _response: command.response,
    _note: command.note ?? '',
    _actor_id: input.accountId,
  });
  if (result.error) throw dependencyFailure('applicant.offer-response', result.error);
  const response = z.record(z.string(), z.unknown()).parse(result.data);
  if (response.status === 'expired')
    throw new AppError({
      code: 'BAD_REQUEST',
      message: 'This admission offer has expired. Contact the admissions team for a new offer.',
      status: 409,
    });
  return response;
}

async function platformStudioWorkspace(bindings: Bindings, context: AuthContext) {
  const admin = client(bindings);
  const queries = [
    admin
      .from('schools')
      .select('id,code,legal_name,display_name,status,created_at,updated_at')
      .order('created_at', { ascending: false }),
    context.permissions.has('platform.domains.read')
      ? admin
          .from('tenant_domains')
          .select(
            'id,school_id,hostname,domain_type,domain_kind,status,certificate_status,is_primary,last_checked_at',
          )
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.entitlements.read')
      ? admin
          .from('platform_features')
          .select('feature_key,available,updated_at')
          .order('feature_key')
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.entitlements.read')
      ? admin
          .from('school_feature_entitlements')
          .select('school_id,feature_key,entitled,created_at')
          .order('school_id')
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.operators.read')
      ? admin
          .from('platform_operator_role_assignments')
          .select('account_id,role_id,granted_by,created_at')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.operators.read')
      ? admin.from('platform_authorization_roles').select('id,code,name').order('name')
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.operators.read')
      ? admin.from('accounts').select('id,display_name,primary_email,status').order('display_name')
      : Promise.resolve({ data: [], error: null }),
    context.permissions.has('platform.audit.read')
      ? admin
          .from('audit_events')
          .select('id,school_id,actor_id,action,entity_type,entity_id,metadata,occurred_at')
          .order('occurred_at', { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ];
  const results = await Promise.all(queries);
  results.forEach((result, index) => {
    if (result.error) throw dependencyFailure(`platform-studio.workspace.${index}`, result.error);
  });
  const rows = (index: number) =>
    z.array(z.record(z.string(), z.unknown())).parse(results[index]?.data ?? []);
  return {
    schools: rows(0),
    domains: rows(1),
    features: rows(2),
    entitlements: rows(3),
    operatorAssignments: rows(4),
    operatorRoles: rows(5),
    accounts: rows(6),
    auditEvents: rows(7),
  };
}

async function executePlatformStudioCommand(
  bindings: Bindings,
  input: Parameters<PlatformStudioGateway['execute']>[1],
) {
  const admin = client(bindings);
  const command = input.command;
  let saved: Record<string, unknown>;
  if (command.operation === 'school.create') {
    const result = await admin
      .from('schools')
      .insert({
        code: command.code.toLowerCase(),
        legal_name: command.legalName,
        display_name: command.displayName,
        status: 'active',
      })
      .select('id,code,legal_name,display_name,status,created_at')
      .single();
    if (result.error) throw dependencyFailure('platform-studio.school-create', result.error);
    saved = z.record(z.string(), z.unknown()).parse(result.data);
  } else if (command.operation === 'school.lifecycle') {
    const result = await admin
      .from('schools')
      .update({ status: command.status })
      .eq('id', command.schoolId)
      .select('id,code,display_name,status,updated_at')
      .single();
    if (result.error) throw dependencyFailure('platform-studio.school-lifecycle', result.error);
    saved = z.record(z.string(), z.unknown()).parse(result.data);
  } else if (command.operation === 'entitlement.set') {
    const result = await admin
      .from('school_feature_entitlements')
      .upsert(
        {
          school_id: command.schoolId,
          feature_key: command.featureKey,
          entitled: command.entitled,
        },
        { onConflict: 'school_id,feature_key' },
      )
      .select()
      .single();
    if (result.error) throw dependencyFailure('platform-studio.entitlement', result.error);
    saved = z.record(z.string(), z.unknown()).parse(result.data);
  } else if (command.operation === 'feature.availability') {
    const result = await admin
      .from('platform_features')
      .upsert({ feature_key: command.featureKey, available: command.available })
      .select()
      .single();
    if (result.error) throw dependencyFailure('platform-studio.feature', result.error);
    saved = z.record(z.string(), z.unknown()).parse(result.data);
  } else {
    const role = await admin
      .from('platform_authorization_roles')
      .select('id,code')
      .eq('code', command.roleCode)
      .single();
    if (role.error) throw dependencyFailure('platform-studio.operator-role', role.error);
    if (command.operation === 'operator.assign') {
      const result = await admin
        .from('platform_operator_role_assignments')
        .upsert(
          { account_id: command.accountId, role_id: role.data.id, granted_by: input.actorId },
          { onConflict: 'account_id,role_id' },
        )
        .select()
        .single();
      if (result.error) throw dependencyFailure('platform-studio.operator-assign', result.error);
      saved = z.record(z.string(), z.unknown()).parse(result.data);
    } else {
      if (command.roleCode === 'platform_admin') {
        const admins = await admin
          .from('platform_operator_role_assignments')
          .select('account_id', { count: 'exact', head: true })
          .eq('role_id', role.data.id);
        if (admins.error) throw dependencyFailure('platform-studio.operator-count', admins.error);
        if ((admins.count ?? 0) <= 1)
          throw new AppError({
            code: 'PERMISSION_DENIED',
            message: 'The last platform administrator cannot be removed.',
            status: 409,
          });
      }
      const result = await admin
        .from('platform_operator_role_assignments')
        .delete()
        .eq('account_id', command.accountId)
        .eq('role_id', role.data.id)
        .select()
        .single();
      if (result.error) throw dependencyFailure('platform-studio.operator-revoke', result.error);
      saved = z.record(z.string(), z.unknown()).parse(result.data);
    }
  }
  const targetSchoolId =
    'schoolId' in command
      ? command.schoolId
      : command.operation === 'school.create' && typeof saved.id === 'string'
        ? saved.id
        : null;
  const audit = await admin.from('audit_events').insert({
    school_id: targetSchoolId,
    actor_id: input.actorId,
    action: command.operation,
    entity_type: command.operation.split('.')[0] ?? 'platform',
    entity_id: typeof saved.id === 'string' ? saved.id : null,
    metadata: { platform: true },
  });
  if (audit.error) throw dependencyFailure('platform-studio.audit', audit.error);
  return saved;
}

/**
 * This is the only module allowed to instantiate an elevated Supabase secret-key client. It exposes
 * purpose-specific operations, never the underlying client, query builder, or credentials.
 */
async function processLessonGeneration(bindings: Bindings, envelope: JobEnvelope): Promise<void> {
  const admin = client(bindings);
  const limit = (value: string | undefined, fallback: number) =>
    value === 'unlimited'
      ? null
      : /^\d+$/.test(value ?? '') ? Math.max(1, Math.min(1000, Number(value))) : fallback;
  const claim = await admin.rpc('claim_lesson_generation', {
    _school: envelope.tenantId,
    _request: envelope.resource.id,
    _global_limit: limit(bindings.LESSON_AI_DAILY_LIMIT, 45),
    _school_limit: limit(bindings.LESSON_AI_SCHOOL_DAILY_LIMIT, 10),
  });
  if (claim.error) throw dependencyFailure('lesson.generation.claim', claim.error);
  if (claim.data === 'complete') return;
  if (claim.data === 'busy') throw new GenerationRetryError(180);
  if (claim.data !== 'run')
    throw new PermanentJobError(
      'AI_GENERATION_UNAVAILABLE',
      claim.data === 'quota'
        ? 'Daily generation allowance reached. Try again tomorrow.'
        : 'Generation is unavailable or its retry allowance is exhausted.',
    );
  try {
    const request = await admin
      .from('lesson_generation_requests')
      .select('context,prompt_version,attempts')
      .eq('school_id', envelope.tenantId)
      .eq('id', envelope.resource.id)
      .single<{ context: Record<string, unknown>; prompt_version: string; attempts: number }>();
    if (request.error) throw dependencyFailure('lesson.generation.context', request.error);
    if (![PROMPT_VERSION, 'lesson-note-v2'].includes(request.data.prompt_version))
      throw new PermanentJobError(
        'AI_PROMPT_CHANGED',
        'Create a new request using the updated lesson generator.',
      );
    const result = await generateLesson(
      bindings,
      request.data.context,
      request.data.prompt_version,
    ).catch((error: unknown) => {
      if (error instanceof GenerationRetryError && request.data.attempts >= 3)
        throw new PermanentJobError(error.code, `${error.message} Three attempts were unsuccessful. Please try again later.`);
      throw error;
    });
    const saved = await admin.rpc('finish_lesson_generation', {
      _school: envelope.tenantId,
      _request: envelope.resource.id,
      _document: result.lesson,
      _model: result.model,
      _usage: result.usage,
    });
    if (saved.error) throw dependencyFailure('lesson.generation.save', saved.error);
  } finally {
    const released = await admin
      .from('lesson_generation_requests')
      .update({ lease_until: null })
      .eq('school_id', envelope.tenantId)
      .eq('id', envelope.resource.id);
    if (released.error)
      structuredLog('warn', {
        type: 'lesson_generation_lease_release',
        environment: bindings.APP_ENV,
        schoolId: envelope.tenantId,
        outcome: 'failed',
      });
  }
}

export const adminGateway = Object.freeze({
  processLessonGeneration,
  findActiveTenant,
  findMembership,
  checkReadiness,
  provisionIdentity,
  recordVerifiedPayment,
  createPendingDomain,
  setSchoolStatus,
  loadPublicBootstrap,
  loadPortalBootstrap,
  loadPlatformPortalBootstrap,
  publishConfiguration,
  configurationWorkspace,
  uploadAsset: uploadConfigurationAsset,
  saveConfigurationDraft,
  publishStudioConfiguration,
  cloneStudioVersion,
  loadStudioPreview,
  academicWorkspace,
  saveAcademicRecord,
  removeAcademicRecord,
  replaceClassSubjects,
  assignClassTeacher,
  replaceTeacherAssignments,
  manageEnrollment: manageStudentEnrollment,
  bulkPromote: bulkPromoteStudents,
  listDomains,
  provisionDefaultDomains,
  createCustomDomain,
  updateDomainProviderState,
  setPrimaryDomain,
  markDomainRemoved,
  reconciliationCandidates,
  updateProviderStateAsSystem,
  createBackgroundJob,
  getBackgroundJob,
  startBackgroundJob,
  succeedBackgroundJob,
  failBackgroundJob,
  deadLetterBackgroundJob,
  corePortalWorkspace,
  executeCorePortalCommand,
  canInitiateOnlinePayment,
  prepareOnlinePayment,
  attachPaymentAuthorization,
  findPaymentTransaction,
  settleOnlinePayment,
  verifyPaymentReceipt,
  failOnlinePayment,
  submitManualTransfer,
  reviewManualTransfer,
  completePlatformWorkspace,
  submitPublicContact,
  submitPublicAdmission,
  initializeAdmissionPayment,
  recordAdmissionBankTransfer,
  verifyAdmissionPayment,
  verifyAdmissionPaymentByReference,
  getAdmissionStatus,
  executeCompletePlatformCommand,
  applicantWorkspace,
  executeApplicantCommand,
  platformStudioWorkspace,
  executePlatformStudioCommand,
  scopedSearch,
  notifications,
  readNotification,
  startSupportSession,
  endSupportSession,
  resolveSupportSession,
  auditSupportRequest,
});
