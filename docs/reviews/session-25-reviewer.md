# Session 25 — Reviewer Report (ADR 0018, Diff-Based Learning Capture, Track C)

**Reviewer:** independent review session (Claude Code, Opus 5). No file in this range was written by
this session, and no file was modified by it. This document is the only output.

---

## 0. Scope reviewed (PROC-REVIEW-AT-COMMIT)

**Scope reviewed: `717263d2..d7cee4a5`** — that is `be5779e1^..d7cee4a5`, C2.1 (`be5779e1`) through C2.9
(`d7cee4a5`), 9 commits, 57 files, +7509/−12.

**Every citation in this report is taken at that range**, via `git show d7cee4a5:<path>`,
`git diff 717263d2..d7cee4a5 -- <path>`, `git grep <pattern> d7cee4a5`, and `git log --oneline
717263d2..d7cee4a5`. **Nothing was read at HEAD.** Where a line number is given it is the line number
at `d7cee4a5`, not at HEAD.

**Documents read outside the range, named per the Session 22-F / NEW-12 exception:**

| Document | Where it was read | Why outside the range |
|---|---|---|
| `docs/decisions/0018-diff-based-learning-capture.md` | **working tree (untracked)** | Not committed at `d7cee4a5` — see MAJOR-5. There is no commit at which it can be read. |
| `docs/build-guide/session-25.md` | **working tree (untracked)** | Same — see MAJOR-5. |
| `docs/reviews/session-25-c2.9-verification.md` | `d7cee4a5` (tracked, added by C2.9) | The Builder's own prior verification report, audited against as a prior findings document. |

The reviewed **artefacts** (migrations, `lib/**`, `app/**`, tests, ADR 0016, ADR 0010, runbooks) were
all read at `717263d2..d7cee4a5`. The two spec documents above could not be, and that fact is itself a
finding rather than a reviewer convenience.

**Advisory passes invoked for this review** (read-only, each independently instructed to read at the
range; findings adjudicated and re-graded by this reviewer rather than passed through): `database-reviewer`,
`typescript-reviewer`, `ecc:type-design-analyzer`, `ecc:silent-failure-hunter`, `ecc:pr-test-analyzer`,
`ecc:security-reviewer`. Where I disagreed with an advisory grade I say so and give my reasoning.

---

## 1. SHARED-FUNCTION CALLERS (J4) — four tables

`git grep` at `d7cee4a5`. A caller with no listed test is `AUTHORED-NOT-EXECUTED` **for that caller**
even where a sibling caller is fully covered.

### 1.1 `approvePost` — `lib/db/posts.ts:320`

| Caller | `file:line` | Kind | Covering test | Status |
|---|---|---|---|---|
| `approvePostAction` | `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:97` | Server Action | `actions.test.ts:372-400` — 3 tests (success, Zod rejection, DB-error mapping), **added in this range** | EXECUTED (app-tests) |
| `approvePostFromCalendarAction` | `app/[locale]/(dashboard)/calendar/actions.ts:280` | Server Action | `calendar/actions.test.ts:710-735` (incl. server-derived `business_id` pass-through) | EXECUTED (app-tests) |
| *(direct unit)* | — | — | `lib/db/posts.test.ts:138-166` | EXECUTED (app-tests) |

The Builder's C2.9 report found and closed a real `AUTHORED-NOT-EXECUTED` here: before this range
`approvePostAction` had **zero** direct coverage — it appeared only as an unasserted `vi.fn()` in
`PostCard.test.tsx` and as a UI-wiring assertion in `ApprovalsInbox.test.tsx`. I re-derived this
independently and confirm it: `git show be5779e1^:app/[locale]/(dashboard)/campaigns/[id]/posts/actions.test.ts`
contains no `approvePostAction` describe block. Correctly found, correctly closed.

### 1.2 `bulkApproveDraftPosts` — `lib/db/posts.ts:526`

| Caller | `file:line` | Kind | Covering test | Status |
|---|---|---|---|---|
| `bulkApprovePostsAction` | `campaigns/[id]/posts/actions.ts:221` | Server Action | `actions.test.ts:411-510` — 6 tests, real invocation, args asserted | EXECUTED |
| ↳ `PostsClient` | `campaigns/[id]/posts/PostsClient.tsx:133` | Client Component | `PostsClient.test.tsx` (asserts the rendered-id set passed) | EXECUTED |
| ↳ `ApprovalsInbox` | `approvals/ApprovalsInbox.tsx:123` | Client Component | `ApprovalsInbox.test.tsx` (asserts the rendered-id set passed) | EXECUTED |
| *(direct unit)* | — | — | `posts.test.ts:340-374`; `posts.bulk-approve-url-budget.test.ts` | EXECUTED |

**Both Session 22 blockers were on this exact function, and both callers are now covered** — including
`PostsClient.tsx`, the one that went unaudited across three consecutive sessions.

**The ADR's own §3.4 table carries a false citation** (independently re-derived; C2.9 reported the same):
§3.4 lists `actions.context-equivalence.test.ts` as a second covering test for `bulkApprovePostsAction`.
`git grep bulkApprovePostsAction d7cee4a5 -- '**/actions.context-equivalence.test.ts'` returns only a
`vi.fn()` mock declaration at `:53`; that file's only `describe` is `regeneratePostAction caller — …`.
The function is still fully covered by the three tests above, so this is a **citation defect, not a
coverage gap** — but it is exactly the class of thing the SHARED-FUNCTION CALLERS rule exists to stop
being taken at face value. See MINOR-9.

### 1.3 `createPosts` — `lib/db/posts.ts:288`

| Caller | `file:line` | Kind | Covering test | Status |
|---|---|---|---|---|
| `generatePostsForCampaign` | `lib/campaigns/generate.ts:380` | internal lib (service-role) | `generate.test.ts:335-420` (6 snapshot writes asserted, byte-identical `rendered_content`, thread-payload round-trip, snapshot-failure-propagates-not-swallowed at `:384`); `generate.context-equivalence.test.ts:355` | EXECUTED |
| *(direct unit)* | — | — | `posts.test.ts:85-112` | EXECUTED |

Single production caller, fully covered.

### 1.4 `neutralize()` — `lib/ai/wrap-evidence.ts:83` (gained three callers in this range)

| Call site (enclosing fn) | `file:line` | Covering test | Hostile-input assertion? | New in range |
|---|---|---|---|---|
| `guard()` → `wrapEvidenceForPrompt` | `wrap-evidence.ts:103` | `wrap-evidence.test.ts:47,132,148` | yes (ZWSP-split, NFKC homoglyph) | no |
| `briefAssemblyPrompt.buildUserMessage` | `prompts/brief.ts:117,124` | `brief.test.ts:82,93` | yes | no |
| `critiqueBrief` | `campaigns/brief.ts:173` | `brief.test.ts:243` | wiring only (`neutralize` mocked) | no |
| `generatePostsForCampaign` (opener scoring) | `campaigns/generate.ts:266` | `generate.test.ts:491` | yes (fence defusal) | no |
| **`postGenerationPrompt.buildUserMessage`** | `prompts/post-generation.ts:179` | `post-generation.test.ts:264` | yes | **C2.1** |
| **`postRegenerationPrompt.buildUserMessage`** | `prompts/post-regeneration.ts:147` | `post-regeneration.test.ts:49` | yes — `:57-59` explicitly discriminates "upgraded to `neutralize()`" from "still on the weak local guard" | **C2.1** |
| **`guardExcerpts` + `guardTierZeroSummaries`** | `prompts/learning-summarizer.ts:66,78` | `learning-summarizer.test.ts:60,70,89,104` | yes, **both** directions (hostile defused; benign byte-identical) | **C2.7** |

All seven covered. `formats/native-generation-prompt.ts` — ADR §10.4's alleged *third* `topContent`
render site — **does not render `topContent` or `recentPostPerformance` at all** at this range
(`git grep -n "topContent\|recentPostPerformance" d7cee4a5 -- lib/ai/prompts/formats/` → no match). Two
real sites exist; both are guarded. See NIT-2.

---

## 2. Section-by-section check table

Status key: ✅ pass · ⚠️ pass with a caveat / finding raised · ❌ fail.

### Section A — Schema, RLS, cascade, erasure

| Check | Status | `file:line` @ `d7cee4a5` | Note |
|---|---|---|---|
| A1 RLS enabled, four policies, InitPlan form | ✅ | `20260726010000_learning_capture.sql:71,79,84-89,129,131-134,140-143,148-151,155-158` | Every policy uses `business_id = ANY (SELECT unnest(public.get_user_business_ids()))`. Zero occurrences of the superseded bare per-row form. **Both UPDATE policies carry USING *and* WITH CHECK** — no tenant tunnelling. |
| A1 cross-tenant CRUD denied, executed | ✅ | `supabase/__tests__/learning-capture-rls.test.ts` — 10 tests | Denials asserted, then **re-verified with a second service-role read** of DB state rather than trusting the client response. `USING` and `WITH CHECK` proven separately. Executed in db-tests. |
| A2 no authenticated DELETE on `post_ai_originals` | ✅ | `learning_capture.sql:91-95` | Absent by design, commented, and tested ("no authenticated DELETE policy even for own business"). Same posture as `email_outbox`. |
| A3 `business_id` cascades directly from `businesses`, both tables | ✅ | `:29`, `:100` | Direct FK `ON DELETE CASCADE`, never derived through a join. `post_id` + `campaign_id` FKs present on both; multi-parent cascade documented as intentional `[db-NIT-2]` at `:20-25`. |
| A4 §D2.5 rows for both tables, annotated | ✅ | `docs/decisions/0010-legal-surface.md:1071-1072` | Both rows present, both CASCADE, both explicitly annotated as holding **customer post content incl. third-party quote content** — `[sec-MEDIUM-1]` satisfied verbatim. |
| A4 business delete SUCCEEDS and purges, executed | ✅ | `learning-capture-write-once-and-erasure.test.ts:128,201,208,215` | Asserts `expect(deleteErr).toBeNull()` **at `:201`, before** the rows-are-gone assertions at `:208`/`:215`. Correct ordering — an aborting transaction reddens on the DELETE itself, not silently later. |
| A5 claimable partial index | ✅ | `:128-130` | `(next_attempt_at) WHERE status='pending'`, mirrors `email_outbox_drainable_idx`. |
| A5 covering `(business_id, pattern_key) INCLUDE (campaign_id) WHERE status='processed'` | ✅ | `:136-138` | Present verbatim. §9.6's recompute will not seq-scan. |
| A5 explicit FK indexes on `ai_original_id`, `campaign_id` | ✅ | `:145`, `:146` | Neither is implied by `UNIQUE (post_id, ai_original_id)`, which leads on `post_id`. Correct. |
| A6 `UNIQUE (post_id, revision)`, no `updated_at`, no `set_updated_at` | ✅ | `:37`; absence confirmed | The only trigger on the table is the write-once rejection. `updated_at` deliberately omitted with a recorded rationale ("would be a lie about a column that can never change"). |
| A6 `schema_version` from a named constant | ✅ | `lib/db/post-ai-originals.ts:9`; used at `generate.ts:409`, `posts/actions.ts:366` | `AI_ORIGINAL_SCHEMA_VERSION = 1`. No inline literal at any writer. |

### Section B — The write-once + capture triggers

| Check | Status | `file:line` | Note |
|---|---|---|---|
| B1 write-once is **BEFORE UPDATE ONLY** | ✅ | `learning_capture.sql:64-67` | `BEFORE UPDATE ON public.post_ai_originals`. **No `OR DELETE` in any form.** `:39-55` names the exact hazard — `purge_business` (`20260702120700_purge_business_member_delete.sql:62`) has **no EXCEPTION block anywhere in its body**, so a `BEFORE DELETE` guard here would raise inside the root `DELETE FROM public.businesses` and abort GDPR erasure for **every business that ever generated a post**. `[db-BLOCKER-1]` correctly adopted. |
| B1 UPDATE rejected / cascade DELETE succeeds, executed | ✅ | `write-once-and-erasure.test.ts:111-125`, `:128-215` | UPDATE rejection asserts the message contains `immutable` **and** re-reads to prove the row is unchanged. |
| B2 transition guard in the FUNCTION BODY, not a `WHEN` clause | ✅ | `learning_capture.sql:191` | `IF OLD.status = 'draft' AND NEW.status = 'approved' THEN` inside the body; the trigger at `:227-229` is a bare `AFTER UPDATE ... FOR EACH ROW`. `[sec-LOW-2]` adopted. |
| B2 does NOT fire on other posts UPDATEs | ✅ | `learning-capture-trigger.test.ts:147`, `:160` | Two Tier-1 tests: an unrelated UPDATE (schedule change, status unchanged) and a non-`draft→approved` transition. I additionally re-derived that `requeueScheduledPost` (`lib/db/posts.ts:657`) writes `status='approved'` guarded on `.eq('status','scheduled')` — `OLD.status` is `'scheduled'`, so the trigger correctly cannot fire. No duplicate-with-stale-content path exists. |
| B3 `ai_original_id NOT NULL` + explicit skip branch | ✅ | `:104`, `:203-204` | `IF v_origin_id IS NOT NULL THEN`. `[db-MAJOR-1]` adopted. |
| B3 approving a snapshot-less post SUCCEEDS, enqueues nothing | ✅ | `learning-capture-trigger.test.ts:170-184` | Asserts the post reaches `status='approved'` (`:181`) — i.e. the UPDATE was not aborted — and no signal row exists. This is the core approval flow, not a corner case. |
| B4 trigger body does ONE INSERT and nothing else | ✅ | `:186-226` | Read line by line: (1) the transition `IF`; (2) one `SELECT id … ORDER BY revision DESC LIMIT 1`; (3) one `INSERT … ON CONFLICT DO UPDATE … WHERE status='pending'`. **Zero** diffing, text processing, network calls, memory writes. `LEARN-TRIGGER-ENQUEUE-ONLY` holds; no D-6 contradiction. |
| B5 COPIES `NEW.content`/`NEW.hashtags` into the row | ✅ | `:209-210` | The queue row freezes the human-approved text at approval time. The TOCTOU this closes is real: `updatePostContent`'s guard is `.in('status', ['draft','approved'])` (`lib/db/posts.ts:482`), so a post **can** be edited after approval — a worker re-reading `posts.content` at claim time would diff a version the human never approved. Copying is correct and load-bearing. |
| B6 Tier-1 raw `UPDATE posts SET status='approved'` from **no app code** | ✅ | `learning-capture-trigger.test.ts:7`, `:134` | Issued via a raw `pg` client with zero application code in the path — the proof that makes `LEARN-CAPTURE-ALL-CALLERS` *structural* rather than enumerated. Plus `:253`: a bulk approve of N rows in **one statement** produces N outbox rows (the `bulkApproveDraftPosts` shape). |
| B7 unapprove → re-approve refreshes `pending`, leaves `processed` untouched | ✅ | `:203`, `:226` | Both directions tested at Tier-1 against live Postgres. This is the real duplicate path §0.2/A-1 named, and it is proven, not asserted. |

### Section C — The snapshot

| Check | Status | `file:line` | Note |
|---|---|---|---|
| C1 payload **and** `rendered_content`; byte-identical to `posts.content` | ✅ | `generate.ts:390-412` | Byte-identity is *structural*, not merely tested: the same `renderedContent` local feeds both `PostInsert.content` (`:368`) and `PostAiOriginalInsert.rendered_content` (`:409`). It cannot drift. `payload: g.output` stores the `SinglePostOutput \| ThreadOutput` union verbatim. |
| C1 (bonus) post ids generated client-side | ✅ | `generate.ts:329-341` | `crypto.randomUUID()` per post, passed into the insert, so the snapshot write never depends on `RETURNING` row order — a genuine correctness risk designed out rather than tested around. |
| C2 regenerate writes `revision+1`, `generation_kind='regeneration'` | ✅ | `posts/actions.ts:359-370` | Without this the AI's own rewrite would be attributed to the human — §2.2's named failure. Closed. |
| C2 snapshot written **before** `posts.content` update | ✅ | `posts/actions.ts:359` then `:372` | Correctly reordered (`:330-336` records why): snapshot-first means a failed snapshot leaves `posts.content` untouched and the action is safe to retry. Snapshot-after would have silently lost that revision's ground truth on any retry. |
| C2 `23505` catch-and-retry | ✅ | `post-ai-originals.ts:69-88` | `[db-MINOR-1]` adopted: reads `error.code` on the **raw** Supabase error before wrapping, retries up to `maxAttempts=3`, re-reading the now-updated latest revision. |
| C3 snapshot-less posts skipped **and counted**, never fabricated | ✅ | `orchestrator.ts:173-181` | `skippedNoSnapshot` is distinct from `abandoned`, precisely so §11's operator playbook stays meaningful. |
| C4 `PostUpdate` unchanged | ✅ | `git diff 717263d2..d7cee4a5 -- lib/db/types.ts` | No `ai_original`-shaped field added; no speculative `Omit`. |
| C5 can the snapshot write fail unnoticed? | ⚠️ | `generate.ts:398-413`, `:444-467` | **Partly.** The write is correctly awaited, `Promise.all`-propagated, and deliberately *not* wrapped in a swallowing catch; the outer catch now logs + Sentry-captures + marks the session failed (a real prior gap this range closed). But the posts were committed one statement earlier and are **not** rolled back. See **MAJOR-3**. |

### Section D — Diff + classifier

| Check | Status | `file:line` | Note |
|---|---|---|---|
| D1 no diff library added | ✅ | `git diff 717263d2..d7cee4a5 -- package.json` → **empty** | Zero dependency changes across all nine commits. L-13 held. |
| D2 `classify()` is pure | ✅ | `classify.ts`, `diff.ts` (whole files) | Traced transitively: no `Date`, no `Math.random`, no network, no Anthropic client. Every non-type import is `lib/learning/{constants,diff}`, both pure. `CoreVoiceRules`/`EvidenceMemoryRow` are `import type`. No LLM call per post — the L-1 STOP holds. |
| D3 determinism **tested**, not asserted | ✅ | `classify.test.ts` | Same fixture pair run twice, outputs JSON-diffed for byte-identity. Plus a **source-scan** asserting no `anthropic`/`runPrompt`/`@/lib/ai/` import on the path — that reddens on a future import, which a behavioural test would not. |
| D4 all kinds implemented, correct partitions | ✅ | `classify.ts:41-53`, `:128-274` | 9 preference + 1 correction + 2 inconclusive, each landing in the partition the ADR assigns. `length_delta` gated at `LEARN_LENGTH_DELTA_MIN_PCT` and boundary-tested below/above. |
| D4 thread delimiter matches `joinContent` | ✅ | `diff.ts:11` vs `generate.ts:51-56` | `THREAD_SEGMENT_DELIMITER = '\n\n---\n\n'`, byte-identical to `joinContent`'s `.join('\n\n---\n\n')`, and documented as a contract. A guessed delimiter would silently mis-detect every thread edit; it is not guessed. |
| D4 kind **count** matches the ADR | ⚠️ | `classify.ts:41-53` vs ADR §0/Q4, §4.3, §12, §13 | Twelve kinds exist; the ADR says "eleven" in four places and `orchestrator.ts:62` repeats it. See NIT-1. |

