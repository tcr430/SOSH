import type { VoiceAxes } from '@/lib/validation/voice'

type Band = 'low' | 'neutral' | 'high'

interface BandEntry {
  tone: string | null
  frag: string
}

const BAND_DATA: Record<keyof VoiceAxes, Record<Band, BandEntry>> = {
  formal_casual: {
    low:     { tone: 'professional',   frag: 'formal and polished' },
    neutral: { tone: null,             frag: 'approachable' },
    high:    { tone: 'conversational', frag: 'casual and conversational' },
  },
  expert_peer: {
    low:     { tone: 'authoritative',  frag: 'speaks with authority' },
    neutral: { tone: null,             frag: 'knowledgeable but accessible' },
    high:    { tone: 'collaborative',  frag: 'speaks peer-to-peer' },
  },
  serious_playful: {
    low:     { tone: 'earnest',        frag: 'serious and substantive' },
    neutral: { tone: null,             frag: 'lightly leavened' },
    high:    { tone: 'playful',        frag: 'playful and witty' },
  },
  reserved_warm: {
    low:     { tone: 'measured',       frag: 'reserved and restrained' },
    neutral: { tone: null,             frag: 'cordial' },
    high:    { tone: 'warm',           frag: 'warm and personable' },
  },
  calm_energetic: {
    low:     { tone: 'calm',           frag: 'calm and composed' },
    neutral: { tone: null,             frag: 'steady' },
    high:    { tone: 'energetic',      frag: 'energetic and driving' },
  },
  rational_emotional: {
    low:     { tone: 'analytical',     frag: 'rational and evidence-led' },
    neutral: { tone: null,             frag: 'balanced' },
    high:    { tone: 'evocative',      frag: 'emotionally resonant' },
  },
  exclusive_inclusive: {
    low:     { tone: 'discerning',     frag: 'selective and discerning' },
    neutral: { tone: null,             frag: 'welcoming' },
    high:    { tone: 'inclusive',      frag: 'inclusive and broad' },
  },
}

const AXIS_ORDER: ReadonlyArray<keyof VoiceAxes> = [
  'formal_casual',
  'expert_peer',
  'serious_playful',
  'reserved_warm',
  'calm_energetic',
  'rational_emotional',
  'exclusive_inclusive',
]

function getBand(v: number): Band {
  if (v <= 30) return 'low'
  if (v <= 69) return 'neutral'
  return 'high'
}

function article(s: string): 'a' | 'an' {
  return /^[aeiou]/i.test(s) ? 'an' : 'a'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function vectorToVoiceFields(axes: VoiceAxes): { tone: string[]; descriptor: string } {
  const isAllNeutral = AXIS_ORDER.every(k => getBand(axes[k]) === 'neutral')
  if (isAllNeutral) {
    return { tone: ['balanced'], descriptor: 'A balanced, neutral voice with no strong leanings.' }
  }

  const seenTones = new Set<string>()
  const tone: string[] = []
  for (const key of AXIS_ORDER) {
    const b = getBand(axes[key])
    const entry = BAND_DATA[key][b]
    if (b !== 'neutral' && entry.tone !== null && !seenTones.has(entry.tone)) {
      seenTones.add(entry.tone)
      tone.push(entry.tone)
    }
  }

  const fc = BAND_DATA.formal_casual[getBand(axes.formal_casual)]
  const rw = BAND_DATA.reserved_warm[getBand(axes.reserved_warm)]
  const ep = BAND_DATA.expert_peer[getBand(axes.expert_peer)]
  const ei = BAND_DATA.exclusive_inclusive[getBand(axes.exclusive_inclusive)]
  const sp = BAND_DATA.serious_playful[getBand(axes.serious_playful)]
  const ce = BAND_DATA.calm_energetic[getBand(axes.calm_energetic)]
  const re = BAND_DATA.rational_emotional[getBand(axes.rational_emotional)]

  // Clause 1 — register: formal_casual + reserved_warm
  const art1 = article(fc.frag) === 'an' ? 'An' : 'A'
  const clause1 = `${art1} ${fc.frag} voice, ${rw.frag} in delivery.`

  // Clause 2 — stance + reach: expert_peer + exclusive_inclusive
  const clause2 = `${capitalize(ep.frag)}, reaching ${article(ei.frag)} ${ei.frag} audience.`

  // Clause 3 — energy + emotion: serious_playful + calm_energetic + rational_emotional
  const clause3 = `${capitalize(sp.frag)}, ${ce.frag} in energy; ${re.frag} in argumentation.`

  return { tone, descriptor: `${clause1} ${clause2} ${clause3}` }
}
