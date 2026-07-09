/**
 * Sweep 2-choice vs 3-choice Elo at fixed round budgets.
 * Finds budgets where top-10 set accuracy approaches ~80%.
 *
 * Usage:
 *   node scripts/compareChoicesAccuracy.js
 *   node scripts/compareChoicesAccuracy.js --trials 30 --target 0.8
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createSeededRng,
  createSimulatedUser,
  makeSyntheticSongs,
} from "../src/test/simulatedUser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    trials: 25,
    target: 0.8,
    topK: 10,
    sway: 0,
    closeSway: 0,
    rounds: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--trials") out.trials = Number(args[++i]);
    else if (args[i] === "--target") out.target = Number(args[++i]);
    else if (args[i] === "--topK") out.topK = Number(args[++i]);
    else if (args[i] === "--sway") out.sway = Number(args[++i]);
    else if (args[i] === "--close-sway") out.closeSway = Number(args[++i]);
    else if (args[i] === "--rounds") {
      out.rounds = args[++i].split(",").map(Number);
    }
  }
  return out;
}

function elo(winner, loser, K = 36) {
  const expW = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
  const expL = 1 / (1 + 10 ** ((winner.rating - loser.rating) / 400));
  winner.rating += K * (1 - expW);
  loser.rating += K * (0 - expL);
  winner.wins++;
  loser.losses++;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sortedByRating(songs) {
  return [...songs].sort((a, b) => {
    if ((a.matches > 0) !== (b.matches > 0)) return a.matches > 0 ? -1 : 1;
    if (b.rating !== a.rating) return b.rating - a.rating;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return String(a.title).localeCompare(String(b.title));
  });
}

/**
 * Coverage = min(ceil(n/choices), ~65% of max) so ranking always gets budget.
 * Rest is ranking / second-chance / focus.
 */
function coverageRounds(n, choices, maxRounds) {
  const full = Math.ceil(n / choices);
  const reserve = Math.max(Math.ceil(maxRounds * 0.35), choices * 4);
  return Math.min(full, Math.max(choices, maxRounds - reserve));
}

function pickGroup(songs, choices, round, covRounds, topK, rng) {
  const unseen = songs.filter((s) => s.matches === 0);
  if (unseen.length >= choices && round < covRounds) {
    // album-ish diversity: just shuffle unseen
    return shuffle(unseen, rng).slice(0, choices);
  }

  const rankingRound = round - covRounds;
  const rankingBudget = Math.max(1, songs[0]?._maxRounds - covRounds || 40);
  const focusMode = rankingRound >= rankingBudget * 0.45;

  const srt = sortedByRating(songs).filter((s) => s.matches > 0);
  const poolMap = new Map();

  if (focusMode) {
    srt.slice(0, Math.min(Math.max(topK * 2 + 4, 20), srt.length)).forEach(
      (s) => poolMap.set(s.id, s),
    );
  } else {
    // Swiss-ish: all under-sampled + top band
    songs
      .filter((s) => s.matches > 0 && s.matches < 3)
      .forEach((s) => poolMap.set(s.id, s));
    srt.slice(0, Math.min(30, srt.length)).forEach((s) => poolMap.set(s.id, s));
  }

  if (unseen.length > 0 && rng() < 0.12) {
    const u = unseen[Math.floor(rng() * unseen.length)];
    poolMap.set(u.id, u);
  }

  let pool = [...poolMap.values()];
  if (pool.length < choices) {
    pool = songs.filter((s) => s.matches > 0);
  }
  if (pool.length < choices) pool = songs;

  // Prefer under-sampled when possible
  const under = pool.filter((s) => s.matches < 3);
  if (under.length >= choices && rng() < 0.55) {
    return shuffle(under, rng).slice(0, choices);
  }

  // Score pairs/triples: close ratings + under-sampled
  if (choices === 2 && pool.length >= 2) {
    let best = null;
    let bestScore = -Infinity;
    const focus = pool.length > 40 ? shuffle(pool, rng).slice(0, 35) : pool;
    for (let i = 0; i < focus.length; i++) {
      for (let j = i + 1; j < focus.length; j++) {
        const a = focus[i];
        const b = focus[j];
        const need = (3 - a.matches) + (3 - b.matches);
        const close = Math.max(0, 50 - Math.abs(a.rating - b.rating) / 6);
        const score = need * 20 + close + rng() * 3;
        if (score > bestScore) {
          bestScore = score;
          best = [a, b];
        }
      }
    }
    if (best) return shuffle(best, rng);
  }

  if (choices === 3 && pool.length >= 3) {
    // Sample candidate triples
    let best = null;
    let bestScore = -Infinity;
    const focus = pool.length > 28 ? shuffle(pool, rng).slice(0, 28) : pool;
    for (let t = 0; t < 80; t++) {
      const g = shuffle(focus, rng).slice(0, 3);
      if (g.length < 3) break;
      const need = g.reduce((s, x) => s + Math.max(0, 3 - x.matches), 0);
      const ratings = g.map((x) => x.rating);
      const spread = Math.max(...ratings) - Math.min(...ratings);
      const close = Math.max(0, 60 - spread / 5);
      const score = need * 18 + close + rng() * 3;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best) return shuffle(best, rng);
  }

  return shuffle(pool, rng).slice(0, choices);
}

