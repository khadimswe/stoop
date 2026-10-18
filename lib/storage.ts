// Where Stoop keeps the files it makes (storyboard frames today, render drafts later), behind one
// small interface so Stoop can leave Vercel (the portability rule): a Vercel Blob adapter and a
// Cloudflare R2 adapter. Callers use getStorage() and never import a vendor SDK themselves.
//   STORAGE_DRIVER=blob (default)  BLOB_READ_WRITE_TOKEN
//   STORAGE_DRIVER=r2              R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
// Objects are public (frames are shown on shared report pages) and live at fixed paths, so the same
// path always holds the same file. Server only: each adapter reads its own keys and never logs them.
//
// The private store (PrivateStorage, below) keeps what Stoop hands fal that no page shows publicly
// (re-encoded brand photos for draft video, uploads later). Nothing there has a public URL: each read
// is a GET URL presigned for an hour (PRESIGN_SECONDS), made fresh for every render plan. The store
// keeps paths, never signed URLs.
//   STORAGE_DRIVER=blob (default)  PRIVATE_BLOB_READ_WRITE_TOKEN (a second Blob store, created as private)
//   STORAGE_DRIVER=r2              the R2 keys above plus R2_REFS_BUCKET (a bucket with no public access)
import { BlobNotFoundError, del as blobDel, head as blobHead, issueSignedToken as blobIssueSignedToken, presignUrl as blobPresignUrl, put as blobPut } from "@vercel/blob";
import { AwsClient } from "aws4fetch";

if (typeof window !== "undefined") {
  throw new Error("lib/storage runs on the server only.");
}

export interface StoredObject {
  path: string;
  /** The public https URL the object is served from. */
  url: string;
}

export interface Storage {
  readonly kind: "blob" | "r2";
  /** Writes (or overwrites) the object at `path` and gives back its public URL. */
  put(path: string, bytes: Uint8Array, contentType: string, options?: { abortSignal?: AbortSignal }): Promise<StoredObject>;
  /** The public URL of a stored object, or null when there is none. */
  url(path: string): Promise<string | null>;
  /** Removes the object; removing a missing one is not an error. */
  delete(path: string): Promise<void>;
}

/** A driver's keys are missing or malformed. The message names the variables, never their values. */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

/** A storage call failed. The message carries the status and the path, never a key or a signature. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** Lowercase segments of letters, digits, dots, dashes and underscores: no "..", no leading slash. */
const PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;
export const MAX_PATH_LENGTH = 200;

export function checkPath(path: string): string {
  if (path.length > MAX_PATH_LENGTH || !PATH.test(path) || path.split("/").some((part) => part === "." || part === "..")) {
    throw new StorageError(`"${path.slice(0, 60)}" is not a storage path (lowercase segments, no "..", at most ${MAX_PATH_LENGTH} characters).`);
  }
  return path;
}

const httpsUrl = (value: string, name: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StorageConfigError(`${name} must be an https URL.`);
  }
  if (url.protocol !== "https:") throw new StorageConfigError(`${name} must be an https URL.`);
  return url.toString().replace(/\/+$/, "");
};

// --- Vercel Blob ---------------------------------------------------------------------------------

/** The three @vercel/blob calls the adapter uses, injectable so tests never reach Vercel. */
export interface BlobSdk {
  put: typeof blobPut;
  head: typeof blobHead;
  del: typeof blobDel;
}

const BLOB_SDK: BlobSdk = { put: blobPut, head: blobHead, del: blobDel };

