# Supabase API-key migration

The backend accepts only the new Supabase secret-key format through `SUPABASE_SECRET_KEY`. A legacy JWT `service_role` key is intentionally not accepted. The secret belongs only in the API Worker secret store or an ignored local `.env`; it must never be added to frontend configuration, source control, CI logs, or `wrangler.jsonc`.

## Migration sequence

1. In Supabase, open **Settings → API Keys → Publishable and secret API keys**.
2. Create a dedicated secret key for the Soliventa Learn API. Copy its `sb_secret_…` value once.
3. For local development, place it in the ignored API `.env` as `SUPABASE_SECRET_KEY=sb_secret_…`.
4. For each Cloudflare environment, run `wrangler secret put SUPABASE_SECRET_KEY --env <environment>` from the API repository and enter the value interactively.
5. Deploy to staging. Confirm `/health/ready`, authentication, tenant bootstrap, privileged operations, and cross-school security tests.
6. Deploy to production and monitor authentication, database, and 5xx metrics.
7. Only after every backend deployment uses the new key, disable the legacy `service_role` API key in Supabase.

Do not confuse the API key with the PostgreSQL `service_role` database role. SQL grants to `service_role` remain valid and should not be renamed.

If a key is exposed, revoke it in Supabase, create a replacement, update Worker secrets, and redeploy. Never paste a real key into an issue, chat, commit, command argument, or build log.
