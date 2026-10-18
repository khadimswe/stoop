"use client";

import Image from "next/image";
import { Images } from "lucide-react";
import type { ReactNode } from "react";
import { Chip } from "@/components/stoop/chip";
import { CopyButton } from "@/components/stoop/copy-button";
import { Button } from "@/components/ui/button";
import type {
  BriefCardView,
  CaptionsCardView,
  ConceptCardView,
  CutCardView,
  IngredientView,
  KitCardView,
  KitStoryboardView,
  KitWorldView,
  PlanCardView,
  PromptOptionView,
} from "@/lib/report/view/kit";
import { cn } from "cn";
import { useLiveActions } from "../revise/live-actions";
import { NotThisVibe, ReviseStatus } from "../revise/not-this-vibe";
import { briefAnchor } from "../why/anchors";
import { OriginChip, ReceiptLink, TraceDecisions } from "../why/receipt-link";
import { DownloadButton } from "./download-button";
import { PromptsMenu } from "./prompts-menu";

const CARD = "flex min-w-0 flex-col gap-3 rounded-xl border border-hairline bg-surface p-4";
const HOOK = "font-display text-lg leading-snug font-bold text-pretty [font-stretch:90%]";
/** Copy buttons: text buttons with an icon, 44 px tall on touch screens. */
const ACTION = "h-11 sm:h-9";

