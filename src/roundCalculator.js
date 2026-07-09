/**
 * Session budget for short hybrid Top-K ranking:
 *   Phase 1: 3-choice Elo discovery + soft cut to survivors
 *   Phase 2: pairwise merge-sort for true order of survivors
 *
 * All sizes scale from n (selected song count) and K.
 */

export const DEFAULT_TOP_K = 10;
export const PHASE1_CHOICES = 3;
export const PHASE2_CHOICES = 2;

export const INITIAL_RATING = 1500;
export const BASE_K = 40;
export const HIGH_K = 48;

/** Target survivor count for Phase 2 (short hybrid). */
export const SURVIVOR_TARGET = 20;

/**
 * Catalogs at or below this size skip discovery and pure-merge.
 * Avoids a long phase-1 just to drop 1–4 songs near the survivor threshold.
 */
export const PURE_MERGE_MAX = 24;

/** Phase1 ranking after coverage as a fraction of n. */
export const PHASE1_RANKING_OF_N = 0.28;

/** Minimum extra Phase1 rounds after full coverage. */
export const PHASE1_RANKING_MIN = 12;

/** Mild Elo penalty per missing required match at soft cut. */
export const UNDER_MATCH_PENALTY = 35;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Match MergeRanker.#buildTree totalSize so pre-session estimates align with
 * the interactive merge tree's finishSize / totalSize progress counters.
 * @param {number} m
 */
export function estimateMergeTreeWork(m) {
  if (m <= 1) return 0;
  const tree = [Array.from({ length: m }, (_, i) => i)];
  let totalSize = 0;
  for (let i = 0; i < tree.length; i++) {
    if (tree[i].length >= 2) {
      const mid = Math.ceil(tree[i].length / 2);
      const left = tree[i].slice(0, mid);
      const right = tree[i].slice(mid);
      tree.push(left);
      totalSize += left.length;
      tree.push(right);
      totalSize += right.length;
    }
  }
  return totalSize;
}

/** @deprecated use estimateMergeTreeWork — kept for call-site clarity */
export function estimateMergeComparisons(m) {
  return estimateMergeTreeWork(m);
}

/**
 * @param {number} songCount  Selected catalog size after checklist
 * @param {{ topK?: number, survivorTarget?: number }} [options]
 */
export function calculateSessionBudget(songCount, options = {}) {
  const n = Math.max(0, Math.floor(songCount) || 0);
  const topK = clamp(
    options.topK ?? DEFAULT_TOP_K,
    1,
    Math.max(1, n || DEFAULT_TOP_K),
  );
  const survivorTarget = options.survivorTarget ?? SURVIVOR_TARGET;

  if (n <= 1) {
    return {
      songCount: n,
      topK,
      phase1Choices: PHASE1_CHOICES,
      phase2Choices: PHASE2_CHOICES,
      survivors: n,
      skipToMerge: true,
      coverageRounds: 0,
      phase1RankingRounds: 0,
      phase1Rounds: 0,
      phase2Estimate: 0,
      maxRounds: 0,
      minMatchesBeforeCut: 1,
      underMatchPenalty: UNDER_MATCH_PENALTY,
      choicesPerRound: PHASE1_CHOICES,
    };
  }

  // Pure merge for small catalogs (and just above survivor target)
  const skipToMerge = n <= PURE_MERGE_MAX;
  const survivors = skipToMerge
    ? n
    : clamp(Math.min(survivorTarget, n), topK, n);

  const coverageRounds = Math.ceil(n / PHASE1_CHOICES);
  const phase1RankingRounds = skipToMerge
    ? 0
    : Math.max(PHASE1_RANKING_MIN, Math.ceil(n * PHASE1_RANKING_OF_N));
  const phase1Rounds = skipToMerge ? 0 : coverageRounds + phase1RankingRounds;
  const phase2Estimate = estimateMergeTreeWork(survivors);
  const maxRounds = phase1Rounds + phase2Estimate;

  const minMatchesBeforeCut = n >= 30 ? 2 : 1;

  return {
    songCount: n,
    topK,
    phase1Choices: PHASE1_CHOICES,
    phase2Choices: PHASE2_CHOICES,
    survivors,
    skipToMerge,
    coverageRounds,
    phase1RankingRounds,
    phase1Rounds,
    phase2Estimate,
    maxRounds,
    minMatchesBeforeCut,
    underMatchPenalty: UNDER_MATCH_PENALTY,
    choicesPerRound: PHASE1_CHOICES,
    rankingRounds: phase1RankingRounds,
    minRoundsBeforeStop: phase1Rounds,
    secondChanceRounds: 0,
    stableRoundsRequired: 2,
    minMatchesInTop: minMatchesBeforeCut,
    minRatingGapAtCut: 18,
    softCutFactor: 0.5,
    contenderPool: survivors,
    lateStopWindow: 0,
    lockInLeadRounds: 4,
  };
}

export function getProgressPercent(currentRound, maxRounds) {
  if (maxRounds <= 0) return 100;
  return Math.min(100, Math.round((currentRound / maxRounds) * 100));
}

export function describeBudgets(sizes = [20, 24, 25, 40, 60, 88]) {
  return sizes.map((n) => {
    const b = calculateSessionBudget(n);
    return {
      n,
      skipMerge: b.skipToMerge,
      p1: b.phase1Rounds,
      survivors: b.survivors,
      p2est: b.phase2Estimate,
      max: b.maxRounds,
    };
  });
}
