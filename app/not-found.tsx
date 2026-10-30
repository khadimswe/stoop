import { NotFoundMessage } from "@/components/stoop/not-found-message";

// Unmatched URLs render inside the root layout only; the message brings its own mark and links.
export default function NotFound() {
  return <NotFoundMessage />;
}
