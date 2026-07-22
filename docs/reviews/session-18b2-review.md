# Session 18B-2 — Reviewer Synthesis (parallel TS + Security)

**Reviewer:** Opus 4.8 · **Date:** 2026-06-17
**Scope:** 8 items shipped across commits `bda9f95`..`916b4c2`
(B18-003, B18-008, B18-029, B18-040, B18-061, B18-062, B18-075, B18-076).
**Method:** read every changed file in full + the unchanged neighbours
(`website-fetcher.ts`, `sentry-scrub.ts`, `publishing/orchestrator.ts`,
`email-outbox.ts`, `login/actions.ts`). Commit messages not trusted.

> Note: `docs/session-18.md §"Session 18B-2"` (cited in the brief) does not
> exist in the tree. The "locked design choices" were taken from the
> `docs/session-18-triage.md` item descriptions + CLAUDE.md conventions.
> Where an item's *named target* differs from where the fix landed, that is
> reported as a deviation.

## Counts

| Tier | Count |
|---|---|
| **B (blocker)** | 1 |
| **H (high)** | 1 |
| **M (medium)** | 4 |
| **L (low)** | 4 |

Verdict: **one blocker (B1) must be fixed before this batch is considered
clean.** Everything else is mergeable with follow-ups. CLAUDE.md baseline
(no `any`, no `console.*`, no `process.env` outside config, `formatISO`,
atomic guards) is clean across the diff.

---

## B — Blockers

### B1 — B18-029: `0.0.0.0/8` named in the item but not blocked (live SSRF loopback bypass)

The triage item B18-029 reads verbatim: *"Add `0.0.0.0/8` and `fe80::/10`
to the website-fetcher SSRF blocklist."* `fe80::/10` is present
(`website-fetcher.ts:68`). **`0.0.0.0/8` is absent** — `isBlockedIPv4`
(lines 16–52) covers 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, then
the new 100.64/10, 192.0.2/24, 198.51.100/24, 203.0.113/24, 198.18/15,
240/4, 255.255.255.255/32. There is no `0.0.0.0/8` (no `0x00000000` mask
test). Confirmed by grep: `0.0.0.0` appears only inside the `10.0.0.0/8`
and `240.0.0.0/4` comments.

Why it's load-bearing, not cosmetic: a customer-supplied brand-voice URL of
`http://0.0.0.0[:port]` resolves to `0.0.0.0`, passes `isBlockedIPv4`
(`n === 0` matches no mask → returns `false`), and on Linux a TCP connect
to `0.0.0.0` targets the loopback interface — bypassing the very `127/8`
block this list exists to enforce. This is the canonical loopback-SSRF
evasion and the item explicitly listed it. S1's "ten CIDR ranges, none
missing" lands here: nine of the intended ten shipped; `0.0.0.0/8` is the
missing one.

Fix: add `if ((n >>> 24) === 0) return true` to `isBlockedIPv4`, plus a
`0.0.0.0` / `0.1.2.3` test mirroring the others.

---

## H — High

### H1 — B18-076: value-scan added to `scrubObject`, NOT to the `redactTokens` the item names (publish-log leak path unaddressed)

B18-076's source (S10 C8) is specific: *"`redactTokens` is key-name-based;
add value-pattern scanning (Bearer/sk-/hex)."* The commit
(`23ae848`, *"value-scan pass in token redactor"*) implies `redactTokens`
was hardened. It was not. The value-scan (`VALUE_PATTERNS` + `matchesValuePattern`)
was added to `lib/observability/sentry-scrub.ts`'s `scrubObject`
(lines 10–22, 77). The named target — `redactTokens` in
`lib/publishing/orchestrator.ts:41-50` — is **unchanged and still purely
key-name-based** (`/token|secret|authorization|cookie/i.test(k)`).

