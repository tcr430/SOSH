import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0027 §5.6/§9.1 — AGENCY-PROPOSAL-DECIDE-VIA-RPC (constraint 29), Tier 3 half (added K2.11). The Tier-1 half
// (supabase/__tests__/plan-proposals-decide-rpc.test.ts) proves on live Postgres that no authenticated UPDATE grant
// exists and that the RPC raises 42501 without the capability. This half closes the same door from the SOURCE side:
// no production TypeScript issues an UPDATE, DELETE or UPSERT against campaign_plan_proposals. A proposal is
// decided ONLY through decide_plan_proposal (and superseded/applied only through the freeze and apply RPCs), so a
// future "quick fix" that writes the status column directly reddens here before it reaches a database.
//
// Scope, stated so nobody mistakes it for more: it bounds ACCIDENTAL regression in the one module allowed to touch
// the table. It cannot see a write routed through a helper outside the scanned roots, or a computed verb.

const ROOT = process.cwd()
const TABLE_FILE = 'lib/db/campaign-plan-proposals.ts'

function stripComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

// Every `.update(` / `.delete(` / `.upsert(` that follows a from('campaign_plan_proposals') in the same chain.
export function findProposalTableMutations(source: string): string[] {
  const clean = stripComments(source)
  const hits: string[] = []
  for (const m of clean.matchAll(/from\(\s*['"]campaign_plan_proposals['"]\s*\)([\s\S]{0,300}?)(?:;|\n\s*\n|$)/g)) {
    const verb = /\.(update|delete|upsert)\s*\(/.exec(m[1])
    if (verb) hits.push(verb[1])
  }
  return hits
}

export function namesProposalTable(source: string): boolean {
  return /['"]campaign_plan_proposals['"]/.test(stripComments(source))
}

function collectProdTs(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '__tests__' || entry.name === '__test-utils__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectProdTs(full))
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('AGENCY-PROPOSAL-DECIDE-VIA-RPC — Tier 3 half (ADR 0027 §5.6, constraint 29)', () => {
  it('the detector flags an update, delete or upsert chained off the table (planted)', () => {
    expect(findProposalTableMutations("await client.from('campaign_plan_proposals').update({ status: 'accepted' }).eq('id', id)")).toEqual(['update'])
    expect(findProposalTableMutations("await client\n  .from('campaign_plan_proposals')\n  .delete()\n  .eq('id', id)")).toEqual(['delete'])
    expect(findProposalTableMutations('await client.from("campaign_plan_proposals").upsert(rows)')).toEqual(['upsert'])
  })

  it('the detector ignores reads, inserts, comments and other tables (planted negatives)', () => {
    expect(findProposalTableMutations("await client.from('campaign_plan_proposals').select('*').eq('id', id)")).toEqual([])
    expect(findProposalTableMutations("await client.from('campaign_plan_proposals').insert(rows).select()")).toEqual([])
    expect(findProposalTableMutations("// client.from('campaign_plan_proposals').update({})\nconst x = 1")).toEqual([])
    expect(findProposalTableMutations("await client.from('campaign_briefs').update({ a: 1 })")).toEqual([])
  })

  it('exactly one production module names the table, and it issues no update, delete or upsert against it', () => {
    const files = ['lib', 'app', 'components', 'scripts'].flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? collectProdTs(path.join(ROOT, d)) : []))
    expect(files.length, 'scanned suspiciously few files').toBeGreaterThan(200)

    const naming = files.filter((f) => namesProposalTable(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f).split(path.sep).join('/'))
    expect(naming, 'only the table module may name campaign_plan_proposals; a second module is a second writer').toEqual([TABLE_FILE])

    const source = fs.readFileSync(path.join(ROOT, TABLE_FILE), 'utf8')
    expect(findProposalTableMutations(source)).toEqual([])
  })

  it('anti-stale: the table module still inserts and still decides through the RPC (the allowlist is not empty of meaning)', () => {
    const source = stripComments(fs.readFileSync(path.join(ROOT, TABLE_FILE), 'utf8'))
    expect(source).toMatch(/from\('campaign_plan_proposals'\)\s*\.insert\(/)
    expect(source).toMatch(/rpc\(\s*'decide_plan_proposal'/)
  })
})
