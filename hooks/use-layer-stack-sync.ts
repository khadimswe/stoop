"use client";

import { useSyncExternalStore } from "react";

// Radix keeps one stack of dismissable layers (dialogs, sheets, popovers, tooltips) and only the top layer
// listens for Escape. When a layer opens or closes, Radix fires this event and every open layer re-renders
// to work out whether it is now on top. Radix triggers that re-render with a state update inside an
// effect, which React runs at default priority. An Escape that arrives before it (a quick key press, or a
// busy phone) still reaches the layer underneath, so a nested dialog's Escape closes its parent too.
const LAYER_UPDATE = "dismissableLayer.update";

let version = 0;
const getVersion = () => version;

function subscribe(onChange: () => void) {
  const handle = () => {
    version += 1;
    onChange();
  };
  document.addEventListener(LAYER_UPDATE, handle);
  return () => document.removeEventListener(LAYER_UPDATE, handle);
}

/**
 * Re-renders the calling component whenever a Radix layer opens or closes. React flushes external-store
 * updates synchronously, so the layer under it re-renders in the same task: by the time any key press is
 * handled, the new top layer owns Escape and the one below has let it go. Call it from a component that
 * mounts with a layer's content and renders that content's DismissableLayer.
 */
export function useLayerStackSync(): void {
  useSyncExternalStore(subscribe, getVersion, getVersion);
}
