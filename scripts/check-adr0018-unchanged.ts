// OUTCOME-ADR0018-UNCHANGED (ADR 0026 §12.3, constraint 29) — a recorded Tier-3
// command, NOT part of app-tests: it needs the BASE commit in git history, which a
// shallow CI checkout does not guarantee (a missing BASE would be a false RED, and
// silently skipping it a false GREEN). J2.13 and the Reviewer re-run it.
//
//   npx tsx scripts/check-adr0018-unchanged.ts [base]
//
// Compares the WORKING TREE to BASE (a superset of BASE..HEAD, so an uncommitted
// edit is caught too) for lib/learning/ and the ADR 0018 migrations, and lists any
// untracked file added under them. Exit 0 = untouched, 1 = changed, 2 = could not run.

import { execFileSync } from 'node:child_process'
import {
  ADR0018_BASE_SHA,
  ADR0018_WATCHED_PATHS,
  evaluateAdr0018Diff,
} from '../lib/outcomes/adr0018-guard'

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function main(): number {
  const base = process.argv[2] ?? ADR0018_BASE_SHA
  try {
    git(['cat-file', '-e', `${base}^{commit}`])
  } catch {
    process.stderr.write(`OUTCOME-ADR0018-UNCHANGED: cannot run — commit ${base} is not in this repository's history\n`)
    return 2
  }

  let changed: string[]
  try {
    const tracked = git(['diff', '--name-only', base, '--', ...ADR0018_WATCHED_PATHS]).split('\n')
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...ADR0018_WATCHED_PATHS]).split('\n')
    changed = [...tracked, ...untracked]
  } catch (err) {
    process.stderr.write(`OUTCOME-ADR0018-UNCHANGED: git failed — ${err instanceof Error ? err.message : String(err)}\n`)
    return 2
  }

  const verdict = evaluateAdr0018Diff(changed)
  if (verdict.ok) {
    process.stdout.write(`OUTCOME-ADR0018-UNCHANGED: OK — lib/learning/ and ${ADR0018_WATCHED_PATHS.length - 1} ADR 0018 migrations are identical to ${base.slice(0, 8)}\n`)
    return 0
  }
  process.stderr.write(
    `OUTCOME-ADR0018-UNCHANGED: FAILED — ${verdict.offenders.length} path(s) differ from ${base.slice(0, 8)}. ` +
      'ADR 0018 is untouched by ADR 0026; needing to change one is a STOP, not an edit.\n' +
      verdict.offenders.map((p) => `  ${p}\n`).join(''),
  )
  return 1
}

process.exit(main())
