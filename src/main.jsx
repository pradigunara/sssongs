import { render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import {
  SongSorter,
  loadProviderData,
  getProviderEmbedUrl,
  getProviderIdField,
} from "./songSorter.js";
import { GameRound, GameResults, NoSongsError, DataError } from './components.jsx';
import { embedPool, loadAndPlayEmbed } from './embedPool.js';

// Configuration - choose ONE provider
const MUSIC_PROVIDER = "deezer"; // 'spotify' or 'deezer'

const gameContainer = document.getElementById("game-container");
let tripleSSongs = [];

// Main App Component
function App() {
  const [gameState, setGameState] = useState('loading'); // 'loading', 'playing', 'finished', 'error'
  const [sorter, setSorter] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');

  // Initialize the app
  useEffect(() => {
    initializeGame();
  }, []);

  async function initializeGame() {
    try {
      tripleSSongs = loadProviderData(MUSIC_PROVIDER);
      const newSorter = new SongSorter(tripleSSongs, MUSIC_PROVIDER);

      if (newSorter.songs.length === 0) {
        setGameState('error');
        setErrorMessage(`No ${MUSIC_PROVIDER} songs found`);
        return;
      }

      setSorter(newSorter);
      const round = newSorter.getCurrentRound();
      if (round) {
        setCurrentRound(round);
        setGameState('playing');
      } else {
        // Game is already finished
        setRankings(newSorter.getRankings());
        setGameState('finished');
      }
    } catch (error) {
      setGameState('error');
      setErrorMessage(error.message);
    }
  }

  function handleSongSelect(songId) {
    if (!sorter) return;

    // Disable all selection buttons immediately (visual feedback)
    const selectButtons = document.querySelectorAll(".select-button");
    selectButtons.forEach((button) => {
      button.disabled = true;
      button.style.pointerEvents = "none";
    });

    // Trigger staggered fade out animation
    const songOptions = document.querySelectorAll(".song-option");
    songOptions.forEach((option, index) => {
      option.classList.add(`fade-out-${index + 1}`);
    });

    // Yield to browser so it can paint the disabled state + fade-out start,
    // then update state on the next frame
    requestAnimationFrame(() => {
      sorter.selectWinner(songId);

      const nextRound = sorter.getCurrentRound();
      if (!nextRound) {
        setRankings(sorter.getRankings());
        setGameState('finished');
      } else {
        setCurrentRound(nextRound);
      }
    });
  }

  function handlePlayEmbed(embedId, button) {
    // Store current options globally for embed pool access
    window.currentRoundOptions = currentRound?.options;
    loadAndPlayEmbed(embedId, button);
  }

  function handleRestart() {
    embedPool.cleanup();
    initializeGame();
  }

  async function handleShare() {
    const shareButton = document.querySelector(".share-button");
    if (shareButton) {
      shareButton.disabled = true;
      shareButton.textContent = "📸 Generating...";
    }

    try {
      // Create a container for the share image with mobile proportions
      const shareContainer = document.createElement("div");
      shareContainer.className = "share-container";
      shareContainer.style.position = "absolute";
      shareContainer.style.left = "-9999px";
      shareContainer.style.fontFamily = "system-ui, -apple-system, sans-serif";

      shareContainer.innerHTML = `
        <div class="share-content" style="width: 500px; padding: 40px; background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%); color: white; border-radius: 20px; position: relative;">
          <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: radial-gradient(circle at 20% 80%, rgba(120, 119, 198, 0.3) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255, 119, 198, 0.2) 0%, transparent 50%), radial-gradient(circle at 40% 40%, rgba(120, 219, 255, 0.1) 0%, transparent 50%); border-radius: 20px; pointer-events: none;"></div>
          <div style="position: relative; z-index: 2;">
            <h2 style="text-align: center; margin-bottom: 30px; font-size: 24px; background: linear-gradient(135deg, #ff6b9d, #c471ed, #12c2e9); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800;">🎵 My tripleS Song Rankings</h2>
            <div class="rankings-list">
              ${rankings
                .slice(0, 10)
                .map(
                  (song, index) => `
                <div style="display: flex; align-items: center; margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; backdrop-filter: blur(10px);">
                  <span style="font-weight: bold; margin-right: 15px; background: linear-gradient(135deg, #ff6b9d, #c471ed); background-clip: text; -webkit-background-clip: text; -webkit-text-fill-color: transparent; min-width: 30px; font-size: 16px;">#${
                    index + 1
                  }</span>
                  <span style="flex: 1; font-size: 14px; color: #ffffff;">${song.title}</span>
                </div>
              `,
                )
                .join("")}
            </div>
            <div style="text-align: center; margin-top: 20px; font-size: 12px; opacity: 0.7; color: #ffffff;">
              Created with SSS Song Sorter • ${new Date().toLocaleDateString()}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(shareContainer);

      const canvas = await html2canvas(shareContainer.querySelector(".share-content"), {
        backgroundColor: null,
        scale: 2,
      });

      canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `my-triples-song-rankings-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });

      document.body.removeChild(shareContainer);
    } catch (error) {
      alert("Failed to generate image. Please try again.");
    } finally {
      if (shareButton) {
        shareButton.disabled = false;
        shareButton.textContent = "📱 Share My Ranking";
      }
    }
  }

  function handleRetry() {
    setGameState('loading');
    setErrorMessage('');
    initializeGame();
  }

  // Render based on game state
  if (gameState === 'loading') {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading songs...</p>
      </div>
    );
  }

  if (gameState === 'error') {
    if (errorMessage.includes('No ')) {
      return <NoSongsError provider={MUSIC_PROVIDER} onRetry={handleRetry} />;
    }
    return <DataError message={errorMessage} onRetry={handleRetry} />;
  }

  if (gameState === 'finished') {
    return (
      <GameResults 
        rankings={rankings}
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

// Initialize the Preact app
function initializeApp() {
  render(<App />, gameContainer);
}

// Utility functions for legacy compatibility
window.currentRoundOptions = null;

// Initialize the app when the page loads
initializeApp();