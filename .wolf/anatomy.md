# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-05-05T20:32:09.977Z
> Files: 588 tracked | Anatomy hits: 0 | Misses: 0

## ./

- `.gitignore` — Git ignore rules (~128 tok)
- `AGENTS.md` — This is NOT the Next.js you know (~82 tok)
- `CLAUDE.md` — OpenWolf (~3450 tok)
- `CLAUDE.md.bak` (~3 tok)
- `components.json` (~148 tok)
- `eslint.config.mjs` — Declares eslintConfig (~350 tok)
- `middleware.ts` — Exports middleware, config (~646 tok)
- `next-env.d.ts` — / <reference types="next" /> (~72 tok)
- `next.config.ts` — Next.js configuration (~68 tok)
- `package-lock.json` — npm lock file (~119744 tok)
- `package.json` — Node.js package manifest (~416 tok)
- `postcss.config.mjs` — Declares config (~26 tok)
- `README.md` — Project documentation (~363 tok)
- `tsconfig.json` — TypeScript configuration (~191 tok)
- `tsconfig.tsbuildinfo` (~60667 tok)
- `vitest.config.ts` — ', '**/lib/db/types.test.ts'], (~86 tok)

## .claude/

- `settings.json` (~441 tok)
- `settings.local.json` (~62 tok)

## .claude/rules/

- `openwolf.md` (~313 tok)

## app/

- `globals.css` — Styles: 7 rules, 104 vars, 1 layers (~1350 tok)
- `layout.tsx` — Minimal shell — lang and providers are set per-locale in app/[locale]/layout.tsx (~79 tok)

## app/[locale]/

- `layout.tsx` — geistSans (~370 tok)
- `page.tsx` — LocalePage (~62 tok)

## app/[locale]/(marketing)/home/

- `page.tsx` — MarketingHomePage (~189 tok)

## app/api/_health/social/

- `route.ts` — Next.js API route: GET (~367 tok)

## components/campaigns/

- `.gitkeep` (~0 tok)

## components/layout/

- `.gitkeep` (~0 tok)

## components/posts/

- `.gitkeep` (~0 tok)

## components/ui/

- `badge.tsx` — badgeVariants (~550 tok)
- `button.tsx` — buttonVariants (~914 tok)
- `card.tsx` — Card (~755 tok)
- `dialog.tsx` — Dialog — renders modal (~1165 tok)
- `dropdown-menu.tsx` — DropdownMenu (~2496 tok)
- `form.tsx` — Form — renders form — uses useContext (~996 tok)
- `input.tsx` — Input (~298 tok)
- `label.tsx` — Label (~148 tok)
- `select.tsx` — Select (~1902 tok)
- `separator.tsx` — Separator (~156 tok)
- `tabs.tsx` — Tabs (~1000 tok)
- `textarea.tsx` — Textarea (~241 tok)

## docs/

- `current-phase.md` — Current Phase (~921 tok)

## docs/build-guide/

- `session-0.md` — Session 0 — Environment Setup (~3122 tok)
- `session-1.md` — Session 1 — Project Initialization (~3475 tok)
- `session-2.md` — Session 2 — Database Schema & Multi-Tenancy (~3853 tok)
- `session-3.md` — Session 3 — The SocialProvider Abstraction (~3738 tok)
- `session-4.md` — Session 4 — Authentication & Onboarding Foundation (~3838 tok)
- `session-5.md` — Session 5 — AI Layer Foundation & Brand Voice Inference (~5561 tok)

## docs/decisions/

- `0001-database-schema.md` — ADR 0001 — Database Schema (Phase 1 MVP) (~9373 tok)
- `0002-social-provider.md` — ADR 0002 — SocialProvider Abstraction (Phase 1 MVP) (~10429 tok)

## everything-claude-code/

