# Production school onboarding and demo operations

## Production topology

- `https://api.learn.soliventa.tech` is the central API and operational hostname.
- `https://platform.learn.soliventa.tech/platform` is the isolated Soliventa Platform Studio.
- Each school has a public website and authenticated portal. The five maintained demos use
  `{horizon|crest|meridian|mosaic|vector}.learn.soliventa.tech` and the corresponding
  `portal.<name>.learn.soliventa.tech` hostname.
- Requests under `/api/*` on a school or portal hostname are routed to the API Worker so tenant
  resolution remains hostname-scoped.
- Published website configuration is versioned. Publishing archives the previous version and
  creates a cache-invalidation outbox record.

## Secret handling

Never commit or paste production passwords, Supabase secret keys, Paystack secrets, Resend keys,
Cloudflare tokens, or preview-token secrets. Enter secrets into the current PowerShell process or
store them with the relevant provider's secret facility.

For this workstation, configure the ignored shared production environment once:

```powershell
cd C:\Users\HP\Projects\soliventa-learn-api
pnpm production:configure
pnpm production:validate
```

This writes `soliventa-learn-api/.env.production.local`. Production commands in both the API and
adjacent web repository load that file automatically. Run the configurator again whenever a secret
is rotated; existing values are retained, and environment variables explicitly set in the current
process still take precedence. Never copy development values from `.env` into this file.

Before Paystack activation, test mode may be used with an `sk_test_` key and
`ALLOW_PAYSTACK_TEST_IN_PRODUCTION=true`. The deployment prints a warning and no real charges are
processed. Replace the key with `sk_live_` and remove or disable the override before launch.

Required deployment variables are documented by `scripts/validate-production-readiness.mjs`.
Important demo variables include:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `PRODUCTION_DEMO_PASSWORD`
- `CONFIRM_PRODUCTION_DEMO=ALL_FIVE_PRODUCTION`
- `TENANT_CACHE_KV_ID`
- `RATE_LIMIT_NAMESPACE_ID`
- `SITE_SESSION_KV_ID`
- `SITE_FORM_RATE_NAMESPACE_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Check whether variables exist without printing their values:

```powershell
@(
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "PRODUCTION_DEMO_PASSWORD",
  "TENANT_CACHE_KV_ID",
  "SITE_SESSION_KV_ID",
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY"
) | ForEach-Object {
  "$_=$([bool][Environment]::GetEnvironmentVariable($_, 'Process'))"
}
```

## Current production demo accounts

`pnpm production:provision-demos` creates or updates these accounts. All six use the password in
the current `PRODUCTION_DEMO_PASSWORD` environment variable:

| Workspace | Email |
| --- | --- |
| Platform Studio | `demo+platform-admin@soliventa.tech` |
| Horizon / Northstar administrator | `demo+horizon-admin@soliventa.tech` |
| Crest / St. Aurelia administrator | `demo+crest-admin@soliventa.tech` |
| Meridian administrator | `demo+meridian-admin@soliventa.tech` |
| Mosaic / Bloomfield administrator | `demo+mosaic-admin@soliventa.tech` |
| Vector administrator | `demo+vector-admin@soliventa.tech` |

The actual password is intentionally absent from this document and Git. To rotate all demo
passwords, set a new strong value and rerun the idempotent provisioner:

```powershell
$env:PRODUCTION_DEMO_PASSWORD = Read-Host "Enter a new strong demo password"
$env:CONFIRM_PRODUCTION_DEMO = "ALL_FIVE_PRODUCTION"
pnpm production:provision-demos
```

The production demo provisioner does **not** create teacher, student, parent, applicant, bursar,
registrar, admissions officer, exam officer, librarian, or other specialist accounts. Those users
must be invited or created within the appropriate school and assigned only their required roles.
Accounts named `e2e-*` belong to hosted development fixtures and must not be used as production
credentials.

## Deploy the maintained production environment

From the API repository:

```powershell
cd C:\Users\HP\Projects\soliventa-learn-api
$env:CONFIRM_PRODUCTION_DEMO = "ALL_FIVE_PRODUCTION"
pnpm production:validate
pnpm production:provision-demos
pnpm production:deploy
```

`production:deploy` uploads `PREVIEW_TOKEN_SECRET` to the API Worker before deployment. The value
must be at least 32 characters and should remain stable so preview links issued by the previous
deployment remain valid until their normal expiry.

From the web repository:

```powershell
cd C:\Users\HP\Projects\soliventa-learn-web
$env:VITE_SUPABASE_URL = $env:SUPABASE_URL
$env:VITE_SUPABASE_PUBLISHABLE_KEY = $env:SUPABASE_PUBLISHABLE_KEY
pnpm run production:deploy:web
pnpm production:promote-demos
```

The school-site deployment also binds `preview.learn.soliventa.tech`; this hostname serves private,
short-lived draft previews and must not be replaced with a tenant's public hostname.

After publishing, clear tenant-resolution cache entries:

```powershell
cd C:\Users\HP\Projects\soliventa-learn-api
pnpm production:clear-demo-cache
```

Use `pnpm run production:deploy:portals`, not `pnpm --filter ... deploy`; the latter can invoke
pnpm's unrelated built-in deploy operation.

## Onboard a real school

1. Sign in to `https://platform.learn.soliventa.tech/platform` with a platform administrator or
   operator account.
