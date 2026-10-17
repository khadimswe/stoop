import { AppHeader } from "@/components/stoop/app-header";

/** The app register (reports, /start, /run): the 56 px top bar with a bottom hairline. */
export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}
