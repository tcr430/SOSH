Session 15 Reviewer Report — Drain Worker + Resend Integration
  Verdict: changes are functionally sound and well-tested, but ship-blocked by one architectural-boundary regression in
  eslint.config.mjs. tsc clean (SOSH), 257 passed / 1 skipped on lib/email + publishing. The drainer faithfully mirrors
  the publish-tick template and the A9 Retry-After path is correct end-to-end. One HIGH finding must be fixed before
  merge; the rest are MEDIUM/LOW hardening.

  Verification evidence

  - npx tsc --noEmit --skipLibCheck → clean (only the documented ECC remotion-skill errors, unrelated to SOSH).
  - npx vitest run lib/email lib/publishing/orchestrator.test.ts → 18 files / 257 passed, 1 skipped (the real-network
  round-trip, correctly describe.skipIf-gated).
  - ESLint Response-type check: Resend v6 Response<T> includes headers: Record<string,string> | null
  (node_modules/resend/dist/index.d.mts:122-130) — so sdkResponse.headers in resend-provider.ts:87 is valid and
  populated in production. The A9 fix is not inert. ✅

  ---
  🔴 HIGH — must fix before merge

  H1 — Appending the resend no-restricted-imports block silently disabled the Stripe (and confirms Social/Anthropic)
  import boundaries.
  eslint.config.mjs now has four separate config objects, each targeting ["**/*.ts","**/*.tsx"] and each setting the
  same rule key no-restricted-imports. In ESLint flat config, same-rule options are replaced, not merged — for any file
  matching all four, only the last block is active. The Session 15 resend block is now last.

  Empirical probe on app/probe.ts:
  STRIPE-ban    -> hits: 0     ← regression introduced this session
  SOCIAL-ban    -> hits: 0     ← already broken pre-15 (stripe block was last)
  ANTHROPIC-ban -> hits: 0     ← already broken pre-15
  RESEND-ban    -> hits: 1
  Three CLAUDE.md "non-negotiable" boundaries (ADR 0002 social internals, ADR 0003 @anthropic-ai/sdk, stripe) are
  unenforced on all general application code. The four boundary tests still pass only because each lints a fixture at a
  path where its own rule happens to be last-applicable — they give false confidence.

  Fix direction: consolidate into one no-restricted-imports block listing all four bans for all files, then add narrow
  per-exception override blocks (lib/email/resend-provider.ts, lib/stripe/**, lib/ai/**, lib/social/**) that each
  re-declare the rule minus their own entry. Add a regression test that lints a single general fixture and asserts all
  four bans fire from one file path. (This is the eslint-no-restricted-imports-exact-package learned pattern, but the
  multi-block override is the gap it didn't cover.)

  ---
  🟡 MEDIUM

  M1 — Drainer render-catch only handles typed EmailProviderError; a raw throw becomes a poison pill that stalls the
  queue.
  orchestrator.ts:70-81 catches render errors but only routes EmailProviderError w/ template_render_failed to failed;
  everything else is throw err, which aborts the whole withMonitor callback → outer catch → tick ends with remaining
  batch rows stuck in sending. render.tsx guards the React render() call (→ typed error), but getTranslations()
  (render.tsx:28) and entry.subject(t, data) (:31) are outside that try and can throw raw (e.g. a missing i18n key).
  Such a row gets reaped → re-claimed → re-throws every tick, never reaching failed — a per-kind poison pill that stalls  drainage for EMAIL_SENDING_STUCK_MINUTES each cycle. ADR §9 step 2 / §4 say "React Email throw → terminal failed."
  Fix: in the drainer, treat any render throw as template_render_failed → failed → continue (or widen render.tsx's try
  to cover getTranslations/subject).

  M2 — EMAIL_SENDING_STUCK_MINUTES default still 15, ADR §15 says 10 (config.ts:31). Carried over from the Session-14
  reviewer log, still open. Align code default to 10 or amend the ADR.

  🟢 LOW / NOTE

  - L1 — eslint.config.mjs formatting: the resend block (lines 85-105) is mis-indented and has trailing whitespace },  .  Cosmetic, but run Prettier so the boundary config stays readable.
  - L2 — parseRetryAfterHeader assumes lowercase 'retry-after' key (resend-provider.ts:22). Correct if Resend's
  Response<T>.headers lowercases keys (fetch Headers iteration does). If Resend ever preserves original case, the lookup  silently misses and falls back to exponential — safe-but-degraded. Add a case-insensitive lookup or a one-line
  comment pinning the assumption.
  - L3 — ADR Amendment 2 not added. The task asked whether the headers-verification outcome was documented. Outcome is
  positive (Response<T>.headers exists in resend v6), so a full Amendment 2 isn't warranted — but add one line to
  Amendment 1 §A9 confirming the SDK exposes Response<T>.headers, closing the open verification item.
  - L4 — Integration round-trip props not schema-verified. round-trip.test.ts:43-48 inserts {businessName,
  daysRemaining, expiryDateIso, upgradeUrl} for trial-warning-t3. If these drift from the template's Zod schema the live  test fails at run time (sent>=1 won't hold) — acceptable as a self-checking smoke test, but worth a comment that the
  props must track the schema.
  - L5 — transitionEmailOutboxRow remains read-then-update, no atomic WHERE status= guard (email-outbox.ts:83-114). Safe  today (SKIP-LOCKED claim makes the drainer sole owner) and pre-flagged in the Session-14 log; still inconsistent with
  CLAUDE.md's atomic-transition rule. Low-risk hardening, not a blocker.

  ---
  What's solidly correct (no action)

  - Drainer route mirrors publish/route.ts exactly: QStash dual-mode hard-branch, 405 on wrong method, 401 on auth fail,
  silently misses and falls back to exponential — safe-but-degraded. Add a case-insensitive lookup or a one-line
  comment pinning the assumption.
  - L3 — ADR Amendment 2 not added. The task asked whether the headers-verification outcome was documented. Outcome is
  positive (Response<T>.headers exists in resend v6), so a full Amendment 2 isn't warranted — but add one line to
  Amendment 1 §A9 confirming the SDK exposes Response<T>.headers, closing the open verification item.
  - L4 — Integration round-trip props not schema-verified. round-trip.test.ts:43-48 inserts {businessName,
  daysRemaining, expiryDateIso, upgradeUrl} for trial-warning-t3. If these drift from the template's Zod schema the live  test fails at run time (sent>=1 won't hold) — acceptable as a self-checking smoke test, but worth a comment that the
  props must track the schema.
  - L5 — transitionEmailOutboxRow remains read-then-update, no atomic WHERE status= guard (email-outbox.ts:83-114). Safe  today (SKIP-LOCKED claim makes the drainer sole owner) and pre-flagged in the Session-14 log; still inconsistent with
  CLAUDE.md's atomic-transition rule. Low-risk hardening, not a blocker.

  ---
  What's solidly correct (no action)

  - Drainer route mirrors publish/route.ts exactly: QStash dual-mode hard-branch, 405 on wrong method, 401 on auth fail,  always-200 on processing, email.drain.tick canonical log with triggeredBy, thin route / orchestrator in lib/email/.
  ✅ (401-on-auth, not always-200, matches the template — ADR §9's "always-200" governs the tick outcome, not auth.)
  - A9 path end-to-end: parseRetryAfterHeader (delta-secs + HTTP-date, 3600 cap) → EmailProviderError.retryAfterSeconds
  → computeBackoff short-circuit → next_attempt_at. Tests pin it with fake timers. ✅
  - D3 drain-time suppression re-check before send; status-machine transitions match §5 LEGAL_TRANSITIONS. ✅
  - Stuck-sending reaper (reapStuckSendingRows) is wired into runJanitorTick (publishing/orchestrator.ts:311), per ADR
  §9 "folded into the existing janitor." ✅
  - maybeEnqueueFirstPostPublished refactor correctly DRYs the happy-path and TOKEN_EXPIRED refresh-retry path (D2 fix),  with the counter-RETURNING===1 guard + after() + Sentry-on-failure; new tests cover first-vs-second publish and the
  increment-throws case. ✅
  - resend-provider.ts is unchanged in the working tree (committed at dd44f2b as the 14D A9 boundary) — no Session-15
  drift. ✅

  Recommended next action: correction pass on H1 (the only merge-blocker), then M1; M2/L1–L5 can fold into the same pass  since they're all small. Want me to draft the consolidated eslint.config.mjs fix for H1 and the drainer render-catch
  fix for M1?