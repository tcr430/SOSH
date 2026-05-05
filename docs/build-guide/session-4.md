# Session 4 — Authentication & Onboarding Foundation

> **Goal:** Signup with work-email enforcement, login, password reset, multi-tenant business creation, dashboard shell, and onboarding wizard skeleton.
> **Time:** 3–5 hours including correction pass
> **Models:** Sonnet 4.6 for build, Opus 4.7 for review
> **Session structure:** Single continuous Builder session (auth and onboarding share heavy context) → fresh Opus Reviewer session → expected correction pass (Session 4C)

---

## Pre-session checklist

- [ ] Sessions 2 and 3 complete with all reviewer issues resolved
- [ ] Health check returns `{ provider: 'mock', status: 'ok' }`
- [ ] `npx vitest run` passes
- [ ] `npx tsc --noEmit` passes
- [ ] All 9 tables visible in Supabase
- [ ] `current-phase.md` reflects Session 3 closure

---

## Part A — Builder Session (Sonnet 4.6)

### How to run

1. `claude` in terminal
2. `/model` → **Claude Sonnet 4.6**
3. Paste Primer
4. Run prompts in order — do NOT `/clear` between them (auth + dashboard + onboarding share too much context)

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md.
Read /lib/db/businesses.ts, /lib/db/brand-voices.ts, 
/lib/db/trial-state.ts, /lib/db/types.ts.
Read /lib/supabase/server.ts and /lib/supabase/service.ts.
Read existing /app/[locale]/ structure.

Session 4 — Auth and Onboarding Foundation. Builder role.

ECC workflow (use /everything-claude-code: prefix):
- /everything-claude-code:plan before each prompt
- /everything-claude-code:tdd for testable logic (validation, 
  utilities)
- /everything-claude-code:verify after each prompt
- All visible text via next-intl
- All Server Actions use Zod
- All database access through /lib/db/ — never direct Supabase

CLAUDE.md patterns to follow:
- Server Components by default; 'use client' only when needed
- Server Actions for mutations, not POST API routes
- Soft-delete filtering happens in /lib/db/, already there — 
  don't reimplement
- formatISO from date-fns for timestamps
- Three locale files updated together (en, pt, es)

Confirm:
1. You've read CLAUDE.md and the schema ADR
2. List the auth pages and onboarding steps you'll create
3. Confirm you'll use Server Actions, not POST routes
Wait for Prompt 1.
```

### Builder Prompt 1 — Work email validator

```
/everything-claude-code:tdd "Work email validator that blocks 
free providers"

This is the first line of trial abuse prevention.

Create /lib/validation/email.ts:

1. FREE_EMAIL_PROVIDERS — exhaustive blocklist:
   gmail.com, googlemail.com, hotmail.com, hotmail.co.uk, 
   hotmail.fr, hotmail.es, hotmail.pt, outlook.com, outlook.fr, 
   outlook.es, outlook.pt, live.com, live.co.uk, live.com.pt, 
   live.es, yahoo.com, yahoo.co.uk, yahoo.fr, yahoo.es, 
   yahoo.com.br, ymail.com, rocketmail.com, icloud.com, me.com, 
   mac.com, aol.com, aim.com, protonmail.com, proton.me, pm.me, 
   mail.com, gmx.com, gmx.de, gmx.fr, gmx.es, yandex.com, 
   yandex.ru, zoho.com, fastmail.com, fastmail.fm, tutanota.com, 
   tuta.io, hey.com, msn.com, qq.com, 163.com, 126.com, sina.com, 
   naver.com, rediffmail.com, web.de, libero.it, virgilio.it, 
   laposte.net, orange.fr, free.fr, wanadoo.fr, ig.com.br, 
   bol.com.br, uol.com.br, terra.com.br

2. isWorkEmail(email: string): boolean
   - Extracts and lowercases the domain
   - Checks against the blocklist
   - Also blocks subdomains (user@mail.gmail.com → false)
   - Returns true only for non-free domains

3. getEmailDomain(email: string): string

