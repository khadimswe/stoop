"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FloorMark } from "@/components/stoop/floor/kit";
import { cn } from "cn";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#examples", label: "Examples" },
  { href: "/judges", label: "For judges" },
] as const;

/**
 * The landing's 72 px nav: the wordmark, three links and "Plan an event". The button waits until the
 * hero (which has its own) scrolls away, so a screen never shows the same action twice. No sign in:
 * there are no accounts.
 */
export function HomeNav({ heroId }: { heroId?: string }) {
  const [heroVisible, setHeroVisible] = useState(Boolean(heroId));
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const hero = heroId ? document.getElementById(heroId) : null;
    if (!hero) return;
    const io = new IntersectionObserver(([e]) => setHeroVisible(Boolean(e?.isIntersecting)), { rootMargin: "-72px 0px 0px 0px" });
    io.observe(hero);
    return () => io.disconnect();
  }, [heroId]);
  return (
    <header className="sticky top-0 z-40 border-b border-transparent bg-fl-page/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-[1248px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-[6px]" aria-label="Stoop home">
          <FloorMark />
          <span className="text-[1.0625rem] font-semibold tracking-tight">Stoop</span>
        </Link>
        <ul className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="rounded-[6px] px-3 py-2 text-sm font-medium text-fl-muted hover:text-fl-ink">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/start"
            aria-hidden={heroVisible || undefined}
            tabIndex={heroVisible ? -1 : undefined}
            className={cn(
              "inline-flex h-10 items-center rounded-[12px] bg-fl-ink px-4 text-sm font-semibold text-white transition-opacity motion-reduce:transition-none",
              heroVisible && "pointer-events-none opacity-0",
            )}
          >
            Plan an event
          </Link>
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="home-menu" aria-label={open ? "Close menu" : "Open menu"} className="flex size-11 items-center justify-center rounded-[12px] md:hidden">
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <ul id="home-menu" className="flex flex-col border-t border-fl-rule bg-fl-page px-4 py-2 md:hidden">
          {[...LINKS, { href: "/stores", label: "My stores" }].map((l) => (
            <li key={l.href}>
              <Link href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center text-base font-medium">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}
