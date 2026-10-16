# Tenant bootstrap and caching

The public endpoint resolves only from the normalized URL hostname and returns published public
branding, features, and navigation. The portal endpoint additionally requires a valid token and
active membership, returns only shell-level user information, and is always `no-store`.

KV keys are controlled by server-derived values:

- `domain:{normalized-hostname}`: 15-minute active mapping or 30-second negative entry.
- `tenant-config:{schoolId}:{published-version}`: immutable public configuration for 24 hours.
- `tenant-page:{schoolId}:{published-version}:{encoded-slug}`: reserved page-cache namespace.

No request header or query value participates in these keys. There is currently no localized
configuration variant, so locale is deliberately not a cache dimension. If localization is added,
the locale must come from an allowlisted route value and become part of the versioned key. Full
HTTP responses are not stored in shared cache; this avoids path, locale, and authenticated-response
poisoning. Invalid cached JSON is deleted and treated as a miss.

Publishing goes through `ConfigurationPublishingService`, which validates `school.configure`,
publishes through the private gateway, and deletes every active domain mapping plus the previous
version key. The next request resolves the new published version; immutable new version data cannot
collide with the old cache.

Public responses expose `X-Tenant-Cache: HIT|MISS` and `Server-Timing: tenant-bootstrap;dur=...`.
Configure the GitHub Actions variable `STAGING_BOOTSTRAP_URL` with a real tenant bootstrap URL to
run the staging probe. `BOOTSTRAP_MAX_P95_MS` defaults to 500 ms over ten sequential samples.
