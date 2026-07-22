  Session 13.5 Part C — Security & Correctness Review

  SECTION A — Hard-Branch Selection & Lexical Unreachability
  ┌─────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │ Result │                                              Notes                                               │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ A1  │ ✅     │ Both routes branch on config.server.CRON_TRIGGER === 'qstash' (publish:13, sync-metrics:12). No  │
  │     │ PASS   │ header-presence selection.                                                                       │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ grep -rn "x-cron-dev-trigger" in lib/cron/ returns zero hits. In route files, both               │
  │ A2  │ PASS   │ x-cron-dev-trigger reads sit in the else { … } branch (publish:29, sync-metrics:27). Lexically   │
  │     │        │ unreachable from the qstash branch.                                                              │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ Reviewer-pinned test present in both files (route.test.ts:273 publish, route.test.ts:249         │
  │ A3  │ PASS   │ sync-metrics): CRON_TRIGGER=qstash, NODE_ENV=development, X-Cron-Dev-Trigger=true, POST, no      │
  │     │        │ signature → asserts status 401 + reason='qstash-missing-signature'.                              │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ A4  │ ✅     │ qstash-auth.ts reads only config.server.QSTASH_*. Routes read only config.server.CRON_TRIGGER /  │
  │     │ PASS   │ config.public.NODE_ENV. No process.env in new code.                                              │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ CRON_TRIGGER: z.enum(['qstash','secret']).default('secret') (config.ts:59). superRefine fires    │
  │ A5  │ PASS   │ only when CRON_TRIGGER==='qstash' AND process.env.NODE_ENV==='production' AND either key missing │
  │     │        │  (config.ts:62–74).                                                                              │
  └─────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  SECTION B — QStash Signature Verification

  ┌─────┬───────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │  Result   │                                             Notes                                             │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B1  │ ✅ PASS   │ new Receiver({ currentSigningKey, nextSigningKey }) (qstash-auth.ts:23).                      │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B2  │ ✅ PASS   │ Module-level let receiver cache; getReceiver() constructs lazily once (qstash-auth.ts:14–25). │
  │     │           │  Test exercises lazy-init via vi.resetModules().                                              │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B3  │ ✅ PASS   │ await request.text() called once before rcv.verify() (qstash-auth.ts:36). No prior parse.     │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B4  │ ✅ PASS   │ url: request.url passed verbatim (qstash-auth.ts:41). Not reconstructed from headers.         │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B5  │ ✅ PASS   │ if (request.method !== 'POST') throw qstash-requires-post (qstash-auth.ts:28–30). Defence in  │
  │     │           │ depth over route's GET/POST split.                                                            │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │           │ All four reasons throw QStashAuthError, which sets super('Unauthorized') (qstash-auth.ts:7).  │
  │ B6  │ ✅ PASS   │ Test "Error.message is the literal 'Unauthorized' in every thrown case" asserts               │
  │     │           │ toStrictEqual('Unauthorized') for all four reasons (qstash-auth.test.ts:112–134).             │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B7  │ ❌ FAIL — │ package.json:27 shows "@upstash/qstash": "^2.11.0". The caret allows automatic minor          │
  │     │  FINDING  │ upgrades. ADR Amendment 1 §3 D2 requires exact pinning. Fix: change to "2.11.0".              │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ B8  │ ✅ PASS   │ grep CRON_SECRET|Bearer in qstash-auth.ts returns no hits. grep x-cron-dev-trigger returns no │
  │     │           │  hits. Pure D6 separation.                                                                    │
  └─────┴───────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘

  SECTION C — Bearer Branch Preservation

  ┌─────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │ Result │                                              Notes                                               │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ git diff c7272ff~1 c7272ff -- route.ts: the entire original handler body (auth + janitor +       │
  │ C1  │ PASS   │ reaper + publish + always-200) appears inside the new else { … } block with no semantic change — │
  │     │        │  only indentation shifts and the closing } placement.                                            │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ C2  │ ✅     │ CRON_SECRET superRefine (config.ts:38–45) is unmodified by this session.                         │
  │     │ PASS   │                                                                                                  │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ route.test.ts:157 (publish) / :147 (sync-metrics) — "returns 401 when X-Cron-Dev-Trigger is true │
  │ C3  │ PASS   │  in prod (header ignored)" still alive. Default mockCronTrigger.value = 'secret', so it routes   │
  │     │        │ through the else branch.                                                                         │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │        │ No Bearer-side cron-auth-failure warn line ever existed in route.ts pre-session (verified in git │
  │ C4  │ ⚠️      │  history — original else branch returns 401 silently without a structured warn). The QStash      │
  │     │ DRIFT  │ branch adds a cron-auth-failure warn, but the Bearer branch still emits no parallel log. H2      │
  │     │        │ below revisits this.                                                                             │
  └─────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  SECTION D — Method Asymmetry

  ┌─────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │ Result │                                              Notes                                               │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ D1  │ ✅     │ Both routes export distinct GET and POST functions, each guarding the wrong-mode case with 405   │
  │     │ PASS   │ (publish:102–114, sync-metrics:77–89).                                                           │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ D2  │ ✅     │ if (CRON_TRIGGER === 'qstash') return 405 inside GET.                                            │
  │     │ PASS   │                                                                                                  │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ D3  │ ✅     │ if (CRON_TRIGGER !== 'qstash') return 405 inside POST.                                           │
  │     │ PASS   │                                                                                                  │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │        │ Both GET (secret) and POST (qstash) funnel through publishTick() / metricsSyncTick(), which call │
  │ D4  │ ✅     │  runPublishTick / runMetricsSyncTick. Those orchestrators wrap in                                │
  │     │ PASS   │ Sentry.withMonitor('publish-tick'…) (orchestrator.ts:54) and                                     │
  │     │        │ Sentry.withMonitor('metrics-sync-tick'…) (metrics orchestrator.ts:26).                           │
  └─────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  SECTION E — Route Diff Minimality

  #: E1
  Result: ⚠️  PARTIAL FAIL — FINDING
  Notes: The route diff matches (a) wrap in else, (b) qstash branch + warn, (c) GET/POST split with 405. But (d) is
    wrong: the spec says "triggeredBy added to the existing tick log line." The existing tick log line lives in the
    orchestrator (lib/publishing/orchestrator.ts:80,135 — console.log({ kind:'publish-tick', ...summary })). Instead, B9
    added a second, separate console.log({ kind:'publish-tick', triggeredBy: … }) inside the route (publish:93–96,
    sync-metrics:69–72). This now emits two publish-tick events per tick — the orchestrator's summary (no triggeredBy)
    and the route's triggeredBy-only line (no summary). Fix: delete the route's console.log and pass triggeredBy as an
    argument into runPublishTick/runMetricsSyncTick so the orchestrator's single canonical log gains the field.
  ────────────────────────────────────────
  #: E2
  Result: ✅ PASS
  Notes: runPublishTick({ now, batchSize, reaped }), runJanitorTick({ now }), runMetricsSyncTick({ now }) — call sites
    unchanged.
  ────────────────────────────────────────
  #: E3
  Result: ✅ PASS
  Notes: maxDuration = 60 on both routes — unchanged.
  ────────────────────────────────────────
  #: E4
  Result: ✅ PASS
  Notes: Always-200 contract preserved: catch blocks still build summary objects with error field and return
    NextResponse.json(...).
  ────────────────────────────────────────
  #: E5
  Result: ✅ PASS
  Notes: git diff c7272ff~1 c7272ff -- lib/publishing/orchestrator.ts lib/metrics/orchestrator.ts returns empty. Zero
    orchestrator diff in B9.

  SECTION F — vercel.json & Rollback Readiness

  ┌─────┬────────┬──────────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │ Result │                                              Notes                                               │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ F1  │ ✅     │ vercel.json is {} — crons array fully removed, not reduced.                                      │
  │     │ PASS   │                                                                                                  │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ F2  │ ✅     │ vercel-cron-restore.md:46–53 contains the verbatim JSON block with both routes and * * * * * / 0 │
  │     │ PASS   │  * * * * schedules.                                                                              │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │ ✅     │ vercel-cron-restore.md:58–61 "No TypeScript changes are required — the route hard-branches on    │
  │ F3  │ PASS   │ CRON_TRIGGER." Setting CRON_TRIGGER=secret + restoring vercel.json crons + removing QSTASH_*     │
  │     │        │ keys reaches the else branch automatically.                                                      │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ F4  │ ✅     │ qstash-setup.md:124–135 Step 6 documents the two-key rotation (set NEXT to new, redeploy, then   │
  │     │ PASS   │ promote NEXT to CURRENT, redeploy).                                                              │
  ├─────┼────────┼──────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ F5  │ ✅     │ qstash-setup.md:115–119 Step 5 names "Run now" as the only supported manual re-trigger and       │
  │     │ PASS   │ explicitly states "There is no CRON_SECRET bearer fallback when CRON_TRIGGER=qstash".            │
  └─────┴────────┴──────────────────────────────────────────────────────────────────────────────────────────────────┘

  SECTION G — Idempotency & At-Least-Once

  #: G1
  Result: ⚠️  NOT VERIFIED
  Notes: ADR 0005 Amendment 1 was not opened in this session (not in my read set). The audit instructions reference
    §12/§13/Amendment 1 — Reviewer should confirm Amendment 1 explicitly cites the FOR UPDATE SKIP LOCKED claim (ADR
    §4/§7) as the QStash retry safety basis. Code substrate is correct (claim_posts_for_publishing RPC unchanged this
    session), but ADR doc-drift cannot be confirmed without reading the file.
  ────────────────────────────────────────
  #: G2
  Result: ⚠️  NOT VERIFIED
  Notes: Same reason — ADR 0006 Amendment 1 not read this session. Code substrate (metrics upserts) unchanged.
  ────────────────────────────────────────
  #: G3
  Result: ✅ PASS
  Notes: git diff confirms zero orchestrator diff in commits c7272ff and 4840f47.

  SECTION H — Observability & Redaction

  #: H1
  Result: ⚠️  PARTIAL — same as E1
  Notes: triggeredBy is logged with literal field name and 'qstash'/'secret' value on both routes (publish:95,
    sync-metrics:71). However it is a separate log line from the orchestrator's canonical publish-tick summary line.
    Operators searching triggeredBy will find ticks; operators searching by publish-tick summary fields
    (claimed/published/failed) will see them without triggeredBy. Same fix as E1.
  ────────────────────────────────────────
  #: H2
  Result: ⚠️  DRIFT
  Notes: The QStash cron-auth-failure warn has kind: 'cron-auth-failure', route: 'publish'|'sync-metrics', trigger:
    'qstash', reason. It logs only reason (no signature, no key value, no header verbatim). ✅ on redaction. But there
  is
     no pre-existing Bearer-side warn to "match" — the Bearer 401 path returns silently. The new QStash warn  is the
  only
     structured auth-failure log. Acceptable, but the spec's "matching pair" expectation overstates the prior state.
  ────────────────────────────────────────
  #: H3
  Result: ✅ PASS
  Notes: Both routes: return new NextResponse('Unauthorized', { status: 401 }) — no reason leaked in body. Test
    expect(await res.text()).toBe('Unauthorized') enforces literal equality (route.test.ts:118, 257).
  ────────────────────────────────────────
  #: H4
  Result: ✅ PASS
  Notes: sentry-scrub.ts:19 REDACTED_KEYS now includes 'upstashsignature', 'qstashcurrentsigningkey',
    'qstashnextsigningkey' (normalised forms — matches Upstash-Signature, QSTASH_CURRENT_SIGNING_KEY,
    QSTASH_NEXT_SIGNING_KEY after normaliseKey() strips non-alphanumerics and lowercases).
  ────────────────────────────────────────
  #: H5
  Result: ✅ PASS
  Notes: Orchestrators reach Sentry.withMonitor('publish-tick', …) / Sentry.withMonitor('metrics-sync-tick', …)
    regardless of trigger source (zero orchestrator diff confirms no regression).
  ────────────────────────────────────────
  #: H6
  Result: ✅ PASS
  Notes: cron_health writes happen inside the orchestrators (unchanged this session).

  SECTION I — Conventions

  ┌─────┬───────────┬───────────────────────────────────────────────────────────────────────────────────────────────┐
  │  #  │  Result   │                                             Notes                                             │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ I1  │ ✅ PASS   │ No process.env in qstash-auth.ts or route additions.                                          │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ I2  │ ✅ PASS   │ No any in new code. e: unknown narrowed via instanceof QStashAuthError.                       │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │           │ New code adds two console surfaces per route: the cron-auth-failure warn (acceptable) and the │
  │ I3  │ ❌ FAIL — │  new route-level publish-tick/metrics-sync-tick log (E1). The duplicate tick log is           │
  │     │  FINDING  │ unauthorised. CLAUDE.md prohibits unsanctioned console.*. The cron-auth-failure warn is a     │
  │     │           │ justified addition; the duplicate tick log is not.                                            │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │ I4  │ ✅ PASS   │ No new timestamp writes. Existing formatISO(now) calls preserved.                             │
  ├─────┼───────────┼───────────────────────────────────────────────────────────────────────────────────────────────┤
  │     │           │ docs/launch-checklist.md §3 has "Trigger source" header with QStash (active) sub-section      │
  │ I5  │ ✅ PASS   │ linking qstash-setup.md (line 90) and Vercel Cron (reserved) sub-section linking              │
  │     │           │ vercel-cron-restore.md (line 120).                                                            │
  └─────┴───────────┴───────────────────────────────────────────────────────────────────────────────────────────────┘

  ---
  Final Verdict

  Blockers before deploying to production

  1. B7 — Pin @upstash/qstash. Change package.json from "^2.11.0" to "2.11.0". A floating minor on a security-critical
  SDK is a supply-chain risk.
  2. E1 / H1 / I3 — Collapse the duplicate publish-tick / metrics-sync-tick log. The route emits a second, summary-less
  tick line. Either pass triggeredBy into the orchestrator so the canonical line gains the field, or delete the
  route-level log. Without this, the operator observability gate "observe triggeredBy: 'qstash' in the first prod tick"
  works, but search-by-summary queries lose triggeredBy correlation, and CLAUDE.md's console-surface rule is broken.

  Blockers before the future Vercel Cron flip

  3. None. The rollback runbook is complete and code-change-free. F1–F5 all pass. The hard-branch design means setting
  CRON_TRIGGER=secret, restoring the vercel.json crons block, and removing QStash env vars is sufficient.

  Tech debt acceptable to defer

  - G1 / G2 ADR cross-reference verification. ADR 0005/0006 Amendment 1 cite text not read this session; the code
  substrate (claim_posts_for_publishing RPC, metrics upserts) is unchanged and verified safe by construction in prior
  sessions. Confirm Amendment text in a follow-up doc pass.
  - C4 / H2 — Bearer-side cron-auth-failure warn parity. The Bearer branch has no structured warn on 401; only the
  QStash branch does. Adding the matching pair is a small observability improvement, not a launch blocker.
  - vercel.json: {} empty object. Cosmetic — can be deleted entirely once Vercel tooling is reconfirmed not to require
  its presence.

  Disposition: APPROVE pending fixes for findings B7 and E1/H1/I3 (one package.json edit, one route refactor that lifts
  triggeredBy into the orchestrator log). All other amendment-mandated invariants hold. Reviewer-pinned dev-bypass
  lexical-unreachability test confirms the core security claim.