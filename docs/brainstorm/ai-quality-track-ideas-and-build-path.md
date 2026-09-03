# AI Quality Track — Ideas and the Path to Build Them

> **Status:** Brainstorm. Not an ADR, not a decision. Written 2026-09-01, read from the source at
> `b297a4a8` (`lib/ai/`, `lib/campaigns/`, `lib/signals/triage/`) rather than from the ADRs describing it.
>
> **Purpose:** the founder asked how to significantly improve the *quality of what the AI delivers* —
> explicitly not how to appear more "AI-powered." Everything below makes the calls you already make
> better. Nothing below adds AI to a new surface.
>
> **Companion document:** `growth-sensation-ideas-and-build-path.md` covers the growth track (why anyone
> shows up). This one covers the quality track (whether what they get is good). They are independent and
> can run in either order.

---

## 1. Where the ceiling actually is

The AI layer's *governance* is genuinely strong — one entry point, versioned prompt programs, priced
model routing, trial caps and rate limits ahead of the call, typed errors, and prompt-injection defense
enforced by branded types (`lib/ai/wrap-evidence.ts`). None of that is the limiter.

**The limiter is that the author is under-informed and gets close to one attempt.**

What already exists, stated accurately so this document does not under-credit the codebase:

- The rubric **is** wired as a real critique gate — but on the **brief**, not the post
  (`lib/campaigns/brief.ts:139`, Stage B, against `BRIEF_QUALITY_THRESHOLD`).
- Generated posts **do** get a quality retry — but a **one-dimension, one-shot** one: regenerate once if
  `openingStrength` is below threshold, no re-score (`lib/campaigns/generate.ts:259`).
- Deterministic Tier-0 checks exist and are free: role coverage and link placement
  (`lib/campaigns/consistency.ts`).

So: the *plan* is critiqued properly; the *output* is spot-checked on one dimension. And when generation
runs, the model receives a fixed five-field `CustomerContext` (`lib/ai/context.ts:9`), a *description* of
the brand voice, no examples, no view of the world, no access to the customer's own past work, and no
ability to look anything up.

Every one of those is fixable with machinery that already exists in the repo.

---

## 2. Tier 1 — Large gains, small builds

### T1.1 — Give the model examples, not descriptions of examples

**The single biggest voice-fidelity lever in the system, currently unused.**

`brandVoice` reaches the prompt as a descriptor plus rules. Rules *describe* a voice; examples *are* one.
Six of the customer's own highest-performing posts, selected for similarity to the task at hand, will beat
twenty voice rules — and the corpus already exists, with `post_ai_originals` giving the human-approved
version specifically (i.e. the version that reflects the customer's taste, not the model's).

- **Change:** `CustomerContext` gains a `voiceExemplars` field; selection is by similarity to the task,
  not by recency.
- **Depends on:** the embeddings ruling (§4).
- **Measured by:** average human edit distance on approved posts.

### T1.2 — Generate three candidates and let the rubric pick

Best-of-N with a judge is the most reliably effective quality technique available in this class of system,
and the codebase is one small change from it: the rubric exists, the threshold exists, and a regeneration
path exists.

- **Change:** generate **N=3 in parallel** at nonzero temperature, score all three across the *full*
  rubric (not `openingStrength` alone), keep the argmax. Surface the losing candidates' scores at the
  approval gate so the human can see *why* this one won — which doubles as a trust feature.
- **Prerequisite:** there is **no `temperature` anywhere in `lib/ai/`** today. Sampling at defaults means
  three candidates would come back near-identical. One-line prerequisite, but a real one.
- **Interacts with:** ADR 0017's frozen Mode 2 prompt fixtures — changing sampling changes fixtures.
  Scope that explicitly rather than discovering it mid-session.

### T1.3 — Let the model think before it writes

No thinking budget appears anywhere in the layer. For the strategic steps — brief assembly, campaign
structure, Stage C triage — an extended thinking budget is a parameter change with a large effect on
exactly the decisions that matter most, and it is directly measurable on the existing eval harness.

Cheapest experiment in this document. Run it first, if only to size the rest.

### T1.4 — Condition retrieval on the task

`lib/ai/context.ts` calls `retrievePerformancePatterns(client, businessId, {})` — **an empty
`queryContext`**, which the in-file comment openly acknowledges. The governed-memory machinery already
accepts a query; the primary call site passes nothing.

Consequence: a launch post and an objection-handling post receive **identical** memory. Threading the task
down is close to free and makes every downstream item better.

### T1.5 — Structured output through tool-use schemas

The layer parses JSON out of prose (`extractJsonBlock`, `lib/ai/parsers.ts:48`), and Session 30 shipped a
fix for a **production bug in exactly that path** — the model prefaced its JSON decision with prose.
Schema-enforced output eliminates the bug class rather than hardening against it a second time.

---

## 3. Tier 2 — Architectural, and where the real jump lives

### T2.1 — Let the generator look things up

**The biggest structural miss in the layer.** `runToolLoop` (`lib/ai/tool-runner.ts:219`) exists, is
bounded by named constants, and is proven in Stage C triage — and **the generator cannot use it**. The
model is asked to write about a market it cannot see, for a company whose site it cannot read, without
being able to check what that company has already said.

- **Change:** give generation its own **read-only** tool inventory — search own past posts by similarity,
  fetch the source article, read the customer's site, query evidence memory by specific claim.
- **The injection seam is already built and currently unused by any generation path:**
  `wrapToolResultForPrompt` and `TOOL_RESULT_MAX_CHARS` exist in `lib/ai/wrap-evidence.ts:245/218`.
- **Non-negotiable:** read-only tools, authenticated client, never service-role — the same constraint that
  governs any future interactive agent. A tool loop holding `createServiceRoleClient()` is an RLS bypass.
- This is what the strategy doc's "AI research before writing" means in this codebase: **wiring, not new
  infrastructure.**

### T2.2 — Verify claims against evidence, and flag the unsupported ones

Extract every factual claim from a draft, match each against `evidence_memory` — which already carries
source, date, confidence and permission-to-use — and mark the unsupported ones at the approval gate:
*"this sentence asserts a 40% figure with nothing behind it."*

