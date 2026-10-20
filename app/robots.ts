import type { MetadataRoute } from "next";

// Only the API is off limits to crawlers. A visitor's own report, a live run and the /byok page stay
// crawlable on purpose, so crawlers can read their noindex (page metadata, and /byok's meta tag and
// X-Robots-Tag header): a disallowed URL can still be listed, without content, when something links to it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: "/api/",
    },
  };
}
