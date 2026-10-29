/**
 * The floor: the store-events app (My stores, a store's block, a new event, the event, the poster,
 * promote). Each screen brings its own 52 px app bar and stepper, so this layout only sets the scope:
 * the warm grey page, black ink and the system UI font.
 */
export default function FloorLayout({ children }: LayoutProps<"/">) {
  return <div className="floor flex min-h-full flex-1 flex-col">{children}</div>;
}
