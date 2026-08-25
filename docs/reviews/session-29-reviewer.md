# Session 29 — Track F Reviewer report (F1c)

**Scope reviewed: `dac7ddac..4db4053f`; all citations are `git show <sha>:<path>` at that range, never HEAD.**
Range contents (`git log --oneline dac7ddac..4db4053f`): `d3e6c27e` F1b.1 · `9a610c08` F1b.2 · `5de812ef` F1b.3 ·
`b347d4cd` F1b.4 · `86642e64` F1b.5 · `4fc54a31` F1b.6 · `172a1a77` F1b.7 · `2efc8c1b` F1b.8 · `841aa769` F1b.10 ·
`a038678d` F1b.9 · `0601090e` F1b.11 · `b01a9985` CRLF fix · `4db4053f` ADR §20 CI citations (docs-only).

**Documents audited against, read at their own commits (Session 22-F NEW-12 exception):**

- `docs/decisions/0022-promote-to-campaign-and-format-families.md` read at **`5e9ed904`** (§§1–19; §§17–19 treated
  as the standard wherever they correct §5.2, §6.3, §9 or §16).
- `docs/decisions/0018-diff-based-learning-capture.md` (Amendment A, A.1–A.4) read at **`c56332b0`**.
- `docs/build-guide/session-29.md` (§0 L-1..L-12, §0.2 A-1..A-8, Reality 1-19, §2b step table) read at **`dac7ddac`**.
- ADR 0022 §20 (the Builder's own close-out, written *inside* this range) read at **`4db4053f`** and treated as a
  claim to be verified, not as a standard.

**Verdict: no BLOCKER.** The four items flagged as most likely to be wrong are all correct (§A below). Five MAJOR
findings concern requirements the ADR states that no step shipped, plus one wiring gap with no test behind it.

---

## A. The four priority checks — all four PASS

**A1. SHARED-FUNCTION CALLERS on `assembleBrief` — count is TWO at the range head, as predicted.**
`git grep assembleBrief 4db4053f` over `lib app components`, non-test: `lib/signals/seed.ts:85` and
`lib/campaigns/promote.ts:151`. Nothing else. Per caller:

| Caller | Test that executes it | Verdict |
|---|---|---|
| `lib/signals/seed.ts:85` | Tier-1 `supabase/__tests__/signals3-seed.test.ts:139` (real body, real Postgres). Tier-2 `lib/signals/seed.test.ts:14` **mocks** it — not coverage, as §9 already records. | **EXECUTED** |
| `lib/campaigns/promote.ts:151` | Tier-1 `supabase/__tests__/studio-promote-brief-end-to-end.test.ts:95` — drives `promoteDraftToCampaignCore` end to end with a **real signed-in anon client**, asserting `origin='studio_promoted'`, the post, the brief and the write-back. Tier-2 `lib/campaigns/promote.test.ts:18` mocks it (declared). | **EXECUTED** |

**A2. `upsertDistilledPerformancePattern` — §18.1's finding re-confirmed; the Builder did NOT discharge
`MEM-PATTERN-BOUNDED` at Tier 2.** `git grep` at the range head:

| Caller | Test | Verdict |
|---|---|---|
| `recomputeAndUpsertPattern` (`lib/learning/promote.ts:119`), driven by `lib/learning/orchestrator.ts:278` | `lib/learning/promote.test.ts:18` **mocks** the writer; `lib/learning/orchestrator.test.ts:72` **mocks** `recomputeAndUpsertPattern` | **AUTHORED-NOT-EXECUTED for this caller** |
| `summarizeBusinessLearning` (`lib/learning/summarize.ts:167`) | `lib/learning/summarize.test.ts:25` **mocks** the writer | **AUTHORED-NOT-EXECUTED for this caller** |
| direct, non-production `lib/db/memory-performance.test.ts:173` | real body, **stubbed** client — cannot fire a CHECK | not coverage of the bound |

Neither production caller executes the real body anywhere. That is unchanged from §18.1 and is correctly recorded
by the Builder at ADR 0022 §20.3. It is a standing, declared gap, not a Session 29 regression — no finding raised.

**A3. `MEM-PATTERN-BOUNDED` is Tier-1 — correct.**
`supabase/__tests__/learning-generation-kind-and-pattern-bound.test.ts:169-206`, live Postgres, three cases (501
rejected, 500 accepted, UPDATE-to-501 rejected), each asserting on `performance_memory_pattern_length_check` by
name. The CHECK is at `supabase/migrations/20260822093000_learning_generation_kind_and_pattern_bound.sql`
(`NOT VALID` + `VALIDATE`, separate statements). **No Tier-2 test anywhere claims to prove the CHECK.** Not a
BLOCKER — not a finding at all.

**A4. The `platform-map.test.ts` diff is ARITY-ONLY — verified line by line.**
`git diff dac7ddac..4db4053f -- lib/ai/prompts/formats/platform-map.test.ts` changes five line-groups; every change
is the insertion of `, false` into an existing argument list. **Zero** changed `expect(...).toBe(...)` right-hand
sides, **zero** changed `it.each` lists, **zero** reworded descriptions. §18.3's mechanical test is met and
`MODE2-FORMAT-SELECTION-UNCHANGED` is not void. (One count defect — see NIT-1.)

**A5. The order is correct.** `4fc54a31` (F1b.6) lands the exhaustiveness conversion in its **own commit**, touching
only `lib/ai/generate-native.ts`, `native-generation-prompt.ts` and `lib/utils.ts` — no schema change, no
`FormatFamily` member added, no carousel branch. `172a1a77` (F1b.7) adds `'carousel'` to `FormatFamily` afterwards.
`generate-native.ts:110`'s silent misroute did **not** ship.

---

## B. Independently verified claims (I did not take the Builder's word)

- **CI runs are real and green.** `gh run view 32609963073` → `App tests`, `headSha b01a9985…`, `conclusion: success`.
  `gh run view 32609963087` → `DB tests`, same sha, `conclusion: success`. The claimed earlier failure
  `32609638366` is real too (`headSha 0601090e`, `conclusion: failure`) — the Builder did not hide a red run.
- **Skip-guard lines read from the logs, not inferred.** `app-tests`: `skip-guard: 219 file(s) under [app, lib,
  components] all visible, zero failures — green. (2963/2963 tests passed)`. `db-tests`: `skip-guard: 34 file(s)
  under [supabase/__tests__] all visible, zero failures — green. (309/309 tests passed)`. Both **non-zero**, both
  verbatim-identical to ADR 0022 §20's table. `git ls-tree -r b01a9985 supabase/__tests__` counts **34** `.test.ts`
  files, so every Tier-1 file — including all four new ones — executed. The `219` reconciles exactly against 232
  files under `app lib components` minus 4 `__integration__`, minus 2 explicit `exclude` entries, minus 7
  `lib/**/*.test.tsx` (see MINOR-7).
- **Head is docs-only.** `4db4053f` touches only ADR 0022, so CI green at `b01a9985` genuinely covers all code at
  the range head. Acceptable; see NIT-2 for the wording.
- **`lib/ai/runner.ts` untouched.** `git diff dac7ddac..4db4053f -- lib/ai/runner.ts` is **empty**. L-7 /
  `MODE2-RUNNER-UNTOUCHED` holds by the diff, not merely by the scan's existence.
- **`posts` DDL untouched.** `git diff dac7ddac..4db4053f -- supabase/migrations` grepped for `posts` returns
  **nothing** — the two new migrations contain no reference to `posts` at all.
- **Mode 3 untouched.** `git diff --stat dac7ddac..4db4053f -- lib/signals 'app/[locale]/(dashboard)/opportunities'`
  is **empty**.
- **All four scans carry a per-root vacuity guard.** `lib/scope-scans.test.ts`: `MODE2-CAROUSEL-NO-IMAGE-GEN`,
  `MODE3-UNTOUCHED` and `NO-SKIP-REVIEW-PATH` each loop their roots asserting `collectTsFiles(root).length > 0`;
  `POSTS-DDL-UNMODIFIED` guards both the baseline file's existence and `afterBaseline.length > 0`;
  `MODE2-RUNNER-UNTOUCHED` guards the single file's existence. `script-never-published.test.ts:69-71` does the same,
  plus an allowlist-staleness guard at `:88-94`.
- **The promote snapshot is written only when the retained revision is non-NULL.** `lib/campaigns/promote.ts:139`:
  `if (draft.accepted_revision !== null)`, and its content is `draft.accepted_revision`, never `content`. Proved in
  **both directions** at Tier-1: `studio-promote-brief-end-to-end.test.ts:139-146` (never-suggested-on draft → zero
  snapshot rows) and `:148-199` (a draft driven through the **real** `createStudioDraft → persistSuggestions →
  acceptSuggestion` path → exactly one row, `generation_kind='studio_promoted'`, `rendered_content` equal to the
  accepted revision). ADR 0018 Amd A.1's binding corollary is honoured. **No BLOCKER here.**
- **The staleness window is a named constant with stated arithmetic.** `lib/config.ts:62-68` —
  `PROMOTE_CLAIM_STALE_MINUTES`, default `5`, arithmetic written out (two Postgres round-trips; no LLM call inside
  the window; `assembleBrief` explicitly outside it). Read at `lib/db/studio-drafts.ts:252` via the lazy `config`
  import. Not a literal at the call site.
- **`clearPromotedCampaignReferenceOnDrafts` exists and is wired.** `lib/db/studio-drafts.ts:322`; called from
  `app/[locale]/(dashboard)/campaigns/actions.ts:101`, which is the **only** production call site of
  `softDeleteCampaignGuarded` (`actions.ts:80`). The D7 bug is not reintroduced in the source. **But the wiring is
  untested — MAJOR-3.**
- **i18n landed in all three locales simultaneously and is registered.** `i18n/{en,pt,es}/studio.json` and
  `.../approvals.json` all changed in the same commits; the 23 `editor.promote` keys are byte-identical key sets
  across en/pt/es (verified by parsing all three); `i18n/request.ts:22-23,38-39` registers both namespaces.
- **Constitution surface checks clean.** `git diff dac7ddac..4db4053f -- 'app/**' 'components/**'` grepped for
  `asChild` and `dangerouslySetInnerHTML` → **no hits**. One added `console.error` (NIT-3), a server-side
  Server-Action log, not a rendering surface.
- **No new status colour, and the contrast assertion reads the shipped token file.** `app/globals.css` is
  **untouched** in this range; `components/studio/StudioEditor.test.tsx:251` does
  `readFileSync(path.resolve(process.cwd(), 'app/globals.css'))` and parses `:root` / `.dark` live, asserting
  ≥ 4.5:1 on `success`/`warning`/`info-foreground` in **both** themes (`:269-296`), plus the negative assertion
  that no `amber|emerald|sky-\d` class survives the render (`:299-311`). No hand-transcribed hex anywhere.
- **All seven §10 states render.** `StudioEditor.test.tsx` covers state 1 (three distinct reasons), 2, 4, 6, 7 plus
  `claimed_by_another` and `promote failed`; state 3 (`promoting`) is covered at
  `components/studio/PromoteDraftDialog.test.tsx:79`. Complete.
- **`scheduled_at` is user-chosen; no default slipped in.** `PromoteDraftDialog.tsx:83-90` is a `datetime-local`
  input with `min={now}`, sent as UTC ISO; `promote.ts:120` writes it verbatim. **But approve does not re-touch it
  — MAJOR-4.**

---

## C. Findings, by ADR 0022 section

### 1. Promote contract and gate count (§2; A-3, A-7)

**MAJOR-4 — the second half of A-3 never shipped: `approvePost` does not re-touch `scheduled_at`, so the
surprise-publish path §2.5 exists to close is still live.** *(Builder finding, with an ADR contributing cause.)*

- **What is wrong.** §2.5 rules: *"The user chooses it, **and the approve step must re-touch it**."* The first half
  shipped (`PromoteDraftDialog.tsx:83-90`, `lib/campaigns/promote.ts:120`). The second did not.
  `lib/db/posts.ts:320-338` (`approvePost`) sets `{ status: 'approved' }` and nothing else; no approve path in the
  range writes `scheduled_at`.
- **Why it matters.** `supabase/migrations/20260524230000_publishing_worker.sql:31-34` claims on
  `status = 'approved' AND scheduled_at <= p_now AND platform IN ('linkedin','twitter')`. A user who promotes on
  2026-08-23 choosing 2026-09-01, then approves on 2026-09-05, has an already-past `scheduled_at` and the post
  publishes on the next cron tick — the exact failure `[db-Q1]` described, reached by a different route. A
  user-chosen date narrows the window; it does not close it, because nothing requires the chosen date still to be
  in the future at approval time.
- **Contributing ADR cause.** §11.1/§11.2 name **no constraint** for the re-touch, and §2b's F1b.4 row repeats only
  the "user-chosen" half. A requirement with no tier and no step could not redden anything.
- **What would prove it fixed.** Either the approve path re-touches `scheduled_at`, or promote rejects a past
  `scheduledAt` **and** approve refuses a past `scheduled_at` — with a Tier-1 case proving a promoted post approved
  after its chosen time is not claimable by `claim_posts_for_publishing` on the next tick.

**MAJOR-5 — a promoted campaign can never generate Mode 2 posts and never activates; §2.7's fix is unreachable
arithmetic.** *(ADR finding — a fourth defect §§17–18 did not catch — with a Builder consequence.)*

- **What is wrong.** `lib/campaigns/generate.ts:106-114` is an unconditional idempotency guard:
  `const existingPosts = await listPostsByCampaign(...); if (existingPosts.length > 0) { … 'already_generated'; return }`.
  A promoted campaign **always** holds exactly one post before generation is ever invoked
  (`lib/campaigns/promote.ts:113-124`), so `generatePostsForCampaign` — the only production generator, reached from
  `app/[locale]/(dashboard)/campaigns/[id]/generate-action.ts:70` — returns `already_generated` for every promoted
  campaign, unconditionally. `activateCampaign` at `generate.ts:423` is never reached for a promoted campaign, which
  stays `awaiting_brief` forever.
- **Consequently `generate.ts:423`'s `postsCreated + existingPosts.length` can only ever evaluate with
  `existingPosts.length === 0`.** The §2.7 change is correct in principle and **dead in practice** — the off-by-one
  it fixes cannot occur, because the path that would exhibit it cannot run. `ACTIVATE-PLANNED-UNCHANGED`
  (`lib/campaigns/generate.test.ts:555-563`) proves only the reachable case, so it is a true test of a
  now-unreachable guarantee.
- **Why it is an ADR finding.** §2.7's entire premise — *"a naive activation would write N for a campaign holding
  N + 1 posts"* — presupposes that generation runs on a promoted campaign. §2.8(2) audits `createPosts` for a
  campaign-status guard and finds none, but neither §2.7 nor §2.8 audits `generatePostsForCampaign`'s own
  post-count guard, which is what actually decides the question. §2.6's ruling (the brief does not block the
  *promoted post's* approval) remains true; what nobody stated is that the brief consequently governs **nothing at
  all** for a promoted campaign.
- **Why it matters.** A promoted campaign assembles, critiques and gates a brief that can never produce a post. The
  user gets a brief-review flow whose only possible outcome is a campaign stuck at `awaiting_brief`. That is a
  product-shape decision that was never made — it was inherited from a guard nobody re-read.
- **What would prove it resolved.** An explicit ADR ruling — either "a promoted campaign is single-post by design,
  and §2.7 is withdrawn as unreachable", or "the idempotency guard must exempt the promoted post" — plus a test
  pinning whichever behaviour is chosen.

### 2. Atomicity, the claim, the staleness window, the soft-delete cleanup (§3, §12.1; A-6)

The claim itself is correct: an atomic conditional UPDATE guarded on `promoted_campaign_id IS NULL` **and**
(`promotion_claimed_at IS NULL` OR older than the window) at `lib/db/studio-drafts.ts:253-262`, a typed loser split
into `already_promoted` / `claimed_by_another` from a real re-read (`:268-278`), a void, `IS NULL`-guarded write-back
(`:293-305`), and Tier-1 coverage of all three constraints plus the never-reclaimable-once-promoted case
(`supabase/__tests__/studio-promote-claim.test.ts:91,116,138,151,160`).

**MAJOR-3 — `clearPromotedCampaignReferenceOnDrafts`'s wiring into `deleteCampaignAction` has no test; the D7
precedent it copies has three.** *(Builder finding.)*

- **What is wrong.** `app/[locale]/(dashboard)/campaigns/actions.ts:99-104` adds the cleanup call.
  `app/[locale]/(dashboard)/campaigns/actions.test.ts` is **unchanged in this range**: it does not
  `vi.mock('@/lib/db/studio-drafts')` (`:1-29`) and never asserts the new function is called. The sibling it mirrors
  is covered three ways — called (`:196-198`), throw-tolerated (`:201-209`), and not-called-when-the-delete-guard-
  fails (`:211-217`).
- **Why it matters.** `PROMOTE-SOFTDELETE-CLEARED` (`supabase/__tests__/studio-promote-claim.test.ts:174-204`)
  invokes `clearPromotedCampaignReferenceOnDrafts` **directly**. It reddens if the *function* is removed and stays
  green if the *call site* is removed. Deleting `actions.ts:101` would reintroduce the exact D7 bug with a fully
  green suite — the SHARED-FUNCTION CALLERS failure shape, on the very function added to prevent a repeat of it.
- **What would prove it fixed.** Three Tier-2 cases on `deleteCampaignAction` mirroring the
  `clearCampaignReferenceOnCards` trio, each demonstrated to redden when `actions.ts:101` is removed.

**MINOR-8 — `promoteDraftToCampaign` has no `try/catch`, and the claim can throw out of it.** *(Builder finding.)*
`claimStudioDraftForPromotion` (`lib/db/studio-drafts.ts:240-278`) runs **before** `promoteDraftToCampaignCore`'s
`try` block (`lib/campaigns/promote.ts:80,101`), and its fallback re-read at `:270-276` uses `.single()` — which
errors, and is rethrown, if the draft was soft-deleted or removed between page load and submit. The Server Action
wrapper (`app/[locale]/(dashboard)/studio/actions.ts:334-350`) has no `try/catch` either, so that path produces
Next's generic error boundary rather than one of §10's seven states. **Fixed when** a deleted or missing draft
returns a typed outcome the UI renders, with a test.

### 3. The `generation_kind` amendment and the snapshot corollary (§4; ADR 0018 Amd A.1; A-1)

**No findings.** Correct in the source (`lib/campaigns/promote.ts:139-152`), correct in the migration
(`20260822093000_…sql`, widened `NOT VALID` + `VALIDATE`), and proved both directions at Tier-1. This is the
strongest-executed part of the session.

**NIT-7 — `accepted_revision text NULL` is unbounded**
(`supabase/migrations/20260822090000_studio_promote_schema.sql`), and its value flows verbatim into
`post_ai_originals.rendered_content` and `payload` at `lib/campaigns/promote.ts:145-146`. §5.1 applied the
`max(5000)` contract to `posts.content` for exactly this class of reason and did not extend it here; the write site
(`lib/db/studio-drafts.ts:196-203`) is itself fed from a bare `z.string()`. No ADR clause requires a bound, so this
is a NIT — recorded because §5.1's own reasoning applies to it verbatim.

### 4. The write-time bound, its TIER, and the A-5 guard (§5; ADR 0018 Amd A.2/A.3; §18.1)

The CHECK shipped and is Tier-1 (§A3). Two of the section's three required changes did not ship at all.

**MAJOR-1 — A-5's `neutralizeWithSentinels` at the writer boundary was never implemented.** *(Builder finding, with
a build-guide contributing cause.)*

