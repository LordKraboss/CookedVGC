// services/championsData.js
// Fetches and parses the Champions BSS mod data from Showdown's GitHub.
// Two files are used:
//   champions/learnsets.ts   — move legality per Pokémon (313 KB, pure data)
//   champions/formats-data.ts — which Pokémon are legal (isNonstandard == null)
//
// Both are cached to disk. Cache is considered stale after 30 days OR when
// regulations.js is newer than the cache (new regulation was added).

const fs   = require("fs");
const path = require("path");
const vm   = require("vm");

const CACHE_DIR    = path.join(__dirname, "../../data/cache");
const REG_FILE     = path.join(__dirname, "../../../shared/regulations.js");
const DATA_URL     = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data";
const BASE_URL     = `${DATA_URL}/mods/champions`;
const MAX_AGE_MS   = 30 * 24 * 60 * 60 * 1000;

let _learnsets    = null;
let _formatsData  = null;
let _legalItems   = null;
let _moveOverrides = null;
let _moveDex       = null;

// ── Cache helpers ─────────────────────────────────────────────────────────────

function cacheFile(key) { return path.join(CACHE_DIR, `${key}.json`); }

function readCache(key) {
  try {
    const f = cacheFile(key);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {}
  return null;
}

function writeCache(key, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile(key), JSON.stringify(data));
}

function isStale(key) {
  const f = cacheFile(key);
  if (!fs.existsSync(f)) return true;
  const cacheMtime = fs.statSync(f).mtimeMs;
  if (Date.now() - cacheMtime > MAX_AGE_MS) return true;
  if (fs.existsSync(REG_FILE) && fs.statSync(REG_FILE).mtimeMs > cacheMtime) return true;
  return false;
}

// ── TypeScript data file parser ───────────────────────────────────────────────
// Finds "= {" (start of the exported object literal), extracts the balanced
// brace block, then evaluates it as JS. Works for pure-data TS files like
// learnsets.ts and formats-data.ts — do NOT use on files with method bodies.

function parseTsObject(text) {
  const eqIdx = text.indexOf("= {");
  if (eqIdx === -1) throw new Error("parseTsObject: could not find '= {' in file");
  const start = eqIdx + 2;
  let depth = 0, end = -1;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) throw new Error("parseTsObject: unbalanced braces");
  return vm.runInNewContext(`(${text.slice(start, end + 1)})`);
}

async function fetchAndCache(filename, cacheKey) {
  const url = `${BASE_URL}/${filename}`;
  console.log(`[champions] Fetching ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": "pokemon-vgc-tool/1.0" } });
  if (!res.ok) throw new Error(`[champions] ${filename} fetch failed: ${res.status}`);
  const data = parseTsObject(await res.text());
  writeCache(cacheKey, data);
  return data;
}

// ── items.ts legality parser ────────────────────────────────────────────────
// items.ts (base and Champions) contains method bodies with TS casts, so the
// vm-based parseTsObject can't be used. We only need each item's `name` and
// `isNonstandard`, both of which sit at the 2-tab indent — a line-based parse
// is robust against nested method braces.

function parseItemsLegality(text) {
  const map = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const key = line.match(/^\t([a-z0-9]+):\s*\{/);
    if (key) { cur = key[1]; map[cur] = {}; continue; }
    if (!cur) continue;
    const ns = line.match(/^\t\tisNonstandard:\s*(null|"[^"]*")/);
    if (ns) map[cur].isNonstandard = ns[1] === "null" ? null : ns[1].replace(/"/g, "");
    const nm = line.match(/^\t\tname:\s*"([^"]+)"/);
    if (nm) map[cur].name = nm[1];
  }
  return map;
}

async function fetchAndCacheItems(url, cacheKey) {
  console.log(`[champions] Fetching ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": "pokemon-vgc-tool/1.0" } });
  if (!res.ok) throw new Error(`[champions] ${cacheKey} fetch failed: ${res.status}`);
  const data = parseItemsLegality(await res.text());
  writeCache(cacheKey, data);
  return data;
}

// ── Champions moves.ts override parser ──────────────────────────────────────
// moves.ts is an override table with method bodies, so we line-parse only the
// scalar fields we care about for display/legality. Each entry sits under a
// 1-tab id key; whitelisted fields sit at the 2-tab indent. Method-body fields
// (flags, secondary, condition, self, on*) are intentionally skipped.

const MOVE_SCALAR_FIELDS = new Set(["basePower", "pp", "accuracy", "type", "category", "isNonstandard"]);

function coerceMoveValue(raw) {
  const v = raw.replace(/,\s*$/, "").trim();
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  const q = v.match(/^"([^"]*)"$/);
  if (q) return q[1];
  return undefined; // unparseable (object/expression) — skip
}

