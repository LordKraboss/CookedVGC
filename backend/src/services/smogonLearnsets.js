// services/smogonLearnsets.js
// Populates pokemon_learnsets and learnset_learners from the Showdown Champions mod.
// Replaces the old per-Pokémon HTML scraping approach — one bulk mod fetch instead
// of ~500 individual HTTP requests.

const { getDb } = require("../db/schema");
const { getChampionsLearnset } = require("./championsData");

// Gender-split Pokémon: chaos data only tracks the M form by default name,
// but the F form exists as a separate Pokémon with a different learnset.
const GENDER_FORM_EXPANSIONS = {
  "Meowstic":    ["Meowstic-F"],
  "Indeedee":    ["Indeedee-F"],
  "Basculegion": ["Basculegion-F"],
  "Oinkologne":  ["Oinkologne-F"],
};

/**
 * Sync learnsets for all Pokémon in a regulation.
 * Skips Pokémon already stored. Pass force=true to re-fetch all.
 */
async function syncLearnsets(reg, pokemonNames, { force = false } = {}) {
  if (!reg.dexGen) {
    console.log(`[learnsets] No dexGen for ${reg.id}, skipping`);
    return;
  }

  const db = await getDb();

  const existing = new Set(
    db.prepare("SELECT pokemon_name FROM pokemon_learnsets WHERE reg_id=?")
      .all(reg.id)
      .map(r => r.pokemon_name.toLowerCase())
  );

  // Expand gender-split forms not tracked separately in chaos data
  const expanded = [...pokemonNames];
  for (const name of pokemonNames) {
    for (const extra of GENDER_FORM_EXPANSIONS[name] ?? []) {
      if (!expanded.some(n => n.toLowerCase() === extra.toLowerCase())) expanded.push(extra);
    }
  }

  const toFetch = force
    ? expanded
    : expanded.filter(n => !existing.has(n.toLowerCase()));

  if (toFetch.length === 0) {
    console.log(`[learnsets] ${reg.id}: all ${expanded.length} learnsets already cached`);
  } else {
    if (force) {
      db.prepare("DELETE FROM pokemon_learnsets WHERE reg_id=?").run(reg.id);
      db.prepare("DELETE FROM learnset_learners WHERE reg_id=?").run(reg.id);
      console.log(`[learnsets] ${reg.id}: cleared stale learnset data`);
    }

    console.log(`[learnsets] ${reg.id}: syncing ${toFetch.length} learnsets from Champions mod...`);

    const upsert = db.prepare(`
      INSERT INTO pokemon_learnsets (reg_id, pokemon_name, moves_json)
      VALUES (?, ?, ?)
      ON CONFLICT(reg_id, pokemon_name) DO UPDATE SET moves_json=excluded.moves_json
    `);
    const insertLearner = db.prepare(`
      INSERT OR REPLACE INTO learnset_learners (reg_id, move_norm, move_display, pokemon_name)
      VALUES (?, ?, ?, ?)
    `);
    const writePokemon = db.transaction((name, moves) => {
      upsert.run(reg.id, name, JSON.stringify(moves));
      for (const m of moves) {
        const norm = m.toLowerCase().replace(/[\s\-]+/g, "");
        insertLearner.run(reg.id, norm, m, name);
      }
    });

    let ok = 0, failed = 0;
    for (const name of toFetch) {
      const moves = await getChampionsLearnset(name);
      if (moves && moves.length > 0) {
        writePokemon(name, moves);
        ok++;
      } else {
        console.warn(`[learnsets] No learnset found for ${name}`);
        failed++;
      }
    }

    console.log(`[learnsets] ${reg.id}: ✓ ${ok} stored, ${failed} not found in Champions mod`);
  }

  // Populate pokemon_showdown with types/stats + download sprites for all expanded Pokémon.
  // Required so /usage, /meta, and sprite serving work for regulations that don't have chaos
  // data yet. Uses ON CONFLICT DO UPDATE so re-running is safe.
  try {
    const { getPokemonData } = require("./showdownData");
    const { downloadSprites } = require("./sprites");

    const sdStmt = db.prepare(`
      INSERT INTO pokemon_showdown (name, types_json, stats_json, sprite_url)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        types_json  = excluded.types_json,
        stats_json  = excluded.stats_json,
        sprite_url  = excluded.sprite_url
    `);

    const dataList = await Promise.all(expanded.map(n => getPokemonData(n)));
    db.transaction((items) => {
      for (const [name, d] of items) {
        if (d.types.length > 0 || Object.keys(d.baseStats).length > 0)
          sdStmt.run(name, JSON.stringify(d.types), JSON.stringify(d.baseStats), d.spriteUrl);
      }
    })(expanded.map((n, i) => [n, dataList[i]]));

    await downloadSprites(expanded);
    console.log(`[learnsets] ${reg.id}: ✓ Showdown data populated for ${expanded.length} Pokémon`);
  } catch (err) {
    console.warn(`[learnsets] ${reg.id}: Showdown data populate warning:`, err.message);
  }
}

/**
 * Get the legal moves for a Pokémon from the DB (fast path, no network).
 * Returns array of display-name strings, or null if not yet synced.
 */
async function getStoredLearnset(regId, pokemonName) {
  const db = await getDb();
  const row = db.prepare(
    "SELECT moves_json FROM pokemon_learnsets WHERE reg_id=? AND lower(pokemon_name)=lower(?)"
  ).get(regId, pokemonName);
  return row ? JSON.parse(row.moves_json) : null;
}

module.exports = { syncLearnsets, getStoredLearnset };
