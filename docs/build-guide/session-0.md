# Session 0 — Environment Setup

> **Goal:** Get every tool, account, and credential ready so Session 1 starts smoothly.
> **Time:** 90–120 minutes the first time. You only do this once.
> **Claude Code needed:** No, except at the very end to verify the install.
> **Difficulty:** Procedural, not technical. Just follow the steps in order.

---

## Before you start

You'll work through this on your own machine, no Claude Code involvement until the final verification step. Don't skip steps. Don't change the order. If something fails, find the matching block in the **Troubleshooting** section at the end before continuing.

You'll need a credit card for Anthropic's API and Stripe (Stripe can be deferred until later if you prefer). All other accounts are free at this stage.

**Pre-flight checklist — confirm before starting:**

- [ ] You have a computer running macOS, Windows 10/11, or Linux
- [ ] You have admin rights on the computer (you can install software)
- [ ] You have a stable internet connection
- [ ] You have a personal email and a work/business email available
- [ ] You have ~120 minutes uninterrupted

---

## Step 1 — Install VS Code (10 minutes)

VS Code is your code editor. You'll spend most of your time here.

1. Go to https://code.visualstudio.com
2. Click the big download button (it auto-detects your OS)
3. Run the installer with default options
4. **macOS:** drag VS Code into Applications, then open it from Launchpad
5. **Windows:** during install, check the box "Add to PATH" if asked
6. Open VS Code

**Verify:** VS Code opens and shows the welcome screen. If it does, move on.

---

## Step 2 — Install Node.js (10 minutes)

Node.js runs JavaScript outside the browser. Next.js, npm, and Claude Code all require it.

1. Go to https://nodejs.org
2. Download the **LTS version** (left button — currently 20.x or 22.x). Do not download "Current."
3. Run the installer with default options
4. **Restart your computer** after install completes

**Verify:** Open a terminal and run two commands.

**On macOS:** Press Cmd+Space, type `Terminal`, press Enter.
**On Windows:** Press Windows key, type `cmd`, press Enter (or use PowerShell).
**On Linux:** Open your terminal as you normally do.

In the terminal, type:

```
node --version
```

You should see something like `v20.11.0` or `v22.x.x`. Then type:

```
npm --version
```

You should see something like `10.2.4`.

**If both commands print version numbers, move on. If not, see Troubleshooting block A.**

---

## Step 3 — Install Git (10 minutes)

Git is how you save versions of your code and back it up to GitHub.

**On macOS:** Git is usually pre-installed. In your terminal type `git --version`. If it shows a version, skip to Step 4. If it asks you to install Xcode Command Line Tools, accept and wait for it to finish (~15 minutes), then re-run `git --version` to confirm.

**On Windows:** Go to https://git-scm.com/download/win and run the installer. Use all default options.

**On Linux:** `sudo apt install git` (Debian/Ubuntu) or your distro's equivalent.

**Verify:**

```
git --version
```

You should see something like `git version 2.42.0`.

Now configure Git with your identity. Replace the values with your actual name and email:

```
git config --global user.name "Your Name"
git config --global user.email "you@yourdomain.com"
```

Use the email you'll use for GitHub.

---

## Step 4 — Create a GitHub account (10 minutes)

GitHub is where your code lives. Free for personal projects.

1. Go to https://github.com/signup
2. Use your work/business email
3. Pick a username — this becomes part of your project URLs, so choose something professional. Lowercase, no special characters.
4. Verify your email when GitHub sends the confirmation
5. Skip the "for individual" plan — the free tier is fine

**Set up authentication:**

You need a way for Git on your computer to push code to GitHub. The simplest method in 2026 is GitHub CLI.

1. Go to https://cli.github.com and install the GitHub CLI for your OS
2. After install, in your terminal run:

```
gh auth login
```

3. Follow the prompts. Choose: GitHub.com → HTTPS → Yes (authenticate Git) → Login with web browser
4. It will give you a code, then open your browser. Paste the code, authorize.

**Verify:**

```
gh auth status
```

Should show "Logged in to github.com as [your-username]."

---

## Step 5 — Create an Anthropic account and API key (10 minutes)

This is for Claude Code (using Claude programmatically) and for SŌSH itself (the AI layer in your app).

1. Go to https://console.anthropic.com
2. Sign up with your work email
3. Verify your email
4. **Add billing information:** Settings → Billing → add a credit card. Without this, Claude Code won't work.
5. Add a small amount of starting credit ($10 is fine to begin)
6. Go to **API Keys** in the left sidebar
7. Click "Create Key"
8. Name it `sosh-development`
9. **Copy the key immediately and save it somewhere safe.** You can't view it again. A password manager is ideal.

**You'll use this key in two places:**
- Claude Code uses it automatically once configured
- Your SŌSH app uses it as an environment variable

---

## Step 6 — Create a Supabase account (10 minutes)

Supabase is your database, authentication, and file storage.

1. Go to https://supabase.com
2. Click "Start your project"
3. Sign up with GitHub (easiest)
4. Once logged in, click "New Project"
5. Fill in:
   - **Organization:** the default personal one is fine
   - **Project name:** `sosh-dev`
   - **Database password:** click "Generate a password" and **save it in your password manager immediately**
   - **Region:** pick the one closest to you (Frankfurt, Paris, or Madrid for Lisbon)
   - **Pricing plan:** Free
6. Click "Create new project" and wait ~2 minutes for it to provision

