# Jemip — Product Status

> **What this is:** an honest account of what the product **is today**, from a customer's point of view.
> What someone could actually do with it, what works, what is promised but absent, and what is known to be
> weak.
>
> **What this is not:** `docs/current-phase.md` — that tracks development state (sessions, ADRs, CI runs,
> correction passes) and is the right place for engineering progress. This file answers a different
> question: *if we handed this to a customer this morning, what would they get?*
>
> **Basis:** written 2026-09-02, verified against the source at `b297a4a8` rather than against planning
> documents. **Naming:** the product is being renamed SOSH → Jemip; the codebase still says SOSH.

---

## Where we are, in one paragraph

**Jemip has an unusually strong engine and an incomplete product around it.** The parts that decide *what
to say* — governed memory, three campaign modes, signal ingestion and triage, a critique gate, a learning
loop that reads the difference between what the AI wrote and what a human approved — are built, tested and
better than what the market ships. The parts that make it a *service* rather than an engine — the
engagement inbox, analytics, visual formats, and a reporting artefact — are not built at all. **It is not
yet sellable at the advertised price**, because two of the things the pricing page promises have no
surface in the product.

---

## The scorecard

An agency sells four things. This is where we stand against each.

| | What it means | Status |
|---|---|---|
| **Judgment** — what to say, why now, to whom | Campaign modes, memory, signals, critique gate | **Strong.** The most complete part of the product and the genuine differentiator. |
| **Production** — making the artefacts | Copy, visuals, formats | **Partial.** Text only. No images, no carousels in practice, no video. |
| **Execution** — publishing *and* engaging | Scheduling, publishing, replies | **Half.** Publishing works. Engagement does not exist. |
| **Accountability** — reporting, owning the number | Analytics, insight, monthly report | **Absent.** Metrics are collected and never shown or learned from. |

---

## What a customer could actually do today

End to end, this journey works:

1. **Sign up** on a work email, with a card, and get a 14-day trial.
2. **Onboard** through four steps, including having their **brand voice inferred from their website** and
   ratifying it.
3. **Connect social accounts** (which starts the trial clock).
4. **Create a campaign** three different ways:
   - **Studio** — start from their own draft or idea and let Jemip develop it, then promote it to a
     campaign.
   - **From an objective** — describe what they want to achieve; Jemip assembles a strategic brief, runs
     a quality critique gate over it, freezes it, and generates a sequence of posts with distinct roles.
   - **From a signal** — Jemip watches their GitHub releases and any RSS/Atom feeds they add, triages what
     it finds, and proposes **insight cards** in an opportunity feed; an approved card seeds a brief.
5. **Review and approve** posts in an approvals inbox, individually or in bulk, with team seats and
   permissions.
6. **Schedule** on a content calendar.
7. **Publish** automatically across connected platforms.
8. **Have their edits learned from** — every change they make to an AI draft is captured, classified, and
   promoted into memory, so future drafts drift toward their taste.

That is a real product, and the loop from *"something happened"* to *"a considered post went out in our
voice"* genuinely closes.

---

## Capability inventory

### Built and working

- **Accounts, onboarding, brand voice** — including inference from the customer's website and a
  ratification step, plus voice variations.
- **Governed memory** — four typed stores (brand, evidence, audience, performance) with source,
  confidence, recency decay, expiry and scope. Voice reads through the existing brand-voice tables by
  design. Not one undifferentiated vector blob — this is the part of the architecture worth defending.
- **Three campaign modes** — Studio, objective-driven, and signal-driven, all shipped and reviewed.
- **Strategic briefs** — objective, audience, narrative, evidence, role sequence, with a **quality
  critique gate** that scores the brief on ten dimensions and blocks weak ones before generation.
- **Platform-native generation** — posts written per platform rather than copy-pasted, with format
  families (single post, thread).
- **Signal ingestion and triage** — GitHub releases and customer-supplied RSS/Atom feeds, deterministic
  deduplication and scoring, then a bounded AI triage step that decides what deserves a card.
- **Opportunity feed** — insight cards with ten states, approve / dismiss-with-reason / save, and expiry.
- **Approvals** — inbox with bulk approve, seats and role-based permissions.
- **Content calendar.**
- **Publishing** — scheduling, retries, status reconciliation.
- **Learning from edits** — the difference between the AI's draft and the approved version is captured,
  classified and promoted into memory.
