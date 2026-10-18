// A live run's product reference for draft video: the brand's own product photo (product-only, as the
// page reader marked it), fetched with the guarded public-URL fetch, re-encoded with sharp so every bit
// of metadata (EXIF, GPS, camera, XMP, ICC) is gone, and kept in private storage at a path fixed by its
// source URL. Each plan presigns it for an hour; the store never holds a signed URL. Never used on AI
// outputs, whose metadata (provenance marks) stays as rendered.
import { guardedFetchImage, type ImageFetch } from "../intake/guarded-fetch";
import { sha256 } from "../hash";
import type { PrivateStorage } from "../storage";
import { PHOTO_ENCODING, RenderError } from "./plan";

if (typeof window !== "undefined") {
  throw new Error("lib/render/photo runs on the server only.");
}

/** Large enough for fal's references, small enough to keep a plan quick. */
export const PHOTO_MAX_SIDE = 2048;
/** Refuses decompression bombs before decoding them (25 MP is about 100 MB decoded). */
export const PHOTO_MAX_PIXELS = 25_000_000;
/** What sharp may decode, by what the bytes are (not what the server claimed): product photo formats only, never SVG, TIFF or PDF. */
export const PHOTO_FORMATS: readonly string[] = ["jpeg", "png", "webp", "gif", "heif"];

/** Where a brand photo's re-encoded copy lives in private storage. */
export const photoPath = (sourceUrl: string) => `refs/photos/${sha256(`${PHOTO_ENCODING}:${sourceUrl}`).slice(0, 40)}.webp`;

/** Re-encodes an image to WebP with no metadata at all, upright (EXIF orientation applied first), at most PHOTO_MAX_SIDE a side. */
export async function reencodePhoto(bytes: Uint8Array): Promise<Uint8Array> {
  const { default: sharp } = await import("sharp");
  const options = { limitInputPixels: PHOTO_MAX_PIXELS, failOn: "error", animated: false } as const;
  // The header alone: sharp reads the format from the bytes, so an SVG served as image/png is caught here.
  const { format } = await sharp(bytes, options).metadata();
  if (!format || !PHOTO_FORMATS.includes(format)) throw new Error(`A ${format ?? "unknown"} file is not a product photo format.`);
  // sharp writes no metadata unless asked (keepMetadata, withMetadata, withExif): none is asked here.
  const out = await sharp(bytes, options)
    .rotate()
    .resize({ width: PHOTO_MAX_SIDE, height: PHOTO_MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();
  return new Uint8Array(out);
}

export interface PhotoDeps {
  storage: PrivateStorage;
  now: number;
  fetchImage?: (url: string) => Promise<ImageFetch>;
}

/** A presigned URL (one hour) for the brand photo's private, re-encoded copy, made on first use. */
export async function privatePhotoUrl(deps: PhotoDeps, sourceUrl: string): Promise<string> {
  const path = photoPath(sourceUrl);
  if (!(await deps.storage.exists(path))) {
    const fetched = await (deps.fetchImage ?? ((url: string) => guardedFetchImage(url)))(sourceUrl);
    if (!fetched.ok) throw new RenderError("failed", `The product photo could not be read: ${fetched.detail}`.slice(0, 300), 502);
    let encoded: Uint8Array;
    try {
      encoded = await reencodePhoto(fetched.bytes);
    } catch {
      throw new RenderError("failed", "The product photo is not an image Stoop can use.", 502);
    }
    await deps.storage.put(path, encoded, "image/webp");
  }
  return deps.storage.presign(path, { now: deps.now });
}
