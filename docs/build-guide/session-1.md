# Session 1 — Project Initialization

> **Goal:** Bootstrap the Next.js project with the right foundations: TypeScript, Tailwind, shadcn/ui, i18n scaffolding, environment config, and the folder structure that CLAUDE.md describes.
> **Time:** 60–90 minutes
> **Model:** Claude Sonnet 4.6 throughout (this is well-trodden territory, no architecture decisions)
> **Session structure:** Single continuous session, no architect/builder/reviewer split needed

---

## Pre-session checklist

Before running this session, confirm:

- [ ] Session 0 is fully complete and all verifications passed
- [ ] You're inside your `~/projects/sosh` folder in your terminal
- [ ] CLAUDE.md is in the project root
- [ ] You have your Supabase URL, anon key, and service_role key ready
- [ ] You have your Anthropic API key ready
- [ ] VS Code is open with the project folder loaded

---

## How to run this session

1. Open your terminal inside the project folder
2. Run `claude` to launch Claude Code
3. Confirm the model — type `/model` and select **Claude Sonnet 4.6** (or whatever the current Sonnet is named)
4. Paste the **Session Primer** below and wait for Claude Code to acknowledge
5. Then paste **Prompt 1**, wait for completion, review, and proceed to **Prompt 2**, and so on
6. After all prompts are run, do the **Test Checklist**
7. Come back to Claude.ai with the **Report Back** information

---

## Session Primer

Paste this first:

```
Read CLAUDE.md in the project root. Read all files in /docs/build-guide/ 
and /docs/current-phase.md.

We are starting Session 1: Project Initialization. We will scaffold the 
Next.js project foundations.

Rules for this session:
- Follow every convention in CLAUDE.md exactly
- Do not install any package not listed in the prompts I'll give you
- Do not create files outside the structure CLAUDE.md describes
- Stop and ask if any prompt seems to contradict CLAUDE.md
- After each prompt, summarize what you did in 2-3 sentences before I 
  move to the next prompt

Acknowledge that you've read CLAUDE.md and current-phase.md, and confirm 
you're ready for Prompt 1.
```

Wait for Claude Code to confirm it has read the files and is ready.

---

## Prompt 1 — Initialize Next.js project

```
Initialize a Next.js 14 project in the current directory using:

npx create-next-app@latest . --typescript --tailwind --app --no-src-dir 
--import-alias "@/*" --use-npm

When prompted, answer:
- ESLint: Yes
- Use Turbopack for next dev: Yes (if asked)

After creation, verify package.json exists and run npm install if needed.
Do not start the dev server yet. Show me the contents of package.json 
when done.
```

**What to check after Prompt 1:**
- A `package.json` file exists
- A `tsconfig.json` exists
- An `app` folder exists with `page.tsx` and `layout.tsx` inside
- The CLAUDE.md you placed earlier is still there (Claude Code should not have deleted it)

---

## Prompt 2 — Install core dependencies

```
Install the following dependencies in this exact order. Run each install 
command, wait for it to finish, then move to the next:

1. Production dependencies:
npm install @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk zod 
date-fns clsx tailwind-merge lucide-react next-intl

2. Dev dependencies:
npm install -D @types/node

After all installs complete, show me the dependencies and devDependencies 
sections of package.json.
```

**What to check after Prompt 2:**
- All packages above appear in package.json
- No errors in the terminal output

---

## Prompt 3 — Set up shadcn/ui

```
Initialize shadcn/ui in the project. Run:

npx shadcn@latest init

When prompted, answer:
- Style: Default
- Base color: Stone
- CSS variables: Yes

After init completes, install these initial components we'll need 
across the app:

npx shadcn@latest add button input label card form dialog 
dropdown-menu select textarea badge separator tabs

Show me the contents of /components/ui/ when done to confirm all 
components were added.
```

**What to check after Prompt 3:**
- A `/components/ui/` folder exists with `button.tsx`, `input.tsx`, etc.
- A `/lib/utils.ts` file exists
- `tailwind.config.ts` was updated by shadcn
- `app/globals.css` contains shadcn CSS variables

---

## Prompt 4 — Create the folder structure

```
Create the folder structure described in CLAUDE.md. Specifically:

mkdir -p app/\(auth\) app/\(dashboard\) app/\(marketing\) app/api 
mkdir -p components/campaigns components/posts components/layout 
mkdir -p lib/ai lib/social lib/db lib/supabase 
mkdir -p i18n/en i18n/pt i18n/es 
mkdir -p docs/decisions

Create empty placeholder files so the folders are tracked by Git:
- lib/ai/.gitkeep
- lib/social/.gitkeep  
- lib/db/.gitkeep
- components/campaigns/.gitkeep
- components/posts/.gitkeep
- components/layout/.gitkeep

Show me the result of running `tree -L 3 -I 'node_modules|.next|.git'` 
or equivalent so I can confirm the structure.
```

