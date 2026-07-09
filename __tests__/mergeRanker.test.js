import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MergeRanker } from "../src/mergeRanker.js";

describe("MergeRanker", () => {
  it("returns single item complete immediately", () => {
    const r = new MergeRanker([{ id: 1, title: "A" }]);
    assert.equal(r.isComplete(), true);
    assert.deepEqual(
      r.getRankedItems().map((x) => x.id),
      [1],
    );
  });

  it("produces full order under a consistent comparator", () => {
    // Higher id is preferred (always pick larger id)
    const items = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, title: `S${id}` }));
    const ranker = new MergeRanker(items);
    let guard = 0;
    while (!ranker.isComplete() && guard < 200) {
      const cmp = ranker.getCurrentComparison();
      assert.ok(cmp, "expected a comparison");
      // Prefer higher id
      if (cmp.a.id >= cmp.b.id) ranker.preferA();
      else ranker.preferB();
      guard++;
    }
    assert.equal(ranker.isComplete(), true);
    const ranked = ranker.getRankedItems().map((x) => x.id);
    assert.deepEqual(ranked, [8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("getCurrentComparison is stable until prefer", () => {
    const items = [1, 2, 3, 4].map((id) => ({ id }));
    const ranker = new MergeRanker(items);
    const a = ranker.getCurrentComparison();
    const b = ranker.getCurrentComparison();
    assert.equal(a.a.id, b.a.id);
    assert.equal(a.b.id, b.b.id);
  });

  it("progress totalSize matches finishSize at completion", () => {
    const items = [1, 2, 3, 4, 5].map((id) => ({ id }));
    const ranker = new MergeRanker(items);
    const start = ranker.getProgress();
    assert.ok(start.totalSize > 0);
    while (!ranker.isComplete()) {
      const cmp = ranker.getCurrentComparison();
      if (cmp.a.id >= cmp.b.id) ranker.preferA();
      else ranker.preferB();
    }
    const end = ranker.getProgress();
    assert.equal(end.finishSize, end.totalSize);
    assert.equal(end.isComplete, true);
  });
});
