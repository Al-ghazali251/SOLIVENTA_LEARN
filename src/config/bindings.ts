import type { JobEnvelope } from '../jobs/model';

export type Bindings = {
  APP_ENV: 'development' | 'staging' | 'production';
  APP_ORIGIN: string;
  PORTAL_ORIGIN: string;
  PLATFORM_HOSTNAMES?: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SECRET_KEY: string;
  SUPABASE_JWT_SECRET?: string;
  SUPABASE_JWT_JWK?: string;
  PREVIEW_TOKEN_SECRET?: string;
  PREVIEW_ORIGIN?: string;
  PLATFORM_BASE_DOMAIN?: string;
  CLOUDFLARE_ZONE_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_SAAS_TARGET?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_DATA_COLLECTION?: 'deny' | 'allow';
  LESSON_AI_DAILY_LIMIT?: string;
  LESSON_AI_SCHOOL_DAILY_LIMIT?: string;
  PAYSTACK_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  RESEND_REPLY_TO_EMAIL?: string;
  TENANT_CACHE?: KVNamespace;
  RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  JOB_QUEUE?: Queue<JobEnvelope>;
  METRICS?: AnalyticsEngineDataset;
};

export function hasSupabaseSecretKey(bindings: Bindings): boolean {
  return bindings.SUPABASE_SECRET_KEY?.startsWith('sb_secret_') === true;
}

function hasOwnedProductionDomain(value: string | undefined): boolean {
  if (!value) return false;
  const hostname = value.toLowerCase().replace(/\.$/, '');
  return !(
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.invalid')
  );
}

export function bindingsAreConfigured(bindings: Bindings): boolean {
  const base = Boolean(
    bindings.APP_ENV &&
    bindings.APP_ORIGIN &&
    bindings.PORTAL_ORIGIN &&
    bindings.SUPABASE_URL &&
    bindings.SUPABASE_PUBLISHABLE_KEY &&
    hasSupabaseSecretKey(bindings),
  );
  return bindings.APP_ENV === 'production'
    ? base &&
        Boolean(
          bindings.TENANT_CACHE && bindings.RATE_LIMITER && bindings.JOB_QUEUE && bindings.METRICS,
        ) &&
        Boolean(bindings.RESEND_API_KEY && bindings.RESEND_FROM_EMAIL) &&
        hasOwnedProductionDomain(bindings.PLATFORM_BASE_DOMAIN)
    : base;
}
