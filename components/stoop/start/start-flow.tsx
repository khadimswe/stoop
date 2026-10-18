"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntake } from "@/hooks/use-intake";
import type { IntakeResponse } from "@/lib/api/responses";
import { LEAD_EXAMPLE } from "@/lib/demo/examples";
import type { Evidence } from "@/lib/evidence";
import type { Seed } from "@/lib/report/schema";
import { addRecent, browserStorage } from "@/lib/run/recents";
import { DEFAULT_REGION, exampleRunHref, intakeBody, postRunStart, runBody, singleFlight, startHref, type ApiResult } from "@/lib/run/start";
import { Composer, type ComposerMode, type ComposerNotice } from "./composer";
import { ExampleChips } from "./example-chips";
import { RecentCampaigns } from "./recent-campaigns";
import { SeedStep } from "./seed-step";

const replayExample = (reason: "replay" | "daily-cap" | "rate-limited") => ({ href: exampleRunHref(LEAD_EXAMPLE.slug, reason), label: "Watch an example run" });

/** A refusal from /api/intake as one plain line, with a way into an example where live runs are out. */
function noticeFor(result: Extract<ApiResult<IntakeResponse>, { ok: false }>): ComposerNotice {
  if (result.code === "off") return { text: result.message, example: replayExample("replay") };
  if (result.code === "daily_cap") return { text: result.message, example: replayExample("daily-cap") };
  if (result.code === "rate_limited") return { text: result.message, example: replayExample("rate-limited") };
  return { text: result.message };
}

/**
 * /start: step 1 reads the product (link first, description as the fallback), step 2 confirms the
 * seeds Qloo found and the founder's own read, then starts the run. A start lands on the live trace,
 * or on an example's replay with the reason; a double click never starts twice.
 */
export function StartFlow() {
  const router = useRouter();
  const intake = useIntake();
  const [mode, setMode] = useState<ComposerMode>("link");
  const [link, setLink] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ComposerNotice | null>(null);

  const [found, setFound] = useState<{ intake: IntakeResponse; fromLink: boolean } | null>(null);
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [stated, setStated] = useState("");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const stepTwoHeading = useRef<HTMLHeadingElement>(null);
  const startOnce = useMemo(() => singleFlight(postRunStart), []);

  // Arriving on step 2 moves focus to its heading, so a screen reader hears the new step.
  useEffect(() => {
    if (found) stepTwoHeading.current?.focus();
  }, [found]);

  const read = async () => {
    setNotice(null);
    const body = intakeBody({ mode, link, description, region });
    if (!body.ok) return setFieldError(body.message);
    setFieldError(null);
    const result = await intake.read(body.value);
    if (!result) return;
    if (result.ok) {
      setSeeds(result.data.seeds);
      setEvidence(result.data.evidence);
      setStated("");
      setStartError(null);
      setFound({ intake: result.data, fromLink: Boolean(body.value.url) });
      return;
    }
    // A page Stoop could not read asks for a description, keeping the link (never a dead end).
    if (result.code === "invalid" && mode === "link") {
      setMode("describe");
      setNotice({ text: result.message });
      return;
    }
    setNotice(noticeFor(result));
  };

  const start = async () => {
    if (!found || starting) return;
    const body = runBody({ intakeId: found.intake.intakeId, seedIds: seeds.map((s) => s.ref.id), statedCustomer: stated, region });
    if (!body.ok) return setStartError(body.message);
    setStartError(null);
    setStarting(true);
    const result = await startOnce((input, init) => window.fetch(input, init), body.value);
    if (!result.ok) {
      setStarting(false);
      setStartError(result.message);
      return;
    }
    const reply = result.data;
    if (reply.mode === "live") {
      addRecent(browserStorage("localStorage"), { runId: reply.runId, name: found.intake.product.name, startedAt: new Date().toISOString(), status: "running" });
    }
    // The button stays disabled while the next page loads.
    router.push(startHref(reply));
  };

  if (found) {
    return (
      <SeedStep
        intake={found.intake}
        fromLink={found.fromLink}
        region={region}
        seeds={seeds}
        evidence={evidence}
        onRemoveSeed={(id) => setSeeds((list) => list.filter((s) => s.ref.id !== id))}
        onAddSeed={(seed, receipts) => {
          setSeeds((list) => (list.some((s) => s.ref.id === seed.ref.id) ? list : [...list, seed]));
          setEvidence((list) => [...list, ...receipts.filter((r) => !list.some((e) => e.id === r.id))]);
        }}
        stated={stated}
        onStatedChange={setStated}
        starting={starting}
        error={startError}
        onBack={() => {
          setFound(null);
          intake.reset();
        }}
        onStart={start}
        headingRef={stepTwoHeading}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-[1.75rem] leading-tight font-extrabold tracking-tight [font-stretch:85%] sm:text-[1.875rem]">What are you selling?</h1>
      <Composer
        mode={mode}
        onModeChange={(next) => {
          setMode(next);
          setFieldError(null);
        }}
        link={link}
        onLinkChange={setLink}
        description={description}
        onDescriptionChange={setDescription}
        region={region}
        onRegionChange={setRegion}
        error={fieldError}
        notice={notice}
        reading={intake.state.kind === "reading"}
        onSubmit={read}
      />
      <ExampleChips />
      <RecentCampaigns />
    </div>
  );
}
