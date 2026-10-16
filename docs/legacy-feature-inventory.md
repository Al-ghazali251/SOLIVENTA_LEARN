# Legacy feature inventory and rebuild requirements

This document records product behavior observed in the former AcademIQ implementation. It is a requirements reference only. No legacy source or schema is adopted by the new platform.

## Actors

| Actor                | Core scope                                                                     |
| -------------------- | ------------------------------------------------------------------------------ |
| Platform moderator   | Platform configuration, school lifecycle, integrations, platform audit         |
| Super administrator  | Broad school administration                                                    |
| School administrator | School users, academics, settings, results, fees and operations                |
| Teacher              | Assigned classes and subjects, learning content, attendance, results and exams |
| Exam officer         | Exams, assessments, scores, releases and broadsheets                           |
| Bursar               | Fee structures, invoices, payments, balances and receipts                      |
| Librarian            | Catalogue, borrowing, returns and fines                                        |
| Student              | Own learning content, assignments, exams, results, attendance and fees         |
| Parent               | Data for explicitly linked children only                                       |
| Public applicant     | School discovery and admission application                                     |

## Functional domains

### Identity and access

- Email, username, and phone-oriented login experiences.
- Password reset and verification-code flows.
- Staff and student account provisioning.
- Multi-role users and school-scoped roles.
- Parent invitations and parent-to-student linking.
- Suspended school access handling.

Rebuild requirement: explicit permission policies, verified tenant membership, MFA for platform operators, and no public bootstrap mechanism.

### School and academic structure

- School onboarding, profiles, branding, assets, bank details and configurable terminology.
- Academic sessions and terms.
- Classes, subjects, class teachers, teacher-class assignments and teacher-subject assignments.
- Subject templates and school-specific configuration.

### Students and staff

- Student demographics, guardians, medical/learning notes, documents, admission number, status and class enrollment.
- Staff identity, contact information, roles, class and subject allocation.
- Account creation, credential changes, deactivation and deletion behavior.

### Attendance

- Date-based student attendance.
- Teacher/admin/exam-officer recording access.
- Student self-view and linked-parent summaries.
- Term-based attendance calculations.

### Learning management

- Lessons, assignments, submissions and grading.
- Scheme of work by class, subject, week and term.
- Class and student dashboards showing recent work.
- Announcements and audience selection.

### Exams

- Exam creation, questions, options, publication, closure and attempts.
- Objective and short-answer questions.
- Timed attempts, autosave, submission and grading.
- Fullscreen/visibility/right-click violation recording.
- Teacher and exam-officer management.

### Results

- Assessment configuration, continuous assessment and examination scores.
- Subject totals, grades, positions, remarks and psychomotor scores.
- Broadsheets and report cards.
- Term/session filtering and controlled result release.
- Parent result locks and linked-child visibility.

### Fees and payments

- Fee items, student invoices, balances, manual payments and receipts.
- School bank-account configuration.
- Paystack bank resolution, transaction initialization, server-side verification and platform settings.
- Financial summaries for bursars, administrators, students and parents.

Rebuild requirement: idempotent verification, immutable provider references, integer minor units, audited adjustments, and no browser-trusted payment outcome.

### Admissions

- Public school-specific application form.
- Configurable fields, document and photograph uploads.
- Application review, status changes, email tracking and admission conversion.
- Applicant verification and admission email delivery.

### Parent portal

- Invitations, account activation, linked children, results, attendance, fees and receipts.
- Result access locks and PIN/reset workflows.
- Parent messaging and notifications.

### Communication

- Direct messages and inbox state.
- Announcements by audience.
- Email through Resend.
- Social and WhatsApp links.

### Library

- Book catalogue, available copies, borrowing, returns, fines and digital resources.

### Audit and moderation

- School-scoped and platform audit events.
- Actor and entity metadata.
- School pause/resume controls.
- Platform payment and AI-provider configuration.

### Rho AI assistant

- Provider selection and failover across configurable AI providers.
- Role-filtered tools spanning school, academics, students, attendance, results, fees, learning content, exams, announcements, library, parents and moderation.
- Usage limits and audit events.

Rebuild requirement: tools call ordinary authorized application services, use strict schemas, preserve tenant scope, require later-message confirmation for destructive work, and never receive a raw service-role client.

## External systems

| System       | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| Supabase     | Authentication, PostgreSQL, storage and legacy edge functions |
| Paystack     | Bank resolution and fee payment processing                    |
| Resend       | Transactional and admission email                             |
| AI providers | Rho assistant model execution and failover                    |
| Cloudflare   | Target runtime, edge delivery, custom domains and caching     |

## Cross-cutting rebuild requirements

- One codebase and deployment serve many independently branded school domains.
- Hostname resolution selects presentation context; authorization independently controls data access.
- Public pages are edge-cached and ship minimal JavaScript.
- Portal features are route-level code split.
- Public and private cache policies are strictly separated.
- All mutations validate input, permission, tenant ownership and audit requirements.
- Every functional domain receives unit, integration, cross-tenant security and end-to-end coverage.

## Open questions requiring product decisions

- Whether a user may hold roles in multiple schools and switch domains without reauthentication.
- Exact grading systems and whether they are configurable by school or education authority.
- Supported currencies and payment providers beyond Paystack.
- Data retention, deletion, export and regulatory obligations.
- Offline expectations for attendance and CBT exams.
- Whether public websites require multilingual content.
- Subscription plans, feature entitlements and billing ownership.
- Required integration channels for SMS and WhatsApp.
