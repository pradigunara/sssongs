import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SongSorterCore } from "../src/songSorter.core.js";
import {
  calculateSessionBudget,
  PURE_MERGE_MAX,
} from "../src/roundCalculator.js";
import {
  averageTrials,
  createSimulatedUser,
  makeSyntheticSongs,
  runSimulatedSession,
} from "../src/test/simulatedUser.js";

describe("SongSorterCore hybrid + simulated user", () => {
  it("completes within budget (pure merge path)", () => {
    const songs = makeSyntheticSongs(16);
    const budget = calculateSessionBudget(16);
    assert.equal(budget.skipToMerge, true);

    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({
      songs,
      seed: 11,
      swayRate: 0,
      closeSwayRate: 0,
    });
    const result = runSimulatedSession(sorter, user);

    assert.equal(result.complete, true);
    assert.ok(result.roundsPlayed > 0);
    assert.equal(result.recovered.length, sorter.topK);
    // Pure merge should mark songs as shown
    assert.ok(Number(sorter.getStats().avgMatches) > 0);
  });

  it("with zero sway, merge phase orders top-K correctly on small n", () => {
    const songs = makeSyntheticSongs(18);
    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({
      songs,
      seed: 42,
      swayRate: 0,
      closeSwayRate: 0,
    });
    const result = runSimulatedSession(sorter, user);

    assert.ok(result.top10Accuracy >= 0.9, `set acc ${result.top10Accuracy}`);
    assert.ok(
      result.rankAgreement >= 0.95,
      `pairwise order ${result.rankAgreement}`,
    );
  });

  it("getCurrentRound is stable (does not reshuffle pending options)", () => {
    const songs = makeSyntheticSongs(36);
    const sorter = new SongSorterCore(songs, "deezerId");
    const a = sorter.getCurrentRound();
    const b = sorter.getCurrentRound();
    assert.ok(a && b);
    assert.deepEqual(
      a.options.map((s) => s.id),
      b.options.map((s) => s.id),
    );
  });

  it("uses 3 options in discovery and 2 in final sort", () => {
    const songs = makeSyntheticSongs(36);
    assert.equal(calculateSessionBudget(36).skipToMerge, false);

    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({ songs, seed: 7, swayRate: 0 });

    const r1 = sorter.getCurrentRound();
    assert.ok(r1);
    assert.equal(r1.phase, 1);
    assert.equal(r1.options.length, 3);

    let guard = 0;
    while (!sorter.isComplete() && sorter.phase === 1 && guard < 300) {
      const round = sorter.getCurrentRound();
      if (!round?.options || sorter.phase !== 1) break;
      let best = round.options[0];
      for (const o of round.options) {
        if (user.scoreOf(o) > user.scoreOf(best)) best = o;
      }
      sorter.selectWinner(best.id);
      guard++;
    }

    if (!sorter.isComplete()) {
      const r2 = sorter.getCurrentRound();
      assert.ok(r2, "expected a phase-2 round");
      assert.equal(r2.phase, 2);
      assert.equal(r2.options.length, 2);
    }
  });

  it("freezes exactly budget.survivors after phase-1 cut", () => {
    const songs = makeSyntheticSongs(36);
    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({ songs, seed: 9, swayRate: 0 });

    let guard = 0;
    while (sorter.phase === 1 && !sorter.isComplete() && guard < 400) {
      const round = sorter.getCurrentRound();
      if (!round?.options) break;
      let best = round.options[0];
      for (const o of round.options) {
        if (user.scoreOf(o) > user.scoreOf(best)) best = o;
      }
      sorter.selectWinner(best.id);
      guard++;
    }

    // Force cut if still in phase 1 edge case
    if (sorter.phase === 1) {
      while (sorter.phase === 1 && guard < 500) {
        const round = sorter.getCurrentRound();
        if (!round?.options) break;
        sorter.selectWinner(round.options[0].id);
        guard++;
      }
    }

    assert.equal(sorter.phase, 2);
    const alive = sorter.songs.filter((s) => !s.eliminated);
    assert.equal(alive.length, sorter.budget.survivors);
    assert.equal(sorter.survivors.length, sorter.budget.survivors);
  });

  it("hybrid zero-sway recovers most of true top-10 on mid catalog", () => {
    // n just above pure-merge threshold
    const n = PURE_MERGE_MAX + 8; // 32
    const songs = makeSyntheticSongs(n);
    const summary = averageTrials({
      trials: 10,
      setup: (t) => ({
        sorter: new SongSorterCore(songs, "deezerId"),
        user: createSimulatedUser({
          songs,
          seed: 2000 + t,
          swayRate: 0,
          closeSwayRate: 0,
        }),
      }),
    });

    assert.ok(
      summary.avgTop10Accuracy >= 0.7,
      `avg top10 set acc ${summary.avgTop10Accuracy}`,
    );
    assert.ok(
      summary.avgRankAgreement >= 0.85,
      `avg pairwise order ${summary.avgRankAgreement}`,
    );
  });

  it("never puts eliminated songs above survivors in final rankings", () => {
    const songs = makeSyntheticSongs(40);
    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({ songs, seed: 3, swayRate: 0 });
    runSimulatedSession(sorter, user);

    const rankings = sorter.getRankings();
    const survivorCount = sorter.budget.survivors;
    const topSlice = rankings.slice(0, survivorCount);
    for (const song of topSlice) {
      assert.equal(
        song.eliminated,
        false,
        `${song.title} should be a survivor`,
      );
    }
  });

  it("progress totalRounds does not stay below completed rounds mid-session", () => {
    const songs = makeSyntheticSongs(30);
    const sorter = new SongSorterCore(songs, "deezerId");
    const user = createSimulatedUser({ songs, seed: 1, swayRate: 0 });

    for (let i = 0; i < 15; i++) {
      const round = sorter.getCurrentRound();
      if (!round) break;
      assert.ok(
        round.totalRounds >= round.roundDisplay,
        `round ${round.roundDisplay} / ${round.totalRounds}`,
      );
      let best = round.options[0];
      for (const o of round.options) {
        if (user.scoreOf(o) > user.scoreOf(best)) best = o;
      }
      sorter.selectWinner(best.id);
    }
  });
});
