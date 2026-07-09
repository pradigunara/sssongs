// Static imports for bundling
import spotifyData from "./data/triples-songs.json";
import deezerData from "./data/triples-deezer-songs.json";
import { SongSorterCore } from "./songSorter.core.js";

// Provider configuration with static data references
const PROVIDER_CONFIG = {
  spotify: {
    data: spotifyData,
    embedUrl: (id) => `https://open.spotify.com/embed/track/${id}`,
    idField: "spotifyId",
  },
  deezer: {
    data: deezerData,
    embedUrl: (id) => `https://widget.deezer.com/widget/dark/track/${id}`,
    idField: "deezerId",
  },
};

function loadProviderData(provider) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  const data = config.data;
  return data?.songs || [];
}

function getProviderEmbedUrl(provider, songId) {
  const config = PROVIDER_CONFIG[provider];
  return config ? config.embedUrl(songId) : null;
}

function getProviderIdField(provider) {
  const config = PROVIDER_CONFIG[provider];
  return config ? config.idField : null;
}

/**
 * Top-K song sorter wrapper.
 * Hybrid: 3-way Elo discovery + soft cut, then pairwise merge-sort
 * (or pure merge when the selected catalog is small).
 */
export class SongSorter extends SongSorterCore {
  constructor(songs, musicProvider = "deezer") {
    const idField = getProviderIdField(musicProvider);
    if (!idField) {
      throw new Error(`Unknown provider: ${musicProvider}`);
    }
    super(songs, idField);
    this.musicProvider = musicProvider;
  }
}

export {
  loadProviderData,
  getProviderEmbedUrl,
  getProviderIdField,
  PROVIDER_CONFIG,
};