4. workEmailSchema — Zod schema combining email format + 
   isWorkEmail check, with translatable error message keys 
   (use literal keys like 'errors.email.work_required' that 
   resolve via next-intl in the component)

Tests in /lib/validation/email.test.ts:
- Valid work emails accepted
- Every blocked domain rejected
- Subdomains of blocked domains rejected
- Case variations (USER@GMAIL.COM)
- Plus addressing (user+tag@gmail.com) — domain still wins
- Empty strings, malformed addresses
- IDN punycode if applicable

Run npx vitest run — all pass.

/everything-claude-code:verify
```

### Builder Prompt 2 — Signup page and Server Action

```
/everything-claude-code:plan "Signup page with work-email 
enforcement and multi-tenant business creation"

Create /app/[locale]/(auth)/signup/page.tsx:
- Form fields: full name, work email, password, company name
- Uses shadcn Form, Input, Button, Label components
- All visible text via next-intl
- Submits to a Server Action (not a POST route)
- Renders errors inline beside the relevant field

Create /app/[locale]/(auth)/signup/actions.ts:
- 'use server' directive
- Server Action validates with Zod (workEmailSchema for email, 
  password min 12 chars with letter and number, all fields 
  required)
- Uses /lib/supabase/server.ts client to call auth.signUp
- On success, performs these in /lib/db/ (in order):
  1. createBusiness with name=companyName, owner_id=newUserId, 
     plan='trial', language=locale (en/pt/es from URL)
  2. createBrandVoice with business_id (empty defaults)
  3. trial_state row is auto-created by the businesses INSERT 
     trigger from Session 2 — do not create it manually
- If any step fails after auth.signUp succeeds, log the failure 
  (use console.error temporarily — proper logger is post-MVP) 
  but don't try complex rollback in MVP. The user retries.
- Redirects to /[locale]/onboarding on success

Error handling:
- Free email → inline error 'errors.email.work_required'
- Email already exists → 'errors.signup.email_taken' with 
  link to login
- Weak password → field-level error
- Generic failure → form-level error

Add translation keys to /i18n/en/auth.json, /i18n/pt/auth.json, 
/i18n/es/auth.json (create files if missing — natural PT-PT 
and ES-ES, not machine-translated):

errors.email.work_required, errors.signup.email_taken, 
errors.signup.weak_password, errors.signup.generic, 
auth.signup.title, auth.signup.cta, auth.signup.fields.name, 
auth.signup.fields.email, auth.signup.fields.password, 
auth.signup.fields.company, auth.signup.have_account, 
auth.signup.login_link

/everything-claude-code:verify
```

### Builder Prompt 3 — Login, password reset

```
/everything-claude-code:plan "Login and password reset flow"

Create /app/[locale]/(auth)/login/page.tsx:
- Email + password fields
- Uses Server Action in /app/[locale]/(auth)/login/actions.ts
- On success: query businesses for the user, check 
  onboarding_completed:
  · false → redirect to /[locale]/onboarding
  · true → redirect to /[locale]/campaigns
- Errors are deliberately vague: 'errors.login.invalid' (do 
  not reveal whether email exists)
- Unconfirmed email: 'errors.login.confirm_email' with resend 
  link (separate Server Action)
- "Forgot password?" → /[locale]/forgot-password
- "Sign up" → /[locale]/signup

Create /app/[locale]/(auth)/forgot-password/page.tsx:
- Single email field
- Server Action calls supabase.auth.resetPasswordForEmail
- ALWAYS shows the same success message regardless of whether 
  email exists: 'auth.forgot_password.sent_if_exists'

Create /app/[locale]/(auth)/reset-password/page.tsx:
- Reads recovery token from URL params  
- New password + confirm password
- Server Action calls supabase.auth.updateUser
- On success: redirect to /[locale]/campaigns

Add translation keys to all three locales.

/everything-claude-code:verify
```

### Builder Prompt 4 — proxy.ts auth guard

```
/everything-claude-code:plan "Add auth redirect to proxy.ts"

