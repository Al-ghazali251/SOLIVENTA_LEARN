# Phase 14 comprehensive testing

Phase 14 is an executable release gate, not a claim that unfinished modules are tested. The source of truth is `ops/testing/phase-14-gates.json`; run `pnpm phase14:status` for the current gap report and `pnpm phase14:enforce` in a release pipeline.

## Test layers

- `pnpm test` covers deterministic domain and service rules, including grading, fee balances, role permissions, hostname normalization, feature and navigation evaluation, content validation, payment transitions, jobs, configuration, domains, caching, and the API foundation.
- `pnpm db:test` runs pgTAP against a local Supabase stack. It covers tenant RLS, guessed UUIDs, cross-school writes, parent-child scope, score and payment constraints, suspended schools, domains, jobs, and academic structure.
- `pnpm test:hosted` exercises the provisioned hosted project through Supabase Auth and the local API. It verifies public tenant mapping, an authenticated portal bootstrap, and School A credentials being rejected on School B.
- `pnpm test:integration` is safe in ordinary CI and skips hosted checks unless `RUN_HOSTED_INTEGRATION=1` is explicitly set.
- `pnpm test:performance` runs the initial k6 public-bootstrap profile. It requires k6 on PATH and a running API.
- `pnpm --dir ../soliventa-learn-web demo:verify` signs in through a real browser and captures the Greenfield site and portal.

## Security coverage and remaining work

Existing executable coverage includes tenant RLS, UUID substitution, cross-origin denial, preview-token binding, service-secret source scanning, configuration URL validation, idempotent jobs, duplicate payment-event rules, and tenant membership isolation. Expired tokens, disabled Auth users, storage MIME/signature attacks, rate-limit distribution, Paystack callbacks, CSRF, AI injection, and destructive AI confirmation must be added with the modules that own those behaviors.

## Performance matrix

The checked-in k6 profile establishes warm-bootstrap thresholds. Cold cache, galleries, templates, fonts, global regions, large portal datasets, concurrent result entry, exam autosave, payment spikes, and bulk admissions require representative seeded datasets and staging infrastructure. Results must be stored as release evidence; a script existing is not a passing result.

## Recovery evidence

Configuration rollback and idempotent queue behavior have unit/database coverage. Database PITR, storage recovery, deployment rollback, queue replay, and domain restoration require a staging recovery exercise. Record the backup identifier, operator, timestamps, recovery point, integrity checks, observed RTO/RPO, and links to logs. The recovery gate remains `not-demonstrated` until that exercise succeeds.

## Milestone 3 reality

Login is implemented. Classes are an implementation candidate with remaining gates. Students, Staff, Attendance, Results, and Fees do not yet have complete repositories, application services, versioned API operations, portal workflows, and end-to-end journeys. Results and Fees now have tested pure rules only. Phase 14 must remain open until these modules and their critical journeys exist.
