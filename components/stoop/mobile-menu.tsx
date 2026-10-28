"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV_LINKS, PLAN_LINK } from "./nav-links";

/** The phone menu: the opener and Close are 44 px tap targets, as are the links. */
export function MobileMenu() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 md:hidden" aria-label="Open menu">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" aria-describedby={undefined} showCloseButton={false} className="w-72 border-l border-hairline bg-surface p-6">
        <SheetTitle className="sr-only">Menu</SheetTitle>
        <nav aria-label="Mobile">
          <ul className="mt-8 flex flex-col gap-1">
            {[PLAN_LINK, ...NAV_LINKS].map((link) => (
              <li key={link.href}>
                <SheetClose asChild>
                  <Link href={link.href} className="block rounded-xl px-3 py-3 text-lg font-semibold text-ink hover:bg-ink/5">
                    {link.label}
                  </Link>
                </SheetClose>
              </li>
            ))}
          </ul>
        </nav>
        {/* Last in the tab order, as the sheet's own Close is; drawn in the top corner. */}
        <SheetClose asChild>
          <Button variant="ghost" size="icon" className="absolute top-2.5 right-2.5 size-11">
            <X aria-hidden="true" />
            <span className="sr-only">Close</span>
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
