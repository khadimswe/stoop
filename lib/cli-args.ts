// Strict argument parsing for the founder's offline scripts (scripts/render-demo.ts,
// scripts/export-pack.ts). Anything the command does not name is an error, never ignored: a typo such
// as --segmnet must not silently widen a render to every board, and a repeated option is refused rather
// than overwritten, so what runs is exactly what was typed.

export interface CliSpec {
  /** Flags that take no value, e.g. "--dry-run". */
  flags: readonly string[];
  /** Options that take one value, e.g. "--segment". */
  options: readonly string[];
  /** How many positional arguments the command takes. */
  positionals: { min: number; max: number };
}

export interface CliArgs {
  positional: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

export function parseCliArgs(argv: readonly string[], spec: CliSpec): CliArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (spec.flags.includes(arg)) {
      if (flags.has(arg)) throw new CliError(`${arg} is given twice.`);
      flags.add(arg);
    } else if (spec.options.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new CliError(`${arg} needs a value.`);
      if (options.has(arg)) throw new CliError(`${arg} is given twice.`);
      options.set(arg, value);
      i++;
    } else if (arg.startsWith("-")) {
      throw new CliError(`Unknown option ${arg}.`);
    } else {
      positional.push(arg);
    }
  }
  const { min, max } = spec.positionals;
  if (positional.length < min || positional.length > max) {
    const want = min === max ? `${min}` : `${min} to ${max}`;
    throw new CliError(`Expected ${want} argument${max === 1 ? "" : "s"}, got ${positional.length}${positional.length ? ` (${positional.join(" ")})` : ""}.`);
  }
  return { positional, options, flags };
}
