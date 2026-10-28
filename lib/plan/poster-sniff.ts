// What kind of image some bytes are, by their first bytes: art that is not really a PNG, JPEG or WebP is
// never drawn on a poster. A plain module, shared by the poster route and the approval reader.

export function sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (String.fromCharCode(b(0), b(1), b(2), b(3)) === "RIFF" && String.fromCharCode(b(8), b(9), b(10), b(11)) === "WEBP") return "image/webp";
  return null;
}