function parseMoveOverrides(text) {
  const map = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const key = line.match(/^\t([a-z0-9]+):\s*\{/);
    if (key) { cur = key[1]; map[cur] = {}; continue; }
    if (!cur) continue;
    const f = line.match(/^\t\t([a-zA-Z]+):\s*(.+)$/);
    if (!f || !MOVE_SCALAR_FIELDS.has(f[1]) || f[1] in map[cur]) continue;
    const val = coerceMoveValue(f[2]);
    if (val !== undefined) map[cur][f[1]] = val;
  }
  return map;
}

async function loadMoveOverrides() {
  if (_moveOverrides) return _moveOverrides;
  let cached = readCache("champions-moves");
  if (cached && !isStale("champions-moves")) { _moveOverrides = cached; return cached; }
  const url = `${BASE_URL}/moves.ts`;
  console.log(`[champions] Fetching ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": "pokemon-vgc-tool/1.0" } });
  if (!res.ok) throw new Error(`[champions] moves.ts fetch failed: ${res.status}`);
  const data = parseMoveOverrides(await res.text());
  writeCache("champions-moves", data);
  _moveOverrides = data;
  console.log(`[champions] Move overrides cached (${Object.keys(data).length} moves)`);
  return data;
}

/**
 * Returns the full Showdown move dex with Champions overrides merged in
 * (basePower / type / accuracy / pp / category / isNonstandard). Memoised —
 * base dex and overrides are both stable until a mod refresh.
 */
async function getChampionsMoveDex() {
  if (_moveDex) return _moveDex;
  const { loadMoveDex } = require("./showdownData");
  const [base, overrides] = await Promise.all([loadMoveDex(), loadMoveOverrides()]);
  const merged = { ...base };
  for (const [id, o] of Object.entries(overrides)) {
    if (merged[id]) merged[id] = { ...merged[id], ...o };
  }
  _moveDex = merged;
  return merged;
}

// ── Data loaders ──────────────────────────────────────────────────────────────

async function loadLearnsets() {
  if (_learnsets) return _learnsets;
  if (!isStale("champions-learnsets")) {
    const cached = readCache("champions-learnsets");
    if (cached) { _learnsets = cached; console.log("[champions] Learnsets loaded from cache"); return cached; }
  } else {
    console.log("[champions] Learnsets cache stale, re-fetching...");
  }
  _learnsets = await fetchAndCache("learnsets.ts", "champions-learnsets");
  console.log(`[champions] Learnsets cached (${Object.keys(_learnsets).length} Pokémon)`);
  return _learnsets;
}

async function loadFormatsData() {
  if (_formatsData) return _formatsData;
  if (!isStale("champions-formats")) {
    const cached = readCache("champions-formats");
    if (cached) { _formatsData = cached; console.log("[champions] Formats data loaded from cache"); return cached; }
  } else {
    console.log("[champions] Formats data cache stale, re-fetching...");
  }
  _formatsData = await fetchAndCache("formats-data.ts", "champions-formats");
  console.log(`[champions] Formats data cached (${Object.keys(_formatsData).length} entries)`);
  return _formatsData;
}

/**
 * Returns the legal item pool for the Champions format as [{ id, name }].
 * Effective legality = Champions override when the item is listed there,
 * else the base game's value. An item is legal when isNonstandard === null.
 * Base names are authoritative (Champions entries are `inherit: true`, no name).
 */
async function getLegalChampionsItems() {
  if (_legalItems) return _legalItems;

  let base = readCache("base-items");
  if (!base || isStale("base-items"))
    base = await fetchAndCacheItems(`${DATA_URL}/items.ts`, "base-items");

  let champ = readCache("champions-items");
  if (!champ || isStale("champions-items"))
    champ = await fetchAndCacheItems(`${BASE_URL}/items.ts`, "champions-items");

  const legal = [];
  for (const [id, b] of Object.entries(base)) {
    const eff = (id in champ && "isNonstandard" in champ[id])
      ? champ[id].isNonstandard
      : (b.isNonstandard ?? null);
    if (eff === null) legal.push({ id, name: b.name ?? id });
  }
  _legalItems = legal;
  console.log(`[champions] Legal item pool: ${legal.length} items`);
  return legal;
}

/**
 * Returns Showdown's item description text as { id: { name, shortDesc, desc } }.
 * Source is data/text/items.ts (pure-data, parseTsObject-safe). Global to all
 * formats — Champions only changes legality, not what an item does. Memoised +
 * disk-cached (30-day stale window, same as the other Showdown caches).
 */
let _itemTexts = null;
async function loadItemDescriptions() {
  if (_itemTexts) return _itemTexts;
  let cached = readCache("item-texts");
  if (cached && !isStale("item-texts")) { _itemTexts = cached; return cached; }
  const url = `${DATA_URL}/text/items.ts`;
  console.log(`[champions] Fetching ${url}...`);
  const res = await fetch(url, { headers: { "User-Agent": "pokemon-vgc-tool/1.0" } });
  if (!res.ok) throw new Error(`[champions] text/items.ts fetch failed: ${res.status}`);
  const data = parseTsObject(await res.text());
  writeCache("item-texts", data);
  _itemTexts = data;
  console.log(`[champions] Item descriptions cached (${Object.keys(data).length} entries)`);
  return data;
}

// ── items.ts category parser ────────────────────────────────────────────────
// Showdown items have no `flags` object; category membership is expressed via
// individual fields (megaStone, isBerry, isGem, …). We line-parse them into a
// per-item flag array so the UI can offer category filters.
const ITEM_CATEGORY_RULES = [
  ["mega",     /^\t\tmegaStone:/],
  ["primal",   /^\t\tisPrimalOrb:\s*true/],
  ["zcrystal", /^\t\tzMove:/],
  ["plate",    /^\t\tonPlate:/],
  ["pokeball", /^\t\tisPokeball:\s*true/],
  ["gem",      /^\t\tisGem:\s*true/],
  ["berry",    /^\t\tisBerry:\s*true/],
  ["choice",   /^\t\tisChoice:\s*true/],
];

function parseItemCategories(text) {
  const map = {};
  let cur = null;
  for (const line of text.split("\n")) {
    const key = line.match(/^\t([a-z0-9]+):\s*\{/);
    if (key) { cur = key[1]; map[cur] = []; continue; }
    if (!cur) continue;
    for (const [flag, re] of ITEM_CATEGORY_RULES) {
      if (re.test(line) && !map[cur].includes(flag)) map[cur].push(flag);
    }
  }
  return map;
}

/**
 * Returns { id: [categoryFlag, …] } for every Showdown item (base items.ts).
 * Memoised + disk-cached as "item-categories".
 */
let _itemCategories = null;
async function loadItemCategories() {
  if (_itemCategories) return _itemCategories;
  let cached = readCache("item-categories");
  if (cached && !isStale("item-categories")) { _itemCategories = cached; return cached; }
  const url = `${DATA_URL}/items.ts`;
  console.log(`[champions] Fetching ${url} (categories)...`);
  const res = await fetch(url, { headers: { "User-Agent": "pokemon-vgc-tool/1.0" } });
  if (!res.ok) throw new Error(`[champions] items.ts fetch failed: ${res.status}`);
  const data = parseItemCategories(await res.text());
  writeCache("item-categories", data);
  _itemCategories = data;
  console.log(`[champions] Item categories cached (${Object.keys(data).length} entries)`);
  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the display-name move list for a Pokémon in the Champions format.
 * Walks the baseSpecies → prevo chain so Mega forms inherit their base learnset.
 * Returns null if no learnset found.
 */
async function getChampionsLearnset(pokemonName) {
  const { loadPokedex, loadMoveDex, loadLearnsets: loadBaseLearnsets } = require("./showdownData");
  const [learnsets, baseLearnsets, pokedex, moveDex] = await Promise.all([
    loadLearnsets(),
    loadBaseLearnsets(),
    loadPokedex(),
    loadMoveDex(),
  ]);

  function toId(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // Walk Mega/forme → base species → pre-evolution, collecting moves from a learnset map.
  function walk(source, startId) {
    const ids = new Set();
    const visited = new Set();
    let current = startId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const entry = source[current];
      if (entry?.learnset) {
        for (const moveId of Object.keys(entry.learnset)) ids.add(moveId);
      }
      const pdx  = pokedex[current];
      const next = pdx?.baseSpecies ? toId(pdx.baseSpecies) : pdx?.prevo ? toId(pdx.prevo) : null;
      current    = next && next !== current ? next : null;
    }
    return ids;
  }

  const selfId = toId(pokemonName);

  // A Mega forme can share its baseSpecies with an NFE/illegal base (regular
  // Floette) while the legal pre-mega forme is an alternate forme: Floette-Mega
  // is only reachable from Floette-Eternal (per Floettite's megaStone map), and
  // that forme holds the move pool incl. Light of Ruin. When the direct chain
  // has no mod learnset, pull from the base species' other formes that do.
  function walkSiblingFormes(source) {
    const baseName = pokedex[selfId]?.baseSpecies;
    const formes = baseName ? pokedex[toId(baseName)]?.otherFormes : null;
    for (const formeName of formes ?? []) {
      const fid = toId(formeName);
      if (fid === selfId) continue;
      const ids = walk(source, fid);
      if (ids.size > 0) return ids;
    }
    return new Set();
  }

  // Champions mod entries are authoritative. Only when a Pokémon (and its whole base
  // chain) has no mod entry at all — e.g. Floette-Mega, whose base Floette is
  // Champions-illegal and absent from the mod learnsets — fall back to the base
  // Showdown learnset rather than returning nothing.
  let moveIds = walk(learnsets, selfId);
  if (moveIds.size === 0) moveIds = walkSiblingFormes(learnsets);
  if (moveIds.size === 0) moveIds = walk(baseLearnsets, selfId);

  if (moveIds.size === 0) return null;
  return [...moveIds]
    .map(id => moveDex[id]?.name ?? null)
    .filter(Boolean);
}

/**
 * Returns display-name list of all Pokémon legal in the Champions format.
 * Legal = `isNonstandard == null` (matches Champions item legality). Past/Future
 * formes (typed Arceus, battle-only formes like Darmanitan-Zen, cosmetic formes)
 * carry isNonstandard but often omit `tier`, so a tier-only filter lets them leak
 * in. Champions re-enables megas by giving them a real tier and clearing
 * isNonstandard, so they stay legal under this rule.
 */
async function getLegalChampionsPokemon() {
  const { loadPokedex } = require("./showdownData");
  const [formatsData, pokedex] = await Promise.all([loadFormatsData(), loadPokedex()]);

  const legal = [];
  for (const [id, data] of Object.entries(formatsData)) {
    if (data.isNonstandard != null || data.tier === "Illegal") continue;
    const name = pokedex[id]?.name;
    if (name) legal.push(name);
  }
  return legal;
}

/**
 * Force-refresh both cache files. Call this after a new regulation drops.
 */
async function refreshChampionsMod() {
  _learnsets    = null;
  _formatsData  = null;
  _legalItems   = null;
  _moveOverrides = null;
  _moveDex       = null;
  _itemTexts     = null;
  _itemCategories = null;
  for (const key of ["champions-learnsets", "champions-formats", "champions-items", "base-items", "champions-moves", "item-texts", "item-categories"]) {
    const f = cacheFile(key);
    try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
  }
  console.log("[champions] Cache cleared, re-fetching...");
  await Promise.all([loadLearnsets(), loadFormatsData(), getLegalChampionsItems(), loadMoveOverrides()]);
  console.log("[champions] Cache refreshed");
}

module.exports = { getChampionsLearnset, getLegalChampionsPokemon, getLegalChampionsItems, getChampionsMoveDex, loadItemDescriptions, loadItemCategories, refreshChampionsMod, loadLearnsets, loadFormatsData };
