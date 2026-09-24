import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0027 §5.7 — AGENCY-FREEZE-SUPERSEDE-ATOMIC, Tier-3 half (Session 34-D D4, BLOCKER-1).
// A brief is approved, or its version advanced, ONLY through approve_/revise_brief_and_supersede_proposals — one
// Postgres function body each, so the brief UPDATE and the supersede of its pending proposals are ONE
// transaction. A PostgREST `.update()` on campaign_briefs that sets status 'approved' or advances `version`
// would bring back the two-statement form (a frozen brief with proposals still `pending`), so no module under
// lib/ or app/ may contain one. Two halves, because a scan that has never failed proves nothing:
//   1. a pure DETECTOR, unit-tested against planted violations (runs in CI forever);
//   2. the detector run over the REAL tree, asserting it scanned a NUMERICALLY non-empty set.
//
// BLIND SPOT, recorded: an update payload built in a variable and passed to `.update(payload)` is not seen —
// the scan reads the literal object at the call. The wrapper-caller pin below closes the other side: only the
// two named production files may call the two wrappers.

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '__fixtures__', '.wolf', '.claude'])

function collectProd(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectProd(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

const rel = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// Every `.from('campaign_briefs')` chain up to its terminating `;` (or the next blank line) that contains an
// `.update(` whose literal sets status 'approved' or a `version` key.
export function findBriefApproveOrVersionWriter(source: string): string[] {
  const hits: string[] = []
  const code = stripComments(source)
  for (const m of code.matchAll(/from\(\s*['"`]campaign_briefs['"`]\s*\)/g)) {
    const chain = code.slice(m.index, m.index + 900).split(/;|\n\s*\n/)[0]
    const update = /\.update\(([\s\S]*?)\)\s*(?:\.|$)/.exec(chain)
    if (!update) continue
    if (/\bstatus\s*:\s*['"`]approved['"`]/.test(update[1])) hits.push("update sets status 'approved'")
    if (/\bversion\s*:/.test(update[1])) hits.push('update advances version')
  }
  return hits
}

describe('AGENCY-FREEZE-SUPERSEDE-ATOMIC — Tier 3: no PostgREST approve/revise writer on campaign_briefs (ADR 0027 §5.7)', () => {
  it('the detector flags a PostgREST approve and a version advance (planted)', () => {
    expect(
      findBriefApproveOrVersionWriter(
        "await client.from('campaign_briefs').update({ status: 'approved', frozen_at: now }).eq('id', id).select()",
      ),
    ).toEqual(["update sets status 'approved'"])
    expect(
      findBriefApproveOrVersionWriter(
        "await client\n  .from('campaign_briefs')\n  .update({ status: 'draft', version: v + 1, content })\n  .eq('id', id)",
      ),
    ).toEqual(['update advances version'])
  })

  it('the detector allows the legitimate writers and ignores comments (planted negatives)', () => {
    expect(findBriefApproveOrVersionWriter("client.from('campaign_briefs').update({ status: 'critiqued', overall_score: 1 }).eq('id', id)")).toEqual([])
    expect(findBriefApproveOrVersionWriter("client.from('campaign_briefs').update({ status: 'generated' }).eq('id', id)")).toEqual([])
    expect(findBriefApproveOrVersionWriter("client.from('campaign_briefs').select('*').eq('id', id)")).toEqual([])
    expect(findBriefApproveOrVersionWriter("// client.from('campaign_briefs').update({ status: 'approved' })")).toEqual([])
  })

  it('no production module under lib/ or app/ issues one, and the scan saw a non-empty tree', () => {
    const files = ['lib', 'app'].flatMap((r) => collectProd(path.join(ROOT, r)))
    expect(files.length, 'the scan saw too few files — it would pass vacuously').toBeGreaterThan(200)
    const dbFile = files.find((f) => rel(f) === 'lib/db/campaign-briefs.ts')
    expect(dbFile, 'lib/db/campaign-briefs.ts not in the scanned set').toBeDefined()

    const offenders: string[] = []
    for (const file of files) {
      const hits = findBriefApproveOrVersionWriter(fs.readFileSync(file, 'utf8'))
      if (hits.length > 0) offenders.push(`${rel(file)}: ${hits.join('; ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('the two RPC wrappers exist, the PostgREST predecessors are gone, and ONLY the named callers call the wrappers', () => {
    const files = ['lib', 'app'].flatMap((r) => collectProd(path.join(ROOT, r)))
    const db = fs.readFileSync(path.join(ROOT, 'lib/db/campaign-briefs.ts'), 'utf8')
    expect(db).toMatch(/export async function approveBriefAndSupersedeProposals\(/)
    expect(db).toMatch(/export async function reviseBriefAndSupersedeProposals\(/)
    expect(db).toContain("'approve_brief_and_supersede_proposals'")
    expect(db).toContain("'revise_brief_and_supersede_proposals'")

    const callersOf = (name: string) =>
      files
        .filter((f) => rel(f) !== 'lib/db/campaign-briefs.ts' && new RegExp(`\\b${name}\\b`).test(stripComments(fs.readFileSync(f, 'utf8'))))
        .map(rel)
    for (const gone of ['approveBrief', 'reviseBrief']) {
      expect(callersOf(gone), `${gone} still referenced`).toEqual([])
      expect(new RegExp(`function ${gone}\\b`).test(db), `${gone} is still defined`).toBe(false)
    }
    expect(callersOf('approveBriefAndSupersedeProposals')).toEqual(['lib/campaigns/brief.ts'])
    expect(callersOf('reviseBriefAndSupersedeProposals')).toEqual(['app/[locale]/(dashboard)/campaigns/[id]/brief/actions.ts'])
  })
})