- **What is wrong.** ADR 0018 Amendment A.3 (read at `c56332b0`) states the change without qualification: *"Any
  `pattern` value whose provenance chain touches human-authored text is guarded with `neutralizeWithSentinels`
  (`lib/ai/wrap-evidence.ts:118-132`), not plain `neutralize()`."* ADR 0022 §5.4 records the decision and
  **explicitly declines** the "document the residual as an accepted carve-out" loser, on the ground that *"the wider
  guard already exists and the cost of calling it is one function swap."* At the range head,
  `git grep neutralizeWithSentinels 4db4053f -- lib app` returns hits in `wrap-evidence.ts`, `lib/studio/guard.ts`
  and `lib/signals/triage/card.ts` only — **nothing in `lib/db/memory-performance.ts`, `lib/learning/summarize.ts`
  or `lib/learning/promote.ts`.** `lib/db/memory-performance.ts`'s entire diff in this range is **comment-only**.
- **Why it matters.** A-5 is a founder adjudication. §5.4's own argument is that the length bound closes the cost
  problem and leaves the guard-strength gap open: `saveStudioDraftAction` validates with a bare `z.string()`, so
  manually-saved content — precisely what promote now reads — is never guarded, and the `performance_memory` →
  `post-generation.ts:179` sink still routes through the weaker `neutralize()`. Shipping the bound without the guard
  ships the half §5.4 said was insufficient on its own, while the ADR reads as though both landed.
