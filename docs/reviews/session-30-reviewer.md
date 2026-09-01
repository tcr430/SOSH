# Session 30 — Track G Reviewer report (G1c)

**Scope reviewed: `afeafbf3..e036f6f5` (20 commits, `G1b.1` → `G1b.14` close-out); all citations are
`git show <sha>:<path>` / `git diff afeafbf3..e036f6f5` at that range, never HEAD.**

`afeafbf3` ("Trim docs/current-phase.md", 2026-08-25) is the tip of `origin/master` and the last commit
before Track G. `e036f6f5` is the head PR #9 proposes to merge (`gh pr view 9`: base `master`, 20 commits,
**state OPEN, MERGEABLE**). Local `master` sits at `17d36e1f` — *inside* the Track G series — so
`git diff master..HEAD` shows only 2 of the 20 commits; I did not use it as a base. That stale local ref is
noted here as a working-copy fact, not a finding.

ADR 0023 §19 argues the Reviewer is gated until the range is final because PR #9 is open. I proceeded
anyway: `e036f6f5` is the head proposed for merge, nothing has landed since, and a review that waits for
merge reviews nothing that can still be changed. **If a commit lands on this branch after this report is
written, my range is stale and every citation below must be re-read at the new head.**

## The commits at which I read the checklist documents (CLAUDE.md / Session 22-F NEW-12)

| Document | Read at |
|---|---|
| `docs/decisions/0023-market-responsive-signal-source.md` (§0–§19, incl. §17/§18 Amendments 1–2) | **UNTRACKED — working-tree copy only. No SHA exists at any commit.** `git cat-file -e e036f6f5:docs/decisions/0023-…` → *"exists on disk, but not in `e036f6f5`"*. 1666 lines. |
| `docs/decisions/0020-mode-3-signal-ingestion.md` §7, §9, §11.3, §13 | body at `87a4dfc8` |
| ADR 0020 **§17 Amendment C** (C-1…C-6) | **UNCOMMITTED working tree (+136 lines over `87a4dfc8`)** |
| `docs/decisions/0021-mode-3-triage-and-opportunity-feed.md` §4.4, §10.4, §12, §13 | body at `87a4dfc8` |
| ADR 0021 **§16 Amendment A** (the §12 override) | **UNCOMMITTED working tree (+54 lines over `87a4dfc8`)** |
| `docs/build-guide/session-30.md` §0, §0.2, §2, §3, §4, §5 | placeholder at `f692a30e`; **§0.2, §2 and §3 as authored are UNCOMMITTED (+1179 lines)** |
| `docs/decisions/0015-test-execution-and-ci-gates.md` §1, §2, §5, Amendment B (B0–B6) | `632a4b5e`, clean |
| `CLAUDE.md` | clean at `e036f6f5` |

That table is itself BLOCKER-2 below.

**Vocabulary, per ADR 0015 Amendment B4.** Tier-1/2/3 constraints are **COVERED**; the four Tier-E
constraints are **MEASURED**, with numbers and a run URL. I use the two words as B4 defines them and
nowhere interchangeably.

**ECC budget: zero subagents spent, as §3 requires.** No step's named specialist was found skipped, so
there is no finding on that axis.

---

# A. THE EGRESS GUARD — read against the code, clause by clause

`lib/signals/rss-egress-guard.ts` at `e036f6f5`. **This section is the strongest work in the session.** All
eight clauses are implemented as specified, and the tests assert the mechanism rather than a comment about
it. Clause-by-clause verdict:

| # | Clause | Verdict | Evidence at the range |
|---|---|---|---|
| 1 | https re-checked **per redirect hop** | **PASS** | `rss-egress-guard.ts:182-186` — `validateUrl()` runs at the top of the `while(true)` loop; `:259-260` assigns the redirect target to `currentUrl` and `continue`s, so every hop re-enters the same check. Test: "rejects a redirect chain that downgrades https -> http". |
| 2 | Canonical IP normalization via a **real parser**, on the submitted string, the resolved address and every redirect target | **PASS** | `new URL(raw)` (`:160`) is the WHATWG parser — no regex. I checked the three encodings myself against the shipped tests: decimal `2130706433`, octal/hex `0x7f.0.0.1`, octal `0177.0.0.1` and IPv4-mapped `[::ffff:169.254.169.254]` each have their own executed case. `isBlockedIPv6:106-112` decodes the **hex-group** canonical form (`::ffff:a9fe:a9fe`) that the URL parser actually produces — the subtlety `lib/ai/website-fetcher.ts`'s dotted-form regex would have missed. Redirect targets re-enter via clause 1's loop. |
| 3 | Deny loopback, private, link-local, ULA, metadata | **PASS** | `:71-128`. Includes `0.0.0.0/8` (the B18-029 loopback evasion), CGNAT, TEST-NETs, Class E, and `fc00::/7` which subsumes IPv6 cloud metadata. `resolveAndValidate:135-138` blocks if **any** resolved address is bad (dual-stack test present). DNS failure fails **closed** (`:140-142`). |
| 4 | **Pin the validated IP** — the highest-risk item | **PASS** | `:203-206` — `new Agent({ connect: { lookup: (_hostname, _opts, cb) => cb(null, address, family) } })`, passed as `dispatcher` at `:211`. The request URL is unchanged, so `Host` and TLS SNI still target the real hostname. This is a genuine pin, not a comment claiming one. The test asserts the hook returns the pre-validated address **regardless of the args it is called with** — an assertion on the mechanism. |
| 5 | Re-validate **on every poll** | **PASS** | `:192` is inside the loop and there is no cache anywhere in the module. Test: "a second call with a since-rebound address is blocked even though the first call succeeded". |
| 6 | Size cap against **bytes read**, mid-stream abort | **PASS** | `:266-282` reads via `getReader()` and aborts at `received > maxBytes`; `Content-Length` is never consulted. Test: "a body attacker-controlled Content-Length lies about is still capped by actual bytes read". |
| 7 | Per-fetch **and** per-tick wall-clock budgets, actually compared | **PASS, with MINOR-8** | Per-fetch: `AbortSignal.timeout(config.server.RSS_FEED_FETCH_TIMEOUT_MS)` at `:215`. Per-tick: **actually compared** at `rss-orchestrator.ts:275` — `if (Date.now() - loopStartedAtMs >= budgetMs) break`. This is the "bound defined but never compared" case the brief told me to hunt for, and it is not that case. |
| 8 | DTD/external-entity resolution disabled **unconditionally** | **PASS** | `rejectIfDeclaresDoctype:320-339` rejects **any** DOCTYPE, internal entities included — an active rejection layered on top of `sax`'s passive inability to fetch external entities. `rss-client.ts:120-130` calls it on the **raw body before `parseStringPromise` is ever reached**. Not a caller-supplied option. |

No finding against clauses 1–6 or 8. MINOR-6, MINOR-7, MINOR-8 and NIT-3 below are the residue.

# B. CORPUS AUTHORSHIP ORDERING — **verified from git, and it holds**

This is the load-bearing claim of the session and it is the one I tried hardest to break. It survives.

- `git merge-base --is-ancestor 7bfe1c7c cd1b7203` → **true**. Label commit `7bfe1c7c`
  (2026-08-29 12:15:37 +0100) is a genuine ancestor of cassette commit `cd1b7203` (15:09:37 +0100).
- At the **label commit** `7bfe1c7c`, `corpus.v2.json` carried **80 examples, 40 `market_responsive`, of
  which `0` had a non-empty `cassette`**, and all 40 already carried their `expectedVerdict` (24 `card` /
  16 `no_card`, all 16 `no_card` carrying `expectedDismissReason`). The labels existed with no model
  output in the file to anchor to.
- At `e036f6f5`, all 40 `market_responsive` cassettes are populated.
- **Labels and signal inputs are byte-identical between the two commits**: I diffed every example by id —
  `ids missing at label commit: 0 | labels changed after label commit: 0 | signals changed: 0`. No label
  was revised after its cassette appeared.
- Both SHAs are recorded in the artefact **in that order** — `corpus.v2.json:4-5` and `latest-run.json`
  (`labelCommitSha` then `cassetteCommitSha`).
- The GitHub slice is **not** presented as equally-founded: `corpus.v2.json:3` states the 40 github
  examples are *"still the v1 hand-authored bootstrap cassettes, not yet re-run live themselves."*

**`SIGNAL-MR-CORPUS-BLIND-LABELLED` is MEASURED as met.** The one instruction in §3b item B I could not
execute as written is "the 40 news signal inputs are HAND-AUTHORED and not model-generated" — ADR 0023
**§17 Amendment 1 reverses that ruling**, and §18 Amendment 2 narrows it further (real companies for the 24
`card` examples). §3b was authored 2026-08-26; both amendments are dated 2026-08-29 and §3b was never
updated. See ADJUDICATION REQUEST AR-2. §18's own residual — *"figures were pulled from search-result
summaries, not verified against primary sources"* — is recorded as still **OPEN** by the ADR itself and is
carried forward here, not closed.

# C. THE RESERVED SPLIT

`lib/signals/triage/allocate-shortlist.ts` at `e036f6f5`.

- **At most 2 rss of 5** — `RSS_MAX_SLOTS = 2` (`:34`), `if (rssTaken >= RSS_MAX_SLOTS) break` (`:49`). PASS.
- **At most 1 per distinct feed** — `seenFeeds` keyed on `watched_feed_id` (`:56-58`). PASS, and I proved
  it is load-bearing: deleting `if (seenFeeds.has(feedKey)) continue` turned **2 of 10** tests red, then I
  restored the file from `git show e036f6f5:` (`git diff --stat` empty). Not
  `EXECUTED-AND-PROVING-NOTHING`.
- **Backfill wastes no slot** — github takes rss's unused slots (`:65`). PASS in that direction only.
- **"one empty source yields all five to the other"** — **only when github is the survivor.** If github is
  empty, rss is still capped at 2 and the shortlist returns 2, not 5. See MINOR-1 / AR-1.
- **`TRIAGE_SHORTLIST_PER_TICK` and `TRIAGE_DAILY_CAP_CENTS` are untouched.** `git diff` over
  `lib/config.ts` and `triage/orchestrator.ts` shows no `[-+]` line touching either constant; the only
  change at that call site is `listNewCandidates(..., 5)` → `allocateReservedShortlist(pool, 5)`
  (`orchestrator.ts:213-217`). §5.4's "the Builder must not fix the cap" is honoured. PASS.
- **No rss pre-candidate filter in Stage B.** `rss-orchestrator.ts:238-240` ingests, scores and upserts
  every parsed article; the only rejections are the dedup backstop and a missing external id. A-4
  honoured. PASS.

---

# BLOCKER-1 — The Tier-E false-green guard is defeated by the `pending` status. Demonstrated.

**Tier: BLOCKER.** `scripts/eval/run-triage-eval.ts:118`, `:177`, `:237` at `e036f6f5`.

