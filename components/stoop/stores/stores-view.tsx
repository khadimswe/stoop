"use client";

import { ImageOff } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { StoreRowView } from "@/lib/plan/view/stores";
import { cn } from "cn";

const ROLES = [
  { id: "store", label: "Store" },
  { id: "multi", label: "Multi-store" },
  { id: "district", label: "District" },
] as const;
type Role = (typeof ROLES)[number]["id"];

function Thumb({ store, className }: { store: StoreRowView; className?: string }) {
  return store.poster ? (
    <Image src={store.poster.src} alt={store.poster.alt} width={216} height={270} unoptimized className={cn("aspect-[4/5] rounded-md bg-fill object-cover", className)} />
  ) : (
    <span className={cn("flex aspect-[4/5] items-center justify-center rounded-md bg-fill text-ink-soft", className)}>
      <ImageOff aria-hidden="true" className="size-4" />
      <span className="sr-only">No poster yet</span>
    </span>
  );
}

/** One store's next event as a card: the multi-store view, and the single-store view's only card. */
function StoreCard({ store, big = false }: { store: StoreRowView; big?: boolean }) {
  return (
    <article className="flex gap-4 rounded-xl border border-hairline bg-surface p-4">
      <Thumb store={store} className={big ? "w-28 shrink-0" : "w-16 shrink-0"} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm text-ink-soft">
          {store.storeName}, {store.city.split(",")[0]}
        </p>
        <h2 className={cn("font-display leading-tight font-extrabold text-balance [font-stretch:85%]", big ? "text-2xl" : "text-lg")}>{store.eventTitle ?? "No plan yet"}</h2>
        <p className="font-mono text-xs">
          {store.dateShort} · {store.timeText}
        </p>
        {store.block && (
          <p className="text-sm">
            <span className="text-ink-soft">Block: </span>
            <span className="font-semibold text-dusk">{store.block}</span>
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <Link href={store.planHref} className="inline-flex min-h-11 items-center font-semibold underline decoration-2 underline-offset-4 hover:decoration-brick sm:min-h-8">
            Open plan<span className="sr-only">: {store.storeName}</span>
          </Link>
          <span className="text-ink-soft">{store.status}</span>
        </div>
      </div>
    </article>
  );
}

/** Every store in one table: the district view. Stacks into rows on phones. */
function DistrictTable({ stores }: { stores: readonly StoreRowView[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-hairline bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">Every store&apos;s next event</caption>
        <thead className="max-md:sr-only">
          <tr className="border-b border-hairline text-left font-mono text-[0.6875rem] tracking-wide text-ink-soft uppercase">
            <th scope="col" className="px-4 py-2.5 font-medium">
              Store
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Next event
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Block
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.slug} className="border-b border-hairline last:border-b-0 max-md:grid max-md:gap-1 max-md:px-4 max-md:py-3">
              <th scope="row" className="text-left font-semibold md:px-4 md:py-3">
                <Link href={s.planHref} className="underline decoration-1 underline-offset-4 hover:decoration-brick">
                  {s.storeName}
                </Link>
                <span className="block text-xs font-normal text-ink-soft">{s.city.split(",")[0]}</span>
              </th>
              <td className="md:px-4 md:py-3">
                <span className="block">{s.eventTitle ?? "No plan yet"}</span>
                <span className="font-mono text-xs text-ink-soft">{s.dateShort}</span>
              </td>
              <td className="md:px-4 md:py-3">{s.block ? <span className="text-dusk">{s.block}</span> : <span className="text-ink-soft">No Qloo place</span>}</td>
              <td className="text-ink-soft md:px-4 md:py-3">{s.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * "My stores", for the three people who plan these events: a store manager (one store), a
 * multi-store manager (a card per store) and a district manager (one table). The switch changes
 * the view, never the data.
 */
export function StoresView({ stores }: { stores: readonly StoreRowView[] }) {
  const [role, setRole] = useState<Role>("multi");
  const first = stores[0];
  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="View as" className="inline-flex self-start rounded-full border-[1.5px] border-concrete-line bg-surface p-1">
        {ROLES.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={role === r.id}
            onClick={() => setRole(r.id)}
            className={cn("min-h-10 rounded-full px-4 text-sm font-semibold", role === r.id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink")}
          >
            {r.label}
          </button>
        ))}
      </div>
      {role === "store" && first && <StoreCard store={first} big />}
      {role === "multi" && (
        <ul className="flex flex-col gap-3">
          {stores.map((s) => (
            <li key={s.slug}>
              <StoreCard store={s} />
            </li>
          ))}
        </ul>
      )}
      {role === "district" && <DistrictTable stores={stores} />}
    </div>
  );
}