- **Contributing cause.** §2b's F1b.2 row names only *"the 500-char CHECK (Amd A.2)"*; §11.1/§11.2 assign **no
  constraint name** to A.3, and §20.1's constraint map has no row for it. With no step and no constraint, its
  absence could not redden anything.
- **What would prove it fixed.** The guard applied at the writer boundary, a named constraint in §11, and a test
  that reddens when the call is swapped back to `neutralize()`.

**MAJOR-2 — the promoter-level Zod bound in front of the RPC was never implemented.** *(Builder finding.)*

- **What is wrong.** ADR 0018 Amd A.2: the bound is *"enforced by a **CHECK constraint** … **with a Zod bound at
  `upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts:95-114`) in front of it**."* ADR 0022 §5.2 says
  the same in its opening line: *"At the RPC, with a promoter-level Zod bound in front."*
  `lib/db/memory-performance.ts:97-116` at the range head contains no validation at all — it forwards
  `insert.pattern` straight into `client.rpc(...)`.
- **Why it matters.** §5.2 is explicit that these are *"two different guarantees at two boundaries"* — the
  promoter's is **input hygiene**, the RPC's a **durable-storage invariant** — *"not redundancy."* Only one shipped.
  The practical consequence today is small (both writers are structurally capped at 200 and ≈80 chars, per §17), but
  F1b.10's new per-statement `try/catch` (`lib/learning/summarize.ts:157-183`) now **swallows** a CHECK rejection
  into a counter, so the DB-level bound is the only remaining barrier and its failure is no longer loud.
- **What would prove it fixed.** A Zod bound at `upsertDistilledPerformancePattern`, with a Tier-2 test that reddens
  when it is removed — labelled as proving the *promoter* bound, never as proving the CHECK (§18.1's binding
  consequence).

**NIT-4 — `lib/learning/summarize.ts:176` catches every error, not just a bound rejection.** §17 item 3 asked for
per-statement log-and-skip for a **CHECK rejection**. The shipped `catch (err)` also absorbs a transient DB or
network failure into `statementsRejected`, where §5.3's semantics say "rejected" means "over the bound". Sentry
still receives it (`:178-180`), so nothing is lost silently — hence NIT. The §17.1 stale-comment corrections
(`lib/ai/prompts/learning-summarizer.ts:34-47`, `lib/db/memory-performance.ts:44-58`) are correct and, as
instructed, leave the guard posture unchanged.

### 5. The carousel family, roles, policy, and the exhaustiveness precondition (§6; A-4)

The precondition landed first and clean (§A5). Schema (`lib/ai/prompts/formats/schemas.ts:66-92` — slides
`.min(3).max(10)`, closed `cover|body|cta` role enum, no `order` field), policy
(`lib/ai/prompts/formats/policy.ts:34-54`), and the third overload all match §6.1/§6.2.

**MINOR-4 — carousel ships structurally unreachable, and §6.3's stated sourcing mechanism was never built.**
*(ADR finding.)*