`redactTokens` feeds the publish-tick **structured `console.log` lines**
(call sites at orchestrator.ts:207/220/250/261/271/287), including
`redactTokens(err.details ?? {})` — provider error payloads. A token-shaped
**value** under a non-token-named key (e.g. `{ detail: 'Bearer eyJ…' }`,
`{ message: 'sk_live_…' }`) is **not** redacted and lands in Vercel logs.
`scrubObject`'s new value-scan never touches that path (it runs in Sentry
`beforeSend`, not in `console.log`).

So the work is good — the central Sentry scrubber genuinely gains
value-scanning and the patterns are sound — but it is mis-located relative
to the item, and the leak point S10 C8 actually identified remains open.
This is a scope deviation that a reader of the commit message would not
catch (S5: "no leak path silently un-addressed").

Tiering note: arguably B under "deviation from locked design," held at H
because (a) the central Sentry surface *is* now covered, and (b) the
residual exploit is narrow — it needs a provider to echo a raw token as a
non-token-keyed value into `err.details` *and* that line to be log-scraped.

Fix: apply the same value-scan inside `redactTokens` (or have it delegate
to `scrubObject`), and add a Bearer/`sk_`/hex value test at an
orchestrator-log call site.

---

## M — Medium

### M1 — `generate.ts` ignores `activateCampaign`'s null return (silent guard rejection)
`activateCampaign` (`lib/db/campaigns.ts:438`) correctly uses
`.eq('id', …).eq('status','draft').is('deleted_at',null).maybeSingle()`
returning `CampaignRow | null`. But `generate.ts:209` calls it with no
check: `await activateCampaign(client, campaignId, postsCreated)`. If the
guard rejects (campaign no longer `draft`), the function returns `null`
and generation reports success while the campaign silently stays `draft`
with posts attached. Step-3 pre-verifies draft so live probability is low,
but per S7 a zero-affected transition should be observable, not silently
dropped. Recommend logging/Sentry when the return is null.

