import { describe, it } from 'vitest'

describe.skipIf(!process.env.POSTIZ_INTEGRATION_TEST_ENABLED)(
  'PostizProvider integration',
  () => {
    it.todo('publish to a real Postiz instance')
    it.todo('exchangeOAuthCode with real auth code')
    it.todo('refreshAccessToken with real refresh token')
  },
)