Simultaneously a quality feature, a trust feature and a legal one, built on a store that exists and is
barely read from. It also directly serves the rubric dimension the strategy doc names as "risk of
unsupported claims."

### T2.3 — Make the learning loop reach the prompt, not just memory

ADR 0018 captures the diff between what the AI wrote and what the human approved (`post_ai_originals`,
`post_edit_signals`) and promotes learnings into memory. That is the most defensible asset in the
codebase and it is currently used for one of the three things it could do. It should also:

1. **Become few-shot examples** — an approved edit is a labelled correction, which is the highest-value
   training signal available and it is already being collected.
2. **Accumulate a per-business regression set** of (input, approved output) pairs, so a prompt change can
   be tested against *that customer's* taste rather than a global corpus. This is the missing piece under
   the honest "bootstrap ceiling" caveat on the current eval numbers.
3. **Calibrate the rubric** — score against what this specific human actually approves, rather than
   against an abstract standard.

This is what turns "we store your edits" into "the system measurably converges on you," which is the
claim the whole product rests on.

### T2.4 — Let the model plan the campaign, not just fill it

**The one failure mode the rubric structurally cannot catch: a well-written post that should not exist.**

Today, campaign generation is a fixed pipeline. The brief is assembled, critiqued against the rubric
(`lib/campaigns/brief.ts:139`), and **frozen**; then N posts are generated against a `roleSequence` that
was decided *before* generation, with each post tagged to the `order` of the entry it came from
(`lib/campaigns/generate.ts:303`). Afterwards, `checkRoleCoverage` (`lib/campaigns/consistency.ts`)
verifies positionally that every entry which was supposed to produce a post actually did.

That pipeline is well-built, and it has one blind spot: **the role sequence is decided before anything
checks whether the material to fulfil it exists.**

So the system can instruct the model to write a *customer proof* post when `evidence_memory` holds nothing
that supports one — and the model will write it, because that is the instruction. Role coverage passes
(the slot was filled). The rubric may score it weak, but the rubric is asked "is this a good post?", never
"should this post have existed?" This is the precise mechanism by which a structurally correct campaign
ends up containing a hollow or over-claimed post — and it is exactly the case the strategy doc names: *"a
launch campaign contains four feature announcements but no customer proof or objection-handling
content."*

**The change: a bounded planning step between brief-freeze and generation.**

Give the model agency over the *sequence itself*, not just the prose inside each slot. For each proposed
role it asks whether the material to support that role actually exists, and may propose:

- **drop** a role that nothing in memory can support,
- **substitute** one (an objection-handling post where a customer-proof post has no evidence),
- **reorder**, where narrative progression argues for it,
- **request evidence** — surface to the human that a role is worth keeping *if* they can supply the proof.

Each proposed change carries a reason string, rendered to the human.

**Why this is safe, and where it lands.** The output is a **proposal against the frozen brief**, surfaced
at the brief-review checkpoint that already exists — never a silent mutation. On the reversibility ×
verifiability test this sits squarely in "propose, then human-ratify": fully reversible, gated, and
auditable. It is agency over a *plan*, never over a published artefact.

**Design constraints, all load-bearing:**

- **It must not silently mutate a frozen brief.** `checkRoleCoverage` depends on a positional contract
  against the frozen `roleSequence`, which is deep-readonly by construction. Either the planner runs
  *before* the freeze, or a ratified change produces an explicit re-freeze with an audit trail. Choosing
  between those two is the central Architect question for this item.
- **Bounded like every other loop** — reuse the `tool-runner.ts` constants pattern (max calls, max turns,
  cumulative token ceilings, wall clock), not a new budgeting scheme.
- **Read-only tools only**, and the same closed inventory Stage C already uses (`list_evidence`,
  `list_audience_notes`, `list_brand_claims`, `list_recent_campaigns`) — authenticated client, never
  service-role.
- **It is the natural home for `MODE2-REDUNDANCY-UNDEFER`.** Cross-set redundancy is currently deferred
  (`consistency.ts`, ADR 0017 §8 item 4). "These two posts make the same argument" is a question about the
  set, which is precisely what a planner reasons over — so when that check is un-deferred, it belongs
  here rather than as a fourth deterministic pass.

**Why it matters strategically.** This is the first point at which the system reasons about a campaign
**as a sequence** rather than as a folder of independently-generated posts — which is the strategy doc's
central claim about campaigns being the product's unit of work. Everything else in Tiers 1 and 2 makes
individual posts better. This is the only item that makes the *campaign* better.

**Measured by:** share of generated campaigns where the planner proposes a change; human acceptance rate
of those proposals (a low rate means the planner is noisy and should be tightened, exactly as with Living
Drafts); and rubric scores on posts in planned vs. unplanned campaigns.

### T2.5 — Background agents that produce proposals

**The third form of agency, and the one that changes what the product *is*.** T2.1 is agency inside a
call. T2.4 is agency over a plan. This is agency **on a schedule, between sessions** — the system doing
work while the customer isn't there, and having something worth saying when they come back.

**The substrate already exists.** The hourly signal worker, `lib/learning/orchestrator.ts`,
`lib/email/orchestrator.ts`, the publishing and metrics workers, Vercel Cron. SOSH already runs scheduled
autonomous pipelines; this is not new infrastructure. **What's missing is a shared proposal object** —
every existing worker terminates in its own bespoke surface, so a sixth one would mean a sixth inbox.

#### The pattern

> **watcher → condition → proposal → an existing human gate → accept/reject → the accept/reject becomes
> training signal.**

Never a published artefact. Never a silent write. The agent's entire output is *a proposal with its
reasoning attached*, landing somewhere the human already looks.

#### Instances worth building, in order

1. **Living Drafts** — watches scheduled posts, proposes a diff when the world moved underneath one.
   **Already specified** as Idea 4 / Session 33 Track J in `growth-sensation-ideas-and-build-path.md` —
   not duplicated here. **Coordination note: if both tracks run, build Living Drafts as the first
   *instance* of this pattern rather than as a bespoke feature.** Otherwise the proposal object gets
   invented twice, and the second one has to be retrofitted onto the first.
