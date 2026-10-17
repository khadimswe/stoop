"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

type CopyState = "idle" | "copied" | "failed";

/**
 * Writes text to the clipboard, falling back to a hidden textarea where the Clipboard API is missing
 * or refused. The textarea goes into `container` (next to the button), so a dialog's focus trap
 * lets it take the selection.
 */
export async function copyText(text: string, container: HTMLElement = document.body): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the textarea (permissions, in-app browsers).
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  container.appendChild(area);
  area.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/**
 * The app register's text-only copy button ("Copy prompt", "Copy script"). The label turns into
 * "Copied" for two seconds and a polite live region says so; if copying fails, it says how to copy
 * by hand. The text arrives as a prop, so pass only what this button copies.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = "Copied",
  variant = "ghost",
  size = "sm",
  className,
}: {
  text: string;
  label: string;
  copiedLabel?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    const ok = await copyText(text, event.currentTarget.parentElement ?? document.body);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  };

  return (
    <>
      <Button type="button" variant={variant} size={size} onClick={onClick} className={cn("gap-1.5", className)}>
        {state === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {state === "copied" ? copiedLabel : label}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {state === "copied" ? copiedLabel : state === "failed" ? "Copy failed. Select the text and copy it by hand." : ""}
      </span>
    </>
  );
}
