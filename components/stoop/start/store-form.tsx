"use client";

import { Loader2, LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AGE_BUCKETS, type AgeBucket } from "@/lib/qloo/constants";
import { CARRIER_LABELS, SETTING_LABELS } from "@/lib/plan/view/format";
import {
  DURATIONS,
  LIMITS,
  PLAN_NOTICE_KEY,
  coordText,
  emptyStoreForm,
  firstError,
  nextSaturday,
  parseStoreForm,
  type Carrier,
  type Setting,
  type StoreField,
  type StoreFormValues,
} from "@/lib/plan/view/start-form";
import { ageBandLabel } from "@/lib/types";
import { cn } from "cn";

const FIELD =
  "h-11 w-full rounded-lg border border-concrete-line bg-surface px-3 text-base text-ink outline-none placeholder:text-ink-soft focus-visible:border-dusk focus-visible:ring-3 focus-visible:ring-dusk/30 aria-invalid:border-rose-deep";

const noSubscription = () => () => {};

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string };
type LocateState = { kind: "idle" } | { kind: "locating" } | { kind: "error"; message: string } | { kind: "done" };

const SETTING_HINTS: Record<Setting, string> = {
  sidewalk_table: "A table outside the store",
  in_store: "Inside, on the floor",
  nearby_venue: "A park, theater or spot nearby",
  community_event: "A booth at a fair, festival or block party",
};

