import { ImageResponse } from 'next/og'
import en from '@/i18n/en/marketing.json'
import pt from '@/i18n/pt/marketing.json'
import es from '@/i18n/es/marketing.json'

export const runtime = 'edge'

// Strings sourced from the i18n marketing namespace (§6.14) — imported
// directly so the Edge handler has no next-intl request-context dependency.
const OG_STRINGS: Record<string, Record<string, string>> = {
  en: en.og,
  pt: pt.og,
  es: es.og,
}

const OG_ROUTES = new Set(['home', 'pricing', 'terms', 'privacy'])

// Stone token literals (satori cannot read CSS variables; values are the hex
// equivalents of app/globals.css tokens — do not invent new colors):
//   --background: oklch(0.985 0.002 75)        → #fafaf9
//   --foreground: oklch(0.145 0.004 75)        → #1c1917
//   --muted-foreground: oklch(0.556 0.005 75)  → #78716c
const BACKGROUND = '#fafaf9'
const FOREGROUND = '#1c1917'
const MUTED_FOREGROUND = '#78716c'

/** Runtime OG image (ADR 0009 §9): 1200×630, Stone palette, editorial type. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
) {
  const { locale } = await params
  const strings = OG_STRINGS[locale] ?? OG_STRINGS.en

  const routeParam = new URL(request.url).searchParams.get('route') ?? 'home'
  const route = OG_ROUTES.has(routeParam) ? routeParam : 'home'
  const line = strings[route]

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          backgroundColor: BACKGROUND,
          padding: 80,
        }}
      >
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: '-0.02em',
            color: FOREGROUND,
          }}
        >
          SŌSH
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 60,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              lineHeight: 1.15,
              color: FOREGROUND,
              maxWidth: 1000,
            }}
          >
            {line}
          </div>
          <div style={{ marginTop: 32, fontSize: 24, color: MUTED_FOREGROUND }}>
            sosh.app
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
