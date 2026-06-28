import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const LOCALES = ['en', 'pt', 'es'] as const

function loadLocale(locale: string) {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, `../../i18n/${locale}/common.json`), 'utf-8'),
  ) as { voiceEditor: Record<string, string> }
}

describe('VoiceEditor mobile track — i18n contract (L-13)', () => {
  it.each(LOCALES)(
    'locale %s has tracks_toggle_show and tracks_toggle_hide keys',
    (locale) => {
      const json = loadLocale(locale)
      expect(json.voiceEditor.tracks_toggle_show).toBeTruthy()
      expect(json.voiceEditor.tracks_toggle_hide).toBeTruthy()
    },
  )

  it('toggle keys differ from each other (show ≠ hide)', () => {
    for (const locale of LOCALES) {
      const json = loadLocale(locale)
      expect(json.voiceEditor.tracks_toggle_show).not.toBe(
        json.voiceEditor.tracks_toggle_hide,
      )
    }
  })

  it('all 3 locales have the same set of voiceEditor keys', () => {
    const keysets = LOCALES.map(locale => Object.keys(loadLocale(locale).voiceEditor).sort())
    expect(keysets[1]).toEqual(keysets[0])
    expect(keysets[2]).toEqual(keysets[0])
  })
})
