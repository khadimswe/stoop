/**
 * The public event page's register: no Stoop header or navigation, because the people opening it come
 * from a Facebook or WhatsApp link to one store's event, not to Stoop.
 */
export default function EventLayout({ children }: LayoutProps<"/">) {
  return <>{children}</>;
}
