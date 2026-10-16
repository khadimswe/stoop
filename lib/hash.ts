// Stable hashing for frozen prompts and run records. The same value always hashes the same way,
// whatever the key order, so an approval in public/demo/approvals.json pins exactly one prompt.
import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level. Undefined object values are dropped, like JSON.stringify. */
export function stableStringify(value: unknown): string {
  const json = JSON.stringify(sortKeys(value)) as string | undefined;
  if (json === undefined) throw new Error("stableStringify: value has no JSON form");
  return json;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortKeys(item)));
  if (isPlainObject(value)) {
    const record = value;
    return Object.fromEntries(
      Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("stableStringify: non-finite number");
  return value;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 of the stable JSON form of a value. */
export function hashOf(value: unknown): string {
  return sha256(stableStringify(value));
}
