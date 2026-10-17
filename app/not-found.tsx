import { AppHeader } from "@/components/stoop/app-header";
import { NotFoundMessage } from "@/components/stoop/not-found-message";

// Unmatched URLs render inside the root layout only (no route group layout), so this page brings its
// own header. notFound() inside the app group renders app/(app)/not-found.tsx under that group's bar.
export default function NotFound() {
  return (
    <>
      <AppHeader />
      <NotFoundMessage />
    </>
  );
}
