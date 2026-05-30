import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Ban direct imports of internal social provider modules from outside /lib/social/.
  // All consumers must import from @/lib/social (the public index).
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["lib/social/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/social/postiz-provider",
                "@/lib/social/mock-provider",
                "@/lib/social/vault",
                "@/lib/social/registry",
                "@/lib/social/errors",
                "@/lib/social/constants",
                "@/lib/social/oauth/*",
              ],
              message:
                "Import from '@/lib/social' instead of internal social provider modules.",
            },
          ],
        },
      ],
    },
   },
    // Ban direct imports of @anthropic-ai/sdk from outside /lib/ai/.
    // All Anthropic SDK calls must go through /lib/ai/runner.ts (ADR 0003 C-2).
    {
      files: ["**/*.ts", "**/*.tsx"],
      ignores: ["lib/ai/**"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@anthropic-ai/sdk", "@anthropic-ai/sdk/*"],
                message:
                  "Import from '@/lib/ai' instead of importing @anthropic-ai/sdk directly. All Anthropic SDK calls must go through /lib/ai/runner.ts (ADR 0003 C-2).",
              },
            ],
          },
        ],
      },
    },
    // Ban direct imports of the stripe npm package from outside /lib/stripe/.
    // All Stripe SDK calls must go through /lib/stripe/.
    // Test files are excluded so they can import stripe for mocking.
    {
      files: ["**/*.ts", "**/*.tsx"],
      ignores: ["lib/stripe/**", "**/*.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: [
              {
                name: "stripe",
                message:
                  "Import from '@/lib/stripe' instead of importing the Stripe SDK directly. All Stripe calls must go through /lib/stripe/.",
              },
            ],
          },
        ],
      },
    },
  ]);

export default eslintConfig;