Update /proxy.ts (Next.js 16 middleware) to:
- For paths matching /[locale]/(dashboard)/* (any path under 
  the dashboard route group), check session via 
  /lib/supabase/middleware.ts
- If no authenticated user: redirect to 
  /[locale]/login?redirect=<original-pathname>
- If authenticated: continue (let Server Components handle 
  business-scoped redirects)
- Static assets, _next, api routes, and /(auth)/ routes are 
  NOT auth-guarded

Use the existing pattern from /lib/supabase/middleware.ts. 
Do not introduce any new dependencies.

/everything-claude-code:verify
```

### Builder Prompt 5 — Dashboard shell

```
/everything-claude-code:plan "Dashboard shell with 
multi-tenant context"

Create /app/[locale]/(dashboard)/layout.tsx (Server Component):
1. Get session via /lib/supabase/server.ts
2. If no session: redirect to /[locale]/login (proxy.ts 
   should have caught this, but defense in depth)
3. Fetch the user's businesses via /lib/db/businesses.ts 
   (getBusinessesByOwner)
4. If no business: redirect to /[locale]/signup (data 
   integrity issue — should not happen in normal flow)
5. Pick first business as activeBusiness (multi-business 
   support is Phase 2; one business per user in Phase 1)
6. If activeBusiness.onboarding_completed is false AND 
   pathname is not /onboarding/*: redirect to 
   /[locale]/onboarding
7. Render BusinessProvider wrapping children

Create /lib/contexts/business-context.tsx:
- 'use client'
- BusinessContext with { user, activeBusiness, brandVoice }
- BusinessProvider component
- useActiveBusiness() hook — throws if used outside provider

Create /components/layout/DashboardShell.tsx:
- Sidebar with nav items (Campaigns, Calendar, Inbox, 
  Analytics, Settings) — labels from next-intl
- Top bar: active business name + user dropdown (Profile, 
  Logout)
- Logout: Server Action that calls supabase.auth.signOut, 
  redirects to /[locale]/login

Empty state for /app/[locale]/(dashboard)/campaigns/page.tsx 
(placeholder until Session 6).

/everything-claude-code:verify
```

### Builder Prompt 6 — Onboarding wizard skeleton

```
/everything-claude-code:plan "4-step onboarding wizard"

Note: AI brand voice inference is Session 5. Step 2 is a 
placeholder form here.

Structure:
- /app/[locale]/(dashboard)/onboarding/page.tsx — redirects 
  to correct step based on what's filled in
- /onboarding/step-1/page.tsx — Business profile  
- /onboarding/step-2/page.tsx — Brand voice (manual form 
  for now, AI-powered in Session 5)
- /onboarding/step-3/page.tsx — Connect social account 
  (placeholder)
- /onboarding/step-4/page.tsx — Welcome/done screen

Each step:
- Progress indicator component (Step X of 4)
- Back/Continue buttons (no Back on step 1)
- Server Action saves progress on Continue
- "Skip for now" link sets onboarding_completed = true 
  via service-role function (createServiceRoleClient lazy 
  import) — onboarding flag changes are gated to prevent 
  user clients from setting it directly

Step 1 fields: business name (pre-filled from signup), 
website URL, industry (dropdown: SaaS / E-commerce / 
Agency / Consulting / Other), description (textarea, 
2-3 sentences)

Step 2 placeholder fields: tone (multi-select pills), 
target audience (textarea), keywords (tag input), 
avoid_words (tag input), unique_value_prop (textarea). 
All save to brand_voices via Server Action.

Step 3 placeholder: cards for LinkedIn, X, Instagram, 
Facebook, Threads. Each card has "Connect" button 
disabled with "Coming in Session 5" tooltip. "Skip for 
now" advances to step 4.

Step 4: "You're all set!" + "Create your first campaign" 
button → /[locale]/campaigns. Sets onboarding_completed.

All UI text via next-intl in three languages.

/everything-claude-code:verify
```

### Builder Prompt 7 — Build verification

```
Run these checks in order. Stop on first failure and 
show the error. Do not auto-fix.

1. npx tsc --noEmit
2. npx vitest run
3. npm run build

If all pass, run: npm run dev

Tell me to test manually. List the test cases I should 
exercise.
```

### Builder Prompt 8 — Update current-phase

```
Update /docs/current-phase.md:
- Add Session 4A to "What's done"
- Update "What's in progress" to Session 4B (Reviewer)
- Add any decisions made (e.g. specific Zod schemas, 
  redirect logic edge cases)
- Add any open gotchas

If any pattern emerged that future sessions should 
follow, update CLAUDE.md.
```

### Part A Test Checklist

Manual testing — exercise all of these:

- [ ] `/en/signup` loads
- [ ] Signup with `@gmail.com` → rejected with clear error
- [ ] Signup with `@yourdomain.com` → accepted, confirmation email sent
- [ ] After confirming email, login works
- [ ] After login → redirected to `/en/onboarding` (fresh account)
- [ ] Onboarding step 1→2→3→4 navigates correctly
- [ ] Each step's data saves to database (check Supabase Table Editor)
- [ ] "Skip for now" on any step → lands on campaigns empty state
- [ ] After completing onboarding, login redirects to campaigns (not onboarding loop)
- [ ] Logout works
- [ ] `/en/campaigns` while logged out → redirects to `/en/login?redirect=/en/campaigns`
- [ ] After login from that redirect, lands on campaigns
- [ ] All three languages render: `/en/signup`, `/pt/signup`, `/es/signup`
- [ ] Forgot password sends an email
- [ ] Reset password completes and signs user in
- [ ] No console errors in browser
- [ ] `tsc --noEmit` clean
- [ ] `vitest run` passes
- [ ] `npm run build` succeeds

```
git add .
git commit -m "Session 4A: Auth and onboarding foundation"
git push
```

`/exit` Claude Code.

---

## Part B — Reviewer Session (Opus 4.7)

### Primer

```
Read CLAUDE.md, /docs/current-phase.md, AGENTS.md,
/docs/decisions/0001-database-schema.md.
Read every file under /app/[locale]/(auth)/.
Read every file under /app/[locale]/(dashboard)/.
Read /lib/validation/email.ts and email.test.ts.
Read /lib/contexts/business-context.tsx.
Read /components/layout/DashboardShell.tsx.
Read /proxy.ts.

Session 4 Part B — Auth and Onboarding Review.

Run /everything-claude-code:security-reviewer and 
/everything-claude-code:typescript-reviewer in parallel. 
Synthesize one report.

Independent review. You did not write this code. Do not 
modify files.
```

### Reviewer Prompt

```
Run security-reviewer and typescript-reviewer in parallel. 
Synthesize one structured report with severity ratings.

SECTION A — AUTH SECURITY (security-reviewer)
- Server Actions use /lib/supabase/server.ts (anon key), 
  not service-role?
- Are passwords ever passed through any code we wrote 
  (we should never touch raw passwords; only Supabase does)?
- CSRF: Server Actions in Next.js 16 — verify protection is 
  active
- Login error messages safe (don't reveal email existence)?
- Forgot password always returns same response (sent or not)?
- Auth session cookie settings (HttpOnly, Secure, SameSite)?
- Reset password token validated before allowing password 
  change?

SECTION B — WORK-EMAIL VALIDATOR
- Run through bypass attempts:
  · Plus addressing (user+tag@gmail.com)
  · Capital letters (USER@GMAIL.COM)
  · Subdomains (user@x.gmail.com)
  · IDN domains (xn--... or unicode)
  · Trailing whitespace
  · Multiple @ characters
- Each rejected? If any pass, ❌

SECTION C — MULTI-TENANT ISOLATION
- Signup creates business via /lib/db/businesses.ts (not 
  direct Supabase)?
- Could the Server Action create a business for someone 
  else's owner_id? (Test: review the createBusiness call)
- Dashboard layout queries via /lib/db/, not direct Supabase?
- useActiveBusiness throws if used outside provider?
- Could a logged-in user GET another user's business by 
  manipulating URL params anywhere?

SECTION D — DATA INTEGRITY
- All Server Actions validate with Zod before DB calls?
- What happens if auth.signUp succeeds but createBusiness 
  fails? Is the failure logged? Is there guidance for the 
  user? (Don't require complex rollback in MVP — but failure 
  must be visible.)
- onboarding_completed updates use service-role lazy import?
- trial_state auto-creation by trigger confirmed by reading 
  the migration?

SECTION E — REDIRECTS AND ROUTING
- Auth-guarded routes redirect correctly?
- Dashboard layout handles "no business" edge case?
- Onboarding loop: can a user get stuck if onboarding_completed 
  fails to set?
- Login redirect param sanitized? (Check for open redirect 
  vulnerability — redirect=https://evil.com would be a bug)

SECTION F — CODE QUALITY (typescript-reviewer)
- Any 'any' types?
- All visible text via next-intl, no hardcoded English?
- All three locale files have all keys?
- Direct Supabase calls outside /lib/db/ or /lib/supabase/?
- process.env outside /lib/config.ts?
- Server Actions correctly marked 'use server'?
- No console.log left behind (console.error for genuine 
  error logging is acceptable until proper logger lands)?

SECTION G — UX
- Loading states on all submit buttons?
- Errors shown inline (next to relevant field), not just 
  page-level?
- Mid-onboarding refresh resumes at correct step?
- Form fields preserve values on validation errors?

SECTION H — CONVENTIONS
- formatISO from date-fns where timestamps written to DB?
- shadcn components used for primitives (no custom buttons)?
- File structure matches CLAUDE.md?

Report: markdown table 
(Section / Check / Status ✅❌⚠️ / File:Line / Fix)
After table: every ❌ with exact fix instructions
After that: every ⚠️ with recommendation

Final "Verdict" section listing:
- Blockers before Session 5
- Blockers before first user  
- Tech debt acceptable to defer
```

### After Part B

```
git add .
git commit -m "Session 4B: Review complete"
git push
```

Paste the report to Claude.ai. I'll write the correction prompts for Session 4C if needed.

---

## Part C — Correction Pass (only if reviewer finds issues)

Mirrors Session 2D/2E pattern. Fresh Sonnet session, fix listed issues only, verify, commit.

---

## Report Back to Claude.ai

```
Session 4 complete.

Manual tests passed:
- Gmail rejected: [yes/no]
- Work email accepted: [yes/no]
- Login → onboarding flow: [yes/no]
- Logout: [yes/no]
- Three languages render: [pass/fail]
- Forgot password flow: [yes/no]
- Onboarding step 1-4: [yes/no]
- Skip-for-now works: [yes/no]

Build:
- tsc --noEmit: [yes/no]
- vitest run: [yes/no - test count]
- npm run build: [yes/no]

Reviewer report:
[paste full report]

Correction pass needed: [yes/no]
Remaining ❌: [list or "none"]
⚠️ deferred: [list or "none"]

Repo: [GitHub URL]
```

---

## Common gotchas

**Confirmation emails not arriving** — Supabase free tier has email rate limits. In dev, disable email confirmation: Supabase dashboard → Authentication → Providers → Email → "Confirm email" off. Re-enable before production.

**RLS blocks own queries after signup** — RLS uses `(SELECT get_user_business_ids())` which only returns businesses where `owner_id = auth.uid()`. If the businesses INSERT didn't actually run (or set the wrong owner_id), the user is locked out. Check Server Action ordering.

**Onboarding redirect loop** — if `onboarding_completed` never gets set to true, every login redirects to onboarding. Check that step 4 and "Skip for now" both reliably update the field via service-role function.

**Open redirect vulnerability** — `?redirect=` parameter on login. Sanitize: only accept paths that start with `/{locale}/` and don't contain `://`. Reject absolute URLs.

**Server Action file co-location** — Next.js 16 expects 'use server' files alongside the page that uses them. Don't move actions to /lib/ even if they look reusable.

**Translation keys diverge** — adding a key to `en` but forgetting `pt` and `es` causes build failures. Always add to all three.
