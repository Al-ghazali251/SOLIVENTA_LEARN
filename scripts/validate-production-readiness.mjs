import { readFile } from 'node:fs/promises';

const manifest=JSON.parse(await readFile('ops/production/demo-tenants.json','utf8'));
const required=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','PREVIEW_TOKEN_SECRET','PAYSTACK_SECRET_KEY','RESEND_API_KEY','RESEND_FROM_EMAIL','CLOUDFLARE_ZONE_ID','CLOUDFLARE_API_TOKEN','CLOUDFLARE_SAAS_TARGET'];
const missing=required.filter((key)=>!process.env[key]);
if(missing.length)throw new Error(`Missing production variables: ${missing.join(', ')}`);
if(!process.env.SUPABASE_SECRET_KEY.startsWith('sb_secret_'))throw new Error('SUPABASE_SECRET_KEY must use the sb_secret_ format.');
if(!/^https:\/\/.+\.supabase\.co\/?$/u.test(process.env.SUPABASE_URL))throw new Error('SUPABASE_URL must be a hosted HTTPS Supabase project.');
const livePaystack=process.env.PAYSTACK_SECRET_KEY.startsWith('sk_live_');
const testPaystack=process.env.PAYSTACK_SECRET_KEY.startsWith('sk_test_');
if(!livePaystack&&!(testPaystack&&process.env.ALLOW_PAYSTACK_TEST_IN_PRODUCTION==='true'))throw new Error('PAYSTACK_SECRET_KEY must be live, or explicitly allow a test key with ALLOW_PAYSTACK_TEST_IN_PRODUCTION=true.');
if(testPaystack)console.warn('WARNING: Paystack test mode is enabled; no real charges will be processed.');
if(!process.env.RESEND_FROM_EMAIL.includes('@'))throw new Error('RESEND_FROM_EMAIL must be a verified sender address.');
for(const tenant of manifest.tenants){for(const hostname of [tenant.publicHostname,tenant.portalHostname])if(!hostname.endsWith('.learn.soliventa.tech'))throw new Error(`Unexpected production hostname: ${hostname}`);}
console.log(`Production inputs validated for ${manifest.tenants.length} tenants and ${manifest.apiHostname}.`);
