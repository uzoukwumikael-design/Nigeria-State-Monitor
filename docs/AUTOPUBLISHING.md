# Automatic publishing

Nothing here needs a person. One scheduled call reads every news source, asks the AI model (if you set one up) to classify new articles, publishes what passes the rules, and attaches repeats of the same story to the event that already exists.

## The one thing to schedule

Call this address every 15 minutes with your `CRON_SECRET`:

```
GET https://YOUR-SITE/api/cron/ingest
Authorization: Bearer YOUR_CRON_SECRET
```

- **Free option:** a scheduler such as cron-job.org can send that request with the header every 15 minutes.
- **Vercel Cron** can also do it, but sub-daily schedules need a paid Vercel plan. This project does not ship a `vercel.json` for that reason: a cron line on a free plan can make a deployment fail.
- `?autopilot=0` ingests without publishing. `?source=punch,vanguard` runs only those sources. `/api/cron/autopilot` publishes without ingesting. `npm run autopilot` does the same from a terminal.

## What happens each run

1. **Ingest** all sources (four publishers at a time). Each is checked against its robots.txt first. A source that keeps failing is **paused** (30 minutes after 5 failures, doubling up to 24 hours) and retried automatically.
2. **AI sort** (only if `AI_PROVIDER` is configured; up to `AUTOPUBLISH_AI_PER_RUN`, default 10, per run). A proposal is discarded unless its quoted location evidence appears word for word in the article, so a model cannot invent a place.
3. **Decide** per article:
   - published when it has a state and a category above the confidence thresholds (rules, AI, or both agreeing);
   - declined when it is opinion, has no Nigerian state, is low-confidence, or when the AI and the rules disagree.
4. **De-duplicate one article at a time.** Before each publish, the duplicate check runs. A second report of the same story (same category, state and time window) is attached to the existing event and does not create a new one.
5. **Publish** with a software-assigned severity.

## What it will and will not claim

- Every automatic decision is recorded under the actor `system.autopublish` in the audit tables. It is never a person.
- **Severity is capped at 3 (Moderate)** and based on reported-impact words only. Levels 4 and 5 need a human and are never assigned automatically.
- Events start as **unassessed**. Several reports from independent outlets are counted as independent sources; repeats from one outlet are not.
- The event screens no longer carry a "not reviewed" banner (owner's decision). The Data notes page still says in one sentence that records are created and classified by software, and each event shows its verification status and independent-source count.

## Risks you are accepting by not reviewing

- A story can be put in the wrong state or category (the confidence thresholds and the AI cross-check reduce this, not remove it).
- An allegation in a headline can appear on your site as a reported event. Wording stays attributed to the outlet and links to it.
- Publishers' terms of use were reviewed for Premium Times only.

## Controls

| Setting | Default | Effect |
|---|---|---|
| `AUTOPUBLISH` | on | `off` stops all automatic accepting, declining and publishing (ingestion still runs) |
| `AUTOPUBLISH_MIN_CATEGORY_CONFIDENCE` | 0.5 | Minimum rule-based category confidence |
| `AUTOPUBLISH_MIN_GEO_CONFIDENCE` | 0.6 | Minimum rule-based location confidence |
| `AUTOPUBLISH_MIN_AI_CONFIDENCE` | 0.7 | Minimum AI confidence to use a proposal |
| `AUTOPUBLISH_MAX_PER_RUN` | 30 | Most candidates accepted and published per run |
| `AUTOPUBLISH_AI_PER_RUN` | 10 | Most AI calls per run (each is a paid call) |
| `INGESTION_DISABLE` | empty | Comma-separated source slugs to switch off |

To undo a mistake today, use the reviewer tools (`npm run review`, `npm run verification`) to move an event to a corrected state such as retracted. The `/review` console works the same way.
