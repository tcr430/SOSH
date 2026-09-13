import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ADR 0025 §12 (constraints 7 and 37), Session 32 I2.1 — on the
// lib/signals/source-scans.test.ts precedent (ADR 0020 §11.3): boundary
// scans land BEFORE the code they fence, so nothing under lib/backfill/**
// can ever land already violating them. Each scan below was DEMONSTRATED to
// redden (temporarily introduced the forbidden pattern, re-ran, observed
// the failure, reverted) per the I2.1 commit.

const ROOT = process.cwd()
const BACKFILL_DIR = path.join(ROOT, 'lib', 'backfill')

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '__fixtures__', '.next'])

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      collectTsFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

// Strips `//` line comments before pattern-matching — see
// lib/signals/source-scans.test.ts's own comment for why: prose that
// MENTIONS a forbidden term while explaining its absence must not trip the
// scan. CRLF is normalized first (the same Windows-checkout bug that file's
// history already hit).
function stripLineComments(source: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n')
}

// Extracts the body of a named method from a class-bearing TS source file by
// brace-depth counting from the method's opening `{`, or returns null if the
// method is not defined at all. Used to scope BACKFILL-NO-COMMENT-READ's
// second half to fetchRecentPosts's own body — the surrounding provider file
// legitimately implements fetchEngagement elsewhere and must not be banned
// wholesale.
function extractMethodBody(source: string, methodName: string): string | null {
  const sigMatch = source.match(new RegExp(`\\basync\\s+${methodName}\\s*\\(`))
  if (!sigMatch || sigMatch.index === undefined) return null
  const openBraceIdx = source.indexOf('{', sigMatch.index)
  if (openBraceIdx === -1) return null
  let depth = 0
  for (let i = openBraceIdx; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') {
      depth--
      if (depth === 0) return source.slice(openBraceIdx, i + 1)
    }
  }
  return null // unbalanced — treat as not found rather than guess
}

describe('BACKFILL-NO-COMMENT-READ (ADR 0025 §12 constraint 7)', () => {
  const COMMENT_READ_PATTERNS = [
    /\bfetchEngagement\b/,
    /\bliking_users\b/,
    /\bretweeted_by\b/,
    /\bliked_tweets\b/,
    /\bquote_tweets\b/,
    /\/replies\b/,
    /\bconversation_id\b/,
    /\bsocialActions\b/, // LinkedIn comment/reaction path
    /\bcomments\?count=/, // LinkedIn comments endpoint shape
  ]

  it('lib/backfill/** contains no reference to fetchEngagement or a comment/like/repost/quote endpoint', () => {
    const files = collectTsFiles(BACKFILL_DIR)
    expect(files.length, 'lib/backfill/ contributed zero files to the scan').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      if (COMMENT_READ_PATTERNS.some((p) => p.test(source))) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })

  // Until I2.2 lands fetchRecentPosts's real bodies, this asserts the
  // method is either absent (I2.1's state) or, once present, clean of the
  // same patterns — scoped to the METHOD BODY, not the whole provider file,
  // which legitimately implements fetchEngagement (still NOT_IMPLEMENTED)
  // elsewhere in the same class.
  it("no occurrence of the same forbidden terms inside fetchRecentPosts's own body in lib/social/*-provider.ts, when it exists", () => {
    const providerFiles = [
      path.join(ROOT, 'lib', 'social', 'twitter-provider.ts'),
      path.join(ROOT, 'lib', 'social', 'linkedin-provider.ts'),
    ]

    const offenders: string[] = []
    for (const file of providerFiles) {
      expect(fs.existsSync(file), `${path.relative(ROOT, file)} no longer exists`).toBe(true)
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      const body = extractMethodBody(source, 'fetchRecentPosts')
      if (body === null) continue // absent — clean by construction (I2.1's state)
      if (COMMENT_READ_PATTERNS.some((p) => p.test(body))) {
        offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('BACKFILL-NO-URL-FETCH (ADR 0025 §12 constraint 37)', () => {
  it('lib/backfill/** imports no website-fetcher, undici, node-fetch or axios, and calls no fetch(', () => {
    const files = collectTsFiles(BACKFILL_DIR)
    expect(files.length, 'lib/backfill/ contributed zero files to the scan').toBeGreaterThan(0)

    const offenders: string[] = []
    for (const file of files) {
      const source = stripLineComments(fs.readFileSync(file, 'utf8'))
      const bad =
        /from\s+['"][^'"]*website-fetcher['"]/.test(source) ||
        /from\s+['"]undici['"]/.test(source) ||
        /from\s+['"]node-fetch['"]/.test(source) ||
        /from\s+['"]axios['"]/.test(source) ||
        /\bfetch\s*\(/.test(source)
      if (bad) offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'))
    }
    expect(offenders).toEqual([])
  })
})
