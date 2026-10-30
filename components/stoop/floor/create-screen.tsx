"use client";

import { ChevronDown, ChevronLeft, LayoutGrid, Loader2, Minus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode, type TextareaHTMLAttributes } from "react";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/qloo/constants";
import { SETTING_LABELS, timeRange } from "@/lib/plan/view/format";
import { apiMessageOf } from "@/lib/plan/view/live";
import type { PlanNotice } from "@/lib/plan/view/notice";
import { BUDGET_MIN, DURATIONS, emptyStoreForm, EVENT_DAYS_AHEAD, LIMITS, MAX_OFFERS, nextSaturday, parseStoreForm, PLAN_NOTICE_KEY, type Setting, type StoreField, type StoreFormValues } from "@/lib/plan/view/start-form";
import { ageBandLabel } from "@/lib/types";
import { cn } from "cn";
import { ActionBar, Chevron, FloorHeader, IconSlot, Notice, PRIMARY, RowLabel, ScreenTitle, Section, TwoColumn, type Step } from "./kit";

const noSubscription = () => () => {};

/** The local date `days` from today, as YYYY-MM-DD (what a date input reads). */
function localDay(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Text fields keep the site-wide 3 px focus ring (no outline-none), with a radius so it sits neatly. */
const FIELD = "w-full min-w-0 rounded-[6px] bg-transparent text-[0.9375rem] text-fl-ink placeholder:text-fl-dim";
const START_TIMES = Array.from({ length: 27 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
/** The stepper's range: typed amounts are held to it too. */
const BUDGET_MAX = LIMITS.budget;
const DRAFT_KEY = "stoop:create-draft";

/** The store the event is for; fixed on this screen (it was set on the Community step). */
export interface CreateStore {
  name: string;
  address: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  carrier: StoreFormValues["carrier"];
  phone?: string;
  storeNumber?: string;
}

const thisYear = () => new Date().getFullYear();
function dayText(iso: string): string {
  if (!iso) return "Pick a day";
  const d = new Date(`${iso}T12:00:00Z`);
  const year = d.getUTCFullYear() !== thisYear();
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(d);
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : `${h} h ${m} min`;
}

/** A textarea that grows with what is typed, so a long promo is never hidden. */
function GrowingText({ value, className, ...rest }: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value"> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} rows={1} value={value} className={cn("resize-none overflow-hidden", className)} {...rest} />;
}

/** "112 of 140" once a field nears its limit, and a plain message past it. */
function Counter({ length, max, id, what }: { length: number; max: number; id: string; what: string }) {
  if (length < max - 30) return null;
  const over = length > max;
  return (
    <p id={id} aria-live="polite" className={cn("text-xs tabular-nums", over ? "font-medium text-fl-bad" : "text-fl-dim")}>
      {over ? `${length} of ${max}: shorten this ${what} by ${length - max}. Stoop uses it exactly as typed.` : `${length} of ${max}`}
    </p>
  );
}

/** A row that opens a field in place, with a chevron. */
function OpenRow({ label, value, open, onToggle, children, error, id }: { label: string; value: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; error?: string; id: string }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-panel`} className="flex min-h-[54px] w-full items-center gap-3 px-4 py-3 text-left">
        <RowLabel>{label}</RowLabel>
        <span className="line-clamp-2 min-w-0 flex-1 text-[0.9375rem] text-pretty">{value}</span>
        {open ? <ChevronDown aria-hidden="true" className="size-4 shrink-0 rotate-180 text-fl-chev" /> : <Chevron />}
      </button>
      <div id={`${id}-panel`} hidden={!open} className="px-4 pb-3.5 pl-[5.75rem]">
        {children}
      </div>
      {error && (
        <p id={`${id}-error`} className="px-4 pb-3 pl-[5.75rem] text-sm text-fl-bad">
          {error}
        </p>
      )}
    </li>
  );
}

function loadDraft(key: string): Partial<StoreFormValues> | null {
  try {
    const all = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, Partial<StoreFormValues>>;
    return all[key] ?? null;
  } catch {
    return null;
  }
}
function saveDraft(key: string, values: StoreFormValues) {
  try {
    const all = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, Partial<StoreFormValues>>;
    const { offers, ageBands, setting, notes, startTime, durationMinutes, budgetUsd, date } = values;
    all[key] = { offers, ageBands, setting, notes, startTime, durationMinutes, budgetUsd, date };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(all));
  } catch {
    // Private browsing: the form still works, it just isn't kept.
  }
}

/**
 * Step 2, a new event: four things in one grouped form (the store, the day, the time, the budget with
 * $50 to start), then the store's promos, used exactly as typed, and the optional rest under "More".
 * "Plan my event" starts the plan (POST /api/plan) or, when live plans are paused, opens an example and
 * leaves it a note saying so. With `draftKey` (a store typed on /start) what was typed is kept for the
 * tab, so coming back from an example finds it again. From 1024 px a side column holds the summary and
 * the action.
 */
export function CreateScreen({
  store,
  defaults,
  backHref,
  steps,
  reasons,
  onEditStore,
  draftKey,
}: {
  store: CreateStore;
  defaults?: Partial<Pick<StoreFormValues, "offers" | "ageBands" | "setting" | "notes" | "startTime" | "durationMinutes" | "budgetUsd">>;
  backHref: string;
  steps?: Partial<Record<Step, string>>;
  reasons?: Partial<Record<Step, string>>;
  onEditStore?: () => void;
  /** Keep what is typed in this tab under this key (client-only screens). */
  draftKey?: string;
}) {
  const router = useRouter();
  const id = useId();
  const saturday = useSyncExternalStore(noSubscription, () => nextSaturday(new Date()), () => "");
  const today = useSyncExternalStore(noSubscription, () => localDay(0), () => "");
  const lastDay = useSyncExternalStore(noSubscription, () => localDay(EVENT_DAYS_AHEAD), () => "");
  const [values, setValues] = useState<StoreFormValues>(() => {
    const draft = draftKey ? loadDraft(draftKey) : null;
    const merged = { ...defaults, ...draft };
    return {
      ...emptyStoreForm(),
      storeName: store.name,
      address: store.address,
      city: store.city,
      region: store.region,
      lat: String(store.lat),
      lon: String(store.lon),
      carrier: store.carrier,
      phone: store.phone ?? "",
      storeNumber: store.storeNumber ?? "",
      ...merged,
      offers: merged.offers?.length ? merged.offers : [""],
    };
  });
  const [dateTouched, setDateTouched] = useState(Boolean(values.date));
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const [send, setSend] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string }>({ kind: "idle" });
  const date = dateTouched ? values.date : saturday;
  const set = <K extends keyof StoreFormValues>(key: K, value: StoreFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggle = (row: string) => setOpen((o) => (o === row ? null : row));
  const budget = Number(values.budgetUsd) || 0;
  const clampBudget = (n: number) => Math.max(BUDGET_MIN, Math.min(BUDGET_MAX, Math.round(n)));
  // Functional updates, so quick taps each count.
  const step = (by: number) => setValues((v) => ({ ...v, budgetUsd: String(clampBudget((Number(v.budgetUsd) || 0) + by)) }));
  const errorList = Object.values(errors).filter(Boolean);
  const dateError =
    errors.date ??
    (dateTouched && today && values.date && values.date < today
      ? "Pick today or a later day."
      : dateTouched && lastDay && values.date > lastDay
        ? "Pick a day in the next 4 weeks."
        : undefined);
  const bandsFull = values.ageBands.length >= LIMITS.maxBands;

  useEffect(() => {
    if (draftKey) saveDraft(draftKey, { ...values, date: dateTouched ? values.date : "" });
  }, [draftKey, values, dateTouched]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseStoreForm({ ...values, date }, today || undefined);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      if (parsed.errors.date) setOpen("day");
      else if (parsed.errors.ageBands) setOpen("ages");
      else if (parsed.errors.notes) setOpen("notes");
      return;
    }
    setErrors({});
    setSend({ kind: "sending" });
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: parsed.inputs }) });
      const body = (await response.json().catch(() => null)) as { mode?: string; id?: string; slug?: string; message?: string } | null;
      if (!response.ok) return setSend({ kind: "error", message: apiMessageOf(body) ?? "Stoop couldn't start this plan. Try again in a minute." });
      if (body?.mode === "live" && body.id) return router.push(`/plan/${encodeURIComponent(body.id)}`);
      if (body?.mode === "example" && body.slug) {
        try {
          // The example's Event page says why it opened, whose plan it is and the way back.
          const notice: PlanNotice = { message: body.message ?? "Live plans are off right now.", slug: body.slug, from: { name: store.name, city: `${store.city}, ${store.region}` }, back: backHref };
          sessionStorage.setItem(PLAN_NOTICE_KEY, JSON.stringify(notice));
        } catch {
          // Private browsing: the example still opens.
        }
        return router.push(`/plan/ex-${encodeURIComponent(body.slug)}`);
      }
      setSend({ kind: "error", message: "Stoop couldn't start this plan. Try again in a minute." });
    } catch {
      setSend({ kind: "error", message: "No connection. Your answers are still here. Try again." });
    }
  };

  const ageText = values.ageBands.length ? values.ageBands.map(ageBandLabel).join(", ") : "Pick at least one";
  const offersTyped = values.offers.filter((o) => o.trim()).length;
  const submitButton = (
    <button type="submit" className={PRIMARY} disabled={send.kind === "sending"}>
      {send.kind === "sending" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
      {send.kind === "sending" ? "Planning..." : "Plan my event"}
    </button>
  );
  const note = "Usually 1 to 2 minutes. Nothing posts until you approve it.";

  const main = (
    <>
      <ScreenTitle title="New event" meta="Four things. About a minute." />
      {errorList.length > 0 && (
        <Notice tone="bad" title="Check these first">
          <ul className="list-disc pl-5">
            {errorList.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Notice>
      )}
      <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
        <li className="flex min-h-[54px] items-center gap-3 px-4 py-3">
          <RowLabel>Store</RowLabel>
          <span className="min-w-0 flex-1">
            <span className="block text-[0.9375rem] font-medium">{store.name}</span>
            <span className="block text-[0.8125rem] text-fl-dim">{store.address}</span>
          </span>
          {onEditStore && (
            <button type="button" onClick={onEditStore} className="text-sm font-medium underline underline-offset-[3px]">
              Edit
            </button>
          )}
        </li>
        <OpenRow id={`${id}-day`} label="Day" value={dayText(date)} open={open === "day"} onToggle={() => toggle("day")} error={dateError}>
          <input
            type="date"
            aria-label="Day of the event"
            value={date}
            min={today || undefined}
            max={lastDay || undefined}
            aria-invalid={dateError ? true : undefined}
            onChange={(e) => {
              setDateTouched(true);
              set("date", e.target.value);
              if (errors.date) setErrors((x) => ({ ...x, date: undefined }));
            }}
            className="h-11 w-full rounded-[12px] border border-fl-line bg-white px-3 text-base"
          />
        </OpenRow>
        <OpenRow id={`${id}-time`} label="Time" value={timeRange(values.startTime, Number(values.durationMinutes))} open={open === "time"} onToggle={() => toggle("time")}>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[0.8125rem] text-fl-dim">
              Starts
              <select value={values.startTime} onChange={(e) => set("startTime", e.target.value)} className="h-11 rounded-[12px] border border-fl-line bg-white px-2 text-base text-fl-ink">
                {START_TIMES.map((t) => (
                  <option key={t} value={t}>
                    {timeRange(t, 0).split(" to ")[0]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[0.8125rem] text-fl-dim">
              For
              <select value={values.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} className="h-11 rounded-[12px] border border-fl-line bg-white px-2 text-base text-fl-ink">
                {DURATIONS.map((m) => (
                  <option key={m} value={String(m)}>
                    {durationLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </OpenRow>
        <li className="flex flex-col gap-1 px-4 py-2.5">
          <div className="flex min-h-11 items-center gap-3">
            <RowLabel htmlFor={`${id}-budget`}>Budget</RowLabel>
            <span className="flex-1" />
            <button type="button" onClick={() => step(-10)} disabled={budget <= BUDGET_MIN} aria-label="Ten dollars less" className="flex size-11 items-center justify-center rounded-[12px] border border-fl-line bg-white disabled:opacity-40">
              <Minus aria-hidden="true" className="size-4" />
            </button>
            <span className="flex h-11 w-[5.5rem] items-center justify-center gap-0.5 rounded-[12px] border border-fl-line bg-white px-2 focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-fl-ink">
              <span aria-hidden="true" className="text-lg font-medium">
                $
              </span>
              <input
                id={`${id}-budget`}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                aria-label="Budget in dollars"
                aria-describedby={`${id}-budget-help`}
                value={values.budgetUsd}
                onChange={(e) => set("budgetUsd", e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                onBlur={() => setValues((v) => ({ ...v, budgetUsd: String(clampBudget(Number(v.budgetUsd) || BUDGET_MIN)) }))}
                className="w-14 bg-transparent text-center text-lg font-medium tabular-nums outline-none"
              />
            </span>
            <button type="button" onClick={() => step(10)} disabled={budget >= BUDGET_MAX} aria-label="Ten dollars more" className="flex size-11 items-center justify-center rounded-[12px] border border-fl-line bg-white disabled:opacity-40">
              <Plus aria-hidden="true" className="size-4" />
            </button>
          </div>
          <p id={`${id}-budget-help`} className={cn("pl-[4.75rem] text-xs", errors.budgetUsd ? "text-fl-bad" : "text-fl-dim")}>
            {errors.budgetUsd ?? `Type an amount, $${BUDGET_MIN} to $${BUDGET_MAX.toLocaleString("en-US")}.`}
          </p>
        </li>
      </ul>

      <Section title="Promos" aside="Used exactly as typed">
        <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          {values.offers.map((offer, i) => (
            <li key={i} className="flex flex-col gap-1 px-4 py-2">
              <div className="flex min-h-[38px] items-start gap-2">
                <GrowingText
                  aria-label={`Promo ${i + 1}`}
                  value={offer}
                  placeholder={i === 0 ? "e.g. Free phone when you switch" : "Another promo"}
                  onChange={(e) => set("offers", values.offers.map((o, j) => (j === i ? e.target.value : o)))}
                  aria-invalid={errors[`offer${i}`] || offer.length > LIMITS.offer ? true : undefined}
                  aria-describedby={`${id}-offer${i}-count`}
                  className={cn(FIELD, "px-1 py-1.5 leading-5")}
                />
                {values.offers.length > 1 && (
                  <button type="button" onClick={() => set("offers", values.offers.filter((_, j) => j !== i))} aria-label={`Remove promo ${i + 1}`} className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-fl-chev hover:bg-fl-sunk">
                    <X aria-hidden="true" className="size-4" />
                  </button>
                )}
              </div>
              <Counter length={offer.length} max={LIMITS.offer} id={`${id}-offer${i}-count`} what="promo" />
            </li>
          ))}
          <li>
            {values.offers.length < MAX_OFFERS ? (
              <button type="button" onClick={() => set("offers", [...values.offers, ""])} className="flex min-h-[54px] w-full items-center gap-3 px-4 text-[0.9375rem] font-semibold">
                <Plus aria-hidden="true" className="size-4" />
                Add a promo
              </button>
            ) : (
              <p className="flex min-h-[54px] items-center px-4 text-sm text-fl-dim">Up to {MAX_OFFERS} promos. Remove one to add another.</p>
            )}
          </li>
        </ul>
      </Section>

      <Section title="More" aside="Optional">
        <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          <OpenRow id={`${id}-ages`} label="Ages" value={ageText} open={open === "ages"} onToggle={() => toggle("ages")} error={errors.ageBands}>
            <div role="group" aria-label={`Adult ages, up to ${LIMITS.maxBands}`} aria-describedby={`${id}-ages-help`} className="flex flex-wrap gap-2">
              {AGE_BUCKETS.map((band: AgeBucket) => {
                const on = values.ageBands.includes(band);
                const blocked = !on && bandsFull;
                return (
                  <button
                    key={band}
                    type="button"
                    aria-pressed={on}
                    disabled={blocked}
                    onClick={() => set("ageBands", on ? values.ageBands.filter((b) => b !== band) : AGE_BUCKETS.filter((b) => b === band || values.ageBands.includes(b)))}
                    className={cn("h-[34px] rounded-[6px] border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-45", on ? "border-fl-ink bg-fl-ink text-white" : "border-fl-line bg-white")}
                  >
                    {ageBandLabel(band)}
                  </button>
                );
              })}
            </div>
            <p id={`${id}-ages-help`} className="mt-2 text-xs text-fl-dim">
              {bandsFull ? `Up to ${LIMITS.maxBands} age bands. Tap one to swap it.` : `Pick up to ${LIMITS.maxBands}. Adults only.`}
            </p>
          </OpenRow>
          <OpenRow id={`${id}-setup`} label="Setup" value={SETTING_LABELS[values.setting]} open={open === "setup"} onToggle={() => toggle("setup")}>
            <div role="radiogroup" aria-label="Setup" className="flex flex-wrap gap-2">
              {(Object.keys(SETTING_LABELS) as Setting[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={values.setting === s}
                  onClick={() => set("setting", s)}
                  className={cn("h-[34px] rounded-[6px] border px-3 text-sm font-medium", values.setting === s ? "border-fl-ink bg-fl-ink text-white" : "border-fl-line bg-white")}
                >
                  {SETTING_LABELS[s]}
                </button>
              ))}
            </div>
          </OpenRow>
          <OpenRow id={`${id}-notes`} label="Notes" value={values.notes || <span className="text-fl-dim">Staff, weather, last time</span>} open={open === "notes"} onToggle={() => toggle("notes")} error={errors.notes}>
            <textarea
              aria-label="Notes"
              rows={3}
              value={values.notes}
              aria-describedby={`${id}-notes-count`}
              onChange={(e) => set("notes", e.target.value)}
              className="w-full rounded-[12px] border border-fl-line bg-white p-2.5 text-[0.9375rem]"
            />
            <p id={`${id}-notes-count`} aria-live="polite" className={cn("mt-1 text-xs tabular-nums", values.notes.length > LIMITS.notes ? "font-medium text-fl-bad" : "text-fl-dim")}>
              {values.notes.length > LIMITS.notes ? `${values.notes.length} of ${LIMITS.notes}: shorten your notes by ${values.notes.length - LIMITS.notes}.` : `${values.notes.length} of ${LIMITS.notes}`}
            </p>
          </OpenRow>
        </ul>
      </Section>
      {send.kind === "error" && (
        <Notice tone="bad" title="The plan didn't start">
          {send.message}
        </Notice>
      )}
    </>
  );

  const side = (
    <>
      <section aria-labelledby={`${id}-sum`} className="flex flex-col gap-2 rounded-[20px] bg-white px-4 py-3.5">
        <h2 id={`${id}-sum`} className="text-[0.9375rem] font-semibold">
          The plan Stoop makes
        </h2>
        <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[0.8125rem]">
          <dt className="text-fl-dim">Store</dt>
          <dd>{store.name}</dd>
          <dt className="text-fl-dim">When</dt>
          <dd>
            {dayText(date)}, {timeRange(values.startTime, Number(values.durationMinutes))}
          </dd>
          <dt className="text-fl-dim">Budget</dt>
          <dd className="tabular-nums">${budget}</dd>
          <dt className="text-fl-dim">Promos</dt>
          <dd>{offersTyped ? `${offersTyped}, word for word` : "None yet"}</dd>
        </dl>
        <p className="border-t border-fl-rule pt-2 text-[0.8125rem] text-pretty text-fl-dim">Music from your city, snacks and prizes from places in your community, a prize wheel and a timeline.</p>
      </section>
      <p className="text-center text-xs text-fl-dim">{note}</p>
      {submitButton}
    </>
  );

  return (
    <>
      <FloorHeader
        left={
          <IconSlot href={backHref} label="Back to your community">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="New event"
        right={
          <IconSlot href="/stores" label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
        store={{ name: store.name, city: `${store.city}, ${store.region}` }}
        step="Create"
        hrefs={steps}
        reasons={reasons}
      />
      <form id={`${id}-form`} noValidate onSubmit={submit} className="contents">
        <TwoColumn main={main} side={side} />
        <ActionBar className="lg:hidden" note={note}>
          {submitButton}
        </ActionBar>
      </form>
    </>
  );
}
