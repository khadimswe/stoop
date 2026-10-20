"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IntakeRequest, SEARCH_TYPES } from "@/lib/api/requests";
import type { IntakeResponse } from "@/lib/api/responses";
import type { Evidence } from "@/lib/evidence";
import type { Seed } from "@/lib/report/schema";
import { getSearch, postIntake, type ApiResult } from "@/lib/run/start";

export type IntakeState =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "ready"; data: IntakeResponse }
  | { kind: "error"; status: number; code: Extract<ApiResult<never>, { ok: false }>["code"]; message: string };

/**
 * "What are you selling?": one POST /api/intake at a time (a second submit while one is reading is
 * ignored). Returns the result too, so the composer can react (a blocked page asks for a description).
 */
export function useIntake() {
  const [state, setState] = useState<IntakeState>({ kind: "idle" });
  const inflight = useRef<AbortController | null>(null);

  useEffect(() => () => inflight.current?.abort(), []);

  const read = useCallback(async (body: IntakeRequest): Promise<ApiResult<IntakeResponse> | null> => {
    if (inflight.current) return null;
    const controller = new AbortController();
    inflight.current = controller;
    setState({ kind: "reading" });
    try {
      const result = await postIntake((input, init) => window.fetch(input, init), body, controller.signal);
      setState(result.ok ? { kind: "ready", data: result.data } : { kind: "error", status: result.status, code: result.code, message: result.message });
      return result;
    } catch {
      // Aborted: the page is going away.
      return null;
    } finally {
      if (inflight.current === controller) inflight.current = null;
    }
  }, []);

  const reset = useCallback(() => setState({ kind: "idle" }), []);
  return { state, read, reset };
}

export type SearchType = (typeof SEARCH_TYPES)[number];

type Entry = { kind: "searching" } | { kind: "done"; results: Seed[]; evidence: Evidence[] } | { kind: "error"; message: string; final: boolean };

/** Typed searches start after a pause, at 3 characters (2 with Enter): an intake gets 12 searches. */
export const SEARCH_MIN_AUTO = 3;
export const SEARCH_MIN = 2;
export const SEARCH_DEBOUNCE_MS = 450;

const keyOf = (type: SearchType, q: string) => `${type}:${q.trim().toLowerCase()}`;

export interface SeedSearch {
  query: string;
  setQuery: (query: string) => void;
  type: SearchType;
  setType: (type: SearchType) => void;
  status: "idle" | "searching" | "done" | "error";
  results: Seed[];
  evidence: Evidence[];
  message: string | null;
  /** Searches now (Enter), for names as short as 2 characters. */
  searchNow: () => void;
}

/**
 * Qloo autocomplete for "you" seeds (GET /api/search), debounced, one answer per query and type kept
 * for the session so retyping costs nothing. Only Qloo's own matches come back; a refusal for too
 * many searches stops further searches with its message.
 */
export function useSeedSearch(intakeId: string): SeedSearch {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<SearchType>("brand");
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [limit, setLimit] = useState<string | null>(null);
  const asked = useRef(new Set<string>());

  const run = useCallback(
    (q: string, t: SearchType) => {
      const key = keyOf(t, q);
      if (asked.current.has(key)) return;
      asked.current.add(key);
      setEntries((all) => ({ ...all, [key]: { kind: "searching" } }));
      void getSearch((input, init) => window.fetch(input, init), { intakeId, q, type: t }).then((result) => {
        if (!result.ok && result.code === "rate_limited") setLimit(result.message);
        // A failed search can be asked again; a refusal for too many searches cannot.
        if (!result.ok && result.code !== "rate_limited") asked.current.delete(key);
        setEntries((all) => ({
          ...all,
          [key]: result.ok ? { kind: "done", results: result.data.results, evidence: result.data.evidence } : { kind: "error", message: result.message, final: result.code === "rate_limited" },
        }));
      });
    },
    [intakeId],
  );

  const trimmed = query.trim();
  const key = keyOf(type, trimmed);
  useEffect(() => {
    if (trimmed.length < SEARCH_MIN_AUTO || limit || asked.current.has(key)) return;
    const timer = setTimeout(() => run(trimmed, type), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, type, key, limit, run]);

  const searchNow = useCallback(() => {
    if (trimmed.length >= SEARCH_MIN && !limit) run(trimmed, type);
  }, [trimmed, type, limit, run]);

  const entry = trimmed.length >= SEARCH_MIN ? entries[key] : undefined;
  if (limit && !entry) return { query, setQuery, type, setType, status: "error", results: [], evidence: [], message: limit, searchNow };
  return {
    query,
    setQuery,
    type,
    setType,
    status: entry ? (entry.kind === "searching" ? "searching" : entry.kind) : "idle",
    results: entry?.kind === "done" ? entry.results : [],
    evidence: entry?.kind === "done" ? entry.evidence : [],
    message: entry?.kind === "error" ? entry.message : null,
    searchNow,
  };
}