2. **Coverage agent (weekly).** *"48% of your posts are product features; 8% carry customer evidence."*
   *"You haven't published for technical evaluators in six weeks."* This is the strategy doc's Release-3
   portfolio intelligence delivered as **proposals rather than a dashboard** — which is the difference
   between a chart the user must interpret and a decision they can accept.
3. **Evidence-gap agent.** The natural companion to T2.4: when the planner drops a role for lack of
   material *repeatedly*, that is a standing signal, not a per-campaign event. *"Three campaigns running
   have wanted customer proof and had none — here are the two customers worth asking."* This is the
   loop closing between generation and the company's own knowledge.
4. **Staleness agent.** Memory items already carry source, last-confirmed date, confidence and expiry
   (ADR 0016) — **and nothing currently acts on expiry.** *"This brand claim was last confirmed 11 months
   ago and appears in four scheduled posts."* Pure governance value from fields that already exist, and
   the cheapest agent in the list to build.
5. **Repetition agent.** *"Your last three campaigns opened with the same argument."* Related to
   `MODE2-REDUNDANCY-UNDEFER` but operating *across* campaigns rather than within a generated set — a
   different scope than T2.4's, and worth keeping distinct.

#### The design decision that makes or breaks it: one proposal object, many producers

If each agent invents its own surface, you get five inboxes and the customer ignores all of them. If they
share a single proposal type — `{ kind, subject, trigger, evidence, proposedChange, confidence }` —
landing in one review surface, you get four things at once:

- **one UI** to build and maintain,
- **one place the human looks**, which is the only way any of this survives contact with a busy founder,
- **one accept/reject telemetry stream**, and therefore
- **per-agent-kind accept rates — the measurement that decides whether each agent earns its place.**

That last point is the important one. An agent whose proposals are rejected 80% of the time gets switched
off, on evidence. **This is how autonomy gets added safely: each agent must earn its keep against a number
the human generates just by doing their normal work.**

#### Constraints, all load-bearing

- **Proposals only** — no published artefact, no silent write, no exception.
- **Every proposal carries its trigger and its evidence**, rendered to the human. A proposal you can't
  interrogate is one you learn to dismiss reflexively.
- **Volume ceilings per agent per week.** An agent producing forty proposals is noise wearing a
  suit. Cap it, and let the accept rate tune the cap.
- **Deterministic-first.** Most of these triggers — staleness, coverage percentages, repetition — are
  *computable without an LLM*. Only the phrasing and the final judgment call need a model. This keeps
  cost near zero and matches ADR 0020's Stage B posture exactly (cheap deterministic filtering on
  everything, premium model on the few that survive).
- **Service-role is legitimate here** — these are workers, like the publishing and metrics workers — but
  every proposal must be tenant-scoped and land in an RLS-protected table with its `business_id`, and the
  §D2.5 erasure-cascade row is mandatory in the same PR.
- **Cost accounted on every run including failures**, per the existing `tool-runner.ts` posture.

#### Why it matters

This is the highest-retention item in either document. A product that only responds when opened is a tool;
a product that did work overnight and has something considered to say is a service you employ. It is also
the concrete form of the strategy doc's claim that **the home screen should show a ranked set of decisions,
not charts or a calendar** — and it can only be that if something is producing ranked decisions while
nobody is watching.

**Measured by:** proposals per brand per week; **accept rate per agent kind** (the number that switches an
agent off); and the share of accepted proposals that reach a published post.

---

## 4. The blocker that needs a founder ruling

**T1.1 and T1.4 want semantic similarity. `SIGNAL-NO-EMBEDDINGS` is a Tier-3 constraint that ADR 0023
§4.1 explicitly RE-AFFIRMED rather than retired.** This must not be improvised in a Builder session.

Two facts to weigh:

- The revival condition written into **ADR 0020 §6.5** — *a second, unstructured signal source* —
  **appears to have been met** by the RSS/Atom source shipped in ADR 0023. The trigger the team wrote for
  itself may already have fired.
- **But that condition was written about Stage B candidate scoring.** Using embeddings for few-shot
  retrieval and memory conditioning is a *different* use with a different risk and cost profile. It needs
  its own explicit ruling, not a read-across from the Stage B condition.

**Recommendation:** for retrieval of the customer's *own* content, the case is materially stronger than it
was for Stage B scoring — because the alternative there was "deterministic dedup," whereas the alternative
here is "recency," which is simply the wrong ordering for choosing an exemplar.

Everything else in Tiers 1 and 2 ships without touching this decision.

---

## 5. The cost math, since it decides everything

Rates are in `lib/ai/models.ts` (cents per 1M tokens, dated 2026-05-12): Sonnet 4.6 at 300 in / 1500 out;
cache reads billed at 10% of input (`calculateCostCents`).

| Item | Rough cost |
|---|---|
| One ~4k-in / 800-out generation on Sonnet | **≈ 2.4¢** |
| Best-of-3 + one judge pass | **≈ 9¢** |
| At the Plus cap of 50 posts/month | **≈ €4.50 per customer per month** |
| Against Plus revenue | €99/month |

Prompt caching on the brand-context prefix claws back most of the input side, since that prefix is
identical across every call for a business.

**Conclusion: quality here is not cost-constrained, it is design-constrained.** The system can afford to
think, to sample several times, to critique, and to look things up — several times over — and still leave
the unit economics untouched.

---

## 6. What NOT to do

- **Do not fine-tune.** The moat is retrieval and governance; a fine-tune freezes exactly the thing that
  should keep learning, and it makes the per-business convergence in T2.3 harder, not easier.
- **Do not grow the prompt.** Past a point, more instructions make output *more* generic, not less.
  Examples (T1.1) and retrieved facts (T2.1) beat rules.
- **Do not treat model upgrades as a quality strategy.** Every competitor gets those on the same day.
- **Do not add AI to more surfaces.** Every item above improves calls that already happen. That is the
  whole difference between "more AI-powered" and better.

### And specifically: do not build the agent swarm

The most likely wrong turn available, because it is the most fashionable and it sounds like the natural
next step after T2.1 and T2.4. The brainstorm source proposes it directly (`Chat/next-hootsuite…` §20):
a Research Agent, Trend Agent, Hook Agent, Copy Agent, Design Agent, SEO Agent, Engagement Agent,
Analytics Agent and Competitor Agent, each with its own memory, communicating with the others.

