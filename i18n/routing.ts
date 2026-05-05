import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "pt", "es"],
  defaultLocale: "en",
  // Every URL carries the locale prefix (/en/..., /pt/..., /es/...)
  // so there's no ambiguity and canonical URLs are stable.
  localePrefix: "always",
  // Auto-detect locale from Accept-Language header and persist choice
  // in a cookie so returning visitors get their preferred language.
  localeDetection: true,
});

export type Locale = (typeof routing.locales)[number];