- **What is wrong.** §6.3 says `carouselRequested` is *"sourced from the brief, the deterministic Tier-0 input that
  already drives generation."* Both production call sites pass a hard-coded literal: `lib/ai/generate-native.ts:106`
  (`false`) and `lib/ai/prompts/studio-suggestion.ts:142` (`false`). Nothing reads the brief. And
  `lib/ai/generate-native.ts:133-134`'s `case 'carousel':` **throws** rather than dispatching.
- **Why it matters.** `CarouselOutputSchema` and `validateCarouselPolicy` have **no production caller**. §6.4 is
  written as *"what carousel ships as"*, and §15.2's deferral covers only image generation — so neither §6.4 nor §15
  records "carousel is authored but unreachable" as a decision. §2b's F1b.7 row does not ask for the wiring either,
  so the Builder delivered exactly its scope; the gap is between §6.3's prose and the step table.
- **What would prove it resolved.** Either §6.3 amended (append-only) to record the sourcing as deferred with a
  revival condition, or the brief-sourced input built with a test exercising the carousel arm end to end.

### 6. `scriptBrief` and the never-published scan (§7)

The scan is sound: repo-wide absence check over `lib/` and `app/`, per-root vacuity guard
(`lib/ai/prompts/formats/script-never-published.test.ts:69-71`), a three-file allowlist with its own staleness guard
(`:88-94`), and two explicit named-sink assertions on `lib/db/posts.ts` and `lib/publishing/orchestrator.ts`
(`:101-113`). §7.3's "recommendation, never published" rendering is real and accessible
(`app/[locale]/(dashboard)/approvals/AiOutputPreview.tsx:57-70`, `role="note"` with an `aria-label` naming the
never-published note), in all three locales.

**MINOR-5 — §7.1 requires `scriptBrief` to be *generated*; §8.2's frozen prompt fixtures forbid changing the
prompts. The ADR never reconciles the two, and the Builder silently chose §8.2, so `scriptBrief` is never
populated.** *(ADR finding — a genuine internal contradiction, stated by the Builder in-code but never adjudicated.)*

- **What is wrong.** §7.1: *"It is **generated**, attached to the post, surfaced wherever posts are reviewed, and
  never published."* `lib/ai/prompts/formats/schemas.ts:9-29` records the Builder's reasoning verbatim:
  *"native-generation-prompt.ts's `shapeInstructions` is NOT updated to ask the model for this field, deliberately,
  to keep MODE2-PROMPT-BYTE-IDENTICAL's frozen fixtures untouched by this step."* The field is therefore
  `.nullish()`, the model is never asked for it, and no production path ever produces a non-null value.
- **Why it matters.** `SCRIPT-BRIEF-BOUNDED` passes over a field nothing writes; §7.3's rendering is unreachable in
  production; and §8.2's `MODE2-PROMPT-BYTE-IDENTICAL` is, as written, incompatible with §7.1's "generated". One of
  the two must yield and the ADR does not say which. The Builder made the right *engineering* call (do not break the
  frozen fixtures); the *product* decision was made by omission.
- **What would prove it resolved.** An appended ADR section ruling which of §7.1 and §8.2 yields, and — if §7.1
  does — a stated revival condition in §15 so the next gap analysis reads it as a decision rather than drift.

### 7. `MODE2-FORMAT-SELECTION-UNCHANGED` and the arity-only diff (§8; §18.3)

The arity-only requirement is met (§A4) and the `Record<Platform, …>` typing is correct
(`lib/ai/prompts/formats/platform-map.frozen-table.test.ts:42`), so a sixth `Platform` hard-fails `tsc` before
vitest runs, exactly as §8.2 Rot mode 2 requires.

