# Session 29 — Closing the Mode 1 / Mode 2 deferrals: promote-to-campaign + carousel & script (ADR 0022) · Track F

> **Goal:** close the two gaps in `docs/brainstorm/plan-vs-implemented-gap-analysis.md` that live inside
> Modes 1 and 2, and close them as **decisions** rather than as silent overrides of Accepted ADRs. Both
> were deferred by a named ruling in a landed ADR; neither is a bug, and neither may be built by simply
> starting to type.
>
> - **Track F1 — Studio promote-to-campaign.** ADR 0019 §15 item 1, named there as Track D's *"immediate
>   follow-on."* Mode 1 Studio today produces a reviewed draft that dead-ends: `studio_drafts` holds
>   `content`, the chosen `platform` and the accepted revision, and **nothing consumes them**. Mode 3
>   already ships the symmetric exit (`lib/signals/seed.ts` — an approved insight card becomes a real
>   campaign and a real brief through the **unchanged** ADR 0017 pipeline). Track F1 gives Studio the same
>   exit, by the same route, and its ADR's job is largely to explain why it is not allowed to invent a
>   different one.
> - **Track F2 — The carousel format family, and script as a recommendation field.** ADR 0017 D-6 deferred
>   both *"when Instagram carousel / TikTok-Shorts are prioritized; one new union branch each."* Instagram,
>   Facebook Pages and Threads are **locked launch platforms** (constitution), so **carousel's revival
>   condition is met** and it ships as a real format family. **Script's does not ship as a family** — D-6
>   priced it as one union branch, and that price assumed a publish path no launch platform can provide
>   (§0 L-9). Script ships instead as a **recommendation field**, on exactly the footing `imageBrief`
>   already occupies. The true script family is deferred with a named condition.
>
> **Prerequisite, absolute — two of them.** (1) **Step 0 below must be complete**: Sessions 23–28 land on
> `master` and the three workflows run green there. Session 29 has no correct base branch until they do.
> (2) ADRs 0017 and 0019 must be Accepted and their sessions closed — Track F1 seeds a pipeline ADR 0017
> defines and consumes a table ADR 0019 defines. Both are Accepted as of Session 28's close; **re-verify
> at the shipped code, not at the ADR text**, per the Reality block.
>
> **The second gap track ships separately.** The third gap — a second, market-responsive signal source —
> is **not here**. It reopens ADR 0020 §6.5's embeddings ruling, introduces a new external service behind
> the signals boundary, and carries a prompt-injection surface unlike anything in Modes 1–2. It gets its
> own ADR 0023 and its own guide: **`docs/build-guide/session-30.md` · Track G**. Bundling it here would
> bury a ruling that retires a Tier-3 constraint inside a document mostly about promote buttons and
> discriminated unions, where no reviewer would find it.

---

## Step 0 — Prerequisite, absolute: land Sessions 23–28 on `master`

**Session 29 does not begin until this is done.** As of writing, `master` is at `462e49eb`
("docs: track the governance layer", Session 22-D). Every commit from Sessions 23 through 28 — ADR 0015
Amendment B, ADRs 0016–0021, ~345 files and ~70k lines — exists **only on `session-22-d`**. Three
consequences, all blocking:

1. **There is no correct base branch for Session 29.** Cutting `session-29` from `master` starts from a
   tree with no governed memory, no Mode 2 brief pipeline, no Studio and no Mode 3 — and Track F builds
   directly on the first three. Cutting it from `session-22-d` stacks a fourth unmerged session onto an
   already 70k-line branch.
2. **The `db-tests` promotion rule is frozen.** ADR 0015 §5 promotes `db-tests` to Required after **three
   consecutive full green runs on `master`**. `docs/current-phase.md` carries the tally at **0 of 3** —
   not because runs have failed, but because no post-Session-22 code has ever run on `master` at all. The
   tally cannot advance while the work lives on a branch.
3. **Session 28's CI evidence is branch evidence.** D9's green runs (`app-tests` 31846312604, `db-tests`
   31846312570, `eval-reported`/`eval-threshold` 31846312762) are real and were read at the corrected
   head — but they are **not `master` runs** and do not count toward the tally. D9's own note in
   `current-phase.md` already says so.

**Step 0 deliverables:**

- **0.1** Working tree clean. At the time of writing: `.gitignore` and `docs/build-guide/session-24.md`
  modified, `docs/brainstorm/plan-vs-implemented-gap-analysis.md` untracked. Review each and commit or
  discard **deliberately** — do not sweep them into the merge commit.
