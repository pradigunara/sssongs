/**
 * Short hybrid Top-K sorter:
 *   Phase 1 — 3-choice Elo discovery + soft cut to ~20 survivors
 *   Phase 2 — pairwise merge-sort for true ordering of survivors
 *
 * If the selected catalog is small (≤ PURE_MERGE_MAX), skips to merge-sort.
 */
import {
  calculateSessionBudget,
  getProgressPercent,
  INITIAL_RATING,
  BASE_K,
  HIGH_K,
  PHASE1_CHOICES,
  UNDER_MATCH_PENALTY,
} from "./roundCalculator.js";
import { MergeRanker } from "./mergeRanker.js";

export class SongSorterCore {
  constructor(songs, idField = "deezerId") {
    const availableSongs = songs.filter((song) => {
      const providerId = song[idField];
      return providerId !== null && providerId !== undefined && providerId !== "";
    });

    this.idField = idField;
    this.budget = calculateSessionBudget(availableSongs.length);
    this.totalRounds = this.budget.maxRounds;
    this.topK = this.budget.topK;

    this.songs = availableSongs.map((song) => ({
      ...song,
      rating: INITIAL_RATING,
      matches: 0,
      wins: 0,
      losses: 0,
      eliminated: false,
    }));

    this.phase = this.budget.skipToMerge ? 2 : 1;
    this.currentRound = 0;
    this.history = [];
    this.currentRoundOptions = null;
    this.pendingRoundPayload = null; // pure getCurrentRound cache
    this.mergeRanker = null;
    this.survivors = [];
    this.finalOrder = null;
    this.phase1CompletedRounds = 0;

    if (this.phase === 2) {
      this.#startPhase2(this.songs);
    }
  }

  isComplete() {
    if (this.finalOrder) return true;
    if (this.phase === 2 && this.mergeRanker) {
      return this.mergeRanker.isComplete();
    }
    return false;
  }

  expectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  }

  kFactor(songA, songB) {
    const minM = Math.min(songA.matches, songB.matches);
    if (minM < 2) return HIGH_K;
    return BASE_K;
  }

  applyElo(winner, loser) {
    const K = this.kFactor(winner, loser);
    const expW = this.expectedScore(winner.rating, loser.rating);
    const expL = this.expectedScore(loser.rating, winner.rating);
    winner.rating += K * (1 - expW);
    loser.rating += K * (0 - expL);
    winner.wins += 1;
    loser.losses += 1;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /** Effective rating for soft cut: mild penalty for under-matched songs. */
  cutScore(song) {
    const minM = this.budget.minMatchesBeforeCut;
    const penalty =
      this.budget.underMatchPenalty ?? UNDER_MATCH_PENALTY;
    const deficit = Math.max(0, minM - song.matches);
    return song.rating - deficit * penalty;
  }

  getSortedByRating() {
    return [...this.songs]
      .filter((s) => !s.eliminated)
      .sort((a, b) => {
        if ((a.matches > 0) !== (b.matches > 0)) return a.matches > 0 ? -1 : 1;
        if (b.rating !== a.rating) return b.rating - a.rating;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.matches !== a.matches) return b.matches - a.matches;
        return String(a.title).localeCompare(String(b.title));
      });
  }

  #pickPhase1Group() {
    const active = this.songs.filter((s) => !s.eliminated);
    const k = PHASE1_CHOICES;
    const unseen = active.filter((s) => s.matches === 0);
    const cov = this.budget.coverageRounds;
    const minM = this.budget.minMatchesBeforeCut;

    if (unseen.length >= k && this.phase1CompletedRounds < cov) {
      return this.shuffleArray(unseen).slice(0, k);
    }

    if (unseen.length > 0 && this.phase1CompletedRounds < cov) {
      const rest = this.shuffleArray(active.filter((s) => s.matches > 0));
      return [...unseen, ...rest].slice(0, k);
    }

    // After coverage: prioritize second looks for current top band
    // so true contenders are measured before the soft cut.
    const ranked = [...active].sort(
      (a, b) => this.cutScore(b) - this.cutScore(a),
    );
    const protectBand = ranked.slice(
      0,
      Math.min(active.length, this.budget.survivors + 6),
    );
    const needLooks = protectBand.filter((s) => s.matches < minM);
    if (needLooks.length >= k) {
      return this.shuffleArray(needLooks).slice(0, k);
    }

    const under = active.filter((s) => s.matches < minM);
    if (under.length >= k) {
      return this.shuffleArray(under).slice(0, k);
    }

    // Mix remaining under-sampled with top Elo
    const poolMap = new Map();
    needLooks.forEach((s) => poolMap.set(s.id, s));
    under.forEach((s) => poolMap.set(s.id, s));
    ranked
      .slice(0, Math.min(30, ranked.length))
      .forEach((s) => poolMap.set(s.id, s));
    const pool = [...poolMap.values()];
    if (pool.length >= k) return this.shuffleArray(pool).slice(0, k);
    return this.shuffleArray(active).slice(0, Math.min(k, active.length));
  }

  #startPhase2(survivorSongs) {
    this.phase = 2;
    this.survivors = survivorSongs.map((s) => s);
    this.mergeRanker = new MergeRanker(this.survivors);
    this.pendingRoundPayload = null;
    this.currentRoundOptions = null;

    // Align session cap with real merge-tree work once ranker exists
    const mp = this.mergeRanker.getProgress();
    const p1Done = this.phase1CompletedRounds;
    this.budget = {
      ...this.budget,
      phase2Estimate: mp.totalSize,
      maxRounds: p1Done + mp.totalSize,
    };
    this.totalRounds = this.budget.maxRounds;

    if (this.mergeRanker.isComplete()) {
      this.finalOrder = this.mergeRanker.getRankedItems();
    }
  }

  /**
   * Soft cut: single ranking by cutScore (Elo − under-match penalty).
   * Also always keep songs still in the protect band that are close to the cut.
   */
  #cutToSurvivors() {
    const target = this.budget.survivors;
    const minM = this.budget.minMatchesBeforeCut;
    const all = [...this.songs];

    const ordered = all.sort((a, b) => {
      const sa = this.cutScore(a);
      const sb = this.cutScore(b);
      if (sb !== sa) return sb - sa;
      if (b.rating !== a.rating) return b.rating - a.rating;
      if (b.matches !== a.matches) return b.matches - a.matches;
      if (b.wins !== a.wins) return b.wins - a.wins;
      return String(a.title).localeCompare(String(b.title));
    });

    const kept = [];
    const keptIds = new Set();

    // Primary: top by cutScore
    for (const s of ordered) {
      if (kept.length >= target) break;
      kept.push(s);
      keptIds.add(s.id);
    }

    // Safety: if cut line is tight, pull in under-matched high-Elo songs
    // still within a band of the last kept score (favorites with one unlucky loss).
    if (kept.length > 0 && kept.length === target) {
      const cutLine = this.cutScore(kept[kept.length - 1]);
      const band = 50; // Elo-ish points of cutScore
      for (const s of ordered) {
        if (keptIds.has(s.id)) continue;
        if (s.matches >= minM) continue;
        if (this.cutScore(s) >= cutLine - band && s.rating >= cutLine - band) {
          // Swap out the lowest-cut kept if this contender is competitive
          // Prefer not to exceed target — replace weakest kept if better raw rating
          const weakest = kept[kept.length - 1];
          if (s.rating > weakest.rating && s.matches >= 1) {
            keptIds.delete(weakest.id);
            kept.pop();
            kept.push(s);
            keptIds.add(s.id);
            kept.sort((a, b) => this.cutScore(b) - this.cutScore(a));
          }
        }
      }
    }

    // Re-trim to target after swaps
    while (kept.length > target) {
      const drop = kept.pop();
      keptIds.delete(drop.id);
    }

    this.songs.forEach((s) => {
      s.eliminated = !keptIds.has(s.id);
    });
    this.#startPhase2(kept);
  }

  #sessionTotals() {
    if (this.phase === 2 && this.mergeRanker) {
      const mp = this.mergeRanker.getProgress();
      const p1 = this.phase1CompletedRounds;
      const total = Math.max(1, p1 + mp.totalSize);
      const done = p1 + mp.finishSize;
      return { total, done, p1, p2Total: mp.totalSize, p2Done: mp.finishSize };
    }
    const total = Math.max(1, this.budget.maxRounds);
    const done = this.currentRound;
    return {
      total,
      done,
      p1: this.phase1CompletedRounds,
      p2Total: this.budget.phase2Estimate,
      p2Done: 0,
    };
  }

  getCurrentRound() {
    if (this.isComplete()) {
      return null;
    }

    // Pure re-entry: return the same pending options
    if (this.pendingRoundPayload && this.currentRoundOptions?.length >= 2) {
      return this.#refreshPendingPayload(this.pendingRoundPayload);
    }

    if (this.phase === 2) {
      return this.#getPhase2Round();
    }

    // Phase 1
    if (this.phase1CompletedRounds >= this.budget.phase1Rounds) {
      this.#cutToSurvivors();
      if (this.isComplete()) return null;
      return this.#getPhase2Round();
    }

    const options = this.#pickPhase1Group();
    if (!options || options.length < 2) {
      this.#cutToSurvivors();
      if (this.isComplete()) return null;
      return this.#getPhase2Round();
    }

    this.currentRoundOptions = options;
    const payload = this.#buildPhase1Payload(options);
    this.pendingRoundPayload = payload;
    return payload;
  }

  #refreshPendingPayload(payload) {
    const { total, done } = this.#sessionTotals();
    const roundNum = this.currentRound + 1;
    return {
      ...payload,
      round: roundNum,
      roundDisplay: roundNum,
      totalRounds: Math.max(total, roundNum),
      progress: getProgressPercent(done + 1, total),
    };
  }

  #buildPhase1Payload(options) {
    const { total, done } = this.#sessionTotals();
    const roundNum = this.currentRound + 1;
    const n = options.length;
    return {
      round: roundNum,
      roundDisplay: roundNum,
      totalRounds: Math.max(total, roundNum),
      options,
      progress: getProgressPercent(done + 1, total),
      phase: 1,
      phaseMessage: `Discovery — pick your favorite of ${n}`,
      phaseInfo: { phase: 1, type: "discover", description: "Discovery" },
      choices: n,
      isFinalShowdown: false,
    };
  }

  #getPhase2Round() {
    if (!this.mergeRanker || this.mergeRanker.isComplete()) {
      this.finalOrder = this.mergeRanker?.getRankedItems() || this.survivors;
      this.pendingRoundPayload = null;
      return null;
    }

    // Stable pending comparison
    if (this.pendingRoundPayload && this.currentRoundOptions?.length === 2) {
      return this.#refreshPendingPayload(this.pendingRoundPayload);
    }

    const cmp = this.mergeRanker.getCurrentComparison();
    if (!cmp) {
      this.finalOrder = this.mergeRanker.getRankedItems();
      this.pendingRoundPayload = null;
      return null;
    }

    const options = [cmp.a, cmp.b];
    this.currentRoundOptions = options;
    const { total, done } = this.#sessionTotals();
    const roundNum = this.currentRound + 1;
    const payload = {
      round: roundNum,
      roundDisplay: roundNum,
      totalRounds: Math.max(total, roundNum),
      options,
      progress: Math.min(99, getProgressPercent(done + 1, total)),
      phase: 2,
      phaseMessage: "Final ranking — head-to-head",
      phaseInfo: { phase: 2, type: "merge", description: "Final ranking" },
      choices: 2,
      isFinalShowdown: true,
      mergeProgress: this.mergeRanker.getProgress(),
    };
    this.pendingRoundPayload = payload;
    return payload;
  }

  selectWinner(winnerId) {
    if (this.isComplete()) return;

    if (this.phase === 2) {
      const options = this.currentRoundOptions;
      if (!options || options.length < 2) return;
      const winner = options.find((s) => s.id === winnerId);
      if (!winner) return;

      // Count phase-2 exposure for stats / "shown" metrics
      options.forEach((s) => {
        s.matches += 1;
      });
      for (const s of options) {
        if (s.id !== winner.id) {
          s.losses += 1;
          winner.wins += 1;
        }
      }

      this.mergeRanker.preferItem(winner);
      this.history.push({
        round: this.currentRound + 1,
        phase: 2,
        options: options.map((s) => s.id),
        winner: winnerId,
        timestamp: Date.now(),
      });
      this.currentRound += 1;
      this.currentRoundOptions = null;
      this.pendingRoundPayload = null;

      if (this.mergeRanker.isComplete()) {
        this.finalOrder = this.mergeRanker.getRankedItems();
        // Final totalRounds = actual clicks
        this.budget = {
          ...this.budget,
          maxRounds: this.currentRound,
        };
        this.totalRounds = this.currentRound;
      }
      return;
    }

    // Phase 1
    const options = this.currentRoundOptions;
    if (!options || options.length < 2) return;

    const winner = options.find((s) => s.id === winnerId);
    if (!winner) return;

    options.forEach((s) => {
      s.matches += 1;
    });
    for (const s of options) {
      if (s.id !== winner.id) this.applyElo(winner, s);
    }

    this.history.push({
      round: this.currentRound + 1,
      phase: 1,
      options: options.map((s) => s.id),
      winner: winnerId,
      timestamp: Date.now(),
    });
    this.currentRound += 1;
    this.phase1CompletedRounds += 1;
    this.currentRoundOptions = null;
    this.pendingRoundPayload = null;

    if (this.phase1CompletedRounds >= this.budget.phase1Rounds) {
      this.#cutToSurvivors();
    }
  }

  getRankings() {
    if (this.finalOrder && this.finalOrder.length) {
      const top = this.finalOrder.map((song, index) => ({
        rank: index + 1,
        ...song,
      }));
      const topIds = new Set(this.finalOrder.map((s) => s.id));
      const rest = this.songs
        .filter((s) => !topIds.has(s.id))
        .sort((a, b) => b.rating - a.rating || b.wins - a.wins);
      return [
        ...top,
        ...rest.map((song, i) => ({
          rank: top.length + i + 1,
          ...song,
        })),
      ];
    }

    return this.getSortedByRating().map((song, index) => ({
      rank: index + 1,
      ...song,
    }));
  }

  getTop10() {
    return this.getRankings().slice(0, this.topK);
  }

  getStats() {
    const rankings = this.getRankings();
    const top = rankings.slice(0, this.topK);
    const { total } = this.#sessionTotals();
    return {
      roundsPlayed: this.currentRound,
      maxRounds: Math.max(this.budget.maxRounds, total, this.currentRound),
      stoppedEarly: false,
      phase: this.phase,
      phase1Rounds: this.budget.phase1Rounds,
      phase2Estimate: this.budget.phase2Estimate,
      survivors: this.budget.survivors,
      skipToMerge: this.budget.skipToMerge,
      top10: top.map((s) => s.title),
      topK: this.topK,
      songCount: this.songs.length,
      eliminatedSongs: this.songs.filter((s) => s.eliminated).length,
      avgMatches: (
        this.songs.reduce((s, x) => s + x.matches, 0) /
        Math.max(1, this.songs.length)
      ).toFixed(1),
      unseen: this.songs.filter((s) => s.matches === 0).length,
      coverageRounds: this.budget.coverageRounds,
      rankingRounds: this.budget.phase1RankingRounds,
      comparisonsPlayed: this.history.length,
    };
  }
}
