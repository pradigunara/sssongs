import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function searchDeezerArtist(artistName) {
  console.log(`🔍 Searching for artist: ${artistName}`);
  const response = await fetch(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(artistName)}&limit=10`
  );

  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data || [];
}

async function getDeezerAlbums(artistId) {
  console.log(`📀 Fetching albums for artist ID: ${artistId}`);
  const albums = [];
  let index = 0;
  const limit = 100;

  while (true) {
    const response = await fetch(
      `https://api.deezer.com/artist/${artistId}/albums?index=${index}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Deezer API error: ${response.status}`);
    }

    const data = await response.json();
    albums.push(...data.data);

    if (data.data.length < limit) break;
    index += limit;

    // Rate limiting - be nice to Deezer API
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return albums;
}

/**
 * Detect remix / alternate-mix tracks without false-positives like "Mix & Match".
 * Matches: Remix, RMX, parenthetical mixes, quoted mixes, trailing " Mix".
 */
function isRemixTrack(title) {
  const t = String(title || "").toLowerCase().trim();
  if (!t) return false;

  // Keep original titles that only use "mix" as part of the name
  if (/\bmix\s*[&+]/.test(t) || t === "mix & match" || t.includes("mix and match")) {
    return false;
  }

  if (/\bremix(ed|es)?\b/.test(t)) return true;
  if (/\brmx\b/.test(t)) return true;
  if (/\bre[\s-]?mix\b/.test(t)) return true;
  // (Seoul Remix: …), (Club Mix), etc.
  if (/\([^)]*\b(remix|rmx|mix)\b[^)]*\)/.test(t)) return true;
  // 'Hy-Fluid Mix', "Testarossa Mix"
  if (/['‘’"][^'‘’"]*\bmix\b[^'‘’"]*['‘’"]/.test(t)) return true;
  // Trailing alternate mix: "… Mix" / "… Mix-"
  if (/\s+mix\s*$/.test(t) || /\s+mix\s*[-–:]/.test(t)) return true;

  return false;
}

async function getDeezerAlbumTracks(albumId) {
  // First get the album info to get cover art
  const albumResponse = await fetch(`https://api.deezer.com/album/${albumId}`);

  if (!albumResponse.ok) {
    throw new Error(`Deezer API error: ${albumResponse.status}`);
  }

  const albumData = await albumResponse.json();

  // Then get the tracks
  const tracksResponse = await fetch(`https://api.deezer.com/album/${albumId}/tracks`);

  if (!tracksResponse.ok) {
    throw new Error(`Deezer API error: ${tracksResponse.status}`);
  }

  const tracksData = await tracksResponse.json();

  // Return tracks with album cover info
  return {
    tracks: tracksData.data || [],
    albumCover: albumData.cover_medium || albumData.cover_small || albumData.cover,
    albumCoverBig: albumData.cover_big || albumData.cover_xl
  };
}

async function fetchDeezerSongs(artistName, options = {}) {
  const {
    ignoreInstrumental = false,
    ignoreRemix = false,
    ignoreKeywords = [],
    includeOnly = [],
    minDurationSeconds = 0
  } = options;

  try {
    // Search for the artist
    const artists = await searchDeezerArtist(artistName);
    if (artists.length === 0) {
      throw new Error(`Artist "${artistName}" not found on Deezer`);
    }

    // Find exact match or closest match
    let targetArtist = artists.find(artist =>
      artist.name.toLowerCase() === artistName.toLowerCase()
    );

    if (!targetArtist) {
      targetArtist = artists[0]; // Take first result
      console.log(`⚠️  Exact match not found, using: ${targetArtist.name}`);
    }

    console.log(`✅ Found artist: ${targetArtist.name} (ID: ${targetArtist.id})`);
    console.log(`   Fans: ${targetArtist.nb_fan?.toLocaleString() || 'Unknown'}`);

    // Get all albums
    const albums = await getDeezerAlbums(targetArtist.id);
    console.log(`✅ Found ${albums.length} albums/singles`);

    const allSongs = [];
    let songId = 1;
    let filteredAlbums = 0;
    let filteredTracks = 0;

    for (const album of albums) {
      const albumName = album.title.toLowerCase();

      // Filter albums based on options
      let skipAlbum = false;

      if (ignoreInstrumental && (albumName.includes('instrumental') || albumName.includes('inst.'))) {
        console.log(`   ⏭️  Skipping instrumental album: ${album.title}`);
        filteredAlbums++;
        continue;
      }

      if (ignoreKeywords.length > 0) {
        for (const keyword of ignoreKeywords) {
          if (albumName.includes(keyword.toLowerCase())) {
            console.log(`   ⏭️  Skipping album with keyword "${keyword}": ${album.title}`);
            filteredAlbums++;
            skipAlbum = true;
            break;
          }
        }
      }

      if (includeOnly.length > 0) {
        const hasIncludeKeyword = includeOnly.some(keyword =>
          albumName.includes(keyword.toLowerCase())
        );
        if (!hasIncludeKeyword) {
          console.log(`   ⏭️  Skipping album (not in include list): ${album.title}`);
          filteredAlbums++;
          skipAlbum = true;
        }
      }

      if (skipAlbum) continue;

      console.log(`   📀 Processing: ${album.title} (${album.release_date})`);

      try {
        const albumData = await getDeezerAlbumTracks(album.id);
        const tracks = albumData.tracks;
        const albumCover = albumData.albumCover;
        const albumCoverBig = albumData.albumCoverBig;

        for (const track of tracks) {
          const trackName = track.title.toLowerCase();
          const durationSeconds = track.duration;

          // Filter tracks based on options
          let skipTrack = false;

          if (minDurationSeconds > 0 && durationSeconds < minDurationSeconds) {
            console.log(`   ⏭️  Skipping short track (${durationSeconds}s): ${track.title}`);
            filteredTracks++;
            skipTrack = true;
          }

          if (ignoreInstrumental && (trackName.includes('instrumental') || trackName.includes('inst.'))) {
            filteredTracks++;
            skipTrack = true;
          }

          if (ignoreRemix && isRemixTrack(track.title)) {
            console.log(`   ⏭️  Skipping remix: ${track.title}`);
            filteredTracks++;
            skipTrack = true;
          }

          if (ignoreKeywords.length > 0) {
            for (const keyword of ignoreKeywords) {
              if (trackName.includes(keyword.toLowerCase())) {
                filteredTracks++;
                skipTrack = true;
                break;
              }
            }
          }

          if (skipTrack) continue;

          // Check for duplicates (same title)
          if (!allSongs.some(song => song.title.toLowerCase() === track.title.toLowerCase())) {
            allSongs.push({
              id: songId++,
              title: track.title,
              album: album.title,
              releaseDate: album.release_date,
              deezerId: track.id.toString(),
              deezerPreviewUrl: track.preview,
              durationMs: track.duration * 1000, // Convert to milliseconds
              explicit: track.explicit_lyrics,
              trackNumber: track.track_position,
              artists: [targetArtist.name],
              // Album artwork
              albumCover: albumCover,
              albumCoverBig: albumCoverBig,
              // Additional Deezer-specific data
              deezerRank: track.rank,
              isrc: track.isrc
            });
          }
        }
      } catch (error) {
        console.log(`   ❌ Error fetching tracks for album ${album.title}: ${error.message}`);
      }

      // Rate limiting between albums
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    console.log(`✅ Total unique songs found: ${allSongs.length}`);
    if (filteredAlbums > 0) console.log(`   🚫 Filtered out ${filteredAlbums} albums`);
    if (filteredTracks > 0) console.log(`   🚫 Filtered out ${filteredTracks} tracks`);

    // Sort by release date, then by album, then by track number
    allSongs.sort((a, b) => {
      if (a.releaseDate !== b.releaseDate) {
        return a.releaseDate.localeCompare(b.releaseDate);
      }
      if (a.album !== b.album) {
        return a.album.localeCompare(b.album);
      }
      return a.trackNumber - b.trackNumber;
    });

    // Reassign IDs after sorting
    allSongs.forEach((song, index) => {
      song.id = index + 1;
    });

    return {
      artist: {
        name: targetArtist.name,
        id: targetArtist.id.toString(),
        deezerId: targetArtist.id.toString(),
        fans: targetArtist.nb_fan,
        picture: targetArtist.picture_medium
      },
      songs: allSongs,
      totalSongs: allSongs.length,
      fetchedAt: new Date().toISOString(),
      source: 'Deezer',
      filterOptions: options,
      // Analysis data
      analysis: {
        songsWithPreviews: allSongs.filter(s => s.deezerPreviewUrl).length,
        averageDuration: Math.round(allSongs.reduce((sum, s) => sum + s.durationMs, 0) / allSongs.length / 1000),
        albums: [...new Set(allSongs.map(s => s.album))].length,
        dateRange: {
          earliest: allSongs[0]?.releaseDate,
          latest: allSongs[allSongs.length - 1]?.releaseDate
        }
      }
    };

  } catch (error) {
    console.error('❌ Error fetching Deezer songs:', error.message);
    throw error;
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    artistName: 'tripleS',
    outputFile: null,
    ignoreInstrumental: false,
    ignoreRemix: false,
    ignoreKeywords: [],
    includeOnly: [],
    minDurationSeconds: 0
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      console.log(`
🎵 Deezer Song Fetcher

Usage: node scripts/fetchDeezerSongs.js [artist] [options]

Arguments:
  artist                    Artist name (default: "tripleS")

Options:
  --output, -o <file>       Output file path
  --ignore-instrumental     Skip instrumental albums and tracks
  --ignore-remix           Skip remix tracks
  --ignore <keywords>      Skip albums/tracks containing keywords (comma-separated)
  --include-only <keywords> Only include albums containing keywords (comma-separated)
  --min-duration <seconds> Skip tracks shorter than specified duration (e.g., 120 for 2 minutes)
  --help, -h               Show this help message

Examples:
  node scripts/fetchDeezerSongs.js "tripleS"
  node scripts/fetchDeezerSongs.js "tripleS" --ignore-instrumental --min-duration 120
  node scripts/fetchDeezerSongs.js "NewJeans" --ignore remix,live --min-duration 90
      `);
      process.exit(0);
    }

    if (!arg.startsWith('--') && !options.artistName) {
      options.artistName = arg;
    } else if (!arg.startsWith('--') && options.artistName === 'tripleS') {
      options.artistName = arg;
    } else if (arg === '--output' || arg === '-o') {
      options.outputFile = args[++i];
    } else if (arg === '--ignore-instrumental') {
      options.ignoreInstrumental = true;
    } else if (arg === '--ignore-remix') {
      options.ignoreRemix = true;
    } else if (arg === '--ignore') {
      const keywords = args[++i];
      if (keywords) {
        options.ignoreKeywords = keywords.split(',').map(k => k.trim());
      }
    } else if (arg === '--include-only') {
      const keywords = args[++i];
      if (keywords) {
        options.includeOnly = keywords.split(',').map(k => k.trim());
      }
    } else if (arg === '--min-duration') {
      const duration = parseInt(args[++i]);
      if (!isNaN(duration) && duration > 0) {
        options.minDurationSeconds = duration;
      }
    }
  }

  // Set default output file if not specified
  if (!options.outputFile) {
    options.outputFile = `src/data/${options.artistName.toLowerCase().replace(/\s+/g, '-')}-deezer-songs.json`;
  }

  return options;
}

// Main execution
const options = parseArgs();

console.log(`🎵 Fetching Deezer songs for: ${options.artistName}`);
console.log(`📁 Output file: ${options.outputFile}`);

fetchDeezerSongs(options.artistName, {
  ignoreInstrumental: options.ignoreInstrumental,
  ignoreRemix: options.ignoreRemix,
  ignoreKeywords: options.ignoreKeywords,
  includeOnly: options.includeOnly,
  minDurationSeconds: options.minDurationSeconds
})
  .then(data => {
    const dir = path.dirname(options.outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(options.outputFile, JSON.stringify(data, null, 2));

    console.log(`\n🎉 Deezer songs saved to ${options.outputFile}`);
    console.log(`📊 Analysis Summary:`);
    console.log(`   Artist: ${data.artist.name} (${data.artist.fans?.toLocaleString() || 'Unknown'} fans)`);
    console.log(`   Total songs: ${data.totalSongs}`);
    console.log(`   Albums/Singles: ${data.analysis.albums}`);
    console.log(`   Songs with previews: ${data.analysis.songsWithPreviews}/${data.totalSongs} (${Math.round(data.analysis.songsWithPreviews/data.totalSongs*100)}%)`);
    console.log(`   Average duration: ${data.analysis.averageDuration}s`);
    console.log(`   Date range: ${data.analysis.dateRange.earliest} - ${data.analysis.dateRange.latest}`);

    if (data.filterOptions) {
      console.log(`   Filters applied: ${JSON.stringify(data.filterOptions, null, 2)}`);
    }

    // Show first few songs as sample
    console.log(`\n📋 Sample songs:`);
    data.songs.slice(0, 5).forEach(song => {
      const preview = song.deezerPreviewUrl ? '🎵' : '❌';
      console.log(`   ${preview} ${song.title} - ${song.album} (${song.releaseDate})`);
    });

    if (data.totalSongs > 5) {
      console.log(`   ... and ${data.totalSongs - 5} more songs`);
    }
  })
  .catch(error => {
    console.error('Failed to fetch Deezer songs:', error.message);
    process.exit(1);
  });
