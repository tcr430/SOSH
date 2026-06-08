import type { ZodSchema } from 'zod'
import type { EmailKind, TranslatorFn } from '../types'
import {
  TrialWarningT3PropsSchema,
  trialWarningT3Subject,
  TrialWarningT3Email,
} from './trial-warning-t3'
import {
  TrialWarningT1PropsSchema,
  trialWarningT1Subject,
  TrialWarningT1Email,
} from './trial-warning-t1'
import {
  WelcomeToPlanPropsSchema,
  welcomeToPlanSubject,
  WelcomeToPlanEmail,
} from './welcome-to-plan'
import {
  PaymentFailedCourtesyPropsSchema,
  paymentFailedCourtesySubject,
  PaymentFailedCourtesyEmail,
} from './payment-failed-courtesy'
import {
  FirstPostPublishedPropsSchema,
  firstPostPublishedSubject,
  FirstPostPublishedEmail,
} from './first-post-published'

export interface KindEntry {
  propsSchema: ZodSchema
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subject: (t: TranslatorFn, props: any) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: React.FC<any>
}

export const TEMPLATES: Record<EmailKind, KindEntry> = {
  'trial-warning-t3': {
    propsSchema: TrialWarningT3PropsSchema,
    subject: trialWarningT3Subject,
    Component: TrialWarningT3Email,
  },
  'trial-warning-t1': {
    propsSchema: TrialWarningT1PropsSchema,
    subject: trialWarningT1Subject,
    Component: TrialWarningT1Email,
  },
  'welcome-to-plan': {
    propsSchema: WelcomeToPlanPropsSchema,
    subject: welcomeToPlanSubject,
    Component: WelcomeToPlanEmail,
  },
  'payment-failed-courtesy': {
    propsSchema: PaymentFailedCourtesyPropsSchema,
    subject: paymentFailedCourtesySubject,
    Component: PaymentFailedCourtesyEmail,
  },
  'first-post-published': {
    propsSchema: FirstPostPublishedPropsSchema,
    subject: firstPostPublishedSubject,
    Component: FirstPostPublishedEmail,
  },
} as const
