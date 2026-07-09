/**
 * Export / share top-K results without external libs (html2canvas CDN was flaky).
 * Uses Canvas 2D → PNG download, plus Web Share / clipboard fallbacks.
 */

/**
 * @param {Array<{ title?: string, album?: string }>} rankings
 * @param {number} topK
 * @returns {HTMLCanvasElement}
 */
export function renderShareCanvas(rankings, topK = 10) {
  const list = rankings.slice(0, topK);
  const width = 720;
  const padX = 48;
  const padTop = 56;
  const rowH = 52;
  const headerH = 100;
  const footerH = 56;
  const height = padTop + headerH + list.length * rowH + footerH + 32;

  const canvas = document.createElement("canvas");
  const scale = Math.min(2, window.devicePixelRatio || 2);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  // Background
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#0a0a0a");
  bg.addColorStop(0.45, "#1a1a2e");
  bg.addColorStop(1, "#16213e");
  ctx.fillStyle = bg;
  roundRect(ctx, 0, 0, width, height, 28);
  ctx.fill();

  // Soft glow orbs
  drawOrb(ctx, width * 0.2, height * 0.85, 180, "rgba(120, 119, 198, 0.28)");
  drawOrb(ctx, width * 0.85, height * 0.15, 140, "rgba(255, 119, 198, 0.2)");
  drawOrb(ctx, width * 0.5, height * 0.45, 160, "rgba(120, 219, 255, 0.1)");

  // Title
  ctx.textAlign = "center";
  ctx.font = "800 32px system-ui, -apple-system, Segoe UI, sans-serif";
  const titleGrad = ctx.createLinearGradient(width * 0.25, 0, width * 0.75, 0);
  titleGrad.addColorStop(0, "#ff6b9d");
  titleGrad.addColorStop(0.5, "#c471ed");
  titleGrad.addColorStop(1, "#12c2e9");
  ctx.fillStyle = titleGrad;
  ctx.fillText(`My tripleS Top ${topK}`, width / 2, padTop + 8);

  ctx.font = "500 15px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("tripleS Song Sorter", width / 2, padTop + 36);

  // Rows
  const startY = padTop + headerH;
  list.forEach((song, i) => {
    const y = startY + i * rowH;
    const rowTop = y - 28;

    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    roundRect(ctx, padX, rowTop, width - padX * 2, 44, 12);
    ctx.fill();
    ctx.stroke();

    // Rank
    ctx.textAlign = "left";
    ctx.font = "800 16px system-ui, -apple-system, Segoe UI, sans-serif";
    const rankGrad = ctx.createLinearGradient(padX + 12, 0, padX + 48, 0);
    rankGrad.addColorStop(0, "#ff6b9d");
    rankGrad.addColorStop(1, "#c471ed");
    ctx.fillStyle = i < 3 ? rankGrad : "rgba(255,255,255,0.85)";
    ctx.fillText(`#${i + 1}`, padX + 16, y);

    // Title
    ctx.font = "600 15px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = "#ffffff";
    const title = truncate(ctx, song.title || "Untitled", width - padX * 2 - 72);
    ctx.fillText(title, padX + 58, y);
  });

  // Footer
  ctx.textAlign = "center";
  ctx.font = "400 12px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(
    `Created with SSS Song Sorter · ${new Date().toLocaleDateString()}`,
    width / 2,
    height - 28,
  );

  return canvas;
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawOrb(ctx, x, y, radius, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not create image"));
    }, "image/png");
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay revoke so Safari can start the download
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function formatShareText(rankings, topK) {
  const lines = rankings
    .slice(0, topK)
    .map((s, i) => `${i + 1}. ${s.title || "Untitled"}`);
  return `My tripleS Top ${topK}:\n${lines.join("\n")}\n\nhttps://sssorter.pages.dev/songs`;
}

/**
 * Share or download top-K image (+ optional native share / copy).
 * @param {{ rankings: Array, topK?: number }} opts
 * @returns {Promise<'shared'|'downloaded'|'copied'>}
 */
export async function shareTopResults({ rankings, topK = 10 }) {
  if (!rankings?.length) {
    throw new Error("No rankings to share");
  }

  const canvas = renderShareCanvas(rankings, topK);
  const blob = await canvasToBlob(canvas);
  const filename = `my-triples-top-${topK}-${Date.now()}.png`;
  const text = formatShareText(rankings, topK);

  // Prefer native share with image when available (mobile)
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      const file = new File([blob], filename, { type: "image/png" });
      const data = { title: `My tripleS Top ${topK}`, text, files: [file] };
      if (!navigator.canShare || navigator.canShare(data)) {
        await navigator.share(data);
        return "shared";
      }
    } catch (err) {
      // User cancel → stop; other errors fall through to download
      if (err && (err.name === "AbortError" || err.name === "NotAllowedError")) {
        throw err;
      }
    }
    // Try text-only share
    try {
      await navigator.share({ title: `My tripleS Top ${topK}`, text });
      return "shared";
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
    }
  }

  // Desktop: download PNG
  downloadBlob(blob, filename);
  return "downloaded";
}
