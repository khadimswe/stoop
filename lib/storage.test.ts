// The storage adapters with their vendors mocked: Vercel Blob through a fake SDK, Cloudflare R2
// through a fake fetch that sees the signed S3 requests. No test reaches a vendor.
import { BlobNotFoundError } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { checkPath, createBlobStorage, createR2Storage, StorageConfigError, StorageError, storageDriver, storageFromEnv, type BlobSdk } from "./storage";

const bytes = new Uint8Array([137, 80, 78, 71]);
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const r2Env = { STORAGE_DRIVER: "r2", R2_ACCOUNT_ID: ACCOUNT, R2_ACCESS_KEY_ID: "test-access", R2_SECRET_ACCESS_KEY: "test-secret", R2_BUCKET: "stoop-frames", R2_PUBLIC_URL: "https://frames.example.com/" };

function fakeBlob() {
  const put = vi.fn(async (pathname: string) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}`, downloadUrl: "", pathname, contentType: "image/png", contentDisposition: "", etag: "" }));
  const head = vi.fn(async (pathname: string) => {
    if (pathname.includes("missing")) throw new BlobNotFoundError();
    return { url: `https://store.public.blob.vercel-storage.com/${pathname}` };
  });
  const del = vi.fn(async () => {});
  return { sdk: { put, head, del } as unknown as BlobSdk, put, head, del };
}

