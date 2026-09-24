import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { contentFingerprint, withContentFingerprint, claimCheckMatchesContent } from '../claim-fingerprint'
import type { PersistedClaimCheck } from '@/lib/db/types'

// ADR 0027 §4.8 — Session 34-D D7 (MAJOR-3). A claim check is valid only for the exact text its spans index into.
// The fingerprint is a SHA-256 of EXACTLY posts.content — never content plus hashtags — computed in ONE place.

const TEXT = 'We cut churn by 42% in Q3. The rest is plain.'
const CHECKED: PersistedClaimCheck = { status: 'checked', claims: [{ outcome: 'unsupported', span: { start: 0, end: 26 } }] }

describe('contentFingerprint', () => {
  it('is a deterministic SHA-256 hex of the string', () => {
    expect(contentFingerprint(TEXT)).toMatch(/^[0-9a-f]{64}$/)
    expect(contentFingerprint(TEXT)).toBe(contentFingerprint(TEXT))
    // A known SHA-256 vector, so the algorithm cannot drift silently.
    expect(contentFingerprint('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('changes on ANY change to the text — a single character, whitespace, case', () => {
    const base = contentFingerprint(TEXT)
    for (const edited of [TEXT + ' ', TEXT.replace('42', '43'), TEXT.toUpperCase(), ' ' + TEXT, TEXT.slice(0, -1)]) {
      expect(contentFingerprint(edited)).not.toBe(base)
    }
  })

  it('hashes CONTENT ONLY: content plus hashtags is a DIFFERENT fingerprint (the trap the unedited-post test guards)', () => {
    expect(contentFingerprint(`${TEXT} #saas #growth`)).not.toBe(contentFingerprint(TEXT))
  })
})

describe('withContentFingerprint — stamps EVERY variant, not only `checked`', () => {
  it.each([
    ['checked', CHECKED],
    ['no_claims', { status: 'no_claims' } as PersistedClaimCheck],
    ['no_corpus', { status: 'no_corpus' } as PersistedClaimCheck],
  ])('%s carries the fingerprint of the text and keeps everything else', (_label, check) => {
    const stamped = withContentFingerprint(check, TEXT)
    expect(stamped.contentFingerprint).toBe(contentFingerprint(TEXT))
    expect({ ...stamped, contentFingerprint: undefined }).toEqual({ ...check, contentFingerprint: undefined })
  })
})

describe('claimCheckMatchesContent — the one validity rule every reader uses', () => {
  const stamped = withContentFingerprint(CHECKED, TEXT)

  it('is true only for a check that carries a fingerprint AND matches the current text', () => {
    expect(claimCheckMatchesContent(stamped, TEXT)).toBe(true)
  })

  it('is false for an EDITED text, a check with NO fingerprint (K2.9-era), and no check at all — absence is "not checked", never "clean"', () => {
    expect(claimCheckMatchesContent(stamped, TEXT + ' (edited)')).toBe(false)
    expect(claimCheckMatchesContent(CHECKED, TEXT)).toBe(false)
    expect(claimCheckMatchesContent(undefined, TEXT)).toBe(false)
    expect(claimCheckMatchesContent({ ...stamped, contentFingerprint: '' }, TEXT)).toBe(false)
  })
})

describe('ONE hasher — nothing else computes a claim-check fingerprint', () => {
  const ROOT = process.cwd()
  const SKIP = new Set(['node_modules', '.next', '.git', '__fixtures__', '.wolf', '.claude'])
  const collect = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) collect(full, out)
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
    }
    return out
  }
  const files = ['app', 'lib', 'components'].flatMap((r) => collect(path.join(ROOT, r)))
  const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('contentFingerprint is DEFINED in exactly one module, and the scan saw a non-empty tree', () => {
    expect(files.length).toBeGreaterThan(300)
    const definers = files.filter((f) => /export function contentFingerprint\s*\(/.test(strip(fs.readFileSync(f, 'utf8')))).map(rel)
    expect(definers).toEqual(['lib/campaigns/claim-fingerprint.ts'])
  })

  it('the writer (generate.ts) and both readers (lib/db/posts.ts) use the helper, and none of them hashes locally', () => {
    for (const file of ['lib/campaigns/generate.ts', 'lib/db/posts.ts']) {
      const src = strip(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      expect(src, `${file} does not import the helper`).toMatch(/from '@\/lib\/campaigns\/claim-fingerprint'/)
      expect(src, `${file} hashes locally`).not.toMatch(/createHash|crypto\.subtle|sha256/i)
    }
  })

  it('the resolve action never hashes either (it goes through lib/db/posts.ts)', () => {
    const src = strip(fs.readFileSync(path.join(ROOT, 'app/[locale]/(dashboard)/approvals/claim-actions.ts'), 'utf8'))
    expect(src).not.toMatch(/createHash|crypto\.subtle|sha256|contentFingerprint/i)
  })
})
