"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { checkRegion, REGION_LIMITS } from "@/lib/run/start";

const CHIP = "inline-flex min-h-11 items-center gap-1.5 rounded-lg border-[1.5px] border-concrete-line bg-surface px-3 text-[0.8125rem] font-semibold text-ink";

/**
 * "Region: United States": where Qloo maps the audience's cities, and the location brand and artist
 * picks lean toward. A small popover with one field; Enter or Done applies it.
 */
export function RegionChip({ region, onChange, disabled }: { region: string; onChange: (region: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(region);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const apply = () => {
    const checked = checkRegion(draft);
    if (!checked.ok) return setError(checked.message);
    onChange(checked.value);
    setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    apply();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setDraft(region);
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" disabled={disabled} className={`${CHIP} hover:bg-fill disabled:opacity-50`}>
          <span>
            Region: <span className="font-medium">{region}</span>
          </span>
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-[min(18rem,calc(100vw-2rem))] gap-3 rounded-xl border border-hairline bg-surface p-4 shadow-l2 ring-0">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-region`} className="text-[0.8125rem] font-semibold">
            Region
          </label>
          <input
            id={`${id}-region`}
            value={draft}
            maxLength={REGION_LIMITS.max}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            className="h-11 rounded-lg border border-concrete-line bg-fill px-3 text-base text-ink"
          />
          <p id={`${id}-hint`} className="text-xs text-ink-soft">
            A country, state or city. Qloo maps where the audience clusters here.
          </p>
          {error && (
            <p id={`${id}-error`} role="alert" className="text-xs font-semibold text-ink">
              {error}
            </p>
          )}
        </div>
        <Button type="button" variant="quiet" onClick={apply} className="self-end">
          Done
        </Button>
      </PopoverContent>
    </Popover>
  );
}
