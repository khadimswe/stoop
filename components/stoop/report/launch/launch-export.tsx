"use client";

import { Copy, Download } from "lucide-react";
import { useMemo } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import { Button } from "@/components/ui/button";
import { launchSheetCsv, launchSheetMarkdown, SETUP_LINE, type BudgetSplit } from "@/lib/report/view/launch-sheet";
import type { LaunchPlanView } from "@/lib/report/view/types";

const ACTION = "h-11 sm:h-9";

/** Saves text the page already holds as a file: no request, no account. */
function save(file: string, text: string, type: string) {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The launch sheet: a CSV with one row per cell and the same plan as Markdown, both built in the
 * browser from the current split. It is a sheet to set up by hand, never an import into an ads
 * manager. Both wait for valid numbers.
 */
export function LaunchExport({ view, split, pageUrl }: { view: LaunchPlanView; split: BudgetSplit | null; pageUrl: string | null }) {
  const markdown = useMemo(() => (split ? launchSheetMarkdown(view, split, pageUrl) : ""), [view, split, pageUrl]);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-surface p-4 sm:p-5" data-launch-export>
      <h3 className="text-base font-semibold">Launch sheet</h3>
      <p className="text-sm text-ink-soft">
        One row per cell: the campaign, ad set name, daily budget, placements, audience options, hook, where its prompts are and what to watch. {SETUP_LINE}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="quiet" size="sm" disabled={!split} className={ACTION} onClick={() => split && save(view.fileName, launchSheetCsv(view, split, pageUrl), "text/csv")}>
          <Download aria-hidden="true" />
          Download launch sheet (CSV)
        </Button>
        {split ? (
          <CopyButton text={markdown} label="Copy as Markdown" variant="quiet" className={ACTION} />
        ) : (
          <Button type="button" variant="quiet" size="sm" disabled className={ACTION}>
            <Copy aria-hidden="true" />
            Copy as Markdown
          </Button>
        )}
      </div>
      {!split && <p className="text-xs text-ink-soft">Fix the budget above to download or copy the sheet.</p>}
    </div>
  );
}
