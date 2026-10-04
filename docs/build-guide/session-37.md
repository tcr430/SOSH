# Session 37 — Analytics and the monthly report (ADR 0031, provisional) · Track O

> **PLACEHOLDER — intent only (written 2026-10-04).** This file records *what Session 37 is for*, sourced
> from the planning docs. It is **not** a build guide yet: the Reality check, §0 Locked decisions, §0.1
> Architect questions, §0.2 adjudications and the §1a/§1b Architect prompts are authored later with the
> `sosh-build-guide` skill, and §2/§3/§4 then follow at their own gates. The ADR number and Track letter are
> provisional until the Architect runs.
>
> **Goal:** ship **T1-B** (`docs/pre-launch-scope.md` §4): a post / campaign / portfolio analytics surface,
> plus a **generated monthly report** the founder can forward to a board.
>
> **Does NOT ship:** the engagement inbox (T1-A, Session 40), founder profiles (T1-E, Session 38), any new
> metrics collection or platform read scope, the content portfolio view (`docs/ideas.md` §3, `OPEN`), or
> any growth/virality prediction (`docs/ideas.md` §3, `PARKED`).

## Why this session, and why now

- **It is half of C-2, the one hard launch gate** (`pre-launch-scope.md` §9, §12.9 P-6). Both pricing
  tiers promise analytics (Plus *"basic analytics"*, Pro *"advanced analytics"*), and
  `docs/product-status.md` records that *"Metrics are collected from platforms and stored; nothing
  displays them."* Either this ships or the pricing page changes.
- **The P-7 ruling recorded the debt** (`pre-launch-scope.md` §14): Track L was sequenced ahead of T1-B,
  with the cost written down as *"it spends a session T1-B could have used ... T1-B is still open and
  unscheduled."* This session pays it.
- **It is the cheapest Tier-1 item.** `pre-launch-scope.md` §4 T1-B: *"cheap once Session 33 lands"* —
  and Session 33 (ADR 0026, the outcome loop) has landed. No counsel question, no new OAuth scope.
- **It closes the Accountability quadrant** (`pre-launch-scope.md` §3), currently *"Nothing"*. An
  agency's monthly report is *"half of what the retainer buys."*

## What already exists (to be re-verified in the Reality check)

- `post_metrics`, collected by `lib/metrics/orchestrator.ts` (`pre-launch-scope.md` §2).
- Session 33 / ADR 0026: dimension tagging, outcome patterns in `performance_memory`, the campaign
  retrospective, and the north-star query `get_learning_cycles_northstar` / `scripts/northstar-report.ts`
  (`docs/current-phase.md`, Session 33 entry).
- A *"metrics unavailable"* state already read from a `/lib/social/` capability (Session 33-D MINOR-5).

## What the Architect will have to decide (themes, not the §0.1 questions)

- **Plus vs Pro split** — what "basic" and "advanced" analytics actually mean, so the pricing copy (C-2)
  can be written against something real.
- **The monthly report artefact** — format (in-app page, PDF, email via Resend), schedule, which model
  writes the narrative through `/lib/ai/`, and its cost ceiling.
- **Honesty rules carried from governed memory** — every pattern rendered with its n (*"based on 7
  posts"*), never as an instruction; correlation never presented as causation (`docs/ideas.md` §3,
  growth-simulator rejection).
- **The empty production state.** No production OAuth app is registered, so no real customer has
  metrics (`current-phase.md`, Session 33: *"The pattern layer is EMPTY in production"*). Empty and
  thin-data states are part of the contract, not polish.
- **Account-shape readiness** — metrics must be sliceable per connected account, so Session 38's founder
  profiles slot in without a retrofit.

## Constraints it inherits

DB access only through `/lib/db/`; memory only through `/lib/memory/`; list queries bounded and ordered;
RLS on anything new plus an ADR 0010 §D2.5 cascade row; i18n in en/pt/es; Server Components by default;
`/impeccable` / `/taste-skill` only in the Builder against the ADR's UX contract.

## §2 — Builder · §3 — Reviewer · §4 — Correction pass

> **PLACEHOLDER — §2 and §3 are authored after the ADR is Accepted; §4 only after the Reviewer has run and
> `docs/reviews/session-37-reviewer.md` exists.**

## Next

**Session 38 — founder / personal profiles (T1-E).**
