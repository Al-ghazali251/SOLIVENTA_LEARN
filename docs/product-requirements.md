# Soliventa Learn product requirements document

| Field          | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| Product        | Soliventa Learn                                             |
| Organization   | Soliventa Technologies (operating brand: Soliventa Tech)    |
| Status         | Working product baseline                                    |
| Version        | 1.0                                                         |
| Updated        | 25 August 2026                                              |
| Product model  | Multi-tenant school websites and school-management platform |
| Initial market | Nursery, primary and secondary schools, initially Nigeria   |
| Repositories   | `soliventa-learn-api` and `soliventa-learn-web`             |

## 1. Executive summary

Soliventa Learn gives every participating school the experience of owning an independent digital
product. Each school operates a distinctive public website and authenticated portal on its own
domains, with its own branding, navigation, content and enabled features. The platform team
maintains one secure backend and one configurable frontend codebase rather than a fork per school.

The product combines:

1. A fast, search-friendly public website for discovery, trust, news and admissions.
2. A secure portal for school administration, teachers, specialist staff, students and parents.
3. A platform control plane for school onboarding, domains, moderation and support.

A hostname selects presentation context; it never grants private access. Private requests are
independently authenticated, checked for active school membership and authorized for a permission
and, where relevant, a class, subject, student or linked child.

## 2. Problem statement

Schools often use generic portals, disconnected websites, spreadsheets, payment dashboards and
paper processes. Generic products weaken school identity, while separately built websites are slow
to improve, expensive to maintain and inconsistent in security.

Soliventa Learn must:

- Give each school a credible owned-web presence without a frontend fork.
- Allow safe customization without publishing incomplete drafts.
- Consolidate core admissions, academic and financial workflows.
- Give each user only the data and actions needed for their responsibilities.
- Let parents and students access trustworthy records in one place.
- Let the platform team operate many schools safely from shared infrastructure.
- Keep public experiences fast as tenant and feature counts grow.

## 3. Vision and principles

**Vision:** Every school can launch a distinctive, fast and secure digital campus while Soliventa
Learn supplies the shared technology and operational controls underneath it.

Product principles:

1. **School-owned experience:** Domain, identity and content should feel native to the school.
2. **Configuration over forks:** Variation comes from validated templates, tokens, blocks and
   features, not copied source code.
3. **Security by invariant:** Tenant and relationship boundaries are enforced by API and database.
4. **Publish, then render:** Live domains render immutable published configuration only.
5. **Fast by default:** Public pages use edge delivery, optimized assets and minimal JavaScript.
6. **Progressive capability:** A school may begin with a website and enable portal modules later.
7. **Auditable operations:** Sensitive changes identify actor, tenant, target and outcome.

## 4. Goals and non-goals

### Goals

- Launch custom-domain school websites from one frontend codebase.
- Give managers controlled branding, content, navigation and feature configuration.
- Provide secure, role-aware portals for all core school personas.
- Establish a reliable academic and operational system of record.
- Support admissions, attendance, results, fees and payments as the operational core.
- Provide safe school lifecycle, custom-domain and audit capabilities to platform operators.
- Maintain measurable performance, availability, accessibility and tenant-security objectives.

### Non-goals for the first release

- Separate source forks or bespoke applications per school.
- Arbitrary tenant HTML, JavaScript or server-side templates.
- Native mobile applications.
- Full accounting, payroll or human-resources management.
- Migrating or reusing the former AcademIQ database.
- Trusting client-side roles, supplied school IDs or browser-reported payment success.
- AI making destructive decisions without explicit human confirmation.

## 5. Personas and access model

