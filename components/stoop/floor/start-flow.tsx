"use client";

import { ChevronLeft, Loader2, LocateFixed, Search } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CARRIER_LABELS } from "@/lib/plan/view/format";
import { apiMessageOf } from "@/lib/plan/view/live";
import { planView, type PlanView } from "@/lib/plan/view/plan";
import { storeSlug } from "@/lib/plan/view/start-form";
import type { Evidence } from "@/lib/evidence";
import type { Local } from "@/lib/plan/schema";
import { cn } from "cn";
import { BlockScreen } from "./block-screen";
import { CreateScreen, type CreateStore } from "./create-screen";
import { ActionBar, AppBar, BUTTON2, IconSlot, Notice, PRIMARY, RowLabel, ScreenBody, ScreenTitle, Section, Stepper, TEXT_LINK } from "./kit";
import { PinMap } from "./pin-map";

interface Hit {
  address: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  label: string;
}

type Phase = { kind: "store" } | { kind: "finding" } | { kind: "block"; view: PlanView | null; example: { slug: string; message: string } | null } | { kind: "create" };

const FIELD = "h-11 w-full min-w-0 rounded-[12px] border border-fl-line bg-white px-3 text-base text-fl-ink placeholder:text-fl-dim";

/** A plan view of just a block (no plan yet), so the Community step shows it with its receipts. */
function blockView(store: CreateStore, local: Local, ledger: Evidence[]): PlanView {
  return planView({
    id: "block",
    kind: "live",
    createdAt: null,
    provenance: "live",
    inputs: {
      store: { id: storeSlug(store.name, store.city), name: store.name, carrier: store.carrier, address: store.address, city: store.city, region: store.region, point: { lat: store.lat, lon: store.lon } },
      date: new Date().toISOString().slice(0, 10),
      startTime: "12:00",
      durationMinutes: 240,
      setting: "sidewalk_table",
      budgetUsd: 50,
      offers: [],
      ageBands: ["25_to_29", "30_to_34"],
    },
    report: { ledger, local, plan: null, baseline: null, comparison: null, poster: { status: "none", prompt: "", promptHash: "", alt: "" }, posts: null, test: null, results: [], trace: [], stats: { stages: {} }, partial: null, cost: null },
  });
}

/**
 * A new store, from nothing: its name and where it is (an address search or "Use my location", then
 * the pin dragged onto the door; never raw coordinates), then its block (POST /api/plan/block, or an
 * example block when live maps are off), then the event form.
 */
