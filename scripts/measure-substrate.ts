/* eslint-disable @typescript-eslint/no-explicit-any */
// ADR 0030 §11.5 (Session 36 L2.11) — the MEASUREMENT of the memory substrate on SEEDED data. Reported, never COVERED, never a test: it asserts nothing and
// no CI job runs it. It answers only what §11.5 says a seeded fixture can answer; it does NOT (and cannot) say that retrieval is better, that posts are
// better, or that triage is more precise. Run against the LOCAL stack only:
//   source <local env> && npx tsx scripts/measure-substrate.ts
// It creates its own businesses, seeds them, measures, and deletes them.

import { Client } from 'pg'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createBiz, createUser, seedRepo, seedCard, recompute, dismissalRows, destroy, type Biz } from '../supabase/__helpers__/dismissal-fixtures'
import { MEMORY_WRITERS } from '@/lib/memory/writers'
import { MEMORY_TASK_BUDGET, retrieveMemoryBundle, retrieveBrandMemory, retrieveEvidenceMemory, retrieveAudienceMemory } from '@/lib/memory'

const url = process.env.DATABASE_URL
if (!url || !/(127\.0\.0\.1|localhost)/.test(url)) throw new Error('measure-substrate: DATABASE_URL must be the LOCAL stack (loopback)')

type Corpus = { name: string; brand: number; evidence: number; audience: number; performance: number }
// Uneven on purpose: the budget only does anything when the types are not equally supplied.
const CORPORA: Corpus[] = [
  { name: 'balanced (5/5/5/5)', brand: 5, evidence: 5, audience: 5, performance: 5 },
  { name: 'audience-heavy (1/1/30/0)', brand: 1, evidence: 1, audience: 30, performance: 0 },
  { name: 'brand-heavy (30/0/0/0)', brand: 30, evidence: 0, audience: 0, performance: 0 },
  { name: 'sparse (0/0/2/0)', brand: 0, evidence: 0, audience: 2, performance: 0 },
  { name: 'evidence-heavy (2/30/2/3)', brand: 2, evidence: 30, audience: 2, performance: 3 },
]

async function seed(pg: Client, biz: Biz, c: Corpus): Promise<void> {
  // Every row is ACTIVE with the default confidence (0.5, above the 0.25 floor): a default 'candidate' status would make a corpus vacuously empty.
  for (let i = 0; i < c.brand; i++) await pg.query(`INSERT INTO public.brand_memory (business_id, source, scope, category, statement, status) VALUES ($1,'manual','brand','positioning',$2,'active')`, [biz.id, `brand fact ${i}`])
  for (let i = 0; i < c.evidence; i++) await pg.query(`INSERT INTO public.evidence_memory (business_id, source, scope, kind, content, status) VALUES ($1,'manual','brand','quote',$2,'active')`, [biz.id, `evidence quote ${i}`])
  for (let i = 0; i < c.audience; i++) await pg.query(`INSERT INTO public.audience_memory (business_id, source, scope, kind, statement, status) VALUES ($1,'manual','brand','problem',$2,'active')`, [biz.id, `audience note ${i}`])
  for (let i = 0; i < c.performance; i++) await pg.query(`INSERT INTO public.performance_memory (business_id, source, scope, dimension, pattern, status, observation_count) VALUES ($1,'manual','brand','topic',$2,'active',9)`, [biz.id, `pattern ${i}`])
}

