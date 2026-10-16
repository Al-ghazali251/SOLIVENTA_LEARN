# Phase 10 migration status

Phase 10 is intentionally delivered module by module. A module is not labelled migrated until its automated gates pass and pilot users approve it.

## Corrected dependency order

Classes, subjects, academic sessions and terms precede students and staff. Student placement and teacher assignments depend on this structure, so implementing them in the originally listed order would create temporary identifiers and rework.

## Academic structure — implementation candidate

Implemented:

- school-scoped sessions, terms, classes and subjects;
- class-to-subject, class-teacher and teacher/class/subject assignments;
- compound foreign keys that reject cross-school relationships;
- immutable `school_id`, one active session and term per school, and term/session date validation;
- RLS for member reads and administrator writes;
- explicit `academic.read` and `academic.manage` permissions;
- domain validation, application service, private service-role repository and audit events;
- versioned OpenAPI operations and generated frontend client;
- a permission-guarded, lazy-loaded portal workspace for classes and subjects;
- unit and pgTAP security/schema tests.

Legacy behavior retained where safe:

- simple class and subject catalogues;
- one class teacher per class;
- teachers may be assigned combinations of classes and subjects;
- sessions and terms are explicit reusable records.

Legacy behavior deliberately removed:

- browser-side database writes;
- school selection from client-provided identifiers;
- scattered role-string checks;
- cross-school or dangling teacher assignments;
- unaudited administrative changes.

Remaining completion gates:

- apply the migration to a blank local/staging database and run `pnpm db:test`;
- add session, term and assignment controls to the portal (the API contract already supports assignments);
- complete staging API and browser end-to-end tests;
- compare representative records with the approved legacy behavior;
- internal enablement, pilot-school approval and production rollout.

The next implementation slice is Students and Staff, using these academic identifiers for placement and assignment.
