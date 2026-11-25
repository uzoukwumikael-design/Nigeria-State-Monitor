# Going live (no terminal needed)

You need three free accounts: **Supabase** (database), **Vercel** (hosting, already used for this site) and **cron-job.org** (a free scheduler). About 30 minutes.

## 1. Create the database (Supabase)

1. Create a project at supabase.com. Choose a region near Nigeria's users and **write down the database password**.
2. Open the project's **Connect** (or Database settings) page and copy two connection strings:
   - **Transaction pooler** (port 6543): this becomes `DATABASE_URL`.
   - **Session pooler** or **Direct connection** (port 5432): this becomes `MIGRATION_DATABASE_URL`. Setup needs it because the transaction pooler can reject some setup statements.
3. Replace `[YOUR-PASSWORD]` in both strings with your password.

## 2. Add settings in Vercel

Project → Settings → Environment Variables. Add these for **Production**, then **redeploy**.

| Name | Value |
|---|---|
| `NSM_MODE` | `production` |
| `NSM_REPOSITORY` | `postgres` |
| `DATABASE_URL` | the transaction pooler string |
| `MIGRATION_DATABASE_URL` | the session pooler or direct string |
| `DATABASE_SSL` | `require` |
| `DATABASE_POOL_MAX` | `1` |
| `CRON_SECRET` | a long random password (see below) |

**Making `CRON_SECRET`:** use your password manager's generator (32 or more characters, letters and numbers). With a terminal you can run `npm run secrets:generate` instead. Keep it private: anyone with it can trigger your scheduled jobs.

You do **not** need `REVIEWER_CREDENTIALS` or `REVIEWER_SESSION_SECRET`: publishing is automatic.

## 3. Set up the database (one request)

In cron-job.org create a job (it will also be your scheduler): URL `https://YOUR-SITE/api/cron/setup`, request method `GET`, and under *Advanced → Headers* add `Authorization` = `Bearer YOUR_CRON_SECRET`. Use **Execute now** and open the job history to read the answer.

- First send it with `?dry=1` on the end to see what is pending and a **configuration review** that lists anything missing by name.
- Then run it without `?dry=1`. A good answer says `"status": "ready"`, applied migrations and `"states": 37`.
- Running it again is safe: it applies nothing twice.

(With a terminal, `npm run golive:check` gives the same review, and `npm run db:setup:registry` does the setup.)

## 4. Turn on the AI (optional but recommended)

Without it, articles are sorted by the built-in rules only. Add these in Vercel and redeploy. Use any model that follows JSON instructions; put the provider's model name in `AI_MODEL`.

| Provider type | Settings |
|---|---|
| OpenAI | `AI_PROVIDER=openai`, `AI_API_KEY=...`, `AI_MODEL=...` |
| Any OpenAI-compatible service (Groq, OpenRouter, a hosted open model) | `AI_PROVIDER=openai-compatible`, `AI_BASE_URL=https://.../v1`, `AI_API_KEY=...`, `AI_MODEL=...` |

Each article is one paid model call; `AUTOPUBLISH_AI_PER_RUN` (default 10) caps calls per run. The AI cannot invent a location: its answer is thrown away unless the place it quotes appears word for word in the article.

## 5. Schedule the collector

In cron-job.org create a second job: `https://YOUR-SITE/api/cron/ingest`, every **15 minutes**, with the same `Authorization: Bearer YOUR_CRON_SECRET` header. Each run reads the sources, sorts and publishes (see AUTOPUBLISHING.md).

## 6. Check it worked

- `https://YOUR-SITE/api/system/health` shows the data is live.
- The **Sources** tab lists every source and its health after the first runs. Some feeds may fail at first: they are skipped, retried, and paused if they keep failing.
- Events appear on the map after the first run or two.

## If something goes wrong

- **Stop publishing at once:** set `AUTOPUBLISH=off` in Vercel and redeploy. Collection continues, publishing stops.
- **Remove a publisher** (for example if they object): set `INGESTION_DISABLE=slug` (comma separated for several, slugs are on the Sources tab) and redeploy.
- **Setup says it failed:** the answer names the failing step. The most common cause is using the transaction pooler for `MIGRATION_DATABASE_URL`: use the session pooler or direct string.
