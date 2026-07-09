import { render } from "preact";
import { useState, useEffect } from "preact/hooks";
import {
  SongSorter,
  loadProviderData,
} from "./songSorter.js";
import {
  CatalogSetup,
  GameRound,
  GameResults,
  NoSongsError,
  DataError,
} from "./components.jsx";
import { defaultSelectedIds, filterSongsBySelection } from "./catalogSelection.js";
import { shareTopResults } from "./shareResults.js";
import { embedPool, loadAndPlayEmbed } from "./embedPool.js";

const MUSIC_PROVIDER = "deezer"; // 'spotify' or 'deezer'

const gameContainer = document.getElementById("game-container");

function App() {
  const [gameState, setGameState] = useState("loading");
  // loading | setup | playing | finished | error
  const [allSongs, setAllSongs] = useState([]);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [sorter, setSorter] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [stats, setStats] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [setupError, setSetupError] = useState("");

  useEffect(() => {
    loadCatalog();
  }, []);

  function loadCatalog() {
    try {
      const songs = loadProviderData(MUSIC_PROVIDER);
      if (!songs || songs.length === 0) {
        setGameState("error");
        setErrorMessage(`No ${MUSIC_PROVIDER} songs found`);
        return;
      }
      setAllSongs(songs);
      setSelectedIds(defaultSelectedIds(songs));
      setSetupError("");
      setGameState("setup");
    } catch (error) {
      setGameState("error");
      setErrorMessage(error.message);
    }
  }

  function startGame() {
    try {
      setSetupError("");
      const selected = filterSongsBySelection(allSongs, selectedIds);
      if (selected.length < 2) {
        setSetupError("Select at least 2 songs to rank.");
        setGameState("setup");
        return;
      }

      const newSorter = new SongSorter(selected, MUSIC_PROVIDER);
      if (newSorter.songs.length < 2) {
        setSetupError(
          "Need at least 2 songs with playable previews for this provider.",
        );
        setGameState("setup");
        return;
      }

      setSorter(newSorter);
      const round = newSorter.getCurrentRound();
      if (round) {
        setCurrentRound(round);
        setGameState("playing");
      } else {
        setRankings(newSorter.getRankings());
        setStats(newSorter.getStats());
        setGameState("finished");
      }
    } catch (error) {
      setSetupError(error.message);
      setGameState("setup");
    }
  }

  function handleSongSelect(songId) {
    if (!sorter) return;

    const selectButtons = document.querySelectorAll(".select-button");
    selectButtons.forEach((button) => {
      button.disabled = true;
      button.style.pointerEvents = "none";
    });

    const songOptions = document.querySelectorAll(".song-option");
    const chosenId = String(songId);
    songOptions.forEach((option, index) => {
      const isChosen = String(option.dataset.songId) === chosenId;
      option.classList.remove(
        "fade-in-1",
        "fade-in-2",
        "fade-in-3",
        "fade-out-1",
        "fade-out-2",
        "fade-out-3",
      );
      if (isChosen) {
        option.classList.add("is-chosen");
      } else {
        option.classList.add("is-not-chosen");
        // Stagger dim/fade on losers only — winner holds the highlight
        option.classList.add(`fade-out-${index + 1}`);
      }
    });

    // Brief chosen highlight, then advance (keep snappy).
    const FEEDBACK_MS = 200;
    window.setTimeout(() => {
      sorter.selectWinner(songId);

      const nextRound = sorter.getCurrentRound();
      if (!nextRound) {
        setRankings(sorter.getRankings());
        setStats(sorter.getStats());
        setGameState("finished");
      } else {
        setCurrentRound(nextRound);
      }
    }, FEEDBACK_MS);
  }

  function handlePlayEmbed(embedId, button) {
    window.currentRoundOptions = currentRound?.options;
    loadAndPlayEmbed(embedId, button);
  }

  function handleRestart() {
    embedPool.cleanup();
    setSorter(null);
    setCurrentRound(null);
    setRankings([]);
    setStats(null);
    // Keep selection; return to checklist
    setGameState("setup");
  }

  async function handleShare() {
    const topK = stats?.topK ?? 10;
    const shareButton = document.querySelector(".share-button");
    const originalText = shareButton?.textContent || `📱 Share My Top ${topK}`;
    if (shareButton) {
      shareButton.disabled = true;
      shareButton.textContent = "📸 Generating...";
    }

    try {
      const mode = await shareTopResults({ rankings, topK });
      if (shareButton && mode === "downloaded") {
        shareButton.textContent = "✅ Downloaded!";
        setTimeout(() => {
          if (shareButton) shareButton.textContent = originalText;
        }, 1600);
        return;
      }
      if (shareButton && mode === "shared") {
        shareButton.textContent = "✅ Shared!";
        setTimeout(() => {
          if (shareButton) shareButton.textContent = originalText;
        }, 1600);
        return;
      }
    } catch (error) {
      // User cancelled native share sheet — not an error
      if (error?.name === "AbortError") return;
      console.error("Share failed:", error);
      alert("Could not share ranking. Please try again.");
    } finally {
      if (shareButton) {
        shareButton.disabled = false;
        // Keep success label briefly if already set above
        if (
          shareButton.textContent === "📸 Generating..." ||
          shareButton.textContent === originalText
        ) {
          shareButton.textContent = originalText;
        }
      }
    }
  }

  function handleRetry() {
    setErrorMessage("");
    loadCatalog();
  }

  if (gameState === "loading") {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading songs...</p>
      </div>
    );
  }

  if (gameState === "error") {
    if (errorMessage.includes("No ")) {
      return <NoSongsError provider={MUSIC_PROVIDER} onRetry={handleRetry} />;
    }
    return <DataError message={errorMessage} onRetry={handleRetry} />;
  }

  if (gameState === "setup") {
    return (
      <CatalogSetup
        songs={allSongs}
        selectedIds={selectedIds}
        onChange={(ids) => {
          setSelectedIds(ids);
          setSetupError("");
        }}
        onStart={startGame}
        setupError={setupError}
      />
    );
  }

  if (gameState === "finished") {
    return (
      <GameResults
        rankings={rankings}
        stats={stats}
        onRestart={handleRestart}
        onShare={handleShare}
      />
    );
  }

  return (
    <GameRound
      round={currentRound}
      provider={MUSIC_PROVIDER}
      onSelect={handleSongSelect}
      onPlayEmbed={handlePlayEmbed}
    />
  );
}

function initializeApp() {
  render(<App />, gameContainer);
}

window.currentRoundOptions = null;
initializeApp();
