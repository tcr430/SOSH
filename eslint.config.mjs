import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const TO_ISO_STRING_BAN = {
  property: 'toISOString',
  message:
    "Use toUtcIso() from '@/lib/utils' instead. Raw .toISOString() is banned to prevent local-offset bugs — see CLAUDE.md date rule.",
}

// Shared ban lists — used in the main block and subtracted from per-package overrides.

const SOCIAL_INTERNALS_BAN = {
  group: [
    "@/lib/social/linkedin-provider",
    "@/lib/social/twitter-provider",
    "@/lib/social/mock-provider",
    "@/lib/social/vault",
    "@/lib/social/registry",
    "@/lib/social/errors",
    "@/lib/social/constants",
    "@/lib/social/oauth/*",
  ],
  message:
    "Import from '@/lib/social' instead of internal social provider modules.",
};

const ANTHROPIC_BAN = {
  group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
  message:
    "Import from '@/lib/ai' instead of importing @anthropic-ai/sdk directly. All Anthropic SDK calls must go through /lib/ai/runner.ts (ADR 0003 C-2).",
};

const STRIPE_BAN = {
  name: "stripe",
  message:
    "Import from '@/lib/stripe' instead of importing the Stripe SDK directly. All Stripe calls must go through /lib/stripe/.",
};

const STRIPE_CLIENT_INTERNALS_BAN = {
  group: [
    "@/lib/stripe/products",
    "@/lib/stripe/checkout",
  ],
  allowTypeImports: true,
  message:
    "Do not value-import Stripe internals outside lib/stripe/. Use type-only imports or pass pricing data via Server Actions.",
};

const RESEND_BAN = {
  name: "resend",
  message:
    "Import from '@/lib/email' instead. The Resend SDK is confined to lib/email/resend-provider.ts (ADR 0008 §4).",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Main consolidated block — all four bans on every .ts/.tsx file.
  // Per-package override blocks below subtract exactly one ban each.
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [SOCIAL_INTERNALS_BAN, ANTHROPIC_BAN, STRIPE_CLIENT_INTERNALS_BAN],
          paths: [STRIPE_BAN, RESEND_BAN],
        },
      ],
      "no-restricted-properties": ["error", TO_ISO_STRING_BAN],
    },
  },

  // Exception: test files — toISOString allowed in fixtures and mocks.
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**", "**/__integration__/**", "scripts/**"],
    rules: {
      "no-restricted-properties": "off",
    },
  },

  // Exception: lib/stripe/** + test files that mock Stripe.
  // Preserves the original **/*.test.ts exclusion from the stripe ban so that
  // test files importing stripe for type annotations or mocking are not flagged.
  // The B-01 fixture (app/__test_fixtures__/boundary-probe.ts) does not match
  // **/*.test.ts, so all four bans still fire on that neutral path.
  {
    files: ["lib/stripe/**", "**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [SOCIAL_INTERNALS_BAN, ANTHROPIC_BAN],
          paths: [RESEND_BAN],
        },
      ],
    },
  },

  // Exception: billing Server Action — value-imports checkout functions server-side (S11 D5).
  {
    files: ["app/**/billing/actions.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [SOCIAL_INTERNALS_BAN, ANTHROPIC_BAN],
          paths: [STRIPE_BAN, RESEND_BAN],
        },
      ],
    },
  },

  // Exception: lib/ai/** — @anthropic-ai/sdk allowed.
  {
    files: ["lib/ai/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [SOCIAL_INTERNALS_BAN],
          paths: [STRIPE_BAN, RESEND_BAN],
        },
      ],
    },
  },

  // Exception: lib/social/** — social internal imports allowed.
  {
    files: ["lib/social/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [ANTHROPIC_BAN],
          paths: [STRIPE_BAN, RESEND_BAN],
        },
      ],
    },
  },

  // Exception: lib/email/resend-provider.ts — resend allowed.
  {
    files: ["lib/email/resend-provider.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [SOCIAL_INTERNALS_BAN, ANTHROPIC_BAN, STRIPE_CLIENT_INTERNALS_BAN],
          paths: [STRIPE_BAN],
        },
      ],
    },
  },
]);

export default eslintConfig;
