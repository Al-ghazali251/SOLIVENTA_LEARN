# Platform Studio foundation

Platform Studio is the platform-operator control plane. It is deliberately separate from a
school tenant's administration workspace and is only served on a platform domain.

## Capabilities

- Create a staged school record and move schools through active, suspended, and archived states.
- View delivery domains across tenants without granting domain mutation implicitly.
- Grant or withdraw feature entitlements per school and control platform feature availability.
- Assign the `platform_admin`, `platform_operator`, `platform_support`, and `platform_auditor`
  roles independently of school memberships.
- Review cross-tenant audit events.

Every mutation has a dedicated permission. Read access never implies management access. Operators
cannot revoke their own platform role, and the gateway prevents removal of the last platform
administrator. Role-assignment changes are recorded in `identity_security_events`; operational
commands are recorded in `audit_events` with their actor and target.

## Lifecycle boundary

Creating a school establishes the tenant identity only. Domain provisioning, initial website
configuration, memberships, and entitlements remain explicit onboarding operations so partially
configured schools cannot accidentally be published.

## API

- `GET /v1/platform-studio` returns only collections authorized by the caller's platform
  permissions.
- `POST /v1/platform-studio/commands` accepts the discriminated commands defined in
  `src/platform-studio/model.ts`.

Both endpoints require authenticated platform scope and are exposed in the generated OpenAPI
contract used by the web API client.
