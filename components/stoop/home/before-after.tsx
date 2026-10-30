import Image from "next/image";
import { AI_PREVIEW_LABEL, beforeAfterItems } from "@/lib/marketing/before-after";
import type { BeforeAfter as Config } from "@/lib/marketing/pilot";
import { cn } from "cn";

/**
 * "Before and after", from the pilot: the usual table and the table Stoop planned, side by side
 * (stacked on phones), each tagged and captioned, then an optional AI preview that always says it is
 * one. Plain images: nothing to drag, both are always in view. Null renders nothing.
 */
export function BeforeAfter({ config }: { config: Config | null }) {
  const items = beforeAfterItems(config);
  if (!items.length) return null;
  return (
    <section aria-labelledby="before-after-title" className="mx-auto mt-16 flex w-full max-w-[1248px] flex-col gap-6 px-4 sm:px-8 lg:mt-24">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold tracking-[0.02em] text-fl-dim">From the pilot</p>
        <h2 id="before-after-title" className="font-serif text-[1.75rem] leading-[1.1] font-normal text-balance lg:text-[2.5rem]">
          The usual table, and the one Stoop planned.
        </h2>
      </div>
      <ul className="grid gap-6 md:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} className={cn(item.key === "preview" && "md:col-span-2 md:max-w-[calc(50%-0.75rem)]")}>
            <figure className="flex flex-col gap-2.5">
              <div className="relative overflow-hidden rounded-[20px] bg-fl-band">
                <Image src={item.src} alt={item.alt} width={1600} height={1200} unoptimized loading="lazy" className="aspect-[4/3] h-auto w-full object-cover" />
                <span
                  className={cn(
                    "absolute top-3 left-3 inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold",
                    item.label === AI_PREVIEW_LABEL ? "bg-fl-ink text-white" : "border border-fl-line bg-white text-fl-ink",
                  )}
                >
                  {item.label === AI_PREVIEW_LABEL && <i aria-hidden="true" className="block size-2 rounded-[2px] bg-fl-signal" />}
                  {item.label}
                </span>
              </div>
              <figcaption className="text-sm text-fl-muted">{item.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
