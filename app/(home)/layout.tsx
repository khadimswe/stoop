import Link from "next/link";
import { FloorMark } from "@/components/stoop/floor/kit";
import { codeUrl } from "@/lib/marketing/site";

const FOOT = [
  { href: "/#examples", label: "Examples" },
  { href: "/judges", label: "For judges" },
  { href: "/start", label: "Plan an event" },
] as const;

/** The landing and the judges' guide: the floor's look, with its own footer (each page brings its nav). */
export default function HomeLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="floor flex min-h-full flex-1 flex-col">
      {children}
      <footer className="border-t border-fl-rule">
        <div className="mx-auto flex max-w-[1248px] flex-col gap-6 px-4 py-12 sm:flex-row sm:justify-between sm:px-8">
          <div className="flex max-w-xl flex-col gap-3">
            <p className="flex items-center gap-2.5">
              <FloorMark />
              <span className="font-semibold">Stoop</span>
            </p>
            <p className="text-sm text-fl-muted">Stoop reads your city and the places in your community through Qloo&apos;s aggregate taste data. It never sees a shopper. Nothing posts until you approve it.</p>
            <p className="text-xs text-fl-dim">
              Example stores are fictional. Stoop is not affiliated with or endorsed by T-Mobile, Metro by T-Mobile, Cricket or Boost, and draws no carrier logos.
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm font-medium sm:flex-col">
            {FOOT.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="inline-flex min-h-11 items-center hover:underline">
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <a href={codeUrl("LICENSE")} className="inline-flex min-h-11 items-center hover:underline">
                MIT license
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
