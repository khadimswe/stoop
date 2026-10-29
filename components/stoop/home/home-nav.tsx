"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FloorMark } from "@/components/stoop/floor/kit";

const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#examples", label: "Examples" },
  { href: "/judges", label: "For judges" },
  { href: "/stores", label: "My stores" },
] as const;

/**
 * The landing's 72 px nav, on a solid page-colored bar so nothing shows through it: the wordmark, four
 * links and the ink "Plan an event". Phones fold the links into a menu. No sign in: there are no accounts.
 */
export function HomeNav() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Escape closes the menu and puts focus back on its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="sticky top-0 z-40 border-b border-fl-rule bg-fl-page">
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-[1248px] items-center gap-6 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 rounded-[6px]" aria-label="Stoop home">
          <FloorMark />
          <span className="text-[1.0625rem] font-semibold tracking-tight">Stoop</span>
        </Link>
        <div className="ml-auto flex items-center gap-2 md:gap-6">
          <ul className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="rounded-[6px] px-3 py-2 text-sm font-medium text-fl-muted hover:text-fl-ink">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/start" className="inline-flex h-10 items-center rounded-[12px] bg-fl-ink px-4 text-sm font-semibold whitespace-nowrap text-white hover:bg-[#2a2a2e]">
            Plan an event
          </Link>
          <button
            ref={button}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="home-menu"
            aria-label={open ? "Close menu" : "Open menu"}
            className="-mr-2 flex size-11 items-center justify-center rounded-[12px] md:hidden"
          >
            {open ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
      </nav>
      {open && (
        <ul id="home-menu" className="flex flex-col border-t border-fl-rule bg-fl-page px-4 py-2 md:hidden">
          {LINKS.map((l) => (
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
