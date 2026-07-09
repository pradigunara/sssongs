/**
 * Offline simulation of the Elo top-10 sorter with a noisy simulated user.
 * Usage: node scripts/simulateElo.js
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SongSorterCore } from "../src/songSorter.core.js";
import { calculateSessionBudget } from "../src/roundCalculator.js";
import {
  averageTrials,
  createSimulatedUser,
} from "../src/test/simulatedUser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const songsPath = join(__dirname, "../src/data/triples-deezer-songs.json");
const data = JSON.parse(readFileSync(songsPath, "utf8"));
const songs = data.songs || [];

const budget = calculateSessionBudget(songs.length);
console.log("Catalog:", songs.length, "songs");
console.log("Budget:", {
  coverage: budget.coverageRounds,
  ranking: budget.rankingRounds,
  max: budget.maxRounds,
  minStop: budget.minRoundsBeforeStop,
  topK: budget.topK,
});
console.log("---");

// Perfect user (no sway)
const perfect = averageTrials({
  trials: 10,
  setup: (t) => ({
    sorter: new SongSorterCore(songs, "deezerId"),
    user: createSimulatedUser({
      songs,
      seed: 200 + t,
      swayRate: 0,
      closeSwayRate: 0,
    }),
  }),
});

// Realistic user: small base sway, more when close
const noisy = averageTrials({
  trials: 10,
  setup: (t) => ({
    sorter: new SongSorterCore(songs, "deezerId"),
    user: createSimulatedUser({
      songs,
      seed: 300 + t,
      swayRate: 0.08,
      closeSwayRate: 0.25,
      closeMargin: 2,
    }),
  }),
});

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function report(label, summary) {
  console.log(label);
  console.log(
    `  avg rounds: ${summary.avgRounds.toFixed(1)}  early: ${(summary.earlyRate * 100).toFixed(0)}%`,
  );
  console.log(
    `  top-10 set accuracy: ${pct(summary.avgTop10Accuracy)}  (${summary.avgOverlap.toFixed(2)}/${budget.topK} songs)`,
  );
  console.log(
    `  top-1 / top-3 / top-5: ${pct(summary.avgTop1Accuracy)} / ${pct(summary.avgTop3Accuracy)} / ${pct(summary.avgTop5Accuracy)}`,
  );
  console.log(
    `  exact-position accuracy: ${pct(summary.avgTopKOrderAccuracy)}  pairwise order (∩): ${pct(summary.avgRankAgreement)}`,
  );
  console.log(
    `  conditional recall (among shown true top-K): ${pct(summary.avgConditionalRecall)}`,
  );
  const sample = summary.results[0];
  console.log(`  sample true top: ${sample.trueTop.slice(0, 5).join(" | ")}…`);
  console.log(
    `  sample recovered: ${sample.recovered.slice(0, 5).join(" | ")}…`,
  );
}

report("Perfect user (sway=0)", perfect);
console.log("");
report("Noisy user (sway 8% / close 25%)", noisy);
