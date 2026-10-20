import { ArrowDownRight, BadgeCheck, PenLine } from "lucide-react";
import type { ReactNode } from "react";
import { Chip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { cn } from "cn";
import { CONTROL_INTEREST_NOTE, formatUsd, INTEREST_HEADING, INTEREST_NOTE } from "@/lib/report/view/launch-sheet";
import type { LaunchCellView, LaunchInterestView, LaunchOptionView, ReceiptView } from "@/lib/report/view/types";

/** The cell's source tag: dusk for a world (built on Qloo's measured audience), dashed concrete for the Control. */
function SourceTag({ control }: { control: boolean }) {
  return control ? (
    <span className="inline-flex items-center gap-1 self-start rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
      <PenLine aria-hidden="true" className="size-3" />
      Generic AI brief · not from Qloo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 self-start rounded-full border-[1.5px] border-dusk px-2.5 py-0.5 text-xs font-semibold text-dusk">
      <BadgeCheck aria-hidden="true" className="size-3" />
      Culture-made
    </span>
  );
}

/** A solid Qloo chip that opens its receipt. */
function QlooChip({ text, detail, receipt }: { text: string; detail: string | null; receipt: ReceiptView }) {
  return (
    <ReceiptDrawer receipt={receipt}>
      <button type="button" className="inline-flex min-h-11 max-w-full items-center rounded-full sm:min-h-8">
        <Chip origin="qloo">
          {text}
          {detail && <span className="font-mono font-medium"> · {detail}</span>}
        </Chip>
        <span className="sr-only"> (opens its receipt)</span>
      </button>
    </ReceiptDrawer>
  );
}

/** A Qloo option opens its receipt; the Control's options are plain, labeled not from Qloo. */
function Option({ option }: { option: LaunchOptionView }) {
  if (!option.receipt) {
    return (
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-1 text-[0.8125rem] leading-none font-semibold text-ink-soft">
        <PenLine aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="sr-only">From the generic brief, not from Qloo: </span>
        <span className="truncate">{option.text}</span>
      </span>
    );
  }
  return <QlooChip text={option.text} detail={option.detail} receipt={option.receipt} />;
}

/**
 * Interest searches to try: entities Qloo returned for this world, each opening its receipt, labeled
 * as suggestions (an ads manager's interest list is not Qloo's). The Control has none.
 */
function Interests({ interests, control }: { interests: LaunchInterestView[]; control: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-3" data-launch-interests>
      <h4 className="text-[0.8125rem] font-semibold">
        {INTEREST_HEADING} <span className="font-normal text-ink-soft">(suggestions)</span>
      </h4>
      {control || interests.length === 0 ? (
        <p className="text-sm text-ink-soft">{control ? CONTROL_INTEREST_NOTE : "No Qloo signal"}</p>
      ) : (
        <>
          <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:gap-y-1.5">
            {interests.map((interest) => (
              <li key={interest.id} className="max-w-full">
                <QlooChip text={interest.name} detail={interest.kind} receipt={interest.receipt} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-soft">{INTEREST_NOTE}</p>
        </>
      )}
    </div>
  );
}

function Options({ term, options, empty }: { term: string; options: LaunchOptionView[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-ink-soft">{term}</dt>
      <dd>
        {options.length > 0 ? (
          <ul className="flex flex-wrap items-center gap-x-1.5 gap-y-1 sm:gap-y-1.5">
            {options.map((option) => (
              <li key={option.text} className="max-w-full">
                <Option option={option} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">{empty}</p>
        )}
      </dd>
    </div>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-soft">{term}</dt>
      <dd className="text-sm text-pretty">{children}</dd>
    </div>
  );
}

/**
 * One test cell: an ad set (Meta) or ad group (TikTok). The Control sits in a dashed concrete frame,
 * a world in a hairline card. Its daily budget comes from the budget helper (null while the numbers
 * are invalid). `promptsHref` points at the cell's card in the Output section.
 */
export function LaunchCell({ cell, dailyCents, promptsHref }: { cell: LaunchCellView; dailyCents: number | null; promptsHref: string }) {
  const control = cell.kind === "control";
  const titleId = `launch-${cell.key}`;
  return (
    <article
      aria-labelledby={titleId}
      data-launch-cell={cell.key}
      className={cn(
        "flex h-full min-w-0 flex-col gap-4 rounded-xl bg-surface p-4 sm:p-5",
        control ? "border-[1.5px] border-dashed border-concrete-line" : "border border-hairline",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-semibold text-ink-soft">{control ? "Baseline" : cell.name}</p>
          <h3 id={titleId} className="font-display text-lg leading-snug font-bold text-balance [font-stretch:90%]">
            {control ? "Control" : cell.label}
          </h3>
          <SourceTag control={control} />
        </div>
        {dailyCents !== null && (
          <p className="shrink-0 text-right" data-launch-budget>
            <span className="block font-mono text-base font-semibold">{formatUsd(dailyCents)}</span>
            <span className="block text-xs text-ink-soft">a day</span>
          </p>
        )}
      </header>

      <div className="flex flex-col gap-2">
        <Chip origin="creative" showOrigin className="self-start">
          Concept
        </Chip>
        <p className="font-display text-base leading-snug font-bold [font-stretch:90%]">{cell.creative.title}</p>
        <p className="text-sm text-pretty">
          <span className="font-semibold">Hook: </span>
          {cell.creative.hook}
        </p>
        <a
          href={promptsHref}
          className="-my-1.5 inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick"
        >
          See its prompts
          <span className="sr-only"> for {control ? "the Control" : cell.label}</span>
          <ArrowDownRight aria-hidden="true" className="size-4" />
        </a>
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline pt-3">
        <h4 className="text-[0.8125rem] font-semibold">
          Audience options <span className="font-normal text-ink-soft">(optional)</span>
        </h4>
        <dl className="flex flex-col gap-2">
          <Options term={cell.ageBands.length === 1 ? "Age band" : "Age bands"} options={cell.ageBands} empty={control ? "None in the generic brief." : "No Qloo signal"} />
          <Options term="Cities" options={cell.cities} empty={control ? "None in the generic brief." : "No Qloo signal"} />
        </dl>
        <p className="text-xs text-ink-soft">{control ? "From the generic brief, not from Qloo." : "Measured by Qloo. Each one opens its receipt."}</p>
      </div>

      <Interests interests={cell.interests} control={control} />

      <dl className="mt-auto flex flex-col gap-2 border-t border-hairline pt-3">
        <Row term="Placements">{cell.placements.join(" · ")}</Row>
        <Row term="What to watch">{cell.watch}</Row>
      </dl>
    </article>
  );
}
