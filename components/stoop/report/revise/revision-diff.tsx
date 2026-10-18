import type { RevisionView } from "@/lib/report/view/why";
import { OriginChip, ReceiptLink } from "../why/receipt-link";

/**
 * What a "Not this vibe" revision changed, slot by slot: the new cue with its origin and receipt, and
 * the one it replaced, kept visible as "was: <old text> (Qloo receipt)".
 */
export function RevisionDiff({ revision, latest }: { revision: RevisionView; latest: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-fill p-3">
      <p className="text-sm">
        <span className="font-semibold">{latest ? "What changed" : "Earlier revision"}</span>
        <span className="text-ink-soft">
          {" "}
          · not this {revision.field === "world" ? "world" : revision.fieldLabel.toLowerCase()}
          {revision.excluded > 0 && `, ${revision.excluded} of Qloo's picks left out`}
        </span>
      </p>
      {revision.note && (
        <p className="text-sm">
          <span className="text-ink-soft">Your note: </span>
          <q className="italic">{revision.note}</q>
        </p>
      )}
      {revision.changes.length === 0 ? (
        <p className="text-sm text-ink-soft">The new brief kept the same wording here.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {revision.changes.map((change, i) => (
            <li key={`${i}-${change.slot}`} className="flex flex-col gap-1">
              <span className="font-mono text-xs text-ink-soft">{change.label}</span>
              {change.after ? (
                <div className="flex flex-col items-start gap-1">
                  <span className="line-clamp-3 text-sm">{change.after.text}</span>
                  <OriginChip origin={change.after.origin} receipt={change.after.receipt} />
                </div>
              ) : (
                <span className="text-sm text-ink-soft">Removed from the brief.</span>
              )}
              {change.before && (
                <p className="text-xs text-ink-soft">
                  was: <span className="line-through decoration-concrete-line">{change.before.text}</span>{" "}
                  {change.before.receipt ? (
                    <ReceiptLink receipt={change.before.receipt}>(Qloo receipt)</ReceiptLink>
                  ) : (
                    <span>{change.before.origin === "yours" ? "(your choice)" : "(not from Qloo)"}</span>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
