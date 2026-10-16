# Background processing

Soliventa Learn uses Cloudflare Queues for slow, retryable work. `soliventa-learn-jobs` has three bounded retries with delayed redelivery; exhausted messages are transferred to `soliventa-learn-jobs-dlq`, which has its own consumer and durable dead-letter recording.

Every queue message is validated and contains only the job ID, tenant ID, actor ID, operation, idempotency key, initial attempt count, creation timestamp and a resource reference. Sensitive records, email content, credentials, import rows and AI prompts must remain in their protected system of record and be loaded by an authorized handler.

`background_jobs` is the durable state and idempotency boundary. `background_job_attempts` records individual deliveries. A unique `(school_id, operation, idempotency_key)` constraint prevents duplicate effects even when a producer or queue retries. Consumers check terminal state before executing and acknowledge duplicates without re-running the handler.

Implemented handlers:

- `domain.verify`: refreshes Cloudflare ownership/certificate state and invalidates only that hostname's tenant cache.
- `cache.warm`: warms the active public domains after configuration publication or rollback.

The registry is intentionally closed. Email, admission notification, image, PDF, import, export and AI handlers should be added only with strict resource-reference schemas, authorization rules and idempotency tests.

Operational rules:

- Transient failures are retried with bounded delay.
- Permanent validation/resource failures are recorded and acknowledged immediately.
- Retry exhaustion is recorded as `dead_lettered` and logged using identifiers only.
- Logs never include the message body, provider responses or student data.
- `GET /v1/jobs/{jobId}` is tenant-scoped and limited to the actor or a relevant school administrator.

Before production deployment, create both queues or allow Wrangler to provision them, apply the database migration and configure the `JOB_QUEUE` binding from `wrangler.jsonc`.
