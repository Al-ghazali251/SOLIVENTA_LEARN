# Five-template production demo

The production topology keeps tenant resolution authoritative at the API edge:

- `{horizon|crest|meridian|mosaic|vector}.learn.soliventa.tech`: public websites.
- `portal.{horizon|crest|meridian|mosaic|vector}.learn.soliventa.tech`: authenticated portals.
- `platform.learn.soliventa.tech`: isolated Platform Studio for Soliventa operators.
- `/api/*` on each school hostname: the API Worker, preserving the hostname used for tenant resolution.
- `api.learn.soliventa.tech`: platform health, Paystack webhook and operational endpoints that do not require a school hostname.

Do not put secrets in either manifest. Cloudflare Worker secrets and hosted Supabase secrets are configured during the operator deployment runbook.

See `docs/operations/production-school-onboarding.md` for deployment, credentials, onboarding,
verification, and recovery procedures.
