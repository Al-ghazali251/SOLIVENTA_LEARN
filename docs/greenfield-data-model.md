# Greenfield data and tenancy model

Soliventa Learn does not inherit or migrate the former database. The first migration is a reviewed greenfield baseline whose security properties are reproducible from an empty Supabase project.

## Trust boundaries

1. A hostname selects a tenant presentation context; it never proves authorization.
2. An authenticated user receives school access only through an active `school_memberships` row.
3. Ordinary membership stops working when a school is suspended or archived.
4. Platform moderation is separate from school membership.
5. Every relationship between tenant-owned records carries or validates the same `school_id`.
6. `school_id` is immutable after a row is created.
7. RLS is the final database boundary even when the API has already authorized a request.
8. Service-role access is restricted to narrowly scoped backend services and is never used by browsers.

## Table classification

| Table                       | Level             |                `school_id` | RLS | Primary isolation/invariant                               |
| --------------------------- | ----------------- | -------------------------: | --: | --------------------------------------------------------- |
| `profiles`                  | Platform identity |                         No | Yes | Own profile or moderator                                  |
| `schools`                   | Platform registry | Its `id` is the tenant key | Yes | Active membership or moderator                            |
| `platform_role_assignments` | Platform          |                         No | Yes | Self/moderator visibility; service-managed                |
| `school_memberships`        | School            |                        Yes | Yes | Unique school/user/role; immutable tenant                 |
| `tenant_domains`            | School            |                        Yes | Yes | Globally unique normalized hostname; one primary per type |
| `tenant_config_versions`    | School            |                        Yes | Yes | One published version; immutable snapshots                |
| `tenant_branding`           | School            |                        Yes | Yes | Same-school version FK; one per version                   |
| `tenant_features`           | School            |                        Yes | Yes | Same-school version FK; unique feature per version        |
| `tenant_navigation`         | School            |                        Yes | Yes | Same-school version FK; stable positions                  |
| `tenant_pages`              | School            |                        Yes | Yes | Same-school version FK; unique slug per version           |
| `tenant_page_blocks`        | School            |                        Yes | Yes | Same-school page/version FKs; stable positions            |
| `students`                  | School            |                        Yes | Yes | Unique admission number and active username per school    |
| `guardians`                 | School            |                        Yes | Yes | Unique user per school                                    |
| `guardian_student_links`    | School            |                        Yes | Yes | Compound FKs prevent cross-school links                   |
| `fee_payments`              | School            |                        Yes | Yes | Non-negative minor units; unique provider reference       |
| `assessment_scores`         | School            |                        Yes | Yes | Score is between zero and its maximum                     |
| `audit_events`              | Platform/school   |                   Nullable | Yes | Append-only to users; manager/moderator read              |
| `cache_invalidation_outbox` | School operations |                        Yes | Yes | Transactional publication side effect                     |

## Views

The baseline intentionally defines no public database views. Public websites consume the API, preventing direct exposure of domain verification material or incomplete configuration. Purpose-built read models can be added later with `security_invoker = true` and dedicated tests.

## Functions

| Function                   | Security | Caller validation                                                         |
| -------------------------- | -------- | ------------------------------------------------------------------------- |
| `is_platform_moderator`    | Definer  | Checks explicit platform assignment                                       |
| `is_school_active`         | Definer  | Reads status only                                                         |
| `is_school_member`         | Definer  | Active school, user and membership                                        |
| `has_school_role`          | Definer  | Active school, user, membership and requested roles                       |
| `is_linked_guardian`       | Definer  | Active school plus compound guardian/student link                         |
| `can_manage_school`        | Definer  | Moderator or active admin membership                                      |
| `storage_object_school_id` | Invoker  | Safely parses a tenant storage prefix without querying tenant data        |
| `publish_tenant_config`    | Definer  | Authenticated manager, active school, owned draft and completeness checks |

All definer functions use an empty search path, fully qualified objects, revoked public execution, and explicit grants.

## Triggers

- `set_updated_at`: maintains timestamps.
- `prevent_school_id_change`: makes tenant ownership immutable.
- `protect_config_snapshot`: rejects changes to published or archived child records.
- `protect_config_version`: only permits the publication system to archive an otherwise immutable published version.

## Configuration publication

Draft configuration is never rendered as live configuration. `publish_tenant_config` performs one transaction:

1. Authorize the actor.
2. Lock and validate the active school.
3. Lock and validate the draft version.
4. Require branding and a home page.
5. Archive the previous published version.
6. Publish the draft and update the school pointer.
7. Append an audit event.
8. Add a cache-invalidation outbox item.

An API background worker will consume the outbox after commit. This avoids making an external Cloudflare call inside a database transaction.

## Storage

- `tenant-public-assets`: public read; school managers write below `{school_id}/...`.
- `tenant-private-files`: no anonymous read; school managers access below `{school_id}/...`.

More granular student, parent, admission and staff document policies must be introduced with their owning feature. The baseline deliberately defaults private files to administrators rather than broad school membership.

## Deferred domain models

Classes, subjects, sessions, terms, attendance, invoices, result releases, admissions, exams, messaging and library records will be introduced in feature migrations. Every new school-owned table must follow the checklist in `forward-migrations.md` and receive cross-tenant tests before merge.
