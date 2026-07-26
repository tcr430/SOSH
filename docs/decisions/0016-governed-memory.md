# ADR 0016 — Governed Memory Foundation

- **Status:** Accepted
- **Date:** 2026-07-19
- **Track:** A (of the ADR 0016→0017→0018 intelligence-layer programme; `docs/brainstorm/session-plan-adrs-0016-0018.md`)
- **Supersedes / amends:** none. Adds a new module boundary (`lib/memory/`) and new tables; amends ADR 0010 Amendment 2 §D2.5 (cascade table) by row-addition only.
- **Source design docs:** `docs/brainstorm/intelligence-layer-memory-mining-rubric-opportunity-feed.md` §1 (primary); `docs/brainstorm/campaign-modes-architecture-and-build-plan.md`; build guide `docs/build-guide/session-23.md` §0/§0.1 (binding scope + the four questions this ADR resolves).
- **Scope discipline:** this ADR ships the **read side + schema + governance metadata** only. No learning/distillation worker, no Mode 2 brief pipeline, no rubric, no mining, no UI, no new route. Those are Tracks B/C and later (§10).

---

## 1. Context + decision summary

### 1.1 What `buildCustomerContext` does today

`buildCustomerContext` (`lib/ai/context.ts:31-45`) runs a **service-role** client
(`context.ts:35-37`) and assembles `CustomerContext` (`context.ts:13-29`) from a **fixed five-way
fan-out**, every call, same shape:

```
getBusinessById(client, businessId)          context.ts:40
getBrandVoice(client, businessId)            context.ts:41
listCampaigns(client, businessId, 5)         context.ts:42   — fixed limit 5
listTopPostMetrics(client, businessId, 10)   context.ts:43   — fixed limit 10, ORDER BY likes DESC (post-metrics.ts:33-46)
getTrialStateMaybe(client, businessId)       context.ts:44
```

The result is handed to `runPrompt` (`lib/ai/runner.ts:55-59`), which then **dumps the entire object
verbatim** into the first user message:

```
const userContextMsg = JSON.stringify(context)     runner.ts:94
… { type: 'text', text: userContextMsg } …          runner.ts:101   — uncached user block
```

on top of the already-templated `prompt.buildUserMessage(input, context)` (`runner.ts:95`).
`cache_control: ephemeral` is set **only on the system block, only when it exceeds 4096 chars**
(`runner.ts:85-91`), so the biggest per-call payload — the JSON context dump — is uncached and
undifferentiated.

### 1.2 Why that is the problem

Three failures, all named in the source design (`intelligence-layer §1`, lines 12-16, 35-71):

1. **No relevance scoring, no confidence, no cap.** `listTopPostMetrics(…,10)` is "the 10 most-liked,
   always," not "the 3 most *relevant to this campaign objective*." The discipline missing is
   prioritisation — "include everything relevant" instead of "rank, then take the top-N."
2. **No governance.** Nothing carries source, confidence, sensitivity, permission, or expiry. The
   system cannot say *"technical-comparison posts appear to work for CTO audiences, based on 3
   campaigns"* — it can only assert or omit.
3. **Wholesale prompt inclusion.** `JSON.stringify(context)` (`runner.ts:94`) is the literal
   "stuff more into the context object" anti-pattern the design calls out, and it defeats prompt
   caching because the per-call blob sits uncached in the user message.

### 1.3 The fix — split three things currently collapsed into one call

Per `intelligence-layer §1` (lines 35-65), separate:

- **Learning** — background, periodic, AI-driven distillation into confidence-scored statements.
  **Track C (ADR 0018).** Not built here.
- **Retrieval** — per-call, cheap, **deterministic code**, hard-budgeted: rank by relevance +
  confidence + recency, then take a **hard cap**. **This ADR.**
- **Generation** — unchanged; `runPrompt` still makes one call with pre-retrieved, pre-capped context.

Retrieval lives behind a new module boundary `lib/memory/`, one file per memory type, mirroring how
`lib/social/` fronts providers and `lib/db/` fronts tables. `buildCustomerContext` becomes a
*consumer* of `lib/memory/`, not a direct fan-out caller for the sections that should be scoped.

### 1.4 Decision ledger (losers named — build guide §0 D-1..D-5)

| # | Decision | Chosen | Loser (rationale) |
|---|---|---|---|
| D-1 | Track A scope | governed-memory read side + schema only | bundling Mode 2 / rubric / mining (each depends on foundations still being built — staleness, plan §4) |
| D-2 | Module home | new `lib/memory/`, per-type `retrieveRelevant` | extend `lib/db/` (loses the scoring boundary); extend `lib/ai/` (conflates selection with generation) |
| D-3 | Retrieval mechanism | scored + **hard-capped** deterministic query | LLM-decides-what-to-retrieve (cost, latency, quiet failure — `intelligence-layer §5` names the invisible-skip failure mode) |
| D-4 | Learning write side | **deferred to Track C** | build the distillation worker now (nothing to distill until the diff loop exists) |
| D-5 | Rewire risk | behaviour-equivalence gate (L-7) | free-hand refactor of the load-bearing context builder |
| D-6 | Table shape | one table per memory type, shared governance columns | single polymorphic `memory_records` + JSONB payload (loses per-type indexes, column constraints, type-safe rows) |

---

## 2. The memory-record schema (governance metadata — L-5)

