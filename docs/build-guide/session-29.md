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

---

## §5 — Docs to update at close-out (Track F done)

- [ ] `docs/current-phase.md` — the Session 29 entry closing Track F; the `db-tests` promotion tally with
      run URLs and the skip-guard's file/test counts **quoted verbatim from the log line**, not summarized.
      Note that Step 0 already moved the tally to 1 of 3; this session's `master` runs may move it further
      — count only genuine `master` runs.
- [ ] `docs/decisions/0022-promote-to-campaign-and-format-families.md` — status / close-out block (§15),
      amended by the correction pass if it changed anything the ADR asserts.
- [ ] `docs/decisions/0018-diff-based-learning-capture.md` — the additive `generation_kind` amendment in
      place, with its line range cited.
- [ ] `docs/decisions/0019-mode-1-studio.md` — §15 item 1 (promote-to-campaign) and item 10 (the
      `topContent` write-time bound) marked as **closed by ADR 0022**, with the ADR and session named.
      Appended, not rewritten.
- [ ] `docs/decisions/0017-mode-2-upgrade.md` — §15's D-6 deferral marked **partially** closed by ADR 0022:
      **carousel closed** as a format family; **script re-deferred as a family** with its new revival
      condition, and its recommendation-field form recorded as what shipped instead. Appended, not
      rewritten — and do not let it read as "carousel/script closed", which would be false.
      **The skip-review fast path (L-11) stays deferred** — confirm it was not touched.
- [ ] `docs/decisions/0010-legal-surface.md` Amendment 2 §D2.5 — a new cascade row **if** a new
      business-scoped table landed; an explicit note that none was required **if** the change was a column
      on an already-covered table (the Session 28-D D7 precedent).
- [ ] `docs/brainstorm/plan-vs-implemented-gap-analysis.md` — refreshed, or superseded by a Session-29
      successor. **A gap analysis that still lists closed gaps is worse than none**, because the next
      session plans against it. Correct its `EMBEDDINGS_UNDEFER_THRESHOLD` attribution at the same time:
      that constant is ADR 0016 §5.3's `audience_memory` trigger, **not** Mode 3 Stage B's — Stage B's
      revival condition is ADR 0020 §6.5's second-unstructured-source clause, and conflating them would
      send Session 30 after the wrong ruling.
- [ ] `.wolf/anatomy.md`, `.wolf/memory.md`, `.wolf/cerebrum.md` — updated per the OpenWolf protocol.
- [ ] **Next:** `docs/build-guide/session-30.md` · Track G — the second signal source (ADR 0023), which
      carries the Stage B embeddings ruling ADR 0020 §6.5 deferred.
