# Session 40 — The engagement inbox (ADR 0034, provisional) · Track R

> **PLACEHOLDER — intent only (written 2026-10-04).** This file records *what Session 40 is for*, sourced
> from the planning docs. It is **not** a build guide yet: the Reality check, §0 Locked decisions, §0.1
> Architect questions, §0.2 adjudications and the §1a/§1b Architect prompts are authored later with the
> `sosh-build-guide` skill, and §2/§3/§4 then follow at their own gates. The ADR number and Track letter are
> provisional until the Architect runs. **Expect this track to need two sessions** — the Architect may
> split it.
>
> **Goal:** ship **T1-A** (`docs/pre-launch-scope.md` §4): comments and mentions on the customer's
> **own** posts, **classified** (support / product feedback / qualified interest / objection / advocate /
> partnership / content opportunity / reputation risk / routine), each with a **drafted reply** and a
> **human approval gate**.
>
> **Does NOT ship:** autonomous public replies — *"No autonomous public replies, ever"* (§4, §6, §12.8;
> `CLAUDE.md`: every reply is human-approved, permanently, at any plan tier); the Social CRM
> (`docs/ideas.md` §3, stays post-launch); full social listening beyond the customer's own posts (§6);
> reading activity on accounts the customer does not own.
>
> **Does not begin until** the counsel work on third-party personal data has at least started — see
> below.

## Why this session, and why now

- **It is promised in both tiers and does not exist.** `pre-launch-scope.md` §2: the inbox *"is not a
  Pro differentiator at all, it is a floor-level promise on the cheapest plan."* It is the other half of
  the C-2 pricing gate, with analytics (Session 37).
- **It is the missing half of the Execution quadrant** (§3: *"Publishing only"*). §4: *"For founder-led
  B2B, replies drive more pipeline than posts. A prospect asks 'who handles the comments?' in the first
  demo."*
- **It is last of the four because it is the largest and riskiest**: new platform read scopes, a new
  counsel question, and un-parking a memory store.

## What already exists (to be re-verified in the Reality check)

- The triage machinery that §4 says *"transfers almost wholesale"*: `runToolLoop`, the closed read-only
  tool pattern, the ten-state opportunity feed (ADR 0021), and Session 34's generation tool patterns
  (ADR 0027).
- `relationship_memory` — specified in ADR 0016 and **parked** until the inbox ships; this session
  un-parks it.
- Account-shaped connections from Session 38, so founder-profile comments are in scope from day one.

## What the Architect will have to decide (themes, not the §0.1 questions)

- **Platform feasibility** — what LinkedIn and X actually serve for comments and mentions on the
  customer's own posts, at what access tier and price, recorded in an honest per-platform table (the
  Session 32 Q1 precedent). If a platform cannot serve it, that is the finding.
- **Counsel** — third-party personal data (commenters), *"the same class as the ADR 0020 §9.6 / ADR 0023
  items, not covered by them"* (§4). Lawful basis, retention, erasure, and the `/privacy` prose with its
  `evidenceRef` bump.
- **Ingestion** — polling vs webhooks, cadence, dedup, and untrusted-content neutralisation (commenter
  text is prompt-injection surface).
- **Classification** — the nine classes, which model, measured how (a Tier E MEASURED slice is the
  likely shape, per ADR 0015 Amendment B4).
- **Reply drafting and approval** — reuse of the approval gate and seats/roles (ADR 0013/0014), and
  publishing replies through `/lib/social/`.
- **`relationship_memory`** — what is stored about a commenter, its governance fields, and its scope;
  ADR 0010 §D2.5 cascade rows for every new table.

## Constraints it inherits

No autonomous replies, ever; provider calls only inside `/lib/social/`; memory only through
`/lib/memory/`; RLS + cascade rows on every new table; bounded, ordered list queries; i18n en/pt/es;
`security-reviewer` mandatory in review (new untrusted input inside a generation path).

## §2 — Builder · §3 — Reviewer · §4 — Correction pass

> **PLACEHOLDER — §2 and §3 are authored after the ADR is Accepted; §4 only after the Reviewer has run and
> `docs/reviews/session-40-reviewer.md` exists.**

## Next

With T1-A to T1-E shipped, the remaining launch gate is `docs/pre-launch-scope.md` §10: every
`launch-checklist.md` row green, the C-2 pricing copy matching the product, and Tier 2 shipped or deferred
with a named trigger.
