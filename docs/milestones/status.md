# Soliventa Learn milestone status

## Milestone 1 — secure foundation

Implementation status: complete. Production assurance status: conditional.

Evidence in the repositories includes removal of the legacy public bootstrap-moderator path, separate API and web repositories, CI and database/security workflows, ignored environment-specific secret files, new-format Supabase secret keys isolated to the API gateway, reviewed greenfield migrations and pgTAP tests, tenant/domain resolution from trusted hostnames, explicit roles and permissions, school membership enforcement, CORS tied to active domains, normalized errors, structured auditing, and hosted cross-school authentication tests.

The production assurance label remains conditional until staging dependency scanning, database tests, incident alerts, and recovery exercises produce retained evidence. A code implementation cannot substitute for those operational exercises.

## Milestone 2 — fast school websites

Implementation status: complete. Production rollout status: conditional.

The web repository contains the Astro server-rendered public application, semantic theme tokens, three templates, structured content blocks, bounded client islands, image/SEO/form controls, customization drafts/preview/publish/rollback, platform and custom-domain workflows, versioned cache keys and invalidation, bundle budgets, and a browser-tested Greenfield site. Schools can be onboarded on platform subdomains in a configured deployment.

Real custom-domain certificate issuance, globally distributed cold/warm performance measurement, and production Core Web Vitals remain deployment evidence—not missing application code.

## Milestone 3 — core portal

Implementation status: implementation candidate. Pilot status: not approved.

Implemented vertical slices:

- branded Supabase login, membership verification, permission navigation, and scoped bootstrap;
- Students creation/update model, class placement, listing, tenant constraints, API compatibility route, and portal screen;
- Staff invitation, Auth/profile/membership/staff compensation, deactivation, role selection, listing, and portal screen;
- Classes, subjects, sessions, terms, teacher/class/subject relationships, API service, and portal workspace;
- daily Attendance upsert, correction history timestamps, student/class/term invariants, scoped reads, and portal entry/listing;
- assessment definitions, score maximum and class validation, score entry, releases, report-card compatibility API, and portal workflow;
- fee definitions, invoices, discounts, manual payments, Paystack initialization/provider verification/signed webhook handling, unique references, invoice/student invariants, idempotent settlement, balance status updates, and portal workflow;
- operation-specific permissions, school and resource scoping for staff, teachers, students, and linked guardians;
- audit events for every command, OpenAPI contract, generated browser client, unit tests, pgTAP security tests, hosted tenant isolation, and browser journeys.

Remaining approval gates:

- run pgTAP locally/CI once Docker or Podman is available;
- execute staff email delivery and invitation acceptance against a controlled staging mailbox;
- complete one Paystack test checkout to retain successful webhook, settlement, invoice, and receipt evidence;
- run large-dataset, concurrent-entry, staging performance, and recovery suites (login accessibility automation now passes);
- compare legacy behavior and obtain internal/pilot approval.

Because those gates are required by the project’s own migration standard, Milestone 3 must not be called production-complete yet.
