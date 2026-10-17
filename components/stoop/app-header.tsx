import Link from "next/link";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NAV_LINKS, TRY_LINK } from "./nav-links";
import { WaitlistTrigger } from "./waitlist-trigger";

/**
 * The app register's top bar (reports, /start, /run): 56 px, paper, one bottom hairline, no shadow.
 * Same links as the marketing pill. The waitlist pill is outlined here, because the page's one brick
 * primary belongs to the page itself (the sticky "Make this for my product", "Read my page").
 * Phones: logo, pill, menu.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-paper/95 backdrop-blur">
      <nav aria-label="Main" className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-5">
        <Link href="/" aria-label="Stoop home" className="shrink-0 rounded-lg">
          <Logo className="[&_svg]:size-7" />
        </Link>
        <ul className="ml-4 hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="rounded-full px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1.5">
          <Link
            href={TRY_LINK.href}
            className="hidden rounded-full px-3 py-2 text-sm font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick sm:inline-block"
          >
            {TRY_LINK.label}
          </Link>
          <WaitlistTrigger variant="quiet" />
          <MobileMenu />
        </div>
      </nav>
    </header>
  );
}