**MINOR-1 — the frozen table samples two volumes, not the domain; a threshold shift from `>= 3` to `>= 2` or `>= 4`
passes it silently.** *(Builder finding.)* §8.2 requires a table *"enumerating **every** `(platform,
estimatedTweetsWorth, carouselRequested)` combination **across the existing domain**."* The shipped table uses
`LOW_VOLUME = 1` and `HIGH_VOLUME = 5` (`platform-map.frozen-table.test.ts:38-39`) and never touches the boundary
at 3. Editing `platform-map.ts:33`'s `>= 3` to `>= 2` or `>= 4` leaves all twenty frozen rows green. The threshold
is still guarded — by `platform-map.test.ts:17-21` (`2.9 → single`, `3 → thread`) — but that is the
**co-editable** file §8.1 named as the weaker instrument, which is precisely the risk the frozen table was created
to remove. **Fixed when** the table includes the boundary rows (2, 2.9, 3 at minimum) and a threshold edit is
demonstrated to redden it.

**MINOR-2 — the "byte-identical, restated" assertion is tautological and cannot fail.** *(Builder finding.)*
`platform-map.frozen-table.test.ts:71-77` reads
`const withoutCarouselArg = selectFormatFamily(platform, LOW_VOLUME, false)` /
`const withCarouselArgFalse = selectFormatFamily(platform, LOW_VOLUME, false)` — the **same call twice** — then
asserts they are equal. Its title claims it *"restates the byte-identical claim"*; it asserts nothing. The real
guarantee is carried by the hand-written literal table above it, so no coverage is actually missing — but under
ADR 0015 a green test that cannot redden is the false-green shape, and its name misrepresents what
`MODE2-FORMAT-SELECTION-UNCHANGED` is proved by. **Fixed when** the assertion is removed or replaced with one that
can fail.

### 8. SHARED-FUNCTION CALLERS, per caller (§9; §18.1)

The re-grep at §20.3 is accurate. I re-ran it independently: `assembleBrief` — two production callers, both
Tier-1-executed (§A1); `upsertDistilledPerformancePattern` — two production callers, **both mocked** (§A2,
correctly declared); `softDeleteCampaignGuarded` — **one** production caller
(`app/[locale]/(dashboard)/campaigns/actions.ts:80`), so "call sites" plural resolves to one and the cleanup is
wired at it; `activateCampaign` — one caller (`lib/campaigns/generate.ts:423`); `selectFormatFamily` — **two**
callers, and §20.3's corrected row is right: `lib/ai/prompts/studio-suggestion.test.ts` does execute the second
caller's real body (no mock on `platform-map` in that file). The Builder found a caller §9 had missed and recorded
it in the append-only form. This section is done correctly.

**NIT-6 — citation drift inside `platform-map.ts`'s own comment.** `lib/ai/prompts/formats/platform-map.ts:27-28`
cites *"generate-native.ts:98, studio-suggestion.ts:136"*; the actual lines at the range head are `:106` and `:142`.
§20.3's table cites both correctly, so only the in-code comment is stale.

### 9. The UX contract and the design floor (§10)

Compliant: Server Component page + Client interaction, two-step flow, all seven states, tokens rather than raw
palette classes, contrast read from the shipped file in both themes, en/pt/es simultaneous and registered, Zod on
the action input, no `asChild`, zero `dangerouslySetInnerHTML`. Evidence in §B.

**MINOR-6 — `listLatestPostAiOriginalsByPostIds` can silently truncate.** *(Builder finding.)*
`lib/db/post-ai-originals.ts:76-85` orders by `post_id ASC, revision DESC` and caps at `.limit(postIds.length * 20)`.
The cap is a per-list heuristic, not a per-post one: a single post with more than 20 revisions consumes other posts'
budget, and because the ordering is `post_id`-major, the posts sorted last simply fall off the result — their
preview renders nothing, with no error. `createNextPostAiOriginalRevision` increments a revision on **every**
regeneration, so >20 revisions on one post is reachable. **Fixed when** the read is per-post-bounded (an RPC with
`DISTINCT ON (post_id)`) or detects truncation instead of absorbing it.

**NIT-5 — per-slide `imageBrief` is not rendered.** `schemas.ts:71-77` gives every slide its own `imageBrief` on
§6.1's explicit design; `AiOutputPreview.tsx:41-49` renders `slide.role` and `slide.text` only. §10 asks for
*"slides in order with their roles visible"* and for `imageBrief` to be shown, without saying which one — so this is
a gap in the rendering of a field the schema deliberately added, not a contract breach.

**NIT-3 — one new `console.error`.** `app/[locale]/(dashboard)/campaigns/actions.ts:103`. §10's rule is *"no
`console.*` on a user-facing surface"*; this is a server-side Server-Action error log, immediately mirroring the
pre-existing `clearCampaignReferenceOnCards` line at `:93`. Consistent with house practice; recorded for
completeness.

### 10. Constraint-to-CI mapping (§11, §20.1)

I checked every row of §20.1 against the range. **All 24 rows map to a real, executing test**, and the
*reddens-if-broken* column is accurate in each case I probed. Corrections:

| §20.1 row | Correction |
|---|---|
| `MEM-PATTERN-BOUNDED` | Correct as stated (Tier 1). Its two production callers remain `AUTHORED-NOT-EXECUTED` — recorded in §20.3, not in the map. |
| `MODE2-FORMAT-SELECTION-UNCHANGED` | *"Any row in the frozen table changes value"* is true, but the table does not span the domain §8.2 requires — MINOR-1. |
| `PROMOTE-SOFTDELETE-CLEARED` | Reddens if the **function** changes; does **not** redden if the **call site** is removed — MAJOR-3. |
| `ACTIVATE-PLANNED-UNCHANGED` | Reddens correctly, but the behaviour it guards is unreachable — MAJOR-5. |
| `SCRIPT-BRIEF-BOUNDED` | Reddens correctly over a field no production path populates — MINOR-5. |
| `CAROUSEL-SCHEMA-STRUCTURAL`, `CAROUSEL-POLICY-SEQUENCE` | Redden correctly over code with no production caller — MINOR-4. |

**Not in the map, and should be:** ADR 0018 Amd A.3 (the A-5 guard) has no constraint name in §11 or §20.1 — see
MAJOR-1. That absence is why nothing detected that it did not ship.

**MINOR-3 — `PROMOTE-RLS-ISOLATED` proves `USING` in both directions but never `WITH CHECK`.** *(Builder finding.)*
§11.1 states the constraint as *"mirrored both directions … with `USING` **and** `WITH CHECK` on UPDATE"*, and
CLAUDE.md's multi-tenancy rule makes `WITH CHECK` the tenant-tunnelling guard specifically. The four shipped cases
(`supabase/__tests__/studio-promote-schema.test.ts:90,111,132,157`) are cross-tenant SELECT ×2 and cross-tenant
UPDATE ×2 — all `USING`-side. No case attempts the `WITH CHECK` violation (updating a row you *can* see so that it
lands in another tenant). **Fixed when** a `WITH CHECK` case exists and reddens if the clause is dropped.

### 11. Scope and process

- **L-1's out-of-scope list: not shipped.** Verified by diff, not by the scans' existence: no `runner.ts` change,
  no `posts` DDL, no Mode 3 change, no `BriefAssemblyInput` change (`lib/campaigns/promote.ts:69-73` composes into
  the existing `objective` slot only), no image generation, no skip-review path. All six clean.
- **The Tier-3 five: enumerated as decisions, and four upgraded to executable scans.** §20.2 states this accurately
  and, correctly, does not claim the upgrade re-scopes what Tier 3 means. The redden demonstrations are recorded in
  `lib/scope-scans.test.ts`'s header rather than reproduced — I could not independently verify that they were
  performed (§D), but each scan's mechanism is sound on inspection, and the CRLF failure at `0601090e` is evidence
  that the hash pins do redden for real.
- **`MODE2-CAROUSEL-NO-IMAGE-GEN` is a new constraint added at F1b.11**, correctly labelled as such in §20.1 rather
  than smuggled into the original five.

**NIT-1 — "ten call sites" is eleven.** *(ADR finding.)* ADR 0022 §18.3 states *"`platform-map.test.ts` contains
**TEN** two-argument call sites of `selectFormatFamily`"*, and §2b's F1b.7 row repeats *"ten call sites"*.
`git show dac7ddac:lib/ai/prompts/formats/platform-map.test.ts` contains **11** (the final `it` block has two calls
on one line). Cosmetic — but it is a miscount inside the very section written to correct §6.3's miscounting of the
same file's cost.

**NIT-2 — §20's table calls `b01a9985` "the current range head".** It was when written; the head is `4db4053f`.
Because `4db4053f` is docs-only the CI evidence still covers all code at the head, but the sentence is now false as
written, and a later reader could take it as a claim that CI ran at `4db4053f`.

**MINOR-7 — pre-existing, OUT OF RANGE, flagged not charged: seven test files under `lib/` are never executed by
any CI job.** Found while reconciling the `219` skip-guard count. `vitest.config.ts`'s include is
`'lib/**/*.test.ts'`, which does not match `.test.tsx`; `lib/email/templates/__tests__/` contains seven
`*.test.tsx` files (`first-post-published`, `layout`, `payment-failed-courtesy`, `team-invite`, `trial-warning-t1`,
`trial-warning-t3`, `welcome-to-plan`). They are authored, they are not excluded by name, and the skip-guard cannot
see them because vitest never collects them — invisible to the guard rather than caught by it. **This is not a
Session 29 defect** (nothing in this range touched it); it is recorded only because this reviewer is positioned to
see it, and it is an `AUTHORED-NOT-EXECUTED` set of exactly the kind ADR 0015 exists to eliminate.

---

## D. What I could NOT verify, and why

1. **That each of the five scans was actually demonstrated to redden.** `lib/scope-scans.test.ts:14-22` and
   `script-never-published.test.ts:12-15` record the demonstrations in prose; the temporary violations were reverted
   and are not in the range's history, so there is nothing to read. I verified the scans' *mechanisms* by
   inspection instead. One case is provable: `0601090e` genuinely reddened `MODE2-RUNNER-UNTOUCHED` and
   `MODE3-UNTOUCHED` in CI and `b01a9985` fixed it — so those two hash pins demonstrably redden.
2. **The `SELECT count(*) FROM performance_memory WHERE length(pattern) > 500;` result from F1b.0.** No F1b.0 step
   notes are committed in the range. Per §17 / Amd A.4.2 the result is confirmation and not a decision input, and
   the migration is written `NOT VALID` + `VALIDATE` regardless — so nothing turns on it — but the record the step
   called for is not in the repository.
3. **Whether the `taste-skill` / `impeccable` passes required by §2b's F1b.5 and F1b.9 rows were run.** No committed
   artefact either way. `components/studio/StudioEditor.test.tsx:210` cites an *"impeccable review fix"*, which is
   evidence the F1b.5 pass happened; I found no equivalent trace for F1b.9.
4. **Runtime behaviour of anything.** I ran no application code and started no database. Every claim above comes
   from the diff, file contents at the range, the two CI runs' JSON and logs, and `gh`.
5. **Whether `db-tests`' three-green promotion tally moved.** §11.4 says this ADR neither asserts nor moves it, and
   `db706d84` (outside the reviewed range) reconciles it. Out of scope; not examined.

---

Session 29 review complete — 15 findings (0 BLOCKER, 5 MAJOR, 6 MINOR, 4 NIT) over range `dac7ddac..4db4053f`.

---

## CORRECTION PASS (Session 29-D)

**Author:** Session 29-D (Claude Code, Sonnet 5). **Date:** 2026-08-23. **Commit range fixed:** starts at
`6411708a` (D0, this report landed unmodified) and continues through this pass's remaining steps
(D1…D12), each its own commit on `session-29`. Everything above this line is the Reviewer's; everything
from here down is the correction author's. Per CLAUDE.md REVIEWER-REPORT APPEND-ONLY, not one character
above this section is edited — including §10's correction table and the closing tally line immediately
above, which stay exactly as written even after every finding below is closed.

**Note (D11, 2026-08-25) — this appendix's own header above is unedited; it is completed, not
superseded, by this note.** The header's "Date: 2026-08-23" records when the appendix was OPENED (D0/D1);
this correction pass ran across several sessions through D11 on 2026-08-25, the step that closes every
remaining finding row below.

**Row zero (D11) — the closing tally above does not match this report's own finding IDs. Argued, not
edited.** The line immediately above this appendix reads *"15 findings (0 BLOCKER, 5 MAJOR, 6 MINOR, 4
NIT)."* Counting the bolded `**MAJOR-N**` / `**MINOR-N**` / `**NIT-N**` headers actually present in
§C/§11 of this same report: **MAJOR-1..5 (5), MINOR-1..8 (8), NIT-1..7 (7) — 20 findings, not 15.** The
MAJOR count matches; MINOR is undercounted by 2 and NIT by 3. Nothing in this report explains the
discrepancy — no finding is announced then withdrawn, no ID is skipped or doubled. Left as a recorded
mystery rather than silently corrected: the tally line stays exactly as the Reviewer wrote it (REVIEWER-REPORT
APPEND-ONLY forbids touching it even to fix arithmetic), and this row states the true count the correction
pass actually had to close — 20, all twenty of which are addressed below (closed, argued-and-declined, or,
for one, explicitly left open with a named follow-up).

| Finding | Fix | Test that now proves it | Commit |
|---|---|---|---|
| **MAJOR-1** | `neutralizeWithSentinels` (the existing `lib/ai/wrap-evidence.ts` function, not a second copy) is applied inside `upsertDistilledPerformancePattern` (`lib/db/memory-performance.ts`) to `insert.pattern` before the RPC call. This is the sole writer of `performance_memory` — both production producers (`lib/learning/summarize.ts`'s LLM-synthesized statements, which echo human-authored edit excerpts, and `lib/learning/promote.ts`'s deterministic template) route through this one choke point, and grep confirms no third write path exists — so guarding here covers both regardless of which producer's composition touches human text. Constraint named: `MEM-PATTERN-SENTINEL-GUARDED`, added to ADR 0022 §11.2 (Tier 2, per the correction step's own classification — it is a mocked-client `app-tests.yml` test, not a live-Postgres one, so it belongs in the Tier-2 table alongside the other `app-tests.yml` constraints rather than the Tier-1 table at §11.1) and to §20.1's constraint map with an honest "reddens if" column. | `lib/db/memory-performance.test.ts` — new case `'neutralizes a sentinel-class payload in pattern before it reaches the RPC (MEM-PATTERN-SENTINEL-GUARDED)'`, asserting a `[/DATA]`-class payload arrives at `client.rpc` as `[/data-blocked]`. Demonstrated to redden: reverting `p_pattern: neutralizeWithSentinels(insert.pattern)` to `p_pattern: insert.pattern` fails this case (raw `'... [/DATA] ...'` observed at the RPC boundary instead of the neutralized string); reverted immediately after confirming red. All 25 cases in the file, plus the full `lib/db lib/learning lib/ai` scoped suite (1049 tests), pass with the fix applied. | D1 |
| **MAJOR-2** | A promoter-level `z.string().max(500)` bound (`PATTERN_PROMOTER_BOUND_SCHEMA`) now parses `insert.pattern` inside `upsertDistilledPerformancePattern` BEFORE the RPC call, mirroring the DB's `performance_memory_pattern_length_check` CHECK at the app layer — the two-boundary guarantee §5.2 always claimed but which `memory-performance.ts:97-116` never actually implemented. Constraint named: `MEM-PATTERN-PROMOTER-BOUNDED`, added to ADR 0022 §11.2 and §20.1, explicitly labelled as proving the PROMOTER bound only (never cited as evidence for the Tier-1 CHECK, per §18.1). | `lib/db/memory-performance.test.ts` — two new cases: a 501-char pattern is rejected with `client.rpc` never called, and a 500-char pattern at the exact bound is accepted and reaches the RPC. Demonstrated to redden per the step's own note in the test file: temporarily removing `PATTERN_PROMOTER_BOUND_SCHEMA.parse(...)` let a 501-char pattern reach the RPC unrejected; reverted immediately after confirming red. | D2 (`1ff244ba`) |
| **NIT-4** | `lib/learning/summarize.ts`'s per-statement catch no longer folds every failure into `statementsRejected`. It now distinguishes a genuine bound rejection (`ZodError`, or the DB CHECK's `performance_memory_pattern_length_check` constraint name in the error message) from anything else, which lands in a new `statementsErrored` counter on `SummarizeResult`. Both outcomes are still reported to Sentry, now tagged `outcome: 'rejected' \| 'errored'`. | `lib/learning/summarize.test.ts` — the existing bound-rejection case now asserts `statementsErrored: 0` alongside `statementsRejected: 1`; a new case asserts a transient failure (`'connection terminated unexpectedly'`, containing neither signal) increments `statementsErrored` and leaves `statementsRejected` at 0. | D2 (`1ff244ba`) |
| **NIT-7** | **Not closed in this pass.** The session-29 build guide's D2 step scoped `studio_drafts.accepted_revision` bounding (a Zod max mirroring §5.1's `posts.content` contract, plus a recorded CHECK-or-why decision) into D2 alongside MAJOR-2 and NIT-4. That work was not done — D2 as executed touched only `lib/db/memory-performance.ts` and `lib/learning/summarize.ts`. `accepted_revision` remains `text NULL`, unbounded, flowing verbatim into `post_ai_originals.rendered_content` via `promote.ts:145-146`. Left open, not silently dropped: still needs its own step. | — | not closed |
| **NIT-7 (follow-up)** | Closed. The row above is left exactly as written (append-only) — this row supersedes it. `acceptSchema`'s `acceptedContent` field (`app/[locale]/(dashboard)/studio/actions.ts`) — the sole write path into `studio_drafts.accepted_revision` via `acceptSuggestion` — gains `z.string().min(1).max(5000)`, mirroring `posts.content`'s established contract. Decision recorded as no DB CHECK: `accepted_revision` has exactly one producer, unlike `performance_memory.pattern`'s §5.2 rationale for a CHECK. Constraint named `ACCEPTED-REVISION-BOUNDED`, added to ADR 0022 §5.5, §11.2, §20.1. | `app/[locale]/(dashboard)/studio/actions.test.ts` — two new cases on `acceptStudioSuggestion`: a 5001-char `acceptedContent` is rejected as `invalid_input` before `acceptSuggestion` is called, and a 5000-char value at the exact bound is accepted. | D2 follow-up |
| **MAJOR-3** | `PROMOTE-SOFTDELETE-CLEARED` (Tier-1, `supabase/__tests__/studio-promote-claim.test.ts`) calls `clearPromotedCampaignReferenceOnDrafts` directly and proves the function's own behaviour, but stays green if `campaigns/actions.ts:101`'s CALL SITE is deleted — the Session-28-D D7 bug shape, reintroduced fresh on the very function added to prevent a repeat of it. Closed with three new Tier-2 cases in `campaigns/actions.test.ts`, mirroring the pre-existing `clearCampaignReferenceOnCards` trio in the same file. §20.1's `PROMOTE-SOFTDELETE-CLEARED` row now carries an appended note naming which of the three tests actually catches the call-site deletion (one of three — see the test that now proves it, next column) versus which two assert a complementary, mutation-independent guarantee. | `campaigns/actions.test.ts` — three new cases on `deleteCampaignAction`: called with the deleted campaign's id (`clearPromotedCampaignReferenceOnDrafts`), a throw from it does not fail the delete, and it is not called when the delete guard fails. Demonstrated to redden: temporarily replacing the call-site body with a no-op reddened ONLY the first of the three ("called with the deleted campaign's id") — 1 test failed, 18 passed. The other two assert a guarantee (throw-tolerance; not-called-on-guard-failure) that holds whether or not the call exists at all, so they do not redden on this mutation and are not claimed to; this is reported as observed, not as "all three redden." Reverted immediately after confirming the one red case. | D3 |
| **NIT-3** | **Argued and declined.** The new `console.error('campaigns/actions: clearPromotedCampaignReferenceOnDrafts failed after delete', ...)` at `actions.ts:103` immediately mirrors the pre-existing line at `:93` (`clearCampaignReferenceOnCards`'s own failure log) — same file, same Server Action, same shape, same purpose: the sole operator-observability line for a best-effort cleanup step whose failure must not mask a successful delete. CLAUDE.md's console.log carve-out ("a worker or route may emit exactly ONE canonical structured-JSON `console.log`... until a logger lands — this is the established house pattern, not a new exception per file") covers a `console.error` used identically to an already-accepted sibling line in the same route; adding a second cleanup path without its own log would be the inconsistency, not the log itself. No change made. | — | D3 (argued, no code change) |
| **MAJOR-4** | A-3's second half now ships: `approvePost` (`lib/db/posts.ts`) refuses a `scheduled_at` already in the past (typed `outcome: 'schedule_expired'`), rather than silently approving it for the next `claim_posts_for_publishing` tick. Adds an optional `newScheduledAt` so a re-picked future time is written atomically with the status flip in the SAME conditional UPDATE — never a separate reschedule call. Both `approvePost` callers (`calendar/actions.ts`'s `approvePostFromCalendarAction`, `campaigns/[id]/posts/actions.ts`'s `approvePostAction`) updated to surface the new typed outcome; UI treatment varies by surface — a full inline re-pick control in `ApprovalsInbox.tsx` (the primary approval surface), a directing message in `PostCard.tsx` and `PostRow.tsx` (which already have a reschedule affordance elsewhere on the same row/card) — recorded as a deliberate scope call, not an oversight. i18n added to en/pt/es across all three surfaces. `database-reviewer` (invoked per the step's spec) caught a real MAJOR in the first pass: the `newScheduledAt <= nowIso` pre-check used STRING comparison, which misclassifies when the two ISO timestamps differ in fractional-second precision (Zod's `.datetime()` permits zero-to-any digits; `toISOString()` always emits exactly 3) — a same-second, differently-precision pair could bypass the guard entirely, with no DB-level backstop on that branch. Fixed to a numeric instant comparison (`new Date(...).getTime()`) before committing; a regression test pins the exact repro. The reviewer's MINOR (the diagnostic-read SELECT not mirroring the `businessId` predicate, so a business-mismatch could misclassify as `schedule_expired` instead of `not_eligible`) was also fixed in the same pass. Constraint named `PROMOTE-SCHEDULE-RETOUCHED`, added to ADR 0022 §11.1 and §20.1. | `lib/db/posts.test.ts` — mocked cases for the atomic guard, the `newScheduledAt`-in-past pre-check (string-vs-instant regression case included), and both diagnostic-read outcomes. `supabase/__tests__/posts-approval-boundary.test.ts` (Tier-1, live Postgres) — `describe('PROMOTE-SCHEDULE-RETOUCHED (MAJOR-4)')`: a past-scheduled draft is refused, stays `draft`, and is proved NOT claimable by the real `claim_posts_for_publishing` RPC; a future-scheduled draft is approved normally and IS claimable once that time arrives. Demonstrated to redden: temporarily disabling the atomic `.gt('scheduled_at', nowIso)` guard let the negative case's post reach `approved` with a past `scheduled_at` (1 test failed); reverted immediately after confirming red, then reconfirmed green (13/13). Both `lib/db lib/social lib/validation`-adjacent scope (`npm run test:app`, 2984 tests) and the Tier-1 file re-ran green after the reviewer's fixes. | D4 |
| **MAJOR-5** | A-9's ruling: `generatePostsForCampaign`'s idempotency guard (`lib/campaigns/generate.ts`) now counts GENERATED posts (`posts.role IS NOT NULL`) rather than all existing posts. A promoted campaign always holds exactly one pre-existing, human-authored post with `role === null` (`promoteDraftToCampaignCore`'s `createPosts` call never sets it); counting it as "already generated" made every promoted campaign refuse to generate and never reach `activateCampaign`, stuck at `awaiting_brief` forever. The discriminator is origin-blind by construction — `role` is set only by this same function, never inspected against `campaigns.origin`, per A-9's explicit rule against reaching for `origin`. §2.7's `N + 1` arithmetic (previously dead code on the promoted path) is now the live path. Constraints named `PROMOTE-GENERATE-ACTIVATE-REACHABLE` (§11.1) and `GENERATE-GUARD-ROLE-SCOPED` (§11.2), both added with §20.1 rows; §2.7 gets an appended amendment recording the fix. | `lib/campaigns/generate.test.ts` — three cases: the BYTE-IDENTITY regression (a non-promoted campaign with a generated, `role`-set post still returns `already_generated`), the fix itself (a promoted campaign's `role === null` post does not block generation), and §2.7's arithmetic on the live path (`activateCampaign` called with generated-count + 1). `supabase/__tests__/studio-promote-brief-end-to-end.test.ts` (Tier-1) — a promoted campaign driven through the real promote → critique → approve → generate → activate chain ends `status='active'`, `total_posts_planned=3`. Demonstrated to redden: reverting the guard to count all existing posts reddened both the Tier-2 promoted-campaign case and the Tier-1 end-to-end case (`postsCreated: 0`, campaign stayed `awaiting_brief`); reverted immediately after confirming red. `database-reviewer` (invoked per the step's spec) reviewed read-only and confirmed the discriminator, the arithmetic, and the RLS/race posture were all sound — no findings. | D5 (`0f1a125f`) |
| **MINOR-4** | Recorded as a deferred decision, not built: §6.3 gets an appended amendment stating the carousel FAMILY (schema, policy, platform-map rows) shipped correctly, but the SOURCING — a brief field or other Tier-0 signal that ever sets `carouselRequested` to `true` — does not exist, because building it would require re-opening §8.2's frozen Mode 2 prompt fixtures (a prompt would need to ask the model to signal carousel intent), out of scope for a correction pass (L-1). Revival condition recorded in §15. `CAROUSEL-SCHEMA-STRUCTURAL`/`CAROUSEL-POLICY-SEQUENCE` reddening over code with no production caller is now a stated decision, not an unnoticed gap. No source file changed. | — (docs-only decision; no runtime test changes what it was already correctly proving in isolation) | D6 (`3b1a1985`) |
| **MINOR-5** | Recorded as a ruling, not built: §7.1 gets an appended amendment stating §8.2 wins and §7.1 yields — `scriptBrief` ships schema-and-render-ready (bounded, rendered per §7.3) but no production prompt populates it, and none will until a session is explicitly permitted to re-freeze the Mode 2 prompt fixtures. The Builder's original `.nullish()` engineering call (recorded only in a source comment) was correct; what was missing was the ADR making the same ruling. `schemas.ts:9-29`'s long inline comment shortened to point at the ADR section (the one source change this step permits). Revival condition recorded in §15, shared with MINOR-4's. | — (docs-only decision; `SCRIPT-BRIEF-BOUNDED` continues to prove the bound, now explicitly labelled as proving a field nothing populates yet) | D6 (`3b1a1985`) |
| **MINOR-1** | `platform-map.frozen-table.test.ts`'s frozen table extended from two volume points (1, 5) to five (1, 2, 2.9, 3, 5) — spanning `platform-map.ts`'s `>= 3` threshold itself, for every platform and both `carouselRequested` values. `MODE2-FORMAT-SELECTION-UNCHANGED`'s §20.1 row and §11.2 entry both note the strengthening. | `platform-map.frozen-table.test.ts` itself. Demonstrated to redden: mutating the threshold to `>= 2` reddened 8/51 cases, to `>= 4` reddened 4/51 — both exactly at the new boundary rows; both reverted immediately after confirming red. | D7 (`40786c76`) |
| **MINOR-2** | The tautological assertion (`platform-map.frozen-table.test.ts:71-77`, calling `selectFormatFamily` twice with identical arguments and asserting the results equal — cannot fail) deleted outright, per the step's first listed option. The per-cell literal expectations in the same file already prove the byte-identical claim honestly; nothing replaced it because nothing needed to. | The remaining per-cell assertions in `platform-map.frozen-table.test.ts` are the real proof; there is no assertion left that could reproduce the tautology. | D7 (`40786c76`) |
| **NIT-1** | Recounted directly against the file: 11, confirming the Reviewer's finding. Corrected via an APPENDED `### 18.4` note in ADR 0022 (§18's own append-only form — §18.3's original "ten" text is not edited), rather than an in-place fix, since §18.3 is itself already a correction section. The same stale `generate-native.ts:98` production-caller citation recurs in §18.3's own text; noted in the same append (the underlying `platform-map.ts` comment citation is corrected separately, NIT-6). | — (a recount + a documentation append; verified by direct `grep -c` against the file, 11 matches) | D7 (`40786c76`) |
| **NIT-6** | `lib/ai/prompts/formats/platform-map.ts:27-28`'s comment corrected from `generate-native.ts:98, studio-suggestion.ts:136` to the current `generate-native.ts:106, studio-suggestion.ts:142` — re-grepped, not assumed, matching §20.3's already-correct table. | — (comment-only fix; verified by `grep -n` against both call sites) | D7 (`40786c76`) |
| **MINOR-3** | A new Tier-1 case proves the `WITH CHECK` violation specifically: a signed-in tenant updates a row it legitimately sees (USING passes), attempting to move it into another tenant's `business_id`, and is refused with Postgres's row-level-security error. A genuine, unplanned finding surfaced during the mutation-test verification: loosening ONLY `studio_drafts_update_own`'s `WITH CHECK` to `true` did NOT let the tunnel succeed — Postgres's RLS for UPDATE also applies the table's `SELECT` policy's `USING` clause to the new row, independently of the UPDATE policy's own `WITH CHECK`. Confirmed by loosening BOTH policies together (the tunnel then succeeded, a real cross-tenant `business_id` change observed), then restoring each individually (either alone re-blocks it). `security-reviewer` (invoked per the step's spec) confirmed the test is sound, the finding is accurately understood (not a masked gap), no remaining tenant-isolation gap exists in these policies, and the `not_found` path introduced by MINOR-8 (same step) leaks nothing across tenants. All live-Postgres policy mutations were performed with the user's explicit turn-by-turn approval and fully restored, verified via `pg_policies` re-query, before the step's tests were reconfirmed green. `PROMOTE-RLS-ISOLATED`'s §11.1 and §20.1 rows both carry the strengthening and the live finding. | `supabase/__tests__/studio-promote-schema.test.ts` — new case `'WITH CHECK refuses moving a legitimately-visible row into another tenant'`. | D8 (`d140f4b7`) |
| **MINOR-8** | `claimStudioDraftForPromotion`'s fallback re-read (`lib/db/studio-drafts.ts`) changed from `.single()` (throws on zero rows) to `.maybeSingle()`, returning a new typed outcome `{ outcome: 'not_found' }` when the draft was soft-deleted or removed between page load and the claim attempt. Threaded through `PromoteDraftToCampaignResult` (`lib/campaigns/promote.ts`) into the Server Action (`studio/actions.ts`'s `promoteDraftToCampaign`, now ALSO wrapped in try/catch with `Sentry.captureException` — it had none before, so even an unrelated thrown exception rendered Next's generic error boundary instead of a typed state) as a new `StudioActionErrorCode` value `draft_not_found`, rendered as a distinct message in `StudioEditor.tsx` (an eighth, distinct case beside §10's seven, not a renumbering), i18n'd in en/pt/es. Constraint named `PROMOTE-MISSING-DRAFT-TYPED`, added to §11.1 and §20.1; `PROMOTE-STATES-RENDERED`'s §11.2/§20.1 entries note the extension. | `supabase/__tests__/studio-promote-claim.test.ts` (Tier-1) — two new cases: claiming a soft-deleted draft, and claiming a draft id that never existed, both asserting `{ outcome: 'not_found' }`. `lib/campaigns/promote.test.ts`, `app/[locale]/(dashboard)/studio/actions.test.ts` (including a new case that the try/catch catches an exception and returns a typed generic error, never rethrowing), `components/studio/StudioEditor.test.tsx` — mocked pass-through and rendering cases. Demonstrated to redden: reverting the fallback re-read to `.single()` reddened both new Tier-1 cases with a thrown "Cannot coerce the result to a single JSON object" error; reverted immediately after confirming red. | D8 (`d140f4b7`) |
| **MINOR-6** | `listLatestPostAiOriginalsByPostIds` (`lib/db/post-ai-originals.ts`) rewritten from a single ordered, list-wide-capped SELECT (`.limit(postIds.length * 20)`, post_id-major ordering) to a new RPC `get_latest_post_ai_originals` (migration `20260825190000_post_ai_originals_latest_per_post.sql`) — a `DISTINCT ON (post_id)` read, `SECURITY INVOKER` (RLS applies through the caller's own session), granted to `authenticated` since the sole production caller (`approvals/page.tsx`) uses the RLS-scoped Server Component client. Every requested post now gets its own latest revision regardless of how many revisions any OTHER post in the list carries. Constraint named `PROMOTE-AI-ORIGINALS-PER-POST-BOUNDED`, added to §11.1 and §20.1. | New Tier-1 file `supabase/__tests__/post-ai-originals-latest-per-post.test.ts` — one post with 41 revisions, another with 1, both requested together; both come back with their correct latest revision. Demonstrated to redden: reverting to the old capped SELECT reddened the test — the light post fell off the result entirely (`result.size` 1, not 2); reverted immediately after confirming red. Stale Tier-2 mocks in `lib/db/post-ai-originals.test.ts` (asserting `.from`/`.order`/`.limit` chain shape) updated to assert the RPC call shape instead. | D9 (`50f3b1e8`) |
| **NIT-5** | `AiOutputPreview.tsx` now renders each carousel slide's own `imageBrief` (§6.1's per-slide field, previously unrendered) alongside `role` and `text`, with the identical "recommendation, never published" framing and `role="note"`/`aria-label` treatment §7.3 already establishes for the branch-level `imageBrief`/`scriptBrief` blocks. i18n added to en/pt/es simultaneously (`row.carousel.slideImageBrief.{heading,neverPublishedNote}`). Confirmed the never-published scan (`script-never-published.test.ts`) and the no-image-generation scan (`scope-scans.test.ts`, `MODE2-CAROUSEL-NO-IMAGE-GEN`) are both unaffected — no new file references `scriptBrief`, and nothing generates an image. Constraint named `CAROUSEL-SLIDE-IMAGE-BRIEF-RENDERED`, added to §11.2 and §20.1. | `AiOutputPreview.test.tsx` — two new cases: a slide with a real `imageBrief` renders it with the never-published marker present in its accessible name; a slide with `imageBrief: null` renders nothing extra. | D9 (`50f3b1e8`) |
| **MINOR-7** | Out of range, flagged not charged by the Reviewer, fixed anyway per founder direction (build guide §4, D10). `vitest.config.ts`'s `lib/**` include widened from `*.test.ts` to `*.test.{ts,tsx}` (mirroring `app/**`/`components/**`'s existing pattern). All seven previously-invisible files ran green on the first try — a genuine discovery of zero breakage, not a fix disguised as one. Local test-file count moved 219 → 226 (+7), recorded in `docs/current-phase.md` as a local reading, explicitly distinguished from a `master` push-event skip-guard reading (this branch has not merged). | The seven files themselves (`first-post-published`, `layout`, `payment-failed-courtesy`, `team-invite`, `trial-warning-t1`, `trial-warning-t3`, `welcome-to-plan` — all `.test.tsx` under `lib/email/templates/__tests__/`), now collected and passing where they were previously never collected at all. | D10 (`99982288`) |
| **NIT-2** | Addressed in this same step (D11): ADR 0022 gets an appended `### 20.4` note (§20's own append-only form — §20's original "the current range head" sentence is not edited) stating precisely what the Reviewer's finding requires: the CI evidence at `b01a9985` still covers all code at that head (`4db4053f` is docs-only), but the sentence itself is now false as written and could be misread as a claim that CI ran at `4db4053f`. Recorded as superseded once D12 runs CI at the corrected head. | — (documentation-only correction) | D11 (this commit) |

**Closing line (D12) — all twenty findings above are closed, argued-and-declined (NIT-3), or, for NIT-7's
first row, superseded by its own follow-up row; both required CI jobs ran green at the corrected head,
`8d506634` (D11's `6f67fda6` plus one lint fix this step's own CI run discovered — see ADR 0022 §20.5 and
`docs/current-phase.md`'s D12 entry for the verbatim skip-guard lines, run URLs, and the exact file-count
reconciliation). These are `pull_request`-event runs on PR #6 against `session-29`, not `master` push
events — the `db-tests` three-green promotion tally is unmoved by them. Session 29-D's correction pass
(D0–D12) is code-complete and CI-verified at this SHA; merging `session-29` to `master` is a separate step
the founder takes when ready, not performed by this pass.**
