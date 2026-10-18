// Maps a pack's multi-shot prompt onto the images fal actually receives. Packs name their assets by
// filename in Higgsfield's "@name (file.png)" form (lib/prompts/higgsfield.ts), but a draft render only
// has the storyboard frames and one product image, and fal numbers its references @Image1..N in
// image_urls order. So:
//   - the product image is @Image1, then the storyboard frames by shot as @Image2..N
//   - every mention of the product's files (product sheet, packshot, the brand's photos) becomes @Image1
//   - mentions of sheets that were never rendered (talent sheets, location plates) become plain words
//     ("the character", "the location"), so the prompt never points at an image that is not there
//   - a REFERENCES block up top says what each image is
// Pure and deterministic: the same prompt and references always map to the same text, which the render
// cache hashes.

export type ReferenceRole = "product" | "frame";

export interface ReferenceImage {
  role: ReferenceRole;
  /** For a storyboard frame: the index of the scene it shows (shot scene + 1). Null for the product. */
  scene: number | null;
  url: string;
}

export interface MappedReferences {
  prompt: string;
  /** In @Image order. */
  imageUrls: string[];
  /** The images in the same order, with their @Image handle. */
  images: (ReferenceImage & { handle: string })[];
}

type AssetKind = "product" | "talent" | "location" | "other";

const IMAGE_FILE = "[a-z0-9][a-z0-9_]*\\.(?:png|jpe?g|webp)";
/** "@product_sheet (product_sheet.png)": a handle in Higgsfield's syntax, with its filename. */
const HANDLE_WITH_FILE = new RegExp(`@([a-z0-9][a-z0-9_]*) \\((${IMAGE_FILE})\\)`, "g");
/** A bare "@name" left over (any handle but fal's own @ImageN). */
const BARE_HANDLE = /@(?!Image\d+\b)([a-z0-9][a-z0-9_]*)/g;
/** A bare filename of a pack asset. */
const BARE_FILE = new RegExp(`\\b(${IMAGE_FILE})\\b`, "g");

/** Which of the pack's assets a filename (or handle) names, by the fixed names in lib/prompts/lines.ts FILES. */
export function assetKind(name: string): AssetKind {
  const base = name.replace(/\.(?:png|jpe?g|webp)$/, "");
  if (base === "product_sheet" || base === "packshot" || /^product_photo_\d+$/.test(base)) return "product";
  if (/^talent_[a-z0-9_]+_sheet$/.test(base)) return "talent";
  if (/^loc_[a-z0-9_]+$/.test(base)) return "location";
  return "other";
}

/** Product image first, then frames by scene: the @Image order. */
export function orderReferences(images: readonly ReferenceImage[]): ReferenceImage[] {
  const product = images.filter((image) => image.role === "product").slice(0, 1);
  const frames = images.filter((image) => image.role === "frame").sort((a, b) => (a.scene ?? 0) - (b.scene ?? 0));
  return [...product, ...frames];
}

/** Capitalizes a label that starts a line or a sentence. */
function placed(label: string, before: string): string {
  return before === "" || /\n\s*$/.test(before) || /[.!?]\s+$/.test(before) ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

export function mapReferences(prompt: string, images: readonly ReferenceImage[], options: { productName: string }): MappedReferences {
  const ordered = orderReferences(images).map((image, index) => ({ ...image, handle: `@Image${index + 1}` }));
  const product = ordered.find((image) => image.role === "product") ?? null;

  // Locations are numbered by first mention, so the LOCATION block and the shots agree.
  const locations: string[] = [];
  for (const match of prompt.matchAll(HANDLE_WITH_FILE)) {
    const file = match[2];
    if (assetKind(file) === "location" && !locations.includes(file)) locations.push(file);
  }
  const locationLabel = (file: string) => {
    if (!locations.includes(file)) locations.push(file);
    return locations.length === 1 ? "the location" : `location ${locations.indexOf(file) + 1}`;
  };
  const replacement = (name: string): string => {
    switch (assetKind(name)) {
      case "product":
        return product ? product.handle : "the product";
      case "talent":
        return "the character";
      case "location":
        return locationLabel(name.endsWith(".png") ? name : `${name}.png`);
      default:
        return "the scene";
    }
  };
  const swap = (pattern: RegExp, pick: (match: string[]) => string | null) => (text: string) =>
    text.replace(pattern, (...args: unknown[]) => {
      const groups = args.slice(0, -2) as string[];
      const offset = args.at(-2) as number;
      const label = pick(groups);
      return label === null ? groups[0] : placed(label, text.slice(0, offset));
    });

  let body = swap(HANDLE_WITH_FILE, ([, , file]) => replacement(file))(prompt);
  body = swap(BARE_HANDLE, ([, name]) => (assetKind(name) === "other" ? null : replacement(name)))(body);
  body = swap(BARE_FILE, ([, file]) => (assetKind(file) === "other" ? null : replacement(file)))(body);

  const header = ordered.length ? `REFERENCES\n${referenceLines(ordered, options.productName).join("\n")}\n\n` : "";
  return { prompt: `${header}${body}`, imageUrls: ordered.map((image) => image.url), images: ordered };
}

/** The REFERENCES lines, short: the prompt shares fal's length limit with the whole brief. */
function referenceLines(ordered: readonly (ReferenceImage & { handle: string })[], productName: string): string[] {
  const lines: string[] = [];
  const product = ordered.find((image) => image.role === "product");
  if (product) lines.push(`${product.handle}: the ${productName}, the same shape, colors and label in every shot.`);
  const frames = ordered.filter((image) => image.role === "frame");
  if (frames.length === 0) return lines;
  const shots = frames.map((image) => (image.scene ?? 0) + 1);
  const match = "Match their framing, setting and light.";
  if (frames.length === 1) {
    lines.push(`${frames[0].handle}: the storyboard frame for shot ${shots[0]}. Match its framing, setting and light.`);
  } else if (shots.every((shot, i) => i === 0 || shot === shots[i - 1] + 1)) {
    lines.push(`${frames[0].handle} to ${frames.at(-1)?.handle}: storyboard frames for shots ${shots[0]} to ${shots.at(-1)}, in order. ${match}`);
  } else {
    lines.push(`Storyboard frames: ${frames.map((image, i) => `${image.handle} for shot ${shots[i]}`).join(", ")}. ${match}`);
  }
  return lines;
}

/** Fixed sections that repeat what GLOBAL STYLE already says: left out, in this order, only when a prompt is over fal's limit. */
const BOILERPLATE = ["OPTICS/CAMERA", "PHYSICS"] as const;

/** The prompt within `max` characters, dropping boilerplate sections if it must (never a brief field). */
export function fitPrompt(prompt: string, max: number): string {
  let text = prompt;
  for (const section of BOILERPLATE) {
    if (text.length <= max) break;
    text = text
      .split("\n\n")
      .filter((block) => block.split("\n")[0] !== section)
      .join("\n\n");
  }
  return text;
}