| Persona              | Primary responsibilities                                    | Required scope                           |
| -------------------- | ----------------------------------------------------------- | ---------------------------------------- |
| Platform moderator   | School lifecycle, domains, support and platform audit       | Platform permissions; MFA; fully audited |
| School administrator | Configuration, people, academics and operations             | Current active school                    |
| Teacher              | Assigned classes, subjects, attendance, learning and scores | Assigned resources only                  |
| Exam officer         | Assessments, results, broadsheets and release               | Result/exam permissions                  |
| Bursar               | Fees, payments, balances and receipts                       | Finance permissions                      |
| Librarian            | Catalogue, loans, returns and fines                         | Library permissions                      |
| Student              | Own learning, attendance, results and fees                  | Self only                                |
| Parent or guardian   | Permitted records for linked children                       | Linked children only                     |
| Applicant            | School discovery and own admission application              | Public and own application only          |
| Public visitor       | Published school information                                | Public content only                      |

A person may hold several roles. Effective permissions are the union of active role grants, but
resource scope remains restrictive. Multi-school identity behavior is an open decision in section 16.

## 6. Product surfaces

### Public school site

The request hostname selects a published tenant configuration. The site supports school identity,
structured pages, news, contact information and admissions calls to action. It is server/edge
rendered where practical and ships minimal browser JavaScript.

### School portal

The authenticated portal has role-aware navigation and route-level feature loading. Bootstrap is a
small shell response; module data loads on demand. Private data never enters a shared cache.

### Platform control plane

Platform moderators onboard and suspend schools, verify domains, manage platform integrations,
support tenants and inspect audit events. Platform authority is separate from school membership.

### API and frontend client

The versioned API is the only product boundary for both frontends. OpenAPI is canonical and both
apps consume a generated browser-safe client. Frontends do not import backend source, access
Supabase directly or assemble endpoint URLs throughout components.

## 7. Release scope

### Foundation — implemented

- Independent API/web repositories and enforced dependency boundaries.
- Greenfield tenant, identity and published-configuration baseline.
- Trusted-host custom-domain resolution.
- Request IDs, security headers, CORS, rate limiting, logs and normalized errors.
- Authentication, active membership, explicit permissions and authorization scopes.
- Public and portal bootstrap endpoints with safe caching.
- Versioned OpenAPI and generated typed frontend client.

### Minimum viable launch

- School onboarding, status and domain activation.
- Branding, pages, navigation and draft/preview/publish workflow.
- Production public templates and core pages.
- Authentication, profile and school-user management.
- Sessions, terms, classes, subjects and teacher assignments.
- Students, guardians and their relationships.
- Public admissions and application review.
- Attendance recording and authorized summaries.
- Score entry, result approval/release and report cards.
- Fees, invoices, verified payments, balances and receipts.
- Sensitive-operation audit history and essential operational dashboards.

### Subsequent releases

- Learning content, assignments, submissions and schemes of work.
- Computer-based examinations.
- Announcements, messaging and notifications.
- Library management, advanced analytics and exports.
- Rho AI assistant with permission-scoped tools and human confirmation.
- Additional payment and communications providers.
- Offline-assisted workflows if validated by customer research.

## 8. Functional requirements

“Must” is launch-blocking for the release containing that domain. IDs are stable references for
epics, acceptance tests and API contracts.

### Tenant lifecycle and domains

- **FR-TEN-001:** Moderators must create a school with an immutable tenant ID, display/legal names,
  code and lifecycle status.
- **FR-TEN-002:** Each school must support separate public and portal domains, with one primary active
  domain of each type.
- **FR-TEN-003:** A hostname must be normalized, globally unique, verified and active before serving
  a tenant.
- **FR-TEN-004:** Pending, failed, removed, suspended and unknown domains must not serve active
  configuration.
- **FR-TEN-005:** Client `schoolId`, forwarded-host headers and arbitrary headers must never choose
  tenant identity.
- **FR-TEN-006:** Suspending a school must stop ordinary private access and apply an approved public
  suspension experience.

### Configuration and public website

- **FR-CFG-001:** Managers must configure approved logos, favicon, colors, fonts and design tokens.
- **FR-CFG-002:** Managers must select approved templates and compose pages from validated blocks.
- **FR-CFG-003:** Header, footer and portal navigation must support stable ordering and optional
  feature requirements.
