import { NotFoundMessage } from "@/components/stoop/not-found-message";

// notFound() in an app page (an unknown example, a malformed run id) renders here, under the group's
// own app bar, so the page never shows two headers.
export default function AppNotFound() {
  return <NotFoundMessage />;
}
