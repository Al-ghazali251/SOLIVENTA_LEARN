# API contract policy

`contracts/openapi.v1.json` is the reviewed source exchanged with frontend repositories. Route
implementations and the committed artifact must remain synchronized through `pnpm contract:check`.

- Additive changes may remain in `v1` and require regenerated clients.
- Behavioral changes require release notes and contract/integration tests.
- Removing or renaming paths, methods, or documented responses is breaking and requires a new API
  version or an explicitly coordinated deployment.

Pull requests run the compatibility checker against `origin/main`. Frontend CI regenerates its
schema from its committed contract snapshot, making stale generated code fail the build. Before
production promotion, update the web snapshot from the reviewed API artifact and run its complete
check against the staging configuration.