- **FR-CFG-004:** Draft content must never appear on a live domain.
- **FR-CFG-005:** Publishing must validate completeness, publish an immutable version, update the
  school pointer, audit the action and invalidate stale cache mappings.
- **FR-CFG-006:** Managers must have a secure, non-indexed preview before publication.
- **FR-CFG-007:** Published history must support audit and a controlled rollback process.
- **FR-CFG-008:** Tenant content must not execute arbitrary scripts or unsanitized rich HTML.

### Bootstrap and caching

- **FR-BTS-001:** `GET /v1/public/bootstrap` must resolve from hostname and return only public tenant,
  branding, template, features, navigation and configuration version.
- **FR-BTS-002:** `GET /v1/portal/bootstrap` must require token and active membership and return only
  tenant, current profile, roles, permissions, portal features, navigation, status and inexpensive
  unread counts.
- **FR-BTS-003:** Portal bootstrap must not aggregate dashboard/module data.
- **FR-BTS-004:** Domain and configuration caches must use server-owned normalized and versioned
  keys. Unknown domains receive only short negative caching.
- **FR-BTS-005:** Private responses must be `no-store`; malformed cache values must be discarded.
- **FR-BTS-006:** Cache hit/miss and bootstrap duration must be observable without private data.

### Identity and authorization

- **FR-IAM-001:** Users must have secure sign-in, verification and recovery flows.
- **FR-IAM-002:** Every private request must verify bearer token, tenant and active membership.
- **FR-IAM-003:** Roles map to explicit permissions; frontend visibility never grants authority.
- **FR-IAM-004:** Teachers may act only on assigned classes and subjects.
- **FR-IAM-005:** Students access self only; guardians access explicitly linked children only.
- **FR-IAM-006:** Elevated identity operations require a verified authorization context and private
  administrative gateway.
- **FR-IAM-007:** Platform moderators must use MFA before production launch.
- **FR-IAM-008:** Membership deactivation must stop authorizing new requests promptly.

### Academic structure, people and guardians

- **FR-ACA-001:** Administrators must manage sessions and terms with active and closed states.
- **FR-ACA-002:** Administrators must manage classes/sections, subjects and school terminology.
- **FR-ACA-003:** Class-teacher and teacher-subject-class assignments must be explicit and historical.
- **FR-ACA-004:** Cross-school assignments and invalid overlapping academic periods must fail.
- **FR-PEO-001:** Administrators must manage student identity, enrollment, status, demographics and
  approved documents.
- **FR-PEO-002:** Admission numbers and active usernames are unique within a school.
- **FR-PEO-003:** Administrators must manage staff profiles, memberships, roles and assignments.
- **FR-PEO-004:** Guardian/student links must be same-school relationships enforced beyond the UI.
- **FR-PEO-005:** Medical, learning and private documents require narrower access than demographics.

### Admissions

- **FR-ADM-001:** Public applications must belong to the school resolved from the hostname.
- **FR-ADM-002:** Schools configure fields, documents, admissions windows and instructions.
- **FR-ADM-003:** Applicants receive a reference and safe own-status verification mechanism.
- **FR-ADM-004:** Authorized staff transition applications through defined statuses with audit.
- **FR-ADM-005:** Converting an accepted application into a student must be idempotent and avoid
  duplicate identities/admission numbers.
- **FR-ADM-006:** Admission email attempts and outcomes are recorded without provider secrets.

### Attendance

- **FR-ATT-001:** Teachers/admins record date attendance only within authorized scope.
- **FR-ATT-002:** Retry must be idempotent or an explicit audited correction.
- **FR-ATT-003:** Students see self and parents see linked-child attendance only.
- **FR-ATT-004:** Term summaries use school calendar days and consistent status rules.
- **FR-ATT-005:** Corrections retain actor and timestamp history.

### Results

- **FR-RES-001:** Schools configure assessment components, maximums, grade boundaries and release
  rules.
