// services/sprites.js
// Downloads Pokémon sprites from Showdown's CDN during sync and serves them locally.
// This eliminates the 300 simultaneous external requests that block the browser on
// every MetaAnalysis page load.

const fs   = require('fs');
const path = require('path');
const { toShowdownId } = require('./showdownData');

const SPRITES_DIR = path.join(__dirname, '../../public/sprites');
const CDN_BASE    = 'https://play.pokemonshowdown.com/sprites/dex';

// Ensure directory exists on module load
if (!fs.existsSync(SPRITES_DIR)) fs.mkdirSync(SPRITES_DIR, { recursive: true });

/** Full path to the local sprite file for a given Showdown ID. */
function spritePath(showdownId) {
  return path.join(SPRITES_DIR, `${showdownId}.png`);
}

/** True if the sprite is already cached on disk. */
function spriteExists(showdownId) {
  return fs.existsSync(spritePath(showdownId));
}

/** Download one sprite. Returns true on success. */
async function downloadSprite(showdownId) {
  if (spriteExists(showdownId)) return true;
  const url = `${CDN_BASE}/${showdownId}.png`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'pokemon-vgc-tool/1.0' },
    });
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    fs.writeFileSync(spritePath(showdownId), Buffer.from(buf));
    return true;
  } catch {
    return false;
  }
}

/**
 * Download sprites for a list of Pokémon names.
 * Already-cached sprites are skipped (no re-download).
 * Downloads are serialised with a small delay every 20 files so we don't
 * hammer the CDN or block the Node event loop for extended periods.
 */
async function downloadSprites(names) {
  let downloaded = 0, skipped = 0, failed = 0;
  for (const name of names) {
    const id = toShowdownId(name);
    if (spriteExists(id)) { skipped++; continue; }
    const ok = await downloadSprite(id);
    if (ok) { downloaded++; }
    else { failed++; console.warn(`[sprites] Failed to download: ${id}`); }
    // Yield to event loop every 20 downloads to keep the server responsive
    if ((downloaded + failed) % 20 === 0) {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  if (downloaded > 0 || failed > 0) {
    console.log(`[sprites] Downloaded: ${downloaded}, Skipped: ${skipped}, Failed: ${failed}`);
  } else {
    console.log(`[sprites] All ${skipped} sprites already cached`);
  }
  return { downloaded, skipped, failed };
}

/**
 * Returns the local sprite URL path (e.g. "/sprites/incineroar.png")
 * if the file exists on disk, or null if it hasn't been downloaded yet.
 */
function getLocalSpriteUrl(name) {
  const id = toShowdownId(name);
  return spriteExists(id) ? `/sprites/${id}.png` : null;
}

module.exports = { downloadSprites, getLocalSpriteUrl, spriteExists };
