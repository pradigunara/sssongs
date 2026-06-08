// Static imports for bundling
import spotifyData from './data/triples-songs.json';
import deezerData from './data/triples-deezer-songs.json';
import { calculateHybridSystem, getCurrentPhase, getPhaseMessage } from './roundCalculator.js';

// Provider configuration with static data references
const PROVIDER_CONFIG = {
  'spotify': {
    data: spotifyData,
    embedUrl: (id) => `https://open.spotify.com/embed/track/${id}`,
    idField: 'spotifyId'
  },
  'deezer': {
    data: deezerData,
    embedUrl: (id) => `https://widget.deezer.com/widget/dark/track/${id}`,
    idField: 'deezerId'
  }
};

// Load data for specific provider (now synchronous)
function loadProviderData(provider) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }

  const data = config.data;
  return data?.songs || data.songs || [];
}

// Get embed URL for provider
function getProviderEmbedUrl(provider, songId) {
  const config = PROVIDER_CONFIG[provider];
  return config ? config.embedUrl(songId) : null;
}

// Get provider ID field name
function getProviderIdField(provider) {
  const config = PROVIDER_CONFIG[provider];
  return config ? config.idField : null;
}

export class SongSorter {
  constructor(songs, musicProvider = 'deezer') {
    this.musicProvider = musicProvider;
    const idField = getProviderIdField(musicProvider);

    if (!idField) {
      throw new Error(`Unknown provider: ${musicProvider}`);
    }

    // Filter songs based on provider availability
    const availableSongs = songs.filter(song => {
      const providerId = song[idField];
      return providerId !== null && providerId !== undefined && providerId !== '';
    });


    // Calculate optimal round system based on song count
    this.systemConfig = calculateHybridSystem(availableSongs.length);
    this.totalRounds = this.systemConfig.totalRounds;

    // Initialize songs with score tracking and head-to-head data
    this.songs = availableSongs.map((song) => ({
      ...song,
      score: 0, // Phase 1-2 accumulation score
      appearances: 0,
      eliminated: false,
      // Phase 3 head-to-head tracking (reset when entering Phase 3)
      h2hScore: 0, // Pure head-to-head wins in Phase 3
      h2hWins: 0,
      h2hLosses: 0,
      h2hMatches: 0
    }));

    this.currentRound = 0;
    this.history = [];
  }

  getCurrentPhaseInfo() {
    return getCurrentPhase(this.currentRound + 1, this.systemConfig);
  }

  selectThreeSongs() {
    const phaseInfo = this.getCurrentPhaseInfo();
    let availableSongs = this.songs.filter(song => !song.eliminated);

    // Phase-specific logic
    let selectedSongs;
    if (phaseInfo.phase === 1) {
      // Phase 1: Discovery - prioritize unshown songs
      selectedSongs = this.selectForDiscoveryPhase(availableSongs);
    } else if (phaseInfo.phase === 2) {
      // Phase 2: Elimination round - all current survivors
      selectedSongs = this.selectForEliminationPhase(availableSongs);
    } else {
      // Phase 3: Head-to-head matrix - strategic pairing
      selectedSongs = this.selectForHeadToHeadPhase(availableSongs);
    }

    // Ensure we have exactly 3 songs
    if (selectedSongs.length < 3) {
      const remaining = availableSongs.filter(song => !selectedSongs.find(s => s.id === song.id));
      while (selectedSongs.length < 3 && remaining.length > 0) {
        selectedSongs.push(remaining.shift());
      }
    }

    // Anti-repetition: Shuffle positions if same songs appear in same slots as previous round
    if (this.history.length > 0) {
      const lastRound = this.history[this.history.length - 1];
      const lastOptions = lastRound.options;

      // Check if any song appears in the same position as last round
      let needsShuffle = false;
      for (let i = 0; i < Math.min(3, selectedSongs.length, lastOptions.length); i++) {
        if (selectedSongs[i] && selectedSongs[i].id === lastOptions[i]) {
          needsShuffle = true;
          break;
        }
      }

      // Shuffle if same-position repetition detected
      if (needsShuffle) {
        selectedSongs = this.shuffleArray([...selectedSongs]);
      }
    }

    return selectedSongs.slice(0, 3);
  }