**What to check after Prompt 4:**
- All folders exist
- Folder structure matches what CLAUDE.md describes

---

## Prompt 5 — Create the typed config module

```
Create /lib/config.ts which is the single typed access point for 
environment variables. Per CLAUDE.md, no other file may use process.env 
directly.

The config should export a single typed object with these keys (split 
into server-only and public):

Server (only available server-side):
- ANTHROPIC_API_KEY
- SUPABASE_SERVICE_ROLE_KEY
- POSTIZ_API_URL (optional, default: empty string for now)
- POSTIZ_API_KEY (optional, default: empty string for now)
- STRIPE_SECRET_KEY (optional, default: empty string for now)
- STRIPE_WEBHOOK_SECRET (optional, default: empty string for now)
- RESEND_API_KEY (optional, default: empty string for now)

Public (available in browser too):
- NEXT_PUBLIC_SUPABASE_URL
- NEXT_PUBLIC_SUPABASE_ANON_KEY
- NEXT_PUBLIC_APP_URL (default: http://localhost:3000)

Use Zod to validate the env vars at startup. If a required var is 
missing, throw a descriptive error. Make optional vars truly optional 
(no error if missing).

Use a getter pattern so server-only vars throw if accessed in client 
code:

export const config = {
  server: { ... server-only getters that throw client-side ... },
  public: { ... }
}

Also create a .env.local.example file at the project root listing every 
env var name with a placeholder value, so I know what to fill in.
```

**What to check after Prompt 5:**
- `/lib/config.ts` exists with proper typing
- `.env.local.example` exists
- No use of `process.env` outside `/lib/config.ts`

---

## Prompt 6 — Create your actual .env.local

This one is for you to do, not Claude Code. Paste this prompt to it anyway so it knows you're doing it.

```
I'm going to create the .env.local file myself with my actual credentials. 
Wait while I do that. Confirm you understand and will not create this 
file yourself.
```

**Now you do this manually:**

1. In VS Code, right-click the project root → New File → name it `.env.local`
2. Open `.env.local.example` (just created by Claude Code) and copy its contents into `.env.local`
3. Replace each placeholder with your real credentials:
   - `NEXT_PUBLIC_SUPABASE_URL` → your Supabase project URL from Step 6 of Session 0
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → your Supabase anon key
   - `SUPABASE_SERVICE_ROLE_KEY` → your Supabase service role key
   - `ANTHROPIC_API_KEY` → your Anthropic API key from Step 5 of Session 0
   - `NEXT_PUBLIC_APP_URL` → leave as `http://localhost:3000` for now
   - All the optional ones (Postiz, Stripe, Resend) → leave blank for now

4. Save the file
5. Confirm `.env.local` is in `.gitignore` (it should be by default — open `.gitignore` and check). It must never be committed to Git.

---

## Prompt 7 — Set up the Supabase client wrappers

```
Create the three Supabase client wrappers in /lib/supabase/. These 
follow the @supabase/ssr package conventions for Next.js App Router.

1. /lib/supabase/server.ts — for use in Server Components, Server 
Actions, and Route Handlers. Uses cookies() from next/headers.

2. /lib/supabase/client.ts — for use in Client Components. Singleton 
browser client.

3. /lib/supabase/middleware.ts — helper used by middleware.ts to refresh 
the session cookie on every request.

Use the latest @supabase/ssr patterns. The server client must NOT cache 
across requests. Each function call creates a new client tied to the 
current request's cookies.

Pull the URL and anon key from /lib/config.ts (config.public), never 
directly from process.env.

Then create middleware.ts at the project root that uses the helper to 
refresh sessions. Match all paths except static files and images.

Show me each file after creation.
```

**What to check after Prompt 7:**
- All three files exist in `/lib/supabase/`
- `middleware.ts` exists at the root
- All env access goes through `/lib/config.ts`, not `process.env`

---

## Prompt 8 — Set up next-intl for i18n

