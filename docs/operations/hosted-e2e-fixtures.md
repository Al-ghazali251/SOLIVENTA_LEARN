# Hosted E2E fixtures

Run `pnpm fixtures:hosted` only against a dedicated hosted development Supabase project. The command refuses non-development environments, provisions Auth identities through the Admin API, rotates strong random passwords on every run, and writes credentials to the ignored `.env.e2e` file.

It creates two active schools, public and portal `.localhost` tenant domains, published configurations, feature entitlements, representative memberships, students and a linked parent. The operation is idempotent by fixture email and stable entity IDs. Never use `supabase/seed.sql` against a hosted project; that seed is deterministic and local-stack-only.

With the local API running on port 8787, run `pnpm fixtures:verify`. The probe confirms both public tenant bootstraps, neutral rejection of an unknown host, successful School A portal bootstrap and denial of that School A administrator on School B's portal hostname. Set `E2E_API_PORT` only when Wrangler uses a different local port.

Neither `.env.e2e` nor `.env.migrations` may be copied into Worker runtime variables, committed, logged or shared. Delete the fixture Auth users and school records before repurposing the development project.
