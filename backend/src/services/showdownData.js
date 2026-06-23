// services/showdownData.js
// Fetches Pokémon types + base stats from Pokémon Showdown's own pokedex.json.
// This is Smogon's data — the same source used by the simulator.
// Fetched once and stored as plain JSON files in data/cache/ (NOT in SQLite —
// keeping large blobs out of the DB keeps saveToDisk() fast).

const fs   = require("fs");
const path = require("path");
const { getDb } = require("../db/schema");

const CACHE_DIR = path.join(__dirname, "../../data/cache");

function readFileCache(key) {
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.warn(`[showdown] Cache read error for ${key}:`, err.message);
  }
  return null;
}

function writeFileCache(key, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
}

const POKEDEX_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // re-fetch after 30 days

const POKEDEX_URL    = "https://play.pokemonshowdown.com/data/pokedex.json";
const MOVES_URL      = "https://play.pokemonshowdown.com/data/moves.json";
const LEARNSETS_URL  = "https://play.pokemonshowdown.com/data/learnsets.json";
const ABILITIES_TS   = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/abilities.ts";
const ITEMS_TS       = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/items.ts";

let _pokedexCache    = null;
let _movesCache      = null;
let _learnsetsCache  = null;
let _abilitiesCache  = null;
let _itemsCache      = null;

// In-flight fetch promises — prevent 200+ concurrent callers from all triggering
// separate network requests when the in-memory cache is cold.
let _pokedexFetching   = null;
let _learnsetsFetching = null;

/**
 * Parse a Showdown TypeScript data file into an { id → displayName } map.
 * Uses a line-by-line approach so nested method bodies (with their own { })
 * don't break the extraction.
 *
 * Handles two formats:
 *   items.ts    — lowercase top-level key IS the id:  abilityshield: { name: "Ability Shield"
 *   abilities.ts — PascalCase key, explicit id/name:  Overgrow: { ... id: "overgrow", name: "Overgrow"
 */
function parseTsIdNameMap(text) {
  const map = {};
  const lines = text.split('\n');

  let currentId   = null;
  let currentName = null;

  function flush() {
    if (currentId && currentName) map[currentId] = currentName;
    currentId = null;
    currentName = null;
  }

  for (const line of lines) {
    // New top-level entry — flush the previous one first

    // Items format: lowercase key is the id   e.g.  \tabilityshield: {
    const lcKey = line.match(/^\t([a-z][a-z0-9]*):\s*\{/);
    if (lcKey) { flush(); currentId = lcKey[1]; continue; }

    // Abilities format: PascalCase/mixed key, id set by id: field below   e.g.  \tRough Skin: {
    if (/^\t[A-Z][^\n]*:\s*\{/.test(line)) { flush(); continue; }

    // id: field at indent-2 (exactly two tabs before "id:")
    const idField = line.match(/^\t\tid:\s*"([^"]+)"/);
    if (idField) { currentId = idField[1]; continue; }

    // name: field at indent-2
    const nameField = line.match(/^\t\tname:\s*"([^"]+)"/);
    if (nameField) { currentName = nameField[1]; continue; }
  }

  flush(); // save the last entry
  return map;
}

async function loadAbilityDex() {
  if (_abilitiesCache) return _abilitiesCache;
  const stored = readFileCache("ability-names");
  if (stored && Object.keys(stored).length > 100) {
    _abilitiesCache = stored; return stored;
  }
  if (stored) console.log("[showdown] Ability name cache appears stale — re-fetching...");
  console.log("[showdown] Fetching abilities.ts from Showdown GitHub...");
  const res = await fetch(ABILITIES_TS, { headers: { 'User-Agent': 'pokemon-vgc-tool/1.0' } });
  if (!res.ok) throw new Error(`abilities.ts fetch failed: ${res.status}`);
  const map = parseTsIdNameMap(await res.text());
  writeFileCache("ability-names", map);
  _abilitiesCache = map;
  console.log(`[showdown] Abilities cached (${Object.keys(map).length} entries)`);
  return map;
}

async function loadItemDex() {
  if (_itemsCache) return _itemsCache;
  const stored = readFileCache("item-names");
  if (stored) { _itemsCache = stored; return stored; }
  console.log("[showdown] Fetching items.ts from Showdown GitHub...");
  const res = await fetch(ITEMS_TS, { headers: { 'User-Agent': 'pokemon-vgc-tool/1.0' } });
  if (!res.ok) throw new Error(`items.ts fetch failed: ${res.status}`);
  const map = parseTsIdNameMap(await res.text());
  writeFileCache("item-names", map);
  _itemsCache = map;
  console.log(`[showdown] Items cached (${Object.keys(map).length} entries)`);
  return map;
}

// Convert Showdown's internal ID to display name lookup key
// e.g. "fluttermane" → lookup in pokedex
function toShowdownId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const REG_FILE = path.join(__dirname, "../../../shared/regulations.js");