Every governed-memory table carries the **same governance column block**. This is a documented shared
shape, not a shared table (D-6): per-type tables keep their own domain columns and indexes.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | — |
| `business_id` | `uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE` | tenancy key + erasure path (§4) |
| `source` | `text NOT NULL CHECK (source IN ('manual','distilled','import'))` | provenance; `distilled` = written by Track C's worker |
| `confidence` | `numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1)` | **Q3** — continuous 0–1 scale |
| `observation_count` | `int NOT NULL DEFAULT 1 CHECK (observation_count >= 1)` | how many signals back this record; Track C's promotion threshold reads it |
| `status` | `text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','active','retired'))` | **retrieval returns `active` only** — the structural "one data point is not fact" gate |
| `sensitivity` | `text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public','internal','confidential'))` | — |
| `public_use_permission` | `boolean NOT NULL DEFAULT false` | may this be surfaced in published output? |
| `scope` | `text NOT NULL CHECK (scope IN ('brand','campaign','platform','contact'))` | governance scope band |
| `scope_ref` | `text` | optional pointer within the scope (a platform value, a `campaign_id`); nullable |
| `last_confirmed_at` | `timestamptz` | recency signal for scoring + decay; nullable |
| `expires_at` | `timestamptz` | `NULL` = no expiry; retrieval excludes `expires_at < now()` |
| `deleted_at` | `timestamptz` | soft-delete, filtered in `lib/db/` (CLAUDE.md); nullable |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | — |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | `BEFORE UPDATE` trigger `set_updated_at()` (as `campaigns.sql:38-40`) |

**Q3 rationale (confidence model).** Chosen: `numeric(3,2)` in `[0,1]` + `observation_count` +
`status` lifecycle. **Loser:** a discrete band enum (`low/med/high`) — it cannot encode "3 campaigns"
evidence weight, cannot decay smoothly against `last_confirmed_at`, and cannot express "observed once,
not yet trusted." The `status` enum makes L-5's *probabilistic, not permanent* rule **structural**:
a record enters `candidate` (never retrieved), and only Track C's aggregation promotes it to `active`.
The **threshold** that gates promotion is Track C's (ADR 0018); the **columns it gates on** are here.

**Timestamps** use `now()` in SQL defaults (DB-side, correct); all application-layer timestamp handling
uses `date-fns formatISO`, never `new Date().toISOString()` (CLAUDE.md, L-9).

---

## 3. The tables shipped (Q1)

**Shipped as new governed tables:** `brand_memory`, `evidence_memory`, `audience_memory`,
`performance_memory`. **Voice is read THROUGH the existing tables** (§3.5). **`relationship` memory is
deferred** (§3.6).

Each table below lists only its **domain columns** — the full governance block from §2 is present on
every one and not repeated. Every table gets the standard four RLS policies and the cascade wiring in
§4.

### 3.1 `brand_memory` — stable approved brand facts

Domain columns:
- `category text NOT NULL CHECK (category IN ('positioning','capability','pricing','competitor','other'))`
- `statement text NOT NULL` — the fact ("we integrate natively with Postiz", "€99/mo Plus tier")

Indexes:
- `brand_memory_business_id_idx (business_id)`
- `brand_memory_retrieval_idx (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC) WHERE deleted_at IS NULL AND status = 'active'` — matches the candidate ORDER BY (§5.3)

### 3.2 `evidence_memory` — material that supports claims

Domain columns:
- `kind text NOT NULL CHECK (kind IN ('quote','case_study','usage_data','other'))`
- `content text NOT NULL` — the quote / stat / summary
- `source_url text` — provenance link, nullable

