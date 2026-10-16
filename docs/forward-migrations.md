# Forward database migration process

There is no legacy migration archive because Soliventa Learn starts with a new database. `20260824150000_greenfield_tenancy_baseline.sql` is the authoritative baseline.

## Creating a migration

1. Start the local stack with `pnpm db:start`.
2. Create a migration with `pnpm exec supabase migration new <descriptive_name>`.
3. Make the migration forward-only and safe for existing data.
4. Add or update indexes, grants, RLS policies and security tests in the same pull request.
5. Reset locally with `pnpm db:reset` to prove creation from an empty database.
6. Run `pnpm db:lint` and `pnpm db:test`.
7. Generate and review the schema diff where applicable.
8. Apply to staging and run smoke/security tests before production.

## Tenant-owned table checklist

Every school-owned table must answer yes to the applicable items:

- It has a non-null `school_id`.
- Its `school_id` references `schools(id)`.
- Updates cannot change `school_id`.
- Cross-table tenant relationships use compound foreign keys including `school_id`.
- RLS is enabled.
- SELECT, INSERT, UPDATE and DELETE have explicit least-privilege behavior.
- Cross-school UUID guessing is tested.
- Common `school_id` access paths are indexed.
- Unique constraints include `school_id` unless uniqueness is intentionally global.
- Security-definer functions fully qualify names and validate `auth.uid()`.
- Suspended-school behavior is tested.
- Audit and retention requirements are documented.

## Deployment rules

- Never edit a migration already applied to staging or production.
- Prefer expand/migrate/contract changes for breaking schema evolution.
- Application releases must tolerate both the old and new shape during rolling deployment.
- Destructive changes require a verified backup, data migration evidence, and rollback procedure.
- Production migrations run once through CI/CD using a dedicated deployment identity.
- Application service-role credentials are not migration credentials.

## Environment promotion

```text
local reset and tests
        ↓
ephemeral CI database
        ↓
development project
        ↓
staging project and smoke tests
        ↓
backup and production migration
        ↓
post-deployment verification
```