```
Configure next-intl for English, Portuguese, and Spanish.

1. Install the next-intl plugin (already installed) and create the 
configuration:

- Create /i18n/request.ts (or wherever next-intl docs recommend in 
their latest version)
- Create translation files:
  - /i18n/en/common.json
  - /i18n/pt/common.json
  - /i18n/es/common.json

Each file starts with these keys:

{
  "app": {
    "name": "SŌSH",
    "tagline": "Marketing-leading AI social media management"
  },
  "nav": {
    "campaigns": "Campaigns",
    "calendar": "Calendar",
    "analytics": "Analytics",
    "inbox": "Inbox",
    "settings": "Settings"
  }
}

Translate appropriately for each language (use natural PT-PT and ES-ES, 
not Portuguese from Brazil for now — we'll add PT-BR later).

2. Update next.config.js to use the next-intl plugin

3. Set up the routing so URLs are /en/..., /pt/..., /es/...

4. Update app/layout.tsx to handle the locale parameter

5. Make English the default locale, but auto-detect user's browser 
language on first visit

Show me the resulting file structure under /app and /i18n.
```

**What to check after Prompt 8:**
- All three locale files exist with content
- `next.config.js` has the next-intl plugin
- The app folder structure now uses `[locale]` routing
- A locale switcher pattern is set up

---

## Prompt 9 — Create the marketing homepage placeholder

```
Create a minimal marketing homepage at /app/[locale]/(marketing)/page.tsx 
that:

- Uses next-intl translations for all visible text
- Shows the SŌSH name in a large header
- Shows the tagline below it
- Has a "Start free trial" button (link to /[locale]/signup, route 
doesn't exist yet — that's fine, link anyway)
- Uses shadcn Button component
- Centered, simple, clean — no fancy graphics yet
- Renders correctly in all three languages

Add the corresponding translation keys to all three locale common.json 
files:

- "marketing.hero.title": (the SŌSH brand name)
- "marketing.hero.subtitle": (one-line description, write it well in each 
language)
- "marketing.hero.cta": ("Start free trial" / "Iniciar teste grátis" / 
"Comenzar prueba gratis")

Show me the resulting page.tsx and the updated translation files.
```

**What to check after Prompt 9:**
- The page renders correctly
- All three languages display
- The button uses shadcn Button

---

## Prompt 10 — Verify the build works

```
Run two checks to make sure everything is wired correctly:

1. Type check: npx tsc --noEmit
   This should produce no errors.

2. Build: npm run build
   This should complete without errors.

If either fails, show me the full error output and stop. Do not attempt 
to fix things automatically — I want to see the errors first.

If both succeed, run:

3. npm run dev

Then tell me what URL to visit (it should be http://localhost:3000) 
and stop. Do not write more code.
```

**What to check after Prompt 10:**
- Type check passes
- Build passes
- Dev server starts
- Visiting http://localhost:3000 shows the homepage (it should redirect to /en or your detected language)

---

## Test Checklist

Before reporting back, verify all of these manually:

- [ ] `npm run dev` starts without errors
- [ ] Homepage loads at http://localhost:3000
- [ ] You can manually navigate to /en, /pt, and /es and see the homepage in different languages
- [ ] The "Start free trial" button is visible (clicking it gives a 404 — that's expected)
- [ ] No errors in the browser console (F12 → Console tab)
- [ ] No errors in the terminal where dev server is running
- [ ] `npm run build` completes successfully
- [ ] All files from CLAUDE.md's folder structure exist

---

## Commit your progress

```
git add .
git commit -m "Session 1: Project initialization complete"
git push
```

---

## Report Back to Claude.ai

Come back here and paste this template, filled in:

```
Session 1 complete.

✅ Worked: 
[list anything that went smoothly]

⚠️ Issues encountered: 
[list anything that needed troubleshooting, even if resolved]

❓ Decisions Claude Code asked about: 
[did Claude Code ever stop to ask you something? What did it ask?]

📁 Final state:
- Number of files in /lib/: [count]
- Number of files in /components/ui/: [count]  
- Total package count in package.json: [count]

🔗 Repo URL: [paste your GitHub repo URL]
```

I'll review the report and either confirm we're good to move to Session 2, or give you a correction prompt to fix any issues before continuing.

---

## Common gotchas in Session 1

**"Module not found" errors after install** — usually fixed by deleting `node_modules` and `.next`, then running `npm install` again.

**shadcn init fails with "components.json already exists"** — that's fine, skip the init step and just run the `add` commands.

**Build fails on i18n routing** — next-intl version mismatches can cause this. Tell Claude Code to confirm it's using the latest stable next-intl docs.

**Tailwind classes not applying** — confirm `tailwind.config.ts` has the right content paths after shadcn init modified it.