### Section E — Correction vs preference

| Check | Status | `file:line` | Note |
|---|---|---|---|
| E1(a) partitioned return; no `Signal[]` anywhere | ✅ | `classify.ts:78-82` | `ClassifyResult = { preferences, corrections, inconclusive }`, all `readonly`. Full-tree grep: no `Signal[]` type exists. There is nothing to `.filter()` and forget — L-6's footgun is structurally gone. |
| E1(a) `_class` a literal, never widened; no index signature | ✅ | `classify.ts:63-76` | Three **required** literal `_class` fields plus three fully disjoint `kind` vocabularies. Because both discriminants are required literals over disjoint value sets, TypeScript's structural typing genuinely rejects cross-assignment — the "required literal tag" case, not the "optional tag" trap. `SignalDetail = Record<string, unknown>` is the nested `detail` payload — a field, **not** an index signature on the signal interfaces. |
| E1(b) `LEARN-VOICE-WRITE-TRIGGER` is a DB trigger, not a service-role `if` | ✅ *in form* | `20260726020000_performance_memory_pattern_key.sql:80-115` | A real `BEFORE INSERT OR UPDATE` trigger that `RAISE`s. `[type-4]`'s theatre was **not** shipped. |
| E1(b) …and it actually fires on the shipped write paths | ❌ | see **MAJOR-1** | It cannot. Both shipped writers construct rows the `EXISTS` join can never match. |
| E2 `@ts-expect-error` compile assertion is load-bearing | ✅ | `classify.types.test.ts:20-29` | Read literally. It fails **closed in both directions**: today because `readonly CorrectionSignal[]` is genuinely unassignable to `VoiceDirectedWriterInput`; and if a future PR widened `_class`/`kind` to `string` (the exact regression it guards), the assignment would succeed and the now-**unused** `@ts-expect-error` directive would itself become a `tsc` error under this project's strict convention. Not decorative. |
| E3 rehydration choke point named, Zod `.literal()` guard | ⚠️ | `rehydrate.ts:54-76`, `:89-91` | The guard is exactly right: `z.literal()` per `_class`, `z.enum()` per kind vocabulary, plus compile-time `Assert<Equals<…>>` tying the Zod enums back to the TS unions so they cannot drift. Tested at `rehydrate.test.ts:47-62`. **But it has no production caller** — MINOR-1. |
| E4 `LEARN-CORRECTION-REQUIRES-BRIEF` | ✅ | `classify.ts:238-244` | Re-derived by reading, not by test name: `if (pinnedEvidence.length === 0) { inconclusive.push(… reason: 'no_pinned_evidence'); continue }`. The `corrections.push` at `:262` is unreachable when the pinned set is empty. Both the "no brief" and "brief with an empty pinned set" cases are separately tested. **A brief-less post cannot produce a correction.** The guard whose absence would have flooded false corrections is present and correct. |
| E5 the ADR's own honesty survives | ✅ *in the ADR* / ⚠️ *in one comment* | ADR §5.3-§5.4; `20260726020000…sql:107-109` | The ADR keeps `[type-1]`'s framing and `[type-7]`'s plain statement that the type layer cannot validate the tag was assigned correctly — no "unrepresentable". The one overclaim is the trigger's own `RAISE` text: *"must be sourced entirely from preference-class signals"*, which is not the invariant the pipeline maintains (MAJOR-1). |

### Section F — Memory write + promotion

| Check | Status | `file:line` | Note |
|---|---|---|---|
| F1 `observation_count` RECOMPUTED, never incremented | ✅ | `promote.ts:113,128`; `20260726030000…sql:68` | `git grep -nE "observation_count[^;]*\+\|\+\+\|\+ 1" d7cee4a5 -- lib/learning/*.ts lib/db/memory-performance.ts supabase/migrations/20260726*.sql` (tests excluded) returns **zero** hits touching `observation_count`. Every `++` is an in-memory tick counter (`orchestrator.ts:141,187,195,234,249-251,265,277,325,334`) or a retry counter. SQL side is `observation_count = EXCLUDED.observation_count`. `promote.test.ts:125` pins it. |
| F2 `pattern_key` from kind+direction+platform, never prose | ✅ | `pattern-key.ts:36-38` | `[signal.kind, directionFor(signal), signal.platform].join(':')`. Never touches `detail.sentence`. `computePatternKey` accepts **only** `PreferenceSignal` — a correction cannot produce a key, enforced by the type signature. Platform is embedded in the key because the voice-trigger join matches on `(business_id, pattern_key)` alone. |
| F2 determinism tested in **both** directions | ✅ | `pattern-key.test.ts` | Same phenomenon → same key; different kind/platform → different key; `length_delta` sign-vs-magnitude both ways; all four no-opposite kinds enumerated for `computeContradictingPatternKey`'s `null`. Both silent failure modes covered. |
| F3 `CHECK (source <> 'distilled' OR pattern_key IS NOT NULL)` | ✅ | `20260726020000…sql:16-18` | `[db-MAJOR-2]` adopted, with an explicit note that on a non-empty table this fails loudly at apply time — the correct behaviour. |
| F3 partial-UNIQUE predicate repeated at **every** `ON CONFLICT` | ✅ | `20260726030000…sql:63` | Predicate repeated exactly. Verified this is the **only** `ON CONFLICT` targeting `performance_memory` in the range. `post_edit_signals`' `ON CONFLICT (post_id, ai_original_id)` (`learning_capture.sql:212`) targets a full non-partial UNIQUE, so no predicate is required there. The RPC-not-query-builder choice is correct and correctly justified: `.upsert({ onConflict })` cannot express a partial index. |
| F4 all three gates in ONE atomic conditional UPDATE | ✅ | `20260726030000…sql:112-127` | `observation_count >= 5 AND confidence >= 0.70 AND (SELECT count(DISTINCT pes.campaign_id) …) >= 2`, all inside one `UPDATE … WHERE`, with `status='candidate'` as the transition guard. No read-then-update: `promote.ts:106` calls the RPC unconditionally. Postgres evaluates the whole predicate including the subquery against one MVCC snapshot and locks the row before applying — double-promotion is structurally impossible, and `performance-memory-promotion.test.ts` proves it with **10 parallel RPC calls asserting exactly one success**. |
| F4 the distinct-campaign gate makes L-7 real | ✅ | same | Five observations in one campaign is one editing session; the gate rejects it. Tested at Tier-1 with a real 1-campaign no-op case. |
| F5 `K=2` and the 0.714-at-5 interaction intact, boundary-tested | ✅ | `promote.ts`; `promote.test.ts` | `computeConfidence(5,0) = 5/7 ≈ 0.714 ≥ 0.70` passes; with `K=3` it would be `5/8 = 0.625 < 0.70`, making `MIN_OBSERVATIONS=5` unreachable and the constant a lie. Explicit `K=2` vs `K=3` comparison, plus 4-vs-5 observation and 1-vs-2 campaign boundaries. |
| F6 demotion has an explicit `status='active'` guard; never deletes | ✅ | `20260726030000…sql:164`, `:137` | `AND status = 'active'` inside the same atomic UPDATE (`[db-MINOR-3]`); moves to `'candidate'`, never `DELETE`. |
| F6 decay is `expires_at`-based with no new job | ⚠️ | `20260726030000…sql:61` | Written, but **no query in this range reads it** — MINOR-6. |
| F7 distilled write OMITS likes/impressions | ✅ | `20260726030000…sql:48-56`; `lib/memory/performance.ts:11-23` | Not columns on the table, not parameters of the RPC. There is no `0` anywhere — the resurrected-inversion shape is absent. |
| F8 everything through `lib/db/memory-performance.ts` + `lib/memory/` | ✅ *by grep* / ⚠️ *untested* | `git grep "\.from('performance_memory'\|'post_ai_originals'\|'post_edit_signals')" d7cee4a5 -- lib/learning/` → **no match** | True today; no test asserts it — MINOR-2. |
| F9 nothing writes `brand_voices` / `brand_voice_variations` | ✅ | `git grep "\.from('brand_voice" d7cee4a5 -- lib/learning/ app/api/cron/capture-learning/` → **no match** | Only mention is a comment at `classify.ts:116`. No voice table created (`ls supabase/migrations \| grep voice_memory` → empty). **The L-9 STOP holds — no BLOCKER here.** |

### Section G — The summarizer

