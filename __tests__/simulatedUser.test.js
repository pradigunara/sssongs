import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignLatentScores,
  createSeededRng,
  createSimulatedUser,
  makeSyntheticSongs,
} from "../src/test/simulatedUser.js";

describe("simulatedUser", () => {
  it("seeded rng is deterministic", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b(), b()];
    assert.deepEqual(seqA, seqB);
  });

  it("latent scores induce a total order", () => {
    const songs = makeSyntheticSongs(20);
    const scores = assignLatentScores(songs, createSeededRng(7));
    assert.equal(scores.size, 20);
    const values = [...scores.values()];
    assert.equal(new Set(values).size, 20); // all unique
  });

  it("with swayRate=0 always prefers higher latent score", () => {
    const songs = makeSyntheticSongs(12);
    const user = createSimulatedUser({
      songs,
      seed: 99,
      swayRate: 0,
      closeSwayRate: 0,
    });

    for (let i = 0; i < songs.length; i++) {
      for (let j = i + 1; j < songs.length; j++) {
        const a = songs[i];
        const b = songs[j];
        const winner = user.pickWinner(a, b);
        const expected =
          user.scoreOf(a) >= user.scoreOf(b) ? a.id : b.id;
        assert.equal(winner, expected);
      }
    }
  });

  it("with high closeSway can flip close pairs across many draws", () => {
    const songs = makeSyntheticSongs(8);
    // Fixed adjacent scores so they are always "close"
    const latentScores = new Map([
      [1, 10],
      [2, 9], // gap 1 → close
      [3, 1],
      [4, 2],
      [5, 3],
      [6, 4],
      [7, 5],
      [8, 6],
    ]);
    const user = createSimulatedUser({
      songs,
      seed: 1,
      swayRate: 0,
      closeSwayRate: 0.5,
      closeMargin: 2,
      latentScores,
    });

    const a = songs.find((s) => s.id === 1);
    const b = songs.find((s) => s.id === 2);
    let flips = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      if (user.pickWinner(a, b) === b.id) flips += 1;
    }
    // Expect roughly ~50% flips; allow wide band for PRNG variance
    assert.ok(flips > 40 && flips < 160, `flips=${flips}`);
  });

  it("trueTopK returns favorites first", () => {
    const songs = makeSyntheticSongs(15);
    const user = createSimulatedUser({ songs, seed: 3, swayRate: 0 });
    const top3 = user.trueTopK(3);
    assert.equal(top3.length, 3);
    // All top scores should beat every non-top song
    const topIds = user.trueTopKIds(3);
    const minTop = Math.min(...topIds.map((id) => user.latentScores.get(id)));
    for (const s of songs) {
      if (!topIds.includes(s.id)) {
        assert.ok(user.scoreOf(s) < minTop);
      }
    }
  });
});
