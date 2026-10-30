"use client";

import { ChevronLeft, LayoutGrid, Loader2, LocateFixed, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { PLAN_EXAMPLE_INPUTS, PLAN_EXAMPLES } from "@/lib/plan/example-list";
import { CARRIER_LABELS, fictionalNotice } from "@/lib/plan/view/format";
import { apiMessageOf } from "@/lib/plan/view/live";
import { splitMessage } from "@/lib/plan/view/notice";
import { planView, type PlanView } from "@/lib/plan/view/plan";
import { phoneProblem, storeSlug } from "@/lib/plan/view/start-form";
import type { Evidence } from "@/lib/evidence";
import type { Local } from "@/lib/plan/schema";
import { cn } from "cn";
import { BlockMap } from "./block-map";
import { BlockScreen } from "./block-screen";
import { CreateScreen, type CreateStore } from "./create-screen";
import { ActionBar, BUTTON2, Chevron, Fine, FloorHeader, IconSlot, Notice, PRIMARY, RowLabel, ScreenTitle, Section, TEXT_LINK, TwoColumn } from "./kit";
import { PinMap } from "./pin-map";

interface Hit {
  address: string;
  city: string;
  region: string;
  lat: number;
  lon: number;
  label: string;
}

/** What POST /api/plan/block answered: the store's own community, or the example to look at instead. */
type BlockAnswer = { mode: "live"; local: Local; ledger: Evidence[] } | { mode: "example"; slug: string; message: string };
type Phase = { kind: "store" } | { kind: "finding" } | { kind: "block" } | { kind: "create" };

/** The ring Stoop maps around a store: Qloo's places within 1,500 m (lib/plan/requests.ts DEFAULT_RADIUS_M). */
const RING_M = 1500;

/** Hints read as hints: lighter, and starting with "e.g." so nobody takes them for a filled value. */
const HINT = "placeholder:text-fl-dim/70 placeholder:italic";
const FIELD = cn("h-11 w-full min-w-0 rounded-[12px] border border-fl-line bg-white px-3 text-base text-fl-ink", HINT);
const INLINE = cn("min-w-0 flex-1 rounded-[6px] bg-transparent px-1 py-1 text-[0.9375rem]", HINT);
const SAVED_KEY = "stoop:start";
const noSubscription = () => () => {};

interface Saved {
  name: string;
  carrier: CreateStore["carrier"];
  phone: string;
  place: Hit | null;
  create: boolean;
  /** The community the store got, so the Community step opens again without asking twice. */
  block?: BlockAnswer | null;
}

/** What this tab kept. It opens on the form again only when coming back from an example ("?resume"). */
function loadSaved(): Saved | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? "null") as Saved | null;
    if (!v || typeof v.name !== "string") return null;
    return { ...v, create: v.create && new URLSearchParams(window.location.search).has("resume") };
  } catch {
    return null;
  }
}

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
 * example block when live maps are off), then the event form. What was typed is kept for the tab, so
 * coming back (from an example plan, say) finds the store and the form as they were.
 */
export function StartFlow() {
  // The saved store is read on the client only: the server and the first client render match, then
  // the form starts again from what this tab kept. Only that client copy writes back: the first,
  // empty render must never overwrite what the tab kept (so a reload of /start?resume=1 finds it).
  const client = useSyncExternalStore(noSubscription, () => true, () => false);
  return <StartSteps key={client ? "client" : "server"} saved={client ? loadSaved() : null} persist={client} />;
}