| Check | Status | `file:line` | Note |
|---|---|---|---|
| G1 both gates required; each independently suppresses | ✅ | `summarize.ts:36-42`; `summarize.test.ts` | `signalsGatePasses && intervalGatePasses`. Tests isolate each: `{19 signals, 8 days}` fails on the signal gate alone; `{25, 3}` fails on the interval gate alone; `{20, 7}` passes exactly at the boundary (proving `>=` not `>`). Not an OR, not a single gate. |
| G2 shared `neutralize()` at RENDER time, hard length cap | ✅ | `learning-summarizer.ts:66,78`, `:80-85` | Guarded entirely inside `buildUserMessage` — render time, never authorship time (a later human edit re-enters the field after any one-time sanitize, so capture-time sanitizing would be a bypass; the code says exactly this). Uses the **shared** `neutralize()`, not the weak local `sanitizeDataField`. Hard cap `LEARNING_SUMMARY_MAX_INPUT_TOKENS * 4` chars on the **combined** input (the tierZero block's actual length is subtracted from the excerpt budget), and it **truncates** rather than warns. Proven with a hostile fixture in both directions. |
| G2 `tierZeroSummaries` guarded too | ✅ | `:78`, rationale at `:36-49` | Correctly refuses the tempting assumption that "distilled = arithmetic = safe": the summarizer is currently the **only** live writer of that bucket, and no column distinguishes an arithmetic row from an LLM row. Guarded identically. A genuinely good catch. |
| G3 one business per call; every query business-scoped; output takes the same variable | ✅ *by inspection* / ⚠️ *untested at Tier-2* | `summarize.ts:76-160`; `orchestrator.ts:320-322` | Traced the loop for a capture leak. `summarizeBusinessLearning(client, businessId)` takes the id as an explicit parameter; all five reads pass it explicitly; `buildCustomerContext(businessId)`; and the write at `:143` passes **the same parameter**, never anything derived from the LLM response. The orchestrator's `for (const businessId of touchedBusinessIds)` uses a per-iteration `const` — no closure capture. `summarize.test.ts` asserts a distinct `businessId` on **every** mock call. But no test claims two businesses' rows in one tick — **MAJOR-6**. |
| G4 bounded output schema, never falls through to an unvalidated write | ✅ | `learning-summarizer.ts:15-22` | 5 statements × 200 chars, `z.enum(['topic','hook','format','proof_type'])` — the ADR 0016 §3.4 fixed vocabulary, never free-form. `runPrompt` throws on parse failure rather than writing. |
| G4 not conflated with render-time neutralisation | ✅ | `learning-summarizer.ts:26-32` | `[sec-MEDIUM-3]` adopted verbatim and in the right words: named **orthogonal**, with an explicit "do not conflate the two or drop either". |
| G5 writes `candidate` rows only | ✅ | `summarize.ts:145-154`; `20260726030000…sql:41-46` | `status` is never set by the RPC — defaults to `'candidate'` on INSERT and is deliberately left **untouched** on a conflicting re-observation, so a re-observation can neither flip an active row back nor resurrect a retired one. `observation_count: 1` and `computeConfidence(1,0) ≈ 0.333` are each independently below a gate. |
| G6 Tier 1 only; no critique/regenerate or agentic loop | ✅ | `git grep -n "runPrompt\|anthropic\." d7cee4a5 -- lib/learning/*.ts` (non-test) → **one** call site, `summarize.ts:130` | One one-shot call per business per tick. Single fixed tier (Haiku 4.5), `[cost-1]` deviation named rather than silent. |
| G6 monthly ceiling enforced against `ai_usage` | ✅ | `summarize.ts:92-104` | `countRecentCalls(client, businessId, 30d, LEARNING_SUMMARIZER_PROMPT_ID) >= 8` → hard return. Counted from the existing table, no new tracking state. Non-atomic against a concurrent second invocation — recorded in-file rather than assumed away. |
| G — the summarizer's output can reach generation | ❌ | see **MAJOR-2** | It cannot. Structurally unpromotable. |

### Section H — Worker, route, idempotency

| Check | Status | `file:line` | Note |
|---|---|---|---|
| H1 `Sentry.withMonitor` applied, slug `capture-learning` | ✅ | `orchestrator.ts:307-345` | Wrapped, with `schedule: crontab '0 * * * *'`, `checkinMargin`, `maxRuntime`, thresholds. `runJanitorTick`'s missing wrap was **not** inherited — `:6-9` says so explicitly; `orchestrator.test.ts:514` asserts the slug. |
| H2 exactly ONE `console.log` on the tick path, §9.5 field set | ✅ | `orchestrator.ts:353` | One line, `kind: 'learning.tick'`, all 14 counters. `orchestrator.test.ts:481-510` asserts **exactly one** matching log line and its full field set. The route's two `console.warn`s are `cron-auth-failure`, byte-for-byte the shape `api/cron/publish/route.ts:18,50` already uses. |
| H3 replayed-tick test | ❌ | `orchestrator.test.ts:449-475` | Does **not** replay over the same fixture. See **MAJOR-4**. |
| H3 the underlying property nonetheless proven | ✅ | `promote.test.ts:125`; `learning-capture-trigger.test.ts:186,203,226,273` | Recompute-not-increment proven at Tier-2 one layer down and at Tier-1. This is why MAJOR-4 is not a BLOCKER. |
| H4 claim RPC: DEFINER, REVOKE/GRANT, SKIP LOCKED, disjoint under concurrency | ✅ | `learning_capture.sql:234-249`; `learning-capture-trigger.test.ts:273` | `SECURITY DEFINER`, `SET search_path = public, pg_temp`, `REVOKE ALL … FROM public`, `GRANT EXECUTE … TO service_role`, `FOR UPDATE SKIP LOCKED`. Disjointness tested at Tier-1, correctly scoped against pre-existing rows. |
| H5 transient retries with backoff → max attempts → abandon; permanent abandons immediately | ✅ | `orchestrator.ts:255-280`; tests at `:356,374,392` | Three genuinely distinct branches (permanent 23xxx / transient-exhausted / transient-with-backoff), each with its own terminal state and counter. Each tested. |
| H5 unknown `schema_version` REFUSES to diff | ✅ | `orchestrator.ts:183-189` | Abandons with `unknown_schema_version:N`. **No best-effort parse.** `orchestrator.test.ts:341` asserts `classify()` is never called. §2.4 satisfied exactly — the one place a best-effort parse would have fed wrong signals into a confidence counter. |
| H5 no error swallowed; every terminal outcome writes `last_error` + a counter | ⚠️ | `orchestrator.ts:126-149`, `:255-280` | Very strong: `guardedTransition` treats a `null` return (lost race) as its own terminal outcome with `raceLost++` and a Sentry capture rather than falling through; the entire `processRow` body including the snapshot lookup is inside one try/catch (a prior BLOCKER where a throw there stranded the rest of the batch at `status='processing'`, which the claim RPC never reclaims). Two residual counter defects — MINOR-3, MINOR-4. |
| H6 route mirrors `publish/route.ts` | ✅ | `capture-learning/route.ts:1-81` vs `publish/route.ts:1-52` | QStash `verifyQStashRequest`; `timingSafeEqual` bearer fallback with a length pre-check (**not** `===`); `x-cron-dev-trigger` honoured in non-prod only; `GET` 405s in qstash mode and `POST` 405s otherwise — **both directions**; always 200 so a non-2xx never triggers an unwanted retry. The route takes no request body, so there is nothing for Zod to validate (same as `publish`). `route.test.ts` covers the full auth matrix incl. the dev-bypass-not-consulted-in-qstash-branch case. |
| H6 runbook row added | ✅ | `docs/build-guide/runbooks/qstash-setup.md` (+25 lines) | Hourly `capture-learning` schedule row present. |
| H7 config via `lib/config.ts` only; date-fns `formatISO` | ✅ | `lib/config.ts` (+38 lines); `orchestrator.ts:12,192,246,258,269` | `LEARNING_BATCH_SIZE`, `LEARNING_MAX_ATTEMPTS`, `LEARNING_RETRY_BACKOFF_SECONDS`, `CRON_TRIGGER` all via `config.server.*`. No `process.env` outside `config.ts`. Every app-layer timestamp is `formatISO(...)`. |

### Section I — Scope + process

| Check | Status | Evidence | Note |
|---|---|---|---|
| I1 no Mode 1 / Mode 3 / mining / insight cards | ✅ | full-range file list | None present. |
| I1 no `relationship_memory`, no embeddings, no skip-review fast path | ✅ | migration list; grep | None. |
| I1 no `campaign_brief_revisions`, no voice table | ✅ | `git grep -l campaign_brief_revisions d7cee4a5 -- supabase/migrations/` → none; `grep voice_memory` → none | `LEARN-BRIEF-DIFF-DEFERRED` and `LEARN-VOICE-SUGGESTION-DEFERRED` hold. |
| I1 no user-facing route | ✅ | `git diff --diff-filter=A --name-only 717263d2..d7cee4a5 -- 'app/[locale]/(dashboard)'` → **empty** | Q8 "pipeline-only, no UI in Track C" held. |
| I1 no new i18n keys | ✅ | `git diff --stat 717263d2..d7cee4a5 -- i18n/` → **empty** | Correct — nothing user-facing shipped. |
| I1 no new dependency | ✅ | `git diff 717263d2..d7cee4a5 -- package.json` → **empty** | L-13 held across all nine commits. |
| I2 render-guard expansion stayed bounded | ✅ | `git show --stat be5779e1` | C2.1 touched exactly 4 files: `post-generation.ts` + test, `post-regeneration.ts` + test. **No opportunistic sweep of other prompt fields; no `sanitizeDataField` consolidation** (`[sec-LOW-3]`, declined). Bare `neutralize()` per site, rationale recorded per site. Exemplary scope discipline. |
| I3 ADR 0016 Amendment B is APPEND-ONLY | ✅ | `git diff 717263d2..d7cee4a5 -- docs/decisions/0016-governed-memory.md` → `@@ -618,3 +618,33 @@` | 30 lines added at EOF; **zero deletions, zero modifications**. §3.4's original text untouched, and the amendment says so itself. No process violation. |
| I4 every §14 "Adopted" disposition actually shipped | ⚠️ | §3 below | 26 of 27 landed. `[type-4]` landed in form but not in effect (MAJOR-1). |
| I5 no `any` outside the two carve-outs | ✅ | `git grep -nE ": any\b\|as any\b\|<any>" d7cee4a5 -- lib/learning/ lib/db/post-*.ts lib/db/memory-performance.ts app/api/cron/capture-learning/ lib/ai/prompts/learning-summarizer.ts` → **empty** | All narrowing via `unknown` + type guards. No new carve-out needed. |
| I5 service-role lazy-imported, never in a user-facing read path | ✅ | `orchestrator.ts:311` | `await import('@/lib/supabase/service')` inside the tick, per CLAUDE.md's pattern. |
| I5 new list queries bounded with an explicit ORDER BY | ⚠️ | `post-edit-signals.ts:63-73`; `memory-performance.ts:11-27,49-67`; `post-ai-originals.ts:24-33` | All production queries bounded and ordered. Two in `scripts/learning-report.ts` are not — MINOR-7. |
| I6 one step, one commit; C2.1 precedes C2.6 | ✅ | `git log --oneline 717263d2..d7cee4a5` | Nine commits map cleanly to C2.1…C2.9 with no bleed. `be5779e1` (C2.1, render guard) is the **first** commit; `c03de1bf` (C2.6, the distillation writer) is five commits later. **There is no commit range in which the writer is live and the guard is not** — §0.2/A-2 satisfied. |

---

## 3. ADR §14 — all dispositions walked (I4)

The §14 table contains **27 rows** (the ADR's prose says 28 — NIT-5). Every one verified at the range:

| Finding | Disposition | Shipped? | Evidence |
|---|---|---|---|
| BLOCKER-1 `BEFORE UPDATE OR DELETE` breaks erasure | Adopted | ✅ | `learning_capture.sql:64-67` UPDATE-only; `:91-95` no authenticated DELETE policy |
| MAJOR-1 snapshot-less posts | Adopted | ✅ | `:104` NOT NULL; `:203-204` skip branch; `orchestrator.ts:173-181` counted |
| MAJOR-2 `pattern_key` CHECK | Adopted | ✅ | `20260726020000…sql:16-18` |
| HIGH-2 `topContent` render guard | Adopted | ✅ | `post-generation.ts:179`, `post-regeneration.ts:147` (two real sites; the "third" does not exist — NIT-2) |
| MEDIUM-1 §D2.5 rows annotated | Adopted | ✅ | `0010-legal-surface.md:1071-1072` |
| MEDIUM-2 same-tenant content laundering | Accepted residual | ✅ | recorded in ADR §6.3, no code claim made |
| MEDIUM-3 schema ≠ neutralisation | Adopted | ✅ | `learning-summarizer.ts:26-32` |
| Q2 summarizer one-business scoping | Adopted + test obligation | ⚠️ | code correct (`summarize.ts:76-160`); the **test obligation** is only partly discharged — MAJOR-6 |
| LOW-1 direct `post_id` FK | Adopted | ✅ | `learning_capture.sql:30` |
| LOW-2 guard in body not `WHEN` | Adopted | ✅ | `:191` |
| LOW-3 `sanitizeDataField` consolidation | **Declined** | ✅ | correctly **not** done — I2 |
| Q4 index shapes | Adopted verbatim | ✅ | `:128-146` |
| Q5 `coalesce(platform,'')` | Adopted | ✅ | `20260726020000…sql:26-28` |
| Q6 atomic promotion + same rigour for demotion | Adopted | ⚠️ | promotion fully atomic (`…030000…sql:112-127`); demotion's threshold is caller-supplied — MINOR-8 |
| MINOR-1 `23505` catch-and-retry | Adopted | ✅ | `post-ai-originals.ts:69-88` |
| MINOR-2 no retention policy | Named gap | ✅ | recorded, not silently dropped |
| MINOR-3 demotion atomic guard | Adopted | ✅ | `…030000…sql:164` |
| NIT-1 InitPlan RLS form | Adopted | ✅ | all 7 policies |
| NIT-2 multi-parent cascade documented | Adopted | ✅ | `learning_capture.sql:20-25` |
| type-1 drop "unrepresentable" | Adopted | ✅ | ADR §5.3 |
| type-2 `_class` primary discriminant | Adopted | ✅ | `classify.ts:30-38` records which is primary and which is fallback |
| type-3 plain interfaces, no `#private` class | Adopted | ✅ | `classify.ts:63-76`; rejection recorded |
| **type-4 DB trigger, not a service-role `if`** | Adopted | ⚠️ **form only** | trigger exists (`…020000…sql:80-115`) but cannot fire on either shipped path — **MAJOR-1** |
| type-5 rehydration choke point + runtime guard | Adopted | ⚠️ | exists and is correct; **no production caller** — MINOR-1 |
| type-6 `@ts-expect-error` regression test | Adopted | ✅ | `classify.types.test.ts` — load-bearing, verified by reading |
| type-7 the type layer can't validate the tag | Adopted | ✅ | stated plainly in ADR §5.4 |
| cost-1 single fixed tier | Adopted, deviation named | ✅ | `learning-summarizer.ts:87-92` |

**26 of 27 landed. One (`type-4`) landed as an artefact but not as the property it was adopted to deliver.**

---

## 4. Findings

### BLOCKER

**None.** No finding in this range blocks merge. I explicitly cleared the four highest-risk candidates:
the write-once trigger carries no `OR DELETE` and GDPR erasure provably succeeds (B1/A4); no code writes
`brand_voices` (F9); no dependency, route, i18n key, or out-of-scope table shipped (I1); and both
`db-tests` and `app-tests` ran green on the range head with every Tier-1 file visible and non-empty (J3).

---

### MAJOR

#### MAJOR-1 — `LEARN-VOICE-WRITE-TRIGGER` is structurally unreachable from both shipped write paths; the invariant its own error message asserts is not the invariant the pipeline maintains

**Where:** `supabase/migrations/20260726020000_performance_memory_pattern_key.sql:96-113`;
`lib/learning/orchestrator.ts:98-123` (`canonicalize`); `lib/learning/summarize.ts:64-71`, `:143-155`;
`lib/db/post-edit-signals.ts:63-73`.

The trigger rejects a `source='distilled'`, `dimension IN ('format','hook')` write when:

```sql
EXISTS (SELECT 1 FROM public.post_edit_signals
         WHERE business_id = NEW.business_id
           AND pattern_key = NEW.pattern_key
           AND class IS DISTINCT FROM 'preference')
```

Both shipped writers construct rows this join can never match:

1. **The Tier-0 path.** `canonicalize()` (`orchestrator.ts:107-123`) sets `pattern_key` **only** when
   `rowClass = 'preference'`; a `correction`- or `inconclusive`-classed row gets `pattern_key = NULL`.
   So every row with a non-NULL `pattern_key` has `class='preference'` **by construction**, and every row
   that could fail the check has `pattern_key = NULL`, which never equals a non-NULL `NEW.pattern_key`.
   The `EXISTS` is unsatisfiable. The comment at `:98-110` states this is deliberate — the canonical
   class was chosen *specifically so the trigger would not block the write*.
2. **The Tier-1 summarizer path.** `computeSummaryPatternKey` (`summarize.ts:64-71`) namespaces its key
   `summarize:<dimension>:<hash>`, which by design "can never collide with a Tier-0 key". That property
   also guarantees it never matches **any** `post_edit_signals.pattern_key`, so the `EXISTS` is again
   unsatisfiable. And this path is worse: `listRecentHumanEditExcerpts` (`post-edit-signals.ts:63-73`)
   filters only on `business_id` and `status='processed'` — **there is no `class` filter** — so raw human
   copy from `correction`- and `inconclusive`-classed rows feeds the LLM, whose output is written with
   `dimension` drawn from `z.enum(['topic','hook','format','proof_type'])`, including the two
   voice-directed dimensions the trigger exists to guard.

Net: a correction-derived statement *can* occupy a `dimension='hook'` distilled memory row, and the DB
guard cannot see it. The `RAISE` text — *"must be sourced entirely from preference-class signals"* — is
false for exactly the rows it was written to police.

**Why MAJOR and not BLOCKER.** The blast radius is bounded by an unrelated mechanism: such a row is
written `status='candidate'` and can never be promoted (MAJOR-2), and `listPerformanceMemoryCandidates`
(`memory-performance.ts:11-27`) filters `.eq('status','active')`. **No correction-derived text can reach
a generation prompt today.** The safety property holds; the *stated enforcement* does not. That makes it
a latent trap — one that the next session to touch promotion will spring silently.

**Fix:**
1. Add `.eq('class', 'preference')` to `listRecentHumanEditExcerpts` (`post-edit-signals.ts:63-73`) so
   correction/inconclusive copy never enters the summarizer at all. Smallest change; closes the
   summarizer half outright.
2. For the Tier-0 half, either extend the trigger's `EXISTS` so it is satisfiable — match contributing
   signals on `(business_id, pattern_key)` **or** on the same `(business_id, post_id)` carrying a
   non-preference class, making "this pattern drew on a diff that also contained a correction"
   expressible — **or**, if the current behaviour is intended (a preference is a preference even when a
   correction co-occurred), amend ADR §5.3 and the `RAISE` message to say so and add a Tier-3 entry
   recording that the trigger's live scope is *other* write paths (manual backfill, future jobs, ad-hoc
   queries) rather than the Track-C pipeline. Either resolution is acceptable; keeping a guard whose
   message overstates what it guarantees is not.
3. Add a Tier-1 test that writes a `post_edit_signals` row with `class='correction'` **and** a non-NULL
   `pattern_key`, then attempts the matching `dimension='hook'` distilled write and asserts the RAISE.
   `performance-memory-pattern-key.test.ts` proves the trigger fires when handed such a row directly —
   correct and valuable — but nothing proves the *pipeline* can produce that row, and it cannot.

---

#### MAJOR-2 — The entire C2.7 Tier-1 summarizer is write-only: its output is structurally unpromotable and therefore unreachable by generation

**Where:** `supabase/migrations/20260726030000_performance_memory_promotion.sql:118-127`;
`lib/learning/summarize.ts:64-71`, `:143-155`; `lib/db/memory-performance.ts:11-27`.

`promote_performance_pattern`'s third gate is:

```sql
AND (SELECT count(DISTINCT pes.campaign_id) FROM public.post_edit_signals pes
      WHERE pes.business_id = p_business_id
        AND pes.pattern_key = p_pattern_key
        AND pes.status = 'processed') >= 2
```

For a summarizer row, `p_pattern_key` is `summarize:<dimension>:<hash>`, which — by the same
never-collides-with-Tier-0 property the code relies on — matches **zero** `post_edit_signals` rows. The
subquery is always `0`, so `0 >= 2` is always false. A summarizer row can therefore **never** reach
`status='active'`, at any volume, for any duration. And `listPerformanceMemoryCandidates` — the only
generation-time reader — filters `.eq('status','active')`.

Consequence: every Haiku call the summarizer makes produces rows that only the summarizer itself ever
reads back (via `listDistilledPatternsForSummary`, which deliberately does not filter on `active`,
`memory-performance.ts:29-67`). It is a closed loop that costs tokens and cannot influence the product.

I do not believe this was intended. ADR §6.1 says summarizer output "gets no shortcut into active" —
"no shortcut" is a very different claim from "no path whatsoever", and nothing in the ADR, the code
comments, or the C2.9 report records the stronger property. `summarize.ts:145-152` reasons carefully
about *why* a fresh statement cannot promote (confidence 0.333 < 0.70; `observation_count` 1 < 5) — both
gates a repeat observation would eventually clear — and does not notice the campaign gate makes the
question moot forever.

**Fix:** decide, and record, which is intended:
(a) summarizer rows are permanently candidate-only — then state it explicitly in ADR §6.1 and in
    `summarize.ts`, add it to §12's Tier-3 list, and stop describing the promotion gates as if they
    applied; or
(b) summarizer rows should be promotable — then the campaign gate needs a summarizer-aware branch (count
    distinct campaigns among the signals that fed the summarization window, or exempt
    `pattern_key LIKE 'summarize:%'` from the campaign gate while keeping the observation and confidence
    gates).
Either way, add a Tier-1 test asserting the chosen behaviour: today nothing tests promotion of a
`summarize:`-keyed row in either direction.

---

#### MAJOR-3 — A failed snapshot write after `createPosts` leaves live, approvable draft posts permanently and invisibly outside the learning loop

**Where:** `lib/campaigns/generate.ts:380`, `:398-413`, `:444-467`;
`supabase/migrations/20260726010000_learning_capture.sql:203-204`; `lib/db/posts.ts:257-271`;
`scripts/learning-report.ts`.

Surfaced by `silent-failure-hunter` as a BLOCKER; I re-derived it and regrade it MAJOR (reasoning below).

`createPosts` commits N post rows in one call. The snapshot writes are a **second, independent** round
trip. If any one fails, `Promise.all` rejects, the outer catch fires — logs `campaign.generate.failed`,
captures to Sentry, marks the **session** failed, returns `postsCreated: 0`. It does **not** delete or
flag the already-committed posts, and because `Promise.all` surfaces only the first rejection it does not
even know which post ids succeeded.

Those posts remain live `status='draft'` rows. `listPostsByCampaign` filters on `campaign_id` and
`deleted_at` only — nothing ties a post back to its generation session's outcome — so they render and are
approvable exactly like posts from a successful session. On approval the trigger's
`IF v_origin_id IS NOT NULL THEN … END IF` has **no `ELSE`**: no log, no counter, no row. The post is
silently outside the learning loop forever, and there is no backfill (Q1: "no backfill; ships empty").
`scripts/learning-report.ts` aggregates `post_edit_signals` and `performance_memory` — it never diffs
`posts` against `post_ai_originals`, so the one founder-facing observability tool this track built cannot
see the gap either.

**Why MAJOR and not BLOCKER:** snapshot-less posts are an *anticipated* state the design handles
correctly and safely (the approve does not fail — that was `[db-MAJOR-1]`, correctly adopted); no customer
data is corrupted or leaked; and the failure **is** operator-visible at session granularity via the new
log line and Sentry capture. What is missing is per-post attribution and any way to find orphans after
the fact. A real gap in a track whose thesis is that this signal must stop being thrown away — but a
coverage gap, not a correctness or safety failure.

**Fix (any one closes it; (c) is the cheapest and is my recommended minimum):**
(a) Move the post insert and the snapshot insert into one Postgres function so they share a transaction.
(b) Use `Promise.allSettled` and, on partial failure, soft-delete the specific snapshot-less posts or
    mark them queryably before returning failed.
(c) Add an orphan query — `posts` with `deleted_at IS NULL` and no matching `post_ai_originals` row — to
    `scripts/learning-report.ts`, plus a Tier-1 test asserting it returns zero on a healthy fixture and
    non-zero on a seeded orphan. This gives `[db-MAJOR-1]`'s deliberate silent skip the operator-visible
    counterpart it currently lacks.

---

#### MAJOR-4 — `orchestrator.test.ts`'s `LEARN-TICK-IDEMPOTENT` test does not exercise the property it names

**Where:** `lib/learning/orchestrator.test.ts:449-475`.

The test is named *"replayed tick (LEARN-TICK-IDEMPOTENT)"*, and C2.8's commit message states
*"replayed-tick test proves LEARN-TICK-IDEMPOTENT (recompute, not increment)."* It does not. It stubs
`mockClaimPostEditSignals.mockResolvedValueOnce([signalRow]).mockResolvedValueOnce([])` — the second tick
is *given* an empty batch — then asserts the second tick writes nothing. That proves "an empty claim batch
is a no-op", which is close to tautological against a mocked claim. It **presupposes** the thing it should
demonstrate (that a replay claims nothing), and never touches recompute-vs-increment at the orchestrator
level. It would not redden if the orchestrator were changed to increment.

Under a strict reading of the checklist's H3 this is a BLOCKER. I grade it MAJOR because the underlying
property genuinely is proven elsewhere and I verified each piece: `promote.test.ts:125` (asserts the
recomputed COUNT reaches the upsert), `learning-capture-trigger.test.ts:186` (UNIQUE rejects a duplicate),
`:203`/`:226` (unapprove→re-approve refreshes pending, leaves processed untouched), and the claim RPC's
`status='pending'`-only predicate. `LEARN-TICK-IDEMPOTENT` is *covered*; what is wrong is that the test
carrying its name is not what covers it — precisely the "trust the assertion, not the name" failure mode
ADR 0015 exists to catch.

**Fix:** either (a) rename the test to what it proves ("no-op on an empty claim batch") and re-map
`LEARN-TICK-IDEMPOTENT`'s Tier-2 half in ADR §13 to `promote.test.ts:125`; **or** (b) make it a real
replay — return the same `signalRow` from **both** claims and assert `recomputeAndUpsertPattern` receives
an identical (not cumulative) `observation_count` on both invocations. (b) is preferable; (a) is
acceptable and honest. Do not leave the current name over the current assertion.

---

#### MAJOR-5 — The governing ADR and the build guide are untracked; the spec is not in git at the range it governs

**Where:** `docs/decisions/0018-diff-based-learning-capture.md`, `docs/build-guide/session-25.md` —
`git cat-file -e d7cee4a5:<path>` → *"exists on disk, but not in d7cee4a5"*; `git status` shows both `??`.

Nine commits implement a specification, cite it by section in dozens of code comments, and are verified
against its 21 named constraints — and the specification was never committed. Concretely:

- No reviewer, now or later, can perform a PROC-REVIEW-AT-COMMIT read of the document the range is
  measured against. I read it from an uncommitted working tree, which is the read-at-HEAD hazard the rule
  exists to prevent, one level up.
- Every `ADR 0018 §N` citation in the migrations and in `lib/learning/*` points at a file that does not
  exist for anyone who clones the repo or checks out this branch cleanly.
- ADR 0016 Amendment B (committed, `d5fafa72`) cites ADR 0018 §7.2 and §5.3 — a committed document
  referencing an uncommitted one. `docs/decisions/0010-legal-surface.md:1071-1072` (committed) likewise
  cites "ADR 0018 §2.3" / "§3.3".

A pure process defect — no code is wrong — but the kind that silently invalidates the audit trail the
last four sessions have been built around.

**Fix:** commit both files at the head of the correction pass. If the intent was that ADR 0018 lands with
a later session, that intent is recorded nowhere and is contradicted by four committed documents already
citing it. Note in the commit message that they were authored before C2.1 and are being landed
retroactively, so the ordering is on the record.

---

#### MAJOR-6 — No test proves cross-business isolation of the service-role batch loop, the one boundary that is not RLS

**Where:** `lib/learning/orchestrator.ts` (`processRow`, the `touchedBusinessIds` loop);
`lib/learning/orchestrator.test.ts`.

`runLearningTick` runs entirely under a service-role client, which **bypasses RLS**. The only tenancy
boundary for the whole batch is the `business_id` threaded through each call. By inspection it is correct
and I verified it independently: `processRow` reads `row.business_id` from the claimed row (never a
closed-over variable); `touchedBusinessIds` is built from that same per-row value; the summarize loop
uses a per-iteration `const`. But `orchestrator.test.ts` contains only `biz-1` — there is **no test that
claims rows for two different businesses in one tick**. The Tier-1 RLS suite proves isolation for the
*authenticated* path, which is a different boundary entirely.

This is precisely the shape CLAUDE.md's SHARED-FUNCTION CALLERS doctrine exists to catch: a tenancy
property asserted by code-reading rather than proven by a regression test, on the highest-severity
surface in the range. ADR §14 lists `[sec-Q2]` as "Adopted → §10.3, **with a test obligation**" — the
code half discharged, the test half only partly.

**Fix:** add one Tier-2 test to `orchestrator.test.ts` that claims two rows for two distinct businesses in
a single tick and asserts that (a) each `recomputeAndUpsertPattern` call carries its own row's
`business_id`, (b) `summarizeBusinessLearning` is called once per business with the matching id, and
(c) neither business's `human_content` appears in the other's call arguments. This would redden on any
future closure-capture or shared-variable refactor — the exact bug class Session 24-D's MAJOR-1 closed
elsewhere.

---

### MINOR

**MINOR-1 — `rehydrateSignals()` has no production caller.** `lib/learning/rehydrate.ts`;
`git grep rehydrateSignals d7cee4a5` matches only the file and its test. The `[type-5]` choke point is
correct, well-built, and tested — but nothing in this range reads `post_edit_signals.signals` back into a
`ClassifyResult`; its correctness is proven in a vacuum. Compounding it: `PostEditSignalRow.signals` is
typed `Record<string, unknown> | null` (`lib/db/types.ts:839`), so a future reader can write
`row.signals as unknown as ClassifyResult` with zero compiler complaint — the "MUST route through
`rehydrateSignals()`" rule is a comment, not a constraint. **Fix:** add a Tier-3 entry to ADR §12
recording that no production reader exists yet and that `rehydrateSignals` is the mandatory entry point
when one is added, so the next reviewer has a named check rather than rediscovering this by grep.

**MINOR-2 — the Tier-2 halves of `LEARN-MEMORY-THROUGH-BOUNDARY` and `LEARN-VOICE-NOT-AUTO-MUTATED` are
unmapped.** Both properties are true today (F8, F9) but nothing asserts them programmatically:
`promote.test.ts` and `orchestrator.test.ts` mock `lib/db/memory-performance.ts`'s exports, so a direct
`.from('performance_memory')` added to `lib/learning/` would pass silently, as would a
`.from('brand_voices')`. The Builder self-reported both in the C2.9 report rather than papering over
them — correct behaviour, and I confirm both independently. **Fix:** one `collectSourceFiles`-style
source-scan test (the pattern exists in `lib/db/businesses.caller-migration.test.ts`, and
`classify.test.ts` already uses the technique for `LEARN-HEURISTIC-FIRST`) closes both. Highest
value-per-line item in the correction pass.

**MINOR-3 — `raceLost` and `abandoned`/`skippedNoSnapshot` double-count the same row.**
`lib/learning/orchestrator.ts:151-160`, `:255-267`, `:173-181`. `abandonRow` calls `guardedTransition`,
which increments `raceLost` and returns `false` on a lost race — but every caller then increments
`abandoned` (or `skippedNoSnapshot`) unconditionally, so one lost race bumps two counters and claims an
abandonment that did not happen. The canonical `learning.tick` line over-reports terminal outcomes.
**Fix:** branch on `guardedTransition`'s boolean return before bumping the terminal counter.

**MINOR-4 — `summarizeFailed` collapses three distinguishable causes.** `orchestrator.ts:326-336`. An LLM
call failure, a Zod output-parse failure (`AiError` carries a `.code`), and a DB write failure in the
upsert loop all land in one counter with an untagged Sentry capture. An operator watching
`summarizeFailed` spike cannot tell an upstream Anthropic outage (transient, self-resolving) from a
prompt/schema regression (needs a code fix) without leaving the log for Sentry — defeating §11's
founder-verifiability posture for this path. **Fix:** tag the Sentry capture with
`err instanceof AiError ? err.code : 'unknown'` and include that code in the JSON log line.

**MINOR-5 — `status='failed'` is dead for reclaim.** `lib/db/post-edit-signals.ts:88-110`;
`20260726010000_learning_capture.sql:234-246`. `claim_post_edit_signals` claims only `status='pending'` —
unlike its sibling `claim_deletion_requests` it has no `OR (status='failed' AND attempts < max)` clause —
while ADR §9.4's prose describes a retry path through `'failed'`. The orchestrator routes around this by
sending transient failures back to `'pending'`, which is safe **as currently wired**, and the comment says
so at length. But `'failed'` remains a legal transition target, so any future writer that parks a row
there expecting reclaim will strand it forever. The guarantee lives in orchestrator behaviour, not in the
schema. **Fix:** either add the reclaim clause in a follow-up migration, or remove `'failed'` from
`LEGAL_TRANSITIONS`' reachable targets and amend ADR §9.4's prose to match the schema as applied.

**MINOR-6 — `expires_at` decay has no consumer.** `20260726030000…sql:61` writes
`expires_at = now() + 90 days` on every upsert, but neither `listPerformanceMemoryCandidates`
(`memory-performance.ts:11-27`) nor `listDistilledPatternsForSummary` (`:49-67`) filters on it, and no job
reads it. A 90-day-stale `active` pattern is still retrieved at generation time. ADR §7.1's "decay via
`expires_at` with no new job" is satisfied literally (no job was added), but the decay does not currently
*do* anything. **Fix:** add `.or('expires_at.is.null,expires_at.gt.now()')` to
`listPerformanceMemoryCandidates`, or record explicitly that decay activates in a later session.

**MINOR-7 — two unbounded queries in `scripts/learning-report.ts`.** `:26-32` (per-business
`post_edit_signals` select) and `:66-71` (list all `business_id`s with any signal) have no `limit` and no
explicit `ORDER BY`, against CLAUDE.md's two list-query rules. Operator-run diagnostic over small tables,
so real-world risk is low — but the rules are written without a script carve-out. **Fix:** add a bounded
`limit` and an `ORDER BY`, or add an explicit `scripts/` carve-out to CLAUDE.md.

**MINOR-8 — the demotion threshold is caller-supplied, not derived from stored state.**
`20260726030000…sql:157-166` guards on `p_net < 3`, where `p_net` is computed in TypeScript
(`promote.ts:135`) and passed in. Promotion's gates are all evaluated from stored columns and genuinely
atomic; demotion's is not — the DB trusts the caller's arithmetic. The migration explains why (no stored
column for "contradictions"), making it a recorded decision rather than an oversight, but `[db-MINOR-3]`'s
"same rigor as promotion" is not literally achieved. **Fix:** recompute the contradiction count inside the
function via a correlated subquery on the contradicting `pattern_key` (the TS side already computes that
key and could pass it instead of the net), or record the asymmetry explicitly in ADR §7.4.

**MINOR-9 — ADR §3.4's caller table carries stale line numbers and one false citation.** §3.4 cites
`actions.ts:94` (actual `:97`), `actions.ts:218` (actual `:221`), `generate.ts:362` (actual `:380`), and
lists `actions.context-equivalence.test.ts` as covering `bulkApprovePostsAction`, which it does not
(§1.2). **Fix:** correct the four citations. This is the table whose whole purpose is to be trusted at
face value by the next reviewer.

**MINOR-10 — the promotion confidence gate is not isolated in a boundary test.** `promote.test.ts` crosses
the 4-vs-5 observation and 1-vs-2 campaign boundaries with other inputs held fixed, but the confidence
gate is exercised only indirectly through two real `computeConfidence` outputs (0.714, 0.667) that also
vary the contradiction count. The gate is provably correct for the values used, but a reader auditing "is
each gate independently boundary-tested" must infer the isolation. **Fix:** one direct
`meetsPromotionThreshold({observations: 5, campaigns: 2, confidence: 0.69 / 0.70})` pair.

**MINOR-11 — the `topContent` render sites carry no length cap.** `lib/ai/prompts/post-generation.ts:179`,
`post-regeneration.ts:147`. Both route through `neutralize()` (correct — that was `[sec-HIGH-2]`), but
neither truncates, unlike `wrapEvidenceForPrompt`'s `EVIDENCE_MAX_CHARS` and the summarizer's token
budget. Bounded today by `PERFORMANCE_CAP=3` items and the `z.string().max(5000)` manual-edit cap, and the
in-code comment names the residual: once the distillation writer populates `performance_memory.pattern`
(an unbounded `text` column) with synthesized values, "that writer must enforce its own length bound at
write time". Tier-0's `renderPatternStatement` is a fixed template over an enum-constrained platform, and
the summarizer path is capped at 200 chars by Zod — so both live writers are safe today. **Fix:** record
this as a tracked follow-up (issue or ADR §15 row) rather than re-litigating it each session, so it is not
forgotten when a third writer appears.

---

### NIT

**NIT-1 — "eleven kinds" is twelve.** `classify.ts:41-53` defines 9 + 1 + 2 = 12. The ADR says "eleven" at
§0/Q4, §4.3 (`:285`), §12 (`:675`), §13 (`:707`), and `orchestrator.ts:62` repeats it in a comment about
`PreferenceKind`, which has 9. Fix the count in all five places so a future reader auditing "all eleven
implemented" does not conclude one is missing.

**NIT-2 — C2.1's commit message claims three render sites; two exist.** `be5779e1`'s subject says "all
three render sites", inherited from ADR §10.4's stale citation of `formats/native-generation-prompt.ts`,
which renders no `topContent` at this range. The work is correct and complete; only the count is wrong.
Fix ADR §10.4's citation (the commit message is history and should not be rewritten).

**NIT-3 — `computeSummaryPatternKey` uses a 32-bit hash.** `summarize.ts:64-71`. At 5 statements ×
8 calls/month/business the collision probability is negligible, and a collision would merge two statements
onto one row rather than corrupt anything. Worth a comment noting the bound was considered.

**NIT-4 — `summary.failed` means "retrying", not "failed".** `orchestrator.ts:277`. It sits beside
`abandoned`, `promoted`, `demoted` in the same summary object, so anyone alerting on `failed > 0` would
page on every ordinary transient retry. Rename to `retrying`, or comment the field declaration.

**NIT-5 — §14 says 28 findings; the table has 27 rows.** Recount, or add the missing row.

**NIT-6 — structured `console.log` vs CLAUDE.md's literal text.** `orchestrator.ts:353`,
`generate.ts:450`, `capture-learning/route.ts:15,46`, `posts/actions.ts:385`. CLAUDE.md says "No
console.log in committed code. Use a proper logger (we'll add this later)". This range follows the
established house pattern (`lib/email/orchestrator.ts:146`, `api/cron/publish/route.ts:18,50`) exactly, so
it is not a new violation — but the constitution still reads as absolute with no documented carve-out for
structured JSON logging. One sentence in CLAUDE.md legitimising the existing pattern would stop this being
re-raised every review.

**NIT-7 — `getLatestRevision` / `getPostAiOriginalById` carry no `business_id` filter.**
`lib/db/post-ai-originals.ts:24-33`, `:38-49`. Safe in every current path: `getPostAiOriginalById` is
called only from the service-role orchestrator with an `ai_original_id` sourced from the same trusted
`post_edit_signals` row (not attacker input), and `getLatestRevision` is reached from `regeneratePostAction`
with an RLS-scoped `ctx.client` and an already-validated `postId`. No exploitable path. Flagged only so a
future caller does not assume these functions self-enforce tenancy — they do not; the caller's client does.

---

## 5. Constraint coverage — ADR §13's 21 `LEARN-*` (J1, J2, J5)

`app-tests` = `app-tests.yml` (`vitest run app/ lib/ components/`, every push/PR).
`db-tests` = `db-tests.yml` (`vitest run supabase/__tests__`, live Postgres).
"Reddens?" = my judgement, informed by `pr-test-analyzer`, on whether the cited test goes RED if the
property breaks.

| # | Constraint | Tier | Test | CI job | Reddens if broken? |
|---|---|---|---|---|---|
| 1 | `LEARN-SNAPSHOT-SEPARATE` | 1+3 | table existence implicit in every Tier-1 insert; the "`PostUpdate` unchanged" half is Tier-3 prose confirmed by inspection | db-tests | Partially — the table half yes; the `PostUpdate` half has no test **by decision**. C2.9 correctly withdrew an earlier overclaim that `satisfies PostUpdate` assertions test it (they compile identically either way). Honest. |
| 2 | `LEARN-SNAPSHOT-WRITE-ONCE` | 1 | `write-once-and-erasure.test.ts:111-125` | db-tests | **Yes** — asserts the error, then re-reads to prove the row is unchanged. |
| 3 | `LEARN-CAPTURE-AT-TRANSITION` | 1 | `learning-capture-trigger.test.ts:134,147,160,170` | db-tests | **Yes** — four cases incl. two negative ones. |
| 4 | `LEARN-CAPTURE-ALL-CALLERS` | 1+2 | Tier-1 `:134` (raw UPDATE, no app code) + `:253` (bulk N-in-one-statement); Tier-2 the six caller tests in §1 | db-tests + app-tests | **Yes.** The raw-UPDATE test is the structural proof; the Tier-2 rows prove each caller reaches the right function with the right args. |
| 5 | `LEARN-MODE-AGNOSTIC` | 1 | same raw-UPDATE test — keys off the transition, no origin branching in the body | db-tests | **Yes** — a `campaigns.origin` branch added to the trigger would fail the raw-UPDATE case. |
| 6 | `LEARN-HEURISTIC-FIRST` | 2 | `classify.test.ts` — kind case table **plus a source-scan** for `anthropic`/`runPrompt`/`@/lib/ai/` imports | app-tests | **Yes**, unusually strongly: the source-scan reddens on a future import that a behavioural test would miss. |
| 7 | `LEARN-CLASSIFY-DETERMINISTIC` | 2 | `classify.test.ts` — same fixture twice, JSON-diffed | app-tests | **Yes.** |
| 8 | `LEARN-CORRECTION-REQUIRES-BRIEF` | 2 | `classify.test.ts` — "no brief" and "brief with empty pinned set" separately | app-tests | **Yes.** Re-derived from source (`classify.ts:238-244`), not from the test name. |
| 9 | `LEARN-CORRECTION-PREFERENCE-ENFORCED` | 1+2 | Tier-2 `classify.types.test.ts` (compile) + `rehydrate.test.ts` (Zod literal); Tier-1 `performance-memory-pattern-key.test.ts` | app-tests + db-tests | **TS half yes** (verified load-bearing both directions). **DB half: the test reddens, but only against a row the pipeline cannot produce** — MAJOR-1. |
| 10 | `LEARN-VOICE-WRITE-TRIGGER` | 1 | `performance-memory-pattern-key.test.ts` — 5 tests, real inserts, reject/accept both asserted, fail-closed NULL case, retirement escape hatch | db-tests | **Yes for the trigger as written. No for the property the constraint names** — MAJOR-1. |
| 11 | `LEARN-NO-SINGLE-DIFF-PROMOTION` | 2 | `promote.test.ts` (one diff never promotes) + the `.eq('status','active')` retrieval filter | app-tests | **Yes.** |
| 12 | `LEARN-PROMOTION-THRESHOLD` | 1+2 | Tier-2 `promote.test.ts` (5/0.70/2, K=2-vs-K=3, contradiction, demotion); Tier-1 `performance-memory-promotion.test.ts` (exactly once under **10 concurrent calls**; no-op when the campaign gate is unmet) | app-tests + db-tests | **Yes** — the strongest DB-level test in the range. Confidence gate isolated only indirectly (MINOR-10). |
| 13 | `LEARN-TICK-IDEMPOTENT` | 1+2 | Tier-1 `learning-capture-trigger.test.ts:186,203,226,273`; Tier-2 **`promote.test.ts:125`** | db-tests + app-tests | **Yes at Tier-1 and via `promote.test.ts`. NO for the test carrying the constraint's name** — `orchestrator.test.ts:449` is vacuous for it (MAJOR-4). |
| 14 | `LEARN-MEMORY-THROUGH-BOUNDARY` | 2+3 | Tier-3 grep half confirmed; **Tier-2 half unmapped** | **unmapped** | **No.** MINOR-2. |
| 15 | `LEARN-SUMMARY-DATA-GUARDED` | 2 | `learning-summarizer.test.ts:60,70,89,104` | app-tests | **Yes** — hostile defused *and* benign byte-identical, so both a bypass and an over-aggressive regression redden. |
| 16 | `LEARN-PATTERN-RENDER-GUARDED` | 2 | `post-generation.test.ts:264`, `post-regeneration.test.ts:49` | app-tests | **Yes** — `post-regeneration.test.ts:57-59` explicitly discriminates the shared `neutralize()` from the weaker local guard. |
| 17 | `LEARN-VOICE-NOT-AUTO-MUTATED` | 2+3 | Tier-3 half confirmed (no `*_voice_memory` migration); **Tier-2 half unmapped** | **unmapped** | **No.** MINOR-2. |
| 18 | `LEARN-RLS-ISOLATED` | 1 | `learning-capture-rls.test.ts` — 10 tests, cross-tenant CRUD denied on both tables, `USING`/`WITH CHECK` separately | db-tests | **Yes** — denials re-verified by a second service-role read, not by trusting the client response. |
| 19 | `LEARN-CASCADE-COMPLETE` | 1+3 | Tier-1 erasure-SUCCEEDS test; Tier-3 the two §D2.5 rows | db-tests | **Yes** — asserts the DELETE's own error is null before checking the rows. |
| 20 | `LEARN-BRIEF-DIFF-DEFERRED` | 3 | no test **by decision**, ADR §3.5 | n/a | Recorded decision. Confirmed: no `campaign_brief_revisions` anywhere. |
| 21 | `LEARN-VOICE-SUGGESTION-DEFERRED` | 3 | no test **by decision**, ADR §0/Q6, §15 | n/a | Recorded decision. Confirmed: no suggestion surface under Track C. |

**Result: 19 of 21 map to a test in a named, executing CI job. Two (#14, #17) have an unmapped Tier-2
half — MINOR-2. Of the 19, three carry a caveat: #9 and #10 (MAJOR-1), #13 (MAJOR-4).**

### J5 — the seven Tier-3 diff-verified properties

All seven confirmed independently as recorded decisions, not oversights: the two §D2.5 cascade rows
(`0010-legal-surface.md:1071-1072`); no `*_voice_memory` migration; no `package.json` change; no
Tier-2/Tier-3 agentic loop (one `runPrompt` call site, `summarize.ts:130`); no new route under
`app/[locale]/(dashboard)`; no new i18n keys; no `campaign_brief_revisions` table. Each is enumerated in
ADR §12 as diff-verified **by decision**, which is what makes "no test" a decision rather than a gap.

### J3 — CI execution and the promotion tally

| Job | Run | headSha | Event | Result |
|---|---|---|---|---|
| App tests (tsc + eslint + vitest) | 30301920945 | **`d7cee4a5`** (range head) | `pull_request` | success — `skip-guard: 166 file(s) under [app, lib, components] all visible, zero failures` |
| DB tests (ADR 0013 RLS/migration suite) | 30301920885 | **`d7cee4a5`** | `pull_request` | success — `skip-guard: 20 file(s) under [supabase/__tests__] all visible, zero failures` |

All 20 Tier-1 files at `d7cee4a5` executed, including all five added by this range. Per
`scripts/ci/assert-no-empty-suite.mjs` at the range, "visible" means **≥1 non-skipped `assertionResult`
per file**, and invariant (ii) fails the job on any `status: 'failed'` — a strictly stronger guarantee
than a raw count. **No FALSE-GREEN.**

**One correction to the C2.9 report.** Its §5 states *"192 tests executed … confirmed directly from the
CI log"*. Not supportable: `test:db` runs with `--reporter=json --outputFile`, which suppresses the human
summary, and the skip-guard prints a **file** count, not a test count. `192` is the local figure from its
own §1. The per-file non-zero guarantee holds; the specific integer does not come from CI. The report also
cites the runs for `4dcbbf3e` (its own parent) rather than for the range head — the range head has its own
green pair, listed above.

**Promotion tally: this range does NOT count.** Both runs are `pull_request`-event runs on
`session-22-d`, and ADR 0015 §5's promotion rule counts full-green `db-tests` runs **on `master`**. The
tally is unchanged. The C2.9 report states this correctly and does not claim promotion.

---

## 6. Verdict

### Blockers before merge

**None.** This range can merge as it stands. It is, on the evidence, the most carefully built range in
this project to date: the schema, the RLS posture, the atomic promotion, the render guards, the failure
taxonomy, and the scope discipline are all correct on first pass. The two most dangerous things it could
have got wrong — a `BEFORE DELETE` guard that would have made every post-generating business un-erasable,
and an LLM call on the per-post classify path — it explicitly did not do, with the reasoning recorded in
the migration and in `classify.ts` rather than left implicit.

### Recommended before merge (cheap; each closes a real gap)

- **MINOR-2** — one source-scan test closes the two unmapped Tier-2 constraint halves. Highest
  value-per-line item in the correction pass.
- **MAJOR-6** — one two-business tick test closes the untested half of `[sec-Q2]`'s explicit test
  obligation, on the only tenancy boundary that is not RLS.
- **MAJOR-4** — rename the idempotency test or make it a real replay. A constraint's name over an
  assertion that does not test it is the exact failure ADR 0015 exists to prevent.
- **MAJOR-5** — commit ADR 0018 and `session-25.md`. Four committed documents already cite them.

### Deferrable debt (record, then schedule)

- **MAJOR-1 and MAJOR-2 are one problem and must be fixed together.** Both are consequences of
  `pattern_key` being simultaneously the aggregation key, the promotion join key, and the voice-guard
  join key. They are safe today only because MAJOR-2's dead end happens to contain MAJOR-1's leak. Nobody
  designed that, and a session that fixes either in isolation will activate the other. Fix them in one
  session, or record explicitly that summarizer rows are permanently candidate-only and re-scope the
  voice trigger accordingly.
- **MAJOR-3** — at minimum add the orphan query to `learning-report.ts`.
- MINOR-1, MINOR-3 … MINOR-11 and NIT-1 … NIT-7 as scheduled.

### The four questions this track exists to settle

Each answered at the DB level, as required.

**(1) Can the AI's original ever be clobbered by a human edit? — No.**
`supabase/migrations/20260726010000_learning_capture.sql:64-67`: `trg_post_ai_originals_write_once` is a
`BEFORE UPDATE` trigger whose function body is an unconditional `RAISE EXCEPTION`. It cannot be satisfied,
cannot be bypassed by RLS (the trigger fires after the policy, and the policy is moot), and cannot be
reached by an authenticated `DELETE` — no such policy exists (`:91-95`). Proven executing at
`learning-capture-write-once-and-erasure.test.ts:111-125` against live Postgres, which asserts the error
**and** re-reads to confirm `rendered_content` is unchanged. The human's edit lands in `posts.content`
and, separately, is copied into the queue row at approval time (`:209-210`) — the two never share a row.

**(2) Can a diff be counted twice? — No.**
Three independent DB-level mechanisms, each proven at Tier-1. `UNIQUE (post_id, ai_original_id)`
(`learning_capture.sql:125`) makes a second queue row for the same (post, snapshot) pair impossible —
`learning-capture-trigger.test.ts:186`. The enqueue trigger's
`ON CONFLICT … DO UPDATE … WHERE post_edit_signals.status = 'pending'` (`:213-219`) means a re-approval
**refreshes** a pending row and is a silent no-op against a processed one — `:203` and `:226`.
`claim_post_edit_signals` (`:234-246`) claims only `status='pending'` under `FOR UPDATE SKIP LOCKED`, so a
processed row is never re-claimed and concurrent ticks receive disjoint sets — `:273`. And the count
itself is a `COUNT(*)` recompute, not an increment: `promote.ts:113` → `20260726030000…sql:68`
(`observation_count = EXCLUDED.observation_count`). There is no `+ 1` anywhere in the range.

**(3) Can a correction-tagged signal reach a voice-directed write? — Yes, by one path, but it cannot
reach generation.**
This is the one question whose answer is not clean, and it is **MAJOR-1**. The DB guard
(`20260726020000_performance_memory_pattern_key.sql:96-113`) rejects a `source='distilled'`,
`dimension IN ('format','hook')` write when a contributing `post_edit_signals` row sharing its
`(business_id, pattern_key)` carries a non-`preference` class. But `listRecentHumanEditExcerpts`
(`lib/db/post-edit-signals.ts:63-73`) applies **no `class` filter**, so correction-classed human copy feeds
the summarizer, whose output is written under a `summarize:`-namespaced `pattern_key` that by construction
matches no `post_edit_signals` row — the `EXISTS` is unsatisfiable and the write is allowed. The Tier-0
path is likewise immune by construction: `canonicalize()` (`orchestrator.ts:107-123`) never emits a
non-NULL `pattern_key` on a non-`preference` row.

What stops this being a live defect is a second DB fact, not the guard:
`promote_performance_pattern`'s campaign gate (`20260726030000…sql:118-127`) counts `post_edit_signals`
rows matching `p_pattern_key`, which for a `summarize:` key is always zero, so `0 >= 2` is always false —
such a row can never reach `status='active'`, and `listPerformanceMemoryCandidates`
(`lib/db/memory-performance.ts:11-27`) filters `.eq('status','active')`. **No correction-derived text
reaches a generation prompt.** The property holds; the mechanism the ADR credits with holding it is not
the mechanism holding it.

**(4) Can a single diff change future generation? — No.**
`promote_performance_pattern` (`20260726030000…sql:112-127`) is a single atomic conditional `UPDATE`
requiring `status='candidate' AND observation_count >= 5 AND confidence >= 0.70 AND
(SELECT count(DISTINCT pes.campaign_id) …) >= 2`. One diff yields `observation_count = 1`,
`computeConfidence(1,0) = 1/3 ≈ 0.333`, and one campaign — it fails **all three** gates independently.
The distinct-campaign gate is what makes this real rather than nominal: five observations inside one
campaign is one editing session, and the gate rejects it. Retrieval reads only `status='active'`
(`memory-performance.ts:19`), and the upsert never sets `status` at all (`:41-46` — deliberately, so a
re-observation can neither flip an active row back nor resurrect a retired one). Proven at Tier-1 by
`performance-memory-promotion.test.ts`, which fires **10 concurrent promotion RPCs** and asserts exactly
one succeeds, plus a real 1-campaign no-op case.

---

## CORRECTION PASS (Session 25-D)

**Author:** Session 25-D (Claude Code, Sonnet 5). Everything above this section is the Reviewer's
original text, unedited, per CLAUDE.md's REVIEWER-REPORT APPEND-ONLY rule. Everything below is this
correction pass — findings are referenced by ID, never restated as resolved in place.

### D0 (commit `052c48fc`)

Committed `docs/decisions/0018-diff-based-learning-capture.md`, `docs/build-guide/session-25.md`, and
this file (`docs/reviews/session-25-reviewer.md`) exactly as they stood — no edits. Resolves **MAJOR-5**:
the governing ADR and build guide are now in git at the range the correction pass measures against.

### D1 — MAJOR-1 and MAJOR-2

Both findings are **fixed**, per the founder-adjudicated resolution recorded in
`docs/build-guide/session-25.md` §4 and in ADR 0018 Amendment A: **option (a) — record + narrow.**
Summarizer rows are **not** made promotable; MAJOR-2 was **resolved, not declined** — the two findings
share one root cause (`pattern_key` doing triple duty as aggregation key, promotion join key, and
voice-guard join key), and the fix is to state the true invariant rather than manufacture a
summarizer-side campaign count ADR §6.1 never intended.

- **MAJOR-1** — `fixed`. Two closures, both required:
  1. **Real code fix**: `lib/db/post-edit-signals.ts`'s `listRecentHumanEditExcerpts` now filters
     `.eq('class', 'preference')` — correction/inconclusive-classed human copy no longer enters the
     summarizer's input at all. A new Tier-2 test (`lib/db/post-edit-signals.test.ts`, "filters by
     class=preference…") was confirmed to redden when the `.eq` call was manually removed and re-run
     (`class` assertion failed, `status` call reported in its place), then confirmed green again once
     restored.
  2. **Overclaim narrowed, not silently reworded**: the trigger's RAISE text and comments
     (`supabase/migrations/20260726020000_performance_memory_pattern_key.sql`, unedited — applied
     migrations are never edited) are superseded by a new forward migration,
     `supabase/migrations/20260728190000_narrow_voice_write_trigger_message.sql`, changing **only** the
     RAISE message and comments via `CREATE OR REPLACE FUNCTION` — the guard condition, retirement escape
     hatch, and re-validation predicate are byte-identical (independently confirmed by `database-reviewer`).
     The new message states the trigger's actual live scope (other write paths — manual backfill, future
     jobs, ad-hoc queries — not this pipeline, which cannot construct a matching row). A new Tier-1 test,
     `supabase/__tests__/performance-memory-pattern-key.test.ts` — "rejects a hook-dimension distilled
     write sourced from a correction-class signal" — proves the trigger still fires when handed such a row
     directly, per the Reviewer's fix #3: both facts (the guard works; the pipeline can't trigger it) are
     on the record together.
  Test: `lib/db/post-edit-signals.test.ts`, `supabase/__tests__/performance-memory-pattern-key.test.ts`.
- **MAJOR-2** — `fixed` as a documentation/comment correction; no code-behaviour change was needed or
  made — the campaign gate already made this true. `lib/learning/summarize.ts`'s upsert-site comment now
  states plainly that a summarizer row can never promote, at any volume, because its
  `summarize:`-namespaced `pattern_key` matches zero `post_edit_signals` rows by construction. ADR 0018
  Amendment A narrows §6.1's "no shortcut into active" framing to "no path whatsoever," and adds the
  property to §12's Tier-3 diff-verified list. Test: none added — Tier-3 by decision, mirroring §12's
  existing Tier-3 entries; the property being recorded is a permanent absence, not a runtime-testable one.

**Advisory passes** (each independently instructed to read the D1 diff, findings adjudicated by this
correction pass rather than passed through verbatim):
- `database-reviewer`: confirmed the new migration's guard condition, `TG_OP`/`IS DISTINCT FROM`
  re-validation predicate, and `EXISTS` join are byte-identical to the superseded migration — only the
  RAISE message and comments changed; confirmed `CREATE OR REPLACE FUNCTION` is safe/correct Postgres
  semantics for a trigger that already references the function by name (no trigger recreation needed);
  confirmed the new `.eq('class','preference')` filter does not defeat the existing partial covering index
  on `post_edit_signals` and causes no seq scan. No issues found.
- `security-reviewer`: confirmed the query filter is correct and sufficient — `listRecentHumanEditExcerpts`
  has exactly one production caller (`summarize.ts`), and Tier-0's separate input path
  (`listDistilledPatternsForSummary`) is already `preference`-derived via `canonicalize()`, so no other
  path feeds non-preference human copy into a voice-directed write; confirmed the render-time
  `neutralize()` guard (LEARN-SUMMARY-DATA-GUARDED) is untouched and remains an orthogonal, still-applying
  control. No residual gap found.
- `ecc:type-design-analyzer`: confirmed the ADR Amendment A and code comments now honestly narrow the
  claim to match what the code proves. Flagged, as a residual **not** newly introduced by this pass and
  consistent with ADR 0018 §5.3's own framing (the DB trigger, not TypeScript, is the real enforcement
  layer): the "both writers structurally cannot produce a matching row" property is a **runtime/convention
  guarantee** confined to `canonicalize()`'s four branches and `computeSummaryPatternKey()`'s `summarize:`
  prefix, not a type-level invariant — nothing in the type system links `class` to `pattern_key`'s
  nullness, and `transitionPostEditSignal`'s `next` parameter would accept an illegal pairing with no
  compiler error if a caller ever constructed one outside `canonicalize()`. Recorded here as a known,
  accepted limitation (the DB trigger is the actual backstop) rather than a new gap requiring a fix in this
  pass.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean.
