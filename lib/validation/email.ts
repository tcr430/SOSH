import { z } from 'zod'

export const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.co.uk', 'hotmail.fr', 'hotmail.es', 'hotmail.pt',
  'outlook.com', 'outlook.fr', 'outlook.es', 'outlook.pt',
  'live.com', 'live.co.uk', 'live.com.pt', 'live.es',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.es', 'yahoo.com.br',
  'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'aim.com',
  'protonmail.com', 'proton.me', 'pm.me',
  'mail.com',
  'gmx.com', 'gmx.de', 'gmx.fr', 'gmx.es',
  'yandex.com', 'yandex.ru',
  'zoho.com',
  'fastmail.com', 'fastmail.fm',
  'tutanota.com', 'tuta.io',
  'hey.com',
  'msn.com',
  'qq.com', '163.com', '126.com', 'sina.com',
  'naver.com',
  'rediffmail.com',
  'web.de',
  'libero.it', 'virgilio.it',
  'laposte.net', 'orange.fr', 'free.fr', 'wanadoo.fr',
  'ig.com.br', 'bol.com.br', 'uol.com.br', 'terra.com.br',
])

export function getEmailDomain(email: string): string {
  const trimmed = email.trim()
  const atIndex = trimmed.lastIndexOf('@')
  if (atIndex === -1) return ''
  return trimmed.slice(atIndex + 1).toLowerCase().trim()
}

export function isWorkEmail(email: string): boolean {
  const domain = getEmailDomain(email)
  if (!domain) return false

  // Require at least one character before the @
  const atIndex = email.trim().lastIndexOf('@')
  if (atIndex === 0) return false

  for (const blocked of FREE_EMAIL_PROVIDERS) {
    if (domain === blocked || domain.endsWith('.' + blocked)) {
      return false
    }
  }

  return true
}

export const workEmailSchema = z
  .string()
  .email({ message: 'errors.email.invalid_format' })
  .refine(isWorkEmail, { message: 'errors.email.work_required' })
