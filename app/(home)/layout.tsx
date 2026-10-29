import Link from "next/link";
import { FloorMark } from "@/components/stoop/floor/kit";
import { FOOTER_NOTICE } from "@/lib/marketing/pilot";
import { codeUrl } from "@/lib/marketing/site";

const FOOT = [
  { href: "/#how", label: "How it works" },
  { href: "/#examples", label: "Examples" },
  { href: "/judges", label: "For judges" },
  { href: "/stores", label: "My stores" },
  { href: "/start", label: "Plan an event" },
] as const;

/** The landing and the judges' guide: the floor's look, with its own footer (each page brings its nav). */
export default function HomeLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="floor flex min-h-full flex-1 flex-col">
      {children}
      <footer className="border-t border-fl-rule">
        <div className="mx-auto flex max-w-[1248px] flex-col gap-6 px-4 pt-10 pb-12 sm:px-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2.5">
              <FloorMark />
              <span className="font-semibold">Stoop</span>
            </p>
            <ul className="flex flex-wrap gap-x-6 gap-y-0 text-sm font-medium">
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
          <div className="border-t border-fl-rule pt-5">
            <p className="max-w-[60rem] text-xs leading-[1.5] text-fl-dim">{FOOTER_NOTICE} Nothing posts until you approve it.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
