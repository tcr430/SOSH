# Session 30.5 — N2.1 Platform Fact Verification

**Author:** Builder (N2.1), 2026-09-04. **Scope:** ADR 0028 §13's nine unverified items (plus 7a), verified against vendor documentation only — LinkedIn via the Microsoft Learn LinkedIn API docs (the LinkedIn-maintained developer documentation partner site, `learn.microsoft.com/en-us/linkedin/...`) and X via `docs.x.com`. No blog posts, no Stack Overflow, no recollection. **No production code was written in this step.**

This file is a **standalone verification log**, separate from ADR 0028 §13/§14, which this step also appends to (below the Architect's existing text, per REVIEWER-REPORT APPEND-ONLY discipline — nothing above the appended section in the ADR is edited).

**Result: 7 of 9 items CONFIRMED, 2 STILL-UNKNOWN** (item 5, X refresh rotation; part of item 6, X permalink shape). Item 8's capability table is CONFIRMED for both platforms, with one drift finding that affects N2.7's scope list (see below) — flagged, not fixed, here.

---

## 1. LinkedIn authorize and token endpoint URLs

**CONFIRMED.**

- Authorization: `GET https://www.linkedin.com/oauth/v2/authorization`
- Token: `POST https://www.linkedin.com/oauth/v2/accessToken`, `Content-Type: application/x-www-form-urlencoded`

Source: [LinkedIn 3-Legged OAuth Flow — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow), updated 2026-05-15. Read 2026-09-04.

Access-token lifespan confirmed **60 days** (`"expires_in":5184000`), matching `platforms/config.ts:16`'s `tokenExpiryDays: 60`. ADR 0002 §10's `/v2/ugcPosts`/`/v2/me` URLs are confirmed stale, exactly as ADR 0028 states — this Posts API flow supersedes them.

## 2. Whether LinkedIn requires or supports PKCE

**CONFIRMED — not required, and not available without special enablement, for the flow SOSH uses.**

The standard 3-legged (web, confidential-client) OAuth flow doc above makes **no mention of PKCE anywhere** — authentication is `client_id` + `client_secret` in the token-exchange body. PKCE exists only in a **separate** "native clients" flow (loopback-IP applications, e.g. desktop/CLI apps with no server), and even there LinkedIn's own docs say: *"reach out to your point of contact at LinkedIn, and they will enable PKCE OAuth 2 flow for your app"* — it is not self-serve and requires a LinkedIn contact.

Source: [Authenticating with OAuth 2.0 for Native Clients — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow-native). Read 2026-09-04.

**Consequence for N2.7:** SOSH's `redirect_uri` is a server route, not a loopback client — the standard confidential-client flow applies, and PKCE is neither required nor obtainable. **ADR 0028 §3.1 is unaffected; the STOP-AND-REPORT condition on N2.1's paste is not triggered** (checked directly against §3.1 below).

## 3. Both platforms' token revocation endpoints

**X: CONFIRMED to exist.** `POST oauth2/invalidate_token` — referenced directly from X's own OAuth 2.0 overview page as the mechanism for revoking a Bearer Token, alongside a "revoke" button in the Developer Portal's Keys and Tokens section.

Source: [OAuth 2.0 — docs.x.com](https://docs.x.com/fundamentals/authentication/oauth-2-0/overview). Read 2026-09-04.

**LinkedIn: STILL-UNKNOWN — functionally, no programmatic revoke endpoint for a standard third-party app.** LinkedIn publishes a **Token Inspector** (introspection: check TTL / active-or-expired) but no revocation endpoint a developer calls. Every source found describes revocation as **member-initiated**, through the member's own LinkedIn account settings (removing the app's access), which then invalidates all tokens tied to that grant. No official LinkedIn Developer document was found describing a `POST` a third-party app can make to revoke its own issued token.

**Affects:** N2.7/N2.8's `revokeAccessToken` for LinkedIn. **Honest fallback, per ADR 0028 §13's own instruction:** `revokeAccessToken` returns early without a network call, and never throws — there is nothing to call. This matches `postiz-provider.ts:282-309`'s existing best-effort shape, just with the network step skipped entirely for LinkedIn specifically (X's does have a real endpoint to call).

## 4. Client authentication at each token endpoint

**CONFIRMED, and the two platforms differ.**