ADR 0015 Amendment **B2.4** and ADR 0021 §10.4 `[test-5]` both require the harness's own guard to
**hard-fail, never default**, on *"executed-example count < declared corpus count (partial execution
silently shrinking the denominator)"*. G1b.12 introduced a third outcome status, `'pending'` (an example
with **no cassette at all**), and then counted it as executed:

```
executedCount: ok.length + pending.length,          // run-triage-eval.ts:177
const executedCount = outcomes.filter((o) => o.status === 'ok' || o.status === 'pending').length   // :237
```

A second defect compounds it — a source that scored nothing is scored as **passing**:

```
const metricPasses = (m: SourceMetric) => m.denominator === 0 || m.value >= m.floor   // :118
```

**I demonstrated the false green rather than reasoning about it.** I removed the `cassette` key from all 80
examples in the working-tree copy of `corpus.v2.json`, ran the harness and both guard modes, then restored
the file from `git show e036f6f5:` and confirmed `git diff --stat -- lib/signals/__fixtures__/eval/` is
empty. Verbatim output:

```
$ npx tsx scripts/eval/run-triage-eval.ts
SIGNAL3-TRIAGE-QUALITY measured (never covered): corpusVersion=2 github: precision=0.000 (0/0)
recall=0.000 (0/0) dismissMatch=0.000 (0/0) pending=40 | market_responsive: precision=0.000 (0/0)
recall=0.000 (0/0) dismissMatch=0.000 (0/0) pending=40 run=local (no GITHUB_RUN_ID in env)
EXIT=0

artefact: declaredCorpusCount: 80  executedCount: 80  errorCount: 0  metricsPass: true
          github.pass: true   market_responsive.pass: true

$ node scripts/ci/assert-eval-executed.mjs
assert-eval-executed: eval-reported green — corpusVersion=2 executed=80/80 run=local (...)
GUARD EXIT=0

$ node scripts/ci/assert-eval-executed.mjs --check-threshold
assert-eval-executed (threshold): green — ... github[precision=0.000 (0/0) ...] market_responsive[...]
THRESHOLD EXIT=0
```

**A corpus that measures literally nothing reports `executed=80/80`, `errorCount: 0`, `metricsPass: true`,
and turns both `eval-reported` and `eval-threshold` green.** That is the exact shape ADR 0015 §1(b)
defines as `FALSE-GREEN` and that B2.4 was written to make impossible — *"it can compute a
plausible-looking rate while measuring nothing."* `eval-reported` is on the promotion track to **required
with no override**; promoting it in this state would make a required gate unfalsifiable.

**This is not only hypothetical at this head.** `market_responsive.cardPrecision` has `denominator: 0`
right now (the live model predicted zero cards), and `:118` therefore scores precision as **passing**.
"The model carded nothing" is currently recorded as a precision pass.

**What would close it:** `executedCount` counts `'ok'` only; `'pending'` becomes its own reported count
that `assert-eval-executed.mjs` treats as a shortfall against `declaredCorpusCount` (job-failing, like
`error`); and `metricPasses` stops returning `true` on a zero denominator — an unscored metric is
`null`/unknown, never a pass. Whatever the interim label-before-cassette state needs, it must not be
expressed by inflating the executed count that the false-green guard reads.

# BLOCKER-2 — ADR 0023 and both amendment notes have never entered git, and §19 claims otherwise

**Tier: BLOCKER.** `git diff afeafbf3..e036f6f5 --name-status -- docs/decisions/` at the range; working
tree.

The entire acceptance basis for this session is outside PR #9:

- `docs/decisions/0023-market-responsive-signal-source.md` — **untracked**. It contains §11's 27
  constraints, §10's test plan, §8.4's UX contract, §12's four adjudications, §15's deferrals, and §19's
  own Builder close-out.
- ADR 0020 **§17 Amendment C** and ADR 0021 **§16 Amendment A** — **uncommitted working-tree edits**. These
  are the notes recording the four deferral rulings and the §12 override.
- `docs/build-guide/session-30.md` §0.2 (A-1…A-4), §2 and §3 — **uncommitted** (+1179 lines).

ADR 0023 §13 states the four ADR 0020 notes and the ADR 0021 note *"are appended by **this session
(G1a)**"*. §19 goes further: *"**§13's amendment notes confirmed landed:** ADR 0020 §6.5/§14/§7/§8.6 and
ADR 0021 §16 Amendment A (the §12 override) are all present at this head — **verified by direct grep, not
assumed** from §13's own narration."* A grep of the **working tree** finds them; a grep of `e036f6f5` does
not. The verification method could not distinguish the two, and the claim as written is false at the head
it names.

The consequence is concrete: **merging PR #9 lands 10,418 lines of code without the ADR that authorises
it, without the note recording that ADR 0021 §12 was overridden rather than satisfied, and without the
build guide's §2/§3.** A future reader of `master` would find `SIGNAL-MR-*` constraint names in commit
messages and code comments with no document defining them. This repo has paid for this exact shape once
already — `632a4b5e`'s message records that ADR 0015 Amendment B *"was a named Architect deliverable
(L-10) and had never entered git."* CLAUDE.md's erasure-cascade rule enforces the same-PR discipline for
migrations for the same reason.

**What would close it:** commit ADR 0023, both amendment notes and session-30.md §0.2/§2/§3 onto the
branch before PR #9 merges, and correct §19's "confirmed landed / verified by direct grep" sentence to say
what was actually verified and where.

---

# MAJOR-1 — `extractJsonBlock`'s semantics changed for every AI call in the product; neither caller has a test

**Tier: MAJOR.** `lib/ai/parsers.ts:6-61` at `e036f6f5`.

G1b.13 rewrote `extractJsonBlock` to fall back to a balanced-brace scan when the whole trimmed response is
not valid JSON. The change is well-reasoned and the file's own comment is explicit that it is *"a real
production risk, not eval-only."* That is exactly the problem for **SHARED-FUNCTION CALLERS**.

I re-ran the greps myself at the range:

| Caller | Test covering the **new** behaviour |
|---|---|
| `lib/ai/parsers.ts:66` (`safeParseOrAiError`) — the only direct caller | `lib/ai/parsers.test.ts` — 8 new cases. **COVERED.** |
| `lib/ai/runner.ts` (`runPrompt` — every Mode 1 / Mode 2 / Studio / learning generation) | **NONE.** `lib/ai/runner.test.ts` exists but no case exercises prose-wrapped JSON. `AUTHORED-NOT-EXECUTED` for this caller. |
| `lib/ai/tool-runner.ts` (`runToolLoop` — Stage C triage) | **NONE.** `lib/ai/tool-runner.test.ts` exists but no case exercises prose-wrapped JSON. `AUTHORED-NOT-EXECUTED` for this caller. |
| `scripts/eval/live-triage-run.ts` | out-of-band script, not CI-executed. |

CLAUDE.md's rule is precise about why this matters: *"A caller with no listed test is
`AUTHORED-NOT-EXECUTED` for that caller, even if another caller is fully covered"* — and both Session 22
blockers were this shape. The behaviour genuinely differs at those call sites: a response of
`{"a":1} …trailing text…`, or two concatenated objects, previously raised `invalid_response` and now
silently yields the **first** object. Under `runPrompt` that reaches Mode 1/2 post generation.

Secondarily, this is a **scope** question. L-1 scopes Session 30 to one signal source and instructs "STOP
and report" otherwise; the ADR authorises no change to `lib/ai/parsers.ts`. §19 and `current-phase.md`
disclose the change honestly, which is the right instinct — but disclosure is not authorisation, and no
ADR amendment records it.

**What would close it:** a test at `runner.ts` and one at `tool-runner.ts` asserting the prose-prefixed
response now parses (and reddening if the fallback is removed), plus either an ADR amendment recording the
shared-parser change or a founder ruling that it was in scope.

# MAJOR-2 — `listBusinessesWithNewCandidates` has no `ORDER BY`, and its row limit can silently exclude businesses from triage

**Tier: MAJOR.** `lib/db/signal-candidates.ts:137-149` at `e036f6f5`.

```
.from('signal_candidates')
.select('business_id')
.eq('status', 'new')
.limit(limit)                        // BUSINESS_ENUMERATION_LIMIT = 5000
```

Two defects, and they compound.

1. **No explicit `ORDER BY`.** CLAUDE.md states it as a house rule — *"List queries always have an explicit
   `ORDER BY` matching an existing index — never rely on implicit ordering"* — and session-30.md L-10
   inherits it into every step. Every other query added this session obeys it
   (`listActiveWatchedFeedsReadyForPoll`, `listRecentSignalsByBusinessAndSource`,
   `listNewCandidatesPoolWithSource`, `listWatchedFeedsForBusiness`). This one does not.
2. **The 5000 is a *row* limit, not a *business* limit.** The function emulates
   `SELECT DISTINCT business_id` by reading up to 5000 candidate **rows** and de-duplicating client-side
   (`:147-148`). ADR §5.5a sanctioned `SELECT DISTINCT business_id FROM signal_candidates WHERE
   status='new'` with a *performance* caveat; it did not sanction a row cap.

The interaction with A-4 is the real defect. A-4 **accepted an unbounded `new` backlog** and the ADR
records the consequence as "unbounded index growth". It has a second consequence nobody wrote down: once
the backlog exceeds 5000 `new` rows, businesses whose candidates fall outside an **unordered** 5000-row
window are **never enumerated, and therefore never triaged**, with no counter, no log line and no error.
`summary.businessesConsidered` would report a plausible number. This replaces the defect §5.5a set out to
fix (a feed-only business never triaged) with a differently-shaped one.

**What would close it:** an explicit `ORDER BY` matching the leading column of `signal_candidates_feed_idx`,
and either a keyset-paginated enumeration or a genuine distinct query, so the bound is on businesses rather
than rows — plus a test that a business beyond the window is still enumerated.

# MAJOR-3 — §3.4's `guid` dedup fallback is specified, commented as delivered, and not implemented; items are silently dropped

**Tier: MAJOR.** `lib/signals/rss-orchestrator.ts:118`, `lib/signals/parse-article.ts:63-83`, `:135-143`.

ADR §3.4 rules: *"**Dedup key:** `external_id = 'rss:' || sha256(canonical_link)`, falling back to `guid`
only when no link exists."* The signature honours it — `computeRssExternalId(link, guid)` (`:76-81`) reads
`link ?? guid`. The call site does not:

```
const externalId = computeRssExternalId(article.link, null)     // rss-orchestrator.ts:118
```

`null` is hardcoded because `ParsedArticle` has no `guid` field: `parse-article.ts:63-83` omits it, and
`:135-143` never carries it through. `rss-client.ts:82`/`:96` do extract `guid`, and
`parse-article.ts:30-33` comments it as *"carried through for G1b.5's dedup-key fallback"* — G1b.5 never
wired it.

