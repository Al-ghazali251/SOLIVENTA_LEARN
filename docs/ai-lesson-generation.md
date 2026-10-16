# AI lesson notes pilot

The pilot uses the existing Cloudflare queue and lesson review workflow. Administrators add immutable curriculum topic versions for a classroom's class and subject. Teachers generate a note, edit the draft, preview the student content, and submit it. Existing administrator approval and publication rules still apply. Students read stored published sections without an AI request.

## Enable

1. Apply `supabase/migrations/20260910010000_ai_lesson_generation.sql` through the normal migration process.
2. Set the server secret with `pnpm exec wrangler secret put OPENROUTER_API_KEY` (add the appropriate environment flag when applicable). Never put the key in portal configuration or a frontend environment file.
3. Optionally set Worker variables `OPENROUTER_MODEL` (default `openrouter/free`), `LESSON_AI_DAILY_LIMIT` (default 45) and `LESSON_AI_SCHOOL_DAILY_LIMIT` (default 10). Limits count inference attempts, including retries, and reset at midnight UTC. They are shared in PostgreSQL across workers. Other applications using the same OpenRouter account also consume its provider allowance.
4. Deploy the API, including the existing queue consumer, and the updated portal together. Queue batches are capped at three messages to leave room for inference timeouts. No extra queue or vector database is required.
5. In Lessons, choose **Generate lesson notes with AI**, select a classroom, and add an approved curriculum topic as an administrator. A teacher can select that topic and generate a draft.

## Editable Nigerian starter templates

Administrators can now choose **Nigerian curriculum templates** after selecting a classroom. Select a matching template class level, subject, term and topic, then choose **Use and edit this template**. The curriculum name, version, term, week, topic, objectives, teaching scope and source reference are all editable. Saving selects the new school topic for generation automatically.

The library contains 504 original topic starters: Mathematics and English for Primary 1–6, JSS 1–3 and SS 1–3; science for Primary 1–6 and JSS 1–3; and Biology, Chemistry and Physics for SS 1–3. Each class/subject has four suggested topics in each of three terms. These are starter selections, not complete annual schemes or coverage of every school subject.

Subject names reference [NERDC's published subject offerings](https://nerdc.gov.ng/content_manager/pdf_files/Basic%20and%20Senior%20Secondary%20Education%20Curriculum%20Offerings.pdf). Topic text is original Soliventa content, not an official NERDC reproduction. Suggested term/week placement must be adapted to the school's approved scheme. The [current NERDC curriculum directory](https://www.nerdc.gov.ng/content_manager/new_curriculum_home.html) provides the official curriculum links for school review.

Select a saved topic and choose **Edit selected topic as a new version** to revise it. This saves a separate school version and preserves earlier curriculum snapshots and generated lessons. Editing a template never modifies the built-in library or another school's records. A blank-topic form remains available for subjects outside the starter library. No additional migration or AI call is needed to browse and edit templates; saving uses the existing curriculum API.

Only `openrouter/free` or explicit provider/model `:free` identifiers are accepted. OpenRouter automatic paid routing is rejected. The generator defaults to denying provider data collection. This deployment explicitly sets `OPENROUTER_DATA_COLLECTION=allow` with administrator approval so eligible free providers can process curriculum prompts. There is no paid fallback. See [free routing](https://openrouter.ai/docs/guides/routing/routers/free-router) and [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs).

## Behaviour and recovery

If generation reports `AI_PRIVACY_POLICY_BLOCKED`, OpenRouter cannot find a free endpoint under the account and request privacy restrictions. Review [OpenRouter privacy settings](https://openrouter.ai/settings/privacy). The server also defaults `OPENROUTER_DATA_COLLECTION` to `deny`. Only after explicitly accepting that providers may retain/use curriculum prompts for training, set `OPENROUTER_DATA_COLLECTION=allow` in the Worker configuration and permit the corresponding providers in the OpenRouter account. Changing account settings alone does not override the server's `deny` setting. Free-only model selection remains enforced. After deployment, start a new generation request; previous failed jobs are not restarted automatically.

- Curriculum excerpts are reference data. The server supplies the class and subject; student records and names are not loaded for generation.
- Objectives and all lesson sections are student material. Teaching procedure, differentiation and practice/homework answer keys belong in private teacher notes. Teachers must check these boundaries and factual accuracy before submission.
- Requests retain the curriculum snapshot, context hash, prompt version, actual model and usage. Topic corrections are saved as a new version. Existing requests keep their context.
- Retries use a three-minute lease and at most three inference attempts. Completion locks the request and creates a lesson once. No generation writes over an existing draft or published document.
- A failed or exhausted request can be followed by a new generation request. Quota errors require waiting until the next UTC day. Provider 429 responses respect Retry-After up to the queue delay limit. Configuration and invalid-output errors fail without repeated provider calls.
- The generation URL retains the request ID so reloading resumes status checks. Once successful, **Review generated draft** opens the existing editor.
- Full lesson and revision tables are inaccessible to authenticated browser clients; the server projects student content and enforces school/classroom scope. Existing direct Supabase consumers of these tables must use the portal API.

## Verification

Unit coverage: free-only routing, structured requests, invalid/truncated output, provider retry timing, student field projection, and command permissions. `supabase/tests/lesson_generation.test.sql` covers request deduplication, assignment and tenant boundaries, quota claims, leases, draft-only completion, and direct-read protection.

Run `pnpm test`, `pnpm typecheck`, `pnpm build` and `pnpm db:test` with local Supabase running. Regenerate the OpenAPI contract and the web API client after command changes. Evaluate representative notes with teachers before enabling the feature school-wide.

Scheduled weekly generation, PDF extraction, section-specific regeneration and automatic replacement of published revisions are follow-up work, outside this teacher-triggered pilot.

Testing configuration: set both `LESSON_AI_DAILY_LIMIT=unlimited` and `LESSON_AI_SCHOOL_DAILY_LIMIT=unlimited` to disable application daily quotas, including in production. OpenRouter limits and bounded per-job retries still apply. Restore numeric values to re-enable quotas. Existing failed requests require a new generation request.
