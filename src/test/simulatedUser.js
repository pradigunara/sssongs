/**
 * Simulated fan for song-sorter evaluation.
 *
 * Each user has a hidden total preference order (latent scores). When shown
 * two songs they usually pick the higher one, with occasional "sway" —
 * more likely when the pair is close.
 */

/**
 * Mulberry32 — small seeded PRNG (deterministic across runs).
 * @param {number} seed
 * @returns {() => number} float in [0, 1)
 */
export function createSeededRng(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build synthetic catalog for unit tests (no JSON imports needed).
 * @param {number} count
 * @param {{ idField?: string }} [opts]
 */
export function makeSyntheticSongs(count, opts = {}) {
  const idField = opts.idField || "deezerId";
  const songs = [];
  for (let i = 0; i < count; i++) {
    const albumIdx = Math.floor(i / 5);
    songs.push({
      id: i + 1,
      title: `Song ${String(i + 1).padStart(3, "0")}`,
      album: `Album ${albumIdx + 1}`,
      [idField]: `id-${i + 1}`,
    });
  }
  return songs;
}

/**
 * Assign strictly ordered latent scores (higher = more preferred).
 * Uses a seeded shuffle of ranks so order isn't id-order.
 *
 * @param {Array<{id: number|string}>} songs
 * @param {() => number} rng
 * @returns {Map<string|number, number>}
 */
export function assignLatentScores(songs, rng) {
  const order = [...songs];
  // Fisher–Yates with seeded rng
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const scores = new Map();
  // rank 0 = favorite → highest score
  order.forEach((song, rank) => {
    // Spread scores so "close" pairs are clear (adjacent ranks differ by 1)
    scores.set(song.id, order.length - rank);
  });
  return scores;
}

/**
 * @typedef {object} SimulatedUserOptions
 * @property {Array} songs
 * @property {number} [seed=1]
 * @property {number} [swayRate=0.08] base P(flip) when not close
 * @property {number} [closeSwayRate=0.25] P(flip) when |scoreA-scoreB| <= closeMargin
 * @property {number} [closeMargin=2] score distance treated as "close"
 * @property {Map} [latentScores] optional precomputed scores
 */

/**
 * Create a simulated user with internal ranking + noise.
 * @param {SimulatedUserOptions} options
 */
export function createSimulatedUser(options) {
  const {
    songs,
    seed = 1,
    swayRate = 0.08,
    closeSwayRate = 0.25,
    closeMargin = 2,
    latentScores: providedScores,
  } = options;

  const rng = createSeededRng(seed);
  const latentScores = providedScores || assignLatentScores(songs, rng);

  function scoreOf(song) {
    const s = latentScores.get(song.id);
    if (s === undefined) {
      throw new Error(`No latent score for song id=${song.id}`);
    }
    return s;
  }

  /**
   * Pick winner id between two songs.
   * @param {object} a
   * @param {object} b
   * @returns {number|string}
   */
  function pickWinner(a, b) {
    const sa = scoreOf(a);
    const sb = scoreOf(b);
    const preferred = sa >= sb ? a : b;
    const other = preferred === a ? b : a;
    const gap = Math.abs(sa - sb);
    const pFlip = gap <= closeMargin ? closeSwayRate : swayRate;
    if (pFlip > 0 && rng() < pFlip) {
      return other.id;
    }
    return preferred.id;
  }

  /**
   * True top-K titles by latent preference.
   * @param {number} k
   */
  function trueTopK(k) {
    return [...songs]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, k)
      .map((s) => s.title);
  }

  /**
   * True top-K ids by latent preference.
   * @param {number} k
   */
  function trueTopKIds(k) {
    return [...songs]
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, k)
      .map((s) => s.id);
  }

  return {
    seed,
    swayRate,
    closeSwayRate,
    closeMargin,
    latentScores,
    scoreOf,
    pickWinner,
    trueTopK,
    trueTopKIds,
    rng,
  };
}

/**
 * Run a full SongSorterCore session driven by a simulated user.
 * @param {import('../songSorter.core.js').SongSorterCore} sorter
 * @param {{ pickWinner: Function }} user
 * @param {{ maxGuard?: number }} [opts]
 */