- **0.2** `session-22-d` → `master` via PR (the Session 25 precedent, PR #4). **Merge, do not squash:** the
  per-session commit history is the audit trail every ADR appendix cites by SHA.
- **0.3** All three workflows green **on `master` at the merge head** — `app-tests`, `db-tests`
  (skip-guard clean, non-zero file and test counts quoted from the log line), `eval-reported` +
  `eval-threshold`. Record the run URLs.
- **0.4** `docs/current-phase.md` updated: this is the **first `master` run**, so the promotion tally moves
  **0 of 3 → 1 of 3**, dated, with the run URL. **Do not backfill the branch runs into the tally.**
- **0.5** `session-29` cut from the merge head on `master`.

If 0.3 is not green, **Session 29 stops here** and the failure is diagnosed as its own correction pass. A
merge that reddens `master` is not a base to build two tracks on.

---

## Reality check — to be re-verified against the live repo before the Architect runs

Stated at the shape found at `66262711` (Session 28-D close-out). Each item is load-bearing for at least
one track. **If any has changed, correct this file before the Architect runs** — do not let the ADR
re-derive a contract from memory.

1. **Stage F is the promote precedent, and F1 must mirror it rather than re-invent it.**
   `lib/signals/seed.ts` composes an approved card into a `campaigns` row with
   `origin = 'signal_generated'` (§6.2 — *"no migration, the value already ships"*) and then calls
   **`assembleBrief(campaignId)` unchanged**. `critiqueBrief` and `approveBriefIfQualified`'s HARD gate
   still run (§6.3). `BriefAssemblyInput` was **not** extended — the card is composed into
   `objective: string` by `composeObjective()`, precisely so Mode 2's contract costs zero change. ADR 0021
   D-7 names *"a signal-specific generation path"* as the loser. **F1's equivalent loser is a
   Studio-specific generation path**, and the ADR should be expected to reject it on identical grounds.
2. **`seedCampaignFromCard` is NOT idempotent at the `createCampaign` step** — its own comment says so
   (`lib/signals/seed.ts:52-61`, added by Session 28-D D7 as `database-reviewer`'s NIT-1). Only the final
   write-back is guarded, by `setCardCampaignId`'s `.is('campaign_id', null)`. It is unreachable today only
   because `approveCardAction`'s atomic conditional transition admits at most one caller per approval, and
   no retry job exists. **F1's promote action inherits this hazard exactly** and must carry an equivalent
   atomic-conditional guard **on the `studio_drafts` row**, from the first commit — not as a follow-up.
3. **`studio_drafts` deliberately has no `campaign_id` column and no `status` enum.** ADR 0019 §4 is
   explicit about why: *"a nullable FK nobody uses yet is option (a) in miniature and will attract exactly
   one join."* ADR 0019 §15 states what promote actually is: *"an INSERT into `posts` under a real campaign
   … a migration plus a Server Action, not a redesign."* **Note the tension with item 1** — §15 says
   `posts` INSERT, Stage F says seed a brief. That is §0.1 Q1, and it is the single most consequential
   question in this ADR.
4. **F1 is the caller that reopens a deferred ADR 0018 amendment.** ADR 0019 A-3 deferred an additive
   `generation_kind` value (the CHECK is `IN ('initial','regeneration')`,
   `20260726010000_learning_capture.sql:34`) on the stated ground that *"Track D has no promote step, so
   the amendment has no caller."* **Track F1 is that caller.** The amendment is now due, it is additive,
   and writing it is a named deliverable of this Architect phase (L-6).
5. **F1 opens a path ADR 0019 §5.6(2) named as unbounded.** Promoted content reaches `posts.content` →
   ADR 0018's classifier → possibly `performance_memory.pattern` → back into generation as `topContent` at
   `post-generation.ts:179` — whose own comment (`:167-178`) concedes it has **no length cap** and states
   *"THAT writer must enforce its own length bound at write time."* ADR 0019 §15 item 10 makes the
   write-time bound a **promote-time obligation**. **Track F1 owns it and it has no other owner.**
   Same-tenant, so this is self-poisoning and cost, not a tenancy breach — say so plainly rather than
   overstating it.
6. **Format families live in `lib/ai/prompts/formats/`** — `schemas.ts` (the
   `z.discriminatedUnion('format', …)`), `platform-map.ts` (the deterministic Tier-0 platform→family map),
   `policy.ts` (the validator that distinguishes shape-fail from sequence-fail), and
   `native-generation-prompt.ts` (the per-family Prompt factory). ADR 0017 D-3/§4: the **runner stays
   ignorant of format families** and there is **no third `prompt.id`**. F2 adds **one union branch each**
   plus map and policy entries. **If F2 finds itself editing `lib/ai/runner.ts`, it has taken the losing
   option** — stop and re-read §4.
7. **Thread guardrails are structural, in the schema, not in prose:** `3 ≤ posts.length ≤ 8`, `posts[0]`
   = hook, last = close, ≥1 pull_quote, enforced by the policy validator
   (`MODE2-THREAD-GUARDRAILS`). Carousel and script each need their **own** structural bounds, decided in
   the ADR with an argument, **not defaulted from thread's**.
8. **The platform→family map is deterministic and Tier-0** (`platform-map.ts`): today `twitter` and
   `threads` map to single-post **or** thread by a content-volume rule (`<3` tweets' worth → single,
   `3..8` → thread, L-8). Adding families means adding rows to that map, and **every existing row must
   produce byte-identical output afterwards** — that is F2's central risk, not the new branches
   themselves.
9. **`imageBrief` is a recommendation field only** (ADR 0017 §4, §15) — consistent with the constitution's
   *"We don't generate images at launch."* A carousel is a sequence of image slides, so **carousel at
   launch is slide copy plus per-slide `imageBrief`, and nothing else**. The ADR must state that as the
   shipped product, not as a stopgap (L-8).
10. **`assembleBrief` gains a SECOND production caller — not a third.** *(CORRECTED 2026-08-21 by the
    F1a seam sweep; the original text below was wrong and is preserved so the correction is legible.)*
    ~~Today: Mode 2's own path and Stage F (`seedCampaignFromCard`).~~ A repo-wide `git grep` finds
    **exactly one** production caller today: `seedCampaignFromCard` at `lib/signals/seed.ts:85`. There are
    **zero** callers under `app/**` — Mode 2 has no production `assembleBrief` call site. ADR 0021 §6.4's
    own SHARED-FUNCTION CALLERS table said so at Session 28 (*"(none in production today)"* / *"its first
    production caller"*); this guide contradicted it and this guide was wrong. Promote is therefore
    `assembleBrief`'s **second** production caller. ADR 0021 A-2 required a **Tier-1 live-Postgres test
    driving `assembleBrief` end to end** through Stage F, precisely because a function with few real
    callers has never met real auth, real RLS-filtered memory, or the missing-rows path — *"both Session 22
    blockers were that gap."* **SHARED-FUNCTION CALLERS applies in full to F1**: enumerate **both**
    production callers plus every test caller, state per caller which test covers it, and confirm no
    existing caller's behaviour changes. Note that `lib/signals/seed.test.ts:14` **mocks** `assembleBrief`
    (`vi.fn()`) and therefore does **not** execute its body; the only test that drives the real function
    through a production caller is the Tier-1 `supabase/__tests__/signals3-seed.test.ts:139`.
11. **Studio's surfaces are `app/[locale]/(dashboard)/studio/page.tsx` and `studio/[draftId]/page.tsx`,
    with `actions.ts` alongside**, and `lib/studio/` holds `categories`, `diff`, `guard`, `markers`,
    `verify`. The closest shipped triage/approve surface to model promote's UX on is
    `app/[locale]/(dashboard)/approvals/` and, newer, `opportunities/OpportunityFeed.tsx` — whose status
    bands were moved onto `globals.css` tokens with a both-themes contrast assertion in Session 28-D D5.
    **That token + contrast-assertion precedent is binding on any new UI here** (L-11).
12. **Mode 3 is untouched by this session.** No change to the poller, the watch list, the scorer, the
    candidate schema, the triage loop, the card schema or the feed. If a step appears to need one, that is
    a Session 27/28 amendment and it is **flagged, not made** (L-12).

**Items 13-19 were added 2026-08-21 by the F1a seam sweep and its three advisory passes.** Each falsified
or materially sharpened something the Architect would otherwise have taken on trust. They are Reality, not
decisions — the decisions they forced are in §0.2.

13. **`generation_kind` is written by APPLICATION CODE, not by a trigger.** ADR 0019 §2.6/§15's phrase
    *"the existing trigger does the rest, unchanged"* is **half true, and the load-bearing half is false**.
    The value is supplied at exactly two sites — `lib/campaigns/generate.ts:407` (`'initial'`) and
    `app/[locale]/(dashboard)/campaigns/[id]/posts/actions.ts:363` (`'regeneration'`). The trigger
    `enqueue_post_edit_signal()` only **reads** the latest snapshot
    (`20260726010000_learning_capture.sql:199-203`). Promote must write its own `post_ai_originals` row.
14. **A snapshot-less post is already handled, deliberately.** `20260726010000_learning_capture.sql:205-207`
    guards with `IF v_origin_id IS NOT NULL THEN` and the comment *"a snapshot-less post (manual origin, or
    any post with no `post_ai_originals` row) must NOT fail the approve — just skip."* **A promoted post
    does not need a snapshot for approval to work.** Writing a *fabricated* one is worse than writing none:
    Track C would diff the human's text against the human's own text wearing an AI label and synthesize a
    phantom pattern into `performance_memory`. This is why §0.2 A-1 exists.
15. **`studio_drafts` does not retain the accepted-suggestion revision.** Columns are `content`, `platform`,
    `content_hash`, `suggestions`, `suggestions_for_hash` — the accepted revision is **merged into
    `content`**, not stored separately. ADR 0019 §2.6's plan to snapshot *"the accepted-suggestion
    revision"* is therefore **not implementable as written**. §0.2 A-1 rules on it.
16. **`studio_drafts.content` is UNBOUNDED today.** `createStudioDraftAction` / `saveStudioDraftAction`
    validate with a bare `z.string()` — no `.max()` (`studio/actions.ts:267`, `:296`). Inert only because
    nothing consumes it downstream. The moment promote reads it, the worst case is *whatever a human can
    paste*, **not** the "~3x5000 chars" that `post-generation.ts:167-178` reasons about — that number
    assumes the edit-path caps (`calendar/actions.ts:48`, `posts/actions.ts:179`) apply, and they do not.
17. **`instagram` maps to `'single'` UNCONDITIONALLY** (`platform-map.ts:25-35`), and
    `platform-map.test.ts:5-12` asserts it is single *"regardless of content volume."* Carousel cannot be
    reachable without touching that arm — see §0.2 A-4 for how L-10 is satisfied anyway.
18. **Three ternaries switch on a bare `FormatFamily` string and are NOT exhaustiveness-checked** —
    `lib/ai/generate-native.ts:110`, `native-generation-prompt.ts:36-52`, and the factory body at `:138`.
    `selectFormatFamily`'s `switch` buys exhaustiveness over **`Platform`**, and **nothing** over
    `FormatFamily`. The first site **silently misroutes** a carousel call into `generateThread`; it throws
    only because `validateThreadPolicy` happens to crash on the missing `posts[0].role` — an accidental
    safety net, not a designed one. Converting all three to `switch` + `assertNever` is a **precondition**
    of adding carousel (L-7), not a cleanup.
19. **Two soft-delete / worker facts that will look like bugs later if unstated.**
    (a) `softDeleteCampaignGuarded` is an **UPDATE** setting `deleted_at` (`campaigns.ts:141-155`), so
    `ON DELETE SET NULL` **never fires** — this is exactly why Session 28-D D7 needed
    `clearCampaignReferenceOnCards` (`insight-cards.ts:172-191`), and any new draft-to-campaign FK needs
    the same mirror. (b) `claim_posts_for_publishing` filters `platform IN ('linkedin','twitter')`
    (`20260524230000_publishing_worker.sql:34`) while `studio_drafts.platform` permits all five — a
    promoted Instagram/Facebook/Threads post sits `approved` **forever**. Pre-existing, not introduced
    here; say it out loud.

---

## §0 — Locked decisions (binding input — adjudicated by founder, 2026-08-21)

These are decided. The Architect (F1a) **encodes** them in ADR 0022 and names their losers; it does **not**
re-open them. Where a Locked decision and this guide disagree, the guide is wrong — flag it. Where the ADR
needs to contradict a Locked decision, it **STOPS and flags for founder adjudication**, exactly as an ADR
contradicting CLAUDE.md would.

**Locked (L):**

- **L-1 — Session 29 ships Track F1 (promote-to-campaign) and Track F2 (carousel + script format
  families), and nothing else.** *In scope:* the promote contract and its migration; the atomic promote
  transition; the ADR 0018 `generation_kind` amendment; the write-time length bound on the
  `performance_memory.pattern` / `topContent` path; **one** new format-family union branch (carousel) with
  its structural bounds, platform-map rows and policy rules; the **script recommendation field**; and the
  UI for all of it. *Out of scope, explicitly:* **the script format family** (L-9 — deferred, with its
  revival condition recorded);
  **any second signal source** (that is ADR 0023 / Session 30); **any change to Mode 3** in any part;
  `relationship_memory`; the **skip-review fast path** (ADR 0017 L-11 — an L-1 STOP if attempted);
  **image generation of any kind**; the media editor; and **any change to Mode 2's existing single-post or
  thread generation behaviour**. If a step appears to need any of these, **STOP and report.**

- **L-2 — Promote proposes. It never publishes, and it never skips a gate.** CLAUDE.md: *"We don't
  auto-publish without user approval (human-in-the-loop is a feature)."* A promoted Studio draft passes
  through **at least** the same gates a typed campaign does. **There is no configuration, flag, plan tier
  or "power user" setting that skips any of them.** The ADR states this as a named constraint with a test,
  not as prose. State the resulting gate count explicitly, the way ADR 0021 §6 did for signal-originated
  campaigns.

- **L-3 — Stage F is the precedent, and promote reuses ADR 0017's pipeline UNCHANGED.** No
  Studio-specific generation path, no second brief-assembly path, no new generation prompt, and **no
  extension of `BriefAssemblyInput`**. `critiqueBrief` and `approveBriefIfQualified`'s HARD gate run on a
  promoted brief exactly as on every other. The named loser is a bespoke Studio→campaign generator, which
  duplicates ADR 0017 and forfeits the entire reason the pipeline was designed as one (ADR 0021 D-7's
  argument, applied to a second caller).

- **L-4 — The promote transition is an ATOMIC conditional UPDATE on the draft row.** Never
  read-then-update. Two users promoting the same draft in the same moment is a real scenario in a
  multi-seat product, and a read-then-update loses one of them silently — or, worse, creates two campaigns
  from one draft. The ADR resolves the concurrent case explicitly and states what the second caller sees.
  **`seedCampaignFromCard`'s known non-idempotency (Reality §2) is a hazard to design against, not a
  pattern to copy.**

- **L-5 — The write-time length bound on `performance_memory.pattern` / `topContent` ships in THIS
  session.** ADR 0019 §15 item 10 assigned it to promote; promote is here; it has no other owner. The ADR
  states the bound as a **literal number** with its arithmetic (what a realistic `topContent` block costs
  in tokens against the context it competes with), where it is enforced (at write time, per
  `post-generation.ts:167-178`'s own instruction), and what happens on overflow — truncate, reject, or
  refuse to promote. Deferring it again is not available.

- **L-6 — The additive ADR 0018 `generation_kind` amendment is a named deliverable of the Architect
  phase.** Not a follow-on, not a ticket. ADR 0019 A-3 deferred it *because it had no caller*; L-1 gives it
  one. It is **additive** to an existing CHECK constraint, and it is written in the ADR 0014 Amendment A /
  ADR 0010 Amendment 2 house form.

- **L-7 — F2 adds ONE union branch per family, inside `lib/ai/prompts/formats/`, and nowhere else.**
  `lib/ai/runner.ts` is **not modified**. There is **no third `prompt.id`** (ADR 0017 D-3). The per-family
  Prompt factory pattern is extended, not replaced. Each new family's structural bounds are stated as
  literal numbers in the schema — the way thread's `3..8` and its role sequence are — so that
  `safeParse` rejects a malformed family structurally, not by a downstream string check.

- **L-8 — No image generation, and carousel ships as slide copy.** The constitution's *"We don't generate
  images at launch"* stands unamended by this session. A carousel branch produces **structured slide copy
  plus a per-slide `imageBrief` recommendation field** — nothing more. The ADR states this as the shipped
  product and records it in its §15 deferred section with the condition that would change it, so the next
  gap analysis does not re-flag it as drift.

- **L-9 — Carousel ships as a format family; script ships as a RECOMMENDATION FIELD** *(founder ruling
  2026-08-21, revising the same day's earlier scope ruling — the revision is recorded, not hidden)*. The
  original ruling named **both** as format families, over this guide's recommendation to defer script.
  **It is revised on new information, not re-litigated.** ADR 0017 D-6 priced each as *"one new union
  branch each"*, and that price silently assumed every family has a `platform-map.ts` row **and a publish
  path**. **Carousel has both** — Instagram is a locked launch platform and slide copy publishes as a
  post. **Script has neither**: no launch platform publishes video and the product has no media pipeline,
  so a script family would be a **new artefact class** — something generated, reviewed and approved that
  can never reach `published`, for which `posts`' state machine, the approval flow, the calendar and the
  publishing worker have **no state**. That is a session, not a branch. D-6's cost estimate was wrong, and
  that is the new information.

  **What ships instead:** script output as a **recommendation field**, on exactly the footing `imageBrief`
  already occupies (ADR 0017 §4, §15) — valuable generated content the product cannot itself act on,
  attached to a post, explicitly never published. The founder gets script output at launch; the publish
  pipeline gains no unpublishable artefact; and the precedent is one the codebase already set rather than
  a new exception. **The true script format family is DEFERRED**, with a revival condition recorded in the
  ADR's §15: a video-capable platform lands, **or** the product decides what a non-publishable artefact
  is — whichever comes first. **If the Architect concludes a recommendation field cannot carry the product
  value the founder asked for, it STOPS and flags for founder adjudication** rather than quietly building
  the artefact class.

- **L-10 — Mode 2's existing behaviour is byte-identical after F2.** Adding families must not change what
  single-post or thread generation produces for any existing platform. This is a **named constraint with a
  test**, in the shape ADR 0021 used for `SIGNAL3-RUBRIC-UNCHANGED` (*"proves `mode:'brief'` output
  byte-identical"*). The platform-map's existing rows are the risk surface (Reality §8), not the new
  branches.

- **L-11 — GDPR, tenancy, RLS and the design floor, in full.** Any new business-scoped table: RLS in the
  InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))` form, `USING` **and**
  `WITH CHECK` on every UPDATE, `ON DELETE CASCADE` from `businesses`, **a row in ADR 0010 Amendment 2
  §D2.5's cascade table**, and `purge_business` coverage. A new *column* on an existing covered table needs
  **no new §D2.5 row** — the Session 28-D D7 precedent (`insight_cards.campaign_id`) settles that; say
  which case applies and why. **Design floor:** new status/state colour lands on `globals.css` tokens with
  a both-themes contrast assertion reading the shipped token file (the ApprovalsInbox → OpportunityFeed
  precedent, Session 28-D D5), never as ad-hoc Tailwind colour classes.

- **L-12 — Contract discipline + constitution rules, inherited by every step.** Additive migration with an
  explicit stated backfill; **Zod** on every Server Action and route input; **atomic** state transitions;
  every list query **bounded + explicit `ORDER BY`** matching an index; **date-fns** (`toUtcIso()`, never
  raw `.toISOString()` — `lib/utils.ts:8-11`); **no `any`**; **no `console.*`** on user-facing surfaces;
  env only via `lib/config.ts`; Anthropic SDK only via `lib/ai/`; DB only via `lib/db/` + `lib/memory/`;
  service-role never in a user-facing read path; **i18n en/pt/es simultaneously**; shadcn v4 / Base UI with
  **no `asChild`** on `Button` or `DropdownMenu` primitives; and **SHARED-FUNCTION CALLERS** for every
  existing function F1 touches — enumerate every caller, state which test covers each. Both Session 22
  blockers were this exact failure.

**Adjudicated decision ledger (D — named losers):**

| # | Decision | Chosen | Losers (rationale) |
|---|---|---|---|
| D-1 | Session shape | **Two ADRs, two sessions: 0022 (Modes 1–2, here) and 0023 (second signal source, Session 30)** | one ADR for all three gaps — buries a ruling that retires a Tier-3 constraint (`SIGNAL-NO-EMBEDDINGS`) inside a document mostly about promote and discriminated unions, where no reviewer would look for it |
| D-2 | What promote produces | **§0.1 Q1 — the Architect decides between "seed a brief" (Stage F's shape) and "INSERT a post" (ADR 0019 §15's words), with the loser named** | *not* pre-decided here: ADR 0019 §15 and ADR 0021 §6 genuinely say different things, and picking one in a build guide rather than in an ADR is how contracts get re-derived from memory |
| D-3 | Promote concurrency | **atomic conditional UPDATE on the draft row** | read-then-update (loses a concurrent promoter silently, or creates two campaigns from one draft); copying Stage F's known non-idempotency (Reality §2 documents it as a hazard, not a pattern) |
| D-4 | The `topContent` bound | **ships here, as a literal number with arithmetic** | deferring it a third time (ADR 0019 §15 item 10 already assigned it to promote; promote is here) |
| D-5 | `generation_kind` | **additive amendment to ADR 0018, written in this Architect phase** | a new enum/table (non-additive, and ADR 0019 A-3 already specified the additive shape); deferring again (its caller now exists) |
| D-6 | Format-family extension point | **one union branch each in `lib/ai/prompts/formats/`; runner untouched; no third `prompt.id`** | a tag-dispatch branch inside `lib/ai/runner.ts` (couples every Mode 1/2 call to format-family concerns — ADR 0017 D-3's original loser, unchanged) |
| D-7 | Carousel at launch | **slide copy + per-slide `imageBrief`, no image generation** | generating images (constitution: not at launch); deferring carousel entirely (its revival condition — Instagram prioritized — is met by the locked launch-platform list) |
| D-8 | Script | **a recommendation field on `imageBrief`'s footing; the format family deferred** | a script *format family* now — ADR 0017 D-6 priced it as one union branch, but with no launch platform able to publish video it is a new **unpublishable-artefact class**, so the price was wrong; deferring script **entirely** — the founder wants script output at launch and the recommendation-field form delivers it without touching the publish pipeline |

---

## §0.1 — Questions the Architect (F1a) must resolve IN the ADR (BINDING)

**F1a's ADR must decide each one explicitly, name the loser, and tier the resulting constraint.** The
Builder consumes these answers as binding. Ground every answer in the real seams — let the single
`ecc:code-explorer` sweep map them and cite `file:line` rather than remembering.

- **Q1 — What promote actually produces (the load-bearing question).** ADR 0019 §15 says *"an INSERT into
  `posts` under a real campaign"*; ADR 0021 §6 / `lib/signals/seed.ts` seed a **brief** and let
  `assembleBrief` do the rest. **These are different products and the ADR must pick one and say why.**
  Decide: the exact function and its signature; its input (which `studio_drafts` fields, including the
  accepted revision); its output; the `campaigns.origin` value (**report `origin`'s ACTUAL enum values from
  `supabase/migrations/20260722190000_mode2_brief_and_roles.sql` — if a new value is needed, that migration
  lands here**); and whether `composeObjective`'s shape is reused, generalized, or duplicated. State the
  **gate count** for a promoted campaign explicitly, per L-2. If the answer is "INSERT a post," state what
  replaces the critique gate and why that is acceptable — L-3 makes that a hard argument to win.

- **Q2 — Promote's atomicity, idempotency and failure modes (L-4, Reality §2).** The conditional `WHERE`
  guard on the `studio_drafts` row and what column it guards on (a new `promoted_campaign_id`? a state
  column ADR 0019 §4 deliberately refused? — argue it, and note that §4's refusal was about a *nullable FK
  nobody uses yet*, a condition L-1 changes). What the losing concurrent caller sees. What happens if the
  process dies **between** campaign creation and the write-back — the exact gap `lib/signals/seed.ts:52-61`
  documents. Whether a reconciliation path exists and, if not, why the atomic guard makes one unnecessary.

- **Q3 — The ADR 0018 `generation_kind` amendment (L-6).** The new value's name; confirmation that the
  CHECK change is additive and needs no backfill; which trigger or writer emits it at promote time (ADR
  0019 §15: *"the existing trigger does the rest, unchanged"* — verify that claim against the shipped
  trigger rather than quoting it); and what ADR 0018's classifier does with a row carrying the new value.
  Then write the amendment in the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form.

- **Q4 — The write-time length bound (L-5).** The bound as a **literal number**, with the arithmetic that
  justifies it — what a realistic `topContent` block costs against the context it competes with at
  `post-generation.ts:179`. Where it is enforced (write time, per `:167-178`). Behaviour on overflow:
  truncate at a boundary, reject the write, or refuse the promote — each has a different failure mode and
  the ADR names the loser. Whether existing `performance_memory.pattern` rows need a backfill or are
  grandfathered, and what that means for the rows already in production.

- **Q5 — The carousel family (L-7, L-8).** Its schema branch: slide count bounds as literal numbers, the
  per-slide shape, whether slides carry roles the way thread tweets do (`hook|body|pull_quote|close`) or a
  different sequence discipline, and the `imageBrief` field's shape and its explicit
  recommendation-only status. Its `platform-map.ts` rows — which platforms may select it and under what
  deterministic Tier-0 rule (thread's content-volume rule is the precedent; say whether carousel gets an
  analogue or a different trigger). Its `policy.ts` rules and how a shape-fail is distinguished from a
  sequence-fail. And the character/length constraints per slide, per platform.

- **Q6 — The script recommendation field, and the deferral of the script family (L-9, D-8).** **This is
  not a schema branch and must not become one.** Decide: the field's shape (hook / beats / CTA as a small
  structured object, or a bounded string — argue it); which format families carry it and which do not; its
  length bounds as literal numbers; and its **recommendation-only, never-published** status, citing
  `imageBrief`'s treatment at ADR 0017 §4/§15 as the precedent being followed rather than inventing a new
  category. **Confirm structurally that it cannot reach `posts.content` or the publishing worker** — that
  confirmation is the constraint, and a length bound is not a substitute for it. State how it renders
  wherever posts are reviewed, and its i18n keys in en/pt/es. **Then record the deferral of the true script
  format family** in the ADR's §15 with its revival condition (a video-capable platform lands, or the
  product decides what a non-publishable artefact is), so the next gap analysis reads it as a decision and
  not as drift. **If you conclude a recommendation field cannot carry the product value, STOP and flag for
  founder adjudication** — do not build an approvable artefact that can never publish.

- **Q7 — Proving Mode 2 unchanged (L-10).** The constraint that makes "existing families are byte-identical
  after F2" **testable**, in `SIGNAL3-RUBRIC-UNCHANGED`'s shape. What the fixture is, what is compared, and
  at which layer (schema output? the assembled prompt? the platform-map's selection?). State explicitly
  which of the three is the real risk — Reality §8 argues it is the platform map — and make the strongest
  assertion there rather than the easiest one everywhere.

- **Q8 — Test plan across the tiers, and the UX contract the Builder is held to.** Map every constraint:
  **Tier 1** (live Postgres) for the promote transition under concurrency, any new column's RLS and
  cascade, `purge_business` coverage, and — per ADR 0021 A-2's precedent — **`assembleBrief` driven end to
  end through promote against real Postgres**, not only a mocked Tier-2 test. **Tier 2** (vitest) for the
  schema branches' structural rejection, the platform map's determinism, the policy validator, the
  write-time bound, the byte-identical proof, and the Server Action's Zod contract. **Tier 3**
  (diff-verified, enumerated **as such** in the ADR so "no test" is a recorded decision). Then **specify —
  do not design — the UX contract**: promote's placement in the Studio surface, every state (draft not
  promotable, promotable, promoting, promoted-and-in-flight, promote failed, already promoted), the
  carousel and script **preview** states in the approvals/calendar surfaces, the accessibility floor, the
  Server Component page + Client interaction split, and the `globals.css` token + both-themes contrast
  requirement from L-11.

Where an F1a answer and this build-guide disagree, **the ADR wins once written** — but F1a must not
silently contradict a §0 Locked decision; if it needs to, it **STOPS and flags for founder adjudication**.

---

## §0.2 — Founder adjudications (2026-08-21)

**Raised by F1a after the seam sweep and the three advisory passes (`database-reviewer`,
`typescript-reviewer`, `security-reviewer` — one batch, read-only, never re-consulted). Adjudicated by the
founder 2026-08-21.** This section is **the Builder's gate**: F1b does not start until ADR 0022 encodes
every row below. Where a ruling went against F1a's original recommendation, that recommendation is
**preserved, not rewritten** (A-4).

| # | Question | Decision | Where encoded |
|---|---|---|---|
| **A-1** | **L-6 mandates the `generation_kind` amendment, but both reviewers independently concluded promote should write NO `post_ai_originals` row** (Reality 14) — and ADR 0019 §2.6's "accepted-suggestion revision" is **not retrievable** from `studio_drafts` (Reality 15). | **Retain the accepted revision in a new column on `studio_drafts`, snapshot THAT** — it is genuinely model-generated, so the row is truthful and the diff measures a real AI→human delta. **The L-6 amendment stands.** Rejected: fabricating a snapshot from human text (corrupts ADR 0018's corpus); skipping the snapshot (discharges L-6 by contradiction). | ADR 0022 §Q1/§Q3 + the ADR 0018 amendment + an **ADR 0019 §2.2 amendment** (new column) |
| **A-2** | Promote needs a `campaigns.origin` value; the CHECK has only `manual`/`objective_generated`/`signal_generated` (`20260722190000:112-118`) and Stage F needed no migration. | **Add `'studio_promoted'`.** A migration against `campaigns` **and** an amendment to **ADR 0017 §3.1**. Rejected: reusing `'manual'` — a lie the learning loop cannot see through. | ADR 0022 §Q1 + ADR 0017 §3.1 amendment |
| **A-3** | `posts.scheduled_at` is `NOT NULL` (`20260430120010:24`), and a defaulted past date means `claim_posts_for_publishing` publishes **within minutes of approval** with no deliberate scheduling. | **The user picks `scheduled_at`, and approve MUST re-touch it.** Promote is therefore **two steps, not one click** — every reference to it as a one-click affordance must say so. | ADR 0022 §Q1/§Q8 (UX contract) |
| **A-4** | **L-10 vs carousel.** `instagram` maps to `'single'` unconditionally (Reality 17); carousel cannot be reachable without changing that arm. | **Carousel is triggered by a NEW required input dimension (`carouselRequested`), sourced from the brief — not by a volume heuristic.** Every call that exists today supplies no such value and resolves **byte-identically**, so **L-10 holds in its strict form** and `platform-map.test.ts:5-12` stays true as written. `selectFormatFamily` gains a third **required** parameter; there is exactly one caller (`generate-native.ts:98`). *F1a's original recommendation was to **reinterpret** L-10 as "inputs still resolving to single/thread are byte-identical" — preserved here; the ruling supersedes it with a fix that needs no reinterpretation.* Rejected: a volume-derived trigger (**changes output for inputs that already exist — the original problem restated**); amending L-10 by fiat; deferring carousel. | ADR 0022 §Q5/§Q7 |
| **A-5** | **Guard-strength drift.** `guardStudioField`'s wider `neutralizeWithSentinels` runs only at **suggest** time; `saveStudioDraftAction` is a bare `z.string()`, so manually-saved content — exactly what promote reads — is never guarded. The memory→generation sink uses the weaker `\p{Cf}`-only `neutralize()` (`wrap-evidence.ts:108-115`). | **Apply `neutralizeWithSentinels` at the writer boundary.** A length bound closes the cost problem and does **not** close this. Recorded as a decision, never an unstated gap. | ADR 0022 §Q4 + the ADR 0018 amendment |
| **A-6** | Promote burns a paid campaign slot at `createCampaign` (`countActiveCampaigns`, `campaigns.ts:157-169`, `status IN ('active','draft')`), and a crash strands an orphan campaign with no reconciliation story. | **Deliberate and accepted**, plus a **staleness window** on the claim column so orphans are reclaimable (`promotion_claimed_at` older than N minutes AND `promoted_campaign_id IS NULL`). Rejected: the stuck-forever case, because unlike Stage F's invisible card a stuck Studio draft is directly in the user's face. | ADR 0022 §Q2 |
| **A-7** | **Two linked problems:** `total_posts_planned` goes permanently off by one for promoted campaigns; and the human's post can be **held hostage** by a brief HARD gate (`< 70`) they never wrote and cannot fix. | **Package A — the post is independent of the brief.** The brief is still assembled, critiqued and gated exactly as ADR 0017 specifies, but it governs **generation**, so its outcome does not block the promoted post's own approval. `activateCampaign`'s caller computes `planned = brief-derived N + count of posts already attached` (byte-identical for every non-promoted campaign, whose count is 0). **Gate count, corrected:** the promoted post passes **two** gates (Studio accept → post approval), matching Mode 2's two; *generated* posts in that campaign pass **three**. Rejected: Package B (couples promote into the brief-approval flow — an L-1 risk — and hides the user's post behind a gate they don't control); Package C (one gate; the Q1 loser L-2 rules out). | ADR 0022 §Q1/§Q7 |
| **A-8** | This guide carried two factual errors into the Architect phase. | **Corrected in place, with the original preserved where it was load-bearing:** Reality 10 (`assembleBrief` has **one** production caller, not two) and the `20260726010000_post_ai_originals.sql` filename, which **does not exist** — it is `20260726010000_learning_capture.sql`. | Reality 10; §0.1 Q3; §1b file list |

**Scope consequence the founder must see: THREE landed ADRs now need amendments, not one.** §1's brief
anticipated only ADR 0018. A-2 adds **ADR 0017 §3.1** (the `origin` CHECK) and A-1/Q2 add **ADR 0019 §2.2**
(new columns, and the supersession of its A-4 refusal of a draft→campaign FK). Both are additive and both
are written in the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form.

**Two items ship as STATED-OPEN, not silently resolved** — ADR 0022 records them as open with the command
that closes them: (1) the live `SELECT count(*) FROM performance_memory WHERE length(pattern) > 500` that
must run **before** Q4's number is fixed (the table is **no longer necessarily empty** — Track C is live via
`promote.ts`/`summarize.ts`), and (2) whether `renderPatternStatement` (`orchestrator.ts:273`) and
`renderTierZeroSummary` (`summarize.ts:47`) interpolate unbounded content — if they do, reject-not-truncate
silently starves `performance_memory` instead of bounding it.

**No new `user_can` capability and no new dependency** is required by any row above.

---

## §1 — Architect session (F1a)  ·  (paste into Claude Code · Opus)  ·  RUN FIRST, ALONE

**Role boundary (constitution).** This session produces **two documents and no code**:
`docs/decisions/0022-promote-to-campaign-and-format-families.md` (Accepted) and the **additive ADR 0018
amendment** appended to `docs/decisions/0018-diff-based-learning-capture.md`. No `.ts`, no `.sql`, no
`.tsx`. Any code attempted here is discarded. The last action is a single confirmation line, then `/exit`.

**ECC budget for this phase — four subagent invocations, total.** One `ecc:code-explorer` grounding sweep
over the closed file list, then **exactly three** advisory reviewers dispatched **once, in a single
parallel batch**, after the draft answers exist. No iterative re-consultation. Skills are free and do not
count against the budget: `ecc:architecture-decision-records` for structure, and `claude-mem`'s
`mem-search` — **prefer one `mem-search` over re-reading a closed session's build guide.**

**On `impeccable` and `taste-skill` — this session, deliberately, differs from Session 28.** Session 28's
Architect was told *"DO NOT invoke impeccable or taste-skill"* because a dedicated design session followed
its track. Track F has no such follow-on: promote is a **small** addition to a surface that already exists,
and carousel/script previews are **renderings of a schema this ADR defines**. So:

- **The Architect may run `impeccable` ONCE, read-only, in audit mode**, over the existing Studio surfaces
  (`app/[locale]/(dashboard)/studio/**`) and the two shipped inbox precedents (`approvals/`,
  `opportunities/OpportunityFeed.tsx`), for the sole purpose of grounding Q8's UX contract in what is
  actually shipped. It **specifies**; it does not design, and it writes no `.tsx`. This counts as a fifth
  invocation and is the only one permitted beyond the four.
- **`taste-skill` is NOT invoked in the Architect phase.** It is a build-time skill and belongs to §2,
  where the promote affordance and the carousel/script previews are actually built.

### §1a — Architect primer  (paste first · wait for acknowledgement)

```
Session 29 — Closing the Mode 1 / Mode 2 deferrals: promote-to-campaign + carousel & script format
families. ARCHITECT phase (Track F). You produce FOUR artefacts and NO code:
  (a) docs/decisions/0022-promote-to-campaign-and-format-families.md (status: Accepted)
  (b) an additive amendment appended to docs/decisions/0018-diff-based-learning-capture.md — the
      generation_kind value promote needs (L-6), AND the write-time length bound on
      performance_memory.pattern, AND A-5's neutralizeWithSentinels guard at that writer. All three
      concern objects ADR 0018 OWNS (its CHECK, its column, its writer, its RPC), so they belong in
      its amendment and are CITED from 0022, never duplicated there.
  (c) an additive amendment to docs/decisions/0017-mode-2-upgrade.md §3.1 — the 'studio_promoted'
      origin value (§0.2 A-2).
  (d) an additive amendment to docs/decisions/0019-mode-1-studio.md §2.2 — the new studio_drafts
      columns, AND an explicit, in-words supersession of its A-4 refusal of a draft→campaign FK,
      citing it rather than acting as though it never existed (§0.2 A-1, Q2).
Count corrected 2026-08-21: §0.2 found that A-1 and A-2 pull two further landed ADRs into scope. All
four are additive and written in the ADR 0014 Amendment A / ADR 0010 Amendment 2 house form.
No .ts, no .sql, no .tsx. If you catch yourself writing a migration, a zod schema body, a prompt template
or a component, stop: that is the Builder's job (F1b), and the constitution requires Architect-attempted
code to be discarded.

PREREQUISITES — verify before anything else, in this order.
1. Sessions 23-28 are merged to master and all three workflows ran green there (Step 0 of
   docs/build-guide/session-29.md). If master is still at 462e49eb, STOP and say so.
2. docs/decisions/0017-mode-2-upgrade.md, 0018-diff-based-learning-capture.md and 0019-mode-1-studio.md
   exist and are Accepted. You are amending 0018 and building the follow-on 0019 named in its own §15.
   If any is missing, STOP — do not invent the contract.

ECC BUDGET — FOUR subagent invocations for this whole phase, plus ONE optional impeccable audit. Stay
inside it.
1. FIRST, run ecc:code-explorer ONCE over the closed file list below. Ask it for file:line citations and
   the shape of each seam — nothing else.
2. Use the ecc:architecture-decision-records skill for structure so 0022 matches 0016-0021, and follow the
   ADR 0014 Amendment A / ADR 0010 Amendment 2 form for the 0018 amendment. (Skills — free.) Use
   claude-mem's mem-search for prior-session context; cheaper than re-reading a closed build guide.
3. You MAY run `impeccable` ONCE, READ-ONLY, in audit mode over app/[locale]/(dashboard)/studio/**,
   app/[locale]/(dashboard)/approvals/** and app/[locale]/(dashboard)/opportunities/OpportunityFeed.tsx —
   ONLY to ground Q8's UX contract in the shipped surfaces. You SPECIFY the contract; you do not design it
   and you write no .tsx. DO NOT invoke taste-skill — that is a build-time skill and belongs to the
   Builder phase.
4. AFTER you have draft answers to the eight Q's, dispatch EXACTLY THREE advisory reviewers ONCE, in a
   SINGLE PARALLEL BATCH, all read-only, all writing NO code:
   - database-reviewer — on Q1/Q2: the promote migration, the ATOMIC promote transition under concurrency
     (two users, same draft, same moment), what guards it and on which column, the crash-between-
     createCampaign-and-write-back gap that lib/signals/seed.ts:52-61 documents for the Stage F precedent,
     and the full RLS / §D2.5-cascade / purge_business obligation for anything new. Ask explicitly whether
     ADR 0019 §4's refusal of a nullable campaign_id on studio_drafts still binds now that promote exists.
   - typescript-reviewer — on Q5/Q6/Q7 ONLY: extending a z.discriminatedUnion with ONE new branch
     (carousel) without weakening the existing two; whether the per-family Prompt factory generalizes to
     three families or starts to leak; whether the platform-map stays deterministic and total; how to make
     "existing families byte-identical" a real assertion rather than a snapshot that rots; and — for Q6 —
     whether the script recommendation field can be typed so that reaching posts.content is a COMPILE
     error rather than a runtime check. Ask for the failure mode, not the principle.
   - security-reviewer — on Q4 and the promote path: promoted human-authored content reaching
     posts.content -> ADR 0018's classifier -> performance_memory.pattern -> back into generation as
     topContent at post-generation.ts:179, a path whose own comment concedes it has NO length cap. This is
     SAME-TENANT self-poisoning and a cost/context-exhaustion issue, not a cross-tenant breach — ask for
     the honest severity, and ask whether the write-time bound belongs at the classifier, the promoter, or
     the memory writer.
   Fold their objections in, or record why you rejected them, and DO NOT re-consult them. One batch.

Read now, before anything else:
- docs/build-guide/session-29.md — the Reality block, §0 (Locked L-1..L-12 + the D-1..D-8 ledger) and §0.1
  (the eight questions Q1..Q8 you MUST resolve). This is your binding input.
- docs/decisions/0019-mode-1-studio.md — ALL of it, and §15 item 1 VERBATIM ("Promote-to-campaign (L-3) —
  the immediate follow-on"), plus §15 item 10 (the topContent write-time bound), §4 (why studio_drafts has
  no campaign_id and no status enum), §2.6 and A-3 (the deferred generation_kind amendment, and the exact
  reason it was deferred).
- docs/decisions/0021-mode-3-triage-and-opportunity-feed.md §6 (Stage F) and lib/signals/seed.ts — the
  seeding precedent you are being asked to mirror, INCLUDING its own comment at :52-61 about
  non-idempotency. Note ADR 0021 D-7's named loser and A-2's Tier-1 live-Postgres condition.
- docs/decisions/0017-mode-2-upgrade.md — §4 (format families, the discriminated union, the per-family
  Prompt factory, D-3's "runner stays ignorant" ruling), the platform->family map table, §15 (D-6 defers
  carousel/script; L-11 defers the skip-review fast path — that one stays deferred), and Amendment A.
- docs/decisions/0018-diff-based-learning-capture.md — the generation_kind CHECK you are amending, the
  classifier, and the promotion gates into performance_memory.
- docs/decisions/0015-test-execution-and-ci-gates.md §2 (the three tiers you tier constraints against) and
  §5 (the merge gates). You are NOT amending 0015 in this session.
- CLAUDE.md — the AI-layer / DB-access / three-client / RLS + erasure-cascade / atomic-transition / Zod /
  i18n / bounded-query rules, "we don't auto-publish without user approval", "we don't generate images at
  launch", the UI Component patterns section (shadcn v4 is Base UI: NO asChild on Button or DropdownMenu
  primitives), and the test-execution-integrity section (the three tiers and SHARED-FUNCTION CALLERS).

The CLOSED file list for the ONE ecc:code-explorer sweep — map these, cite file:line, nothing beyond:
- lib/signals/seed.ts (the full seeding contract, composeObjective, the write-back guard) and
  lib/db/insight-cards.ts:setCardCampaignId (the .is('campaign_id', null) atomic pattern).
- lib/campaigns/brief.ts (assembleBrief, critiqueBrief, approveBriefIfQualified) — REPORT EVERY CALLER of
  assembleBrief that exists today. SHARED-FUNCTION CALLERS depends on this being complete, not
  approximately right.
- lib/db/campaigns.ts:createCampaign + supabase/migrations/20260722190000_mode2_brief_and_roles.sql —
  REPORT campaigns.origin's ACTUAL enum values. If promote needs a new one, the migration lands here.
- app/[locale]/(dashboard)/studio/actions.ts + studio/page.tsx + studio/[draftId]/page.tsx + lib/studio/*
  — what a Studio draft holds at the moment a human finishes reviewing it, and which fields promote can
  actually read.
- The studio_drafts migration — its exact columns, constraints and RLS policy.
- lib/ai/prompts/formats/schemas.ts, platform-map.ts, policy.ts, native-generation-prompt.ts — the four
  seams F2 extends. Report the discriminated union's exact shape, the map's totality, and how policy
  distinguishes shape-fail from sequence-fail.
- lib/ai/prompts/post-generation.ts:160-190 — the topContent render path and the comment at :167-178 that
  concedes the missing length cap. Quote it.
- lib/db/memory-performance.ts (or wherever performance_memory.pattern is written) — the write site Q4's
  bound attaches to.
- supabase/migrations/20260726010000_learning_capture.sql:34 — the generation_kind CHECK you are amending.
- app/[locale]/(dashboard)/approvals/** and opportunities/OpportunityFeed.tsx — the shipped inbox
  precedents, including OpportunityFeed's globals.css status-band tokens and its both-themes contrast
  assertion (Session 28-D D5). That is the design floor Q8 inherits.

Do NOT write either document yet. First OUTPUT your answers to the eight §0.1 questions (Q1 what promote
produces, Q2 atomicity/idempotency/failure, Q3 the generation_kind amendment, Q4 the write-time bound, Q5
carousel, Q6 the script RECOMMENDATION FIELD and the deferral of the script family, Q7 proving Mode 2
unchanged, Q8 the test plan + the UX contract), EACH with its named loser and its ADR 0015 tier, AND a
one-line note on any place a §0 Locked decision constrains the answer. Flag explicitly if any answer needs:
a founder ruling (Q6's STOP — "a recommendation field cannot carry script's value" — is the likeliest),
a new user_can capability, a new dependency, a change to Mode 2's generation behaviour, or any
change to a Session 27/28 artefact — those are founder adjudications, not your call. Then STOP for
acknowledgement.
```

### §1b — Architect prompt  (paste after the eight answers are acknowledged)

```
ARCHITECT — Session 29. Write BOTH documents. Ground every claim in the real repo (cite file:line from the
ecc:code-explorer sweep). You have already dispatched your ONE batch of three advisory reviewers — fold
their objections in now, or record why you rejected them. Do not re-consult them.

=== DOCUMENT A: docs/decisions/0022-promote-to-campaign-and-format-families.md (Accepted) ===

1. Context + decision summary: what ADR 0019 shipped (a reviewed Studio draft) and what is missing
   (nothing consumes it — the draft dead-ends); what ADR 0017 shipped (single-post + thread) and what is
   missing (two families its own D-6 deferred). State plainly that BOTH gaps were deliberate deferrals with
   named revival conditions, quote each condition, and state whether it is now met — carousel's is (the
   locked launch-platform list includes Instagram), script's is a founder ruling (§0 L-9). Name the losers
   per §0 D-1..D-8. State explicitly that the third gap (a second signal source) is ADR 0023's, not this
   ADR's, and why they were split.

2. Promote-to-campaign (Q1, L-2, L-3) — the load-bearing section. The exact function and signature, its
   input from studio_drafts, its output, the campaigns.origin value with its migration if the enum lacks
   it, and whether composeObjective is reused/generalized/duplicated. Reconcile ADR 0019 §15's "INSERT into
   posts" against ADR 0021 §6's "seed a brief" EXPLICITLY — quote both, pick one, name the loser. Confirm
   critiqueBrief and approveBriefIfQualified's HARD gate still run, and state the GATE COUNT for a promoted
   campaign plainly, the way ADR 0021 §6 did for signal-originated ones. SHARED-FUNCTION CALLERS table for
   assembleBrief: one row per caller (Mode 2, Stage F, promote), the test that covers it, and confirmation
   that no existing caller's behaviour changes.

3. Atomicity and failure modes (Q2, L-4, D-3): the conditional WHERE guard and the column it guards on
   (argue whether ADR 0019 §4's refusal of a nullable campaign_id still binds now that a consumer exists);
   what the losing concurrent promoter sees; the crash-between-createCampaign-and-write-back gap that
   lib/signals/seed.ts:52-61 documents, and whether your design closes it or inherits it. Fold in
   database-reviewer's findings.

4. The ADR 0018 generation_kind path (Q3, L-6): the new value, confirmation the CHECK change is additive
   and needs no backfill, which writer or trigger emits it at promote time (VERIFY ADR 0019 §15's claim
   that "the existing trigger does the rest, unchanged" against the shipped trigger — do not quote it as
   fact), and what the classifier does with it.

5. The write-time length bound (Q4, L-5, D-4): the bound as a LITERAL NUMBER with its arithmetic; where it
   is enforced; behaviour on overflow with the loser named; and what happens to rows already in production.
   Fold in security-reviewer's severity assessment — state honestly that this is same-tenant self-poisoning
   and context cost, not a cross-tenant breach.

6. Carousel (Q5, L-7, L-8, D-7): the union branch, slide-count and per-slide bounds as literal numbers, the
   sequence discipline, the imageBrief field as RECOMMENDATION ONLY with the constitution's no-images rule
   cited, the platform-map rows and the deterministic Tier-0 rule that selects it, and the policy rules
   with shape-fail vs sequence-fail distinguished.

7. Script (Q6, L-9, D-8) — a RECOMMENDATION FIELD, not a union branch. Its shape, which families carry it,
   its literal bounds, and its recommendation-only/never-published status with imageBrief's ADR 0017
   §4/§15 treatment cited as the precedent. The STRUCTURAL confirmation that it cannot reach posts.content
   or the publishing worker — that confirmation is the constraint; a length bound is not a substitute.
   Then record the deferral of the true script FORMAT FAMILY in §15 with its revival condition (a
   video-capable platform lands, or the product decides what a non-publishable artefact is). Explain, in
   two sentences, why D-6's "one new union branch each" pricing held for carousel and did not hold for
   script — a future reader must be able to see this was a costing correction, not a change of appetite.
   If you concluded the field cannot carry the value, STOP and flag instead of writing this section.

8. Mode 2 unchanged (Q7, L-10): the constraint that makes "existing families byte-identical" testable, in
   SIGNAL3-RUBRIC-UNCHANGED's shape — the fixture, what is compared, at which layer, and why that layer is
   the real risk surface. Fold in typescript-reviewer's findings on whether the union and the Prompt
   factory actually generalize to four families.

9. GDPR + tenancy (L-11): RLS in the InitPlan-wrapped form with USING and WITH CHECK on UPDATE, ON DELETE
   CASCADE, and either the ADR 0010 Amd 2 §D2.5 cascade row VERBATIM or the explicit statement that this is
   a column on an already-covered table and needs none (the Session 28-D D7 / insight_cards.campaign_id
   precedent) — say WHICH case applies and why. purge_business coverage either way.

10. The UX contract the Builder is held to — you SPECIFY it, you do not design it. Promote's placement in
    the Studio surface and every state (not promotable, promotable, promoting, promoted-and-in-flight,
    promote failed, already promoted); the carousel and script PREVIEW states wherever posts are reviewed;
    the accessibility floor; Server Component page + Client interaction split; Zod on every Server Action;
    shadcn v4 / Base UI with NO asChild on Button or DropdownMenu primitives; Tailwind only; i18n en/pt/es
    simultaneously; and new status colour on globals.css tokens with a both-themes contrast assertion
    reading the shipped token file (the OpportunityFeed precedent, Session 28-D D5) — never ad-hoc colour
    classes. Note that the Builder invokes taste-skill and impeccable against THIS contract.

11. Test plan across the tiers (Q8): Tier 1 (live Postgres) for the promote transition under concurrency,
    new-column RLS/cascade/purge_business, and assembleBrief driven END TO END through promote against real
    Postgres per ADR 0021 A-2's precedent — not only a mocked Tier-2 test; Tier 2 (vitest) for the schema
    branches' structural rejection, the platform map's determinism, the policy validator, the write-time
    bound, the byte-identical proof and the Server Action's Zod contract; Tier 3 enumerated AS SUCH. Name
    the fixture directories. State what is honestly untestable and why.

12. A constraint table: every named constraint, its test tier, and the test that will prove it — the
    Reviewer's checklist. Cover at least: PROMOTE-ATOMIC, PROMOTE-SEEDS-BRIEF-UNCHANGED (or its Q1
    equivalent), PROMOTE-GATES-INTACT, PROMOTE-NEVER-AUTOPUBLISHES, PROMOTE-ORIGIN-RECORDED,
    PROMOTE-TOPCONTENT-BOUNDED, PROMOTE-CALLERS-ENUMERATED, MODE2-CAROUSEL-STRUCTURAL,
    MODE2-CAROUSEL-NO-IMAGE-GEN, MODE2-SCRIPT-RECOMMENDATION-ONLY, MODE2-SCRIPT-NEVER-PUBLISHED,
    MODE2-PLATFORM-MAP-TOTAL, MODE2-EXISTING-FAMILIES-UNCHANGED, and MODE2-RUNNER-UNTOUCHED.

13. Explicit "deferred" section with revival conditions, so the next gap analysis does not re-flag closed
    ground as drift: THE SCRIPT FORMAT FAMILY (L-9 — a video-capable platform lands, or the product
    decides what a non-publishable artefact is; the recommendation field shipped, the family did not);
    image generation and the media editor (Phase 2); relationship_memory (ADR 0016 —
    needs the engagement inbox); the skip-review fast path (ADR 0017 L-11 — still deferred, still an L-1
    STOP); the second signal source and the Stage B embeddings question (ADR 0023 / Session 30); and
    whatever Q1-Q8 pushed to a follow-on.

=== DOCUMENT B: the additive ADR 0018 amendment ===

Append to docs/decisions/0018-diff-based-learning-capture.md in the ADR 0014 Amendment A / ADR 0010
Amendment 2 house form. It must contain: why it exists now (ADR 0019 A-3 deferred it for want of a caller;
Track F is that caller — quote A-3); the new generation_kind value and the additive CHECK change; the
confirmation that no backfill is required and that existing rows are unaffected; which writer emits it;
what the classifier does with it; and an explicit statement that no existing ADR 0018 constraint is
re-tiered or weakened by this amendment.

Do NOT write code. End with one line: "ADR 0022 written and accepted — <n> constraints, promote produces
<brief|post>, origin <value>, topContent bound <n> chars, carousel <min>..<max> slides, script ships as a
recommendation field (family deferred, condition <condition>), ADR 0018 amendment adds generation_kind
'<value>'." Then /exit.
```

**Gate:** do not author §2 until **both** documents exist, ADR 0022 is Accepted, the ADR 0018 amendment is
appended, and the eight §0.1 answers are on the record. **If any answer required founder adjudication, that
adjudication is recorded as the `§0.2 — Founder adjudications` block above before the Builder starts** —
exactly as Sessions 22–28 did. Then author **§2 and §3** below from the accepted ADR's real constraint
names. **§4 stays a placeholder** until the Reviewer has run and its findings document exists.

---

## §2 — Builder session (F1b)  ·  (paste into Claude Code · Sonnet)

> **PLACEHOLDER — authored after ADR 0022 is Accepted and the ADR 0018 amendment is appended.**
>
> Do not write this section speculatively. When both documents are accepted, this section is filled in as:
>
> - **§2a — Builder primer** (paste first, wait for acknowledgement): role; the ECC budget for the Builder
>   phase; the binding §0 Locked list and the §0.2 adjudications; the ADR's constraint table as the
>   definition of done; the verification loop (`npx tsc --noEmit --skipLibCheck`, `npm run test:app`,
>   `npm run test:db`); and the commit discipline.
> - **§2b — Builder steps** `F1b.0 … F1b.n`, one paste each, each a self-contained
>   `/ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop` cycle, each ending green and committed.
> - **Ordering:** **Track F1 first, then Track F2.** F1 is smaller, has an exact shipped precedent
>   (`lib/signals/seed.ts`), and touches no shared generation code. F2 edits a discriminated union every
>   Mode 2 call flows through, so it lands second, on a green tree. **Do not interleave them.**
> - **Design skills belong HERE, not in §1.** The step that builds the promote affordance and the steps
>   that build the carousel/script previews invoke **`taste-skill`** for the build and **`impeccable`** for
>   the review pass, both against the ADR's §10 UX contract — not against their own taste. They may not
>   introduce a colour outside `globals.css` tokens (L-11), and any new status band ships with a
>   both-themes contrast assertion reading the shipped token file.
> - Each step names **the ADR constraints it closes** and **the test that proves each**, per ADR 0015's
>   "covered = executed green in CI" rule. A step that closes no constraint should not exist.
> - **Two scope tripwires specific to this session**, to be written as executable scans rather than review
>   comments: any diff touching `lib/ai/runner.ts` breaks `MODE2-RUNNER-UNTOUCHED` (L-7), and any image
>   generation call anywhere breaks `MODE2-CAROUSEL-NO-IMAGE-GEN` (L-8).
> - **One step is already fixed by ADR 0022 §17 and must appear in `F1b.*`.** The three §16 stated-open
>   items were closed on 2026-08-21 by reading the code at `dd748435` (evidence and per-item consequences:
>   ADR 0022 §17). Items 1 and 2 add **no** Builder work — both `performance_memory.pattern` writers are
>   structurally bounded (≈80 chars and a Zod `.max(200)`), so the 500 CHECK can never fire from a
>   legitimate Track C write and the migration is written `NOT VALID` + `VALIDATE` in one step regardless
>   of the count query, which is recorded as confirmation only. Item 3 adds exactly one small step:
>   `lib/learning/summarize.ts:146`'s statement loop has **no per-statement `try/catch`**, so a single
>   rejected statement silently drops the rest of that business's batch and reports as a generic
>   `summarizeFailed`. The step wraps that upsert in log-and-skip per §5.3 and adds a `summarizeRejected`
>   counter to `LearningTickSummary` (`orchestrator.ts:44-58`). **It is latent, not a live bug** — nothing
>   can currently produce a >200-char statement — and must not be written up as one. The same step corrects
>   the two stale *"no production caller yet"* comments at `lib/ai/prompts/learning-summarizer.ts:41` and
>   `lib/db/memory-performance.ts:51-52` (`orchestrator.ts:270` **is** that caller), **leaving their guard
>   posture exactly as it stands** — only the premise is stale, the conclusion is not.
> - **Two binding rules from ADR 0022 §18, which corrects §9 and §6.3.** (a) **`MEM-PATTERN-BOUNDED` is
>   Tier-1 ONLY.** Both production callers of `upsertDistilledPerformancePattern` mock it
>   (`promote.test.ts:16-18`, `summarize.test.ts:23-25`, and `orchestrator.test.ts:71-72` mocks
>   `recomputeAndUpsertPattern`), and `memory-performance.test.ts:168` runs the real body against a
>   **stubbed** client — a stub cannot fire a Postgres CHECK. The bound is proved in `supabase/__tests__/`
>   against live Postgres or it is not proved. A Tier-2 test may prove the promoter-level Zod bound, but
>   must be labelled as that and never as proof of the CHECK. (b) **The `platform-map.test.ts` diff in the
>   carousel commit changes call ARITY only.** The file has **ten** two-argument `selectFormatFamily` call
>   sites; a required third parameter breaks all ten, so the file cannot stay untouched (ADR 0022 §6.3 said
>   it could — §18.3 corrects that). Each call gains a third argument `false` and **nothing else changes**:
>   no `expect(...).toBe(...)` right-hand side, no `it.each` list, no description string. The PR shows that
>   diff and states it contains zero changed expectations. One altered expectation there is an L-10
>   violation.

**✅ AUTHORED 2026-08-22 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Gate satisfied: ADR 0022 is Accepted (`dd748435`), its
§§17-19 closure and correction record is appended (`5e9ed904`), the three amendments are appended
(`dd748435`, `c56332b0`), and §0.2 exists with eight adjudications.

**Ordering rationale, restated because it is binding.** **Track F1 (`F1b.0`-`F1b.5`) lands in full before
Track F2 (`F1b.6`-`F1b.11`) begins.** F1 is smaller, has an exact shipped precedent (`lib/signals/seed.ts`),
and touches no shared generation code. F2 edits a `z.discriminatedUnion` that every Mode 2 call flows
through. **Do not interleave them.** Inside F2, the exhaustiveness precondition (`F1b.6`) lands **before**
the carousel branch (`F1b.7`) — ADR 0022 §6.5 makes it a precondition, not a cleanup, and adding the branch
first means shipping `generate-native.ts:110`'s silent misroute for the length of one commit.

**Definition of done for every step:** `npx tsc --noEmit --skipLibCheck` clean, `npm run test:app` green,
`npm run test:db` green where the step touches DB behaviour, each named constraint **demonstrated to redden
against the pre-fix code and then reverted**, and one commit per step.

### §2a — Builder primer  (paste first · wait for acknowledgement)

```
Session 29 Track F — BUILDER phase (F1b). You implement ADR 0022 and its three amendments. You write code;
you do NOT make architectural decisions. Every decision you need has already been made and carries a named
loser. If you find yourself choosing between two designs, STOP and report — that is an ADR gap, not your
call.

READ FIRST, in this order:
- docs/decisions/0022-promote-to-campaign-and-format-families.md — ALL of it, including §§17-19, which are
  additive and CORRECT §6.3, §9 and §16. Where §17/§18 correct an earlier section, THE CORRECTION WINS and
  the original text is left standing deliberately so you can see what changed.
- The three amendments: ADR 0018 Amendment A (incl. A.4), ADR 0017 Amendment B, ADR 0019 Amendment A.
- docs/build-guide/session-29.md — Reality 1-19, §0 (Locked L-1..L-12), §0.2 (the eight adjudications).
  §0.2 IS YOUR GATE. Every row must end up encoded.
- CLAUDE.md — the AI-layer / DB-access / three-client / RLS + erasure-cascade / atomic-transition / Zod /
  i18n / bounded-query rules, and the test-execution-integrity section.

BINDING RULES YOU WILL BE REVIEWED AGAINST:
1. ORDER. F1b.0 through F1b.5 (Track F1) complete and green BEFORE F1b.6 begins. No interleaving.
2. lib/ai/runner.ts is NOT modified. No third prompt.id branch in the runner. If you are editing runner.ts,
   you have taken ADR 0017 D-3's losing option — stop.
3. posts is NOT modified — no column, constraint, index, policy, trigger, RPC, or PostUpdate field.
4. MEM-PATTERN-BOUNDED is TIER-1 ONLY (ADR 0022 §18.1). Both production callers of
   upsertDistilledPerformancePattern MOCK it, and memory-performance.test.ts:168 runs the real body against
   a STUBBED client — a stub cannot fire a Postgres CHECK. Prove the CHECK in supabase/__tests__/ against
   live Postgres or it is not proved. A Tier-2 test may prove the promoter-level Zod bound; label it as
   that, never as proof of the CHECK.
5. The platform-map.test.ts diff in F1b.7 changes call ARITY ONLY (ADR 0022 §18.3). Ten two-argument
   selectFormatFamily call sites each gain a third argument `false`. NOTHING else changes: no
   expect(...).toBe(...) right-hand side, no it.each list, no description string. One altered expectation
   is an L-10 violation.
6. Every list query bounded + explicit ORDER BY matching an index. Zod on every Server Action input. Atomic
   conditional UPDATEs, never read-then-update. date-fns (toUtcIso()), never raw .toISOString(). No `any`.
   No console.* on a user-facing surface. env only via lib/config.ts. i18n en/pt/es landed together and
   registered in i18n/request.ts.
7. shadcn v4 is Base UI: NO asChild on Button or DropdownMenu primitives. Use buttonVariants() for a link
   styled as a button.
8. SHARED-FUNCTION CALLERS: before you mark any constraint on a shared function as tested, git grep its
   callers and state, per caller, which test file exercises it. A caller with no listed test is
   AUTHORED-NOT-EXECUTED even if another caller is fully covered. Both Session 22 blockers were this.

ECC BUDGET FOR THIS PHASE: per step, /ecc:plan then /ecc:tdd-workflow then /ecc:verification-loop. Skills
are free. Design skills belong to F1b.5 and F1b.9 ONLY: taste-skill for the build, impeccable for the
review pass, BOTH against ADR 0022 §10's UX contract — not against their own taste. You may dispatch
database-reviewer before committing F1b.1/F1b.2 and security-reviewer before committing F1b.4. Do not
dispatch a reviewer per step.

VERIFICATION, every step: npx tsc --noEmit --skipLibCheck ; npm run test:app ; npm run test:db (where the
step touches DB behaviour). Each named constraint must be DEMONSTRATED TO REDDEN against the pre-fix code
and then reverted — an assertion that cannot fail is not coverage. One commit per step, subject naming the
step id and the constraints it closes.

Acknowledge with a one-line confirmation that you have read ADR 0022 INCLUDING §§17-19 and understand that
§17/§18 correct §6.3, §9 and §16. Then STOP and wait for the step list.
```

### §2b — Builder steps

Each step is one paste, one commit. **A step that closes no ADR constraint should not exist.**

| Step | What it ships | Constraints closed | Tier |
|---|---|---|---|
| **F1b.0** | **Grounding pass, no code.** Re-verify Reality 1-19 against the live repo and report any drift *before* writing anything (Session 26's C2.0 precedent). Run the §17 confirmation query `SELECT count(*) FROM performance_memory WHERE length(pattern) > 500;` and record the result **as confirmation, not as a decision input** — §17 closed item 1 by arithmetic, and the migration is written `NOT VALID` + `VALIDATE` regardless. Re-run `git grep assembleBrief` and publish the caller table. | — | — |
| **F1b.1** | **Promote schema.** `campaigns.origin` gains `'studio_promoted'` (ADR 0017 Amd B). `studio_drafts` gains `promotion_claimed_at`, `promoted_campaign_id` and the retained-revision column (ADR 0019 Amd A.1). Both `NOT VALID` + `VALIDATE`, backfill stated as none. **No new §D2.5 row** — state which case applies and why (ADR 0022 §12.2). | `PROMOTE-RLS-ISOLATED`, `PROMOTE-CASCADE-COMPLETE` | 1 |
| **F1b.2** | **Learning schema.** `generation_kind` gains `'studio_promoted'` (ADR 0018 Amd A.1). `performance_memory.pattern` gains the **500-char CHECK** (Amd A.2). **Keep 500 — do not reduce it to 200** (§17's corollary: with writers capped at 200 and ≈80 the CHECK can never fire from a legitimate Track C write, and that is the intended defence-in-depth property). | `LEARN-GENERATION-KIND-WIDENED`, **`MEM-PATTERN-BOUNDED`** (Tier-1 only, rule 4) | 1 |
| **F1b.3** | **The claim, the write-back, the cleanup.** `lib/db/studio-drafts.ts` gains the atomic claim (guarded `promotion_claimed_at IS NULL`, with the staleness window from a named `lib/config.ts` constant), the guarded write-back, and **`clearPromotedCampaignReferenceOnDrafts`** wired from `softDeleteCampaignGuarded`'s call sites. The claim returns a **typed** result; the write-back returns void (ADR 0022 §3.3). | `PROMOTE-CLAIM-ATOMIC`, `PROMOTE-WRITEBACK-GUARDED`, `PROMOTE-CLAIM-RECLAIMABLE`, `PROMOTE-SOFTDELETE-CLEARED` | 1 |
| **F1b.4** | **`promoteDraftToCampaign`.** The Server Action in ADR 0022 §2.1's exact six-step order. Composes into `objective` (no `BriefAssemblyInput` change), applies the `z.string().min(1).max(5000)` copy bound (§5.1), inserts the post with a **user-chosen** `scheduled_at` (A-3), writes the snapshot **only when the retained revision is non-NULL** (Amd A.1's binding corollary), then calls `assembleBrief` unchanged. Also: `activateCampaign`'s caller computes `planned = brief-derived N + existing post count` (§2.7). | `PROMOTE-ACTION-VALIDATED`, `PROMOTE-BRIEF-END-TO-END`, `ACTIVATE-PLANNED-UNCHANGED` | 1 + 2 |
| **F1b.5** | **The Studio promote surface.** Server Component page + Client interaction; the **two-step** scheduled_at flow (A-3 — never a one-click affordance); all **seven** §10 states incl. `already promoted` rendering that draft's real state and `reclaimable`. New status colour on `globals.css` tokens with a **both-themes contrast assertion reading the shipped token file** (`OpportunityFeed.test.tsx:439` mechanism). i18n en/pt/es. `taste-skill` + `impeccable` against §10. | `PROMOTE-STATES-RENDERED`, `PROMOTE-CONTRAST-AA`, `PROMOTE-I18N-COMPLETE` | 2 |
| **F1b.6** | **The exhaustiveness precondition — Track F2 opens here, and this lands BEFORE carousel.** Convert all three bare-`FormatFamily` ternaries to `switch` + `assertNever`: `lib/ai/generate-native.ts:110`, `native-generation-prompt.ts:36-52`, `native-generation-prompt.ts:138`. **No new family in this commit** — it must be green with `FormatFamily` still `'single' \| 'thread'`. Leave `generate.ts:48`/`:55` alone; ADR 0022 §6.5 records them as already safe. | — (enables `CAROUSEL-*`) | 2 |
| **F1b.7** | **The carousel branch.** Third union branch, slides `3..10`, `role: 'cover' \| 'body' \| 'cta'`, per-slide `imageBrief`, no `order` field. `validateCarouselPolicy` in `policy.ts` throwing `AiError('policy_violation')`. `selectFormatFamily` gains the **required third parameter**; `platform-map.test.ts`'s ten call sites gain `false` and **nothing else** (rule 5). The `Record<Platform, …>`-typed frozen table lands here. | `CAROUSEL-SCHEMA-STRUCTURAL`, `CAROUSEL-POLICY-SEQUENCE`, **`MODE2-FORMAT-SELECTION-UNCHANGED`**, `MODE2-PROMPT-BYTE-IDENTICAL` | 2 |
| **F1b.8** | **`scriptBrief`.** `string \| null` on `imageBrief`'s exact footing, per-branch, literal length bound. **Not a structured object** (§7.1's loser). Plus the Tier-3 source scan with a **per-root vacuity guard**. i18n en/pt/es. | `SCRIPT-BRIEF-BOUNDED`, `SCRIPT-NEVER-PUBLISHED` | 2 + 3 |
| **F1b.9** | **Carousel and script previews** in the approvals surface: slides in order with roles visible; `imageBrief` and `scriptBrief` rendered as recommendations **explicitly marked never-published**. `taste-skill` + `impeccable` against §10. | (renders `SCRIPT-NEVER-PUBLISHED`'s affordance) | 2 |
| **F1b.10** | **The §17 learning-loop fix and the stale comments.** Wrap `lib/learning/summarize.ts:146`'s upsert in per-statement `try/catch` (log-and-skip) and add **`summarizeRejected`** to `LearningTickSummary` (`orchestrator.ts:44-58`, initialised `:319-334`). **Write it up as latent, not as a live bug** — nothing can currently produce a >200-char statement. Correct the two stale *"no production caller yet"* clauses (`learning-summarizer.ts:41`, `memory-performance.ts:51-52`) — `orchestrator.ts:270` **is** that caller — and **leave their guard posture exactly as it stands** (§17.1: only the premise is stale, the conclusion is not). | (closes §16 item 3's remainder) | 2 |
| **F1b.11** | **The scope scans and the verification pass.** Four executable scans, each with a per-root vacuity guard and each demonstrated to redden against a temporary violation then reverted: `MODE2-RUNNER-UNTOUCHED`, `MODE2-CAROUSEL-NO-IMAGE-GEN`, `POSTS-DDL-UNMODIFIED`, `MODE3-UNTOUCHED`. Then: every ADR 0022 constraint mapped to its executing CI job with *reddens-if-broken* stated per row; **`SHARED-FUNCTION CALLERS` re-grepped and the §9 table extended if a caller appeared**; the Tier-3 five enumerated **as decisions**. Push and cite real run URLs. | `RUNNER-UNMODIFIED`, `MODE3-UNTOUCHED`, `POSTS-DDL-UNMODIFIED`, `NO-SKIP-REVIEW-PATH` | 3 |

**Two scope tripwires, executable rather than advisory.** `MODE2-RUNNER-UNTOUCHED` fails if any diff touches
`lib/ai/runner.ts` (L-7). `MODE2-CAROUSEL-NO-IMAGE-GEN` fails on any image-generation call anywhere (L-8).
Both are scans in `F1b.11`, not review comments — a scope rule that lives as prose is not enforced.

**Do not claim a constraint count until it is executed green in CI at the head it is dated to.** Session 28
shipped a false *"29/29 executed green"* that took three correction steps to undo.

The twelve pastes follow, one per step, in the Sessions 26-28 form.

#### F1b.0 — Grounding pass: re-verify every ADR premise against the live repo  ·  no code, no commit

```
BUILDER — Session 29 · F1b.0. NO CODE, NO COMMIT. Produce a premise → file:line → still-true? table before
anything is built. ADR 0022 and its three amendments cite ~70 exact locations; if any has drifted, the step
that depends on it is not built until the drift is reconciled and recorded here. Session 26's C2.0 is the
precedent for this step existing at all.

VERIFY these premises specifically (each is load-bearing for a named later step):
- Reality 1-19 in docs/build-guide/session-29.md, every one. Items 13-19 were added by the F1a sweep and
  are the ones most likely to have moved.
- lib/signals/seed.ts:62-96 (the step order promote mirrors), :22-26 (composeObjective), and the :52-61
  non-idempotency comment VERBATIM. Confirm it still says what ADR 0022 §3.2 quotes.
- lib/campaigns/brief.ts:80 (assembleBrief), :84-86 (the status!=='draft' guard), :88-90 (the
  if-existing-throw guard), :143 (critiqueBrief), :197-216 (the HARD gate).
- git grep assembleBrief across the WHOLE repo including tests. Publish the caller table. THE COUNT IS ONE
  PRODUCTION CALLER TODAY (lib/signals/seed.ts:85). If you find two, ADR 0022 §9 and Reality 10 are both
  stale and you STOP and report before building.
- supabase/migrations/20260722190000_mode2_brief_and_roles.sql:107-118 (origin DEFAULT dropped, the CHECK,
  NOT VALID then VALIDATE) and :175 (the status CHECK).
- supabase/migrations/20260730100000_studio_drafts.sql — all columns, :48-52's refusal comment, :71-86's
  four RLS policies, :17's businesses CASCADE.
- supabase/migrations/20260726010000_learning_capture.sql:34 (the generation_kind CHECK), :199-203 (the
  trigger's READ), :205-207 (the skip path and its comment), :224-226 (AFTER UPDATE, no WHEN).
- lib/ai/prompts/formats/: schemas.ts:9-46, platform-map.ts:25-35, policy.ts:15-32,
  native-generation-prompt.ts:36-52, :105-125, :133-139. Count the two-argument selectFormatFamily call
  sites in platform-map.test.ts — ADR 0022 §18.3 says TEN. Confirm the number yourself.
- lib/ai/generate-native.ts:98 (the only selectFormatFamily caller) and :110 (the ternary F1b.6 converts).
- lib/ai/prompts/post-generation.ts:167-178 (the comment) and :179 (the render).
- lib/db/memory-performance.ts:95-114 and 20260726030000_performance_memory_promotion.sql:39-75.
- lib/learning/summarize.ts:146-150 (the statement loop with NO try/catch) and
  lib/learning/orchestrator.ts:44-58, :270, :319-334, :350-351.
- lib/db/campaigns.ts:37-49 (createCampaign), :92-107 (activateCampaign), :141-155
  (softDeleteCampaignGuarded — confirm it is an UPDATE), :157-169 (countActiveCampaigns).
- lib/db/insight-cards.ts:161-170 (setCardCampaignId) and :172-191 (clearCampaignReferenceOnCards — the
  function F1b.3 mirrors).
- app/globals.css:98-110 and :149-156 (the status-band tokens) and
  app/[locale]/(dashboard)/opportunities/OpportunityFeed.test.tsx:412-534 (the contrast mechanism F1b.5
  copies — confirm it READS the token file at :439).

ALSO RUN, and record the result as CONFIRMATION only, never as a decision input:
  SELECT count(*) FROM performance_memory WHERE length(pattern) > 500;
ADR 0022 §17 closed this by arithmetic (both writers are capped at 200 and ~80 chars). The migration in
F1b.2 is written NOT VALID + VALIDATE regardless of what this returns. If it returns non-zero, that is a
drift finding about manual or seed data and you STOP and report it.

CONFIRM ABSENT: no promoteDraftToCampaign anywhere; no carousel branch in schemas.ts; no scriptBrief
anywhere; studio_drafts has no promotion_claimed_at, no promoted_campaign_id, no retained-revision column.
Anything pre-existing here is a drift finding.

OUTPUT: the premise table, any drift found with the affected step named, the count-query result, and
"Ready for F1b.1." Do NOT commit. Then stop.
```

#### F1b.1 — Migration A: promote schema  ·  ADR 0022 §2.3, §3.1, §12.2 · ADR 0017 Amd B · ADR 0019 Amd A.1  ·  PROMOTE-RLS-ISOLATED, PROMOTE-CASCADE-COMPLETE

```
BUILDER — Session 29 · F1b.1. Migration + Tier-1 DB tests + row types in lib/db/types.ts ONLY. No helpers,
no action, no UI. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke database-reviewer ONCE
with the scope "F1b.1 + F1b.2 TOGETHER — both migrations"; this is the phase's only DB review and F1b.2
does not get a second one. Use the supabase:supabase-postgres-best-practices skill (free) while authoring.

BUILD — one additive migration:
- ALTER the campaigns_origin_check to admit 'studio_promoted' as a FOURTH value, keeping the existing
  three. NOT VALID then VALIDATE CONSTRAINT as a SEPARATE statement — copy the sequencing at
  20260722190000:112-118 exactly. Do NOT restore a DEFAULT; it was deliberately dropped at :109-110.
- ALTER studio_drafts ADD three columns:
    promotion_claimed_at  timestamptz NULL
    promoted_campaign_id  uuid NULL REFERENCES campaigns(id) ON DELETE SET NULL
    <retained accepted revision>  text NULL
  Name the third column yourself, descriptively (it holds the accepted-suggestion revision promote
  snapshots). All three nullable. NO new RLS policy — the four at :71-86 are column-agnostic and already
  carry USING and WITH CHECK. NO BEFORE DELETE trigger.
- State the backfill IN A COMMENT: none, and why (every existing row is legitimately NULL). L-12 requires
  an additive migration to carry an explicit backfill statement.
- State in a comment WHY no new ADR 0010 Amendment 2 §D2.5 row is required: columns on an already-covered
  table whose cascade row exists and whose business_id already CASCADEs from businesses (:17) — the
  Session 28-D D7 insight_cards.campaign_id precedent. L-11 requires saying which case applies and why.

TEST — supabase/__tests__/, live Postgres:
- PROMOTE-RLS-ISOLATED: tenant A cannot SELECT or UPDATE tenant B's draft through the new columns.
  MIRROR IT BOTH DIRECTIONS with a real signed-in owner-B session (the Session 26-D MINOR-2 precedent) —
  one direction is not isolation.
- PROMOTE-CASCADE-COMPLETE: deleting the business CASCADEs the rows away and erasure SUCCEEDS. Assert
  success, not merely absence.
- The origin CHECK accepts all four values and rejects a bogus one.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:db. Demonstrate each new assertion REDDENS against
the pre-migration schema, then restore. Commit: "F1b.1 complete — promote schema (ADR 0022 §2.3/§3.1,
ADR 0017 Amd B, ADR 0019 Amd A.1)".

STOP AND REPORT IF: the origin CHECK will not VALIDATE, or any existing studio_drafts RLS test reddens —
that would mean the new columns changed policy behaviour, which they must not.
```

#### F1b.2 — Migration B: learning schema  ·  ADR 0018 Amd A.1, A.2  ·  LEARN-GENERATION-KIND-WIDENED, MEM-PATTERN-BOUNDED

```
BUILDER — Session 29 · F1b.2. Migration + Tier-1 DB tests ONLY. Run /ecc:plan → /ecc:tdd-workflow →
/ecc:verification-loop. NO second database-reviewer call — F1b.1's review covered both migrations.

BUILD — one additive migration:
- Widen post_ai_originals' generation_kind CHECK (20260726010000_learning_capture.sql:34) to admit
  'studio_promoted' as a THIRD value. Backfill stated as none, with the reason: widening a CHECK cannot
  invalidate an existing row.
- Add a CHECK bounding performance_memory.pattern at 500 characters. NOT VALID then VALIDATE as a separate
  statement (same precedent as F1b.1).

KEEP 500. DO NOT REDUCE IT TO 200. ADR 0018 Amendment A.2 and ADR 0022 §17's corollary are explicit: the
two production writers are capped at 200 (a Zod .max at learning-summarizer.ts:16) and ~80 (nine fixed
labels via renderPatternStatement), so a 500 CHECK CAN NEVER FIRE from a legitimate Track C write. That is
the INTENDED property — it makes the constraint a pure defence-in-depth guard on the §5 promote-path writer
boundary (A-5), not a live participant in distillation. A later session may read 500 as slack and try to
"tighten" it; leave a comment saying it is deliberate and pointing at ADR 0018 Amd A.2.

TEST — supabase/__tests__/, live Postgres:
- LEARN-GENERATION-KIND-WIDENED: the CHECK accepts all three values and rejects a bogus one.
- MEM-PATTERN-BOUNDED: an INSERT/UPDATE with a 501-character pattern is REJECTED by Postgres; 500 passes.

⚠️ MEM-PATTERN-BOUNDED IS TIER-1 ONLY. It is a Postgres CHECK. ADR 0022 §18.1 established that BOTH
production callers of upsertDistilledPerformancePattern mock it (promote.test.ts:16-18,
summarize.test.ts:23-25) and that memory-performance.test.ts:168 runs the real body against a STUBBED
client — a stub cannot fire a CHECK. If you discharge this constraint anywhere but supabase/__tests__/
against live Postgres, you have not discharged it. Put this test beside
performance-memory-promotion.test.ts.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:db. Demonstrate both assertions REDDEN pre-migration.
Commit: "F1b.2 complete — generation_kind widened, performance_memory.pattern bounded (ADR 0018 Amd A.1/A.2)".
```

#### F1b.3 — The claim, the write-back, and the soft-delete cleanup  ·  ADR 0022 §3.1-§3.4, §12.1  ·  PROMOTE-CLAIM-ATOMIC, PROMOTE-WRITEBACK-GUARDED, PROMOTE-CLAIM-RECLAIMABLE, PROMOTE-SOFTDELETE-CLEARED

```
BUILDER — Session 29 · F1b.3. lib/db/ + lib/config.ts ONLY. No Server Action, no UI. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD — lib/db/studio-drafts.ts gains three functions, and lib/config.ts one constant:
- The CLAIM: an ATOMIC conditional UPDATE setting promotion_claimed_at, guarded on
  (promotion_claimed_at IS NULL OR promotion_claimed_at < now() - <window>) AND promoted_campaign_id IS
  NULL. It RETURNS A TYPED RESULT — claimed | already_promoted | claimed_by_another — mirroring
  transitionCardStatus's already_triaged arm (lib/db/insight-cards.ts:206-232). It must NOT return void.
  ADR 0022 §3.3: "silently no-op" is correct for the write-back and WRONG for the claim, because the
  claim's loser has to render something truthful.
- The WRITE-BACK: an atomic UPDATE setting promoted_campaign_id, guarded .is('promoted_campaign_id', null),
  returning void. This one MAY silently no-op — it mirrors setCardCampaignId (insight-cards.ts:161-170).
- clearPromotedCampaignReferenceOnDrafts(campaignId): nulls promoted_campaign_id for that campaign.
  WIRE IT from every call site of softDeleteCampaignGuarded. Mirror clearCampaignReferenceOnCards
  (insight-cards.ts:172-191) including its comment explaining why it exists.
- lib/config.ts gains the staleness window as a NAMED CONSTANT with its arithmetic stated in a comment: it
  must exceed the worst-case createCampaign + write-back latency by a wide margin, and it need NOT
  accommodate assembleBrief, which runs after the write-back. Never a literal at the call site.

WHY THE CLEANUP EXISTS, and do not let a reviewer talk you out of it: softDeleteCampaignGuarded
(lib/db/campaigns.ts:141-155) is an UPDATE setting deleted_at, NOT a DELETE — so ON DELETE SET NULL NEVER
FIRES. That is exactly the bug Session 28-D D7 had to close for insight_cards.campaign_id.

TEST — supabase/__tests__/, live Postgres, and this is the step's whole point:
- PROMOTE-CLAIM-ATOMIC: two concurrent claims of ONE draft. Exactly one wins; the loser gets a TYPED
  outcome, not an exception and not a silent success. Must REDDEN if the WHERE guard is removed.
- PROMOTE-WRITEBACK-GUARDED: a second write-back no-ops rather than overwriting.
- PROMOTE-CLAIM-RECLAIMABLE: a claim older than the window WITH promoted_campaign_id IS NULL is
  reclaimable; a fresh one is not; and one with promoted_campaign_id SET is never reclaimable.
- PROMOTE-SOFTDELETE-CLEARED: soft-deleting the campaign leaves no dangling promoted_campaign_id. Must
  REDDEN with the cleanup function unwired — demonstrate that, then restore.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app ; npm run test:db. Commit: "F1b.3 complete —
atomic claim, guarded write-back, soft-delete cleanup (ADR 0022 §3, §12.1)".
```

#### F1b.4 — `promoteDraftToCampaign`  ·  ADR 0022 §2.1-§2.7, §5.1 · ADR 0018 Amd A.1  ·  PROMOTE-ACTION-VALIDATED, PROMOTE-BRIEF-END-TO-END, ACTIVATE-PLANNED-UNCHANGED

```
BUILDER — Session 29 · F1b.4. The Server Action + the activateCampaign counting fix. No UI. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop. Invoke security-reviewer ONCE over this step before committing
— this is the step where human-authored text enters posts.content.

BUILD — promoteDraftToCampaign(draftId) in the Studio surface's actions.ts, in ADR 0022 §2.1's EXACT order:
  1. Claim the draft (F1b.3's function). On a losing claim, return its typed outcome and do NOTHING else.
  2. createCampaign with origin='studio_promoted', objective composed from the draft.
  3. Write back promoted_campaign_id IMMEDIATELY — before step 6, not after.
  4. Insert the draft content as a posts row, status='draft', with the USER-CHOSEN scheduled_at.
  5. Write the post_ai_originals snapshot — SEE THE CONDITION BELOW.
  6. Call assembleBrief(campaignId) UNCHANGED.

Compose the objective by REUSING composeObjective's SHAPE (lib/signals/seed.ts:22-26), generalized. Do NOT
extend BriefAssemblyInput — its six fields (lib/ai/prompts/brief.ts:61-68) are untouched. ADR 0021 §6.1's
named loser, unchanged: a seed variant on BriefAssemblyInput is a change to Mode 2's generation behaviour
and L-1 forbids it.

⚠️ THE SNAPSHOT CONDITION IS BINDING (ADR 0018 Amd A.1's corollary). Write the post_ai_originals row IF AND
ONLY IF the retained accepted revision is NON-NULL, with generation_kind='studio_promoted' and the
REVISION as its content — never the human's raw draft. When the column is NULL (the human wrote the draft
and promoted it without accepting any suggestion) write NO ROW AT ALL; the trigger's skip path at
20260726010000_learning_capture.sql:205-207 handles it exactly as designed. A snapshot fabricated from
human text makes the classifier diff human text against itself and poisons performance_memory. This is the
single most damaging thing you could get wrong in this session.

ALSO: Zod on the input (draftId uuid, scheduled_at). Apply z.string().min(1).max(5000) to the content copy
into posts.content, matching calendar/actions.ts:48 and posts/actions.ts:179 — promote must not be the one
write path to that column with a different contract (ADR 0022 §5.1; studio_drafts.content is UNBOUNDED
today, so the 5000 does real work here).

ALSO: activateCampaign's CALLER computes planned = brief-derived N + count of posts already attached. For
every non-promoted campaign that count is 0, so behaviour is byte-identical (ADR 0022 §2.7).

TEST:
- Tier-1, live Postgres: PROMOTE-BRIEF-END-TO-END drives assembleBrief END TO END through promote against
  real auth, real RLS-filtered memory and the missing-rows path. This is ADR 0021 A-2's binding condition
  applied to assembleBrief's SECOND production caller — a Tier-2 mock does not discharge it.
- Tier-2: PROMOTE-ACTION-VALIDATED (the Zod contract incl. the 5000 bound); the snapshot written when the
  revision exists AND not written when it is NULL; the losing-claim path performs no writes.
- Tier-2: ACTIVATE-PLANNED-UNCHANGED — a non-promoted campaign's planned value is IDENTICAL to today.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app ; npm run test:db. Commit: "F1b.4 complete —
promoteDraftToCampaign (ADR 0022 §2, ADR 0018 Amd A.1)".

STOP AND REPORT IF: you find yourself needing to change assembleBrief, critiqueBrief,
approveBriefIfQualified, or BriefAssemblyInput. All four are unchanged by design (L-3).
```

#### F1b.5 — The Studio promote surface  ·  ADR 0022 §10 · A-3, L-11  ·  PROMOTE-STATES-RENDERED, PROMOTE-CONTRAST-AA, PROMOTE-I18N-COMPLETE

```
BUILDER — Session 29 · F1b.5. UI only. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
taste-skill for the build and impeccable for the review pass, BOTH against ADR 0022 §10's UX contract —
not against their own taste. They may not introduce a colour outside globals.css tokens.

BUILD — the promote affordance on app/[locale]/(dashboard)/studio/[draftId]:
- Server Component page owns auth, the business lookup and every bounded read; the Client component owns
  interaction ONLY. Precedent, in code: opportunities/page.tsx:13-16 — "NO client-side data fetching".
- ⚠️ PROMOTE IS TWO STEPS, NOT ONE CLICK (A-3). The user chooses scheduled_at before the action fires. Any
  affordance implying one click is wrong, and the reviewer is instructed to check this specifically.
- All SEVEN §10 states, each with visible text AND an accessible name: not promotable (content empty OR
  platform IS NULL — the column is nullable by design); promotable; promoting; promoted (a REAL link to
  the brief, following D7's insight_cards.campaign_id link precedent); promote failed; already promoted
  (the lost-race arm — render THAT draft's real current state, never a generic error, mirroring
  OpportunityFeed's already_triaged); reclaimable.
- Any new status colour goes on app/globals.css tokens beside --warning / --success / --info-foreground
  (light :98-110, dark :149-156). NEVER an ad-hoc Tailwind colour class.
- i18n keys in en, pt AND es simultaneously, registered in i18n/request.ts.
- shadcn v4 is Base UI: NO asChild on Button or DropdownMenu. Use buttonVariants() for a link styled as a
  button. Zero dangerouslySetInnerHTML. No console.*.

TEST — Tier-2, rendering the REAL component (not a mock — page.test.tsx mocking the component to () => null
is what made OpportunityFeed.tsx 387 lines of AUTHORED-NOT-EXECUTED before Session 28-D D5):
- PROMOTE-STATES-RENDERED: all seven states, with the two "cannot promote" states asserted DISTINCT and
  already-promoted asserted to render that draft's own status.
- PROMOTE-CONTRAST-AA: both themes, ≥4.5:1, READING THE SHIPPED TOKEN FILE via
  readFileSync(path.resolve(process.cwd(), 'app/globals.css')) — copy OpportunityFeed.test.tsx:412-534's
  mechanism, do not hand-transcribe a hex. Add the negative assertion that no raw amber|emerald|sky-\d
  class survives in the rendered output.
- PROMOTE-I18N-COMPLETE: every new key present in all three locales.

⚠️ NO ABSOLUTE DATE LITERALS IN FIXTURES. A fixture date compared against new Date() is a time bomb — the
OpportunityFeed suite went red on 2026-08-15 from exactly that (ca27d268). Derive from
formatISO(addDays(new Date(), n)).

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Commit: "F1b.5 complete — the Studio promote
surface (ADR 0022 §10)". TRACK F1 IS NOW COMPLETE. Confirm the full suite is green before F1b.6.
```

#### F1b.6 — The exhaustiveness precondition  ·  ADR 0022 §6.5  ·  (enables CAROUSEL-*)

```
BUILDER — Session 29 · F1b.6. TRACK F2 OPENS HERE. This step adds NO new format family. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD — convert three bare-FormatFamily ternaries to exhaustive switches with an assertNever default:
  lib/ai/generate-native.ts:110
  lib/ai/prompts/formats/native-generation-prompt.ts:36-52 (buildSystemPrompt)
  lib/ai/prompts/formats/native-generation-prompt.ts:138 (the factory body)

WHY THIS IS ITS OWN COMMIT AND WHY IT LANDS FIRST. These three switch on a bare FormatFamily STRING, not on
a tagged object, so tsc's discriminated-union narrowing does not apply and NONE of them is exhaustiveness-
checked. generate-native.ts:110 is the dangerous one: add carousel without touching it and a carousel call
falls silently into generateThread, receiving the thread prompt and validateThreadPolicy. It throws only
because that validator happens to crash on the missing posts[0].role — an ACCIDENTAL safety net, not a
designed one. Landing the conversion first means the compiler, not luck, catches F1b.7's third arm.

DO NOT TOUCH lib/campaigns/generate.ts:48 (extractOpener) or :55 (joinContent). ADR 0022 §6.5 records them
as ALREADY SAFE — they narrow on the output union where CarouselOutput has slides and not posts, which is a
genuine compile error. Changing them is out of scope.

THIS COMMIT MUST BE GREEN WITH FormatFamily STILL 'single' | 'thread'. If you find yourself adding
'carousel' to make it compile, you have merged F1b.6 into F1b.7 — split them.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Prove the conversion is behaviour-preserving:
the existing generate-native and native-generation-prompt suites pass UNCHANGED. Commit: "F1b.6 complete —
FormatFamily dispatch made exhaustive (ADR 0022 §6.5, precondition for carousel)".
```

#### F1b.7 — The carousel family  ·  ADR 0022 §6, §8 · A-4  ·  CAROUSEL-SCHEMA-STRUCTURAL, CAROUSEL-POLICY-SEQUENCE, MODE2-FORMAT-SELECTION-UNCHANGED, MODE2-PROMPT-BYTE-IDENTICAL

```
BUILDER — Session 29 · F1b.7. The third union branch and everything that makes it reachable. Run /ecc:plan
→ /ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- schemas.ts: a THIRD discriminatedUnion branch, format: 'carousel', with slides bounded 3..10 as LITERAL
  schema bounds, each slide { text, role, imageBrief }, role a closed enum 'cover' | 'body' | 'cta', plus
  the branch-level imageBrief. NO order field — array position IS the order (ADR 0017 §4.1's [type-2]).
  Repeat imageBrief per-branch; discriminatedUnion has no shared base merge.
- policy.ts: validateCarouselPolicy(output) mirroring validateThreadPolicy's shape (:15-32) — first slide
  is 'cover', at least one 'cta', throwing AiError('policy_violation'). Shape failures must keep surfacing
  as invalid_response from zod; the two codes stay DISTINGUISHABLE (ADR 0017 §4.2).
- native-generation-prompt.ts: buildCarouselPrompt + a third overload, with its OWN hardcoded prompt.id
  alongside 'native-generation-single' (:107) and 'native-generation-thread' (:118).
- platform-map.ts: selectFormatFamily gains a THIRD REQUIRED PARAMETER, carouselRequested, sourced from the
  brief. Instagram's arm becomes conditional on it. EVERY OTHER ARM IS UNTOUCHED.
- lib/ai/generate-native.ts:98 — the only caller — supplies the new argument.

⚠️ WHY A NEW PARAMETER AND NOT A VOLUME RULE (A-4, and this is the whole reason L-10 survives). Every call
that exists today supplies no such value and resolves BYTE-IDENTICALLY, so carousel is a DOMAIN EXTENSION,
not a mapping change, and L-10 holds in its STRICT form. A volume-derived trigger ("3 slides' worth →
carousel") is derived from inputs that ALREADY EXIST, so calls resolving to 'single' today would start
resolving to 'carousel' — that is the L-10 violation this design exists to avoid. It is the named loser.
The parameter is REQUIRED, not optional, precisely because there is one caller: the cost is one line and it
forces the decision to be visible at every future call site.

⚠️ THE platform-map.test.ts DIFF IS ARITY-ONLY (ADR 0022 §18.3). The file has TEN two-argument
selectFormatFamily call sites. Each gains a third argument `false`. NOTHING ELSE CHANGES: no
expect(...).toBe(...) right-hand side, no it.each list, no description string. In the commit body, state
that the diff contains ZERO changed expectations. ONE altered expectation is an L-10 violation and voids
MODE2-FORMAT-SELECTION-UNCHANGED entirely. Note that :5-12's "regardless of content volume" assertion for
instagram REMAINS TRUE, because volume is not the trigger — do not "update" it.

TEST — Tier-2:
- CAROUSEL-SCHEMA-STRUCTURAL: safeParse REJECTS 2 slides, 11 slides, a bad role, and prose-where-carousel-
  expected — structurally, not by a downstream string check.
- CAROUSEL-POLICY-SEQUENCE: a cover-less or cta-less carousel throws policy_violation, and a JSON-shape
  failure throws invalid_response. Assert the codes are DIFFERENT.
- MODE2-FORMAT-SELECTION-UNCHANGED: the frozen expectation table, typed as Record<Platform, ...> so tsc
  --noEmit HARD-FAILS if Platform ever gains a member the table does not cover — that is strictly stronger
  than a runtime completeness check. Enumerate every (platform, estimatedTweetsWorth, carouselRequested)
  combination and assert the pre-F2 value. NOT a snapshot file: a snapshot rots and gets -u'd back to green.
- MODE2-PROMPT-BYTE-IDENTICAL: buildSinglePrompt() and buildThreadPrompt() output byte-compared against
  frozen fixtures.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Commit: "F1b.7 complete — the carousel family
(ADR 0022 §6, A-4); platform-map.test.ts diff is arity-only, zero changed expectations".
```

#### F1b.8 — `scriptBrief`  ·  ADR 0022 §7  ·  SCRIPT-BRIEF-BOUNDED, SCRIPT-NEVER-PUBLISHED

```
BUILDER — Session 29 · F1b.8. The recommendation field and its Tier-3 scan. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- scriptBrief: string | null on EXACTLY imageBrief's footing (schemas.ts:12, :36) — declared per-branch,
  with a LITERAL length bound in the schema.
- ⚠️ IT IS A BOUNDED STRING, NOT A STRUCTURED OBJECT. A { hook, beats[], cta } shape was the Architect's
  draft and was REJECTED (ADR 0022 §7.1): a structured multi-field object with its own array bound "starts
  looking exactly like a format family in miniature", which is the thing L-9 forbids. If you find yourself
  adding fields to it, stop.
- i18n keys in en, pt AND es, registered in i18n/request.ts.

TEST:
- Tier-2 SCRIPT-BRIEF-BOUNDED: over-length is rejected by safeParse.
- Tier-3 SCRIPT-NEVER-PUBLISHED: an EXECUTABLE SOURCE SCAN asserting the field name appears nowhere outside
  the generation-output module and the single mapper that consumes generation output — and NEVER in
  posts.content's write path or the publishing worker. Follow lib/signals/source-scans.test.ts's shape.
  ⚠️ IT MUST HAVE A PER-ROOT VACUITY GUARD (expect(files.length).toBeGreaterThan(0) PER ROOT, not in
  aggregate — the Session 26-D MINOR-1 precedent). A scan that passes over an empty root proves nothing.
  Demonstrate it REDDENS against a temporary violation, then revert.

WHY A SCAN AND NOT A TYPE. ADR 0022 §7.2 evaluated a compile-error guarantee and REJECTED IT ON COST, which
is different from skipping it: a brand only constrains what may be assigned TO a branded slot, so the brand
would have to sit on the SINK, and posts.content has several legitimate plain-string producers (manual
edits, joinContent at generate.ts:270, the regeneration and brand-voice paths). Forcing all of them through
one mint point makes the brand mean "passed through the function everything passes through" — a tautology.
Do not re-litigate this; it is recorded with its reasoning.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Commit: "F1b.8 complete — scriptBrief as a
recommendation field + the never-published scan (ADR 0022 §7)".
```

#### F1b.9 — Carousel and script previews  ·  ADR 0022 §10

```
BUILDER — Session 29 · F1b.9. UI only. Run /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
taste-skill for the build and impeccable for the review pass, BOTH against ADR 0022 §10.

BUILD — in the approvals surface:
- A carousel preview: slides IN ORDER with their roles VISIBLE (cover / body / cta), so a misplaced cta is
  legible to a human reviewer rather than only to the policy validator.
- imageBrief and scriptBrief rendered as recommendations EXPLICITLY MARKED NEVER-PUBLISHED, in visible text
  and in the accessible name. This is the same treatment imageBrief already receives — not a new category.
- Reuse the existing status-band tokens; add none unless the design genuinely needs one, and if it does,
  it lands on globals.css with a both-themes contrast assertion like F1b.5's.
- i18n en/pt/es. No asChild. Zero dangerouslySetInnerHTML. No console.*.

TEST — Tier-2, rendering the REAL component: a carousel post renders every slide with its role; a post
carrying scriptBrief renders it with the never-published marker present in the accessible name.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Commit: "F1b.9 complete — carousel and script
previews (ADR 0022 §10)".
```

#### F1b.10 — The learning-loop per-statement guard and two stale comments  ·  ADR 0022 §17 item 3, §17.1

```
BUILDER — Session 29 · F1b.10. A small, bounded fix plus two comment corrections. Run /ecc:plan →
/ecc:tdd-workflow → /ecc:verification-loop.

BUILD:
- lib/learning/summarize.ts:146 — the statement loop has NO per-statement try/catch, so a rejection on
  statement #2 throws out of summarizeBusinessLearning into the per-business catch at orchestrator.ts:358,
  and statements #3-5 for that business are never written. Wrap the upsert in a try/catch that LOGS AND
  CONTINUES to the next statement (ADR 0022 §5.3's per-item requirement).
- Add a summarizeRejected counter to LearningTickSummary (lib/learning/orchestrator.ts:44-58, initialised
  :319-334) and to the canonical tick log line, so a bound rejection is legible AS ITSELF rather than as a
  generic summarizeFailed with code 'unknown' — today it is indistinguishable from an Anthropic outage.

⚠️ WRITE THIS UP AS LATENT, NOT AS A LIVE BUG. Nothing can currently produce a >200-char statement (the Zod
.max at learning-summarizer.ts:16 rejects at parse, long before the 500 CHECK). This is a correctness-of-
the-guard fix. Do not describe it as a bug in the commit message or anywhere else.
- The ROW loop is already correct and needs NO change: processRow's own try/catch (orchestrator.ts:211,
  :284) funnels every exception into permanent/transient handling and returns without rethrowing.

ALSO — two stale comments (§17.1):
  lib/ai/prompts/learning-summarizer.ts:41
  lib/db/memory-performance.ts:51-52
Both assert the arithmetic Tier-0 writer "has no production caller yet". lib/learning/orchestrator.ts:270
IS that caller and has been since the tick loop landed. ⚠️ CORRECT ONLY THE PREMISE. Both comments use it
to argue that pattern text must NOT be assumed arithmetic-and-therefore-safe, and THAT CONCLUSION IS STILL
CORRECT and must not be weakened — it is now correct for a stronger reason (both writers are live, and no
column distinguishes an arithmetic row from an LLM-summarizer row). Leave the guard posture exactly as it
stands.

TEST — Tier-2: a rejected statement does not prevent subsequent statements in the same batch from being
written, and summarizeRejected increments. Must REDDEN without the try/catch.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app. Commit: "F1b.10 complete — per-statement
log-and-skip in the summarizer, summarizeRejected counter, two stale premises corrected (ADR 0022 §17)".
```

#### F1b.11 — Scope scans, constraint map, and the verification pass  ·  ADR 0022 §11.3  ·  RUNNER-UNMODIFIED, MODE3-UNTOUCHED, POSTS-DDL-UNMODIFIED, NO-SKIP-REVIEW-PATH

```
BUILDER — Session 29 · F1b.11. The last step. Run /ecc:verification-loop over the WHOLE range.

BUILD — four EXECUTABLE scans, each with a PER-ROOT vacuity guard, each demonstrated to REDDEN against a
temporary violation and then reverted:
- MODE2-RUNNER-UNTOUCHED: fails if lib/ai/runner.ts is modified in this range, and asserts there is no
  third prompt.id branch alongside isPostGeneration / isBrandVoice (runner.ts:17-25).
- MODE2-CAROUSEL-NO-IMAGE-GEN: fails on any image-generation call anywhere in the repo (L-8, constitution).
- POSTS-DDL-UNMODIFIED: posts gains no column, constraint, index, policy or trigger in this range.
- MODE3-UNTOUCHED: no change to the poller, watch list, scorer, candidate schema, triage loop, card schema
  or feed (L-12).
A scope rule that lives as prose is not enforced. These are tests, not review comments.

THEN PRODUCE, in the step notes:
- EVERY ADR 0022 constraint mapped to its EXECUTING CI JOB, with "reddens if broken" stated PER ROW. Tier-1
  → db-tests, Tier-2 → app-tests, Tier-3 → the scan or the diff that proves it.
- The Tier-3 five enumerated AS DECISIONS (ADR 0022 §11.3), so "no runtime test" reads as a recorded choice.
- SHARED-FUNCTION CALLERS re-grepped at the range head and the ADR §9 table EXTENDED if a caller appeared.
  State per caller which test exercises it. assembleBrief should now show TWO production callers. Note
  explicitly that lib/signals/seed.test.ts:14 MOCKS assembleBrief and therefore does not execute its body.
- The §18.1 correction reflected: upsertDistilledPerformancePattern has TWO production callers, both
  mocking it, and MEM-PATTERN-BOUNDED is discharged in Tier-1 ONLY.

THEN PUSH and cite REAL run URLs for app-tests and db-tests, quoting the skip-guard's own line with its
NON-ZERO file and test counts. ⚠️ DO NOT CLAIM A CONSTRAINT COUNT UNTIL IT IS EXECUTED GREEN IN CI AT THE
HEAD IT IS DATED TO. Session 28 shipped a false "29/29 executed green" that took three correction steps to
undo. If a constraint is authored but not executed, label it AUTHORED-NOT-EXECUTED and say so.

VERIFY: npx tsc --noEmit --skipLibCheck ; npm run test:app ; npm run test:db. Commit: "F1b.11 complete —
four scope scans, full constraint map, SHARED-FUNCTION CALLERS re-grepped; <app-tests URL>, <db-tests URL>".

End with one line: "Session 29 Track F Builder complete — F1b.0..F1b.11, <n> constraints executed green at
<sha>." Then /exit.
```

---

## §3 — Reviewer session (F1c)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored after ADR 0022 is Accepted, alongside §2.** The reviewer's checklist *is* the
> ADR's constraint table, so this section can be written before the Builder runs; only the commit range is
> filled in at run time, by the Reviewer itself.
>
> When filled in, this section follows the Sessions 26–28 form:
>
> - **§3a — Reviewer primer** (paste first, wait for acknowledgement) and **§3b — Reviewer prompt**.
> - **`PROC-REVIEW-AT-COMMIT` is absolute.** The report **opens by naming the exact commit range it read**
>   (e.g. *"Scope reviewed: `<base>..<head>`; all citations are `git show <sha>:<path>` at that range,
>   never HEAD."*). A report that does not name its range is not a valid review. Reading at HEAD produced a
>   false-positive MAJOR in Session 21B; this is not a formality.
> - **`SHARED-FUNCTION CALLERS` is the first thing checked** for `assembleBrief`'s callers. **The count is
>   one today, two after promote lands** — `lib/signals/seed.ts:85` is the only production caller at
>   `dd748435` (`git grep assembleBrief`, non-test), and this ADR's promote path adds the second. *An
>   earlier draft of this section said "three callers"; that predates the A-8 correction to Reality 10 and
>   was never true.* Both
>   Session 22 blockers were a shared function verified against one caller. The reviewer lists, per caller,
>   which test file exercises it, and marks any caller with no listed test `AUTHORED-NOT-EXECUTED` **even
>   if another caller is fully covered**.
> - Findings are written to `docs/reviews/session-29-reviewer.md`, with severities (BLOCKER / MAJOR /
>   MINOR / NIT) and stable ids the correction pass cites.
> - The reviewer independently verifies that every constraint claimed COVERED is **executed green in CI at
>   the stated head** — not merely authored. A claimed count that is false at its dated head is the exact
>   failure Session 28 shipped and 28-D spent three steps correcting.

**✅ AUTHORED 2026-08-22 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.** Authored alongside §2, per its own gate: the reviewer's
checklist **is** ADR 0022's constraint table, so it can be written before the Builder runs. **Only the
commit range is filled in at run time, by the Reviewer itself.**

### §3a — Reviewer primer  (paste first · wait for acknowledgement)

```
Session 29 Track F — REVIEWER phase (F1c). You are independent. You MODIFY NOTHING: no source, no tests, no
ADR, no build guide. Your single output is docs/reviews/session-29-reviewer.md. This is the ONE review pass
for this session; there is no separate re-review track.

PROC-REVIEW-AT-COMMIT IS ABSOLUTE AND IS YOUR FIRST OBLIGATION.
Read every artefact AT THE STATED COMMIT RANGE — git diff <base>..<head>, git show <sha>:<path>,
git log --oneline <base>..<head>. NEVER at HEAD. Reading at HEAD produced a false-positive MAJOR finding in
Session 21B that the next session's reviewer had to withdraw. Your report MUST OPEN by naming the exact
range, e.g.:
  "Scope reviewed: <base>..<head>; all citations are git show <sha>:<path> at that range, never HEAD."
A report that does not name its range is not a valid review.

Exception you may rely on (Session 22-F, NEW-12): the ADR and build guide you audit AGAINST are read at
their own commits, which you name separately — they postdate or predate the range and cannot be read
inside it. State both: "ADR 0022 read at <sha>; reviewed artefacts read at <base>..<head>."

WHAT YOU ARE AUDITING AGAINST:
- docs/decisions/0022-promote-to-campaign-and-format-families.md, INCLUDING §§17-19. §17 and §18 are
  additive corrections to §6.3, §9 and §16. WHERE THEY CORRECT AN EARLIER SECTION, THE CORRECTION IS THE
  STANDARD. Do not raise a finding against §9's superseded row or §6.3's superseded claim — §18 already
  corrected both, deliberately leaving the originals legible.
- ADR 0018 Amendment A (incl. A.4), ADR 0017 Amendment B, ADR 0019 Amendment A.
- docs/build-guide/session-29.md §0 (L-1..L-12), §0.2 (A-1..A-8), Reality 1-19, and §2b's step table.

THE FOUR THINGS MOST LIKELY TO BE WRONG, in the order I want them checked:

1. SHARED-FUNCTION CALLERS on assembleBrief. THE COUNT IS ONE TODAY, TWO AFTER PROMOTE LANDS.
   lib/signals/seed.ts:85 is the only production caller at dd748435; promote adds the second. Verify by
   git grep at the range, not by trusting the ADR. Then do the same for upsertDistilledPerformancePattern,
   where ADR 0022 §18.1 records that BOTH production callers MOCK the function — confirm the Builder did
   not discharge MEM-PATTERN-BOUNDED with a Tier-2 test. List, per caller, which test file exercises it.
   A caller with no listed test is AUTHORED-NOT-EXECUTED EVEN IF another caller is fully covered.

2. MEM-PATTERN-BOUNDED must be TIER-1. It is a Postgres CHECK. A Tier-2 test against a stubbed client
   CANNOT fire it (memory-performance.test.ts:168 runs the real body against a stub). If the Builder proved
   it anywhere but supabase/__tests__/ against live Postgres, that is a BLOCKER, not a MINOR.

3. THE platform-map.test.ts DIFF MUST BE ARITY-ONLY. Ten call sites gain a third argument `false`. Open the
   diff and confirm ZERO changed expectations — no altered expect(...).toBe(...) right-hand side, no
   changed it.each list, no reworded description. ONE altered expectation is an L-10 violation and the
   whole MODE2-FORMAT-SELECTION-UNCHANGED guarantee is void.

4. THE ORDER. F1b.6's exhaustiveness conversion must land BEFORE F1b.7's carousel branch, in a separate
   commit that is green with FormatFamily still 'single' | 'thread'. If carousel landed first, or in the
   same commit, generate-native.ts:110's silent misroute shipped — say so.

ALSO VERIFY, and do not take the Builder's word for any of it:
- Every constraint claimed COVERED is EXECUTED GREEN IN CI AT THE STATED HEAD, not merely authored. Open
  the runs. A claimed count that is false at its dated head is exactly what Session 28 shipped and 28-D
  spent three steps correcting.
- The db-tests skip-guard line shows a NON-ZERO file and test count, read from the log, not inferred.
- lib/ai/runner.ts is untouched (L-7, MODE2-RUNNER-UNTOUCHED) and posts is untouched (POSTS-DDL-UNMODIFIED)
  — check the diff yourself, do not trust the scan's existence.
- Each of the four executable scans has a PER-ROOT VACUITY GUARD. A scan that passes over an empty root
  proves nothing.
- The promote snapshot is written ONLY when the retained revision is non-NULL (ADR 0018 Amd A.1's binding
  corollary). A snapshot fabricated from the human's raw draft corrupts ADR 0018's corpus — BLOCKER.
- The staleness window is a named lib/config.ts constant with stated arithmetic, not a literal.
- clearPromotedCampaignReferenceOnDrafts exists AND is wired from softDeleteCampaignGuarded's call sites —
  ON DELETE SET NULL never fires on a soft delete, which is the D7 bug this would reintroduce.
- scheduled_at is user-chosen and approve re-touches it (A-3). If a default slipped in, the surprise-publish
  path at claim_posts_for_publishing (scheduled_at <= p_now) is live — MAJOR at minimum.
- i18n landed in en, pt AND es simultaneously and is registered in i18n/request.ts.
- No asChild on Button or DropdownMenu. Zero dangerouslySetInnerHTML. No console.* on a user-facing surface.
- Any new status colour is a globals.css token with a both-themes contrast assertion that READS THE SHIPPED
  TOKEN FILE. A hand-transcribed hex is the anti-pattern that assertion exists to prevent.

Acknowledge in one line, naming the commit range you have been given and confirming you will read at that
range and never at HEAD. Then STOP and wait for the review prompt.
```

### §3b — Reviewer prompt  (paste after the primer is acknowledged)

```
Review the Session 29 Track F Builder range and write docs/reviews/session-29-reviewer.md.

Open the report with the range line (PROC-REVIEW-AT-COMMIT), and name separately the commit at which you
read ADR 0022 and the build guide.

Organise findings by the ADR's own sections so a correction pass can cite them:
  1. Promote contract and gate count (ADR 0022 §2; A-3, A-7)
  2. Atomicity, the claim, the staleness window, the soft-delete cleanup (§3, §12.1; A-6)
  3. The generation_kind amendment and the snapshot corollary (§4; ADR 0018 Amd A.1; A-1)
  4. The write-time bound, its TIER, and the A-5 guard (§5; ADR 0018 Amd A.2/A.3; §18.1)
  5. The carousel family, roles, policy, and the exhaustiveness precondition (§6; A-4)
  6. scriptBrief and the never-published scan (§7)
  7. MODE2-FORMAT-SELECTION-UNCHANGED and the arity-only diff (§8; §18.3)
  8. SHARED-FUNCTION CALLERS, per caller, with the test that exercises each (§9; §18.1)
  9. The UX contract and the design floor (§10)
 10. Constraint-to-CI mapping: every constraint, its tier, its executing job, and whether it REDDENS if the
     property breaks (§11)
 11. Scope and process: L-1's out-of-scope list not shipped; the Tier-3 five enumerated AS DECISIONS

Severities: BLOCKER / MAJOR / MINOR / NIT, each with a STABLE ID (BLOCKER-1, MAJOR-2, ...) the correction
pass will cite. For each finding give: what is wrong, the file:line AT THE RANGE, why it matters, and what
would prove it fixed. Do not propose patches — you write no code.

Where you believe the ADR itself is wrong rather than the implementation, say so explicitly and mark it as
an ADR finding, not a Builder finding. §17 and §18 exist because an audit of this ADR against the code
found three real defects; a fourth is possible and you should say so if you find one.

State plainly anything you could NOT verify and why — an unverified claim recorded as unverified is worth
more than a confident guess. Do not pad the report to look thorough.

End with one line: "Session 29 review complete — <n> findings (<b> BLOCKER, <m> MAJOR, <mi> MINOR, <ni>
NIT) over range <base>..<head>." Then /exit.
```

**Gate:** `§4` is authored **only after** this Reviewer has actually run and `docs/reviews/session-29-reviewer.md`
exists. A correction pass is a response to findings; there is nothing to order or prioritise until they
exist, and inventing them ahead of time produces a fictional resolution log.

---

## §4 — Correction pass (Session 29-D)  ·  (paste into Claude Code · Opus)

> **PLACEHOLDER — authored ONLY after the Reviewer has actually run and
> `docs/reviews/session-29-reviewer.md` exists.** A correction pass is a response to findings; there is
> nothing to order, prioritise or resolve until they exist, and drafting it earlier produces a fictional
> resolution log.
>
> When filled in, this section follows the Sessions 26–28 form: a summary of what the reviewer found
> (with `docs/reviews/session-29-reviewer.md` named as authoritative), the ordering rationale, the
> correction primer, the numbered correction steps `D0…Dn`, a resolution log, and a close-out step that
> pushes the corrected range and runs CI green at that head.
>
> **`REVIEWER-REPORT APPEND-ONLY` governs where resolutions go, and all four conditions are load-bearing:**
>
> 1. **No in-place edit, ever** — not one character of the reviewer's text changes. No verdict flipped, no
>    RESOLVED stamped onto a finding, no finding reworded, deleted or reordered.
> 2. **One appended, attributed section** — a single `## CORRECTION PASS (Session 29-D)` at the **end** of
>    the reviewer's own file, opening with its author, date and the commit range it fixed. A reader must be
>    able to tell, from any line, which of the two wrote it.
> 3. **Findings are referenced, never restated as resolved** — cite by id, and record *finding → fix → the
>    test that now proves it → the commit SHA*.
> 4. **A disputed or withdrawn finding is argued, not erased** — say why in the appendix and let the reader
>    judge.
>
> The Session 22-D failure (RESOLVED verdicts written *into* the reviewer's finding text) remains
> prohibited. Note the Session 22-F / NEW-12 exception: the **findings document** being audited is read at
> **its own** commit, which the report must name, while the **reviewed artefacts** are read at the audited
> range.

**✅ AUTHORED 2026-08-23 — the placeholder above is retained as the specification this section was written
against; everything below is the section itself.**

**Filled in from `docs/reviews/session-29-reviewer.md`** (Reviewer range **`dac7ddac..4db4053f`**,
F1b.1…F1b.11 + the CRLF fix + the docs-only head, thirteen commits, 61 files, +4276/−109; the findings
document itself read at its own commit, per the Session 22-F / NEW-12 exception — it is **untracked** at
the range head, which is why D0 exists). **Thirteen steps: D0–D12.** Correction passes are normal, not
failures (constitution). **There is no independent re-review pass this session** (mirroring
23-D/24-D/25-D/26-D/27-D/28-D): this pass fixes the Reviewer's findings, records its own resolutions in the
reviewer's own file, and the founder adjudicates close-out.

**The Reviewer found NO BLOCKER, and that is the correct verdict — the four items most likely to be wrong
are all right.** `assembleBrief`'s two callers are both Tier-1-executed; `MEM-PATTERN-BOUNDED` really is
Tier-1 against live Postgres; the `platform-map.test.ts` diff really is arity-only; and F1b.6's
exhaustiveness conversion really did land in its own commit **before** `'carousel'` joined `FormatFamily`,
so `generate-native.ts`'s silent misroute never shipped. The promote snapshot's both-directions Tier-1
proof (`studio-promote-brief-end-to-end.test.ts:139-199`) is the strongest-executed work in the session.

**So this pass is not a rescue. It is the harder, quieter kind: five MAJORs that are almost all
requirements the ADR asserts and no step was ever asked to build.** MAJOR-1 (the A-5 sentinel guard),
MAJOR-2 (the promoter-level Zod bound) and MAJOR-4 (A-3's *"approve must re-touch `scheduled_at`"*) each
have the same shape — **a founder adjudication or an ADR clause with no constraint name in §11, no row in
§20.1, and no row in §2b's step table. With no step and no constraint, their absence could not redden
anything, and the ADR reads as though they landed.** MAJOR-3 is the SHARED-FUNCTION CALLERS failure shape
landing on the very function added to prevent a repeat of it: the *function* is tested, the *call site* is
not, so deleting `actions.ts:101` reintroduces the D7 bug with a fully green suite. MAJOR-5 is a
product-shape decision nobody made — a promoted campaign can never generate and never activates, because
of an idempotency guard nobody re-read.

**The single process lesson of this pass, and it must be written into the ADR rather than into a commit
message:** *a requirement that names no constraint in §11 is a requirement that will not ship.* Three of
the five MAJORs are that sentence.

**Founder direction — every finding is fixed, including the deferred ones.** The Reviewer graded MINOR-1…8
and NIT-1…7 as deferrable debt; per founder direction (as in Sessions 23-E, 24-D, 25-D, 26-D, 27-D and
28-D) they are **resolved in this pass anyway**, each with its own resolution row — including any that is
**declined/argued rather than changed** (NIT-3 is expected to be one, and MINOR-7 is out of range and is
fixed anyway). A finding declined, deferred or adjudicated the other way still gets a row, because an
unexplained gap between findings and resolutions is what makes the trail unreadable later.

**One arithmetic note about the report itself, which this pass must NOT edit.** The closing line reads
*"15 findings (0 BLOCKER, 5 MAJOR, 6 MINOR, 4 NIT)"*. The body actually carries **MAJOR-1…5, MINOR-1…8 and
NIT-1…7 — twenty findings**. The tally line is wrong; **the findings are not.** Under REVIEWER-REPORT
APPEND-ONLY this is recorded in the appendix (condition 4: argued, never erased) and **not one character of
the reviewer's line is changed**. This pass resolves **all twenty**, and the resolution log's row count is
the check that none was lost to the miscount.

### Adjudications A-9, A-10, A-11 — RAISED HERE, founder rules before D5 and D6 run

The Reviewer correctly refused to choose for us in three places, and each is a *product* decision wearing a
test's clothes. **§0's L-1…L-12 and §0.2's A-1…A-8 are NOT reopened by any of them** — in particular A-3
(the user picks `scheduled_at` **and approve re-touches it**) stands exactly as written, which is why
MAJOR-4 is a plain implementation step and **not** an adjudication.

| # | Item | Recommended ruling (founder to confirm) | Named loser | Where it lands |
|---|---|---|---|---|
| **A-9** | **MAJOR-5** — `generatePostsForCampaign`'s unconditional idempotency guard (`lib/campaigns/generate.ts:106-114`) sees the promoted post, returns `already_generated` for **every** promoted campaign, and `activateCampaign` is never reached; the campaign stays `awaiting_brief` forever and §2.7's arithmetic is unreachable | **Exempt the promoted post from the guard.** The guard counts **generated** posts, not all posts. A promoted campaign then generates, activates, and §2.7's `postsCreated + existingPosts.length` becomes the live path it was written for. This keeps A-7 Package A intact: the brief still governs generation, the promoted post is still independent of it, and the two-gate/three-gate count in §2 stays true. | **"A promoted campaign is single-post by design, withdraw §2.7."** Cheaper, and wrong: it silently retires the brief-assembly, critique and HARD-gate flow for promoted campaigns *after* shipping the UI that walks the user through it, and it makes L-3 (promote reuses ADR 0017's pipeline UNCHANGED) false in effect while leaving it true in text. | `lib/campaigns/generate.ts`; `lib/campaigns/generate.test.ts`; Tier-1 `studio-promote-brief-end-to-end.test.ts`; ADR **§2.7 amendment**; step **D5** |
| **A-10** | **MINOR-4** — carousel ships structurally unreachable: both call sites pass a literal `false`, nothing reads the brief, and `generate-native.ts:133-134`'s `case 'carousel':` **throws**. `CarouselOutputSchema` and `validateCarouselPolicy` have no production caller | **Record the deferral; do not wire it in this pass.** §6.3's *"sourced from the brief"* is amended (append-only) to state that the **sourcing** is deferred with a named revival condition in §15, while the **family, schema, policy and platform-map rows** are what shipped. Wiring it needs a prompt change, and a prompt change collides head-on with §8.2's `MODE2-PROMPT-BYTE-IDENTICAL` frozen fixtures — the identical collision A-11 adjudicates. Ruling the two the same way is the point. | **Wiring `carouselRequested` from the brief in a correction pass.** It changes Mode 2 generation behaviour (L-1's explicit out-of-scope list), breaks the frozen fixtures, and does it under the least-reviewed conditions of the session. | ADR **§6.3 / §15 amendment**; step **D6** |
| **A-11** | **MINOR-5** — §7.1 requires `scriptBrief` to be *generated*; §8.2's frozen prompt fixtures forbid asking the model for it. The Builder chose §8.2 **in a source comment** (`schemas.ts:9-29`) and the ADR never adjudicated it, so `SCRIPT-BRIEF-BOUNDED` passes over a field nothing writes and §7.3's rendering is unreachable | **§8.2 wins; §7.1 yields, explicitly.** ADR amended (append-only) to state that `scriptBrief` ships as a **schema-and-render-ready field that no prompt yet populates**, with the revival condition in §15: *the field is generated in the first session permitted to re-freeze the Mode 2 prompt fixtures.* The Builder's engineering call was right; this makes it a **decision** instead of a comment. | **Silence** — leaving the contradiction in the ADR, which is what produced the finding. Also rejected: changing the prompt now (breaks §8.2 for a recommendation field), and deleting `scriptBrief` (throws away shipped, tested, rendered work for a deferral). | ADR **§7.1 / §15 amendment**; step **D6** |

**Why A-9 is the one a Builder is most likely to get half-right.** Two symmetrical drifts, both wrong.
Deleting the guard outright restores generation *and* removes the double-generation protection every
non-promoted campaign relies on — an idempotency regression for the 100 % case to fix the promoted case.
Special-casing on `campaigns.origin = 'studio_promoted'` looks equivalent and is not: it makes the guard's
correctness depend on a value the promote path writes, so a future origin silently gets the wrong
behaviour. **The ruling is: the guard counts what it was always meant to count — posts this pipeline
generated — and the promoted snapshot post is not one of them.**

### What the Reviewer found (summary — `session-29-reviewer.md` is authoritative)

| ID | Tier | One line | Fixed in |
|---|---|---|---|
| — | audit | `docs/reviews/session-29-reviewer.md` is **untracked** (`??`) at the range head; every step below amends or cites it | **D0** (first, deliberately) |
| MAJOR-1 | MAJOR | A-5's `neutralizeWithSentinels` at the writer boundary **was never implemented** — `git grep neutralizeWithSentinels` has no hit in `memory-performance.ts`, `learning/summarize.ts` or `learning/promote.ts`; §5.4 explicitly declined the "accept the residual" loser; **no constraint name in §11, no row in §20.1** | **D1** |
| MAJOR-2 | MAJOR | The promoter-level Zod bound in front of the RPC (Amd A.2, §5.2) **was never implemented** — `memory-performance.ts:97-116` forwards `insert.pattern` straight into `client.rpc`; §5.2 calls the two bounds *"two different guarantees at two boundaries… not redundancy"* | **D2** |
| NIT-4 | NIT | `learning/summarize.ts:176` catches **every** error into `statementsRejected`, not only a CHECK rejection; §5.3's semantics say "rejected" means "over the bound" | **D2** |
| NIT-7 | NIT | `studio_drafts.accepted_revision text NULL` is unbounded and flows verbatim into `post_ai_originals.rendered_content`; §5.1 applied `max(5000)` to `posts.content` for exactly this reason | **D2** |
| MAJOR-3 | MAJOR | `clearPromotedCampaignReferenceOnDrafts`'s **call site** (`campaigns/actions.ts:101`) has no test; `PROMOTE-SOFTDELETE-CLEARED` reddens if the function changes, stays green if the call is deleted — the D7 bug, reintroducible on a green suite. The sibling it mirrors has three cases | **D3** |
| NIT-3 | NIT | One new `console.error` at `campaigns/actions.ts:103`, mirroring the pre-existing line at `:93` — expected to be **argued and declined**, not changed | **D3** |
| MAJOR-4 | MAJOR | A-3's second half never shipped: `approvePost` (`lib/db/posts.ts:320-338`) sets `{ status: 'approved' }` and nothing else, so a post promoted for 2026-09-01 and approved on 2026-09-05 is claimable by `claim_posts_for_publishing` on the next tick — `[db-Q1]`'s surprise-publish reached by another route. **No constraint name for the re-touch anywhere** | **D4** |
| MAJOR-5 | MAJOR | A promoted campaign can **never** generate and **never** activates — `generate.ts:106-114`'s guard sees the promoted post and returns `already_generated` unconditionally; §2.7's arithmetic is dead; `ACTIVATE-PLANNED-UNCHANGED` proves a now-unreachable guarantee. A-9 | **D5** |
| MINOR-4 | MINOR | Carousel is structurally unreachable — both call sites pass a literal `false`, nothing reads the brief, and the `case 'carousel':` arm throws; §6.3's sourcing mechanism was never built. A-10 | **D6** |
| MINOR-5 | MINOR | §7.1 (`scriptBrief` is *generated*) and §8.2 (frozen prompt fixtures) are irreconcilable; the Builder chose §8.2 in a source comment and the ADR never ruled. A-11 | **D6** |
| MINOR-1 | MINOR | The frozen table samples `LOW_VOLUME = 1` / `HIGH_VOLUME = 5` and never touches the boundary at 3 — editing `platform-map.ts:33`'s `>= 3` to `>= 2` or `>= 4` leaves all twenty rows green; the threshold is guarded only by the **co-editable** file §8.1 named as the weaker instrument | **D7** |
| MINOR-2 | MINOR | `platform-map.frozen-table.test.ts:71-77` calls `selectFormatFamily(platform, LOW_VOLUME, false)` **twice** and asserts the two are equal — a green test that cannot redden, titled as though it proves `MODE2-FORMAT-SELECTION-UNCHANGED` | **D7** |
| NIT-1 | NIT | §18.3 and §2b's F1b.7 row say *"TEN call sites"*; `platform-map.test.ts` has **eleven** — a miscount inside the section written to correct a miscount of the same file | **D7** |
| NIT-6 | NIT | `platform-map.ts:27-28`'s own comment cites `generate-native.ts:98, studio-suggestion.ts:136`; the real lines are `:106` and `:142` | **D7** |
| MINOR-3 | MINOR | `PROMOTE-RLS-ISOLATED`'s four cases are all `USING`-side (cross-tenant SELECT ×2, cross-tenant UPDATE ×2); **no case attempts the `WITH CHECK` violation** — updating a row you *can* see so it lands in another tenant. CLAUDE.md makes `WITH CHECK` the tenant-tunnelling guard specifically | **D8** |
| MINOR-8 | MINOR | `claimStudioDraftForPromotion` runs **outside** `promoteDraftToCampaignCore`'s `try`, and its fallback re-read uses `.single()` — a draft soft-deleted between page load and submit throws to Next's generic error boundary instead of one of §10's seven states | **D8** |
| MINOR-6 | MINOR | `listLatestPostAiOriginalsByPostIds` caps at `postIds.length * 20` with `post_id ASC, revision DESC` ordering — one post with >20 revisions eats the others' budget and the last posts silently render nothing; `createNextPostAiOriginalRevision` makes >20 reachable | **D9** |
| NIT-5 | NIT | Per-slide `imageBrief` (`schemas.ts:71-77`, added on §6.1's explicit design) is never rendered — `AiOutputPreview.tsx:41-49` shows `role` and `text` only | **D9** |
| MINOR-7 | MINOR | **Pre-existing, OUT OF RANGE, flagged not charged — fixed anyway:** `vitest.config.ts`'s include is `'lib/**/*.test.ts'`, which does not match `.test.tsx`, so the seven `lib/email/templates/__tests__/*.test.tsx` files are **never collected by any CI job** and are invisible to the skip-guard rather than caught by it | **D10** |
| NIT-2 | NIT | §20's table calls `b01a9985` *"the current range head"*; the head is `4db4053f`. True when written, false now, and readable as a claim that CI ran at `4db4053f` | **D11** |
| — | — | The report's own tally line (*"15 findings"* against twenty IDs) — argued in the appendix, **never edited** | **D11** |
| — | — | Re-green the corrected range; record both run URLs and the skip-guard file/test counts **verbatim from the log**; the `db-tests` tally counts **`master` runs only** | **D12** |

### Ordering rationale (state it in the resolution log so it does not read as arbitrary)

1. **D0 runs FIRST**, the 25-D/26-D/27-D/28-D precedent. The reviewer report is untracked at the range
   head; appending a resolution row to an untracked file produces no diff and no history, and the whole
   value of REVIEWER-REPORT APPEND-ONLY is that the diff proves nothing above the appendix moved.
2. **The three "requirement with no constraint" MAJORs (D1, D2, D4) come before the behavioural ones**, and
   not merely by severity. Each one's fix is *the same fix twice*: the code change **and** the §11
   constraint name that would have caught its absence. Doing them late would mean the later steps' green
   runs were once again green over an unnamed requirement.
3. **D1 precedes D2** because they touch the same writer boundary and D1 is the founder adjudication (A-5).
   A Zod bound added first would have to be re-read once the guard changes what reaches it.
4. **D3 precedes D4/D5** because it is the cheapest proof that this session's own review lesson was learnt:
   a shared function whose *call site* is untested. It is three Tier-2 cases against an existing trio.
5. **D4 (`scheduled_at`) is an implementation step, not an adjudication** — A-3 already ruled it. It lands
   before D5 because D5 changes what a promoted campaign *generates*, and the schedule invariant should be
   true before more posts can reach it.
6. **D5 (A-9) is the product-shape step and carries the highest blast radius**: it edits the idempotency
   guard every campaign in the product passes through. It is isolated for that reason, and its
   non-promoted-campaign byte-identity is a required assertion, not a hoped-for one.
7. **D6 is documentation only, and it is not cosmetic.** MINOR-4 and MINOR-5 are the same collision —
   *a §6/§7 requirement against §8.2's frozen fixtures* — and ruling them **the same way in one step** is
   what stops the next session from re-deriving the conflict from scratch.
8. **D7 groups the four `platform-map` findings** (MINOR-1, MINOR-2, NIT-1, NIT-6) because they are one
   file pair and one constraint. Four commits over `platform-map*.ts` would each redefine the others'
   fixtures, and MINOR-2's removal is only safe once MINOR-1's boundary rows exist to carry the guarantee.
9. **D8 groups the two promote-path robustness findings** (MINOR-3, MINOR-8): one adds the `WITH CHECK`
   case to the promote RLS suite, the other makes a deleted draft a typed §10 state — both are "the promote
   path under conditions nobody drove it through".
10. **D9 groups the two preview-surface findings** (MINOR-6, NIT-5) — one component, one test file.
11. **D10 is deliberately last among the code steps.** Making vitest collect seven never-executed
    `.test.tsx` files may turn them red; that is a **discovery**, not a regression of this pass, and it must
    not be entangled with any Session 29 fix's green run.
12. **D11 is the documentation-truth step**, including the appendix's argument about the reviewer's own
    tally line — recorded, not corrected in place.
13. **CI runs LAST (D12)**, and its job is not merely to re-green: it is to produce the green run **for the
    corrected range**, which is what makes NIT-2's re-citation true rather than merely reworded.

### Where resolutions go (CLAUDE.md — REVIEWER-REPORT APPEND-ONLY, revised Session 23-D)

Directly into `docs/reviews/session-29-reviewer.md`, under a **single appended, attributed**
`## CORRECTION PASS (Session 29-D)` section at the **end** of the file — no separate corrections file. The
reviewer's findings above it are **immutable**: not one character edited, no verdict flipped, no status
column rewritten, no RESOLVED stamped onto a finding, nothing reworded, deleted or reordered — **including
§C's per-section verdicts, §10's correction table and the closing tally line**, which stay exactly as
written even after every finding is closed. The appendix opens with its author, date and the commit range
it fixed, references each finding **by ID**, and records *finding → fix → the test that now proves it → the
commit SHA*. A finding **disputed, declined or adjudicated the other way** (NIT-3 is the expected one) gets
a row that says so and argues it. **Twenty finding IDs exist; the appendix carries twenty rows.**

### Standing rules for every step in this pass

- **§0's L-1…L-12 and §0.2's A-1…A-8 still hold.** No second signal source, no Mode 3 change, no
  `relationship_memory`, no skip-review fast path, no image generation of any kind, no media editor, no
  change to Mode 2's existing single-post or thread generation behaviour, no new runtime dependency. A fix
  that appears to need one is a **STOP and report**, not a judgement call. The five scope scans in
  `lib/scope-scans.test.ts` are live and will catch four of these mechanically — treat a red scan as the
  rule working, never as a test to relax.
- **Never weaken a test to reach green, and never delete a test to tidy code.** MINOR-2 is a test that
  passes while proving nothing; the fix is to make the file able to fail (MINOR-1's boundary rows), never
  to make more assertions of that shape.
- **New and rewritten tests must be shown to REDDEN against the pre-fix code** — mutate, observe red,
  revert — and the mutation must be *named in the commit message*. Asserted-green is not proof; §D item 1
  of the report is the reviewer saying, politely, that prose about a demonstration is not a demonstration.
- **Each step:** `/ecc:plan` → `/ecc:tdd-workflow` → `/ecc:verification-loop`;
  `npx tsc --noEmit --skipLibCheck`; scoped `npx vitest run` per CLAUDE.md's invocation notes;
  `npm run test:db` wherever Tier-1 is touched. One commit per step.
- **ECC budget: ≤1 subagent per step, and only where the step names one** — D2 `security-reviewer` (a
  guard-strength change at a prompt-injection boundary), D4 `database-reviewer` (a claim-query
  interaction), D5 `database-reviewer` (the idempotency guard), D8 `security-reviewer` (an RLS `WITH CHECK`
  case). Nothing anywhere else. Do not re-run §1's advisory reviewers.
- **The three highest-risk changes in this pass, named so nobody discovers them at D12:** D5 edits a guard
  on the path **every** campaign generates through (a wrong fix double-generates posts for real customers);
  D4 changes when a post becomes claimable by the publishing worker (a wrong fix either publishes early —
  the exact defect — or makes approved posts unpublishable); D10 changes what CI collects (a wrong fix
  hides files instead of running them, which is the `AUTHORED-NOT-EXECUTED` shape ADR 0015 exists to
  eliminate).

### §4.0 — Correction primer  (paste first · wait for acknowledgement)

```
Session 29-D — Track F: promote-to-campaign + carousel & script (ADR 0022), CORRECTION pass. You are
fixing the findings in docs/reviews/session-29-reviewer.md (reviewed range dac7ddac..4db4053f,
F1b.1…F1b.11). Thirteen steps, D0…D12, each its own commit.

Read now, before anything else:
- docs/reviews/session-29-reviewer.md — IN FULL. It is your work order AND the file you record resolutions
  in. Append a single `## CORRECTION PASS (Session 29-D)` section at the END; do NOT edit any finding in
  place, do NOT touch §10's correction table or the closing tally line, do NOT create a separate
  corrections file (CLAUDE.md REVIEWER-REPORT APPEND-ONLY). A finding you DISPUTE or DECLINE is argued in
  the appendix — never erased, never restated as resolved. There are TWENTY finding IDs (MAJOR-1..5,
  MINOR-1..8, NIT-1..7) even though the report's closing line says fifteen; you resolve all twenty and you
  do NOT correct that line in place.
- docs/build-guide/session-29.md §0 (L-1..L-12), §0.2 (A-1..A-8 — still binding, NOT reopened; A-3 in
  particular is why MAJOR-4 is an implementation step and not a question) and §4 (this section — the step
  list, adjudications A-9/A-10/A-11, and the ordering rationale).
- docs/decisions/0022-promote-to-campaign-and-format-families.md — §2.5/§2.7 (the schedule re-touch and the
  activation arithmetic MAJOR-4 and MAJOR-5 hit), §5.1/§5.2/§5.4 (the two bounds and the A-5 guard —
  MAJOR-1, MAJOR-2, NIT-7), §6.1/§6.3/§6.4 (carousel, A-10), §7.1/§7.3 (scriptBrief, A-11), §8.1/§8.2 (the
  frozen table and MODE2-PROMPT-BYTE-IDENTICAL — MINOR-1, MINOR-2, and the constraint both A-10 and A-11
  turn on), §9 (SHARED-FUNCTION CALLERS), §11 (the constraint map — three MAJORs exist because rows are
  MISSING from it), §17/§18/§19 (the self-corrections) and §20 (the Builder's close-out, NIT-2).
- docs/decisions/0018-diff-based-learning-capture.md Amendment A — A.1 (the snapshot corollary, which the
  Builder got RIGHT and you must not disturb), A.2 (the Zod bound MAJOR-2 shows never shipped) and A.3 (the
  neutralizeWithSentinels requirement MAJOR-1 shows never shipped).
- docs/decisions/0015-test-execution-and-ci-gates.md §1(c), §2 and §5 — "covered = executed green in CI,
  never authored" is the sentence MAJOR-3, MINOR-2 and MINOR-7 are each an instance of.

Binding rules for this pass:
- L-1..L-12 and A-1..A-8 still hold. No second signal source, no Mode 3 change, no skip-review fast path,
  no image generation, no media editor, no change to Mode 2's existing single-post or thread generation
  behaviour, no new runtime dependency. A fix that seems to need one is a STOP. lib/scope-scans.test.ts
  enforces four of these mechanically — a red scan is the rule working.
- A-9, A-10 and A-11 are adjudicated in §4 above. Do NOT re-litigate them. Do NOT ship half of A-9 (do not
  delete the idempotency guard, and do not special-case on campaigns.origin) — if D5 turns up evidence
  that an origin-blind guard breaks something real, STOP and report rather than quietly special-casing.
- NEVER weaken a test to reach green, and never delete a test to tidy code. Every new or rewritten test is
  demonstrated to REDDEN against the pre-fix code (mutate, observe red, revert) and the mutation is NAMED
  in the commit message.
- Each step: /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. npx tsc --noEmit --skipLibCheck;
  scoped vitest run per CLAUDE.md; npm run test:db for Tier-1.
- ECC: ≤1 subagent per step, and only where §4 names one — D2 security-reviewer, D4 database-reviewer,
  D5 database-reviewer, D8 security-reviewer. Nothing anywhere else.

Confirm these grounding facts (a wrong one is a STOP):
(1) git status — docs/reviews/session-29-reviewer.md is UNTRACKED (`??`). That is D0's scope.
(2) `git grep -n neutralizeWithSentinels -- lib app` returns hits ONLY in lib/ai/wrap-evidence.ts,
    lib/studio/guard.ts and lib/signals/triage/card.ts — nothing in lib/db/memory-performance.ts,
    lib/learning/summarize.ts or lib/learning/promote.ts. That is MAJOR-1.
(3) lib/db/memory-performance.ts:97-116 forwards insert.pattern into client.rpc(...) with no validation of
    any kind. Quote the lines. That is MAJOR-2.
(4) app/[locale]/(dashboard)/campaigns/actions.test.ts does NOT vi.mock('@/lib/db/studio-drafts') and never
    asserts clearPromotedCampaignReferenceOnDrafts is called, while actions.ts:101 calls it. Contrast with
    the clearCampaignReferenceOnCards trio at :196-198, :201-209, :211-217. That is MAJOR-3.
(5) lib/db/posts.ts:320-338 — approvePost sets { status: 'approved' } and nothing else; no approve path
    writes scheduled_at. Cross-read
    supabase/migrations/20260524230000_publishing_worker.sql:31-34's claim predicate. That is MAJOR-4.
(6) lib/campaigns/generate.ts:106-114 returns 'already_generated' whenever listPostsByCampaign is
    non-empty, and lib/campaigns/promote.ts:113-124 always writes exactly one post before generation can be
    invoked. Re-derive for yourself that generate.ts:423 is unreachable for a promoted campaign. That is
    MAJOR-5.
(7) lib/ai/generate-native.ts:106 and lib/ai/prompts/studio-suggestion.ts:142 both pass a hard-coded false,
    and generate-native.ts:133-134's `case 'carousel':` throws. That is MINOR-4 / A-10.
(8) lib/ai/prompts/formats/platform-map.frozen-table.test.ts:71-77 calls selectFormatFamily with IDENTICAL
    arguments twice and asserts equality. That is MINOR-2.
(9) vitest.config.ts's include is 'lib/**/*.test.ts' and lib/email/templates/__tests__/ contains seven
    *.test.tsx files. That is MINOR-7 (out of range, fixed anyway).
Output the twenty findings grouped by step (D0…D12), the three adjudications with their rulings, and
"Ready for D0." Then stop.
```

### §4.1 — Correction steps

#### D0 — audit trail: land the reviewer report in git, unmodified  ·  FIRST, by design  ·  no code

```
CORRECTION — Session 29-D · D0. No .ts, no .sql, no .tsx. Invoke no specialist — this is audit-trail
integrity.

THE DEFECT: docs/reviews/session-29-reviewer.md is UNTRACKED at the range head. Every step below either
amends it or cites it, and an appended resolution row against an untracked file produces no diff — which
destroys the one property REVIEWER-REPORT APPEND-ONLY exists to give a later reader: proof that nothing
above the appendix was touched.

DO — commit these files EXACTLY AS THEY STAND, with no edits in this commit:
- docs/reviews/session-29-reviewer.md   (as the Reviewer left it, before any resolution row)
- docs/build-guide/session-29.md        (it enters this commit WITH §4 already authored — §4 is this step's
                                         own work order, so it cannot land later. Say so in the commit
                                         message.)
Do NOT append the CORRECTION PASS section here. Do NOT fix NIT-2 in ADR 0022 here — that is D11.

VERIFY: `git show <D0-sha>:docs/reviews/session-29-reviewer.md` resolves and is byte-identical to the
working-tree file as the Reviewer left it (diff it); the commit contains no .ts/.sql/.tsx/.json/.yml.
On commit: "D0 complete — reviewer report and session-29.md §4 committed unmodified, before any resolution
row, so the appendix is provably additive."  Then stop.
```

#### D1 — MAJOR-1: A-5's `neutralizeWithSentinels` at the writer boundary, and the constraint that would have caught it

```
CORRECTION — Session 29-D · D1. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist here
(D2 carries the security-reviewer read for this boundary, once both halves are in place).

THE DEFECT (MAJOR-1): ADR 0018 Amendment A.3 states it without qualification — "Any pattern value whose
provenance chain touches human-authored text is guarded with neutralizeWithSentinels
(lib/ai/wrap-evidence.ts:118-132), not plain neutralize()." ADR 0022 §5.4 records the decision AND
EXPLICITLY DECLINES the "document the residual as an accepted carve-out" loser, on the ground that "the
wider guard already exists and the cost of calling it is one function swap." It was never called. A-5 is a
founder adjudication; §5.4's own argument is that the length bound closes the COST problem and leaves the
GUARD-STRENGTH gap open — saveStudioDraftAction validates with a bare z.string(), so manually-saved content
(exactly what promote reads) is unguarded, and the performance_memory → post-generation.ts:179 sink still
routes through the weaker neutralize().

DO:
1. Apply neutralizeWithSentinels at the WRITER boundary for the pattern path — lib/db/memory-performance.ts
   (the upsert), and the two producers lib/learning/summarize.ts and lib/learning/promote.ts wherever they
   compose a pattern value from human-authored provenance. Read wrap-evidence.ts:108-132 first and use the
   EXISTING function; do not write a second guard.
2. Name the constraint. ADR 0022 §11.1 gets MEM-PATTERN-SENTINEL-GUARDED (Tier 2), and §20.1's map gets its
   row with an honest "reddens if" column. This is half the fix, not paperwork: the reviewer's own
   diagnosis is that with no step and no constraint, the absence could not redden anything.
3. Tier-2 test: a pattern value carrying a sentinel-class payload is neutralised at the writer, and the
   test REDDENS when the call is swapped back to neutralize(). Demonstrate that mutation and name it in the
   commit message.

DO NOT: touch the CHECK constraint or its Tier-1 test (§A3 — it is correct); change guardStudioField's
suggest-time behaviour; alter what post-generation.ts:179 reads (that sink is downstream of this fix).

VERIFY: tsc; npx vitest run lib/db lib/learning lib/ai; the named mutation observed red then reverted.
On commit: "D1 — MAJOR-1 closed: A-5's neutralizeWithSentinels applied at the writer boundary;
MEM-PATTERN-SENTINEL-GUARDED added to ADR 0022 §11.1/§20.1; reddens when swapped to neutralize()."
Then stop.
```

#### D2 — MAJOR-2 + NIT-4 + NIT-7: the bounds step — promoter-level Zod, an honest catch, and `accepted_revision`

```
CORRECTION — Session 29-D · D2. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
security-reviewer ONCE, read-only, after the code is written: this is the writer boundary a prompt-injection
payload reaches, and D1 + D2 together are the whole of it.

THE DEFECTS:
- MAJOR-2. ADR 0018 Amd A.2: the bound is "enforced by a CHECK constraint … WITH A ZOD BOUND AT
  upsertDistilledPerformancePattern IN FRONT OF IT". §5.2 opens with the same sentence and is explicit that
  these are "two different guarantees at two boundaries — input hygiene and a durable-storage invariant —
  not redundancy." memory-performance.ts:97-116 contains no validation at all. The consequence is now
  sharper than when §5.2 was written: F1b.10's per-statement try/catch (summarize.ts:157-183) SWALLOWS a
  CHECK rejection into a counter, so the DB-level bound is the last barrier and its failure is no longer
  loud.
- NIT-4. summarize.ts:176's `catch (err)` absorbs a transient DB or network failure into
  statementsRejected, where §5.3's semantics reserve "rejected" for "over the bound".
- NIT-7. studio_drafts.accepted_revision is `text NULL`, unbounded, and flows verbatim into
  post_ai_originals.rendered_content and payload (promote.ts:145-146). §5.1 applied max(5000) to
  posts.content for exactly this class of reason; the write site (studio-drafts.ts:196-203) is fed from a
  bare z.string().

DO:
1. A Zod bound at upsertDistilledPerformancePattern, with a Tier-2 test that REDDENS when it is removed —
   and LABELLED as proving the PROMOTER bound, never as proving the CHECK (§18.1's binding consequence: a
   Tier-2 test must never be cited as evidence for a Tier-1 constraint). Constraint name:
   MEM-PATTERN-PROMOTER-BOUNDED, added to §11.1 and §20.1.
2. Narrow the catch: distinguish a CHECK rejection (Postgres error code / constraint name
   performance_memory_pattern_length_check) from any other failure. A bound rejection increments
   statementsRejected; anything else keeps its existing Sentry path and is counted separately or rethrown —
   state which in the ADR §17 line, and do not silently widen what "rejected" means.
3. Bound accepted_revision: a Zod max on the save path (matching §5.1's posts.content contract) and, in the
   SAME step, decide and record whether the column gets a CHECK. If yes it is one additive migration
   written NOT VALID + VALIDATE as two statements, matching 20260822093000's shape; if no, §5.1 gets an
   appended line saying why the app-layer bound suffices here. Either is acceptable; silence is not.

DO NOT: change the CHECK bound's VALUE (500) or its Tier-1 test; conflate the promoter bound and the CHECK
in any test title, comment or ADR row.

VERIFY: tsc; npx vitest run lib/db lib/learning; npm run test:db if a migration lands; both named mutations
observed red then reverted. Then security-reviewer, read-only, on the D1+D2 diff.
On commit: "D2 — MAJOR-2, NIT-4, NIT-7 closed: promoter-level Zod bound in front of the RPC
(MEM-PATTERN-PROMOTER-BOUNDED), the summarizer's catch narrowed to CHECK rejections, accepted_revision
bounded."  Then stop.
```

#### D3 — MAJOR-3 + NIT-3: the call site gets the test the function already has

```
CORRECTION — Session 29-D · D3. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist: this
is three Tier-2 cases mirroring an existing trio.

THE DEFECT (MAJOR-3): PROMOTE-SOFTDELETE-CLEARED (supabase/__tests__/studio-promote-claim.test.ts:174-204)
invokes clearPromotedCampaignReferenceOnDrafts DIRECTLY. It reddens if the FUNCTION is removed and stays
green if the CALL SITE (campaigns/actions.ts:101) is removed. Deleting that one line reintroduces the exact
Session-28-D D7 bug with a fully green suite — the SHARED-FUNCTION CALLERS failure shape, landing on the
very function added to prevent a repeat of it. The sibling it mirrors, clearCampaignReferenceOnCards, is
covered three ways in the same file: called (:196-198), throw-tolerated (:201-209), and
not-called-when-the-delete-guard-fails (:211-217).

DO:
1. In app/[locale]/(dashboard)/campaigns/actions.test.ts, add vi.mock('@/lib/db/studio-drafts') and THREE
   cases on deleteCampaignAction mirroring the trio exactly: (a) the cleanup is called with the deleted
   campaign's id, (b) a throw from it does not fail the delete, (c) it is NOT called when
   softDeleteCampaignGuarded's guard fails.
2. Demonstrate all three REDDEN by deleting actions.ts:101, then revert. Name that mutation in the commit
   message — it is the whole point of the step.
3. §20.1's PROMOTE-SOFTDELETE-CLEARED row gets an appended note distinguishing what the Tier-1 case proves
   (the function) from what the new Tier-2 cases prove (the wiring). Do not overwrite the reviewer's
   correction table — that lives in the review file and it stays as written.
4. NIT-3 (the new console.error at actions.ts:103): this is expected to be ARGUED AND DECLINED — it is a
   server-side Server-Action error log immediately mirroring the pre-existing line at :93, and CLAUDE.md's
   carve-out covers exactly this house pattern. Write the argument in the appendix row; do not change the
   line just to close a row. If you conclude otherwise, say why there instead.

VERIFY: tsc; npx vitest run app/[locale]/(dashboard)/campaigns; the deletion of actions.ts:101 observed red
across all three cases, then reverted.
On commit: "D3 — MAJOR-3 closed: deleteCampaignAction's cleanup wiring covered three ways, each shown to
redden when actions.ts:101 is deleted. NIT-3 argued and declined (house carve-out)."  Then stop.
```

#### D4 — MAJOR-4: A-3's second half — approve re-touches `scheduled_at`, and a past date cannot publish

```
CORRECTION — Session 29-D · D4. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer ONCE, read-only, on the claim-predicate interaction before you commit.

THE DEFECT (MAJOR-4): §0.2 A-3 ruled "The user picks scheduled_at, AND APPROVE MUST RE-TOUCH IT." The first
half shipped (PromoteDraftDialog.tsx:83-90, promote.ts:120). The second did not: lib/db/posts.ts:320-338
sets { status: 'approved' } and nothing else. claim_posts_for_publishing
(20260524230000_publishing_worker.sql:31-34) claims on status = 'approved' AND scheduled_at <= p_now, so a
user who promotes on 2026-08-23 choosing 2026-09-01 and approves on 2026-09-05 publishes on the next cron
tick — [db-Q1]'s surprise-publish reached by a different route. A user-chosen date NARROWS the window; it
does not close it, because nothing requires the chosen date still to be in the future at approval time.
This is not an adjudication: A-3 already decided it. It shipped half-implemented because §11.1/§11.2 named
NO constraint for the re-touch and §2b's F1b.4 row repeated only the "user-chosen" half.

DO:
1. Make the approve path re-touch scheduled_at. The shape: approve REFUSES a scheduled_at that is already
   in the past and returns a TYPED outcome the UI renders (one of §10's states — the user re-picks a future
   time, which is then written ATOMICALLY with the status flip in the same conditional UPDATE, per
   CLAUDE.md's atomic-state-transition rule). The NAMED LOSER is silently bumping a past date to
   now + some lead: it publishes content at a time the user never chose, which is the same defect wearing a
   friendlier face. If implementation shows the refusal shape cannot be made atomic, STOP and report — do
   not fall back to the bump.
2. Name the constraint: PROMOTE-SCHEDULE-RETOUCHED in §11.1, Tier 1, with its §20.1 row.
3. TIER-1 test (live Postgres, not a mock): a promoted post whose chosen time has passed, approved after
   that time, is NOT claimable by claim_posts_for_publishing on the next tick. Plus the positive case — a
   future time approved normally IS claimable when it arrives.
4. i18n: the new state's strings land in en, pt and es SIMULTANEOUSLY (CLAUDE.md).

DO NOT: change claim_posts_for_publishing itself; change scheduling behaviour for non-promoted posts
(assert byte-identity for the ordinary approve path in the same test file); touch posts DDL beyond what
this needs — POSTS-DDL-UNMODIFIED is a live scan and a red there is the rule working.

VERIFY: tsc; npx vitest run lib/db app; npm run test:db; the Tier-1 case shown to redden against the
pre-fix approvePost, then reverted. Then database-reviewer, read-only.
On commit: "D4 — MAJOR-4 closed: A-3's second half shipped — approve re-touches scheduled_at and refuses a
past time; PROMOTE-SCHEDULE-RETOUCHED proved Tier-1 against claim_posts_for_publishing."  Then stop.
```

#### D5 — MAJOR-5 / A-9: a promoted campaign can generate, and §2.7's arithmetic becomes reachable

```
CORRECTION — Session 29-D · D5. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
database-reviewer ONCE, read-only, before committing — this edits a guard every campaign in the product
passes through, and it is the highest-blast-radius change in the pass.

THE DEFECT (MAJOR-5): lib/campaigns/generate.ts:106-114 is an unconditional idempotency guard — any
existing post makes generatePostsForCampaign return 'already_generated'. A promoted campaign ALWAYS holds
exactly one post before generation can be invoked (promote.ts:113-124), so every promoted campaign returns
'already_generated' forever, activateCampaign at :423 is never reached, and the campaign stays
awaiting_brief permanently. §2.7's postsCreated + existingPosts.length can therefore only ever evaluate
with existingPosts.length === 0 — correct in principle, dead in practice — and ACTIVATE-PLANNED-UNCHANGED
proves a now-unreachable guarantee. The user gets a brief they must review whose only possible outcome is a
stuck campaign.

A-9 RULES: the guard counts GENERATED posts, not all posts. The promoted snapshot post is not one of them.
DO NOT delete the guard (that removes double-generation protection for every campaign), and DO NOT
special-case on campaigns.origin = 'studio_promoted' (it makes correctness depend on a value the promote
path writes, so a future origin silently gets the wrong behaviour). If an origin-blind discriminator turns
out not to exist in the schema, STOP and report rather than reaching for origin.

DO:
1. Implement the guard change in lib/campaigns/generate.ts.
2. Tier-2: a promoted campaign generates, reaches activateCampaign, and lands total_posts_planned =
   brief-derived N + 1 — §2.7's arithmetic, now on the live path. Keep ACTIVATE-PLANNED-UNCHANGED and add
   the reachable case beside it; do not repurpose the existing test.
3. Tier-2 BYTE-IDENTITY for non-promoted campaigns: a campaign with generated posts still returns
   'already_generated'. This assertion is REQUIRED, not optional — it is the regression this step could
   cause.
4. Tier-1: extend studio-promote-brief-end-to-end.test.ts so a promoted campaign is driven through brief →
   generation → activation and ends `active`, not `awaiting_brief`.
5. ADR 0022 §2.7 gets an APPENDED amendment recording A-9: the arithmetic is live, why the guard was
   origin-blind, and the named loser (single-post-by-design + withdraw §2.7).

VERIFY: tsc; npx vitest run lib/campaigns app; npm run test:db; both new cases shown to redden against the
pre-fix guard, then reverted. Then database-reviewer, read-only.
On commit: "D5 — MAJOR-5 closed (A-9): the idempotency guard counts generated posts, so a promoted campaign
generates and activates; §2.7's arithmetic is now the live path; non-promoted byte-identity asserted."
Then stop.
```

#### D6 — MINOR-4 + MINOR-5 / A-10 + A-11: the two frozen-fixture collisions, ruled the same way  ·  documentation only

```
CORRECTION — Session 29-D · D6. No .ts, no .sql, no .tsx — ADR text only (the one exception is named
below). No specialist.

THE DEFECTS: two findings, one collision.
- MINOR-4 (A-10). §6.3 says carouselRequested is "sourced from the brief, the deterministic Tier-0 input
  that already drives generation." Nothing reads the brief: generate-native.ts:106 and
  studio-suggestion.ts:142 both pass a hard-coded false, and generate-native.ts:133-134's
  `case 'carousel':` THROWS. CarouselOutputSchema and validateCarouselPolicy have no production caller.
  §6.4 is written as "what carousel ships as" and §15.2's deferral covers only image generation, so
  "carousel is authored but unreachable" is recorded nowhere.
- MINOR-5 (A-11). §7.1 requires scriptBrief to be GENERATED; §8.2's MODE2-PROMPT-BYTE-IDENTICAL forbids
  changing the prompts. schemas.ts:9-29 records the Builder choosing §8.2 IN A SOURCE COMMENT. The field is
  .nullish(), nothing ever writes it, SCRIPT-BRIEF-BOUNDED passes over a field no production path
  populates, and §7.3's rendering is unreachable.

Both are the same shape — a §6/§7 requirement against §8.2's frozen fixtures — and §4's adjudications rule
them the same way ON PURPOSE, so the next session reads one decision rather than re-deriving the conflict.

DO — append-only amendments to docs/decisions/0022-…md, in the ADR 0014 Amendment A house form:
1. §6.3: the FAMILY, schema, policy and platform-map rows shipped; the SOURCING is deferred. State the
   revival condition in §15 explicitly (the first session permitted to re-freeze the Mode 2 prompt
   fixtures, or a brief field that carries the dimension without touching a prompt). State that
   CAROUSEL-SCHEMA-STRUCTURAL and CAROUSEL-POLICY-SEQUENCE currently redden over code with no production
   caller, and that this is now a recorded decision rather than drift.
2. §7.1: §8.2 WINS and §7.1 YIELDS, explicitly. scriptBrief ships as a schema-and-render-ready field that
   no prompt yet populates; §15 carries the same revival condition. Say plainly that the Builder's
   engineering call was right and that what was missing was the ruling.
3. §15 gets both revival conditions as numbered items, in the form the next gap analysis can read without
   opening this ADR.
4. Move the substance of schemas.ts:9-29's comment INTO the ADR (a source comment is not a decision record)
   and leave the comment pointing at the ADR section. That comment edit is the ONLY source change permitted
   in this step.

DO NOT: wire carouselRequested from the brief; change any prompt; add a prompt fixture; delete scriptBrief,
CarouselOutputSchema or validateCarouselPolicy. Any of those is an L-1 STOP in a correction pass.

VERIFY: no .ts/.sql/.tsx in the diff except the schemas.ts comment; tsc; npx vitest run lib/ai still green.
On commit: "D6 — MINOR-4, MINOR-5 closed (A-10, A-11): carousel's brief-sourcing and scriptBrief's
generation both recorded as deferred against §8.2's frozen fixtures, with revival conditions in §15."
Then stop.
```

#### D7 — MINOR-1 + MINOR-2 + NIT-1 + NIT-6: the frozen table actually spans the threshold

```
CORRECTION — Session 29-D · D7. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist.

THE DEFECTS — one file pair, one constraint (MODE2-FORMAT-SELECTION-UNCHANGED):
- MINOR-1. §8.2 requires a table enumerating every (platform, estimatedTweetsWorth, carouselRequested)
  combination ACROSS THE EXISTING DOMAIN. The shipped table uses LOW_VOLUME = 1 and HIGH_VOLUME = 5
  (platform-map.frozen-table.test.ts:38-39) and never touches the boundary at 3, so editing
  platform-map.ts:33's `>= 3` to `>= 2` or `>= 4` leaves all twenty rows green. The threshold survives only
  in platform-map.test.ts:17-21 — the CO-EDITABLE file §8.1 named as the weaker instrument, which is
  exactly the risk the frozen table was created to remove.
- MINOR-2. platform-map.frozen-table.test.ts:71-77 calls selectFormatFamily(platform, LOW_VOLUME, false)
  TWICE and asserts the two results are equal, under a title claiming it "restates the byte-identical
  claim". It asserts nothing and cannot redden — the false-green shape under ADR 0015, in a required job.
- NIT-1. §18.3 and §2b's F1b.7 say "TEN two-argument call sites"; the file has ELEVEN (the final it block
  has two calls on one line). A miscount inside the section written to correct a miscount of the same file.
- NIT-6. platform-map.ts:27-28's comment cites generate-native.ts:98 and studio-suggestion.ts:136; the real
  lines are :106 and :142. §20.3's table is right; only the in-code comment is stale.

DO:
1. Extend the frozen table to include the boundary: 2, 2.9 and 3 at minimum, for every platform and both
   carouselRequested values. Then DEMONSTRATE that changing `>= 3` to `>= 2` and to `>= 4` each reddens the
   FROZEN TABLE (not merely platform-map.test.ts), and name both mutations in the commit message.
2. Delete the tautological assertion at :71-77, or replace it with one that can fail. Do not keep it and
   add a comment — a green test that cannot redden is the thing being fixed. If you replace it, its title
   must describe what it actually asserts.
3. Correct "ten" → "eleven" in ADR 0022 §18.3 and §2b's F1b.7 row, as an APPENDED correction note in the
   ADR (§18 is itself a self-correction section; keep its form).
4. Fix platform-map.ts:27-28's line citations.

DO NOT: change any selectFormatFamily behaviour; change platform-map.test.ts's existing expectations (§A4
verified that diff is arity-only and MODE2-FORMAT-SELECTION-UNCHANGED depends on it staying that way).

VERIFY: tsc; npx vitest run lib/ai; both threshold mutations observed red on the FROZEN TABLE, then
reverted.
On commit: "D7 — MINOR-1, MINOR-2, NIT-1, NIT-6 closed: frozen table spans the >= 3 boundary and reddens on
a threshold edit; the tautological assertion removed; the eleven-call-site count and the stale comment
citations corrected."  Then stop.
```

#### D8 — MINOR-3 + MINOR-8: the promote path under conditions nobody drove it through

```
CORRECTION — Session 29-D · D8. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. Invoke
security-reviewer ONCE, read-only, on the RLS case.

THE DEFECTS:
- MINOR-3. §11.1 states PROMOTE-RLS-ISOLATED as "mirrored both directions … with USING AND WITH CHECK on
  UPDATE", and CLAUDE.md makes WITH CHECK the tenant-tunnelling guard specifically. The four shipped cases
  (studio-promote-schema.test.ts:90,111,132,157) are cross-tenant SELECT ×2 and cross-tenant UPDATE ×2 —
  all USING-side. No case attempts the WITH CHECK violation: updating a row you CAN see so that it lands in
  another tenant.
- MINOR-8. claimStudioDraftForPromotion (studio-drafts.ts:240-278) runs BEFORE promoteDraftToCampaignCore's
  try block (promote.ts:80,101), and its fallback re-read at :270-276 uses .single() — which errors and is
  rethrown if the draft was soft-deleted or removed between page load and submit. The Server Action wrapper
  (studio/actions.ts:334-350) has no try/catch either, so that path renders Next's generic error boundary
  instead of one of §10's seven states.

DO:
1. Add a Tier-1 WITH CHECK case: a signed-in tenant updates a row it legitimately sees, attempting to move
   it into another business_id, and is refused. Demonstrate it REDDENS when the WITH CHECK clause is
   dropped from the policy locally, then revert. Record in §20.1 that PROMOTE-RLS-ISOLATED now proves both
   clauses.
2. Make a deleted or missing draft a TYPED outcome (.maybeSingle() plus an explicit typed result), rendered
   as a §10 state, with a Tier-2 test. i18n in en, pt and es simultaneously. Constraint name:
   PROMOTE-MISSING-DRAFT-TYPED in §11.1 with its §20.1 row.
3. Keep the claim's atomicity exactly as it is — §C.2 verified the conditional UPDATE, the typed
   already_promoted / claimed_by_another split and the IS NULL-guarded write-back are all correct. This
   step adds a fourth outcome; it does not restructure the three that work.

VERIFY: tsc; npx vitest run lib/campaigns app components; npm run test:db; both mutations observed red then
reverted. Then security-reviewer, read-only.
On commit: "D8 — MINOR-3, MINOR-8 closed: PROMOTE-RLS-ISOLATED now proves WITH CHECK as well as USING; a
deleted draft returns a typed §10 state instead of Next's error boundary."  Then stop.
```

#### D9 — MINOR-6 + NIT-5: the preview surface stops truncating, and renders what the schema added

```
CORRECTION — Session 29-D · D9. /ecc:plan → /ecc:tdd-workflow → /ecc:verification-loop. No specialist.

THE DEFECTS:
- MINOR-6. lib/db/post-ai-originals.ts:76-85 orders by post_id ASC, revision DESC and caps at
  .limit(postIds.length * 20). The cap is a PER-LIST heuristic, not a per-post one: one post with more than
  20 revisions consumes the others' budget, and because the ordering is post_id-major the posts sorted last
  fall off the result entirely — their preview renders nothing, with no error.
  createNextPostAiOriginalRevision increments on EVERY regeneration, so >20 revisions on one post is
  reachable.
- NIT-5. schemas.ts:71-77 gives every carousel slide its own imageBrief on §6.1's explicit design;
  AiOutputPreview.tsx:41-49 renders slide.role and slide.text only.

DO:
1. Make the read per-post-bounded — an RPC using DISTINCT ON (post_id) is the shape the reviewer names, and
   it fits CLAUDE.md's "list queries always have a limit and an explicit ORDER BY matching an index". If a
   DISTINCT ON RPC is chosen it is one additive migration; if instead you detect truncation and surface it,
   the detection must be ASSERTED, not logged. Silent absorption is what is being fixed.
2. Tier-2 (or Tier-1 if the RPC lands): N posts where one carries >20 revisions, and EVERY post still gets
   its latest revision. Demonstrate it reddens against the pre-fix read.
3. Render per-slide imageBrief in AiOutputPreview, alongside role and text, with the same
   "recommendation, never published" framing §7.3 already establishes and its aria treatment; i18n keys in
   en, pt, es simultaneously. Assert it in the AiOutputPreview / StudioEditor tests.

DO NOT: change what is published; add image generation of any kind (MODE2-CAROUSEL-NO-IMAGE-GEN is a live
scan — a red there is the rule working, not a test to relax); change the never-published scan's allowlist.

VERIFY: tsc; npx vitest run lib/db components app; npm run test:db if a migration lands; the named mutation
observed red then reverted.
On commit: "D9 — MINOR-6, NIT-5 closed: the AI-originals preview read is per-post bounded and cannot
silently truncate; per-slide imageBrief is rendered as a never-published recommendation."  Then stop.
```

#### D10 — MINOR-7: seven authored test files that no CI job has ever run  ·  out of range, fixed anyway

```
CORRECTION — Session 29-D · D10. /ecc:plan → /ecc:verification-loop. No specialist. Deliberately LAST among
the code steps.

THE DEFECT (MINOR-7, pre-existing and OUT OF RANGE — the reviewer flagged it without charging it to this
session, and founder direction fixes it anyway): vitest.config.ts's include is 'lib/**/*.test.ts', which
does not match .test.tsx. lib/email/templates/__tests__/ contains SEVEN *.test.tsx files —
first-post-published, layout, payment-failed-courtesy, team-invite, trial-warning-t1, trial-warning-t3,
welcome-to-plan. They are authored, they are not excluded by name, and the skip-guard cannot see them
because vitest never collects them: INVISIBLE to the guard rather than caught by it. That is precisely the
AUTHORED-NOT-EXECUTED set ADR 0015 exists to eliminate, and it is why the 219 count reconciled.

DO:
1. Extend the include to collect .test.tsx under lib/** (mirroring however app/** and components/** already
   collect theirs — read vitest.config.ts before changing it, and change the MINIMUM that works).
2. Run them. If any are RED, that is a DISCOVERY, not a regression of this pass: report the failures, fix
   only what is genuinely broken, and if a file cannot be made green in this step, EXCLUDE IT BY NAME WITH
   A WRITTEN REASON and a follow-up line in docs/current-phase.md. An unexplained exclusion is the same
   defect with better manners.
3. Re-read the skip-guard count after the change and record the new number — it must move, and the amount
   it moves by is the evidence the fix worked.

DO NOT: entangle this with any Session 29 fix; touch any test's assertions to make it pass.

VERIFY: npx vitest run lib (the seven files now collected and listed by name in the output); tsc.
On commit: "D10 — MINOR-7 closed (out of range, fixed anyway): vitest now collects lib/**/*.test.tsx; the
seven email-template test files execute for the first time; skip-guard count moves from 219 to <N>."
Then stop.
```

#### D11 — documentation truth, and the appendix  ·  no code

```
CORRECTION — Session 29-D · D11. No .ts, no .sql, no .tsx. No specialist.

DO:
1. NIT-2. ADR 0022 §20's table calls b01a9985 "the current range head". It was when written; the head is
   4db4053f. Correct it in the APPENDED house form (§20 is the Builder's close-out — append, do not rewrite
   history), stating precisely what is true: CI ran at b01a9985, 4db4053f is docs-only, so the evidence
   covers all code at that head — and after D12 it is superseded by the corrected head's runs.
2. §11 and §20.1 now carry the new constraint rows from D1, D2, D4, D5 and D8
   (MEM-PATTERN-SENTINEL-GUARDED, MEM-PATTERN-PROMOTER-BOUNDED, PROMOTE-SCHEDULE-RETOUCHED,
   PROMOTE-MISSING-DRAFT-TYPED, plus the PROMOTE-SOFTDELETE-CLEARED and PROMOTE-RLS-ISOLATED notes).
   Verify every one is present with an honest "reddens if" column, and add the one-line process finding
   this pass produced: A REQUIREMENT THAT NAMES NO CONSTRAINT IN §11 IS A REQUIREMENT THAT WILL NOT SHIP —
   three of the five MAJORs are that sentence. Put it in §11's preamble where the next Architect reads it,
   not in a commit message.
3. THE APPENDIX. Append the single `## CORRECTION PASS (Session 29-D)` section to the END of
   docs/reviews/session-29-reviewer.md — author, date, the commit range fixed, then TWENTY rows
   (MAJOR-1..5, MINOR-1..8, NIT-1..7), each recording finding → fix → the test that now proves it → commit
   SHA. NIT-3 is argued and declined. Include a row-zero note arguing that the report's closing tally
   ("15 findings") does not match its own twenty IDs — ARGUED, NEVER EDITED. Not one character above the
   appendix changes: verify with `git diff <D0-sha>..HEAD -- docs/reviews/session-29-reviewer.md` and read
   the hunk headers — every hunk must be an addition at the end of the file.
4. §5 of docs/build-guide/session-29.md: work the close-out checklist, including the ADR 0019 / 0017 / 0018
   amendment items and the gap-analysis refresh with its EMBEDDINGS_UNDEFER_THRESHOLD attribution fix.
5. docs/current-phase.md: the Session 29 entry — Track F closed, the correction pass named, the D10
   discovery recorded, and the db-tests tally counting MASTER RUNS ONLY.
6. .wolf/anatomy.md, .wolf/memory.md, .wolf/cerebrum.md per the OpenWolf protocol; .wolf/buglog.json for
   the defects fixed in D1–D9.

VERIFY: the append-only diff check above; no .ts/.sql/.tsx in this commit.
On commit: "D11 — documentation truth: NIT-2 corrected, the new §11/§20.1 constraint rows verified, and the
single append-only CORRECTION PASS appendix written with all twenty finding rows."  Then stop.
```

#### D12 — CI at the corrected head, and close-out

```
CORRECTION — Session 29-D · D12. No specialist. This step's job is not merely to re-green: it is to produce
the green run FOR THE CORRECTED RANGE, which is what makes NIT-2's re-citation true rather than reworded.

DO:
1. Push the corrected range. Run app-tests and db-tests to completion at the corrected HEAD.
2. Read BOTH runs' logs — do not infer. Quote the skip-guard lines VERBATIM ("skip-guard: N file(s) under
   [...] all visible, zero failures — green. (X/Y tests passed)"), for both jobs. A zero anywhere in those
   counts is a false-green and a STOP.
3. Confirm the file counts moved as expected: supabase/__tests__ grows by the Tier-1 files D4/D5/D8/D9
   added, and the app-tests count reflects D10's newly collected .test.tsx files. A count that did NOT move
   is evidence a new test is not being collected — investigate before recording anything.
4. Record the run URLs and counts in ADR 0022 §20 (appended), in docs/current-phase.md, and in the
   appendix's closing line, all citing the SAME corrected head SHA.
5. The db-tests three-green promotion tally counts MASTER RUNS ONLY. If this pass's runs are branch runs,
   say so explicitly rather than advancing the tally.

VERIFY: both runs conclusion: success at the corrected head; every quoted count non-zero; the three
documents cite one identical SHA.
On commit: "D12 — Session 29-D complete: CI green at the corrected head, run URLs and verbatim skip-guard
counts recorded in ADR 0022 §20, current-phase.md and the correction appendix."  Then stop.
```

### §4.2 — Resolution log (the appendix's index — twenty rows, one per finding ID)

The appendix in `docs/reviews/session-29-reviewer.md` is the authoritative record; this table is the index
a reader of the build guide uses to confirm **nothing was lost between the report and the pass**. Fill the
last two columns as each step lands.

| ID | Step | Fix in one line | Test that now proves it | SHA |
|---|---|---|---|---|
| MAJOR-1 | D1 | `neutralizeWithSentinels` at the writer boundary; `MEM-PATTERN-SENTINEL-GUARDED` named in §11 | `lib/db/memory-performance.test.ts` (mocked-client, `client.rpc` payload assertion) | `cd95aee9` |
| MAJOR-2 | D2 | Promoter-level Zod bound in front of the RPC; `MEM-PATTERN-PROMOTER-BOUNDED` | `lib/db/memory-performance.test.ts` (501/500-char boundary cases) | `1ff244ba` |
| MAJOR-3 | D3 | Three Tier-2 cases on `deleteCampaignAction`'s cleanup **call site** | `app/[locale]/(dashboard)/campaigns/actions.test.ts` | `01512728` |
| MAJOR-4 | D4 | Approve re-touches `scheduled_at` and refuses a past time; `PROMOTE-SCHEDULE-RETOUCHED` | `lib/db/posts.test.ts` + `supabase/__tests__/posts-approval-boundary.test.ts` (Tier-1) | `6ab2e391` |
| MAJOR-5 | D5 | A-9 — the idempotency guard counts **generated** posts; promoted campaigns activate | `lib/campaigns/generate.test.ts` + `supabase/__tests__/studio-promote-brief-end-to-end.test.ts` (Tier-1) | `0f1a125f` |
| MINOR-1 | D7 | Frozen table spans the `>= 3` boundary (2, 2.9, 3) | `platform-map.frozen-table.test.ts` | `40786c76` |
| MINOR-2 | D7 | The tautological assertion removed or replaced with one that can fail | `platform-map.frozen-table.test.ts` (deletion; remaining per-cell assertions) | `40786c76` |
| MINOR-3 | D8 | Tier-1 `WITH CHECK` case added to the promote RLS suite | `supabase/__tests__/studio-promote-schema.test.ts` (Tier-1) | `d140f4b7` |
| MINOR-4 | D6 | A-10 — carousel's brief-sourcing recorded as deferred, revival condition in §15 | ADR — no test | `3b1a1985` |
| MINOR-5 | D6 | A-11 — §8.2 wins, §7.1 yields, revival condition in §15 | ADR — no test | `3b1a1985` |
| MINOR-6 | D9 | Per-post-bounded AI-originals read; truncation impossible, not absorbed | `supabase/__tests__/post-ai-originals-latest-per-post.test.ts` (Tier-1, new file) | `50f3b1e8` |
| MINOR-7 | D10 | `vitest.config.ts` collects `lib/**/*.test.tsx`; seven files execute | the seven `lib/email/templates/__tests__/*.test.tsx` files themselves | `99982288` |
| MINOR-8 | D8 | Deleted/missing draft returns a typed §10 state; `PROMOTE-MISSING-DRAFT-TYPED` | `supabase/__tests__/studio-promote-claim.test.ts` (Tier-1) + `promote.test.ts` + `studio/actions.test.ts` + `StudioEditor.test.tsx` | `d140f4b7` |
| NIT-1 | D7 | "ten call sites" → eleven, in §18.3 and §2b | ADR — no test (verified by `grep -c`, 11 matches) | `40786c76` |
| NIT-2 | D11 | §20's "current range head" corrected, then superseded by D12's runs | ADR — no test | `6f67fda6` (superseded `8d506634`/`30281de7`) |
| NIT-3 | D3 | **Argued and declined** — server-side Server-Action log, CLAUDE.md carve-out | none — argued | `01512728` |
| NIT-4 | D2 | Summarizer's catch narrowed to CHECK rejections | `lib/learning/summarize.test.ts` | `1ff244ba` |
| NIT-5 | D9 | Per-slide `imageBrief` rendered | `app/[locale]/(dashboard)/approvals/AiOutputPreview.test.tsx` | `50f3b1e8` |
| NIT-6 | D7 | `platform-map.ts:27-28`'s stale line citations fixed | none — comment (verified by `grep -n` against both call sites) | `40786c76` |
| NIT-7 | D2 | `accepted_revision` bounded (Zod, and a CHECK or a written reason) | `app/[locale]/(dashboard)/studio/actions.test.ts` | `7a68817a` (D2 follow-up) |

**Plus one non-finding row, argued in the appendix and edited nowhere:** the report's closing tally line
says *"15 findings (0 BLOCKER, 5 MAJOR, 6 MINOR, 4 NIT)"* against **twenty** finding IDs in its own body.
The findings are right; the arithmetic is not; **the reviewer's text stands as written.**

### §4.3 — What this pass does NOT do

- **It does not re-review.** There is no independent F1d pass (the 23-D…28-D precedent). D12's evidence and
  the appendix are what the founder adjudicates.
- **It does not reopen L-1…L-12 or A-1…A-8.** A-3 in particular is *implemented* by D4, not reconsidered.
- **It does not close the two standing, declared gaps** — `upsertDistilledPerformancePattern`'s two
  production callers remain mocked (§A2), and the five scans' redden demonstrations remain recorded in
  prose (§D item 1). Both were correctly declared by the Builder and neither is a Session 29 regression. If
  the founder wants either closed, it is a named step in the next session, not an unlogged extra here.
- **It does not touch the `db-tests` promotion tally by argument** — only genuine `master` runs move it.

---

## §5 — Docs to update at close-out (Track F done)

- [x] `docs/current-phase.md` — the Session 29 entry closing Track F; the `db-tests` promotion tally with
      run URLs and the skip-guard's file/test counts **quoted verbatim from the log line**, not summarized.
      Note that Step 0 already moved the tally to 1 of 3; this session's `master` runs may move it further
      — count only genuine `master` runs.
      **Done (D11/D12):** Session 29 entry added, D10/D12 sub-entries with verbatim skip-guard lines and
      run URLs. Tally explicitly NOT moved by D12's runs (`pull_request`-event, not `master`); stays at the
      5-consecutive count recorded as of `e69e5c41`.
- [x] `docs/decisions/0022-promote-to-campaign-and-format-families.md` — status / close-out block (§15),
      amended by the correction pass if it changed anything the ADR asserts.
      **Done (D6/D11/D12):** §15 items 9/10 (carousel/script revival conditions, D6); §20.4 (NIT-2, D11);
      §20.5 (D12's CI results, this pass's actual close-out).
- [x] `docs/decisions/0018-diff-based-learning-capture.md` — the additive `generation_kind` amendment in
      place, with its line range cited.
      **Confirmed already done** (Amendment A, §992-996, pre-dating this correction pass — no change needed).
- [x] `docs/decisions/0019-mode-1-studio.md` — §15 item 1 (promote-to-campaign) and item 10 (the
      `topContent` write-time bound) marked as **closed by ADR 0022**, with the ADR and session named.
      Appended, not rewritten.
      **Confirmed already done** (§956-960, pre-dating this correction pass — no change needed).
- [x] `docs/decisions/0017-mode-2-upgrade.md` — §15's D-6 deferral marked **partially** closed by ADR 0022:
      **carousel closed** as a format family; **script re-deferred as a family** with its new revival
      condition, and its recommendation-field form recorded as what shipped instead. Appended, not
      rewritten — and do not let it read as "carousel/script closed", which would be false.
      **The skip-review fast path (L-11) stays deferred** — confirm it was not touched.
      **Done (D11):** Amendment C appended, stating exactly this partial-closure framing; L-11 confirmed
      untouched.
- [x] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — a new cascade row **if** a new
      business-scoped table landed; an explicit note that none was required **if** the change was a column
      on an already-covered table (the Session 28-D D7 precedent).
      **Done (D11):** no new table landed (three columns on the already-covered `studio_drafts`, plus D9's
      new FUNCTION which carries no cascade obligation) — a confirmation note appended, no new row.
- [x] `docs/brainstorm/plan-vs-implemented-gap-analysis.md` — refreshed, or superseded by a Session-29
      successor. **A gap analysis that still lists closed gaps is worse than none**, because the next
      session plans against it. Correct its `EMBEDDINGS_UNDEFER_THRESHOLD` attribution at the same time:
      that constant is ADR 0016 §5.3's `audience_memory` trigger, **not** Mode 3 Stage B's — Stage B's
      revival condition is ADR 0020 §6.5's second-unstructured-source clause, and conflating them would
      send Session 30 after the wrong ruling.
      **Done (D11):** `EMBEDDINGS_UNDEFER_THRESHOLD` misattribution corrected; the stale "promote to
      campaign" and "carousel/script not built" gap entries refreshed to their actual (partial) closure
      status.
- [x] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — updated per the OpenWolf protocol.
      **Done (D11):** `anatomy.md`/`memory.md` auto-update via hook (confirmed current); `cerebrum.md`
      manually updated with this pass's genuine learnings (the RLS USING/WITH-CHECK finding, the
      origin-blind discriminator pattern, the append-only self-check, the stale NIT-1 count correction).
- [ ] **Next:** `docs/build-guide/session-30.md` · Track G — the second signal source (ADR 0023), which
      carries the Stage B embeddings ruling ADR 0020 §6.5 deferred.
