import type { ReactNode } from "react";
import { CopyButton } from "@/components/stoop/copy-button";
import type { ExportView } from "@/lib/report/view/output";
import { Disclosures, type DisclosureItem } from "./disclosures";

// The Output section's "Export" line, one line: "Copy Higgsfield prompt" (the multi-shot prompt, in
// one tap), then "Veo 3.1 scene prompts (5)" and "Production Pack", which open below the line: the
// per-scene prompts, and the rest of the pack (asset prompts, shot list, Director's Guide, checklists,
// the AI disclosure). Model and host names come from the view model (lib/prompts/models.config.ts),
// never from this file.

// `focus-visible:outline-solid` restores the keyboard ring the shared Button loses to its `outline-none`.
const COPY = "h-11 focus-visible:outline-solid sm:h-9";

function Pre({ text, label }: { text: string; label: string }) {
  return (
    <pre
      tabIndex={0}
      aria-label={label}
      className="max-h-56 overflow-auto rounded-lg border border-hairline bg-paper p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink"
    >
      {text}
    </pre>
  );
}

function Panel({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label} className="flex flex-col gap-5 rounded-lg border border-hairline bg-paper px-3 pt-3 pb-4">
      {children}
    </section>
  );
}

function ScenePrompts({ veo, worldLabel }: { veo: NonNullable<ExportView["veo"]>; worldLabel: string }) {
  return (
    <Panel label={`${veo.modelName} scene prompts, ${worldLabel}`}>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-ink-soft">One prompt per scene. Render each, then cut them together in order.</p>
        <ul className="-ml-3 flex flex-wrap gap-x-1">
          {veo.prompts.map((p) => (
            <li key={p.id}>
              <CopyButton text={p.prompt} label={`Copy scene ${p.scenes.join(" and ")}`} className={COPY} />
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function ProductionPack({ view, worldLabel }: { view: ExportView; worldLabel: string }) {
  const { references } = view;
  return (
    <Panel label={`Production Pack, ${worldLabel}`}>
      {references.assets.length > 0 && (
        <section className="flex flex-col gap-1.5" aria-label={`Asset prompts, ${worldLabel}`}>
          <h4 className="text-sm font-semibold">Asset prompts</h4>
          <p className="text-xs text-ink-soft">Render these first and save each under its exact filename: the scene prompts reference them by name.</p>
          <ul className="-ml-3 flex flex-col">
            {references.assets.map((a) => (
              <li key={a.file} className="flex flex-wrap items-center gap-x-2">
                <CopyButton
                  text={a.prompt}
                  label={`Copy ${a.file}`}
                  className={`${COPY} h-auto min-h-11 max-w-full text-left text-xs whitespace-normal [overflow-wrap:anywhere] sm:min-h-9`}
                />
                <span className="text-xs text-ink-soft">
                  {a.modelName} · {a.aspect}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-1.5" aria-label={`Production Pack shot list, ${worldLabel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Shot list</h4>
          <CopyButton text={references.shotList} label="Copy shot list" className={COPY} />
        </div>
        <Pre text={references.shotList} label={`Shot list text, ${worldLabel}`} />
      </section>
      <section className="flex flex-col gap-1.5" aria-label={`Director's Guide, ${worldLabel}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-sm font-semibold">Director&apos;s Guide</h4>
          <CopyButton text={references.directorGuide} label="Copy Director's Guide" className={COPY} />
        </div>
        <Pre text={references.directorGuide} label={`Director's Guide text, ${worldLabel}`} />
      </section>
      {references.checklist.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold">Critique checklist</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {references.checklist.map((item) => (
              <li key={item.id}>
                {item.text}
                {item.blocking && <span className="text-xs font-semibold text-ink-soft"> (must pass)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {references.reviewChecklist.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-sm font-semibold">Before anyone posts it</h4>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {references.reviewChecklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
      {references.otherModels.length > 0 && (
        <p className="text-xs text-ink-soft">
          The pack also has scene prompts for {references.otherModels.map((m) => `${m.modelName} (${m.prompts})`).join(" and ")}, in the Campaign Kit&apos;s Prompts menu and its
          Production Pack download.
        </p>
      )}
      <p className="text-xs text-ink-soft">
        <span className="font-semibold text-ink">AI disclosure: </span>
        {references.disclosure}
      </p>
    </Panel>
  );
}

export function ExportLine({ view, worldLabel }: { view: ExportView; worldLabel: string }) {
  const { multiShot, veo } = view;
  const items: DisclosureItem[] = [];
  if (veo) {
    const label = `${veo.modelName} scene prompts (${veo.prompts.length})`;
    items.push({ key: "veo", label, name: `${label}, ${worldLabel}`, content: <ScenePrompts veo={veo} worldLabel={worldLabel} /> });
  }
  items.push({ key: "pack", label: "Production Pack", name: `Production Pack, ${worldLabel}`, content: <ProductionPack view={view} worldLabel={worldLabel} /> });
  return (
    <Disclosures
      className="-ml-3"
      lead={multiShot && <CopyButton text={multiShot.prompt} label={`Copy ${multiShot.hostName} prompt`} context={worldLabel} className={`${COPY} text-[0.8125rem] sm:text-sm`} />}
      items={items}
    />
  );
}
