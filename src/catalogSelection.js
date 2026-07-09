/**
 * Helpers for the start-screen album / song checklist.
 */

/**
 * Group songs by album for checklist UI.
 * @param {Array<{ id: number|string, album?: string, title?: string, releaseDate?: string }>} songs
 * @returns {Array<{ album: string, releaseDate: string|null, songs: Array, cover: string|null }>}
 */
export function groupSongsByAlbum(songs) {
  const map = new Map();
  for (const song of songs) {
    const album = song.album || "Unknown";
    if (!map.has(album)) {
      map.set(album, {
        album,
        releaseDate: song.releaseDate || null,
        songs: [],
        cover: song.albumCover || song.albumCoverBig || null,
      });
    }
    const g = map.get(album);
    g.songs.push(song);
    if (!g.cover && (song.albumCover || song.albumCoverBig)) {
      g.cover = song.albumCover || song.albumCoverBig;
    }
    if (!g.releaseDate && song.releaseDate) g.releaseDate = song.releaseDate;
  }

  return [...map.values()].sort((a, b) => {
    // Newest first when dates exist
    if (a.releaseDate && b.releaseDate && a.releaseDate !== b.releaseDate) {
      return b.releaseDate.localeCompare(a.releaseDate);
    }
    return a.album.localeCompare(b.album);
  });
}

/**
 * Default selection: every song id included.
 * @param {Array<{ id: number|string }>} songs
 * @returns {Set<string|number>}
 */
export function defaultSelectedIds(songs) {
  return new Set(songs.map((s) => s.id));
}

/**
 * @param {Set<string|number>} selectedIds
 * @param {Array} songs
 */
export function filterSongsBySelection(songs, selectedIds) {
  return songs.filter((s) => selectedIds.has(s.id));
}

/**
 * Toggle helpers for album-level checkboxes.
 * @param {Set<string|number>} selectedIds
 * @param {Array} albumSongs
 * @param {boolean} checked
 */
export function setAlbumSelection(selectedIds, albumSongs, checked) {
  const next = new Set(selectedIds);
  for (const s of albumSongs) {
    if (checked) next.add(s.id);
    else next.delete(s.id);
  }
  return next;
}

/**
 * @param {Set<string|number>} selectedIds
 * @param {Array} albumSongs
 * @returns {'all'|'some'|'none'}
 */
export function albumCheckState(selectedIds, albumSongs) {
  let on = 0;
  for (const s of albumSongs) {
    if (selectedIds.has(s.id)) on += 1;
  }
  if (on === 0) return "none";
  if (on === albumSongs.length) return "all";
  return "some";
}

/**
 * Rough session length preview for hybrid short budget.
 * @param {number} selectedCount
 * @param {(n: number) => { maxRounds: number, skipToMerge?: boolean, phase1Rounds?: number, phase2Estimate?: number }} budgetFn
 */
export function estimateSessionPreview(selectedCount, budgetFn) {
  const b = budgetFn(selectedCount);
  return {
    songs: selectedCount,
    maxRounds: b.maxRounds,
    skipToMerge: !!b.skipToMerge,
    phase1Rounds: b.phase1Rounds ?? 0,
    phase2Estimate: b.phase2Estimate ?? b.maxRounds,
  };
}
