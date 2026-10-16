# Observability and operations

## Data path

HTTP requests receive a `req_…` request ID before other middleware runs. Structured Worker logs and Analytics Engine points use that ID, while queued work persists it as `traceId` in both the job row and message envelope. Search Worker Logs for the request ID to follow the API request and every later job attempt.

Analytics Engine uses the school ID as its index. Platform dashboards aggregate all indexes; tenant dashboards filter to one school. Blob and double positions are defined in `src/observability/telemetry.ts`. Routes are normalized before recording so UUIDs and numeric identifiers do not create unbounded cardinality.

The public site uses Cloudflare Web Analytics when `PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN` is set. It supplies LCP, INP and CLS splits by hostname, device and country. Join the hostname to its published template version when reviewing template regressions. The portal sends sanitized browser failures to `/v1/telemetry/browser-errors`; the API deliberately rejects error messages, stack traces and arbitrary payloads.

## Privacy and classification

Never add passwords, bearer tokens, service keys, payment payloads, documents, free-form student data, AI conversations, exception messages, request bodies, or response bodies to telemetry. `application_error` represents expected failures. `unexpected_exception` and 5xx responses are operational failures. Client reports contain only kind, error class, normalized route, optional component label, and release.

## Deployment setup

1. Provision the `soliventa_learn_metrics` Analytics Engine dataset from `wrangler.jsonc`.
2. Enable Workers Logs and retain production logs according to the privacy policy.
3. Import `ops/observability/dashboards.json` into the dashboard provisioning workflow.
4. Configure the Cloudflare Web Analytics token in the public-site build environment.
5. Connect every policy in `ops/observability/alerts.json` to the on-call destination represented by `OPERATIONS_ALERT_WEBHOOK` in the secret manager. Send a test notification in staging and record its receipt.
6. Configure native Cloudflare Queue backlog/oldest-message alerts and certificate alerts; those infrastructure signals are not reliably inferred from request metrics.
7. Connect the backup alert to the provider's verified backup/restore heartbeat. A successful snapshot without a tested restore is not considered healthy.

## Staging acceptance drill

Run the API integration and cross-school security suites. Then create: one controlled 500, one invalid login, one failed/retried job, one dead-letter job, and one failed domain verification. Confirm logs contain request/trace IDs but no sensitive values; metrics appear in the platform and tenant views; and each page-level alert reaches the responsible team. Finally, run a synthetic mobile visit for each public template and confirm Web Analytics receives Core Web Vitals.

## Triage

Start with request ID, school ID, environment and error code. Check platform scope before tenant scope to distinguish an outage from tenant configuration. For queues, inspect retry count and operation, replay only jobs whose idempotency behavior is documented, and never edit tenant context. For certificates, disable a removed mapping before retrying provisioning. For payment verification, use the provider reference in the protected audit record—not application logs.
