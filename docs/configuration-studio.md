# Configuration studio

The customization studio is a school-administrator workflow backed by immutable configuration versions. React never publishes configuration directly to public caches or database tables.

## Lifecycle

1. `GET /v1/configuration` loads the current private draft, version history, platform availability and subscription entitlements.
2. `PUT /v1/configuration/draft` validates the complete structured document and transactionally materializes branding, feature, navigation, page and block rows. Arbitrary HTML, CSS and JavaScript are not accepted.
3. Preview first saves the draft and requests a 10-minute HMAC-signed URL. The preview API verifies the signature, expiry, school ID and version ID, returns only that draft with `private, no-store` and `noindex`, and never changes the published pointer.
4. Publishing validates authorization and completeness inside the database transaction, archives the prior published snapshot, activates the draft, updates the school pointer, writes an audit event and invalidation outbox item, and purges only that school's domain/configuration keys.
5. Rollback clones an archived snapshot into a new version and sends it through the same publication pipeline. Historical rows remain immutable.

## Feature entitlement

The API computes effective feature state as platform availability ∩ school subscription entitlement ∩ school request. The UI disables unavailable toggles, while the API rejects crafted requests that attempt to enable them.

## Deployment

Configure a unique `PREVIEW_TOKEN_SECRET` of at least 32 characters. Local development may use `PREVIEW_ORIGIN=http://preview.soliventa.localhost`; production must use an HTTPS hostname on a domain owned by Soliventa Technologies. Route that hostname to the Astro school-site application and proxy `/api` to the API Worker. Preview responses and URLs must never be cached or indexed.

Apply `20260824200000_configuration_studio.sql` before deploying the API. The migration adds entitlement tables and service-only, actor-validating draft/publication functions.
