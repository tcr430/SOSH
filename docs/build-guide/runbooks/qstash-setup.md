# QStash Setup Runbook

**Purpose:** Configure Upstash QStash as the cron trigger source for production.
**Replaces:** `vercel.json` cron entries (removed in the same commit that flips `CRON_TRIGGER`).
**Reverse:** See [vercel-cron-restore.md](./vercel-cron-restore.md) for the Vercel Cron fallback.

---

## Prerequisites

- Upstash account (upstash.com)
- Production Vercel deployment URL (e.g. `https://sosh.app`)
- Vercel CLI installed and logged in (`vercel env add`)

---

## Step 1 — Create QStash schedule: publish route

In the Upstash console → **QStash** → **Schedules** → **Create Schedule**:

| Field       | Value                                         |
|-------------|-----------------------------------------------|
| Destination | `https://<prod-domain>/api/cron/publish`      |
| Method      | `POST`                                        |
| Cron        | `*/10 * * * *`                                 |
| Retries     | `3` (default)                                 |
| Body        | _(empty)_                                     |
| Headers     | _(none required — auth via signature)_        |

Note the **Schedule ID** for your ops log.

---

## Step 2 — Create QStash schedule: sync-metrics route

Create a second schedule:

| Field       | Value                                             |
|-------------|---------------------------------------------------|
| Destination | `https://<prod-domain>/api/cron/sync-metrics`     |
| Method      | `POST`                                            |
| Cron        | `0 * * * *`                                       |
| Retries     | `3`                                               |
| Body        | _(empty)_                                         |

---

## Step 2b — Create QStash schedule: process-deletions route

Create a third schedule for the GDPR 30-day hard-delete cron (ADR 0010 Amendment 2 §D2.9):

| Field       | Value                                                   |
|-------------|---------------------------------------------------------|
| Destination | `https://<prod-domain>/api/cron/process-deletions`      |
| Method      | `POST`                                                  |
| Cron        | `0 3 * * *`                                             |
| Retries     | `0` (orchestrator owns its own retry/abandon loop)      |
| Body        | _(empty)_                                               |

> **Why retries=0?** The orchestrator claims rows atomically and drives its own
> state machine (pending→processing→completed|failed|abandoned). QStash retrying
> a delivery would cause the same row to be re-processed concurrently, doubling
> the attempt count against the `DELETION_MAX_ATTEMPTS` cap. Set retries=0 and
> let the next day's tick pick up any `failed` rows.

Note the **Schedule ID** for your ops log.

---

## Step 3 — Set production environment variables

Add these in a single Vercel deployment (all three must be present before the deploy goes live):

```bash
# Flip trigger mode
vercel env add CRON_TRIGGER production
# Enter: qstash

# Signing keys — copy from Upstash console → QStash → Settings → Signing keys
vercel env add QSTASH_CURRENT_SIGNING_KEY production
# Paste the "Current Signing Key" value

vercel env add QSTASH_NEXT_SIGNING_KEY production
# Paste the "Next Signing Key" value
# (same as CURRENT when no rotation is mid-flight)
# Both vars MUST be set — the Zod superRefine rejects boot if either is absent
# when CRON_TRIGGER=qstash in production.

# CRON_SECRET: keep set. Bearer auth remains the fallback for local-dev curl
# paths and the dev-bypass tests. Do not remove it.
```

The `vercel.json` crons array must be absent in the same deploy commit. If it is present
alongside `CRON_TRIGGER=qstash`, both triggers fire in parallel — needless duplication.
The crons array was removed from `vercel.json` as part of this change (see git history).

**Redeploy** after setting all three vars.

---

## Step 4 — Smoke test

After the deploy goes live:

**Publish route (within 10 minutes):**

```
Vercel dashboard → project → Logs → filter: /api/cron/publish
Look for: {"kind":"publish-tick","triggeredBy":"qstash",...}
```

**Sync-metrics route (within the first hour):**

```
Vercel dashboard → project → Logs → filter: /api/cron/sync-metrics
Look for: {"kind":"metrics-sync-tick","triggeredBy":"qstash",...}
Expected at launch: synced=0, skippedNotImplemented=N, errors=0
(wired-but-inert is healthy per ADR 0006 §1)
```

**cron_health rows:**

```sql
select * from cron_health;
```

Expected: two rows (`publish`, `metrics-sync`) with recent `last_seen_at`.

---

## Step 5 — On-call operations: pause, resume, manual re-trigger

**Pause a schedule:** Upstash console → QStash → Schedules → select schedule → **Pause**.

**Resume a schedule:** Same view → **Resume**.

**Manual re-trigger:** Upstash console → QStash → Schedules → select schedule → **Run now**.

> This is the **only** supported manual-ops path in QStash mode. There is no `CRON_SECRET`
> bearer fallback when `CRON_TRIGGER=qstash` — the route hard-branches and the GET method
> returns 405 (ADR 0005 Amendment 1 §5). Use the QStash console for all ad-hoc triggers.

---

## Step 6 — Key rotation (zero downtime)

The `@upstash/qstash` `Receiver` singleton accepts **either** `CURRENT_SIGNING_KEY` or
`NEXT_SIGNING_KEY` during verification, enabling zero-downtime rotation:

1. In Upstash console → QStash → Settings → **Roll signing key**. Upstash sets the current
   key to NEXT and generates a new CURRENT.
2. Update `QSTASH_NEXT_SIGNING_KEY` in Vercel env to the new **Next Signing Key** value.
3. Redeploy. Both old and new signatures are now accepted by the running app.
4. Wait for the rotation window (~24h). Upstash stops signing with the old key.
5. Update `QSTASH_CURRENT_SIGNING_KEY` to the new **Current Signing Key** value.
6. Set `QSTASH_NEXT_SIGNING_KEY` equal to `QSTASH_CURRENT_SIGNING_KEY` (no rotation in flight).
7. Redeploy.

---

## Step 7 — Alerting

**Primary alert path:** Sentry Cron Monitors (ADR 0007).
Sentry tracks `publish-tick`, `metrics-sync-tick`, and `process-deletions` by monitor slug.
A missed tick (no check-in within the expected window) pages via the Sentry alert rule —
regardless of whether the trigger source is QStash or Vercel Cron.

**QStash-side alerting:** Upstash console → QStash → Schedules shows delivery status and
retry history per schedule. Configure Upstash webhook alerts in the QStash settings if you
want a secondary notification channel outside Sentry.
