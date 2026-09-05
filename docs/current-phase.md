# Current Phase

**Phase:** 1 — MVP
**Goal:** First paying customer
**Status:** **Session 30 (Track G, market-responsive signal source, ADR 0023, G1b.1–G1b.14) CLOSED and
MERGED (2026-09-03).** All four sessions ran: Architect (ADR 0023) → Builder (G1b.1–G1b.14) → Reviewer
(G1c, `docs/reviews/session-30-reviewer.md`, scope `afeafbf3..e036f6f5`, 23 findings) → Correction pass
(Session 30-D, D0–D9, CLOSED: 19 fixed, 4 deferred with named conditions). **PR #9 merged to `master` as
merge commit `2a67041a`** — a **merge commit, not a squash**, deliberately: the 30-D appendix self-cites
individual SHAs (`943ad622`, `4820fa37`, `6f93499f`, `98a91a56`, `b297a4a8`), all verified reachable from
`master` after the merge. This unblocks Session 30.5 (Track N, ADR 0028). A second Mode-3 signal source (customer-supplied RSS/Atom feeds)
ships alongside GitHub releases, gated behind ADR 0021 §12's second-source override (ADR 0023 §2.9 + ADR
0021 §16 Amendment A — corrected citation, Session 30-D D8 NIT-1; does not travel to a third source). Two
real production bugs were found and fixed along the
way: the triage prompt was hardcoded to GitHub-release framing for every candidate including RSS articles,
and `lib/ai/parsers.ts#extractJsonBlock` could not tolerate the model prefacing its JSON decision with
prose (a real risk on any `runPrompt`/`runToolLoop` call, not eval-only). **27 constraints total** (ADR
0023 §11): 23 carry a Tier-1/2/3 proof and are **COVERED**; exactly 4
(`SIGNAL-MR-CORPUS-EXTENDED`/`-MODEL-AUTHORED`/`-BLIND-LABELLED`/`-QUALITY-LOWER-CONFIDENCE`) are Tier E
and are **MEASURED**, never COVERED. **The live model-authored cassette run (G1b.13) is honest, not
flattering:** corpusVersion 2 — github precision 1.000 (24/24), recall 1.000 (24/24), dismissMatch 1.000
(16/16), unchanged v1 bootstrap; **market_responsive precision 0/0, recall 0/24, dismissMatch 9/16** — the
live model scored zero of the 24 founder-labelled `card` examples as `card`. Every `no_card` reason cited
the total absence of audience/brand/campaign memory (the corpus's universal `stubMemory: {}` condition) —
**stated here as a HYPOTHESIS the model's own text suggests, not a confirmed cause** (A-7, Session 30-D D8):
the corpus's universal zero-memory condition is a genuine confound never isolated from the prompt/model
combination itself, and no re-run with populated stub memory has yet been attempted to test it (D9 attempts
one). **`SIGNAL-MR-QUALITY-LOWER-CONFIDENCE`, updated for the post-live-run state (§2.8's
own instruction — reciting the pre-live-run sentence would now be false):** the market-responsive source is
no longer merely lower-confidence for lack of measurement — it **has been measured**, and the measured
result is currently poor; market-responsive floors remain reported-but-advisory until graduation (§2.6),
and the per-source split (§2.7) is preserved — a blended number remains prohibited. **CI, PR #9
(`pull_request`-event run, `db-tests` tally unaffected — not a `master` run):** `app-tests`
[run 33259652839](https://github.com/tcr430/SOSH/actions/runs/33259652839) (`232 file(s) under [app, lib,
components] all visible, zero failures — green. (3311/3311 tests passed)`), `db-tests`
[run 33259652907](https://github.com/tcr430/SOSH/actions/runs/33259652907) (`38 file(s) under
[supabase/__tests__] all visible, zero failures — green. (343/343 tests passed)`),
`eval-reported`/`eval-threshold` [run 33259652831](https://github.com/tcr430/SOSH/actions/runs/33259652831)
(`corpusVersion=2 github[precision=1.000 (24/24) recall=1.000 (24/24) dismissMatch=1.000 (16/16)]
market_responsive[precision=0.000 (0/0) recall=0.000 (0/24) dismissMatch=0.563 (9/16)]`). **Launch-blocking
counsel items, extending ADR 0020 §9.6's existing blocker (not a parallel one):** article licensing/feed
ToS; a fresh Art. 6(1)(f) balancing test for a controller posture covering named journalists, quoted
individuals and photo credits; the `/privacy` prose extension and its `evidenceRef` bump. **`SIGNAL-NO-
EMBEDDINGS` (Tier 3) is explicitly NOT retired** — embeddings were RE-AFFIRMED as deferred (ADR 0023 §4.1),
not un-deferred. See the Session 30 entry under "What's done" for the full detail, including the two bug
fixes and the Reviewer's still-pending independent audit (§3, G1c).

**Session 29 (Mode 1 Studio "promote to campaign" + carousel/script format families, ADR 0022,
Track F) CLOSED.** Correction pass Session 29-D (D0–D12) closed all twenty Reviewer findings (5 MAJOR, 8
MINOR, 7 NIT — 0 BLOCKER; the Reviewer's own closing tally understated this as 15, corrected in the
appendix's row zero); PR #6 merged to `master` as `2e6d3915` (real merge commit, not squash, matching every
prior session's convention) with a genuine `master` push-event green run for both required jobs — `app-tests`
[run 32893410518](https://github.com/tcr430/SOSH/actions/runs/32893410518) (`226 file(s) … 3129/3129 tests
passed`), `db-tests` [run 32893410504](https://github.com/tcr430/SOSH/actions/runs/32893410504) (`35
file(s) … 316/316 tests passed`) — extending the `db-tests` promotion streak to **6** consecutive green
`master` runs (see the tally entry below). Every MAJOR was the same root cause restated three times: a
requirement ADR 0022 stated in prose but named no constraint for — MAJOR-1, MAJOR-2 and MAJOR-4 all trace
back to that single process failure, now recorded as a standing rule in ADR 0022 §11's preamble (D11). See
the Session 29 entries under "What's done" below for the full detail, including the D8 live-Postgres RLS
finding (`security-reviewer`-confirmed)
and D5's promoted-campaign generation fix.

**Session 28 (Mode 3 Part 2: Triage, Insight Cards, Opportunity Feed, ADR 0021) CLOSED, correction
pass Session 28-D CLOSED (D0–D9, Track E).** E5.1–E5.12 shipped Stage C (bounded tool-using triage loop),
Stage D (card generation + verification), the `/opportunities` feed (ten states), Stage F (seeding into the
existing brief pipeline), and Tier E — a new MEASURED-never-COVERED eval category. **28 of 29 §11 constraints
carry a Tier-1/2/3 proof (COVERED); 1 (`SIGNAL3-TRIAGE-QUALITY`) is Tier E (MEASURED)** — corrected here from
an earlier "all 29 executed green in CI" claim that was FALSE at the E5.12 close-out head (`0ffe6acf`): three
constraints did not hold there (`SIGNAL3-TOOL-INVOCATION-EXPECTED` never authored, the
`SIGNAL3-RESCORE-INVALIDATES-TRIAGE` card arm proved nothing, `OpportunityFeed.tsx` had zero test
coverage). **Session 28-D's D3, D2 and D5 steps closed each of these**, with tests demonstrated to redden
against the pre-fix code before being reverted — the count is now true, dated to 28-D (2026-08-14), not
silently backfilled onto the E5.12 date. **D9 (2026-08-14) pushed the corrected range (`632a4b5e`..`87a4dfc8`,
D0–D8) and ran all three workflows green at that head** — `app-tests`
[run 31846312604](https://github.com/tcr430/SOSH/actions/runs/31846312604) (`skip-guard: 212 file(s)
under [app, lib, components] all visible, zero failures — green. (2848/2848 tests passed)`), `db-tests`
[run 31846312570](https://github.com/tcr430/SOSH/actions/runs/31846312570) (`skip-guard: 30 file(s) under
[supabase/__tests__] all visible, zero failures — green. (282/282 tests passed)`, this is the run that
contains `signals3-triage-atomic.test.ts` — D8/MINOR-2's corrected citation is now backed by a real green
run, not merely a promise), `eval-reported`
[run 31846312762/job/94913376549](https://github.com/tcr430/SOSH/actions/runs/31846312762/job/94913376549)
and `eval-threshold`
[run 31846312762/job/94913501702](https://github.com/tcr430/SOSH/actions/runs/31846312762/job/94913501702)
(two check names, one workflow, per D4) — **corpusVersion=1, precision=1.000 (24/24), recall=1.000
(24/24), dismissMatch=1.000 (16/16), executed=40/40**, framed per D8/MINOR-8 as a **bootstrap ceiling**
(hand-authored cassettes scored against their own hand-assigned labels), not a quality claim. See "What's
done" below for the full detail. **Session 25 (diff-based learning
capture, ADR 0018) CLOSED.** Track C of the ADR 0016→0017→0018
intelligence-layer programme shipped: the AI-original snapshot (`post_ai_originals`, write-once), the
capture outbox (`post_edit_signals`, trigger-enqueued on `draft→approved`), the Tier-0 heuristic classifier
(no LLM, 12 signal kinds), the correction/preference split enforced by a DB trigger, the Tier-1 LLM
summarizer (Haiku, two-gate floor, hard ceilings), atomic promotion/demotion, and the hourly worker —
through C2.1–C2.9, then a full Session 25-D correction pass (D0–D7) closing every finding (6 MAJOR, 11
MINOR, 7 NIT — zero BLOCKER) from the independent Reviewer's report. All three tracks of the 0016–0018
programme (governed memory, Mode 2 upgrade, diff-based learning) are now closed. `db-tests`/`app-tests`
ran green on the corrected range (D0–D7, `05deb29d`) via PR #4 — `app-tests`
[run 30432771541](https://github.com/tcr430/SOSH/actions/runs/30432771541), `db-tests`
[run 30432771534](https://github.com/tcr430/SOSH/actions/runs/30432771534) — see the promotion tally
below (tally unchanged at 0/3: a `pull_request`-event run, not a `master` run). **Session 22
(test-execution integrity + approvals hardening) CLOSED.** W1 (ADR 0015) gave the app-layer suite its own required CI gate (`app-tests.yml`) and made `db-tests.yml` tuned/skip-guarded/flag-free; W2 (ADR 0014 Amendment A) hardened bulk approve to filter-scoped+atomic, added a server-side filter-scoped overflow-honest total, verified WCAG-AA contrast in both themes, and regression-guarded `ROLE-TEAM-ECHO`. B6 closed the session: re-verified three 21B/21C findings already resolved at HEAD (no code needed), and wrote PROC-REVIEW-AT-COMMIT + the merge-gate table into `CLAUDE.md`. **Session 21 (21A + 21B + 21C) CLOSED.** Seats & Permissions is fully shipped: the DB-enforced model (ADR 0013 Rev B, 21A → 21A-D correction), the resolver/invite/team-settings/capability-retrofit/overage surface (ADR 0014, 21B → 21B D1–D4 correction), and the approver quick-approve inbox (ADR 0014 §9, 21C → 21C E1–E3 correction). Session 20 — Content Calendar (ADR 0012 Rev B) shipped, through the 20D-5 correction pass. Voice model (ADR 0011 Rev B) remains code-complete bar the open 19D-5 decision (§7 BP9 read path — needs ADR 0011 amendment). Next phase: pre-launch hardening (Postiz removal, legal gates, perf/CWV — see "Next up" below). tsc clean (one pre-existing error in refine-from-posts-action.test.ts, unrelated to Session 20/21/22), ESLint clean.

## What's done

- **Session 30 — Track G: Market-responsive signal source (ADR 0023), G1b.1–G1b.14 BUILDER COMPLETE, PR #9
  open:** A second Mode-3 signal source — customer-supplied RSS/Atom feeds — alongside the existing GitHub
  releases source. `watched_feeds` migration + RLS + §D2.5 cascade (G1b.1); boundary scans extended ahead
  of the code that could violate them (G1b.2); the SSRF/XXE egress guard as two separate controls (G1b.3);
  the RSS/Atom client behind `SIGNAL-MR-CLIENT-BOUNDED` (G1b.4); atomic ingestion with per-feed isolation
  and dedup (G1b.5); the scorer, kind-keyed and re-proved deterministic across both kinds (G1b.6); the
  reserved-split allocation — 2-of-5 shortlist slots, 1-per-feed cap (G1b.7); provenance at the human gate,
  metadata that never reaches a prompt (G1b.8); the gating seam extracted, settings/signals/ watch-list
  UI (G1b.9); the scan sweep + Tier-3 enumeration (G1b.10); the Tier A mutation test proving the eval
  script's own arithmetic (G1b.11).
  - **Corpus v2 (G1b.12/G1b.13):** schema bump to `corpusVersion=2` — every example now carries a `source`
    discriminator; 80 examples total, `metricsBySource` replacing the removed blended figure, each metric
    carrying numerator/denominator/floor/sigma. The 40 market-responsive signal inputs and every
    `expectedVerdict`/`expectedDismissReason` are founder-authored and approved (ADR 0023 §17 Amendment 1
    permits Claude-drafted inputs under founder review; §18 Amendment 2 records the further ruling to use
    real companies/events for the 24 `card` examples, fictional for the 16 `no_card`, with the caveat that
    the real-company figures are pulled from search summaries and not yet verified against primary
    sources). `SIGNAL-MR-CORPUS-BLIND-LABELLED`'s ordering is provable: the label commit
    (`7bfe1c7c`) predates the cassette commit (`cd1b7203`), both SHAs recorded in `corpus.v2.json`.
  - **The live model run (G1b.13) found and fixed two real production bugs before it could produce a
    usable cassette.** (1) `lib/signals/triage/orchestrator.ts`'s `buildTriageSystemPrompt`/
    `buildTriageUserMessage` were hardcoded to GitHub-release framing regardless of `signal.source`, even
    though the candidate pool has enumerated both sources since G1b.7 — every market-responsive candidate
    was being triaged with a prompt telling the model it was reading a GitHub release. Fixed by branching
    on `candidate.signals.source` (SIGNAL-MR-METADATA-NOT-PROMPTED still holds — the branch is in code,
    never in prompt text). (2) `lib/ai/parsers.ts#extractJsonBlock` required the model's entire response
    to already be valid JSON; the model prefixed its JSON decision with a sentence of commentary despite an
    explicit "no commentary" instruction in ~75% of the first attempt's calls, all reported as
    `invalid_response`. Fixed with a balanced-brace, quoted-string-aware fallback scan — a genuine
    production-code fix (any `runPrompt`/`runToolLoop` call could hit the same non-compliance), not
    eval-only.
  - **The measured result, reported honestly (Tier E, ADR 0015 Amendment B4) — not smoothed over:**
    corpusVersion 2, github precision 1.000 (24/24) recall 1.000 (24/24) dismissMatch 1.000 (16/16,
    unchanged v1 bootstrap, not itself re-run live yet); **market_responsive precision 0/0 (the model
    predicted zero cards) recall 0/24 (every founder-labelled `card` example scored `no_card`) dismissMatch
    9/16.** Every `no_card` reason cited the total absence of audience/brand/campaign memory — the corpus's
    universal `stubMemory: {}` condition — **stated here as a HYPOTHESIS the model's own reason text
    suggests, not a confirmed cause of the 0/24 result** (A-7, Session 30-D D8): the zero-memory condition
    has not been isolated from the prompt/model combination by any controlled re-run as of this entry — D9
    attempts the one out-of-band live re-run with populated stub memory that would test it, and either
    cites that result or records the attempt as blocked, in which case this hypothesis framing stands as
    the final word. The sabotage
    experiment (`lib/signals/__fixtures__/eval/sabotage-run.json`) ran the same 40 signals through a
    deliberately degraded ("always decide card") prompt: 6/40 flipped to card vs 0/40 clean — proving the
    prompt demonstrably CAN move the output at this out-of-band live-run point (the honest form of ADR
    0021 §12/L-11's mitigation #1; the deterministic replay harness, `run-triage-eval.ts`, remains provably
    un-movable by any prompt change, since it never invokes one). Total live-API cost across the session's
    invocations: ~$3.39.
  - **27 constraints total** (ADR 0023 §11): 23 carry a Tier-1/2/3 proof and are **COVERED**; exactly 4
    (`SIGNAL-MR-CORPUS-EXTENDED`, `-MODEL-AUTHORED`, `-BLIND-LABELLED`, `-QUALITY-LOWER-CONFIDENCE`) are
    Tier E and are **MEASURED**, never COVERED — `SIGNAL-MR-CORPUS-DISCRIMINATIVE` is Tier 2 (a test of
    `scripts/eval/`'s own arithmetic, explicitly not a corpus-discrimination proof).
  - **ADR 0021 §12's second-source gate is OVERRIDDEN, not satisfied** (ADR 0023 §2.9/Amendment note on
    ADR 0021 §16): neither clause (true-card ≥ 40 per source, a recorded run history) was met at ship time.
    **This override does not travel** — a third signal source re-tests §12 from scratch, and citing this
    session as precedent is itself a Reviewer finding.
  - **`SIGNAL-NO-EMBEDDINGS` (Tier 3) is explicitly NOT retired** — embeddings were RE-AFFIRMED as deferred
    (ADR 0023 §4.1, Q3a), not un-deferred; no pgvector, no embedding call anywhere in the diff.
  - **Launch-blocking counsel items** (ADR 0023 §7.7/A-2), extending ADR 0020 §9.6's existing blocker
    rather than a parallel one: article licensing/feed ToS; a fresh Art. 6(1)(f) balancing test for a
    controller posture covering named journalists, quoted individuals and photo credits; the `/privacy`
    prose extension and its `evidenceRef` bump. Flagged, not written — no `[LEGAL ENTITY]` placeholder
    touched.
  - **CI (PR #9, `pull_request`-event run — the `db-tests` promotion tally is unaffected, not a `master`
    run):** `app-tests` [run 33259652839](https://github.com/tcr430/SOSH/actions/runs/33259652839)
    (`232 file(s) under [app, lib, components] all visible, zero failures — green. (3311/3311 tests
    passed)`), `db-tests` [run 33259652907](https://github.com/tcr430/SOSH/actions/runs/33259652907)
    (`38 file(s) under [supabase/__tests__] all visible, zero failures — green. (343/343 tests passed)`),
    `eval-reported`/`eval-threshold`
    [run 33259652831](https://github.com/tcr430/SOSH/actions/runs/33259652831) (`corpusVersion=2
    github[precision=1.000 (24/24) recall=1.000 (24/24) dismissMatch=1.000 (16/16)]
    market_responsive[precision=0.000 (0/0) recall=0.000 (0/24) dismissMatch=0.563 (9/16)]`). Two real
    lint errors (pre-existing, uncaught until this PR's first CI run: a raw `.toISOString()` in
    `parse-article.ts`, `require()`-style imports in two RSS test files) plus one this session introduced
    (`live-triage-run.ts` importing `@anthropic-ai/sdk` directly, banned by ADR 0003 C-2 outside
    `/lib/ai/`) were found and fixed before `app-tests` went green.
  - **Reviewer session (§3, G1c) RAN — `docs/reviews/session-30-reviewer.md`** (corrected 2026-09-03; the
    line previously here read *"NOT YET RUN"* and was never updated by D0–D9, though the correction pass
    it describes answers that report's own numbered findings). **Scope reviewed: `afeafbf3..e036f6f5`**
    (20 commits, `G1b.1` → `G1b.14`), named in the report's opening line per `PROC-REVIEW-AT-COMMIT`.
    The Reviewer proceeded with PR #9 still open, reasoning that `e036f6f5` was the head proposed for
    merge and *"a review that waits for merge reviews nothing that can still be changed"* — recording the
    caveat that a later commit on the branch makes its range stale. D0–D9 are exactly those later commits,
    which is the designed Reviewer → Correction-pass order, and the 30-D appendix re-cites each fix at its
    own SHA. **Local `master` was stale at `17d36e1f` — inside the Track G series — so `git diff
    master..HEAD` showed 21 of the 39 commits; the Reviewer refused it as a base and used `afeafbf3`
    (tip of `origin/master`). That stale ref was corrected on 2026-09-03 at merge.**
  - **Session 30-D, D6 correction (ADR 0023 §20 Amendment 3):** the market-responsive ingestion cadence is
    **HOURLY**, not the "daily tick" §3.4 originally stated — `runSignalsTick`'s existing signals-poll cron
    is `0 * * * *`, and A-4's backlog-growth arithmetic (and D3's business-bounded enumeration fix) both
    assume this real cadence, not the daily one. **`rate_limited_until` is READ-ONLY / SEEDED-ONLY** — no
    production code path sets it yet (un-deferring condition: the first observed HTTP 429 from a real feed,
    or the session that adds feed-health surfacing); the UI/column/i18n keys all stay.
  - **Session 30-D, D8 (A-6 ruling) — the corpus's 24 `card` examples cite unverified real-company figures:**
    ADR 0023 §18 Amendment 2's real-company/event figures (used to construct the 24 `card` examples) were
    "pulled from search-result summaries, not verified against primary sources," and that spot-check has
    **not** been performed. **Any future session citing a specific number from those 24 examples must
    re-verify it against a primary source first** — this obligation is recorded here (so it is not lost
    inside the ADR alone), in ADR 0023 §18, and in `docs/build-guide/session-30.md`'s §3b reconciliation
    note.
  - **Session 30-D, D9 CLOSE-OUT (2026-09-01) — Session 30 Track G's correction pass is CLOSED.** D0–D8
    (BLOCKER-1/2, MAJOR-1/2/3, MINOR-1/3/4/6/7/8/9/10, NIT-1/2/3/4/5, A-5/A-6/A-7/A-8 — 19 fixed, 4 deferred
    with named conditions) pushed to `session-30-track-g-market-responsive-signal-source` (PR #9), head
    `98a91a56`. **All three required workflows green at the corrected head**, `pull_request`-event (not
    `master` — the `db-tests` promotion tally below is therefore unaffected by this run):
    `app-tests` [run 33541129699](https://github.com/tcr430/SOSH/actions/runs/33541129699)
    (`skip-guard: 232 file(s) under [app, lib, components] all visible, zero failures — green. (3326/3326
    tests passed)`, quoted verbatim from the log line); `db-tests`
    [run 33541129826](https://github.com/tcr430/SOSH/actions/runs/33541129826)
    (`skip-guard: 38 file(s) under [supabase/__tests__] all visible, zero failures — green. (344/344 tests
    passed)`, quoted verbatim); `eval-reported`/`eval-threshold`
    [run 33541129684](https://github.com/tcr430/SOSH/actions/runs/33541129684) —
    `assert-eval-executed: eval-reported green — corpusVersion=2 executed=80/80` (D1's fix: this now means
    what it says, `pendingCount` would hard-fail if any example were unscored) and
    `assert-eval-executed (threshold): … corpusVersion=2 github[precision=1.000 (24/24) recall=1.000 (24/24)
    dismissMatch=1.000 (16/16)] market_responsive[precision=undefined (0/0) recall=0.000 (0/24)
    dismissMatch=0.563 (9/16)]` — **precision reported as the UNDEFINED metric D1 made it (denominator 0),
    never `0.000`**, per source, never blended (L-11). market_responsive remains MEASURED at **lower
    confidence** than github until its graduation label count (160 presented cards, §2.6) is reached. The
    corpus's D1 redden demonstration: stripping every cassette from `corpus.v2.json` now flips
    `eval-reported` from green to a hard failure (`executed 0/80`, every example named `PENDING`) — proof
    the false-green D1 closed is gone, not merely asserted.
  - **A-7's re-run (D9): ONE out-of-band live re-run with POPULATED stub memory, `npm run
    eval:live-triage-populated`.** Result: **recall moved from 0/24 (clean, zero-memory) to 11/24** with
    populated stub audience/brand/evidence/campaign memory; precision 11/11 (was 0/0 — the run now predicts
    `card` at all). Cost: $0.66. **This MOVES the hypothesis from untested to partially supported**: the
    zero-memory condition is not the sole driver of the 0/24 result (13 of 24 genuinely-relevant examples
    still scored `no_card` even with populated memory — real judgment-calibration headroom remains beyond
    the memory confound), but populating memory demonstrably recovers real recall the zero-memory condition
    was suppressing. `corpus.v2.json` was **not** modified by this run — the artefact
    (`lib/signals/__fixtures__/eval/populated-memory-run.json`) is evidence, not a new cassette commit, per
    A-1's ban on treating an ad hoc live run as a corpus source.
  - **`db-tests` promotion tally: unchanged by this pass** — D9's runs are `pull_request`-event against PR
    #9, not pushes to `master`; the three-consecutive-green-on-master tally that gates `db-tests` promotion
    (ADR 0015 §5) advances only on a `master` push, which this correction pass does not make (merging PR #9
    is the founder's call, per session-30.md §5's "Next" line).

- **Session 28 — Mode 3 Part 2: Triage, Insight Cards, Opportunity Feed (ADR 0021), E5.1–E5.12 CLOSED:**
  Builds on Session 27's ingestion pipeline. Stage C (a bounded, tool-using triage loop —
  `lib/ai/tool-runner.ts#runToolLoop`, security-reviewed, four read-only tools, hard token/turn/cost bounds,
  fail-closed) decides `card`/`no_card` per candidate; Stage D (`lib/signals/triage/card.ts`) generates the
  insight card in one Tier-1 `runPrompt` call outside the loop, with a verify-then-cite evidence guard and a
  deterministic no-post-copy validator; the `/opportunities` feed (E5.9) implements all ten §9.2 states
  (empty×2, pending, high-sensitivity, expired, saved, approved-in-flight, triage-failed, paused,
  lost-the-race) with atomic conditional-UPDATE transitions and the typed `already_triaged` race outcome;
  Stage F (`lib/signals/seed.ts#seedCampaignFromCard`, E5.10) composes an approved card into a new campaign
  and drives the **existing** `assembleBrief` unchanged — its first production caller, exercised end-to-end
  against live Postgres per §0.2 A-2's binding condition; E5.11 closed the four executable source scans
  (all per-root vacuity guarded) and recorded the six Tier-3 diff-verified items as decisions; E5.8 shipped
  a new test category, **Tier E — MEASURED, never COVERED** (ADR 0015 Amendment B4), a deterministic-replay
  eval harness scoring precision/recall/dismiss-reason-match against a 40-example human-labelled corpus.
  - **29 constraints total** (ADR 0021 §11): 28 carry a Tier-1/2/3 proof and are **COVERED**; exactly one,
    `SIGNAL3-TRIAGE-QUALITY`, is Tier E and is **MEASURED** — a deliberately weaker claim, never
    "COVERED," everywhere it appears (§10.4).
  - **First eval result — a bootstrap ceiling, not evidence of real triage quality** (ADR 0021 §10.4/§10.5,
    the E5.8 caveat): hand-authored cassettes scored against their own hand-assigned labels, so a perfect
    score is expected by construction, not earned. **corpusVersion=1, precision=1.000 (24/24), recall=1.000
    (24/24), dismissMatch=1.000 (16/16), executed=40/40.** `eval-reported` promotes to required the same
    way `db-tests` does — three consecutive green `master` runs — and is currently at **0 of 3** (no
    `master` run yet). **DEFECT, found 2026-09-03 at the PR #9 merge and NOT yet fixed: this tally cannot
    ever advance as written.** `.github/workflows/eval-triage.yml` declares `on: pull_request` +
    `workflow_dispatch` and **has no `push` trigger at all**, so no `master` push event can produce an
    `eval-reported` run — the merge of PR #9 to `master` fired `app-tests` and `db-tests` and, correctly
    per that trigger list, no eval run. The promotion rule and the workflow's trigger set are therefore
    contradictory, and "0 of 3" understates the problem: the counter is not merely at zero, it is
    unreachable. **Fixing it is a CI-gate change and the founder's call** (add `push: branches:
    [master]`, or restate the promotion rule for this workflow in ADR 0015 §5) — recorded here rather
    than changed silently, and deliberately not bundled into the Session 30 close-out.
  - **Final, current CI citation (Session 28-D, D9, the corrected range `632a4b5e`..`87a4dfc8`):**
    `app-tests` [run 31846312604](https://github.com/tcr430/SOSH/actions/runs/31846312604)
    (`212 file(s), 2848/2848 tests`); `db-tests`
    [run 31846312570](https://github.com/tcr430/SOSH/actions/runs/31846312570) (`30 file(s), 282/282
    tests` — contains `signals3-triage-atomic.test.ts`, confirmed present); `eval-reported`/`eval-threshold`
    [run 31846312762](https://github.com/tcr430/SOSH/actions/runs/31846312762) both green. Two earlier
    citations at this same close-out were superseded before this one: an original head (`0ffe6acf`) was
    cited before `signals3-triage-atomic.test.ts` existed at that SHA (self-contradicting the
    `SIGNAL3-TRIAGE-ATOMIC` claim it was meant to prove) and had to be re-cited twice — a caution to always
    verify a cited file actually exists at the cited SHA (`git cat-file -e <sha>:<path>`), not just that a
    run was green.
  - Full detail: `docs/decisions/0021-mode-3-triage-and-opportunity-feed.md`, `docs/build-guide/session-28.md`.

- **Session 27 — Mode 3 GitHub signal ingestion (ADR 0020), E2.1–E2.11:** GitHub App install/OAuth
  connect flow (tenant-bound per §8.3's eleven-step callback, A-1's two-direction close — the OAuth leg
  present, the user token never persisted), an hourly QStash poller (conditional ETag polling, idempotent
  ingestion, one canonical tick log line), a deterministic zero-LLM scorer/dedup pass into
  `signal_candidates`, the `settings/signals` UI (four honest states, truthful disconnect copy, i18n
  en/pt/es), and E2.10/E2.11's enforcement layer: four executable source scans plus two A-1 scans, all with
  per-root vacuity guards (`lib/signals/source-scans.test.ts`, `lib/signals/token-boundary.test.ts`).
  **E2.11 (verify-only) found and closed four real gaps** between ADR §12's claimed test coverage and what
  actually executed — `SIGNAL-DISCONNECT-DEACTIVATES` claimed Tier-1 with only a Tier-2 mock (added a live
  concurrency test), `SIGNAL-NO-TOKEN-AT-REST` and `SIGNAL-WEBHOOK-SEAM-CLEAN` claimed proof tiers neither
  a test nor a §11.4 enumeration backed (added migration-block scans), `SIGNAL-RAW-TEXT-UNTRUSTED`'s
  "brand minting" proof didn't exist as a test distinct from sink-narrowing (added a compile-time
  `expectTypeOf`/`@ts-expect-error` pair) — and corrected ADR §11.5's SHARED-FUNCTION CALLERS table, which
  wrongly claimed reuse of `signOAuthState`/`verifyOAuthState`; Session 27 actually built separate,
  non-shared functions (`signGithubConnectState`/`verifyGithubConnectState` in `lib/signals/state.ts`) that
  only mirror the existing mechanism's shape. All 33 `SIGNAL-*` constraints independently reconfirmed to
  map to a test that executes in a named CI job and reddens if broken.
  - **CI infrastructure gap found and fixed (E2.11):** this branch hadn't been pushed to CI since Session
    26-D, so E2.3's four REQUIRED `GITHUB_APP_*` config fields had never been exercised in either workflow
    — every `supabase/__tests__` suite failed at `beforeAll` with a `ZodError` (read by the skip-guard as
    "every test skipped"), plus two app-tests files via the unmocked `@/lib/config` import. Fixed by adding
    the same dummy-value env vars `db-tests.yml` already used for `ANTHROPIC_API_KEY`/`STRIPE_*` to both
    workflows.
  - **[Session 27-D, MAJOR-1] The Reviewer's audited range head (`5b5bbb9f`) never itself ran green** —
    both jobs failed there on MAJOR-3 (the `GITHUB_APP_*` fields being unconditionally required). The
    fix landed 3 commits later, non-behavioural (workflow env vars + one lint annotation), so the 33
    `SIGNAL-*` constraints are not `AUTHORED-NOT-EXECUTED` — but D7 re-ran the corrected range
    (`93107cce`) green for real: `app-tests` [31194555691](https://github.com/tcr430/SOSH/actions/runs/31194555691)
    (193 files, 2665/2665 tests); `db-tests` [31194553890](https://github.com/tcr430/SOSH/actions/runs/31194553890)
    (24 files, 241/241 tests) — confirmed the four `GITHUB_APP_*` fields are genuinely `.optional()` (no
    workflow env vars set, green anyway). Both `pull_request`-event runs; promotion tally unchanged.
  - **A-2's launch-blocking condition, standing (ADR 0020 §0.2/§9.6):** third-party personal data in
    `signals`/`signal_candidates` (release author names/handles) has an approved, tracked Evidence Pack
    follow-on — **binding on launch: no launch until the Evidence Pack entry, the Art. 6(1)(f) balancing
    test, and the `/privacy` prose all land.** None had landed as of this entry. Standing alongside A-3's
    retention-reaper condition (§9.5, `SIGNAL-RETENTION-UNCLAIMED`), enforced by
    `settings/signals/signals-i18n.test.ts`'s scan until a real reaper ships.
  - Full detail: `docs/decisions/0020-mode-3-signal-ingestion.md`, `docs/build-guide/session-27.md`.

- **Session 25 CLOSED — Diff-based learning capture, ADR 0018 (Track C of the 0016→0017→0018 programme):**
  Builder phase C2.1–C2.9 shipped the snapshot table (`post_ai_originals`, write-once, `BEFORE UPDATE`-only
  guard — never `OR DELETE`, since a `BEFORE DELETE` guard would abort GDPR erasure for every business
  that ever generated a post), the capture outbox (`post_edit_signals`, trigger-enqueued on
  `draft→approved`, mode-agnostic and caller-agnostic by construction), a Tier-0 heuristic classifier
  (deterministic, no LLM, 12 signal kinds — 9 preference + 1 correction + 2 inconclusive), the
  correction/preference split enforced by a real DB trigger (`LEARN-VOICE-WRITE-TRIGGER`, not a
  service-role `if`), a Tier-1 LLM summarizer (Haiku 4.5, two-gate floor, hard token/monthly-call
  ceilings, `neutralize()`-guarded at render time), atomic promotion/demotion RPCs, and an hourly QStash
  worker with one canonical tick log line. An independent Reviewer session then audited the full range
  (`717263d2..d7cee4a5`) and found **zero BLOCKER**, 6 MAJOR, 11 MINOR, 7 NIT — the two most dangerous
  possible defects (a `BEFORE DELETE` guard breaking erasure; an LLM call on the per-post classify path)
  were explicitly NOT present. A full correction pass (Session 25-D, D0–D7) closed every finding:
  - **D0** committed the governing ADR/build-guide/reviewer-report trio (MAJOR-5 — they were untracked at
    the range they governed).
  - **D1** closed the MAJOR-1/MAJOR-2 pair (a query-layer leak letting correction-classed copy reach the
    summarizer, and the summarizer's promotability being overstated) — founder-adjudicated option (a):
    record + narrow, not make summarizer rows promotable.
  - **D2** gave `[db-MAJOR-1]`'s deliberate silent snapshot-skip its operator-visible counterpart
    (`scripts/learning-report.ts`'s orphan report, MAJOR-3 fix (c)) and bounded three previously-unbounded
    list queries (MINOR-7).
  - **D3** made the idempotency test a real replay (MAJOR-4), closed the one non-RLS tenancy boundary's
    outstanding test obligation (MAJOR-6), mapped ADR §13's last two unmapped Tier-2 constraint halves —
    **19 of 21 → 21 of 21** (MINOR-2) — and isolated the confidence-gate boundary (MINOR-10).
  - **D4** stopped a lost race from double-counting as an abandonment (MINOR-3), tagged summarizer
    failures with their underlying error code (MINOR-4), and renamed a misleadingly-named counter
    (NIT-4).
  - **D5** closed three DB-level guarantees that had lived in caller behaviour: removed `'failed'` as an
    unreachable transition target (MINOR-5), enforced the 90-day `expires_at` decay column at the
    generation-time read (MINOR-6), and made demotion recompute its own contradiction count instead of
    trusting caller arithmetic (MINOR-8) — a new forward migration,
    `20260728220000_demote_recomputes_contradictions.sql`.
  - **D6** corrected nine documentation/comment-accuracy defects (MINOR-1, MINOR-9, MINOR-11, NIT-1,
    NIT-2, NIT-3, NIT-5, NIT-6, NIT-7) — including a genuinely missing 28th disposition-table row
    (`[db-Q1]`, cited inline but never tabled) found only by checking the source rather than assuming the
    build guide's "28" prose was wrong.
  - **D7** finalised the reviewer report's correction-pass appendix (24-of-24 resolution table, additions-
    only diff proven) and consolidated the ADR/backlog/OpenWolf close-out documentation this entry
    describes.
  Every fix in D1–D6 that touched a mutable code path was manually mutated, confirmed to redden, and
  reverted before landing — not merely asserted to be tested. `tsc` clean and `npm run test:app` green
  (2343/2343, 167 files) after every step. **`db-tests`/`app-tests` CI run URLs for the corrected range**
  (D0–D7, `05deb29d`, via PR [#4](https://github.com/tcr430/SOSH/pull/4)): `app-tests`
  [run 30432771541](https://github.com/tcr430/SOSH/actions/runs/30432771541), `db-tests`
  [run 30432771534](https://github.com/tcr430/SOSH/actions/runs/30432771534), both green — see the
  promotion tally below for the full D8 entry.
- **Session 22 CLOSED — Test-execution integrity + approvals hardening (ADR 0015 + ADR 0014 Amendment A):**
  Two workstreams, one session, shared Reviewer, independently committable (W1 landed first — W2's
  regression tests are worthless until something executes them).
  - **W1 — Test-execution integrity (ADR 0015):** `app-tests.yml` is a NEW, standalone required CI job
    (tsc --skipLibCheck + eslint + `vitest run app/ lib/ components/`) — Tier-2 now runs on every push/PR,
    independent of the DB stack. `db-tests.yml` revised: `supabase/config.toml` disables `[studio]`,
    `[inbucket]`, `[storage]`, `[edge_runtime]` (grep-clean); Postgres memory knobs
    (`shared_buffers=256MB`/`max_connections=50`/`work_mem=8MB`) live in `config.toml`'s `[db.settings]`
    (not `ALTER SYSTEM` — the local Supabase `postgres` role isn't a superuser, a live-CI finding that
    corrected the original ADR 0015 §3.2b plan) and are verified, not assumed, before `db reset`; the
    eleven per-suite `*_INTEGRATION_TEST_ENABLED` flags are deleted — every `supabase/__tests__` suite now
    runs unconditionally; a JSON-reportered run feeds `scripts/ci/assert-no-empty-suite.mjs`, which fails
    the job on either an invisible (zero/all-skipped) suite or any genuinely red test, with no `|| true`
    anywhere in the gate. `vitest.config.ts` gained the repo-wide `include` (app/lib/components/
    supabase/__tests__) that is now the single source of truth for "the SOSH suite"; `package.json` gained
    `typecheck`/`test:app`/`test:db` as the only sanctioned entrypoints.
  - **W2 — Approvals hardening (ADR 0014 Amendment A):** bulk approve (`bulkApproveDraftPosts`) takes an
    optional `platforms` predicate — filter-scoped and atomic (A1), replacing the 21C/E1 stopgap of
    disabling the button under a filter; `listPendingDraftPosts` returns `{ rows, total }` with a
    server-side filter-scoped total, `countPendingDraftPosts` accepts the same predicate, and the Approvals
    inbox shows an honest overflow signal instead of a silent 200-row truncation (A2); bulk is offered only
    when the rendered count equals the server total for the active filter — an incomplete set disables
    bulk rather than risking a silent over/under-approve (`APV-BULK-VISIBLE-ONLY`, A1.1, added on founder
    review); WCAG-AA contrast verified in both light and dark themes (A3); `ROLE-TEAM-ECHO` — the four
    `settings/team` Server Actions' existing `canServer(MANAGE_MEMBERS)` echo (already present at
    `actions.ts:101,160,186,213` since 21B) — is now regression-guarded by a Tier-2 test asserting each
    action returns the typed `errors.forbidden` denial (not an opaque zero-row error) before touching the
    DB layer, backed by the existing Tier-1 `user-can-matrix.test.ts` proof that `manage_members` resolves
    `false` for every non-admin role×combo (the DB denies independently of the echo).
  - **B6 close-out (verification, not implementation):** re-verified 21C n1 (`DashboardShell` export-area
    comment) and 21B n1 (ADR §11 manifest) were already closed at HEAD from the 21C/E2–E3 correction pass —
    no new work. Re-verified 21B n2 (`MemberList.isExpiredInvite`) was already using `date-fns`
    (`addDays`/`isAfter`/`parseISO`), not raw epoch math — no new work. `CLAUDE.md` gained the
    test-execution-integrity section (three-tier taxonomy pointer, "covered = executed green" rule,
    PROC-REVIEW-AT-COMMIT, the §5 merge-gate table).
  - **`db-tests` promotion tally (ADR 0015 §5, `CI-DB-SUITE-STABLE`):** Promotion to Required needs three
    consecutive full-green `db-tests` runs on genuine **`master` push events** — `pull_request` runs never
    move this tally, however green, and every session's own PR-event CI runs are recorded in that
    session's build guide / reviewer appendix instead of here. **Threshold met 2026-07-27 (run 3); current
    streak: 7, unbroken** (last `master` red was `e2812ec8`, 2026-07-14, before the current topology).
    Reconciled 2026-08-22 after four weeks of only logging PR-event runs here and never querying
    `--event push --branch master` directly — every row below is confirmed non-vacuous (the skip-guard
    step itself reported `success`, not merely the overall check).

    | # | Date | `master` head | `db-tests` run | Skip-guard |
    |---|---|---|---|---|
    | 1 | 2026-07-22 | `4b035d3b` | [29947011885](https://github.com/tcr430/SOSH/actions/runs/29947011885) | `13 file(s) … green` |
    | 2 | 2026-07-25 | `d97e55c8` | [30156271345](https://github.com/tcr430/SOSH/actions/runs/30156271345) | green |
    | 3 | 2026-07-27 | `f1c730cc` | [30302554218](https://github.com/tcr430/SOSH/actions/runs/30302554218) | green — **threshold met** |
    | 4 | 2026-07-29 | `51264772` | [30436667567](https://github.com/tcr430/SOSH/actions/runs/30436667567) | `22 file(s) … green` |
    | 5 | 2026-08-21 | `e69e5c41` | [32493839443](https://github.com/tcr430/SOSH/actions/runs/32493839443) | `30 file(s) / 282 tests` — Sessions 26–28 (PR #5) merged |
    | 6 | 2026-08-25 | `2e6d3915` | [32893410504](https://github.com/tcr430/SOSH/actions/runs/32893410504) | `35 file(s) / 316 tests` — Session 29 Track F, ADR 0022 (PR #6) merged; `app-tests` also green ([32893410518](https://github.com/tcr430/SOSH/actions/runs/32893410518), 226 file(s) / 3129 tests) |
    | 7 | 2026-09-03 | `2a67041a` | [33747169517](https://github.com/tcr430/SOSH/actions/runs/33747169517) | `38 file(s) under [supabase/__tests__] all visible, zero failures — green. (344/344 tests passed)` — Session 30 Track G, ADR 0023 (PR #9) merged; `app-tests` also green ([33747169515](https://github.com/tcr430/SOSH/actions/runs/33747169515), `232 file(s) … (3326/3326 tests passed)`) |

    **Promoting `db-tests` from advisory to Required is a branch-protection change and the founder's
    call, not a documentation update** — recorded as met-and-pending, not auto-applied. Two defects worth
    keeping on record from this reconciliation: (a) `OpportunityFeed.test.tsx` went red at `f692a30e`
    (2026-08-21) on a hardcoded `expires_at` literal rotting past the "present" date it assumed — fixed in
    `ca27d268` by deriving it from `formatISO(addDays(new Date(), 7))`, not a regression in the code under
    test; (b) Session 29-D's D12 CI run caught `ApprovalsInbox.tsx` using a raw `.toISOString()` (banned,
    CLAUDE.md's date rule) in D4's reschedule handler — fixed before merge, full detail in ADR 0022 §20.5.
    Full tally detail: `docs/decisions/0015-test-execution-and-ci-gates.md` §5.
  - **Merge-gate enforcement (Session 22-D):** GitHub ruleset `master-app-tests` (id `19038239`) is live on
    `refs/heads/master`, requiring `app-tests` with no bypass actors. `db-tests` is intentionally **not**
    in any ruleset yet — it stays advisory until the tally above reaches 3/3, at which point the ruleset is
    updated (not recreated) to add it.
  - **PR-only, demonstrated (Session 22-D re-review, NEW-6):** the ruleset enforces on **direct pushes to
    `master`**, not just PR merges — pushing the 22-D range straight to `master` was rejected with
    `GH013 … Required status check "app-tests" is expected`. Every future session lands via PR (open a
    branch, push it, `gh pr create`, let `app-tests` run, merge) — a direct `git push origin master` will
    bounce. See `docs/decisions/0015-test-execution-and-ci-gates.md` §5 for the verification command.
  - Full detail: `docs/decisions/0015-test-execution-and-ci-gates.md`,
    `docs/decisions/0014-seats-and-permissions-surface.md` (Amendment A).

- **Session 21 CLOSED — Seats & Permissions, end to end (ADR 0013 Rev B + ADR 0014):**
  Three sub-sessions (21A, 21B, 21C), each build → review → correction, took multi-tenant permissions
  from a locked DB model to a usable multi-member product.
  - **DB-enforced permission model (21A, ADR 0013 Rev B):** `business_members` table; two-axis
    role×`is_admin` model; `user_can(business_id, capability)` DEFINER helper as the single oracle every
    check ultimately calls; DB-enforced seat cap (`plan_max_seats()` + `enforce_seat_cap` trigger, not an
    app-layer echo); `accept_invite` DEFINER RPC (email-match + DB-side expiry); owner-membership
    provisioning (M7 backfill + `ensure_owner_membership` AFTER INSERT trigger, 21A-D/D1).
  - **Membership resolver + member-lockout fix (21B, ADR 0014 §2):** `businesses_select_own` widened
    SELECT-only to the `get_user_business_ids()` pattern (the one RLS delta 0014 permits, L-1a);
    `getBusinessForUser(client, userId, preferredBusinessId?)` resolves owner ∪ active membership,
    deterministic pick (owned wins); ~25 dashboard call sites migrated off the owner-only
    `getBusinessByOwner`; the login/onboarding redirect made ownership-scoped, closing the bug where a
    pure member was bounced to `/onboarding` on every login.
  - **Invite email + accept flow (21B, ADR 0014 §3–§4):** `team-invite` `EmailKind` through the existing
    Resend outbox; `/invite/accept?token=` route (app-side HMAC verify → `accept_invite` RPC); sign-up
    email pre-filled + locked to the invited address; anti-enumeration accept copy (mirrors 18B); resend
    re-issues a fresh token on the same reserved row (no seat double-count).
  - **`/settings/team` + seat meter + overage UX (21B, ADR 0014 §5, §8):** member list, invite form,
    inline-confirm role change, soft revoke/remove (explicit dialog), seat meter across
    Normal/Unlimited/At-cap/Overage-locked states with distinct CTAs (overage explicitly does NOT say
    "upgrade" — the fix is removing members, not paying more).
  - **Capability-gate retrofit (21B, ADR 0014 §6–§7):** `useCan`/`canServer` echoes of `user_can` across
    calendar/campaign/connect/billing surfaces (hide by default; disable-with-tooltip only where absence
    would confuse, chiefly the Approve control an editor can see but not use); the connect/disconnect
    route handlers gained an authoritative app-layer `user_can` gate (they run service-role and bypass
    RLS, so the RLS predicate alone is defense-in-depth only).
  - **Approver quick-approve inbox (21C, ADR 0014 §9):** `/approvals`, role-gated to approver + admin;
    single + batch approve wired to the existing `approvePostAction`/`bulkApprovePostsAction`/
    `skipPostAction` (no new authorization surface); campaign + platform filters; edit-then-approve kept
    as two explicit steps (editing an approved post still reverts it to draft, ADR 0012). 21C correction
    pass (E1–E3): bulk approve now disables while a platform filter is active so the button's count
    always matches what the DB acts on (M1 — a control that said 2 and did 5 broke human-in-the-loop
    itself, though authorization was never actually bypassed); Skip-label contrast fixed to the WCAG-AA
    floor in both themes (m2); an honesty overflow notice ("Showing the first N of total") added for the
    200-row `APPROVALS_POST_LIMIT` cap, without building real pagination (m1); stale nav comment corrected
    (n1).
  - Full section-by-section detail: `docs/decisions/0013-seats-and-permissions.md`,
    `docs/decisions/0014-seats-and-permissions-surface.md`, `docs/reviews/session-21a-reviewer.md`,
    `docs/reviews/0014-21b-surface-review.md`, `docs/reviews/0014-21c-approvals-review.md`.

- **Session 21B (Architect phase) complete — ADR 0014 authored (Seats & Permissions: Flow & Surface):**
  `docs/decisions/0014-seats-and-permissions-surface.md` (§0–§13) turns the 21A DB-enforced backend
  spine (ADR 0013 Rev B) into a usable multi-member product. Fully specifies 21B (membership-aware
  resolver, invite email, `/invite/accept`, `/settings/team`, capability-gate retrofit affordance
  map, connect/disconnect app-layer gate, overage-lock UX) and defines 21C contracts (approver
  quick-approve inbox, reusing the existing `approvePostAction`/`skipPostAction`/
  `bulkApprovePostsAction` Server Actions unchanged).
  - **L-1a RLS carve-out (founder-adjudicated):** one permitted SELECT-only widening of
    `businesses_select_own` to the `get_user_business_ids()` pattern (§2.1, `RES-BIZ-SELECT-WIDEN`) —
    the only RLS delta 0014 allows; fixes a latent 21A parent/child asymmetry (every child table was
    widened in 21A, `businesses` itself was not).
  - **New resolver contract:** `getBusinessForUser(client, userId, preferredBusinessId?)` (§2.2) —
    deterministic pick (owned business wins, else earliest active membership); `preferredBusinessId`
    is a Phase-2 switcher seam only, no persistence shipped this ADR. `getBusinessByOwner` is kept
    for service-role owner-only paths.
  - **Login/onboarding member-lockout closed in the ADR itself (§2.4):** caught during orientation —
    a pure member resolves `null` through the owner-only resolver and gets redirected to
    `/onboarding` on every login. Amended with the ownership-scoped redirect
    (`RES-LOGIN-MEMBER-NO-LOCKOUT`, `RES-ONBOARDING-OWNER-SCOPED`), later reconfirmed against the
    live repo in the 21B-prep grounding pass below.
  - `team-invite` EmailKind design (existing `enqueueEmail` outbox, `signInviteToken`, re-issue-safe
    `dedupe_token` so resend actually sends); anti-enumeration accept copy; app-layer `user_can` gate
    added to the connect/disconnect route handlers.
  - **Open discrepancy, unresolved:** `docs/build-guide/session-21bc.md`'s locked ledger still states
    L-1 as "no RLS-policy body change" with no L-1a carve-out recorded in the Locked section, while
    ADR §2.1 and the Builder-instructions block both assume L-1a is in force. Needs founder
    reconciliation before B1 touches the RLS policy.
  - Architect-role session: ADR only, no `.ts`/`.sql` written. Unreviewed — the build-guide's
    Reviewer session (§3) is next, though the grounding pass below has already re-verified the ADR's
    factual premises against the live repo.

- **Session 21B-prep complete — ADR 0014 grounding (B1 pre-check):**
  ADR 0014 (Seats & Permissions: Flow & Surface) was authored in the Session 21B Architect
  phase, building on the locked ADR 0013 Rev B model. Before Builder work began, six grounding
  facts the ADR depends on were re-verified against the live repo: (1) `businesses_select_own`'s
  RLS asymmetry confirmed, and confirmed as the *only* parent-table SELECT policy still keyed on
  `owner_id` directly rather than `get_user_business_ids()`; (2) the `login/actions.ts` /
  `layout.tsx` member-lockout gap (owner-only `getBusinessByOwner` resolver + unconditional
  onboarding redirect) confirmed exactly as ADR §2.4 describes; (3) the email-outbox shape
  (`enqueueEmail`, `EmailKind` union, `TEMPLATES` registry, ADR-0008 §17 log fields) confirmed
  compatible with a new `team-invite` kind, zero mechanism changes needed; (4) the existing
  `approvePostAction` / `skipPostAction` / `bulkApprovePostsAction` Server Actions confirmed as
  the exact names 21C reuses unchanged; (5) `signInviteToken`/`verifyInviteToken`
  (`lib/members/invite-token.ts`) and `accept_invite(p_member_id, p_business_id)`'s signature
  confirmed; (6) no email-confirmation gate before session establishment confirmed
  (`supabase/config.toml` — `enable_confirmations = false`). No STOP conditions found; no code
  written this session. B1 (the §2.1 RLS migration + `getBusinessForUser` resolver) is next.

- **Session 21A complete — Seats & Permissions (ADR 0013 Rev B) shipped:**
  - **21A-B1–B8:** `business_members` table + CHECK constraints + partial unique indexes; `get_user_business_ids()` widened to owner ∪ active members; `user_can(business_id, capability)` DEFINER helper; DB-enforced seat cap (`plan_max_seats` + `enforce_seat_cap` trigger); role-aware `posts`/`campaigns`/`social_accounts` write policies; `accept_invite` DEFINER RPC (email-match + DB expiry + double-membership pre-check); M7 owner backfill for pre-existing businesses; `purge_business` explicit member erasure.
  - **21A-D correction pass:**
    - **D1 (MAJOR-1):** `ensure_owner_membership` AFTER INSERT DEFINER trigger (M9) — closes the go-forward gap M7 couldn't (M7 only covered businesses that existed when it ran); fixture ripple fixed across 3 test files; dedicated regression suite added.
    - **D2 (MAJOR-2 + MINORs):** read-blast-radius matrix widened to `campaigns`/`social_accounts`/`post_metrics`; RLS USING/WITH CHECK-per-command coverage; invited-row visibility test; third-party accept_invite replay test; seat-cap rejection via genuine authenticated admin path; `transfer_ownership` unknown-capability test; status CHECK 4th-value rejection test.
    - **D3 (NITs + close-out):** stale ADR 0010 comment corrected; CLAUDE.md `any` carve-out documented for `supabase/__tests__` admin clients; this close-out.
  - Test-only D2/D3 changes; no schema/logic change beyond D1's single trigger.
  - Full finding-by-finding resolution mapping: `docs/reviews/session-21a-reviewer.md` → **Resolution Log (21A-D)** section.

- **Session 20 complete — Content Calendar (ADR 0012 Rev B) shipped:**
  - **20B (BP1–BP7) — data layer + UI:** migration adding an indexed `scheduled_at` and the
    new `20260701210000_reschedule_posts_batch.sql` atomic RPC; `lib/calendar/types.ts`
    (canonical `CalendarPostRow` / `CalendarPostMetrics` / `CampaignDayCell`); `lib/db/posts.ts`
    (`listPostsForCalendar`, `reschedulePost`, `reschedulePostsBatch`); `lib/calendar/group.ts`
    (`groupByCampaignDay`); `lib/calendar/drag.ts` (`isDayDroppable`, `moveBoxOptimistically`,
    `getTodayKeyInTz`, `formatDayKeyForLocale`); month-grid split-pane UI (`CalendarView`,
    `MonthGrid`, `DayCell`, `CampaignDayBox`, `PostDayPanel`, `PostRow`); dnd-kit
    drag-to-reschedule with full keyboard support; WCAG AA 8-hue CVD-safe campaign palette;
    `i18n/{en,pt,es}/calendar.json`.
  - **20C — Reviewer audit:** tiered BLOCKER/MAJOR/MINOR/NIT findings report against ADR 0012
    Rev B (`docs/reviews/0012-content-calendar-review.md`).
  - **20D-1:** Cleared the enforced ESLint gate — all raw `.toISOString()` calls routed through
    `toUtcIso()` (11 sites); fixed a UTC-vs-business-tz "today" bug (`getTodayKeyInTz` replaces
    a UTC-based `getTodayKey`); replaced a `react-hooks/set-state-in-effect`-violating
    `useEffect` with the render-time state-adjustment pattern.
  - **20D-2:** Group reschedule rewritten from a per-post `await` loop to ONE atomic
    `reschedule_posts_batch` SECURITY INVOKER RPC; `reschedulePostsBatch()` wrapper added to
    `lib/db/posts.ts`; security-reviewer confirmed RLS still gates every row independent of the
    RPC (no service-role, no privilege escalation).
  - **20D-3:** Collapsed duplicated `CalendarPostRow`/`CalendarPostMetrics` declarations to one
    source of truth (`lib/calendar/types.ts`, re-exported from `lib/db/posts.ts`); removed a
    double `as unknown as` cast on the calendar list-read; compile-time `expectTypeOf` identity
    test added so the two copies can't silently diverge again.
  - **20D-4 — a11y + UI corrections:** `CampaignDayBox`'s dnd-kit `KeyboardSensor` was shadowing
    Space/Enter on the box itself, blocking keyboard users from opening the pane on exactly the
    actionable (movable) boxes — split into a dedicated small drag-handle button (grip glyph,
    own aria-label) carrying the drag activator, while the box's own Enter/Space opens the pane
    (a real double-activation bug from keydown bubbling was caught by the test suite and fixed
    via an `e.target !== e.currentTarget` guard); `PostRow`'s Edit button gated to
    `draft`/`approved` only (was also showing for failed/skipped, where the edit silently
    no-ops); `CampaignDayBox` aria-label now reads a localized long-form date instead of the raw
    ISO day key; redundant `!allSkipped` guard dropped from `showDraftBadge`.
  - **20D-5 — observability + defense-in-depth hardening:** three canonical id-only JSON log
    lines (`reschedule_post`, `reschedule_group`, `reschedule_rejected{reason}`) emitted from the
    calendar Server Actions, with `Sentry.captureException` (id-only tags, no content/PII) on
    unexpected errors; `approvePost` gained an optional `businessId` belt-and-suspenders
    predicate matching `reschedulePost`'s posture (calendar wrapper passes it; the pre-existing
    `campaigns/[id]/posts` caller is unaffected and still fully RLS-gated);
    `buildPlatformPostUrl` wraps `platformPostId` in `encodeURIComponent()`, closing a
    URL-injection vector. security-reviewer confirmed all three changes clean.
  - Single-post creation from the calendar toolbar ("New post") stays deferred — inline
    coming-soon message, `CREATE_POST_DISABLED` constant — not part of this session's scope.
  - Full scoped suite: 659 tests passing (`lib/db lib/social lib/validation lib/calendar
    components/calendar app/[locale]/(dashboard)/calendar`); tsc clean (SOSH files); ESLint clean.

- **Session 19D-5 STOPPED — MAJOR #3: §7 BP9 read path needs ADR 0011 amendment:**
  The `SocialProvider` interface (`lib/social/types.ts`) has no `fetchRecentPosts` / `listRecentPosts` method — only OAuth, publish, fetchPostMetrics (single post), fetchEngagement (comments/DMs). ADR §7 specifies fetching via the SocialProvider read surface, but that surface does not expose recent posts. Stopped per STOP CONDITION; did not substitute silently. Decision needed: add a `fetchRecentPosts` method to `SocialProvider` + implement in `PostizProvider`/`MockProvider` (ADR 0002 amendment), or amend ADR 0011 §7 to ratify the local-posts read as intentional scope.

- **Session 19D-4 complete — MINOR #6 + #7: list revalidation + mobile sticky track:**
  - `app/[locale]/(dashboard)/settings/voice/actions.ts` — `revalidatePath('/[locale]/settings/voice', 'page')` added after each successful mutation in `addVariationAction`, `renameVariationAction`, `updateVariationAxesAction`, `deleteVariationAction`
  - `components/voice/VoiceEditor.tsx` — `trackExpanded` state added; right pane becomes `sticky bottom-0 z-10 bg-background border-t border-border` on mobile; toggle button (`lg:hidden`) shows/hides tracks with chevron indicator; track panel uses `hidden lg:block` pattern (always visible on desktop)
  - `i18n/{en,pt,es}/common.json` — `voiceEditor.tracks_toggle_show` / `voiceEditor.tracks_toggle_hide` added in all 3 locales
  - Tests: `settings/voice/actions.test.ts` — 4 revalidatePath assertions (one per action) + 1 no-call-on-error; `components/voice/VoiceEditor.test.ts` (new) — 5 i18n contract tests verifying toggle keys present + distinct + consistent across all 3 locales

- **Session 19D-3 complete — MINOR #5 + #8: data-layer + logging hygiene:**
  - `lib/validation/voice.ts` — `VOICE_VARIATION_CAP = 5` exported (single source for the RPC-enforced cap)
  - `lib/db/voice.ts` — `createVoiceVariation` returns `(data as BrandVoiceVariationRow[])[0]` (unwraps PostgREST SETOF array); `listVariations` adds `.limit(VOICE_VARIATION_CAP)` per CLAUDE.md bounded-query rule
  - `app/[locale]/(dashboard)/onboarding/infer-brand-voice/actions.ts` — `console.error` removed
  - Tests: `lib/db/voice.test.ts` — mocks updated to return arrays for RPC calls; new scalar-access assertion; new bounded-query assertion

- **Session 19D-2 complete — MAJOR #2: base-voice write validation + shared axis guard (MINOR #4):**
  - `lib/validation/voice.ts` — `voiceAxesCoerceSchema` (FormData-safe coerce variant) + `voicePayloadSchema` (full payload: axes + tone + keywords + avoidWords, word arrays max 20×100chars) exported
  - `app/[locale]/(dashboard)/onboarding/step-2/actions.ts` — `saveVoiceAxesAction` now validates via `voiceAxesCoerceSchema` before `upsertBrandVoice`; returns structured `SaveVoiceAxesResult` with `error: 'validation' | 'generic'` instead of silently swallowing
  - `app/[locale]/(dashboard)/settings/voice/actions.ts` — `saveBaseVoiceAction` validates via `voicePayloadSchema.safeParse`; returns `{ error: 'validation' }` on bad axes; local `AXIS_KEYS` + `parseVoiceAxes` helper imports `voiceAxesCoerceSchema` from shared module
  - `components/voice/VoiceEditor.tsx` — `onSave` callback return type relaxed to `void | Promise<unknown>` to accept `SaveBaseVoiceResult`
  - Tests: `lib/validation/voice.test.ts`, `step-2/actions.test.ts`, `settings/voice/actions.test.ts` updated

- **Session 19D-1 complete — §3.3 BLOCKER: cross-tenant voice_variation_id:**
  - `lib/db/voice.ts` — `getVariationForBusiness(client, id, businessId)` added; explicit `business_id` filter for service-role callers
  - `lib/ai/context.ts` — `buildCustomerContext` now calls `getVariationForBusiness(serviceClient, voiceVariationId, businessId)` instead of `getVariationById`; returns null cross-tenant (degrades to base voice)
  - `app/[locale]/(dashboard)/campaigns/new/actions.ts` — write-time ownership guard added; `createCampaignAction` validates `voice_variation_id` belongs to the business via RLS-scoped `getVariationForBusiness`; rejects cross-tenant UUID before INSERT
  - Tests: `lib/ai/context.test.ts` + `campaigns/new/actions.test.ts` — cross-tenant rejection test cases added; all passing

- **Session 19C — Reviewer audit (ADR 0011 Rev B):**
  8 findings across schema, security, editor UI, and TypeScript hygiene. Core spine verified clean (D-A, D-B, D-E, R1–R5, L-3/L-4/L-6/L-7/L-8/L-9, §4, §5, §6, §13).
  | # | Tier | Finding |
  |---|------|---------|
  | 1 | BLOCKER | §3.3 — `voice_variation_id` not tenant-validated at write; resolved under service-role |
  | 2 | MAJOR | §3.1 — base-voice writes skip shared Zod guard; one swallows error silently |
  | 3 | MAJOR | §7 (BP9) — refine reads local `posts` table, not SocialProvider read surface |
  | 4 | MINOR | §3.1 — variation actions duplicate axis schema locally |
  | 5 | MINOR | §3.4 — `createVoiceVariation` casts `SETOF` array → single row (latent) |
  | 6 | MINOR | §8/UI — variation mutations lack `revalidatePath` |
  | 7 | MINOR | §9 — L-13 mobile track not sticky/collapsible |
  | 8 | MINOR | x-cut — `console.error` in `inferBrandVoiceAction`; `listVariations` missing `limit` |

- **Session 19B complete — Voice Model: ADR 0011 Rev B (BP1–BP9):**
  - **BP1:** `supabase/migrations/…_voice_model.sql` — `brand_voices.voice_axes jsonb NOT NULL` with 7-key structural CHECK (jsonb_typeof + 0–100 range); `brand_voice_variations` table (id, business_id, name, voice_axes, timestamps); `create_voice_variation` SECURITY DEFINER RPC with row-locking cap-5 guard + `RAISE EXCEPTION 'voice_variation_cap_reached'`; RLS SELECT/INSERT/UPDATE/DELETE on both tables (USING + WITH CHECK pattern); cascade row documented per ADR 0010 Amd 2 §D2.5
  - **BP2:** `lib/voice/translate.ts` — pure in-process translation (zero API calls); band thresholds ≤30/31–69/≥70 per §4.2; grouped 3-clause descriptor (register / stance+reach / energy+emotion); article() helper; all-neutral path returns ADR-locked string; determinism asserted by test
  - **BP3:** `lib/voice/calibration.ts` — `CALIBRATION_BANK` (6 questions, 4 options each); divergence-proportional delta rule (k = clamp(0.15 + 0.30·|gap|/100, 0.15, 0.45)); untargeted axes untouched; all 24 option vectors match ADR §6.2 exactly
  - **BP4:** `lib/voice/editor-state.ts` — `VoiceEditorState` machine; `isLocked`/`isFinalStep`/`currentQuestion`/`answerQuestion`/`manuallyAdjustAxes`/`setKeywords`/`setAvoidWords`/`buildSavePayload`; `manuallyAdjustAxes` throws while locked; `NEUTRAL_VOICE_AXES` exported from `lib/validation/voice.ts`
  - **BP5:** `lib/voice/variations.ts` — `suggestVariations` (5 deterministic presets: Bolder/Buttoned-up/Warmer/Sharper/Thought leader per §8.1, absolute vectors, 0–100 clamp, name-collision filter); `lib/db/voice.ts` — `addVariation`, `renameVariation`, `listVariations`, `updateVariationAxes`, `getVariationById`, `deleteVariation`; `VoiceVariationCapError` typed error class
  - **BP6:** `components/voice/AxisTrack.tsx` — pole-labels only (no numbers, L-6); read-only while locked (L-8); `components/voice/VoiceEditor.tsx` — two-pane editor (questions-first, L-13 partial); calibration Q&A flow with axis highlight on answer; word-tag inputs (keywords/avoid_words) at final step (L-7); `components/voice/VariationManager.tsx` — variation list with add/rename/delete
  - **BP7:** Campaign `voice_variation_id` wiring — `createCampaignSchema` extended; `buildCustomerContext` swaps variation `voice_axes` + recomputes descriptor when set; `CampaignForm` lists business variations; new campaign page fetches variations via RLS client
  - **BP8:** Teardown — old tone-pills/voice-prose form replaced by `<VoiceEditor>`; `saveStep2Action` removed; `Step2Form` delegates to `VoiceEditor`; `step-2/actions.ts` now exposes only `saveVoiceAxesAction` + `getBrandVoiceAction`; exactly one editor, two mounts (onboarding + settings); no generation path reads `brand_voices.tone`
  - **BP9:** `refineFromPostsAction` — reuses `brandVoiceInferencePrompt` (no new counter); gated on connected accounts + local post texts (≤3); severable (nothing in BP1–BP8 imports it)
  - i18n EN/PT/ES — `voiceEditor.*` keys (question_count, keywords_label/hint/placeholder, avoid_label/hint/placeholder, save, saving, tracks_hint)
  - Test suites: `lib/voice/` (translate, calibration, variations, editor-state), `lib/db/voice.test.ts`, `lib/validation/voice.test.ts`, `lib/ai/context.test.ts`

- **Session 18B-5D complete — Correction pass (CI fixes):**
  - B1: 15 email template snapshots regenerated after 13 px → 14 px footer fix. Committed `a31423b`.
  - B2: Duplicate `toUtcIso` in `lib/db/utils.ts` removed; canonical `@/lib/utils` import used across `businesses.ts`, `campaigns.ts`, `posts.ts`. Committed `1fd98c5`.
  - B3: `STRIPE_CLIENT_INTERNALS_BAN` ESLint rule updated — `allowTypeImports: true`, billing Server Action exception block, `typeof window` guard in `lib/stripe/checkout.ts`. Committed `77e2e34`.
  - M1 (B18-009): CLAUDE.md `any`-escape-hatch carve-out wording corrected (describes `eslint-disable-next-line` comments, not `as unknown as` casts). Committed `90fc652`.
  - Triage backfill: B18-001/002/009/031/045/072/073/081/084/085 closed; B18-005/006/043 N/A-verified; B18-064 CVE evidence recorded; B18-089 filed. Committed `dab1791`.
  - Bonus: pre-existing test typo `ab_live_` → `sk_live_` in `orchestrator.test.ts:636` fixed. Committed `afa60f6`.
  - Final CI: `npx tsc --noEmit --skipLibCheck` → 0 errors; scoped vitest → **1071 passed / 0 failed**.

- **Session 18B-5 complete — Docs + remaining P1-CHEAP cleanup:**
  - B18-001: `'suppressed'` added to `EmailProviderErrorCode` union (`lib/email/errors.ts`).
  - B18-002: Email footer `13px → 14px` (`lib/email/templates/_layout.tsx`, WCAG 1.4.4); snapshots fixed in 18B-5D.
  - B18-004: `marketing.layout.skipToContent` i18n key wired in EN/PT/ES; layout made `async` with `getTranslations`.
  - B18-026: ADR 0002 open-follow-up note for `OAuthAuthorizeInput` 2-extra-fields drift.
  - B18-031: `fetch_failed` dead enum value removed from `AiErrorCode`.
  - B18-034: Silent `catch {}` blocks in OAuth callback replaced with `Sentry.captureException` (5 sites).
  - B18-045: Launch-checklist §1 expanded from grouped row to per-var tunable rows matching `lib/config.ts`.
  - B18-046: `authToken: process.env.SENTRY_AUTH_TOKEN` passed explicitly in `next.config.ts`.
  - B18-066: No-accounts banner dismissal switched `sessionStorage → localStorage`.
  - B18-072: `VALID_TRANSITIONS` JSDoc updated (documents why `unapprove`/`unskip` bypass the map).
  - B18-073: Redundant re-sort removed from `PostsClient` (server already sorts by `scheduled_at`).
  - B18-081: `STRIPE_CLIENT_INTERNALS_BAN` ESLint rule added; refined in 18B-5D.
  - B18-084: `Sentry.withMonitor` wrapper removed from `runJanitorTick` (no declared schedule).
  - B18-085 (partial → B18-089): `toUtcIso` duplicate collapsed in 18B-5D; full `formatISO` sweep deferred as B18-089 (P2).

- **Session 18B-4D complete — Documentation + dead-key pass (zero behavioural change):**
  - M1: Missing `/resend-confirmation` locale keys backfilled in EN/PT/ES `common.json`.
  - L1: Orphaned `unconfirmedEmail` i18n keys removed from all three `auth.json` files.

- **Session 18B-4 complete — Auth oracle + middleware rename:**
  - B18-060 (Option 3): Login enumeration oracle closed. All `signInWithPassword` failures return generic `errors.login.invalid`. `unconfirmedEmail` state removed; login page shows resend-confirmation link unconditionally. New `/resend-confirmation` route mirrors `forgot-password` anti-enumeration posture. `proxy.ts` updated: `'resend-confirmation'` added to `AuthAction`, `RATE_LIMITS`, `PUBLIC_SEGMENTS`.
  - B18-025: `middleware.ts` → `proxy.ts` (Next.js 16 convention). Export renamed `middleware → proxy`. Behaviour byte-identical. Launch-checklist §8 grep commands updated.
  - B18-086 (signup oracle) + B18-087 (confirmation redirect env parity): filed as P2 triage items.

- **Session 18B-3D complete — Correction pass on 18B-3:**
  - H1: Pattern-matched `getErrorMessage` sweep — replaced aliased casts in `lib/db/businesses.ts`, `lib/db/posts.ts` (×2), `lib/ai/metrics.ts` (×2).
  - H2: Unsound `result.error as '...'` cast in `RegenerateDialog.tsx:51` removed; replaced with `regenerateErrorKey()` switch.
  - M4: Unit tests added for `getErrorMessage` (5 cases) and `parseAiGenerationMetadata` (4 cases) in `lib/db/utils.test.ts`.
  - L2 → B18-089: `formatISO(new Date())` local-offset strings filed as new triage item (P2).

- **Session 18B-3 complete — Type-quality cross-cutting sweeps:**
  - B18-041: 8 production `toISOString()` sites replaced with `toUtcIso()` wrapper; ESLint `no-restricted-properties` ban added.
  - B18-030: `getErrorMessage(error: unknown): string` helper extracted to `lib/utils.ts`; all `(error as Error).message` casts in `lib/db/` replaced.
  - B18-010: Hardcoded plan-limit integers replaced with `getPlanCapabilities()` reads in `lib/campaigns/enforcement.ts` and adjacent files.
  - B18-069: Unsound `post.status as …` cast removed from `PostCard`.
  - B18-070: `PostActionErrorCode` named union defined; `PostActionState.error` retyped.
  - B18-071: `parseAiGenerationMetadata` narrow-parse helper added to `lib/db/utils.ts`; two call sites updated.

- **Session 18B-2D complete — Correction pass on 18B-2 (M1–M4):**
  - M1: `activateCampaign` atomic guard rejection emits structured warn log + Sentry breadcrumb.
  - M2: `publishPostComplete` guard rejections emit structured warn log at both sites in `lib/publishing/orchestrator.ts`.
  - M3: Zero-row negative test added for `transitionEmailOutboxRow` wrong-source-status path.
  - M4: Hex over-redaction trade-off documented above `VALUE_PATTERNS` in `lib/observability/sentry-scrub.ts`.

- **Session 18B-2 complete — Atomic-transition + small security batch:**
  - B18-075: `publish_complete` single-statement RPC migration; `markPostPublished` / `requeueScheduledPost` rewritten to call it.
  - B18-003: `transitionEmailOutboxRow` atomic `WHERE id AND WHERE status` guard added.
  - B18-040: `updateCampaign` in `generate.ts` step 10 given atomic `WHERE status='draft'` guard.
  - B18-029: 10 CIDR ranges added to SSRF block-list (link-local, CGNAT, Class E, TEST-NET-1/2/3, benchmark, IPv6 ULA/link-local/documentation); one unit test per range.
  - B18-062: `isSafeRedirect` now recursively `decodeURIComponent` (max 3 iterations) before allow-list validation.
  - B18-061: `canonicalizeEmail(input)` helper added to `lib/auth/email.ts`; wired into signup, login, password-reset, resend-confirmation.
  - B18-076: Value-scan pass added to token redactor — email, JWT, Stripe `sk_(live|test)_`, long hex (32+ chars).
  - B18-008: All Sentry paths confirmed flowing through extended redactor; closed via B18-076 coverage.

- **Session 18B-1 complete — GDPR 30-day hard-delete cron (ADR 0010 Amendment 2 §D2.1–D2.10):**
  - Migration `20260615200000_deletion_cron_state_machine.sql` — D2.1 schema delta on `business_deletion_requests`
    (status/attempts/next_attempt_at/last_error/updated_at columns, updated_at trigger, claimable index,
    FK decoupled so audit row survives purge), D2.3 `claim_deletion_requests(int,int,int)` RPC
    (FOR UPDATE SKIP LOCKED, service_role-only), D2.4 `purge_business(uuid)` RPC (idempotency guard,
    vault-first delete via `vault_delete_secret`, billing_events redaction, root DELETE FROM businesses)
  - `lib/config.ts` — three new server vars: `DELETION_RETENTION_DAYS=30`, `DELETION_MAX_ATTEMPTS=5`,
    `DELETION_RETRY_BACKOFF_BASE_MINUTES=60` (Zod-coerced, env-configurable, serverOnly guarded)
  - `lib/db/deletion-requests.ts` — typed query helpers: `claimDeletionRequests`, `transitionDeletionRequest`
    (atomic `.eq('status','processing')` guard), `purgeBusiness`, `getBusinessOwnerId`, `countRemainingBusinesses`
  - `lib/deletion/orchestrator.ts` — `runDeletionTick({ triggeredBy })` + exported `computeBackoff`
    (base MINUTES, exp growth, 0.75–1.25× jitter, cap 1440); lazy `createServiceRoleClient` import;
    Sentry.withMonitor('process-deletions', ..., `{ schedule:{type:'crontab',value:'0 3 * * *'}, ... }`);
    D2.7 auth-delete ordering (read ownerId BEFORE purge); multi-business guard; D2.8 failure taxonomy
    (SQLSTATE class 23 → abandon; exhausted → abandon; transient → retry); structured console.log tick logs
  - `app/api/cron/process-deletions/route.ts` — POST-only QStash route (mirrors drain-email-outbox),
    `maxDuration=60`, returns `NextResponse.json({ ok: true, ...summary })`
  - `lib/deletion/orchestrator.test.ts` — 14 unit tests: `vi.hoisted` pattern for auth.admin mock,
    empty queue, happy path, idempotent replay, multi-business guard, permanent SQLSTATE, transient
    retry, attempts-exhausted, auth-delete failure, mixed batch, tick-start/end logs, Sentry.withMonitor
  - `lib/deletion/__integration__/purge-business.test.ts` — gated on `DELETION_INTEGRATION_TEST_ENABLED`;
    tests purge metadata, idempotency, audit-row survival
  - `supabase/__tests__/rls-policy-lockdown.test.ts` — `pg.Client` RLS audit: RLS enabled,
    SELECT policy shape, no authenticated mutate policies, `= ANY` (not `IN` subquery), grant lockdown
  - Pre-existing bug fixed: `= ANY (public.get_user_business_ids())` in `email_outbox.sql` and
    `business_deletion_requests.sql` (was `IN (SELECT get_user_business_ids())` — wrong operator on uuid[])
  - QStash runbook Step 2b added (`0 3 * * *`, retries=0 rationale); launch-checklist A1.4 ticked ✅

- **Session 17B complete — Legal Surface (ADR 0010 + Amendment A1):**
  - `content/legal/terms.en.mdx` — full Terms of Service prose from ADR 0010 §12 with A1 deltas
    applied (A1.1: §9 direct LinkedIn/X API wording; A1.3: §18 end-of-billing-period termination remedy)
  - `content/legal/privacy.en.mdx` — full Privacy Policy from ADR 0010 §13 with A1 deltas
    (A1.2 Path A: no AI training row, no Art. 7(3) bullet; A1.7: DPF explicit cite;
    A1.8: email webhook events bullet; A1.9: security@sosh.app; §8 erasure → email-based override)
  - `content/legal/subprocessors.en.mdx` — Subprocessors list from ADR 0010 §14 with A1 deltas
    (A1.1: no Postiz row; A1.7: Anthropic "US (EU-US DPF)"; A1.11: Svix client-verify note;
    A1.3: end-of-billing-period sub-processor change remedy)
  - All three MDX files carry `evidenceRef: "5f7a2e4"` frontmatter locking to Evidence Pack commit
  - `[LEGAL ENTITY]` placeholder deliberately retained — gated on counsel ratification (ADR §16)
  - `app/[locale]/(marketing)/subprocessors/page.tsx` — new route mirroring terms/privacy pattern
  - `components/marketing/LegalPage.tsx` extended for `'subprocessors'` slug
  - `lib/marketing/metadata.ts` — `MarketingRoute` + `ROUTE_PATHS` extended with `subprocessors`
  - `app/sitemap.ts` — `/subprocessors` added (priority 0.3, changeFrequency yearly)
  - `i18n/en/marketing.json` — `footer.link_subprocessors`, `meta.subprocessors_title`, `og.subprocessors`
  - `i18n/pt/marketing.json` + `i18n/es/marketing.json` — same keys with `_todo` sentinel (ADR 0009 §10)
  - `components/marketing/MarketingFooter.tsx` — legal column: Terms → Subprocessors → Privacy
  - `supabase/migrations/20260614021500_business_deletion_requests.sql` — TABLE + RLS SELECT policy;
    cron/UI/TTL purge deferred to backlog per session hard constraints
  - `lib/db/social-accounts.ts` — two silent `catch {}` blocks replaced with
    `captureException(err, { tags: { operation: 'vault_delete_secret' } })` from `@sentry/nextjs`
  - `docs/launch-checklist.md` §9 — A1 gate items fully expanded (A1.2 Path A, A1.4 deletion jobs ×4,
    A1.7 DPF gate, A1.10 cookie inventory, A1.11 Svix client-verify, §16 entity gate)
  - `CLAUDE.md` — "Legal pages" section added (evidenceRef rule + [LEGAL ENTITY] gate)
  - 5 commits: `5747873` (MDX), `6bcfc67` (migration), `756b76a` (route+i18n+footer),
    `aed2f8e` (Sentry), `223a23c` (checklist)
  - Backlog: 30-day purge cron, in-app Delete Account flow, auth_rate_limits TTL purge,
    Amendment A2 to ADR 0010, PT/ES legal copy translations

- **Session 16 complete — Landing Page & Positioning (ADR 0009 + Amendments A1, A2):**
  - Five public routes (`/`, `/pricing`, `/terms`, `/privacy`, `/og`) across en/pt/es in the `(marketing)` route group; MarketingHeader, MarketingFooter, LocaleSwitcher; §3.4 path change (`/` is canonical homepage)
  - Locked EN copy namespace (`i18n/en/marketing.json` verbatim from ADR §6); PT/ES EN-fallback + `_todo` sentinel per §10 wart; `marketing.hero` placeholder removed from common.json
  - Shared no-props `<PricingCards />` + `<PricingFaq />` (native `<details>`/`<summary>`); `pricingFeatureRows` in `lib/stripe/plan.ts` — zero price drift possible
  - MDX legal stubs (§6.15 sentence only); Edge OG ImageResponse route (Stone hex, 1200×630); root `app/sitemap.ts` (12 URLs, 4 routes × 3 locales with `alternates.languages`); `app/robots.ts`
  - **Amendment A1 (2026-06-12):** CSS-only motion migration — Framer Motion uninstalled; IntersectionObserver + `@starting-style` + single `@media (prefers-reduced-motion: no-preference)` block in `globals.css`; `MotionProviders.tsx` and `motion.ts` deleted
  - **Amendment A2 (2026-06-13):** ADR documentation corrections — §3.1 sitemap path and §5.3 button variant aligned to implementation; no code changes
  - Reviewer audit: 0 BLOCKERs, 0 MAJORs; MINOR-2 corrected (ADR §3.1 diagram); MINOR-3 resolved (redundant `matchMedia` JS guard removed from `Section.tsx`); MINOR-1 deferred → backlog L-16-1; NIT-3 no-action (locale_label confirmed consumed in LocaleSwitcher)
  - Launch-checklist §11: 13 of 15 rows ticked; 2 perf/CWV rows blocked (Turbopack compilation succeeds; `npm run build` fails at TS check on pre-existing ECC Remotion error — route table not printed)
  - Tests: 426 passing, 0 failed; tsc clean (SOSH files)

- **Session 15D — Transactional Email correction pass (Reviewer findings):**
  - **L-01 / B-01** `eslint.config.mjs` — consolidated 4 sprawling blocks into 1 main block
    (all four bans: stripe, @anthropic-ai/sdk, lib/social internals, resend) + 4 narrow per-package
    override blocks with shared constants; B-01 regression test confirmed all 4 bans fire on
    `app/__test_fixtures__/boundary-probe.ts`.
  - **M-01** `lib/email/render.tsx` — widened try block to cover `getTranslations()` and
    `entry.subject()`; raw throws now become `EmailProviderError('template_render_failed', ...)`.
  - **M-02** `lib/config.ts` — `EMAIL_SENDING_STUCK_MINUTES` default corrected 15 → 10
    (aligns with ADR 0008 §15); `.env.local.example` comment updated.
  - **L-02** `lib/email/resend-provider.ts` — `parseRetryAfterHeader` now uses case-insensitive
    header key lookup via `Object.entries().find(k.toLowerCase())`.
  - **L-03** `docs/decisions/0008-transactional-email.md` — Amendment 1 §A9: verification
    sentence confirming Resend SDK v6 `Response<T>.headers` path is live.
  - **L-04** `lib/email/__integration__/round-trip.test.ts` — Zod schema tracking comment
    added near props literal.
  - **L-05** `docs/backlog.md` created — Pre-launch debt section; atomic WHERE guard in
    `transitionEmailOutboxRow` filed (email-outbox.ts not modified).
  - Full suite: 720 tests passed / 0 failed; tsc clean.

- **Session 15 — Transactional Email: drain orchestrator + integration test:**
  - `lib/email/orchestrator.ts` — `runEmailDrainTick`: SKIP LOCKED claim, per-row suppress/render/send,
    transient retry with `computeBackoff`, terminal failure, stuck-row reaper, one canonical log line
  - `lib/email/resend-provider.ts` — full Resend SDK integration: `send()`, `mapResendError`,
    `parseRetryAfterHeader` (delta-seconds + HTTP-date, capped at 3600 s), `mapNetworkError`
  - `lib/email/__tests__/orchestrator.test.ts` — 16 unit tests covering all drain behaviours
    (A9 Retry-After cap, provider_unavailable transient, unknown error → terminal + Sentry, mixed batch)
  - `lib/email/__integration__/round-trip.test.ts` — real-network test gated on `EMAIL_INTEGRATION_TEST_ENABLED`
  - `.env.local.example` — ADR 0008 block completed (RESEND_API_KEY, EMAIL_PROVIDER, tunables, gate var)
  - `docs/launch-checklist.md` §3 — drain-email-outbox smoke-test rows added
  - ADR 0008 Amendment 1 appended: A9 (Retry-After extraction + 3600 s cap) + D3 (event-type normalisation)
  - Full suite: 237 tests passed / 1 skipped / 0 failed; tsc clean.

- **Session 14D:** Transactional Email — correction pass (ADR 0008 Amendment 1):
  - **D2 (merge blocker):** Missing first-post-published email trigger added to the
    TOKEN_EXPIRED refresh-retry success path in `lib/publishing/orchestrator.ts`;
    `maybeEnqueueFirstPostPublished` helper extracted for both code paths.
  - **D3 (live blocker — retry storm):** Unknown Resend event types (e.g. `email.sent`)
    now normalised to `'other'` before DB insert in `recordWebhookEvent`; eliminates
    `23514` check-constraint → 500 → Resend retry loop.
  - **A9 (live blocker — backoff):** `Retry-After` header extracted from Resend 429 SDK
    response wrapper (`sdkResponse.headers`); `parseRetryAfterHeader` supports both
    delta-seconds and HTTP-date formats, capped at 3600 s; passed through
    `mapResendError` → `EmailProviderError.retryAfterSeconds` → `computeBackoff`.
    Exponential path also capped at 3600 s.
  - **K11 (docs):** `.env.local.example` completed with all 9 ADR 0008 email vars
    (`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_PROVIDER`, `EMAIL_FROM`,
    `EMAIL_REPLY_TO`, and 4 commented tunables).
  - Full verification: tsc clean, 46 test files / 692 tests passing, ESLint 0 errors.
  - ADR 0008 Amendment 1 filed at `docs/decisions/0008-transactional-email.md §A1`.

- **Session 14B:** Transactional Email B8 — enqueue wiring across three surfaces:
  - Stripe webhook: `after()` tail fires `enqueueWelcomeToPlan` on `checkout.session.completed`
    and `enqueuePaymentFailedCourtesy` on `invoice.payment_failed` (outcome=applied only)
  - Resend inbound webhook (`app/api/webhooks/resend/`): svix signature verification,
    idempotent event recording via `email_webhook_events`, bounce/complaint suppression upsert
  - Publishing worker: `incrementBusinessPublishedCount` RPC; `newCount === 1` fires
    `enqueueFirstPostPublished` in `after()` (race-free 0→1 detection)
  - ESLint `no-restricted-imports` on `stripe` resolved; `Stripe` type re-exported from
    `lib/stripe/webhook.ts`; 405 tests passing.

- **Session 14A:** Transactional Email — foundation (ADR 0008, DB migrations, data access layer,
  5 React Email templates EN/PT/ES, render orchestrator, enqueue facade, D3 suppression check,
  trial-warnings cron with T-3/T-1 dual-cadence, drain-email-outbox cron stub).

- **Session 13.5D:** Correction pass — both reviewer blockers resolved:
  - B7: `@upstash/qstash` pinned to exact version `2.11.0` (no caret) in package.json;
    lockfile regenerated
  - E1/H1/I3: `triggeredBy` parameter threaded through `runPublishTick`, `runJanitorTick`,
    and `runMetricsSyncTick` signatures; orchestrators emit one canonical log line per tick
    carrying both `triggeredBy` and all summary fields; duplicate route-level tick logs deleted
  - Route tests updated to assert `triggeredBy` via `vi.mocked(orchestratorFn).toHaveBeenCalledWith`
    (orchestrators are mocked in route tests); `it.each(['qstash', 'secret'])` parametrized
    tests added in both orchestrator test files
  - 89 tests passing across cron routes + auth + orchestrators; commit b62a29c.

- **Session 13.5C:** Reviewer audit — security + correctness review of QStash migration (Opus 4.7).
  Two blockers surfaced: B7 (caret range on @upstash/qstash) and E1/H1/I3 (duplicate tick logs).

- **Session 13.5B:** QStash trigger migration — dual-mode cron authentication (ADR 0005 Amendment 1):
  - `lib/cron/qstash-auth.ts` — `verifyQStashRequest` helper + `QStashAuthError` class;
    10 tests passing (Receiver constructor mock, valid/invalid/missing signature, env var absent)
  - `app/api/cron/publish/route.ts` — hard-branched on `CRON_TRIGGER`: GET+Bearer in `secret` mode,
    POST+QStash signature in `qstash` mode; 405 returned for wrong method in either mode
  - `app/api/cron/sync-metrics/route.ts` — same dual-mode pattern
  - `docs/runbooks/qstash-setup.md` and `docs/runbooks/vercel-cron-restore.md` created
  - `vercel.json` crons array removed (QStash schedules the jobs from the Upstash console)
  - `docs/launch-checklist.md` §3 updated for QStash verification gates
  - @upstash/qstash ^2.11.0 added to package.json
  - 36 route tests + 10 auth tests passing; commit 4840f47.

- **Session 13D:** Correction pass — all 6 code findings resolved, ADR 0007 aligned in 3 sections:
  - B6: tunnelRoute removed from `withSentryConfig` in next.config.ts
  - A8: `Sentry.setUser({ id: user.id })` added to dashboard layout (id only — no PII)
  - H5: Orchestrator kind strings hyphenated — `publish-tick`, `metrics-sync-tick`
  - F2: `detectLocale` uses `Object.hasOwn()` — prototype-poisoning safe
  - A1: `CATCH_ALL_SUBSTRINGS` single source of truth — exported from sentry-scrub.ts,
    imported and re-exported by errors.ts; reference equality enforced by test
  - D15: `signupAction` drops unused email arg from `consumeRateLimit`
  - ADR §3.2: sourcemaps config pattern documented (deleteSourcemapsAfterUpload)
  - ADR §3.5: janitor-cron Sentry.withMonitor example documented
  - ADR §4.2: middleware ordering corrected (auth redirect → x-pathname → i18n → nonce → CSP)
  - New tests: prototype-poisoning cases in global-error.test.tsx, CATCH_ALL_SUBSTRINGS ===
    reference equality in errors.test.ts, Sentry.setUser integration in layout.test.tsx
  - 691/691 tests passing; tsc --noEmit --skipLibCheck clean.

- **Session 13C:** Reviewer audit — typescript-reviewer review of the full ADR 0007 (Launch Hardening)
  implementation. 6 code findings and 3 ADR doc-drift issues identified.

- **Session 13B:** Launch Hardening continued — error boundaries + launch checklist (ADR 0007 §B7–B8):
  - `app/global-error.tsx` — root error boundary, inline Stone CSS, multi-locale (en/pt/es),
    Sentry capture on mount, no next-intl dependency
  - `app/[locale]/error.tsx` — locale-scoped error boundary, Tailwind, next-intl, Sentry on mount
  - `app/[locale]/not-found.tsx` — Server Component 404 page, next-intl, no Sentry (by design)
  - `i18n/en|pt|es/errors.json` — error boundary translations for all three locales
  - `docs/launch-checklist.md` — all Section 1 `<fill>` cells replaced with concrete
    `vercel env ls production | grep` commands; `SENTRY_DSN` corrected to
    `NEXT_PUBLIC_SENTRY_DSN`; Section 8 scrubEvent route-path exclusion check added
  - 551 tests passing.

- **Session 13A:** Launch Hardening — Sentry observability + CSP + rate limiting (ADR 0007 §B1–B6):
  - Sentry SDK initialized across client, server, and edge runtimes; `lib/observability/sentry-scrub.ts`
    shared scrubber module with CATCH_ALL_SUBSTRINGS; scrubEvent PII scrubber wired into Sentry config
  - Content Security Policy with nonce injection (Middleware) and Report-Only mode; security headers
    (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)
  - `auth_rate_limits` and `cron_health` migrations authored and applied to live DB
  - Database-backed rate limiting: `consumeRateLimit` wired into all 4 auth Server Actions
    (signup, login, forgot-password, reset-password)
  - `app/api/_health/route.ts` — health check endpoint with cron job monitoring
  - `lib/config.ts` — all 42 env vars centralized and typed
  - Vercel Speed Insights + Analytics integrated
  - Error message redaction refactored into shared constants
  - 551 tests passing.

- Session 12C: Reviewer correction pass — all 5 items resolved:
  1. [HIGH I1] `route.ts` — `now.toISOString()` → `formatISO(now)` in error-path fallback;
     `formatISO` imported from date-fns (only `.toISOString()` in the Session 12B diff)
  2. [HIGH D1] `orchestrator.test.ts` — `PROVIDER_NOT_CONFIGURED` added to `it.each`;
     all 8 `SocialProviderErrorCode` values now covered exactly once
  3. [MEDIUM ADR drift] ADR 0006 §5 — `BAD_REQUEST` removed (never existed in the union);
     `NOT_CONFIGURED` renamed to `PROVIDER_NOT_CONFIGURED` (actual code name)
  4. [MEDIUM H4/H5/H6] `posts.metrics.test.ts` — 3 `expect(true).toBe(true)` tests deleted;
     replaced with a comment block above `describe()` citing the migration as the SQL spec;
     no integration test infrastructure exists
  5. [VERIFY] `orchestrator.ts` — `formatISO(result.fetchedAt)` removed; `result.fetchedAt`
     passed straight through (Option a: `PostMetrics.fetchedAt` is typed `string`, already
     ISO-8601 per provider contract; `formatISO` expects `Date | number`, not `string`);
     test mocks corrected from `fetchedAt: NOW` (Date) to `fetchedAt: formatISO(NOW)` (string)
  28 test files, 348 tests passing; tsc --noEmit --skipLibCheck clean (SOSH files).

- Session 12B: Metrics worker — full Phase 1 implementation (ADR 0006):
  - Migration 20260530120000: `list_posts_for_metrics_sync` plain SQL helper function
    (LEFT JOIN posts → post_metrics, staleness predicate, NULLS FIRST ordering, REVOKE/GRANT)
  - lib/db/posts.ts — `listPostsForMetricsSync` (RPC wrapper, service-role, formatISO args)
  - lib/metrics/orchestrator.ts — `runMetricsSyncTick`: per-platform short-circuit Set<Platform>,
    full §5 outcome matrix, null-vs-zero preservation, structured console.log summary
  - app/api/cron/sync-metrics/route.ts — timing-safe auth, dev-bypass, always-200 response
  - vercel.json — hourly cron `0 * * * *` added alongside publish cron
  - lib/config.ts — `METRICS_SYNC_BATCH_SIZE`, `METRICS_STALE_MINUTES`, `METRICS_MAX_AGE_DAYS`
  - Test suite: orchestrator (8 outcome-matrix cases, short-circuit, batch limit, tick format),
    route (auth, dev-bypass, internal throw), DB helper (RPC params, staleness arg, error throw)
  - 220 tests passing across 15 files; tsc --noEmit --skipLibCheck clean

- Session 11C: Correction pass — all 10 fixes applied and verified.
  299/299 tests passing. tsc --noEmit --skipLibCheck clean. 0 ESLint violations on touched files.

  **Fixes applied:**
  - (B5) Webhook pre-records with 'error' sentinel before dispatch, updates to real outcome after
  - (B6) Documented stale subscription.updated race condition — Phase 2 accepted risk
  - (G4) "Manage billing" link gated on stripe_customer_id presence
  - Zod validation added to startCheckoutAction (plan + locale params)
  - (D5) serverOnly guard added to products.ts to prevent client-side bundling
  - (H1a) Double-cast removed from route.ts payload
  - (H1b) isPostgresError type guard replaces 3 unsafe error casts in billing-events.ts
  - (H2) Redundant type casts removed from webhook.ts fingerprint block
  - (H7) 4 WHY comments added to checkout.ts (client_reference_id, subscription_data)
  - Fingerprint-capture-failure resilience test added to webhook.test.ts

  **Learned skill:** postgres-error-type-guard — safe Supabase error narrowing pattern
  saved to ~/.claude/skills/learned/postgres-error-type-guard.md

- Session 11B: typescript-reviewer + security-reviewer parallel audit of B6/B7/B8 output.
  3 critical TS issues, 7 medium, 2 critical security, 4 medium security identified.

- Session 11A: Stripe billing — full implementation (B6 webhook, B7 upgrade CTAs, B8 billing UI)
  + ESLint correction pass. 706/706 tests passing. tsc --noEmit --skipLibCheck clean.

  **Stripe surface (`/lib/stripe/`):**
  - `client.ts` — lazy singleton `getStripeClient()`; server-only guard (throws if imported in browser)
  - `products.ts` — `PLAN_TO_PRICE_ID` / `planForPriceId()` driven by env vars; bidirectional map
  - `plan.ts` — `PlanCapabilities` interface + `getPlanCapabilities(plan)` — single source of truth
    for all per-plan limits and feature flags (postsPerMonth, activeCampaigns, allowedPlatforms, etc.)
  - `checkout.ts` — `createCheckoutSession` / `createBillingPortalSession` / `NoBillingCustomerError`
  - `webhook.ts` — `parseWebhookEvent` (signature verify) + `dispatchWebhookEvent` (business logic)
  - ESLint boundary rule added: no direct `stripe` npm import outside `lib/stripe/**`

  **Migration 031 — `billing_events` table:**
  - `id TEXT PRIMARY KEY` — Stripe event.id is the PK; unique constraint provides idempotency
  - `processed_outcome` CHECK: applied | ignored_unknown_price | ignored_no_business |
    ignored_duplicate | error
  - RLS: authenticated users SELECT their own business's events; all writes are service-role

  **Webhook idempotency model:**
  - Route pre-records the event before dispatch using event.id as PK
  - Postgres `23505` unique violation → `{ duplicate: true }` → immediate 200, no re-processing
  - Outcome updated after dispatch; initial value is optimistic 'applied'
  - Signature failure → 400; dispatch error → 500 (triggers Stripe retry); duplicates/success → 200

  **Webhook events handled:**
  - `checkout.session.completed` → activates subscription, upgrades plan, records card fingerprint (non-fatal)
  - `customer.subscription.updated` → upgrades/downgrades plan or clears billing on cancellation statuses
  - `customer.subscription.deleted` → clears billing (downgrade to trial)
  - `invoice.payment_failed` → explicit no-op (logged; dunning emails deferred to Phase 3)
  - All other event types → silent no-op; 200 returned

  **Plan-switch UX decision (B8):**
  - New subscriptions → Stripe Checkout (`startCheckoutAction`): full hosted payment flow
  - Plan switches and cancellations → Customer Portal (`openBillingPortalAction`): Stripe manages
    proration, downgrades, and cancellation; no custom plan-switch UI at launch

  **New env vars:**
  - Server (4): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PLUS`, `STRIPE_PRICE_ID_PRO`
  - Public (1): `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

  **New i18n namespace `billing.*`** — full EN/PT/ES covering pricing cards, current plan banner,
  success page, portal access, and trial expiry banner.

  **B7 — Upgrade CTA gate:** `upgradeCtaTargetFor(reason)` in `lib/campaigns/enforcement.ts`
  returns `/billing` for trial and plus limits. Gate value `PLUS_CAMPAIGN_LIMIT = 5` was
  hardcoded in enforcement.ts — closed in Session 18B-3 (B18-010), now reads from
  `getPlanCapabilities()`.

  **Smoke tests A–F: done** (Stripe live-key run against webhook idempotency, pricing page
  render, checkout flow, Stripe portal, trial banner, signature failure).

- Session 10D: All 8 blockers and 2 quick wins resolved. 13 test files, 204 tests passing.
  tsc --noEmit --skipLibCheck clean.
  Deferred: B2 (metadata RPC), C8 (value-scanning), H5 (comments), W2/W3/W4.

- Session 10C: Reviewer audit completed — 8 blockers + 2 quick wins identified across
  auth (CRON_SECRET), state machine (requeueScheduledPost timestamp), error routing
  (refresh-retry catch), explicit error cases, tests (reaper ordering + platform gate),
  timestamp coherence (claimPostsForPublishing now param), and convention (config.public.NODE_ENV).

- Session 10B: Publishing worker implementation + status UI surfaces (Prompt B7):
  - Migration 20260525100000: publish_attempts/last_publish_attempt_at/last_publish_error
    columns; claim_posts_for_publishing SECURITY DEFINER RPC with REVOKE/GRANT service_role;
    FOR UPDATE SKIP LOCKED claim query
  - lib/db/posts.ts: claimPostsForPublishing, markPostPublished, markPostFailed,
    requeueScheduledPost (incrementAttempts flag), reapStuckScheduledPosts
    (STUCK_REAPED/STUCK_TERMINAL two-statement approach), incrementPublishedCountForCampaign
  - lib/db/post-generation-sessions.ts: recoverStuckGenerationSessions (stale janitor,
    deferred from Session 8)
  - lib/publishing/orchestrator.ts: runPublishTick + runJanitorTick; full 8-code error
    matrix; TOKEN_EXPIRED in-tick refresh+retry; NETWORK exponential backoff ±25% jitter;
    redactTokens helper; per-tick refreshedThisTick Set loop guard
  - app/api/cron/publish/route.ts: CRON_SECRET timing-safe auth (length pre-check +
    timingSafeEqual); X-Cron-Dev-Trigger dev bypass (production rejects header entirely);
    Phase A (janitor + reaper) → Phase B (publish tick); always-200 response
  - QStash: */10 * * * * schedule for /api/cron/publish (Hobby limit; upgrade to * * * * * on Pro)
  - lib/config.ts: 6 new vars with ADR 0005 §14 defaults (CRON_SECRET, PUBLISH_BATCH_SIZE=25,
    PUBLISH_MAX_ATTEMPTS=5, PUBLISH_RETRY_BACKOFF_SECONDS=60, PUBLISH_STUCK_MINUTES=10,
    POST_GENERATION_SESSION_STALE_MINUTES=15)
  - docs/build-guide/runbooks/cron-secret-rotation.md: full CRON_SECRET rotation runbook
  - Status UI (Prompt B7): PostCard extended with scheduled (indigo animate-pulse dot),
    published (emerald dot + ExternalLink to platform_url), failed (amber dot + localised
    error label from resolveErrorLabel switch + failedAt tooltip) pills; action buttons
    disabled for scheduled/published/failed states; CampaignDetailActions extended with
    "Next post: in Xh Xm" timing + amber failed-banner → ?filter=failed deep-link;
    PostsClient extended with failed filter pill + initialFilter prop wired from searchParams
  - i18n EN/PT/ES: posts.json (card.status.scheduled/published/failed, card.error.* 9 codes,
    filter.failed, card.tooltip.failedAt, card.action.openOnPlatform); common.json
    (campaigns.detail.nextPost, failedBanner, failedBanner_plural, openFailed)
  - Test suite: 289/289 passing; tsc --noEmit --skipLibCheck clean

- Session 10A: Publishing worker ADR authored (docs/decisions/0005-publishing-worker.md)
  - REVERSAL 1: retry-tracking columns (publish_attempts/last_publish_attempt_at/
    last_publish_error) over jsonb
  - REVERSAL 2: `failed` is terminal — "re-queue back to scheduled" in ADR 0001 §B.5 was
    speculative; retry-from-failed is Phase 2
  - REVERSAL 3: scheduled_at is now mutable — worker bumps it on RATE_LIMITED/NETWORK retry
  - Full error matrix (8 codes), TOKEN_EXPIRED in-tick refresh+retry with per-tick Set loop
    guard, PUBLISH_STUCK_MINUTES=10 strictly greater than maxDuration=60s

- Session 9D: Correction pass — all 5 reviewer fixes applied:
  1. **C5 — Prompt injection sanitization:** Added `sanitizeDataField()` helper to both
     `post-regeneration.ts` and `post-generation.ts` (local copy per file, not shared import).
     Applied to all user-controlled strings inside [DATA] blocks: `previousContent`,
     `previousRationale`, `feedbackNote`, `siblingPostsTopics[]`, `special_instructions`,
     `unique_value_prop`, `alreadyGeneratedTopics[]`. Replaces `[/DATA]` with `[/data-blocked]`.
  2. **E2a — i18n Show more/less:** Added `card.showMore`/`card.showLess` to all three
     locale files (EN/PT/ES). `PostCard.tsx` now uses `t('card.showLess')`/`t('card.showMore')`
     with Unicode arrows.
  3. **E2b — date-fns locale in date dividers:** `PostsClient.tsx` imports `enUS`/`pt`/`es`
     from `date-fns/locale`, builds a `DATE_FNS_LOCALES` map, destructures `locale` prop,
     and passes `{ locale: dateFnsLocale }` to `format()` for date divider labels.
  4. **E7 — formatISO convention:** `listPostsDue()` in `lib/db/posts.ts` uses
     `formatISO(new Date())` instead of `new Date().toISOString()` per CLAUDE.md.
  5. **X1 — FilterPill at module scope:** Moved `FilterPill` out of `PostsClient` render
     to module scope; added `FilterPillProps` with `activeFilter`/`onSelect` props; all 4
     call sites updated.
  Test suite: 331/331 SOSH tests passing; tsc --noEmit --skipLibCheck clean.

- Session 9B: Posts review UI — full implementation:
  - lib/ai/prompts/post-regeneration.ts — PostRegenerationOutputSchema (Zod), postRegenerationPrompt
    (buildSystemPrompt + buildUserMessage with feedbackNote injection)
  - AiGenerationMetadata.previousVersions type fixed (string[] → array of version objects)
  - lib/db/posts.ts — updatePostContentAndMetadata helper (updates content + hashtags +
    increments ai_generation_metadata.regenerationCount, caps previousVersions at 10)
  - 7 Post Review Server Actions (app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts):
    approvePostAction, unapprovePostAction, skipPostAction (with rejection_note), unskipPostAction,
    updatePostContentAction, regeneratePostAction (full runPrompt pipeline), bulkApprovePostsAction
  - app/[locale]/(dashboard)/campaigns/[id]/posts/actions.test.ts — full test suite covering
    all 7 actions (UUID validation, auth guards, optimistic update payloads, error codes)
  - app/[locale]/(dashboard)/campaigns/[id]/posts/page.tsx — Server Component: auth + RLS;
    post counts (approved/draft/skipped/total); back link; summary bar; ready-to-publish banner
    (all approved); empty state with CTA; passes posts + campaign to PostsClient
  - app/[locale]/(dashboard)/campaigns/[id]/posts/PostsClient.tsx — Client Component:
    optimistic local state; filter pills (all/per-platform/approved/skipped); date dividers;
    sticky filter bar; bulk-approve button (drafts only); renders PostCard per post
  - components/posts/PostCard.tsx — full interactive card: platform colour accent; status pill;
    regeneration count badge; content expand/collapse (>300 chars); hashtag pills; skip inline
    form; edit mode (Textarea + hashtags input); action buttons per status (approve/skip/undo/
    edit/regenerate); optimistic updates with rollback on server error
  - components/posts/RegenerateDialog.tsx — modal with feedback Textarea (min 5 chars);
    submitting state; per-error-code messages; optimistic content/hashtags update on success
  - i18n/en|pt|es/posts.json — new posts namespace (title, back, summary.*, readyBanner.*,
    empty.*, filter.*, bulkApprove, bulkApproveSuccess, card.*, skip.*, regenerate.*);
    wired into i18n/request.ts; legacy posts.* keys removed from common.json
  - All i18n key paths in components aligned to posts.json structure (fixed in this session:
    title {campaignName}, summary sub-keys, readyBanner.*, empty.action, regenerate.error.*,
    regenerate.minChars, regenerate.submitting, card.actions.cancel, bulkApprove)
  - Test suite: 488/488 passing; tsc --noEmit --skipLibCheck clean

- Session 8D: Correction pass — all 5 blockers applied:
  1. **UUID validation on Server Action params (Fix 1):** Both startGenerationAction and
     getGenerationSessionAction now call z.string().uuid().safeParse() at entry; params
     renamed rawCampaignId / rawSessionId so validated const flows through the function.
  2. **console.warn removed (Fix 2):** posts.length mismatch block deleted from generate.ts;
     CLAUDE.md prohibits console.* in committed code; discrepancy observable via session row.
  3. **Double-cast eliminated (Fix 3):** PostInsert.ai_generation_metadata widened to
     AiGenerationMetadata | Record<string, unknown>; `as unknown as` cast removed from generate.ts.
  4. **scheduled_at endDate clamp (Fix 4):** schedulePosts now filters selected slots to
     ≤ endDate (end-of-day UTC) before returning. Widening may produce post-endDate slots in
     the fillExtraSlots fallback; clamp removes them. Fewer posts than count is acceptable
     (posts_created < posts_planned surfaced by session row). New test added:
     "clamps output to endDate — no slot returned after endDate".
  5. **POST_GENERATION_POLL_MAX_SECONDS extracted (Fix 5):** Hardcoded 120 moved to
     config.server; passed as pollMaxSeconds prop from page.tsx → CampaignDetailActions →
     GeneratePostsButton.
  Test suite: 231/231 passing; tsc --noEmit --skipLibCheck clean.

- Session 8C: Reviewer audit — security-reviewer + typescript-reviewer parallel review of
  Session 8B post-generation subsystem. 37-item consolidated checklist (28 ✅ / 6 ⚠️ / 5 ❌).
  All 7 ADR-mandated patterns (P-1–P-7) and 2 reversals (R-1, R-2) verified correct.
  5 blockers identified (Fixes 1–5 below), 6 recommendations (some deferred).

- Session 8B: Post generation — full AI orchestration + UI wiring:
  - lib/ai/prompts/post-generation.ts — PostGenerationOutputSchema (Zod), PLATFORM_CONSTRAINTS
    (per-platform character/hashtag/style rules), getPlatformConstraintsVersion(),
    postGenerationPrompt (buildSystemPrompt + buildUserMessage with [DATA] injection hardening)
  - lib/campaigns/schedule.ts — schedulePosts: timezone-aware UTC slot generation, per-platform
    optimal days/hours (OPTIMAL_SLOTS), week-cap enforcement, window widening (MAX_WIDENING_PASSES),
    fillExtraSlots fallback, endDate clamp (end-of-day UTC), evenly-spaced pick
  - lib/db/post-generation-sessions.ts — createGenerationSession, getGenerationSession,
    updateGenerationSessionStatus (service-role CRUD for post_generation_sessions table)
  - lib/db/trial-state.ts — incrementPostsGeneratedBy(businessId, amount) RPC wrapper
  - lib/campaigns/generate.ts — generatePostsForCampaign orchestrator (12 steps):
    service-role client → mark generating → idempotency guard → buildCustomerContext →
    trial pre-flight (P-4, R-2) → schedule per platform (canonical order) → runPrompt per
    platform (P-2) → collect-then-insert (P-1) → updateCampaign(active) → increment trial
    counter (R-1) → mark complete; full rollback to 'failed' on any error path
  - app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts — two Server Actions:
    startGenerationAction (UUID validation → auth → idempotency checks → trial pre-flight →
    createGenerationSession → after() background dispatch) and
    getGenerationSessionAction (UUID validation → auth → session ownership check → return status)
  - app/[locale]/(dashboard)/campaigns/[id]/GeneratePostsButton.tsx — Client Component:
    idle → pending → generating (live post count) → complete (auto-redirect) → failed (retry);
    polling via setInterval at 2s; MAX_POLLS derived from config.server.POST_GENERATION_POLL_MAX_SECONDS
  - app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx — GeneratePostsButton
    wired into draft state; pollMaxSeconds prop passed from Server Component parent
  - lib/db/types.ts — GenerationSession, AiGenerationMetadata types added; PostInsert
    ai_generation_metadata widened to AiGenerationMetadata | Record<string, unknown>
  - lib/config.ts — POST_GENERATION_POLL_MAX_SECONDS added (env-configurable, default 120s)
  - Migrations 026–029: post_generation_sessions table, increment_posts_generated_by RPC,
    vault write helpers, increment_campaigns_created corrections
  - i18n EN/PT/ES — campaigns.detail.generate.* (cta, starting, in_progress, success, timeout,
    try_again, error.{quota_exceeded,rate_limited,provider_error,invalid_response,timeout,
    invalid_campaign_state,already_generated,generic})
  - Test suite: 231/231 passing; tsc --noEmit --skipLibCheck clean

- Session 8A: Campaign detail page built:
  - app/[locale]/(dashboard)/campaigns/[id]/page.tsx — Server Component: auth + RLS-scoped
    getCampaignById (redirect to /campaigns on 404/unowned); renders back link, campaign header
    (name + status badge + Edit button), overview card (objective, special instructions,
    platforms, frequency, date range); passes campaign to CampaignDetailActions
  - app/[locale]/(dashboard)/campaigns/[id]/CampaignDetailActions.tsx — Client Component:
    Draft state: "Ready to generate your posts?" card with total_posts_planned count,
    Generate Posts button (shows coming-soon message inline on click);
    Non-draft state: published/total summary + View Posts link → /campaigns/{id}/posts;
    Danger zone (collapsed by default): Pause button (active campaigns), Resume button
    (paused campaigns), Delete button (draft/completed with AlertDialog confirmation);
    after delete → router.push to /campaigns
  - i18n EN/PT/ES — campaigns.detail.* (back, edit, meta.*, generate.*, posts.*, danger.*)
  - Test suite: 461/461 passing; tsc --noEmit --skipLibCheck clean

- Session 7 complete (7A ADR → 7B Builder → 7C Reviewer + correction pass):
  - **Plan enforcement:** checkCampaignCreationAllowed with trial/starter/pro tiers;
    atomic increment_campaigns_created RPC; trial cap env-configurable
  - **Server-side platform ownership check:** createCampaignAction verifies all
    submitted platforms are connected for the business before enforcement step
  - **Campaign list page:** listCampaigns + CampaignCard (status badge, platform names,
    pause/resume/delete actions with AlertDialog confirmation for delete)
  - **Campaign detail page:** getCampaignById (RLS-scoped); overview card; Generate Posts
    CTA placeholder (inline coming-soon message on click); danger zone with pause/resume/delete
  - **Type safety:** CampaignUpdate now excludes business_id (CLAUDE.md tenancy convention);
    softDeleteCampaign unguarded export removed (only softDeleteCampaignGuarded is public)
  - **Cleanup:** Dead i18n keys errors.campaign.limit_trial / limit_starter removed;
    endDate validation message updated to clarify same-day case
  - Test suite: 459/459 passing; tsc --noEmit --skipLibCheck clean

- Session 7B: Campaign creation form + Server Action (builder role):
  - lib/validation/campaign.ts — createCampaignSchema (Zod): name, objective,
    specialInstructions (optional), platforms (min 1), frequency (enum), postsPerWeek
    (1–21 int), startDate, endDate (optional, must be after startDate)
  - lib/db/campaigns.ts — countActiveCampaigns: counts active+draft campaigns per business
    (draft counts toward Starter limit — represents committed in-progress work)
  - lib/campaigns/enforcement.ts — checkCampaignCreationAllowed: trial=cap from
    config.server.AI_TRIAL_CAMPAIGN_CAP (default 1, via campaigns_created_count);
    starter=2 active+draft; pro/agency=unlimited
  - lib/campaigns/campaign.test.ts — 26 tests covering schema validation + all 4 plan tiers
  - app/[locale]/(dashboard)/campaigns/new/actions.ts — createCampaignAction Server Action:
    10-step pipeline (validate → auth → business → trialState → enforcement → compute
    totalPostsPlanned → createCampaign(status:draft) → incrementIfTrial(swallowed) → return
    campaignId). Returns campaignId for client-side redirect (redirect() not usable inside
    useActionState).
  - app/[locale]/(dashboard)/campaigns/new/actions.test.ts — 18 tests: validation errors,
    auth/business errors, limit errors, success path, error swallowing, generic DB error
  - supabase/migrations/20260521180000_increment_campaigns_created.sql — atomic
    increment_campaigns_created RPC (SECURITY DEFINER, service_role-only). Applied to live DB.
  - lib/db/trial-state.ts — incrementCampaignsCreated added (lazy service-role import pattern)
  - app/[locale]/(dashboard)/campaigns/new/page.tsx — Server Component: fetches
    listActiveSocialAccounts, passes to CampaignForm
  - app/[locale]/(dashboard)/campaigns/new/CampaignForm.tsx — Client Component with three
    sections: (1) name/objective/special-instructions; (2) platform cards (all 5 shown —
    connected selectable, disconnected greyed with "Connect in Settings →"; coming-soon badge
    on instagram/facebook/threads); frequency pills (daily/3×week/weekly/custom); date range
    with estimated post count; (3) sticky summary bar with live preview + Create button
  - i18n EN/PT/ES — campaigns.new.* namespace (25 keys: title, section headers, all field
    labels/placeholders, frequency options, platform states, summary, cta, limit banners)
  - errors.campaign.generic added to all three locales (limit_trial/limit_starter later removed as dead keys in 7C)
  - Test suite: 470/470 passing; tsc --noEmit --skipLibCheck clean

  - lib/db/campaigns.ts — pauseCampaign, resumeCampaign (atomic status-guarded UPDATE, return row|null),
    softDeleteCampaignGuarded (guards on draft/completed status, returns boolean)
  - app/[locale]/(dashboard)/campaigns/actions.ts — pauseCampaignAction, resumeCampaignAction,
    deleteCampaignAction: UUID Zod validation → auth → business (RLS) → mutate → success/error
  - app/[locale]/(dashboard)/campaigns/actions.test.ts — 13 tests covering UUID validation,
    unauth, guard failures, success paths, DB errors
  - lib/db/campaigns.test.ts — extended with 9 new tests for the three guarded helpers
  - components/campaigns/CampaignCard.tsx — Client Component: name/objective/status badge/platform
    names/post count/created date; View link (buttonVariants); Pause/Resume/Delete buttons shown
    only in valid states; Delete uses AlertDialog confirmation; useTransition + router.refresh()
    on success; inline error message per action
  - app/[locale]/(dashboard)/campaigns/page.tsx — replaced stub: fetches listCampaigns via RLS;
    empty state (inline SVG + headline + CTA) or list of CampaignCards with page header
  - i18n EN/PT/ES — campaigns.list.* (title, new_button, empty.*, card.*) and
    campaigns.status.* (draft/active/paused/completed) in all three locale files
  - Test suite: 492/492 passing; tsc --noEmit --skipLibCheck clean

- Session 6D: Correction pass — all critical findings applied:
  1. DashboardShell.tsx — eslint-disable for hydration-safe sessionStorage read in useEffect
  2. SocialAccountUpdate type — vault_access_token_id/vault_refresh_token_id allow null;
     double cast removed from deactivateSocialAccount
  3. listAllSocialAccounts / listActiveSocialAccounts — explicit column list, vault IDs excluded;
     return type SocialAccountWithoutVault
  4. connected_coming_soon status — active account on coming-soon platform surfaces Disconnect;
     disabled Connect button prevents orphan accounts; i18n keys in all 3 locales
  5. connect_failed — added to ERROR_KEYS whitelist + translations (EN/PT/ES)
  6. Locale in OAuth state JWT — signOAuthState embeds locale; callback reads claims.locale
     for all redirects (fixes PT/ES users landing on /en/ after OAuth)
  7. isPlatform() guard — extracted to lib/social/platforms/guards.ts, replaces three
     duplicated VALID_PLATFORMS Sets in connect/callback/disconnect routes
  8. Connection-status boundary tests — exact 7-day (expiring_soon) + 8-day (connected)
  Test suite: 295/295 passing; tsc --noEmit clean (SOSH files)

- Session 6C: Reviewer audit — security-reviewer + typescript-reviewer parallel review (Opus 4.7).
  31-item security checklist (24 ✅ / 4 ❌ / 3 ⚠️), 35-item TS checklist (30 ✅ / 2 ❌ / 3 ⚠️).

- Session 6B: Full OAuth + social accounts UI implemented:
  - Postiz docker-compose (local dev stack with Postgres, Redis, health checks)
  - OAuth connect/callback/disconnect routes for all 5 platforms
  - lib/social/oauth/state.ts — signOAuthState / verifyOAuthState with locale claim
  - lib/social/platforms/guards.ts — VALID_PLATFORMS + isPlatform() (single source of truth)
  - lib/social/connection-status.ts — ConnectionStatus type with 'connected_coming_soon'
    (active account on coming-soon platform shows Disconnect; not connected shows disabled Connect)
  - components/social/PlatformConnectionCard.tsx — shared card component (settings + onboarding)
  - components/social/PlatformIcon.tsx — brand-colour platform icons
  - app/[locale]/(dashboard)/settings/accounts/ — server-fetched accounts page with
    AccountsClient (banner, router refresh on disconnect)
  - app/[locale]/(dashboard)/onboarding/step-3/ — Step3Client with live polling and skip warning
  - components/layout/SettingsNav.tsx — settings sidebar nav
  - i18n EN/PT/ES — full accounts, settings nav, step-3 strings

- Session 6A: SocialProvider OAuth ADR authored (docs/decisions/0002-social-provider.md §7 — vault
  write sequence, compensating transactions, state JWT with locale)

- Session 5D: Correction pass — all 8 reviewer findings applied:
  1. **B-trial-bypass:** context.ts now derives trialState from business.plan (not
     trialStateRow === null). If plan is 'trial' but row missing, full caps returned
     (trigger hasn't fired yet). config.server.AI_TRIAL_POST_CAP and
     AI_TRIAL_CAMPAIGN_CAP added (env-configurable, previously hardcoded).
  2. **C-dns-all:** lookup() now called with { all: true }; every resolved address
     checked — single blocked address in a multi-A record set rejects the request.
  3. **C-mapped-ipv6:** isBlockedIPv6 now extracts the IPv4 part from ::ffff:x.x.x.x
     and passes it through isBlockedIPv4. Covers AWS metadata via mapped IPv6.
  4. **C-toctou:** undici Agent created with connect.lookup pinned to the pre-resolved
     IP address; TCP connect cannot re-resolve to a different address (DNS rebinding fix).
  5. **F-cache-tokens-not-stored:** ai_usage.input_tokens now stores
     usage.input_tokens + usage.cache_read_input_tokens (raw total per ADR §10).
     Cost weighting (10% for cache reads) is applied only in calculateCostCents.
  6. **F-rate-limit-not-per-prompt:** countRecentCalls now accepts promptId param and
     filters by prompt_id. Separate rate limits: brand-voice 10/min, post-gen 30/min.
     AI_RATE_LIMIT_POST_GENERATION_PER_MIN added to config.
  7. **I-i18n-ai-errors:** errors.ai.{quota_exceeded,rate_limited,provider_error,
     invalid_response,timeout} added to all three locale files. Step 2 form calls
     inferBrandVoiceAction on mount; on failure, sets errorCode state and shows the
     specific message via useTranslations('errors.ai').
  8. **B-race:** incrementBrandVoiceAttempts + incrementPostsGenerated replaced with
     single client.rpc() calls to atomic SQL functions (migration 25). No read round-trip.
  9. **C-body-stream:** website-fetcher replaced arrayBuffer() with streaming reader;
     cap fires at the byte boundary as data arrives, not after full buffer load.
  Test suite: 334/334 passing; tsc --noEmit --skipLibCheck clean; migration 25 applied.

- Session 5C: Reviewer audit — security-reviewer + typescript-reviewer + cost-aware-llm-pipeline
  parallel review of /lib/ai/. Identified B-trial-bypass, 3 SSRF gaps (C-dns-all,
  C-mapped-ipv6, C-toctou), F-cache-tokens-not-stored, F-rate-limit-not-per-prompt,
  I-i18n-ai-errors, B-race, C-body-stream.

- Session 5B: Full AI layer implemented (/lib/ai/)
  - models.ts — MODELS registry (SONNET_4_6, HAIKU_4_5, OPUS_4_7), calculateCostCents
  - errors.ts — AiError class with typed codes (quota_exceeded, rate_limited, provider_error,
    invalid_response, rate_limit)
  - parsers.ts — safeParseOrAiError (Zod-validated JSON parse)
  - client.ts — getAnthropicClient factory; AI_PROVIDER=mock returns stub
  - context.ts — buildCustomerContext: loads business + brand voice + trial_state;
    trialState derives from business.plan (not row nullity — B-trial-bypass fix)
  - website-fetcher.ts — fetchWebsiteText with full SSRF guard (F-1–F-14):
    scheme allowlist, credential rejection, blocklisted IPv4/IPv6 ranges, all-address
    DNS check, IPv4-mapped IPv6 (::ffff:) detection, undici pinned dispatcher (TOCTOU),
    manual redirect re-resolution (max 2 hops), streaming body cap (C-body-stream fix)
  - runner.ts — 8-step runPrompt: trial cap → rate limit → message assembly →
    cache_control (>4096 chars) → SDK call with one retry → parse → cost calc →
    ai_usage record (always, in finally) → trial counter increment
  - prompts/brand-voice-inference.ts — BrandVoiceInferenceOutput schema + prompt builder
  - metrics.ts — aiCostByBusiness, aiCallVolume read-only observability helpers
  - index.ts — single public export surface
  - Migration 25: increment_brand_voice_attempts + increment_posts_generated RPC functions
    (atomic single-statement UPDATE, no read round-trip — B-race fix)
  - Test suite additions: context, errors, models, parsers, runner, website-fetcher, metrics,
    ai-usage (countRecentCalls), trial-state (increment RPCs) — 334 tests total
  - Step 2 form upgraded: polls inferBrandVoiceAction → BrandVoice DB row; AI-badge on
    suggested fields; per-error-code i18n messages (quota_exceeded, rate_limited,
    provider_error, invalid_response, timeout) in EN/PT/ES

- Session 5A: AI layer ADR authored (docs/decisions/0003-ai-layer.md)
  - 8-step runner contract, SSRF constraints (F-1–F-14), trial cap & rate-limit rules,
    cost accounting model (ADR §10: raw input_tokens + cache_read_input_tokens stored),
    per-prompt rate limits (ADR §9), provider abstraction (AI_PROVIDER env)

- Session 4D: Correction pass — all non-deferred reviewer findings applied:
  1. **IDOR closure (B-01):** step-1 and step-2 Server Actions no longer trust client-supplied
     `businessId` from FormData. `businessId` is now derived server-side via
     `getBusinessByOwner(client, user.id)` after the auth check. Hidden `businessId` inputs
     removed from both forms.
  2. **Zod schema for step-2 (B-02):** `saveStep2Action` now validates all six fields through
     a proper `step2Schema`; exported `Step2State` type added with index signature for field errors.
  3. **Guarded JSON.parse for tone (B-03):** `JSON.parse(toneRaw)` wrapped in try/catch and
     validated through `z.array(z.string()).catch([])` — malformed input silently coerces to `[]`.
  4. **Missing locale key (B-04):** `errors.onboarding.name_required` and `errors.onboarding.generic`
     added to all three locale files (en/pt/es) under `common.json`.
  5. **Step2Form useActionState + errors (B-05):** Step2Form refactored to mirror Step1Form —
     `useActionState`, `isPending` on submit button, `_form` error block with `role="alert"`.
  6. **Step1Form error rendering (B-06):** Field error paragraph now calls `tErrors(state.errors.name)`
     instead of rendering the field label string.
  7. **Reset URL from APP_URL (H-01):** `forgot-password/actions.ts` no longer builds the reset
     URL from spoofable `x-forwarded-host`/`host` headers. URL comes from `config.server.APP_URL`
     (backed by `NEXT_PUBLIC_APP_URL`); `lib/config.ts` updated with the new `APP_URL` getter.
  8. **Zod-first password reads (H-02):** `reset-password/actions.ts` removed pre-Zod unsafe casts;
     password mismatch check moved into `resetPasswordSchema` via `.superRefine`.
  9. **Signup recovery path (M-03):** Post-auth setup failures return a `setup_incomplete` error
     state with preserved form values instead of silently stalling. `errors.signup.setup_incomplete`
     added to all three auth locale files.
  10. **Skip button pending state (M-05):** `SkipButton` component created using `useFormStatus`;
      both step-1 and step-2 forms use it for the "Skip for now" action.
  11. **Form value preservation on error (M-06):** All auth actions (login, signup, forgot-password)
      now include `values` in error returns; login/signup/forgot-password pages bind `defaultValue`
      on inputs from `state.values.*`.
  Test suite: 265/265 passing; tsc --noEmit clean (SOSH files).

- Session 4B: Reviewer audit — typescript-reviewer + security-reviewer parallel audit of Session 4A.
  Identified 12 issues (B-01–B-06, H-01–H-02, M-03, M-05–M-06, plus deferred M-01/M-02/M-04/L-*).

- Session 4A: Authentication & Onboarding Foundation
  - lib/validation/email.ts — FREE_EMAIL_PROVIDERS blocklist, isWorkEmail(), getEmailDomain(),
    workEmailSchema (Zod); lib/validation/email.test.ts — 37 tests covering all cases
  - app/[locale]/(auth)/ — signup, login, forgot-password, reset-password pages with
    Server Actions, useActionState feedback, next-intl translations across EN/PT/ES
  - i18n/en|pt|es/auth.json — full auth namespace (signup, login, forgot, reset, errors)
  - middleware.ts — auth redirect + i18n locale detection + x-pathname header injection
  - lib/contexts/business-context.tsx — BusinessProvider + useActiveBusiness() Client Component
    context (user, activeBusiness, brandVoice)
  - app/[locale]/(dashboard)/layout.tsx — Server Component guard (getUser → login redirect;
    getBusinessByOwner → signup redirect; onboarding guard via x-pathname header)
  - app/[locale]/(dashboard)/actions.ts — logoutAction (signOut + redirect)
  - components/layout/DashboardShell.tsx — sidebar (5 nav items) + top bar with user dropdown
    (Base UI DropdownMenu without asChild — see decisions below)
  - app/[locale]/(dashboard)/campaigns/page.tsx — empty state page
  - components/onboarding/OnboardingProgress.tsx — step progress indicator (X of 4)
  - app/[locale]/(dashboard)/onboarding/page.tsx — routing logic redirects to correct step
    based on what's already filled in (business fields → brand voice → step-3)
  - app/[locale]/(dashboard)/onboarding/step-1/ — business profile (name/website/industry/
    description); native <select> for industry; pre-fills from context
  - app/[locale]/(dashboard)/onboarding/step-2/ — brand voice (tone multi-select pills,
    target audience, keywords tag input, avoid_words tag input, unique_value_prop);
    tone serialized as JSON hidden input, tags as comma-separated string
  - app/[locale]/(dashboard)/onboarding/step-3/ — social platform cards (LinkedIn, X,
    Instagram, Facebook, Threads); Connect buttons disabled with "Coming soon" tooltip;
    Skip → step-4
  - app/[locale]/(dashboard)/onboarding/step-4/ — completion screen; completeOnboardingAction
    sets onboarding_completed via service-role (lazy import pattern)
  - i18n/en|pt|es/common.json — nav.profile, nav.logout, dashboard.campaigns.empty.*,
    onboarding.* (all steps, tones, industries, platforms)

- Session 3D: Correction pass — all 10 reviewer fixes applied:
  1. POSTIZ_BASE_URL — renamed from POSTIZ_API_URL (canonical ADR name) across
     lib/config.ts, registry.ts, route.ts, .env.local, .env.local.example
  2. readRefreshToken — added !account.is_active guard (was missing vs readAccessToken)
  3. Zod validation on Postiz responses — PostizCallbackResponseSchema +
     PostizRefreshResponseSchema replace raw `as` casts in postiz-provider.ts
  4. Recursive redaction — SocialProviderError.details now redacts nested
     token-shaped keys (e.g. details.platform_message.accessToken)
  5. Constant-time health-check — token comparison uses crypto.timingSafeEqual
  6. NODE_ENV via config — registry.ts + route.ts read config.public.NODE_ENV,
     not process.env.NODE_ENV directly
  7. Expired-token test — oauth-state.test.ts covers verifyOAuthState rejection
  8. 300s exact boundary test — vault.test.ts covers the <= skew condition
  9. token_secret + recursive redaction test — errors.test.ts covers nested keys
  10. Integration test placeholder — lib/social/__integration__/ created, gated on
      POSTIZ_INTEGRATION_TEST_ENABLED
  Rec A: OAuthAuthorizeInput platform/state fields documented in types.ts +
         current-phase.md
  Rec B: OAUTH_STATE_SECRET requires .min(32) at boot (no silent empty default)
  Test suite: 165/165 passing + 3 todo + 1 skipped (integration)

- Session 3C: Reviewer audit — SocialProvider reviewed by typescript-reviewer +
  security-reviewer in parallel (Opus 4.7 synthesis). 10 fixes identified.

- Session 3B: Full SocialProvider abstraction implemented (/lib/social/)
  - types.ts — SocialProvider interface + all OAuth/token types
  - errors.ts — SocialProviderError with typed error codes
  - constants.ts — Required OAuth scopes per platform
  - vault.ts — readAccessToken, readRefreshToken, withFreshToken (service-role)
  - oauth/state.ts — signOAuthState / verifyOAuthState (HMAC-SHA256 JWT)
  - mock-provider.ts — MockProvider with configurable failure injection
  - postiz-provider.ts — PostizProvider (Postiz API wrapper)
  - registry.ts — getRegistry() singleton; SOCIAL_PROVIDER=mock for tests
  - index.ts — single public export surface for all consumers
  - ESLint rule: no direct imports of postiz-provider or mock-provider outside lib/social/
  - Migration 24: vault RPC helpers (vault_create_secret, vault_update_secret, vault_delete_secret)
  - Test suite: 66/66 passing (7 test files in lib/social); full suite 162/162
  - lib/social/types.test.ts — type-level assertions for all exported types
  - app/api/_health/social/route.ts — health check endpoint (HEALTHCHECK_TOKEN gated)
  - HEALTHCHECK_TOKEN added to /lib/config.ts as optional server var
  - vitest.config.ts: testTimeout bumped to 15000ms (vault module-reset slowness)

- Session 3A: SocialProvider ADR authored (docs/decisions/0002-social-provider.md)

- Session 2E: Final correction pass — all warnings resolved
  - Test suite: 96/96 passing; tsc --noEmit clean

- Session 2D: All lib/db/ query modules complete with full TypeScript types
  (businesses, brand-voices, campaigns, posts, post-metrics, social-accounts,
  engagement, trial-state, ai-usage)

- Session 2C: Reviewer audit — database schema and security review passed

- Session 2B: All 23 database migrations authored
  (supabase/migrations/ 001–013 base + 014–015 placeholders + 016–023 fixes)

- Session 2A: Database schema ADR complete and approved
  (docs/decisions/0001-database-schema.md)

- Session 1: Next.js 16 initialized, Tailwind, shadcn/ui,
  next-intl (EN/PT/ES), Supabase clients, typed config

- Session 0: Environment setup complete

## What's next

Session 19D correction pass is applied. Voice model core is merge-ready. One open decision required before closing Session 19:

### Open decision — Session 19D-5 (§7 BP9 read path)

Choose one:
1. **Add `fetchRecentPosts` to `SocialProvider`** — ~~implement in `PostizProvider` + `MockProvider`~~
   **re-pointed 2026-09-05 (Session 30.5 N2.13, ADR 0028 §12): `PostizProvider` no longer exists.**
   This option is now designed against `LinkedInProvider`/`TwitterProvider` directly and lands as
   **ADR 0002 Amendment B, owned by Session 32** — not this decision, and not a Postiz API call.
2. **Amend ADR 0011 §7** — ratify "refine reads local published posts from SOSH DB" as deliberate scope reduction. Update the reviewer finding as accepted deviation.

### Next up — post-Session 22 (Pre-launch hardening)

Session 21 (Seats & Permissions) and Session 22 (test-execution integrity + approvals hardening) are both
closed — resolved by Session 22 W1 and marked closed in `backlog.md`; `21C-bulk-platform` is
resolved by W2 A1. What remains, in priority order:

1. ~~**Postiz removal workstream (launch-checklist §16):** migrate `lib/social/` to direct LinkedIn/X APIs —
   a separate track, unaffected by Sessions 21/22.~~ — ✅ done, Session 30.5 Track N (ADR 0028), code-complete
   at N2.13 close-out. See the dated entry below. Production OAuth app registration remains open (§14.1).
2. **Remaining legal gates (launch-checklist §9):** counsel ratification → `[LEGAL ENTITY]` substitution;
   Anthropic DPF verification; cookie inventory in staging; Svix client-verify confirm.
3. **Perf/CWV gates (launch-checklist §11):** first-load JS ≤ 90 KB gz + LCP/CLS/INP lab check, blocked on
   the pre-existing `npm run build` ECC Remotion TS-check failure.
4. **`db-tests` promotion — THRESHOLD MET, awaiting the founder's branch-protection change.** (Corrected
   2026-09-03: this item read *"currently 0/3"*, which has been stale since the 2026-08-22 reconciliation
   recorded the threshold as met on 2026-07-27.) The tally stands at **7 consecutive green `master` runs**,
   the latest being the PR #9 merge at `2a67041a`. What remains is not tracking but a decision: updating
   ruleset `master-app-tests` (id `19038239`) to add `db-tests`, which ADR 0015 §5 makes the founder's
   call, not a documentation update. **Separately, `eval-reported`'s own 0/3 tally is unreachable until
   `eval-triage.yml` gains a `push` trigger — see the defect recorded in the Session 28 entry above.**
5. Lower priority: `21C-pagination` (real cursor pagination past the 200-row Approvals cap — see the
   un-defer trigger filed in `backlog.md`; `21C-dead-params` is resolved by the same A2 server-side
   filtering work), `21B-n4` (request-level memo of `getBusinessForUser`), and the open 19D-5 voice-model
   decision — all filed in `backlog.md` / noted above, not blocking.

### Remaining pre-launch work

- **Open legal gates (§9):** counsel ratification → [LEGAL ENTITY] substitution; Anthropic DPF verification at dataprivacyframework.gov; cookie inventory in staging; Svix client-verify confirm
- ~~**Postiz removal workstream (§16):** migrate `lib/social/` to direct LinkedIn/X APIs (separate track)~~ — ✅ done (Session 30.5 Track N, ADR 0028)
- **Deferred post-launch backlog:** in-app Delete Account flow (B18-014, P2); `auth_rate_limits` TTL purge; `13.5C-log` (cron-auth-failure structured log); ADR reconciliation items G3/C7 (backlog.md)
- **Open triage items:** B18-089 (full 15-site `formatISO(new Date())` sweep → `toUtcIso`, P2); B18-064 (postcss XSS CVE, awaits Next.js bump); B18-086/087 (P2 signup oracle + confirmation redirect env parity)
- **Perf/CWV gates (§11, 2 rows):** first-load JS ≤ 90 KB gz + LCP/CLS/INP lab check once `npm run build` ECC Remotion issue is resolved
- ~~**Smoke tests:** Resend sandbox sends for all 5 email kinds; Stripe smoke tests A–F~~ — ✅ done
- **Launch-checklist verification pass:** confirm all §1–§10 rows are actionable

---

## Backlog / Deferred

### Session 5D

- **fixture-key by prompt_id**: lib/ai/__fixtures__/ should be keyed by prompt_id so
  fixtures are reusable across prompt versions without collision.
- **Extra IP ranges**: 0.0.0.0/8 (this-network broadcast) and fe80::/10 (link-local IPv6)
  are not yet in the SSRF blocklist. Low risk in practice but should be added.
- **Error cast cleanup**: `(error as { message: string })` pattern appears in ~15 places
  across lib/db/. Extract to a typed `getErrorMessage(unknown): string` helper.
- **fetch_failed dead enum**: The `fetch_failed` value exists in an error enum but is
  never produced by the current website-fetcher (it returns null on failure). Remove or connect it.
- **AI_RATE_LIMIT_POST_GENERATION_PER_MIN**: Config var and countRecentCalls filter are
  wired up, but post-generation prompts don't exist yet. Verify the limit applies correctly
  when Session 6 lands.

### Session 6D

- **A3 — TOCTOU race on disconnect** (ADR deviation, low-probability): deactivateSocialAccount
  reads then updates the social_accounts row in two round-trips. A concurrent connect could
  race between the read and the update. Acceptable until publishing worker lands; revisit then.
- **Silent vault cleanup logging**: vault_delete_secret failures in the 6e reconnect path are
  swallowed silently. Add structured logging once a proper logger (pino/similar) is introduced.
- **AlertDialog visual QC**: the disconnect confirmation dialog renders but has not been
  verified in a browser across all three locales and dark/light modes. Schedule a UI QC pass.

### Session 7C

- **TOCTOU on starter cap:** countActiveCampaigns + createCampaign is two round-trips;
  a concurrent request could slip a 3rd campaign through on the Starter plan. Low probability
  in practice — revisit when concurrent usage warrants it (Phase 2).
- **notFound() over redirect on missing campaign:** detail page currently redirects to
  /campaigns on 404/unowned; Next.js convention prefers notFound(). Cosmetic — no security
  impact given RLS guards.
- **Equal-date endDate edge case:** Zod refine uses `>` which already rejects same-day
  (error message updated to make this explicit). No functional gap.

### Session 8C

- **Schema enforcement on prompt output (B4):** PostGenerationOutputSchema validates structure
  but does not enforce platform-specific hashtag counts or content length ranges at parse time.
  Acceptable at launch — add stricter Zod refinements in a future prompt iteration pass.
- **Custom frequency scheduler test (E6):** schedulePosts is tested for daily/3x_week/weekly
  but not for `frequency='custom'` with an unusual postsPerWeek value. Add a targeted test
  if custom frequency is user-facing.
- **updateCampaign atomic guard:** generate.ts step 10 calls updateCampaign without an atomic
  `WHERE status='draft'` guard. Low risk (orchestrator already verified draft status in step 3),
  but a concurrent request could slip through. Revisit when concurrent generation is possible (Phase 2).
- **toISOString() consistency:** lib/db/posts.ts still uses `.toISOString()` directly in a few
  places instead of date-fns `formatISO()`.

### Session 11A

- ~~**Cross-file capability-hardcoding sweep**~~ — ✅ closed, Session 18B-3 (B18-010,
  matches backlog.md S11A-cap): `lib/campaigns/enforcement.ts` and adjacent files now read
  plan limits from `getPlanCapabilities()` instead of hardcoded integers.
- ~~**Smoke tests A–F**~~ — ✅ done: webhook idempotency, pricing page render, checkout flow,
  Stripe portal, trial banner, signature failure (400) all run against live Stripe keys.

### Session 13.5C

- **C4/H2 — Bearer-side cron-auth-failure warn log:** The `secret` (Bearer) branch does not emit a
  structured `{ kind: 'cron-auth-failure' }` warn log on failed auth, unlike the QStash branch which
  logs reason + route + trigger. Low operational impact at launch but inconsistent with the QStash
  branch's observability. Add a parallel `console.warn(JSON.stringify({ kind: 'cron-auth-failure',
  route, trigger: 'secret', reason: ... }))` to both route Bearer guards in a future correction pass.
- **G1/G2 — ADR 0005 + 0006 cross-reference drift:** ADR 0005 Amendment 1 and ADR 0006 §12/§13
  were not updated to cross-reference each other after the QStash migration. Resolve in a dedicated
  doc pass — no code change required.
- **vercel.json cosmetic:** vercel.json retains commented-out cron stanza (left as a rollback reference).
  Remove the comment block once QStash is confirmed stable in production.

### Session 13D

- ~~**H1 — launch-checklist tunable granularity**~~ — ✅ closed, Session 18B-5 (B18-045):
  `docs/launch-checklist.md` §1 expanded to per-var tunable rows matching `lib/config.ts`.
- ~~**B5 — withSentryConfig SENTRY_AUTH_TOKEN**~~ — ✅ closed, Session 18B-5 (B18-046):
  `authToken: process.env.SENTRY_AUTH_TOKEN` now passed explicitly in `next.config.ts`.

### Session 14 reviewer (ADR 0008 — Transactional Email)

- ~~**A4 — `suppressed` missing from EmailProviderErrorCode**~~ — ✅ closed, Session 18B-5
  (B18-001): `| 'suppressed'` added to the union in `lib/email/errors.ts`.
- **G3 — T-1 window ADR reconciliation:** Implementation uses `[now+1d, now+2d)` (i.e. "ends
  tomorrow"); ADR §10 text says `[now, now+1d)`. Code and tests are internally consistent and
  the copy is correct. Recommended fix: amend ADR §10 to the implemented windows rather than
  changing code; update the §16 test description comment.
- **C7 / §14 schema drift — svix-id as PK:** `email_webhook_events` uses `svix-id` as the
  idempotency PK (stable across Resend retries), not a payload event id. ADR §14 schema block
  does not document this and shows a different column shape. Reconcile the ADR §14 schema
  block with the shipped migration; document why svix-id is the correct anchor.
- **D3 — full locale-snapshot invariant test missing:** `enqueue.test.ts` asserts locale is
  forwarded but does not cover the mutation invariant. Add: enqueue with `locale='pt'`, mutate
  `businesses.language='es'`, claim the row, assert render uses `'pt'` (not the live value).
  Locks the snapshot guarantee end-to-end per ADR §16.
- **J3 — verify beforeSend scrubs bare email addresses in Sentry error strings:** ADR 0007
  `beforeSend` scrubber is key-name based (`REDACTED_KEYS`). Resend error messages can embed
  the recipient address as a bare string (not under a key), which the scrubber would not catch.
  Confirm `scrubString` / `scrubEvent` covers this pattern; if not, scrub `err.message` before
  `Sentry.captureException` in the drainer.
- ~~**E5 — footer text 13px below 14px minimum**~~ — ✅ closed, Session 18B-5 + 18B-5D
  (B18-002): `lib/email/templates/_layout.tsx` footer bumped to 14px; snapshots regenerated.
- **K1 — `any` escape hatch in templates/index.ts:** Two `any` casts (props, `React.FC`)
  with `eslint-disable` comments are the registry heterogeneity escape hatch. Consider a
  generic `KindEntry<P>` keyed per kind to remove them, or document the exception in CLAUDE.md.
- ~~**§5 — atomic WHERE-guard on transitionEmailOutboxRow**~~ — ✅ closed, Session 18B-2
  (B18-003): atomic `WHERE id AND WHERE status` guard added to `transitionEmailOutboxRow`.
- **Hardcoded 14-day trial interval in find_trial_expiring_between.sql:** The SQL function
  hardcodes the 14-day trial length. Should read from a config constant or be passed as a
  parameter so it stays in sync with `config.server.TRIAL_DURATION_DAYS` if that var is ever
  introduced.

### Session 19

- **§7 BP9 — SocialProvider read surface gap (STOPPED, decision required):** `refineFromPostsAction` currently reads `listRecentPublishedPostTexts` from the local SOSH DB. ADR §7 calls for the SocialProvider read surface, but `SocialProvider` has no `fetchRecentPosts` method. Either add one (ADR 0002 amendment + Postiz/direct-API implementation) or amend ADR 0011 §7 to accept the local-posts read as deliberate scope. See 19D-5 stop output for full context.
- **VoiceEditor DOM rendering tests:** `components/voice/VoiceEditor.test.ts` covers the i18n contract for the mobile track toggle. Full behavioral rendering tests (aria-expanded toggle, DOM order of questions vs track) require `@testing-library/react` + jsdom/happy-dom — not yet installed. Add when setting up component test infrastructure.
- **`refine-from-posts-action.test.ts:92` pre-existing TS error:** `BrandVoiceRow` argument type mismatch (`undefined` vs `BrandVoiceRow`) in the test at line 92. Pre-dates Session 19; not introduced by any 19D pass. Fix when touching that file.

---

## Key Decisions

### Session 21A (ADR 0013 — Seats & Permissions, Rev B)

The two-axis permission model is DB-enforced, not app-layer-only: `user_can(business_id, capability)` is a DEFINER helper every role×capability check ultimately calls, and the two hard boundaries (post approval, seat cap) are backed by triggers rather than RLS policies alone, so a raw anon-key request can't bypass them. Seats are a DB-enforced plan cap — `plan_max_seats()` + the `enforce_seat_cap` BEFORE INSERT trigger reject over-cap invites regardless of caller, with the app-layer `checkInviteAllowed` demoted to a fail-fast UX echo. Owner membership (the un-removable primary-admin row) is provisioned by two complementary mechanisms: a one-time M7 backfill DML for businesses that existed before 21A shipped, and an `ensure_owner_membership` AFTER INSERT DEFINER trigger (M9, added in the 21A-D/MAJOR-1 correction) for every business created since — without M9, `countSeatUsage`/`listMembers` would have silently under-reported the owner forever. Invite/accept runs through the `accept_invite` DEFINER RPC, gated by email-match (not admin-only visibility) plus DB-side 7-day expiry and a double-membership pre-check.

### Sessions 3B + 3D

- SocialProvider abstraction enforced at ESLint level (no-restricted-imports rule)
- Vault access is always service-role; lib/social/ layer owns all vault I/O
- MockProvider injected via SOCIAL_PROVIDER env var (no test-only DI plumbing)
- OAuth state signed as HMAC-SHA256 JWT (stateless, no DB round-trip)
- Vault helpers exposed as Supabase RPC (not direct vault.secrets writes)
- POSTIZ_BASE_URL is the canonical env var name (not POSTIZ_API_URL)
- Postiz integration tests gated on POSTIZ_INTEGRATION_TEST_ENABLED env var
- OAUTH_STATE_SECRET requires min 32 chars — boot fails fast if missing

### Session 4A

- **onboarding_completed is service-role gated:** `completeOnboarding()` uses the lazy dynamic
  import pattern so the service-role client is never accidentally bundled into client code.
- **Onboarding guard via x-pathname header:** middleware.ts injects `x-pathname`; dashboard
  layout reads it to detect when the user is already on an `/onboarding` route and avoid a redirect loop.
- **Step page architecture:** Each onboarding step is a Server Component page wrapping a Client
  Component form. The Server Component renders the shell; the form reads `useActiveBusiness()`.
- **Native `<select>` for industry dropdown:** shadcn/ui Select (`@base-ui/react/select`) has
  uncertain API stability for this pattern; native HTML `<select>` styled with Tailwind is used instead.
- **Tone stored as JSON, tags as CSV:** Step 2 receives `tone` as a JSON-parsed array and
  `keywords`/`avoid_words` as comma-split strings, serialized via hidden `<input>` fields.
- **Base UI DropdownMenu — no asChild:** shadcn v4 does not expose `asChild` on Menu primitives.
  `DropdownMenuTrigger` is styled directly; `<Link>` and `<form>` are children inside `DropdownMenuItem`.
- **Skip for now sets onboarding_completed:** `skipOnboardingAction` calls `completeOnboarding()`
  via service-role and redirects to campaigns.
- **Step 2 Zod schema:** tone validated as array after guarded JSON.parse; keywords/avoid_words
  split from CSV. All fields optional except tone (defaults to `[]`).
- **Step 1 Zod schema:** name required; businessId derived server-side via getBusinessByOwner,
  never from FormData.

### Session 5

- **8-step runner** (`lib/ai/runner.ts`): trial cap → rate limit (per prompt_id) → message
  assembly with cache_control for system prompts >4096 chars → SDK call with one retry on
  429/5xx → Zod parse → cost calc → ai_usage INSERT in finally (never throws) → trial counter
  RPC (success path only, errors swallowed).
- **Per-prompt rate limits**: countRecentCalls filters by (business_id, prompt_id, window).
  brand-voice: 10/min; post-gen: 30/min. Env-configurable via config.server.
- **Atomic trial increments**: Postgres functions increment_brand_voice_attempts /
  increment_posts_generated do a single `UPDATE ... SET col = col + 1`. No read round-trip.
- **undici pinned dispatcher**: fetchWebsiteText resolves DNS once, checks ALL addresses,
  then creates an Agent whose connect.lookup always returns the validated IP — eliminates DNS
  rebinding TOCTOU window.

### Session 11A

- **Stripe SDK boundary enforced at ESLint level:** `no-restricted-imports` paths rule bans
  direct `stripe` npm imports outside `lib/stripe/**`. Test files (`*.test.ts`) excluded so
  they can import stripe for mocking. Uses `paths` (exact match), not `patterns`, to avoid
  accidentally catching `@/lib/stripe/*` internal imports.
- **Plan-switch via Customer Portal, not Checkout:** `startCheckoutAction` is for new
  subscriptions only. Existing subscribers use `openBillingPortalAction` (Stripe-hosted portal)
  for upgrades, downgrades, and cancellations. No custom plan-switch UI at launch.
- **`startCheckoutAction(locale, plan)` takes locale as a parameter:** No `getLocale()` helper
  exists in Server Actions; Client Component passes locale from `useParams()`.
- **`billing_events.id` is the Stripe event.id (TEXT PK):** Idempotency is enforced by the
  primary key constraint. Duplicate detection is a Postgres `23505` unique violation, not an
  application-level query. Pre-record before dispatch; update outcome after.
- **`invoice.payment_failed` is an explicit no-op at launch:** The event is recorded and
  returns outcome 'applied' with a null businessId. Dunning emails and grace-period logic
  are Phase 3.

### Sessions 13A–D (ADR 0007 — Launch Hardening)

- **Sentry.setUser passes id only:** no email, no name, no PII ever set on the Sentry user context.
- **CATCH_ALL_SUBSTRINGS single source of truth:** exported from `lib/observability/sentry-scrub.ts`;
  `lib/social/errors.ts` imports and re-exports it. Reference equality enforced by test — prevents
  accidental divergence if one copy is edited and not the other.
- **Object.hasOwn over `in` operator for locale detection:** `in` traverses the prototype chain
  and is vulnerable to prototype-poisoning attacks. `Object.hasOwn` checks own properties only.
- **tunnelRoute excluded from withSentryConfig:** increases attack surface without sufficient
  benefit at our scale. Removed in Session 13D correction pass.
- **global-error.tsx has no next-intl dependency:** the root error boundary must render without
  the i18n provider, which may itself have crashed. Locale detection is manual with an
  Object.hasOwn guard and a hardcoded EN fallback.

### Session 13.5B–D (ADR 0005 Amendment 1 — QStash trigger migration)

- **CRON_TRIGGER hard-branch, not feature flag:** Routes branch at entry on `config.server.CRON_TRIGGER`.
  GET returns 405 in `qstash` mode; POST returns 405 in `secret` mode. Dev-bypass (`X-Cron-Dev-Trigger`)
  is only consulted in the `secret` branch — never in the `qstash` branch.
- **@upstash/qstash pinned exactly:** `"2.11.0"` (no caret). ADR Amendment 1 mandates exact pinning
  for security-critical SDKs whose verification logic must not silently change between deploys.
- **Canonical tick log lives in the orchestrator:** `publish-tick`, `janitor_tick`, and
  `metrics-sync-tick` log lines are emitted once per tick from the orchestrator, carrying both
  `triggeredBy` and all summary fields. Routes do not emit tick logs — they delegate to orchestrators.

### Session 18B-4 (B18-060 anti-enumeration + B18-025 proxy rename)

- **Anti-enumeration: Option 3 — collapse all `signInWithPassword` failures to `errors.login.invalid`:** removes `unconfirmedEmail` from `LoginState`; replaces the conditional amber banner with an always-rendered resend link; new `/resend-confirmation` route mirrors the `forgot-password` indistinguishability posture. Residual GoTrue timing oracle documented + accepted.
- **proxy.ts replaces middleware.ts (Next.js 16 convention):** `config.matcher`, `x-pathname` header, nonce/CSP injection, and auth-redirect logic are byte-identical; only the export name and filename changed.

---

## Known gotchas

- **`npm run build` fails (pre-existing):** ECC remotion skill files cause Next.js tsc
  (without `--skipLibCheck`) to error. Use `npm run dev` for local work. Do not fix in a Builder session.
- **Bare `npx vitest run` picks up ECC tests:** Always scope to SOSH paths, e.g.
  `npx vitest run lib/db lib/social lib/campaigns lib/ai lib/observability lib/publishing lib/metrics app/global-error "app/[locale]/(dashboard)" "app/[locale]/(auth)"`.
  Bare vitest matches ECC files that call `process.exit()` and fail.
- **tsc must use `--skipLibCheck`:** Bare `npx tsc --noEmit` surfaces ECC remotion errors.
  Always use `npx tsc --noEmit --skipLibCheck`.
- **Migrations applied through 031 + auth_rate_limits + cron_health:** All migrations through 031
  (billing_events) plus the two Session 13A migrations (auth_rate_limits, cron_health) have been
  applied to the live Supabase DB as of Session 13A.
- **OAuthAuthorizeInput has 2 extra fields vs ADR §2** (platform, state — Builder additions).
  Document in ADR 0002 open follow-ups.
- **ECC commands use `/ecc:` prefix**, not `/everything-claude-code:`.
- **`npm run db:migrate` requires `DATABASE_URL`** (Supabase transaction pooler connection string).
- **B18-030 sweep is pattern-matched, not variable-name-matched:** aliased error vars (`fetchError`, `readError`) are covered. The original 18B-3 sweep matched only the variable name `error` and missed them.

### Session 30.5 N2.11 (2026-09-04)

- **The broker is removed, total and provable.** `lib/social/postiz-provider.ts` and its two test
  files, `infra/` (docker-compose stack), all env vars, CSP host, npm scripts, and every prose
  reference are gone in one commit. Proof is executable, not asserted: `lib/social/__tests__/
  no-postiz.test.ts` (SOCIAL-NO-POSTIZ) case-insensitively scans the real source tree and fails on
  any stray reference, demonstrated to redden and revert before landing.
- **Exemptions are named, not silent.** `docs/decisions/`, `docs/reviews/`, `docs/build-guide/`,
  `docs/brainstorm/archive/`, `docs/evidence/`, `supabase/migrations/`, and a handful of individual
  test/doc files that must name "postiz" to prove its absence (`csp.test.ts`,
  `eslint-internals-ban.test.ts`, `accounts-i18n.test.ts`) or that narrate the removal itself
  (`docs/launch-checklist.md` §16) — each with its own stated reason in the scan file.
  `docs/current-phase.md`'s own historical session entries above this one are left unedited for the
  same reason; this entry is appended, not inserted into the record of what already happened.
- **A false ADR premise was caught before it broke working code.** ADR 0028's instruction to drop
  `'multi'` from `SocialProvider['platform']` assumed the deleted broker file was its only producer;
  it wasn't — `MockProvider` legitimately shares one instance across all five platforms in
  `SOCIAL_PROVIDER_MODE=mock`, asserted directly in this track's own `registry.test.ts`. Founder
  ruling: keep `'multi'` in the type. `lib/social/types.ts` documents why.
  `SOCIAL-NO-MULTI-PLATFORM` in `types.test.ts` asserts the corrected reality.

### Session 30.5 N2.12–N2.13 (2026-09-05) — Track N close-out

- **N2.12 — the accounts surface, dual identity.** `app/[locale]/(dashboard)/settings/accounts/` reworked
  from single-account-per-platform (accounts silently collapsed via `Object.fromEntries`, dropping a
  second identity) to grouped-by-platform arrays: one row per active identity, a "Default" badge for the
  identity `resolvePublishAccount` would pick when a post names no account, and an honest "no default"
  note when two active identities exist (no `is_default` column exists — adding one was judged out of
  this step's scope). The seven real OAuth error-redirect codes (ADR 0028 §9.4) are now the literal
  `ERROR_KEYS` list in `resolve-banner.ts`; the eighth key, `provider_unavailable`, was found dead (no
  route emits it since N2.11's rename) and removed from the reachable-states list while its i18n string
  stays, since `accounts-i18n.test.ts` still asserts its presence.
- **N2.13 — four executable scope-scan tripwires, each demonstrated to redden then reverted:**
  `SOCIAL-WORKER-UNCHANGED` (`lib/publishing/__tests__/worker-unchanged.test.ts` — the retry/status/
  idempotency machinery in `orchestrator.ts` is unchanged, account resolution is the one permitted
  addition), `SOCIAL-PROVIDER-BOUNDARY` (extended `eslint-internals-ban.test.ts` to assert all eight
  `SOCIAL_INTERNALS_BAN` entries fire together, not just two), `SOCIAL-META-STILL-UNAVAILABLE`
  (`lib/social/platforms/config.test.ts` — Instagram/Facebook/Threads stay `publishingAvailable: false`),
  and `SOCIAL-NO-READ-PATH` (`lib/social/__tests__/no-read-path.test.ts` — no `fetchRecentPosts`/
  `listRecentPosts` member exists yet; that is Session 32's, ADR 0002 Amendment B).
- **`SOCIAL-INTEGRATION-NOT-EXECUTED` confirmed, not just asserted.** `lib/social/__integration__/` does
  not exist in the repository — Postiz's integration suite was deleted whole in N2.11 and no native
  replacement was written (writing one would have bought zero CI coverage until backlog item
  `22E-integration-discovery` closes). `docs/backlog.md`'s row updated to say so plainly rather than
  leaving a stale "LinkedIn/X" framing that implied a suite exists.
- **Close-out docs worked per build-guide §5**, evidenced per row: `docs/launch-checklist.md` gained
  §16a (the LinkedIn Community Management API launch gate, ADR 0028 A-5 — not previously written despite
  §12's table naming it); the "Postiz removal workstream" Next-up item above is struck; the open 19D-5
  decision's option 1 is annotated as re-pointed at Session 32/ADR 0002 Amendment B, not rewritten.
  `docs/product-status.md:95`, `CLAUDE.md`'s tech-stack line, `docs/decisions/0002-social-provider.md`
  Amendment A, `docs/build-guide/session-32.md`'s dated Reality note, and ADR 0010 Amendment 2's cascade-
  table treatment of `posts.social_account_id` (no new row required — column addition to an
  already-cascading table, the Session 28-D D7 precedent) were all found **already done** in earlier
  N2.x steps — verified by reading each, not assumed from a checklist.
- **ADR 0028 §16's stated-open items remain open — none are closed by this step.** Items 1 (LinkedIn
  member-only vs. the locked "Business and Founder" platform list) and 6 (X's per-post link cost vs.
  "unlimited posts") are explicit founder adjudications neither N2.12 nor N2.13 can resolve. Items 2–5, 7
  and 8 are standing risks/facts, not defects with a fix step. §14's manual verification log is empty —
  stated as the honest state per §14.1, not backfilled.
- **CI, read at the head this section is dated to (`b6580b84`): `app-tests` GREEN**
  (`https://github.com/tcr430/SOSH/actions/runs/33970367725`); **`db-tests` RED on three consecutive
  attempts** (`https://github.com/tcr430/SOSH/actions/runs/33970367722`), reliably at
  `vault-update-secret.test.ts`'s permission tests with a "database system in recovery mode" signature
  right after the reset step — distinguished as a `db-tests.yml` readiness race, not a behaviour
  regression (the same function's grants were independently confirmed correct against the live linked
  Supabase project). Not a blocker: `db-tests` is not yet a required gate. Filed as
  `30.5-DBTESTS-READINESS-RACE`. Full detail in ADR 0028 §17.4.

### Session 30.5-D (2026-09-05/06) — correction pass, D0-D9

- **All 16 N3-reviewer findings plus 2 founder adjudications fixed or ruled**, one commit per step
  (`02a93980`..`933a335c`): BLOCKER-1 (three endpoint URLs re-sourced against live vendor docs, none had
  actually been verified despite a citation claiming so), MAJOR-2 (a latent cross-tenant publish path in
  `resolvePublishAccount`'s pinned branch, closed with a `business_id`/`platform` check), MAJOR-1 (disconnect
  now actually attempts platform revocation, with an added network timeout the build guide's own rules
  required), MAJOR-3/A-11 (`r_member_postAnalytics` verified review-gated, not shipped — the founder's "Yes"
  authorised the decision, not the fact), A-9′ (ship both LinkedIn account types, no locked-list amendment),
  A-10 (X's per-post cost recomputed at realistic volume, ruled immaterial), MINOR-3 through MINOR-7 and
  NIT-1 through NIT-4 (guard names, an i18n key, ADR §16's numbering, an arithmetic sweep that itself found
  the ADR's own "corrected to seven" claim was wrong — the original "eight" was right).
- **`app-tests` re-verified GREEN at the corrected head**, [run 33998672886](https://github.com/tcr430/SOSH/actions/runs/33998672886), commit `933a335c`.
- **`db-tests` — RED a fourth consecutive time, diagnosis sharpened, not resolved.** A memory-tuning fix
  (`shared_buffers`/`maintenance_work_mem` lowered) was pushed and re-tested — still red, but this time with
  healthy container memory and an explicit `signal 11: Segmentation fault` in the Postgres log, coinciding
  with `vault_update_secret` RPC calls across all four reds observed. This is not a resource-exhaustion
  signature; it points at the `pgsodium`/Vault extension, not memory pressure — the memory fix addressed the
  wrong theory, and that failure is itself the evidence that sharpened the diagnosis. `SOCIAL-VAULT-UPDATE-
  SECRET` and `SOCIAL-DUAL-IDENTITY-SCHEMA` are marked `AUTHORED-NOT-EXECUTED` in ADR 0028 §17.4's table.
  `db-tests` remains not a required gate, so this does not block merge. Filed as `30.5-DBTESTS-READINESS-
  RACE` (updated) in `docs/backlog.md`, with a new bug entry in `.wolf/buglog.json` (bug-1031).
