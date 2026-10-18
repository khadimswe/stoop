// The private store (presigned reads) with its vendors mocked: Vercel Blob's signed-token call is
// faked, but the URL is signed by the SDK's real presignUrl; R2 is signed by aws4fetch for real and
// sent nowhere. No test reaches a vendor.
import { BlobNotFoundError, presignUrl } from "@vercel/blob";
import { describe, expect, it, vi } from "vitest";
import { createPrivateBlobStorage, createPrivateR2Storage, PRESIGN_SECONDS, privateStorageFromEnv, StorageConfigError, StorageError, type PrivateBlobSdk } from "./storage";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const PATH = "refs/photos/abc.webp";

/** A delegation token shaped like the Blob API's: a base64url JSON scope, a dot, a store HMAC. */
function delegation(scope: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify(scope)).toString("base64url")}.store-mac`;
}

function fakePrivateBlob() {
  const put = vi.fn(async (pathname: string) => ({ url: `https://store1.private.blob.vercel-storage.com/${pathname}`, downloadUrl: "", pathname, contentType: "image/webp", contentDisposition: "", etag: "" }));
  const head = vi.fn(async (pathname: string) => {
    if (pathname.includes("missing")) throw new BlobNotFoundError();
    return { url: `https://store1.private.blob.vercel-storage.com/${pathname}` };
  });
  const issueSignedToken = vi.fn(async (options: { pathname?: string; operations?: string[]; validUntil?: number }) => ({
    delegationToken: delegation({ storeId: "store1", pathname: options.pathname, operations: options.operations, validUntil: options.validUntil }),
    clientSigningToken: "client-signing-key",
    validUntil: options.validUntil ?? 0,
  }));
  return { sdk: { put, head, issueSignedToken, presignUrl } as unknown as PrivateBlobSdk, put, head, issueSignedToken };
}

describe("the private Blob store", () => {
  it("writes with private access and no random suffix, and checks existence by path", async () => {
    const blob = fakePrivateBlob();
    const storage = createPrivateBlobStorage({ token: "vercel_blob_rw_private", sdk: blob.sdk });
    expect(await storage.put(PATH, new Uint8Array([1, 2]), "image/webp")).toEqual({ path: PATH });
    expect(blob.put).toHaveBeenCalledWith(PATH, expect.any(Buffer), expect.objectContaining({ access: "private", contentType: "image/webp", addRandomSuffix: false, allowOverwrite: true, token: "vercel_blob_rw_private" }));
    expect(await storage.exists(PATH)).toBe(true);
    expect(await storage.exists("refs/missing.webp")).toBe(false);
  });

  it("presigns a GET of one path for exactly one hour, through a token scoped to that path and to reads", async () => {
    const blob = fakePrivateBlob();
    const storage = createPrivateBlobStorage({ token: "vercel_blob_rw_private", sdk: blob.sdk });
    const now = Date.now();
    const url = new URL(await storage.presign(PATH, { now }));
    expect(blob.issueSignedToken).toHaveBeenCalledWith({ token: "vercel_blob_rw_private", pathname: PATH, operations: ["get"], validUntil: now + PRESIGN_SECONDS * 1000 });
    expect(url.origin).toBe("https://store1.private.blob.vercel-storage.com");
    expect(url.pathname).toBe(`/${PATH}`);
    expect(url.searchParams.get("vercel-blob-signature")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const scope = JSON.parse(Buffer.from((url.searchParams.get("vercel-blob-delegation") ?? "").split(".")[0], "base64url").toString());
    expect(scope).toEqual({ storeId: "store1", pathname: PATH, operations: ["get"], validUntil: now + 3_600_000 });
    expect(PRESIGN_SECONDS).toBe(3600);
  });

  it("refuses a read longer than an hour, and reports failures without the token", async () => {
    const blob = fakePrivateBlob();
    const storage = createPrivateBlobStorage({ token: "vercel_blob_rw_private", sdk: blob.sdk });
    await expect(storage.presign(PATH, { seconds: 7200 })).rejects.toThrow(StorageError);
    blob.issueSignedToken.mockRejectedValueOnce(new Error("vercel_blob_rw_private leaked?"));
    const error = await storage.presign(PATH).catch((e: Error) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as Error).message).not.toContain("vercel_blob_rw_private");
  });
});

describe("the private R2 bucket", () => {
  const options = { accountId: ACCOUNT, accessKeyId: "test-access", secretAccessKey: "test-secret", bucket: "stoop-refs" };

  it("presigns a GET in the query with X-Amz-Expires=3600 from the given time", async () => {
    const storage = createPrivateR2Storage({ ...options, fetch: vi.fn() as unknown as typeof fetch });
    const now = Date.parse("2026-11-03T12:00:00Z");
    const url = new URL(await storage.presign(PATH, { now }));
    expect(`${url.origin}${url.pathname}`).toBe(`https://${ACCOUNT}.r2.cloudflarestorage.com/stoop-refs/${PATH}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("3600");
    expect(url.searchParams.get("X-Amz-Date")).toBe("20261103T120000Z");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("test-access/20261103/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.href).not.toContain("test-secret");
  });

  it("writes and checks objects with signed requests", async () => {
    const requests: Request[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      requests.push(input as Request);
      return new Response(null, { status: (input as Request).method === "HEAD" ? 404 : 200 });
    }) as unknown as typeof globalThis.fetch;
    const storage = createPrivateR2Storage({ ...options, fetch });
    expect(await storage.put(PATH, new Uint8Array([1]), "image/webp")).toEqual({ path: PATH });
    expect(await storage.exists(PATH)).toBe(false);
    expect(requests.map((r) => [r.method, r.headers.get("authorization")?.startsWith("AWS4-HMAC-SHA256") ?? false])).toEqual([
      ["PUT", true],
      ["HEAD", true],
    ]);
  });
});

describe("private storage from the environment", () => {
  it("needs its own keys, and never the public store or bucket", () => {
    expect(() => privateStorageFromEnv({})).toThrow(/PRIVATE_BLOB_READ_WRITE_TOKEN/);
    expect(() => privateStorageFromEnv({ PRIVATE_BLOB_READ_WRITE_TOKEN: "same", BLOB_READ_WRITE_TOKEN: "same" })).toThrow(StorageConfigError);
    expect(privateStorageFromEnv({ PRIVATE_BLOB_READ_WRITE_TOKEN: "private", BLOB_READ_WRITE_TOKEN: "public" }).kind).toBe("blob");
    const r2 = { STORAGE_DRIVER: "r2", R2_ACCOUNT_ID: ACCOUNT, R2_ACCESS_KEY_ID: "a", R2_SECRET_ACCESS_KEY: "b", R2_BUCKET: "stoop-frames" };
    expect(() => privateStorageFromEnv(r2)).toThrow(/R2_REFS_BUCKET/);
    expect(() => privateStorageFromEnv({ ...r2, R2_REFS_BUCKET: "stoop-frames" })).toThrow(/private bucket/);
    expect(privateStorageFromEnv({ ...r2, R2_REFS_BUCKET: "stoop-refs" }).kind).toBe("r2");
  });
});
