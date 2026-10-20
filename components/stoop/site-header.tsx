import Link from "next/link";
import { Logo } from "./logo";
import { MobileMenu } from "./mobile-menu";
import { NAV_LINKS, TRY_LINK } from "./nav-links";
import { WaitlistTrigger } from "./waitlist-trigger";

/** The marketing header (landing, /judges, /mcp): three links, "Try it free" for the live agent, and one pill: the waitlist. */
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
            href={TRY_LINK.href}
            className="hidden rounded-full px-3 py-2 text-[0.95rem] font-semibold text-ink underline decoration-2 underline-offset-4 hover:decoration-brick sm:inline-block"
          >
            {TRY_LINK.label}
          </Link>
          <WaitlistTrigger className="pointer-coarse:h-11" />
          <MobileMenu />
        </div>
      </nav>
    </header>
  );
}
