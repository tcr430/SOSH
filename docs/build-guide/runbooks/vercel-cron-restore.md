# Vercel Cron Restore Runbook

**Purpose:** Restore Vercel Cron as the trigger source (e.g. after upgrading to Vercel Pro).
**Reverses:** [qstash-setup.md](./qstash-setup.md).

---

## When to use

When the project upgrades to Vercel Pro and you want native Vercel Cron instead of QStash.
This is a hard cutover — both triggers must never fire simultaneously.

---

## Step 1 — Pause QStash schedules

In the Upstash console → QStash → Schedules:

- Select the **publish** schedule → **Pause**.
- Select the **sync-metrics** schedule → **Pause**.

Do **not** delete the schedules. Pause is reversible; delete requires re-creating from scratch.

---

## Step 2 — Flip CRON_TRIGGER and remove QStash keys

```bash
# Switch back to bearer mode (or remove the var entirely — default is secret)
vercel env rm CRON_TRIGGER production
# OR: vercel env add CRON_TRIGGER production → enter: secret

# Remove QStash signing keys from production env
vercel env rm QSTASH_CURRENT_SIGNING_KEY production
vercel env rm QSTASH_NEXT_SIGNING_KEY production
```

Leave `CRON_SECRET` in place — it is required for the bearer-mode auth path.

---

## Step 3 — Restore the crons array in vercel.json

Add this block to `vercel.json` (paste verbatim):

```json
{
  "crons": [
    { "path": "/api/cron/publish",      "schedule": "* * * * *" },
    { "path": "/api/cron/sync-metrics", "schedule": "0 * * * *" }
  ]
}
```

---

## Step 4 — Redeploy

Push the `vercel.json` change. No TypeScript changes are required — the route hard-branches
on `CRON_TRIGGER`. With `CRON_TRIGGER=secret` (or absent), the existing inline Bearer +
dev-bypass logic runs unchanged. Zero code change required.

---

## Step 5 — Smoke test

After the deploy goes live:

```
Vercel dashboard → project → Logs
Look for: {"kind":"publish-tick","triggeredBy":"secret",...} within 60 seconds
Look for: {"kind":"metrics-sync-tick","triggeredBy":"secret",...} within the first hour
```

Confirm the publish route now answers **GET** (not POST — the method asymmetry flips with
the trigger source, ADR 0005 Amendment 1 §5):

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<prod-domain>/api/cron/publish
# Expected: 200
```

---

## Step 6 — Clean up (after 24h of stable operation)

Once 24 hours of successful Vercel Cron ticks are confirmed, delete the paused QStash
schedules from the Upstash console to avoid confusion.