  // Fisher-Yates shuffle algorithm
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  selectForDiscoveryPhase(availableSongs) {
    // Phase 1 goal: Ensure each song appears at least 2 times with uniform distribution
    const minAppearances = this.systemConfig.phase1.minAppearances || 2;

    // Get songs that haven't met minimum appearances yet
    const underMinSongs = availableSongs.filter(song => song.appearances < minAppearances);

    // If we have songs under minimum, STRONGLY prioritize them
    if (underMinSongs.length >= 3) {
      // All 3 songs from under-minimum pool
      const weights = underMinSongs.map(song => {
        // Heavy weight for unshown songs, moderate for 1-appearance songs
        return song.appearances === 0 ? 100 : 50;
      });
      return this.weightedSelection(underMinSongs, weights, 3);

    } else if (underMinSongs.length > 0) {
      // Mix under-minimum songs with others, but prioritize the under-minimum ones
      const others = availableSongs.filter(song => song.appearances >= minAppearances);

      // Select all under-minimum songs first
      const selected = [...underMinSongs];

      // Fill remaining slots with songs that have minimum appearances
      // but prioritize those with fewer appearances
      const remaining = 3 - selected.length;
      if (remaining > 0 && others.length > 0) {
        const weights = others.map(song => 1 / (song.appearances + 1));
        const additionalSongs = this.weightedSelection(others, weights, remaining);
        selected.push(...additionalSongs);
      }

      return selected;

    } else {
      // All songs have minimum appearances - now focus on keeping distribution uniform
      // Heavily weight songs with fewer appearances to maintain balance
      const minAppearanceCount = Math.min(...availableSongs.map(s => s.appearances));
      const maxAppearanceCount = Math.max(...availableSongs.map(s => s.appearances));

      // If distribution is getting uneven, strongly favor under-represented songs
      const weights = availableSongs.map(song => {
        const appearanceDiff = maxAppearanceCount - song.appearances;
        // Exponential weighting: songs with fewer appearances get much higher weight
        return Math.pow(2, appearanceDiff + 1);
      });

      return this.weightedSelection(availableSongs, weights, 3);
    }
  }

  selectForEliminationPhase(availableSongs) {
    // Phase 2 goal: Fair elimination - each surviving song should get adequate representation
    // Calculate target appearances for this phase
    const phaseInfo = this.getCurrentPhaseInfo();
    const roundsInPhase = phaseInfo.maxPhaseRounds;
    const targetAppearancesInPhase = Math.floor((roundsInPhase * 3) / availableSongs.length);
    const minAppearancesInPhase = Math.max(1, targetAppearancesInPhase - 1);

    // Track appearances specifically since start of Phase 2
    const phase2StartRound = this.systemConfig.phase1.rounds + 1;
    const currentPhaseRound = phaseInfo.phaseRound;

    // Calculate appearances in current phase by checking recent history
    const appearancesInPhase = availableSongs.map(song => {
      let phaseAppearances = 0;
      const recentHistory = this.history.slice(-(currentPhaseRound - 1));
      recentHistory.forEach(round => {
        if (round.options.includes(song.id)) {
          phaseAppearances++;
        }
      });
      return { song, phaseAppearances };
    });

    // Find songs under-represented in this phase
    const underRepresented = appearancesInPhase.filter(
      item => item.phaseAppearances < minAppearancesInPhase
    );

    if (underRepresented.length >= 3) {
      // Prioritize under-represented songs heavily
      const songs = underRepresented.map(item => item.song);
      const weights = underRepresented.map(item => {
        return Math.pow(3, minAppearancesInPhase - item.phaseAppearances + 1);
      });
      return this.weightedSelection(songs, weights, 3);

    } else if (underRepresented.length > 0) {
      // Mix under-represented with others
      const underRepSongs = underRepresented.map(item => item.song);
      const others = appearancesInPhase
        .filter(item => item.phaseAppearances >= minAppearancesInPhase)
        .map(item => item.song);

      const selected = [...underRepSongs];
      const remaining = 3 - selected.length;

      if (remaining > 0 && others.length > 0) {
        // Weight others by overall appearances (less important than phase balance)
        const weights = others.map(song => 1 / (song.appearances + 1));
        const additionalSongs = this.weightedSelection(others, weights, remaining);
        selected.push(...additionalSongs);
      }

      return selected;

    } else {
      // All songs adequately represented in phase - use appearance-based weighting
      const minPhaseAppearances = Math.min(...appearancesInPhase.map(item => item.phaseAppearances));
      const maxPhaseAppearances = Math.max(...appearancesInPhase.map(item => item.phaseAppearances));

      const weights = availableSongs.map(song => {
        const songPhaseApp = appearancesInPhase.find(item => item.song.id === song.id)?.phaseAppearances || 0;
        const phaseDiff = maxPhaseAppearances - songPhaseApp;
        // Moderate exponential weighting for phase balance
        return Math.pow(2, phaseDiff + 1);
      });

      return this.weightedSelection(availableSongs, weights, 3);
    }
  }