**Do not build this.** Four reasons, in order of how much they cost you:

1. **It dismantles the one advantage you have.** `CustomerContext` exists to assemble the brand's voice,
   evidence, audience and performance history into *one* coherent view before a single token is
   generated. Every agent-to-agent handoff serialises that view down to whatever fits in a message and
   loses the rest. You would be spending real engineering effort to un-build governed memory.
2. **You cannot attribute a regression.** With one loop and a rubric, a quality drop is traceable to a
   prompt version, a model, or a retrieval change — all of which are versioned. With nine agents, a
   regression is an emergent property of the handoffs, and debugging becomes guesswork. This matters far
   more here than in a typical product, because ADR 0015's whole premise is that a property is only real
   if something executes and proves it.
3. **It is unmeasurable at the seams.** The eval harness scores end-to-end. It has no way to score
   "the Hook Agent got worse," so a swarm adds autonomy you are structurally unable to evaluate. The
   general rule it breaks: **agency must follow evaluation, never lead it.** Autonomy you cannot score
   fails quietly, which is the worst way for a human-in-the-loop product to fail — because the human
   gradually stops checking. This is also why T2.3's per-business regression sets are a *prerequisite*
   for deepening agency, not a parallel nicety.
4. **Cost and latency multiply on coordination, not on quality.** §5 shows quality is design-constrained,
   not cost-constrained — that headroom should buy thinking, sampling and retrieval, not message-passing
   overhead between agents that each re-read the same context.

**What the swarm is actually reaching for, and the cheaper way to get it.** The intuition behind #20 is
sound: *more than one pass over the work produces better work.* That intuition is correct and this
document already acts on it — three times, more cheaply and more measurably:

| The swarm's claim | What delivers it here |
|---|---|
| "A dedicated Hook Agent writes better hooks" | **T1.2** — N candidates scored on the full rubric, `openingStrength` included |
| "A Research Agent gathers material first" | **T2.1** — the generator gets read-only tools and gathers its own |
| "A Strategy Agent structures the campaign" | **T2.4** — a bounded planner proposing against the frozen brief |
| "A Learning Agent studies results" | **T2.3** — the edit corpus reaching prompts, exemplars and rubric calibration |

Same benefit, one context, one loop, one place to look when it regresses.

**The honest exception.** Separate *prompt programs* with distinct jobs — which SOSH already has nine of
under `lib/ai/prompts/` — are not a swarm. Specialisation at the prompt level, unified at the context
level, is the right architecture and is the one you are already running. The failure mode is
specialisation at the *runtime* level, where each specialist holds its own private state.

---

## 7. Build path

Continues the existing session/ADR numbering and the house Architect → Builder → Reviewer shape. This
track is independent of the growth track and can interleave with it.

### Session A — Sampling, judging and conditioning (ADR 002x)

*T1.2, T1.3, T1.4, T1.5. The highest ratio of quality gained to work done, and no new stores.*

- **Architect:** where temperature and thinking budgets are configured (per-prompt, versioned, so a
  sampling change bumps `version` exactly as a model change does — the ADR C-4 rule already exists);
  the N-candidate judging contract and what the approval gate shows; how task context threads into
  `retrievePerformancePatterns`; the migration path off `extractJsonBlock` to schema-enforced output.
  **Name the ADR 0017 fixture impact explicitly** — frozen Mode 2 fixtures move when sampling changes.
- **Builder:** the sampling params; parallel candidate generation; full-rubric judging replacing the
  single-dimension retry; queryContext threading; structured outputs.
- **Reviewer:** `cost-aware-llm-pipeline` on the N-candidate spend; `typescript-reviewer` on the
  schema-enforced output types.
- **Measured by:** edit distance and rubric scores on the existing eval harness, before and after.

### Session B — Tools for the generator, claim verification, and the campaign planner (ADR 002y)

*T2.1, T2.2, T2.4. All three share one tool inventory and one loop wiring, which is why they belong in a
single session rather than three.*