2. Create the school in staged state with a stable code, legal name, and display name. Never reuse
   a school code or UUID from a demo tenant.
3. Grant only the purchased feature entitlements. Entitlements and navigation visibility are
   separate from user permissions.
4. Provision the default public-site and portal domains. For a custom school-owned domain, submit
   it through domain management, give the school the displayed CNAME/TXT records, and wait until
   ownership and certificate status are both active.
5. Create the initial school administrator through the invitation flow. Do not share the demo
   password or manually reuse another school's membership.
6. The administrator accepts the emailed invitation, chooses a unique password, and completes
   school branding, terminology, contact information, portal policies, and navigation.
7. Save a draft, preview it, and publish it. Published versions remain immutable; later changes
   create new versions and rollback targets.
8. Configure academic sessions, terms, classes, arms, subjects, teacher assignments, and student
   enrolment before expecting classrooms, registers, or authorized teacher/student views.
9. Configure payment methods and verified email sender details before enabling fee payment or
   transactional messages.
10. Invite staff and guardians and create/link students. Assign specialist roles explicitly.
    Identity ownership, tenant membership, lifecycle state, role, and resource scope remain
    separate authorization boundaries.
11. Verify the public site, portal login, role navigation, direct API authorization, email delivery,
    payment callback/webhook handling, cache invalidation, and cross-tenant denial before launch.

## Creating role-specific accounts

- School administrators invite staff from the People/Teachers administration experience.
- Assign teacher roles and teaching/class-teacher assignments separately; a teacher role alone
  does not authorize every learner.
- Students receive portal identity when created or converted from an accepted applicant. Their
  class enrolment must reference the active session and class/arm.
- Guardians receive their own identity and must be linked to specific students. They never receive
  classroom membership merely because they are guardians.
- Applicants remain linked to admission applications until accepted, offered, and converted
  idempotently into student records.
- Specialist staff use the shared administrator shell with explicit permissions for finance,
  admissions, exams, registration, library, or other assigned responsibilities.
- Platform roles are assigned only in Platform Studio and do not grant implicit access to school
  tenant data.

## Verification and recovery

Verify websites and portals:

```powershell
$hosts = @(
  "horizon.learn.soliventa.tech", "portal.horizon.learn.soliventa.tech",
  "crest.learn.soliventa.tech", "portal.crest.learn.soliventa.tech",
  "meridian.learn.soliventa.tech", "portal.meridian.learn.soliventa.tech",
  "mosaic.learn.soliventa.tech", "portal.mosaic.learn.soliventa.tech",
  "vector.learn.soliventa.tech", "portal.vector.learn.soliventa.tech",
  "platform.learn.soliventa.tech"
)
foreach ($hostName in $hosts) {
  curl.exe -sS -o NUL -w "$hostName -> HTTP %{http_code}`n" "https://$hostName/"
}
```

If a site returns 503 immediately after publishing and Worker logs report `bootstrap.version`, clear
the tenant cache with `pnpm production:clear-demo-cache`. If bootstrap reports schema validation,
validate the published configuration rather than bypassing validation or modifying production data
in place.

Apply database changes only through forward migrations. Never run `supabase db reset` against a
hosted production project.

If `/api/v1/complete-platform` reports `complete-platform.workspace.45`, apply
`20260903140000_repair_conversation_participant_read_state.sql`. This repairs an older partial
`conversation_participants` table without replaying the complete-platform baseline migration.