  selectForHeadToHeadPhase(availableSongs) {
    if (availableSongs.length <= 3) {
      // If we have very few songs left, just return them all
      return availableSongs.slice(0, 3);
    }

    // Phase 3 goal: Balance strategic head-to-head matchups with fair representation
    const phaseInfo = this.getCurrentPhaseInfo();
    const roundsInPhase = phaseInfo.maxPhaseRounds;
    const targetAppearancesInPhase = Math.floor((roundsInPhase * 3) / availableSongs.length);
    const minAppearancesInPhase = Math.max(2, targetAppearancesInPhase - 1); // Higher minimum for final phase

    // Calculate appearances in Phase 3 specifically
    const phase3StartRound = this.systemConfig.phase1.rounds + this.systemConfig.phase2.rounds + 1;
    const currentPhaseRound = phaseInfo.phaseRound;

    const appearancesInPhase = availableSongs.map(song => {
      let phaseAppearances = 0;
      const recentHistory = this.history.slice(-(currentPhaseRound - 1));
      recentHistory.forEach(round => {
        if (round.options.includes(song.id)) {
          phaseAppearances++;
        }
      });
      return { song, phaseAppearances };
    });

    // Find under-represented songs in this phase
    const underRepresented = appearancesInPhase.filter(
      item => item.phaseAppearances < minAppearancesInPhase
    );

    if (underRepresented.length >= 3) {
      // Strong priority for under-represented songs in final phase
      const songs = underRepresented.map(item => item.song);
      const weights = underRepresented.map(item => {
        // Very high weight for songs that need more appearances
        return Math.pow(4, minAppearancesInPhase - item.phaseAppearances + 1);
      });
      return this.weightedSelection(songs, weights, 3);

    } else if (underRepresented.length > 0) {
      // Mix under-represented with strategic selection
      const underRepSongs = underRepresented.map(item => item.song);
      const adequatelyRepresented = appearancesInPhase
        .filter(item => item.phaseAppearances >= minAppearancesInPhase)
        .map(item => item.song);

      const selected = [...underRepSongs];
      const remaining = 3 - selected.length;

      if (remaining > 0 && adequatelyRepresented.length > 0) {
        // For remaining slots, use strategic head-to-head logic
        const sortedByScore = adequatelyRepresented.sort((a, b) => b.score - a.score);

        // Mix top performers with variety
        const weights = sortedByScore.map((song, index) => {
          const rankWeight = Math.max(1, sortedByScore.length - index); // Higher rank = higher weight
          const appearanceWeight = 1 / (song.appearances + 1); // Favor less frequent overall
          return rankWeight * appearanceWeight;
        });

        const strategicSongs = this.weightedSelection(sortedByScore, weights, remaining);
        selected.push(...strategicSongs);
      }

      return selected;

    } else {
      // All songs adequately represented - focus on strategic matchups with variety
      const sortedSongs = [...availableSongs].sort((a, b) => b.score - a.score);

      // Divide into tiers for strategic yet varied selection
      const topTier = sortedSongs.slice(0, Math.ceil(sortedSongs.length / 3));
      const midTier = sortedSongs.slice(Math.ceil(sortedSongs.length / 3), Math.ceil(sortedSongs.length * 2 / 3));
      const bottomTier = sortedSongs.slice(Math.ceil(sortedSongs.length * 2 / 3));

      const selected = [];

      // Pick from top tier (but consider phase appearances for variety)
      if (topTier.length > 0) {
        const weights = topTier.map(song => {
          const songPhaseApp = appearancesInPhase.find(item => item.song.id === song.id)?.phaseAppearances || 0;
          const maxPhaseApp = Math.max(...appearancesInPhase.map(item => item.phaseAppearances));
          const phaseDiff = maxPhaseApp - songPhaseApp;
          return Math.pow(2, phaseDiff + 1); // Favor less frequent in this phase
        });
        const topPick = this.weightedSelection(topTier, weights, 1)[0];
        if (topPick) selected.push(topPick);
      }

      // Pick from mid tier for competitive matches
      if (midTier.length > 0 && selected.length < 3) {
        const remaining = midTier.filter(song => !selected.find(s => s.id === song.id));
        if (remaining.length > 0) {
          const weights = remaining.map(song => {
            const songPhaseApp = appearancesInPhase.find(item => item.song.id === song.id)?.phaseAppearances || 0;
            const maxPhaseApp = Math.max(...appearancesInPhase.map(item => item.phaseAppearances));
            const phaseDiff = maxPhaseApp - songPhaseApp;
            return Math.pow(1.5, phaseDiff + 1);
          });
          const midPick = this.weightedSelection(remaining, weights, 1)[0];
          if (midPick) selected.push(midPick);
        }
      }

      // Fill remaining slot with variety consideration
      if (selected.length < 3) {
        const remaining = sortedSongs.filter(song => !selected.find(s => s.id === song.id));
        if (remaining.length > 0) {
          const weights = remaining.map(song => {
            const songPhaseApp = appearancesInPhase.find(item => item.song.id === song.id)?.phaseAppearances || 0;
            return 1 / (songPhaseApp + 1); // Strong preference for less frequent in phase
          });
          const finalPick = this.weightedSelection(remaining, weights, 1)[0];
          if (finalPick) selected.push(finalPick);
        }
      }

      // Fill any remaining slots if needed
      while (selected.length < 3 && selected.length < availableSongs.length) {
        const remaining = availableSongs.filter(song => !selected.find(s => s.id === song.id));
        if (remaining.length > 0) {
          selected.push(remaining[0]);
        } else {
          break;
        }
      }

      return selected;
    }
  }

