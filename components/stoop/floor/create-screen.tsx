"use client";

import { ChevronDown, ChevronLeft, Loader2, Minus, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/qloo/constants";
import { SETTING_LABELS, timeRange } from "@/lib/plan/view/format";
import { apiMessageOf } from "@/lib/plan/view/live";
import type { PlanNotice } from "@/lib/plan/view/notice";
import { DURATIONS, emptyStoreForm, MAX_OFFERS, nextSaturday, parseStoreForm, PLAN_NOTICE_KEY, type Setting, type StoreField, type StoreFormValues } from "@/lib/plan/view/start-form";
import { ageBandLabel } from "@/lib/types";
import { cn } from "cn";
import { ActionBar, AppBar, Chevron, IconSlot, Notice, PRIMARY, RowLabel, ScreenBody, ScreenTitle, Section, Stepper, type Step } from "./kit";

const noSubscription = () => () => {};
const FIELD = "w-full min-w-0 bg-transparent text-[0.9375rem] text-fl-ink outline-none placeholder:text-fl-dim";
const START_TIMES = Array.from({ length: 27 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);

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

function dayText(iso: string): string {
  if (!iso) return "Pick a day";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : `${h} h ${m} min`;
}

/** A row that opens a field in place, with a chevron. */
function OpenRow({ label, value, open, onToggle, children, error, id }: { label: string; value: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; error?: string; id: string }) {
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-panel`} className="flex min-h-[54px] w-full items-center gap-3 px-4 py-3 text-left">
        <RowLabel>{label}</RowLabel>
        <span className="min-w-0 flex-1 text-[0.9375rem] text-pretty">{value}</span>
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

/**
 * Step 2, a new event: four things in one grouped form (the store, the day, the time, the budget with
 * $50 to start), then the store's promos, used exactly as typed, and the optional rest under "More".
 * "Plan my event" starts the plan (POST /api/plan) or, when live plans are paused, opens an example.
 */
export function CreateScreen({
  store,
  defaults,
  backHref,
  steps,
  onEditStore,
}: {
  store: CreateStore;
  defaults?: Partial<Pick<StoreFormValues, "offers" | "ageBands" | "setting" | "notes" | "startTime" | "durationMinutes" | "budgetUsd">>;
  backHref: string;
  steps?: Partial<Record<Step, string>>;
  onEditStore?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const saturday = useSyncExternalStore(noSubscription, () => nextSaturday(new Date()), () => "");
  const today = useSyncExternalStore(
    noSubscription,
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => "",
  );
  const [values, setValues] = useState<StoreFormValues>(() => ({
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
    ...defaults,
    offers: defaults?.offers?.length ? defaults.offers : [""],
  }));
  const [dateTouched, setDateTouched] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const [send, setSend] = useState<{ kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string }>({ kind: "idle" });
  const date = dateTouched ? values.date : saturday;
  const set = <K extends keyof StoreFormValues>(key: K, value: StoreFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const toggle = (row: string) => setOpen((o) => (o === row ? null : row));
  const budget = Number(values.budgetUsd) || 0;
  const step = (by: number) => set("budgetUsd", String(Math.max(0, Math.min(5000, budget + by))));
  const errorList = Object.values(errors).filter(Boolean);

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

  return (
    <>
      <AppBar
        left={
          <IconSlot href={backHref} label="Back to your community">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="New event"
      />
      <Stepper current="Create" hrefs={steps} />
      <form id={`${id}-form`} noValidate onSubmit={submit} className="contents">
        <ScreenBody>
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
            <OpenRow id={`${id}-day`} label="Day" value={dayText(date)} open={open === "day"} onToggle={() => toggle("day")} error={errors.date}>
              <input
                type="date"
                aria-label="Day of the event"
                value={date}
                min={today || undefined}
                onChange={(e) => {
                  setDateTouched(true);
                  set("date", e.target.value);
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
            <li className="flex min-h-[64px] items-center gap-3 px-4 py-2.5">
              <RowLabel>Budget</RowLabel>
              <span className="flex-1" />
              <button type="button" onClick={() => step(-10)} aria-label="Ten dollars less" className="flex size-11 items-center justify-center rounded-[12px] border border-fl-line bg-white">
                <Minus aria-hidden="true" className="size-4" />
              </button>
              <output aria-live="polite" aria-label="Budget" className="w-16 text-center text-lg font-medium tabular-nums">
                ${budget}
              </output>
              <button type="button" onClick={() => step(10)} aria-label="Ten dollars more" className="flex size-11 items-center justify-center rounded-[12px] border border-fl-line bg-white">
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </li>
          </ul>

          <Section title="Promos" aside="Used exactly as typed">
            <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
              {values.offers.map((offer, i) => (
                <li key={i} className="flex min-h-[54px] items-center gap-2 px-4 py-2">
                  <textarea
                    aria-label={`Promo ${i + 1}`}
                    rows={offer.length > 38 ? 2 : 1}
                    maxLength={140}
                    value={offer}
                    placeholder={i === 0 ? "Like: Free phone when you switch" : "Another promo"}
                    onChange={(e) => set("offers", values.offers.map((o, j) => (j === i ? e.target.value : o)))}
                    aria-invalid={errors[`offer${i}`] ? true : undefined}
                    className={cn(FIELD, "resize-none py-1.5 leading-5")}
                  />
                  {values.offers.length > 1 && (
                    <button type="button" onClick={() => set("offers", values.offers.filter((_, j) => j !== i))} aria-label={`Remove promo ${i + 1}`} className="flex size-11 shrink-0 items-center justify-center rounded-[12px] text-fl-chev hover:bg-fl-sunk">
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  )}
                </li>
              ))}
              {values.offers.length < MAX_OFFERS && (
                <li>
                  <button type="button" onClick={() => set("offers", [...values.offers, ""])} className="flex min-h-[54px] w-full items-center gap-3 px-4 text-[0.9375rem] font-semibold">
                    <Plus aria-hidden="true" className="size-4" />
                    Add a promo
                  </button>
                </li>
              )}
            </ul>
          </Section>

          <Section title="More" aside="Optional">
            <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
              <OpenRow id={`${id}-ages`} label="Ages" value={ageText} open={open === "ages"} onToggle={() => toggle("ages")} error={errors.ageBands}>
                <div role="group" aria-label="Adult ages, up to 3" className="flex flex-wrap gap-2">
                  {AGE_BUCKETS.map((band: AgeBucket) => {
                    const on = values.ageBands.includes(band);
                    return (
                      <button
                        key={band}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("ageBands", on ? values.ageBands.filter((b) => b !== band) : AGE_BUCKETS.filter((b) => b === band || values.ageBands.includes(b)))}
                        className={cn("h-[34px] rounded-[6px] border px-3 text-sm font-medium", on ? "border-fl-ink bg-fl-ink text-white" : "border-fl-line bg-white")}
                      >
                        {ageBandLabel(band)}
                      </button>
                    );
                  })}
                </div>
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
                  maxLength={280}
                  value={values.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  className="w-full rounded-[12px] border border-fl-line bg-white p-2.5 text-[0.9375rem]"
                />
              </OpenRow>
            </ul>
          </Section>
          {send.kind === "error" && (
            <Notice tone="bad" title="The plan didn't start">
              {send.message}
            </Notice>
          )}
        </ScreenBody>
        <ActionBar note="About a minute. Nothing posts anywhere.">
          <button type="submit" className={PRIMARY} disabled={send.kind === "sending"}>
            {send.kind === "sending" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
            {send.kind === "sending" ? "Planning..." : "Plan my event"}
          </button>
        </ActionBar>
      </form>
    </>
  );
}
