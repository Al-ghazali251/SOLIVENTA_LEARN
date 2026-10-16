# Engineering standards

## Repository rules

- `main` represents production; `staging` represents staging; work is merged through short-lived pull requests.
- A pull request must pass formatting, linting, type checking, tests, build, dependency review, and secret scanning.
- Direct database access is contained in repositories. HTTP handlers call application services, not Supabase directly.
- Business rules are framework-independent and tested as pure functions where possible.
- The Supabase service-role client is private to narrowly scoped privileged services.
- The API resolves a tenant from a verified hostname and independently verifies user membership and permission.
- Never trust a request-supplied school ID as proof of tenancy.
- Logs must not contain passwords, access tokens, private keys, payment details, or sensitive student documents.
- `pnpm check:boundaries` rejects frontend imports, route-level Supabase access, and service-role access outside the binding declaration and privileged admin client.

## Environment model

| Environment | Branch        | Data                 | External integrations |
| ----------- | ------------- | -------------------- | --------------------- |
| Development | local/feature | synthetic            | sandbox or disabled   |
| Staging     | `staging`     | synthetic/anonymized | sandbox               |
| Production  | `main`        | production           | production            |

Secrets are managed in the deployment platform. `.env.example` contains names only.

## Definition of done

A backend change is complete only when its contract, validation, authorization, tenant isolation, audit behavior, tests, and observability are implemented.
