import { describe, it, expectTypeOf } from 'vitest'
import type { CalendarPostRow, CalendarPostMetrics } from './types'
import type {
  CalendarPostRow as DbCalendarPostRow,
  CalendarPostMetrics as DbCalendarPostMetrics,
} from '@/lib/db/posts'

// 20D-3 (20C MAJOR-3): CalendarPostRow/CalendarPostMetrics used to be declared
// twice — once here, once independently in lib/db/posts.ts — with no re-export
// linking them, so the two shapes could silently diverge. lib/db/posts.ts now
// re-exports this file's types verbatim; these checks pin that identity down
// at compile time so a future edit to one copy can't drift from the other.
describe('CalendarPostRow / CalendarPostMetrics — single source of truth (lib/calendar/types)', () => {
  it('lib/db/posts re-exports the exact same CalendarPostRow type', () => {
    expectTypeOf<DbCalendarPostRow>().toEqualTypeOf<CalendarPostRow>()
  })

  it('lib/db/posts re-exports the exact same CalendarPostMetrics type', () => {
    expectTypeOf<DbCalendarPostMetrics>().toEqualTypeOf<CalendarPostMetrics>()
  })
})
