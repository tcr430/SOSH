import { describe, expect, it } from 'vitest'
import { parseRelease, BODY_MAX_CHARS } from './parse-release'
import releaseValidFixture from './__fixtures__/github/release-valid.json'
import releaseBotFixture from './__fixtures__/github/release-bot.json'
import releaseDraftFixture from './__fixtures__/github/release-draft.json'
import releaseOversizedBodyFixture from './__fixtures__/github/release-oversized-body.json'
import malformedReleaseFixture from './__fixtures__/github/malformed-release.json'
import releaseEditedFixture from './__fixtures__/github/release-edited.json'

// release-valid.json is shared with github-client.test.ts, where it is an
// HTTP-response wrapper ({ status, headers, body: [release] }). This file
// parses a single release object, so it reaches through to `.body[0]`
// rather than duplicating the fixture.
const releaseValid = (releaseValidFixture as { body: unknown[] }).body[0]

describe('parseRelease', () => {
  it('maps every retained field for a valid published release (SIGNAL-NO-CONTRIBUTOR-IDENTITY)', () => {
    const result = parseRelease(releaseValid)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.signal.external_id).toBe('github:release:111111')
    expect(result.signal.title).toBe("v1.2.0 — Faster exports")
    expect(result.signal.body).toBe("## What's new\n\n- Faster CSV export\n- Fixed a timezone bug")
    expect(result.signal.body_truncated).toBe(false)
    expect(result.signal.html_url).toBe('https://github.com/acme/widgets/releases/tag/v1.2.0')
    expect(result.signal.occurred_at).toBe('2026-07-01T12:00:00Z')
    expect(result.signal.is_prerelease).toBe(false)
    expect(result.signal.author_is_bot).toBe(false)

    // Structural absence, not a runtime filter: none of these keys exist on
    // ParsedSignal (Omit<SignalInsert, ...>), so this asserts the produced
    // object never carries them at runtime either, field by field.
    const droppedKeys = [
      'author',
      'author_login',
      'author_id',
      'author_node_id',
      'author_avatar_url',
      'author_html_url',
      'author_association',
      'reactions',
      'assets',
      'mentions_count',
      'tarball_url',
      'zipball_url',
      'repo_id',
      'tag_name',
    ]
    for (const key of droppedKeys) {
      expect(result.signal).not.toHaveProperty(key)
    }
  })

  it('derives author_is_bot true and retains no author identity for a bot-authored release', () => {
    const result = parseRelease(releaseBotFixture)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    expect(result.signal.author_is_bot).toBe(true)
    expect(result.signal).not.toHaveProperty('author')
    expect(result.signal).not.toHaveProperty('author_login')
  })

  it('never ingests a draft release', () => {
    const result = parseRelease(releaseDraftFixture)
    expect(result.status).toBe('skipped_draft')
  })

  it('truncates an oversized body on a multibyte-safe boundary', () => {
    const result = parseRelease(releaseOversizedBodyFixture)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const body = result.signal.body as string
    expect(result.signal.body_truncated).toBe(true)
    expect(body.length).toBeLessThanOrEqual(BODY_MAX_CHARS)
    // The fixture places a surrogate pair straddling the exact 8000-char
    // cut boundary: a naive `.slice(0, 8000)` would end on a lone high
    // surrogate. Assert the actual last code unit is NOT a high surrogate
    // (0xD800-0xDBFF) — the truncation backed off to a complete code point.
    const lastCode = body.charCodeAt(body.length - 1)
    expect(lastCode).toBeLessThan(0xd800)
  })

  it('skips a malformed release without throwing, for the caller to continue', () => {
    const result = parseRelease(malformedReleaseFixture)
    expect(result.status).toBe('malformed')
    if (result.status !== 'malformed') return
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('parses an edited release with the same external_id as its original but different content', () => {
    const original = parseRelease(releaseValid)
    const edited = parseRelease(releaseEditedFixture)
    expect(original.status).toBe('ok')
    expect(edited.status).toBe('ok')
    if (original.status !== 'ok' || edited.status !== 'ok') return

    expect(edited.signal.external_id).toBe(original.signal.external_id)
    expect(edited.signal.body).not.toBe(original.signal.body)
    expect(edited.signal.title).not.toBe(original.signal.title)
  })

  it('never throws on a completely malformed input', () => {
    expect(() => parseRelease({})).not.toThrow()
    expect(() => parseRelease(null)).not.toThrow()
    expect(() => parseRelease('not an object')).not.toThrow()
  })
})