function StartSteps({ saved, persist }: { saved: Saved | null; persist: boolean }) {
  const [phase, setPhase] = useState<Phase>(saved?.create && saved.place && saved.name ? { kind: "create" } : { kind: "store" });
  const [block, setBlock] = useState<BlockAnswer | null>(saved?.block ?? null);
  const [name, setName] = useState(saved?.name ?? "");
  const [carrier, setCarrier] = useState<CreateStore["carrier"]>(saved?.carrier ?? "metro");
  const [phone, setPhone] = useState(saved?.phone ?? "");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [place, setPlace] = useState<Hit | null>(saved?.place ?? null);
  const [busy, setBusy] = useState<"search" | "locate" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const store: CreateStore | null = place && name.trim() ? { name: name.trim(), address: [place.address, place.city, place.region].filter(Boolean).join(", "), city: place.city, region: place.region, lat: place.lat, lon: place.lon, carrier, phone: phone.trim() || undefined } : null;

  useEffect(() => {
    if (!persist) return;
    try {
      sessionStorage.setItem(SAVED_KEY, JSON.stringify({ name, carrier, phone, place, create: phase.kind === "create", block } satisfies Saved));
    } catch {
      // Private browsing (or a full store): nothing is kept, the flow still works.
    }
  }, [persist, name, carrier, phone, place, phase.kind, block]);

  const pick = (h: Hit) => {
    setPlace(h);
    setBlock(null);
    setProblem(null);
  };

  const lookup = async (params: string) => {
    setProblem(null);
    const response = await fetch(`/api/geocode?${params}`, { headers: { accept: "application/json" } });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error(apiMessageOf(body) ?? "Address search isn't answering. Try again in a minute.");
    return ((body as { hits?: Hit[] } | null)?.hits ?? []) as Hit[];
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const text = q.trim();
    if (text.length < 4) return setProblem("Type the street address, city and state.");
    if (/\bp\.?\s*o\.?\s*box\b/i.test(text)) return setProblem("Use the store's street address, not a PO box: the community is mapped around the door.");
    setBusy("search");
    try {
      const found = await lookup(`q=${encodeURIComponent(text)}`);
      setHits(found);
      if (found.length === 0) setProblem("No match. Stoop works with US store addresses for now. Add the city and state, like 1240 W 18th St, Chicago, IL.");
      else if (found.length > 0) setProblem(null);
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
          if (hit) pick({ ...hit, lat: pos.coords.latitude, lon: pos.coords.longitude });
          else setProblem("Got your location, but no US street address for it. Search the address instead.");
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
    const badName = name.trim() ? null : "Enter the store's name.";
    const badPhone = phoneProblem(phone);
    setNameError(badName);
    setPhoneError(badPhone);
    if (badName || badPhone) return;
    if (!place) return setProblem(hits && hits.length > 0 ? "Pick the store's address from the matches above." : "Find the store's address first.");
    if (!store) return;
    setPhase({ kind: "finding" });
    try {
      const response = await fetch("/api/plan/block", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ store: { id: storeSlug(store.name, store.city), name: store.name, carrier: store.carrier, address: store.address, city: store.city, region: store.region, point: { lat: store.lat, lon: store.lon }, ...(store.phone ? { phone: store.phone } : {}) } }),
      });
      const body = (await response.json().catch(() => null)) as { mode?: string; local?: Local; ledger?: Evidence[]; slug?: string; message?: string; field?: string; error?: { field?: string } } | null;
      if (body?.mode === "live" && body.local) {
        setBlock({ mode: "live", local: body.local, ledger: body.ledger ?? [] });
        return setPhase({ kind: "block" });
      }
      if (body?.mode === "example" && body.slug) {
        setBlock({ mode: "example", slug: body.slug, message: body.message ?? "Live maps are off right now." });
        return setPhase({ kind: "block" });
      }
      setPhase({ kind: "store" });
      // A refused field is said on that field.
      const field = body?.error?.field ?? body?.field;
      const message = apiMessageOf(body) ?? "Couldn't map your community right now. Try again in a minute.";
      if (field && /phone/i.test(field)) setPhoneError(message);
      else if (field && /name/i.test(field)) setNameError(message);
      else setProblem(message);
    } catch {
      setPhase({ kind: "store" });
      setProblem("No connection. Try again.");
    }
  };

  const draftKey = store ? storeSlug(store.name, store.city) : undefined;
  const create = () => setPhase({ kind: "create" });
  // The Community step, from the form: the community this store already got, else ask again.
  const community = () => (block ? setPhase({ kind: "block" }) : void seeBlock());
  if (phase.kind === "create" && store)
    return <CreateScreen store={store} backHref="/start?resume=1" onEditStore={() => setPhase({ kind: "store" })} draftKey={draftKey} stepActions={{ Community: community }} />;

  if (phase.kind === "block" && store && block) {
    if (block.mode === "live") return <LiveBlock store={store} answer={block} onCreate={create} />;
    return <ExampleBlock store={store} answer={block} onBack={() => setPhase({ kind: "store" })} onCreate={create} />;
  }

  const primary = (
    <button type="button" onClick={seeBlock} disabled={phase.kind === "finding"} className={PRIMARY}>
      {phase.kind === "finding" && <Loader2 aria-hidden="true" className="motion-safe:animate-spin" />}
      {phase.kind === "finding" ? "Finding your community..." : "See my community"}
    </button>
  );

  const main = (
    <>
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
              placeholder="e.g. 18th Street Wireless"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "store-name-error" : undefined}
              onChange={(e) => {
                setName(e.target.value);
                if (e.target.value.trim()) setNameError(null);
              }}
              className={INLINE}
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
          <select id="store-carrier" value={carrier} onChange={(e) => setCarrier(e.target.value as CreateStore["carrier"])} className="min-w-0 flex-1 rounded-[6px] bg-transparent py-1 text-[0.9375rem]">
            {(Object.keys(CARRIER_LABELS) as CreateStore["carrier"][]).map((c) => (
              <option key={c} value={c}>
                {c === "other" ? "Other" : CARRIER_LABELS[c]}
              </option>
            ))}
          </select>
        </li>
        <li className="flex flex-col gap-1.5 px-4 py-2">
          <div className="flex min-h-[38px] items-center gap-3">
            <RowLabel htmlFor="store-phone">Phone</RowLabel>
            <input
              id="store-phone"
              type="tel"
              inputMode="tel"
              value={phone}
              maxLength={24}
              autoComplete="tel"
              placeholder="Optional, printed on the poster"
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? "store-phone-error" : undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                if (phoneError && !phoneProblem(e.target.value)) setPhoneError(null);
              }}
              onBlur={() => setPhoneError(phoneProblem(phone))}
              className={INLINE}
            />
          </div>
          {phoneError && (
            <p id="store-phone-error" className="pl-[4.75rem] text-sm text-fl-bad">
              {phoneError}
            </p>
          )}
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
              <button
                type="button"
                onClick={() => {
                  setPlace(null);
                  setBlock(null);
                }}
                className={cn(TEXT_LINK, "text-sm")}
              >
                Change
              </button>
            </div>
            <PinMap
              point={{ lat: place.lat, lon: place.lon }}
              onChange={(p) => {
                setPlace((x) => (x ? { ...x, lat: p.lat, lon: p.lon } : x));
                setBlock(null);
              }}
              className="h-[220px] lg:h-[280px]"
            />
            <p className="text-[0.8125rem] text-fl-dim">Drag the pin onto the store&apos;s door, or tap the map.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <form onSubmit={search} role="search" className="flex gap-2">
              <label htmlFor="store-address" className="sr-only">
                Street address, city and state
              </label>
              <input id="store-address" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 1240 W 18th St, Chicago, IL" autoComplete="street-address" className={FIELD} />
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
              <div className="flex flex-col gap-1.5">
                <p className="text-[0.8125rem] text-fl-dim">{hits.length === 1 ? "Is this the store? Tap it to use it." : "Tap the store's address."}</p>
                <ul aria-label="Matches" className="overflow-hidden rounded-[20px] bg-white [&>li+li]:border-t [&>li+li]:border-fl-rule">
                  {hits.map((h) => (
                    <li key={`${h.lat},${h.lon}`}>
                      <button type="button" onClick={() => pick(h)} className="flex min-h-[54px] w-full flex-col justify-center px-4 py-2.5 text-left hover:bg-fl-sunk">
                        <span className="text-[0.9375rem] font-medium">{h.address || h.label.split(",")[0]}</span>
                        <span className="text-[0.8125rem] text-fl-dim">
                          {h.city}, {h.region}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
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
    </>
  );

  const side = (
    <>
      <section aria-labelledby="start-next" className="flex flex-col gap-2 rounded-[20px] bg-white px-4 py-3.5">
        <h2 id="start-next" className="text-[0.9375rem] font-semibold">
          What happens next
        </h2>
        <ol className="flex flex-col gap-1.5 text-[0.8125rem] text-fl-muted">
          <li>
            <b className="font-semibold text-fl-ink">1 Community.</b> Places within about a mile of the door, from Qloo.
          </li>
          <li>
            <b className="font-semibold text-fl-ink">2 Create.</b> The day, the budget and your promos.
          </li>
          <li>
            <b className="font-semibold text-fl-ink">3 to 5.</b> The plan, the poster and the posts. Nothing posts until you approve it.
          </li>
        </ol>
      </section>
      {primary}
    </>
  );

  return (
    <>
      <FloorHeader
        left={
          <IconSlot href="/" label="Stoop home">
            <ChevronLeft aria-hidden="true" />
          </IconSlot>
        }
        title="Your store"
        right={
          <IconSlot href="/stores" label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
        step="Community"
      />
      <TwoColumn main={main} side={side} />
      <ActionBar className="lg:hidden">{primary}</ActionBar>
    </>
  );
}

/** The store's own community (live maps on), with its receipts. */
function LiveBlock({ store, answer, onCreate }: { store: CreateStore; answer: Extract<BlockAnswer, { mode: "live" }>; onCreate: () => void }) {
  const view = useMemo(() => blockView(store, answer.local, answer.ledger), [store, answer]);
  return (
    <BlockScreen
      storeName={store.name}
      cityLine={`${store.city}, ${store.region}`}
      address={store.address}
      local={view.local}
      uses={{}}
      receipts={view.receipts}
      onCreate={onCreate}
      stepActions={{ Create: onCreate }}
      backHref="/start"
      fictional={null}
    />
  );
}

/**
 * Live maps are off: the store's own spot on the map (the point picked from the address), the
 * server's note said once, and the nearest example store's community one tap away. The event form is
 * still the next step.
 */
function ExampleBlock({ store, answer, onBack, onCreate }: { store: CreateStore; answer: Extract<BlockAnswer, { mode: "example" }>; onBack: () => void; onCreate: () => void }) {
  const said = splitMessage(answer.message);
  const example = PLAN_EXAMPLES.find((e) => e.slug === answer.slug);
  const inputs = example ? PLAN_EXAMPLE_INPUTS[example.slug] : null;
  const cityLine = `${store.city}, ${store.region}`;
  const primary = (
    <button type="button" onClick={onCreate} className={PRIMARY}>
      Create an event
    </button>
  );
  const main = (
    <>
      <ScreenTitle title="Your community" meta={store.address} />
      <BlockMap
        center={{ lat: store.lat, lon: store.lon, label: "Your store" }}
        radiusM={RING_M}
        places={[]}
        interactive={false}
        className="h-[240px] lg:h-[320px]"
        label={`Map of where ${store.name} is, with the ring of about a mile Stoop maps around it`}
      />
      <Notice title={said.title}>Stoop maps the places within about a mile of your store when live plans are on. Until then, look around the nearest example store&apos;s community, or go on and plan your event.</Notice>
      {example && inputs && (
        <Section title="Nearest example community">
          <Link href={`/s/${example.slug}`} className="flex min-h-[54px] items-center gap-3 rounded-[20px] bg-white px-4 py-3 hover:bg-fl-sunk">
            <span className="min-w-0 flex-1">
              <span className="block text-[0.9375rem] leading-5 font-medium">See {example.storeName}&apos;s community</span>
              <span className="mt-px block text-[0.8125rem] leading-[18px] text-fl-dim">
                An example store in {inputs.store.city}, {inputs.store.region}, with its places from Qloo
              </span>
            </span>
            <Chevron />
          </Link>
          <Fine>{fictionalNotice(inputs.store.carrier)}</Fine>
        </Section>
      )}
    </>
  );
  return (
    <>
      <FloorHeader
        left={<BackButton onClick={onBack} />}
        title={store.name}
        subtitle={cityLine}
        store={{ name: store.name, city: cityLine }}
        right={
          <IconSlot href="/stores" label="My stores">
            <LayoutGrid aria-hidden="true" />
          </IconSlot>
        }
        step="Community"
        actions={{ Create: onCreate }}
      />
      <TwoColumn main={main} side={primary} />
      <ActionBar className="lg:hidden">{primary}</ActionBar>
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