function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} ${h === 1 ? "hour" : "hours"}` : `${h} hours ${m} minutes`;
}

/** The API's own words when it sends them, else a plain line for the status. */
async function apiMessage(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") return body.message;
  if (response.status === 429) return "Live plans are paused for today. Try an example store instead.";
  return "Stoop could not start this plan. Try again in a minute.";
}

/**
 * The store form: the store, where it is, the event, the manager's own offers, the adult age bands and
 * notes. It checks itself in plain words, then starts a plan (POST /api/plan) and goes to its page, or
 * to an example store with the API's message when live plans are paused.
 */
export function StoreForm() {
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<StoreFormValues>(emptyStoreForm);
  const [dateTouched, setDateTouched] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<StoreField, string>>>({});
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [locate, setLocate] = useState<LocateState>({ kind: "idle" });
  const form = useRef<HTMLFormElement>(null);
  // This Saturday, read on the client only (the page is a static shell).
  const saturday = useSyncExternalStore(noSubscription, () => nextSaturday(new Date()), () => "");
  const today = useSyncExternalStore(
    noSubscription,
    () => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    },
    () => "",
  );
  const date = dateTouched ? values.date : saturday;

  const set = <K extends keyof StoreFormValues>(key: K, value: StoreFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));
  const fid = (field: StoreField) => `${id}-${field}`;
  const errorProps = (field: StoreField, extra?: string) => ({
    "aria-invalid": errors[field] ? true : undefined,
    "aria-describedby": [extra, errors[field] ? `${fid(field)}-error` : null].filter(Boolean).join(" ") || undefined,
  });

  const locateStore = () => {
    if (!("geolocation" in navigator)) return setLocate({ kind: "error", message: "This browser can't share a location. Type the coordinates instead." });
    setLocate({ kind: "locating" });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setValues((v) => ({ ...v, lat: coordText(pos.coords.latitude), lon: coordText(pos.coords.longitude) }));
        setErrors((e) => ({ ...e, point: undefined, lat: undefined, lon: undefined }));
        setLocate({ kind: "done" });
      },
      (err) =>
        setLocate({
          kind: "error",
          message: err.code === err.PERMISSION_DENIED ? "Location is blocked for this site. Type the coordinates instead." : "Couldn't get a location. Type the coordinates instead.",
        }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseStoreForm({ ...values, date }, today || undefined);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      const first = firstError(parsed.errors);
      const target = first === "point" ? `${fid("lat")}` : first === "ageBands" ? `${fid("ageBands")}-0` : first === "setting" ? `${fid("setting")}-0` : first ? fid(first) : null;
      if (target) form.current?.querySelector<HTMLElement>(`#${CSS.escape(target)}`)?.focus();
      return;
    }
    setErrors({});
    setSend({ kind: "sending" });
    try {
      const response = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.inputs) });
      if (!response.ok) return setSend({ kind: "error", message: await apiMessage(response) });
      const body = (await response.json().catch(() => null)) as { mode?: string; id?: string; slug?: string; message?: string } | null;
      if (body?.mode === "live" && body.id) return router.push(`/plan/${encodeURIComponent(body.id)}`);
      if (body?.mode === "example" && body.slug) {
        try {
          if (body.message) sessionStorage.setItem(PLAN_NOTICE_KEY, body.message);
        } catch {
          // Private browsing: the example still opens, without the note.
        }
        return router.push(`/examples/stores/${encodeURIComponent(body.slug)}`);
      }
      setSend({ kind: "error", message: "Stoop could not start this plan. Try again in a minute." });
    } catch {
      setSend({ kind: "error", message: "No connection. Your answers are still here: try again." });
    }
  };

  const toggleBand = (band: AgeBucket, on: boolean) => set("ageBands", on ? AGE_BUCKETS.filter((b) => b === band || values.ageBands.includes(b)) : values.ageBands.filter((b) => b !== band));

  return (
    <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-8">
      <Group title="The store" description="Example stores are fictional. Stoop names your carrier in text and never draws its logo.">
        <Field id={fid("storeName")} label="Store name" error={errors.storeName}>
          <input id={fid("storeName")} value={values.storeName} maxLength={LIMITS.storeName} onChange={(e) => set("storeName", e.target.value)} autoComplete="organization" className={FIELD} {...errorProps("storeName")} />
        </Field>
        <Field id={fid("carrier")} label="Carrier" error={errors.carrier}>
          <select id={fid("carrier")} value={values.carrier} onChange={(e) => set("carrier", e.target.value as Carrier)} className={cn(FIELD, "pr-8")} {...errorProps("carrier")}>
            {(Object.keys(CARRIER_LABELS) as Carrier[]).map((c) => (
              <option key={c} value={c}>
                {c === "other" ? "Other" : CARRIER_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        <Field id={fid("address")} label="Street address" error={errors.address}>
          <input id={fid("address")} value={values.address} maxLength={LIMITS.address} onChange={(e) => set("address", e.target.value)} autoComplete="street-address" className={FIELD} {...errorProps("address")} />
        </Field>
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-3">
          <Field id={fid("city")} label="City" hint="Qloo reads the music by city name" error={errors.city}>
            <input id={fid("city")} value={values.city} maxLength={LIMITS.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" className={FIELD} {...errorProps("city", `${fid("city")}-hint`)} />
          </Field>
          <Field id={fid("region")} label="State" error={errors.region}>
            <input id={fid("region")} value={values.region} maxLength={LIMITS.region} onChange={(e) => set("region", e.target.value)} autoComplete="address-level1" className={FIELD} {...errorProps("region")} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-3" aria-describedby={`${fid("point")}-hint${errors.point ? ` ${fid("point")}-error` : ""}`}>
          <legend className="mb-1 text-sm font-semibold">Where the store is</legend>
          <p id={`${fid("point")}-hint`} className="-mt-1 text-xs text-ink-soft">
            Qloo finds the food spots, venues and parks around this point. At the store, tap Use my location. Anywhere else, copy the coordinates from any map.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="quiet" onClick={locateStore} disabled={locate.kind === "locating"}>
              {locate.kind === "locating" ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <LocateFixed aria-hidden="true" />}
              Use my location
            </Button>
            <span role="status" aria-live="polite" className={cn("text-sm", locate.kind === "error" ? "text-rose-deep" : "text-ink-soft")}>
              {locate.kind === "error" ? locate.message : locate.kind === "done" ? "Location added. Check it's the store." : ""}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field id={fid("lat")} label="Latitude" error={errors.lat}>
              <input id={fid("lat")} inputMode="decimal" placeholder="41.85760" value={values.lat} onChange={(e) => set("lat", e.target.value)} className={cn(FIELD, "font-mono")} {...errorProps("lat")} />
            </Field>
            <Field id={fid("lon")} label="Longitude" error={errors.lon}>
              <input id={fid("lon")} inputMode="decimal" placeholder="-87.65660" value={values.lon} onChange={(e) => set("lon", e.target.value)} className={cn(FIELD, "font-mono")} {...errorProps("lon")} />
            </Field>
          </div>
          {errors.point && <ErrorText id={`${fid("point")}-error`}>{errors.point}</ErrorText>}
        </fieldset>
      </Group>

      <Group title="The event">
        <div className="grid grid-cols-2 gap-3">
          <Field id={fid("date")} label="Day" error={errors.date}>
            <input
              id={fid("date")}
              type="date"
              value={date}
              min={today || undefined}
              onChange={(e) => {
                setDateTouched(true);
                set("date", e.target.value);
              }}
              className={FIELD}
              {...errorProps("date")}
            />
          </Field>
          <Field id={fid("startTime")} label="Start time" error={errors.startTime}>
            <input id={fid("startTime")} type="time" step={900} value={values.startTime} onChange={(e) => set("startTime", e.target.value)} className={FIELD} {...errorProps("startTime")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field id={fid("durationMinutes")} label="How long" error={errors.durationMinutes}>
            <select id={fid("durationMinutes")} value={values.durationMinutes} onChange={(e) => set("durationMinutes", e.target.value)} className={cn(FIELD, "pr-8")} {...errorProps("durationMinutes")}>
              {DURATIONS.map((m) => (
                <option key={m} value={String(m)}>
                  {durationLabel(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={fid("budgetUsd")} label="Budget (dollars)" hint="Snacks, supplies, partners" error={errors.budgetUsd}>
            <input id={fid("budgetUsd")} inputMode="numeric" value={values.budgetUsd} onChange={(e) => set("budgetUsd", e.target.value)} className={FIELD} {...errorProps("budgetUsd", `${fid("budgetUsd")}-hint`)} />
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2" aria-describedby={errors.setting ? `${fid("setting")}-error` : undefined}>
          <legend className="mb-1 text-sm font-semibold">Where it happens</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(SETTING_LABELS) as Setting[]).map((s, i) => (
              <label
                key={s}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                  values.setting === s ? "border-ink bg-surface" : "border-concrete-line bg-surface",
                )}
              >
                <input id={`${fid("setting")}-${i}`} type="radio" name={`${id}-setting`} value={s} checked={values.setting === s} onChange={() => set("setting", s)} className="mt-0.5 size-4 shrink-0 accent-ink" />
                <span className="flex flex-col">
                  <span className="font-semibold">{SETTING_LABELS[s]}</span>
                  <span className="text-xs text-ink-soft">{SETTING_HINTS[s]}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.setting && <ErrorText id={`${fid("setting")}-error`}>{errors.setting}</ErrorText>}
        </fieldset>
      </Group>

      <Group title="Your offers" description="Up to 3, word for word. Stoop never invents a deal: the poster and posts use only what you type here.">
        {values.offers.map((offer, i) => {
          const field = `offer${i}` as StoreField;
          return (
            <Field key={i} id={fid(field)} label={`Offer ${i + 1}`} optional error={errors[field]}>
              <input
                id={fid(field)}
                value={offer}
                maxLength={LIMITS.offer}
                placeholder={i === 0 ? "Like: Free case with any new line" : undefined}
                onChange={(e) => set("offers", values.offers.map((o, j) => (j === i ? e.target.value : o)) as StoreFormValues["offers"])}
                className={FIELD}
                {...errorProps(field)}
              />
            </Field>
          );
        })}
      </Group>

      <Group title="Who it's for" description="Adults only: events never aim at minors. Pick up to 3 age bands; Qloo reads your city's music for them.">
        <fieldset className="flex flex-col gap-2" aria-describedby={errors.ageBands ? `${fid("ageBands")}-error` : undefined}>
          <legend className="sr-only">Age bands</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {AGE_BUCKETS.map((band, i) => {
              const on = values.ageBands.includes(band);
              return (
                <label
                  key={band}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border px-3 text-sm font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    on ? "border-ink bg-surface" : "border-concrete-line bg-surface",
                  )}
                >
                  <input id={`${fid("ageBands")}-${i}`} type="checkbox" checked={on} onChange={(e) => toggleBand(band, e.target.checked)} className="size-5 shrink-0 accent-ink" />
                  {ageBandLabel(band)}
                </label>
              );
            })}
          </div>
          {errors.ageBands && <ErrorText id={`${fid("ageBands")}-error`}>{errors.ageBands}</ErrorText>}
        </fieldset>
      </Group>

      <Group title="Notes" description="Anything Stoop should know: the block, what worked last time. Read as your words, never as instructions.">
        <Field id={fid("notes")} label="Notes" hideLabel optional error={errors.notes} hint={`${values.notes.length} of ${LIMITS.notes} characters`}>
          <textarea
            id={fid("notes")}
            rows={3}
            maxLength={LIMITS.notes}
            value={values.notes}
            onChange={(e) => set("notes", e.target.value)}
            className={cn(FIELD, "h-auto py-2")}
            {...errorProps("notes", `${fid("notes")}-hint`)}
          />
        </Field>
      </Group>

      <div className="flex flex-col gap-3 border-t border-hairline pt-6">
        {Object.keys(errors).some((k) => errors[k as StoreField]) && (
          <p className="text-sm text-rose-deep">Check the fields marked above.</p>
        )}
        <Button type="submit" size="lg" className="self-stretch sm:self-start" disabled={send.kind === "sending"}>
          {send.kind === "sending" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
          {send.kind === "sending" ? "Starting your plan..." : "Plan this event"}
        </Button>
        <p role="status" aria-live="polite" className={cn("text-sm", send.kind === "error" ? "text-rose-deep" : "text-ink-soft")}>
          {send.kind === "error" ? send.message : "About a minute. Nothing posts anywhere: you get drafts to check and share."}
        </p>
      </div>
    </form>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-display text-xl leading-tight font-extrabold [font-stretch:85%]">
          {title}
        </h2>
        {description && <p className="text-sm text-ink-soft">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ id, label, hint, error, optional, hideLabel, children }: { id: string; label: string; hint?: string; error?: string; optional?: boolean; hideLabel?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={cn("text-sm font-semibold", hideLabel && "sr-only")}>
        {label}
        {optional && <span className="font-normal text-ink-soft"> (optional)</span>}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-ink-soft">
          {hint}
        </p>
      )}
      {error && <ErrorText id={`${id}-error`}>{error}</ErrorText>}
    </div>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="text-sm text-rose-deep">
      {children}
    </p>
  );
}
