# Milestone 4 — Complete school platform

## Delivered scope

Milestone 4 adds tenant-scoped persistence, API commands, permissions, audit events, and lazy-loaded portal screens for:

- admissions: public submission, internal creation, review, acceptance/rejection, and accepted-applicant conversion;
- parents: explicit guardian/student links and compensating parent account invitations;
- messaging: participant-scoped conversations, messages, and read state;
- exams: exam/question creation, scheduling states, student attempt start, autosave, and submission;
- lessons: draft creation and publication;
- assignments: creation, publication, learner drafts/submission, and grading;
- library: catalogue management and transactional issue/return operations;
- moderation: platform-only school visibility and suspension/activation commands.

The public school admission form submits to the versioned API. Portal modules use the generated API client; they do not access Supabase directly.

## Security boundaries

- Every persisted record carries `school_id`; compound foreign keys reject cross-school relationships.
- The API derives the school from the resolved hostname, never a client-selected tenant.
- Each command requires an explicit permission and writes an audit event.
- Learners receive only their own attempts/submissions and their class's exams, lessons, and assignments.
- Exam answer keys are removed from learner API payloads and are not readable through learner RLS policies.
- Conversations and messages are visible only to participants or authorized administrators.
- Moderator mutations require both a moderator permission and a platform-type hostname.
- Parent access is established by an explicit guardian/student link, never by matching email or phone.
- Library issue/return uses locked, idempotent database functions to prevent copy-count races.

## Verification

- API lint and TypeScript checks pass.
- 49 API unit tests pass.
- OpenAPI contract validation passes.
- Cloudflare Worker dry-run build passes.
- Cross-school API access was rejected in hosted smoke testing.
- Exam submit, assignment grade, library issue/return, public admission, and core create/list flows passed hosted smoke testing before the final privacy migration.
- Frontend lint, contract validation, type checks, and unit tests pass.
- Astro and portal production builds pass.
- Public JavaScript is 0 bytes against a 20 KB budget.
- Portal initial bundle is 245,057 bytes against a 250 KB budget; all 18 feature routes are lazy chunks.

## Production gate

The migration `20260825022000_complete_platform_privacy.sql` must be applied and the pgTAP suite rerun before deployment. The current local Supabase CLI session cannot push it because the logged-in account receives a 403 insufficient-privileges response.

Production acceptance also requires configured external services and human workflow testing for invitation email delivery, admission notifications, file uploads, and moderator operational controls. These are deployment/acceptance gates, not reasons to weaken the tenant or authorization model.
