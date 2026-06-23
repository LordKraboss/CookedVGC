// services/smogonSync.js — 100% Smogon/Showdown, zero PokeAPI
const { getDb } = require("../db/schema");
const { getAllRegs } = require("../../../shared/regulations");
const { getPokemonData, loadPokedex } = require("./showdownData");
const { syncLearnsets } = require("./smogonLearnsets");
const { downloadSprites } = require("./sprites");

const SMOGON_BASE = "https://www.smogon.com/stats";

async function fetchLatestMonth() {
  const res = await fetch(SMOGON_BASE + "/");
  const html = await res.text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map(m => m[1]).sort();
  return months.at(-1);
}

function chaosUrl(reg, month) {
  return `${SMOGON_BASE}/${month}/chaos/${reg.format}-${reg.ratingBracket}.json`;
}

function prevMonth(yyyyMM) {
  const [y, m] = yyyyMM.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function normalisePokemon(name, raw, totalBattles) {
  const count = raw["Raw count"] ?? raw.count ?? 0;
  const usagePct = raw.usage != null ? raw.usage * 100 : (count / (totalBattles * 6)) * 100;
  const pct = (val) => (count > 0 ? (val / count) * 100 : 0);

  const topN = (obj, n = 10) =>
    Object.entries(obj ?? {})
      .map(([k, v]) => ({ name: k, pct: parseFloat(pct(v).toFixed(2)) }))
      .sort((a, b) => b.pct - a.pct).slice(0, n);

  const spreads = Object.entries(raw.Spreads ?? {})
    .map(([k, v]) => {
      const [nature, evStr = ""] = k.split(":");
      const [hp=0, atk=0, def=0, spa=0, spd=0, spe=0] = evStr.split("/").map(Number);
      return { nature, evs: { hp, atk, def, spa, spd, spe }, pct: parseFloat(pct(v).toFixed(2)) };
    })
    .sort((a, b) => b.pct - a.pct).slice(0, 10);

  const teammates = Object.entries(raw.Teammates ?? {})
    .map(([k, v]) => ({ name: k, score: parseFloat(v.toFixed(4)) }))
    .sort((a, b) => b.score - a.score);

  return {
    name, usagePct: parseFloat(usagePct.toFixed(3)), rawCount: count,
    moves: topN(raw.Moves), items: topN(raw.Items),
    abilities: topN(raw.Abilities), spreads, teammates,
    moveNames: Object.keys(raw.Moves ?? {}),
  };
}

async function syncRegulation(reg, month = null, force = false) {
  const db = await getDb();
  if (!month) { month = await fetchLatestMonth(); console.log(`[sync] Latest month: ${month}`); }

  const existing = db.prepare("SELECT sync_month FROM regulations WHERE id = ?").get(reg.id);
  if (!force && existing?.sync_month === month) { console.log(`[sync] ${reg.id} already current`); return { skipped: true, month }; }

  console.log(`[sync] Fetching ${chaosUrl(reg, month)}`);
  const res = await fetch(chaosUrl(reg, month));
  if (!res.ok) {
    const prev = prevMonth(month);
    if (reg.startMonth && prev >= reg.startMonth) {
      console.warn(`[sync] Not found for ${month}, trying ${prev}`);
      return syncRegulation(reg, prev);
    }
    throw new Error(`No chaos data for ${reg.format} (no data found from latest back to ${reg.startMonth ?? month})`);
  }
  const chaos = await res.json();

  const totalBattles = chaos.info?.["number of battles"] ?? chaos.info?.number_of_battles ?? 1;
  const rows = Object.entries(chaos.data).map(([n, r]) => normalisePokemon(n, r, totalBattles));
  console.log(`[sync] ${reg.id}: ${rows.length} Pokémon for ${month}`);

  // Upsert regulation row
  db.prepare(`INSERT INTO regulations (id,label,format,rating,active,sync_month,last_synced)
    VALUES (?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(id) DO UPDATE SET active=excluded.active,sync_month=excluded.sync_month,last_synced=excluded.last_synced`
  ).run(reg.id, reg.label, reg.format, reg.ratingBracket, reg.active?1:0, month);

  // Upsert usage + meta in a transaction
  const usageStmt = db.prepare(`INSERT INTO pokemon_usage (reg_id,month,name,usage_pct,raw_count)
    VALUES (?,?,?,?,?) ON CONFLICT(reg_id,month,name) DO UPDATE SET usage_pct=excluded.usage_pct,raw_count=excluded.raw_count`);
  const metaStmt = db.prepare(`INSERT INTO pokemon_meta (reg_id,month,name,moves_json,items_json,spreads_json,abilities_json,teammates_json)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(reg_id,month,name) DO UPDATE SET
    moves_json=excluded.moves_json,items_json=excluded.items_json,spreads_json=excluded.spreads_json,
    abilities_json=excluded.abilities_json,teammates_json=excluded.teammates_json`);

  db.transaction((rows) => {
    for (const p of rows) {
      usageStmt.run(reg.id, month, p.name, p.usagePct, p.rawCount);
      metaStmt.run(reg.id, month, p.name,
        JSON.stringify(p.moves), JSON.stringify(p.items),
        JSON.stringify(p.spreads), JSON.stringify(p.abilities), JSON.stringify(p.teammates));
    }
  })(rows);

  // Build move→learner index from chaos data (no PokeAPI needed)
  const mlStmt = db.prepare(`INSERT OR IGNORE INTO move_learners VALUES (?,?,?,?)`);
  db.transaction((rows) => {
    for (const p of rows)
      for (const mv of p.moveNames) mlStmt.run(reg.id, month, mv.toLowerCase(), p.name);
  })(rows);

  // Build ability index
  const abilityStmt = db.prepare(`INSERT OR REPLACE INTO pokemon_abilities VALUES (?,?,?,?,?)`);
  db.transaction((rows) => {
    for (const p of rows)
      for (const ab of p.abilities)
        abilityStmt.run(reg.id, month, p.name, ab.name.toLowerCase(), ab.pct);
  })(rows);

  // Cache Showdown types/stats — pre-fetch all async data, then write in ONE transaction
  try {
    await loadPokedex(); // warm cache first (single network request)
    const pokemonDataList = await Promise.all(rows.map(p => getPokemonData(p.name)));
    const sdStmt = db.prepare(`INSERT INTO pokemon_showdown (name,types_json,stats_json,sprite_url)
      VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET
      types_json=excluded.types_json,stats_json=excluded.stats_json,sprite_url=excluded.sprite_url`);
    db.transaction((items) => {
      for (const [p, d] of items)
        sdStmt.run(p.name, JSON.stringify(d.types), JSON.stringify(d.baseStats), d.spriteUrl);
    })(rows.map((p, i) => [p, pokemonDataList[i]]));
  } catch (err) { console.warn("[sync] Showdown cache warning:", err.message); }

  // Download sprites locally so the frontend doesn't hammer the CDN on every page load
  try {
    console.log(`[sync] Downloading sprites for ${rows.length} Pokémon…`);
    await downloadSprites(rows.map(p => p.name));
  } catch (err) { console.warn("[sync] Sprite download warning:", err.message); }

  console.log(`[sync] ✓ ${reg.id} complete for ${month}`);
  return { skipped: false, month, count: rows.length };
}

// Returns the Pokémon list to use for learnset sync for a given reg.
// Champions is a mod-defined legality format, so its legal Pokémon list (from the
// mod's formats-data) is the authoritative roster for EVERY champions reg, whether
// or not chaos stats exist. Using ladder usage names instead would let non-legal
// mons that appeared on ladder leak in and drop the roster's tie to the mod. Usage %
// is still joined from pokemon_usage at read time, so no usage data is lost.
// Non-champions regs keep using their own chaos usage names.
async function getLearnsetPokemonList(reg) {
  if (reg.dexGen === "champions") {
    const { getLegalChampionsPokemon } = require("./championsData");
    try { return await getLegalChampionsPokemon(); }
    catch (err) { console.warn(`[learnsets] ${reg.id}: Could not load Champions Pokémon list:`, err.message); return []; }
  }
  const db = await getDb();
  const rows = db.prepare("SELECT DISTINCT name FROM pokemon_usage WHERE reg_id=?").all(reg.id);
  return rows.map(r => r.name);
}

async function syncAll(force = false) {
  const regs = getAllRegs();
  const results = [];

  // Phase 1: chaos data (usage stats, meta, move/ability indexes, sprites)
  for (const reg of regs) {
    try { results.push({ id: reg.id, ...await syncRegulation(reg, null, force) }); }
    catch (err) { console.error(`[sync] ${reg.id} failed:`, err.message); results.push({ id: reg.id, error: err.message }); }
  }

  // Phase 2: learnsets — runs independently so new regulations get move data
  // even before their Smogon chaos stats are published
  for (const reg of regs) {
    if (!reg.dexGen) continue;
    try {
      const names = await getLearnsetPokemonList(reg);
      if (names.length === 0) { console.log(`[learnsets] ${reg.id}: no Pokémon list available, skipping`); continue; }
      await syncLearnsets(reg, names, { force });
    } catch (err) { console.warn(`[learnsets] ${reg.id}:`, err.message); }
  }

  return results;
}

module.exports = { syncAll, syncRegulation, fetchLatestMonth };