function pickWinnerAmong(options, user) {
  // Chain 2-way picks so sway model stays consistent for k>2
  let champ = options[0];
  for (let i = 1; i < options.length; i++) {
    const id = user.pickWinner(champ, options[i]);
    champ = options.find((o) => o.id === id);
  }
  return champ.id;
}

function runSession({
  songs,
  choices,
  maxRounds,
  seed,
  topK,
  swayRate,
  closeSwayRate,
}) {
  const list = songs.map((s) => ({
    ...s,
    rating: 1500,
    matches: 0,
    wins: 0,
    losses: 0,
    _maxRounds: maxRounds,
  }));
  const byId = new Map(list.map((s) => [s.id, s]));
  const user = createSimulatedUser({
    songs,
    seed,
    swayRate,
    closeSwayRate,
    closeMargin: 2,
  });
  const rng = createSeededRng(seed + 17_000);
  const cov = coverageRounds(songs.length, choices, maxRounds);

  for (let r = 0; r < maxRounds; r++) {
    const group = pickGroup(list, choices, r, cov, topK, rng);
    if (group.length < 2) break;
    const opts = group.map((g) => songs.find((s) => s.id === g.id));
    const winnerId = pickWinnerAmong(opts, user);
    const winner = byId.get(winnerId);
    group.forEach((s) => {
      s.matches += 1;
    });
    for (const g of group) {
      if (g.id === winnerId) continue;
      elo(winner, byId.get(g.id));
    }
  }

  const ranking = sortedByRating(list);
  const recoveredIds = ranking.slice(0, topK).map((s) => s.id);
  const trueIds = user.trueTopKIds(topK);
  const overlap = recoveredIds.filter((id) => trueIds.includes(id)).length;

  // exact position
  let exact = 0;
  for (let i = 0; i < topK; i++) {
    if (recoveredIds[i] === trueIds[i]) exact += 1;
  }

  const avgMatches =
    list.reduce((s, x) => s + x.matches, 0) / Math.max(1, list.length);
  const unseen = list.filter((s) => s.matches === 0).length;

  return {
    overlap,
    accuracy: overlap / topK,
    orderAccuracy: exact / topK,
    avgMatches,
    unseen,
    coverageRounds: cov,
    eloEdges: maxRounds * (choices - 1),
  };
}

function sweep({ songs, label, choicesList, roundsList, trials, topK, sway, closeSway }) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`${label}  (n=${songs.length}, trials=${trials}, topK=${topK}, sway=${sway})`);
  console.log("=".repeat(72));
  console.log(
    "choices | rounds | top10-acc | order-acc | avgMatches | unseen | edges | cov",
  );
  console.log("-".repeat(72));

  const hits = []; // rounds where acc >= target tracked outside

  for (const choices of choicesList) {
    for (const maxRounds of roundsList) {
      let sumAcc = 0;
      let sumOrder = 0;
      let sumM = 0;
      let sumUnseen = 0;
      let cov = 0;
      let edges = 0;
      for (let t = 0; t < trials; t++) {
        const r = runSession({
          songs,
          choices,
          maxRounds,
          seed: 10_000 + choices * 1_000 + maxRounds * 3 + t,
          topK,
          swayRate: sway,
          closeSwayRate: closeSway,
        });
        sumAcc += r.accuracy;
        sumOrder += r.orderAccuracy;
        sumM += r.avgMatches;
        sumUnseen += r.unseen;
        cov = r.coverageRounds;
        edges = r.eloEdges;
      }
      const acc = sumAcc / trials;
      const order = sumOrder / trials;
      const row = {
        choices,
        maxRounds,
        acc,
        order,
        avgMatches: sumM / trials,
        unseen: sumUnseen / trials,
        edges,
        cov,
      };
      hits.push(row);
      const marker = acc >= 0.8 ? "  <-- ~80%+" : acc >= 0.7 ? "  (~70%)" : "";
      console.log(
        `  ${choices}-way  |  ${String(maxRounds).padStart(4)}  |  ${(acc * 100).toFixed(1).padStart(5)}%   |  ${(order * 100).toFixed(1).padStart(5)}%   |   ${row.avgMatches.toFixed(2)}    |  ${row.unseen.toFixed(1).padStart(4)}  |  ${String(edges).padStart(4)} | ${cov}${marker}`,
      );
    }
    console.log("-".repeat(72));
  }

  return hits;
}

