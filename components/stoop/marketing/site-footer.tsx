import Link from "next/link";
import { Logo } from "@/components/stoop/logo";
import { codeUrl } from "@/lib/marketing/site";

const LINKS = [
  { href: "/#examples", label: "Example stores" },
  { href: "/stores", label: "District view" },
  { href: "/judges", label: "For judges" },
  { href: "/start", label: "Plan an event" },
] as const;

/** The marketing footer: the honesty line, the main links and the license. */
export function SiteFooter() {
  return (
    <footer className="border-t border-hairline">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12">
        <div className="flex flex-wrap items-start justify-between gap-x-12 gap-y-6">
          <div className="flex max-w-[36rem] flex-col gap-3">
            <Logo />
            <p className="text-base leading-relaxed text-ink">
              Stoop reads your city and your block through Qloo&apos;s aggregate taste data. It never sees a shopper, and it never posts for you.
            </p>
            <p className="text-sm text-ink-soft">
              Example stores are fictional. Stoop is not affiliated with or endorsed by T-Mobile, Metro by T-Mobile, Cricket or Boost, and draws no
              carrier logos.
            </p>
          </div>
          <nav aria-label="Footer">
            <ul className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-1">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-ink underline-offset-4 hover:underline">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <p className="border-t border-hairline pt-6 text-sm text-ink-soft">
          Open source under the{" "}
          <a href={codeUrl("LICENSE")} className="font-semibold text-ink underline underline-offset-4">
            MIT license
          </a>
          . Built on Qloo&apos;s taste data for the Qloo Agentic Hackathon.
        </p>
      </div>
    </footer>
  );
}
