import { afterEach } from 'vitest'
import { drainCassetteQueue } from '@/lib/ai/__test-utils__/cassette-queue'

// Session 31-D, D8 (MINOR-3). lib/ai/client.ts:38-41,:55-56's
// __evalCassetteQueue is a single GLOBAL FIFO — a test that leaves it
// non-empty poisons whichever test file runs next, since vitest reuses the
// module registry across files in the same worker. H2.3's own consumers
// (generate.test.ts's argmax/tie-break/partial-failure/below-threshold
// cases) ended up going through `vi.mock('@/lib/ai/runner')` /
// `vi.mock('@/lib/ai/generate-native')` instead of the real
// MockAnthropicClient, so drainCassetteQueue()'s loud-failure teardown was
// never wired anywhere except its own test file
// (cassette-queue.test.ts) — the queue itself stayed unguarded for every
// OTHER file that might one day exercise the real client.
//
// This closes that gap globally rather than per-file: every test file gets
// this teardown, so a future test that DOES reach MockAnthropicClient
// (directly, or via any prompt path that isn't wholesale-mocked) throws
// loudly the moment it leaves a cassette unconsumed, instead of silently
// corrupting the next file's fixture routing. A no-op (queue already
// empty/unset) for every file that never touches the queue — which is
// every file today.
afterEach(() => {
  drainCassetteQueue()
})
