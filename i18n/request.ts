import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Fall back to default locale if the segment is missing or invalid
  // (e.g. a request to /unknown.txt that slips past the middleware matcher).
  if (!locale || !routing.locales.includes(locale as (typeof routing.locales)[number])) {
    locale = routing.defaultLocale;
  }

  const [common, auth, posts, billing, errors, marketing, calendar] = await Promise.all([
    import(`./${locale}/common.json`),
    import(`./${locale}/auth.json`),
    import(`./${locale}/posts.json`),
    import(`./${locale}/billing.json`),
    import(`./${locale}/errors.json`),
    import(`./${locale}/marketing.json`),
    import(`./${locale}/calendar.json`),
  ])

  return {
    locale,
    messages: {
      ...common.default,
      auth: auth.default,
      posts: posts.default,
      billing: billing.default,
      marketing: marketing.default,
      calendar: calendar.default,
      errors: {
        ...(common.default.errors ?? {}),
        ...errors.default,
      },
    },
  };
});