  weightedSelection(availableSongs, weights, count) {
    const selected = [];
    const selectablePool = [...availableSongs];

    for (let i = 0; i < count; i++) {
      const availableWeights = selectablePool.map((song) => {
        const originalIndex = availableSongs.indexOf(song);
        return weights[originalIndex];
      });
      const availableTotalWeight = availableWeights.reduce((sum, w) => sum + w, 0);

      if (availableTotalWeight === 0) break;

      let random = Math.random() * availableTotalWeight;
      let selectedIndex = 0;

      for (let j = 0; j < availableWeights.length; j++) {
        random -= availableWeights[j];
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }

      selected.push(selectablePool[selectedIndex]);
      selectablePool.splice(selectedIndex, 1);

      if (selectablePool.length === 0) break;
    }

    return selected;
  }

  eliminateSongs() {
    const phaseInfo = this.getCurrentPhaseInfo();
  
    if (phaseInfo.phase === 1 && phaseInfo.phaseRound === phaseInfo.maxPhaseRounds) {
      // End of Phase 1: eliminate songs with very low scores (more lenient threshold)
      // In 35 rounds, a song should have at least a few chances to win
      const threshold = 0; // Only eliminate songs that never won (score = 0)
      this.songs.forEach(song => {
        if (song.score <= threshold) {
          song.eliminated = true;
        }
      });
  
    } else if (phaseInfo.phase === 2 && phaseInfo.phaseRound === phaseInfo.maxPhaseRounds) {
      // End of Phase 2: eliminate to get final head-to-head count
      const survivors = this.songs.filter(song => !song.eliminated);
      const sortedSurvivors = survivors.sort((a, b) => b.score - a.score);
      const keepCount = this.systemConfig.phase2.survivors;
  
      sortedSurvivors.forEach((song, index) => {
        if (index >= keepCount) {
          song.eliminated = true;
        }
      });
  
      // RESET HEAD-TO-HEAD SCORES for pure Phase 3 ranking
      this.songs.forEach(song => {
        if (!song.eliminated) {
          song.h2hScore = 0;
          song.h2hWins = 0;
          song.h2hLosses = 0;
          song.h2hMatches = 0;
        }
      });
    }
  }

  getCurrentRound() {
    if (this.currentRound >= this.totalRounds) {
      return null;
    }

    const options = this.selectThreeSongs();
    const phaseInfo = this.getCurrentPhaseInfo();

    // Store the current round options for selectWinner to use
    this.currentRoundOptions = options;

    // Update appearances here (only once per round)
    options.forEach((song) => song.appearances++);

    // Determine round display and phase-specific progress
    let roundDisplay, progress;

    if (phaseInfo.phase === 3) {
      roundDisplay = `Head-to-Head ${phaseInfo.phaseRound}`;
      progress = (phaseInfo.phaseRound / phaseInfo.maxPhaseRounds) * 100;
    } else {
      roundDisplay = this.currentRound + 1;
      // Use phase-specific progress instead of total progress
      progress = (phaseInfo.phaseRound / phaseInfo.maxPhaseRounds) * 100;
    }

    return {
      round: this.currentRound + 1,
      roundDisplay: roundDisplay,
      totalRounds: this.totalRounds,
      options: options,
      progress: progress,
      phaseMessage: getPhaseMessage(phaseInfo),
      phaseInfo: phaseInfo,
      isFinalShowdown: phaseInfo.phase === 3,
    };
  }

