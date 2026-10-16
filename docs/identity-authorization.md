# Identity, membership, lifecycle and authorization

The canonical chain is:

```text
auth.users -> accounts -> tenant_memberships -> membership_role_assignments
                                      |                  |
                                      |                  -> authorization_roles -> authorization_permissions
                                      -> membership_entity_links -> applicant/student/guardian/staff aggregate
```

## Invariants

- Authentication proves an account; it does not imply a school role.
- `accounts` are tenant-independent and can participate in many schools.
- A tenant membership represents one lifecycle identity. One account may concurrently be an applicant, guardian, student, teacher, administrator, or specialist in different tenants.
- Applicant and student memberships are distinct. Enrolment creates/transitions the student membership and preserves the applicant history.
- Guardian access comes only from an explicit domain relationship—not a shared surname, address, phone number, or email.
- Roles bundle permissions. A role assignment may carry a resource scope such as assigned classes or linked children.
- Database/API authorization is authoritative. Client navigation is only presentation.
- Platform authorization remains separate and grants no tenant production-data access by default.
- Membership lifecycle changes retain append-only events and security audit records.

## Compatibility

`school_memberships` remains available while current services migrate. Inserts and state changes synchronize into the canonical model. API authorization now resolves the canonical workspace and database permission grants.

New features must use `get_account_workspaces`, `account_has_permission`, and domain relationship checks. They must not introduce a single `user.type` field.
