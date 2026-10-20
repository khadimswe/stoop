import type { MetadataRoute } from "next";

// The landing, the examples, /judges, /mcp and /start are for everyone. A visitor's own report and live
// run, the /byok page and the API are not for search engines: those pages also say noindex themselves
// (their metadata, and /byok's meta tag and X-Robots-Tag header), for crawlers that skip this file.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/report/", "/byok", "/run/", "/api/"],
    },
  };
}
