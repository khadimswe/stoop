import { describe, expect, it } from "vitest";
import { CliError, parseCliArgs, type CliSpec } from "./cli-args";

const spec: CliSpec = { flags: ["--dry-run", "--yes"], options: ["--segment"], positionals: { min: 1, max: 1 } };

describe("parseCliArgs", () => {
  it("reads flags, options and positionals in any order", () => {
    const args = parseCliArgs(["--yes", "food-hot-sauce", "--segment", "seg-a"], spec);
    expect(args.positional).toEqual(["food-hot-sauce"]);
    expect(args.options.get("--segment")).toBe("seg-a");
    expect([...args.flags]).toEqual(["--yes"]);
  });

  it("rejects unknown flags, so a typo never widens a command", () => {
    expect(() => parseCliArgs(["food-hot-sauce", "--segmnet", "seg-a", "--yes"], spec)).toThrow(/Unknown option --segmnet/);
    expect(() => parseCliArgs(["food-hot-sauce", "-y"], spec)).toThrow(CliError);
  });

  it("rejects an option without its value", () => {
    expect(() => parseCliArgs(["food-hot-sauce", "--segment"], spec)).toThrow(/--segment needs a value/);
    expect(() => parseCliArgs(["food-hot-sauce", "--segment", "--yes"], spec)).toThrow(/--segment needs a value/);
  });

  it("rejects too few or too many positionals", () => {
    expect(() => parseCliArgs(["--yes"], spec)).toThrow(/Expected 1 argument, got 0/);
    expect(() => parseCliArgs(["food-hot-sauce", "home-candles"], spec)).toThrow(/Expected 1 argument, got 2/);
    expect(parseCliArgs([], { ...spec, positionals: { min: 0, max: 1 } }).positional).toEqual([]);
  });

  it("rejects a repeated option or flag instead of keeping the last one", () => {
    expect(() => parseCliArgs(["food-hot-sauce", "--segment", "seg-a", "--segment", "seg-b"], spec)).toThrow(/--segment is given twice/);
    expect(() => parseCliArgs(["food-hot-sauce", "--yes", "--yes"], spec)).toThrow(/--yes is given twice/);
  });
});