async function main() {
  const pg = new Client({ connectionString: url })
  await pg.connect()
  const admin: any = createServiceRoleClient()
  const bizIds: string[] = []
  const userIds: string[] = []
  const mk = async (label: string): Promise<Biz> => {
    const u = await createUser(admin, label)
    userIds.push(u.id)
    const b = await createBiz(admin, label, u)
    bizIds.push(b.id)
    return b
  }
  try {
    // 1. registered writers
    const writers = Object.keys(MEMORY_WRITERS)
    console.log(`\n## 1. Registered writers: ${writers.length}\n${writers.map((w) => `- ${w}`).join('\n')}`)

    // 2/3/5. the bundle versus the three per-type reads it replaced, and the donation, on uneven seeded corpora
    console.log('\n## 2. Bundle (task) versus the three per-type reads it replaced (brand, evidence, audience; performance was never read on the brief path)')
    console.log('| corpus | task | budget | old per-type reads (b/e/a = total) | bundle (b/e/a/p = total) | slots donated | donation rate |')
    console.log('|---|---|---|---|---|---|---|')
    for (const c of CORPORA) {
      const biz = await mk(`measure-${c.name.split(' ')[0]}`)
      await seed(pg, biz, c)
      const oldB = (await retrieveBrandMemory(admin, biz.id, {})).length
      const oldE = (await retrieveEvidenceMemory(admin, biz.id, {})).length
      const oldA = (await retrieveAudienceMemory(admin, biz.id, {})).length
      for (const task of ['brief', 'post'] as const) {
        const bundle = await retrieveMemoryBundle(admin, biz.id, { task })
        const n = { b: bundle.count('brand'), e: bundle.count('evidence'), a: bundle.count('audience'), p: bundle.count('performance') }
        const total = n.b + n.e + n.a + n.p
        const budget = MEMORY_TASK_BUDGET[task]
        // DEFINITION (stated, because "donation" has no other definition in the ADR): equal share = budget.total / number of types with a non-zero ceiling;
        // a type that delivers MORE than its equal share is taking slots that under-supplied types could not fill. donated = sum(max(0, delivered - equal share)).
        const active = Object.values(budget.types).filter((t) => t.ceiling > 0).length
        const share = budget.total / active
        const donated = [n.b, n.e, n.a, n.p].reduce((s, v) => s + Math.max(0, v - share), 0)
        console.log(`| ${c.name} | ${task} | ${budget.total} | ${oldB}/${oldE}/${oldA} = ${oldB + oldE + oldA} | ${n.b}/${n.e}/${n.a}/${n.p} = ${total} | ${donated.toFixed(1)} | ${(donated / budget.total).toFixed(2)} |`)
      }
    }

    // 4. dismissal rows per seeded business, through the REAL writer (3 not_relevant dismissals of one source -> one ACTIVE row)
    console.log('\n## 4. Dismissal rows per seeded business (real recompute RPC)')
    const biz = await mk('measure-dismissal')
    const perSource = [3, 3, 2, 1]
    for (let i = 0; i < perSource.length; i++) {
      const repo = await seedRepo(admin, biz, { owner: 'measure', name: `repo-${i}` })
      const cards = await Promise.all(Array.from({ length: perSource[i] }, () => seedCard(admin, biz, repo, { status: 'dismissed', reason: 'not_relevant' })))
      await recompute(admin, cards[0])
    }
    const rows = await dismissalRows(pg, biz.id)
    console.log(`Seeded 4 watched sources with ${perSource.join('/')} not_relevant dismissals each -> ${rows.length} dismissal row(s), ${rows.filter((r) => r.status === 'active').length} ACTIVE, ${rows.filter((r) => r.status !== 'active').length} not active.`)

    // 5. rows per writer on this fixture
    console.log('\n## 3. Rows per writer on THIS fixture (the ephemeral test:db corpora are destroyed by their own suites, so they cannot be counted)')
    const { rows: bySource } = await pg.query(
      `SELECT source, count(*)::int AS n FROM (
         SELECT source FROM public.brand_memory WHERE business_id = ANY($1) UNION ALL
         SELECT source FROM public.evidence_memory WHERE business_id = ANY($1) UNION ALL
         SELECT source FROM public.audience_memory WHERE business_id = ANY($1) UNION ALL
         SELECT source FROM public.performance_memory WHERE business_id = ANY($1)) t GROUP BY source ORDER BY source`,
      [bizIds],
    )
    for (const w of writers) console.log(`- ${w}: ${bySource.find((r: any) => r.source === w)?.n ?? 0}`)
    console.log('(import, interview, distilled and outcome rows come from pipelines that need a backfill run, an interview round, processed signals and collected metrics; they are proven by their own suites and are not seeded here.)')
  } finally {
    await destroy(admin, pg, bizIds, userIds)
    await pg.end()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