export function runSimulatedSession(sorter, user, opts = {}) {
  const maxGuard =
    opts.maxGuard ?? Math.max(200, (sorter.budget?.maxRounds ?? 100) + 80);
  let guard = 0;
  const choices = [];

  while (!sorter.isComplete() && guard < maxGuard) {
    const round = sorter.getCurrentRound();
    if (!round || !round.options || round.options.length < 2) break;

    // Support 2- or 3-way rounds: pick best by latent chain (with sway)
    let champ = round.options[0];
    for (let i = 1; i < round.options.length; i++) {
      const id = user.pickWinner(champ, round.options[i]);
      champ = round.options.find((o) => o.id === id);
    }
    const winnerId = champ.id;
    choices.push({
      round: round.round,
      options: round.options.map((o) => o.id),
      winner: winnerId,
    });
    sorter.selectWinner(winnerId);
    guard += 1;
  }

  const stats = sorter.getStats();
  const topK = sorter.topK;
  const recovered = stats.top10 || [];
  const trueTop = user.trueTopK(topK);
  const trueIdsOrdered = user.trueTopKIds(topK);
  const trueIds = new Set(trueIdsOrdered);
  const recoveredIds = sorter
    .getRankings()
    .slice(0, topK)
    .map((s) => s.id);

  const overlap = recovered.filter((title) => trueTop.includes(title)).length;
  const overlapIds = recoveredIds.filter((id) => trueIds.has(id)).length;

  const shownIds = new Set(
    sorter.songs.filter((s) => s.matches > 0).map((s) => s.id),
  );
  const trueShown = trueIdsOrdered.filter((id) => shownIds.has(id));
  const recoveredOfShown = trueShown.filter((id) =>
    recoveredIds.includes(id),
  ).length;
  const conditionalRecall =
    trueShown.length > 0 ? recoveredOfShown / trueShown.length : 0;

  // --- Top-K accuracy metrics ---
  // Set accuracy (recall): fraction of true top-K that appear in recovered top-K
  const topKSetAccuracy = topK > 0 ? overlapIds / topK : 0;

  // Prefix set accuracy: top-1 / top-3 / top-5 / top-K
  const prefixSetAccuracy = (p) => {
    const t = new Set(trueIdsOrdered.slice(0, p));
    const r = recoveredIds.slice(0, p);
    const hit = r.filter((id) => t.has(id)).length;
    return p > 0 ? hit / p : 0;
  };

  // Exact-position hits: recovered[i] === true[i]
  let exactPositionHits = 0;
  for (let i = 0; i < topK; i++) {
    if (recoveredIds[i] === trueIdsOrdered[i]) exactPositionHits += 1;
  }
  const topKOrderAccuracy = topK > 0 ? exactPositionHits / topK : 0;

  // Among songs that appear in BOTH top-K sets, how often absolute rank agrees
  // (Spearman-friendly: correlation of latent ranks within the intersection).
  const intersection = recoveredIds.filter((id) => trueIds.has(id));
  let rankAgreement = 0;
  if (intersection.length >= 2) {
    // Compare pairwise order within intersection
    let agree = 0;
    let pairs = 0;
    for (let i = 0; i < intersection.length; i++) {
      for (let j = i + 1; j < intersection.length; j++) {
        const idA = intersection[i];
        const idB = intersection[j];
        const trueOrder =
          trueIdsOrdered.indexOf(idA) < trueIdsOrdered.indexOf(idB);
        const recOrder =
          recoveredIds.indexOf(idA) < recoveredIds.indexOf(idB);
        if (trueOrder === recOrder) agree += 1;
        pairs += 1;
      }
    }
    rankAgreement = pairs > 0 ? agree / pairs : 0;
  } else if (intersection.length === 1) {
    rankAgreement = 1;
  }

  return {
    stats,
    choices,
    roundsPlayed: stats.roundsPlayed,
    stoppedEarly: stats.stoppedEarly,
    overlap,
    overlapIds,
    topK,
    trueTop,
    recovered,
    conditionalRecall,
    trueShownCount: trueShown.length,
    complete: sorter.isComplete(),
    // Explicit accuracy API
    topKSetAccuracy,
    topKOrderAccuracy,
    top1Accuracy: prefixSetAccuracy(1),
    top3Accuracy: prefixSetAccuracy(Math.min(3, topK)),
    top5Accuracy: prefixSetAccuracy(Math.min(5, topK)),
    top10Accuracy: prefixSetAccuracy(Math.min(10, topK)),
    rankAgreement,
    exactPositionHits,
  };
}

/**
 * Average a metric over multiple seeded trials.
 * @param {object} params
 * @param {() => { sorter: object, user: object }} params.setup
 * @param {number} [params.trials=10]
 */
export function averageTrials({ setup, trials = 10 }) {
  const results = [];
  for (let t = 0; t < trials; t++) {
    const { sorter, user } = setup(t);
    results.push(runSimulatedSession(sorter, user));
  }
  const avg = (key) =>
    results.reduce((sum, r) => sum + (r[key] ?? 0), 0) / results.length;

  return {
    results,
    avgRounds: avg("roundsPlayed"),
    avgOverlap: avg("overlapIds"),
    avgConditionalRecall: avg("conditionalRecall"),
    /** Mean top-K set accuracy (true top-K recall), 0–1 */
    avgTopKSetAccuracy: avg("topKSetAccuracy"),
    /** Alias focused on top-10 leaderboards */
    avgTop10Accuracy: avg("top10Accuracy"),
    avgTop1Accuracy: avg("top1Accuracy"),
    avgTop3Accuracy: avg("top3Accuracy"),
    avgTop5Accuracy: avg("top5Accuracy"),
    avgTopKOrderAccuracy: avg("topKOrderAccuracy"),
    avgRankAgreement: avg("rankAgreement"),
    earlyRate:
      results.filter((r) => r.stoppedEarly).length / Math.max(1, results.length),
  };
}
