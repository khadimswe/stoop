import type { CultureBriefView, CultureFieldView } from "@/lib/report/view/why";
import { NotThisVibe, ReviseStatus } from "../revise/not-this-vibe";
import { RevisionDiff } from "../revise/revision-diff";
import { OriginChip, ReceiptLink, StatusTag, TraceDecisions, wasLabel } from "./receipt-link";
import { briefAnchor } from "./anchors";
import { CARD, CARD_TITLE } from "./research-cards";

function FieldRow({ segmentId, field, revisable }: { segmentId: string; field: CultureFieldView; revisable: boolean }) {
  return (
    <div className="flex flex-col gap-2 border-t border-hairline py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-semibold">{field.label}</span>
        <span className="font-mono text-xs text-ink-soft">
          {field.signalLabel}
          {field.sources > 0 && ` · ${field.sources} Qloo ${field.sources === 1 ? "pick" : "picks"}`}
        </span>
      </dt>
      <dd className="flex flex-col gap-2.5">
        {field.cues.length === 0 && (
          <p>
            <StatusTag tone="none">No Qloo signal</StatusTag>
          </p>
        )}
        {field.cues.map((cue, i) => (
          <div key={`${i}-${cue.text.slice(0, 24)}`} className="flex flex-col items-start gap-1.5">
            <p className="text-sm leading-relaxed">{cue.text}</p>
            <OriginChip origin={cue.origin} receipt={cue.receipt} />
            {cue.was && (
              <p className="text-xs text-ink-soft">
                was: <span className="line-through decoration-concrete-line">{cue.was.text}</span>{" "}
                {cue.was.receipt ? (
                  <ReceiptLink receipt={cue.was.receipt}>(Qloo receipt)</ReceiptLink>
                ) : (
                  <span>{wasLabel(cue.was.origin)}</span>
                )}
              </p>
            )}
          </div>
        ))}
        {field.noSignal && field.cues.length > 0 && <p className="text-xs text-ink-soft">No Qloo signal for this field.</p>}
        {field.scopeNote && <p className="text-xs text-ink-soft">{field.scopeNote}</p>}
        {revisable && !field.noSignal && <NotThisVibe segmentId={segmentId} field={field.field} label={field.label} exclude={field.excludeIds} className="-ml-3 self-start" />}
      </dd>
    </div>
  );
}

/**
 * One world's Culture Brief: each field with how much Qloo signal backs it, every cue with its origin
 * and receipt ("No Qloo signal" when empty), what a revision changed, and on live reports "Not this
 * vibe" per field and for the whole world.
 */
export function CultureBriefCard({ brief }: { brief: CultureBriefView }) {
  const anchor = briefAnchor(brief.segmentId);
  const revisions = [...brief.revisions].reverse();
  return (
    <article id={anchor} aria-labelledby={`${anchor}-title`} className={`${CARD} scroll-mt-28`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-kicker text-ink-soft">Culture Brief</p>
          <h3 id={`${anchor}-title`} className={CARD_TITLE}>
            {brief.label}
          </h3>
        </div>
        {brief.revisable && <NotThisVibe segmentId={brief.segmentId} field="world" label={brief.label} className="-mr-2" />}
      </div>
      <ReviseStatus segmentId={brief.segmentId} announce />
      {brief.partial && <p className="text-sm text-ink-soft">This world stopped at {brief.partial.stage}: {brief.partial.reason}</p>}
      {revisions.map((revision, i) => (
        <RevisionDiff key={revision.id} revision={revision} latest={i === 0} />
      ))}
      {brief.fields.length > 0 ? (
        <dl className="flex flex-col">
          {brief.fields.map((field) => (
            <FieldRow key={field.field} segmentId={brief.segmentId} field={field} revisable={brief.revisable} />
          ))}
        </dl>
      ) : (
        <p className="text-sm text-ink-soft">The Culture Brief appears once Qloo has measured this world.</p>
      )}
      <TraceDecisions steps={brief.reviseSteps} title="Latest revision, agent decisions" />
    </article>
  );
}
