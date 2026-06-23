// pokemonImage.js
// Sprites are served locally from the backend after sync.
// If a sprite wasn't downloaded during sync, null is returned and the component
// shows a "?" placeholder — no external CDN requests are ever made.

const API_BASE     = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
const BACKEND_BASE = API_BASE.replace(/\/api$/, '');   // e.g. "http://localhost:3001"

/**
 * Primary image URL for a Pokémon.
 * - Local path ("/sprites/incineroar.png") → resolved against the backend host.
 * - null → no sprite was cached during sync; the component shows a placeholder.
 * No CDN requests are ever made from the browser.
 */
export function getPokemonImageUrl(name, spriteUrlFromApi = null) {
  if (!spriteUrlFromApi) return null;

  // Local path returned by the backend
  if (spriteUrlFromApi.startsWith('/sprites/')) {
    return `${BACKEND_BASE}${spriteUrlFromApi}`;
  }

  // Should not reach here with the updated backend, but handle gracefully
  return null;
}

/**
 * Bulbapedia page link (for opening in browser — not used for images).
 */
export function bulbapediaPageUrl(name) {
  const display = name.split(/[-\s]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join("_");
  return `https://bulbapedia.bulbagarden.net/wiki/${display}_(Pok%C3%A9mon)`;
}
