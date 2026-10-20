import Link from "next/link";
import { EXAMPLE_CHIPS, exampleRunHref } from "@/lib/run/start";

/** "Try an example": each chip opens that example's recorded run, which ends on its full report. */
export function ExampleChips() {
  return (
    <div className="flex flex-col gap-2.5">
      <p id="try-example" className="text-[0.8125rem] font-semibold text-ink-soft">
        Try an example
      </p>
      <ul aria-labelledby="try-example" className="flex flex-wrap gap-2">
        {EXAMPLE_CHIPS.map((chip) => (
          <li key={chip.slug}>
            <Link
              href={exampleRunHref(chip.slug)}
              aria-label={`${chip.label}: watch the recorded ${chip.brandName} run`}
              className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-concrete-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-fill"
            >
              {chip.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