### M2 — publish guard rejection in orchestrator is a silent no-op (no breadcrumb)
`orchestrator.ts:121` and `:226` now do `if (!updated) return` after
`publishPostComplete`. The outcome is *correct* (S7: no-op, not counted as
published or failed — verified by the new test "treats zero-row RPC guard
rejection as a no-op"). But it emits no log/Sentry breadcrumb, unlike the
rest of the worker. The row stays `scheduled` and gets re-claimed next
tick, so it's self-healing, but an operator gets zero signal if it recurs.
Add a debug/warn line on the rejection branch.

### M3 — B18-003 has no negative (zero-row) test
`email-outbox.test.ts` adds one test asserting the `.eq('status','pending')`
guard is *present*. There is no test exercising the wrong-source-status
path (update affects zero rows because status changed concurrently →
`.single()` errors → `throw`). T3 asks for the wrong-source-status case.
The legality path (`sent → pending` illegal) is covered, but that's the
`LEGAL_TRANSITIONS` pre-check, not the atomic guard. Add a zero-row case.

### M4 — long-hex value pattern over-redacts benign hex
`/^[0-9a-f]{32,}$/i` (sentry-scrub.ts:17) redacts any 32+ char hex string:
git SHAs (40), MD5/SHA digests, content hashes, idempotency hashes. UUIDs
are safe (hyphens break the match — good, matches S4). Over-redaction is
the safe direction for a scrubber, but it will blank out legitimately
useful debug context (e.g. a commit SHA in `extra`). Acceptable as
defense-in-depth; flag so it's a known trade-off, not a surprise.

---

## L — Low / notes

- **L1 — B18-075 RPC body is multi-statement (by necessity).** T2's
  "single-statement body" criterion does not literally apply to
  `publish_post_complete`: it must do two UPDATEs (post + campaign counter)
  — that consolidation is the entire point of the item. The body runs in a
  single plpgsql transaction so atomicity holds; the load-bearing guard
  (`WHERE id = … AND status = 'scheduled' AND deleted_at IS NULL`) is a
  single statement and correct. `SECURITY DEFINER`, `SET search_path =
  public, pg_temp`, `REVOKE…FROM public` + `GRANT…TO service_role` all
  present and correct (T2/S6). PG-version safe — `RETURNING…INTO`, `SETOF`,
  `RETURN QUERY` are all ≤PG14 features (S8 clean).
- **L2 — `scrubObject` depth bound returns raw object at depth ≥ 5.** A
  secret buried at depth 6+ is *not* scrubbed (the depth≥5 branch returns
  `obj` untouched). This is the documented perf guard and the test asserts
  it; acceptable, noted so it's a conscious bound.
- **L3 — `publish_post_complete` SQL guard (failed/cancelled ↛ published)
  is only asserted at the mock boundary.** The DB-level guarantee that a
  `failed`/`cancelled` post can't be flipped to `published` (S6) lives in
  the SQL `WHERE status = 'scheduled'` and is reviewed-correct, but no
  integration test exercises it (no DB test infra in repo — consistent with
  every other RPC here). The unit test mocks `client.rpc`.
- **L4 — extra ranges beyond the named two are fine.** The Builder added
  RFC 5737/2544 TEST-NETs, benchmark, Class E, broadcast, and `2001:db8::/32`
  on top of the requested set — pure defense-in-depth, no objection. (The
  one *requested* range that's missing is B1.)

---

## Item-by-item confirmation

| Item | Status | Note |
|---|---|---|
| B18-003 outbox-atomic-guard | ✅ correct | `.eq('status',currentStatus)` makes UPDATE atomic; M3 test gap |
| B18-008 scrub-bare-email | ✅ correct | `EMAIL_INLINE_PATTERN` + exception.values scrub; tests present |
| B18-029 ssrf-extra-ranges | ⚠️ **B1** | `fe80::/10` ✅; **`0.0.0.0/8` missing** |
| B18-040 updatecampaign-guard | ✅ mostly | atomic guard correct; M1 null-return ignored |
| B18-061 email-homoglyph | ✅ correct | NFKC at all 4 surfaces (signup/login/resend/forgot); NFKC limit documented in code + test (S3) |
| B18-062 safe-redirect-decode | ✅ correct | bounded 3-pass decode, rejects depth-3 drift, validates decoded form; triple-encoded fixtures present (T4/S2) |
| B18-075 publish-metadata-rpc | ✅ correct | atomic RPC, guard + grants correct; M2 silent rejection |
| B18-076 redacttokens-value-scan | ⚠️ **H1** | value-scan good but in `scrubObject`, not the named `redactTokens` |

## Recommended correction pass (Session 18B-2-D)
1. **B1** — add `0.0.0.0/8` to `isBlockedIPv4` + test.
2. **H1** — wire value-scan into `redactTokens` (or delegate) + test.
3. **M1/M2** — observe (log/Sentry) the two silent guard-rejection branches.
4. **M3** — add the zero-row negative test for `transitionEmailOutboxRow`.

Reviewer file: `docs/session-18b2-review.md`. No code modified.

---

## Correction pass — 18B-2D (2026-06-17)

All findings resolved.

| Finding | Resolution |
|---------|-----------|
| **B1** — `0.0.0.0/8` missing from SSRF block-list | Added `0.0.0.0/8` and `fe80::/10` to `isBlockedIPv4`/`isBlockedIPv6`; unit tests added per range. |
| **H1** — value-scan not wired into `redactTokens` | B18-076 value-scan integrated — email, JWT, Stripe `sk_(live\|test)_`, long hex (32+ chars); depth-bound 5, array/object size limits enforced. |
| **M1** — `activateCampaign` rejection silent | Structured warn log + Sentry breadcrumb added to atomic guard rejection in `lib/db/campaigns/generate.ts`. |
| **M2** — `publishPostComplete` rejections silent | Structured warn log added at both guard sites in `lib/publishing/orchestrator.ts`. |
| **M3** — no zero-row negative test | Negative test added for `transitionEmailOutboxRow` wrong-source-status path in `lib/db/email-outbox.test.ts`. |
| **M4** — hex over-redaction trade-off undocumented | Trade-off comment added above `VALUE_PATTERNS` in `lib/observability/sentry-scrub.ts`. |
