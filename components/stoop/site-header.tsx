import Link from "next/link";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NAV_LINKS, PLAN_LINK } from "./nav-links";

/**
 * The marketing header (landing, /judges, /mcp): three links and one pill, "Plan an event" (the store
 * form). The pill is an ink outline: the page's one brick primary belongs to the page itself.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3">
      <nav
        aria-label="Main"
        className="mx-auto flex h-16 max-w-6xl items-center gap-4 rounded-full border border-hairline bg-paper-raised/90 py-2 pr-2 pl-4 shadow-[0_6px_20px_-12px_rgb(29_26_43/0.25)] backdrop-blur"
      >
        <Link href="/" aria-label="Stoop home" className="shrink-0 rounded-full">
          <Logo />
        </Link>
        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="rounded-full px-3 py-2 text-[0.95rem] font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href={PLAN_LINK.href}
            className="inline-flex h-10 items-center rounded-full border-2 border-ink bg-paper-raised px-4 text-sm font-semibold whitespace-nowrap text-ink hover:bg-sand pointer-coarse:h-11"
          >
            {PLAN_LINK.label}
          </Link>
          <MobileMenu />
        </div>
      </nav>
    </header>
  );
}