- Targeted `vitest run` on the touched files (`lib/db/post-edit-signals.test.ts`,
  `lib/learning/summarize.test.ts`, `lib/learning/orchestrator.test.ts`) — all green (59/59).
- `npx vitest run lib/db lib/social lib/validation lib/learning` (CLAUDE.md's scoped app-test invocation)
  — one failure, `lib/social/__tests__/vault.test.ts` ("returns token and expiry when account is active"),
  a 15s timeout. Re-run in isolation: 12/12 pass. Pre-existing flake, unrelated to this pass's files —
  matches a previously-recorded flake (memory: "vault.test.ts passes all tests when run in isolation").
- `npm run db:migrate` — applied the one new migration cleanly against the local live Postgres.
- `test:db` (`supabase/__tests__`, live Postgres, `--no-file-parallelism --retry=2`): the new/modified
  Tier-1 file (`performance-memory-pattern-key.test.ts`) — 11/11 pass, including the new hook-dimension
  test. Full suite: 2 failures, both in files **untouched by this pass** and on **unrelated tables**
  (`rls-policy-lockdown.test.ts` — `business_deletion_requests` SELECT-policy count; and
  `get-user-business-ids-matrix.test.ts` — an active member's business/post visibility). Confirmed
  pre-existing and not caused by D1: re-ran both files with all six D1 file changes `git stash`ed away
  (`lib/db/post-edit-signals.ts`, its test, `lib/learning/summarize.ts`,
  `performance-memory-pattern-key.test.ts`, the new migration, and the ADR amendment) — same two failures,
  identical assertions, with none of this pass's changes present. Stash restored afterward; `git status`
  confirmed all six changes intact. These two failures are local-environment/pre-existing and out of D1's
  scope (MAJOR-1/MAJOR-2 only); not investigated further here.

### D2 — MAJOR-3 and MINOR-7

- **MAJOR-3** — `fixed`, via fix (c) only (the Reviewer's recommended minimum). `scripts/learning-report.ts`
  now exports `findSnapshotOrphans(client, businessId)`: posts with `deleted_at IS NULL` and no matching
  `post_ai_originals` row (detected via a PostgREST embedded left-join, `post_ai_originals(id)` returning an
  empty/null array for a childless post), ordered by `created_at DESC` and bounded to `ORPHAN_SCAN_LIMIT =
  500` — matching `posts_business_id_created_at_idx (business_id, created_at DESC)`. `reportForBusiness`
  prints the orphan count plus a bounded sample of ids (`ORPHAN_SAMPLE_LIMIT = 20`), with a note that any
  pre-Track-C post will also appear here (no backfill was built, by decision) so an operator doesn't treat
  every historical post as a fresh incident.
  - **(a) one transaction** and **(b) `Promise.allSettled` + mark/soft-delete** were both **considered and
    deferred**, per instruction — recorded in `scripts/learning-report.ts`'s own comment above
    `findSnapshotOrphans`, not left implicit: (a) is a transaction-boundary change to `createPosts`'s
    generation path itself — a behaviour change to already-shipped code, out of scope for a pass whose
    brief is fixing what the Reviewer found wrong, not restructuring it; (b) changes `createPosts`'s
    failure semantics (what it returns, what a caller sees on partial failure) — exactly the class of
    change this correction pass is scoped to avoid. Neither is implemented here.
  - **BLOCKER (silent-failure-hunter) vs MAJOR (Reviewer) — the severity split, argued, not erased.**
    silent-failure-hunter's original BLOCKER reasoning (cited above, in the Reviewer's MAJOR-3 section) is
    about production impact: posts silently and permanently escape the learning loop, with no rollback and
    no id-level rejection reporting. That underlying defect is **still true after this pass** — `createPosts`
    and the snapshot writes are still two round trips, still not transactional, still no `allSettled`
    reporting; fix (c) adds **detection**, not **correction**. Re-invoked in this correction pass,
    silent-failure-hunter accepted the Reviewer's MAJAR grading as adequate **conditional on this pass's
    record being explicit that (c) is manual-only** — `findSnapshotOrphans` is invoked by a human running
    `tsx scripts/learning-report.ts`, not by a scheduled job or an alert, so "operator-visible" here means
    "visible to an operator who runs the report," not "surfaced automatically." That condition is satisfied
    by this very appendix and by the in-file comment. The Reviewer's original bounded-blast-radius
    reasoning (no data corruption, no cross-tenant leak, session-level Sentry/log visibility already
    existed pre-pass) is unchanged and still the basis for MAJOR over BLOCKER.
  - **Real gap found and fixed within this pass** (silent-failure-hunter, D2 re-invocation): `main()`'s
    no-argument sweep originally derived its business list **only** from `post_edit_signals.business_id` —
    which would silently skip exactly the business MAJOR-3 describes: one whose only symptom is a
    snapshot-write failure, with zero signals yet (no post approved or edited). Fixed in this same commit:
    `main()` now unions `post_edit_signals.business_id` with `posts.business_id` (`deleted_at IS NULL`,
    bounded to `BUSINESS_SCAN_LIMIT = 500`, ordered to match the same index), so the automatic sweep cannot
    skip a business that has posts but no signals.
  - **Residual, named not fixed**: `ORPHAN_SCAN_LIMIT = 500` truncates silently for a business with more
    than 500 non-deleted posts — the `scanned` count is printed but there is no explicit "more posts exist
    beyond this window" caveat when `scanned === ORPHAN_SCAN_LIMIT`. Recorded here as a follow-up, not
    fixed in this pass (out of scope — MAJOR-3's brief is detection existing at all, not exhaustiveness at
    arbitrary scale).
  Test: `supabase/__tests__/learning-report-orphans.test.ts` — zero orphans on a healthy fixture (post +
  snapshot), the seeded orphan's id returned when no `post_ai_originals` row exists, and a soft-deleted
  snapshot-less post excluded. Manually confirmed to redden when the filter condition
  (`!row.post_ai_originals || row.post_ai_originals.length === 0`) was inverted, then restored.
- **MINOR-7** — `fixed`. All three list queries in `scripts/learning-report.ts` are now bounded with an
  explicit `ORDER BY` matching an existing index: the per-business `post_edit_signals` scan
  (`SIGNAL_SCAN_LIMIT = 5000`, ordered `created_at DESC` against `post_edit_signals_business_id_idx`); the
  business-id discovery queries (`BUSINESS_SCAN_LIMIT = 500` each, ordered `business_id ASC` against the
  same index's leading column); and the new orphan query (above). No `scripts/` carve-out was added to
  CLAUDE.md — the rules were cheaper to obey than to weaken, per instruction.

**Advisory passes** (each independently instructed to read the D2 diff):
- `ecc:silent-failure-hunter`: confirmed fix (c) gives genuine, tested operator visibility where none
  existed; accepted the Reviewer's MAJOR grading as adequate given the record above; found and this pass
  fixed the `main()` business-selection gap described above.
- `database-reviewer`: confirmed the PostgREST embedded left-join (`post_ai_originals(id)`) is correct,
  unambiguous, standard behavior for a single-FK one-to-many relationship — no `!left`/`!inner` needed;
  confirmed all three `ORDER BY` clauses genuinely match their claimed indexes' leading columns and
  directions; confirmed the embed compiles to one SQL statement (not client-side N+1), index-backed via
  `post_ai_originals`'s `UNIQUE (post_id, revision)`. No corrections needed.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean.
- `npx tsx --env-file=.env.local scripts/learning-report.ts <businessId>` — manually run against the live
  local Postgres; orphan section renders correctly (`Snapshot-orphan posts (of the N most recent
  non-deleted posts scanned): 0`).
- `supabase/__tests__/learning-report-orphans.test.ts` — 3/3 pass; confirmed reddens when the orphan filter
  is inverted (both the healthy-fixture and seeded-orphan assertions failed as expected), then restored to
  green.
- `npx vitest run lib/db lib/social lib/validation lib/learning` — same pre-existing `vault.test.ts` timeout
  as D1 (12/12 green in isolation), everything else green.
- `test:db` full suite (live Postgres, `--no-file-parallelism --retry=2`): same two pre-existing, unrelated
  failures as D1 (`rls-policy-lockdown.test.ts`, `get-user-business-ids-matrix.test.ts` — confirmed
  pre-existing there, not re-investigated here), plus the 3 new orphan tests green. No new failures
  introduced by D2's changes.

### D3 — MAJOR-4, MAJOR-6, MINOR-2, MINOR-10

All four are `fixed`. Every one was verified by applying the exact named mutation locally, confirming RED,
then reverting to green — noted per-item below.

- **MAJOR-4** — `fixed`. `lib/learning/orchestrator.test.ts`'s "replayed tick (LEARN-TICK-IDEMPOTENT)" describe
  block is split in two: the old test (which stubbed the SECOND claim to return an EMPTY batch, proving
  only "an empty claim is a no-op") is kept and renamed to what it actually proves — "a second tick with
  nothing left to claim (no-op on an empty batch)". A NEW test, "replayed tick over the SAME signal row
  (LEARN-TICK-IDEMPOTENT)", implements the Reviewer's preferred option (b): `mockClaimPostEditSignals
  .mockResolvedValue([signalRow])` returns the IDENTICAL row on both ticks (a persistent mock, not paired
  `.mockResolvedValueOnce` calls), and `mockRecomputeAndUpsertPattern.mockResolvedValue(...)` likewise
  returns a fixed `observations: 5` on both calls. Asserts: `recomputeAndUpsertPattern` is called exactly
  twice (never skipped on replay), both calls carry identical `DistillationInput` args
  (`toEqual(firstArgs[1])`), and both resolve to the identical `observations` value.
  **Mutation-redenned, confirmed then reverted**: temporarily changed the mock to
  `.mockResolvedValueOnce({observations:5,...}).mockResolvedValueOnce({observations:10,...})` (modeling
  what an incrementing implementation would do) — the "identical observations" assertion failed
  (`expected 10 to be 5`), exactly as required. Reverted; `npx vitest run
  lib/learning/orchestrator.test.ts` green (22/22) afterward.
- **MAJOR-6** — `fixed`. New describe block "cross-business isolation in one tick (MAJOR-6)" in the same
  file claims two signal rows for two distinct businesses (`biz-1`, `biz-2`) in ONE tick, using
  per-id `mockImplementation` on `getPostAiOriginalById`/`getPostById` to give each business its own
  fixture. Asserts (a) each `recomputeAndUpsertPattern` call carries its own row's `business_id`
  (`toHaveBeenNthCalledWith`), (b) `summarizeBusinessLearning` is called once per business with the
  matching id, (c) neither business's `human_content` appears in the other's `classify()` call arguments.
  This discharges ADR §14's `[sec-Q2]` "Adopted, WITH A TEST OBLIGATION" outstanding half.
  **Mutation-redenned, confirmed then reverted**: temporarily hardcoded `businessId: 'biz-1'` in
  `orchestrator.ts`'s `recomputeAndUpsertPattern` call (in place of `row.business_id`) — the second
  business's call showed `businessId: 'biz-1'` instead of `'biz-2'`, failing assertion (a) exactly as
  required. Reverted; green afterward.
  - **Real gap found and closed within this pass** (`security-reviewer`, re-invoked on this diff):
    `retrieveVoice(client, row.business_id)` and `getBriefByCampaign(client, row.campaign_id)` are
    ALSO constructed per-row inside `processRow` — the same leak vector as (a)–(c), on two more
    collaborators, and the original test asserted neither. Added
    `expect(mockRetrieveVoice).toHaveBeenCalledWith(expect.anything(), 'biz-1')` /`'biz-2'` and the same
    for `mockGetBriefByCampaign` with `'camp-1'`/`'camp-2'`. **Mutation-redenned, confirmed then reverted**:
    temporarily hardcoded `retrieveVoice(client, 'biz-1')` — the second call's expected `'biz-2'` argument
    failed against the actual `'biz-1'`, exactly as required. Reverted; green afterward.
  - **Named residual, not fixed in this pass** (`security-reviewer`): `getEvidenceMemoryByIds` is never
    called in this test's fixture (both rows resolve `getBriefByCampaign` to `null`, so `pinnedIds` is
    always empty and the guarded call never fires) — its own cross-business argument-leak vector is
    therefore untested here. Also flagged: since `recomputeAndUpsertPattern`/`summarizeBusinessLearning`
    are fully mocked in this Tier-2 test, a real cross-business leak INSIDE their bodies (`promote.ts`,
    `summarize.ts`) would not be caught here — `security-reviewer` recommends a follow-up confirming
    `promote.test.ts`/`summarize.test.ts` each have their own explicit two-business non-leak case, which
    this pass did not add (out of scope: D3's brief was the orchestrator's own wiring, not a re-audit of
    every downstream function).
- **MINOR-2** — `fixed`. New file `lib/learning/memory-table-boundary.test.ts`: a source-scan test (the
  same technique `classify.test.ts`'s `LEARN-HEURISTIC-FIRST` uses) that recursively reads every non-test
  `.ts` file under `lib/learning/**` and `app/api/cron/capture-learning/**` and asserts none contains
  `.from('performance_memory'|'post_ai_originals'|'post_edit_signals'|'brand_voice…')`. Guards against its
  own false-green: asserts `files.length > 0` before scanning. ADR 0018 §13 updated in place (both
  constraint-table cells for `LEARN-MEMORY-THROUGH-BOUNDARY` and `LEARN-VOICE-NOT-AUTO-MUTATED` now name
  this test and the `app-tests.yml` job it executes in) — 21 of 21 `LEARN-*` constraints now map to an
  executing test; no "unmapped" cell remains. Documented as ADR 0018 Amendment B (the table cells are
  edited in place, not appended around, since — unlike §5.3/§6.1's narrative decision text — a stale
  constraint→test mapping is simply wrong, not a historical claim worth preserving verbatim; the amendment
  records why and when).
  **Mutation-redenned, confirmed then reverted**: appended a comment line containing
  `.from('performance_memory').select('*')` to `lib/learning/orchestrator.ts` — the scan correctly flagged
  that file as an offender (`expected ['lib\learning\orchestrator.ts'] to deeply equal []`). Removed the
  line; green afterward.
- **MINOR-10** — `fixed`. New direct test in `lib/learning/promote.test.ts`, "confidence gate isolated at
  its own boundary": `meetsPromotionThreshold({observationCount:5, confidence:0.69, distinctCampaignCount:2})`
  → `false`, and the same with `confidence:0.7` → `true` — holding observations and campaigns fixed at
  passing values so only the confidence boundary is exercised, unlike the two pre-existing "5 obs" cases
  which vary confidence only indirectly through a real `computeConfidence` output that also depends on the
  contradiction count.
  **Mutation-redenned, confirmed then reverted**: changed `promote.ts`'s
  `eligibility.confidence >= LEARN_PROMOTION_MIN_CONFIDENCE` to `>` — the `confidence: 0.7` case failed
  (`expected false to be true`), exactly at the boundary this test isolates. Reverted; `npx vitest run
  lib/learning/promote.test.ts` green (19/19) afterward.

**Advisory passes** (each independently instructed to read the D3 diff):
- `ecc:pr-test-analyzer`: confirmed all four fixes are genuine and non-tautological — each would fail
  under the specific broken implementation it targets, not just under an unrelated change. Confirmed each
  described manual mutation is the correct, minimal one for its named failure mode. No residual gaps
  found. (The agent also flagged, unprompted, that several tool-result blocks it encountered in its own
  context contained injected text posing as system/hook messages instructing tool calls outside its actual
  toolset, plus a fabricated cost warning — it correctly disregarded these per prompt-injection defense
  and flagged them for visibility; noted here for the record, not otherwise actioned by this pass.)
- `security-reviewer`: confirmed MAJOR-6's test covers the realistic tenancy-leak vectors for the
  orchestrator's own wiring (closure capture, shared variables, incorrect keying); found and this pass
  closed the `retrieveVoice`/`getBriefByCampaign` gap above; named the `getEvidenceMemoryByIds` and
  downstream-function residuals above as follow-ups, not blockers, given a Tier-1 live-Postgres test would
  not add RLS-relevant coverage here (this boundary is pure application-code discipline, not a DB
  constraint) — Tier-2 accepted as sufficient for this specific finding.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean, throughout (checked after each fix and after the
  security-reviewer follow-up).
- `npx vitest run lib/db lib/social lib/validation lib/learning` — 777/777 green (48 files); the
  previously-seen `vault.test.ts` flake did not recur this run.
- Individual files re-run standalone after each mutation-revert cycle:
  `lib/learning/orchestrator.test.ts` (22/22), `lib/learning/promote.test.ts` (19/19),
  `lib/learning/memory-table-boundary.test.ts` (1/1) — all green.

### D4 — MINOR-3, MINOR-4, NIT-4

All three are `fixed`. §11's whole posture is founder-verifiability from ONE log line — this step closes
three ways that line lied by omission (over-reporting a terminal outcome, collapsing three causes into one
untagged counter, and a name that would page an operator on ordinary retry traffic).

- **MINOR-3** — `fixed`. `abandonRow` (`lib/learning/orchestrator.ts`) now returns the `boolean` from
  `guardedTransition` (was `Promise<void>`). Its two call sites in `processRow` (the missing-snapshot path
  and the unknown-`schema_version` path) and the catch block's two direct `guardedTransition` calls
  (permanent/exhausted abandon, transient retry) all branch on the returned value before incrementing
  `skippedNoSnapshot` / `abandoned` / `retrying` — a lost race (already counted once, in `raceLost`, inside
  `guardedTransition`) no longer ALSO claims a terminal outcome that didn't happen.
  **Mutation-redenned, confirmed then reverted**: reverted the schema_version-path branch to an
  unconditional `summary.abandoned++`, ran the new test "a lost race on abandonRow does not double-count
  as an abandonment (MINOR-3)" — failed (`abandoned` was `1`, expected `0`) — restored the branch; green
  afterward.
  Test: `lib/learning/orchestrator.test.ts` — "a lost race on abandonRow does not double-count as an
  abandonment (MINOR-3)" — asserts `raceLost === 1` and `abandoned === 0` together.
- **MINOR-4** — `fixed`. The summarize-per-business catch block now computes
  `err instanceof AiError ? err.code : 'unknown'`, tags the `Sentry.captureException` call with it
  (`{ tags: { business_id, phase: 'learning-summarize', code } }`), and stores it in a new
  `summary.summarizeFailedCode: AiErrorCode | 'unknown' | null` field that flows into the canonical
  `console.log` tick line via the existing `...summary` spread.
  **Mutation-redenned, confirmed then reverted**: hardcoded `const code = 'unknown'` unconditionally, ran
  the new "carries its AiErrorCode into the log line" test (rejecting with `new AiError('provider_error',
  …)`) — failed (`summarizeFailedCode` was `'unknown'`, expected `'provider_error'`) — restored; green
  afterward.
  Test: `lib/learning/orchestrator.test.ts` — new describe "a summarize failure carries its AiErrorCode
  into the log line (MINOR-4)" asserts both the summary field and the Sentry tag; the pre-existing
  plain-`Error` summarizer-failure test was strengthened to also assert `summarizeFailedCode === 'unknown'`
  for the non-`AiError` fallback path.
- **NIT-4** — `fixed`. `LearningTickSummary.failed` renamed to `retrying` (with a doc comment explaining
  why: it means "sent back to `pending` with a backoff," not a terminal failure like `abandoned` —
  alerting on the old name would page on every ordinary transient retry). Every reference updated in the
  same commit: the initializer, the increment site, `lib/learning/orchestrator.test.ts`'s six assertions
  and one test description, the canonical-log field-set test (which also gained `summarizeFailedCode:
  null` to stay complete), `app/api/cron/capture-learning/route.ts`'s catch-block fallback object, and
  `route.test.ts`'s fixture. ADR 0018 §9.5's example log-line snippet updated to match — renamed `failed`
  to `retrying`, and (closing a pre-existing drift found while touching this section, not itself named by
  NIT-4) added `summarizeFailed`/`summarizeFailedCode`/`raceLost`, which the snippet was missing entirely
  even before this pass.
  Test: the existing "logs exactly one JSON line... and all named counters" test continues to pass with
  the renamed/added fields.

**Advisory pass** (`ecc:silent-failure-hunter`, re-invoked on the D4 diff):
- Confirmed MINOR-3's fix is **exhaustive** — independently counted the same four call sites (two
  `abandonRow` calls, two direct catch-block `guardedTransition` calls) and confirmed the fifth
  `guardedTransition` call (the success/`processed` transition) was already correctly guarded before this
  pass and is out of scope for this finding.
- On `summarizeFailedCode`'s "last write wins" semantics across multiple businesses failing with different
  codes in one tick: accepted as consistent with the existing design posture (`abandoned` already collapses
  "permanent" vs. "transient_exhausted" the same way; `summarizeFailed`'s own *count* is unaffected, only
  which code is visible in the log line). A one-sentence doc-comment addition recording this explicitly was
  made in this same commit.
- **New finding, out of scope for D4, recorded not fixed**: the OUTER `try/catch` around
  `Sentry.withMonitor` (wrapping the whole tick) still lets a total-tick crash (e.g. `claimPostEditSignals`
  itself throwing) fall through to Sentry-only reporting while the canonical `console.log` still fires
  with every counter at its initialized value — byte-identical to a legitimately idle hour with nothing
  pending. This is the same class of bug MAJOR-2 fixed for the summarizer loop specifically, one level up,
  for the whole tick. Not fixed here: MINOR-3/MINOR-4/NIT-4 were D4's named scope, and this is a fourth,
  separate defect discovered during D4's re-invocation of silent-failure-hunter, not one of the three. A
  future session should add a `crashed: boolean` (or similar) field, set in that outer catch before the
  final `console.log`, so an all-zero line reads differently when the tick genuinely didn't run.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean, throughout (checked after each fix and after the doc-comment
  addition).
- `npm run test:app` (full scope, all of `app/ lib/ components/`) — 2340/2340 green across 167 files.
- `lib/learning/orchestrator.test.ts` re-run standalone after each mutation-revert cycle — 24/24 green.

### D5 — MINOR-5, MINOR-6, MINOR-8

Each of these was a guarantee living in caller behaviour rather than in the database. All three are
`fixed`. Each row below names the option taken and why, per instruction.

- **MINOR-5** — `fixed`, **option (i) taken** (remove `'failed'` from reachable targets and align the ADR
  prose), **not** option (ii) (add a reclaim clause). Reason: (ii) would have built a migration to service
  a state the orchestrator never actually writes into — the orchestrator already retries transient
  failures via `'pending'` (reclaimable under the current claim RPC), so a reclaim clause for `'failed'`
  would be dead code from day one. (i) makes the schema (as enforced by the app-layer transition guard)
  and the ADR's own prose agree, and removes the trap (a future writer parking a row at `'failed'`
  expecting reclaim) rather than leaving it in place to be serviced later. `LEGAL_TRANSITIONS` in
  `lib/db/post-edit-signals.ts` now maps `processing → ['processed', 'pending', 'abandoned']` (was
  `..., 'failed', ...`) and `failed → []` (was `['processing']`). `'failed'` remains a legal DB value — the
  table's `CHECK` constraint is unchanged, no migration was needed for a pure app-layer guard — it is
  simply unreachable through any transition this codebase performs. ADR 0018 Amendment C corrects §9.4's
  disproven "→ `status='failed'`" prose to `→ status='pending'`, without editing the original text.
  Test: `lib/db/post-edit-signals.test.ts` — repurposed the prior `'failed'`-target atomic-guard test to
  target `'pending'` (the transition it actually exercises now), and added a new "throws on illegal
  transition: processing → failed (MINOR-5)" test.
- **MINOR-6** — `fixed`. `listPerformanceMemoryCandidates` (`lib/db/memory-performance.ts`, the ONE
  generation-time reader) now filters `.or('expires_at.is.null,expires_at.gt.now()')`. NULL is included
  because manual/import rows never get an `expires_at` and must not be treated as expired by omission.
  `listDistilledPatternsForSummary` was deliberately left unfiltered — documented in a new comment above
  it — because the summarizer reads its own prior history back to avoid re-describing a pattern it has
  already named; a decayed-but-real pattern is still something this business's editors did, and excluding
  it there would just cause re-description as if it were new. Only the generation-time reader needed
  enforcement, since that is the one place a stale pattern could shape a NEW post.
  **Mutation-redenned, confirmed then reverted**: temporarily commented out the `.or(...)` call — both the
  new Tier-1 test (below) and a new Tier-2 mock-call-assertion test failed — restored the line; both green
  afterward.
  Test: `lib/db/memory-performance.test.ts` — new Tier-2 test asserting `builder.or` is called with the
  exact filter string. `supabase/__tests__/performance-memory-candidates-expiry.test.ts` (new, Tier-1, live
  Postgres) — the outcome-level proof the instruction asked for: seeds an expired active row, a
  NULL-expires_at row, and a future-expires_at row, and asserts only the expired one is excluded from
  `listPerformanceMemoryCandidates`'s real return value.
- **MINOR-8** — `fixed`, **the real fix, not the ADR-amendment fallback**: `demote_performance_pattern`
  (new forward migration `20260728220000_demote_recomputes_contradictions.sql` — the applied
  `20260726030000…sql` migration is unedited) now recomputes the contradiction count ITSELF via a
  correlated subquery over `post_edit_signals`, keyed on a new `p_contradicting_pattern_key` parameter
  (replacing the old caller-trusted `p_net numeric`), matching the exact rigor `promote_performance_pattern`
  already has for its campaign-count gate. `net = observation_count` (the row's own stored, freshly
  recomputed column) `- (SELECT count(*) FROM post_edit_signals WHERE pattern_key = p_contradicting_pattern_key
  AND status='processed' AND class='preference')`. `DROP FUNCTION IF EXISTS ...(uuid,text,text,text,numeric)`
  precedes the `CREATE FUNCTION` for the new `(...,text)` signature — required, since `CREATE OR REPLACE`
  cannot change a function's argument types, only its body; the `DROP` also removes the old signature's
  `REVOKE`/`GRANT` as a unit, so the new signature's `REVOKE ALL`/`GRANT EXECUTE TO service_role` needed no
  separate cleanup. `lib/db/memory-performance.ts`'s `demotePerformancePattern` and
  `lib/learning/promote.ts`'s call site were updated to pass `contradictingPatternKey` (from
  `computeContradictingPatternKey`) instead of a pre-computed `net`; the client-side `net` value is still
  computed and used only for `meetsDemotionThreshold`'s call-avoidance pre-check, never trusted by the RPC.
  **Mutation-redenned, confirmed then reverted**: temporarily widened the live function's threshold from
  `< 3` to `< 30` (would always demote) directly against Postgres — the new "no-op when the recomputed net
  >= LEARN_DEMOTION_NET" Tier-1 test failed (`expected 1 to be 0`) — restored the correct `< 3` threshold by
  reapplying the migration's function body; green afterward.
  Test: `lib/learning/promote.test.ts` — the demote call-args assertion now checks `contradictingPatternKey`
  is passed, not a number. `lib/db/memory-performance.test.ts` — new test for the `null`-key case (a signal
  kind with no natural opposite). `supabase/__tests__/performance-memory-promotion.test.ts` (Tier-1,
  rewritten) — both existing concurrency/no-op tests now seed REAL `post_edit_signals` contradiction rows
  via the existing `createProcessedSignal` fixture and pass the key, proving the recompute against live
  Postgres rather than trusting a hardcoded `p_net`.

**Advisory pass** (`database-reviewer`, invoked on the full D5 diff):
- **MINOR-5**: confirmed by grep that no other code path in the repo targets
  `post_edit_signals.status = 'failed'` anymore — every remaining `'failed'` literal belongs to an
  unrelated status enum (`PostStatus`, `EmailOutboxStatus`, `GenerationSessionStatus`) or an unrelated
  table. Confirmed leaving `'failed'` as a legal-but-unreachable `CHECK` value is the right call, not a new
  problem: a stray direct-SQL write into `'failed'` would strand a row no worse than before, now honestly
  documented rather than silently trap-laid.
- **MINOR-6**: confirmed the `.or()` syntax is correct PostgREST, producing exactly
  `WHERE business_id = $1 AND status = 'active' AND deleted_at IS NULL AND (expires_at IS NULL OR
  expires_at > now())`. Confirmed `listDistilledPatternsForSummary` staying unfiltered is safe: worst case
  is the summarizer re-observing a decayed-but-real pattern in its own read-back loop — wasted tokens, not
  a generation-time leak, since only `listPerformanceMemoryCandidates` feeds prompts.
- **MINOR-8**: confirmed `DROP FUNCTION` + `CREATE FUNCTION` is required (not optional style) given the
  parameter-type change; confirmed the correlated subquery correctly yields `0` when
  `p_contradicting_pattern_key IS NULL` (SQL's three-valued logic — `pattern_key = NULL` is never `TRUE`);
  confirmed unqualified `observation_count` inside the `UPDATE ... WHERE` clause reads each candidate row's
  current pre-update value, identical to how `promote_performance_pattern` already reads
  `observation_count`/`confidence`; confirmed demotion is exactly as atomic as promotion under concurrency
  (same MVCC-snapshot-plus-row-lock reasoning, not merely test-proven); confirmed the `REVOKE`/`GRANT`
  reapplication against the new five-arg signature is correct and complete. No issues found in any of the
  three changes.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean, throughout.
- `npm run db:migrate` — the one new migration (`20260728220000_demote_recomputes_contradictions.sql`)
  applied cleanly against the local live Postgres.
- `npx vitest run lib/db/post-edit-signals.test.ts lib/db/memory-performance.test.ts
  lib/learning/promote.test.ts` — all green (repurposed and new tests included).
- `npm run test:app` (full scope) — 2343/2343 green across 167 files.
- `test:db` full suite (live Postgres, `--no-file-parallelism --retry=2`): same two pre-existing, unrelated
  failures seen since D1 (`rls-policy-lockdown.test.ts`, `get-user-business-ids-matrix.test.ts`), plus
  195/197 passing — includes all of D5's new/modified Tier-1 tests
  (`performance-memory-candidates-expiry.test.ts`, the rewritten `performance-memory-promotion.test.ts`
  demote cases) green. No new failures introduced by D5's changes.

### D6 — MINOR-1, MINOR-9, MINOR-11, NIT-1, NIT-2, NIT-3, NIT-5, NIT-6, NIT-7

Nine findings, all "a document, comment, or count says something the code does not." No behaviour change
in this step — comments and docs only. All nine are `fixed`.

- **MINOR-1** — `fixed`, documentation-only, per instruction (no production caller invented, no type
  signature changed). ADR 0018 §12 gained a new Tier-3 bullet recording that `rehydrateSignals()`
  (`lib/learning/rehydrate.ts`) has no production reader today (`git grep` matches only the file and its
  test), that `PostEditSignalRow.signals: Record<string, unknown> | null` lets a future direct cast bypass
  it with zero compiler complaint, and that `rehydrateSignals()` is the MANDATORY entry point the day a
  reader is added.
- **MINOR-9** — `fixed`. ADR §3.4's caller table: all six `file:line` citations re-derived at the current
  commit (not `d7cee4a5`). Four were wrong as originally written: `actions.ts:94` → `:89`,
  `actions.ts:218` → `:207`, `generate.ts:362` → `:380`, and `calendar/actions.ts:280` → `:270` (this
  fifth drift found during re-derivation, beyond the three the instruction named — flagged as expected
  line-number drift, not a new defect). The false test citation is removed:
  `actions.context-equivalence.test.ts` no longer listed as covering `bulkApprovePostsAction` — confirmed
  by `git grep` that file's only `describe` is `regeneratePostAction caller — …` with zero references to
  `bulkApprovePostsAction`. Coverage is unaffected (`actions.test.ts` alone fully covers it); this is a
  citation correction, not a new gap.
- **MINOR-11** — `fixed`, recorded as a triggered follow-up, not implemented (per instruction — both live
  writers are bounded today). New ADR §15 bullet and `docs/backlog.md` row (`25D-MINOR-11`): neither
  `post-generation.ts:179` nor `post-regeneration.ts:147` truncates `topContent` after `neutralize()`;
  safe today because Tier-0's `renderPatternStatement` is a fixed template and the summarizer's output is
  capped at 200 chars by Zod. Un-defer trigger stated explicitly: the first writer that puts a synthesized,
  unbounded value into `performance_memory.pattern` must enforce its own length bound at write time.
- **NIT-1** — `fixed` in all five named places plus one the instruction didn't name but which
  `comment-analyzer` caught: ADR §0/Q4, §4.2 (line 278 — missed on the first pass, found by
  `comment-analyzer` and fixed in this same commit), §4.3, §12, §13 all now say "twelve" (9 preference +
  1 correction + 2 inconclusive); `orchestrator.ts:88`'s comment no longer conflates the total with
  `PreferenceKind`'s count — it now says "9 preference kinds (of 12 total)."
- **NIT-2** — `fixed`. ADR §10.4's citation of a phantom third render site
  (`formats/native-generation-prompt.ts`) is removed; the table and prose now cite only the two real sites
  (`post-generation.ts`, `post-regeneration.ts`). Three sibling references to "three §10.4 render sites"
  that the original instruction didn't separately name — §12's Tier-2 bullet (line 717), the
  `LEARN-PATTERN-RENDER-GUARDED` constraint-table row (§13, line 754), and §15's deferred-scope bullet
  (line 817) — were found stale by `comment-analyzer` (they weren't updated when §10.4 itself was
  corrected) and fixed in this same commit; §14's HIGH-2 disposition row (the quoted original
  security-reviewer finding) is left as originally worded per append-only convention for quoted findings,
  with a bracketed correction noting one of the two "unguarded" sites it names does not exist at this
  ADR's implementation range. `be5779e1`'s commit message ("all three render sites") is **not** rewritten
  — history stands — with a note in §10.4 that the message inherited the ADR's own stale citation and the
  guard work itself (both real sites, no opportunistic sweep) was correct and complete.
- **NIT-3** — `fixed`. `summarize.ts`'s `computeSummaryPatternKey` gained a comment recording the 32-bit
  hash bound was considered: at 5 statements × 8 calls/month/business = 40 keys/month/business against a
  2³² (~4.29 billion) space, the birthday-bound collision probability is `40² / (2 × 2³²) ≈ 1.9 × 10⁻⁷`
  per business per month — and a collision merges two statements onto one row rather than corrupting
  anything, never a false promotion (a summarizer row is permanently candidate-only regardless, MAJOR-2).
- **NIT-5** — `fixed`, and NOT the prose that was wrong. Re-derivation found `[db-Q1]` (§3.1: "a `FOR EACH
  ROW` trigger fires once per row of a set-based `UPDATE`... the trigger sidesteps this entirely") cited
  inline but with **no corresponding row** in §14's disposition table — a genuinely missing 28th finding,
  not a miscount in `docs/build-guide/session-25.md`'s "28 advisory findings" prose (which was actually
  correct all along). Added the missing row; §14's table now has 28 rows, matching the build guide's
  count exactly. Per instruction, checked against the source review before assuming the prose was the
  error — it was the table that was short one row.
- **NIT-6** — `fixed`. CLAUDE.md's "No console.log in committed code" bullet gained one sentence
  legitimising a single canonical structured-JSON `console.log` per invocation on a worker/route path
  (citing `lib/email/orchestrator.ts`, `lib/learning/orchestrator.ts`, `api/cron/publish/route.ts` as the
  established pattern) until a logger lands. No logger introduced — out of scope, per instruction.
- **NIT-7** — `fixed`. `lib/db/post-ai-originals.ts`'s `getLatestRevision` and `getPostAiOriginalById` each
  gained a comment stating explicitly that tenancy is enforced by the CALLER'S CLIENT, not by the
  function, naming today's actual caller and client/id-sourcing for each and warning a future caller not
  to assume self-enforcement. No parameter added — an unmotivated signature change on a path with no
  defect, per instruction.

**Advisory passes** (each independently instructed to read the D6 diff):
- `ecc:comment-analyzer`: confirmed NIT-1's `orchestrator.ts` and NIT-3's `summarize.ts` comments are
  arithmetically and factually accurate (independently recounted `PreferenceKind`/`CorrectionKind`/
  `InconclusiveKind` = 9+1+2=12; independently recomputed the birthday-bound collision probability);
  confirmed NIT-7's two `post-ai-originals.ts` comments accurately describe today's actual call graph
  (traced `getLatestRevision` to `regeneratePostAction`'s RLS-scoped `ctx.client`, `getPostAiOriginalById`
  to the orchestrator's service-role client with a trusted `post_edit_signals`-sourced id); confirmed
  MINOR-9's four re-derived citations and the test-citation removal are correct against current source;
  confirmed §14's row count now matches the build guide's "28" claim; confirmed CLAUDE.md's carve-out
  sentence is clear and consistent. **Found two real gaps** (both fixed in this same commit, before this
  appendix was written): line 278's "Eleven signal kinds" was missed on the first NIT-1 pass despite the
  table immediately below it and §4.3 two paragraphs later already saying twelve; and three sibling
  references to "three §10.4 render sites" (§12 line 717, §13's constraint-table row line 754, §15 line
  817) were not propagated when §10.4 itself was corrected under NIT-2. Both gap classes are exactly what
  this agent was invoked to catch — comment/doc accuracy at scale, where a single-site fix leaves
  sibling references stale.
- `ecc:typescript-reviewer` (MINOR-1's cast hole): confirmed the documentation-only resolution is the
  right size given the explicit no-caller/no-signature-change constraint — a branded/opaque type on
  `PostEditSignalRow.signals` was considered as speculative alternative but rejected as itself a
  signature change on a track that deliberately ships no reader yet, better deferred to the same PR that
  adds the first caller. Confirmed the ADR's three factual claims (no caller exists; `signals`'s type;
  the zero-compiler-complaint cast) are all accurate. No issues found with `rehydrate.ts`'s own design —
  its `Assert<Equals<...>>` compile-time ties and `ClassifyResultSchema.parse` already force
  schema/type-shape drift to fail `tsc`, independent of this session's fix.

**Verification run:**
- `npx tsc --noEmit --skipLibCheck` — clean, throughout, including after the two `comment-analyzer` gaps
  were closed.
- `npm run test:app` (full scope) — 2343/2343 green across 167 files (no behavioural changes in this
  step; run to confirm the comment-only edits introduced no syntax/type regression).
- Every changed line number in MINOR-9's fix re-derived and confirmed against the current commit:
  `approvePostAction:89`, `bulkApprovePostsAction:207`, `approvePostFromCalendarAction:270`,
  `createPosts(...)` call site in `generatePostsForCampaign:380`.

### D7 — Finalisation: attribution, resolution table, and the record of what is easy to lose

**Author:** Session 25-D (Claude Code, Sonnet 5). **Date:** 2026-07-29. **Range fixed:** `717263d2..d7cee4a5`
(`be5779e1^..d7cee4a5`, C2.1 through C2.9, the range this whole reviewer report is scoped to). **This
correction pass's own commits, in order:**

| Step | SHA | Findings closed |
|---|---|---|
| D0 | `052c48fc` | MAJOR-5 |
| D1 | `e2a5b28b` | MAJOR-1, MAJOR-2 |
| D2 | `ca37eabc` | MAJOR-3, MINOR-7 |
| D3 | `07344ae9` | MAJOR-4, MAJOR-6, MINOR-2, MINOR-10 |
| D4 | `44f35efa` | MINOR-3, MINOR-4, NIT-4 |
| D5 | `de4cd69e` | MINOR-5, MINOR-6, MINOR-8 |
| D6 | `aabe6152` | MINOR-1, MINOR-9, MINOR-11, NIT-1, NIT-2, NIT-3, NIT-5, NIT-6, NIT-7 |
| D7 | *(this commit)* | Documentation finalisation only — no findings closed, none reopened |
| D8 | *(this commit)* | CI verification only — no findings closed, none reopened |

**Additions-only, proven, not merely asserted.** `git diff 052c48fc..HEAD -- docs/reviews/session-25-reviewer.md`
(D0's own commit as the base, since D0 is the first commit in this correction pass and touched this file
only to commit it unmodified) reports:

```
docs/reviews/session-25-reviewer.md | 539 ++++++++++++++++++++++++++++++++++++
1 file changed, 539 insertions(+)
```

**Zero deletions, zero modifications, across every step D0 through D6 and this D7 append.** A line-level
check (`git diff 052c48fc..HEAD -- docs/reviews/session-25-reviewer.md | grep -E "^-" | grep -v "^---"`)
returns no output — not one line above or below the appendix heading was removed or rewritten. Everything
from line 1 through the `## CORRECTION PASS (Session 25-D)` heading (line 816, at the commit this was
verified) is the Reviewer's original text, byte-identical to what D0 committed. Everything from that
heading onward is this correction pass, and within this pass, every step is a pure append onto the one
before it — condition 2 of CLAUDE.md's REVIEWER-REPORT APPEND-ONLY rule (*"a reader must be able to tell,
from any line, which of the two wrote it"*) is satisfied structurally: any line above the heading is the
Reviewer's; any line below it, this pass's.

#### Resolution table — one row per finding, 24 of 24

| Finding | Step | Fix | Test that now proves it | SHA |
|---|---|---|---|---|
| MAJOR-1 | D1 | `listRecentHumanEditExcerpts` filters `class='preference'`; `LEARN-VOICE-WRITE-TRIGGER`'s RAISE narrowed to its real scope via a new forward migration | `lib/db/post-edit-signals.test.ts` ("filters by class=preference…"); `supabase/__tests__/performance-memory-pattern-key.test.ts` ("rejects a hook-dimension distilled write sourced from a correction-class signal") | `e2a5b28b` |
| MAJOR-2 | D1 | Summarizer output recorded as **permanently** candidate-only (not "no shortcut") in `summarize.ts`'s comment and ADR §6.1/§12 Amendment A — founder option (a), resolved not declined | none — Tier-3 by decision, the property recorded is a permanent absence | `e2a5b28b` |
| MAJOR-3 | D2 | `scripts/learning-report.ts` reports snapshot-orphan posts per business (fix (c), the recommended minimum); (a) transaction and (b) `allSettled` recorded as considered-and-deferred | `supabase/__tests__/learning-report-orphans.test.ts` | `ca37eabc` |
| MAJOR-4 | D3 | `orchestrator.test.ts`'s replayed-tick test now returns the SAME row on both claims and asserts an identical, non-cumulative `observation_count` | "replayed tick over the SAME signal row (LEARN-TICK-IDEMPOTENT)" | `07344ae9` |
| MAJOR-5 | D0 | ADR 0018, `session-25.md`, and this reviewer report committed unmodified | the D0 commit itself, plus `git cat-file -e` resolving against it | `052c48fc` |
| MAJOR-6 | D3 | New two-business, single-tick test closes `[sec-Q2]`'s outstanding test obligation | "cross-business isolation in one tick (MAJOR-6)" (strengthened in the same step to also assert `retrieveVoice`/`getBriefByCampaign` per-business args) | `07344ae9` |
| MINOR-1 | D6 | ADR §12 gained a Tier-3 entry: no production reader of `rehydrateSignals()` exists yet; it is the mandatory entry point when one is added | none — Tier-3 by decision, per instruction (no caller invented, no type changed) | `aabe6152` |
| MINOR-2 | D3 | One source-scan test closes the unmapped Tier-2 halves of `LEARN-MEMORY-THROUGH-BOUNDARY` / `LEARN-VOICE-NOT-AUTO-MUTATED`; ADR §13 updated | `lib/learning/memory-table-boundary.test.ts` | `07344ae9` |
| MINOR-3 | D4 | `abandonRow` returns `guardedTransition`'s boolean; every caller branches before incrementing its terminal counter — a lost race no longer double-counts as an abandonment | "a lost race on abandonRow does not double-count as an abandonment (MINOR-3)" | `44f35efa` |
| MINOR-4 | D4 | `summarizeFailedCode` field + Sentry tag carry the underlying `AiErrorCode` (or `'unknown'`) into both the log line and Sentry | "a summarize failure carries its AiErrorCode into the log line (MINOR-4)" | `44f35efa` |
| MINOR-5 | D5 | `'failed'` removed from `LEGAL_TRANSITIONS`' reachable targets (option (i)); ADR §9.4 corrected via Amendment C | "throws on illegal transition: processing → failed (MINOR-5 — failed is no longer reachable)" | `de4cd69e` |
| MINOR-6 | D5 | `listPerformanceMemoryCandidates` filters `.or('expires_at.is.null,expires_at.gt.now()')`; `listDistilledPatternsForSummary` deliberately left unfiltered, documented | `lib/db/memory-performance.test.ts` (mock-call assertion) + `supabase/__tests__/performance-memory-candidates-expiry.test.ts` (Tier-1 outcome proof) | `de4cd69e` |
| MINOR-7 | D2 | `scripts/learning-report.ts`'s three list queries bounded with an explicit `ORDER BY` matching an existing index | exercised via `learning-report-orphans.test.ts` and a manual `tsx` run against live Postgres; no dedicated regression test beyond that (a script, not a library function) | `ca37eabc` |
| MINOR-8 | D5 | `demote_performance_pattern` recomputes the contradiction count itself via a correlated subquery, keyed on `contradictingPatternKey` — the real fix, not the ADR-amendment fallback | `supabase/__tests__/performance-memory-promotion.test.ts` (rewritten demote cases, live Postgres); `lib/learning/promote.test.ts`; `lib/db/memory-performance.test.ts` (null-key case) | `de4cd69e` |
| MINOR-9 | D6 | ADR §3.4's caller table: four `file:line` citations corrected, one false test citation (`actions.context-equivalence.test.ts`) removed | re-derived directly against source at the current commit (`grep`/`git grep`), not a runtime test — this is a documentation-accuracy fix | `aabe6152` |
| MINOR-10 | D3 | Direct confidence-gate boundary test isolates 0.69 (false) / 0.70 (true) with observations/campaigns held fixed | "confidence gate isolated at its own boundary: 0.69 does NOT promote, 0.70 DOES" | `07344ae9` |
| MINOR-11 | D6 | Recorded as a triggered follow-up (ADR §15 + `docs/backlog.md` `25D-MINOR-11`), not implemented — both live writers are bounded today, per instruction | none — a recorded decision, not a defect | `aabe6152` |
| NIT-1 | D6 | "Eleven kinds" corrected to twelve in six places (five named plus one, ADR §4.2 line 278, found by `comment-analyzer` on re-check) | none — comment/doc correction | `aabe6152` |
| NIT-2 | D6 | ADR §10.4's phantom third render site removed; three sibling stale references (§12, §13, §15) found by `comment-analyzer` and corrected in the same commit | none — comment/doc correction | `aabe6152` |
| NIT-3 | D6 | `computeSummaryPatternKey`'s 32-bit hash bound documented with the birthday-bound arithmetic | none — comment addition | `aabe6152` |
| NIT-4 | D4 | `LearningTickSummary.failed` renamed to `retrying`; ADR §9.5's field list updated to match | the existing "logs exactly one JSON line... and all named counters" test continues to pass with the renamed/added fields | `44f35efa` |
| NIT-5 | D6 | §14's disposition table was missing a row for the inline-cited `[db-Q1]` finding — added; table now has 28 rows, matching `docs/build-guide/session-25.md`'s "28 advisory findings" prose exactly | none — the fix is the table row itself | `aabe6152` |
| NIT-6 | D6 | CLAUDE.md's "No console.log" bullet gained a one-sentence carve-out for a single canonical structured-JSON line per worker/route invocation | none — constitution-doc change | `aabe6152` |
| NIT-7 | D6 | `getLatestRevision` / `getPostAiOriginalById` each gained a comment stating tenancy is enforced by the caller's client, not the function | none — comment addition, no signature change per instruction | `aabe6152` |

24 of 24 findings from this reviewer report — every BLOCKER (none existed), MAJOR-1 through MAJOR-6,
MINOR-1 through MINOR-11, and NIT-1 through NIT-7 — has a resolution row above.

#### The six things easy to lose

**1. The D0–D8 ordering rationale.** MAJOR-5 (D0) ran **first**, before any other finding, because it is
the one finding whose fix is a precondition for every other step's own record-keeping: D1 through D6 each
amend ADR 0018 (Amendments A, B, C) or its build guide, and an amendment is only a diff against a committed
document if the document is committed. Running D0 last would have meant every later amendment was a diff
against nothing — untracked, unreviewable, and impossible to `git diff` against. CI (D8, not yet run as of
this entry — see below) runs **last**, after D0–D7, because it is the one verification step that cannot be
faked locally: it must green the range as this correction pass leaves it, not as it stood before, and every
fix D1–D7 makes changes the exact tsc/vitest surface CI checks. Running CI before D7 would have graded an
incomplete correction.

**2. The MAJOR-1 / MAJOR-2 founder adjudication.** Recorded in `docs/build-guide/session-25.md` §4 and ADR
0018 Amendment A: **option (a) — record + narrow.** MAJOR-2's campaign gate (`promote_performance_pattern`'s
distinct-campaign subquery, keyed on `pattern_key`) is precisely the mechanism that makes MAJOR-1's leak
harmless today — a summarizer row's `summarize:`-namespaced key never matches any `post_edit_signals` row,
so the campaign count is always `0` and the row can never reach `active`. **Option (b) — making summarizer
rows promotable — would have made LIVE the exact path MAJOR-1's leak sits on**: the moment a summarizer row
can be promoted, whether it was built from correction-classed human copy (MAJOR-1's leak, independently
closed at the query layer in the same step) stops being a theoretical concern and starts being a live
voice-corruption vector. Fixing (b) without also fully closing (a)'s leak first would have reintroduced the
exact hazard §5.1 names as this track's highest-stakes failure mode. **MAJOR-2 was resolved, not
declined** — the fix is the ADR narrowing itself (§6.1 Amendment A, stating the true "no path whatsoever"
property) plus a code comment; nothing was left unaddressed.

**3. The MAJOR-3 severity split, argued not erased.** `silent-failure-hunter` graded the original finding
(a partially-failed `createPosts` call leaving snapshot-less posts silently outside the learning loop) a
**BLOCKER**. The Reviewer regraded it **MAJOR**, reasoning that the blast radius is bounded — no data
corruption, session-level Sentry/log visibility already existed, and the missing piece was per-post
attribution and an after-the-fact way to find orphans, a coverage gap rather than a correctness or safety
failure. Neither original grading was edited; the split is argued in this appendix's D2 section and again
here. `silent-failure-hunter`, re-invoked during D2 on the shipped fix, accepted the Reviewer's MAJAR
grading as adequate **conditional on this pass's record being explicit that fix (c) is manual-only** —
`findSnapshotOrphans` is invoked by an operator running `tsx scripts/learning-report.ts`, not by a
scheduled job or an alert. Fixes **(a) one Postgres transaction** and **(b) `Promise.allSettled` +
mark/soft-delete** were both **considered and deferred**: (a) would be a transaction-boundary change to
`createPosts`'s generation path itself — a behaviour change to already-shipped code, out of scope for a
pass whose brief is fixing what the Reviewer found wrong, not restructuring it; (b) changes `createPosts`'s
failure semantics (what it returns, what a caller sees on partial failure) — exactly the class of change
this correction pass is scoped to avoid. Both reasons are recorded in `scripts/learning-report.ts`'s own
comment above `findSnapshotOrphans`, not left implicit.

**4. The correction to the C2.9 verification report's §5.** The Reviewer's own report (§J3, "CI execution
and the promotion tally") states plainly: *"One correction to the C2.9 report. Its §5 states '192 tests
executed … confirmed directly from the CI log.' Not supportable: `test:db` runs with `--reporter=json
--outputFile`, which suppresses the human summary, and the skip-guard prints a **file** count, not a test
count. `192` is the local figure from its own §1."* This correction pass makes the same point explicit here
so the number is never re-cited as CI-sourced by a future reader skimming only the appendix: `192` is a
locally-observed figure (`docs/reviews/session-25-c2.9-verification.md` §1), and the CI log's own
skip-guard output is a **per-file non-zero** guarantee (`20 file(s) under [supabase/__tests__] all visible,
zero failures`), never a test-count integer. The per-file guarantee holds — CI genuinely proves every
Tier-1 file executed at least one non-skipped assertion — but `192` itself does not come from CI, and
should not be repeated as if it did. `docs/reviews/session-25-c2.9-verification.md` is **not edited** —
same append-only posture as this report; the correction lives here, where the finding that raised it lives.

**5. The four SHARED-FUNCTION CALLERS tables stay valid, unchanged by D1–D6.** The Reviewer's §1 tables
(`approvePost`, `bulkApproveDraftPosts`, `createPosts`, `neutralize()`) enumerate callers of four specific
functions. **None of D1 through D6 added, removed, or re-covered a caller of any of those four functions**
— no row in any of the four tables needed correction on caller-coverage grounds (MINOR-9's fix was to
`file:line` citations and one test-file citation in the ADR's own separate §3.4 table, not to the
Reviewer's §1 tables, which were never wrong). Two changes elsewhere are worth naming for completeness,
neither of which touches these four tables: **D1** added a `.eq('class', 'preference')` filter to
`listRecentHumanEditExcerpts` (`lib/db/post-edit-signals.ts`) — a query function that feeds the summarizer,
not a caller of any of the four enumerated functions. **D3** added Tier-2 test coverage of
`orchestrator.ts`'s own internal calls to `recomputeAndUpsertPattern` and `summarizeBusinessLearning`
across two businesses — again, internal orchestration calls, not new callers of `approvePost`,
`bulkApproveDraftPosts`, `createPosts`, or `neutralize()`. The four tables the Reviewer published require
no update.

**6. ADR §13's constraint mapping — before and after, stated explicitly.** The Reviewer's own §5 table
(line 690, untouched, Reviewer's original text) reads: *"Result: 19 of 21 map to a test in a named,
executing CI job. Two (#14, #17) have an unmapped Tier-2 half."* **After D3's fix (MINOR-2)**, ADR 0018
§13 itself (not the Reviewer's report, which is never edited) now reads **21 of 21** — both `#14`
(`LEARN-MEMORY-THROUGH-BOUNDARY`) and `#17` (`LEARN-VOICE-NOT-AUTO-MUTATED`) name
`lib/learning/memory-table-boundary.test.ts` and the `app-tests.yml` job it executes in, closing the two
previously-unmapped Tier-2 halves. **The Reviewer's "19 of 21" line is the correct historical record of
what was true when the Reviewer read the range — it is not stale, it is dated**, and this correction pass's
own fix is what moved the live ADR from 19 to 21. A future reader comparing the Reviewer's report against
the current ADR should expect this exact discrepancy and know why it exists.

**Verification run (D7):**
- `git status --short` shows no untracked files under `docs/` at the time of this commit — every file this
  correction pass touched (`0018-diff-based-learning-capture.md`, `0016-governed-memory.md`,
  `current-phase.md`, `docs/brainstorm/session-plan-adrs-0016-0018.md`, `backlog.md`, this report, and the
  `.wolf/` files) is tracked and staged, not left as an untracked artefact.
- The reviewer report contains exactly one appended `## CORRECTION PASS (Session 25-D)` section, opening
  with its author and now (as of this D7 append) its date and full range/SHA attribution, with one
  resolution-table row per finding (24 of 24) and the additions-only diff pasted above.
- `git diff 052c48fc..HEAD -- docs/reviews/session-25-reviewer.md` re-confirmed additions-only immediately
  before this commit (539 insertions before this append; this append itself is further pure addition at
  end-of-file, so the property holds transitively).

### D8 — CI execution of the corrected range

**Author:** Session 25-D (Claude Code, Sonnet 5). **Date:** 2026-07-29. **Range executed:** D0–D7
(`052c48fc..05deb29d`), pushed to `origin/session-22-d` and opened as PR
[#4](https://github.com/tcr430/SOSH/pull/4). No code changed in this step — CI execution only, per the
D0–D8 ordering rationale above (CI runs last so it greens the range as this correction pass leaves it, not
as it stood before D0).

**CI results, both required checks green on the PR's head sha (`05deb29d`):**
- `app-tests` (tsc + eslint + vitest): [run 30432771541](https://github.com/tcr430/SOSH/actions/runs/30432771541)
  — `conclusion: success`. Lint output shows only pre-existing unused-var/hook-dependency warnings (no
  errors); none touch a file this correction pass modified.
- `db-tests` (Tier-1 live-Postgres): [run 30432771534](https://github.com/tcr430/SOSH/actions/runs/30432771534)
  — `conclusion: success`. The skip-guard step's own log line, read directly rather than inferred from the
  green checkmark: `skip-guard: 22 file(s) under [supabase/__tests__] all visible, zero failures — green.`
  Per `scripts/ci/assert-no-empty-suite.mjs`'s own logic (read in full before writing this entry): the
  script fails the job individually, by name, on any file with zero `assertionResults` or whose assertions
  are all `skipped`/`pending` (`::error::skip-guard: <file> ran zero tests`). A green run with 22 counted
  therefore proves all 22 files — including every file D1–D6 touched or added
  (`performance-memory-pattern-key.test.ts`, `learning-report-orphans.test.ts`,
  `performance-memory-candidates-expiry.test.ts`, `performance-memory-promotion.test.ts`) — executed at
  least one non-skipped assertion. **No per-file test-count integer is extractable from this log** —
  `test:db` runs with `--reporter=json --outputFile`, which suppresses vitest's console summary, and the
  skip-guard only ever prints the aggregate **file** count (22), matching the correction to the C2.9 report
  already recorded above (D7, "the six things easy to lose," item 4): any test-count figure quoted anywhere
  in this programme's docs is a locally-derived figure, never a CI-sourced one, unless this entry says
  otherwise. This entry makes no such claim.

**Promotion tally: unchanged at 0 of 3.** This is a `pull_request`-event run against `session-22-d`
(PR #4), not a run on `master` — ADR 0015 §5's `CI-DB-SUITE-STABLE` rule counts only full-green `db-tests`
runs **on `master`**. Stating this explicitly, as the D0–D8 ordering rationale requires, rather than
incrementing: `db-tests` remains **advisory-but-must-be-read** until three consecutive full-green `master`
runs land; this pass's green run is a pre-merge signal, not a promotion event. `docs/current-phase.md`'s
tally section carries the same entry, dated to match.

**Verification run (D8):** both run URLs opened and read directly (not inferred from the PR's green
checkmark alone); the skip-guard log line quoted above was read from the `db-tests` job's own log, not
copied from a summary; `git log --oneline origin/session-22-d..HEAD` before pushing confirmed the pushed
range was exactly D0–D7 (`052c48fc..05deb29d`), no extra commits. No db-tests failure occurred, so the
"classify before doing anything else" branch of the D8 instruction does not apply.