function CardTop({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{left}</div>
      {right && <span className="font-mono text-xs text-ink-soft">{right}</span>}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-sand px-2.5 py-1 text-xs leading-none font-semibold">{children}</span>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-hairline pt-3">{children}</div>;
}

const ORIGIN_GROUPS: { origin: IngredientView["origin"]; tag: string }[] = [
  { origin: "qloo", tag: "Qloo" },
  { origin: "interpreted", tag: "From Qloo" },
  { origin: "yours", tag: "Your choice" },
  { origin: "creative", tag: "Not from Qloo" },
];

/**
 * The brief slots the concept draws on, grouped by origin: one chip per origin, then the slots, each
 * opening its receipt where it has one. The concept itself is always creative (not from Qloo).
 */
function Ingredients({ items }: { items: IngredientView[] }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-ink-soft">Draws on</p>
      <ul className="flex flex-col gap-1.5" aria-label="What this concept draws on">
        {ORIGIN_GROUPS.map(({ origin, tag }) => {
          const group = items.filter((item) => item.origin === origin);
          if (group.length === 0 && origin !== "creative") return null;
          return (
            <li key={origin} className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
              <Chip origin={origin}>{tag}</Chip>
              {group.map((item, i) => (
                <span key={item.slot}>
                  <ReceiptLink receipt={item.receipt}>{item.label}</ReceiptLink>
                  {i < group.length - 1 || origin === "creative" ? "," : ""}
                </span>
              ))}
              {origin === "creative" && <span>the concept and its hook</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The kept concept's storyboard: frames when they exist; on live reports, "Storyboards" on demand. */
function StoryboardStrip({ segmentId, storyboard }: { segmentId: string; storyboard: KitStoryboardView }) {
  const live = useLiveActions();
  const note = live?.frames[segmentId];
  const rendering = note?.state !== "note" && (storyboard.status === "rendering" || note?.state === "sending" || note?.state === "starting");
  const steps = <TraceDecisions steps={storyboard.steps} title="Storyboard review, agent decisions" />;

  const frames = storyboard.frames.length > 0 && (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Storyboard frames">
      {storyboard.frames.map((frame) => (
        <li key={frame.scene} className="overflow-hidden rounded-lg bg-screen">
          <Image src={frame.src} alt={frame.alt} width={180} height={320} unoptimized className="aspect-[9/16] h-auto w-full object-cover" />
        </li>
      ))}
    </ol>
  );

  if (storyboard.status === "done" && frames) {
    return (
      <div className="flex flex-col gap-2">
        {frames}
        {steps}
      </div>
    );
  }
  if (!live) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-fill p-3">
      {!rendering && frames}
      {rendering ? (
        <>
          <div aria-hidden="true" className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="aspect-[9/16] rounded-md bg-surface motion-safe:animate-pulse" />
            ))}
          </div>
          <p role="status" className="text-sm">
            Rendering the storyboard. Claude reviews each frame against the checklist and redraws it once if needed.
          </p>
        </>
      ) : (
        <>
          <p role="status" className="text-sm text-ink-soft">
            {note?.state === "note" && note.message
              ? note.message
              : storyboard.status === "paused"
                ? (storyboard.reason ?? "Storyboards paused today.")
                : storyboard.status === "failed"
                  ? (storyboard.reason ?? "The last storyboard did not finish.")
                  : "Four frames of this concept, drawn from the Production Pack."}
          </p>
          {storyboard.canRequest && (
            <Button type="button" variant="quiet" size="sm" className={cn(ACTION, "self-start")} onClick={() => void live.requestFrames(segmentId)}>
              <Images aria-hidden="true" />
              Storyboards
            </Button>
          )}
        </>
      )}
      {steps}
    </div>
  );
}

function ConceptCard({ card, world }: { card: ConceptCardView; world: KitWorldView }) {
  const kept = card.status === "kept";
  return (
    <article aria-label={`${kept ? "Kept concept" : "Runner-up concept"}: ${card.title}`} className={CARD}>
      <CardTop left={<Tag>{card.formatLabel ?? "Alternate concept"}</Tag>} right={kept ? "15 s · 9:16" : "Runner-up"} />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{card.title}</p>
        <p className="font-mono text-xs text-ink-soft">
          {kept ? "Kept concept" : "Scored lower"} · rubric {card.score} of 30{card.platformLabel && ` · ${card.platformLabel}`}
        </p>
        <p className={HOOK}>{card.hook}</p>
      </div>
      {card.testHypothesis && (
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">What this tests:</span> {card.testHypothesis}
        </p>
      )}
      <Ingredients items={card.ingredients} />
      {kept && <StoryboardStrip segmentId={world.segmentId} storyboard={world.storyboard} />}
      {!kept && <p className="text-xs text-ink-soft">The Creative Director scored it lower, so the Production Pack is written for the kept concept.</p>}
      <Actions>
        <CopyButton text={card.copy.text} label={card.copy.label} variant="quiet" className={ACTION} />
        {kept && <PromptsMenu video={world.videoPrompts} actor={card.actorPrompts} title={card.title} />}
      </Actions>
    </article>
  );
}

function CutCard({ card, video }: { card: CutCardView; video: PromptOptionView[] }) {
  return (
    <article aria-label={`${card.platformLabel} cut: ${card.conceptTitle}`} className={CARD}>
      <CardTop left={<Tag>{card.formatLabel}</Tag>} right="15 s · 9:16" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{card.conceptTitle}</p>
        <p className="font-mono text-xs text-ink-soft">Kept concept · {card.platformLabel}</p>
        <p className={HOOK}>{card.platformLabel} cut</p>
      </div>
      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">Hook:</span> {card.hookRule}
      </p>
      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">CTA button:</span> {card.cta}
      </p>
      <p className="line-clamp-6 rounded-lg bg-fill px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-ink-soft">{card.copy.text}</p>
      <p className="text-xs text-ink-soft">Same concept and Culture Brief, written for {card.platformLabel}. The script speaks as the brand, never as a customer.</p>
      <Actions>
        <CopyButton text={card.copy.text} label={card.copy.label} variant="quiet" className={ACTION} />
        <PromptsMenu video={video} actor={card.actorPrompts} title={`${card.platformLabel} cut`} />
      </Actions>
    </article>
  );
}

function CaptionsCard({ card }: { card: CaptionsCardView }) {
  return (
    <article aria-label="Captions and on-screen text" className={CARD}>
      <CardTop left={<Tag>Captions</Tag>} right="WebVTT" />
      <p className={HOOK}>Captions and on-screen text</p>
      <ol className="flex flex-col gap-1.5">
        {card.lines.map((line, i) => (
          <li key={`${i}-${line.start}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-sm">
            <span className="font-mono text-xs text-ink-soft">
              {line.start} to {line.end} s
            </span>
            <span>
              <span className="text-xs text-ink-soft">{line.kind}: </span>
              {line.text}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-soft">Added in the edit: video models garble text, so the prompts ask for none.</p>
      <Actions>
        <CopyButton text={card.copy.text} label={card.copy.label} variant="quiet" className={ACTION} />
      </Actions>
    </article>
  );
}

function PlanCard({ card }: { card: PlanCardView }) {
  return (
    <article aria-label={`Ad plan: ${card.name}`} className={CARD}>
      <CardTop left={<Tag>Meta ad set · TikTok ad group</Tag>} />
      <p className={HOOK}>{card.name}</p>
      <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-ink-soft">Age bands</dt>
        <dd>{card.ageBands.length ? `${card.ageBands.join(", ")} (optional)` : "Leave broad"}</dd>
        <dt className="text-ink-soft">Cities</dt>
        <dd>{card.cities.length ? <ReceiptLink receipt={card.receipt}>{`${card.cities.join(", ")} (optional)`}</ReceiptLink> : "Leave broad"}</dd>
      </dl>
      <p className="text-sm text-ink-soft">
        <span className="font-semibold text-ink">What to watch:</span> {card.watch}
      </p>
      <p className="text-xs text-ink-soft">{card.note}</p>
      <Actions>
        <CopyButton text={card.copy.text} label={card.copy.label} variant="quiet" className={ACTION} />
      </Actions>
    </article>
  );
}

function BriefCard({ card }: { card: BriefCardView }) {
  return (
    <article aria-label="Creator brief" className={CARD}>
      <CardTop left={<Tag>Creator brief</Tag>} />
      <p className={HOOK}>Who to recruit</p>
      <div className="flex flex-col items-start gap-1.5">
        <p className="text-sm">{card.profile.text}</p>
        <OriginChip origin={card.profile.origin} receipt={card.profile.receipt} />
      </div>
      {card.avoid.length > 0 && (
        <p className="text-sm text-ink-soft">
          <span className="font-semibold text-ink">Avoid:</span> {card.avoid.join("; ")}
        </p>
      )}
      <details className="text-sm">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-sm font-semibold sm:min-h-0">
          {card.hooks.length} hooks to try, details to hit, disclosure
        </summary>
        <p className="mt-1 font-semibold">Hooks to try</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 marker:text-ink-soft">
          {card.hooks.map((hook) => (
            <li key={hook}>{hook}</li>
          ))}
        </ul>
        <p className="mt-2 font-semibold">Details to hit</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 marker:text-ink-soft">
          {card.hit.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-soft">{card.disclosure}</p>
      </details>
      <Actions>
        <CopyButton text={card.copy.text} label={card.copy.label} variant="quiet" className={ACTION} />
      </Actions>
    </article>
  );
}

function Card({ card, world }: { card: KitCardView; world: KitWorldView }) {
  switch (card.kind) {
    case "concept":
      return <ConceptCard card={card} world={world} />;
    case "cut":
      return <CutCard card={card} video={world.videoPrompts} />;
    case "captions":
      return <CaptionsCard card={card} />;
    case "plan":
      return <PlanCard card={card} />;
    case "brief":
      return <BriefCard card={card} />;
  }
}

/** One group of cards under a small heading. Cards keep their own height, so a short card leaves no empty box. */
function CardGrid({ title, cards, world, className }: { title: string; cards: KitCardView[]; world: KitWorldView; className: string }) {
  if (cards.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-ink-soft">{title}</h4>
      <ul className={cn("grid items-start gap-3", className)}>
        {cards.map((card) => (
          <li key={card.key} className="flex min-w-0 [&>article]:flex-1">
            <Card card={card} world={world} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Production Pack as one Markdown file: the parts the server laid out, with the render prompts joined in. */
function packText(pack: NonNullable<KitWorldView["pack"]>, prompts: PromptOptionView[]): string {
  return [pack.head, ...prompts.map((p) => `### ${p.label} (${p.detail})\n\n${p.text}`), pack.tail].join("\n\n");
}

/** One concept world's kit: its cards, its Production Pack download, and on live reports its after-run actions. */
export function KitWorld({ world }: { world: KitWorldView }) {
  const headingId = `kit-${world.segmentId}`;
  const creatives = world.cards.filter((c) => c.kind === "concept" || c.kind === "cut");
  const plans = world.cards.filter((c) => c.kind !== "concept" && c.kind !== "cut");
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-display text-xl leading-snug font-bold [font-stretch:90%]">
          {world.label}
        </h3>
        {world.pack && <NotThisVibe segmentId={world.segmentId} field="world" label={world.label} className="-mr-2" />}
      </div>
      <ReviseStatus segmentId={world.segmentId} href={`#${briefAnchor(world.segmentId)}`} />
      {world.partial && <p className="text-sm text-ink-soft">This world stopped at {world.partial.stage}: {world.partial.reason}</p>}
      {world.cards.length > 0 ? (
        <>
          <CardGrid title="Concepts and scripts" cards={creatives} world={world} className="md:grid-cols-2" />
          <CardGrid title="Captions, ad plan and creator brief" cards={plans} world={world} className="md:grid-cols-2 xl:grid-cols-3" />
        </>
      ) : (
        <p className="text-sm text-ink-soft">This world&apos;s kit appears once its concept is written.</p>
      )}
      {world.pack && (
        <DownloadButton
          file={world.pack.file}
          type="text/markdown"
          label="Production Pack: asset sheets, scene prompts, Director's Guide"
          text={() => packText(world.pack!, world.videoPrompts)}
          className="self-start"
        />
      )}
    </section>
  );
}