- **FR-RES-002:** Teachers/officers record scores only for authorized class-subject assignments.
- **FR-RES-003:** Scores remain between zero and configured maximum at API and database levels.
- **FR-RES-004:** Totals, grades, remarks and report cards use versioned grading configuration.
- **FR-RES-005:** Draft, approved and released states are explicit.
- **FR-RES-006:** Students/parents cannot view unreleased or locked results.
- **FR-RES-007:** Post-approval/release corrections are restricted and audited.

### Fees and payments

- **FR-FIN-001:** Authorized staff configure fees and issue student invoices.
- **FR-FIN-002:** Amounts use non-negative integer minor units and explicit currency.
- **FR-FIN-003:** Students/parents see appropriate invoices, verified payments, balance and receipts.
- **FR-FIN-004:** Only server-to-server verification can mark online payment successful.
- **FR-FIN-005:** Provider references are unique and callbacks/verifications idempotent.
- **FR-FIN-006:** Manual payments, waivers, reversals and adjustments require actor, reason and audit.
- **FR-FIN-007:** Provider secrets exist only in backend environment bindings.

### Later operational domains

- **FR-LMS-001:** Teachers manage learning content and assignments only within assigned scope;
  students view and submit applicable work.
- **FR-EXM-001:** Authorized staff manage timed exams, validated questions, autosave and one
  authoritative submission.
- **FR-EXM-002:** Integrity events may be recorded, but the product must not claim perfect
  anti-cheating protection.
- **FR-COM-001:** Schools publish audience-scoped announcements and track transactional delivery.
- **FR-COM-002:** Expensive unread calculations load separately from portal bootstrap.
- **FR-LIB-001:** Librarians manage catalogue, copies, loans, returns and approved fines.
- **FR-AUD-001:** Sensitive mutations append actor, request, tenant, action, target and safe metadata.
- **FR-AI-001:** AI tools call ordinary authorized services, never raw database/service-role clients.
- **FR-AI-002:** AI preserves tenant scope, uses strict schemas and requires later-message
  confirmation for destructive work.

## 9. Customization constraints

Supported customization includes approved assets, accessible colors, approved fonts, templates,
layout options, structured navigation/page blocks, terminology, feature flags, contact/social data
and SEO metadata.

Constraints:

- No tenant executable JavaScript or arbitrary server templates.
- Rich content is sanitized and asset type, size, dimensions and storage path are validated.
- Tokens have safe defaults; incomplete optional configuration cannot break rendering.
- Color choices cannot bypass contrast requirements.
- Template/block deprecation requires migration and compatibility planning.

## 10. Non-functional requirements

### Performance

| Metric                        |                      Target | Measurement                        |
| ----------------------------- | --------------------------: | ---------------------------------- |
| Cached public bootstrap p95   | ≤ 200 ms from target market | Synthetic staging/production probe |
| Uncached public bootstrap p95 |                    ≤ 500 ms | Synthetic staging probe            |
| Public LCP p75                |                     ≤ 2.5 s | Real-user monitoring               |
| Public INP p75                |                    ≤ 200 ms | Real-user monitoring               |
| Public CLS p75                |                       ≤ 0.1 | Real-user monitoring               |
| Ordinary portal read p95      |                    ≤ 500 ms | API telemetry                      |

Performance must be evaluated on representative Nigerian mobile networks and devices, not only
local broadband.

### Reliability

- Production API availability target is 99.9% monthly, excluding announced maintenance.
- Liveness tests runtime execution; readiness tests required dependencies without secret details.
- Payment, email and AI failures must degrade their domain without breaking unrelated navigation.
- Retryable work uses bounded retries, idempotency and outbox/dead-letter handling.
- Backup recovery-point and recovery-time objectives must be agreed before production onboarding.

### Security and privacy

- TLS is required on production domains; RLS is the final tenant boundary.
- Same-school relationships are enforced with compound constraints or validated triggers.
- Service-role access remains confined to narrow backend gateways.
- Responses never expose raw provider errors, stack traces, credentials or private settings.
- Logs contain no passwords, tokens, keys, payment details or private student documents.
- Sensitive documents use private storage and short-lived authorized access.
- Security headers, strict CORS, rate limits, secret scans and dependency/boundary checks apply.
- Retention, export, correction and deletion policies require approval before production.