function fakeFetch(status = 200) {
  const requests: Request[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    requests.push(input as Request);
    return new Response(null, { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

describe("storage paths", () => {
  it("takes lowercase segments only, never a traversal or a leading slash", () => {
    expect(checkPath("frames/abc123.png")).toBe("frames/abc123.png");
    for (const bad of ["/frames/a.png", "frames/../secret", "Frames/A.png", "frames//a.png", "frames/a b.png", `frames/${"a".repeat(220)}`]) {
      expect(() => checkPath(bad), bad).toThrow(StorageError);
    }
  });
});

describe("the Vercel Blob adapter", () => {
  it("stores public objects at fixed paths, overwriting, with the content type and the token", async () => {
    const blob = fakeBlob();
    const storage = createBlobStorage({ token: "vercel_blob_rw_test", sdk: blob.sdk });
    const stored = await storage.put("frames/hash.png", bytes, "image/png");
    expect(stored).toEqual({ path: "frames/hash.png", url: "https://store.public.blob.vercel-storage.com/frames/hash.png" });
    const [pathname, body, options] = blob.put.mock.calls[0] as unknown as [string, Buffer, Record<string, unknown>];
    expect(pathname).toBe("frames/hash.png");
    expect([...body]).toEqual([...bytes]);
    expect(options).toMatchObject({ access: "public", contentType: "image/png", addRandomSuffix: false, allowOverwrite: true, token: "vercel_blob_rw_test" });
  });

  it("answers null for a missing object and ignores deleting one", async () => {
    const blob = fakeBlob();
    const storage = createBlobStorage({ token: "vercel_blob_rw_test", sdk: blob.sdk });
    expect(await storage.url("frames/hash.png")).toBe("https://store.public.blob.vercel-storage.com/frames/hash.png");
    expect(await storage.url("frames/missing.png")).toBeNull();
    blob.del.mockRejectedValueOnce(new BlobNotFoundError());
    await expect(storage.delete("frames/missing.png")).resolves.toBeUndefined();
  });

  it("reports a failed write without the token", async () => {
    const blob = fakeBlob();
    blob.put.mockRejectedValueOnce(new Error("token vercel_blob_rw_test rejected"));
    const storage = createBlobStorage({ token: "vercel_blob_rw_test", sdk: blob.sdk });
    const error = (await storage.put("frames/hash.png", bytes, "image/png").catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.message).not.toContain("vercel_blob_rw_test");
  });
});

describe("the Cloudflare R2 adapter", () => {
  it("signs a PUT to the account's S3 endpoint and serves the object from the public URL", async () => {
    const { fetch, requests } = fakeFetch();
    const storage = createR2Storage({ accountId: ACCOUNT, accessKeyId: "test-access", secretAccessKey: "test-secret", bucket: "stoop-frames", publicUrl: "https://frames.example.com/", fetch });
    const stored = await storage.put("frames/hash.png", bytes, "image/png");
    expect(stored.url).toBe("https://frames.example.com/frames/hash.png");
    const [request] = requests;
    expect(request.method).toBe("PUT");
    expect(request.url).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com/stoop-frames/frames/hash.png`);
    expect(request.headers.get("content-type")).toBe("image/png");
    expect(request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request/);
    expect(request.headers.get("authorization")).not.toContain("test-secret");
    expect(new Uint8Array(await request.arrayBuffer())).toEqual(bytes);
  });

  it("looks objects up with HEAD (null when missing) and deletes them", async () => {
    const found = fakeFetch(200);
    const r2 = (fetch: typeof globalThis.fetch) => createR2Storage({ accountId: ACCOUNT, accessKeyId: "a", secretAccessKey: "s", bucket: "stoop-frames", publicUrl: "https://frames.example.com", fetch });
    expect(await r2(found.fetch).url("frames/hash.png")).toBe("https://frames.example.com/frames/hash.png");
    expect(found.requests[0].method).toBe("HEAD");
    const missing = fakeFetch(404);
    expect(await r2(missing.fetch).url("frames/hash.png")).toBeNull();
    const deleted = fakeFetch(204);
    await r2(deleted.fetch).delete("frames/hash.png");
    expect(deleted.requests[0].method).toBe("DELETE");
  });

  it("fails a write R2 refuses, naming the status and never the keys", async () => {
    const { fetch } = fakeFetch(403);
    const storage = createR2Storage({ accountId: ACCOUNT, accessKeyId: "test-access", secretAccessKey: "test-secret", bucket: "stoop-frames", publicUrl: "https://frames.example.com", fetch });
    const error = (await storage.put("frames/hash.png", bytes, "image/png").catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(StorageError);
    expect(error.message).toContain("HTTP 403");
    expect(error.message).not.toMatch(/test-access|test-secret/);
  });

  it("refuses a malformed account, bucket or a public URL that is not https", () => {
    const base = { accountId: ACCOUNT, accessKeyId: "a", secretAccessKey: "s", bucket: "stoop-frames", publicUrl: "https://frames.example.com" };
    expect(() => createR2Storage({ ...base, accountId: "acct" })).toThrow(StorageConfigError);
    expect(() => createR2Storage({ ...base, bucket: "Bad_Bucket" })).toThrow(StorageConfigError);
    expect(() => createR2Storage({ ...base, publicUrl: "http://frames.example.com" })).toThrow(StorageConfigError);
  });
});

describe("choosing the adapter from the environment", () => {
  it("defaults to Vercel Blob and takes r2 when asked", () => {
    expect(storageDriver({})).toBe("blob");
    expect(storageDriver({ STORAGE_DRIVER: " R2 " })).toBe("r2");
    expect(() => storageDriver({ STORAGE_DRIVER: "s3" })).toThrow(StorageConfigError);
    expect(storageFromEnv({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test" }, { blobSdk: fakeBlob().sdk }).kind).toBe("blob");
    expect(storageFromEnv(r2Env, { fetch: fakeFetch().fetch }).kind).toBe("r2");
  });

  it("names every missing key and never prints a value", () => {
    expect(() => storageFromEnv({})).toThrow("Storage driver \"blob\" needs BLOB_READ_WRITE_TOKEN.");
    const { R2_SECRET_ACCESS_KEY: _secret, R2_PUBLIC_URL: _url, ...partial } = r2Env;
    void _secret;
    void _url;
    expect(() => storageFromEnv(partial)).toThrow("Storage driver \"r2\" needs R2_SECRET_ACCESS_KEY, R2_PUBLIC_URL.");
    const error = (() => {
      try {
        storageFromEnv({ ...r2Env, R2_ACCOUNT_ID: "not-an-account" });
      } catch (e) {
        return e as Error;
      }
      return null;
    })();
    expect(error?.message).not.toContain("test-secret");
  });
});