- **Architect:** the generation tool inventory (read-only, closed, enumerated like Stage C's four); the
  ceilings, reusing `tool-runner.ts`'s constants pattern; the authenticated-client constraint as a Tier-2
  constraint with a source scan; the claim-extraction → evidence-match contract and what the approval
  gate renders for an unsupported claim. **And the central T2.4 question: does the planner run *before*
  the freeze, or does a ratified change trigger an explicit re-freeze with an audit trail?** Whichever is
  chosen, `checkRoleCoverage`'s positional contract against the deep-readonly `roleSequence` must survive
  it — name that as a constraint, with its tier.
- **Builder:** the tools; the loop wiring for generation; claim verification; the planner and its proposal
  rendering at the brief-review checkpoint; the approval-gate surface.
- **Reviewer:** `security-reviewer` primary — this widens the prompt-injection surface from evidence and
  signals to live tool results inside a *generation* path. `code-reviewer` on the freeze semantics: a
  planner that can mutate a frozen brief is a correctness bug, not a feature.
- **Scope warning:** if the freeze question turns out to require an ADR 0017 amendment, split T2.4 into
  its own session rather than letting it expand Session B mid-flight.

### Session C — Embeddings ruling, exemplars, per-business regression sets (ADR 002z)

*T1.1, T2.3. Blocked on §4.*

- **Architect:** the embeddings decision recorded as an amendment (whichever way it goes, and why);
  exemplar selection and its caps; the per-business regression corpus schema; rubric calibration against
  `post_edit_signals`.
- **Builder:** exemplar retrieval into `CustomerContext`; the regression sets; calibration.
- **Reviewer:** `database-reviewer` on the vector store if the ruling permits one.

### Session D — The proposal object and the first background agents (ADR 002w)

*T2.5. Sequenced after Session C, because per-agent accept rates are only trustworthy once there is a
regression set to interpret them against — agency follows evaluation.*

- **Architect:** the shared proposal object and its state machine (proposed / accepted / rejected /
  superseded / expired); the single review surface and where it sits relative to the approvals inbox;
  volume ceilings per agent kind; which triggers are deterministic and which need a model; the
  tenant-scoping and §D2.5 cascade row; the accept-rate telemetry contract that lets an agent be switched
  off on evidence.
- **Builder:** the proposals table + RLS + cascade row; the review surface; the two cheapest agents first
  — **staleness** (reads expiry fields that already exist) and **coverage** — with the evidence-gap and
  repetition agents following once the accept-rate signal is readable.
- **Reviewer:** `database-reviewer` on the tenancy and state machine; `code-reviewer` on the
  proposals-only guarantee — an agent that can write anything but a proposal is a defect, not a feature.
- **Cross-track dependency:** if `growth-sensation-ideas-and-build-path.md`'s Session 33 (Living Drafts)
  runs first, **this proposal object must be built there** and this session extends it rather than
  introducing a second one.

---

## 8. The honest test

One number, which the codebase is already positioned to produce:

> **Average human edit distance on approved posts**, tracked before and after each session in this track.

If Tier 1 does not move it, the diagnosis in §1 is wrong and this track should stop rather than continue
into Tier 2. Secondary measures: full-rubric score distribution, and the share of drafts approved with
zero edits.

---

## 9. One-line summary

The governance is excellent and the author is starving: give it **examples instead of rules, three
attempts instead of one, permission to think, permission to look things up, and a way to check its own
claims** — none of which requires new infrastructure, and all of which fits inside the existing unit
economics several times over.

---
---

# Part II — Memory: the substrate everything above depends on

> Appended 2026-09-01, same session. Part I treats memory as a given and improves what the model does
> with it. Part II is about the memory itself: how it is written, how it is queried across features,
> whether it ever learns from outcomes, and how to stop it starting empty. Everything here is verified
> against `lib/memory/`, `lib/learning/`, `lib/metrics/` and `lib/db/` at `b297a4a8` rather than against
> the ADRs describing them.

---

## 10. Memory as a platform substrate — the 8-readers / 1-writer problem

**The retrieval half is already good, and better than a first read of the ADRs suggests.** `lib/memory/`
is a real service, not a context blob: per-type `retrieveRelevant`, `scoreRecord`, `rankAndCap`, an
exponential recency decay with a 30-day half-life, eligibility on `status` + `expires_at`, and scope
matching. And it already has **eight consumers**:

`lib/ai/context.ts` · `lib/ai/prompts/studio-suggestion.ts` · `lib/campaigns/brief.ts` ·
`lib/learning/classify.ts` · `lib/learning/orchestrator.ts` · `lib/signals/triage/tools.ts` ·
`lib/studio/verify.ts` · `app/[locale]/(dashboard)/studio/actions.ts`

Cross-feature *reading* is therefore not the gap — it already works, and `lib/signals/triage/tools.ts`
is the proof that memory can be exposed as a queryable service rather than a fixed struct.

**The gap is the write side. Exactly one thing writes memory: `lib/learning/orchestrator.ts`** — the
`post_edit_signals` pipeline. Memory can currently get smarter from precisely one source: the diff
between what the AI drafted and what the human approved. Everything else the customer tells the product
is discarded.

### Shift 10.1 — Every human decision is a labelled example, and most are thrown away

Each of these is a person stating something true about their brand, and none of it reaches memory:

| The decision | What it actually says | Memory type |
|---|---|---|
| Rejecting a draft in approvals | this doesn't sound like us / isn't worth saying | voice, audience |
| Dismissing an opportunity card | this topic isn't ours | audience |
| Letting a card expire unactioned | weaker signal, same direction | audience |
| Rescheduling a post in the calendar | a timing judgment | performance |
| Discarding a Studio draft | the angle didn't land | voice |
| Regenerating a brief | the *strategy* was wrong, not the prose | audience, brand |
| Editing a specific claim out | that claim isn't defensible | evidence |

Signals triage already captures dismiss **reasons** — the eval harness scores `dismissMatch` against them
— but that judgment is scored and then dropped rather than becoming audience memory. That is the cheapest
writer to add, because the data is already structured and already validated.

**This is the highest-leverage memory change in Part II**: a write path from every decision surface, so
the system learns from the whole session rather than from one artefact type.

### Shift 10.2 — Widen the query contract

`MemoryQueryContext` is `{ objective?, platform?, audience? }` (`lib/memory/scoring.ts:6`) — three fields,
all optional — and the primary call site passes `{}` (see T1.4). To serve consumers beyond generation it
needs the real task shape: **topic, campaign, format, post role, time window, and a confidence floor.**
Cheap to widen, and it compounds with every item in Part I.

### Shift 10.3 — Let queries cross memory types

Retrieval today is four independent `retrieveRelevant` calls, each capped separately — `BRAND_CAP = 5`,
`EVIDENCE_CAP = 5`, `AUDIENCE_CAP = 5`, `PERFORMANCE_CAP = 3` (`lib/memory/constants.ts`). A prompt
therefore receives at most **18 records, selected without reference to one another.**

The questions that actually matter span types:

> *"Which evidence supports the objection this audience keeps raising, and which format performed best
> when we last addressed it?"*

That is evidence × audience × performance in a single query. **This is what "company knowledge graph"
means in this codebase** — a retrieval change over stores that already exist, not a new store and not a
buzzword.

### Shift 10.4 — Write governance, once there are many writers

One writer needs no arbitration; ten do. Adding writers requires: **provenance per writer**,
**contradiction detection** (two features asserting incompatible facts), **confidence arithmetic** when
sources agree or disagree, and a **promotion gate**. ADR 0016 already defines the *fields* for this —
source, confidence, last-confirmed, expiry, scope. The *policy* was never needed because nothing
competed. It will be.

---

## 11. The outcome loop — measured but never learned from

**This is the largest single gap between what the product claims and what it does.**

### The finding, from three verified facts

1. **`lib/metrics/orchestrator.ts`** (cron `sync-metrics`) writes **only** `post_metrics`, via
   `upsertPostMetrics`. It writes nothing to any memory table.
2. **`performance_memory` is written exclusively by `lib/learning/*`** (`promote.ts`, `summarize.ts`) —
   the `post_edit_signals` pipeline, whose inputs are AI-draft-vs-human-approved diffs.
3. **`lib/memory/performance.ts` falls back to raw `post_metrics`** when no governed rows exist, and its
   own comment states: *"today, this always takes the fallback branch."*

So the loop that closes is **AI draft → human edit → learning → memory**. That is a **taste** loop, and it
runs entirely *before publication*.

The loop that does **not** close is **published post → real metrics → learned pattern → next
generation**. Metrics are captured, stored, and injected raw as top-3 posts with like/impression counts —
but nothing generalises over them. No attribution. No pattern extraction. No *"founder stories outperform
product updates 4:1."*

**A naming trap to flag explicitly:** a table called `performance_memory`, populated by the *edit*
pipeline. Any reader of the schema would reasonably assume the outcome loop is wired. It is not. Anyone
planning work off the schema alone will plan wrongly.

**Why it matters:** "the AI gets smarter every week from what worked" is the claim the entire product
thesis rests on. Today the product gets smarter from what was *edited*, which is a different and weaker
claim.

### What closing it requires

The plumbing is trivial. **Attribution is the hard part**, and at 50 posts/month it is genuinely hard:
outcomes are dominated by follower count, timing, seasonality, algorithm shifts and luck. *"Founder
stories get 4× engagement"* derived from six posts is astrology. Given this team published a 0/24 result
rather than blending it away, the design should be statistically honest from the first commit.

**11.1 — Tag dimensions at generation time, never retroactively.** Posts already carry a `role` from the
frozen `roleSequence`. Extend that to **topic, format, proof type, funnel stage, opening type, length
band, CTA presence, and origin mode**. Tagged at generation the data is exact and free; tagged afterwards
it is guesswork. **This is the enabling step** — without dimensions, metrics are numbers attached to posts
with nothing to generalise over, which is precisely today's state.

**11.2 — Normalise before comparing.** Compare against that business's own trailing baseline for the same
platform (engagement rate vs. rolling median), never absolute counts and never across businesses.

**11.3 — Require a minimum n; store confidence, not verdicts.** A pattern needs *k* observations before
promotion and should render in the prompt as *"based on 7 posts."* ADR 0016's `confidence` field exists
for exactly this, and the strategy doc already states the rule: *"we believe technical comparison posts
perform well for CTO audiences based on three campaigns"* — never a weak pattern promoted to a permanent
truth.

**11.4 — Decay and re-confirm.** `recency_at` (30-day half-life) and `expires_at` are implemented and
working. Platform algorithms move; a pattern true last year becomes a liability. The machinery exists —
nothing is currently feeding it outcome data to decay.

**11.5 — Close the loop at campaign level, not only post level.** The campaign object carries a
**hypothesis** and **success criteria**, and **nothing ever evaluates them.** A retrospective that scores
the hypothesis against outcomes and writes the result to memory *is* the "campaign learning cycle" the
north-star metric is named after. **As it stands, the north-star metric measures a loop that is not
fully wired** — worth knowing before it is reported to anyone.

**11.6 — Then deliberate experimentation.** Once dimensions are tagged and normalised, one dimension can
be varied *on purpose* and attributed causally rather than correlationally (the chat doc's A/B idea).
Correct answer at small n, but a later move — it needs volume first.

**One limit to keep honest:** attribution to *business* outcomes (signups, pipeline) stays weak. Use UTMs
and conversion events, present with confidence levels, and never imply precision you do not have.

### Where the learned patterns feed back

One writer, three consumers that need not know about each other — this is the concrete answer to "one
feature using another's memory":

- **Generation** — real patterns instead of raw top-3 posts.
- **The planner (T2.4)** — role sequence chosen partly on what demonstrably works for this brand.
- **The background agents (T2.5) / the feed (§13)** — *"your objection-handling posts outperform product
  updates 3:1 and you haven't published one in six weeks"* is a proposal, not a chart.

---

## 12. Cold-starting memory from the customer's social history

**The precondition for most of Part II, and the answer to the one measured failure in the repo.**

Market-responsive triage scored **recall 0/24**, and every refusal cited absent audience/brand memory
under the corpus's universal `stubMemory: {}` condition. Cold-start emptiness is not a hypothetical
weakness here — it is the only measured failure the project has.

Meanwhile a customer arrives with years of posts and engagement data, and onboarding infers voice from
their **website** — marketing prose, written by a different hand, for a different medium — while ignoring
the corpus of actual social writing sitting in the accounts they are about to connect.

### What a backfill fills, per memory type

- **Voice** — their real writing rather than a description of it. This is also what makes **T1.1
  (exemplars over rules) viable on day one**; exemplars require a corpus.
- **Performance** — what actually worked, with real numbers, replacing bootstrap guesses. This is what
  gives §11 enough n to say anything at all.
- **Audience** — comments and replies carry objections, recurring questions, and the customer's own
  vocabulary.
- **Evidence** — past posts contain claims, statistics and customer quotes **they have already
  published**, which means those claims are already cleared for public use. That maps directly onto
  `evidence_memory`'s permission field and is the cheapest source of permitted evidence available.

### Why it matters strategically

It converts a cold-start product into a warm-start one. It is the direct answer to *"your AI writes
generic slop"* — it doesn't, because it started from 200 of their own posts. It creates switching cost on
day one rather than month six. And *"here's what we learned from your last 200 posts"* is a strong
screenshot moment that feeds the growth doc's preview and X-Ray ideas.

### Four things that decide whether it is buildable

1. **There is no social read path at all — `fetchRecentPosts` does not exist anywhere in `lib/`
   (verified).** This is exactly **open decision 19D-5**, unresolved since Session 19: add
   `fetchRecentPosts` to `SocialProvider` (+ an ADR 0002 amendment and a new provider call), or amend ADR
   0011 §7 to ratify reading only local SOSH posts. That decision has been carried as a minor
   voice-refinement question. **This makes it the highest-value open decision in the repo, and answers it:
   option 1.**
2. **GDPR on commenters.** Reading the customer's *own* posts and aggregate metrics is the strongest
   possible legal position — their data, their accounts, their controller relationship. Mining *comments*
   means processing personal data of people who never signed up, and edges into the `relationship_memory`
   ADR 0016 deliberately parked. **Own posts + aggregate metrics is a clean v1**; comment mining needs its
   own Art. 6(1)(f) balancing test, and the ADR 0020/0023 counsel blockers are precedent, not coverage.
3. **Do not learn voice from mediocre posts.** A backfill teaches whatever it is fed. Weight exemplars by
   performance, and route the inferred voice through the ratification step onboarding already has.
4. **Trial-clock interaction.** The clock starts on first social connection — exactly when backfill would
   run, so the customer would spend trial days waiting for their own history to import. Argue for running
   backfill *before* the clock starts, or accept a materially worse first day. This touches a locked
   decision and needs a founder ruling.

**Cost posture:** metrics, timing, formats and frequency are pure arithmetic. Only voice and audience
synthesis need a model, once, over a performance-filtered subset.

---

## 13. The fourth signal source: memory-driven opportunity cards

**This already has a name in the project's own documents: `evergreen-strategic`** — the third opportunity
type in the strategy doc §4 (company-originated · market-responsive · evergreen-strategic), and the one
`plan-vs-implemented-gap-analysis.md` records as *"the one intelligence-doc opportunity type with no
session behind it."*

The insight is that its **source is memory itself**: rather than watching an external feed, the system
interrogates what it already knows — past posts, performance, evidence, audience, engagement — and
proposes what to do.

### Why it is the best of the three sources

- **No external dependency and no counsel blocker.** GitHub releases and RSS both carry launch-blocking
  legal items (ADR 0020 §9.6; ADR 0023 — article licensing, Art. 6(1)(f), controller posture). A
  memory-driven source reads the customer's own data: the cleanest position available, no integration, no
  feed configuration, no third-party content.
- **It is the only source that guarantees a non-empty feed.** A customer with no public repo and no
  configured feeds opens `/opportunities` to nothing. This matters enormously if the growth track's daily
  brief ever ships, since an empty brief is worse than no brief.
- **The pipeline already accepts a new source.** ADR 0023 proved that seam end to end: `signal_candidates`
  → scoring → triage → `insight_cards` → the ten-state feed → Stage F seeding into the brief pipeline.
  This adds a **producer**, not a mode.

### The architectural unification worth stating plainly

The memory-driven cards, T2.5's background agents, and T2.4's planner are **one system at three
altitudes**, not three features:

| Altitude | What it decides | Where the proposal lands |
|---|---|---|
| **Across campaigns** (§13) | what to talk about at all | opportunity feed cards |
| **Within a campaign** (T2.4) | which roles, given what evidence exists | brief-review checkpoint |
| **On a schedule** (T2.5) | what changed that you should know about | the same feed |

All three read the same memory; all three emit proposals; none publishes anything.

**The consequence is a genuine simplification: the opportunity feed is already the proposal surface.**
T2.5 does not need a new inbox, and §13 does not need a new mode — T2.5's "background agents" *are* the
memory signal-sources feeding a feed that already exists, with ten states and a dismissal vocabulary
already built. Three proposals collapse into one system. **If Session D (T2.5) is built, it should be
built as memory signal-sources into the existing feed, not as a parallel surface.**

### What the cards say, grounded in stores that exist

- **Unused evidence** — *"three customer quotes have never appeared in a post; one's permission review
  lapses in 30 days"*
- **Unanswered objection** — *"this objection appears in five dismissed cards and two post edits; you have
  never addressed it directly"*
- **Performance gap** — *"objection-handling posts outperform product updates 3:1; the last one was six
  weeks ago"*
- **Portfolio coverage** — *"48% product features, 8% customer evidence"*
- **Recurrence** — *"your best topic from last year is seasonally live again; here is the updated
  version"*
- **Staleness** — *"this brand claim is 11 months unconfirmed and appears in four scheduled posts"*
- **Repetition** — *"your last three campaigns opened with the same argument"*

Most of these triggers are **arithmetic over memory rows**, not inference. Deterministic-first, with a
model only for phrasing and the final judgment call — the same Stage B posture that keeps Mode 3 cheap.

### Two blockers

1. **The premise "we already have a ton of memory" is not yet true.** `performance_memory` always takes
   the raw-metrics fallback; audience memory ships thin; evidence memory is fed only by onboarding
   inference and the edit-learning loop. The measured 0/24 happened *because* memory was empty.
   **Memory-driven cards are bounded by the memory behind them — §12 is a hard dependency, not a
   companion.** Built first, this produces a feed of thin, obvious observations, which is worse than an
   empty feed because it teaches the customer to stop looking.
2. **The third-source ruling.** ADR 0021 §12's second-source override was explicitly scoped **not to
   travel to a third source** (ADR 0023 §17 Amendment 1). Memory-as-source needs its own ruling, including
   a new shortlist allocation — market-responsive currently holds 2 of 5 slots with a 1-per-feed cap. This
   must not be inferred in a Builder session.

**One point in its favour:** unlike RSS, memory-derived candidates *can* carry a stable identity (pattern
key, evidence row id, claim id), so deduplication may stay deterministic rather than reopening the
embeddings question that ADR 0020 §6.5 named for unstructured sources.

---

## 14. The dependency chain, the rulings, and the added sessions

### The chain

The four sections above are not independent items. They are one sequence, and building them out of order
degrades each:

> **§12 backfill fills memory → §11 gives it enough n to learn from outcomes → §10 lets every feature
> read and write it → §13 turns it into daily proposals → the feed is never empty → the habit holds.**

### The rulings that gate it

| # | Ruling | Blocks | Recommendation |
|---|---|---|---|
| **R1** | **19D-5** — add `fetchRecentPosts` to `SocialProvider`, or amend ADR 0011 §7 to read local posts only. Open since Session 19. | All of §12, therefore most of Part II | **Option 1.** Its value changed the moment backfill became the plan. |
| **R2** | Third-source override for Mode 3 (ADR 0021 §12 / ADR 0023 §17 A1 explicitly do not travel) + a new shortlist allocation | §13 | Needs its own amendment; do not infer |
| **R3** | Comment mining vs. own-posts-only for the backfill (Art. 6(1)(f), `relationship_memory` boundary) | §12's audience yield | Ship own-posts-only v1; take comments to counsel separately |
| **R4** | Does backfill run before the trial clock starts? (touches a locked decision) | §12's first-day experience | Run it before the clock |

### Added to the build path

These extend §7. They assume Sessions A–D as written.

**Session E — Social backfill and the provider read path (ADR 002v).** *§12. Blocked on R1, R3, R4.*
Architect: the `SocialProvider` read contract and its ADR 0002 amendment; per-type extraction (voice,
performance, audience, evidence) and which are deterministic; the performance filter on exemplars; the
ratification step; rate/cost ceilings for a one-time import; where backfilled records sit in the
provenance and confidence model so they are distinguishable from earned memory forever after.
Builder: the provider method, the extractors, the onboarding surface. Reviewer: `security-reviewer` on
token scope for historical reads; `database-reviewer` on the write volume of a one-time import.

**Session F — The outcome loop (ADR 002u).** *§11. Depends on Session E for n.*
Architect: the dimension taxonomy tagged at generation and where it is stored; the normalisation
baseline; the minimum-n and confidence-promotion rules; the decay/re-confirmation policy; the
campaign-level retrospective and its write-back. Builder: dimension tagging in the generation path;
the pattern extractor in `lib/metrics/` writing `performance_memory`; the retrospective.
Reviewer: `database-reviewer`; and someone must check §11.3 is honoured — a pattern promoted below its
n floor is a correctness bug, not a tuning issue.

**Session G — Many writers, wider queries, cross-type retrieval (ADR 002t).** *§10.*
Architect: the write contract and provenance model; contradiction detection and confidence arithmetic;
the widened `MemoryQueryContext`; the cross-type retrieval API and its caps. Builder: writers from
approvals, feed dismissals, calendar reschedules, studio discards and brief regenerations; the widened
query; cross-type retrieval. Reviewer: `database-reviewer` on write amplification and index pressure.

**§13 is not a separate session** — per the unification above, it is Session D (T2.5) with memory
signal-sources, gated on R2 and on Sessions E/F having put something in memory worth interrogating.

### What measures Part II

- **§10:** number of distinct writers; memory rows written per active brand per week.
- **§11:** share of promoted patterns clearing their n floor; **prediction accuracy** — do posts matching
  a promoted pattern actually outperform the baseline? (the only real proof the loop works)
- **§12:** memory rows at end of onboarding vs. today's near-zero; day-1 edit distance vs. the
  no-backfill cohort.
- **§13:** cards per brand per week; **accept rate per card kind** — the number that switches a producer
  off.

---
---

# Part III — How far to take agency

> The decision rule the rest of this document has been applying implicitly. Parts I and II each argued
> their own safety case ad hoc — T2.1 "read-only tools," T2.4 "proposes against the frozen brief," T2.5
> "proposals only, never a published artefact," §12 "own posts, not comments." Those are four instances of
> **one rule**, and stating it once means the next feature can be checked against it instead of
> re-litigating the question.

---

## 15. The rule: agency scales with reversibility × verifiability

Two questions decide how much autonomy any step may have:

- **Reversible?** — If the output is wrong, can it be undone before it reaches the outside world?
- **Verifiable?** — Can the system check the outcome automatically, without a human looking?

### The grid

| | **Verifiable** | **Not verifiable** |
|---|---|---|
| **Reversible** | **Full autonomy.** Retrieval, scoring, dedup, classification, re-ranking, tagging, research, normalisation. | **Autonomy → human gate.** Drafts, briefs, insight cards, revision proposals, plan changes, memory promotions. |
| **Irreversible** | **Still gated.** Publishing, spending, sending email. | **Never autonomous.** Public replies, deletions, anything addressed to a named third party. |

**Everything in both documents sits in the top row.** Nothing proposed anywhere in this file, or in
`growth-sensation-ideas-and-build-path.md`, moves a capability to the bottom row — and that is deliberate,
not incidental.

### Where each proposal lands

| Item | Cell | Why it's safe |
|---|---|---|
| T1.2 best-of-N judging | reversible + verifiable | rubric scores the candidates; a bad pick is a worse draft, nothing more |
| T1.3 thinking budgets | reversible + verifiable | changes reasoning, not reach |
| T1.4 / §10.2 query conditioning | reversible + verifiable | retrieval only |
| T2.1 generator tools | reversible + verifiable | **read-only**, authenticated client, bounded loop |
| T2.2 claim verification | reversible + verifiable | flags, never edits |
| T2.4 campaign planner | reversible + **not** verifiable | proposes against the frozen brief; human ratifies at an existing checkpoint |
| T2.5 background agents | reversible + **not** verifiable | proposals only; accept rate is the graduation signal |
| §11 pattern promotion | reversible + verifiable | n floor and confidence interval are the automatic check |
| §12 backfill writes | reversible + partly verifiable | own data only; inferred voice routed through onboarding's ratification step |
| §13 memory cards | reversible + **not** verifiable | lands in the ten-state feed the human already triages |
| **Publishing** | **irreversible** | **stays gated, permanently — see below** |

### The floor that evidence never lifts

Verifiability is not fixed — it can be **built**. §11's prediction accuracy and §13's per-kind accept
rates are exactly the mechanisms by which a capability moves left across the grid: a producer that
demonstrably calls it right earns a lighter touch. That makes this framework generative rather than
merely restrictive, and it is the practical form of the rule stated in §6 — **agency follows evaluation,
never leads it.**

**But the bottom row has a floor no amount of evidence raises.** Publishing, public replies, deletions
and spending stay gated regardless of how good the numbers get, because human-in-the-loop is a *product
promise* here, not a risk control awaiting better data. A capability may graduate from "human ratifies
every one" to "human ratifies exceptions" **inside** the system — memory promotions, low-confidence
patterns, routine plan changes. It never graduates to acting on the outside world unattended.

That distinction is what lets the product become dramatically more agentic without ever contradicting
what it sells.

### The test for any future feature

Three questions, in order, before building anything that acts on its own:

1. **If this is wrong, what does it cost to undo?** If the answer involves anyone outside the company
   seeing it, it is gated — stop here.
2. **What number tells us it was wrong, and who generates that number?** If nothing does, it emits
   proposals, not actions. If the answer is "a human, just by doing their normal work" — accept rates,
   edit distance, dismissals — that is the right answer, and it should be instrumented in the same
   session that ships the feature.
3. **Which existing gate does its output land in?** If the answer is "a new one," reconsider: §13 showed
   that three proposed surfaces were really one, and a second inbox is how this class of feature dies.
