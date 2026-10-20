import { Stamp } from "@/components/stoop/stamp";
import type { ChoiceView, ScoreboardView, ScoreWorldView } from "@/lib/report/view/why";
import { ReceiptLink, StatusTag } from "./receipt-link";
import { CARD, CARD_TITLE } from "./research-cards";

const TONE = { supported: "qloo", below: "flagged", missing: "none", unverifiable: "unknown" } as const satisfies Record<ChoiceView["status"], string>;

function Counts({ world }: { world: ScoreWorldView }) {
  const items = [
    { label: "checkable", value: world.counts.checkable },
    { label: "missed what Qloo measured", value: world.counts.below },
    { label: "no measurable affinity", value: world.counts.missing },
    { label: "unverifiable", value: world.counts.unverifiable },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="flex flex-col-reverse justify-end gap-0.5 rounded-lg bg-fill px-3 py-2">
          <dt className="text-xs text-ink-soft">{item.label}</dt>
          <dd className="font-mono text-lg leading-tight font-medium">
            <ReceiptLink receipt={world.fitReceipt} describe={`${item.label} for ${world.label}`} className="inline-flex min-h-11 min-w-11 items-center sm:min-h-0 sm:min-w-0">
              {item.value}
            </ReceiptLink>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ChoiceRow({ choice }: { choice: ChoiceView }) {
  return (
    <li className="grid gap-x-3 gap-y-1 border-t border-hairline py-2.5 first:border-t-0 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]">
      <span className="font-mono text-xs text-ink-soft sm:pt-0.5">{choice.dimensionLabel}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm" title={choice.text}>
          {choice.text}
        </span>
        <span className="text-xs text-ink-soft">
          {choice.measured ? (
            <ReceiptLink receipt={choice.receipt}>{choice.measured}</ReceiptLink>
          ) : choice.status === "missing" ? (
            <ReceiptLink receipt={choice.receipt}>Qloo returned no score for it.</ReceiptLink>
          ) : (
            "Nothing in Qloo to check it against."
          )}
        </span>
      </div>
      <StatusTag tone={TONE[choice.status]} className="self-start justify-self-start">
        {choice.statusLabel}
      </StatusTag>
    </li>
  );
}

function WorldScore({ world }: { world: ScoreWorldView }) {
  return (
    <section aria-labelledby={`score-${world.segmentId}`} className="flex min-w-0 flex-col gap-3 border-t border-hairline pt-4">
      <h4 id={`score-${world.segmentId}`} className="font-display text-base leading-snug font-bold [font-stretch:90%] sm:text-lg">
        {world.label}
      </h4>
      <p className="text-sm font-semibold">
        <ReceiptLink receipt={world.fitReceipt}>{world.fitLine}</ReceiptLink>
      </p>
      {world.range && <p className="text-xs text-ink-soft">{world.range}</p>}
      <Counts world={world} />
      <h5 className="text-sm font-semibold">The generic brief&apos;s choices</h5>
      {world.groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1 rounded-lg border border-hairline p-3">
          <h6 className="text-sm font-semibold">{group.title}</h6>
          <p className="text-xs text-ink-soft">{group.rule}</p>
          <ul className="flex flex-col">
            {group.choices.map((choice, i) => (
              <ChoiceRow key={`${i}-${choice.dimension}`} choice={choice} />
            ))}
          </ul>
        </div>
      ))}
      {world.qlooLine && (
        <p className="text-sm">
          <StatusTag tone="qloo" className="mr-1.5 align-middle">
            Qloo
          </StatusTag>
          <ReceiptLink receipt={world.qlooReceipt}>{world.qlooLine}</ReceiptLink>
        </p>
      )}
      {world.cliches.length > 0 && (
        <div className="flex flex-col gap-2">
          <h5 className="text-sm font-semibold">Cliches flagged</h5>
          <ul className="flex flex-col gap-2">
            {world.cliches.map((cliche, i) => (
              <li key={`${i}-${cliche.dimension}`} className="flex flex-col items-start gap-1 rounded-lg border border-hairline bg-surface p-3">
                <StatusTag tone="flagged">Cliche flagged</StatusTag>
                <span className="text-sm">{cliche.assumed}</span>
                <span className="text-sm text-ink-soft">
                  <ReceiptLink receipt={cliche.receipt}>{cliche.measured}</ReceiptLink>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * With vs without Qloo: the LLM-only Control scored against each world, with numbers. Below the
 * panel median is "Cliche flagged", a missing score is "no measurable affinity", and nothing claims a
 * median under 5 panel items. The rule is printed on the card.
 */
export function ScoreboardCard({ scoreboard }: { scoreboard: ScoreboardView | null }) {
  if (!scoreboard) {
    return (
      <article aria-labelledby="why-score" className={CARD}>
        <h3 id="why-score" className={CARD_TITLE}>
          With vs without Qloo
        </h3>
        <p className="text-sm text-ink-soft">The scored comparison appears once the generic brief has been checked against each world.</p>
      </article>
    );
  }
  const flagged = scoreboard.worlds.some((w) => w.cliches.length > 0 || w.counts.below > 0);
  return (
    <article aria-labelledby="why-score" className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="why-score" className={CARD_TITLE}>
          With vs without Qloo
        </h3>
        {flagged && <Stamp tone="flagged">Cliche flagged</Stamp>}
      </div>
      <p className="text-sm text-ink-soft">
        Each choice in the generic, LLM-only brief is checked against what Qloo measured for each world. A choice the data does not support is flagged as a cliche; the
        rule for each kind of choice sits next to it.
      </p>
      {scoreboard.headline && <p className="text-base font-semibold">{scoreboard.headline}</p>}
      <div className="grid gap-6 lg:grid-cols-2">
        {scoreboard.worlds.map((world) => (
          <WorldScore key={world.segmentId} world={world} />
        ))}
      </div>
    </article>
  );
}
