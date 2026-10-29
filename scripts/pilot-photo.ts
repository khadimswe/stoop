// Prepares a real photo from the pilot for the landing's "Before and after" slot (lib/marketing/pilot.ts
// BEFORE_AFTER): turns it upright from its camera orientation, fits it to 1600 px on the long side,
// and writes a JPEG at quality 80 with every bit of metadata dropped (EXIF, GPS location, camera and
// time), so a store's whereabouts never ride along in the file.
//
//   npx tsx scripts/pilot-photo.ts <in> public/pilot/before.jpg
//
// Only photos of people who agreed to be shown, and never anyone under 18.
import { stat } from "node:fs/promises";
import sharp from "sharp";

const LONG_SIDE = 1600;
const QUALITY = 80;

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || !/\.jpe?g$/i.test(output)) {
    console.error("Usage: npx tsx scripts/pilot-photo.ts <in> public/pilot/<name>.jpg");
    process.exit(1);
  }
  // sharp keeps no metadata unless asked (no withMetadata call), and rotate() bakes in the orientation first.
  const info = await sharp(input)
    .rotate()
    .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg: true })
    .toFile(output);
  const left = await sharp(output).metadata();
  if (left.exif || left.icc || left.iptc || left.xmp) throw new Error(`${output} still carries metadata; not using it.`);
  const { size } = await stat(output);
  console.log(`${output}: ${info.width} by ${info.height}, ${Math.round(size / 1024)} KB, no metadata.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
