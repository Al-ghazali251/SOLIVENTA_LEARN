# Soliventa brand migration

On 25 August 2026, the former working product identity changed to **Soliventa Learn**. The owning legal entity is **Soliventa Technologies**, operating under the umbrella brand **Soliventa Tech**.

The codebase, package scope, OpenAPI title, documentation, local seed identities, Worker name, queue names, dead-letter queue, Analytics Engine dataset and Git remotes use the Soliventa identity. The former names must not be reintroduced in application source or user-facing copy.

No production domain is assumed until Soliventa Technologies purchases and controls one. Local development uses the reserved `.localhost` namespace. OpenAPI uses a relative server URL. Production readiness rejects `localhost`, `.test`, `.example` and `.invalid` as `PLATFORM_BASE_DOMAIN` values.

When a domain is purchased:

1. Confirm legal ownership and Cloudflare zone activation.
2. Set `PLATFORM_BASE_DOMAIN`, `PLATFORM_HOSTNAMES`, origins, preview origin and SaaS target for staging.
3. Provision the Soliventa-named Worker resources declared in `wrangler.jsonc`.
4. Validate tenant routing, certificates, CORS, canonical URLs and rollback.
5. Apply the same reviewed configuration to production.

The resource rename creates new Cloudflare queues and a new Analytics Engine dataset. If any former resources contain production data, drain/export them before removing them. At the current pre-production stage they are not treated as migration sources.
