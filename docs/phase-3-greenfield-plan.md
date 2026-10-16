# Revised Phase 3: greenfield data and tenancy

The former “audit and migrate the existing database” plan is replaced by:

1. Translate product requirements into a threat model and table classification.
2. Build an empty-database baseline with tenant identity, domain mapping and versioned configuration.
3. Encode tenant invariants through compound foreign keys, checks, partial unique indexes and immutable ownership.
4. Add RLS for anonymous, school-role, linked-parent, self, moderator and suspended-school cases.
5. Use deterministic local seed identities for two adversarial schools.
6. Prove isolation with pgTAP tests applied after a clean reset.
7. Promote forward-only migrations through development, staging and production.

No comparison with a legacy or staging schema is required. Instead, CI proves that the complete schema can be reproduced from zero and passes its security contract.
