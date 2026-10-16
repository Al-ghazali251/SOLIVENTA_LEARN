import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

function parseVariables(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/u)
      .map((line) => line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/u))
      .filter(Boolean)
      .map((match) => [match[1], match[2].trim()]),
  );
}

const variableFile = process.env.STAGING_VARS_FILE ?? '.staging.vars';
const variables = parseVariables(await readFile(variableFile, 'utf8'));
if (variables.APP_ENV !== 'staging') throw new Error('Staging fixtures require APP_ENV=staging.');
if (variables.CONFIRM_SYNTHETIC_STAGING_SEED !== 'SOLIVENTA_STAGING_ONLY')
  throw new Error('Set CONFIRM_SYNTHETIC_STAGING_SEED=SOLIVENTA_STAGING_ONLY.');
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/u.test(variables.SUPABASE_URL ?? ''))
  throw new Error('A hosted Supabase staging URL is required.');
if (!variables.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'))
  throw new Error('A new-format Supabase secret key is required.');
const baseDomain = variables.PLATFORM_BASE_DOMAIN;
if (!baseDomain || baseDomain.includes('localhost'))
  throw new Error('PLATFORM_BASE_DOMAIN must be the staging platform domain.');

const manifest = JSON.parse(await readFile('ops/staging/representative-tenants.json', 'utf8'));
const supabase = createClient(variables.SUPABASE_URL, variables.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const email = 'synthetic-staging-operator@soliventa.invalid';
const password = `${randomBytes(24).toString('base64url')}Aa1!`;
const listed = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listed.error) throw listed.error;
const existing = listed.data.users.find((user) => user.email === email);
const identity = existing
  ? await supabase.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
  : await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { synthetic_staging_fixture: true },
    });
if (identity.error) throw identity.error;
const actorId = identity.data.user.id;
await writeFile(
  '.env.staging-fixtures',
  `STAGING_OPERATOR_EMAIL=${email}\nSTAGING_OPERATOR_PASSWORD=${password}\n`,
  {
    encoding: 'utf8',
    mode: 0o600,
  },
);

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  const result = await supabase.from(table).upsert(rows, { onConflict });
  if (result.error) throw result.error;
}

function configuration(tenant) {
  const paymentFeatures = tenant.payments ? { 'portal.fees': true, 'payments.online': true } : {};
  return {
    schemaVersion: 1,
    template: tenant.template,
    branding: {
      logoUrl: null,
      faviconUrl: null,
      colors: {
        ...tenant.branding,
        background: '#F7F8FA',
        surface: '#FFFFFF',
        text: '#17212B',
        muted: '#667085',
      },
      fonts: {
        heading: tenant.scenario === 'extensive-branding' ? 'Playfair Display' : 'Inter',
        body: 'Inter',
      },
      buttonStyle: tenant.scenario === 'extensive-branding' ? 'pill' : 'rounded',
      cardStyle: tenant.scenario === 'extensive-branding' ? 'elevated' : 'bordered',
    },
    contact: {
      email: `office@${tenant.code}.synthetic.invalid`,
      phone: '+234 800 000 0000',
      address: `${tenant.studentCount} Synthetic Learning Avenue, Lagos`,
    },
    socialLinks: [],
    features: { admissions: true, news: true, 'portal.students': true, ...paymentFeatures },
    navigation: [
      { label: 'Home', href: '/', requiredFeature: null },
      { label: 'Admissions', href: '/admissions/', requiredFeature: 'admissions' },
    ],
    pages: [
      {
        slug: '/',
        title: tenant.name,
        visible: true,
        blocks: [
          {
            id: randomUUID(),
            type: 'hero',
            heading: `Welcome to ${tenant.name}`,
            body: `Synthetic staging tenant: ${tenant.scenario}.`,
            imageUrl: null,
            primaryAction: { label: 'Admissions', href: '/admissions/' },
          },
        ],
      },
    ],
  };
}

for (const tenant of manifest.tenants) {
  await upsert(
    'schools',
    [
      {
        id: tenant.id,
        code: tenant.code,
        legal_name: `${tenant.name} Synthetic Ltd`,
        display_name: tenant.name,
      },
    ],
    'id',
  );
  await upsert(
    'profiles',
    [{ user_id: actorId, display_name: 'Synthetic Staging Operator', email }],
    'user_id',
  );
  await upsert(
    'school_memberships',
    [{ school_id: tenant.id, user_id: actorId, role: 'school_admin', status: 'active' }],
    'school_id,user_id,role',
  );
  const school = await supabase
    .from('schools')
    .select('published_config_version_id')
    .eq('id', tenant.id)
    .single();
  if (school.error) throw school.error;
  if (!school.data.published_config_version_id) {
    const draft = await supabase.rpc('save_tenant_config_draft', {
      _school_id: tenant.id,
      _version_id: null,
      _actor_id: actorId,
      _config: configuration(tenant),
    });
    if (draft.error) throw draft.error;
    const published = await supabase.rpc('publish_tenant_config_as_service', {
      _school_id: tenant.id,
      _version_id: draft.data.id,
      _actor_id: actorId,
      _action: 'publish',
    });
    if (published.error) throw published.error;
  }
  const featureKeys = [
    'admissions',
    'news',
    'portal.academic',
    'portal.students',
    ...(tenant.payments ? ['portal.fees', 'payments.online'] : []),
  ];
  await upsert(
    'school_feature_entitlements',
    featureKeys.map((feature_key) => ({ school_id: tenant.id, feature_key, entitled: true })),
    'school_id,feature_key',
  );
  const publicHost = `${tenant.code}.${baseDomain}`;
  const portalHost = `portal.${tenant.code}.${baseDomain}`;
  await upsert(
    'tenant_domains',
    [
      {
        school_id: tenant.id,
        hostname: publicHost,
        domain_type: 'public_site',
        domain_kind: 'platform',
        status: 'active',
        verified_at: new Date().toISOString(),
        certificate_status: 'active',
        is_primary: true,
      },
      {
        school_id: tenant.id,
        hostname: portalHost,
        domain_type: 'portal',
        domain_kind: 'platform',
        status: 'active',
        verified_at: new Date().toISOString(),
        certificate_status: 'active',
        is_primary: true,
      },
      ...(tenant.customDomain
        ? [
            {
              school_id: tenant.id,
              hostname: tenant.customDomain,
              domain_type: 'public_site',
              domain_kind: 'custom',
              status: 'awaiting_dns',
              certificate_status: 'pending',
              is_primary: false,
            },
          ]
        : []),
    ],
    'normalized_hostname',
  );
  for (let offset = 0; offset < tenant.studentCount; offset += 250) {
    const count = Math.min(250, tenant.studentCount - offset);
    await upsert(
      'students',
      Array.from({ length: count }, (_, index) => {
        const sequence = offset + index + 1;
        return {
          school_id: tenant.id,
          admission_number: `${tenant.code.toUpperCase()}-${String(sequence).padStart(5, '0')}`,
          username: `${tenant.code}-${String(sequence).padStart(5, '0')}`,
          full_name: `Synthetic Learner ${String(sequence).padStart(5, '0')}`,
        };
      }),
      'school_id,admission_number',
    );
  }
  console.log(`Provisioned ${tenant.code} (${tenant.studentCount} synthetic learners).`);
}

console.log(
  'Representative staging tenants provisioned. Credentials are in ignored .env.staging-fixtures.',
);