  selectWinner(winnerId) {
    if (this.currentRound >= this.totalRounds) return;
  
    // Use the stored options from getCurrentRound instead of calling selectThreeSongs again
    const options = this.currentRoundOptions;
    if (!options) {
      console.error("No current round options available");
      return;
    }
  
    const winner = options.find((song) => song.id === winnerId);
  
    if (!winner) {
      console.error(`Winner not found: ${winnerId}`);
      return;
    }
  
    const phaseInfo = this.getCurrentPhaseInfo();
  
    if (phaseInfo.phase === 3) {
      // Phase 3: Track pure head-to-head wins/losses
      const losers = options.filter(song => song.id !== winnerId);
  
      // Winner gets +1 h2h win vs each loser
      winner.h2hWins += losers.length;
      winner.h2hScore += 1; // Simple +1 for winning the round
  
      // Each loser gets +1 h2h loss vs winner
      losers.forEach(loser => {
        loser.h2hLosses += 1;
      });
  
      // All participants get match count incremented
      options.forEach(song => {
        song.h2hMatches += 1;
      });
  
    } else {
      // Phase 1-2: Score accumulation as before
      winner.score += 1;
    }
  
    this.history.push({
      round: this.currentRound + 1,
      options: options.map((s) => s.id),
      winner: winnerId,
      timestamp: Date.now(),
    });
  
    this.currentRound++;
  
    // Check for elimination after specific phases
    this.eliminateSongs();
  }

  getRankings() {
    // For head-to-head phase, use head-to-head records for active songs only
    const phaseInfo = this.getCurrentPhaseInfo();

    if (phaseInfo.phase === 3) {
      return this.getHeadToHeadRankings();
    }

    // For other phases, show all non-eliminated songs ranked by score
    // But if we're at the end, show ALL songs (including eliminated ones at the bottom)
    const activeSongs = this.songs.filter(song => !song.eliminated);
    const eliminatedSongs = this.songs.filter(song => song.eliminated);

    // Sort active songs by score
    const activeRankings = activeSongs
      .sort((a, b) => b.score - a.score)
      .map((song, index) => ({
        rank: index + 1,
        ...song,
      }));

    // If we have completed rounds, also include eliminated songs at the bottom
    if (this.isComplete() || this.currentRound > 50) {
      const eliminatedRankings = eliminatedSongs
        .sort((a, b) => b.score - a.score)
        .map((song, index) => ({
          rank: activeRankings.length + index + 1,
          ...song,
        }));

      return [...activeRankings, ...eliminatedRankings];
    }

    return activeRankings;
  }

  getHeadToHeadRankings() {
    const activeSongs = this.songs.filter(song => !song.eliminated);
  
    // Use the tracked head-to-head data from Phase 3
    return activeSongs
      .map(song => ({
        ...song,
        // Calculate win percentage from tracked h2h data
        winPercentage: song.h2hWins + song.h2hLosses > 0
          ? song.h2hWins / (song.h2hWins + song.h2hLosses)
          : 0,
        // Expose h2h stats for potential UI display
        h2hTotalMatches: song.h2hMatches
      }))
      .sort((a, b) => {
        // Primary: win percentage in head-to-head (pure Phase 3 performance)
        if (Math.abs(a.winPercentage - b.winPercentage) > 0.01) {
          return b.winPercentage - a.winPercentage;
        }
        // Secondary: number of matches played (more data = more reliable)
        if (a.h2hMatches !== b.h2hMatches) {
          return b.h2hMatches - a.h2hMatches;
        }
        // Tertiary: Phase 1-2 performance (only for very close cases)
        return b.score - a.score;
      })
      .map((song, index) => ({
        rank: index + 1,
        ...song,
      }));
  }

  isComplete() {
    return this.currentRound >= this.totalRounds;
  }

  getStats() {
    const activeSongs = this.songs.filter(song => !song.eliminated);
    const avgAppearances = activeSongs.reduce((sum, song) => sum + song.appearances, 0) / activeSongs.length;
    const minAppearances = Math.min(...activeSongs.map(s => s.appearances));
    const maxAppearances = Math.max(...activeSongs.map(s => s.appearances));

    return {
      avgAppearances: avgAppearances.toFixed(1),
      minAppearances,
      maxAppearances,
      totalComparisons: this.currentRound * 2,
      distributionFairness: maxAppearances - minAppearances,
      activeSongs: activeSongs.length,
      eliminatedSongs: this.songs.length - activeSongs.length,
      systemConfig: this.systemConfig
    };
  }
}

// Export the provider functions and a placeholder for songs (will be loaded dynamically)
export { loadProviderData, getProviderEmbedUrl, getProviderIdField, PROVIDER_CONFIG };