function findMinRounds(hits, choices, target) {
  const rows = hits
    .filter((h) => h.choices === choices)
    .sort((a, b) => a.maxRounds - b.maxRounds);
  const hit = rows.find((r) => r.acc >= target);
  return hit || null;
}

// --- main ---
const opts = parseArgs();
const dataPath = join(__dirname, "../src/data/triples-deezer-songs.json");
const real = JSON.parse(readFileSync(dataPath, "utf8")).songs;

const defaultRounds = [
  40, 50, 60, 70, 80, 90, 100, 110, 120, 140, 160, 180, 200, 240, 280, 320,
];
const roundsList = opts.rounds || defaultRounds;
const choicesList = [2, 3];
const closeSway = opts.sway > 0 ? opts.closeSway || 0.25 : 0;

const all = [];

all.push(
  ...sweep({
    songs: makeSyntheticSongs(88),
    label: "SYNTHETIC catalog",
    choicesList,
    roundsList,
    trials: opts.trials,
    topK: opts.topK,
    sway: opts.sway,
    closeSway,
  }),
);

all.push(
  ...sweep({
    songs: real,
    label: "REAL Deezer catalog",
    choicesList,
    roundsList,
    trials: opts.trials,
    topK: opts.topK,
    sway: opts.sway,
    closeSway,
  }),
);

// Also small catalog reference
all.push(
  ...sweep({
    songs: makeSyntheticSongs(40),
    label: "SYNTHETIC small (n=40)",
    choicesList,
    roundsList: [30, 40, 50, 60, 70, 80, 100, 120],
    trials: opts.trials,
    topK: opts.topK,
    sway: opts.sway,
    closeSway,
  }),
);

console.log(`\n${"=".repeat(72)}`);
console.log(`Minimum rounds to reach ${(opts.target * 100).toFixed(0)}% top-10 set accuracy`);
console.log("=".repeat(72));

for (const [label, n, subset] of [
  ["synthetic n=88", 88, all.filter((h, i) => i < roundsList.length * 2)],
  [
    "REAL n=88",
    88,
    all.slice(roundsList.length * 2, roundsList.length * 4),
  ],
  ["synthetic n=40", 40, all.slice(roundsList.length * 4)],
]) {
  // Recompute cleanly per catalog by re-filtering from last sweeps is messy;
  // print from dedicated find using last run structure instead:
}

// Clean summary via dedicated re-aggregation
function summarizeCatalog(songs, label) {
  console.log(`\n${label} (n=${songs.length}):`);
  for (const choices of [2, 3]) {
    let found = null;
    for (const maxRounds of roundsList) {
      let sum = 0;
      for (let t = 0; t < opts.trials; t++) {
        sum += runSession({
          songs,
          choices,
          maxRounds,
          seed: 50_000 + choices * 500 + maxRounds + t,
          topK: opts.topK,
          swayRate: opts.sway,
          closeSwayRate: closeSway,
        }).accuracy;
      }
      const acc = sum / opts.trials;
      if (acc >= opts.target) {
        found = { maxRounds, acc };
        break;
      }
    }
    if (found) {
      console.log(
        `  ${choices}-choice: first hits target at ~${found.maxRounds} rounds (acc=${(found.acc * 100).toFixed(1)}%)`,
      );
    } else {
      const last = roundsList[roundsList.length - 1];
      let sum = 0;
      for (let t = 0; t < opts.trials; t++) {
        sum += runSession({
          songs,
          choices,
          maxRounds: last,
          seed: 60_000 + choices * 500 + t,
          topK: opts.topK,
          swayRate: opts.sway,
          closeSwayRate: closeSway,
        }).accuracy;
      }
      console.log(
        `  ${choices}-choice: did NOT reach ${(opts.target * 100).toFixed(0)}% by ${last} rounds (acc=${((sum / opts.trials) * 100).toFixed(1)}%)`,
      );
    }
  }
}

summarizeCatalog(makeSyntheticSongs(88), "SYNTHETIC");
summarizeCatalog(real, "REAL Deezer");
summarizeCatalog(makeSyntheticSongs(40), "SYNTHETIC n=40");

console.log(`
Notes:
  - top10-acc = |recovered top-10 ∩ true top-10| / 10  (set accuracy)
  - order-acc = exact position matches / 10  (much harder)
  - 3-choice applies Elo winner-vs-each-loser (2 edges/round); no loser-vs-loser
  - Same maxRounds compared fair; listening cost is higher for 3-choice
`);