export function StartFlow() {
  const [phase, setPhase] = useState<Phase>({ kind: "store" });
  const [name, setName] = useState("");
  const [carrier, setCarrier] = useState<CreateStore["carrier"]>("metro");
  const [phone, setPhone] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [place, setPlace] = useState<Hit | null>(null);
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  const store: CreateStore | null = place && name.trim() ? { name: name.trim(), address: [place.address, place.city, place.region].filter(Boolean).join(", "), city: place.city, region: place.region, lat: place.lat, lon: place.lon, carrier, phone: phone.trim() || undefined } : null;

  const lookup = async (params: string) => {
    setProblem(null);
    const response = await fetch(`/api/geocode?${params}`, { headers: { accept: "application/json" } });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessageOf(body) ?? "Address search isn't answering. Try again in a minute.");
    return ((body as { hits?: Hit[] } | null)?.hits ?? []) as Hit[];
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (q.trim().length < 4) return setProblem("Type the street address, city and state.");
    setBusy("search");
    try {
      const found = await lookup(`q=${encodeURIComponent(q.trim())}`);
      setHits(found);
      if (found.length === 0) setProblem("No match. Add the city and state, like 1240 W 18th St, Chicago, IL.");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Address search failed.");
    } finally {
      setBusy(null);
    }
  };

  const locate = () => {
    if (!("geolocation" in navigator)) return setProblem("This browser can't share a location. Search the address instead.");
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const found = await lookup(`lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
          const hit = found[0];
          if (hit) setPlace({ ...hit, lat: pos.coords.latitude, lon: pos.coords.longitude });
          else setProblem("Got your location, but no street address for it. Search the address instead.");
        } catch (e) {
          setProblem(e instanceof Error ? e.message : "Couldn't read that location.");
        } finally {
          setBusy(null);
        }
      },
      (err) => {
        setBusy(null);
        setProblem(err.code === err.PERMISSION_DENIED ? "Location is blocked for this site. Search the address instead." : "Couldn't get your location. Search the address instead.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  const seeBlock = async () => {
    if (!name.trim()) return setNameError("Enter the store's name.");
    if (!store) return setProblem("Find the store's address first.");
    setPhase({ kind: "finding" });
    try {
      const response = await fetch("/api/plan/block", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ store: { id: storeSlug(store.name, store.city), name: store.name, carrier: store.carrier, address: store.address, city: store.city, region: store.region, point: { lat: store.lat, lon: store.lon }, ...(store.phone ? { phone: store.phone } : {}) } }),
      });
      const body = (await response.json().catch(() => null)) as { mode?: string; local?: Local; ledger?: Evidence[]; slug?: string; message?: string } | null;
      if (body?.mode === "live" && body.local) return setPhase({ kind: "block", view: blockView(store, body.local, body.ledger ?? []), example: null });
      if (body?.mode === "example" && body.slug) return setPhase({ kind: "block", view: null, example: { slug: body.slug, message: body.message ?? "Live maps are off right now." } });
      setPhase({ kind: "store" });
      setProblem(apiMessageOf(body) ?? "Couldn't map your community right now. Try again in a minute.");
    } catch {
      setPhase({ kind: "store" });
      setProblem("No connection. Try again.");
    }
  };

  if (phase.kind === "create" && store) return <CreateScreen store={store} backHref="/start" onEditStore={() => setPhase({ kind: "store" })} />;

  if (phase.kind === "block" && store) {
    if (phase.view) {
      return (
        <BlockScreen
          storeName={store.name}
          cityLine={`${store.city}, ${store.region}`}
          address={store.address}
          local={phase.view.local}
          uses={{}}
          receipts={phase.view.receipts}
          onCreate={() => setPhase({ kind: "create" })}
          backHref="/start"
          fictional={null}
        />
      );
    }
    return (
      <>
        <AppBar left={<BackButton onClick={() => setPhase({ kind: "store" })} />} title={store.name} subtitle={`${store.city}, ${store.region}`} />
        <Stepper current="Community" />
        <ScreenBody>
          <ScreenTitle title="Your community" meta={store.address} />
          <Notice title="Live maps are off right now">
            {phase.example?.message}{" "}
            <Link href={`/s/${phase.example?.slug}`} className={TEXT_LINK}>
              See an example community
            </Link>
          </Notice>
          <p className="text-sm text-fl-muted">You can still plan your event. Stoop maps the places in your community when live plans are on.</p>
        </ScreenBody>
        <ActionBar>
          <button type="button" onClick={() => setPhase({ kind: "create" })} className={PRIMARY}>
            Create an event
          </button>
        </ActionBar>
      </>
    );
  }

  return (
    <>
      <AppBar
        left={
          <IconSlot href="/" label="Stoop home">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Your store"
      />
      <Stepper current="Community" />
      <ScreenBody>
        <ScreenTitle title="Your store" meta="Where the table goes. Stoop maps the community around it." />
        <ul className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
          <li className="flex flex-col gap-1.5 px-4 py-3">
            <div className="flex min-h-11 items-center gap-3">
              <RowLabel htmlFor="store-name">Name</RowLabel>
              <input
                id="store-name"
                value={name}
                maxLength={80}
                autoComplete="organization"
                placeholder="18th Street Wireless"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "store-name-error" : undefined}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError(null);
                }}
                className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-fl-dim"
              />
            </div>
            {nameError && (
              <p id="store-name-error" className="pl-[4.75rem] text-sm text-fl-bad">
                {nameError}
              </p>
            )}
          </li>
          <li className="flex min-h-[54px] items-center gap-3 px-4 py-2">
            <RowLabel htmlFor="store-carrier">Carrier</RowLabel>
            <select id="store-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as CreateStore["carrier"])} className="min-w-0 flex-1 bg-transparent text-[0.9375rem]">
              {(Object.keys(CARRIER_LABELS) as CreateStore["carrier"][]).map((c) => (
                <option key={c} value={c}>
                  {c === "other" ? "Other" : CARRIER_LABELS[c]}
                </option>
              ))}
            </select>
          </li>
          <li className="flex min-h-[54px] items-center gap-3 px-4 py-2">
            <RowLabel htmlFor="store-phone">Phone</RowLabel>
            <input id="store-phone" type="tel" value={phone} maxLength={24} autoComplete="tel" placeholder="Optional, printed on the poster" onChange={(e) => setPhone(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-fl-dim" />
          </li>
        </ul>

        <Section title="Address">
          {place ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3 rounded-[20px] bg-white px-4 py-3.5">
                <span>
                  <span className="block text-[0.9375rem] font-medium">{place.address || place.label.split(",")[0]}</span>
                  <span className="block text-[0.8125rem] text-fl-dim">
                    {place.city}, {place.region}
                  </span>
                </span>
                <button type="button" onClick={() => setPlace(null)} className={cn(TEXT_LINK, "text-sm")}>
                  Change
                </button>
              </div>
              <PinMap point={{ lat: place.lat, lon: place.lon }} onChange={(p) => setPlace((x) => (x ? { ...x, lat: p.lat, lon: p.lon } : x))} className="h-[220px]" />
              <p className="text-[0.8125rem] text-fl-dim">Drag the pin onto the store&apos;s door, or tap the map.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <form onSubmit={search} role="search" className="flex gap-2">
                <label htmlFor="store-address" className="sr-only">
                  Street address, city and state
                </label>
                <input id="store-address" value={q} onChange={(e) => setQ(e.target.value)} placeholder="1240 W 18th St, Chicago, IL" autoComplete="street-address" className={FIELD} />
                <button type="submit" className={BUTTON2} disabled={busy !== null}>
                  {busy === "search" ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Search aria-hidden="true" />}
                  Find
                </button>
              </form>
              <button type="button" onClick={locate} className={cn(BUTTON2, "self-start")} disabled={busy !== null}>
                {busy === "locate" ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <LocateFixed aria-hidden="true" />}
                Use my location
              </button>
              {hits && hits.length > 0 && (
                <ul aria-label="Matches" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
                  {hits.map((h) => (
                    <li key={`${h.lat},${h.lon}`}>
                      <button type="button" onClick={() => setPlace(h)} className="flex min-h-[54px] w-full flex-col justify-center px-4 py-2.5 text-left hover:bg-fl-sunk">
                        <span className="text-[0.9375rem] font-medium">{h.address || h.label.split(",")[0]}</span>
                        <span className="text-[0.8125rem] text-fl-dim">
                          {h.city}, {h.region}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {problem && (
            <p role="alert" className="text-sm text-fl-bad">
              {problem}
            </p>
          )}
        </Section>
        <p className="text-[0.8125rem] text-fl-dim">
          Just looking?{" "}
          <Link href="/stores" className={TEXT_LINK}>
            See the example stores
          </Link>
        </p>
      </ScreenBody>
      <ActionBar>
        <button type="button" onClick={seeBlock} disabled={phase.kind === "finding"} className={PRIMARY}>
          {phase.kind === "finding" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
          {phase.kind === "finding" ? "Finding your community..." : "See my community"}
        </button>
      </ActionBar>
    </>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label="Back to your store" className="flex size-11 items-center justify-center rounded-[12px] hover:bg-fl-band">
      <ChevronLeft aria-hidden="true" className="size-5" />
    </button>
  );
}
