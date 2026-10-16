# Domain provisioning

## Platform domains

`POST /v1/domains/defaults` transactionally provisions `{school-code}.schools.{platform-domain}` and `portal.{school-code}.schools.{platform-domain}`. Local development uses `soliventa.localhost`; production must set `PLATFORM_BASE_DOMAIN` to a domain owned by Soliventa Technologies. The school code is loaded by the API and is never accepted from the browser.

## Custom domains

Administrators with `domains.manage` submit a hostname to `POST /v1/domains/custom`. The API normalizes it, rejects platform-owned names, creates a Cloudflare for SaaS custom hostname, and persists the returned ownership and certificate-validation records. The UI displays the required CNAME/TXT values.

A domain is resolvable only when the local status is `active`. Status becomes active only when Cloudflare reports both hostname ownership and certificate deployment as active. Administrators can request an immediate refresh; a Worker cron reconciles up to 50 due hostnames every 15 minutes.

Cloudflare credentials are backend-only:

- `CLOUDFLARE_API_TOKEN`: restricted token with Custom Hostnames/SSL write access.
- `CLOUDFLARE_ZONE_ID`: SaaS zone identifier.
- `CLOUDFLARE_SAAS_TARGET`: CNAME target configured as the SaaS fallback origin.

## Removal and takeover prevention

Removal first marks the application mapping `removed`, clears primary/redirect state, records `removed_at`, writes an audit event and purges the edge mapping. It then deletes the Cloudflare custom hostname and certificate. A removed hostname cannot resolve a tenant, pass tenant-origin CORS validation or be restored without a new provider registration and ownership verification.

The public-site middleware returns a neutral, non-indexable response for unknown domains and issues a permanent redirect from active alternate public domains to the verified primary domain.

## Production verification

1. Configure the fallback origin and SaaS target in Cloudflare.
2. Store secrets with `wrangler secret put`; never commit the API token.
3. Apply migrations and run `pnpm db:test` in an environment with Docker or against staging.
4. Provision a test school and verify both platform domains.
5. Add a custom hostname, publish the shown DNS records, and wait for both statuses to become active.
6. confirm tenant bootstrap, certificate chain, canonical redirect and CORS behavior.
7. Remove the hostname and confirm the API returns the neutral unknown-tenant response.
