import sharp from "sharp";
import { describe, expect, it } from "vitest";
import type { ImageFetch } from "../intake/guarded-fetch";
import { PHOTO_MAX_SIDE, photoPath, privatePhotoUrl, reencodePhoto } from "./photo";
import { fakePrivateStorage } from "./testing";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const URL_A = "https://cdn.shop.example/products/sauce.jpg";

/** A JPEG straight off a phone: EXIF with GPS and the camera, XMP, an ICC profile, and rotated by orientation 6. */
async function phonePhoto(width = 40, height = 20): Promise<Uint8Array> {
  const out = await sharp({ create: { width, height, channels: 3, background: "#c04020" } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExifMerge({ IFD0: { Make: "PhoneCo", Model: "Phone 12", Copyright: "Brand" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 44/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "73/1 59/1 0/1" } })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Someone</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>')
    .withIccProfile("p3")
    .toBuffer();
  return new Uint8Array(out);
}

describe("re-encoding a brand photo", () => {
  it("strips every bit of metadata (EXIF, GPS, XMP, ICC) and applies the orientation first", async () => {
    const input = await phonePhoto();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();
    expect(before.orientation).toBe(6);

    const output = await reencodePhoto(input);
    const after = await sharp(output).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    // Orientation 6 is a quarter turn: the 40 x 20 photo comes out upright as 20 x 40.
    expect([after.width, after.height]).toEqual([20, 40]);
    expect(Buffer.from(output).includes(Buffer.from("PhoneCo"))).toBe(false);
  });

  it("shrinks large photos to at most 2048 a side, never enlarges, and refuses what is not an image", async () => {
    const big = new Uint8Array(await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer());
    const meta = await sharp(await reencodePhoto(big)).metadata();
    expect([meta.width, meta.height]).toEqual([PHOTO_MAX_SIDE, 512]);
    await expect(reencodePhoto(new TextEncoder().encode("<html>not an image</html>"))).rejects.toThrow();
  });

  it("decodes product photo formats only, judged by the bytes: never an SVG or a TIFF", async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>');
    await expect(reencodePhoto(svg)).rejects.toThrow(/svg file is not a product photo format/);
    const tiff = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).tiff().toBuffer());
    await expect(reencodePhoto(tiff)).rejects.toThrow(/tiff/);
    const gif = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).gif().toBuffer());
    expect((await sharp(await reencodePhoto(gif)).metadata()).format).toBe("webp");
  });

  it("refuses an image past the pixel limit before decoding it", async () => {
    const huge = new Uint8Array(await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "#fff" } }).jpeg({ quality: 10 }).toBuffer());
    await expect(reencodePhoto(huge)).rejects.toThrow(/pixel limit/i);
  });
});

describe("the private copy", () => {
  const fetcher = (bytes: Uint8Array | null) => {
    const calls: string[] = [];
    const fetchImage = async (url: string): Promise<ImageFetch> => {
      calls.push(url);
      return bytes ? { ok: true, url, finalUrl: url, status: 200, contentType: "image/jpeg", bytes, redirects: 0 } : { ok: false, url, reason: "http-error", detail: "The site answered HTTP 404.", status: 404 };
    };
    return { calls, fetchImage };
  };

  it("is fetched and re-encoded once, then only presigned (for an hour) on every plan", async () => {
    const storage = fakePrivateStorage();
    const { calls, fetchImage } = fetcher(await phonePhoto());
    const first = await privatePhotoUrl({ storage, now: NOW, fetchImage }, URL_A);
    const second = await privatePhotoUrl({ storage, now: NOW + 1000, fetchImage }, URL_A);
    expect(calls).toEqual([URL_A]);
    expect(first).toContain(photoPath(URL_A));
    expect(first).toContain(`vercel-blob-valid-until=${NOW + 3_600_000}`);
    expect(second).toContain(`vercel-blob-valid-until=${NOW + 1000 + 3_600_000}`);
    const kept = storage.objects.get(photoPath(URL_A))!;
    expect((await sharp(kept).metadata()).exif).toBeUndefined();
    expect(photoPath(URL_A)).toMatch(/^refs\/photos\/[0-9a-f]{40}\.webp$/);
    expect(photoPath(URL_A)).not.toBe(photoPath(`${URL_A}?v=2`));
  });

  it("explains a photo that cannot be read or decoded", async () => {
    const storage = fakePrivateStorage();
    await expect(privatePhotoUrl({ storage, now: NOW, fetchImage: fetcher(null).fetchImage }, URL_A)).rejects.toMatchObject({ code: "failed", message: "The product photo could not be read: The site answered HTTP 404." });
    await expect(privatePhotoUrl({ storage, now: NOW, fetchImage: fetcher(new TextEncoder().encode("nope")).fetchImage }, URL_A)).rejects.toMatchObject({ message: "The product photo is not an image Stoop can use." });
    expect(storage.objects.size).toBe(0);
  });
});
