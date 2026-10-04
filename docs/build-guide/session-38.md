# Session 38 — Founder and personal profiles (ADR 0032, provisional) · Track P

> **PLACEHOLDER — intent only (written 2026-10-04).** This file records *what Session 38 is for*, sourced
> from the planning docs. It is **not** a build guide yet: the Reality check, §0 Locked decisions, §0.1
> Architect questions, §0.2 adjudications and the §1a/§1b Architect prompts are authored later with the
> `sosh-build-guide` skill, and §2/§3/§4 then follow at their own gates. The ADR number and Track letter are
> provisional until the Architect runs.
>
> **Goal:** ship **T1-E** (`docs/pre-launch-scope.md` §4, §12.2): a founder's personal LinkedIn / X
> profile connected **as an account belonging to the business workspace**, generated in a **distinct
> founder voice** through the existing ADR 0011 voice-variation machinery, with the **approval gate
> unchanged**.
>
> **Does NOT ship (§12.2, explicitly out of scope):** multi-founder workspaces; per-person seats mapped to
> personal accounts beyond what ADR 0013/0014 already give; *"anything resembling posting as a person who
> has not personally connected their own account."*

## Why this session, and why now

- **It is a locked decision that was never built.** `CLAUDE.md`'s launch platforms already read
  *"LinkedIn (Business and Founder), X (Business and Founder)"*; `docs/product-status.md` records founder
  profiles as *"in the platform list as a decision, but not implemented."*
- **It is the ICP's best channel.** `pre-launch-scope.md` §12.2: *"the founder's personal LinkedIn
  routinely outperforms the company page several times over, and ghostwriting for founders is what the
  good agencies actually sell."*
- **It shapes the accounts the later Tier-1 items build on.** The inbox (Session 40) and carousels
  (Session 39) should be built against account-shaped connections, not retrofitted to them. §12.2 already
  required Session 32's read path to be *"account-shaped, not org-shaped."*
- **It fixes the OAuth scope set before production app registration.** No production OAuth app is
  registered with LinkedIn or X (`docs/current-phase.md`, `launch-checklist.md` §16), and that is what
  keeps Sessions 33–36 inert in production. Deciding the personal-profile scopes first avoids
  registering twice. Platform product/scope restrictions are an **Architect question to verify against
  current platform docs, not an assumed fact.**

## What already exists (to be re-verified in the Reality check)

- Native `LinkedInProvider` / `TwitterProvider` behind `/lib/social/` (Session 30.5, ADR 0028).
- ADR 0011 voice model: `brand_voices` / `brand_voice_variations` — voice has no memory table of its own
  (`MEM-VOICE-THROUGH-EXISTING`).
- Session 32 (ADR 0025) cold-start backfill — §12.2 notes the founder's own personal history is the
  highest-value backfill corpus for a founder-led company.
- Token storage in Supabase Vault; disconnect = deactivate, null vault ids, delete secrets.

## What the Architect will have to decide (themes, not the §0.1 questions)

- **Account model** — how a personal account is represented in `social_accounts` relative to the
  business, and who in the workspace may connect it (it must be the person themself).
- **Voice binding** — how a founder variation attaches to a personal account, and how generation picks
  it.
- **Approval semantics** — §12.2: *"a founder's personal account is more sensitive, not less, so nothing
  about human-in-the-loop relaxes."* Whether the founder must approve their own posts is a candidate
  founder adjudication.
- **Backfill and memory scope** — whether personal-account history feeds business memory, and with what
  provenance.
- **Billing / plan limits** — whether a founder account counts against Plus's "LinkedIn + X" allowance.
- **Counsel** — a personal account is personal data of a named individual; GDPR position on disconnect
  and erasure.

## Constraints it inherits

No provider import outside `/lib/social/`; raw tokens never outside Vault; RLS with `USING` + `WITH
CHECK` on every UPDATE; ADR 0010 §D2.5 cascade row for any new business-scoped table; i18n en/pt/es.

## §2 — Builder · §3 — Reviewer · §4 — Correction pass

> **PLACEHOLDER — §2 and §3 are authored after the ADR is Accepted; §4 only after the Reviewer has run and
> `docs/reviews/session-38-reviewer.md` exists.**

## Next

**Session 39 — template carousels (T1-C).**
