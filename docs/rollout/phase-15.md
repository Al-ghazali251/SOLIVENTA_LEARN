# Phase 15 staging and pilot rollout

Phase 15 is prepared before Milestone 3 implementation so every module is built against representative tenant shapes and a controlled rollout path. Preparation is complete; a real pilot is not complete until the evidence file records successful staging, support, pilot, and rollback exercises.

## Provision representative staging tenants

Create an isolated Supabase staging project, apply the reviewed migrations, and copy `config/staging.vars.example` to the ignored `.staging.vars`. Use a staging-only secret key and a staging platform base domain. Never point this file at production.

Run:

```powershell
pnpm staging:tenants
```

The command refuses to run unless `APP_ENV=staging` and the explicit staging confirmation value is present. It creates seven deterministic scenarios from `ops/staging/representative-tenants.json`, rotates one synthetic operator credential into ignored `.env.staging-fixtures`, publishes valid configurations, creates platform-domain mappings, leaves the illustrative custom domain awaiting DNS, and generates synthetic learners in batches. All identities, email addresses, names, phone numbers, and addresses are visibly synthetic.

## Parallel verification

`ops/pilot/workflow-comparison.json` is the discrepancy register. For every workflow:

1. Record the legacy test case and sanitized input identifier.
2. Run the same input in both systems.
3. Attach database-diff, permission, calculation, receipt, or report evidence as appropriate.
4. Classify each discrepancy as critical, high, medium, low, accepted, or resolved.
5. Record the owner and resolution reference.
6. Set the workflow to `passed` only when no critical or high discrepancy remains.

Staff, Students, Attendance, Results, and Fees remain blocked until their Milestone 3 implementations exist. Website publication and domain configuration are ready for comparison.

## Pilot sequence

Select one cooperative, low-complexity school only after the internal cohort passes. Obtain written authorization and nominate a school owner, Soliventa owner, support owner, rollback decision-maker, pilot start, and pilot end.

Enable progressively:

1. Public website and configuration rollback.
2. Custom domain with the old domain target retained for rollback.
3. Staff access and membership revocation.
4. Synthetic rehearsal followed by approved student import.
5. Attendance.
6. Results and parent visibility.
7. Parents.
8. Fees using Paystack test mode before live mode.
9. Remaining approved features.

Stop expansion for any cross-tenant exposure, data loss, incorrect financial state, unresolved high-impact calculation difference, sustained availability breach, or unavailable rollback route.

## Cohorts

The only permitted progression is `internal` → `pilot-one` → `pilot-3-5` → `mixed-cohort` → `general-availability`. Update `ops/pilot/phase-15-evidence.json` through review; do not skip cohorts or set general availability directly.

## Rollback exercise

Before the pilot, demonstrate—not merely document—the following in staging:

- restore the previous public configuration version and purge/pre-warm tenant caches;
- return DNS/custom hostname traffic to the old site;
- disable new portal access without deleting identities;
- stop new writes and export all pilot-period changes with audit IDs;
- restore the previous deployment artifact;
- replay or dead-letter in-flight jobs without duplication;
- reconcile student, result, fee, and payment changes before reopening either system.

Record timestamps, operator, trigger, commands/runbook revision, integrity checks, observed recovery time, data-loss window, and evidence links in `ops/pilot/phase-15-evidence.json`.

## Support readiness

Support must rehearse login recovery, membership problems, domain status, publish rollback, import rejection, job failure, payment-verification escalation, incident severity, tenant-safe log lookup, and the pilot rollback call tree. Attach attendance and rehearsal evidence before setting `supportReadiness` to `passed`.

## Gate

```powershell
pnpm phase15:status
pnpm phase15:enforce
```

`phase15:enforce` is intended for the release pipeline and remains failing until a real pilot, repeatable migration, discrepancy closure, support rehearsal, and rollback exercise all have evidence.
