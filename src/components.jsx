import { useEffect, useState, useMemo } from "preact/hooks";
import {
  albumCheckState,
  groupSongsByAlbum,
  setAlbumSelection,
} from "./catalogSelection.js";
import { calculateSessionBudget } from "./roundCalculator.js";

// Song option component with embed functionality
export function SongOption({ song, index, provider, onSelect, onPlayEmbed }) {
  const embedId = `${song[provider === "spotify" ? "spotifyId" : "deezerId"]}`;

  return (
    <div
      className={`song-option fade-in-${index + 1}`}
      data-song-id={song.id}
    >
      <div className="embed-and-button">
        <EmbedContainer
          song={song}
          embedId={embedId}
          provider={provider}
          onPlayEmbed={onPlayEmbed}
        />
        <button
          className="select-button"
          onClick={() => onSelect(song.id)}
          aria-label={`Choose ${song.title}`}
        ></button>
      </div>
      <div className="song-content">
        <div className="desktop-song-info">
          <h3>{song.title}</h3>
          <p>{song.album}</p>
        </div>
      </div>
    </div>
  );
}

function EmbedContainer({ song, embedId, provider, onPlayEmbed }) {
  const placeholderStyle = song.albumCover
    ? {
        backgroundImage: `linear-gradient(rgba(0,0,0,0.4), rgba(0,0,0,0.6)), url('${song.albumCover}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }
    : {};

  return (
    <div
      className="embed-container"
      data-embed-id={embedId}
      data-provider={provider}
    >
      <div className="play-placeholder" style={placeholderStyle}>
        <div className="song-info">
          <h3>{song.title}</h3>
          <p>{song.album}</p>
        </div>
        <button
          className="play-button"
          onClick={(e) => onPlayEmbed(embedId, e.target)}
        >
          Play Preview
        </button>
      </div>
    </div>
  );
}

/** Start screen: albums (expandable songs), all checked by default. */
export function CatalogSetup({
  songs,
  selectedIds,
  onChange,
  onStart,
  setupError,
}) {
  const albums = useMemo(() => groupSongsByAlbum(songs), [songs]);
  const [expanded, setExpanded] = useState(() => new Set());

  const selectedCount = selectedIds.size;
  const budget = useMemo(
    () => calculateSessionBudget(selectedCount),
    [selectedCount],
  );

  function toggleExpand(album) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(album)) next.delete(album);
      else next.add(album);
      return next;
    });
  }

  function toggleAlbum(albumSongs, checked) {
    onChange(setAlbumSelection(selectedIds, albumSongs, checked));
  }

  function toggleSong(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function selectAll() {
    onChange(new Set(songs.map((s) => s.id)));
  }

  function selectNone() {
    onChange(new Set());
  }

  const canStart = selectedCount >= 2;

  return (
    <div className="catalog-setup">
      <div className="catalog-setup-header">
        <h2>Choose what to rank</h2>
        <p className="catalog-setup-sub">
          Uncheck albums or songs you don’t know. Everything is included by
          default.
        </p>
        <div className="catalog-setup-actions">
          <button type="button" className="linkish" onClick={selectAll}>
            Select all
          </button>
          <button type="button" className="linkish" onClick={selectNone}>
            Clear all
          </button>
        </div>
      </div>

      <div className="catalog-album-list">
        {albums.map((group) => {
          const state = albumCheckState(selectedIds, group.songs);
          const isOpen = expanded.has(group.album);
          const checkedCount = group.songs.filter((s) =>
            selectedIds.has(s.id),
          ).length;

          return (
            <div
              key={group.album}
              className={`catalog-album ${state === "none" ? "is-off" : ""}`}
            >
              <div className="catalog-album-row">
                <label className="catalog-check">
                  <input
                    type="checkbox"
                    checked={state === "all"}
                    ref={(el) => {
                      if (el) el.indeterminate = state === "some";
                    }}
                    onChange={(e) =>
                      toggleAlbum(group.songs, e.currentTarget.checked)
                    }
                  />
                  <span className="catalog-album-title">
                    {group.cover && (
                      <img
                        src={group.cover}
                        alt=""
                        className="catalog-album-cover"
                        loading="lazy"
                      />
                    )}
                    <span>
                      <strong>{group.album}</strong>
                      <span className="catalog-album-meta">
                        {checkedCount}/{group.songs.length}
                        {group.releaseDate
                          ? ` · ${group.releaseDate.slice(0, 4)}`
                          : ""}
                      </span>
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="catalog-expand"
                  aria-expanded={isOpen}
                  onClick={() => toggleExpand(group.album)}
                >
                  {isOpen ? "Hide songs" : "Songs"}
                </button>
              </div>
              {isOpen && (
                <ul className="catalog-song-list">
                  {group.songs.map((song) => (
                    <li key={song.id}>
                      <label className="catalog-check catalog-check--song">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(song.id)}
                          onChange={() => toggleSong(song.id)}
                        />
                        <span>{song.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="catalog-setup-footer">
        <p className="catalog-estimate">
          <strong>{selectedCount}</strong> songs
          {canStart ? (
            <>
              {" "}
              · up to ~<strong>{budget.maxRounds}</strong> rounds
              {budget.skipToMerge
                ? " (direct ranking)"
                : ` (discover ~${budget.phase1Rounds} + final sort ~${budget.phase2Estimate})`}
            </>
          ) : (
            <> · pick at least 2</>
          )}
        </p>
        {setupError && <p className="catalog-setup-error">{setupError}</p>}
        <button
          type="button"
          className="catalog-start-btn"
          disabled={!canStart}
          onClick={onStart}
        >
          Start ranking
        </button>
      </div>
    </div>
  );
}

// Game round: 2 or 3 options depending on phase
export function GameRound({ round, provider, onSelect, onPlayEmbed }) {
  useEffect(() => {
    const selectButtons = document.querySelectorAll(".select-button");
    selectButtons.forEach((button) => {
      button.disabled = false;
      button.style.pointerEvents = "auto";
    });

    const timer = setTimeout(() => {
      const songOptions = document.querySelectorAll(".song-option");
      songOptions.forEach((option) => {
        option.classList.remove(
          "fade-in-1",
          "fade-in-2",
          "fade-in-3",
          "fade-out-1",
          "fade-out-2",
          "fade-out-3",
        );
      });
    }, 600);

    return () => clearTimeout(timer);
  }, [round]);

  if (!round || !round.options || round.options.length === 0) {
    return (
      <div className="loading">
        <div className="spinner"></div>
        <p>Loading songs...</p>
      </div>
    );
  }

  const choiceCount = round.options.length;
  const layoutClass =
    choiceCount >= 3 ? "song-options--trio" : "song-options--duo";

  return (
    <>
      <div className="round-info">
        <h2>
          Round {round.roundDisplay}
          <span className="round-cap"> / up to {round.totalRounds}</span>
        </h2>
        {round.phaseMessage && (
          <p
            className={`phase-message ${
              round.phase === 2 ? "phase-merge" : "phase-discover"
            }`}
          >
            {round.phaseMessage}
          </p>
        )}
        <div className="progress-bar">
          <div
            className={`progress ${round.phase === 2 ? "phase-merge" : "phase-discover"}`}
            style={{ width: `${round.progress}%` }}
          ></div>
        </div>
      </div>

      <div className={`song-options ${layoutClass}`}>
        {round.options.map((song, index) => (
          <SongOption
            key={`${round.round}-${song.id}`}
            song={song}
            index={index}
            provider={provider}
            onSelect={onSelect}
            onPlayEmbed={onPlayEmbed}
          />
        ))}
      </div>
    </>
  );
}

export function GameResults({ rankings, stats, onRestart, onShare }) {
  const topK = stats?.topK ?? 10;
  const topList = rankings.slice(0, topK);
  const roundsNote =
    stats?.roundsPlayed != null
      ? `Based on ${stats.roundsPlayed} comparisons${
          stats.skipToMerge ? " (direct ranking)" : " (discover + final sort)"
        }`
      : null;

  return (
    <div className="results">
      <h2>Your Top {topK}</h2>
      {roundsNote && <p className="results-meta">{roundsNote}</p>}
      <ol className="rankings" id="rankings-container">
        {topList.map((song, index) => (
          <li key={song.id} className="ranking-item">
            <span className="rank" aria-hidden="true">
              #{index + 1}
            </span>
            <div className="ranking-text">
              <span className="title">{song.title}</span>
              {song.album ? (
                <span className="album">{song.album}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="results-buttons">
        <button className="share-button" onClick={onShare}>
          📱 Share My Top {topK}
        </button>
        <button type="button" onClick={onRestart}>
          🔄 Start Over
        </button>
      </div>
    </div>
  );
}

export function NoSongsError({ provider, onRetry }) {
  return (
    <div className="error-message">
      <h2>❌ No Songs Available</h2>
      <p>No {provider} songs found in the database.</p>
      <p>
        Run: <code>npm run fetch-{provider}-triples</code> to fetch song data.
      </p>
      <button onClick={onRetry}>🔄 Retry</button>
    </div>
  );
}

export function DataError({ message, onRetry }) {
  return (
    <div className="error-message">
      <h2>❌ Error Loading Data</h2>
      <p>{message}</p>
      <button onClick={onRetry}>🔄 Retry</button>
    </div>
  );
}
