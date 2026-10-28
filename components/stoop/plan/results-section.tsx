"use client";

import { Loader2 } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ResultView } from "@/lib/plan/view/plan";
import { NOTES_MAX, parseResults, type ResultsField, type ResultsFormValues } from "@/lib/plan/view/results-form";
import { cn } from "cn";
import { Card, PlanSection } from "./plan-section";

const EMPTY: ResultsFormValues = { walkIns: "", sales: "", facebook: false, instagram: false, whatsapp: false, notes: "" };

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "saved" } | { kind: "error"; message: string };

const FIELD = "h-11 w-full rounded-lg border border-concrete-line bg-surface px-3 text-base text-ink outline-none focus-visible:border-dusk focus-visible:ring-3 focus-visible:ring-dusk/30 aria-invalid:border-rose-deep";

/**
 * After the event: walk-ins, sales, where it was posted and a note, sent to the results route. The
 * next plan for this store reads them. Stoop never claims a lift from these: they are the manager's
 * own counts. Example stores show the form but do not save it.
 */
export function ResultsSection({ planId, results, saveable }: { planId: string; results: readonly ResultView[]; saveable: boolean }) {
  const [values, setValues] = useState<ResultsFormValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<ResultsField, string>>>({});
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [logged, setLogged] = useState<ResultView[]>([]);
  const id = useId();
  const set = <K extends keyof ResultsFormValues>(key: K, value: ResultsFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!saveable) return;
    const parsed = parseResults(values);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    setSend({ kind: "sending" });
    try {
      const response = await fetch(`/api/plan/${encodeURIComponent(planId)}/results`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Not saved. Try again.";
        return setSend({ kind: "error", message });
      }
      const channels = (["facebook", "instagram", "whatsapp"] as const).filter((c) => parsed.body.posted[c]);
      setLogged((l) => [
        ...l,
        {
          loggedOn: "Just now",
          walkIns: parsed.body.walkIns,
          sales: parsed.body.sales,
          postedOn: channels.map((c) => ({ facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" })[c]),
          notes: parsed.body.notes ?? null,
        },
      ]);
      setValues(EMPTY);
      setSend({ kind: "saved" });
    } catch {
      setSend({ kind: "error", message: "No connection. Try again." });
    }
  };

  const all = [...results, ...logged];
  return (
    <PlanSection id="results" title="How it went" description="The next plan starts from what worked.">
      {all.length > 0 && (
        <ul aria-label="Logged results" className="flex flex-col gap-2">
          {all.map((r, i) => (
            <li key={i}>
              <Card className="flex flex-col gap-1 py-3 text-sm sm:p-4">
                <p className="font-mono text-xs text-ink-soft">{r.loggedOn}</p>
                <p>
                  <span className="font-semibold">{r.walkIns ?? "Not counted"}</span> walk-ins · <span className="font-semibold">{r.sales ?? "Not counted"}</span> sales
                  {r.postedOn.length > 0 && <span className="text-ink-soft"> · posted on {r.postedOn.join(", ")}</span>}
                </p>
                {r.notes && <p className="text-ink-soft">“{r.notes}”</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <form noValidate onSubmit={submit} aria-describedby={saveable ? undefined : `${id}-example`} className="flex flex-col gap-4">
          {!saveable && (
            <p id={`${id}-example`} className="rounded-lg bg-fill px-3 py-2 text-sm">
              Example store: results aren&apos;t saved.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField id={`${id}-walkins`} label="Walk-ins" hint="Stopped at the table" value={values.walkIns} error={errors.walkIns} onChange={(v) => set("walkIns", v)} disabled={!saveable} />
            <NumberField id={`${id}-sales`} label="Sales" hint="During the event" value={values.sales} error={errors.sales} onChange={(v) => set("sales", v)} disabled={!saveable} />
          </div>
          <fieldset className="flex flex-col gap-2" disabled={!saveable}>
            <legend className="mb-1 text-sm font-semibold">Posted on</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {(["facebook", "instagram", "whatsapp"] as const).map((c) => (
                <label key={c} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={values[c]} onChange={(e) => set(c, e.target.checked)} className="size-5 cursor-pointer accent-ink" />
                  {{ facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp" }[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-notes`} className="text-sm font-semibold">
              Note
            </label>
            <textarea
              id={`${id}-notes`}
              rows={3}
              maxLength={NOTES_MAX}
              value={values.notes}
              onChange={(e) => set("notes", e.target.value)}
              disabled={!saveable}
              aria-invalid={errors.notes ? true : undefined}
              aria-describedby={`${id}-notes-count${errors.notes ? ` ${id}-notes-error` : ""}`}
              placeholder="What made people stop?"
              className={cn(FIELD, "h-auto py-2")}
            />
            <p id={`${id}-notes-count`} className="text-xs text-ink-soft">
              {values.notes.length} of {NOTES_MAX} characters
            </p>
            {errors.notes && (
              <p id={`${id}-notes-error`} className="text-sm text-rose-deep">
                {errors.notes}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="outline" disabled={!saveable || send.kind === "sending"}>
              {send.kind === "sending" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
              Save
            </Button>
            <p role="status" aria-live="polite" className={cn("text-sm", send.kind === "error" ? "text-rose-deep" : "text-ink-soft")}>
              {send.kind === "saved" ? "Saved." : send.kind === "error" ? send.message : ""}
            </p>
          </div>
        </form>
      </Card>
    </PlanSection>
  );
}

function NumberField({
  id,
  label,
  hint,
  value,
  error,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        className={FIELD}
      />
      <p id={`${id}-hint`} className="text-xs text-ink-soft">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} className="text-sm text-rose-deep">
          {error}
        </p>
      )}
    </div>
  );
}
