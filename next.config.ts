import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import createMDX from "@next/mdx";
import { withSentryConfig } from "@sentry/nextjs";
import { STATIC_SECURITY_HEADERS } from "./lib/observability/security-headers";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

// ADR 0009 §7: compile-time MDX for legal pages. String-form plugin refs keep
// the config serializable for Turbopack.
const withMDX = createMDX({
  options: {
    remarkPlugins: [["remark-frontmatter"], ["remark-mdx-frontmatter"]],
  },
});

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  // ADR 0031 §5.5 (V.3): the PDF route launches Chromium from these two packages, which cannot be bundled.
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
  // The PDF route reads these at request time (fs, not import), so the file tracer cannot see them: tailwindcss' own
  // stylesheets and app/globals.css for the inlined CSS, and the bundled Chromium archives. UNPROVEN until a preview deploy.
  outputFileTracingIncludes: {
    "/api/analytics/reports/[id]/pdf": [
      "./node_modules/tailwindcss/*.css",
      "./app/globals.css",
      "./node_modules/@sparticuz/chromium/bin/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(withMDX(nextConfig)), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  disableLogger: true,
  automaticVercelMonitors: false,
});
