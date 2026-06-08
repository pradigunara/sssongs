// Enhanced embed pool for better INP performance
class EmbedPool {
  constructor() {
    this.pool = new Map();
    this.active = new Set();
  }

  // Create and pool an embed for later use
  createEmbed(song, provider) {
    const embedId = this.getEmbedId(song, provider);
    
    if (this.pool.has(embedId)) {
      return this.pool.get(embedId);
    }

    const iframe = this.createMusicEmbed(song, provider);
    if (iframe) {
      // Hide the iframe initially
      iframe.style.opacity = '0';
      iframe.style.position = 'absolute';
      iframe.style.top = '-9999px';
      iframe.style.left = '-9999px';
      iframe.style.pointerEvents = 'none';
      
      // Add to DOM but hidden
      document.body.appendChild(iframe);
      this.pool.set(embedId, iframe);
      
      // Pre-warm the iframe
      requestIdleCallback(() => {
        iframe.style.position = 'static';
        iframe.style.top = 'auto';
        iframe.style.left = 'auto';
        iframe.style.pointerEvents = 'auto';
      });
    }
    
    return iframe;
  }

  // Get embed from pool (removes from pool, adds to active)
  getEmbed(embedId) {
    const embed = this.pool.get(embedId);
    if (embed) {
      this.pool.delete(embedId);
      this.active.add(embedId);
      
      // Reset styles for use
      embed.style.opacity = '1';
      embed.style.position = 'static';
      embed.style.top = 'auto';
      embed.style.left = 'auto';
      embed.style.pointerEvents = 'auto';
    }
    return embed;
  }

  // Return embed to pool (removes from active, adds to pool)
  returnEmbed(embedId, embed) {
    if (this.active.has(embedId)) {
      this.active.delete(embedId);
      
      // Hide again
      embed.style.opacity = '0';
      embed.style.position = 'absolute';
      embed.style.top = '-9999px';
      embed.style.left = '-9999px';
      embed.style.pointerEvents = 'none';
      
      this.pool.set(embedId, embed);
    }
  }

  // Clean up all embeds
  cleanup() {
    [...this.pool.values(), ...this.getActiveEmbeds()].forEach(embed => {
      if (embed && embed.parentNode) {
        embed.parentNode.removeChild(embed);
      }
    });
    this.pool.clear();
    this.active.clear();
  }

  getActiveEmbeds() {
    return Array.from(this.active).map(id => document.querySelector(`[data-embed-id="${id}"] iframe`)).filter(Boolean);
  }

  getEmbedId(song, provider) {
    return provider === 'spotify' ? song.spotifyId : song.deezerId;
  }

  createMusicEmbed(song, provider) {
    const embedId = this.getEmbedId(song, provider);
    if (!embedId) return null;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-embed-id', embedId);
    iframe.style.borderRadius = '12px';
    iframe.frameBorder = '0';
    iframe.allowTransparency = 'true';
    iframe.allow = 'encrypted-media';
    iframe.loading = 'lazy';

    if (provider === 'spotify') {
      iframe.src = `https://open.spotify.com/embed/track/${embedId}?utm_source=generator&theme=0`;
      iframe.width = '100%';
      iframe.height = '152';
    } else if (provider === 'deezer') {
      iframe.src = `https://widget.deezer.com/widget/dark/track/${embedId}`;
      iframe.width = '100%';
      iframe.height = '155';
    }

    return iframe;
  }
}

// Global embed pool instance
export const embedPool = new EmbedPool();

// Enhanced load and play function with pool optimization
export async function loadAndPlayEmbed(embedId, button) {
  try {
    button.textContent = 'Loading...';
    button.disabled = true;

    const container = document.querySelector(`[data-embed-id="${embedId}"]`);
    if (!container) {
      throw new Error('Container not found');
    }

    // Try to get embed from pool first
    let embed = embedPool.getEmbed(embedId);
    
    if (!embed) {
      // Fallback: create new embed if not in pool
      const song = getCurrentSongByEmbedId(embedId);
      const provider = container.getAttribute('data-provider');
      embed = embedPool.createMusicEmbed(song, provider);
      
      if (!embed) {
        throw new Error('Failed to create embed');
      }
    }

    // Use scheduler.postTask for non-blocking DOM updates
    if ('scheduler' in window && 'postTask' in scheduler) {
      await scheduler.postTask(() => {
        replaceWithEmbed(container, embed);
      }, { priority: 'user-blocking' });
    } else {
      // Fallback for browsers without scheduler API
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          replaceWithEmbed(container, embed);
          resolve();
        });
      });
    }

  } catch (error) {
    button.textContent = 'Load Failed - Retry';
    button.disabled = false;
  }
}

function replaceWithEmbed(container, embed) {
  // Clear existing content
  container.innerHTML = '';
  container.appendChild(embed);
  
  // Trigger fade-in animation
  embed.style.opacity = '0';
  requestAnimationFrame(() => {
    embed.style.transition = 'opacity 0.3s ease-in-out';
    embed.style.opacity = '1';
  });
}

function getCurrentSongByEmbedId(embedId) {
  // This would need to be implemented based on your current song tracking
  // For now, return a placeholder - you'll need to integrate this with your current state
  return window.currentRoundOptions?.find(song => 
    song.spotifyId === embedId || song.deezerId === embedId
  );
}