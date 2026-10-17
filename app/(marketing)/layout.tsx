import { SiteHeader } from "@/components/stoop/site-header";

/** The marketing register (landing, /judges, /mcp): the floating 64 px pill header. */
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
