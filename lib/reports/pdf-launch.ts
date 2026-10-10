import type { PdfBrowser, PdfLauncher } from './pdf'

// ADR 0031 §5.5 — the ONLY place Chromium is launched. The route passes `launchChromium` and nothing else can: the packages
// are imported lazily here so a request that is rejected before this point never loads them (and a module-load failure
// cannot take down an unrelated route). `puppeteer-core` and `@sparticuz/chromium` are the two packages ruling A-3' allows.
//
// `launchChromium` uses the Chromium binary the package bundles (the serverless build). `launcherFor(path)` exists for a
// developer or a script that has a local Chrome; the route never calls it, so no environment variable can redirect a
// production launch to another binary.
//
// UNPROVEN on Vercel's Linux runtime until a preview deploy (ADR 0031 V.3).

async function launchWith(executablePath: string, args: string[]): Promise<PdfBrowser> {
  const puppeteer = await import('puppeteer-core')
  const browser = await puppeteer.default.launch({
    executablePath,
    args,
    headless: true,
    // Nothing is shared with the host profile; every render also gets a fresh browser context (lib/reports/pdf.ts).
    userDataDir: undefined,
  })
  return browser as unknown as PdfBrowser
}

export const launchChromium: PdfLauncher = async () => {
  const chromium = (await import('@sparticuz/chromium')).default
  return launchWith(await chromium.executablePath(), chromium.args)
}

export function launcherFor(executablePath: string): PdfLauncher {
  return () => launchWith(executablePath, ['--no-sandbox'])
}