- **Billing** (Stripe), **transactional email** (Resend), **legal surface**, **marketing site**, and
  **three languages** (English, Portuguese, Spanish) throughout.

### Partial

- **Publishing runs through native LinkedIn and X providers** (Session 30.5, ADR 0028) — the prior broker
  is fully removed from the codebase. Production OAuth apps are not yet registered with either platform,
  so no real customer has connected an account end-to-end yet; this is the remaining gap before the
  migration is customer-visible-complete, not a code gap.
- **Carousels** exist as a format in the code but nothing ever selects one, so in practice output is
  text-only.
- **Founder/personal profiles** are now in the platform list as a decision, but are not implemented.
- **Performance memory** exists as a store but is fed only by editing behaviour, never by real results.

### Not built

- **Engagement inbox.** No comment or mention handling of any kind. *Promised in both pricing tiers.*
- **Analytics.** Metrics are collected from platforms and stored; **nothing displays them** and nothing
  learns from them. *Promised in both pricing tiers.*
- **Monthly report.** No artefact a customer could forward to a board.
- **Image generation** — now scoped as pre-launch, not started.
- **Video generation** — explicitly post-launch.
- **Additional content sources** — Notion, Slack, Linear, call transcripts, support tickets. Only GitHub
  and RSS exist.
- **A way to get information out of the founder's head** — everything Jemip knows comes from the website,
  from published posts, or from watched sources. There is no interview or input mechanism.

---

## The gap between what is sold and what exists

**This is the most important section of this document.**

| Promised in `CLAUDE.md` pricing | Reality |
|---|---|
| Plus (€79) — *"basic analytics"* | No analytics surface exists |
| Plus (€79) — *"engagement inbox"* | No inbox exists |
| Pro (€125) — *"advanced analytics"* | No analytics surface exists |
| Pro (€125) — *"engagement inbox"* | No inbox exists |
| Pro (€125) — *"AI driven posts/campaigns"* | **Built** — this one is real |

**Jemip cannot be sold at the current pricing wording today.** Either those capabilities ship, or the
pricing page changes to describe what exists. `docs/pre-launch-scope.md` treats both as Tier-1 pre-launch
work for exactly this reason.

---

## Known weaknesses, stated plainly

- **Memory starts empty, and the product is only as good as its memory.** A new customer's first weeks are
  the product's worst weeks, and we have measured this: in a live evaluation, the market-responsive signal
  source scored **0 of 24** on cases it should have flagged, with the model citing absent brand and
  audience memory in every refusal. Cold start is the single most consequential weakness we know of.
- **Nothing learns from published results.** The learning loop reads pre-publication editing behaviour, not
  post-publication outcomes. The system currently gets better at matching your taste, not at matching what
  actually performs.
- **Generation gets one attempt.** Posts are checked on one quality dimension with a single retry; there is
  no multi-candidate generation, no reasoning budget, and no ability for the model to look anything up
  before writing.
- **Output is text.** On platforms where visual formats carry most of the reach, this is a real competitive
  gap, not a stylistic preference.
- **Quality evidence is thinner than the architecture.** Our evaluation numbers come from a
  hand-labelled corpus scored against its own labels — a ceiling, not a proof of real-world quality.
- **Some pre-launch legal and operational work remains open**, including counsel ratification of the legal
  surface and the native-provider migration.

---

## In flight

Four sessions are planned and Architect-ready (`docs/build-guide/session-31.md`…`34.md`): generation
quality, importing a customer's social history to solve cold start, closing the outcome-learning loop, and
giving the generator the ability to look things up and check its own claims. Together they address four of
the six weaknesses above.

`docs/pre-launch-scope.md` holds what must exist before launch beyond that; `docs/ideas.md` holds what is
possible but uncommitted.

---

## The honest summary

If a customer used Jemip today, they would get **a genuinely good answer to "what should we post, and
why"** — better than any tool at this price and arguably better than most agencies at any price — followed
by **text-only execution, no help with the conversation afterwards, and no account of whether any of it
worked.**

That is a strong half of a product. The vision document describes the whole one, and
`docs/pre-launch-scope.md` is the list of what closes the distance.
