# Backend foundation

This phase targets the greenfield Soliventa Learn Supabase project. It does not connect to, migrate,
or depend on the former application's database.

## Request pipeline

The global pipeline assigns an untrusted-independent request ID, normalizes the URL hostname,
sets API security headers, validates CORS, applies edge rate limiting, and emits structured logs.
Tenant route groups then resolve the tenant; protected groups additionally validate the bearer
token, load current school membership, and enforce an explicit permission.

- `GET /health/live`: process execution only; no dependency or authentication check.
- `GET /health/ready`: configuration and required Supabase dependency check.
- `GET /v1/public/bootstrap`: active tenant resolution only.
- `GET /v1/students`: tenant, authentication, membership, and `students.read` permission.

Errors sent to clients never contain a Supabase error, stack, credential, or internal detail.
The request ID correlates the safe response with the structured internal error log.

## Host and tenant trust

Tenant identity comes only from `new URL(request.url).hostname`. `X-Forwarded-Host`, a request
body `schoolId`, and query parameters are ignored. Cloudflare must preserve the visitor's custom
school host when routing `/api/*` to the Worker. Active domain records are cached in
`TENANT_CACHE` for five minutes; misses are negatively cached for 30 seconds.

Production readiness requires both the `TENANT_CACHE` KV binding and `RATE_LIMITER` binding.
Configure their environment-specific IDs in Cloudflare rather than committing IDs or secrets.

## Authorization and elevated access

Roles map to explicit permissions. The authorization context also carries a scope: school-wide,
assigned resources, linked children, self, or platform. Feature services must perform the finer
resource check for teachers, parents, and students after the coarse permission check.

The service-role client is created only in `integrations/supabase/admin-client.ts`. Routes do not
receive it. `IdentityProvisioningService`, `PaymentVerificationService`,
`DomainProvisioningService`, and `ModeratorService` first accept and validate an authenticated
authorization context, then call a narrow gateway. Payment methods accept only a provider-
verified result, and raw domain verification tokens are hashed before persistence.

## Deployment checks

For every environment, configure unique Supabase credentials and Cloudflare bindings. Run
`pnpm check`, deploy to staging, verify both health endpoints through the real edge route, test a
known and unknown custom domain, then promote the same reviewed commit to production.
