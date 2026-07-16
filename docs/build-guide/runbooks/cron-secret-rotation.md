# Runbook: CRON_SECRET Rotation

## When to rotate

- Suspected secret exposure (logged, leaked to client, visible in error output)
- Routine rotation (every 90 days recommended)
- Offboarding a team member who had access

## Generate a new secret

```bash
openssl rand -base64 48
```

Copy the output — this is `NEW_SECRET`.

## Update Vercel environment variables

Vercel cron routes are called with the secret in the `Authorization: Bearer <secret>` header.
The secret must be present in **both** `production` and `preview` environments.

```bash
# Add to production
vercel env add CRON_SECRET production
# Paste NEW_SECRET when prompted

# Add to preview
vercel env add CRON_SECRET preview
# Paste NEW_SECRET when prompted
```

To confirm the variable is present (do not print the value):

```bash
vercel env ls
```

## Redeploy

A redeploy is required for the new env var to take effect:

```bash
vercel --prod
```

## Update local .env.local

```bash
# In .env.local, update:
CRON_SECRET=<NEW_SECRET>
```

## Verify

After deployment, trigger the cron manually to confirm the new secret works:

```bash
curl -X GET https://your-domain.vercel.app/api/cron/publish \
  -H "Authorization: Bearer <NEW_SECRET>"
# Expect: 200 with JSON body { tick, janitor, publish }
```

Or in local dev, use the dev-trigger bypass (no secret required):

```bash
curl -X GET http://localhost:3000/api/cron/publish \
  -H "X-Cron-Dev-Trigger: true"
```

## Rollback

If the new secret causes issues, re-add the old value via `vercel env add` and redeploy.
The previous value is not recoverable from Vercel after overwrite — keep a temporary copy until rotation is confirmed.
