import { describe, expect, it } from "vitest";
import { codeUrl, metadataOrigin, siteOrigin } from "./site";

describe("metadataOrigin", () => {
  it("prefers the configured site URL", () => {
    expect(metadataOrigin({ app: "https://stoop.example/", production: "stoop.vercel.app" }).href).toBe("https://stoop.example/");
  });

  it("falls back to the Vercel production domain, then this deployment's, with https", () => {
    expect(metadataOrigin({ production: "stoop.vercel.app", deployment: "stoop-abc.vercel.app" }).href).toBe("https://stoop.vercel.app/");
    expect(metadataOrigin({ deployment: "stoop-abc.vercel.app" }).href).toBe("https://stoop-abc.vercel.app/");
  });

  it("ignores malformed values and ends at localhost for local builds", () => {
    expect(metadataOrigin({ app: "not a url", production: "bad host/path" }).href).toBe("http://localhost:3000/");
    expect(metadataOrigin({}).href).toBe("http://localhost:3000/");
  });
});

describe("siteOrigin and codeUrl", () => {
  it("keeps a clean origin for snippets, and links code on main", () => {
    expect(siteOrigin("https://stoop.example/")).toBe("https://stoop.example");
    expect(siteOrigin(undefined)).toBe("https://stoop.example");
    expect(codeUrl("lib/qloo/client.ts")).toMatch(/\/blob\/main\/lib\/qloo\/client\.ts$/);
  });
});