- `.gitignore` — Git ignore rules (~347 tok)
- `.markdownlint.json` (~108 tok)
- `.mcp.json` (~207 tok)
- `.npmignore` — npm always includes README* — exclude translations from package (~64 tok)
- `.prettierrc` — Prettier configuration (~38 tok)
- `.tool-versions` — .tool-versions — Tool version pins for asdf (https://asdf-vm.com) (~58 tok)
- `.yarnrc.yml` (~8 tok)
- `agent.yaml` (~1394 tok)
- `AGENTS.md` — Everything Claude Code (ECC) — Agent Instructions (~2042 tok)
- `CHANGELOG.md` — Change log (~2164 tok)
- `CLAUDE.md` — CLAUDE.md (~715 tok)
- `CODE_OF_CONDUCT.md` — Contributor Covenant Code of Conduct (~1334 tok)
- `COMMANDS-QUICK-REF.md` — Commands Quick Reference (~1576 tok)
- `commitlint.config.js` (~110 tok)
- `CONTRIBUTING.md` — Contributing to Everything Claude Code (~3440 tok)
- `ecc_dashboard.py` — URL configuration (~11532 tok)
- `eslint.config.js` — ESLint flat configuration (~243 tok)
- `EVALUATION.md` — Repo Evaluation vs Current Setup (~1092 tok)
- `install.ps1` — install.ps1 — Windows-native entrypoint for the ECC installer. (~427 tok)
- `install.sh` — install.sh — Legacy shell entrypoint for the ECC installer. (~350 tok)
- `LICENSE` — Project license (~292 tok)
- `package-lock.json` — npm lock file (~30636 tok)
- `package.json` — Node.js package manifest (~2697 tok)
- `pyproject.toml` — Python project configuration (~510 tok)
- `README.md` — Project documentation (~18148 tok)
- `README.zh-CN.md` — Everything Claude Code (~6570 tok)
- `REPO-ASSESSMENT.md` — Repo & Fork Assessment + Setup Recommendations (~1669 tok)
- `RULES.md` — Rules (~445 tok)
- `SECURITY.md` — Security Policy (~460 tok)
- `SOUL.md` — Soul (~283 tok)
- `SPONSORING.md` — Sponsoring ECC (~461 tok)
- `SPONSORS.md` — Sponsors (~496 tok)
- `the-longform-guide.md` — The Longform Guide to Everything Claude Code (~3882 tok)
- `the-security-guide.md` — The Shorthand Guide to Everything Agentic Security (~7263 tok)
- `the-shortform-guide.md` — The Shorthand Guide to Everything Claude Code (~4180 tok)
- `TROUBLESHOOTING.md` — Troubleshooting Guide (~2632 tok)
- `VERSION` (~4 tok)
- `WORKING-CONTEXT.md` — Working Context (~7506 tok)

## everything-claude-code/.agents/plugins/

- `marketplace.json` (~116 tok)

## everything-claude-code/.agents/skills/agent-introspection-debugging/

- `SKILL.md` — Agent Introspection Debugging (~1414 tok)

## everything-claude-code/.agents/skills/agent-introspection-debugging/agents/

- `openai.yaml` (~89 tok)

## everything-claude-code/.agents/skills/agent-sort/

- `SKILL.md` — Agent Sort (~1528 tok)

## everything-claude-code/.agents/skills/agent-sort/agents/

- `openai.yaml` (~74 tok)

## everything-claude-code/.agents/skills/api-design/

- `SKILL.md` — API Design Patterns (~3398 tok)

## everything-claude-code/.agents/skills/api-design/agents/

- `openai.yaml` (~78 tok)

## everything-claude-code/.agents/skills/article-writing/

- `SKILL.md` — Article Writing (~745 tok)

## everything-claude-code/.agents/skills/article-writing/agents/

- `openai.yaml` (~80 tok)

## everything-claude-code/.agents/skills/backend-patterns/

- `SKILL.md` — Backend Development Patterns (~3606 tok)

## everything-claude-code/.agents/skills/backend-patterns/agents/

- `openai.yaml` (~78 tok)

## everything-claude-code/.agents/skills/brand-voice/

- `SKILL.md` — Brand Voice (~930 tok)

## everything-claude-code/.agents/skills/brand-voice/agents/

- `openai.yaml` (~76 tok)

## everything-claude-code/.agents/skills/brand-voice/references/

- `voice-profile-schema.md` — Voice Profile Schema (~280 tok)

## everything-claude-code/.agents/skills/bun-runtime/

- `SKILL.md` — Bun Runtime (~667 tok)

## everything-claude-code/.agents/skills/bun-runtime/agents/

- `openai.yaml` (~76 tok)

## everything-claude-code/.agents/skills/claude-api/

- `SKILL.md` — Claude API (~2204 tok)

## everything-claude-code/.agents/skills/claude-api/agents/

- `openai.yaml` (~78 tok)

## everything-claude-code/.agents/skills/coding-standards/

- `SKILL.md` — Coding Standards & Best Practices (~3282 tok)

## everything-claude-code/.agents/skills/coding-standards/agents/

- `openai.yaml` (~80 tok)

## everything-claude-code/.agents/skills/content-engine/

- `SKILL.md` — Content Engine (~1119 tok)

## everything-claude-code/.agents/skills/content-engine/agents/

- `openai.yaml` (~81 tok)

## everything-claude-code/.agents/skills/crosspost/

- `SKILL.md` — Crosspost (~884 tok)

## everything-claude-code/.agents/skills/crosspost/agents/

- `openai.yaml` (~73 tok)

## everything-claude-code/.agents/skills/deep-research/

- `SKILL.md` — Deep Research (~1179 tok)

## everything-claude-code/.agents/skills/deep-research/agents/

- `openai.yaml` (~76 tok)

## everything-claude-code/.agents/skills/dmux-workflows/

- `SKILL.md` — dmux Workflows (~1212 tok)

## everything-claude-code/.agents/skills/dmux-workflows/agents/

- `openai.yaml` (~77 tok)

## everything-claude-code/.agents/skills/documentation-lookup/

- `SKILL.md` — Documentation Lookup (Context7) (~1245 tok)

## everything-claude-code/.agents/skills/documentation-lookup/agents/

- `openai.yaml` (~80 tok)

## everything-claude-code/.agents/skills/e2e-testing/

- `SKILL.md` — E2E Testing Patterns (~2063 tok)

## everything-claude-code/.agents/skills/e2e-testing/agents/

- `openai.yaml` (~73 tok)

## everything-claude-code/.agents/skills/eval-harness/

- `SKILL.md` — Eval Harness Skill (~1437 tok)

## everything-claude-code/.agents/skills/eval-harness/agents/

- `openai.yaml` (~73 tok)

## everything-claude-code/.agents/skills/everything-claude-code/

- `SKILL.md` — Everything Claude Code Conventions (~2943 tok)

## everything-claude-code/.agents/skills/everything-claude-code/agents/

- `openai.yaml` (~84 tok)

## everything-claude-code/.agents/skills/exa-search/

- `SKILL.md` — Exa Search (~1242 tok)

## everything-claude-code/.agents/skills/exa-search/agents/

- `openai.yaml` (~72 tok)

## everything-claude-code/.agents/skills/fal-ai-media/

- `SKILL.md` — fal.ai Media Generation (~1773 tok)

## everything-claude-code/.agents/skills/fal-ai-media/agents/

- `openai.yaml` (~76 tok)

## everything-claude-code/.agents/skills/frontend-design/

- `SKILL.md` — Frontend Design (~989 tok)

## everything-claude-code/.agents/skills/frontend-design/agents/

- `openai.yaml` — Declares design (~80 tok)

## everything-claude-code/.agents/skills/frontend-patterns/

- `SKILL.md` — Frontend Development Patterns (~3851 tok)

## everything-claude-code/.agents/skills/frontend-patterns/agents/

- `openai.yaml` (~77 tok)

## everything-claude-code/.agents/skills/frontend-slides/

- `SKILL.md` — Frontend Slides (~1683 tok)
- `STYLE_PRESETS.md` — Style Presets Reference (~2369 tok)

## everything-claude-code/.agents/skills/frontend-slides/agents/

- `openai.yaml` (~79 tok)

## everything-claude-code/.agents/skills/investor-materials/

- `SKILL.md` — Investor Materials (~702 tok)

## everything-claude-code/.agents/skills/investor-materials/agents/

- `openai.yaml` (~84 tok)

## everything-claude-code/.agents/skills/investor-outreach/

- `SKILL.md` — Investor Outreach (~681 tok)

## everything-claude-code/.agents/skills/investor-outreach/agents/

- `openai.yaml` (~81 tok)

## everything-claude-code/.agents/skills/market-research/

- `SKILL.md` — Market Research (~572 tok)

## everything-claude-code/.agents/skills/market-research/agents/

- `openai.yaml` (~78 tok)

## everything-claude-code/.agents/skills/mcp-server-patterns/

- `SKILL.md` — MCP Server Patterns (~979 tok)

## everything-claude-code/.agents/skills/mcp-server-patterns/agents/

- `openai.yaml` (~79 tok)

## everything-claude-code/.agents/skills/nextjs-turbopack/

- `SKILL.md` — Next.js and Turbopack (~548 tok)

## everything-claude-code/.agents/skills/nextjs-turbopack/agents/

- `openai.yaml` (~79 tok)

## everything-claude-code/.agents/skills/product-capability/

- `SKILL.md` — Product Capability (~1138 tok)

## everything-claude-code/.agents/skills/product-capability/agents/

- `openai.yaml` (~82 tok)

## everything-claude-code/.agents/skills/security-review/

- `SKILL.md` — Security Review Skill (~3179 tok)

## everything-claude-code/.agents/skills/security-review/agents/

- `openai.yaml` (~81 tok)

## everything-claude-code/.agents/skills/strategic-compact/

- `SKILL.md` — Strategic Compact Skill (~1022 tok)

## everything-claude-code/.agents/skills/strategic-compact/agents/

- `openai.yaml` (~80 tok)

## everything-claude-code/.agents/skills/tdd-workflow/

- `SKILL.md` — Test-Driven Development Workflow (~2514 tok)

## everything-claude-code/.agents/skills/tdd-workflow/agents/

- `openai.yaml` (~79 tok)

## everything-claude-code/.agents/skills/verification-loop/

- `SKILL.md` — Verification Loop Skill (~651 tok)

## everything-claude-code/.agents/skills/verification-loop/agents/

- `openai.yaml` (~82 tok)

## everything-claude-code/.agents/skills/video-editing/

- `SKILL.md` — Video Editing (~2493 tok)

## everything-claude-code/.agents/skills/video-editing/agents/

- `openai.yaml` (~75 tok)

## everything-claude-code/.agents/skills/x-api/

- `SKILL.md` — X API (~1666 tok)

## everything-claude-code/.agents/skills/x-api/agents/

- `openai.yaml` (~75 tok)

## everything-claude-code/.claude-plugin/

- `marketplace.json` (~373 tok)
- `PLUGIN_SCHEMA_NOTES.md` — Plugin Manifest Schema Notes (~1435 tok)
- `plugin.json` (~224 tok)
- `README.md` — Project documentation (~324 tok)

## everything-claude-code/.claude/

- `ecc-tools.json` (~2986 tok)
- `identity.json` (~86 tok)
- `package-manager.json` (~21 tok)

## everything-claude-code/.claude/commands/

- `add-language-rules.md` — /add-language-rules (~308 tok)
- `database-migration.md` — /database-migration (~232 tok)
- `feature-development.md` — /feature-development (~239 tok)

## everything-claude-code/.claude/enterprise/

- `controls.md` — Enterprise Controls (~136 tok)

## everything-claude-code/.claude/homunculus/instincts/inherited/

- `everything-claude-code-instincts.yaml` — Curated instincts for affaan-m/everything-claude-code (~1406 tok)

## everything-claude-code/.claude/research/

- `everything-claude-code-research-playbook.md` — Everything Claude Code Research Playbook (~157 tok)

## everything-claude-code/.claude/rules/

- `everything-claude-code-guardrails.md` — Everything Claude Code Guardrails (~296 tok)
- `node.md` — Node.js Rules for everything-claude-code (~539 tok)

## everything-claude-code/.claude/skills/everything-claude-code/

- `SKILL.md` — Everything Claude Code Conventions (~2904 tok)

## everything-claude-code/.claude/team/

- `everything-claude-code-team-config.json` (~122 tok)

## everything-claude-code/.codebuddy/

- `install.js` — ECC CodeBuddy Installer (Cross-platform Node.js version) (~2556 tok)
- `install.sh` — ECC CodeBuddy Installer (~2050 tok)
- `README.md` — Project documentation (~833 tok)
- `README.zh-CN.md` — Everything Claude Code for CodeBuddy (~496 tok)
- `uninstall.js` — ECC CodeBuddy Uninstaller (Cross-platform Node.js version) (~2406 tok)
- `uninstall.sh` — ECC CodeBuddy Uninstaller (~1676 tok)

## everything-claude-code/.codex-plugin/

- `plugin.json` (~471 tok)
- `README.md` — Project documentation (~469 tok)

## everything-claude-code/.codex/

- `AGENTS.md` — ECC for Codex CLI (~1268 tok)
- `config.toml` — :schema https://developers.openai.com/codex/config-schema.json (~1121 tok)

## everything-claude-code/.codex/agents/

- `docs-researcher.toml` (~93 tok)
- `explorer.toml` (~92 tok)
- `reviewer.toml` (~87 tok)

## everything-claude-code/.cursor/

- `hooks.json` (~1018 tok)

## everything-claude-code/.cursor/hooks/

- `adapter.js` — Cursor-to-Claude Code Hook Adapter (~747 tok)
- `after-file-edit.js` — Declares input (~226 tok)
- `after-mcp-execution.js` — Declares input (~134 tok)
- `after-shell-execution.js` — Declares input (~311 tok)
- `after-tab-file-edit.js` — Declares input (~130 tok)
- `before-mcp-execution.js` — Declares input (~117 tok)
- `before-read-file.js` — Declares input (~144 tok)
- `before-shell-execution.js` — Declares input (~498 tok)
- `before-submit-prompt.js` — Declares input (~262 tok)
- `before-tab-file-read.js` — Declares input (~132 tok)
- `pre-compact.js` — Declares claudeInput (~89 tok)
- `session-end.js` — Declares input (~126 tok)
- `session-start.js` — Declares input (~124 tok)
- `stop.js` — Declares input (~244 tok)
- `subagent-start.js` — Declares input (~96 tok)
- `subagent-stop.js` — Declares input (~96 tok)

## everything-claude-code/.cursor/rules/

- `common-agents.md` — Agent Orchestration (~418 tok)
- `common-coding-style.md` — Coding Style (~393 tok)
- `common-development-workflow.md` — Development Workflow (~268 tok)
- `common-git-workflow.md` — Git Workflow (~179 tok)
- `common-hooks.md` — Hooks System (~229 tok)
- `common-patterns.md` — Common Patterns (~290 tok)
- `common-performance.md` — Performance Optimization (~443 tok)
- `common-security.md` — Security Guidelines (~251 tok)
- `common-testing.md` — Testing Requirements (~227 tok)
- `golang-coding-style.md` — Go Coding Style (~163 tok)
- `golang-hooks.md` — Go Hooks (~116 tok)
- `golang-patterns.md` — Go Patterns (~244 tok)
- `golang-security.md` — Go Security (~159 tok)
- `golang-testing.md` — Go Testing (~133 tok)
- `kotlin-coding-style.md` — Kotlin Coding Style (~264 tok)
- `kotlin-hooks.md` — Kotlin Hooks (~121 tok)
- `kotlin-patterns.md` — Kotlin Patterns (~305 tok)
- `kotlin-security.md` — Kotlin Security (~364 tok)
- `kotlin-testing.md` — Kotlin Testing (~205 tok)
- `php-coding-style.md` — PHP Coding Style (~219 tok)
- `php-hooks.md` — PHP Hooks (~185 tok)
- `php-patterns.md` — PHP Patterns (~216 tok)
- `php-security.md` — PHP Security (~219 tok)
- `php-testing.md` — PHP Testing (~192 tok)
- `python-coding-style.md` — Python Coding Style (~201 tok)
- `python-hooks.md` — Python Hooks (~123 tok)
- `python-patterns.md` — Python Patterns (~228 tok)
- `python-security.md` — Python Security (~151 tok)
- `python-testing.md` — Python Testing (~167 tok)
- `swift-coding-style.md` — Swift Coding Style (~362 tok)
- `swift-hooks.md` — Swift Hooks (~144 tok)
- `swift-patterns.md` — Swift Patterns (~410 tok)
- `swift-security.md` — Swift Security (~275 tok)
- `swift-testing.md` — Swift Testing (~275 tok)
- `typescript-coding-style.md` — TypeScript/JavaScript Coding Style (~313 tok)
- `typescript-hooks.md` — TypeScript/JavaScript Hooks (~157 tok)
- `typescript-patterns.md` — TypeScript/JavaScript Patterns (~282 tok)
- `typescript-security.md` — TypeScript/JavaScript Security (~156 tok)
- `typescript-testing.md` — TypeScript/JavaScript Testing (~110 tok)

## everything-claude-code/.cursor/skills/article-writing/

- `SKILL.md` — Article Writing (~807 tok)

## everything-claude-code/.cursor/skills/bun-runtime/

- `SKILL.md` — Bun Runtime (~670 tok)

## everything-claude-code/.cursor/skills/content-engine/

- `SKILL.md` — Content Engine (~665 tok)

## everything-claude-code/.cursor/skills/documentation-lookup/

- `SKILL.md` — Documentation Lookup (Context7) (~1248 tok)

## everything-claude-code/.cursor/skills/frontend-slides/

- `SKILL.md` — Frontend Slides (~1686 tok)
- `STYLE_PRESETS.md` — Style Presets Reference (~2369 tok)

## everything-claude-code/.cursor/skills/investor-materials/

- `SKILL.md` — Investor Materials (~705 tok)

## everything-claude-code/.cursor/skills/investor-outreach/

- `SKILL.md` — Investor Outreach (~554 tok)

## everything-claude-code/.cursor/skills/market-research/

- `SKILL.md` — Market Research (~576 tok)

## everything-claude-code/.cursor/skills/mcp-server-patterns/

- `SKILL.md` — MCP Server Patterns (~982 tok)

## everything-claude-code/.cursor/skills/nextjs-turbopack/

- `SKILL.md` — Next.js and Turbopack (~551 tok)

## everything-claude-code/.gemini/

- `GEMINI.md` — ECC for Gemini CLI (~457 tok)

## everything-claude-code/.github/

- `dependabot.yml` (~126 tok)
- `FUNDING.yml` (~14 tok)
- `PULL_REQUEST_TEMPLATE.md` — What Changed (~272 tok)
- `release.yml` (~108 tok)

## everything-claude-code/.github/ISSUE_TEMPLATE/

- `copilot-task.md` — Task Description (~88 tok)

## everything-claude-code/.github/workflows/

- `ci.yml` — CI: CI (~2441 tok)
- `maintenance.yml` — CI: Scheduled Maintenance (~435 tok)
- `monthly-metrics.yml` — CI: Monthly Metrics Snapshot (~2002 tok)
- `release.yml` — CI: Release (~1137 tok)
- `reusable-release.yml` — CI: Reusable Release Workflow (~1231 tok)
- `reusable-test.yml` — CI: Reusable Test Workflow (~1627 tok)
- `reusable-validate.yml` — CI: Reusable Validation Workflow (~404 tok)

## everything-claude-code/.kiro/

- `install.sh` — ECC Kiro Installer (~1274 tok)
- `README.md` — Project documentation (~6902 tok)

## everything-claude-code/.kiro/agents/

- `architect.json` — Declares safety (~1902 tok)
- `architect.md` — Your Role (~1623 tok)
- `build-error-resolver.json` — Declares errors (~1144 tok)
- `build-error-resolver.md` — Build Error Resolver (~958 tok)
- `chief-of-staff.json` (~1681 tok)
- `chief-of-staff.md` — Your Role (~1425 tok)
- `code-reviewer.json` — query: processUsers, processUsers (~2610 tok)
- `code-reviewer.md` — Review Process (~2241 tok)
- `database-reviewer.json` (~1298 tok)
- `database-reviewer.md` — Database Reviewer (~1093 tok)
- `doc-updater.json` — /*.ts                # Extract JSDoc\n```\n\n## Codemap Workflow\n\n### 1. Analyze Repository\n- Identify workspaces/packages\n- Map directory stru... (~1018 tok)
- `doc-updater.md` — Documentation & Codemap Specialist (~848 tok)
- `e2e-runner.json` (~1241 tok)
- `e2e-runner.md` — E2E Test Runner (~1042 tok)
- `go-build-resolver.json` — Declares errors (~1004 tok)
- `go-build-resolver.md` — Go Build Error Resolver (~834 tok)
- `go-reviewer.json` (~861 tok)
- `go-reviewer.md` — Review Priorities (~711 tok)
- `harness-optimizer.json` (~307 tok)
- `harness-optimizer.md` — Mission (~228 tok)
- `loop-operator.json` (~309 tok)
- `loop-operator.md` — Mission (~229 tok)
- `planner.json` — Declares names (~2116 tok)
- `planner.md` — Your Role (~1811 tok)
- `python-reviewer.json` — Declares hints (~1034 tok)
- `python-reviewer.md` — Review Priorities (~863 tok)
- `refactor-cleaner.json` (~840 tok)
- `refactor-cleaner.md` — Refactor & Dead Code Cleaner (~692 tok)
- `security-reviewer.json` (~1336 tok)
- `security-reviewer.md` — Security Reviewer (~1128 tok)
- `tdd-guide.json` (~894 tok)
- `tdd-guide.md` — Your Role (~740 tok)

## everything-claude-code/.kiro/docs/

- `longform-guide.md` — Agentic Workflows: A Deep Dive (~2665 tok)
- `security-guide.md` — Security Guide for Agentic Workflows (~3617 tok)
- `shortform-guide.md` — Quick Reference Guide (~2384 tok)

## everything-claude-code/.kiro/hooks/

- `auto-format.kiro.hook` (~124 tok)
- `code-review-on-write.kiro.hook` (~155 tok)
- `console-log-check.kiro.hook` (~146 tok)
- `doc-file-warning.kiro.hook` (~222 tok)
- `extract-patterns.kiro.hook` (~267 tok)
- `git-push-review.kiro.hook` (~161 tok)
- `quality-gate.kiro.hook` — Declares check (~94 tok)
- `README.md` — Project documentation (~598 tok)
- `session-summary.kiro.hook` (~130 tok)
- `tdd-reminder.kiro.hook` (~140 tok)
- `typecheck-on-edit.kiro.hook` — Declares checking (~125 tok)

## everything-claude-code/.kiro/scripts/

- `format.sh` — ───────────────────────────────────────────────────────────── (~541 tok)
- `quality-gate.sh` — ───────────────────────────────────────────────────────────── (~1032 tok)

## everything-claude-code/.kiro/settings/

- `mcp.json.example` (~279 tok)

## everything-claude-code/.kiro/skills/agentic-engineering/

- `SKILL.md` — Agentic Engineering (~1020 tok)

## everything-claude-code/.kiro/skills/api-design/

- `SKILL.md` — API Design Patterns (~3406 tok)

## everything-claude-code/.kiro/skills/backend-patterns/

- `SKILL.md` — Backend Development Patterns (~3613 tok)

## everything-claude-code/.kiro/skills/coding-standards/

- `SKILL.md` — Coding Standards & Best Practices (~3062 tok)

## everything-claude-code/.kiro/skills/database-migrations/

- `SKILL.md` — Database Migration Patterns (~2526 tok)

## everything-claude-code/.kiro/skills/deployment-patterns/

- `SKILL.md` — Deployment Patterns (~2927 tok)

## everything-claude-code/.kiro/skills/docker-patterns/

- `SKILL.md` — Docker Patterns (~2244 tok)

## everything-claude-code/.kiro/skills/e2e-testing/

- `SKILL.md` — E2E Testing Patterns (~2071 tok)

## everything-claude-code/.kiro/skills/frontend-patterns/

- `SKILL.md` — Frontend Development Patterns (~3859 tok)

## everything-claude-code/.kiro/skills/golang-patterns/

- `SKILL.md` — Go Patterns (~1190 tok)

## everything-claude-code/.kiro/skills/golang-testing/

- `SKILL.md` — Go Testing (~1703 tok)

## everything-claude-code/.kiro/skills/postgres-patterns/

- `SKILL.md` — PostgreSQL Patterns (~1083 tok)

## everything-claude-code/.kiro/skills/python-patterns/

- `SKILL.md` — Python Patterns (~2440 tok)

## everything-claude-code/.kiro/skills/python-testing/

- `SKILL.md` — Python Testing (~2809 tok)

## everything-claude-code/.kiro/skills/search-first/

- `SKILL.md` — /search-first — Research Before You Code (~1536 tok)

## everything-claude-code/.kiro/skills/security-review/

- `SKILL.md` — Security Review Skill (~3187 tok)

## everything-claude-code/.kiro/skills/tdd-workflow/

- `SKILL.md` — Test-Driven Development Workflow (~2527 tok)

## everything-claude-code/.kiro/skills/verification-loop/

- `SKILL.md` — Verification Loop Skill (~655 tok)

## everything-claude-code/.kiro/steering/

- `coding-style.md` — Coding Style (~400 tok)
- `dev-mode.md` — Development Mode (~286 tok)
- `development-workflow.md` — Development Workflow (~274 tok)
- `git-workflow.md` — Git Workflow (~185 tok)
- `golang-patterns.md` — Go Patterns (~253 tok)
- `lessons-learned.md` — Lessons Learned (~834 tok)
- `patterns.md` — Common Patterns (~300 tok)
- `performance.md` — Performance Optimization (~380 tok)
- `python-patterns.md` — Python Patterns (~227 tok)
- `research-mode.md` — Research Mode (~433 tok)
- `review-mode.md` — Review Mode (~403 tok)
- `security.md` — Security Guidelines (~260 tok)
- `swift-patterns.md` — Swift Patterns (~425 tok)
- `testing.md` — Testing Requirements (~230 tok)
- `typescript-patterns.md` — TypeScript/JavaScript Patterns (~281 tok)
- `typescript-security.md` — TypeScript/JavaScript Security (~571 tok)

## everything-claude-code/.opencode/

- `.npmignore` (~7 tok)
- `index.ts` — Everything Claude Code (ECC) Plugin for OpenCode (~590 tok)
- `MIGRATION.md` — Migration Guide: Claude Code to OpenCode (~2885 tok)
- `opencode.json` — Declares errors (~4620 tok)
- `package-lock.json` — npm lock file (~1619 tok)
- `package.json` — Node.js package manifest (~465 tok)
- `README.md` — Project documentation (~1444 tok)
- `tsconfig.json` — TypeScript configuration (~181 tok)

## everything-claude-code/.opencode/commands/

- `build-fix.md` — Build Fix Command (~421 tok)
- `checkpoint.md` — Checkpoint Command (~357 tok)
- `code-review.md` — Code Review Command (~413 tok)
- `e2e.md` — E2E Command (~594 tok)
- `eval.md` — Eval Command (~443 tok)
- `evolve.md` — Evolve Command (~253 tok)
- `go-build.md` — Go Build Command (~423 tok)
- `go-review.md` — Go Review Command (~466 tok)
- `go-test.md` — Go Test Command (~661 tok)
- `harness-audit.md` — Harness Audit Command (~598 tok)
- `instinct-export.md` — Instinct Export Command (~396 tok)
- `instinct-import.md` — Instinct Import Command (~405 tok)
- `instinct-status.md` — Instinct Status Command (~188 tok)
- `learn.md` — Learn Command (~359 tok)
- `loop-start.md` — Loop Start Command (~229 tok)
- `loop-status.md` — Loop Status Command (~120 tok)
- `model-route.md` — Model Route Command (~153 tok)
- `orchestrate.md` — Orchestrate Command (~641 tok)
- `plan.md` — Plan Command (~307 tok)
- `projects.md` — Projects Command (~121 tok)
- `promote.md` — Promote Command (~122 tok)
- `quality-gate.md` — Quality Gate Command (~162 tok)
- `refactor-clean.md` — Refactor Clean Command (~558 tok)
- `rust-build.md` — Rust Build Command (~464 tok)
- `rust-review.md` — Rust Review Command (~483 tok)
- `rust-test.md` — Rust Test Command (~589 tok)
- `security.md` — Security Review Command (~549 tok)
- `setup-pm.md` — Setup Package Manager Command (~403 tok)
- `skill-create.md` — Skill Create Command (~535 tok)
- `tdd.md` — TDD Command (~447 tok)
- `test-coverage.md` — Test Coverage Command (~439 tok)
- `update-codemaps.md` — Update Codemaps Command (~362 tok)
- `update-docs.md` — Update Docs Command (~366 tok)
- `verify.md` — Verify Command (~385 tok)

## everything-claude-code/.opencode/instructions/

- `INSTRUCTIONS.md` — Everything Claude Code - OpenCode Instructions (~2044 tok)

## everything-claude-code/.opencode/plugins/

- `ecc-hooks.ts` — Everything Claude Code (ECC) Plugin Hooks for OpenCode (~5130 tok)
- `index.ts` — Everything Claude Code (ECC) Plugins for OpenCode (~120 tok)

## everything-claude-code/.opencode/plugins/lib/

- `changed-files-store.ts` — Exports ChangeType, initStore, recordChange, getChanges + 5 more (~818 tok)

## everything-claude-code/.opencode/prompts/agents/

- `architect.txt` (~1207 tok)
- `build-error-resolver.txt` — Build Error Resolver (~1463 tok)
- `code-reviewer.txt` — Declares apiKey (~729 tok)
- `cpp-build-resolver.txt` — Declares for (~732 tok)
- `cpp-reviewer.txt` — Declares deduction (~699 tok)
- `database-reviewer.txt` — Database Reviewer (~1829 tok)
- `doc-updater.txt` — Documentation & Codemap Specialist (~1227 tok)
- `docs-lookup.txt` (~717 tok)
- `e2e-runner.txt` — E2E Test Runner (~2094 tok)
- `go-build-resolver.txt` — Go Build Error Resolver (~1663 tok)
- `go-reviewer.txt` — Declares parameters (~1518 tok)
- `harness-optimizer.txt` (~235 tok)
- `java-build-resolver.txt` — Declares Y (~1178 tok)
- `java-reviewer.txt` — Declares usage (~1256 tok)
- `kotlin-build-resolver.txt` — Declares can (~1078 tok)
- `kotlin-reviewer.txt` (~1397 tok)
- `loop-operator.txt` (~305 tok)
- `planner.txt` — Declares names (~765 tok)
- `python-reviewer.txt` — Declares annotations (~771 tok)
- `refactor-cleaner.txt` — Refactor & Dead Code Cleaner (~1559 tok)
- `rust-build-resolver.txt` — Rust Build Error Resolver (~869 tok)
- `rust-reviewer.txt` (~613 tok)
- `security-reviewer.txt` — Security Reviewer (~1434 tok)
- `tdd-guide.txt` — results: searchMarkets (~1415 tok)

## everything-claude-code/.opencode/tools/

- `changed-files.ts` — ToolDefinition: renderTree (~751 tok)
- `check-coverage.ts` — Check Coverage Tool (~1446 tok)
- `format-code.ts` — ECC Custom Tool: Format Code (~672 tok)
- `git-summary.ts` — ECC Custom Tool: Git Summary (~512 tok)
- `index.ts` — ECC Custom Tools for OpenCode (~158 tok)
- `lint-check.ts` — ECC Custom Tool: Lint Check (~769 tok)
- `run-tests.ts` — Run Tests Tool (~1066 tok)
- `security-audit.ts` — Security Audit Tool (~2625 tok)

## everything-claude-code/.trae/

- `install.sh` — ECC Trae Installer (~2019 tok)
- `README.md` — Project documentation (~1395 tok)
- `README.zh-CN.md` — Everything Claude Code for Trae (~811 tok)
- `uninstall.sh` — ECC Trae Uninstaller (~1673 tok)

## everything-claude-code/agents/

- `a11y-architect.md` — Your Role (~1630 tok)
- `architect.md` — Your Role (~1626 tok)
- `build-error-resolver.md` — Build Error Resolver (~964 tok)
- `chief-of-staff.md` — Your Role (~1431 tok)
- `code-architect.md` — Code Architect Agent (~402 tok)
- `code-explorer.md` — Code Explorer Agent (~418 tok)
- `code-reviewer.md` — Review Process (~2246 tok)
- `code-simplifier.md` — Code Simplifier Agent (~331 tok)
- `comment-analyzer.md` — Comment Analyzer Agent (~274 tok)
- `conversation-analyzer.md` — Conversation Analyzer Agent (~375 tok)
- `cpp-build-resolver.md` — C++ Build Error Resolver (~805 tok)
- `cpp-reviewer.md` — Review Priorities (~766 tok)
- `csharp-reviewer.md` — Review Priorities (~1190 tok)
- `dart-build-resolver.md` — Dart/Flutter Build Error Resolver (~1720 tok)
- `database-reviewer.md` — Database Reviewer (~1102 tok)
- `doc-updater.md` — Documentation & Codemap Specialist (~857 tok)
- `docs-lookup.md` — Your Role (~913 tok)
- `e2e-runner.md` — E2E Test Runner (~1049 tok)
- `flutter-reviewer.md` — Your Role (~3571 tok)
- `gan-evaluator.md` — Your Role (~1785 tok)
- `gan-generator.md` — Your Role (~1255 tok)
- `gan-planner.md` — Your Role (~899 tok)
- `go-build-resolver.md` — Go Build Error Resolver (~840 tok)
- `go-reviewer.md` — Review Priorities (~716 tok)
- `harness-optimizer.md` — Mission (~241 tok)
- `healthcare-reviewer.md` — Healthcare Reviewer — Clinical Safety & PHI Compliance (~847 tok)
- `java-build-resolver.md` — Java Build Error Resolver (~1470 tok)
- `java-reviewer.md` — Review Priorities (~1440 tok)
- `kotlin-build-resolver.md` — Kotlin Build Error Resolver (~1086 tok)
- `kotlin-reviewer.md` — Your Role (~1693 tok)
- `loop-operator.md` — Mission (~240 tok)
- `opensource-forker.md` — Open-Source Forker (~1648 tok)
- `opensource-packager.md` — Open-Source Packager (~1798 tok)
- `opensource-sanitizer.md` — Open-Source Sanitizer (~1583 tok)
- `performance-optimizer.md` — Performance Optimizer (~3222 tok)
- `planner.md` — Your Role (~1816 tok)
- `pr-test-analyzer.md` — PR Test Analyzer Agent (~248 tok)
- `python-reviewer.md` — Review Priorities (~868 tok)
- `pytorch-build-resolver.md` — PyTorch Build/Runtime Error Resolver (~1406 tok)
- `refactor-cleaner.md` — Refactor & Dead Code Cleaner (~698 tok)
- `rust-build-resolver.md` — Rust Build Error Resolver (~1504 tok)
- `rust-reviewer.md` — Review Priorities (~1186 tok)
- `security-reviewer.md` — Security Reviewer (~1137 tok)
- `seo-specialist.md` — Audit Priorities (~484 tok)
- `silent-failure-hunter.md` — Silent Failure Hunter Agent (~262 tok)
- `tdd-guide.md` — Your Role (~744 tok)
- `type-design-analyzer.md` — Type Design Analyzer Agent (~235 tok)
- `typescript-reviewer.md` — Review Priorities (~1946 tok)

## everything-claude-code/commands/

- `agent-sort.md` — Agent Sort (Legacy Shim) (~167 tok)
- `aside.md` — Aside Command (~1520 tok)
- `build-fix.md` — Build and Fix (~589 tok)
- `checkpoint.md` — Checkpoint Command (~399 tok)
- `claw.md` — Claw Command (Legacy Shim) (~232 tok)
- `code-review.md` — Code Review (~2074 tok)
- `context-budget.md` — Context Budget Optimizer (Legacy Shim) (~182 tok)
- `cpp-build.md` — C++ Build and Fix (~1047 tok)
- `cpp-review.md` — C++ Code Review (~896 tok)
- `cpp-test.md` — C++ TDD Command (~1526 tok)
- `devfleet.md` — DevFleet (Legacy Shim) (~197 tok)
- `docs.md` — Docs Command (Legacy Shim) (~178 tok)
- `e2e.md` — E2E Command (Legacy Shim) (~1864 tok)
- `eval.md` — Eval Command (Legacy Shim) (~180 tok)
- `evolve.md` — Evolve Command (~1172 tok)
- `feature-dev.md` — Phases (~333 tok)
- `flutter-build.md` — Flutter Build and Fix (~1051 tok)
- `flutter-review.md` — Flutter Code Review (~1013 tok)
- `flutter-test.md` — Flutter Test (~990 tok)
- `gan-build.md` — GAN-Style Harness Build (~804 tok)
- `gan-design.md` — GAN-Style Design Harness (~424 tok)
- `go-build.md` — Go Build and Fix (~990 tok)
- `go-review.md` — Go Code Review (~895 tok)
- `go-test.md` — Go TDD Command (~1469 tok)
- `gradle-build.md` — Gradle Build Fix (~653 tok)
- `harness-audit.md` — Harness Audit Command (~598 tok)
- `hookify-configure.md` — Steps (~101 tok)
- `hookify-help.md` — Hook System Overview (~309 tok)
- `hookify-list.md` — Steps (~127 tok)
- `hookify.md` — Usage (~322 tok)
- `instinct-export.md` — Instinct Export Command (~428 tok)
- `instinct-import.md` — Instinct Import Command (~736 tok)
- `instinct-status.md` — Instinct Status Command (~396 tok)
- `jira.md` — Jira Command (~781 tok)
- `kotlin-build.md` — Kotlin Build and Fix (~1128 tok)
- `kotlin-review.md` — Kotlin Code Review (~941 tok)
- `kotlin-test.md` — Kotlin TDD Command (~1975 tok)
- `learn-eval.md` — /learn-eval - Extract, Evaluate, then Save (~1330 tok)
- `learn.md` — /learn - Extract Reusable Patterns (~419 tok)
- `loop-start.md` — Loop Start Command (~229 tok)
- `loop-status.md` — Loop Status Command (~120 tok)
- `model-route.md` — Model Route Command (~153 tok)
- `multi-backend.md` — Backend - Backend-Focused Development (~1321 tok)
- `multi-execute.md` — Execute - Multi-Model Collaborative Execution (~2717 tok)
- `multi-frontend.md` — Frontend - Frontend-Focused Development (~1337 tok)
- `multi-plan.md` — Plan - Multi-Model Collaborative Planning (~2398 tok)
- `multi-workflow.md` — Workflow - Multi-Model Collaborative Development (~1934 tok)
- `orchestrate.md` — Orchestrate Command (Legacy Shim) (~1045 tok)
- `plan.md` — Plan Command (~994 tok)
- `pm2.md` — PM2 Init (~1711 tok)
- `projects.md` — Projects Command (~223 tok)
- `promote.md` — Promote Command (~326 tok)
- `prompt-optimize.md` — Prompt Optimize (Legacy Shim) (~191 tok)
- `prp-commit.md` — Smart Commit (~784 tok)
- `prp-implement.md` — PRP Implement (~2320 tok)

## lib/

- `config.ts` — ─── Schemas ──────────────────────────────────────────────────────────────── (~1311 tok)

## lib/db/

- `ai-usage.test.ts` — Declares mockUsage (~681 tok)
- `ai-usage.ts` — Exports recordAiUsage, listAiUsageByBusiness (~276 tok)
- `businesses.ts` — Exports getBusinessById, getBusinessByOwner, createBusiness, updateBusiness + 2 more (~763 tok)
- `campaigns.ts` — Exports listCampaigns, getCampaignById, createCampaign, updateCampaign, softDeleteCampaign (~596 tok)
- `engagement.test.ts` — Declares mockItem (~1110 tok)
- `engagement.ts` — Exports listEngagementItems, createEngagementItem, updateEngagementItem (~536 tok)
- `post-metrics.test.ts` — Declares mockMetrics (~889 tok)
- `post-metrics.ts` — Exports upsertPostMetrics, getPostMetricsByPostId, listStalePostMetrics (~404 tok)
- `posts.test.ts` — Declares mockPost (~2248 tok)
- `posts.ts` — Exports listPostsByCampaign, getPostById, createPosts, updatePost + 5 more (~1300 tok)
- `social-accounts.test.ts` — Declares mockAccount (~1615 tok)
- `social-accounts.ts` — Exports listAllSocialAccounts, listActiveSocialAccounts, getSocialAccountById, createSocialAccount + (~900 tok)
- `trial-state.ts` — Exports getTrialState, getTrialStateForBilling (~359 tok)
- `types.test.ts` — Type-level tests for /lib/db/types.ts. (~4266 tok)
- `types.ts` — TypeScript types for all 9 SŌSH database tables. (~3256 tok)

## lib/db/__test-utils__/

- `mock-client.ts` — Exports createMockClient (~338 tok)

## lib/social/

- `constants.ts` — Exports TOKEN_REFRESH_SKEW_SECONDS, LINKEDIN_REQUIRED_SCOPES, TWITTER_REQUIRED_SCOPES, INSTAGRAM_REQ (~189 tok)
- `errors.ts` — Exports SocialProviderError (~286 tok)
- `index.ts` (~211 tok)
- `mock-provider.ts` — Exports FailureConfig, MockProvider (~1139 tok)
- `postiz-provider.ts` — API routes: GET (1 endpoints) (~3047 tok)
- `registry.ts` — Exports getRegistry, _resetRegistry (~564 tok)
- `types.test.ts` — Declares shapes (~978 tok)
- `types.ts` — Exports SocialProviderErrorCode, OAuthAuthorizeInput, ExchangeCodeInput, TokenSet + 10 more (~1095 tok)
- `vault.ts` — Exports readAccessToken, readRefreshToken, withFreshToken (~977 tok)

## lib/social/__tests__/

- `errors.test.ts` — Declares err (~676 tok)
- `mock-provider.test.ts` — Declares url (~1483 tok)
- `oauth-state.test.ts` — Provide a valid OAUTH_STATE_SECRET for all tests in this file. (~852 tok)
- `postiz-provider.test.ts` — Mock vault and service client to isolate PostizProvider logic (~1902 tok)
- `registry.test.ts` — Top-level mock — controls what config returns for all tests. (~996 tok)
- `vault.test.ts` — Mock the service client lazily to avoid env-var parsing at module load time. (~2441 tok)

## lib/social/oauth/

- `state.ts` — Exports OAuthStateClaims, signOAuthState, verifyOAuthState (~406 tok)

## lib/supabase/

- `client.ts` — browser Supabase client (anon key) (~120 tok)
- `middleware.ts` — Called from middleware.ts on every matched request to keep the session (~532 tok)
- `server.ts` — server Supabase client using @supabase/ssr + cookies (~160 tok)
- `service.ts` — singleton service-role client; ONLY place in codebase that uses SUPABASE_SERVICE_ROLE_KEY (~80 tok)
- `service.ts` — Exports createServiceRoleClient (~138 tok)

## scripts/

- `apply-migrations.ts` — MIGRATIONS_DIR: run (~419 tok)

## supabase/migrations/

- `20260430120014_placeholder.sql` — This migration number was skipped (draft discarded before first apply). (~23 tok)
- `20260430120015_placeholder.sql` — This migration number was skipped (draft discarded before first apply). (~23 tok)
- `20260430120016_fix_post_metrics_engagement_rls.sql` — Migration 016: Drop authenticated write policies from post_metrics and engagement_inbox (~201 tok)
- `20260430120017_fix_rls_function_caching.sql` — Migration 017: Wrap RLS function calls in subqueries for plan-time caching (~1732 tok)
- `20260430120018_fix_publishing_queue_index.sql` — Migration 018: Fix publishing queue index column list (~155 tok)
- `20260430120019_fix_stripe_partial_index.sql` — Migration 019: Replace UNIQUE on stripe_customer_id with a partial unique index (~256 tok)
- `20260430120020_fix_trigger_permissions.sql` — Migration 020: Revoke public execute permission on trigger functions (~114 tok)
- `20260430120021_fix_set_updated_at_search_path.sql` — Migration 021: Lock search_path on set_updated_at() (~142 tok)
- `20260430120022_fix_trial_state_checks.sql` — Migration 022: Add non-negative CHECK constraints to trial_state counters (~143 tok)
- `20260430120023_fix_post_metrics_checks.sql` — Migration 023: Add non-negative CHECK constraints to post_metrics columns (~241 tok)
- `20260504120024_vault_helpers.sql` — Migration 24: vault_helpers (~207 tok)