**Save these three values to your password manager** (you'll find them under Settings → API after the project is ready):

- **Project URL** (looks like `https://abcdefgh.supabase.co`)
- **anon public key** (a long string starting with `eyJ...`)
- **service_role key** (another long string starting with `eyJ...`) — this is sensitive, never share it

---

## Step 7 — Create a Vercel account (5 minutes)

Vercel is where SŌSH will be deployed. Free for personal projects.

1. Go to https://vercel.com/signup
2. Sign up with GitHub
3. That's it for now. We'll connect your project later in Session 1.

---

## Step 8 — Install Claude Code (10 minutes)

Claude Code is the agent that will write your code based on the prompts I give you.

In your terminal, run:

```
npm install -g @anthropic-ai/claude-code
```

This installs Claude Code globally so you can run `claude` from any folder.

**On macOS/Linux,** if you get permission errors, prepend `sudo`:

```
sudo npm install -g @anthropic-ai/claude-code
```

**On Windows,** open a new terminal as Administrator (right-click on Command Prompt → Run as Administrator) before running the install.

**Verify:**

```
claude --version
```

Should print a version number.

**Configure Claude Code with your Anthropic API key:**

Run:

```
claude
```

The first time you run it, it will prompt you to log in or paste your API key. Choose to paste your API key. Use the key you saved from Step 5.

Once configured, it will drop you into a chat interface inside the terminal. Type `/exit` to leave for now.

---

## Step 9 — Create your project folder (10 minutes)

This is where your code will live on your computer.

**On macOS/Linux:**

```
mkdir -p ~/projects/sosh
cd ~/projects/sosh
```

**On Windows (PowerShell):**

```
mkdir $HOME\projects\sosh
cd $HOME\projects\sosh
```

You're now inside an empty folder. This is your project root.

**Open the folder in VS Code:**

```
code .
```

(The space and dot are intentional — they mean "this current folder.")

VS Code opens with this empty folder as the workspace.

---

## Step 10 — Create CLAUDE.md and the docs folder (10 minutes)

CLAUDE.md is the file Claude Code reads first in every session. It's the project's constitution.

**In VS Code, create the file:**

1. Right-click in the empty file explorer on the left → New File
2. Name it exactly `CLAUDE.md` (capital letters matter)
3. Press Enter

**Paste the entire CLAUDE.md content** that came with this build guide (you have it as a separate file). Save with Cmd+S (Mac) or Ctrl+S (Windows).

**Now create the docs folder structure:**

In your terminal (still inside the project folder):

```
mkdir -p docs/build-guide docs/decisions
```

**Copy each session markdown file** (session-0.md through session-5.md from the build guide) into `docs/build-guide/`.

**Create one more file** called `docs/current-phase.md`. In VS Code: New File → name `current-phase.md` → place it in `docs/`. Paste this starter content:

```markdown
# Current Phase

**Phase:** 1 — MVP
**Goal:** First paying customer
**Status:** Just started — environment setup complete

## What's done
- Session 0: Environment setup

## What's next
- Session 1: Project initialization

## Open decisions
None right now.

## Recent gotchas
None right now.
```

Save it.

---

## Step 11 — Initialize Git and connect to GitHub (10 minutes)

In your terminal, still in the project folder, run:

```
git init
git add .
git commit -m "Initial commit: project constitution and build guide"
```

You should see Git report some files added.

**Create a GitHub repository:**

```
gh repo create sosh --private --source=. --remote=origin --push
```

This creates a private repository called `sosh` on your GitHub account and pushes your initial commit to it.

**Verify:** Go to https://github.com/[your-username]/sosh and you should see CLAUDE.md and the docs folder listed.

---

## Step 12 — Final verification (5 minutes)

Run this final check. Everything should pass.

**In your terminal, inside the project folder:**

```
node --version
```
✅ Should show v20.x or v22.x

```
git --version
```
✅ Should show a version

```
gh auth status
```
✅ Should show you're logged in

```
claude --version
```
✅ Should show a version

```
ls
```
✅ Should list `CLAUDE.md` and `docs`

**In your browser, verify each account is accessible:**

- https://github.com/[your-username]/sosh — your repo exists
- https://console.anthropic.com — you're logged in with billing set up
- https://supabase.com/dashboard — your `sosh-dev` project shows "Active"
- https://vercel.com/dashboard — you're logged in

---

## Done

If all 12 steps completed and verification passes, environment setup is complete. Come back to Claude.ai and tell me you've finished Session 0. I'll give you Session 1.

**Save your credentials safely.** Before Session 1, make sure your password manager has:

- GitHub login
- Anthropic API key
- Supabase project URL, anon key, service_role key, database password
- Vercel login

You'll need all of these in Session 1.

---

## Troubleshooting

### Block A — Node command not found

If `node --version` says command not found:
- **macOS/Linux:** restart your terminal completely (close all windows, reopen)
- **Windows:** restart your computer
- If still not working, your PATH didn't get updated. Reinstall Node.js and during install, make sure the "Add to PATH" option is checked.

### Block B — Git asks for credentials repeatedly

Run `gh auth setup-git` to make GitHub CLI handle Git authentication automatically.

### Block C — npm install fails with EACCES permission error

**macOS/Linux:** Don't use `sudo`. Instead, set up npm to use a folder you own:
```
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
source ~/.zshrc
```
Then re-run the npm install command without sudo.

**Windows:** Open Command Prompt as Administrator (right-click → Run as Administrator) and try again.

### Block D — Claude Code login fails

Make sure your API key is valid. Go to https://console.anthropic.com → API Keys, and confirm the key exists and is active. If it doesn't, create a new one and paste it when Claude Code asks.

Also confirm you've added a payment method and at least some credit at https://console.anthropic.com → Billing.

### Block E — Supabase project stuck on "Setting up project..."

This sometimes takes 5-10 minutes the first time. Walk away and come back. If it's still stuck after 15 minutes, delete the project and create a new one in a different region.

### Block F — Anything else

Come back to Claude.ai with the error message and what step you were on. I'll diagnose and tell you what to do.