### Accessibility and compatibility

- Public and portal interfaces target WCAG 2.2 AA and keyboard operation at 200% zoom.
- Forms provide labels, field errors and error summaries; destructive actions explain consequences.
- Current and previous major Chrome, Edge, Firefox and Safari releases are supported, including
  relevant mobile equivalents and low-to-mid-range Android devices.
- Additive API changes remain in `v1`; breaking changes require a new version or coordinated rollout.

## 11. Data and tenancy requirements

1. The product starts from the reviewed greenfield schema; the former database is not reused.
2. Tenant records carry immutable `school_id` and same-school relationships are constrained.
3. Live rendering uses only the published configuration pointer; published snapshots are immutable.
4. Private access requires tenant context plus independently verified membership.
5. Parent-child, student-self and teacher-assignment scope is checked at resource level.
6. Every sensitive domain receives same-school and cross-school read/write security tests.
7. Business identifiers have tenant-appropriate uniqueness constraints.
8. Timestamps are stored in UTC and displayed in the school's configured timezone.

## 12. Caching and delivery requirements

- Domain keys contain only normalized trusted hostnames.
- Configuration keys contain server-derived school ID and immutable published version.
- Page keys contain school ID, version and normalized slug.
- Unknown domains use short negative TTLs and cannot overwrite valid-host keys.
- Domain mappings are invalidated after publication or lifecycle changes.
- Locale affects shared caching only from a supported-locale allowlist; arbitrary headers/query values
  cannot create unbounded keys.
- Public assets use fingerprinted immutable URLs.
- Authenticated responses use `private, no-store` and never enter shared edge caches.

## 13. API and integration requirements

- Versioned routes model product capabilities, not database table names.
- Every endpoint documents request/response/error schemas, authentication, permission, pagination,
  idempotency and relevant rate limits.
- Responses use `{ data, meta: { requestId } }` or `{ error: { code, message, requestId } }`.
- Lists use bounded cursor pagination unless another model is justified.
- Retryable mutations define idempotency behavior.
- OpenAPI and frontend client generation are deterministic and drift-checked in CI.
- Payments, email, domains and identity use private provider adapters.
- Webhooks authenticate delivery and process repeated events idempotently.

## 14. Success metrics and telemetry

| Objective            | Metric                                                          |
| -------------------- | --------------------------------------------------------------- |
| Activation           | Median time from approved onboarding to active custom domain    |
| Website adoption     | Active schools with published branding and home page            |
| Portal adoption      | Weekly active users by persona and school                       |
| Operational adoption | Schools actively using attendance, results, admissions and fees |
| Parent value         | Enrolled students with an activated linked guardian             |
| Reliability          | Availability and successful-request rate by tenant/route        |
| Performance          | Bootstrap/API p50/p95/p99 and public Core Web Vitals            |
| Support              | Tenant-impacting incidents and median resolution time           |

Required telemetry includes request ID, environment, route pattern, status, latency, safe tenant ID,
cache status, authorization failure category, external operation outcome, outbox age/retries and
deployment/contract version. Analytics must avoid unnecessary sensitive student data.

## 15. Critical journeys and acceptance

### School website launch

Moderator creates school; manager completes a draft; ownership/certificate are verified; manager
previews and publishes; custom domain serves the published site.

Acceptance: no draft is public, unknown/pending domains do not resolve, stale mappings invalidate,
and no frontend fork is needed.

### Portal bootstrap

User opens the school's portal, signs in, and receives profile, roles, permissions and enabled shell
navigation. Feature data loads when its route opens.

Acceptance: another school's user receives no access; deactivated membership fails; response is
never shared-cached; navigation does not grant backend authority.

### Attendance

Assigned teacher records a class/date; API validates permission and assignment; student and linked
parent can view the correct summary.

Acceptance: unassigned/cross-school mutation fails and retries create no duplicate.

### Result release

Teacher records scores; officer approves and releases; student/linked parent sees the report card.

