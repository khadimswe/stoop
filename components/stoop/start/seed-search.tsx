"use client";

import { Plus } from "lucide-react";
import { useId, type KeyboardEvent, type Ref } from "react";
import { useSeedSearch, SEARCH_MIN, SEARCH_MIN_AUTO, type SearchType } from "@/hooks/use-intake";
import type { Evidence } from "@/lib/evidence";
import type { Seed } from "@/lib/report/schema";
import { plainType } from "@/lib/report/view/format";
import { RUN_SEEDS } from "@/lib/run/start";

const TYPES: { value: SearchType; label: string }[] = [
  { value: "brand", label: "Brand" },
  { value: "tv_show", label: "TV show" },
  { value: "artist", label: "Artist" },
  { value: "movie", label: "Movie" },
  { value: "podcast", label: "Podcast" },
  { value: "book", label: "Book" },
  { value: "videogame", label: "Video game" },
];

const FIELD = "h-11 rounded-lg border border-concrete-line bg-fill px-3 text-base text-ink placeholder:text-ink-soft sm:text-sm";

/**
 * "Add a brand, show, artist or podcast": Qloo autocomplete, by type (Qloo search has no person type). Only Qloo's own matches can
 * be added (as "You" seeds, each with its search receipt); a name Qloo can't match adds nothing.
 */
export function SeedSearch({
  intakeId,
  added,
  full,
  onAdd,
  ref,
}: {
  intakeId: string;
  added: ReadonlySet<string>;
  full: boolean;
  onAdd: (seed: Seed, evidence: readonly Evidence[]) => void;
  ref?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  const search = useSeedSearch(intakeId);
  const typeLabel = TYPES.find((t) => t.value === search.type)?.label.toLowerCase() ?? "name";
  const q = search.query.trim();

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    search.searchNow();
  };

  let status = "";
  if (full) status = `That is ${RUN_SEEDS.max} seeds, the most a run takes. Remove one to add another.`;
  else if (search.status === "searching") status = "Searching Qloo…";
  else if (search.status === "error") status = search.message ?? "";
  else if (search.status === "done") status = search.results.length ? `${search.results.length} Qloo ${search.results.length === 1 ? "match" : "matches"}` : `Qloo has no ${typeLabel} matching "${q}". Try another name or type.`;
  else if (q.length > 0 && q.length < SEARCH_MIN_AUTO) status = q.length >= SEARCH_MIN ? "Press Enter to search." : "Keep typing.";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor={`${id}-type`} className="sr-only">
          What to add
        </label>
        <select id={`${id}-type`} value={search.type} onChange={(event) => search.setType(event.target.value as SearchType)} className={`${FIELD} sm:w-36`}>
          {TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-query`} className="sr-only">
          Add a brand, show, artist or podcast
        </label>
        <input
          ref={ref}
          id={`${id}-query`}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Add a brand, show, artist or podcast"
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          disabled={full}
          aria-describedby={`${id}-status`}
          className={`${FIELD} w-full min-w-0 disabled:opacity-60 sm:flex-1`}
        />
      </div>
      <p id={`${id}-status`} role="status" aria-live="polite" className="text-xs text-ink-soft">
        {status}
      </p>
      {!full && search.results.length > 0 && (
        <ul aria-label="Qloo matches" className="overflow-hidden rounded-lg border border-hairline">
          {search.results.map((seed) => {
            const already = added.has(seed.ref.id);
            return (
              <li key={seed.ref.id} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  disabled={already}
                  aria-label={already ? `${seed.ref.name} (${plainType(seed.ref.type)}) added` : `Add ${seed.ref.name} (${plainType(seed.ref.type)})`}
                  onClick={() => onAdd(seed, search.evidence)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-fill disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{seed.ref.name}</span> <span className="font-mono text-xs text-ink-soft">{plainType(seed.ref.type)} · Qloo match</span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold">
                    {already ? (
                      "Added"
                    ) : (
                      <>
                        <Plus aria-hidden="true" className="size-3.5" />
                        Add
                      </>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