async function loadPokedex() {
  if (_pokedexCache) return _pokedexCache;
  const cacheFile = path.join(CACHE_DIR, "pokedex.json");
  if (fs.existsSync(cacheFile)) {
    const cacheMtime = fs.statSync(cacheFile).mtimeMs;
    const tooOld = Date.now() - cacheMtime > POKEDEX_MAX_AGE_MS;
    const regUpdated = fs.existsSync(REG_FILE) && fs.statSync(REG_FILE).mtimeMs > cacheMtime;
    if (!tooOld && !regUpdated) {
      const stored = readFileCache("pokedex");
      if (stored) {
        _pokedexCache = stored;
        console.log("[showdown] Loaded pokedex from cache");
        return _pokedexCache;
      }
    } else {
      const reason = regUpdated ? "regulations.js updated" : "cache >30 days old";
      console.log(`[showdown] Pokedex cache is stale (${reason}), re-fetching...`);
    }
  }
  if (_pokedexFetching) return _pokedexFetching;
  console.log("[showdown] Fetching pokedex.json from Showdown...");
  _pokedexFetching = fetch(POKEDEX_URL)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch Showdown pokedex: ${res.status}`);
      return res.json();
    })
    .then(data => {
      writeFileCache("pokedex", data);
      _pokedexCache = data;
      _pokedexFetching = null;
      console.log(`[showdown] Pokedex cached (${Object.keys(data).length} entries)`);
      return data;
    })
    .catch(err => { _pokedexFetching = null; throw err; });
  return _pokedexFetching;
}

/**
 * Returns { types, baseStats, num, sprite } for a Pokémon by name.
 * Falls back gracefully if the Pokémon isn't found.
 */
async function getPokemonData(name) {
  const dex = await loadPokedex();
  const id = toShowdownId(name);
  const entry = dex[id];

  if (!entry) return { types: [], baseStats: {}, num: null, spriteUrl: null };

  const types = (entry.types ?? []).map((t) => t.toLowerCase());
  const baseStats = entry.baseStats ?? {};
  const num = entry.num ?? null;

  // Showdown sprite URL (from their CDN, same source as Smogon)
  const spriteUrl = num && num > 0
    ? `https://play.pokemonshowdown.com/sprites/ani/${id}.gif`
    : null;

  // Also build a static PNG fallback
  const staticUrl = num && num > 0
    ? `https://play.pokemonshowdown.com/sprites/dex/${id}.png`
    : null;

  return { types, baseStats, num, spriteUrl: staticUrl };
}

async function loadMoveDex() {
  if (_movesCache) return _movesCache;
  const stored = readFileCache("moves");
  if (stored) { _movesCache = stored; return stored; }
  console.log("[showdown] Fetching moves.json from Showdown...");
  const res = await fetch(MOVES_URL);
  if (!res.ok) throw new Error(`Failed to fetch Showdown moves: ${res.status}`);
  const data = await res.json();
  writeFileCache("moves", data);
  _movesCache = data;
  console.log(`[showdown] Moves cached (${Object.keys(data).length} entries)`);
  return data;
}

/**
 * Returns the type (lowercase) for a move name, or null if unknown.
 */
async function getMoveType(name) {
  const dex = await loadMoveDex();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return dex[id]?.type?.toLowerCase() ?? null;
}

async function loadLearnsets() {
  if (_learnsetsCache) return _learnsetsCache;
  const stored = readFileCache("learnsets");
  if (stored) { _learnsetsCache = stored; return stored; }
  if (_learnsetsFetching) return _learnsetsFetching;
  console.log("[showdown] Fetching learnsets.json from Showdown...");
  _learnsetsFetching = fetch(LEARNSETS_URL)
    .then(res => {
      if (!res.ok) throw new Error(`Failed to fetch Showdown learnsets: ${res.status}`);
      return res.json();
    })
    .then(data => {
      writeFileCache("learnsets", data);
      _learnsetsCache = data;
      _learnsetsFetching = null;
      console.log(`[showdown] Learnsets cached (${Object.keys(data).length} entries)`);
      return data;
    })
    .catch(err => { _learnsetsFetching = null; throw err; });
  return _learnsetsFetching;
}

/**
 * Returns a Set of internal move IDs (lowercase, no spaces) that a Pokémon
 * can legally use in Gen 9, following its pre-evolution chain.
 */
async function getPokemonGen9Moves(name) {
  const [learnsets, pokedex] = await Promise.all([loadLearnsets(), loadPokedex()]);
  const moveIds = new Set();

  let current = toShowdownId(name);
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = learnsets[current];
    if (entry?.learnset) {
      for (const [moveId, sources] of Object.entries(entry.learnset)) {
        if (sources.some(s => s.startsWith('9'))) {
          moveIds.add(moveId);
        }
      }
    }
    // Forme → base species (Mega/Arceus type/etc.), then base species → pre-evolution.
    const pdx = pokedex[current];
    const next = pdx?.baseSpecies ? toShowdownId(pdx.baseSpecies) : pdx?.prevo ? toShowdownId(pdx.prevo) : null;
    current = next && next !== current ? next : null;
  }

  return moveIds;
}

/**
 * Force-refresh the pokedex cache (call after a new game patch).
 */
async function refreshPokedex() {
  _pokedexCache = null;
  const file = path.join(CACHE_DIR, "pokedex.json");
  try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  return loadPokedex();
}

module.exports = { getPokemonData, loadPokedex, loadMoveDex, loadAbilityDex, loadItemDex, loadLearnsets, getMoveType, getPokemonGen9Moves, refreshPokedex, toShowdownId };
