import {
  Body,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components'
import type { EmailLocale } from '../types'

// Stone palette per ADR 0007 §B7 and ADR 0008 §8b
const st = {
  bg: '#FAFAF9',      // stone-50
  border: '#E7E5E4',  // stone-200
  muted: '#78716C',   // stone-500
  text: '#1C1917',    // stone-900
  btnBg: '#1C1917',   // stone-900
  btnText: '#FAFAF9', // stone-50
}

// Dark-mode choice: single dark-on-transparent PNG logo with explicit background-color
// on the outer wrapper. Apple Mail only auto-inverts elements with no declared background,
// so setting background-color: #FAFAF9 on the wrapper prevents inversion without needing
// a dark-mode image swap. Replace LOGO_URL with the actual CDN asset before launch.
const LOGO_URL = 'https://sosh.app/logo.png'

const FOOTER_COPY: Record<EmailLocale, { tagline: string; replyTo: string }> = {
  en: { tagline: 'SŌSH · hello@mail.sosh.app', replyTo: 'Reply to support@sosh.app' },
  pt: { tagline: 'SŌSH · hello@mail.sosh.app', replyTo: 'Responder para support@sosh.app' },
  es: { tagline: 'SŌSH · hello@mail.sosh.app', replyTo: 'Responder a support@sosh.app' },
}

interface EmailLayoutProps {
  locale: EmailLocale
  preheader: string
  children: React.ReactNode
}

export function EmailLayout({ locale, preheader, children }: EmailLayoutProps): React.ReactElement {
  const footer = FOOTER_COPY[locale]
  return (
    <Html lang={locale}>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
      </Head>
      <Preview>{preheader}</Preview>
      <Body
        style={{
          backgroundColor: st.bg,
          color: st.text,
          margin: '0',
          padding: '0',
          fontSize: '16px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Container
          style={{
            backgroundColor: st.bg,
            color: st.text,
            maxWidth: '600px',
            margin: '0 auto',
            padding: '40px 24px',
          }}
        >
          <Section
            style={{
              borderBottom: `1px solid ${st.border}`,
              paddingBottom: '24px',
              marginBottom: '32px',
            }}
          >
            <Img
              src={LOGO_URL}
              alt="SŌSH"
              width={72}
              height={24}
              style={{ display: 'block' }}
            />
          </Section>

          <Section style={{ paddingBottom: '32px' }}>{children}</Section>

          <Section
            style={{
              borderTop: `1px solid ${st.border}`,
              paddingTop: '24px',
            }}
          >
            <Text
              style={{
                fontSize: '14px',
                color: st.muted,
                lineHeight: '1.6',
                margin: '0 0 4px 0',
              }}
            >
              {footer.tagline}
            </Text>
            <Text
              style={{
                fontSize: '14px',
                color: st.muted,
                lineHeight: '1.6',
                margin: '0',
              }}
            >
              <Link
                href="mailto:support@sosh.app"
                style={{ color: st.muted, textDecoration: 'underline' }}
              >
                {footer.replyTo}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

// Exported for consumers that need the button style token (e.g. kind templates)
export const emailCtaStyle: React.CSSProperties = {
  backgroundColor: st.btnBg,
  color: st.btnText,
  fontSize: '14px',
  fontWeight: '500',
  lineHeight: '1',
  padding: '14px 24px',
  borderRadius: '4px',
  textDecoration: 'none',
  display: 'inline-block',
}
