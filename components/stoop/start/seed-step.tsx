"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import { useId, useMemo, useRef, type FormEvent, type ReactNode, type Ref } from "react";
import { SeedChip } from "@/components/stoop/chip";
import { ReceiptDrawer } from "@/components/stoop/receipt-drawer";
import { Button } from "@/components/ui/button";
import type { IntakeResponse } from "@/lib/api/responses";
import type { Evidence } from "@/lib/evidence";
import type { Seed } from "@/lib/report/schema";
import { priceFrom, seedsReceipt, seedView, siteSpeaksTo } from "@/lib/run/intake-view";
import { RUN_SEEDS, STATED_CUSTOMER_MAX } from "@/lib/run/start";
import { SeedSearch } from "./seed-search";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-sm text-pretty">{children}</dd>
    </div>
  );
}

/**
 * Step 2, "Here's what we found.": the product as the run will use it, "Your site speaks to X" (read
 * from the page, never Qloo's), the seeds with their origins and receipts, removable, plus Qloo
 * autocomplete for more, and "Who do you think buys it?". "Map my audience" is the one brick action.
 */
export function SeedStep({
  intake,
  fromLink,
  region,
  seeds,
  evidence,
  onRemoveSeed,
  onAddSeed,
  stated,
  onStatedChange,
  starting,
  error,
  onBack,
  onStart,
  headingRef,
}: {
  intake: IntakeResponse;
  fromLink: boolean;
  region: string;
  seeds: readonly Seed[];
  evidence: readonly Evidence[];
  onRemoveSeed: (id: string) => void;
  onAddSeed: (seed: Seed, evidence: readonly Evidence[]) => void;
  stated: string;
  onStatedChange: (value: string) => void;
  starting: boolean;
  error: string | null;
  onBack: () => void;
  onStart: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const id = useId();
  const search = useRef<HTMLInputElement>(null);
  const { product, site, notes } = intake;
  const price = priceFrom(product.sellerFacts);
  const speaks = siteSpeaksTo(site);
  const receipt = useMemo(() => seedsReceipt(seeds, evidence), [seeds, evidence]);
  const added = useMemo(() => new Set(seeds.map((s) => s.ref.id)), [seeds]);
  const full = seeds.length >= RUN_SEEDS.max;
  const fromPage = fromLink && !intake.blocked;

  const remove = (seedId: string) => {
    onRemoveSeed(seedId);
    // The chip and its button are gone: keep the keyboard in the seed card.
    search.current?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onStart();
  };

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-sm text-[0.8125rem] font-semibold text-ink-soft hover:text-ink">
        <ArrowLeft aria-hidden="true" className="size-4" />
        {fromLink ? "Edit link" : "Edit description"}
      </button>
      <h1 ref={headingRef} tabIndex={-1} className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%] sm:text-[1.875rem]">
        Here&apos;s what we found.
      </h1>

      <section aria-labelledby={`${id}-page`} className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
        <h2 id={`${id}-page`} className="text-sm font-bold">
          {fromPage ? "From your page" : "From your description"}
        </h2>
        <dl className="flex flex-col gap-2.5">
          <Fact label="Product">{product.name}</Fact>
          {product.brandName && <Fact label="Brand">{product.brandName}</Fact>}
          {price && <Fact label="Price">{price}</Fact>}
          <Fact label="About">{product.oneLine}</Fact>
          <Fact label="Region">{region}</Fact>
          {speaks && (
            <Fact label="Your site speaks to">
              <span className="flex flex-wrap items-center gap-2">
                {speaks}
                <span className="rounded-full border-[1.5px] border-dashed border-concrete-line px-2.5 py-0.5 text-xs font-semibold text-ink-soft">Read from your site · not from Qloo</span>
              </span>
            </Fact>
          )}
        </dl>
        <ul className="flex flex-col gap-1 border-t border-hairline pt-3 font-mono text-xs text-ink-soft">
          {notes.length ? notes.map((note) => <li key={note}>{note}</li>) : <li>{fromLink ? "Read 1 page. If a site blocks reading, Stoop uses your description instead." : "Read from your description."}</li>}
        </ul>
      </section>

      <section aria-labelledby={`${id}-seeds`} className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${id}-seeds`} className="text-sm font-bold">
            Your audience probably also loves these
          </h2>
          <span className="font-mono text-xs text-ink-soft">
            {seeds.length} {seeds.length === 1 ? "seed" : "seeds"} · {RUN_SEEDS.min} to {RUN_SEEDS.max}
          </span>
        </div>
        {seeds.length ? (
          <ul aria-label="Seeds" className="flex flex-wrap gap-2">
            {seeds.map((seed) => {
              const view = seedView(seed);
              return (
                <li key={view.id} className="max-w-full">
                  <SeedChip origin={view.origin} name={view.name} kind={view.kind} onRemove={() => remove(view.id)} />
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">No seeds yet. Add at least {RUN_SEEDS.min} below.</p>
        )}
        <SeedSearch ref={search} intakeId={intake.intakeId} added={added} full={full} onAdd={onAddSeed} />
        <div className="flex flex-col items-start gap-1">
          <p className="text-xs text-ink-soft">Suggestions are checked in Qloo before you see them. Anything Qloo can&apos;t match is dropped.</p>
          {receipt && (
            <ReceiptDrawer receipt={receipt}>
              <button type="button" className="inline-flex min-h-11 items-center rounded-sm text-sm font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick">
                See the receipts
              </button>
            </ReceiptDrawer>
          )}
        </div>
      </section>

      <form noValidate onSubmit={submit} aria-busy={starting} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor={`${id}-stated`} className="text-[0.8125rem] font-semibold">
            Who do you think buys it?
          </label>
          <input
            id={`${id}-stated`}
            value={stated}
            maxLength={STATED_CUSTOMER_MAX}
            onChange={(event) => onStatedChange(event.target.value)}
            placeholder="In your words, e.g. home cooks in their 30s"
            aria-describedby={`${id}-stated-hint`}
            className="h-11 w-full rounded-lg border border-concrete-line bg-fill px-3 text-base text-ink placeholder:text-ink-soft sm:text-sm"
          />
          <p id={`${id}-stated-hint`} className="flex flex-wrap justify-between gap-2 text-xs text-ink-soft">
            <span>Optional. Age, place or taste. The Reality Check sets it against what Qloo measures.</span>
            <span className="font-mono">
              {stated.length} of {STATED_CUSTOMER_MAX}
            </span>
          </p>
        </div>
        {error && (
          <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-ink">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <Button type="submit" disabled={starting} className="w-full sm:w-auto">
            {starting ? "Starting…" : "Map my audience"}
          </Button>
          <span className="text-[0.8125rem] text-ink-soft">About 1 to 2 minutes. You can watch every step.</span>
        </div>
      </form>
    </div>
  );
}
