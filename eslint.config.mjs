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
]);

export default eslintConfig;