export function createBlobStorage(options: { token: string; sdk?: BlobSdk }): Storage {
  const token = options.token.trim();
  if (!token) throw new StorageConfigError("BLOB_READ_WRITE_TOKEN is missing.");
  const sdk = options.sdk ?? BLOB_SDK;
  return {
    kind: "blob",
    async put(path, bytes, contentType, options = {}) {
      checkPath(path);
      try {
        // Fixed paths: the same frame always lands at the same URL, so a repeat write overwrites it.
        const result = await sdk.put(path, Buffer.from(bytes), { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true, token, ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}) });
        return { path, url: result.url };
      } catch (error) {
        throw new StorageError(`Vercel Blob could not store ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
    async url(path) {
      checkPath(path);
      try {
        return (await sdk.head(path, { token })).url;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw new StorageError(`Vercel Blob could not look up ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
    async delete(path) {
      checkPath(path);
      try {
        await sdk.del(path, { token });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return;
        throw new StorageError(`Vercel Blob could not delete ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
  };
}

// --- Cloudflare R2 -------------------------------------------------------------------------------

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** The bucket's public base URL (an r2.dev subdomain or a custom domain), https. */
  publicUrl: string;
  fetch?: typeof fetch;
}

/** R2 through its S3 API, each request signed with SigV4 (aws4fetch), path-style on the account endpoint. */
export function createR2Storage(options: R2Options): Storage {
  const accountId = options.accountId.trim();
  const bucket = options.bucket.trim();
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new StorageConfigError("R2_ACCOUNT_ID must be the 32-character Cloudflare account id.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new StorageConfigError("R2_BUCKET must be an R2 bucket name.");
  const publicUrl = httpsUrl(options.publicUrl.trim(), "R2_PUBLIC_URL");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // Region "auto" and service "s3" are what R2's S3 API expects. Retries stay off: a failed write is the caller's to handle.
  const aws = new AwsClient({ accessKeyId: options.accessKeyId.trim(), secretAccessKey: options.secretAccessKey.trim(), service: "s3", region: "auto", retries: 0 });
  const endpoint = (path: string) => `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${checkPath(path)}`;
  const publicOf = (path: string) => `${publicUrl}/${path}`;

  async function send(method: "PUT" | "HEAD" | "DELETE", path: string, init: { body?: Uint8Array; contentType?: string; abortSignal?: AbortSignal } = {}): Promise<Response> {
    const headers: Record<string, string> = init.contentType ? { "content-type": init.contentType } : {};
    // A copy backed by a plain ArrayBuffer, which fetch takes as a body.
    const signed = await aws.sign(endpoint(path), { method, headers, ...(init.body ? { body: new Uint8Array(init.body) } : {}) });
    try {
      return await fetchImpl(signed, init.abortSignal ? { signal: init.abortSignal } : undefined);
    } catch (error) {
      throw new StorageError(`R2 ${method} ${path} failed: ${error instanceof Error ? error.name : "network error"}.`);
    }
  }

  return {
    kind: "r2",
    async put(path, bytes, contentType, options = {}) {
      const response = await send("PUT", path, { body: bytes, contentType, ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}) });
      if (!response.ok) throw new StorageError(`R2 could not store ${path} (HTTP ${response.status}).`);
      return { path, url: publicOf(path) };
    },
    async url(path) {
      const response = await send("HEAD", path);
      if (response.status === 404) return null;
      if (!response.ok) throw new StorageError(`R2 could not look up ${path} (HTTP ${response.status}).`);
      return publicOf(path);
    },
    async delete(path) {
      const response = await send("DELETE", path);
      // S3 answers 204 for a delete, also for a missing key.
      if (!response.ok && response.status !== 404) throw new StorageError(`R2 could not delete ${path} (HTTP ${response.status}).`);
    },
  };
}

// --- The process's storage ------------------------------------------------------------------------

type Env = Readonly<Record<string, string | undefined>>;

export const STORAGE_DRIVERS = ["blob", "r2"] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];

export function storageDriver(env: Env = process.env): StorageDriver {
  const driver = env.STORAGE_DRIVER?.trim().toLowerCase() || "blob";
  if (!(STORAGE_DRIVERS as readonly string[]).includes(driver)) throw new StorageConfigError(`STORAGE_DRIVER must be "blob" or "r2", got "${driver.slice(0, 20)}".`);
  return driver as StorageDriver;
}

/** Builds the adapter STORAGE_DRIVER names, or fails naming every missing key. */
export function storageFromEnv(env: Env = process.env, deps: { fetch?: typeof fetch; blobSdk?: BlobSdk } = {}): Storage {
  const driver = storageDriver(env);
  const value = (name: string) => env[name]?.trim() || "";
  const required = driver === "blob" ? ["BLOB_READ_WRITE_TOKEN"] : ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_URL"];
  const missing = required.filter((name) => !value(name));
  if (missing.length) throw new StorageConfigError(`Storage driver "${driver}" needs ${missing.join(", ")}.`);
  if (driver === "blob") return createBlobStorage({ token: value("BLOB_READ_WRITE_TOKEN"), ...(deps.blobSdk ? { sdk: deps.blobSdk } : {}) });
  return createR2Storage({
    accountId: value("R2_ACCOUNT_ID"),
    accessKeyId: value("R2_ACCESS_KEY_ID"),
    secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    bucket: value("R2_BUCKET"),
    publicUrl: value("R2_PUBLIC_URL"),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

let current: Storage | null = null;

/** The process's storage, built once from the environment. Throws StorageConfigError when its keys are missing. */
export function getStorage(env: Env = process.env): Storage {
  return (current ??= storageFromEnv(env));
}

/** Tests swap in their own storage (null rebuilds from the environment on the next getStorage). */
export function setStorage(storage: Storage | null): void {
  current = storage;
}

// --- Private storage: presigned reads only ------------------------------------------------------

/** How long a presigned read works: one hour, the render plan's expiresAt. */
export const PRESIGN_SECONDS = 60 * 60;

export interface PrivateStorage {
  readonly kind: "blob" | "r2";
  /** Writes (or overwrites) the object at `path`. It gets no public URL. */
  put(path: string, bytes: Uint8Array, contentType: string, options?: { abortSignal?: AbortSignal }): Promise<{ path: string }>;
  exists(path: string): Promise<boolean>;
  /** A GET URL for the object that stops working `seconds` (default PRESIGN_SECONDS) after `now`. */
  presign(path: string, options?: { seconds?: number; now?: number }): Promise<string>;
}

/** The @vercel/blob calls the private adapter uses, injectable so tests never reach Vercel. */
export interface PrivateBlobSdk {
  put: typeof blobPut;
  head: typeof blobHead;
  issueSignedToken: typeof blobIssueSignedToken;
  presignUrl: typeof blobPresignUrl;
}

const PRIVATE_BLOB_SDK: PrivateBlobSdk = { put: blobPut, head: blobHead, issueSignedToken: blobIssueSignedToken, presignUrl: blobPresignUrl };

function presignWindow(options: { seconds?: number; now?: number }): { seconds: number; now: number } {
  const seconds = options.seconds ?? PRESIGN_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > PRESIGN_SECONDS) throw new StorageError(`A presigned read lasts 60 to ${PRESIGN_SECONDS} seconds, not ${seconds}.`);
  return { seconds, now: options.now ?? Date.now() };
}

/**
 * A private Vercel Blob store (created with private access). Reads go through a delegation token
 * scoped to one path and to GET only, issued for the hour, and a URL signed with it
 * (`https://<store>.private.blob.vercel-storage.com/<path>?vercel-blob-delegation=...&vercel-blob-signature=...`).
 */
export function createPrivateBlobStorage(options: { token: string; sdk?: PrivateBlobSdk }): PrivateStorage {
  const token = options.token.trim();
  if (!token) throw new StorageConfigError("PRIVATE_BLOB_READ_WRITE_TOKEN is missing.");
  const sdk = options.sdk ?? PRIVATE_BLOB_SDK;
  return {
    kind: "blob",
    async put(path, bytes, contentType, options = {}) {
      checkPath(path);
      try {
        await sdk.put(path, Buffer.from(bytes), { access: "private", contentType, addRandomSuffix: false, allowOverwrite: true, token, ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}) });
        return { path };
      } catch (error) {
        throw new StorageError(`The private Blob store could not keep ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
    async exists(path) {
      checkPath(path);
      try {
        await sdk.head(path, { token });
        return true;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return false;
        throw new StorageError(`The private Blob store could not look up ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
    async presign(path, options = {}) {
      checkPath(path);
      const { seconds, now } = presignWindow(options);
      const validUntil = now + seconds * 1000;
      try {
        const signed = await sdk.issueSignedToken({ token, pathname: path, operations: ["get"], validUntil });
        const { presignedUrl } = await sdk.presignUrl(signed, { operation: "get", pathname: path, access: "private", validUntil });
        return presignedUrl;
      } catch (error) {
        throw new StorageError(`The private Blob store could not sign a read of ${path}: ${error instanceof Error ? error.name : "error"}.`);
      }
    },
  };
}

export interface PrivateR2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** A bucket with no public access (R2_REFS_BUCKET), never the public one. */
  bucket: string;
  fetch?: typeof fetch;
}

/** SigV4's basic ISO time, "20261103T120000Z". */
const amzDate = (now: number) => new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, "");

/** A private R2 bucket through the S3 API: writes signed in headers, reads presigned in the query (X-Amz-Expires). */
export function createPrivateR2Storage(options: PrivateR2Options): PrivateStorage {
  const accountId = options.accountId.trim();
  const bucket = options.bucket.trim();
  if (!/^[a-f0-9]{32}$/.test(accountId)) throw new StorageConfigError("R2_ACCOUNT_ID must be the 32-character Cloudflare account id.");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new StorageConfigError("R2_REFS_BUCKET must be an R2 bucket name.");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const aws = new AwsClient({ accessKeyId: options.accessKeyId.trim(), secretAccessKey: options.secretAccessKey.trim(), service: "s3", region: "auto", retries: 0 });
  const endpoint = (path: string) => `https://${accountId}.r2.cloudflarestorage.com/${bucket}/${checkPath(path)}`;

  async function send(method: "PUT" | "HEAD", path: string, init: { body?: Uint8Array; contentType?: string; abortSignal?: AbortSignal } = {}): Promise<Response> {
    const headers: Record<string, string> = init.contentType ? { "content-type": init.contentType } : {};
    const signed = await aws.sign(endpoint(path), { method, headers, ...(init.body ? { body: new Uint8Array(init.body) } : {}) });
    try {
      return await fetchImpl(signed, init.abortSignal ? { signal: init.abortSignal } : undefined);
    } catch (error) {
      throw new StorageError(`R2 ${method} ${path} failed: ${error instanceof Error ? error.name : "network error"}.`);
    }
  }

  return {
    kind: "r2",
    async put(path, bytes, contentType, options = {}) {
      const response = await send("PUT", path, { body: bytes, contentType, ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}) });
      if (!response.ok) throw new StorageError(`R2 could not keep ${path} (HTTP ${response.status}).`);
      return { path };
    },
    async exists(path) {
      const response = await send("HEAD", path);
      if (response.status === 404) return false;
      if (!response.ok) throw new StorageError(`R2 could not look up ${path} (HTTP ${response.status}).`);
      return true;
    },
    async presign(path, options = {}) {
      const { seconds, now } = presignWindow(options);
      const url = new URL(endpoint(path));
      url.searchParams.set("X-Amz-Expires", String(seconds));
      const signed = await aws.sign(url.toString(), { method: "GET", aws: { signQuery: true, datetime: amzDate(now) } });
      return signed.url;
    },
  };
}

/** Builds the private adapter for STORAGE_DRIVER, or fails naming every missing key. It never shares the public store. */
export function privateStorageFromEnv(env: Env = process.env, deps: { fetch?: typeof fetch; blobSdk?: PrivateBlobSdk } = {}): PrivateStorage {
  const driver = storageDriver(env);
  const value = (name: string) => env[name]?.trim() || "";
  const required = driver === "blob" ? ["PRIVATE_BLOB_READ_WRITE_TOKEN"] : ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_REFS_BUCKET"];
  const missing = required.filter((name) => !value(name));
  if (missing.length) throw new StorageConfigError(`Private storage for driver "${driver}" needs ${missing.join(", ")}.`);
  if (driver === "blob") {
    if (value("PRIVATE_BLOB_READ_WRITE_TOKEN") === value("BLOB_READ_WRITE_TOKEN")) throw new StorageConfigError("PRIVATE_BLOB_READ_WRITE_TOKEN must belong to a separate private Blob store, not the public one.");
    return createPrivateBlobStorage({ token: value("PRIVATE_BLOB_READ_WRITE_TOKEN"), ...(deps.blobSdk ? { sdk: deps.blobSdk } : {}) });
  }
  if (value("R2_REFS_BUCKET") === value("R2_BUCKET")) throw new StorageConfigError("R2_REFS_BUCKET must be a private bucket, not the public R2_BUCKET.");
  return createPrivateR2Storage({
    accountId: value("R2_ACCOUNT_ID"),
    accessKeyId: value("R2_ACCESS_KEY_ID"),
    secretAccessKey: value("R2_SECRET_ACCESS_KEY"),
    bucket: value("R2_REFS_BUCKET"),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });
}

let currentPrivate: PrivateStorage | null = null;

/** The process's private storage, built once from the environment. Throws StorageConfigError when its keys are missing. */
export function getPrivateStorage(env: Env = process.env): PrivateStorage {
  return (currentPrivate ??= privateStorageFromEnv(env));
}

/** Tests swap in their own private storage (null rebuilds from the environment on the next call). */
export function setPrivateStorage(storage: PrivateStorage | null): void {
  currentPrivate = storage;
}
