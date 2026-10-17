// Pure math for ranking Qloo results honestly.
//
// Heatmap affinity correlates 0.92 to 0.98 with popularity (tasteplot, transplant), so a raw map
// just points at every big downtown. Lift removes the popularity effect. Affinity is also
// normalized per response, so a score only means something relative to other items in the same
// response: rank and panel position, never a fake population percentile.

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Least-squares line y = intercept + slope * x. Flat x gives slope 0 and the mean of y. */
export function linearFit(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } {
  if (xs.length !== ys.length) throw new Error("linearFit needs arrays of equal length");
  if (xs.length === 0) return { slope: 0, intercept: Number.NaN };
  const mx = mean(xs);
  const my = mean(ys);
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < xs.length; i++) {
    covariance += (xs[i] - mx) * (ys[i] - my);
    variance += (xs[i] - mx) ** 2;
  }
  const slope = variance === 0 ? 0 : covariance / variance;
  return { slope, intercept: my - slope * mx };
}

/**
 * Popularity-corrected lift: how much more an area likes this taste than its popularity predicts.
 * Positive means over-indexing. Uses each cell's own `popularity` from the same response.
 */
export function residualLift(cells: readonly { affinity: number; popularity: number }[]): number[] {
  const { slope, intercept } = linearFit(
    cells.map((c) => c.popularity),
    cells.map((c) => c.affinity),
  );
  return cells.map((c) => c.affinity - (intercept + slope * c.popularity));
}

/** Ratio lift against a baseline heatmap. The floor stops tiny baselines from exploding the ratio. */
export function ratioLift(target: number, baseline: number, floor = 0.05): number {
  return target / Math.max(baseline, floor);
}

/** Pairs cells from two heatmaps by geohash, keeping only cells present in both. */
export function joinByGeohash<A extends { geohash: string }, B extends { geohash: string }>(
  target: readonly A[],
  baseline: readonly B[],
): { geohash: string; target: A; baseline: B }[] {
  const byHash = new Map(baseline.map((cell) => [cell.geohash, cell]));
  const joined: { geohash: string; target: A; baseline: B }[] = [];
  for (const cell of target) {
    const match = byHash.get(cell.geohash);
    if (match) joined.push({ geohash: cell.geohash, target: cell, baseline: match });
  }
  return joined;
}

/** Items sorted by a score, highest first, with ties kept in input order. */
export function topBy<T>(items: readonly T[], score: (item: T) => number, n: number): T[] {
  return items
    .map((item, index) => ({ item, index, value: score(item) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .slice(0, n)
    .map((entry) => entry.item);
}

/** 1-based rank of each value within its list, highest first. Ties share the best rank. */
export function rankWithin(values: readonly number[]): number[] {
  return values.map((value) => 1 + values.filter((other) => other > value).length);
}

/** Fewer panel items than this come back, and there is no median to be above or below. */
export const MIN_PANEL_FOR_MEDIAN = 5;

/**
 * Where a score sits against a frozen reference panel scored in the same response.
 * Shown as "beats N of M reference artists"; below the panel median counts as unsupported.
 * With fewer than MIN_PANEL_FOR_MEDIAN panel items there is no median: aboveMedian is null.
 */
export function panelPosition(
  score: number,
  panelScores: readonly number[],
): { beats: number; of: number; aboveMedian: boolean | null } {
  const mid = panelScores.length < MIN_PANEL_FOR_MEDIAN ? null : median(panelScores);
  return {
    beats: panelScores.filter((p) => score > p).length,
    of: panelScores.length,
    aboveMedian: mid === null ? null : score > mid,
  };
}
