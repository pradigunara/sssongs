import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumCheckState,
  defaultSelectedIds,
  filterSongsBySelection,
  groupSongsByAlbum,
  setAlbumSelection,
} from "../src/catalogSelection.js";
import { makeSyntheticSongs } from "../src/test/simulatedUser.js";

describe("catalogSelection", () => {
  it("defaults every song selected", () => {
    const songs = makeSyntheticSongs(12);
    const sel = defaultSelectedIds(songs);
    assert.equal(sel.size, 12);
  });

  it("groups by album", () => {
    const songs = makeSyntheticSongs(12);
    const groups = groupSongsByAlbum(songs);
    assert.ok(groups.length >= 2);
    const total = groups.reduce((s, g) => s + g.songs.length, 0);
    assert.equal(total, 12);
  });

  it("album toggle selects/deselects all songs in album", () => {
    const songs = makeSyntheticSongs(10);
    const groups = groupSongsByAlbum(songs);
    const album = groups[0];
    let sel = defaultSelectedIds(songs);
    sel = setAlbumSelection(sel, album.songs, false);
    assert.equal(albumCheckState(sel, album.songs), "none");
    sel = setAlbumSelection(sel, album.songs, true);
    assert.equal(albumCheckState(sel, album.songs), "all");
  });

  it("filterSongsBySelection respects the set", () => {
    const songs = makeSyntheticSongs(8);
    const sel = new Set([1, 3, 5]);
    const filtered = filterSongsBySelection(songs, sel);
    assert.equal(filtered.length, 3);
    assert.deepEqual(
      filtered.map((s) => s.id).sort(),
      [1, 3, 5],
    );
  });

  it("reports partial album state", () => {
    const songs = makeSyntheticSongs(5);
    const groups = groupSongsByAlbum(songs);
    const album = groups[0];
    const sel = new Set([album.songs[0].id]);
    if (album.songs.length > 1) {
      assert.equal(albumCheckState(sel, album.songs), "some");
    }
  });
});
