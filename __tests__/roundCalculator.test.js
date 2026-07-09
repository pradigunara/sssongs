import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSessionBudget,
  PHASE1_CHOICES,
  PURE_MERGE_MAX,
  SURVIVOR_TARGET,
  estimateMergeTreeWork,
  estimateMergeComparisons,
} from "../src/roundCalculator.js";
import { MergeRanker } from "../src/mergeRanker.js";

describe("calculateSessionBudget (short hybrid)", () => {
  it("uses 3-choice coverage ceil(n/3) for phase 1", () => {
    for (const n of [40, 60, 88]) {
      const b = calculateSessionBudget(n);
      assert.equal(b.coverageRounds, Math.ceil(n / PHASE1_CHOICES));
      assert.equal(b.phase1Choices, 3);
      assert.equal(b.skipToMerge, false);
      assert.ok(b.phase1Rounds >= b.coverageRounds);
    }
  });

  it("skips to merge-sort when n <= PURE_MERGE_MAX", () => {
    for (const n of [16, 20, PURE_MERGE_MAX]) {
      const b = calculateSessionBudget(n);
      assert.equal(b.skipToMerge, true, `n=${n}`);
      assert.equal(b.phase1Rounds, 0);
      assert.equal(b.survivors, n);
      assert.ok(b.phase2Estimate > 0);
    }
    const hybrid = calculateSessionBudget(PURE_MERGE_MAX + 1);
    assert.equal(hybrid.skipToMerge, false);
    assert.equal(hybrid.survivors, SURVIVOR_TARGET);
  });

  it("aligns phase2Estimate with MergeRanker tree totalSize", () => {
    for (const m of [2, 5, 10, 16, 20, 24]) {
      const items = Array.from({ length: m }, (_, i) => ({ id: i }));
      const ranker = new MergeRanker(items);
      const mp = ranker.getProgress();
      assert.equal(
        estimateMergeTreeWork(m),
        mp.totalSize,
        `m=${m} estimate vs ranker`,
      );
      assert.equal(estimateMergeComparisons(m), estimateMergeTreeWork(m));
    }
  });

  it("scales total budget with n for hybrid sizes", () => {
    const a = calculateSessionBudget(40);
    const b = calculateSessionBudget(88);
    assert.ok(a.maxRounds < b.maxRounds);
  });

  it("handles edge catalogs", () => {
    assert.equal(calculateSessionBudget(0).maxRounds, 0);
    assert.equal(calculateSessionBudget(1).topK, 1);
    const two = calculateSessionBudget(2);
    assert.equal(two.skipToMerge, true);
  });
});
