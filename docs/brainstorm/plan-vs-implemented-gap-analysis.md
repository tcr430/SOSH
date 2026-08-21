# Plan vs. Implemented — Gap Analysis (Sessions 25–28)

Comparison of the four planning documents in this directory against what sessions 25–28 (and the ADRs they produced, 0016–0021) actually shipped. Verified against `docs/current-phase.md`, `docs/decisions/`, and the real `lib/`/`app/` source rather than trusting build-guide docs' claims at face value.

Source docs compared:
- `campaign-modes-architecture-and-build-plan.md`
- `intelligence-layer-memory-mining-rubric-opportunity-feed.md`
- `media-generation-editor-phase-2-brainstorm.md`
- `session-plan-adrs-0016-0018.md`

---

## Overall: the plan was substantially delivered, ahead of its own original scope

`session-plan-adrs-0016-0018.md` originally scoped only **Tracks A–C** (ADR 0016 governed memory, ADR 0017 Mode 2 upgrade, ADR 0018 diff-learning), explicitly deferring Mode 1 and Mode 3 "until Tracks A–C have landed." In practice the team kept going: **ADR 0019 (Mode 1 Studio, Session 26)**, **ADR 0020 (Mode 3 ingestion, Session 27)**, and **ADR 0021 (Mode 3 triage/cards/feed, Session 28)** all shipped and closed. By session 28, all three campaign modes and the full intelligence layer are built — more than the original 3-ADR plan called for.

---

## Specific gaps vs. the brainstorm docs

### Governed memory (intelligence-layer doc §1)
4 of 6 memory types shipped: `brand_memory`, `evidence_memory`, `audience_memory`, `performance_memory`.
- **`relationship_memory` was never built** — ADR 0016 explicitly parks it as Phase-2 engagement-inbox scope.
- **Voice memory has no dedicated table** — it deliberately reads through the existing `brand_voices`/`avoid_words` tables rather than a new `voice_memory` store (a documented ADR decision, not an omission).

### Mode 3 candidate scoring (campaign-modes doc §1, Stage B)
Planned as "cheap embeddings + dedup + clustering." ADR 0020 explicitly rejected this: **no pgvector, no embeddings, no LLM anywhere in Stage B** — deterministic dedup only, with a named revival condition (`EMBEDDINGS_UNDEFER_THRESHOLD`, only once a second unstructured signal source exists).

### Mode 3 opportunity types (intelligence-layer doc §2)
Only **company-originated** (GitHub releases/changelog) shipped, exactly per the plan's own instruction to "start with one signal source" and "skip market-responsive entirely at first."
- **Market-responsive (competitor/news monitoring) and evergreen-strategic are not built.**

### Mode 1 Studio "promote to campaign" (campaign-modes doc §1, Mode 1)
Explicitly deferred. ADR 0019 Locked Decision L-3/D-1 names "promote-to-campaign" as out of scope for Track D, a distinct future surface. Studio currently produces a reviewed draft but cannot yet seed a campaign brief the way an approved Mode 3 insight card can.

### Format-family schemas (campaign-modes doc §1, Mode 2)
Only **single-post and thread** shipped (ADR 0017).
- **Carousel and script format families are not built** — deferred to when Instagram/TikTok are prioritized, per the original plan.

### Skip-review fast path (campaign-modes doc, Phase A risk note)
The idea of letting repeat users skip the brief-review checkpoint once brief quality is validated — **not built**, deferred as ADR 0017 L-11.

### Media generation / editor (media-generation-editor-phase-2-brainstorm.md)
**Entirely not implemented**, as expected. This document is explicitly scoped as Phase 2 brainstorm, out of the 0016–0018 plan by its own §4. No editor, no Tier 0 asset-reuse, no template-driven generation, no image generation of any kind exists yet — consistent with the constitution's "we don't generate images at launch" rule, still true as of session 28.

### Mode 3 insight-card expiry/decay
The plan called this out as required "from the start." Session 28's opportunity feed implements an `expired` state among its ten feed states — this landed, not a gap.

---

## Caveat worth flagging

The eval/quality evidence behind Mode 3's triage step (`SIGNAL3-TRIAGE-QUALITY`) is explicitly framed in the current docs as a **"bootstrap ceiling"** — a perfect score against hand-labelled cassettes, not real-world precision/recall. This is a known, documented limitation rather than a hidden gap, but it means Mode 3's triage quality is unproven against real signal traffic.