The consequence is worse than a missing fallback. An item with a `<guid>`/`<id>` but no `<link>` (common in
Atom feeds carrying only `rel="self"` links, and in podcast-style feeds) yields `link: null` →
`externalId: null` → `summary.rssGuardRejected++` and `return` (`:119-127`). The item is **discarded**, and
it is counted under a **counter named for guard rejections**, so §9.4's observability reports a
security-guard rejection for what is actually an unimplemented ingestion path.

**What would close it:** carry `guid` onto `ParsedArticle`, pass it at `:118`, and add a fixture whose item
has a guid and no link — asserting it ingests rather than being counted as guard-rejected.

---

# MINOR-1 — Backfill is one-directional; §5.3 says "either source"

**Tier: MINOR** (paired with AR-1). `lib/signals/triage/allocate-shortlist.ts:6-18`, `:65`.

ADR §5.3 item 3: *"**Backfill:** if **either** source has fewer candidates than its share, the other takes
the free slots."* The code implements one direction only — github absorbs rss's unused slots; rss never
grows past 2 when github is short. The header argues this at length on L-11 grounds and it is a *loud*
deviation, not a silent one. But §2 of the build guide instructs the Builder to **transcribe** ADR
decisions and not "re-derive or improve" them, and no amendment records the change. §3b's own check —
*"does one empty source yield all five to the other?"* — is answered "only in one direction".

I think the Builder chose correctly (see AR-1); the finding is that the choice was made in a code comment
rather than in an ADR.

# MINOR-2 — `run-triage-eval.ts`'s header now misdescribes its own corpus

**Tier: MINOR.** `scripts/eval/run-triage-eval.ts:22-28` at `e036f6f5`.

The header still reads: *"The corpus's cassettes were hand-authored alongside their expected labels (no
live model has produced these examples yet) — so **THIS FIRST RUN scores close to 1.0 by construction**."*
Half the corpus is now model-authored, and the market-responsive slice scored 0/24 recall, which is the
opposite of "close to 1.0 by construction". ADR §2.2 quotes this exact paragraph as the harness's honest
self-framing, and ADR 0021 §12 clause 2 leans on it. Leaving it unamended means the shipped harness
misdescribes its own inputs to the next reader.

**What would close it:** amend the header (append, per house style) to distinguish the still-bootstrap
github slice from the model-authored market-responsive slice.

# MINOR-3 — The §D2.5 cascade row is malformed: three cells in a five-column table

**Tier: MINOR.** `docs/decisions/0010-legal-surface.md:1086` at `e036f6f5`.

The row landed in the **same commit** as the migration (`44e0e7f7`) — the mandatory rule is satisfied, and
`SIGNAL-MR-CASCADE-COMPLETE` exercises it against live Postgres. But §D2.5's table header has five columns
(`table | business_id? | on delete | in purge_business? | note`) and the new row has three, because ADR
§7.6 dictated its text verbatim without checking it against the destination table's shape. It renders
misaligned, and the "in `purge_business`?" column — the one a GDPR auditor reads — is blank for
`watched_feeds`.

# MINOR-4 — The `NOT VALID` + `VALIDATE` two-step is inert as written

**Tier: MINOR.** `supabase/migrations/20260827090000_market_responsive_signal_source.sql:67-108`.

All three CHECK widenings correctly use the two-step, and the migration states its reason: *"`signals` is a
live, hourly-written table by the time this ships, so holding an `ACCESS EXCLUSIVE` lock for a full
validation scan matters."* The pattern is right and the ADR §10.1 requirement is met literally. The stated
*benefit* is not: `ADD CONSTRAINT … NOT VALID` and `VALIDATE CONSTRAINT` run in the **same migration
transaction**, so the `ACCESS EXCLUSIVE` lock taken by the `ADD` is held until commit regardless, and
`VALIDATE`'s weaker `SHARE UPDATE EXCLUSIVE` never gets a window of its own. To actually avoid the lock the
`VALIDATE` has to be a separate transaction (a follow-on migration).

Harmless today — backfill is genuinely NONE and the table is small — but the comment will mislead the next
author who copies the pattern onto a table where it matters.

# MINOR-5 — Precision is reported as `0` when its denominator is `0`; an undefined metric is published as a measured zero

**Tier: MINOR.** `scripts/eval/run-triage-eval.ts:80`, `:92-98`; `latest-run.json`; `current-phase.md`.

`const precision = precisionDenominator > 0 ? truePositives / precisionDenominator : 0`. With zero
predicted cards, precision is **undefined**, not zero. The artefact publishes
`cardPrecision: { value: 0, numerator: 0, denominator: 0, sigma: null }` — the `null` sigma is honest, the
`value: 0` is not — and `current-phase.md` and ADR 0023 §19 both propagate it as *"market_responsive
precision 0/0"* and *"precision=0.000"*.

ADR 0015 **B2.2** makes stating denominators honestly part of the Tier-E contract, precisely so a reader is
not misled about what a number means. To the ADR's credit the denominator **is** printed alongside, so a
careful reader can see it. A `null` value with the denominator would be exact.

# MINOR-6 — `sax` is a second XML parser package, imported inside `lib/signals/`, and no scan bounds it

**Tier: MINOR.** `lib/signals/rss-egress-guard.ts:27`; `lib/signals/source-scans.test.ts:262-285`;
`package.json`.

Scan #2's new arm asserts `xml2js` is imported in exactly one file. `sax` — added as a **direct**
dependency in the same PR and imported by `rss-egress-guard.ts` — is deliberately excluded, on the
reasoning that the build guide names "the RSS parser package" (singular) and sax's use is a security
concern rather than feed-parsing coupling. That reasoning is recorded, which is the right instinct, but
`sax` **is** an XML parser (it is the one `xml2js` itself is built on), it parses the same
attacker-authored document, and CLAUDE.md's signal-source rule is about bounding parser packages to the
boundary. As shipped, a second file could `import sax` and no scan would notice.

**What would close it:** a parallel `toHaveLength(1)` arm for `sax`, or an ADR note recording the exclusion
as a decision rather than a test-file comment.

# MINOR-7 — A new undici `Agent` is constructed per redirect hop and never destroyed

**Tier: MINOR.** `lib/signals/rss-egress-guard.ts:204-206`.

`new Agent({ connect: { lookup: … } })` is inside the redirect `while` loop, so one poll of one feed can
construct up to four Agents, and none is ever `destroy()`ed or `close()`d. Each carries its own connection
pool. Across `POLL_CANDIDATE_LIST_LIMIT = 100` feeds per tick, on an hourly cron, this accumulates
undisposed pools and sockets in a long-lived worker. No security consequence; a real resource-leak
consequence.

**What would close it:** `await dispatcher.close()` in a `finally`, or hoist one Agent per fetch and
re-configure the pinned address per hop.

# MINOR-8 — The per-fetch timeout is per-**hop**; a redirect chain multiplies it 4×

**Tier: MINOR.** `lib/signals/rss-egress-guard.ts:215`, `:37`.

ADR §8.3 clause 7 asks for *"**Total** per-fetch and per-tick wall-clock budgets … against a slow-drip
server that never closes."* `AbortSignal.timeout(RSS_FEED_FETCH_TIMEOUT_MS)` is constructed fresh inside
the loop, so with `MAX_REDIRECTS = 3` a hostile server can hold one feed for up to 4 × 8 s = 32 s against
the 20 s `RSS_FEED_POLL_TICK_BUDGET_MS`. The per-tick budget then contains the damage — the tick breaks at
`rss-orchestrator.ts:275` — so this degrades to "one hostile feed can consume an entire tick", starving
other feeds that tick. Bounded, but not the "total per-fetch" the clause specifies.

**What would close it:** one deadline computed before the loop and passed to every hop.

# MINOR-9 — `rate_limited_until` is read but never written; §8.4's "rate-limited" state is unreachable

**Tier: MINOR.** `supabase/migrations/20260827090000_market_responsive_signal_source.sql:44`;
`lib/db/watched-feeds.ts:120`; `i18n/*/signals.json` `status_rate_limited`; `SignalsClient.test.tsx`.

The column exists, `listActiveWatchedFeedsReadyForPoll` honours it, the UI renders a "Rate limited" state,
i18n carries it in all three locales, and there is an executed test for it. **No code path ever sets it** —
`WatchedFeedPollOutcome` has no field for it and `recordWatchedFeedPollOutcome:150-160` never writes it.
`watched-feeds.ts:106-109` discloses this honestly in a comment. So one of §8.4's required states is
implemented end-to-end in the read direction and is unreachable in production. The executed test passes
against a hand-seeded row, which is legitimate coverage of the renderer but proves nothing about the state
ever occurring.

**What would close it:** either set `rate_limited_until` on an HTTP 429 / `Retry-After` in
`pollWatchedFeed`, or record in the ADR that the state is seeded-only until a later session.

# MINOR-10 — The Tier-3 diff-verified enumeration was gathered five commits short of the reviewed head

**Tier: MINOR.** `lib/signals/source-scans.test.ts:505-511` at `e036f6f5`.