Acceptance: invalid scores fail at API/database, drafts remain private and corrections are audited.

### Verified payment

User initiates payment; backend creates transaction; provider verification confirms it; one payment,
balance and receipt are recorded.

Acceptance: browser claims cannot mark success, repeated delivery creates no duplicate and provider
reference cannot be reused across schools.

## 16. Open product decisions

These require an owner and decision date before their related feature begins:

1. Can one identity belong to multiple schools, and how does domain switching work?
2. Which curricula, school types, terminology and grading variants launch?
3. What separates website-only, core portal and premium plans?
4. What are subscription, trial, billing and suspension rules?
5. Which currencies/providers follow Paystack, and who pays transaction charges?
6. What are the legal basis, retention, export and deletion rules for student data?
7. Which student/admission/staff documents are required, and who can view them?
8. Is multilingual public content required, and which locales launch?
9. Are offline attendance and CBT required?
10. Which notification channels launch: email, SMS, WhatsApp, push or in-app?
11. Which result-lock/PIN behavior is a real customer requirement?
12. What recovery objectives and availability commitments are contractual?
13. What support access may moderators have to school data, with which approval controls?
14. What age, consent and guardian-verification rules apply to student accounts?

## 17. Risks and mitigations

| Risk                                   | Impact                    | Mitigation                                                     |
| -------------------------------------- | ------------------------- | -------------------------------------------------------------- |
| Customization becomes per-school forks | Slow, insecure delivery   | Approved templates/tokens/blocks and boundary checks           |
| Tenant bug exposes another school      | Critical privacy incident | Trusted host, membership, compound FKs, RLS, adversarial tests |
| Published changes remain stale         | Incorrect website         | Immutable versions, invalidation, cache metrics and rollback   |
| Portal bootstrap becomes a dashboard   | Slow, brittle portal      | Small shell response and on-demand module queries              |
| Payment delivery repeats               | Incorrect balances        | Unique references, server verification and idempotency         |
| School grading varies widely           | Result errors             | Versioned policies and golden-case tests                       |
| Sensitive data reaches logs            | Privacy incident          | Allowlisted structured logging and redaction review            |
| Weak connectivity harms adoption       | Failed workflows          | Mobile budgets, resumable flows and validated offline scope    |
| AI exceeds authority                   | Unauthorized actions      | Ordinary services, strict scope, audit and confirmation        |

## 18. Delivery and launch gates

Every increment includes acceptance criteria, API contract, validation, tenant/permission scope,
database/RLS controls where applicable, tests, generated-client synchronization, accessibility,
observability, audit behavior, migration/rollback and staging verification.

MVP launch requires:

1. A representative school completes staging onboarding, domain verification, publication and portal
   setup without engineering database edits.
2. Public pages meet agreed mobile performance and bootstrap targets.
3. Cross-tenant suites pass for every launched private domain.
4. Backup/restore, incident response, secret rotation and suspension procedures are tested.
5. Privacy, retention, terms and support-access policies are approved.
6. The generated web client matches the deployed staging API contract.
7. Payment/email integrations pass sandbox success, failure and retry scenarios.
8. Core journeys have no launch-blocking accessibility issue.
9. Monitoring, alerts, runbooks and owners exist for critical systems and queues.
10. A release owner approves rollout, rollback triggers and pilot-school communication.

## 19. Document governance

This is the canonical product baseline, not a substitute for domain specifications. Material scope,
persona, security, retention or metric changes require a reviewed update. Each implementation epic
must reference its `FR-*` requirements and link detailed acceptance cases, design, API contract and
data migration.

Supporting documents:

- [Engineering standards](engineering-standards.md)
- [Greenfield data and tenancy](greenfield-data-model.md)
- [Backend foundation](backend-foundation.md)
- [API contract policy](api-contract-policy.md)
- [Tenant bootstrap and caching](tenant-bootstrap.md)
- [Forward migrations](forward-migrations.md)
- [Legacy feature inventory](legacy-feature-inventory.md)