> **Sensitivity note:** `evidence_memory` may hold third-party PII (a named customer quote). It is
> `business_id`-scoped and `ON DELETE CASCADE`, so business erasure purges it (§4) — cascade *is*
> erasure. `sensitivity` + `public_use_permission` govern whether a given quote may reach published
> output; enforcement of that gate is a **consumer** concern (0017's brief assembly), flagged in §10.

Indexes:
- `evidence_memory_business_id_idx (business_id)`
- `evidence_memory_retrieval_idx (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC) WHERE deleted_at IS NULL AND status = 'active'`

### 3.3 `audience_memory` — what audiences care about

Domain columns:
- `segment text` — audience label ("CTOs at seed-stage SaaS"), nullable
- `kind text NOT NULL CHECK (kind IN ('problem','objection','question','trigger','other'))`
- `statement text NOT NULL`

Indexes:
- `audience_memory_business_id_idx (business_id)`
- `audience_memory_retrieval_idx (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC) WHERE deleted_at IS NULL AND status = 'active'`

### 3.4 `performance_memory` — what has *appeared* to work (Track C's write target)

Domain columns:
- `dimension text NOT NULL CHECK (dimension IN ('topic','hook','format','proof_type'))`
- `pattern text NOT NULL` — "technical-comparison posts perform well for CTO audiences"
- `platform text CHECK (platform IS NULL OR platform IN ('linkedin','twitter','instagram','facebook','threads'))`

Indexes:
- `performance_memory_business_id_idx (business_id)`
- `performance_memory_retrieval_idx (business_id, confidence DESC, COALESCE(last_confirmed_at, created_at) DESC) WHERE deleted_at IS NULL AND status = 'active'`

> **Track-A reality (important):** this table ships **empty** — its writer is Track C's distillation
> worker. To honour behaviour-equivalence (§6, L-7), `lib/memory/performance.ts` in Track A **derives**
> its scored patterns from the **existing `post_metrics`** (real data today, via the current
> `listTopPostMetrics` path, `post-metrics.ts:33-46`), and **prefers `performance_memory` rows once
> Track C populates them**. The table + RLS + cascade are shipped now so Track C has a governed target;
> the *source* of performance retrieval in Track A is `post_metrics`.

> **UN-DEFER TRIGGER (named — MINOR-2, Session 23 review · CORRECTED at D3).**
> `lib/memory/performance.ts` maps governed `performance_memory` rows to `PerformancePattern` with
> **literal `likes: 0, impressions: 0`**, because a distilled pattern has no single post's metrics.
>
> **Correction to this note as first written at D0, and to MINOR-2 as the Reviewer stated it.** Both
> claimed `post-generation.ts:153-154` renders those numbers verbatim, so a populated
> `performance_memory` would feed the model insights annotated *"0 likes, 0 impressions"* — read as
> evidence the pattern performs **badly**. **That is not what the template does.** The render is:
>
> ```js
> const perfList = ctx.recentPostPerformance.map(p => `- ${p.topContent}`).join('\n')
> ```
>
> **Only `topContent` reaches the prompt.** `grep -n "likes\|impressions" lib/ai/prompts/*.ts` matches
> nothing outside a test fixture — no template renders either number, in any of the three. The
> prompt-corruption risk as described **does not currently exist**, and did not at any commit in the
> reviewed range.
>
> **What remains real, and why this trigger still stands.** The zeroes are a **latent type-shape trap**,
> not a live defect: `PerformancePattern` requires `number` for both, so every governed row must invent
> a value it does not have. Any future template that starts rendering the metrics clause — a plausible
> ADR 0017 change, since richer pattern context is exactly what Mode 2 wants — would silently activate
> the inversion. The trigger is therefore **downgraded in severity but kept**, and the resolution is
> unchanged: make the numerics **optional** on `PerformancePattern` and omit the metrics clause when
> absent, or carry **`observation_count`** as the credibility signal ("appeared in 3 campaigns"), which
> is what L-5's probabilistic framing actually wants.
>
> **ADR 0018 must not ship a `performance_memory` writer without resolving the placeholder**, and
> **ADR 0017 must not add a metrics clause to any template while it stands.** Deferred in Session 23-D
> §4.4; **owner: ADR 0018.**

> **RESOLVED — Session 23-E (2026-07-21), commit `6149535f`.** The trigger's own resolution was
> implemented rather than carried to ADR 0018:
> - **MINOR-2:** `likes`/`impressions` are now **optional** on `PerformancePattern` (and on
>   `CustomerContext.recentPostPerformance`); the governed branch **omits** them instead of inventing
>   `0`. The `post_metrics` fallback still carries real per-post counts. The latent type-shape trap is
>   closed — a governed row no longer invents metrics it does not have.
> - **MINOR-3:** `platform` is widened to `Platform | null`; the governed branch **no longer drops**
>   cross-platform (null-platform) rows (which silently under-filled the cap for a business whose
>   patterns were all cross-platform). Both post-writing templates now render each example's platform as
>   **provenance** — `On {platform}: …` for a platform-specific example, `Across platforms: …` for a
>   cross-platform one — so the model can calibrate tone when the target platform differs.
>
> **Behaviour change on the live path (recorded, not silent):** the `post_metrics` fallback ships
> today, so this adds an `On {platform}: ` prefix to performance snippets in real generation prompts
> **now**, not only once Track C populates the table. This is an information gain — the model previously
> saw the snippet with no provenance — accepted deliberately. The constraint *"ADR 0017 must not add a
> metrics clause while the placeholder stands"* is **discharged, not violated**: no metrics clause is
> rendered, and the numerics now being optional means a future clause cannot resurrect the `0/0`
> inversion.

### 3.5 Voice — read THROUGH the existing tables, never duplicated (MEM-VOICE-THROUGH-EXISTING)

Voice already has governed stores: `brand_voices` (`lib/db/brand-voices.ts`) and
`brand_voice_variations` (`lib/db/voice.ts`, ADR 0011), both already in the §D2.5 cascade table
(`0010-legal-surface.md:1054-1055`). `lib/memory/voice.ts` reads through these via existing
`lib/db` functions (`getBrandVoice`, `getVariationForBusiness`) and **always returns the core voice
rules** (L-4). **No `voice_memory` table is created.** A parallel voice store is a spec defect.

### 3.6 Deferred: `relationship` memory

`relationship` feeds the **Phase-2 engagement inbox** (`intelligence-layer §1`, table row 27) and has
**no Phase-1 consumer**. Building the table now ships an unused, RLS-and-cascade-carrying surface with
no reader. **Deferred** to whenever the engagement inbox is built. Named here so the boundary is on the
record.

---

## 4. RLS + erasure cascade (every new table — L-6)

The pattern is **copied from the currently-live committed shape**, not invented. **The correct form is
the InitPlan-wrapped `= ANY (SELECT unnest(public.get_user_business_ids()))`** — established repo-wide by
`20260430120017_fix_rls_function_caching.sql` and restated as the live convention in
`20260702120100_get_user_business_ids_multimember.sql`. (The bare `= ANY (public.get_user_business_ids())`
in `campaigns.sql:42-59` is the *pre-017* body, since superseded twice — do not copy it; it evaluates the
function once **per row** on a seq scan. This matches CLAUDE.md's "wrapped in `SELECT` so the function
evaluates once per query, not once per row" rule.) For each of `brand_memory`, `evidence_memory`,
`audience_memory`, `performance_memory`:

```
ALTER TABLE public.<t> ENABLE ROW LEVEL SECURITY;

CREATE POLICY <t>_select_own ON public.<t> FOR SELECT TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY <t>_insert_own ON public.<t> FOR INSERT TO authenticated
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));

CREATE POLICY <t>_update_own ON public.<t> FOR UPDATE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())))
  WITH CHECK (business_id = ANY (SELECT unnest(public.get_user_business_ids())));   -- both clauses, L-6

CREATE POLICY <t>_delete_own ON public.<t> FOR DELETE TO authenticated
  USING (business_id = ANY (SELECT unnest(public.get_user_business_ids())));
```

Notes:
- `get_user_business_ids()` is `STABLE SECURITY DEFINER` (`helper_get_user_business_ids.sql:16-27`),
  multi-member since `20260702120100`. The `SELECT unnest(...)` wrapper is what lets the planner evaluate
  it as a once-per-statement InitPlan (the whole point of migration `…120017`), so the new tables' RLS
  matches the caching behaviour the rest of the schema already relies on.
- **Role-gating decision (recorded, not silently omitted — database-reviewer SHOULD-FIX).**
  `campaigns` / `social_accounts` / `posts` had their *write* policies upgraded (ADR 0013,
  `20260702120300`/`20260702120400`) to gate on `user_can(business_id, <capability>)`, not plain
  membership. The memory tables carry governance columns (`sensitivity`, `public_use_permission`) that
  are arguably more permission-sensitive. **Decision: defer `user_can()` write-gating to whenever the
  memory-management UI ships** (there is no authenticated writer in Track A — the only writers are the
  service-role generation path today and Track C's service-role worker later, both of which bypass RLS).
  Plain any-member policies are the *defense-in-depth* belt for that future UI; the capability gate is
  added in the same session that adds the UI, not speculatively now.
- **Service-role note (two-belt tenancy).** `buildCustomerContext` reads via the **service-role**
  client (`context.ts:35-37`), which **bypasses RLS by design**. Tenancy at generation time is
  therefore enforced by the **explicit `business_id` filter** on every `lib/db/memory-*` query — the
  same defense-in-depth pattern `getVariationForBusiness` documents ("explicitly constrains by
  `business_id` instead of relying on RLS", `voice.ts:111-112`). **RLS protects the *future
  authenticated* read path** (a memory-management UI), and is mandatory + Tier-1-tested regardless
  (L-6). The Reviewer must not mistake the service-role generation read for an RLS hole — it is the
  intended, documented belt-and-suspenders split.
- **NAMED RISK (MINOR-1, Session 23 review) — the belt is a single `.eq()`, and no test holds it.**
  The note above records the split as *intended*; this records what it *costs*. Because the only
  production read path is service-role, **RLS is bypassed in the running system** and cross-tenant
  isolation rests entirely on one `.eq('business_id', businessId)` per `lib/db/memory-*.ts` query. The
  Tier-1 RLS suite — which is genuinely thorough, including the tenant-tunnelling case — proves a
  property **no production code path currently exercises**. Consequence: **a future edit that drops or
  weakens that `.eq()` leaks cross-tenant memory into a generation prompt with every RLS test still
  green.** RLS would catch it only once an authenticated read path exists. Mitigation is a Tier-2
  assertion per `lib/db/memory-*.ts` that the built query carries `.eq('business_id', …)` — the existing
  mocks make this cheap. **Deferred to Session 24** (Session 23-D §4.4); named here so the deferral is
  a recorded decision rather than an oversight.

### 4.1 Erasure cascade — ADR 0010 Amendment 2 §D2.5 (MEM-CASCADE-COMPLETE)

`purge_business` (`0010-legal-surface.md:990-1044`) performs a root `DELETE FROM public.businesses`
(`:1034`); every table with `business_id … ON DELETE CASCADE` is purged automatically — **no explicit
`purge_business` change is required.** But the constitution requires a **§D2.5 row per new
business-scoped table** (CLAUDE.md; `0010-legal-surface.md:1129`). The migration adds these four rows
to the §D2.5 table (`0010-legal-surface.md:1049-1073`), each mirroring the `brand_voices` row form:

| Table | Business-scoped? | FK→businesses ON DELETE | Cascades? | Action on purge |
|---|---|---|---|---|
| brand_memory | yes (business_id) | CASCADE | yes | none — cascade = erasure |
| evidence_memory | yes (business_id) | CASCADE | yes | none — cascade = erasure (may hold third-party quote PII) |
| audience_memory | yes (business_id) | CASCADE | yes | none — cascade = erasure |
| performance_memory | yes (business_id) | CASCADE | yes | none — cascade = erasure |

A new business-scoped table absent from this table is a **spec defect** — none is shipped without its row.

---

## 5. The `lib/memory/` module boundary (L-2, Q2, Q4)

### 5.1 Boundary rule (MEM-NO-DIRECT-TABLE-ACCESS)

`lib/memory/` sits alongside `lib/ai/`, `lib/social/`, `lib/db/`. **Nothing outside `lib/memory/`
touches the new memory tables**, exactly as nothing outside `lib/social/` imports a provider. Table
access is layered:

- `lib/db/memory-<type>.ts` — raw candidate queries (Q4): typed rows, explicit `limit`, explicit
  `ORDER BY` matching a §3 index, explicit `business_id` filter, soft-delete filter
  `.is('deleted_at', null)`. **No scoring, no capping.**
- `lib/memory/<type>.ts` — the retrieval intelligence: scoring + the hard cap.
- `lib/memory/index.ts` — the single public entry point consumers import from (mirrors
  `lib/social/index.ts`). Consumers never import `lib/memory/<type>` directly.

**Q4 decision:** memory reads go **through `lib/db/`** (new `lib/db/memory-*.ts` files).
**Loser:** `lib/memory/*` owning its own Supabase queries — rejected because it would be the first
exception to the constitution's "nothing else calls Supabase / DB only via `lib/db/`," and would
re-implement the client-role discipline, soft-delete convention, and one-file-per-table pattern the
codebase already standardises.

### 5.2 `retrieveRelevant` signature — one deliberate deviation from the design sketch

The design sketch (`intelligence-layer §1`, line 61) writes `retrieveRelevant(businessId, queryContext,
limit)`. This ADR adopts:

```
retrieveRelevant(client, businessId, queryContext, limit?) : Promise<T[]>
```

**Deviation flagged (not silently absorbed):** an explicit `client` first param is added, matching
**every** `lib/db` function signature. Reason: the generation path is **service-role**
(`context.ts:35-37`) but a future memory UI is **authenticated**; the caller must own the client role,
and `lib/db/memory-*` needs the client anyway. This is a *lib-internal* signature, invisible to prompts
and to the `CustomerContext` contract, so it does **not** engage L-7. Recorded here so the Builder does
not "correct" it back to the 3-arg sketch.

- `client` — Supabase client (service-role in the generation path today).
- `queryContext` — the task shape already known at generation time: `{ objective?, platform?, audience? }`.
- `limit` — bounds the **candidate scan** (defense against unbounded queries, L-9). It is **not** the
  output size. Default candidate window is an ADR constant `MEMORY_CANDIDATE_LIMIT = 50`.

### 5.3 Scoring — deterministic (Q2: embeddings DEFERRED)

**No embeddings in Track A.** The repo has **no `pgvector`** (extensions are `pgcrypto` +
`supabase_vault` only, `20260430120001_extensions.sql:9-10`); adding it is a new extension + ivfflat/hnsw
index surface + tuning, unearned while the stores are near-empty at launch and the per-business corpus
is tiny.

- **Loser:** pgvector-now.
- **Named un-defer trigger (binding):** the first business whose combined `evidence_memory` +
  `audience_memory` active-row count exceeds **`EMBEDDINGS_UNDEFER_THRESHOLD = 200`**, at which point
  scope/tag matching is provably too coarse to rank well. Re-open embeddings then, not before.

Deterministic score (pure function, app-side, over the candidate set):

```
score = w_conf · confidence
      + w_rec  · recencyDecay(last_confirmed_at ?? created_at)   // date-fns, newer → higher
      + w_scope· scopeMatch(record.scope/scope_ref, queryContext) // platform/objective/audience match → higher
```

The weights `MEMORY_SCORE_WEIGHTS = { conf, rec, scope }` are ADR constants (not scattered magic
numbers, L-4). The DB candidate query filters `status = 'active'` (in the §3 partial index predicate) and
orders by the index-backed proxy `(confidence DESC, COALESCE(last_confirmed_at, created_at) DESC)` (§3
`*_retrieval_idx`); the scope term — which depends on the per-call `queryContext` — is applied app-side
during scoring, then the cap truncates.

> **`COALESCE` matters (database-reviewer SHOULD-FIX).** The recency proxy uses
> `COALESCE(last_confirmed_at, created_at)` in **both** the index and the candidate `ORDER BY`, so a
> freshly-`distilled`, never-confirmed row (`last_confirmed_at IS NULL`) is ranked by its `created_at`
> rather than sorted to the back by `DESC NULLS LAST` — keeping the 50-row DB candidate window honest
> with the `recencyDecay(last_confirmed_at ?? created_at)` scoring it approximates. `lib/db/memory-*.test.ts`
> must cover this NULL-`last_confirmed_at` ordering case, or a high-confidence new row could fall outside
> the candidate window and never reach scoring.

### 5.4 The hard cap (L-4 — MEM-HARD-CAP)

Named ADR constants, applied **after** scoring, **not** the caller's choice past the ceiling:

```
EVIDENCE_CAP    = 5      // top-5 evidence items
PERFORMANCE_CAP = 3      // top-3 performance patterns
AUDIENCE_CAP    = 5
BRAND_CAP       = 5
// core voice rules: ALWAYS returned (no cap) — lib/memory/voice.ts
```

Output length = `min(scoredActiveCandidates, CAP)`. Feeding more than `CAP` candidates returns exactly
`CAP`, highest-scored retained. This is the discipline the current `listTopPostMetrics(…,10)` dump
lacks.

---

## 6. The `buildCustomerContext` rewire (L-7 — MEM-CONTEXT-EQUIVALENT)

### 6.1 What moves, what stays

| `CustomerContext` section | Today | After Track A |
|---|---|---|
| `business` | `getBusinessById` | **unchanged** |
| `brandVoice` | `getBrandVoice` + variation resolve (`context.ts:87-96`) | **unchanged** — voice read through existing tables (§3.5) |
| `recentCampaigns` | `listCampaigns(…,5)` | **unchanged** — campaigns are operational context, not a governed memory type |
| `recentPostPerformance` | `listTopPostMetrics(…,10)` + `listPostsByIds` | **sourced via `lib/memory/performance.retrieveRelevant`**, scored + **capped at `PERFORMANCE_CAP = 3`** (derives from `post_metrics` in Track A, §3.4) |
| `trialState` | `getTrialStateMaybe` | **unchanged** |

**The `CustomerContext` interface shape (`context.ts:13-29`) does not change.** Same fields, same
types. `buildCustomerContext`'s signature (`businessId`, `voiceVariationId?`) is unchanged.

### 6.2 The one non-preserving change — and it is founder-ratified, not silent

`recentPostPerformance` **cardinality drops from ≤10 to ≤3**. This is a **content** change, not a
**shape** change — and it is **already founder-locked at build guide §0 L-4** ("top-3 performance
patterns"). So:

- **Contract (shape): invariant.** Any field added/removed/retyped on `CustomerContext` that reaches
  the generation prompts remains a **STOP / founder decision** (none is made here).
- **`recentPostPerformance` count: intentionally ≤3.** If an existing `lib/ai/context.test.ts`
  assertion pins a performance count > 3, that assertion encodes the *pre-cap* "dump 10" behaviour this
  redesign exists to kill. Updating **that specific assertion** to the founder-locked cap is the **one
  pre-authorised test change** in B3 — it is *not* "loosening a test to mask a regression," and the
  ADR records it here so the Reviewer can tell the two apart. Every other `context.test.ts` case must
  pass **unchanged** (B3's gate).

### 6.3 Evidence / audience / brand retrieval is BUILT and TESTED, but NOT yet wired into `CustomerContext`

`lib/memory/{evidence,audience,brand}.ts` + their `lib/db/memory-*` queries + their RLS + their
Tier-2 scoring/cap tests all ship in Track A. **They are not added to `CustomerContext` in Track A**,
because consuming them requires **new** contract fields, which ripple into prompts — a change ADR 0017
(Mode 2 brief assembly) owns (§10). Wiring them now would be an L-7 contract change and scope creep
past L-1. Track A proves the retrieval works (fixture-backed Tier-2), and leaves it **ready** for 0017.

> This is the deliberate answer to "won't those tables be empty and unread?" — yes, in Track A they are
> a *tested, governed target* awaiting 0017's consumer and Track C's writer. That is exactly the
> "read side + schema" scope L-1 defines.

---

## 7. The `runner.ts` over-inclusion fix (L-8 — MEM-RUNNER-CACHE-SPLIT)

**Remove the blanket dump.** Delete `const userContextMsg = JSON.stringify(context)` (`runner.ts:94`)
and its user text block (`runner.ts:101`). The context object is already available to
`prompt.buildSystemPrompt(context)` (`runner.ts:84`) and `prompt.buildUserMessage(input, context)`
(`runner.ts:95`); the raw JSON dump is redundant over-inclusion sitting **uncached** in the user
message.

Cache split (the point of L-8):
- **Stable, shared slice → cached system block.** Business identity, platform constraints, and the
  **core voice rules** belong in `buildSystemPrompt`'s output, which already carries
  `cache_control: ephemeral` when large (`runner.ts:85-91`). Stable across calls for a business →
  cacheable prefix.
- **Per-call retrieved slice → uncached user message.** The scored, capped `recentPostPerformance`
  (and, post-0017, evidence/audience) is what varies per call and must **not** enter the cached block
  (it would poison the prefix). It rides in `buildUserMessage`.

**Bounded by L-7 — the guard.** The `CustomerContext` contract does not change. The Builder proves,
against the existing generation fixtures (`MockAnthropicClient` routes by `prompt.id`,
`runner.ts:112-114`), that removing the JSON dump yields **identical** generation output. If a specific
prompt genuinely relied on a field only present in the raw dump, that **single field** is added
explicitly to that prompt's `buildUserMessage` — never the whole-object JSON. No prompt-template
behaviour change beyond restoring an input a template already assumed.

### 7.1 Amendment (Session 23-D · D3) — the escape hatch above was INVOKED, for `post-regeneration`

**Founder-adjudicated. Recorded here because the Session 23 review (MAJOR-1) found the narrowing had
been adopted under a code comment asserting no behaviour change, with no test able to detect it.**

B4 implemented the dump removal correctly, but the paragraph above understates a consequence. Before
B4, the dump put **all five** `CustomerContext` fields into **every** call regardless of template.
After it, each prompt sees only what it explicitly renders. Re-derived from `lib/ai/prompts/*.ts`
(there are **three** templates, not four):

| Template | Rendered before B4 (via dump) | Rendered after B4 | Lost |
|---|---|---|---|
| `post-generation` | all 5 | business, brandVoice, recentCampaigns, recentPostPerformance | `trialState` |
| `post-regeneration` | all 5 | business, brandVoice | **`recentCampaigns`, `recentPostPerformance`**, `trialState` |
| `brand-voice-inference` | all 5 | business | **`brandVoice`, `recentCampaigns`, `recentPostPerformance`**, `trialState` |

**Adjudication:**

1. **`post-regeneration` — RESTORED.** `recentCampaigns` and `recentPostPerformance` are now rendered
   explicitly in its `buildUserMessage`, invoking this section's escape hatch verbatim. Rationale:
   regeneration is the *same job* as generation (write a post for this campaign in this voice),
   differing only in that it starts from a rejected draft plus user feedback — it is the product's
   quality-recovery path. The pre-B4 state was never designed; those fields arrived by accident of the
   dump. Restoring them makes B4's own "not a behaviour change" claim **true**, and keeps the two
   post-writing templates comparable. Cost is ≤5 campaign lines + ≤3 capped snippets, uncached, on a
   user-triggered action. They ride `buildUserMessage`, never `buildSystemPrompt` — `recentPostPerformance`
   is the per-call retrieved slice and would poison the cached prefix.
2. **`trialState` — ACCEPTED as removed, from all three.** A billing/quota concern enforced in
   `runner.ts` Step 1. The model has no use for it; it was only ever present because the dump swept it
   in. **Not re-added.**
3. **`brand-voice-inference` losing `brandVoice` — ACCEPTED, and desirable.** Inferring a voice from
   writing samples must not be primed by the voice already on file, or the inference biases toward the
   existing record instead of the evidence. `recentCampaigns` / `recentPostPerformance` are likewise
   irrelevant to that task.

**Now pinned by tests, which is the part that was missing.** `lib/ai/runner.test.ts` asserts, per
template, which `CustomerContext` fields appear in `system[0].text` + the user message, using sentinel
values. The case previously offered as proof ("generation output is fixture-identical") was **deleted**:
the mock routes on `_sosh.promptId`, not message content, so it could not fail by construction — it
would have stayed green if B4 had deleted the entire user message.

---

## 8. Test plan (ADR 0015 §2 tiers)

- **Tier-1 — DB-behaviour (live Postgres, `supabase/__tests__/`, `db-tests.yml`):**
  `governed-memory-rls.test.ts` — per new table: RLS enabled; a business-X authenticated client cannot
  `SELECT` / `INSERT` / `UPDATE` a business-Y row (USING **and** WITH CHECK proven, not assumed);
  business deletion cascades the rows away (erasure). A mocked client or a `pg_policies` read is **not**
  coverage (ADR 0015 §2).
- **Tier-2 — app-layer (`lib/**`, `vitest run`, `app-tests.yml`):**
  - `lib/memory/*.test.ts` — scoring orders candidates by the §5.3 function; **the cap truncates**
    (feed > cap → exactly cap out, highest-scored kept); `candidate`/`retired`/expired rows are
    excluded; `lib/memory/voice.ts` always returns core rules and touches no new table.
  - `lib/db/memory-*.test.ts` — query shape: right table, `business_id` filter, `limit` applied,
    `ORDER BY` present and index-matching, soft-delete filtered.
  - `lib/ai/context.test.ts` — the behaviour-equivalence gate: contract shape unchanged; existing
    cases pass unchanged except the single §6.2 performance-count assertion; `recentPostPerformance`
    length ≤ `PERFORMANCE_CAP`.
  - `lib/ai/runner.test.ts` — the retrieved slice is **not** in the cached system block and the stable
    slice **is**; generation output is fixture-identical after the dump removal.
- **Tier-3 — diff-verified (no runtime test, by decision — enumerated per ADR 0015 §2):**
  - `MEM-CASCADE-COMPLETE` doc-side: the four §D2.5 rows exist in `0010-legal-surface.md`.
  - `MEM-NO-DIRECT-TABLE-ACCESS`: `grep` proves no import/query of the memory tables outside
    `lib/db/memory-*` and `lib/memory/*`.
  - `MEM-VOICE-THROUGH-EXISTING` (structural half): no `*_voice_memory` table migration exists.

---

## 9. Constraint table (the Reviewer's checklist)

| Constraint | Tier | Proven by |
|---|---|---|
| **MEM-RLS-ISOLATED** | 1 | `governed-memory-rls.test.ts` — cross-tenant SELECT/INSERT/UPDATE denied on all four tables, live Postgres |
| **MEM-CASCADE-COMPLETE** | 1 + 3 | Tier-1: business delete purges memory rows. Tier-3: four §D2.5 rows present |
| **MEM-SCOPED-RETRIEVAL** | 2 | `lib/memory/*.test.ts` — returns only the business's `active`, non-expired rows, scope-ranked |
| **MEM-HARD-CAP** | 2 | `lib/memory/*.test.ts` — >cap candidates → exactly cap, highest-scored kept; test reddens if cap mutated up |
| **MEM-CONFIDENCE-GATED** | 2 | `lib/memory/*.test.ts` — `candidate`/`retired` rows never retrieved |
| **MEM-BOUNDED-QUERY** | 2 | `lib/db/memory-*.test.ts` — explicit `limit` + index-matching `ORDER BY` on every query |
| **MEM-VOICE-THROUGH-EXISTING** | 2 + 3 | Tier-2: `voice.ts` reads existing tables, core rules always present. Tier-3: no voice-memory migration |
| **MEM-CONTEXT-EQUIVALENT** | 2 | `lib/ai/context.test.ts` — contract shape unchanged; existing cases green (bar the §6.2 count); perf ≤ cap |
| **MEM-RUNNER-CACHE-SPLIT** | 2 | `lib/ai/runner.test.ts` — no JSON dump; retrieved slice excluded from cached block; fixture-identical output |
| **MEM-NO-DIRECT-TABLE-ACCESS** | 3 | grep guard — memory tables queried only inside `lib/db/memory-*` + `lib/memory/*` |

Every Tier-1/Tier-2 constraint maps to a test **and** to the CI job that executes it (Tier-1 →
`db-tests`, Tier-2 → `app-tests`). A constraint with a test but no executing job is a defect (ADR 0015 §2).

---

## 10. Deferred to Tracks B / C and later (boundary on the record)

- **ADR 0017 (Mode 2 upgrade) — the CONSUMER.** Wires `lib/memory/{evidence,audience,brand}`
  retrieval into brief assembly, which means it (and only it) adds the **new `CustomerContext` / brief
  fields** those types populate, and enforces the `sensitivity` / `public_use_permission` gate on
  evidence reaching published output (§3.2). Reads via `lib/memory/`; writes nothing.
- **ADR 0018 (diff-based learning capture) — the WRITER.** The `ai_original` snapshot + the async
  distillation worker that turns edit-diffs into `distilled`-source memory rows, and the
  **promotion threshold** that moves `status: candidate → active` on `observation_count` /
  `confidence`. Writes into `performance_memory` / (voice via existing tables); the columns it gates on
  are defined here (§2).
- **Not in this programme at all:** `relationship_memory` (Phase-2 engagement inbox, §3.6); the quality
  rubric, content mining, insight cards, the opportunity feed, Studio (Mode 1) and signal-driven
  campaigns (Mode 3) — `session-plan §4`; embeddings (until the §5.3 un-defer trigger).

**A future session must not build the learning worker, the brief pipeline, the rubric, or a new memory
table here.** If Track A's Builder finds a step needs any of them, that is a STOP (build guide L-1).

---

ADR 0016 written and accepted — 10 MEM-* constraints, 4 new tables, embeddings deferred, relationship-memory deferred.

---

## Amendment A — §10 evidence/audience/brand consumers now WIRED (2026-07-24)

**Author:** Session 24-D (Claude Code, Sonnet 5), noting a state closed by ADR 0017's Track B landing.
§10 named ADR 0017 (Mode 2 upgrade) as the intended consumer of `retrieveBrandMemory`/
`retrieveEvidenceMemory`/`retrieveAudienceMemory`, and `lib/memory/index.ts` carried a header comment
recording that, as of Track A, those three had "NO production consumer yet, by design." ADR 0017's brief
assembly (`lib/campaigns/brief.ts`'s `assembleBrief`, B2.5) now calls all three (`retrieveEvidenceMemory`,
`retrieveAudienceMemory`, `retrieveBrandMemory`) to build the brief-assembly prompt's evidence/audience/
brand candidates — closing the "unwired by design" state `lib/memory/index.ts`'s comment describes. That
comment is a code artifact, not this ADR, and is unchanged by this Session 24-D correction pass (D6 is
docs-only); a future session touching `lib/memory/index.ts` should update its header comment to reflect
that the deferred-consumer state is now closed, rather than treating this note as having already done so.

**Evidence:** `lib/campaigns/brief.ts:76-79` (Session 24 B2.5, `bc3b2d4b`); `docs/decisions/0017-mode-2-upgrade.md`
§5.1 (`MODE2-MEMORY-WIRED`).

## Amendment B — §3.4 `performance_memory.pattern_key` (2026-07-26)

**Author:** Session 25 C2.3 (Claude Code, Sonnet 5), closing ADR 0018's §7.2 amendment and its §10
"ADR 0018 — the WRITER" deferral. §3.4's original table definition and text above are **not edited** —
this amendment is additive, per this ADR's own append-only convention (Amendment A).

**What changed:** one additive column, `performance_memory.pattern_key text`, plus a `CHECK (source <>
'distilled' OR pattern_key IS NOT NULL)` and a partial `UNIQUE (business_id, dimension,
coalesce(platform,''), pattern_key) WHERE source = 'distilled' AND deleted_at IS NULL` index. `pattern_key`
is the deterministic identity slug (ADR 0018 §7.2) that lets `observation_count` recompute correctly across
repeated observations of the same phenomenon — without it, Postgres cannot dedupe distilled rows on a NULL
key, and ADR 0018 §9.6's recompute (which is scoped *by* `pattern_key`) would never see repeat observations
land on the same row. The CHECK closes that gap by construction rather than by convention. `manual`/`import`
rows are unaffected and may still carry a NULL `pattern_key`.

Also added in the same migration: `LEARN-VOICE-WRITE-TRIGGER` (ADR 0018 §5.3), a `BEFORE INSERT OR UPDATE`
trigger on `performance_memory` that rejects any `source = 'distilled'` write with `dimension IN ('format',
'hook')` if any `post_edit_signals` row sharing its `(business_id, pattern_key)` carries a class other than
`'preference'` (including an unclassified NULL, treated as fail-closed). This is DB-level enforcement, not
an app-layer re-derivation — it holds for every write path, not only the one a service-role `if` happens to
guard.

**RLS + erasure cascade are unaffected.** `pattern_key` is an additive column on an already-cascaded,
already-RLS-enabled table (§4's `performance_memory` policies, ON DELETE CASCADE from `businesses`) — no
policy or cascade behaviour changes, and the existing `docs/decisions/0010-legal-surface.md` §D2.5 row for
`performance_memory` already covers it. No new cascade row is needed.

**Evidence:** `supabase/migrations/20260726020000_performance_memory_pattern_key.sql`; `docs/decisions/
0018-diff-based-learning-capture.md` §7.2, §5.3.