The §10.3 Tier-3 block states its own range as *"`afeafbf3` … HEAD (G1b.9, `ec64c3c9`)"*. The reviewed head
is `e036f6f5` — `ec64c3c9` is followed by G1b.10 through G1b.14, which include the entire corpus work, the
live-run script, the `parsers.ts` change and the triage-prompt change. Tier-3 is the **only** proof these
eight properties have (ADR 0015 §2: "no test, by decision"), so proof gathered over a shorter range is not
proof over the shipped one. Property 7 in particular ("no change to Stage C's loop bounds, tool inventory
or card schema") was greped over `tools.ts`/`tool-runner.ts`/`card.ts` and never over
`triage/orchestrator.ts`, which **was** modified after `ec64c3c9`.

**I re-ran all eight at `afeafbf3..e036f6f5` myself and they still hold**: no pgvector/embedding/cluster
line outside prose; no added `sanitizeDataField`; `lib/social`, `lib/ai/prompts` and `app/api/**` (other
than the cron route's test file) untouched; no webhook-secret or signature-verification line; and
`tools.ts`, `tool-runner.ts` and `card.ts` have zero production diff. The finding is that the record does
not say so at the range it must.

---

# NIT-1 — `current-phase.md`'s Status block miscites the §12 override

`docs/current-phase.md` — the Status paragraph attributes the second-source override to *"ADR 0023 §17
Amendment 1"*. §17 Amendment 1 is the **signal-input authorship** reversal; the override is §2.9 and
ADR 0021 §16 Amendment A, which the same file cites correctly further down.

# NIT-2 — `as unknown as` casts weaken two read boundaries

`lib/db/signal-candidates.ts:60`, `:88`; `lib/db/insight-cards.ts:83`, `:107`. The double cast is explained
(supabase-js can no longer infer a row shape from a non-literal select string) and follows an existing
house idiom, but it removes the compiler's structural check at exactly the boundaries that mint
`UntrustedText`. A typed helper preserving the literal select would keep the check.

# NIT-3 — The response body is always decoded as UTF-8

`lib/signals/rss-egress-guard.ts:284` — `new TextDecoder().decode(...)` ignores the XML declaration's
`encoding` and any `charset` in `Content-Type`. An ISO-8859-1 or Windows-1252 feed mojibakes into
`signals.title`/`body`, which a human then reads at the approval gate.

# NIT-4 — `If-Modified-Since` is plumbed but never sent

`rss-client.ts:110` sends `If-Modified-Since` only if the caller passes `lastModified`;
`rss-orchestrator.ts:195` passes `{ etag: feed.etag }` only, `WatchedFeedPollOutcome` has no `lastModified`
field, and no column stores it. ADR §3.1 names *"`ETag` / `If-Modified-Since`"*; only the ETag half is
live. Feeds that serve `Last-Modified` without an `ETag` are re-fetched in full every tick.

# NIT-5 — Ingestion runs hourly, not on the "daily tick" §3.4 describes

`lib/signals/orchestrator.ts:378` — `pollWatchedFeeds` runs inside `runSignalsTick`, whose monitor schedule
is `'0 * * * *'`. ADR §3.4 says *"one poll per active feed per **daily** tick, aligned to the existing
signals-poll cron"* — the two halves of that sentence disagree, because the existing cron is hourly. The
Builder followed "aligned to the existing cron", which I think is right; the 24× cadence difference matters
for A-4's backlog-growth arithmetic and should be recorded rather than left as an ADR ambiguity.

---

# ADJUDICATION REQUESTS (disagreements with the ADR, not with the code)

**AR-1 — §5.3's backfill contradicts §2.5 and L-11, and the Builder resolved it silently.**
§5.3 says backfill runs when *"either source"* is short. §2.5 says 2-of-5 is a *"strict minority; 3 would
be the majority L-11 forbids."* If github is empty, bidirectional backfill hands rss 5 of 5 — the majority
L-11 exists to prevent. The two clauses cannot both hold. The Builder chose the L-11-safe reading. **I
agree with that choice** and am not raising it as a code defect; the request is for the founder to settle
§5.3's text so the next reader is not left with a contradiction, and to say whether the resolution needed
an ADR amendment (MINOR-1).

**AR-2 — §3b's Reviewer checklist is stale against ADR 0023 §17/§18 and was never reconciled.**
§3b item B instructs me to verify *"the 40 news signal inputs are HAND-AUTHORED and not model-generated."*
ADR 0023 §17 Amendment 1 (2026-08-29) **reverses** that ruling, and §18 Amendment 2 narrows the
fictional-only convention so the 24 `card` examples use **real companies and real events**. §3b was written
2026-08-26 and never updated. I reviewed against the amended ADR. Two consequences the founder should rule
on: (a) whether §3b should be corrected in place or amended, and (b) **§18's own residual is still open by
its own words** — the real-company figures were *"pulled from search-result summaries, not verified against
primary sources"*, and that spot-check has not happened. §18 is explicit that any future session citing a
specific number from those 24 examples must re-check it first. That obligation is currently recorded only
inside the untracked ADR (BLOCKER-2).

**AR-3 — §2.7 fixes the news slice at 24 true-card knowing it does not clear ADR 0021's meaningfulness
bar, and the first live result is 0/24.** This is not a finding: A-3 fixed the number, §2.9 recorded the
override, and the ADR is binding. But the session's own measured outcome — the model carded **zero** of 24
founder-labelled `card` examples — is a materially different fact from the "unproven harness" §2.9 was
reasoning about when it accepted the override. `current-phase.md` reports it honestly and attributes it to
the corpus's universal `stubMemory: {}` condition, which is a plausible explanation and an untested one.
The founder may wish to rule whether the 2-of-5 allocation should ship before that explanation is tested
(e.g. one live re-run with populated stub memory), or whether shipping on the recorded mitigations stands.
**The recommendation in the ADR was to ship, and nothing I found overturns it.**

---

# Coverage table (constraint → tier → CI job → verdict)

CI jobs named from `.github/workflows/` at the range (**unchanged in this PR** — no workflow file appears in
the diff, which is itself the evidence for A-1's "no recurring live lane, no `ANTHROPIC_API_KEY` in CI").
Run URLs are PR #9's `pull_request`-event runs as cited by ADR 0023 §19 and `current-phase.md`:
`app-tests` [33259652839], `db-tests` [33259652907], eval [33259652831].

| # | Constraint | Tier | CI job | Verdict |
|---|---|---|---|---|
| 1 | `SIGNAL-MR-CLIENT-BOUNDED` | 3 (scan) | `app-tests` | **COVERED** — `source-scans.test.ts:262-285`; I injected a second `xml2js` importer and it went RED (`expected 1, received 2`), then reverted |
| 2 | `SIGNAL-MR-SCANS-EXTENDED` | 3 (scan) | `app-tests` | **COVERED** — 15/15 green; per-root vacuity guards present on both new multi-root arms; #5/#6 re-confirmed against the new migration |
| 3 | `SIGNAL-MR-NO-SIXTH-SANITIZER` | 3 (scan) | `app-tests` | **COVERED** — `source-scans.test.ts:216+`; zero added `sanitizeDataField` at the full range |
| 4 | `SIGNAL-MR-INJECTION-GUARDED` | 2 | `app-tests` | **COVERED** — `OpportunityFeed.test.tsx` |
| 5 | `SIGNAL-MR-METADATA-NOT-PROMPTED` | 2 + 3 | `app-tests` | **COVERED** — `triage/orchestrator.test.ts`; I re-grepped: no publisher/byline/feed-URL in any prompt builder or tool JSON Schema; the source branch is in code, not prompt text |
| 6 | `SIGNAL-MR-PROVENANCE-VISIBLE` | 2 | `app-tests` | **COVERED** — three files; two-hop join, **no denormalised column**; `allowedUrl = candidate.signals.html_url` (`card.ts:207`), structural not model-written. Guard proved live: adding `'javascript:'` to `ALLOWED_LINK_PROTOCOLS` turned `insight-cards.test.ts` RED, then reverted |
| 7 | `SIGNAL-MR-SSRF-VALIDATED` | 2 | `app-tests` | **COVERED** — `rss-egress-guard.test.ts`, all 8 clauses incl. the pinned-IP hook and rebinding |
| 8 | `SIGNAL-MR-XXE-DISABLED` | 2 | `app-tests` | **COVERED** — separate control, separate tests, as §8.3 requires |
| 9 | `SIGNAL-MR-INGEST-ATOMIC` | 1 | `db-tests` | **COVERED** — `market-responsive-signal-ingestion.test.ts` + `rss-orchestrator.test.ts` |
| 10 | `SIGNAL-MR-DEDUP-STABLE` | 1 | `db-tests` | **COVERED for the content-hash window; INCOMPLETE for guid churn** — see MAJOR-3 |
| 11 | `SIGNAL-MR-SHORTLIST-ALLOCATION` | 2 | `app-tests` | **COVERED** — `allocate-shortlist.test.ts` 10/10; per-feed cap proved by mutation. Backfill asymmetry: MINOR-1 |
| 12 | `SIGNAL-MR-BUDGET-BOUNDED` | 2 | `app-tests` | **COVERED** — both constants verified untouched in the diff |
| 13 | `SIGNAL-MR-BUSINESS-ENUMERATION` | 1 | `db-tests` | **COVERED for the feed-only case** (`market-responsive-business-enumeration.test.ts`); the ordering/limit defect is MAJOR-2 and is untested |
| 14 | `SIGNAL-MR-FEED-ISOLATED` | 2 | `app-tests` | **COVERED** — `rss-client.test.ts` + `rss-orchestrator.test.ts` |
| 15 | `SIGNAL-MR-OBSERVABLE` | 1 + 2 | `db-tests` + `app-tests` | **COVERED**, with MINOR-9 (one persisted state unreachable) |
| 16 | `SIGNAL-MR-RLS-ISOLATED` | 1 | `db-tests` | **COVERED** — InitPlan form, `USING` **and** `WITH CHECK` on UPDATE, cross-tenant SELECT and UPDATE both denied, **no DELETE policy**, no BEFORE DELETE trigger |
| 17 | `SIGNAL-MR-CASCADE-COMPLETE` | 1 | `db-tests` | **COVERED** — `business_id` is a genuine `ON DELETE CASCADE` (migration `:19`), `purge_business` exercised not reasoned; §D2.5 row same-commit. Formatting: MINOR-3 |
| 18 | `SIGNAL-MR-NO-CONTRIBUTOR-IDENTITY` | 3 | `app-tests` | **COVERED** — structural: `RawFeedItem`/`ParsedArticle` have no author field to populate |
| 19 | `SIGNAL-MR-RETENTION-UNCLAIMED` | 3 | diff-verified | **COVERED** — I grepped `i18n/`, `content/`, `app/` at the range: no retention period on any customer-facing surface |
| 20 | `SIGNAL-MR-NEVER-AUTONOMOUS` | 2 | `app-tests` | **COVERED** — no flag/tier/setting skips a gate; approval remains an explicit click |
| 21 | `SIGNAL-MR-WATCHLIST-BOUNDED` | 2 | `app-tests` | **COVERED** — cap enforced on add **and** on toggle-back-on; `MAX_ACTIVE_WATCHED_FEEDS = 20` carries the "UX/cost guardrail, not a security boundary" disclaimer verbatim |
| 22 | `SIGNAL-MR-GATING-SEAM` | 2 + 3 | `app-tests` | **COVERED — exemplary.** One extracted `gateSignalSourceAction`; I re-grepped all **nine** callers and **every one** has an executed denial test in `actions.test.ts`. No caller is `AUTHORED-NOT-EXECUTED` |
| 23 | `SIGNAL-MR-CORPUS-DISCRIMINATIVE` | **2** | `app-tests` | **COVERED** — `run-triage-eval.test.ts`, reached because `vitest.config.ts:28` and `package.json`'s `test:app` both add `scripts/eval/`. Correctly described as a test of the script's arithmetic — never as a corpus-discrimination proof — in the ADR, the vitest config comment and `current-phase.md` |
| 24 | `SIGNAL-MR-CORPUS-EXTENDED` | **E** | eval [33259652831] | **MEASURED** — corpusVersion 2, 80 examples, `source` on **all 80** (I counted: 40/40, zero missing), `metricsBySource` with numerator/denominator/floor/sigma, **blended `metrics` object removed, not supplemented** |
| 25 | `SIGNAL-MR-CORPUS-MODEL-AUTHORED` | **E** | eval [33259652831] | **MEASURED** — all 40 market-responsive cassettes are live model responses; the 40 github cassettes are still the v1 bootstrap and the artefact says so |
| 26 | `SIGNAL-MR-CORPUS-BLIND-LABELLED` | **E** | eval [33259652831] | **MEASURED, and independently verified from git** — `7bfe1c7c` (0 cassettes, 40 labels) is an ancestor of `cd1b7203`; labels and inputs byte-identical across the two; both SHAs recorded in order |
| 27 | `SIGNAL-MR-QUALITY-LOWER-CONFIDENCE` | **E** | eval [33259652831] | **MEASURED** — `current-phase.md` reports **two** metric sets, no blended number anywhere, and states the post-live-run wording per §12's own instruction rather than reciting the stale pre-run sentence. github precision 1.000 (24/24) / recall 1.000 (24/24) / dismissMatch 1.000 (16/16); **market_responsive precision 0/0, recall 0/24, dismissMatch 0.563 (9/16)** |

**Tier discipline (Amendment B1.2 / B(b)):** exactly **four** constraints are Tier E, they are the four the
ADR names, and I found nothing testable parked there. The harness itself is **absent** from
`vitest.config.ts`'s `include` — `scripts/eval/**/*.test.ts` adds the *tests of* the scripts, not
`run-triage-eval.ts` — so it can still never report a green skip inside `app-tests`. `eval-threshold`
remains advisory (`checkThreshold()` never exits non-zero) and `eval-reported` remains the execution fact.
**That separation is correct, and BLOCKER-1 is what undermines it.**

**§13.1 contract:** `listNewCandidates`'s exported signature, filter, ordering, default bound (50) and join
list are **unchanged** — `signalsJoinSelect()` with its default empty argument produces the byte-identical
select string. The allocation reader is a **separate** function. **No `source` column was added to
`signal_candidates`** and no new index was created. PASS.

**Scope:** no `lib/social`, no Mode 1/2 generation, no `lib/ai/prompts/`, no `campaigns.origin`, no webhook
route or signature verification, no pgvector/embedding/clustering, no additional GitHub signal kind. The
new dependencies (`xml2js`, `sax` + types) were gated: G1b.3's own commit records the founder confirmation
CLAUDE.md requires. The one scope question is `lib/ai/parsers.ts` (MAJOR-1).

**A-1 / A-2 / A-3 / A-4:** all four honoured. A-1 — the live run was once, out-of-band
(`npm run eval:live-triage`, `--env-file=.env.local`), **no workflow file changed**, no `ANTHROPIC_API_KEY`
in CI, sabotage transcript present at `lib/signals/__fixtures__/eval/sabotage-run.json` (6/40 flipped under
a degraded prompt vs 0/40 clean), L-11's penalty clause recorded as not firing with its mechanical reason.
A-2 — interim position implemented, three counsel items recorded as launch-gating and **extending** ADR
0020 §9.6, no `content/legal/*.mdx` prose written, no `[LEGAL ENTITY]` touched. A-3 — I counted: 40 news
cassettes at **24/16**, total **80**, true-card **48**. A-4 — no rss pre-candidate filter; backlog recorded
as a named reason to prioritise the reaper.

**ADR 0021 §12:** recorded as **OVERRIDDEN, not satisfied**, in ADR 0023 §2.9, ADR 0021 §16 Amendment A and
`current-phase.md`. I grepped the range for "gate passed / satisfied / met / cleared" against §12 and found
none. No document cites §2.9 as precedent for a future source; all three state the override **does not
travel**. PASS (subject to BLOCKER-2 — two of those three documents are not in git).

---

**Summary: 2 BLOCKER, 3 MAJOR, 10 MINOR, 5 NIT, 3 ADJUDICATION REQUESTS.** 23 constraints COVERED and 4
MEASURED as ADR 0023 §11 claims, with the exceptions named above; the egress guard, the blind-labelling
ordering, the gating seam's nine-caller coverage and the Tier-1 DB guarantees are the session's strongest
work, and BLOCKER-1 (a demonstrated Tier-E false green) plus BLOCKER-2 (the ADR and both amendment notes
never entered git) are what must close before PR #9 merges.

## CORRECTION PASS (Session 30-D)

Author: Claude (Session 30-D, D0…D9 correction pass). This appendix records resolutions against the
findings above **by reference only** — nothing above this heading is edited, reworded, or reordered
(CLAUDE.md REVIEWER-REPORT APPEND-ONLY). Findings declined or disputed are argued here, never erased. Each
row: finding → fix → test → commit.

### D0 — BLOCKER-2 (part 1 of 2)

**Fix:** Committed `docs/decisions/0023-market-responsive-signal-source.md` (untracked → new file), ADR 0020
§17 Amendment C, ADR 0021 §16 Amendment A, `docs/build-guide/session-30.md` (entering git with §0.2/§2/§3/§4
already authored — §4 is D0's own work order and could not land later), and this reviewer report itself, all
five exactly as they stood in the working tree, in one commit, with no resolution row appended in that same
commit — so the immutable text above this heading and this appendix are provably in different commits.
`lib/db/insight-cards.ts` (a pre-existing unrelated working-tree edit) and the untracked
`corpus.v2.market-responsive.WORKSHEET.md` were deliberately left out, per the step's own instruction.
**Test:** N/A — Tier 3, diff-verified. Proof: `git status` clean of the five paths post-commit;
`git show 943ad622:docs/decisions/0023-market-responsive-signal-source.md` resolves and is content-identical
to the working-tree file (the one raw `diff` mismatch was CRLF normalisation from this repo's
`core.autocrlf=true`, confirmed identical after stripping `\r`); `git show
943ad622:docs/reviews/session-30-reviewer.md` is byte-identical to the file as written above this heading;
`git show 943ad622:docs/decisions/0021-mode-3-triage-and-opportunity-feed.md | grep -c "Amendment A"` → **4**
(non-zero); the commit contains no `.ts`/`.sql`/`.tsx`/`.json`/`.yml` file.
**Commit:** `943ad622`

### D1 — BLOCKER-1 + MINOR-5 + MINOR-2

**Fix:** `scripts/eval/run-triage-eval.ts` — (1) `executedCount` now counts `'ok'` only, both per-source
(`scoreSource`'s returned `executedCount`) and at the top level (`main()`); `pendingCount` is its own
reported field at both levels. (2) `metricPasses` no longer treats a zero denominator as an automatic pass
(`m.denominator === 0 || m.value >= m.floor` → `m.value !== null && m.value >= m.floor`) — an unscored metric
is UNKNOWN and fails this check (still advisory-only: `checkThreshold()` in `assert-eval-executed.mjs` never
exits non-zero). (3, MINOR-5) `SourceMetric.value` is `number | null`; `precision`/`recall`/`dismissMatchRate`
serialise `null`, not `0`, on a zero denominator — `run-triage-eval.ts`'s `summarize()` and
`assert-eval-executed.mjs`'s `checkThreshold()` both format `null` safely (`fmt()` / optional chaining) rather
than throwing. (4, MINOR-2) Appended (not rewritten) a paragraph to the `run-triage-eval.ts` header
distinguishing the still-bootstrap github slice from the model-authored market-responsive slice, since "THIS
FIRST RUN scores close to 1.0 by construction" is now false for half the corpus (market_responsive measured
0/24 recall). `scripts/ci/assert-eval-executed.mjs`'s `checkArtefactHard()` now hard-fails explicitly on any
`'pending'` outcome (named per-id in the error output, exactly like the existing `'error'` check), rather
than relying solely on the generic executed-vs-declared count mismatch. `lib/signals/__fixtures__/eval/latest-run.json`
regenerated against the real, unmutated corpus.v2.json to reflect the new artefact shape (`pendingCount`
added; `market_responsive.cardPrecision.value` now `null`, was `0`) — `git diff --stat -- lib/signals/__fixtures__/eval/`
shows only this one file changed, confirming `corpus.v2.json` itself is untouched.
**Test:** Re-ran the Reviewer's own demonstration EXACTLY: stripped every `cassette` key from a working-tree
copy of `corpus.v2.json` (all 80 examples → `'pending'`), ran the harness and both guard modes. BEFORE this
fix (the code at the D0 commit) this reported `executedCount: 80`/`declaredCorpusCount: 80` and both
`assert-eval-executed.mjs` (default mode) and `--check-threshold` exited **0**. AFTER this fix, the harness
reports `executedCount: 0`, `pendingCount: 80`, and the default-mode guard exits **1**
(`::error::assert-eval-executed: executed 0 example(s) but the corpus declares 80…` plus the new
`::error::assert-eval-executed: 80 example(s) are 'pending'…` naming every id), while `--check-threshold`
correctly stays advisory and exits **0** — the split the ADR requires is preserved. The corpus was then
restored from the D0 commit (`git show 943ad622:lib/signals/__fixtures__/eval/corpus.v2.json`) and
`git diff --stat -- lib/signals/__fixtures__/eval/` confirmed empty for `corpus.v2.json` before the real run.
Confirmed the CURRENT real corpus (all 80 cassettes present) still reports `executed=80/80` and stays green
on `eval-reported` — `market_responsive.cardPrecision`'s legitimately-zero denominator now serialises `null`
and is correctly excluded from `pass` rather than counted as a pass. New cases added to
`scripts/eval/run-triage-eval.test.ts` (describe block `D1 — zero-denominator metrics and pending shortfalls
are never a silent pass`): (a) flips every github `card` example's `expectedVerdict` and cassette `verdict`
to `no_card`, isolating precision/recall denominators to 0 while leaving `dismissReasonMatch` a real,
fully-scored 16/16 — asserts both null-valued metrics and `github.pass === false`, closing the exact
regression the old shortcut caused; (b) deletes one market-responsive example's `cassette`, runs the real
harness, then spawns `assert-eval-executed.mjs` as a genuine subprocess and asserts a non-zero exit whose
stderr mentions `pending`. `npx tsc --noEmit --skipLibCheck` clean. `npx vitest run
scripts/eval/run-triage-eval.test.ts` — 7/7 green (5 pre-existing + 2 new). `npx vitest run lib/db lib/social
lib/validation` — 731/731 green (unaffected by this change; run as the broader regression sweep this
project's verification loop requires). `npx eslint` on all three touched files — clean.
**Commit:** `a486d618`

### A-8 (ADJUDICATION REQUEST) — ruling recorded

**Ruling (founder, 2026-08-30, `docs/build-guide/session-30.md` §0.2):** the `parsers.ts` change is
retroactively IN SCOPE for Session 30, recorded as an ADR 0020 §17 amendment — not left as ADR 0023 §19
disclosure, since disclosure is not authorisation. Reverting was rejected: it would re-break the live
triage run the market-responsive corpus depends on. The SHARED-FUNCTION CALLERS rule is satisfied only once
`runner.ts` and `tool-runner.ts` each carry an executed test for the new balanced-brace-fallback behaviour —
this step (D2).
**Fix:** `docs/decisions/0020-mode-3-signal-ingestion.md` §17b — Amendment D, appended (not rewritten),
recording what changed (`extractJsonBlock`'s balanced-brace fallback), why (the live run's ~75% prose-prefix
rate), the A-8 ruling verbatim, and a caller-coverage table naming all four callers
(`safeParseOrAiError`/`runner.ts`/`tool-runner.ts`/the out-of-band eval harness) with their before/after
status.
**Test:** N/A for the ruling itself — Tier 3, diff-verified (the amendment is prose). Proof: `git diff --stat
-- docs/decisions/0020-mode-3-signal-ingestion.md` shows only additive lines below `_End Amendment C_`;
`grep -c "Amendment D" docs/decisions/0020-mode-3-signal-ingestion.md` is non-zero.
**Commit:** `28710b58`

### D2 — MAJOR-1

**Fix:** No production change to `lib/ai/parsers.ts` — the balanced-brace fallback A-8 ruled in scope stays
exactly as G1b.13 shipped it. Two new, executed test cases pin its behaviour per caller: `lib/ai/runner.test.ts`
(Step 4 describe block) — a prose-prefixed-JSON case (`'Here is the result you asked for:\n\n{"result":"generated"}'`
resolves to `{result:"generated"}` via `runPrompt`) and a two-concatenated-objects case
(`'{"result":"first"}{"result":"second"}'` resolves to `{result:"first"}`, pinning WHICH object wins, not
merely that parsing succeeds). `lib/ai/tool-runner.test.ts` — the identical two cases through `runToolLoop`
(Stage C triage), via two new fixtures under `lib/signals/__fixtures__/triage/`: `decision-prose-prefixed.json`
(prose before a `card` decision) and `decision-concatenated-objects.json` (a `card` decision immediately
followed by a second, different `no_card` decision — asserting the FIRST is the one returned). Both new
fixtures are schema-valid `TriageDecisionSchema` payloads, matching the existing `decision-card.json`/
`decision-no-card.json` fixture shape.
**Test:** Both new cases in both files pass against the real, unmodified `lib/ai/parsers.ts`
(`npx vitest run lib/ai/runner.test.ts lib/ai/tool-runner.test.ts` — 67/67 green). Demonstrated to REDDEN
per the step's own instruction: temporarily replaced `extractBalancedJsonObject(trimmed) ?? trimmed` with
plain `trimmed` in a working-tree copy of `parsers.ts` (removing the balanced-brace fallback) — all four new
cases (two per file) failed with `invalid_response`, confirming they exercise the fallback and are not
vacuously true; restored the original file and `git diff --stat -- lib/ai/parsers.ts` confirmed empty before
committing. `npx tsc --noEmit --skipLibCheck` clean. `npm run test:app` — 3259/3259 tests passed; 3 test
FILES fail to even load (`lib/config.test.ts`, `components/studio/StudioEditor.test.tsx`,
`lib/signals/orchestrator.test.ts`) on a pre-existing environment gap (`NEXT_PUBLIC_SUPABASE_URL`/
`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` missing in this shell) — confirmed
byte-for-byte identical at the D1 commit via `git stash`/re-run before any D2 change, so this is not a D2
regression. A fourth, transient failure (`corpus-v2-schema.test.ts`) on the first full run was confirmed to
be a parallel-file race against `run-triage-eval.test.ts`'s corpus mutation/restore cycle (both touch
`lib/signals/__fixtures__/eval/corpus.v2.json`), not reproducible on a clean re-run or in isolation — a
pre-existing test-suite hazard, not introduced by this step's changes (which touch neither file).
**Commit:** `28710b58`

### D3 — MAJOR-2

**Fix:** `lib/db/signal-candidates.ts`'s `listBusinessesWithNewCandidates` no longer issues one
`.limit(5000)`-capped, unordered read. It now pages through EVERY `status='new'` row via repeated
`.range()` calls, ordered by all four columns of the existing partial index `signal_candidates_feed_idx`
(`business_id ASC, score DESC, occurred_at DESC, id ASC` — read from
`supabase/migrations/20260731090000_signal_ingestion.sql:230-232`, not guessed), collecting `business_id`s
into a `Set` across pages until a page returns fewer rows than the page size. The bound moved from ROWS
(5000, an implicit business-dropping cap once a real backlog exceeded it) to a page size
(`CANDIDATE_ROW_PAGE_SIZE = 5000`, now just a per-fetch batch) plus `MAX_ENUMERATION_PAGES = 2000` as a
safety valve. The exported signature and name are unchanged (`(client, pageSize? = 5000): Promise<string[]>`
— was `(client, limit? = 5000)`); the one production caller (`lib/signals/triage/orchestrator.ts:222`)
passes no second argument, so this reinterpretation of the parameter's meaning affects no caller.
`invoked database-reviewer once`, per this step's own instruction (tenancy-shaped query bound interacting
with the partial index). It returned no BLOCKER but one MAJOR: the `MAX_ENUMERATION_PAGES` safety valve, as
first written, silently returned a partial business list on exhaustion — reproducing, at a ~10M-row
threshold, the exact "no counter, no log line, no error" failure this step exists to close. Closed
immediately: the loop now throws (naming `MAX_ENUMERATION_PAGES` in the message) if it exhausts every page
without ever seeing a short final page, so a backlog that genuinely outgrows the valve fails LOUDLY instead
of quietly truncating. The reviewer's two MINOR notes (OFFSET-pagination cost degrading toward O(n²) at very
large scale vs. a true keyset cursor; a theoretical skip/double-count race under concurrent writes during
enumeration, not exploitable today since no concurrent writer runs against this read in the orchestrator's
own invocation sequence) are recorded here rather than acted on — not blocking at current/foreseeable
`'new'`-backlog scale, and reversible later without another correction pass.
**Test:** `supabase/__tests__/market-responsive-business-enumeration.test.ts` — new Tier-1 describe block
`SIGNAL-MR-BUSINESS-ENUMERATION-PAGED`: two businesses with explicit UUIDs (`00000000…`/`ffffffff…`,
overriding `gen_random_uuid()` on INSERT) force deterministic `business_id ASC` ordering — a FILLER business
(sorts first) with three `'new'` rss candidates, a TARGET business (sorts last) with exactly one. Calling
`listBusinessesWithNewCandidates(admin, 2)` (`pageSize=2` against 4 total rows) forces >= 3 `.range()`
fetches; the target's row lands in the second fetch, never the first. **Demonstrated to redden**: restored
the pre-D3 file verbatim (`git show HEAD:lib/db/signal-candidates.ts` at the D2 commit) and re-ran this exact
test — the target business was silently absent (`AssertionError: expected [...] to include
'ffffffff-…'`), while the pre-existing feed-only cases in the same file stayed green; restored the fix and
`git diff --stat` confirmed the reversion left no residue. The pre-existing feed-only case the Reviewer
marked COVERED (`SIGNAL-MR-BUSINESS-ENUMERATION`) stayed green throughout. `lib/db/signal-candidates.test.ts`
— two new Tier-2 mock-client cases pin the exhaustion fix directly: a 2000-full-page mock sequence throws
(`/MAX_ENUMERATION_PAGES/`), and a normal short-final-page case still returns correctly and asserts the new
`business_id ASC` ORDER BY is present. `npx tsc --noEmit --skipLibCheck` clean. Full `npm run test:db`
(`--no-file-parallelism --retry=2`, all `supabase/__tests__`) — 342/344 passed; the 2 failures
(`get-user-business-ids-matrix.test.ts`, `rls-policy-lockdown.test.ts`) confirmed byte-for-byte identical at
the D2 commit via `git stash`/re-run before any D3 change — pre-existing, unrelated to `signal_candidates` or
this step. `npm run test:app` — 3260/3261 passed, the 3 known pre-existing env-gap file-load failures
unchanged, plus one confirmed-transient parallel-file race (same as D2's appendix) reproduced and
re-confirmed non-reproducible on isolation/rerun. `npx eslint` on all three touched files — clean.
**Commit:** `801c8f3b`

### D4 — MAJOR-3

**Fix:** `lib/signals/parse-article.ts` — `ParsedArticle` gains a `guid: string | null` field (carried from
`RawFeedItem.guid`, already extracted by `rss-client.ts:82`/`:96`, previously dead-ended), populated in
`parseArticleItem` (`guid: item.guid ?? null`). The stale `:30-33` comment on `RawFeedItem.guid` claiming it
was already "carried through" is corrected to describe the real state (now genuinely wired at the
`rss-orchestrator.ts` call site). `lib/signals/rss-orchestrator.ts:118` (`ingestParsedArticle`) — the
hardcoded `computeRssExternalId(article.link, null)` becomes `computeRssExternalId(article.link,
article.guid)`, so §3.4's specified fallback is live: a link-less item (Atom feeds with only `rel="self"`,
podcast-style feeds) now ingests via its `guid` instead of being silently discarded. The residual null-
externalId branch (genuinely NEITHER link NOR guid) is kept, per this step's own instruction, but no longer
double-counted under `rssGuardRejected` — a new field, `rssMissingDedupKey` (`RssTickSummary`), counts it
honestly, since a missing-identity item is not a security-guard rejection. `SignalsTickSummary` (which
`extends RssTickSummary`) and the canonical tick log line (`console.log(JSON.stringify({...summary}))`, a
plain spread) pick the new field up automatically — no other call site needed a change. Two test fixtures
(`rss-orchestrator.test.ts`'s `makeArticle`, `app/api/cron/signals-poll/route.test.ts`'s summary literal)
were completed with the new required field to keep `tsc` green.
**Test:** `lib/signals/rss-orchestrator.test.ts` — new describe block `D4 — the guid dedup fallback (ADR
§3.4)`: (1) a `link: null, guid: 'urn:uuid:guid-only-item'` article INGESTS
(`rssItemsIngested: 1, rssGuardRejected: 0, rssMissingDedupKey: 0`), and `insertSignal` is asserted called
with `external_id` equal to `computeRssExternalId(null, 'urn:uuid:guid-only-item')` — the guid-fallback hash,
not a discard; (2) an article with `link: null, guid: null` (the genuine residual) is counted as
`rssMissingDedupKey: 1`, `rssGuardRejected: 0`, and never reaches `insertSignal`. **Demonstrated to redden**:
reverted `:118` to the hardcoded `computeRssExternalId(article.link, null)` in a working-tree copy and
re-ran — case (1) failed (`rssItemsIngested` 0, not 1 — the guid-only item was silently discarded exactly as
MAJOR-3 describes); restored and `git diff --stat -- lib/signals/rss-orchestrator.ts` matched the intended
fix exactly. SIGNAL-MR-DEDUP-STABLE's existing content-hash window tests (`rss-orchestrator.test.ts`'s own
case, and the Tier-1 `supabase/__tests__/market-responsive-signal-ingestion.test.ts` — 6/6 green, live
Postgres) stayed green throughout, unmoved from the Reviewer's COVERED mark. `npx tsc --noEmit --skipLibCheck`
clean. `npm run test:app` — 3263/3263 tests passed (3 known pre-existing env-gap file-load failures
unchanged). Full `npm run test:db` in this same session hit Supabase auth rate-limiting from repeated runs
against the shared hosted project (`AuthApiError: Request rate limit reached` in two unrelated files,
`posts-approval-boundary.test.ts` and `studio-drafts.test.ts` — neither touches signals/RSS) plus the same
pre-existing `rls-policy-lockdown.test.ts` failure confirmed identical at D2/D3; rather than re-running the
full suite again and risking further rate-limiting, the specific Tier-1 file this step's own change touches
(`market-responsive-signal-ingestion.test.ts`) was run in isolation and passed 6/6 clean. `npx eslint` on all
four touched files — clean.
**Commit:** `bf1b117a`

### D5 — MINOR-6 + MINOR-7 + MINOR-8 (+ NIT-3 determined, deferred to D6)

**Fix:** `lib/signals/rss-egress-guard.ts` — (MINOR-8) ONE `deadline = Date.now() +
RSS_FEED_FETCH_TIMEOUT_MS` computed BEFORE the redirect `while` loop, replacing a fresh
`AbortSignal.timeout(RSS_FEED_FETCH_TIMEOUT_MS)` constructed per hop. Each hop now computes
`remainingMs = deadline - Date.now()` and passes THAT to `AbortSignal.timeout(remainingMs)`; a
`remainingMs <= 0` short-circuits to a `timeout` result before that hop's DNS/fetch work even starts. §8.3
clause 7's "TOTAL per-fetch budget" is now genuinely total across the whole redirect chain — a hostile
server can no longer hold one fetch for `(MAX_REDIRECTS+1) x RSS_FEED_FETCH_TIMEOUT_MS` by responding just
under the timeout on every hop. (MINOR-7) the pinned-IP `new Agent(...)` dispatcher, previously never
destroyed, is now disposed via `try { ... } finally { await dispatcher.close() }` wrapping every return path
from the point the Agent is constructed through success/redirect-continue/304/size-cap/fetch-error — exactly
one Agent's lifecycle scoped to one hop, never leaked. Clause 4's pinning hook (construction, placement,
`connect.lookup` logic) is completely UNCHANGED — only its disposal timing moved. `lib/signals/source-scans.test.ts`
— (MINOR-6) a parallel `toHaveLength(1)` scan arm for `sax`, matching the `xml2js` arm's shape exactly
(same per-root vacuity guards); the stale comment claiming sax was "deliberately NOT scanned" is corrected
to describe the new arm instead of arguing against one. NIT-3 determined empirically (`node -e
"new TextDecoder().decode(Buffer.from([0xff,0xfe,0x41,0x42]))"` → `"��AB"`): `TextDecoder()`'s
default `fatal: false` SILENTLY substitutes U+FFFD replacement characters for undecodable bytes — it never
throws. An ISO-8859-1/Windows-1252 feed therefore mojibakes into `signals.title`/`body` silently, not
loudly. This finding is DEFERRED, per the step's own instruction — recorded here for D6's ADR §3.1 amendment
to cite, not fixed in this step, and no code changed for it.
Invoked `security-reviewer` once, per this step's own instruction (four edits inside the module the Reviewer
called the session's strongest work). Verdict: **sound, no BLOCKER/MAJOR.** Confirmed the `try/finally`
ordering cannot race `dispatcher.close()` against an in-flight body read (JS's `finally`-runs-after-try-value
guarantee, plus undici's `close()` being the graceful, wait-for-in-flight-requests variant, not the forceful
`destroy()`); confirmed the `remainingMs <= 0` short-circuit never pre-empts a hop that would otherwise have
produced `too_many_redirects` (the two checks never interleave — the redirect count is only ever incremented
after a response is actually received within the same iteration); confirmed clause 4's pin is untouched; found
no bypass path where `dispatcher` is constructed but a return happens from outside the `try`. Two NITs noted,
not acted on (out of this step's scope and not blocking): the redirect branch's `continue` closes the
dispatcher without draining `response.body` first (pre-existing shape — 3xx responses are typically
bodiless/tiny, and there was no `close()` at all before this step, so this is not a new leak); `await
dispatcher.close()` itself is unwrapped (undici's `close()` is documented not to reject under normal
operation, so this is cosmetic).
**Test:** `lib/signals/rss-egress-guard.test.ts` — **all eight §8.3 clauses re-verified green, BY CLAUSE
NUMBER**, per this step's own risk framing (regression, not omission): clause 1 (`clause 1 — https-only
(initial request)`, `clause 1 — re-checked per redirect hop`) — 8/8; clause 2 (`clause 2 — canonical IP
normalization via the real URL parser`) — 5/5; clause 3 (`clause 3 — deny loopback, private, link-local,
ULA, cloud-metadata ranges`) — green; clause 4 (`clause 4 — pin the validated IP, never re-resolve at connect
time`) — 1/1, UNCHANGED assertion, still green; clause 5 (`clause 5 — re-validated on every poll`) — 1/1;
clause 6 (`clause 6 — size cap enforced against bytes actually read`) — 3/3; clause 7 (`clause 7 — per-fetch
timeout`) — 2/2, PLUS two new D5 cases (below); clause 8 (`clause 8 — XXE-hardened parsing`) — green. Total
46/46 (42 pre-existing + 4 new). New cases: (1) `D5 — clause 7 is a TOTAL per-fetch budget across the whole
redirect chain, not per hop` — spies `AbortSignal.timeout` and `Date.now`, asserts hop 1 receives the full
8000ms and hop 2 (after 5000ms simulated elapsed) receives 3000ms, not a fresh 8000ms; a second case asserts
an already-spent budget fails `timeout` WITHOUT calling `fetch` at all. (2) `D5 — the pinned-IP dispatcher is
disposed, never leaked` — asserts `close()` is called exactly once per constructed `Agent` instance
(`MockAgent.mock.instances`), both on the happy path (2 hops, 2 closes) and when the fetch itself errors (1
hop, 1 close). **Demonstrated to redden (MINOR-6)**: added a second `import sax from 'sax'` in a scratch
file under `lib/signals/`, re-ran the new scan arm, observed `expected 1, received 2`; deleted the scratch
file and `git diff --stat -- lib/signals/` confirmed empty before the real change. `npx tsc --noEmit
--skipLibCheck` clean. `npm run test:app` — 3267/3268 passed (3 known pre-existing env-gap file-load
failures unchanged, plus the same confirmed-transient `corpus-v2-schema.test.ts` parallel-file race from
D2/D4's appendices, reproduced and re-confirmed passing in isolation). `npx eslint` on all three touched
files — clean.
**Commit:** `8e72a881`

### D6 — NIT-5 (fixed), MINOR-9 (deferred), NIT-4 (deferred), NIT-3 (deferred) · no code, no migration

**Fix:** Documentation-only, per this step's own rule (no code, no migration). `docs/decisions/0023-market-responsive-signal-source.md`
gains `## 20. Amendment 3` (appended, not rewritten), covering three items: **(NIT-5, FIXED)** §3.4's
self-contradicting "one poll per active feed per daily tick" is corrected — `orchestrator.ts:378` runs
`pollWatchedFeeds` on the existing signals-poll cron, which is HOURLY (`0 * * * *`), not daily; the amendment
states the corrected cadence and cross-references why the 24x multiplier is load-bearing for A-4's
backlog-growth arithmetic (§5.5b) and D3's business-bounded enumeration fix — the unbounded backlog A-4
accepted grows toward any given size sooner than "daily" implied, not later. **(MINOR-9, DEFERRED)** §8.4
gains a note that `rate_limited_until` is READ-ONLY/SEEDED-ONLY — the column, the query that honours it, the
renderer and its i18n keys all exist, but no production code path (`recordWatchedFeedPollOutcome`,
`WatchedFeedPollOutcome`) ever SETS it, so the state is currently unreachable in production and its passing
render test proves the renderer, not the state's occurrence. Named un-deferring condition: the first observed
HTTP 429 from a real feed, or the session that adds feed-health surfacing. **(NIT-4 + NIT-3, DEFERRED, ONE
amendment per this step's instruction)** §3.1 gains a combined note: NIT-4 — only the `ETag` half of
conditional-GET is live (`rss-client.ts:110`/`rss-orchestrator.ts:195` never pass `lastModified`), so a
`Last-Modified`-only feed is re-fetched in full every tick (a cost, not a dedup failure — §3.4's
content-hash backstop still prevents a duplicate row); un-deferring condition: the next migration touching
`watched_feeds`. NIT-3 (found in D5) — body decoding is unconditionally UTF-8 with `fatal: false`,
**empirically confirmed to fail SILENTLY** (D5's own transcript: `new TextDecoder().decode(Buffer.from([0xff,0xfe,0x41,0x42]))`
→ `"��AB"`, no throw), so a non-UTF-8 feed mojibakes into `signals.title`/`body` with no error, log line, or
counter; un-deferring condition: the first customer-added feed confirmed non-UTF-8. `docs/current-phase.md`
gains a bullet in the Session 30 entry stating the hourly cadence and the seeded-only state in the same
words, so a reader does not have to open the ADR to learn either fact.
**Test:** N/A — Tier 3, diff-verified, per this step's own instruction (a documentation correction pass has
no runtime behaviour to test). Proof: `git status`/`git diff --stat` show exactly two files changed
(`docs/current-phase.md`, `docs/decisions/0023-market-responsive-signal-source.md`), zero `.ts`/`.tsx`/`.sql`
files, no new migration file. `npm run test:app` re-run to prove the doc edit touched no fixture path —
3268/3268 tests passed (same 3 known pre-existing env-gap file-load failures, unchanged; the
`corpus-v2-schema.test.ts` parallel-file race did not recur on this run).
**Commit:** `8d290f9d`

### D7 — MINOR-3 + MINOR-4 · no migration

**Fix:** `docs/decisions/0010-legal-surface.md` §D2.5 — the `watched_feeds` cascade row repaired from 3
cells to the table's real 5-column shape (`Table | Business-scoped? | FK→businesses ON DELETE | Cascades? |
Action on purge`). The "in purge_business?"/"Cascades?" and "Action on purge" cells (previously blank/
merged into one prose cell) are now filled from what the Tier-1 test at
`supabase/__tests__/market-responsive-signal-source-schema.test.ts:339-358` actually proves — that test
calls `admin.rpc('purge_business', ...)` directly and asserts zero `watched_feeds`/`signals` rows remain —
confirming `Cascades? = yes`, exercised by `purge_business`'s root `DELETE FROM public.businesses` with no
explicit per-table statement in the function body (read from `purge_business`'s own SQL, `0010:990-1034`).
No surrounding rows were reworded. `docs/decisions/0023-market-responsive-signal-source.md` §7.6 gains a
one-paragraph appended note: any future row text this ADR dictates for §D2.5 must match the table's real
column count at time of writing, so the next signal source does not repeat MINOR-3.
`supabase/migrations/20260827090000_market_responsive_signal_source.sql`'s two NOT VALID/VALIDATE comment
blocks (lines ~58-65 and ~94-99, MINOR-4) are corrected IN PLACE — the DDL itself is byte-identical
(confirmed by `git diff` showing only comment lines changed). Both comments now state plainly that the
two-step is retained for pattern consistency and future-migration safety, that both statements share this
migration's ONE transaction so the ADD's ACCESS EXCLUSIVE lock is held to commit and VALIDATE's weaker
SHARE UPDATE EXCLUSIVE never gets a window here, and that obtaining the weaker lock's real benefit requires
the VALIDATE to run in a SEPARATE transaction (a follow-on migration) — a warning against copying this
migration's shape onto a table where the lock window actually matters. The two-step itself is NOT removed —
the SQL is correct as executed; changing an applied migration's semantics is out of scope.
**Test:** N/A for the doc/comment corrections themselves — Tier 3, diff-verified. Proof: `git status`/`git
diff --stat` show exactly three files changed (`docs/decisions/0010-legal-surface.md`,
`docs/decisions/0023-market-responsive-signal-source.md`, the one migration file), no new migration file
created. `git diff -- supabase/migrations/20260827090000_market_responsive_signal_source.sql | grep -E
"^\+|^-" | grep -viE "^\+? *--"` returned EMPTY (after excluding diff-header lines) — mechanical proof the
DDL itself is unchanged, only comment lines moved. `supabase/__tests__/market-responsive-signal-source-schema.test.ts`
re-run against live Postgres — 18/18 green, including both `SIGNAL-MR-CASCADE-COMPLETE` cases this step's
own row-repair cites as evidence. `scripts/apply-migrations.ts` read directly (not assumed): its
`schema_migrations` tracking table keys on `version TEXT PRIMARY KEY` populated from the migration
**filename** alone (`readdirSync(...).filter(f => f.endsWith('.sql'))`), never a content hash/checksum — a
comment-only edit inside an already-applied file therefore cannot disturb its tracked-applied state, since
the filename is unchanged. `npx tsc --noEmit --skipLibCheck` clean (no `.ts` file touched by this step).
**Commit:** `6c007ebd`

### D8 — documentation truth: BLOCKER-2 (part 2), MINOR-1 + A-5, MINOR-10, A-6, A-7, NIT-1, NIT-2

**BLOCKER-2 part 2 — fix:** ADR 0023 §19's sentence *"§13's amendment notes confirmed landed: … present at
this head — verified by direct grep, not assumed"* is corrected in place (append-style, marked CORRECTED,
not silently reworded) to state what was actually verified — the working tree at G1b.14's close-out, not
`e036f6f5` (the head this sentence names) — and to record that the documents entered git only at Session
30-D's **D0** (`943ad622`), since `git cat-file -e e036f6f5:docs/decisions/0023-market-responsive-signal-source.md`
fails. The correction is the record; the sentence is not deleted.

**MINOR-1 + A-5 — fix:** ADR 0023 §5.3's clause 3 ("Backfill") is amended: the original text ("if either
source has fewer candidates than its share, the other takes the free slots") is corrected to state the
backfill is **one-directional** — `rss` short backfills to `github`, but `github` short does NOT let `rss`
grow past its 2-slot ceiling — matching what `lib/signals/triage/allocate-shortlist.ts:1-18`'s own header
comment already states and implements. **THE CODE DOES NOT CHANGE** — the amendment brings the ADR's binding
text into agreement with code the Reviewer already agreed was the L-11-safe reading, per the founder's A-5
ruling ("keep the code; amend §5.3").

**MINOR-10 — fix:** `lib/signals/source-scans.test.ts`'s Tier-3 diff-verified-properties comment block
(eight properties, ADR 0023 §10.3) restated at the corrected range `afeafbf3..cd986d13` (D7's own commit —
the last commit before this restatement), not the stale `afeafbf3..ec64c3c9` the block previously named.
**All eight commands re-run for real by this correction pass, actual output pasted below** (not the file's
own paraphrase — the exact transcript):
```
$ git diff afeafbf3..cd986d13 -- 'lib/**' 'app/**' 'supabase/**' 'scripts/**' ':(exclude)*.md' ':(exclude)lib/signals/source-scans.test.ts' | grep -iE "pgvector|embedding|vector\("
(no output, exit 1)                                                                     — property 1 HOLDS
$ git diff afeafbf3..cd986d13 -- 'lib/**' 'app/**' 'supabase/**' 'scripts/**' ':(exclude)*.md' ':(exclude)lib/signals/source-scans.test.ts' | grep -iE "cluster"
(no output, exit 1)                                                                     — property 2 HOLDS
$ git diff afeafbf3..cd986d13 -- 'lib/**' 'app/**' ':(exclude)*.md' | grep -n "^+" | grep -iE "function\s+sanitizeDataField"
(no output, exit 1)                                                                     — property 3 HOLDS
$ git diff afeafbf3..cd986d13 -- . | grep -cE "^\+(async )?function \w*[Gg]ate\w*Seam\w*\(|^\+(async )?function gateSignalSourceAction\("
1                                                                                        — property 4 HOLDS
$ git diff afeafbf3..cd986d13 -- lib/signals/parse-article.ts lib/db/types.ts | grep -inE "^\+.*\b(author|creator|byline|email|contributor)\b"
178:+// author / creator / byline / email field of any kind. rss-client.ts's own
207:+// produce a contributor-identity field" a compile-time fact about           — property 5 HOLDS (prose only, no field)
$ git diff afeafbf3..cd986d13 --name-status -- "app/api/"
M	app/api/cron/signals-poll/route.test.ts
$ git diff afeafbf3..cd986d13 -- 'lib/**' 'app/**' 'supabase/**' ':(exclude)*.md' ':(exclude)lib/signals/source-scans.test.ts' | grep -inE "^\+.*(webhook.?secret|verifySignature|x-hub-signature|signature.?verif)"
(no output, exit 1)                                                                     — property 6 HOLDS
$ git diff afeafbf3..cd986d13 --name-status -- lib/signals/triage/tools.ts lib/ai/tool-runner.ts lib/signals/triage/card.ts lib/signals/triage/orchestrator.ts
M	lib/signals/triage/orchestrator.ts                                                    — CORRECTED to include this file, per MINOR-10's own finding
$ git diff afeafbf3..cd986d13 -- lib/signals/triage/orchestrator.ts | grep -n "runToolLoop\|buildTriageTools\|TRIAGE_MAX_TOOL_CALLS\|TRIAGE_MAX_TURNS\|TRIAGE_RETRY_BUDGET\|generateCard("
(shows only import lines + two unchanged call sites — no bound/signature/schema change) — property 7 HOLDS
$ git diff afeafbf3..cd986d13 -- lib/db/signal-candidates.ts | grep -n "^-export async function listNewCandidates\|^+export async function listNewCandidates"
(no output — declaration line unchanged)                                                — property 8 HOLDS
```
All eight properties re-verified HOLD at the corrected range. Property 7's original gap (never grepping
`triage/orchestrator.ts`, which WAS modified for G1b.13's GitHub-only prompt-framing fix) is now closed —
that file's actual diff was read in full and confirmed to touch only prompt-text construction and the
candidate-enumeration source, never Stage C's loop bounds, tool inventory, or card schema.

**A-6 — fix:** a dated reconciliation note APPENDED (not amending §3b in place, which A-6 forbids) to
`docs/build-guide/session-30.md` immediately after §3b's closing fence, recording that ADR 0023 §17
Amendment 1 reverses and §18 Amendment 2 further narrows §3b's item B ("hand-authored, not model-generated"
instruction, written before either amendment existed), that the Reviewer correctly reviewed against the
amended ADR rather than the stale prompt text, and that §18's real-company-figures residual is carried
forward EXPLICITLY as still OPEN — copied verbatim in spirit into `docs/current-phase.md` too, so the
obligation survives in three places (the ADR, the build guide, current-phase.md) rather than only the ADR
where a future reader could miss it.

**A-7 — fix:** both `docs/current-phase.md` (two locations: the top Status/summary paragraph and the
detailed Session 30 entry) and ADR 0023 §19 are reworded so the `stubMemory: {}` (zero-memory) attribution
for the 0/24 recall result reads explicitly as a **HYPOTHESIS the model's own reason text suggests**, never
a confirmed cause — the zero-memory condition has not been isolated from the prompt/model combination by
any controlled re-run as of this step. D9 is named as the step that attempts the one out-of-band live
re-run with populated stub memory that would test the hypothesis, either citing that result or recording
the attempt as blocked (credits/rate limits), in which case the hypothesis framing stands as final. No
untested explanation is left stated as a cause.

**NIT-1 — fix:** `docs/current-phase.md`'s top Status paragraph's mis-citation ("ADR 0023 §17 Amendment 1")
for the ADR 0021 §12 override is corrected to the real citation (ADR 0023 §2.9 + ADR 0021 §16 Amendment A)
— the paragraph further down that already cited it correctly is untouched; only the Status paragraph's
mis-citation was fixed.

**NIT-2 — fix (deferred, recorded in the SAME amendment D2 opened, not a second one):** ADR 0020 §17b
Amendment D gains an appended paragraph recording that the `as unknown as <RowType>[]` double casts at
`lib/db/signal-candidates.ts:68`/`:114` and `lib/db/insight-cards.ts:83`/`:107` remove the compiler's
structural check at the two `UntrustedText`-minting read boundaries, that this follows the existing
`lib/signals/score.ts` "cast through unknown" house idiom (required once a `.select()` string comes from a
shared helper function rather than a literal, per `GenericStringError`), and that the un-deferring condition
is a future session touching `lib/db`'s shared select helpers directly, or one of the four casts being found
to mask a real shape mismatch.

**Test:** N/A for the documentation corrections themselves — Tier 3, diff-verified, per every item's own
nature (a citation fix, an ADR text amendment, a re-stated evidence block, an appended note, a reworded
hypothesis framing). Proof: `git status`/`git diff --stat` show exactly five files changed
(`docs/build-guide/session-30.md`, `docs/current-phase.md`, `docs/decisions/0020-mode-3-signal-ingestion.md`,
`docs/decisions/0023-market-responsive-signal-source.md`, `lib/signals/source-scans.test.ts`); `git diff --
lib/signals/source-scans.test.ts | grep -E "^\+|^-" | grep -viE "^\+\+\+|^---" | grep -viE "^[+-] *//"`
returned EMPTY — mechanical proof every changed line in that file is a comment, no assertion logic touched.
`npx tsc --noEmit --skipLibCheck` clean. `npm run test:app` — 3267/3268 tests passed on the full sweep (the
3 known pre-existing env-gap file-load failures unchanged; the one additional failure,
`corpus-v2-schema.test.ts`, is the same confirmed-transient parallel-file race recorded in D2/D3/D5/D6's
appendices — re-confirmed passing 5/5 in isolation on this run, and the same 3-failure baseline re-confirmed
on a second full-sweep run with no additional flake).
**Commit:** `4820fa37`
