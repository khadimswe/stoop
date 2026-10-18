"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Saves text the page already holds as a file: no request, no account. `text` may be a function, so a
 * large file is joined only when someone asks for it.
 */
export function DownloadButton({ file, text, type, label, className }: { file: string; text: string | (() => string); type: string; label: string; className?: string }) {
  const onClick = () => {
    const blob = new Blob([typeof text === "function" ? text() : text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Button type="button" variant="quiet" size="sm" onClick={onClick} className={cn("h-11 max-w-full gap-1.5 whitespace-normal text-left sm:h-auto sm:min-h-9", className)}>
      <Download aria-hidden="true" />
      <span className="min-w-0">{label}</span>
    </Button>
  );
}