- **LinkedIn:** `client_id` and `client_secret` **in the POST body** (`application/x-www-form-urlencoded`), never HTTP Basic. Confirmed directly in the token-exchange sample request (item 1's source).
- **X:** two supported methods — **public clients** pass `client_id` alone in the body; **confidential clients** (SOSH holds `X_CLIENT_SECRET`, so this is us) authenticate via **HTTP Basic**, base64-encoding `client_id:client_secret` in the `Authorization` header.

Source: [How to connect to endpoints using OAuth 2.0 Authorization Code Flow with PKCE — docs.x.com](https://docs.x.com/fundamentals/authentication/oauth-2-0/user-access-token). Read 2026-09-04.

## 5. X's refresh-token rotation semantics

**STILL-UNKNOWN — official documentation is silent.**

The official X user-access-token page explains how to exchange a refresh token for a new access token, but **does not state** whether the previous refresh token is invalidated on use, nor what happens if a consumed refresh token is presented again. Third-party/community sources describe X's refresh tokens as "rotating, single-use," and the X Developer Community forum has at least one thread reporting a refresh token that appeared to stop working unexpectedly after a service outage — consistent with rotation, but not an authoritative confirmation, and not reliable enough to design against.

**What would confirm it empirically** (as ADR 0028 §13 anticipated): once a real X developer account and credentials exist (Stage 1, §14.1), perform two sequential refresh calls using the *same* original refresh token — issue refresh #1, capture the new refresh token, then attempt refresh #2 with the *original* (now allegedly stale) token. A `400`/`invalid_grant` on the second call confirms single-use rotation; a success confirms it does not rotate.

**Affects:** N2.8 (must report this status verbatim per the build-guide's instruction), and A-4 / `30.5-X-REFRESH-ROTATION` (ADR 0028 §4.2) — **no change to the ADR's accepted-for-MVP decision.** The deferred advisory-lock remedy already assumes rotation is the worse case and is unaffected either way; this finding does not newly justify implementing the lock now.

## 6. X's tweet-creation path, response id, permalink shape, character limit

**Endpoint, method, id field, character limit: CONFIRMED. Permalink shape: STILL-UNKNOWN as a documented response field — confirmed only as an external convention.**

- `POST https://api.x.com/2/tweets`, JSON body `{"text": "..."}`, `Content-Type: application/json`.
- Response carries the new post's id at `data.id` (string).
- Character limit: **280 characters** for `text`.

Source: [Manage Posts on the X API v2 — docs.x.com](https://docs.x.com/x-api/posts/manage-tweets/introduction). Read 2026-09-04. (The full response schema page beyond `data.id`/`data.text` was not retrievable in this pass — the id field and character limit are corroborated by the official page plus every independent developer guide checked, so they are recorded CONFIRMED; a full field-by-field response schema was not obtained.)

- **Permalink:** the create-tweet response does **not** include a URL/permalink field. The `https://x.com/{username}/status/{id}` shape is the universally-used, stable, publicly documented convention for constructing one (referenced across the X ecosystem, including X's own web client routing), but it was not found written down as part of the `/2/tweets` response *schema* itself. **Recorded STILL-UNKNOWN as a documented API guarantee, CONFIRMED as external convention** — matches ADR 0028 §3.2's existing text exactly (`PublishResult.url` constructed from username + id, else `null`). No change needed to §3.2.

## 7. X's rate-limit headers and `retryAfterSeconds` derivation

**CONFIRMED.**

Headers: `x-rate-limit-limit`, `x-rate-limit-remaining`, `x-rate-limit-reset` (Unix epoch **seconds**). **No `Retry-After` header is sent** — confirmed absent.

Source: [X API Rate Limits — docs.x.com](https://docs.x.com/x-api/fundamentals/rate-limits). Read 2026-09-04.

**Derivation:** `retryAfterSeconds = max(x-rate-limit-reset - now_epoch_seconds, 0)`. Matches ADR 0028 §7.2's expectation that X signals limits through `x-rate-limit-*` rather than `Retry-After`. N2.9 should parse this behind a `Number.isFinite` guard with the same 60-second fallback `postiz-provider.ts:321-331` already uses, exactly as the build-guide's N2.9 paste instructs.

## 7a. Which X billing model applies to a newly created account in September 2026

**CONFIRMED, and it resolves §14.2's residual uncertainty: pay-per-usage credits only.**

As of 2026, **legacy Basic (~$200/mo) and Pro (~$5,000/mo) subscriptions are closed to new signups.** Existing Basic subscribers were migrated onto pay-per-use starting around May 2026. A newly created SOSH developer account in September 2026 has **no path to a flat-fee subscription** — pay-per-usage with prepaid credits is the only available model.

Per-request pricing corroborates ADR 0028 §14.3's own figures: reading a post ≈ $0.005, reading a user profile ≈ $0.010, creating a post ≈ $0.010–$0.015 (a linked post carrying a materially higher cost, matching §14.3's $0.200-for-a-link finding). One source states the pay-per-use read cap as **2 million post reads/month** before Enterprise pricing is required — **ADR 0028 §14.3 states 3 million.** This is a minor discrepancy between sources and is **not resolved here**; it should be re-checked directly against the live Developer Console billing page once a real account exists (Stage 1, §14.1), since it bounds Session 32's read path and the metrics worker's cadence per §14.3's closing note.

**This is reported per N2.1's instruction, not acted on.** §14.3's founder-adjudication-required pricing finding stands exactly as written; nothing here changes the recommendation or the decision, which remains the founder's.

## 8. The §6 metrics capability table — per platform, per field

**CONFIRMED for both platforms, with one drift finding affecting N2.7's scope list (flagged below, not fixed here).**

### LinkedIn — member posts only (A-8: LinkedIn ships member-only)

LinkedIn exposes **two separate, non-overlapping** metrics surfaces:

1. **`socialActions`** (network-update social actions) — works under the scopes SOSH already plans to request (`w_member_social`/`r_member_social`-adjacent read access) and returns `likesSummary.totalLikes` and `commentsSummary.totalFirstLevelComments`. No share/repost, click, reach, or impression count is exposed through this surface for member content — those exist only on `organizationalEntityShareStatistics`, which is **organization-scoped and requires `rw_organization_admin`**, unreachable per A-8 (no organization posting at launch).
2. **`memberCreatorPostAnalytics`** (Member Post Statistics, a distinct API) — the *only* LinkedIn surface that exposes impressions, reach, clicks, or saves for a **member's own post**. It requires the scope **`r_member_postAnalytics`**, launched 2025-07-08, described as free to third parties via an approval form.

Source: [Member Post Statistics — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/members/post-statistics?view=li-lms-2026-08) and [Organization Share Statistics — Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics?view=li-lms-2026-08). Both read 2026-09-04.

| `PostMetrics` field | LinkedIn (member, current scope list) | Requires |
|---|---|---|
| `likes` | Servable | `socialActions` — no new scope |
| `comments` | Servable | `socialActions` — no new scope |
| `shares` | Not servable at member scope | only exists on the org-scoped endpoint SOSH cannot reach |
| `saves` | Not servable without `r_member_postAnalytics` | new scope, not in `platforms/config.ts:14` today |
| `clicks` | Not servable without `r_member_postAnalytics` | new scope, not in `platforms/config.ts:14` today |
| `reach` | Not servable without `r_member_postAnalytics` (maps to `MEMBERS_REACHED`) | new scope, not in `platforms/config.ts:14` today |
| `impressions` | Not servable without `r_member_postAnalytics` | new scope, not in `platforms/config.ts:14` today |

**Drift finding, not fixed in this step:** `platforms/config.ts:14`'s LinkedIn scope list is `['openid', 'profile', 'email', 'w_member_social']` — it does **not** include `r_member_postAnalytics`. As designed today, 4 of 7 `PostMetrics` fields (`saves`, `clicks`, `reach`, `impressions`) would be **permanently null for LinkedIn**, and per ADR 0028 §6's own distinction, a field the platform *can* expose but SOSH hasn't scoped for is not "the platform does not expose this metric" — it is a SOSH scope choice, and per §14.1's own reasoning about re-authorisation cost, **adding the scope after users have connected forces every one of them to re-authorise.** This is a decision for whoever authors N2.7 (or the Architect, if it needs to be adjudicated): request `r_member_postAnalytics` alongside `w_member_social` now, before any user connects, or accept that `saves`/`clicks`/`reach`/`impressions` are `NOT_IMPLEMENTED` for LinkedIn until a future re-authorisation. **Not decided here — reported, per N2.1's mandate.**

### X — current scope list (`tweet.read`, `tweet.write`, `users.read`, `offline.access`)

| `PostMetrics` field | X | Requires |
|---|---|---|
| `likes` (`like_count`) | Servable | `public_metrics` — Bearer-token/app-auth level, no elevated tier |
| `comments` (`reply_count`) | Servable | `public_metrics` |
| `shares` (`retweet_count`) | Servable | `public_metrics` |
| `saves` (`bookmark_count`) | Servable | `public_metrics` |
| `clicks` (`non_public_metrics.url_link_clicks`) | Servable in principle, STILL-UNKNOWN whether current scopes suffice | requires user-context OAuth as the post's own author — SOSH holds this via the connected account's own token, but whether `tweet.read` alone is sufficient or an additional scope is needed for `non_public_metrics` was not confirmed in this pass; empirical check once credentials exist |
| `reach` | Permanently unavailable | no distinct "reach"/unique-viewer field exists anywhere in the X API v2 metrics surface |
| `impressions` (`impression_count`) | Servable | `public_metrics` |

Source: [Metrics — docs.x.com](https://docs.x.com/x-api/fundamentals/metrics) and corroborating X Developer Community threads. Read 2026-09-04.

**Session 33 consequence (per N2.1's instruction):** X's `reach` field is **permanently null**, not "not yet populated" — it must be excluded from any minimum-n floor Session 33 builds, exactly as ADR 0028 §6 anticipates for a permanently-unavailable field. LinkedIn's `shares`/`saves`/`clicks`/`reach`/`impressions` are conditionally null pending the scope decision above — Session 33 should treat them as unavailable until that decision is made and (if applicable) shipped.

## 9. The `Linkedin-Version` value to pin at implementation time

**CONFIRMED, as of today (2026-09-04) — this value drifts monthly and N2.7's author should re-check at actual build time, not treat this as a permanent constant.**

The current/latest documented Marketing API version is **`202608`** (moniker `li-lms-2026-08`), confirmed directly from the Posts API documentation's version-range metadata. `202508` — the version ADR 0028 flags as already-sunset — carries an explicit deprecation notice with a sunset date of **2026-08-17**, which as of today has passed, confirming ADR 0028's own note.

Source: same as item 1's Posts API fetch. Read 2026-09-04.

**Recommendation for N2.7:** pin `Linkedin-Version: 202608` (or whatever is current at the moment of implementation — re-check, don't copy this document's value blindly if N2.7 lands more than a few weeks from now), and record the "requires periodic review" obligation ADR 0028 §16 item 2 already names.

---

## Cross-check against ADR 0028 §3.1's STOP-AND-REPORT condition

N2.1's instruction: *"STOP AND REPORT IF: LinkedIn's Posts API contract differs from Section 3.1 — the required headers, the 201 + x-restli-id response, the author URN forms, or the permalink shape."*

Checked directly against the Posts API documentation (item 1/9's source):

- **Headers** — `Authorization: Bearer {token}`, `Linkedin-Version: {YYYYMM}`, `X-Restli-Protocol-Version: 2.0.0`, `Content-Type: application/json` — **matches §3.1 exactly.**
- **201 + `x-restli-id`** — confirmed verbatim, including the example URN shape (`urn:li:share:...` or `urn:li:ugcPost:...`).
- **Author URN forms** — `urn:li:organization:{id}` (org) confirmed in every sample; `urn:li:person:{id}` (member) confirmed via the Find Posts by Author section. Matches §5.1.
- **Permalink shape** — `https://www.linkedin.com/feed/update/urn:li:ugcPost:<id>/` confirmed directly in the vendor doc's dark-post section, matching §3.1's `https://www.linkedin.com/feed/update/{urn}/` construction.

**No discrepancy found. §3.1 does not change shape. N2.7 may proceed against it as written.**

---

## Summary

| Item | Status |
|---|---|
| 1. LinkedIn authorize/token URLs | CONFIRMED |
| 2. LinkedIn PKCE | CONFIRMED (not required/available for our flow) |
| 3. Revocation endpoints | X CONFIRMED; LinkedIn STILL-UNKNOWN (no programmatic endpoint exists) |
| 4. Client authentication | CONFIRMED (LinkedIn: body; X: Basic for confidential clients) |
| 5. X refresh rotation | STILL-UNKNOWN (official docs silent; two-request experiment needed) |
| 6. X tweet creation / id / permalink / limit | CONFIRMED except permalink (STILL-UNKNOWN as a documented field, CONFIRMED as convention) |
| 7. X rate-limit headers | CONFIRMED |
| 7a. X billing model, new account | CONFIRMED (pay-per-usage only; minor read-cap figure discrepancy vs §14.3, flagged) |
| 8. Metrics capability table | CONFIRMED for both platforms; scope-gap drift finding on LinkedIn flagged for N2.7 |
| 9. `Linkedin-Version` to pin | CONFIRMED as of 2026-09-04 (`202608`); re-verify at build time |

**7 confirmed outright, 2 still-unknown** (item 5 fully, item 6's permalink field partially), **plus one drift finding (LinkedIn metrics scope gap) that is reported, not resolved, in this step.**
